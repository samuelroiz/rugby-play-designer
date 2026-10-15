import { startSpot } from './pitch.js';

// Autosave to localStorage, and saving/loading plays as .json files.
// Storage can be missing or throw (private mode, blocked site data, full quota), so every access is
// wrapped and the app carries on without it.

export const SCHEMA_VERSION = 1;
export const CATEGORIES = ['attack', 'defense', 'lineout', 'scrum'];

const AUTOSAVE_KEY = 'rugby-play-designer.autosave';
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

// --- Autosave ---

export function loadAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return { play: parsePlay(saved.play), phase: Number.isInteger(saved.phase) ? saved.phase : 0 };
  } catch {
    return null; // unreadable or unusable: start fresh rather than fail
  }
}

export function saveAutosave(play, phase) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ play, phase }));
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

// Checks a play object and fills in optional fields. Throws a friendly Error if it can't be used.
export function parsePlay(data) {
  const fail = why => { throw new Error(`That file isn't a rugby play: ${why}.`); };
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('it has no play in it');
  if (typeof data.schemaVersion !== 'number') fail('it has no schemaVersion');
  if (data.schemaVersion > SCHEMA_VERSION) throw new Error('That play was saved by a newer version of the designer.');
  if (!Array.isArray(data.players)) fail('it has no players list');
  if (!Array.isArray(data.phases) || !data.phases.length) fail('it has no phases');

  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const isPoint = p => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]);

  const players = data.players.map(p => {
    if (!isObj(p) || typeof p.id !== 'string' || !TEAMS.includes(p.team)) fail('a player is missing its id or team');
    return { id: p.id, team: p.team, label: String(p.label ?? p.id.slice(1)).slice(0, 3) };
  });

  const phases = data.phases.map(ph => {
    if (!isObj(ph)) fail('a phase is broken');
    const positions = ph.positions ?? {};
    const objects = ph.objects ?? [];
    const routes = ph.routes ?? [];
    if (!isObj(positions) || !Array.isArray(objects) || !Array.isArray(routes)) fail('a phase is broken');
    for (const pos of Object.values(positions)) if (!isObj(pos) || !isNum(pos.x) || !isNum(pos.y)) fail('a player position is broken');
    for (const o of objects) if (!isObj(o) || typeof o.id !== 'string' || typeof o.type !== 'string' || !isNum(o.x) || !isNum(o.y)) fail('a marker is broken');
    for (const r of routes) {
      if (!isObj(r) || typeof r.id !== 'string' || typeof r.type !== 'string' || !Array.isArray(r.points) || r.points.length < 2 || !r.points.every(isPoint)) fail('a route is broken');
    }
    // A route's "from" and a pass's "to" must name a player in the play; otherwise that end is loose.
    const ids = new Set(players.map(p => p.id));
    const end = id => (typeof id === 'string' && ids.has(id) ? id : null);
    const checked = routes.map(r => ({ ...r, from: end(r.from), ...(r.type === 'pass' ? { to: end(r.to) } : {}) }));
    return { ...ph, note: typeof ph.note === 'string' ? ph.note : '', positions, objects, routes: checked };
  });

  let tags = data.tags ?? [];
  if (typeof tags === 'string') tags = tags.split(',');
  if (!Array.isArray(tags)) tags = [];

  return {
    schemaVersion: SCHEMA_VERSION,
    name: typeof data.name === 'string' ? data.name : 'Untitled play',
    category: CATEGORIES.includes(data.category) ? data.category : 'attack',
    tags: tags.map(t => String(t).trim()).filter(Boolean),
    view: data.view === 'half' ? 'half' : 'full',
    orientation: data.orientation === 'vertical' ? 'vertical' : 'horizontal',
    players,
    phases: fillMissingPositions(players, phases),
  };
}

// Every player is on the pitch in every phase. Older plays can miss a player in some phases (e.g. one
// re-added on a later phase): copy their spot from the nearest earlier phase, or the nearest later one if
// there is no earlier one. A player with no spot anywhere gets their usual starting spot.
export function fillMissingPositions(players, phases) {
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
