// Auto jobs (jobs.js): the short line made from a player's routes in a phase when the coach hasn't written
// one, one test per rule, and the written instruction winning. Run with: node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import { autoJob, jobLine, kickKind } from '../js/jobs.js';
import { parsePlay } from '../js/storage.js';

const POS = { a9: { x: 50, y: 30 }, a10: { x: 44, y: 32 }, a12: { x: 42, y: 40 }, a13: { x: 40, y: 48 }, d10: { x: 60, y: 32 } };
// A play whose phase 1 has `routes` (and `objects`), and, with `next`, a phase 2 with those objects.
function play(routes, { objects = [], next = null, instructions, positions = POS } = {}) {
  const p = {
    schemaVersion: 1, name: 'Jobs',
    players: Object.keys(positions).map(id => ({ id, team: id[0] === 'a' ? 'attack' : 'defense', label: id.slice(1) })),
    phases: [{ note: '', positions: structuredClone(positions), objects: [{ id: 'o1', type: 'ball', x: 51.1, y: 30.9 }, ...objects], routes, instructions }],
  };
  if (next) p.phases.push({ note: '', positions: structuredClone(positions), objects: next, routes: [] });
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
  const k = (to, box = false) => kickKind({ points: [[50, 30], to] }, 'attack', { box });
  assert.equal(k([60, 32]), 'Grubber', '10 m forward');
  assert.equal(k([75, 30], true), 'Box kick', '25 m forward, by a 9 (or from a ruck)');
  assert.equal(k([75, 30]), 'Kick', '25 m forward by anyone else');
  assert.equal(k([90, 35]), 'Long kick', '40 m forward');
  assert.equal(k([60, 62]), 'Cross-field kick', 'more across than forward');
  assert.equal(k([40, 30], true), 'Kick', 'backwards');
  assert.equal(kickKind({ points: [[50, 30], [25, 30]] }, 'defense', { box: true }), 'Box kick', "defense kicks towards -x");
  assert.equal(autoJob(play([kick('a9', [75, 30])]), 0, 'a9'), 'Box kick');
  assert.equal(autoJob(play([kick('a9', [56, 31])]), 0, 'a9'), 'Grubber');
});

test('"Box kick" only from 9, or from within 5 m of a ruck; otherwise the length rules or "Kick"', () => {
  assert.equal(autoJob(play([kick('a10', [69, 32])]), 0, 'a10'), 'Kick', '25 m by 10, no ruck');
  assert.equal(autoJob(play([kick('a10', [69, 32])], { objects: [{ id: 'o2', type: 'ruck', x: 47, y: 33 }] }), 0, 'a10'), 'Box kick', '10 kicks from 3 m off a ruck');
  assert.equal(autoJob(play([kick('a10', [69, 32])], { objects: [{ id: 'o2', type: 'ruck', x: 52, y: 40 }] }), 0, 'a10'), 'Kick', 'the ruck is more than 5 m away');
  assert.equal(autoJob(play([kick('a10', [84, 32])]), 0, 'a10'), 'Long kick', 'a long kick is a long kick whoever takes it');
  assert.equal(autoJob(play([kick('a10', [52, 33])]), 0, 'a10'), 'Grubber');
  // Kicked after a run: measured from where the kick is taken.
  assert.equal(autoJob(play([run('a10', [60, 32]), kick('a10', [84, 32], 2)]), 0, 'a10'), 'Run your line, then kick', '24 m from where he kicks it');
});

// The back three: 15 deep at (30, 35), 14 and 11 on the wings.
const BACK = { ...POS, a11: { x: 36, y: 8 }, a14: { x: 36, y: 62 }, a15: { x: 30, y: 35 } };
const backPlay = routes => play(routes, { positions: BACK });
const runFrom = (id, to, order = 1) => ({ id: `b-${id}-${order}`, type: 'run', from: id, points: [[BACK[id].x, BACK[id].y], to], curve: 0, order, option: null });

test('a wing or the fullback running backwards: "Cover the backfield"', () => {
  assert.equal(autoJob(backPlay([runFrom('a15', [24, 35])]), 0, 'a15'), 'Cover the backfield', '15 drops back 6 m');
  assert.equal(autoJob(backPlay([runFrom('a14', [30, 60])]), 0, 'a14'), 'Cover the backfield', '14 drops back');
  assert.equal(autoJob(backPlay([runFrom('a15', [40, 35])]), 0, 'a15'), 'Run your line', 'running forward');
  assert.equal(autoJob(backPlay([runFrom('a15', [30, 45])]), 0, 'a15'), 'Run your line', 'straight across');
  assert.equal(autoJob(backPlay([{ ...run('a13', [34, 48]) }]), 0, 'a13'), 'Run your line', 'a centre running back is just a run');
});

test('a wing or the fullback staying deep while team-mates chase a kick: "Cover the backfield"', () => {
  const chase = [kick('a9', [75, 30]), run('a13', [68, 36]), run('a12', [70, 40])];
  assert.equal(autoJob(backPlay(chase), 0, 'a15'), 'Cover the backfield', '15 holds 20 m behind the kick');
  assert.equal(autoJob(backPlay([...chase, runFrom('a15', [32, 30])]), 0, 'a15'), 'Cover the backfield', '15 shuffles across, still deep');
  assert.equal(autoJob(backPlay([...chase, runFrom('a14', [72, 36])]), 0, 'a14'), 'Chase the kick', 'the wing who chases chases');
  assert.equal(autoJob(backPlay([kick('a9', [75, 30])]), 0, 'a15'), 'Hold your spot', 'nobody chases');
  assert.equal(autoJob(backPlay(chase), 0, 'a10'), 'Hold your spot', 'only the back three cover');
  // 11 near the kick (36 vs the kick at 50: 14 m behind) is deep too; level with it isn't.
  assert.equal(autoJob(backPlay(chase), 0, 'a11'), 'Cover the backfield');
  const level = backPlay(chase);
  level.phases[0].positions.a11 = { x: 48, y: 8 };
  assert.equal(autoJob(level, 0, 'a11'), 'Hold your spot', 'not 5 m behind the kick');
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
