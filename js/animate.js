// Animating a play, as pure functions of the play and a time (so any moment can be computed, and tested
// without a browser). A phase plays its routes in badge order: routes with the same order number start
// together, and the ball leaves along a pass or kick once the passer has finished their own movement in
// that step. Of a player's options only A plays (or the one chosen in Present mode). Then everyone, players
// and markers, slides to where they stand in the next phase. Times are in ms at 1x speed; positions are in
// pitch metres. Which ball moves and who catches it come from model.js, as when the next phase is built.

import {
  curvePoint, byOrder, playedRoutes, positionsAfter, movingBall, receiverOf, round2,
  MOVING_ROUTES, BALL_ROUTES, BALL_OFFSET,
} from './model.js';

// 1x is an easy pace to follow on a TV: half the speed of a real game.
export const TIMING = {
  lead: 800, // the phase is shown still before anything moves
  gap: 400, // between one order step and the next
  tween: 1600, // sliding everyone into the next phase
  endHold: 1200, // after the last phase's routes, before stopping
  loopHold: 1500, // with Loop on: the last phase is held this long, then slides back to phase 1
};
// Speed along the route (metres per second) and the shortest and longest time one route takes.
const PACE = {
  run: { speed: 3.5, min: 1200, max: 5600 },
  pass: { speed: 9, min: 900, max: 3000 },
  kick: { speed: 11, min: 1800, max: 5200 },
};
// A ball this close to the first passer at the start of a phase is in their hands and moves with them.
const HOLD_RADIUS = 3;

const add = (p, q) => ({ x: p.x + q.x, y: p.y + q.y });
const sub = (p, q) => ({ x: p.x - q.x, y: p.y - q.y });
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const easeInOut = u => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

function curveLength(r) {
  let len = 0;
  let prev = curvePoint(r, 0);
  for (let i = 1; i <= 16; i++) {
    const q = curvePoint(r, i / 16);
    len += dist(prev, q);
    prev = q;
  }
  return len;
}

function duration(kind, r) {
  const { speed, min, max } = PACE[kind];
  return Math.min(max, Math.max(min, (curveLength(r) / speed) * 1000));
}

// How long the ball takes along route r (a pass or kick) from `from` to `to`, its curve kept.
const flightTime = (r, from, to) => duration(r.type, { points: [[from.x, from.y], [to.x, to.y]], curve: r.curve });

// Where player `id` (standing at `positions[id]` when the phase starts) is at time t, given the phase's
// movements so far.
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

// The route's curve, bent so it starts at `from` and ends at `to` instead of its own ends. When nothing has
// moved (from and to are the route's ends) this is exactly the drawn curve. It covers a player whose second
// run is drawn from where they stood at the start of the phase, and a pass to a receiver who is running.
function along(r, u, from, to) {
  const p = curvePoint(r, u);
  const a = sub(from, curvePoint(r, 0));
  const b = sub(to, curvePoint(r, 1));
  return { x: p.x + (1 - u) * a.x + u * b.x, y: p.y + (1 - u) * a.y + u * b.y };
}

// When everything in phase i happens. Each player's movements run one after another, so two routes of
// one player never overlap, and the ball's flights run one after another, since there's only one ball.
// option: the option letter that plays ('A' unless one was chosen in Present mode). Any other letter plays
// this phase only: it ends with a hold, not a slide into the next phase, which was built from A.
// loop: after the last phase, hold it (TIMING.loopHold) and slide back to phase 1.
export function buildSchedule(play, i, { option = 'A', loop = false } = {}) {
  const phase = play.phases[i];
  const alone = option !== 'A' && phase.routes.some(r => r.option === option);
  const looping = !alone && loop && i === play.phases.length - 1;
  const next = alone ? null : play.phases[i + 1] ?? (looping ? play.phases[0] : null);
  const positions = phase.positions;
  // Ascending order; equal orders keep drawing order, as when the next phase is built.
  const routes = byOrder(playedRoutes(phase.routes, alone ? option : 'A'));
  const moves = [];
  const flights = [];
  const busy = {}; // player id -> when their last movement ends
  let ballFree = 0;
  let t = TIMING.lead;
  for (const order of new Set(routes.map(r => r.order ?? 0))) {
    const step = routes.filter(r => (r.order ?? 0) === order);
    const movedUntil = {}; // when each player's movement in this step ends
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
      // The ball leaves from where the passer is now, and goes to where the receiver is when it arrives:
      // a receiver still running (a pop pass) is met on his path, at the time the flight there takes.
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
      const f = { route: r, from: r.from, to, start, end: flightEnd, release, catchAt, catcher: null };
      flights.push(f);
      ballFree = f.end;
      end = Math.max(end, f.end);
    }
    if (end > t) t = end + TIMING.gap;
  }
  const routesEnd = moves.length || flights.length ? t - TIMING.gap : TIMING.lead;
  const slideStart = routesEnd + (looping ? TIMING.loopHold : 0);

  // The ball that moves: the one nearest the start of the first pass or kick (as when the next phase is
  // built), or the only one there is. A phase with a pass but no ball gets one at the pass's start.
  const balls = phase.objects.filter(o => o.type === 'ball');
  const first = flights[0]?.route;
  const ball = first ? movingBall(phase.objects, first) : balls.length === 1 ? balls[0] : null;
  let holder = null;
  for (const id of first?.from ? [first.from] : Object.keys(positions)) {
    if (ball && positions[id] && dist(positions[id], ball) <= HOLD_RADIUS && (!holder || dist(positions[id], ball) < dist(positions[holder], ball))) holder = id;
  }
  const s = {
    phase: i, option: alone ? option : 'A', looping, positions, objects: phase.objects, next, moves, flights, routesEnd, slideStart,
    total: next ? slideStart + TIMING.tween : routesEnd + TIMING.endHold,
    ballId: ball?.id ?? null,
    ballStart: ball ? { x: ball.x, y: ball.y } : null,
    holder,
    holderOffset: holder ? sub(ball, positions[holder]) : null,
  };
  // Who has the ball after each flight: the same rule as when the next phase is built (model.js).
  for (const f of flights) f.catcher = receiverOf(f.route, play.players, positionsAfter(routes, positions, f.route.order ?? 0));
  // When each route starts moving, so its order badge can go.
  s.starts = new Map();
  for (const m of [...moves, ...flights]) if (!s.starts.has(m.route.id) || s.starts.get(m.route.id) > m.start) s.starts.set(m.route.id, m.start);
  return s;
}

// Where player `id` is at time t (before the slide into the next phase).
const playerAt = (s, id, t) => positionAt(s.moves, s.positions, id, t);

// Where the ball is at time t: with its holder, or in flight along a pass or kick. null before the first
// flight of a phase that has no ball.
function ballAt(s, t) {
  let pos = s.ballStart;
  let holder = s.holder;
  let offset = s.holderOffset;
  for (const f of s.flights) {
    if (t < f.start) break;
    const from = holder ? add(playerAt(s, holder, f.start), offset) : pos ?? curvePoint(f.route, 0);
    const u = Math.min(1, (t - f.start) / (f.end - f.start));
    // A pass to a receiver ends in their hands, where they are when it arrives (on their run, if they're running).
    const to = f.to ? add(f.catchAt, BALL_OFFSET) : curvePoint(f.route, 1);
    pos = along(f.route, u, from, to);
    if (u < 1) return pos;
    holder = f.catcher;
    offset = holder ? sub(pos, playerAt(s, holder, f.end)) : null;
  }
  if (!holder) return pos;
  // Still in the hands of a holder who hasn't moved: exactly where it was, not re-added from the offset.
  const h = playerAt(s, holder, t);
  return h === s.positions[holder] && offset === s.holderOffset ? s.ballStart : add(h, offset);
}

// Everything at time t of phase s.phase: { players: { id: {x, y} }, objects: { id: {x, y, opacity} },
// extraBall: {x, y, opacity} | null (a phase with no ball object of its own), routeOpacity }.
// At t = s.total, players and markers are exactly where they are in the next phase.
export function frameAt(s, t) {
  t = Math.min(Math.max(t, 0), s.total);
  const before = Math.min(t, s.routesEnd);
  const players = {};
  for (const id of Object.keys(s.positions)) players[id] = { ...playerAt(s, id, before) };
  const objects = {};
  for (const o of s.objects) objects[o.id] = { x: o.x, y: o.y, opacity: 1 };
  const ball = ballAt(s, before);
  let extraBall = null;
  if (ball && s.ballId) objects[s.ballId] = { ...ball, opacity: 1 };
  else if (ball) extraBall = { ...ball, opacity: 1 };
  let routeOpacity = 1;

  if (s.next && t > s.slideStart) {
    const u = (t - s.slideStart) / TIMING.tween;
    const k = u >= 1 ? 1 : easeInOut(u);
    const slide = (p, q) => (k === 1 ? { ...p, x: q.x, y: q.y } : { ...p, x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
    for (const id of Object.keys(players)) {
      if (s.next.positions[id]) players[id] = slide(players[id], s.next.positions[id]);
    }
    for (const id of Object.keys(objects)) {
      const q = s.next.objects.find(o => o.id === id);
      objects[id] = q ? slide(objects[id], q) : { ...objects[id], opacity: 1 - k };
    }
    if (extraBall) {
      // The added ball goes to the next phase's new ball, if it has one.
      const q = s.next.objects.find(o => o.type === 'ball' && !s.objects.some(p => p.id === o.id));
      extraBall = q ? slide(extraBall, q) : { ...extraBall, opacity: 1 - k };
    }
    routeOpacity = 1 - k;
  }
  return { players, objects, extraBall, routeOpacity };
}

// The passes and kicks of phase i as the still picture draws them, by route id: from where the passer is when
// the ball leaves to where the receiver is when it arrives (or the route's own end, for a kick or a pass with
// no receiver), the same spots the animation uses. Each option is taken from the schedule that plays it.
// Runs and the other routes are drawn as they are.
export function flightEnds(play, i) {
  const ends = new Map();
  const routes = play.phases[i]?.routes ?? [];
  const letters = ['A', ...new Set(routes.filter(r => r.option && r.option !== 'A').map(r => r.option))];
  for (const option of letters) {
    for (const f of buildSchedule(play, i, { option }).flights) {
      if (ends.has(f.route.id)) continue;
      const to = f.to ? f.catchAt : curvePoint(f.route, 1);
      ends.set(f.route.id, [[round2(f.release.x), round2(f.release.y)], [round2(to.x), round2(to.y)]]);
    }
  }
  return ends;
}

// Route r drawn with `points` (from flightEnds) in place of its own, or r itself.
export const shownRoute = (r, points) => (points ? { ...r, points } : r);
