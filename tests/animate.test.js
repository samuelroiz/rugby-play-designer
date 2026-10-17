// Animation timing and frames. Run with: node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, frameAt, TIMING } from '../js/animate.js';
import { routeGeometry } from '../js/editor.js';
import { animPlay } from './anim-play.mjs';

const bezier = (r, u) => {
  const { control: c } = routeGeometry(r);
  const [[x1, y1], [x2, y2]] = [r.points[0], r.points.at(-1)];
  const v = 1 - u;
  return { x: v * v * x1 + 2 * v * u * c.x + u * u * x2, y: v * v * y1 + 2 * v * u * c.y + u * u * y2 };
};
const near = (p, q, tol = 1e-6) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;

test('routes with the same order start together; the pass waits for the passer; option B never plays', () => {
  const s = buildSchedule(animPlay(), 0);
  const move = id => s.moves.find(m => m.route.id === id);
  assert.equal(move('r1').start, TIMING.lead);
  assert.equal(move('r2').start, move('r1').start);
  assert.deepEqual(s.flights.map(f => f.route.id), ['r3']);
  assert.equal(s.flights[0].start, move('r1').end, 'the ball leaves when 10 has finished his run');
  assert.ok(move('r5').start > Math.max(move('r1').end, move('r2').end, s.flights[0].end), 'order 2 starts after order 1');
  assert.equal(s.total, s.routesEnd + TIMING.tween);
});

test('runs follow their curve; the ball is carried, then flies to the receiver', () => {
  const play = animPlay();
  const s = buildSchedule(play, 0);
  const r2 = play.phases[0].routes[1];
  const m2 = s.moves.find(m => m.route.id === 'r2');
  for (const k of [0.25, 0.5, 0.75]) {
    const p = frameAt(s, m2.start + k * (m2.end - m2.start)).players.a12;
    const closest = Math.min(...Array.from({ length: 401 }, (_, i) => Math.hypot(bezier(r2, i / 400).x - p.x, bezier(r2, i / 400).y - p.y)));
    assert.ok(closest < 0.02, `12 is on the curve at ${k}: ${closest}`);
  }
  const m1 = s.moves.find(m => m.route.id === 'r1');
  for (const k of [0, 0.5, 0.99]) {
    const f = frameAt(s, m1.start + k * (m1.end - m1.start));
    assert.ok(near({ x: f.objects.o1.x - f.players.a10.x, y: f.objects.o1.y - f.players.a10.y }, { x: 1.1, y: 0.9 }, 1e-9), 'ball in 10\'s hands');
  }
  const flight = s.flights[0];
  const mid = frameAt(s, (flight.start + flight.end) / 2);
  assert.ok(Math.hypot(mid.objects.o1.x - mid.players.a10.x, mid.objects.o1.y - mid.players.a10.y) > 2, 'ball has left 10');
  const caught = frameAt(s, flight.end);
  assert.ok(near(caught.objects.o1, { x: caught.players.a12.x + 1.1, y: caught.players.a12.y + 0.9 }, 1e-9), 'ball in 12\'s hands');
  // Option B goes towards 13 (y 20): the ball never heads that way.
  for (let t = 0; t <= s.routesEnd; t += 20) assert.ok(frameAt(s, t).objects.o1.y > 29, `ball at ${t}`);
});

test('the end of a phase\'s animation is exactly the next phase', () => {
  const play = animPlay();
  for (const i of [0, 1]) {
    const s = buildSchedule(play, i);
    const end = frameAt(s, s.total);
    for (const [id, p] of Object.entries(play.phases[i + 1].positions)) assert.deepEqual(end.players[id], p, id);
    for (const o of play.phases[i + 1].objects) {
      if (end.objects[o.id]) assert.deepEqual({ x: end.objects[o.id].x, y: end.objects[o.id].y }, { x: o.x, y: o.y }, o.id);
    }
    assert.equal(end.routeOpacity, 0);
  }
  // 12 of the defense has no route: still until the slide, then part way, then there.
  const s = buildSchedule(play, 0);
  assert.deepEqual(frameAt(s, s.routesEnd).players.d12, play.phases[0].positions.d12);
  const half = frameAt(s, s.routesEnd + TIMING.tween / 2).players.d12;
  assert.ok(half.x < 60 && half.x > 57.3, JSON.stringify(half));
  // The ruck isn't in phase 3: it fades out on the way.
  const s2 = buildSchedule(play, 1);
  assert.ok(frameAt(s2, s2.routesEnd + TIMING.tween / 2).objects.o2.opacity < 1);
});

test('the last phase plays its routes and holds; a pass with no ball gets one', () => {
  const play = animPlay();
  const s = buildSchedule(play, 2);
  assert.equal(s.next, null);
  assert.equal(s.total, TIMING.lead + TIMING.endHold);
  play.phases[2].routes = [{ id: 'r1', type: 'pass', from: 'a10', to: null, points: [[50, 32], [52, 40]], curve: 0, order: 1, option: null }];
  play.phases[2].objects = [];
  const s2 = buildSchedule(play, 2);
  assert.equal(frameAt(s2, 0).extraBall, null);
  const f = frameAt(s2, s2.flights[0].start + 1);
  assert.ok(f.extraBall && near(f.extraBall, { x: 50, y: 32 }, 0.2), JSON.stringify(f.extraBall));
  assert.equal(s2.flights[0].catcher, 'a12', 'nearest team-mate within 5 m of where it lands');
});

test('a player with two runs does them one after the other and ends where the last one ends', () => {
  const play = animPlay();
  play.phases[0].routes.push({ id: 'r6', type: 'run', from: 'a13', points: [[45, 20], [48, 18]], curve: 0, order: 1 },
    { id: 'r7', type: 'run', from: 'a13', points: [[45, 20], [46, 15]], curve: 0, order: 1 });
  const s = buildSchedule(play, 0);
  const [m6, m7] = ['r6', 'r7'].map(id => s.moves.find(m => m.route.id === id));
  assert.equal(m7.start, m6.end);
  assert.deepEqual(frameAt(s, s.routesEnd).players.a13, { x: 46, y: 15 });
});
