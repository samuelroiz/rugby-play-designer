// Set pieces placed where the user clicks, reusing the phase's nearest ball, and the order number a newly
// drawn route gets. Run with: node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import { placeScrum, placeLineout } from '../js/setpiece.js';
import { newRouteOrder } from '../js/model.js';
import { blankPlay } from '../js/storage.js';

const balls = phase => phase.objects.filter(o => o.type === 'ball');

test('a scrum goes at the legal mark nearest the click, and moves the nearest ball there', () => {
  const play = blankPlay();
  const ph = play.phases[0];
  ph.objects.push({ id: 'o1', type: 'ball', x: 90, y: 60 }, { id: 'o2', type: 'ball', x: 35, y: 30 });
  const scrum = placeScrum(play, ph, { x: 30.04, y: 19 }, 'attack');
  assert.deepEqual([scrum.x, scrum.y], [30, 15]);
  assert.equal(balls(ph).length, 2, 'no ball added');
  const moved = ph.objects.find(o => o.id === 'o2');
  assert.deepEqual([moved.x, moved.y], [30, 10.3], 'the nearer ball, on the put-in side');
  assert.deepEqual(ph.objects.find(o => o.id === 'o1'), { id: 'o1', type: 'ball', x: 90, y: 60 });
});

test('a second scrum goes where clicked, not on the old mark; a ball is added only when there is none', () => {
  const play = blankPlay();
  const ph = play.phases[0];
  placeScrum(play, ph, { x: 50, y: 35 }, 'attack');
  assert.equal(balls(ph).length, 1);
  const scrum = placeScrum(play, ph, { x: 70, y: 60 }, 'defense');
  assert.deepEqual([scrum.x, scrum.y], [70, 55]);
  assert.equal(ph.objects.filter(o => o.type === 'scrum').length, 1);
  assert.equal(balls(ph).length, 1);
});

test('a lineout goes on the 5 m line of the touchline nearer the click, reusing the marker and the ball', () => {
  const play = blankPlay();
  const ph = play.phases[0];
  ph.objects.push({ id: 'o1', type: 'lineout', x: 20, y: 5 }, { id: 'o2', type: 'ball', x: 50, y: 35 });
  const marker = placeLineout(play, ph, { x: 64.2, y: 58 }, 'defense');
  assert.equal(marker.id, 'o1');
  assert.deepEqual([marker.x, marker.y], [64.2, 65]);
  assert.equal(balls(ph).length, 1);
  assert.ok(balls(ph)[0].y > 66, 'the ball is with the thrower on the far touchline');
});

test('a pass or kick is the next step; a run, decoy, drift or blitz moves with the latest step', () => {
  assert.equal(newRouteOrder('run', []), 1);
  assert.equal(newRouteOrder('pass', []), 1);
  const routes = [{ order: 1 }, { order: 3 }];
  for (const type of ['pass', 'kick']) assert.equal(newRouteOrder(type, routes), 4);
  for (const type of ['run', 'decoy', 'drift', 'blitz']) assert.equal(newRouteOrder(type, routes), 3);
});
