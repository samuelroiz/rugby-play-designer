// Following one player on a vertical pitch (attack playing up), as the phone viewer does and a position's
// animation export draws it: the view (camera) round them and the ball when it's near, gliding after them,
// with their team-mates drawn faded, and the frame-by-frame timing with their cues (cues.js). Pure functions of plain data;
// the camera is in screen units of the turned pitch: pitch (x, y) is drawn at (y, -x).

import { BOUNDS } from './pitch.js';
import { buildSchedule, frameAt } from './animate.js';
import { phaseCues, firedBetween, cueSpeed, ageBubbles } from './cues.js';

const FOLLOW_M = 20; // this many metres round the player stay in view
const BALL_NEAR_M = 25; // and the ball too, when it's this close to them
const BALL_MARGIN_M = 4;
const KEEP_IN_M = 3; // the followed player is always at least this far inside the view
const OPPONENT_NEAR_M = 15; // opponents this close to the player stay at full strength
const FADED = { mate: 0.2, opponent: 0.35 };
const CAMERA_MS = 300; // how quickly the view glides after its target

const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

// Screen box of a box in pitch metres.
export const screenBox = b => ({ x: b.minY, y: -b.maxX, w: b.maxY - b.minY, h: b.maxX - b.minX });

// Grows a screen box to `aspect` (width over height) about its centre, then moves it to stay on the pitch
// where it fits.
export function shaped(box, aspect) {
  let { x, y, w, h } = box;
  if (w / h < aspect) { x -= (h * aspect - w) / 2; w = h * aspect; } else { y -= (w / aspect - h) / 2; h = w / aspect; }
  const lim = { x0: BOUNDS.minY, x1: BOUNDS.maxY, y0: -BOUNDS.maxX, y1: -BOUNDS.minX };
  const fit = (start, size, lo, hi) => (size >= hi - lo ? (lo + hi) / 2 - size / 2 : Math.min(Math.max(start, lo), hi - size));
  return { x: fit(x, w, lim.x0, lim.x1), y: fit(y, h, lim.y0, lim.y1), w, h };
}

// The ball in a frame of schedule `sched`, or null.
export const ballIn = (sched, f) => (sched.ballId && f.objects[sched.ballId] ? f.objects[sched.ballId] : f.extraBall);

// Where the view should be: round the player at `me` (pitch metres), and the ball when it's near them.
export function followTarget(me, ball, aspect) {
  const b = { minX: me.x - FOLLOW_M, maxX: me.x + FOLLOW_M, minY: me.y - FOLLOW_M, maxY: me.y + FOLLOW_M };
  if (ball && dist(ball, me) <= BALL_NEAR_M) {
    b.minX = Math.min(b.minX, ball.x - BALL_MARGIN_M);
    b.maxX = Math.max(b.maxX, ball.x + BALL_MARGIN_M);
    b.minY = Math.min(b.minY, ball.y - BALL_MARGIN_M);
    b.maxY = Math.max(b.maxY, ball.y + BALL_MARGIN_M);
  }
  return shaped(screenBox(b), aspect);
}

// The view `dt` ms on, gliding from `cam` towards `to` (straight there with no cam yet). With `me` (the
// followed player, pitch metres) they never leave it, however fast they (or a phase change) move.
export function glide(cam, to, dt, me = null) {
  const c = cam ? { ...cam } : { ...to };
  if (cam) {
    const k = 1 - Math.exp(-dt / CAMERA_MS);
    for (const key of ['x', 'y', 'w', 'h']) c[key] += (to[key] - c[key]) * k;
  }
  if (me) {
    const [px, py] = [me.y, -me.x];
    const m = Math.min(KEEP_IN_M, c.w / 4, c.h / 4);
    c.x = Math.min(Math.max(c.x, px + m - c.w), px - m);
    c.y = Math.min(Math.max(c.y, py + m - c.h), py - m);
  }
  return c;
}

// How strongly each player is drawn in frame f: with `focus` (an id) that player and opponents near them in
// full, the rest faded; without, everyone in full.
export function strength(players, f, focus) {
  const out = {};
  const me = focus ? f.players[focus] : null;
  const myTeam = players.find(p => p.id === focus)?.team;
  for (const p of players) {
    const pos = f.players[p.id];
    if (!me || !pos || p.id === focus) out[p.id] = 1;
    else if (p.team === myTeam) out[p.id] = FADED.mate;
    else out[p.id] = dist(pos, me) <= OPPONENT_NEAR_M ? 1 : FADED.opponent;
  }
  return out;
}

// Following `focus` through the whole play at `fps`, timed as the viewer plays it at `speed`: each cue pops
// up as its step starts and playback eases to half speed while it's new. The view has the shape `aspect`.
// Returns [{ phase, sched, t, cam, bubbles: [{ text, age }] }]; the last frame is the last phase's final
// moment (the encoders then hold it).
export function focusFrames(play, focus, { fps, speed = 1, aspect }) {
  const frames = [];
  const wall = 1000 / fps;
  let cam = null;
  let bubbles = [];
  let t = 0;
  for (let i = 0; i < play.phases.length; i++) {
    const sched = buildSchedule(play, i);
    const last = i === play.phases.length - 1;
    const stop = last ? sched.routesEnd : sched.total;
    const cues = phaseCues(play, i, focus, sched);
    for (;;) {
      const f = frameAt(sched, t);
      const me = f.players[focus];
      if (me) cam = glide(cam, followTarget(me, ballIn(sched, f), aspect), wall, me);
      frames.push({ phase: i, sched, t, cam: cam && { ...cam }, bubbles: bubbles.map(b => ({ ...b })) });
      if (t >= stop) break; // only the last phase gets here: its final moment
      const next = t + wall * speed * cueSpeed(bubbles);
      bubbles = [...ageBubbles(bubbles, wall), ...firedBetween(cues, t, Math.min(next, stop)).map(c => ({ text: c.text, age: 0 }))];
      if (!last && next >= stop) { t = next - stop; break; } // the next phase carries on from there
      t = Math.min(next, stop);
    }
  }
  return frames;
}
