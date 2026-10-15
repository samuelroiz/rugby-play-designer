// Building the next phase from the current one: players finish their runs, the ball follows the last pass.
// Also adding, inserting and moving phases. None of these change the contents of any existing phase.

import { nextId } from './editor.js';

// Route types that carry their player to the end of the route.
const MOVING_ROUTES = new Set(['run', 'drift', 'blitz', 'decoy']);
// A pass with no receiver ("to") is caught by the nearest team-mate within this many metres of where it ends.
const CATCH_RADIUS = 5;
// The ball sits just off the receiver so it isn't hidden under their disc.
const BALL_OFFSET = { x: 1.1, y: 0.9 };

// "+": a new phase at the end, built from the last one. Returns its index.
export function appendPhase(phases, players) {
  phases.push(nextPhase(phases[phases.length - 1], players));
  return phases.length - 1;
}

// "Insert after": a new phase straight after phase i, built from it. Later phases only shift along.
export function insertPhaseAfter(phases, i, players) {
  phases.splice(i + 1, 0, nextPhase(phases[i], players));
  return i + 1;
}

// Swaps phase i with its neighbour j. Returns the new index of phase i, or i if j is off the end.
export function movePhase(phases, i, j) {
  if (j < 0 || j >= phases.length) return i;
  [phases[i], phases[j]] = [phases[j], phases[i]];
  return j;
}

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

  // Receiver: the player the pass is attached to, where they stand after their own run. Failing that,
  // the nearest player to the end of the pass; if the passer is known, only their team-mates can catch it.
  let receiver = (pass.to && positions[pass.to] && players.find(p => p.id === pass.to)) || null;
  let best = CATCH_RADIUS;
  for (const p of receiver ? [] : players) {
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
