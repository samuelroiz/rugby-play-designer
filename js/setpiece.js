// Set-piece presets. Stage 1 has the scrum: both packs in formation on a scrum mark.
// Attack attacks towards x=110 and defense towards x=-10, so the packs face +x and -x.

import { movePlayer, nextId } from './editor.js';

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

// Nearest legal mark: x anywhere in the field of play, y snapped to the closest of the three spots.
export function snapScrum(x, y) {
  return {
    x: Math.round(Math.min(100, Math.max(0, x)) * 10) / 10,
    y: SCRUM_SPOTS_Y.reduce((best, s) => (Math.abs(s - y) < Math.abs(best - y) ? s : best)),
  };
}

// The put-in team's scrum-half feeds on that team's loosehead side: -y for attack, +y for defense.
export const putInSide = putIn => (putIn === 'defense' ? 1 : -1);

// Puts players 1-8 of both teams in formation on a new scrum. Players that already exist are moved
// rather than duplicated; missing ones are added (ids a1-a8/d1-d8 are always within the 15 limit).
// An earlier scrum preset in the phase is replaced, so no player belongs to two.
export function placeScrum(state, phase, at, putIn) {
  const previous = phase.objects.find(o => o.type === 'scrum' && o.pack);
  const mark = snapScrum(previous?.x ?? at.x, previous?.y ?? at.y);
  phase.objects = phase.objects.filter(o => o !== previous);

  const pack = [];
  for (const [team, prefix, dir] of TEAMS) {
    for (const [n, along, across] of PACK) {
      const id = prefix + n;
      if (!state.players.some(p => p.id === id)) state.players.push({ id, team, label: String(n) });
      movePlayer(phase, id, mark.x + dir * along, mark.y + dir * across);
      pack.push(id);
    }
  }
  const scrum = { id: nextId('o', phase.objects), type: 'scrum', ...mark, putIn, pack };
  phase.objects.push(scrum);
  return scrum;
}

// Moves a scrum to the snapped mark nearest (x, y), taking its pack along by the same amount,
// so players that were dragged out of formation keep their offset.
export function moveScrum(phase, scrum, x, y) {
  const to = snapScrum(x, y);
  const dx = to.x - scrum.x;
  const dy = to.y - scrum.y;
  if (!dx && !dy) return;
  for (const id of scrum.pack ?? []) {
    const pos = phase.positions[id];
    if (pos) movePlayer(phase, id, pos.x + dx, pos.y + dy);
  }
  Object.assign(scrum, to);
}
