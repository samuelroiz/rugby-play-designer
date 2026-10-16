// Pass and kick options: lettering, closing up, making one the main option, and the next phase
// following option A. Run with: node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import { syncOptions, makeMainOption, optionGroup } from '../js/options.js';
import { nextPhase } from '../js/phases.js';

const players = [
  { id: 'a1', team: 'attack', label: '1' },
  { id: 'a2', team: 'attack', label: '2' },
  { id: 'a3', team: 'attack', label: '3' },
];
const route = (id, type, order, end, extra = {}) => ({ id, type, from: 'a1', points: [[40, 10], end], curve: 0, order, option: null, ...extra });
const letters = routes => routes.map(r => `${r.order}${r.option ?? ''}`);

test('a second pass makes both options A and B with the first one\'s order', () => {
  const routes = [route('r1', 'run', 1, [45, 12], { option: undefined }), route('r2', 'pass', 2, [40, 20]), route('r3', 'pass', 3, [40, 30])];
  syncOptions(routes, ['a1']);
  assert.deepEqual(letters(routes.slice(1)), ['2A', '2B']);
  assert.equal(routes[0].option, undefined, 'runs are never options');
});

test('pass + kick are options; a third becomes C', () => {
  const routes = [route('r1', 'pass', 1, [40, 20]), route('r2', 'kick', 2, [70, 30])];
  syncOptions(routes, ['a1']);
  assert.deepEqual(letters(routes), ['1A', '1B']);
  routes.push(route('r3', 'pass', 3, [38, 25]));
  syncOptions(routes, ['a1']);
  assert.deepEqual(letters(routes), ['1A', '1B', '1C']);
});

test('removing options closes the letters up; one left is a normal route', () => {
  const routes = [route('r1', 'pass', 1, [40, 20]), route('r2', 'kick', 2, [70, 30]), route('r3', 'pass', 3, [38, 25])];
  syncOptions(routes, ['a1']);
  routes.splice(1, 1);
  syncOptions(routes, ['a1']);
  assert.deepEqual(letters(routes), ['1A', '1B']);
  routes.splice(0, 1);
  syncOptions(routes, ['a1']);
  assert.deepEqual(letters(routes), ['1']);
});

test('players not listed are left alone (older plays load unchanged)', () => {
  const routes = [route('r1', 'pass', 1, [40, 20], { option: undefined }), route('r2', 'pass', 2, [40, 30], { option: undefined })];
  const before = structuredClone(routes);
  syncOptions(routes, []);
  assert.deepEqual(routes, before);
});

test('make B the main option: it becomes A, the others follow in order', () => {
  const routes = [route('r1', 'pass', 1, [40, 20]), route('r2', 'kick', 2, [70, 30]), route('r3', 'pass', 3, [38, 25])];
  syncOptions(routes, ['a1']);
  makeMainOption(routes, routes[1]);
  assert.deepEqual(routes.map(r => r.option), ['B', 'A', 'C']);
  assert.deepEqual(optionGroup(routes, 'a1').map(r => r.id), ['r2', 'r1', 'r3']);
});

test('the next phase follows option A only', () => {
  const phase = {
    note: '',
    positions: { a1: { x: 40, y: 10 }, a2: { x: 40, y: 20 }, a3: { x: 40, y: 30 } },
    objects: [{ id: 'o1', type: 'ball', x: 41, y: 11 }],
    routes: [route('r1', 'pass', 1, [40, 20], { to: 'a2' }), route('r2', 'pass', 2, [40, 30], { to: 'a3' })],
  };
  syncOptions(phase.routes, ['a1']);
  assert.deepEqual(nextPhase(phase, players).objects[0], { id: 'o1', type: 'ball', x: 41.1, y: 20.9 }, 'ball to A\'s receiver a2');
  makeMainOption(phase.routes, phase.routes[1]);
  assert.deepEqual(nextPhase(phase, players).objects[0], { id: 'o1', type: 'ball', x: 41.1, y: 30.9 }, 'ball to the new A\'s receiver a3');
});

test('a kick as option A takes the ball to the kick\'s end', () => {
  const phase = {
    note: '',
    positions: { a1: { x: 40, y: 10 }, a2: { x: 40, y: 20 } },
    objects: [{ id: 'o1', type: 'ball', x: 41, y: 11 }],
    routes: [route('r1', 'pass', 1, [40, 20], { to: 'a2' }), route('r2', 'kick', 2, [75, 35])],
  };
  syncOptions(phase.routes, ['a1']);
  makeMainOption(phase.routes, phase.routes[1]);
  assert.deepEqual(nextPhase(phase, players).objects[0], { id: 'o1', type: 'ball', x: 75, y: 35 });
});
