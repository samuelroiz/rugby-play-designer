// A player's job in a phase, as one short line for the phone viewer and a position's animation export: the
// coach's written instruction (phases[n].instructions), or else one made from the player's routes in that
// phase ("Take the pass from 10, then carry into contact"). The made one is never saved. Pure functions of
// plain data (no DOM), so the Node tests use them as they are.

import { buildSchedule } from './animate.js';

// Kicks, by length and direction (metres; forward is the kicker's way: +x for attack, -x for defense).
export const KICK = { grubberMax: 15, longMin: 35, crossMin: 20 };
// A run that ends this close to where a kick in the phase lands chases it.
export const CHASE_M = 10;
// A ball carrier whose last run ends this close to a ruck that's new in the next phase carries into contact.
export const CONTACT_M = 4;
const MOVE_TEXT = { run: 'Run your line', decoy: 'Decoy run', drift: 'Drift across', blitz: 'Blitz up' };

const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const end = r => { const [x, y] = r.points[r.points.length - 1]; return { x, y }; };

// "Grubber", "Box kick", "Cross-field kick", "Long kick", or "Kick" (backwards or sideways).
export function kickKind(route, team) {
  const [x1, y1] = route.points[0];
  const { x: x2, y: y2 } = end(route);
  const forward = (team === 'defense' ? -1 : 1) * (x2 - x1);
  const across = Math.abs(y2 - y1);
  if (forward <= 0) return 'Kick';
  if (across >= KICK.crossMin && across > forward) return 'Cross-field kick';
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < KICK.grubberMax) return 'Grubber';
  return len >= KICK.longMin ? 'Long kick' : 'Box kick';
}

// Rucks in the phase after phase i that weren't there (within 2 m) in phase i.
function newRucks(play, i) {
  const rucks = ph => (ph?.objects ?? []).filter(o => o.type === 'ruck');
  const before = rucks(play.phases[i]);
  return rucks(play.phases[i + 1]).filter(r => !before.some(b => dist(b, r) < 2));
}

// The job made from player `id`'s routes in phase i (option A, as it plays): up to two things they do, in
// the order they happen, e.g. "Take the pass from 10, then carry into contact". "Hold your spot" when they
// do nothing.
export function autoJob(play, i, id) {
  const sched = buildSchedule(play, i);
  const label = pid => play.players.find(p => p.id === pid)?.label ?? '';
  const team = play.players.find(p => p.id === id)?.team;
  const events = []; // { time, text, weight }: weight decides which two are kept when there are more
  const kicks = sched.flights.filter(f => f.route.type === 'kick');
  const hasBall = sched.holder === id || sched.flights.some(f => f.catcher === id);
  const mine = sched.moves.filter(m => m.player === id);
  const rucks = newRucks(play, i);
  mine.forEach((m, k) => {
    const at = end(m.route);
    let text = MOVE_TEXT[m.route.type] ?? MOVE_TEXT.run;
    let weight = 1;
    if (m.route.type === 'run' && kicks.some(f => dist(end(f.route), at) <= CHASE_M)) [text, weight] = ['Chase the kick', 2];
    if (m.route.type === 'run' && k === mine.length - 1 && hasBall && rucks.some(r => dist(r, at) <= CONTACT_M)) [text, weight] = ['Carry into contact', 3];
    events.push({ time: m.start, text, weight });
  });
  for (const f of sched.flights) {
    if (f.from === id) {
      const to = f.catcher ?? f.to;
      const text = f.route.type === 'kick' ? kickKind(f.route, team) : to ? `Pass to ${label(to)}` : 'Pass';
      events.push({ time: f.start, text, weight: 3 });
    } else if (f.catcher === id) {
      events.push({ time: f.end, text: f.from ? `Take the pass from ${label(f.from)}` : 'Take the pass', weight: 3 });
    }
  }
  events.sort((a, b) => a.time - b.time);
  const unique = events.filter((e, k) => k === 0 || e.text !== events[k - 1].text);
  // Keep the two that matter most (the ball first), in the order they happen.
  const kept = unique.map((e, k) => ({ ...e, k })).sort((a, b) => b.weight - a.weight || a.k - b.k).slice(0, 2).sort((a, b) => a.k - b.k);
  if (!kept.length) return 'Hold your spot';
  const lower = s => s.charAt(0).toLowerCase() + s.slice(1);
  return kept.length === 1 ? kept[0].text : `${kept[0].text}, then ${lower(kept[1].text)}`;
}

// The line a player sees for phase i: the coach's instruction, else the made one.
export const jobLine = (play, i, id) => play.phases[i].instructions?.[id]?.trim() || autoJob(play, i, id);
