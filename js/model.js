// Rules about the play itself, shared by the editor, the phase builder, the animation and the drawing, so
// they can't drift apart: route curves, which routes carry the ball, ids, rounding, and who catches the ball.
// Pure functions of plain data: no DOM, so the Node tests use them as they are.

// Route types the ball travels along, and route types that carry their player to the end of the route.
export const BALL_ROUTES = new Set(['pass', 'kick']);
export const MOVING_ROUTES = new Set(['run', 'drift', 'blitz', 'decoy']);
// A pass with no receiver ("to") is caught by the nearest team-mate within this many metres of where it ends.
export const CATCH_RADIUS = 5;
// The ball sits just off the player holding it so it isn't hidden under their disc.
export const BALL_OFFSET = { x: 1.1, y: 0.9 };

// Pitch positions are kept to 0.1 m; drawn geometry to 0.01 m or 0.001 m.
export const round1 = v => Math.round(v * 10) / 10;
export const round2 = v => Math.round(v * 100) / 100;
export const round3 = v => Math.round(v * 1000) / 1000;

// Next free id like "r3" given existing items with ids "r1", "r2".
export function nextId(prefix, items) {
  let max = 0;
  for (const item of items) {
    if (item.id.startsWith(prefix)) max = Math.max(max, Number(item.id.slice(prefix.length)) || 0);
  }
  return prefix + (max + 1);
}

// Order number for a new route: one more than the highest so far.
export const nextOrder = routes => routes.reduce((max, r) => Math.max(max, r.order || 0), 0) + 1;

// Order number for a newly drawn route of `type`: a pass or kick is the next step; a run, decoy, drift or
// blitz moves together with the latest step (the highest number so far, or 1 when there's none).
export const newRouteOrder = (type, routes) => (BALL_ROUTES.has(type) ? nextOrder(routes) : Math.max(1, nextOrder(routes) - 1));

// Whether a route is an alternative to the main plan (option B, C …), which the next phase ignores.
export const isOtherOption = r => !!r.option && r.option !== 'A';

// A route is a quadratic Bézier from its first to its last point. "curve" is how far (metres) the route's
// midpoint is pushed sideways from the straight line; the control point sits at twice that offset.
export function curveControl(route) {
  const [x1, y1] = route.points[0];
  const [x2, y2] = route.points[route.points.length - 1];
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const normal = { x: -(y2 - y1) / len, y: (x2 - x1) / len };
  const mid = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  const c = route.curve || 0;
  return { control: { x: mid.x + 2 * normal.x * c, y: mid.y + 2 * normal.y * c }, mid, normal, len };
}

// Point u (0..1) along a route's curve.
export function curvePoint(route, u) {
  const { control: c } = curveControl(route);
  const [x1, y1] = route.points[0];
  const [x2, y2] = route.points[route.points.length - 1];
  const v = 1 - u;
  return { x: v * v * x1 + 2 * v * u * c.x + u * u * x2, y: v * v * y1 + 2 * v * u * c.y + u * u * y2 };
}

// Routes in play order: ascending order number, equal orders in drawing order (sort is stable).
export const byOrder = routes => [...routes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

// The routes that play: all of them, except that of each player's pass/kick options only one counts:
// `option` (a letter) where that player has it, otherwise A.
export function playedRoutes(routes, option = 'A') {
  const chosen = new Set();
  for (const r of routes) if (r.option === option) chosen.add(r.from);
  return routes.filter(r => !r.option || r.option === (chosen.has(r.from) ? option : 'A'));
}

// The passes and kicks that move the ball, in play order.
export const ballFlights = routes => byOrder(playedRoutes(routes)).filter(r => BALL_ROUTES.has(r.type));

// Where every player stands once the moving routes up to and including order `upTo` have finished (all of
// them with upTo = Infinity). Where a player has several, the later one in play order wins.
export function positionsAfter(routes, positions, upTo = Infinity) {
  const out = { ...positions };
  for (const r of byOrder(routes)) {
    if ((r.order ?? 0) > upTo || !r.from || !MOVING_ROUTES.has(r.type) || !out[r.from]) continue;
    const [x, y] = r.points[r.points.length - 1];
    out[r.from] = { x, y };
  }
  return out;
}

// A player's last run, decoy, drift or blitz in play order (the one they end the phase at the end of), or null.
// A new one drawn from them carries on from its end, as the next step.
export const lastMove = (routes, id) => byOrder(routes).filter(r => r.from === id && MOVING_ROUTES.has(r.type)).at(-1) ?? null;

// The ball a phase's play moves: the one nearest the start of its first pass or kick. null if there's no
// pass or kick, or no ball.
export function movingBall(objects, firstFlight) {
  if (!firstFlight) return null;
  const [sx, sy] = firstFlight.points[0];
  const balls = objects.filter(o => o.type === 'ball');
  return balls.sort((a, b) => Math.hypot(a.x - sx, a.y - sy) - Math.hypot(b.x - sx, b.y - sy))[0] ?? null;
}

// Who catches a pass: its "to" player if they're on the pitch, otherwise the nearest team-mate of the
// passer (anyone, for a pass from open grass) within CATCH_RADIUS of where it lands, the first in the players
// list on a tie. `positions` is where everyone stands as the ball arrives: after their movements up to the
// pass's order (see positionsAfter). Nobody catches a kick. Returns a player id or null.
export function receiverOf(pass, players, positions) {
  if (pass.type !== 'pass') return null;
  if (pass.to && positions[pass.to]) return pass.to;
  const [ex, ey] = pass.points[pass.points.length - 1];
  const team = players.find(p => p.id === pass.from)?.team;
  let best = null;
  let bestD = CATCH_RADIUS;
  for (const p of players) {
    const pos = positions[p.id];
    if (!pos || p.id === pass.from || (pass.from && p.team !== team)) continue;
    const d = Math.hypot(pos.x - ex, pos.y - ey);
    if (d < bestD || (d === bestD && !best)) { best = p.id; bestD = d; }
  }
  return best;
}

// Every spot a play reaches across all its phases, in pitch metres: where each player and marker stands, and
// points along every route (players run along them and the ball flies along them). For fitting a view to it.
export function playPoints(play) {
  const points = [];
  for (const ph of play.phases) {
    points.push(...Object.values(ph.positions), ...ph.objects.map(o => ({ x: o.x, y: o.y })));
    for (const r of ph.routes) for (let i = 0; i <= 8; i++) points.push(curvePoint(r, i / 8));
  }
  return points;
}
