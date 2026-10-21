// Route order badges: which routes show one, and where a badge goes. Run with: node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import { badgePosition, optionBadgePosition, badgedRoutes } from '../js/badges.js';
import { curveControl } from '../js/model.js';

const players = [
  { id: 'a9', team: 'attack', label: '9' },
  { id: 'a10', team: 'attack', label: '10' },
  { id: 'd10', team: 'defense', label: '10' },
];
const route = (id, type, from, order, points, extra = {}) => ({ id, type, from, points, curve: 0, order, option: null, ...extra });
const sizes = { playerR: 1.2, badgeR: 0.9 };
const ids = set => [...set].map(r => r.id).sort();
const clear = (p, disc) => Math.hypot(p.x - disc.x, p.y - disc.y) >= disc.r + sizes.badgeR;

test('no badges with Step numbers off', () => {
  const routes = [route('r1', 'run', 'a9', 1, [[40, 30], [45, 30]]), route('r2', 'pass', 'a9', 2, [[45, 30], [45, 40]])];
  assert.equal(badgedRoutes(routes, players, false).size, 0);
});

test('every route on one step: no badges, except options', () => {
  const routes = [
    route('r1', 'run', 'a10', 1, [[40, 30], [45, 30]]),
    route('r2', 'pass', 'a9', 1, [[40, 20], [40, 30]], { option: 'A' }),
    route('r3', 'kick', 'a9', 1, [[40, 20], [70, 20]], { option: 'B' }),
  ];
  assert.deepEqual(ids(badgedRoutes(routes, players, true)), ['r2', 'r3']);
});

test('a drift on an attacking step has no badge; one on its own step has', () => {
  const routes = [
    route('r1', 'run', 'a10', 1, [[40, 30], [45, 30]]),
    route('r2', 'pass', 'a9', 2, [[40, 20], [40, 30]]),
    route('r3', 'drift', 'd10', 1, [[60, 30], [55, 35]]),
    route('r4', 'drift', 'd10', 3, [[55, 35], [50, 40]]),
    route('r5', 'run', 'a10', undefined, [[45, 30], [50, 30]]),
  ];
  assert.deepEqual(ids(badgedRoutes(routes, players, true)), ['r1', 'r2', 'r4']);
});

test('a badge sits beside the start of its route, clear of the player there', () => {
  const r = route('r1', 'run', 'a10', 1, [[40, 30], [50, 30]]);
  const player = { x: 40, y: 30, r: sizes.playerR };
  const p = badgePosition(r, curveControl(r), [player], sizes);
  assert.ok(clear(p, player));
  assert.ok(Math.abs(p.x - 40) < 1, 'beside the start, not along the route');
});

test('a badge moves round a disc that covers its first spot', () => {
  const r = route('r1', 'run', 'a10', 1, [[40, 30], [50, 30]]);
  const player = { x: 40, y: 30, r: sizes.playerR };
  const first = badgePosition(r, curveControl(r), [player], sizes);
  const other = { x: first.x, y: first.y, r: sizes.playerR };
  const p = badgePosition(r, curveControl(r), [player, other], sizes);
  assert.ok(clear(p, player) && clear(p, other));
});

test("an option's badge is nearer its own route than its sibling's", () => {
  const a = route('r1', 'pass', 'a9', 2, [[40, 30], [40, 45]], { option: 'A' });
  const b = route('r2', 'pass', 'a9', 2, [[40, 30], [52, 40]], { option: 'B' });
  const passer = { x: 40, y: 30, r: sizes.playerR };
  const p = optionBadgePosition(a, [b], [passer], sizes);
  const toLine = (r, q) => {
    const [[x1, y1], [x2, y2]] = r.points;
    const t = Math.max(0, Math.min(1, ((q.x - x1) * (x2 - x1) + (q.y - y1) * (y2 - y1)) / ((x2 - x1) ** 2 + (y2 - y1) ** 2)));
    return Math.hypot(q.x - (x1 + t * (x2 - x1)), q.y - (y1 + t * (y2 - y1)));
  };
  assert.ok(toLine(a, p) < toLine(b, p));
  assert.ok(clear(p, passer));
});
