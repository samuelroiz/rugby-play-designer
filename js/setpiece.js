// Set-piece presets: the scrum (both packs and 9s on a scrum mark) and the lineout (both teams' forwards
// lined up from 5 m in from touch, hookers and 9s). Attack attacks towards x=110 and defense towards
// x=-10, so the packs face +x and -x. Players that already exist are moved rather than duplicated;
// missing ones are added to every phase (ids 1-9 are always within the 15 limit).

import { movePlayer } from './editor.js';
import { nextId, round1 as round } from './model.js';

// Across the pitch a scrum mark sits on the left 15 m line, the middle, or the right 15 m line.
const SCRUM_SPOTS_Y = [15, 35, 55];

// One pack's formation for a team facing +x: [number, metres along, metres across] from the mark.
// Negative "across" is the pack's left. Front row 1-2-3 (loosehead 1 on the left), locks 4-5 behind,
// flankers 6-7 on the sides, 8 at the back. Spacing suits the 1.2 m player discs rather than real
// body sizes. The other pack is the same turned half a turn, so each 1 faces the opposing 3.
const PACK = [
  [1, -1.5, -2.5], [2, -1.5, 0], [3, -1.5, 2.5],
  [4, -4, -1.25], [5, -4, 1.25],
  [6, -3.6, -3.9], [7, -3.6, 3.9],
  [8, -6.5, 0],
];

const TEAMS = [['attack', 'a', 1], ['defense', 'd', -1]];

// A ball within this distance of the mark counts as "at the scrum": the preset reuses it and it moves with the scrum.
const BALL_AT_SCRUM = 8;

// Nearest legal mark: x anywhere in the field of play, y snapped to the closest of the three spots.
function snapScrum(x, y) {
  return {
    x: round(Math.min(100, Math.max(0, x))),
    y: SCRUM_SPOTS_Y.reduce((best, s) => (Math.abs(s - y) < Math.abs(best - y) ? s : best)),
  };
}

// The put-in team's scrum-half feeds on that team's loosehead side: -y for attack, +y for defense.
const putInSide = putIn => (putIn === 'defense' ? 1 : -1);

const ballNear = (objects, mark) => objects.find(o => o.type === 'ball' && Math.hypot(o.x - mark.x, o.y - mark.y) <= BALL_AT_SCRUM);

// Puts player `n` of `team` at (x, y) in this phase, adding them to the play (in every phase, at the same
// spot) if they aren't in it yet. Returns their id.
function place(state, phase, team, n, x, y) {
  const id = (team === 'attack' ? 'a' : 'd') + n;
  [x, y] = [round(x), round(y)];
  if (!state.players.some(p => p.id === id)) {
    state.players.push({ id, team, label: String(n) });
    for (const each of state.phases) each.positions[id] = { x, y };
  }
  movePlayer(phase, id, x, y);
  return id;
}

// The phase's ball nearest `at`, wherever it is, or null if it has none.
const nearestBall = (objects, at) => objects.filter(o => o.type === 'ball')
  .sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y))[0] ?? null;

// Moves the phase's ball nearest `near` to (x, y), so a set piece never adds a second ball; adds one only
// if the phase has none.
function placeBall(phase, near, x, y) {
  let ball = nearestBall(phase.objects, near);
  if (!ball) {
    ball = { id: nextId('o', phase.objects), type: 'ball' };
    phase.objects.push(ball);
  }
  Object.assign(ball, { x: round(x), y: round(y) });
}

// Puts players 1-8 of both teams in formation on a new scrum at the legal mark nearest `at` (where the user
// clicked), and both 9s on the put-in side: the put-in team's 9 next to the ball, the other 9 by their own
// pack. The 9s are part of the scrum's pack, so they move with it. An earlier scrum preset in the phase is
// replaced, so no player belongs to two. The ball is an ordinary ball object on the put-in side: the phase's
// ball nearest the mark is moved there (one is added only if there's none).
export function placeScrum(state, phase, at, putIn) {
  const previous = phase.objects.find(o => o.type === 'scrum' && o.pack);
  const mark = snapScrum(at.x, at.y);
  phase.objects = phase.objects.filter(o => o !== previous);

  const side = putInSide(putIn);
  const putInDir = putIn === 'defense' ? -1 : 1;
  const pack = [];
  for (const [team, , dir] of TEAMS) {
    for (const [n, along, across] of PACK) pack.push(place(state, phase, team, n, mark.x + dir * along, mark.y + dir * across));
    // Both 9s stand on the put-in side, 1.9 m beyond the ball: the put-in 9 just on their own side of the
    // mark, the other 9 by their pack's flank.
    const x = team === putIn ? mark.x - putInDir * 0.5 : mark.x + putInDir * 2.5;
    pack.push(place(state, phase, team, 9, x, mark.y + side * 6.6));
  }
  leaveOtherGroups(phase, 'scrum', pack);
  const scrum = { id: nextId('o', phase.objects), type: 'scrum', ...mark, putIn, pack };
  phase.objects.push(scrum);

  placeBall(phase, mark, mark.x, mark.y + side * 4.7);
  return scrum;
}

// A player belongs to one set piece at a time: placing a scrum takes its players out of a lineout's group
// in the same phase, and the other way round.
function leaveOtherGroups(phase, type, ids) {
  for (const o of phase.objects) {
    if (o.type !== type && o.pack) o.pack = o.pack.filter(id => !ids.includes(id));
  }
}

// Lineout order from the front: lifter 1, jumper 4, lifter 3, then 6, 5, 8 and 7 at the back.
const LINEOUT = [1, 4, 3, 6, 5, 8, 7];
// Discs are 2.4 m across, so the two lines stand 2.4 m apart and players 2.5 m apart (wider than real
// life, as in the scrum), starting 1.2 m beyond the 5 m line.
const LINE_GAP = 1.2;
const LINEOUT_STEP = 2.5;

// Lines up both teams' forwards at `at` (where the user clicked), using the phase's lineout marker (one is
// added if there isn't one). The marker is snapped to the 5 m line of the touchline nearer `at`, and its x
// is the line of touch: attack stands on the -x side, defense on the +x side. The throwing team's hooker is on
// the touchline with the ball, the other hooker in the 5 m channel, and both 9s behind the lineout. A lineout
// restarts play, so the phase's ball nearest the marker moves to the hooker (one is added if there's none).
// The players placed are the marker's `pack`, so dragging the marker moves them (see moveLineout).
// Returns the marker.
export function placeLineout(state, phase, at, throwIn) {
  let marker = phase.objects.find(o => o.type === 'lineout');
  if (!marker) {
    marker = { id: nextId('o', phase.objects), type: 'lineout' };
    phase.objects.push(marker);
  }
  Object.assign(marker, { x: at.x, y: at.y });
  const s = marker.y <= 35 ? 1 : -1; // into the field from the nearer touchline
  const touch = s > 0 ? 0 : 70;
  const x = round(Math.min(97, Math.max(3, marker.x)));
  const y5 = touch + s * 5;
  Object.assign(marker, { x, y: y5 });

  const pack = [];
  for (const [team, , dir] of TEAMS) {
    const line = x - dir * LINE_GAP;
    LINEOUT.forEach((n, i) => pack.push(place(state, phase, team, n, line, y5 + s * (LINE_GAP + i * LINEOUT_STEP))));
    if (team === throwIn) pack.push(place(state, phase, team, 2, x - dir * 0.5, touch + s * 1.2));
    else pack.push(place(state, phase, team, 2, x - dir * 2.4, touch + s * 2.6));
    pack.push(place(state, phase, team, 9, x - dir * 3, y5 + s * 19.5));
  }
  leaveOtherGroups(phase, 'lineout', pack);
  Object.assign(marker, { throwIn, pack });
  const throwDir = throwIn === 'defense' ? -1 : 1;
  placeBall(phase, marker, x + throwDir * 0.6, touch + s * 2.2);
  return marker;
}

// Moves a scrum to the snapped mark nearest (x, y), taking its pack and a ball at the scrum along by the
// same amount, so players that were dragged out of formation keep their offset.
export function moveScrum(phase, scrum, x, y) {
  const to = snapScrum(x, y);
  const dx = to.x - scrum.x;
  const dy = to.y - scrum.y;
  if (!dx && !dy) return;
  const ball = ballNear(phase.objects, scrum);
  if (ball) Object.assign(ball, { x: round(ball.x + dx), y: round(ball.y + dy) });
  for (const id of scrum.pack ?? []) {
    const pos = phase.positions[id];
    if (pos) movePlayer(phase, id, pos.x + dx, pos.y + dy);
  }
  Object.assign(scrum, to);
}

// Where a lineout marker from the preset can go: anywhere along the pitch that keeps both lines in the field
// of play, and always on the 5 m line of its own touchline (crossing to the other one would need the
// formation turned round, so the preset is run again for that).
function snapLineout(lineout, x) {
  return { x: round(Math.min(97, Math.max(3, x))), y: lineout.y <= 35 ? 5 : 65 };
}

// Moves a preset lineout along the touchline, taking its players and a ball at the lineout with it by the same
// amount, so players dragged out of the formation keep their offset.
export function moveLineout(phase, lineout, x) {
  const to = snapLineout(lineout, x);
  const dx = to.x - lineout.x;
  const dy = to.y - lineout.y;
  if (!dx && !dy) return;
  const ball = ballNear(phase.objects, lineout);
  if (ball) Object.assign(ball, { x: round(ball.x + dx), y: round(ball.y + dy) });
  for (const id of lineout.pack ?? []) {
    const pos = phase.positions[id];
    if (pos) movePlayer(phase, id, pos.x + dx, pos.y + dy);
  }
  Object.assign(lineout, to);
}
