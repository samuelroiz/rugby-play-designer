// Position cues: short calls (phases[n].cues, e.g. { player: 'a13', step: 2, text: 'JUMP!' }) that pop up
// next to a player in the phone viewer and in a position's animation export, when their step starts. While
// one is up, playback eases to half speed for about a second, so it registers. Pure functions of plain data
// (no DOM), shared by the viewer, the export and the Node tests.

import { TIMING } from './animate.js';

export const CUE_MAX = 30; // characters; cues are shown in capitals
export const CUE = {
  holdMs: 1500, // a bubble stays up this long
  slowSpeed: 0.5, // playback eases to this speed while it's new
  easeMs: 200, // easing down to it, and back up
  slowMs: 1000, // how long it stays at that speed
};

// The step a cue pops up at when none is given: the step of the player's first route in the phase, else 1.
export function defaultCueStep(routes, player) {
  const orders = routes.filter(r => r.from === player && Number.isInteger(r.order)).map(r => r.order);
  return orders.length ? Math.min(...orders) : 1;
}

// When step `step` starts in a phase's schedule (animate.js buildSchedule), in ms: when its first route
// starts moving. A step with no routes takes the next step that has some, and after the last one, the end of
// the phase's routes (the phase's lead when it has none).
export function cueTime(sched, step) {
  const at = new Map();
  for (const m of [...sched.moves, ...sched.flights]) {
    const o = m.route.order ?? 0;
    if (!at.has(o) || at.get(o) > m.start) at.set(o, m.start);
  }
  if (at.has(step)) return at.get(step);
  const later = [...at.keys()].filter(o => o > step).sort((a, b) => a - b)[0];
  return later != null ? at.get(later) : Math.max(sched.routesEnd, TIMING.lead);
}

// Player `id`'s cues in phase `i`, with when each pops up: [{ text, step, time }], in time order.
export function phaseCues(play, i, id, sched) {
  return (play.phases[i].cues ?? [])
    .filter(c => c.player === id)
    .map(c => ({ text: c.text, step: c.step, time: cueTime(sched, c.step) }))
    .sort((a, b) => a.time - b.time);
}

// The cues among `cues` that pop up after `from` and by `to` (ms into the phase).
export const firedBetween = (cues, from, to) => cues.filter(c => c.time > from && c.time <= to);

// How fast playback runs `age` ms after a cue popped up: eases to CUE.slowSpeed, stays there for CUE.slowMs,
// and eases back to full speed.
export function slowFactor(age) {
  const { slowSpeed, easeMs, slowMs } = CUE;
  if (age < 0 || age >= slowMs + easeMs) return 1;
  const k = age < easeMs ? age / easeMs : age <= slowMs ? 1 : 1 - (age - slowMs) / easeMs;
  return 1 - (1 - slowSpeed) * k;
}
// With several bubbles up, the slowest wins.
export const cueSpeed = bubbles => Math.min(1, ...bubbles.map(b => slowFactor(b.age)));

// The bubbles still up after `ms` more, each a little older.
export const ageBubbles = (bubbles, ms) => bubbles.map(b => ({ ...b, age: b.age + ms })).filter(b => b.age < CUE.holdMs);

// Where a bubble w x h goes next to a player drawn at (x, y) with radius r, inside a view width x height
// with `margin` round its edge: above them if it fits, else below, else beside them; never over the disc.
// Returns its top left corner.
export function placeBubble({ x, y, r, w, h, width, height, margin = 8, gap = 6 }) {
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const across = clamp(x - w / 2, margin, width - w - margin);
  const upDown = clamp(y - h / 2, margin, height - h - margin);
  const spots = [
    { left: across, top: y - r - gap - h },
    { left: across, top: y + r + gap },
    { left: x + r + gap, top: upDown },
    { left: x - r - gap - w, top: upDown },
  ];
  const inside = s => s.top >= margin && s.top + h <= height - margin && s.left >= margin && s.left + w <= width - margin;
  return spots.find(inside) ?? { left: across, top: clamp(spots[0].top, margin, height - h - margin) };
}
