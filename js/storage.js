// A play's shape: a blank play, and the checks every play passes when it's loaded (parsePlay). Also the old
// single autosave (moved into the play library on first run, see library.js and open-play.js), and saving/loading
// plays as .json files.
// Storage can be missing or throw (private mode, blocked site data, full quota), so every access is
// wrapped and the app carries on without it.

import { startSpot } from './pitch.js';
import { OPTION_LABEL_MAX, OPTION_TYPES } from './options.js';
import { CUE_MAX, defaultCueStep } from './cues.js';

const SCHEMA_VERSION = 1;
const CATEGORIES = ['attack', 'defense', 'lineout', 'scrum'];

const TEAMS = ['attack', 'defense'];

export function blankPlay({ view = 'full', orientation = 'horizontal' } = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: 'Untitled play',
    category: 'attack',
    tags: [],
    view,
    orientation,
    players: [],
    phases: [{ note: '', positions: {}, objects: [], routes: [] }],
  };
}

// --- The old autosave ---

// Before the library, the play was autosaved here as { play, phase }. On first run it is moved into the
// library; a broken one is moved to the backup key instead, so it isn't lost.
const AUTOSAVE_KEY = 'rugby-play-designer.autosave';
const AUTOSAVE_BACKUP_KEY = 'rugby-play-designer.autosave-backup';

// The raw autosave text, or null if there is none (or storage can't be read).
export function readAutosave() {
  try {
    return localStorage.getItem(AUTOSAVE_KEY);
  } catch {
    return null;
  }
}

// Turns autosave text into { play, phase }. Throws if it can't be used.
export function parseAutosave(raw) {
  const saved = JSON.parse(raw);
  if (!saved || typeof saved !== 'object') throw new Error('The autosave is empty.');
  return { play: parsePlay(saved.play), phase: Number.isInteger(saved.phase) ? saved.phase : 0 };
}

// The text saving this play and phase would store, so a caller can tell whether anything changed.
export const autosaveText = (play, phase) => JSON.stringify({ play, phase });

export function removeAutosave() {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    // blocked: nothing to remove
  }
}

export function backupAutosave(raw) {
  try {
    localStorage.setItem(AUTOSAVE_BACKUP_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

// --- Files ---

// "My play: v2?" -> "My play v2.json". Keeps spaces, drops characters that are unsafe in file names.
export function safeFileName(name, ext = '.json') {
  const cleaned = String(name ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 80);
  return `${cleaned || 'play'}${ext}`;
}

export function downloadPlay(play) {
  const blob = new Blob([JSON.stringify(play, null, 2) + '\n'], { type: 'application/json' });
  downloadBlob(blob, safeFileName(play.name));
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Reads and checks a picked file. Throws an Error with a short message the user can read.
export async function readPlayFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error(`"${file.name}" isn't a play file: it isn't valid JSON.`);
  }
  return parsePlay(data);
}

export const NAME_MAX = 60;
const LABEL_MAX = 3;
// A player's instruction for one phase (phases[n].instructions, by player id), shown in the phone viewer.
export const INSTRUCTION_MAX = 120;

// Checks a play object and fills in optional fields. Throws a friendly Error if it can't be used.
// Every optional field is checked and dropped (or given its default) if it's the wrong type, so a hand-edited
// or damaged file can't crash the app later: ids that name nobody are dropped too.
export function parsePlay(data) {
  const fail = why => { throw new Error(`That file isn't a rugby play: ${why}.`); };
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('it has no play in it');
  if (typeof data.schemaVersion !== 'number') fail('it has no schemaVersion');
  if (data.schemaVersion > SCHEMA_VERSION) throw new Error('That play was saved by a newer version of the designer.');
  if (!Array.isArray(data.players)) fail('it has no players list');
  if (!Array.isArray(data.phases) || !data.phases.length) fail('it has no phases');

  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const isPoint = p => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]);
  const isPos = p => isObj(p) && isNum(p.x) && isNum(p.y);
  const isOrder = v => Number.isInteger(v) && v >= 1;
  // The checked fields, in the order the file had them (new ones last), so a play saved and loaded again is
  // the same JSON.
  const inOrder = (src, out) => {
    const sorted = {};
    for (const key of Object.keys(src)) if (key in out) sorted[key] = out[key];
    return Object.assign(sorted, out);
  };

  const players = [];
  for (const p of data.players) {
    if (!isObj(p) || typeof p.id !== 'string' || !p.id || !TEAMS.includes(p.team)) fail('a player is missing its id or team');
    if (players.some(q => q.id === p.id)) continue; // the same player twice: keep the first
    const label = typeof p.label === 'string' || isNum(p.label) ? String(p.label).trim().slice(0, LABEL_MAX) : '';
    players.push({ id: p.id, team: p.team, label: label || p.id.slice(1).slice(0, LABEL_MAX) || '?' });
  }
  const ids = new Set(players.map(p => p.id));
  const known = id => (typeof id === 'string' && ids.has(id) ? id : null);
  const team = v => (TEAMS.includes(v) ? v : undefined);

  const phases = data.phases.map(ph => {
    if (!isObj(ph)) fail('a phase is broken');
    const rawPositions = ph.positions ?? {};
    const objects = ph.objects ?? [];
    const routes = ph.routes ?? [];
    if (!isObj(rawPositions) || !Array.isArray(objects) || !Array.isArray(routes)) fail('a phase is broken');
    // Only players in the play have a position; a broken one is filled in like a missing one (below).
    const positions = {};
    for (const [id, pos] of Object.entries(rawPositions)) if (ids.has(id) && isPos(pos)) positions[id] = { x: pos.x, y: pos.y };

    const checkedObjects = objects.map(o => {
      if (!isObj(o) || typeof o.id !== 'string' || typeof o.type !== 'string' || !isNum(o.x) || !isNum(o.y)) fail('a marker is broken');
      const out = { id: o.id, type: o.type, x: o.x, y: o.y };
      // A set piece's group: only players in the play, each once. Without a list it's a plain marker.
      if (Array.isArray(o.pack)) out.pack = [...new Set(o.pack.filter(id => ids.has(id)))];
      if (team(o.putIn)) out.putIn = o.putIn;
      if (team(o.throwIn)) out.throwIn = o.throwIn;
      return inOrder(o, out);
    });

    const checkedRoutes = routes.map(r => {
      if (!isObj(r) || typeof r.id !== 'string' || typeof r.type !== 'string' || !Array.isArray(r.points) || r.points.length < 2 || !r.points.every(isPoint)) fail('a route is broken');
      // A route's "from" and a pass's "to" must name a player in the play; otherwise that end is loose.
      const out = { id: r.id, type: r.type, from: known(r.from), points: r.points.map(([x, y]) => [x, y]) };
      if ('curve' in r) out.curve = isNum(r.curve) ? r.curve : 0;
      if (r.type === 'pass') out.to = known(r.to);
      if (isOrder(r.order)) out.order = r.order;
      // Only passes and kicks can be options.
      if (typeof r.option === 'string' && /^[A-Z]$/.test(r.option) && OPTION_TYPES.has(r.type)) out.option = r.option;
      else if ('option' in r) out.option = null;
      if (out.option && typeof r.optionLabel === 'string' && r.optionLabel.trim()) out.optionLabel = r.optionLabel.trim().slice(0, OPTION_LABEL_MAX);
      return inOrder(r, out);
    });
    const out = { note: typeof ph.note === 'string' ? ph.note : '', positions, objects: checkedObjects, routes: checkedRoutes };
    // Optional: kept only for players in the play, as trimmed text, cut to INSTRUCTION_MAX; empty ones dropped.
    if (isObj(ph.instructions)) {
      const instructions = {};
      for (const [id, text] of Object.entries(ph.instructions)) {
        if (ids.has(id) && typeof text === 'string' && text.trim()) instructions[id] = text.trim().slice(0, INSTRUCTION_MAX);
      }
      if (Object.keys(instructions).length) out.instructions = instructions;
    }
    // Optional: cues for players in the play, as trimmed text cut to CUE_MAX, each at a step from 1 to 99
    // (missing or wrong: the step of the player's first route in the phase, else 1); empty ones dropped.
    if (Array.isArray(ph.cues)) {
      const cues = ph.cues
        .filter(c => isObj(c) && ids.has(c.player) && typeof c.text === 'string' && c.text.trim())
        .map(c => ({
          player: c.player,
          step: Number.isInteger(c.step) && c.step >= 1 && c.step <= 99 ? c.step : defaultCueStep(checkedRoutes, c.player),
          text: c.text.trim().slice(0, CUE_MAX),
        }));
      if (cues.length) out.cues = cues;
    }
    return out;
  });

  let tags = data.tags ?? [];
  if (typeof tags === 'string') tags = tags.split(',');
  if (!Array.isArray(tags)) tags = [];

  return {
    schemaVersion: SCHEMA_VERSION,
    name: typeof data.name === 'string' ? data.name.slice(0, NAME_MAX) : 'Untitled play',
    category: CATEGORIES.includes(data.category) ? data.category : 'attack',
    tags: tags.filter(t => typeof t === 'string').map(t => t.trim()).filter(Boolean),
    view: ['half', 'half-own'].includes(data.view) ? data.view : 'full',
    orientation: data.orientation === 'vertical' ? 'vertical' : 'horizontal',
    players,
    phases: fillMissingPositions(players, phases),
  };
}

// Every player is on the pitch in every phase. Older plays can miss a player in some phases (e.g. one
// re-added on a later phase): copy their spot from the nearest earlier phase, or the nearest later one if
// there is no earlier one. A player with no spot anywhere gets their usual starting spot.
function fillMissingPositions(players, phases) {
  const out = phases.map(ph => ({ ...ph, positions: { ...ph.positions } }));
  for (const p of players) {
    const has = out.map(ph => ph.positions[p.id]);
    if (has.every(Boolean)) continue;
    const spare = startSpot(p.team, Number(p.id.slice(1)) || 1, 'full');
    out.forEach((ph, i) => {
      if (has[i]) return;
      const from = has.slice(0, i).findLast(Boolean) ?? has.slice(i + 1).find(Boolean) ?? spare;
      ph.positions[p.id] = { x: from.x, y: from.y };
    });
  }
  return out;
}
