// Auto jobs (jobs.js): the short line made from a player's routes in a phase when the coach hasn't written
// one, one test per rule, and the written instruction winning. Run with: node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import { autoJob, jobLine, kickKind } from '../js/jobs.js';
import { parsePlay } from '../js/storage.js';

const POS = { a9: { x: 50, y: 30 }, a10: { x: 44, y: 32 }, a12: { x: 42, y: 40 }, a13: { x: 40, y: 48 }, d10: { x: 60, y: 32 } };
// A play whose phase 1 has `routes` (and `objects`), and, with `next`, a phase 2 with those objects.
function play(routes, { objects = [], next = null, instructions } = {}) {
  const p = {
    schemaVersion: 1, name: 'Jobs',
    players: Object.keys(POS).map(id => ({ id, team: id[0] === 'a' ? 'attack' : 'defense', label: id.slice(1) })),
    phases: [{ note: '', positions: structuredClone(POS), objects: [{ id: 'o1', type: 'ball', x: 51.1, y: 30.9 }, ...objects], routes, instructions }],
  };
  if (next) p.phases.push({ note: '', positions: structuredClone(POS), objects: next, routes: [] });
  return parsePlay(p);
}
const at = id => [POS[id].x, POS[id].y];
const run = (id, to, order = 1, type = 'run') => ({ id: `r-${id}-${type}-${order}`, type, from: id, points: [at(id), to], curve: 0, order, option: null });
const pass = (from, to, order = 1, option = null) => ({ id: `p-${from}-${to}`, type: 'pass', from, to, points: [at(from), at(to)], curve: 0, order, option });
const kick = (from, to, order = 1) => ({ id: `k-${from}`, type: 'kick', from, points: [at(from), to], curve: 0, order, option: null });

test('pass: "Pass to 12"', () => {
  assert.equal(autoJob(play([pass('a9', 'a10')]), 0, 'a9'), 'Pass to 10');
});

test('receives a pass: "Take the pass from 10"', () => {
  assert.equal(autoJob(play([pass('a9', 'a10')]), 0, 'a10'), 'Take the pass from 9');
});

test('kick: by its length and direction', () => {
  const k = to => kickKind({ points: [[50, 30], to] }, 'attack');
  assert.equal(k([60, 32]), 'Grubber', '10 m forward');
  assert.equal(k([75, 30]), 'Box kick', '25 m forward');
  assert.equal(k([90, 35]), 'Long kick', '40 m forward');
  assert.equal(k([60, 62]), 'Cross-field kick', 'more across than forward');
  assert.equal(k([40, 30]), 'Kick', 'backwards');
  assert.equal(kickKind({ points: [[50, 30], [25, 30]] }, 'defense'), 'Box kick', "defense kicks towards -x");
  assert.equal(autoJob(play([kick('a9', [75, 30])]), 0, 'a9'), 'Box kick');
  assert.equal(autoJob(play([kick('a9', [56, 31])]), 0, 'a9'), 'Grubber');
});

test('run that ends within 10 m of where a kick lands: "Chase the kick"', () => {
  assert.equal(autoJob(play([kick('a9', [75, 30]), run('a13', [68, 36])]), 0, 'a13'), 'Chase the kick');
  assert.equal(autoJob(play([kick('a9', [75, 30]), run('a13', [55, 46])]), 0, 'a13'), 'Run your line', 'too far from where it lands');
});

test('run: "Run your line", decoy: "Decoy run"', () => {
  assert.equal(autoJob(play([run('a13', [48, 50])]), 0, 'a13'), 'Run your line');
  assert.equal(autoJob(play([run('a13', [48, 50], 1, 'decoy')]), 0, 'a13'), 'Decoy run');
});

test('carries into a new ruck: "Carry into contact"', () => {
  const ruck = [{ id: 'o2', type: 'ruck', x: 58, y: 31 }];
  // a9 holds the ball (it is within 3 m of them) and runs to where phase 2 has a new ruck.
  assert.equal(autoJob(play([run('a9', [57, 30])], { next: ruck }), 0, 'a9'), 'Carry into contact');
  assert.equal(autoJob(play([run('a9', [57, 30])], { objects: ruck, next: ruck }), 0, 'a9'), 'Run your line', 'the ruck was already there');
  assert.equal(autoJob(play([run('a13', [57, 30])], { next: ruck }), 0, 'a13'), 'Run your line', 'no ball, no carry');
  assert.equal(autoJob(play([run('a9', [57, 30])]), 0, 'a9'), 'Run your line', 'no next phase');
});

test('drift: "Drift across", blitz: "Blitz up"', () => {
  assert.equal(autoJob(play([run('d10', [58, 36], 1, 'drift')]), 0, 'd10'), 'Drift across');
  assert.equal(autoJob(play([run('d10', [52, 32], 1, 'blitz')]), 0, 'd10'), 'Blitz up');
});

test('no route: "Hold your spot"', () => {
  assert.equal(autoJob(play([]), 0, 'a12'), 'Hold your spot');
  assert.equal(autoJob(play([pass('a9', 'a10')]), 0, 'a13'), 'Hold your spot');
});

test('two things combine in the order they happen', () => {
  const ruck = [{ id: 'o2', type: 'ruck', x: 50, y: 40 }];
  assert.equal(autoJob(play([pass('a10', 'a12'), run('a12', [49, 40], 2)], { next: ruck }), 0, 'a12'), 'Take the pass from 10, then carry into contact');
  assert.equal(autoJob(play([run('a10', [46, 31]), pass('a10', 'a12')]), 0, 'a10'), 'Run your line, then pass to 12');
  assert.equal(autoJob(play([pass('a9', 'a10'), pass('a10', 'a12', 2)]), 0, 'a10'), 'Take the pass from 9, then pass to 12');
});

test('at most two, the ball first', () => {
  const routes = [run('a10', [46, 31]), pass('a9', 'a10', 2), run('a10', [48, 33], 3), pass('a10', 'a12', 4)];
  routes[2].points[0] = [46, 31];
  assert.equal(autoJob(play(routes), 0, 'a10'), 'Take the pass from 9, then pass to 12');
});

test('only option A counts', () => {
  const routes = [pass('a10', 'a12', 1, 'A'), { ...pass('a10', 'a13', 1, 'B'), id: 'p-b' }];
  assert.equal(autoJob(play(routes), 0, 'a10'), 'Pass to 12');
  assert.equal(autoJob(play(routes), 0, 'a13'), 'Hold your spot');
});

test('the written instruction wins; the auto job is never saved', () => {
  const p = play([pass('a9', 'a10')], { instructions: { a9: 'Quick ball to 10.' } });
  assert.equal(jobLine(p, 0, 'a9'), 'Quick ball to 10.');
  assert.equal(jobLine(p, 0, 'a10'), 'Take the pass from 9');
  assert.deepEqual(p.phases[0].instructions, { a9: 'Quick ball to 10.' });
});
