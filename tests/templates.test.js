// Every template listed in templates/index.json is a valid play file. Run with: node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parsePlay } from '../js/storage.js';
import { nextPhase } from '../js/phases.js';
import { positionsAfter } from '../js/model.js';

const dir = new URL('../templates/', import.meta.url);
const index = JSON.parse(fs.readFileSync(new URL('index.json', dir)));

test('index.json lists names and files that exist', () => {
  assert.ok(Array.isArray(index) && index.length > 0);
  for (const t of index) {
    assert.equal(typeof t.name, 'string');
    assert.ok(fs.existsSync(new URL(t.file, dir)), t.file);
  }
});

for (const t of index) {
  test(`${t.name}: loads like a saved play, players numbered 1-15 per team`, () => {
    const play = parsePlay(JSON.parse(fs.readFileSync(new URL(t.file, dir))));
    const ids = play.players.map(p => p.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const p of play.players) {
      assert.equal(p.id, (p.team === 'attack' ? 'a' : 'd') + p.label);
      assert.ok(Number(p.label) >= 1 && Number(p.label) <= 15);
      for (const ph of play.phases) assert.ok(ph.positions[p.id], `${p.id} has a position`);
    }
  });
}

// A 9 to 10 pass from a set piece mustn't cross the pack: the 10 stands on the 9's side, and the line
// between them is clear of every forward in the set piece's group.
const segDist = (p, a, b) => {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
};
for (const file of ['scrum.json', 'lineout.json']) {
  test(`${file}: each 9 to 10 pass is clear of the pack`, () => {
    const play = parsePlay(JSON.parse(fs.readFileSync(new URL(file, dir))));
    const ph = play.phases[0];
    const set = ph.objects.find(o => o.pack);
    for (const t of ['a', 'd']) {
      const nine = ph.positions[`${t}9`];
      const ten = ph.positions[`${t}10`];
      if (set.type === 'scrum') assert.equal(Math.sign(ten.y - set.y), Math.sign(nine.y - set.y), `${t}10 on the 9's side of the scrum`);
      for (const id of set.pack.filter(id => id !== `${t}9` && id !== `${t}10`)) {
        assert.ok(segDist(ph.positions[id], nine, ten) > 2.4, `${t}9 to ${t}10 passes ${id}`);
      }
    }
  });
}

// The About box's example (not in the picker): a finished play whose phases follow on with Add Phase rules.
test('example.json: loads, stays out of the picker, each phase built from the one before', () => {
  const raw = JSON.parse(fs.readFileSync(new URL('example.json', dir)));
  const play = parsePlay(raw);
  assert.deepEqual(play, raw, 'loads unchanged');
  assert.equal(play.name, 'Example: Scrum 12 crash');
  assert.ok(!index.some(t => t.file === 'example.json'));
  assert.equal(play.phases.length, 3);
  for (let i = 1; i < play.phases.length; i++) {
    const built = nextPhase(play.phases[i - 1], play.players);
    assert.deepEqual(play.phases[i].positions, built.positions, `phase ${i + 1} positions`);
    assert.deepEqual(play.phases[i].objects, built.objects, `phase ${i + 1} markers`);
  }
  for (const ph of play.phases) assert.ok(ph.note.trim(), 'each phase has a note');
  // Phase 1: 9 to 10. Phase 2: 10's options, A to 12 and B a kick with its label. Phase 3: 12 carries.
  const [p1, p2, p3] = play.phases;
  assert.deepEqual(p1.routes.filter(r => r.type === 'pass').map(r => [r.from, r.to]), [['a9', 'a10']]);
  const options = p2.routes.filter(r => r.option).map(r => [r.option, r.type, r.from, r.to ?? null, r.optionLabel ?? null]);
  assert.deepEqual(options, [['A', 'pass', 'a10', 'a12', null], ['B', 'kick', 'a10', null, 'if 12 rushes up']]);
  assert.ok(p3.routes.some(r => r.type === 'run' && r.from === 'a12'));
  for (const ph of [p2, p3]) assert.ok(ph.routes.filter(r => r.type === 'drift' && r.from.startsWith('d')).length >= 2, 'defenders drift');
  // Passes are flat or backwards (attack goes towards +x), as drawn and where the players are when the ball goes.
  for (const ph of play.phases) {
    for (const r of ph.routes.filter(r => r.type === 'pass')) {
      assert.ok(r.points[1][0] <= r.points[0][0], `${r.from} to ${r.to} drawn backwards`);
      const at = positionsAfter(ph.routes, ph.positions, r.order);
      assert.ok(at[r.to].x <= at[r.from].x, `${r.from} to ${r.to} thrown backwards`);
    }
  }
});
