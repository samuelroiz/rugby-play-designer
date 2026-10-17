// The shared play rules (model.js): the next phase and the animation pick the same ball and the same
// receiver, chosen options, Loop's hold and slide back, and the 1x pace. Run with: node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import { nextPhase } from '../js/phases.js';
import { buildSchedule, frameAt, TIMING } from '../js/animate.js';
import { playedRoutes, receiverOf, positionsAfter, curvePoint } from '../js/model.js';
import { routeGeometry } from '../js/editor.js';
import { animPlay } from './anim-play.mjs';

const players = [
  { id: 'a1', team: 'attack', label: '1' }, { id: 'a2', team: 'attack', label: '2' },
  { id: 'a3', team: 'attack', label: '3' }, { id: 'd1', team: 'defense', label: '1' },
];
const run = (id, from, a, b, order) => ({ id, type: 'run', from, points: [a, b], curve: 0, order });
const pass = (id, from, a, b, order, extra = {}) => ({ id, type: 'pass', from, to: null, points: [a, b], curve: 0, order, option: null, ...extra });

// The ball the animation moves and where it ends up just before the slide, against the next phase.
function agree(phase) {
  const play = { players, phases: [phase, nextPhase(phase, players)] };
  const s = buildSchedule(play, 0);
  const built = play.phases[1].objects.find(o => o.type === 'ball');
  const last = s.flights.at(-1);
  return { s, built, last };
}

test('two balls: the next phase and the animation move the same one', () => {
  // The later pass starts nearer the second ball; the first pass nearer the first. Both follow the first.
  const phase = {
    note: '', positions: { a1: { x: 40, y: 10 }, a2: { x: 40, y: 20 }, a3: { x: 40, y: 30 }, d1: { x: 60, y: 10 } },
    objects: [{ id: 'o1', type: 'ball', x: 41, y: 11 }, { id: 'o2', type: 'ball', x: 40, y: 22 }],
    routes: [pass('r1', 'a1', [40, 10], [40, 20], 1, { to: 'a2' }), pass('r2', 'a2', [40, 20], [40, 30], 2, { to: 'a3' })],
  };
  const { s, built } = agree(phase);
  assert.equal(s.ballId, 'o1');
  assert.equal(built.id, 'o1');
  assert.deepEqual(phase.objects[1], nextPhase(phase, players).objects[1], 'the other ball stays');
});

test('a loose pass: both pick the team-mate standing nearest the landing spot when it lands', () => {
  // a3 runs (order 1) to within 1 m of where the pass (order 2) lands; a2 stands 4 m away. Later, in order
  // 3, a3 runs off again: the catch is decided where players stand at the pass, not at the end.
  const phase = {
    note: '', positions: { a1: { x: 40, y: 10 }, a2: { x: 44, y: 20 }, a3: { x: 30, y: 20 }, d1: { x: 40.5, y: 20 } },
    objects: [{ id: 'o1', type: 'ball', x: 41, y: 11 }],
    routes: [run('r1', 'a3', [30, 20], [40, 21], 1), pass('r2', 'a1', [40, 10], [40, 20], 2), run('r3', 'a3', [40, 21], [55, 40], 3)],
  };
  const { s, built, last } = agree(phase);
  assert.equal(last.catcher, 'a3', 'not the nearer defender, not a2');
  assert.equal(receiverOf(phase.routes[1], players, positionsAfter(phase.routes, phase.positions, 2)), 'a3');
  assert.deepEqual([built.x, built.y], [56.1, 40.9], 'the ball is in a3\'s hands where they end up');
  const end = frameAt(s, s.routesEnd);
  assert.ok(Math.hypot(end.objects.o1.x - end.players.a3.x, end.objects.o1.y - end.players.a3.y) < 3, 'and a3 carries it in the animation');
});

test('options: only A builds the next phase and animates by default; a chosen option plays instead', () => {
  const play = animPlay();
  const routes = play.phases[0].routes;
  assert.deepEqual(playedRoutes(routes).map(r => r.id), ['r1', 'r2', 'r3', 'r5']);
  assert.deepEqual(playedRoutes(routes, 'B').map(r => r.id), ['r1', 'r2', 'r4', 'r5']);
  const b = buildSchedule(play, 0, { option: 'B' });
  assert.deepEqual(b.flights.map(f => f.route.id), ['r4']);
  assert.equal(b.flights[0].catcher, 'a13');
  assert.equal(b.next, null, 'option B stops at the end of its phase');
  assert.equal(b.total, b.routesEnd + TIMING.endHold);
  const f = frameAt(b, b.flights[0].end);
  assert.ok(Math.hypot(f.objects.o1.x - (f.players.a13.x + 1.1), f.objects.o1.y - (f.players.a13.y + 0.9)) < 1e-6, 'the ball goes to 13');
  // A letter nobody has plays as normal.
  assert.equal(buildSchedule(play, 0, { option: 'C' }).next, play.phases[1]);
});

test('Loop: the last phase holds 1.5 s, then slides back to phase 1', () => {
  const play = animPlay();
  const s = buildSchedule(play, 2, { loop: true });
  assert.ok(s.looping && s.next === play.phases[0]);
  assert.equal(s.slideStart, s.routesEnd + 1500);
  assert.equal(s.total, s.slideStart + TIMING.tween);
  const held = frameAt(s, s.slideStart);
  assert.deepEqual(held.players.a10, play.phases[2].positions.a10, 'still on the last phase while held');
  const mid = frameAt(s, s.slideStart + TIMING.tween / 2);
  assert.ok(mid.players.a10.x < 50 && mid.players.a10.x > 40, 'sliding back');
  assert.deepEqual(frameAt(s, s.total).players.a10, play.phases[0].positions.a10, 'ends exactly on phase 1');
  assert.equal(buildSchedule(play, 1, { loop: true }).looping, false, 'only the last phase loops');
});

test('1x is half the old pace: a 7 m run takes 2 s', () => {
  const play = animPlay();
  play.phases[2].routes = [run('r1', 'a10', [50, 32], [57, 32], 1)];
  const m = buildSchedule(play, 2).moves[0];
  assert.equal(m.end - m.start, 2000);
  assert.equal(TIMING.lead, 800);
});

test('each route knows when it starts moving, for hiding its badge', () => {
  const s = buildSchedule(animPlay(), 0);
  assert.equal(s.starts.get('r1'), TIMING.lead);
  assert.equal(s.starts.get('r3'), s.flights[0].start);
  assert.equal(s.starts.has('r4'), false, 'option B never moves');
});

test('the curve point matches the drawn Bézier', () => {
  const r = { points: [[10, 10], [30, 20]], curve: 3 };
  const { control: c } = routeGeometry(r);
  for (const u of [0, 0.3, 1]) {
    const v = 1 - u;
    const p = curvePoint(r, u);
    assert.ok(Math.abs(p.x - (v * v * 10 + 2 * v * u * c.x + u * u * 30)) < 1e-9 && Math.abs(p.y - (v * v * 10 + 2 * v * u * c.y + u * u * 20)) < 1e-9);
  }
});
