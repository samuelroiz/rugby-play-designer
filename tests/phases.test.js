// Phase building, inserting and moving. Run with: node --test tests/
// No packages needed: Node's own test runner and assert.

import test from 'node:test';
import assert from 'node:assert/strict';
import { nextPhase, appendPhase, insertPhaseAfter, movePhase } from '../js/phases.js';

const players = [
  { id: 'a1', team: 'attack', label: '1' },
  { id: 'a2', team: 'attack', label: '2' },
  { id: 'a3', team: 'attack', label: '3' },
  { id: 'd1', team: 'defense', label: '1' },
];

// Five phases, each different: players spread out more each phase, a run and a pass in every phase,
// a ball, a ruck from phase 3, and a note.
function fivePhasePlay() {
  return Array.from({ length: 5 }, (_, i) => ({
    note: `note ${i + 1}`,
    positions: {
      a1: { x: 40 + i * 4, y: 10 },
      a2: { x: 40 + i * 4, y: 20 + i },
      a3: { x: 38 + i * 4, y: 30 },
      d1: { x: 60, y: 20 - i },
    },
    objects: [
      { id: 'o1', type: 'ball', x: 41 + i * 4, y: 11 },
      ...(i >= 2 ? [{ id: 'o2', type: 'ruck', x: 70, y: 30 + i }] : []),
    ],
    routes: [
      { id: 'r1', type: 'run', from: 'a1', points: [[40 + i * 4, 10], [46 + i * 4, 12]], curve: i, order: 1 },
      { id: 'r2', type: 'pass', from: 'a1', to: 'a2', points: [[40 + i * 4, 10], [40 + i * 4, 20 + i]], curve: 0, order: 2 },
    ],
  }));
}

const copy = v => structuredClone(v);

test('insert after phase 2: phases after it are unchanged and only shift along', () => {
  for (let at = 0; at < 5; at++) {
    const phases = fivePhasePlay();
    const before = copy(phases);
    const shown = insertPhaseAfter(phases, at, players);
    assert.equal(shown, at + 1);
    assert.equal(phases.length, 6);
    for (let k = 0; k <= at; k++) assert.deepEqual(phases[k], before[k], `phase ${k + 1} (insert after ${at + 1})`);
    for (let k = at + 1; k < 5; k++) assert.deepEqual(phases[k + 1], before[k], `old phase ${k + 1} (insert after ${at + 1})`);
    assert.deepEqual(phases[at + 1], nextPhase(before[at], players));
  }
});

test('the inserted phase is built from the current one: runners at the ends of their runs, ball to the receiver', () => {
  const phases = fivePhasePlay();
  insertPhaseAfter(phases, 1, players);
  const made = phases[2];
  assert.deepEqual(made.positions.a1, { x: 50, y: 12 }); // end of phase 2's run
  assert.deepEqual(made.positions.a2, phases[1].positions.a2); // no run: stays
  assert.equal(made.note, '');
  assert.deepEqual(made.routes, []);
  const ball = made.objects.find(o => o.type === 'ball');
  assert.deepEqual([ball.x, ball.y], [45.1, 21.9]); // just off a2, the pass's "to"
});

test('"+" adds at the end, built from the last phase, whichever phase is shown', () => {
  const phases = fivePhasePlay();
  const before = copy(phases);
  assert.equal(appendPhase(phases, players), 5);
  assert.deepEqual(phases.slice(0, 5), before);
  assert.deepEqual(phases[5], nextPhase(before[4], players));
});

test('moving a phase left or right never changes any phase', () => {
  const phases = fivePhasePlay();
  const before = copy(phases);
  assert.equal(movePhase(phases, 1, 2), 2);
  assert.deepEqual(phases, [before[0], before[2], before[1], before[3], before[4]]);
  assert.equal(movePhase(phases, 2, 1), 1);
  assert.deepEqual(phases, before);
  assert.equal(movePhase(phases, 0, -1), 0); // off the end: nothing happens
  assert.equal(movePhase(phases, 4, 5), 4);
  assert.deepEqual(phases, before);
});

test('insert then move: every phase keeps its contents', () => {
  const phases = fivePhasePlay();
  const before = copy(phases);
  insertPhaseAfter(phases, 2, players);
  const inserted = copy(phases[3]);
  movePhase(phases, 3, 4);
  assert.deepEqual(phases, [before[0], before[1], before[2], before[3], inserted, before[4]]);
});

test('building a phase does not touch the phase it is built from', () => {
  const phases = fivePhasePlay();
  const before = copy(phases);
  nextPhase(phases[3], players);
  assert.deepEqual(phases, before);
});

test('a pass with "to" goes to that player after their run, even if someone else is nearer the end', () => {
  const phase = {
    note: '',
    positions: { a1: { x: 40, y: 10 }, a2: { x: 40, y: 20 }, a3: { x: 41, y: 21 } },
    objects: [{ id: 'o1', type: 'ball', x: 40, y: 10 }],
    routes: [
      { id: 'r1', type: 'run', from: 'a2', points: [[40, 20], [48, 26]], curve: 0, order: 1 },
      { id: 'r2', type: 'pass', from: 'a1', to: 'a2', points: [[40, 10], [41, 21]], curve: 0, order: 2 },
    ],
  };
  const made = nextPhase(phase, players);
  assert.deepEqual(made.objects[0], { id: 'o1', type: 'ball', x: 49.1, y: 26.9 });
});

test('a pass without "to" still falls back to the nearest team-mate', () => {
  const phase = {
    note: '',
    positions: { a1: { x: 40, y: 10 }, a3: { x: 41, y: 21 }, d1: { x: 40, y: 20 } },
    objects: [{ id: 'o1', type: 'ball', x: 40, y: 10 }],
    routes: [{ id: 'r2', type: 'pass', from: 'a1', to: null, points: [[40, 10], [40, 20]], curve: 0, order: 1 }],
  };
  const ball = nextPhase(phase, players).objects[0];
  assert.deepEqual([ball.x, ball.y], [42.1, 21.9]); // a3, not the nearer defender
});
