// Building the next phase from the current one: players finish their runs, the ball follows the last pass.

import { nextId } from './editor.js';

// Route types that carry their player to the end of the route.
const MOVING_ROUTES = new Set(['run', 'drift', 'blitz', 'decoy']);
// A pass is caught by the nearest team-mate within this many metres of where it ends.
const CATCH_RADIUS = 5;
// The ball sits just off the receiver so it isn't hidden under their disc.
const BALL_OFFSET = { x: 1.1, y: 0.9 };

export function nextPhase(phase, players) {
  const positions = structuredClone(phase.positions);
  const objects = structuredClone(phase.objects);
  // Ascending order, so where a player has several routes the highest order is applied last and wins.
  // Equal orders keep drawing order (sort is stable).
  const routes = [...phase.routes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  for (const r of routes) {
    if (r.from && MOVING_ROUTES.has(r.type) && positions[r.from]) {
      const [x, y] = r.points[r.points.length - 1];
      positions[r.from] = { x, y };
    }
  }

  const pass = routes.filter(r => r.type === 'pass').at(-1);
  if (pass) moveBallAlongPass(pass, players, positions, objects);

  return { note: '', positions, objects, routes: [] };
}

function moveBallAlongPass(pass, players, positions, objects) {
  const [sx, sy] = pass.points[0];
  const [ex, ey] = pass.points[pass.points.length - 1];
  const passer = players.find(p => p.id === pass.from);

  // Receiver: the nearest player to the end of the pass, where they stand after their own run.
  // If the passer is known, only their team-mates can catch it.
  let receiver = null;
  let best = CATCH_RADIUS;
  for (const p of players) {
    const pos = positions[p.id];
    if (!pos || p.id === pass.from || (passer && p.team !== passer.team)) continue;
    const d = Math.hypot(pos.x - ex, pos.y - ey);
    if (d <= best) { best = d; receiver = p; }
  }
  const at = receiver
    ? { x: positions[receiver.id].x + BALL_OFFSET.x, y: positions[receiver.id].y + BALL_OFFSET.y }
    : { x: ex, y: ey };

  // Move the ball nearest the start of the pass; if there's no ball yet, add one.
  const balls = objects.filter(o => o.type === 'ball');
  let ball = balls.sort((a, b) => Math.hypot(a.x - sx, a.y - sy) - Math.hypot(b.x - sx, b.y - sy))[0];
  if (!ball) {
    ball = { id: nextId('o', objects), type: 'ball' };
    objects.push(ball);
  }
  ball.x = Math.round(at.x * 10) / 10;
  ball.y = Math.round(at.y * 10) / 10;
}
