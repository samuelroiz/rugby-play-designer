// A faithful port of the Rugby Play Designer's own play rules, for use outside the app.
// Mirrors js/model.js, js/animate.js (buildSchedule) and js/phases.js (nextPhase) of
// https://github.com/samuelroiz/rugby-play-designer as of 2026-10-21 (commit 28f0659).
// If a check here disagrees with the app, the app is right: re-read those files.

export const BALL_ROUTES = new Set(['pass', 'kick']);
export const MOVING_ROUTES = new Set(['run', 'drift', 'blitz', 'decoy']);
export const ROUTE_TYPES = new Set([...BALL_ROUTES, ...MOVING_ROUTES]);
export const CATCH_RADIUS = 5; // a pass with no "to" is caught within this of its end
export const BALL_OFFSET = { x: 1.1, y: 0.9 }; // the ball sits here relative to its holder
export const HOLD_RADIUS = 3; // the ball moves with a player within this at phase start

export const round1 = v => Math.round(v * 10) / 10;
export const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

// --- model.js ---

export const byOrder = routes => [...routes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

export function playedRoutes(routes, option = 'A') {
  const chosen = new Set();
  for (const r of routes) if (r.option === option) chosen.add(r.from);
  return routes.filter(r => !r.option || r.option === (chosen.has(r.from) ? option : 'A'));
}

export const ballFlights = routes => byOrder(playedRoutes(routes)).filter(r => BALL_ROUTES.has(r.type));

export function positionsAfter(routes, positions, upTo = Infinity) {
  const out = { ...positions };
  for (const r of byOrder(routes)) {
    if ((r.order ?? 0) > upTo || !r.from || !MOVING_ROUTES.has(r.type) || !out[r.from]) continue;
    const [x, y] = r.points[r.points.length - 1];
    out[r.from] = { x, y };
  }
  return out;
}

export function movingBall(objects, firstFlight) {
  if (!firstFlight) return null;
  const [sx, sy] = firstFlight.points[0];
  const balls = objects.filter(o => o.type === 'ball');
  return balls.sort((a, b) => Math.hypot(a.x - sx, a.y - sy) - Math.hypot(b.x - sx, b.y - sy))[0] ?? null;
}

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

export function curveControl(route) {
  const [x1, y1] = route.points[0];
  const [x2, y2] = route.points[route.points.length - 1];
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const normal = { x: -(y2 - y1) / len, y: (x2 - x1) / len };
  const mid = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  const c = route.curve || 0;
  return { control: { x: mid.x + 2 * normal.x * c, y: mid.y + 2 * normal.y * c }, mid, normal, len };
}

export function curvePoint(route, u) {
  const { control: c } = curveControl(route);
  const [x1, y1] = route.points[0];
  const [x2, y2] = route.points[route.points.length - 1];
  const v = 1 - u;
  return { x: v * v * x1 + 2 * v * u * c.x + u * u * x2, y: v * v * y1 + 2 * v * u * c.y + u * u * y2 };
}

// --- animate.js (the parts the schedule needs) ---

export const TIMING = { lead: 800, gap: 400 };
export const PACE = {
  run: { speed: 3.5, min: 1200, max: 5600 },
  pass: { speed: 9, min: 900, max: 3000 },
  kick: { speed: 11, min: 1800, max: 5200 },
};

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const easeInOut = u => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

export function curveLength(r) {
  let len = 0;
  let prev = curvePoint(r, 0);
  for (let i = 1; i <= 16; i++) {
    const q = curvePoint(r, i / 16);
    len += dist(prev, q);
    prev = q;
  }
  return len;
}

export function duration(kind, r) {
  const { speed, min, max } = PACE[kind];
  return Math.min(max, Math.max(min, (curveLength(r) / speed) * 1000));
}

const flightTime = (r, from, to) => duration(r.type, { points: [[from.x, from.y], [to.x, to.y]], curve: r.curve });

function along(r, u, from, to) {
  const p = curvePoint(r, u);
  const a = sub(from, curvePoint(r, 0));
  const b = sub(to, curvePoint(r, 1));
  return { x: p.x + (1 - u) * a.x + u * b.x, y: p.y + (1 - u) * a.y + u * b.y };
}

function positionAt(moves, positions, id, t) {
  let p = positions[id];
  for (const m of moves) {
    if (m.player !== id) continue;
    if (t <= m.start) break;
    const u = easeInOut(Math.min(1, (t - m.start) / (m.end - m.start)));
    p = along(m.route, u, p, curvePoint(m.route, 1));
  }
  return p;
}

// One phase's schedule, as buildSchedule computes it (option A): when each route runs, each
// pass/kick's release point (where the passer is when it leaves) and catchAt (where a receiver
// still running is met - the pop-pass catch point).
export function schedulePhase(phase, option = 'A') {
  const positions = phase.positions;
  const routes = byOrder(playedRoutes(phase.routes, option));
  const moves = [];
  const flights = [];
  const busy = {};
  let ballFree = 0;
  let t = TIMING.lead;
  for (const order of new Set(routes.map(r => r.order ?? 0))) {
    const step = routes.filter(r => (r.order ?? 0) === order);
    const movedUntil = {};
    let end = t;
    for (const r of step) {
      if (!r.from || !MOVING_ROUTES.has(r.type) || !positions[r.from]) continue;
      const start = Math.max(t, busy[r.from] ?? 0);
      const m = { route: r, player: r.from, start, end: start + duration('run', r) };
      moves.push(m);
      busy[r.from] = movedUntil[r.from] = m.end;
      end = Math.max(end, m.end);
    }
    for (const r of step) {
      if (!BALL_ROUTES.has(r.type)) continue;
      const start = Math.max(t, movedUntil[r.from] ?? t, ballFree);
      const to = r.type === 'pass' && positions[r.to] ? r.to : null;
      const release = r.from && positions[r.from] ? positionAt(moves, positions, r.from, start) : curvePoint(r, 0);
      let catchAt = to ? positionAt(moves, positions, to, start) : curvePoint(r, 1);
      let flightEnd = start + flightTime(r, release, catchAt);
      for (let k = 0; to && k < 40; k++) {
        catchAt = positionAt(moves, positions, to, flightEnd);
        const next = start + flightTime(r, release, catchAt);
        const done = Math.abs(next - flightEnd) < 0.01;
        flightEnd = next;
        if (done) break;
      }
      if (to) catchAt = positionAt(moves, positions, to, flightEnd);
      flights.push({ route: r, from: r.from, to, start, end: flightEnd, release, catchAt });
      ballFree = flightEnd;
      end = Math.max(end, flightEnd);
    }
    if (end > t) t = end + TIMING.gap;
  }
  return { positions, moves, flights };
}

// Where player `id` is at time t (ms) in a phase's schedule - for mid-run overlap checks.
export const posAt = (sched, id, t) => positionAt(sched.moves, sched.positions, id, t);

// --- phases.js ---

export function nextId(prefix, items) {
  let max = 0;
  for (const item of items) {
    if (item.id.startsWith(prefix)) max = Math.max(max, Number(item.id.slice(prefix.length)) || 0);
  }
  return prefix + (max + 1);
}

// The phase the app builds after `phase`: everyone at the end of their moving routes, the ball
// with the last option-A pass's receiver (at their new spot + BALL_OFFSET) or at the last kick's
// end, markers copied unchanged, no routes.
export function nextPhase(phase, players) {
  const objects = structuredClone(phase.objects);
  const positions = structuredClone(positionsAfter(phase.routes, phase.positions));
  const flights = ballFlights(phase.routes);
  const last = flights.at(-1);
  if (last) {
    const catcher = receiverOf(last, players, positionsAfter(phase.routes, phase.positions, last.order ?? 0));
    const end = last.points[last.points.length - 1];
    const at = catcher ? [positions[catcher].x + BALL_OFFSET.x, positions[catcher].y + BALL_OFFSET.y] : end;
    let ball = movingBall(objects, flights[0]);
    if (!ball) {
      ball = { id: nextId('o', objects), type: 'ball' };
      objects.push(ball);
    }
    ball.x = round1(at[0]);
    ball.y = round1(at[1]);
  }
  return { note: '', positions, objects, routes: [] };
}
