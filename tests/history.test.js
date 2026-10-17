// Undo history: the step limit, the size limit, and rebasing (turning the pitch). Run with: node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from '../js/history.js';

function setup(opts = {}) {
  const doc = { play: { n: 0, orientation: 'horizontal' }, phase: 0 };
  const history = createHistory({
    read: () => ({ play: JSON.stringify(doc.play), phase: doc.phase }),
    write: (json, phase) => { doc.play = JSON.parse(json); doc.phase = phase; },
    ...opts,
  });
  return { doc, history };
}

test('at most 200 steps', () => {
  const { doc, history } = setup();
  for (let i = 1; i <= 250; i++) { doc.play.n = i; history.commit(); }
  assert.equal(history.steps, 200);
  while (history.undo());
  assert.equal(doc.play.n, 50);
});

test('the oldest steps go once the snapshots pass the size limit', () => {
  const { doc, history } = setup({ maxBytes: 100_000 });
  for (let i = 1; i <= 30; i++) { doc.play = { n: i, big: 'x'.repeat(10_000), orientation: 'horizontal' }; history.commit(); }
  assert.ok(history.bytes <= 100_000, String(history.bytes));
  assert.ok(history.steps >= 4 && history.steps < 30, String(history.steps));
  // Redo counts too.
  for (let i = 0; i < 3; i++) history.undo();
  assert.ok(history.bytes <= 100_000);
  assert.ok(history.canRedo);
});

test('the real default keeps about 20 MB', () => {
  const { doc, history } = setup();
  const big = 'x'.repeat(1_000_000); // 2 MB a snapshot
  for (let i = 1; i <= 30; i++) { doc.play = { n: i, big, orientation: 'horizontal' }; history.commit(); }
  assert.ok(history.bytes <= 20e6 && history.steps >= 8, `${history.bytes} ${history.steps}`);
});

test('rebase changes every snapshot without adding a step or clearing redo', () => {
  const { doc, history } = setup();
  for (let i = 1; i <= 3; i++) { doc.play.n = i; history.commit(); }
  history.undo();
  const turn = json => json.replace('"orientation":"horizontal"', '"orientation":"vertical"');
  doc.play.orientation = 'vertical';
  history.rebase(turn);
  assert.equal(history.commit(), false, 'turning the pitch is not a step');
  assert.ok(history.canRedo, 'redo kept');
  history.undo();
  assert.deepEqual(doc.play, { n: 1, orientation: 'vertical' }, 'undo keeps the pitch turned');
  history.redo();
  history.redo();
  assert.deepEqual(doc.play, { n: 3, orientation: 'vertical' });
});
