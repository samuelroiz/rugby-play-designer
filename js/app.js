// App state, toolbar wiring and redraw. The editor changes state, then render() redraws the SVG from it.
// render() is also where changes are recorded: it commits an undo step (unless a drag is in progress)
// and schedules the autosave, so every change to the play is undoable and saved without extra wiring.
// Redraws that only show hover feedback pass { record: false } and record nothing.

import { drawPitch, setView, viewCentre, startSpot, svgEl, uprightTurn, PLAYER_R } from './pitch.js';
import { initEditor, routeGeometry, isAttached, drawingFrom } from './editor.js';
import { placeScrum, moveScrum, placeLineout, moveLineout } from './setpiece.js';
import { appendPhase, insertPhaseAfter, movePhase } from './phases.js';
import { createHistory } from './history.js';
import {
  blankPlay, readAutosave, parseAutosave, saveAutosave, autosaveText, backupAutosave, AUTOSAVE_KEY,
  downloadPlay, downloadBlob, readPlayFile, safeFileName,
} from './storage.js';
import { pictureSvg, allPhasesSvg, legendSvg, pageCss, svgToPng, pageFit, makePdf, PX_PER_MM } from './export.js';
import { loadTemplates, loadExample, thumbnail, isEmptyPlay } from './templates.js';
import { syncOptions, makeMainOption, optionGroup, optionLetters, OPTION_LABEL_MAX } from './options.js';
import { nextId, nextOrder, round2, curvePoint, playedRoutes, BALL_ROUTES } from './model.js';
import { createPlayback } from './playback.js';
import { initPresent } from './present.js';

const MAX_PER_TEAM = 15;
const BADGE_R = 0.9;
const BALL_R = 0.75; // the ball's drawn half-length, for keeping badges off it
// A pass attached to a receiver stops this far from their centre, so its arrowhead touches their disc.
const PASS_END_GAP = PLAYER_R + 0.2;
// PDF pages: the pitch picture is drawn at this many times its size in CSS px on the page (about 190 dpi).
const PDF_SCALE = 2;
// All-phases PNG: width of each pitch tile in CSS px, and tiles per row (fewer if there are fewer phases).
const SHEET_TILE_W = { horizontal: 900, vertical: 420 };
const SHEET_COLS = { horizontal: 1, vertical: 2 };
const AUTOSAVE_MS = 400;
// Smallest touch target for route handles and lines, in screen pixels (converted to metres at draw time).
const HANDLE_HIT_PX = 22;
const LINE_HIT_PX = 14;

// Look of each route type. Widths and dashes are in metres. No reds or blues: those are the team colours.
// Every route also gets a thin dark casing (see routePaths) so the light colours read on grass and on the white lines.
const ROUTE_TYPES = {
  run:   { label: 'Run',   color: '#ffe14d', width: 0.3 },
  pass:  { label: 'Pass',  color: '#ffffff', width: 0.25, dash: '1 0.7' },
  kick:  { label: 'Kick',  color: '#ffa033', width: 0.5,  dash: '0.01 0.95', cap: 'round' },
  decoy: { label: 'Decoy', color: '#b8b8b8', width: 0.2,  dash: '0.4 0.8' },
  drift: { label: 'Drift', color: '#cfa6ff', width: 0.3 },
  blitz: { label: 'Blitz', color: '#ff8fd0', width: 0.6 },
};
// Routes the ball travels along (BALL_ROUTES) are drawn above the players, so a pass over a lineout reads;
// the others stay under them.
// Option label text, in metres: at least as large as a player's number (1.2).
const OPTION_LABEL_SIZE = 1.25;

// A phone held upright gets the vertical pitch; anything else starts horizontal.
const portraitPhone = matchMedia('(max-width: 700px) and (orientation: portrait)');
// Phones and tablets: a saved picture goes to the share sheet rather than a download.
const touchScreen = matchMedia('(pointer: coarse)');
// The phone layout (toolbar at the bottom): pickers open in the middle of the screen, not by their button.
const phoneLayout = matchMedia('(max-width: 700px)');
const CATEGORY_LABELS = { attack: 'Attack', defense: 'Defense', lineout: 'Lineout', scrum: 'Scrum' };

// The play. Always the same object (window.playState): undo, load and New play replace its contents.
const state = blankPlay({ orientation: portraitPhone.matches ? 'vertical' : 'horizontal' });
window.playState = state;

// UI-only state, not part of the saved play.
const ui = {
  phase: 0, // index of the phase being shown
  tool: null,
  selected: null,
  dragging: false,
  snap: null, // player a route being drawn will attach to (highlighted)
  snapTo: null, // receiver a pass being drawn will end on (highlighted)
  preview: null, // click-to-draw: where the next route would end, { x, y }
  optionFocus: null, // the route whose option box is open, highlighted on the pitch
  layers: { distances: true, grid: false, legend: true, ghost: true, direction: true },
  orientationChosen: false, // once the user picks one, stop following the phone's rotation
  presenting: false, // Present mode
  focusPlayer: null, // Present mode's "I play": the rest of that player's team fades
  exporting: false, // a PNG or PDF is being made: editing waits until it's done
};

const $ = id => document.getElementById(id);
const svg = $('pitch');
const world = $('world');
const legend = $('legend');
const layers = {
  pitch: $('pitch-layer'),
  ghost: $('ghost-layer'),
  objects: $('objects-layer'),
  routes: $('routes-layer'),
  players: $('players-layer'),
  ballRoutes: $('ball-routes-layer'),
  balls: $('ball-layer'),
  badges: $('badges-layer'),
  handles: $('handles-layer'),
  pen: $('pen-layer'),
};
const inputs = { name: $('play-name'), category: $('play-category'), tags: $('play-tags'), note: $('phase-note') };

const phase = () => state.phases[ui.phase];
// Editing is off while the play is playing or a picture is being made (the toolbar, undo, phase editing and
// the play's details grey out), and on the pitch also while presenting.
const busy = () => playback.playing || ui.exporting;
const locked = () => busy() || ui.presenting;
const isSelected = (kind, id) => ui.selected?.kind === kind && ui.selected.id === id;
const turn = () => uprightTurn(state.orientation);

// keepTools (undo/redo) keeps the route tool and the selection, so undoing one click-drawn route doesn't
// stop click-to-draw. A selection that no longer exists is dropped at the next redraw.
function replacePlay(play, phaseIndex = 0, { keepTools = false } = {}) {
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, structuredClone(play));
  ui.phase = Math.min(Math.max(0, phaseIndex), state.phases.length - 1);
  if (!keepTools) {
    ui.selected = null;
    ui.tool = null;
  }
  inputsStale = true;
}

const history = createHistory({
  read: () => ({ play: JSON.stringify(state), phase: ui.phase }),
  write: (json, phaseIndex) => replacePlay(JSON.parse(json), phaseIndex, { keepTools: true }),
});

// Playing the play, and Present mode. Both are drawn by render(), which calls them back.
const playback = createPlayback({
  state, ui, layers, turn,
  show: i => { ui.phase = i; ui.tool = null; render(); },
  changed: () => render(),
});
const present = initPresent({ state, ui, svg, world, penLayer: layers.pen, render, phase, playback });
// For tests and debugging, like window.playState.
window.rugbyPlayback = playback;
window.rugbyPresent = present;

// The autosave is written only when its text has changed. While another tab's change is waiting for an
// answer (see initTabs), nothing is written, so theirs isn't overwritten before the user chooses.
let autosaveTimer = null;
let lastSaved = null;
let theirs = null;
const AUTOSAVE_FAILED = "Couldn't autosave. Save to a file to keep your work.";
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(flushAutosave, AUTOSAVE_MS);
}
function flushAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  if (theirs != null) return;
  const text = autosaveText(state, ui.phase);
  if (text === lastSaved) return;
  if (saveAutosave(state, ui.phase, text)) lastSaved = text;
  else if ($('toast').hidden || $('toast').textContent !== AUTOSAVE_FAILED) showToast(AUTOSAVE_FAILED);
}

// A short message in the status line under the pitch: an error (the default), or `ok` for "Saved …".
function showToast(message, kind = 'error') {
  const toast = $('toast');
  toast.classList.toggle('ok', kind === 'ok');
  toast.setAttribute('role', kind === 'ok' ? 'status' : 'alert');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 5000);
}

function strokeAttrs(type) {
  const st = ROUTE_TYPES[type] ?? ROUTE_TYPES.run;
  return {
    fill: 'none',
    stroke: st.color,
    'stroke-width': st.width,
    'stroke-dasharray': st.dash ?? 'none',
    'stroke-linecap': st.cap ?? 'butt',
    'marker-end': `url(#arrow-${ROUTE_TYPES[type] ? type : 'run'})`,
  };
}

// Dark casing underneath, then the coloured line. Used on the pitch and for the samples.
function routePaths(parent, tag, geometry, type) {
  const attrs = strokeAttrs(type);
  svgEl(tag, { ...geometry, ...attrs, class: 'route-casing', 'stroke-width': attrs['stroke-width'] + 0.16, 'marker-end': null }, parent);
  svgEl(tag, { ...geometry, ...attrs, 'pointer-events': 'none' }, parent);
}

// --- Rendering ---

let pitchKey = '';
let renderFrame = 0;

// `commitKey` groups typing in one text box into a single undo step. `record: false` is for redraws that
// change nothing in the play (hover hints): no undo snapshot, no autosave.
function render(commitKey = null, { record = true } = {}) {
  cancelAnimationFrame(renderFrame);
  renderFrame = 0;
  if (!ui.tool && !ui.dragging) ui.snap = null;
  if (!ui.dragging && !ui.preview) ui.snapTo = null;
  drawScene();
  updateToolbar();
  updatePhaseBar();
  syncInputs();
  updateRouteBar();
  updatePlayControls();
  present.update();
  syncHash();

  if (record && !ui.dragging) {
    history.commit(commitKey);
    scheduleAutosave();
  }
  updateHistoryButtons();
  playback.afterRender();
}

// During a drag: one redraw per animation frame, however many pointer moves there are.
function renderSoon() {
  renderFrame ||= requestAnimationFrame(() => { renderFrame = 0; render(); });
}
const renderHint = () => render(null, { record: false });

// Draws the pitch and the current phase (players, routes, markers) without touching anything else.
function drawScene() {
  // The pitch only changes with the view and layers, so it isn't redrawn on every drag.
  const key = [state.view, state.orientation, ui.layers.distances, ui.layers.grid, ui.layers.direction].join();
  if (key !== pitchKey) {
    pitchKey = key;
    setView(svg, world, state.view, state.orientation);
    drawPitch(layers.pitch, { view: state.view, orientation: state.orientation, ...ui.layers });
  }
  if (ui.phase >= state.phases.length) ui.phase = state.phases.length - 1;
  dropMissingSelection();
  if (!drawingFrom(ui, phase())) ui.preview = null;
  legend.classList.toggle('hidden', !ui.layers.legend);
  svg.classList.toggle('focus-player', !!ui.focusPlayer);
  // An animation frame may have faded the routes out; a fresh drawing starts with them shown.
  for (const l of [layers.routes, layers.ballRoutes, layers.badges]) l.style.opacity = '';
  renderGhost();
  renderObjects();
  renderRoutes();
  renderPlayers();
}

// Selection can point at something that's gone after undo, delete or a phase change.
function dropMissingSelection() {
  const sel = ui.selected;
  if (!sel) return;
  const exists = sel.kind === 'player' ? !!phase().positions[sel.id]
    : sel.kind === 'route' ? phase().routes.some(r => r.id === sel.id)
    : phase().objects.some(o => o.id === sel.id);
  if (!exists) ui.selected = null;
}

// Screen pixels per metre, for sizing touch targets.
function pxPerMetre() {
  const m = world.getScreenCTM();
  return m ? Math.hypot(m.a, m.b) || 1 : 1;
}

// Badge sits beside the start of the route, clear of the player there, on the side the route doesn't bend
// to. `taken` lists discs it mustn't cover ({ x, y, r }: players, balls and badges already placed); if the
// first spot is covered it tries the other side, a little behind the start, then further out.
function badgePosition(r, geometry, taken) {
  const [sx, sy] = r.points[0];
  const [ex, ey] = r.points[r.points.length - 1];
  let tx = geometry.control.x - sx;
  let ty = geometry.control.y - sy;
  if (Math.hypot(tx, ty) < 0.01) [tx, ty] = [ex - sx, ey - sy];
  const len = Math.hypot(tx, ty) || 1;
  [tx, ty] = [tx / len, ty / len];
  const side = r.curve > 0 ? -1 : 1;
  const base = r.from ? PLAYER_R + BADGE_R + 0.5 : BADGE_R + 0.5;
  let first = null;
  for (const extra of [0, 1, 2]) {
    for (const s of [side, -side]) {
      for (const along of [0.6, -0.6]) {
        const out = base + extra;
        const p = { x: sx + tx * along - ty * s * out, y: sy + ty * along + tx * s * out };
        first ??= p;
        if (taken.every(o => Math.hypot(o.x - p.x, o.y - p.y) >= o.r + BADGE_R + 0.1)) return p;
      }
    }
  }
  return first;
}

// Points along a route's curve (the full curve, to its last point), for measuring distances to it.
function curveSamples(r, n = 40) {
  return Array.from({ length: n + 1 }, (_, i) => curvePoint(r, i / n));
}
const distanceTo = (samples, p) => Math.min(...samples.map(q => Math.hypot(q.x - p.x, q.y - p.y)));

// An option's badge sits on its own route: a short way along it from the start (past the passer's disc),
// just to one side, where it is clearly nearer its own route than any other option of the same player.
// It tries points further along, either side, then right on the line; if none is clear of `taken`, the
// one that best tells the options apart.
function optionBadgePosition(r, siblings, taken) {
  const own = curveSamples(r);
  const others = siblings.map(o => curveSamples(o));
  const otherDist = p => (others.length ? Math.min(...others.map(o => distanceTo(o, p))) : Infinity);
  const lengths = [0];
  for (let i = 1; i < own.length; i++) lengths.push(lengths[i - 1] + Math.hypot(own[i].x - own[i - 1].x, own[i].y - own[i - 1].y));
  const total = lengths.at(-1);
  const clearOfStart = PLAYER_R + BADGE_R + 0.4;
  const candidates = [];
  for (const along of [3.4, 4.4, 5.6, 7, 8.8, 11]) {
    const at = Math.min(along, Math.max(total * 0.7, Math.min(clearOfStart, total * 0.85)));
    const i = Math.max(1, lengths.findIndex(l => l >= at));
    const q = own[i];
    const [dx, dy] = [own[i].x - own[i - 1].x, own[i].y - own[i - 1].y];
    const len = Math.hypot(dx, dy) || 1;
    const normal = { x: -dy / len, y: dx / len };
    // The side away from the other options first.
    const probe = s => otherDist({ x: q.x + normal.x * s, y: q.y + normal.y * s });
    const sides = probe(1) >= probe(-1) ? [1, -1] : [-1, 1];
    for (const offset of [BADGE_R + 0.3, 0]) {
      for (const s of offset ? sides : [1]) {
        const p = { x: q.x + normal.x * s * offset, y: q.y + normal.y * s * offset };
        const margin = otherDist(p) - offset;
        const clear = taken.every(o => Math.hypot(o.x - p.x, o.y - p.y) >= o.r + BADGE_R + 0.1);
        candidates.push({ p, margin, clear });
        if (clear && margin >= BADGE_R + 0.5) return p;
      }
    }
  }
  const pool = candidates.some(c => c.clear) ? candidates.filter(c => c.clear) : candidates;
  return pool.reduce((best, c) => (c.margin > best.margin ? c : best)).p;
}

// Discs a badge mustn't cover: every player and ball in the shown phase.
function badgeObstacles() {
  const ph = phase();
  return [
    ...state.players.filter(p => ph.positions[p.id]).map(p => ({ ...ph.positions[p.id], r: PLAYER_R })),
    ...ph.objects.filter(o => o.type === 'ball').map(o => ({ x: o.x, y: o.y, r: BALL_R })),
  ];
}

// The drawn shape of a route: a pass to a receiver stops at the edge of their disc.
const drawnGeometry = r => routeGeometry(r, { endGap: r.to ? PASS_END_GAP : 0 });

function renderRoutes() {
  const layer = layers.routes;
  layer.replaceChildren();
  layers.badges.replaceChildren();
  layers.handles.replaceChildren();
  const ppm = pxPerMetre();
  const lineHit = Math.max(1.6, LINE_HIT_PX / ppm);
  layers.ballRoutes.replaceChildren();
  svg.classList.toggle('option-focusing', !!ui.optionFocus);
  const taken = badgeObstacles();
  const routes = phase().routes;
  // Of each player's options, the one that plays draws as the main plan: A, or the one chosen in Present mode.
  const played = new Set(playedRoutes(routes, playback.option));
  // Option badges are placed first, so the start-of-route badges make way for them.
  const ordered = [...routes.filter(r => r.option), ...routes.filter(r => !r.option)];
  const badgeAt = new Map();
  for (const r of ordered) {
    if (!Number.isFinite(r.order)) continue;
    const b = r.option
      ? optionBadgePosition(r, optionGroup(routes, r.from).filter(o => o !== r), taken)
      : badgePosition(r, routeGeometry(r), taken);
    taken.push({ ...b, r: BADGE_R });
    badgeAt.set(r.id, b);
  }
  for (const r of routes) {
    const selected = isSelected('route', r.id);
    const focus = ui.optionFocus === r.id;
    const dim = faded(r.from) ? ' dim' : '';
    const extra = `${r.option && !played.has(r) ? ' option-alt' : ''}${focus ? ' option-focus' : ''}${dim}`;
    const cls = `route${selected ? ' selected' : ''}${isAttached(r) ? '' : ' loose'}${extra}`;
    const g = svgEl('g', { class: cls, 'data-kind': 'route', 'data-id': r.id }, layer);
    const geometry = routeGeometry(r);
    const { d } = drawnGeometry(r);
    svgEl('path', { d, class: 'route-hit', 'stroke-width': lineHit }, g);
    // Passes and kicks are seen above the players; their touch area stays under them, so a press on the
    // passer still picks up the passer.
    const lines = BALL_ROUTES.has(r.type) ? svgEl('g', { class: `route-line${extra}`, 'data-id': r.id }, layers.ballRoutes) : g;
    const width = ROUTE_TYPES[r.type]?.width ?? 0.3;
    if (focus) svgEl('path', { d, class: 'route-focus', 'stroke-width': width + 1.3 }, lines);
    else if (selected) svgEl('path', { d, class: 'route-highlight', 'stroke-width': width + 0.9 }, lines);
    routePaths(lines, 'path', { d }, r.type);

    // Badges go in their own layer above the players, so a nearby player can't cover them.
    if (badgeAt.has(r.id)) {
      const b = badgeAt.get(r.id);
      const badge = svgEl('g', { class: `badge${dim}`, 'data-kind': 'badge', 'data-id': r.id, transform: `translate(${b.x} ${b.y})${turn()}` }, layers.badges);
      svgEl('circle', { r: BADGE_R, stroke: ROUTE_TYPES[r.type]?.color ?? '#fff' }, badge);
      // "2", or "2A" / "2B" for options.
      const text = `${r.order}${r.option ?? ''}`;
      svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': [1.1, 0.85, 0.7][Math.min(text.length, 3) - 1] }, badge).textContent = text;
    }
    optionLabel(layers.badges, r, dim);

    // While a route tool is active the handles are hidden, so pressing on a player always starts a new route.
    if (selected && !ui.tool) renderHandles(r, geometry, ppm);
  }
  renderPreview(layer);
}

// An option's label (e.g. "if 13 bites"), small, just past the end of the route, kept upright and
// anchored so it reads away from the route. Past the receiver's disc for a pass to a team-mate.
function optionLabel(parent, r, extraClass = '') {
  const text = r.option && r.optionLabel?.trim();
  if (!text) return;
  const { control } = routeGeometry(r);
  const [ex, ey] = r.points[r.points.length - 1];
  let [tx, ty] = [ex - control.x, ey - control.y];
  const len = Math.hypot(tx, ty) || 1;
  [tx, ty] = [tx / len, ty / len];
  const gap = r.to ? PLAYER_R + 0.7 : 1;
  // Direction on screen: vertical turns the pitch a quarter turn anticlockwise, (x, y) -> (y, -x).
  const [sx, sy] = state.orientation === 'vertical' ? [ty, -tx] : [tx, ty];
  const across = Math.abs(sx) >= Math.abs(sy);
  svgEl('text', {
    class: `option-label${extraClass}`,
    transform: `translate(${round2(ex + tx * gap)} ${round2(ey + ty * gap)})${turn()}`,
    'text-anchor': across ? (sx > 0 ? 'start' : 'end') : 'middle',
    'dominant-baseline': across ? 'central' : sy > 0 ? 'hanging' : 'alphabetic',
    'font-size': OPTION_LABEL_SIZE,
  }, parent).textContent = text;
}

// Click-to-draw: a faint line from the selected player to where the next click would end the route.
// A pass aimed at a team-mate ends on them (they're ringed too).
function renderPreview(layer) {
  const from = drawingFrom(ui, phase());
  if (!from || !ui.preview) return;
  const start = phase().positions[from];
  const end = ui.snapTo ? phase().positions[ui.snapTo] : ui.preview;
  if (Math.hypot(end.x - start.x, end.y - start.y) < 0.5) return;
  const r = { points: [[start.x, start.y], [end.x, end.y]], curve: 0, to: ui.snapTo };
  const g = svgEl('g', { class: 'route-preview', 'pointer-events': 'none' }, layer);
  routePaths(g, 'path', { d: drawnGeometry(r).d }, ui.tool);
}

// Start, bend and end handles for the selected route. They sit above the players so they can be grabbed,
// with invisible hit circles at least HANDLE_HIT_PX across on screen for fingers.
function renderHandles(r, geometry, ppm) {
  const hitR = Math.max(1.4, HANDLE_HIT_PX / ppm);
  const [sx, sy] = r.points[0];
  const [ex, ey] = r.points[r.points.length - 1];
  for (const [handle, x, y] of [['start', sx, sy], ['end', ex, ey], ['bend', geometry.handle.x, geometry.handle.y]]) {
    const g = svgEl('g', { class: `handle ${handle}`, 'data-kind': 'handle', 'data-handle': handle, 'data-id': r.id, transform: `translate(${x} ${y})` }, layers.handles);
    svgEl('circle', { r: hitR, class: 'handle-hit' }, g);
    svgEl('circle', { r: handle === 'bend' ? 0.6 : 0.75, class: 'handle-dot' }, g);
  }
}

// "I play": the chosen player's team-mates (and their routes) fade; the opposition stays at full strength.
function faded(id) {
  if (!ui.focusPlayer || id === ui.focusPlayer) return false;
  const team = pid => state.players.find(p => p.id === pid)?.team;
  return !!id && team(id) === team(ui.focusPlayer);
}

function renderPlayers() {
  const layer = layers.players;
  layer.replaceChildren();
  for (const p of state.players) {
    const pos = phase().positions[p.id];
    if (!pos) continue;
    const me = ui.focusPlayer === p.id;
    const cls = `player ${p.team}${isSelected('player', p.id) ? ' selected' : ''}${faded(p.id) ? ' dim' : ''}`;
    const g = svgEl('g', { class: cls, 'data-kind': 'player', 'data-id': p.id, transform: `translate(${pos.x} ${pos.y})${turn()}` }, layer);
    svgEl('circle', { r: PLAYER_R * 1.6, class: 'hit' }, g); // bigger touch target
    if (ui.snap === p.id || ui.snapTo === p.id) svgEl('circle', { r: PLAYER_R + 0.55, class: 'snap-ring' }, g);
    if (me) svgEl('circle', { r: PLAYER_R + 0.75, class: 'me-ring' }, g);
    svgEl('circle', { r: PLAYER_R, class: 'body' }, g);
    playerText(g, p.label);
  }
}

function playerText(g, label) {
  svgEl('text', {
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'font-size': label.length > 2 ? 0.85 : 1.2,
  }, g).textContent = label;
}

// The previous phase's routes and players, faintly, so you can see who moved where. The whole layer
// ignores the pointer. Routes have no badges or handles, so nothing in it reads as the current phase.
// Of a player's options only A, the plan the phase was built from, is shown.
function renderGhost() {
  const layer = layers.ghost;
  layer.replaceChildren();
  const prev = state.phases[ui.phase - 1];
  // Not while playing or presenting: it's an editing aid.
  if (!ui.layers.ghost || !prev || ui.presenting || playback.playing) return;
  const routes = svgEl('g', { class: 'ghost-routes' }, layer);
  for (const r of prev.routes) {
    if (r.option && r.option !== 'A') continue;
    routePaths(routes, 'path', { d: drawnGeometry(r).d }, r.type);
    optionLabel(routes, r);
  }
  for (const p of state.players) {
    const pos = prev.positions[p.id];
    if (!pos) continue;
    const g = svgEl('g', { class: `ghost ${p.team}`, 'data-ghost': p.id, transform: `translate(${pos.x} ${pos.y})${turn()}` }, layer);
    svgEl('circle', { r: PLAYER_R }, g);
    playerText(g, p.label);
  }
}

// Marker letter, kept upright. (x, y) is in the marker's pitch-aligned space.
function label(g, text, x = 0, y = 0) {
  svgEl('text', {
    transform: `translate(${x} ${y})${turn()}`,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'font-size': 1.3,
  }, g).textContent = text;
}

// A set piece's drag block (S for a scrum, L for a lineout) shows only while it or one of its players is selected.
function groupActive(o) {
  const sel = ui.selected;
  return !!sel && ((sel.kind === 'object' && sel.id === o.id) || (sel.kind === 'player' && o.pack.includes(sel.id)));
}

// Markers go under the routes and players; balls go in their own layer above the players, so a player
// holding the ball never hides it.
// The drag block of a scrum or lineout, at (x, y) from its mark. Pressing it drags the whole set piece.
function groupTab(g, x, y, letter, selected) {
  const tab = svgEl('g', { transform: `translate(${x} ${y})`, class: 'group-tab' }, g);
  svgEl('circle', { r: 1.9, class: 'hit' }, tab);
  if (selected) svgEl('circle', { r: 1.9, class: 'select-ring' }, tab);
  svgEl('rect', { x: -1.2, y: -1.2, width: 2.4, height: 2.4, rx: 0.4, class: 'outline' }, tab);
  label(tab, letter);
}

function renderObjects() {
  layers.objects.replaceChildren();
  layers.balls.replaceChildren();
  for (const o of phase().objects) {
    const layer = o.type === 'ball' ? layers.balls : layers.objects;
    const g = svgEl('g', { class: `marker ${o.type}`, 'data-kind': 'object', 'data-id': o.id, transform: `translate(${o.x} ${o.y})` }, layer);
    const selected = isSelected('object', o.id);

    if (o.type === 'scrum' && o.pack) {
      // Scrum preset: the mark between the front rows, and (when active) an "S" block clear of the
      // packs, which cover the mark, to drag the whole scrum by. The ball is its own object.
      svgEl('line', { x1: 0, y1: -3.8, x2: 0, y2: 3.8, class: 'scrum-mark' }, g);
      if (!groupActive(o)) continue;
      const side = o.putIn === 'defense' ? 1 : -1; // the ball's side; the block goes on the other
      groupTab(g, 0, -side * 6.5, 'S', selected);
      continue;
    }

    if (o.type === 'lineout' && o.pack) {
      // Lineout preset: the marker on the 5 m line, which can be selected and dragged, and (when active) an
      // "L" block beside the defense's line, into the field, to drag the whole lineout by.
      svgEl('circle', { r: 2.4, class: 'hit' }, g);
      if (selected) svgEl('circle', { r: 2.4, class: 'select-ring' }, g);
      svgEl('line', { x1: -0.7, y1: -2, x2: -0.7, y2: 2, class: 'outline' }, g);
      svgEl('line', { x1: 0.7, y1: -2, x2: 0.7, y2: 2, class: 'outline' }, g);
      if (groupActive(o)) groupTab(g, 5, (o.y <= 35 ? 1 : -1) * 5, 'L', selected);
      continue;
    }

    const ringR = o.type === 'ball' ? 1.4 : 3;
    svgEl('circle', { r: ringR, class: 'hit' }, g);
    if (selected) svgEl('circle', { r: ringR, class: 'select-ring' }, g);

    if (o.type === 'ball') {
      svgEl('ellipse', { rx: 0.7, ry: 0.45, class: 'ball', transform: 'rotate(-25)' }, g);
    } else if (o.type === 'ruck') {
      svgEl('circle', { r: 2, class: 'outline' }, g);
      label(g, 'R');
    } else if (o.type === 'scrum') {
      // Plain scrum marker from older plays.
      svgEl('rect', { x: -2.5, y: -1.5, width: 5, height: 3, class: 'outline' }, g);
      label(g, 'S');
    } else if (o.type === 'lineout') {
      svgEl('line', { x1: -0.7, y1: -2, x2: -0.7, y2: 2, class: 'outline' }, g);
      svgEl('line', { x1: 0.7, y1: -2, x2: 0.7, y2: 2, class: 'outline' }, g);
      label(g, 'L', 0, -2.9);
    }
  }
}

function updateToolbar() {
  const count = team => state.players.filter(p => p.team === team).length;
  // Editing is locked while playing or exporting.
  for (const b of document.querySelectorAll('.toolbar .group button')) b.disabled = busy();
  document.querySelector('[data-action="add-attack"]').disabled ||= count('attack') >= MAX_PER_TEAM;
  document.querySelector('[data-action="add-defense"]').disabled ||= count('defense') >= MAX_PER_TEAM;
  document.querySelector('[data-action="delete"]').disabled ||= !ui.selected;
  $('templates-button').disabled = busy();
  $('present-button').disabled = ui.exporting;
  // The play's details can't be reached by mouse or keyboard either: the File menu is inert and closed.
  const fileMenu = $('file-menu');
  fileMenu.inert = busy();
  if (busy()) fileMenu.open = false;
  for (const el of [inputs.name, inputs.category, inputs.tags]) el.disabled = busy();
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', b.dataset.view === state.view);
  for (const b of document.querySelectorAll('[data-orientation]')) b.setAttribute('aria-pressed', b.dataset.orientation === state.orientation);
  for (const b of document.querySelectorAll('[data-route]')) b.setAttribute('aria-pressed', b.dataset.route === ui.tool);
  for (const c of document.querySelectorAll('[data-layer]')) c.checked = ui.layers[c.dataset.layer];
  svg.classList.toggle('drawing', !!ui.tool);
  updateDrawHint();
}

// Shown whenever a route tool is on: how to draw with nothing selected, and "Click where 12's run ends"
// while click-to-draw from a player is on.
function updateDrawHint() {
  const hint = $('draw-hint');
  const wasHidden = hint.hidden;
  hint.hidden = !ui.tool;
  if (!ui.tool) return;
  const touch = touchScreen.matches;
  const verb = touch ? 'Tap' : 'Click';
  const type = ROUTE_TYPES[ui.tool]?.label.toLowerCase() ?? 'route';
  const from = drawingFrom(ui, phase());
  let text;
  if (!from) {
    text = `Drag from a player to draw a ${type}, or ${verb.toLowerCase()} a player first.`;
  } else {
    const player = state.players.find(p => p.id === from);
    // "12", or "defender 1" when both teams have a 1.
    const shared = state.players.some(p => p !== player && p.label === player.label);
    const who = shared ? `${player.team === 'attack' ? 'attacker' : 'defender'} ${player.label}` : player.label;
    const where = ui.tool === 'pass' ? `${who}'s pass ends, or on a team-mate` : `${who}'s ${type} ends`;
    text = `${verb} where ${where}. ${verb} again for another, ${touch ? 'tap the tool again' : 'Esc'} to stop.`;
  }
  // A new hint is what the user needs now, so it replaces an older "Saved …" message in the status line.
  if (hint.textContent !== text || wasHidden) {
    hint.textContent = text;
    $('toast').hidden = true;
  }
}

function updateHistoryButtons() {
  document.querySelector('[data-action="undo"]').disabled = !history.canUndo || locked();
  document.querySelector('[data-action="redo"]').disabled = !history.canRedo || locked();
}

let shownPhase = -1;

function updatePhaseBar() {
  const n = state.phases.length;
  const tabs = $('phase-tabs');
  if (tabs.children.length !== n) {
    tabs.replaceChildren(...state.phases.map((_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.phase = 'goto';
      b.dataset.index = i;
      b.textContent = i + 1;
      b.setAttribute('aria-label', `Phase ${i + 1}`);
      return b;
    }));
  }
  [...tabs.children].forEach((b, i) => b.setAttribute('aria-current', i === ui.phase ? 'step' : 'false'));
  if (shownPhase !== ui.phase) {
    shownPhase = ui.phase;
    tabs.children[ui.phase]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  $('phase-count').textContent = `Phase ${ui.phase + 1} of ${n}`;
  const btn = name => document.querySelector(`[data-phase="${name}"]`);
  btn('prev').disabled = ui.phase === 0;
  btn('next').disabled = ui.phase === n - 1;
  btn('left').disabled = ui.phase === 0;
  btn('right').disabled = ui.phase === n - 1;
  btn('delete').disabled = n === 1;
  btn('add').disabled = false;
  btn('insert').disabled = false;
  // While playing (or exporting) only moving between phases works; the phases can't be changed.
  if (busy()) for (const name of ['add', 'left', 'right', 'insert', 'delete']) btn(name).disabled = true;
  inputs.note.readOnly = busy();
}

// Play/Pause, speed and Loop. Tooltips only outside Present mode, so nothing pops up on a recording.
function updatePlayControls() {
  document.body.classList.toggle('playing', playback.playing);
  const play = $('play-button');
  play.setAttribute('aria-label', playback.playing ? 'Pause' : 'Play');
  play.querySelector('.play-icon').textContent = playback.playing ? '❚❚' : '▶';
  play.querySelector('.play-text').textContent = playback.playing ? 'Pause' : 'Play';
  for (const b of document.querySelectorAll('[data-speed]')) b.setAttribute('aria-pressed', Number(b.dataset.speed) === playback.speed);
  document.querySelector('[data-play="loop"]').setAttribute('aria-pressed', playback.loop);
  updateOptionButtons();
  for (const b of document.querySelectorAll('#play-controls [data-tip]')) {
    if (ui.presenting) b.removeAttribute('title');
    else b.title = b.dataset.tip;
  }
}

// Present mode: "Option A / B / C" when the shown phase has pass or kick options. Choosing one plays the
// phase with it (the ball follows it) and stops at the phase's end; A is the main plan.
function updateOptionButtons() {
  const box = $('option-buttons');
  const letters = optionLetters(phase().routes);
  box.hidden = letters.length < 2;
  if (box.dataset.letters !== letters.join()) {
    box.dataset.letters = letters.join();
    box.replaceChildren(...letters.map(letter => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.option = letter;
      b.textContent = `Option ${letter}`;
      return b;
    }));
  }
  for (const b of box.children) b.setAttribute('aria-pressed', b.dataset.option === playback.option && (playback.playing || playback.paused));
}

// The address shows the phase (#phase=2), so a link opens on it.
function syncHash() {
  const hash = `#phase=${ui.phase + 1}`;
  if (location.hash !== hash) window.history.replaceState(null, '', hash);
}
function hashPhase() {
  const m = /^#phase=(\d+)$/.exec(location.hash);
  return m ? Math.min(Math.max(Number(m[1]), 1), state.phases.length) - 1 : null;
}

// Text boxes follow the state, except the one being typed in. But when the play is replaced (undo, load,
// New play) or the note box's phase changes, every box is refreshed even if it has the focus: Safari keeps
// the focus in a text box when a button is tapped, and a stale box would write its old text over the new
// play or phase on the next keystroke.
let inputsStale = true;
let notePhase = null; // the phase object whose note the note box shows
function syncInputs() {
  const force = inputsStale;
  const forceNote = force || notePhase !== phase();
  inputsStale = false;
  notePhase = phase();
  const set = (el, value, always) => { if ((always || document.activeElement !== el) && el.value !== value) el.value = value; };
  set(inputs.name, state.name, force);
  $('title-size').dataset.value = inputs.name.value;
  set(inputs.category, state.category, force);
  set(inputs.tags, state.tags.join(', '), force);
  if (inputs.note.value !== phase().note || forceNote) {
    set(inputs.note, phase().note, forceNote);
    fitNote();
  }
}

// The note box grows with its text up to a few lines (then scrolls), so a long note wraps in view.
function fitNote() {
  const t = inputs.note;
  t.style.height = 'auto';
  t.style.height = `${t.scrollHeight + t.offsetHeight - t.clientHeight}px`;
}

// --- Actions ---

// Free numbers (1-15) for a team, lowest first.
function freeNumbers(team) {
  const prefix = team === 'attack' ? 'a' : 'd';
  return Array.from({ length: MAX_PER_TEAM }, (_, i) => i + 1).filter(n => !state.players.some(p => p.id === prefix + n));
}

function addPlayer(team, n) {
  const prefix = team === 'attack' ? 'a' : 'd';
  const id = prefix + n;
  if (!freeNumbers(team).includes(n)) return;
  state.players.push({ id, team, label: String(n) });
  // A player is one person across the whole play: they're in every phase, at the same spot.
  for (const each of state.phases) each.positions[id] = startSpot(team, n, state.view);
  ui.selected = { kind: 'player', id };
}

function addObject(type) {
  const c = viewCentre(state.view);
  const n = phase().objects.length;
  const id = nextId('o', phase().objects);
  // Spread new markers in a small grid so they don't stack on top of each other.
  phase().objects.push({ id, type, x: c.x - 9 + (n % 4) * 6, y: c.y - 6 + (Math.floor(n / 4) % 3) * 6 });
  ui.selected = { kind: 'object', id };
}

function addLineout(throwIn) {
  const marker = placeLineout(state, phase(), viewCentre(state.view), throwIn);
  ui.selected = { kind: 'object', id: marker.id };
  ui.tool = null;
}

function addScrum(putIn) {
  const scrum = placeScrum(state, phase(), viewCentre(state.view), putIn);
  ui.selected = { kind: 'object', id: scrum.id };
  ui.tool = null;
}

function moveObject(o, x, y) {
  if (o.type === 'scrum') moveScrum(phase(), o, x, y);
  else if (o.type === 'lineout' && o.pack) moveLineout(phase(), o, x);
  else Object.assign(o, { x, y });
}

function deleteSelected() {
  const sel = ui.selected;
  if (!sel) return;
  const ph = phase();
  if (sel.kind === 'player') {
    // A player is one person across the whole play, so they leave every phase.
    state.players = state.players.filter(p => p.id !== sel.id);
    for (const each of state.phases) {
      delete each.positions[sel.id];
      for (const o of each.objects) if (o.pack) o.pack = o.pack.filter(id => id !== sel.id);
      // Passers who lose a pass to this player may be down to one option.
      const passers = each.routes.filter(r => r.to === sel.id).map(r => r.from);
      each.routes = each.routes.filter(r => r.from !== sel.id && r.to !== sel.id);
      syncOptions(each.routes, passers);
    }
  } else if (sel.kind === 'route') {
    const route = ph.routes.find(r => r.id === sel.id);
    ph.routes = ph.routes.filter(r => r.id !== sel.id);
    // The remaining options close up their letters; a single one left is a normal route again.
    if (route) syncOptions(ph.routes, [route.from]);
  } else if (sel.kind === 'object') {
    ph.objects = ph.objects.filter(o => o.id !== sel.id);
  }
  ui.selected = null;
}

// A small text box over the pitch, just above (or below, near the top) a point on screen. Enter or clicking
// away saves, Escape cancels. Opening another first saves the one already open.
let finishInline = null;
function inlineEdit({ at, gap, value, maxLength, numeric = false, label, onSave }) {
  finishInline?.(true);
  const input = $('inline-edit');
  const wrap = input.parentElement.getBoundingClientRect();
  Object.assign(input, { value, maxLength, inputMode: numeric ? 'numeric' : 'text' });
  input.setAttribute('aria-label', label);
  input.classList.toggle('numeric', numeric);
  input.hidden = false;
  const { offsetWidth: w, offsetHeight: h } = input;
  let top = at.y - wrap.top - gap - h;
  if (top < 4) top = at.y - wrap.top + gap;
  input.style.left = `${Math.min(Math.max(4, at.x - wrap.left - w / 2), wrap.width - w - 4)}px`;
  input.style.top = `${top}px`;
  input.focus();
  input.select();
  let done = false;
  const finish = save => {
    if (done) return;
    done = true;
    finishInline = null;
    input.removeEventListener('keydown', onKey);
    input.removeEventListener('blur', onBlur);
    input.hidden = true;
    if (save) onSave(input.value);
  };
  const onKey = e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  const onBlur = () => finish(true);
  input.addEventListener('keydown', onKey);
  input.addEventListener('blur', onBlur);
  finishInline = finish;
}

// Pitch metres -> client px.
function screenPoint(x, y) {
  const p = new DOMPoint(x, y).matrixTransform(world.getScreenCTM());
  return { x: p.x, y: p.y };
}

function editLabel(id) {
  const pos = phase().positions[id];
  const player = state.players.find(p => p.id === id);
  if (!player || !pos) return;
  inlineEdit({
    at: screenPoint(pos.x, pos.y),
    gap: PLAYER_R * pxPerMetre() + 6,
    value: player.label,
    maxLength: 3,
    label: 'Player label (number or position, e.g. 10 or FH)',
    onSave: value => {
      const p = state.players.find(q => q.id === id); // the play may have been replaced meanwhile
      const trimmed = value.trim().slice(0, 3);
      if (p && trimmed && trimmed !== p.label) { p.label = trimmed; render(); }
    },
  });
}

function editOrder(id) {
  const route = phase().routes.find(r => r.id === id);
  if (!route) return;
  if (route.option) {
    editOption(route);
    return;
  }
  // A route from an older play may have no order, and so no badge: it gets the next number first.
  if (!Number.isFinite(route.order)) {
    route.order = nextOrder(phase().routes);
    render();
  }
  const badge = layers.badges.querySelector(`.badge[data-id="${id}"]`)?.getBoundingClientRect();
  if (!badge) return;
  inlineEdit({
    at: { x: badge.x + badge.width / 2, y: badge.y + badge.height / 2 },
    gap: badge.height / 2 + 6,
    value: String(route.order ?? ''),
    maxLength: 2,
    numeric: true,
    label: 'Route order number (1-99)',
    onSave: value => {
      const r = phase().routes.find(q => q.id === id);
      const n = Number(value.trim());
      if (r && Number.isInteger(n) && n >= 1 && n <= 99 && n !== r.order) { r.order = n; render(); }
    },
  });
}

// In-app confirm, so the page never opens a native dialog. Resolves true for OK.
function askConfirm(message, ok = 'OK') {
  const dialog = $('confirm-dialog');
  $('confirm-message').textContent = message;
  $('confirm-ok').textContent = ok;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }));
}

// "Add attack" / "Add defender": the numbers not yet used, the next free one highlighted (Enter adds it).
// On a computer it opens beside its button; on a phone in the middle of the screen.
function openNumberPicker(team, button) {
  const dialog = $('number-dialog');
  const free = freeNumbers(team);
  if (!free.length) return;
  dialog.dataset.team = team;
  $('number-title').textContent = team === 'attack' ? 'Add attacker' : 'Add defender';
  const grid = $('number-grid');
  grid.className = `number-grid ${team}`;
  grid.replaceChildren(...Array.from({ length: MAX_PER_TEAM }, (_, i) => {
    const n = i + 1;
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.n = n;
    b.textContent = n;
    b.disabled = !free.includes(n);
    if (n === free[0]) b.classList.add('next');
    b.setAttribute('aria-label', `Number ${n}${b.disabled ? ' (in use)' : ''}`);
    return b;
  }));
  dialog.style.cssText = '';
  dialog.returnValue = '';
  dialog.showModal();
  if (!phoneLayout.matches) {
    const r = button.getBoundingClientRect();
    const top = Math.min(r.top, innerHeight - dialog.offsetHeight - 8);
    dialog.style.cssText = `margin: 0; inset: auto; left: ${r.right + 8}px; top: ${Math.max(8, top)}px;`;
  }
  grid.querySelector('.next').focus();
}

function initNumberPicker() {
  const dialog = $('number-dialog');
  $('number-grid').addEventListener('click', e => {
    const b = e.target.closest('[data-n]');
    if (!b || b.disabled) return;
    dialog.close();
    addPlayer(dialog.dataset.team, Number(b.dataset.n));
    ui.tool = null;
    render();
  });
  // A click outside the box closes it.
  dialog.addEventListener('click', e => {
    const r = dialog.getBoundingClientRect();
    if (e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dialog.close();
  });
}

// "Option A: Pass to 12", "Option B: Kick", "Option C: Pass" (a pass with a loose end).
function optionTitle(route) {
  const receiver = route.to && state.players.find(p => p.id === route.to);
  const what = ROUTE_TYPES[route.type]?.label ?? 'Route';
  return `Option ${route.option}: ${what}${receiver ? ` to ${receiver.label}` : ''}`;
}

// An option's badge opens a box for its order number (shared by all its options), its label, and
// "Make this the main option". Saving is one undo step. While it is open the route is highlighted (the
// others fade) and, on a computer, the box sits on the side of the pitch away from it.
// focus: 'label' or 'order', the field to start in.
function editOption(route, focus = 'order') {
  const dialog = $('option-dialog');
  dialog.dataset.route = route.id;
  $('option-title').textContent = optionTitle(route);
  $('option-order').value = route.order ?? '';
  $('option-label').value = route.optionLabel ?? '';
  $('option-main').hidden = route.option === 'A';
  dialog.returnValue = '';
  ui.optionFocus = route.id;
  render();
  dialog.style.cssText = '';
  dialog.showModal();
  if (!phoneLayout.matches) placeAwayFromRoute(dialog, route.id);
  const field = $(focus === 'label' ? 'option-label' : 'option-order');
  field.focus();
  field.select();
}

// Puts a dialog beside the pitch's left or right edge, whichever is further from the route on screen.
function placeAwayFromRoute(dialog, id) {
  const line = document.querySelector(`#ball-routes-layer [data-id="${id}"], #routes-layer [data-id="${id}"]`);
  if (!line) return;
  const r = line.getBoundingClientRect();
  const pitch = svg.getBoundingClientRect();
  const w = dialog.offsetWidth;
  const h = dialog.offsetHeight;
  const routeMid = r.left + r.width / 2;
  const left = routeMid > pitch.left + pitch.width / 2 ? Math.max(8, pitch.left + 12) : Math.min(innerWidth - w - 8, pitch.right - w - 12);
  // If that still covers the route (a long one), go above or below it instead.
  let top = Math.max(8, pitch.top + (pitch.height - h) / 2);
  if (left < r.right && left + w > r.left && top < r.bottom && top + h > r.top) {
    top = r.top - h - 12 >= 8 ? r.top - h - 12 : Math.min(innerHeight - h - 8, r.bottom + 12);
  }
  dialog.style.cssText = `margin: 0; inset: auto; left: ${left}px; top: ${top}px;`;
}

function initOptionDialog() {
  const dialog = $('option-dialog');
  $('option-label').maxLength = OPTION_LABEL_MAX;
  dialog.addEventListener('close', () => {
    ui.optionFocus = null;
    const route = phase().routes.find(r => r.id === dialog.dataset.route);
    const action = dialog.returnValue;
    if (route && action) {
      const n = Number($('option-order').value);
      if (Number.isInteger(n) && n >= 1 && n <= 99) for (const r of optionGroup(phase().routes, route.from)) r.order = n;
      const label = $('option-label').value.trim().slice(0, OPTION_LABEL_MAX);
      if (label) route.optionLabel = label;
      else delete route.optionLabel;
      if (action === 'main') makeMainOption(phase().routes, route);
    }
    render();
  });
}

// The bar of actions beside a selected route (when no route tool is on): Label and Make main for options,
// Order and Delete for any route. It sits above the route (or below, or beside it, if there's no room),
// clear of the route's handles and their touch areas.
function updateRouteBar() {
  const bar = $('route-bar');
  const sel = ui.selected;
  const route = sel?.kind === 'route' && !ui.tool && !ui.dragging && !ui.optionFocus ? phase().routes.find(r => r.id === sel.id) : null;
  bar.hidden = !route;
  if (!route) return;
  bar.dataset.id = route.id;
  bar.querySelector('[data-route-action="label"]').hidden = !route.option;
  bar.querySelector('[data-route-action="main"]').hidden = !route.option || route.option === 'A';

  const wrap = bar.parentElement.getBoundingClientRect();
  const handles = [...layers.handles.querySelectorAll('.handle-hit')].map(h => h.getBoundingClientRect());
  const hit = layers.routes.querySelector(`[data-id="${route.id}"] .route-hit`)?.getBoundingClientRect();
  const boxes = hit ? [hit, ...handles] : handles;
  if (!boxes.length) { bar.hidden = true; return; }
  // The line's own touch area reaches half its width beyond the line.
  const pad = Math.max(1.6 * pxPerMetre(), LINE_HIT_PX) / 2;
  const box = {
    left: Math.min(...boxes.map(b => b.left)) - pad, right: Math.max(...boxes.map(b => b.right)) + pad,
    top: Math.min(...boxes.map(b => b.top)) - pad, bottom: Math.max(...boxes.map(b => b.bottom)) + pad,
  };
  const { offsetWidth: w, offsetHeight: h } = bar;
  const gap = 6;
  const minX = wrap.left + 4;
  const maxX = wrap.right - w - 4;
  const clampX = x => Math.min(Math.max(minX, x), maxX);
  const midX = clampX((box.left + box.right - w) / 2);
  let at;
  if (box.top - gap - h >= wrap.top + 4) at = { x: midX, y: box.top - gap - h };
  else if (box.bottom + gap + h <= wrap.bottom - 4) at = { x: midX, y: box.bottom + gap };
  else {
    const y = Math.min(Math.max(wrap.top + 4, (box.top + box.bottom - h) / 2), wrap.bottom - h - 4);
    at = { x: box.right + gap <= maxX ? box.right + gap : clampX(box.left - gap - w), y };
  }
  bar.style.left = `${at.x - wrap.left}px`;
  bar.style.top = `${at.y - wrap.top}px`;
}

function initRouteBar() {
  $('route-bar').addEventListener('click', e => {
    const b = e.target.closest('[data-route-action]');
    const route = phase().routes.find(r => r.id === $('route-bar').dataset.id);
    if (!b || !route) return;
    const action = b.dataset.routeAction;
    if (action === 'label') editOption(route, 'label');
    else if (action === 'order') editOrder(route.id);
    else if (action === 'main') { makeMainOption(phase().routes, route); render(); }
    else if (action === 'delete') { deleteSelected(); render(); }
  });
}

// Turning the pitch is a view choice, not an edit: it changes every undo and redo snapshot too (rebase), so
// it adds no undo step, keeps redo, and undo never turns the pitch back.
const ORIENTATION_JSON = /"orientation":"(horizontal|vertical)"/;
function setOrientation(orientation) {
  if (state.orientation === orientation) return;
  state.orientation = orientation;
  history.rebase(json => json.replace(ORIENTATION_JSON, `"orientation":"${orientation}"`));
  render();
}

function goToPhase(i) {
  if (i < 0 || i >= state.phases.length || i === ui.phase) return;
  ui.phase = i;
  ui.tool = null;
}

// Phase bar actions. Each returns after changing state; the caller re-renders, which records one undo step.
function phaseAction(action, index) {
  const i = ui.phase;
  const phases = state.phases;
  if (action === 'prev') goToPhase(i - 1);
  else if (action === 'next') goToPhase(i + 1);
  else if (action === 'goto') goToPhase(index);
  else if (action === 'add' || action === 'insert') {
    ui.phase = action === 'add' ? appendPhase(phases, state.players) : insertPhaseAfter(phases, i, state.players);
    ui.tool = null;
  } else if (action === 'left' || action === 'right') {
    ui.phase = movePhase(phases, i, action === 'left' ? i - 1 : i + 1);
  } else if (action === 'delete') {
    if (phases.length === 1) return;
    askConfirm(`Delete phase ${i + 1}? You can undo this.`, 'Delete phase').then(ok => {
      if (!ok || state.phases !== phases) return;
      phases.splice(i, 1);
      ui.phase = Math.min(i, phases.length - 1);
      render();
    });
  }
}

async function fileAction(action) {
  $('file-menu').open = false;
  if (busy()) return;
  if (action === 'about') {
    openAbout();
  } else if (action === 'save') {
    downloadPlay(state);
    showToast(`Saved ${safeFileName(state.name)}`, 'ok');
  } else if (action === 'png') {
    $('image-dialog').showModal();
  } else if (action === 'pdf') {
    savePdf();
  } else if (action === 'load') {
    $('load-input').click();
  } else if (action === 'new') {
    if (!(await askConfirm('Start a new blank play? The current one is replaced (you can undo).', 'New play'))) return;
    replacePlay(blankPlay({ view: state.view, orientation: state.orientation }));
    render();
  }
}

async function loadFromInput(input) {
  const file = input.files?.[0];
  input.value = ''; // so picking the same file again still fires "change"
  if (!file) return;
  let play;
  try {
    play = await readPlayFile(file);
  } catch (err) {
    showToast(err.message);
    return;
  }
  if (!(await askConfirm(`Load "${play.name}"? It replaces the current play (you can undo).`, 'Load'))) return;
  replacePlay(play);
  render();
}

// --- Export ---

const legendItems = () => Object.entries(ROUTE_TYPES).map(([type, st]) => [type, st.label]);

// Every export works from a copy of the play taken when it starts, and editing is locked until the picture is
// made, so nothing changed meanwhile (another tab's play, say) can end up half in it. make(play) returns
// the File; it's then handed to the user. A second export while one is running is ignored.
async function exportFile(make) {
  if (ui.exporting) return;
  ui.exporting = true;
  finishInline?.(true);
  render(null, { record: false });
  let file = null;
  try {
    file = await make(structuredClone(state));
  } catch (err) {
    showToast(err.message);
  } finally {
    ui.exporting = false;
    render(null, { record: false });
  }
  if (file) keepFile(file);
}

// Draws with `play` in place of the live play, then puts the live play back. Synchronous, so nothing else
// can run in between.
function withPlay(play, draw) {
  const live = { ...state };
  const swap = from => { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, from); };
  swap(play);
  try {
    return draw();
  } finally {
    swap(live);
  }
}

// Phase i of `play` as a standalone picture, in the current view, orientation and layers, except that the
// previous-phase ghost is always left out, and so are selection highlights and handles (nothing is
// selected while it is drawn). `legend: false` leaves the route key off even if its layer is on.
// Redraws the shown phase afterwards.
function phasePicture(play, i, { width, height, scale, css, idPrefix, legend = true, print = false }) {
  const keep = { phase: ui.phase, selected: ui.selected, snap: ui.snap, snapTo: ui.snapTo, preview: ui.preview, layers: ui.layers };
  Object.assign(ui, { phase: i, selected: null, snap: null, snapTo: null, preview: null, layers: { ...ui.layers, ghost: false } });
  let picture;
  try {
    picture = withPlay(play, () => {
      drawScene();
      const legendOn = legend && ui.layers.legend ? { items: legendItems(), sample: routeSample } : null;
      return pictureSvg(svg, { width, height, scale, css, legend: legendOn, idPrefix, print });
    });
  } finally {
    Object.assign(ui, keep);
    drawScene();
    playback.afterRender(); // a paused animation frame stays on screen
  }
  return picture;
}

// The shown phase as a PNG at twice its on-screen size, with the route key under the pitch.
function savePng() {
  const i = ui.phase;
  const { width, height } = svg.getBoundingClientRect();
  return exportFile(async play => {
    const blob = await svgToPng(phasePicture(play, i, { width, height, scale: 2, css: pageCss() }));
    return new File([blob], safeFileName(play.name, `-phase-${i + 1}.png`), { type: 'image/png' });
  });
}

// Every phase on one PNG: a grid of tiles, each "Phase n" over the pitch with its note under it, the play
// name at the top, and one route key under the grid (if the Legend layer is on). Tiles are drawn as the
// single PNG is, so there's no ghost and nothing selected.
function saveAllPng() {
  const [, , vbW, vbH] = svg.getAttribute('viewBox').split(' ').map(Number);
  return exportFile(async play => {
    const tileW = SHEET_TILE_W[play.orientation];
    const tileH = Math.round(tileW * vbH / vbW);
    const css = pageCss();
    const tiles = play.phases.map((ph, i) => ({
      picture: phasePicture(play, i, { width: tileW, height: tileH, scale: 1, css: '', legend: false, idPrefix: `p${i + 1}-` }),
      label: `Phase ${i + 1}`,
      note: ph.note.trim(),
    }));
    const sheet = allPhasesSvg({
      title: play.name.trim() || 'Untitled play',
      tiles,
      tileW,
      tileH,
      cols: Math.min(SHEET_COLS[play.orientation], tiles.length),
      css,
      legend: ui.layers.legend ? { items: legendItems(), sample: routeSample } : null,
    });
    const blob = await svgToPng(sheet);
    return new File([blob], safeFileName(play.name, '-all-phases.png'), { type: 'image/png' });
  });
}

// Every phase as a PDF, one page each: a header line with the play name and its category and tags, the
// pitch picture (as in the PNG, but with darker lines for black and white printing) as large as fits, then
// "Phase n of N" with the route key beside it, and the phase's note. Horizontal plays get landscape pages,
// vertical ones portrait. jsPDF is only loaded the first time this runs.
function savePdf() {
  const [, , vbW, vbH] = svg.getAttribute('viewBox').split(' ').map(Number);
  if (!ui.exporting) showToast('Making the PDF…', 'ok');
  return exportFile(async play => {
    const orientation = play.orientation === 'vertical' ? 'portrait' : 'landscape';
    const n = play.phases.length;
    const css = pageCss();
    const title = play.name.trim() || 'Untitled play';
    const meta = [CATEGORY_LABELS[play.category] ?? play.category, play.tags.join(', ')].filter(Boolean).join(' · ');
    // The route key sits right of the phase line under the pitch, in as many columns as fit beside it.
    let size = pageFit(orientation, vbW / vbH);
    let legend = null;
    if (ui.layers.legend) {
      const items = { items: legendItems(), sample: routeSample };
      const fit = mm => legendSvg(items, { maxW: (mm - 45) * PX_PER_MM, scale: 3, css, defs: $('defs') });
      let key = fit(size.w);
      size = pageFit(orientation, vbW / vbH, key.h / PX_PER_MM);
      if (key.w / PX_PER_MM > size.w - 45) key = fit(size.w);
      legend = { png: await svgToPng(key.svg), w: key.w / PX_PER_MM, h: key.h / PX_PER_MM };
    }
    const pages = [];
    for (const [i, ph] of play.phases.entries()) {
      const picture = phasePicture(play, i, { width: size.px.w, height: size.px.h, scale: PDF_SCALE, css, legend: false, print: true });
      pages.push({ title, meta, caption: `Phase ${i + 1} of ${n}`, note: ph.note.trim(), png: await svgToPng(picture) });
    }
    const blob = await makePdf(pages, orientation, size, legend);
    return new File([blob], safeFileName(play.name, '.pdf'), { type: 'application/pdf' });
  });
}

// Hands a made file to the user. Computers download it. Phones and tablets get the share sheet (Save
// Image or Save to Files on iPhone); if sharing isn't possible there, the file opens in a dialog to save from.
async function keepFile(file) {
  if (!touchScreen.matches) {
    downloadBlob(file, file.name);
    showToast(`Saved ${file.name}`, 'ok');
    return;
  }
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      showToast(`Saved ${file.name}`, 'ok');
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // the user closed the share sheet
    }
  }
  showFile(file);
}

// Fallback for phones that can't share the file straight away: the file, with ways to keep it.
function showFile(file) {
  const dialog = $('save-dialog');
  const isImage = file.type.startsWith('image/');
  const url = URL.createObjectURL(file);
  $('save-title').textContent = isImage ? 'Save image' : 'Save PDF';
  $('save-tip').textContent = isImage
    ? 'Press and hold the picture to save it, or open it in a new tab.'
    : 'Open the PDF in a new tab, then use Share to save it to Files.';
  const preview = $('save-preview');
  preview.hidden = !isImage;
  if (isImage) preview.src = url; else preview.removeAttribute('src');
  $('save-open').href = url;
  const share = $('save-share');
  share.hidden = !navigator.canShare?.({ files: [file] });
  share.onclick = () => navigator.share({ files: [file] }).catch(() => {});
  dialog.addEventListener('close', () => URL.revokeObjectURL(url), { once: true });
  dialog.showModal();
}

// Undo and redo do nothing mid-drag, while playing, presenting or exporting.
function undo() {
  if (ui.dragging || locked()) return;
  document.activeElement?.blur?.(); // so the text boxes show the restored values
  if (history.undo()) render();
}

function redo() {
  if (ui.dragging || locked()) return;
  document.activeElement?.blur?.();
  if (history.redo()) render();
}

// --- Setup ---

function buildArrowMarkers(defs) {
  for (const [type, st] of Object.entries(ROUTE_TYPES)) {
    const size = Math.max(1.4, st.width * 4);
    const marker = svgEl('marker', {
      id: `arrow-${type}`,
      viewBox: '0 0 10 10',
      refX: 7,
      refY: 5,
      markerWidth: size,
      markerHeight: size,
      markerUnits: 'userSpaceOnUse',
      orient: 'auto',
    }, defs);
    svgEl('path', { d: 'M0 0L10 5L0 10z', fill: st.color, class: 'arrowhead' }, marker);
  }
}

// Small sample line for a route type (used on the buttons and in the legend).
function routeSample(type) {
  const s = svgEl('svg', { viewBox: '0 -1 8 2', class: 'route-sample', 'aria-hidden': 'true' });
  routePaths(s, 'line', { x1: 0.4, y1: 0, x2: 6.6, y2: 0 }, type);
  return s;
}

function buildRouteTools() {
  const group = $('route-tools');
  for (const [type, st] of Object.entries(ROUTE_TYPES)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.route = type;
    btn.title = `Draw ${st.label.toLowerCase()} route: press and drag on the pitch`;
    btn.append(routeSample(type), st.label);
    group.appendChild(btn);

    const name = document.createElement('span');
    name.textContent = st.label;
    legend.append(routeSample(type), name);
  }
}

function initTopbar() {
  inputs.name.addEventListener('input', () => { state.name = inputs.name.value; render('name'); });
  inputs.category.addEventListener('change', () => { state.category = inputs.category.value; render(); });
  inputs.tags.addEventListener('input', () => {
    state.tags = inputs.tags.value.split(',').map(t => t.trim()).filter(Boolean);
    render('tags');
  });
  inputs.note.addEventListener('input', () => { phase().note = inputs.note.value; fitNote(); render(`note-${ui.phase}`); });
  addEventListener('resize', fitNote);
  // Clicking the name or its pencil selects the whole name, so typing replaces it. A press on the box
  // itself would otherwise put the cursor where it landed, so the first press focuses it by hand; once it
  // has the focus, clicks place the cursor as usual.
  inputs.name.addEventListener('focus', () => inputs.name.select());
  inputs.name.addEventListener('mousedown', e => {
    if (document.activeElement === inputs.name) return;
    e.preventDefault();
    inputs.name.focus();
  });

  document.querySelector('[data-action="undo"]').addEventListener('click', undo);
  document.querySelector('[data-action="redo"]').addEventListener('click', redo);
  for (const b of document.querySelectorAll('[data-file]')) b.addEventListener('click', () => fileAction(b.dataset.file));
  $('load-input').addEventListener('change', e => loadFromInput(e.target));

  for (const b of document.querySelectorAll('[data-view]')) {
    b.addEventListener('click', () => { state.view = b.dataset.view; render(); });
  }
  for (const b of document.querySelectorAll('[data-orientation]')) {
    b.addEventListener('click', () => { ui.orientationChosen = true; setOrientation(b.dataset.orientation); });
  }
  portraitPhone.addEventListener('change', e => {
    if (!ui.orientationChosen) setOrientation(e.matches ? 'vertical' : 'horizontal');
  });

  $('layers').addEventListener('change', e => {
    const key = e.target.dataset.layer;
    if (key) { ui.layers[key] = e.target.checked; render(null, { record: false }); }
  });
  // Close the drop-down menus when tapping anywhere else.
  const menus = [...document.querySelectorAll('details.menu')];
  document.addEventListener('pointerdown', e => {
    for (const m of menus) if (m.open && !m.contains(e.target)) m.open = false;
  });
  // Only one menu open at a time.
  for (const m of menus) m.addEventListener('toggle', () => { if (m.open) for (const o of menus) if (o !== m) o.open = false; });
}

function initPhaseBar() {
  document.querySelector('.phasebar').addEventListener('click', e => {
    const b = e.target.closest('[data-phase]');
    // Nothing changes phase in the middle of a drag (a second finger, or a key).
    if (!b || b.disabled || ui.dragging) return;
    const action = b.dataset.phase;
    // Moving between phases also works while playing (it carries on from that phase).
    if (action === 'prev' || action === 'next') { step(action === 'prev' ? -1 : 1); return; }
    if (action === 'goto') { playback.jump(Number(b.dataset.index)); return; }
    if (busy()) return;
    phaseAction(action, Number(b.dataset.index));
    render();
  });
}

function initSetPieceDialog() {
  const dialog = $('set-piece-dialog');
  dialog.addEventListener('close', () => {
    const [kind, team] = dialog.returnValue.split('-');
    if (kind === 'scrum') { addScrum(team); render(); }
    else if (kind === 'lineout') { addLineout(team); render(); }
  });
  return () => { dialog.returnValue = ''; dialog.showModal(); };
}

// Save image: this phase or all phases. The buttons save straight from their click, so a phone's share
// sheet still counts it as the user's tap.
function initImageDialog() {
  const dialog = $('image-dialog');
  for (const b of dialog.querySelectorAll('[data-image]')) {
    b.addEventListener('click', () => {
      dialog.close();
      if (b.dataset.image === 'all') saveAllPng();
      else savePng();
    });
  }
}

// Templates picker: a card per template with a thumbnail drawn from its data. Picking one starts a new play
// from it (asking first unless the current play is empty), as one undo step. The template's view is kept,
// but it takes the current orientation, which is a choice about the screen rather than the play.
function initTemplatesDialog() {
  const dialog = $('templates-dialog');
  const grid = $('template-grid');
  const status = $('templates-status');
  let templates = [];

  $('templates-button').addEventListener('click', async () => {
    grid.replaceChildren();
    status.hidden = false;
    status.textContent = 'Loading templates…';
    dialog.showModal();
    try {
      templates = await loadTemplates();
    } catch (err) {
      status.textContent = err.message;
      return;
    }
    status.hidden = true;
    grid.replaceChildren(...templates.map((t, i) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'template-card';
      card.dataset.template = i;
      const name = document.createElement('span');
      name.textContent = t.name;
      card.append(thumbnail(t.play, state.orientation), name);
      return card;
    }));
  });

  grid.addEventListener('click', async e => {
    const card = e.target.closest('[data-template]');
    if (!card) return;
    const t = templates[Number(card.dataset.template)];
    dialog.close();
    if (!isEmptyPlay(state) && !(await askConfirm(`Start a new play from the "${t.name}" template? The current one is replaced (you can undo).`, 'Use template'))) return;
    replacePlay({ ...t.play, orientation: state.orientation });
    render();
  });
}

// About: what the app is, with a finished example to try. It never opens by itself, and opening or closing
// it changes nothing in the play, so there's no undo step or autosave. Escape, Close or a click outside
// closes it. "Try an example" loads templates/example.json like a template (asking first unless the
// current play is empty, one undo step) and plays it once from phase 1 at 1x.
function openAbout() {
  const dialog = $('about-dialog');
  $('about-example').disabled = busy();
  dialog.returnValue = '';
  dialog.showModal();
}

function initAboutDialog() {
  const dialog = $('about-dialog');
  $('about-button').addEventListener('click', openAbout);
  dialog.addEventListener('click', e => {
    const r = dialog.getBoundingClientRect();
    if (e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dialog.close();
  });
  $('about-example').addEventListener('click', async () => {
    let play;
    try {
      play = await loadExample();
    } catch (err) {
      dialog.close();
      showToast(err.message);
      return;
    }
    dialog.close();
    if (!isEmptyPlay(state) && !(await askConfirm(`Open the example "${play.name}"? It replaces the current play (you can undo).`, 'Open example'))) return;
    if (busy()) return;
    replacePlay({ ...play, orientation: state.orientation });
    render();
    playback.speed = 1;
    playback.setLoop(false);
    playback.play();
  });
}

// "? Tips" at the top of the sidebar opens a small popup beside it (a popover, so clicking away or
// Escape closes it). It floats over the page and never moves the toolbar.
function initTips() {
  const tips = $('tips');
  tips.addEventListener('beforetoggle', e => {
    if (e.newState !== 'open') return;
    const b = $('help').getBoundingClientRect();
    tips.style.left = `${b.right + 8}px`;
    tips.style.top = `${b.top}px`;
  });
}

function initKeys() {
  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    const typing = e.target.closest('input, textarea, select, dialog');
    // Undo/redo. In a text box the browser's own text undo handles it.
    if (mod && !typing && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
      e.preventDefault();
      if (e.key === 'y' || e.shiftKey) redo();
      else undo();
      return;
    }
    if (typing || mod || e.altKey) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!ui.selected || locked()) return;
      e.preventDefault();
      deleteSelected();
      render();
    } else if (e.key === 'Escape') {
      if (ui.presenting) present.exit();
      else if (playback.playing) playback.pause();
      else {
        ui.selected = null;
        ui.tool = null;
        render();
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (ui.dragging) return;
      e.preventDefault();
      step(e.key === 'ArrowLeft' ? -1 : 1);
    } else if (e.key === ' ') {
      if (ui.dragging) return;
      e.preventDefault();
      // A focused button would also be clicked by the space bar.
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
      playback.toggle();
    } else if (ui.presenting && (e.key === 'p' || e.key === 'P')) {
      present.togglePen();
    } else if (ui.presenting && (e.key === 'c' || e.key === 'C')) {
      present.clearPen();
    }
  });
}

// Back or forward one phase (Prev/Next, the arrow keys, the step buttons). While playing, playing
// carries on from there.
function step(delta) {
  playback.jump(ui.phase + delta);
}

// Play/Pause, step, speed, Loop, and in Present mode the pen and Exit.
function initPlayControls() {
  $('play-controls').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const action = b.dataset.play;
    if (b.dataset.speed) { playback.speed = Number(b.dataset.speed); updatePlayControls(); }
    else if (b.dataset.option) playback.playOption(b.dataset.option);
    else if (action === 'toggle') playback.toggle();
    else if (action === 'first') playback.jump(0);
    else if (action === 'back') step(-1);
    else if (action === 'forward') step(1);
    else if (action === 'loop') playback.setLoop(!playback.loop);
    else if (action === 'pen') present.togglePen();
    else if (action === 'clear') present.clearPen();
    else if (action === 'exit') present.exit();
    // Space and the arrow keys go to the play, not to the button that was clicked last.
    b.blur();
  });
  $('present-button').addEventListener('click', () => present.enter());
  addEventListener('hashchange', () => {
    const i = hashPhase();
    if (i != null && i !== ui.phase) playback.jump(i);
  });
}

// Another tab saved its play (the autosave is shared by every tab of this site). If it differs from this
// one, ask which to keep: "Use theirs" loads it (one undo step), "Keep mine" saves this one again. Until
// then nothing is autosaved here. Moving between phases or turning the pitch there isn't a change.
function initTabs() {
  const dialog = $('tab-dialog');
  const sameAsMine = raw => {
    try {
      const other = JSON.parse(raw)?.play;
      return JSON.stringify({ ...other, orientation: null }) === JSON.stringify({ ...state, orientation: null });
    } catch {
      return false;
    }
  };
  addEventListener('storage', e => {
    if (e.key !== AUTOSAVE_KEY || e.newValue == null) return;
    if (theirs == null && sameAsMine(e.newValue)) return;
    theirs = e.newValue;
    clearTimeout(autosaveTimer);
    if (playback.playing) playback.pause();
    if (!dialog.open) {
      finishInline?.(false);
      dialog.returnValue = '';
      dialog.showModal();
    }
  });
  dialog.addEventListener('close', () => {
    const raw = theirs;
    theirs = null;
    if (dialog.returnValue === 'theirs') {
      try {
        const saved = parseAutosave(raw);
        replacePlay({ ...saved.play, orientation: state.orientation }, saved.phase);
        lastSaved = raw;
        render();
        return;
      } catch {
        showToast("The other tab's play couldn't be opened. Yours is kept.");
      }
    }
    lastSaved = null; // save again even if nothing changed here, so this play is the one kept
    flushAutosave();
  });
}

function init() {
  // Bring back the last play from this browser, if there is one. If it can't be opened (or drawn), it's kept
  // under a backup key and a blank play starts instead.
  const raw = readAutosave();
  let restored = false;
  let broken = false;
  if (raw) {
    try {
      const saved = parseAutosave(raw);
      replacePlay(saved.play, saved.phase);
      restored = true;
    } catch {
      broken = true;
    }
  }
  // A link to a phase (#phase=3) opens on it.
  ui.phase = hashPhase() ?? ui.phase;
  history.reset();

  buildArrowMarkers($('defs'));
  buildRouteTools();
  initTopbar();
  initPhaseBar();
  initKeys();
  initImageDialog();
  initOptionDialog();
  initNumberPicker();
  initTips();
  initRouteBar();
  initTemplatesDialog();
  initAboutDialog();
  initPlayControls();
  initTabs();
  const openSetPiece = initSetPieceDialog();

  document.querySelector('.toolbar').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const { action, object, route } = b.dataset;
    if (action === 'add-attack') openNumberPicker('attack', b);
    else if (action === 'add-defense') openNumberPicker('defense', b);
    else if (action === 'set-piece') openSetPiece();
    else if (action === 'delete') deleteSelected();
    else if (object) { addObject(object); ui.tool = null; }
    else if (route) ui.tool = ui.tool === route ? null : route;
    render();
  });

  // Save straight away when the page is hidden or closed, rather than waiting for the timer.
  addEventListener('pagehide', flushAutosave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushAutosave(); });

  // No editing while playing, presenting or exporting. A press on the pitch drops a paused frame.
  initEditor(svg, world, {
    state, ui, phase, render, renderSoon, hint: renderHint, editLabel, editOrder, moveObject, locked,
    pressed: () => playback.dropFrame(),
  });

  if (!broken) {
    try {
      render();
    } catch (err) {
      if (!restored) throw err;
      broken = true;
    }
  }
  if (broken) {
    backupAutosave(raw);
    replacePlay(blankPlay({ orientation: state.orientation }));
    history.reset();
    pitchKey = '';
    render();
    showToast("Your last play couldn't be opened. A backup was kept.");
  }
}

init();
