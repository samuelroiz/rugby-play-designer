// Where a route's order badge goes on the pitch, clear of the players, balls and other badges, and which
// routes show one. Pure functions of plain data: sizes are in metres ({ playerR, badgeR }, as drawn now).

import { curvePoint } from './model.js';

// Badge sits beside the start of the route, clear of the player there, on the side the route doesn't bend
// to. `taken` lists discs it mustn't cover ({ x, y, r }: players, balls and badges already placed); if the
// first spot is covered it tries the other side, a little behind the start, then further out.
export function badgePosition(r, geometry, taken, { playerR, badgeR }) {
  const [sx, sy] = r.points[0];
  const [ex, ey] = r.points[r.points.length - 1];
  let tx = geometry.control.x - sx;
  let ty = geometry.control.y - sy;
  if (Math.hypot(tx, ty) < 0.01) [tx, ty] = [ex - sx, ey - sy];
  const len = Math.hypot(tx, ty) || 1;
  [tx, ty] = [tx / len, ty / len];
  const side = r.curve > 0 ? -1 : 1;
  const R = badgeR;
  const base = r.from ? playerR + R + 0.5 : R + 0.5;
  let first = null;
  for (const extra of [0, 1, 2]) {
    for (const s of [side, -side]) {
      for (const along of [0.6, -0.6]) {
        const out = base + extra;
        const p = { x: sx + tx * along - ty * s * out, y: sy + ty * along + tx * s * out };
        first ??= p;
        if (taken.every(o => Math.hypot(o.x - p.x, o.y - p.y) >= o.r + R + 0.1)) return p;
      }
    }
  }
  return first;
}

// Points along a route's curve (the full curve, to its last point), for measuring distances to it.
function curveSamples(r, n = 40) {
  return Array.from({ length: n + 1 }, (_, i) => curvePoint(r, i / n));
}

const distanceTo = (samples, p) => Math.min(...samples.map(q => Math.hypot(q.x - p.x, q.y - p.y)));

// An option's badge sits on its own route: a short way along it from the start (past the passer's disc),
// just to one side, where it is clearly nearer its own route than any other option of the same player.
// It tries points further along, either side, then right on the line; if none is clear of `taken`, the
// one that best tells the options apart.
export function optionBadgePosition(r, siblings, taken, { playerR, badgeR }) {
  const own = curveSamples(r);
  const others = siblings.map(o => curveSamples(o));
  const otherDist = p => (others.length ? Math.min(...others.map(o => distanceTo(o, p))) : Infinity);
  const lengths = [0];
  for (let i = 1; i < own.length; i++) lengths.push(lengths[i - 1] + Math.hypot(own[i].x - own[i - 1].x, own[i].y - own[i - 1].y));
  const total = lengths.at(-1);
  const R = badgeR;
  const clearOfStart = playerR + R + 0.4;
  const candidates = [];
  for (const along of [3.4, 4.4, 5.6, 7, 8.8, 11]) {
    const at = Math.min(along, Math.max(total * 0.7, Math.min(clearOfStart, total * 0.85)));
    const i = Math.max(1, lengths.findIndex(l => l >= at));
    const q = own[i];
    const [dx, dy] = [own[i].x - own[i - 1].x, own[i].y - own[i - 1].y];
    const len = Math.hypot(dx, dy) || 1;
    const normal = { x: -dy / len, y: dx / len };
    // The side away from the other options first.
    const probe = s => otherDist({ x: q.x + normal.x * s, y: q.y + normal.y * s });
    const sides = probe(1) >= probe(-1) ? [1, -1] : [-1, 1];
    for (const offset of [R + 0.3, 0]) {
      for (const s of offset ? sides : [1]) {
        const p = { x: q.x + normal.x * s * offset, y: q.y + normal.y * s * offset };
        const margin = otherDist(p) - offset;
        const clear = taken.every(o => Math.hypot(o.x - p.x, o.y - p.y) >= o.r + R + 0.1);
        candidates.push({ p, margin, clear });
        if (clear && margin >= R + 0.5) return p;
      }
    }
  }
  const pool = candidates.some(c => c.clear) ? candidates.filter(c => c.clear) : candidates;
  return pool.reduce((best, c) => (c.margin > best.margin ? c : best)).p;
}

// The routes in `routes` (one phase's, played by `players`) that show an order badge. None when `steps`
// (Layers → Step numbers) is off.
// Options (A, B, C …) always show theirs, since the letter tells them apart. Otherwise none when every
// numbered route shares one number (the order says nothing then), and a drift or blitz only shows one when
// its number differs from every attacking route's, since defenders usually move with the attack. A route
// with no order never has one.
export function badgedRoutes(routes, players, steps) {
  const numbered = routes.filter(r => Number.isFinite(r.order));
  if (!steps) return new Set();
  if (new Set(numbered.map(r => r.order)).size <= 1) return new Set(numbered.filter(r => r.option));
  const team = id => players.find(p => p.id === id)?.team;
  const defensive = r => r.type === 'drift' || r.type === 'blitz';
  const attackOrders = new Set(numbered.filter(r => (r.from ? team(r.from) === 'attack' : !defensive(r))).map(r => r.order));
  return new Set(numbered.filter(r => !defensive(r) || !attackOrders.has(r.order)));
}
