// App state, toolbar wiring and redraw. The editor changes state, then render() redraws the SVG from it.
// render() is also where changes are recorded: it commits an undo step (unless a drag is in progress)
// and schedules the autosave, so every change to the play is undoable and saved without extra wiring.

import { drawPitch, setView, viewCentre, startSpot, svgEl, uprightTurn, PLAYER_R } from './pitch.js';
import { initEditor, routeGeometry, nextId, isAttached } from './editor.js';
import { placeScrum, moveScrum } from './setpiece.js';
import { appendPhase, insertPhaseAfter, movePhase } from './phases.js';
import { createHistory } from './history.js';
import { blankPlay, loadAutosave, saveAutosave, downloadPlay, downloadBlob, readPlayFile, safeFileName } from './storage.js';
import { pictureSvg, pageCss, svgToPng, pageFit, makePdf } from './export.js';

const MAX_PER_TEAM = 15;
const BADGE_R = 0.9;
// A pass attached to a receiver stops this far from their centre, so its arrowhead touches their disc.
const PASS_END_GAP = PLAYER_R + 0.2;
// PDF pages: the pitch picture is drawn at this many times its size in CSS px on the page (about 190 dpi).
const PDF_SCALE = 2;
const AUTOSAVE_MS = 400;
// Smallest touch target for route handles and lines, in screen pixels (converted to metres at draw time).
const HANDLE_HIT_PX = 22;
const LINE_HIT_PX = 14;

// Look of each route type. Widths and dashes are in metres. No reds or blues: those are the team colours.
// Every route also gets a thin dark casing (see routePaths) so the light colours read on grass and on the white lines.
const ROUTE_TYPES = {
  run:   { label: 'Run',   color: '#ffe14d', width: 0.3 },
  pass:  { label: 'Pass',  color: '#ffffff', width: 0.25, dash: '1 0.7' },
  kick:  { label: 'Kick',  color: '#ffa033', width: 0.3,  dash: '0.01 0.6', cap: 'round' },
  decoy: { label: 'Decoy', color: '#b8b8b8', width: 0.2,  dash: '0.4 0.8' },
  drift: { label: 'Drift', color: '#cfa6ff', width: 0.3 },
  blitz: { label: 'Blitz', color: '#ff8fd0', width: 0.6 },
};

// A phone held upright gets the vertical pitch; anything else starts horizontal.
const portraitPhone = matchMedia('(max-width: 700px) and (orientation: portrait)');
// Phones and tablets: a saved picture goes to the share sheet rather than a download.
const touchScreen = matchMedia('(pointer: coarse)');

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
  layers: { distances: true, grid: false, legend: true, ghost: true },
  orientationChosen: false, // once the user picks one, stop following the phone's rotation
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
  badges: $('badges-layer'),
  handles: $('handles-layer'),
};
const inputs = { name: $('play-name'), category: $('play-category'), tags: $('play-tags'), note: $('phase-note') };

const phase = () => state.phases[ui.phase];
const isSelected = (kind, id) => ui.selected?.kind === kind && ui.selected.id === id;
const turn = () => uprightTurn(state.orientation);

function replacePlay(play, phaseIndex = 0) {
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, structuredClone(play));
  ui.phase = Math.min(Math.max(0, phaseIndex), state.phases.length - 1);
  ui.selected = null;
  ui.tool = null;
  inputsStale = true;
}

const history = createHistory({
  read: () => ({ play: JSON.stringify(state), phase: ui.phase }),
  write: (json, phaseIndex) => replacePlay(JSON.parse(json), phaseIndex),
});

let autosaveTimer = null;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(flushAutosave, AUTOSAVE_MS);
}
function flushAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  saveAutosave(state, ui.phase);
}

function showToast(message) {
  const toast = $('toast');
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

// `commitKey` groups typing in one text box into a single undo step.
function render(commitKey = null) {
  if (!ui.tool && !ui.dragging) ui.snap = null;
  if (!ui.dragging) ui.snapTo = null;
  drawScene();
  updateToolbar();
  updatePhaseBar();
  syncInputs();

  if (!ui.dragging) history.commit(commitKey);
  updateHistoryButtons();
  scheduleAutosave();
}

// Draws the pitch and the current phase (players, routes, markers) without touching anything else.
function drawScene() {
  // The pitch only changes with the view and layers, so it isn't redrawn on every drag.
  const key = [state.view, state.orientation, ui.layers.distances, ui.layers.grid].join();
  if (key !== pitchKey) {
    pitchKey = key;
    setView(svg, world, state.view, state.orientation);
    drawPitch(layers.pitch, { view: state.view, orientation: state.orientation, ...ui.layers });
  }
  if (ui.phase >= state.phases.length) ui.phase = state.phases.length - 1;
  dropMissingSelection();
  legend.classList.toggle('hidden', !ui.layers.legend);
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

// Badge sits beside the start of the route, just clear of a player disc, on the side the route doesn't bend to.
function badgePosition(r, geometry) {
  const [sx, sy] = r.points[0];
  const [ex, ey] = r.points[r.points.length - 1];
  let tx = geometry.control.x - sx;
  let ty = geometry.control.y - sy;
  if (Math.hypot(tx, ty) < 0.01) [tx, ty] = [ex - sx, ey - sy];
  const len = Math.hypot(tx, ty) || 1;
  [tx, ty] = [tx / len, ty / len];
  const side = r.curve > 0 ? -1 : 1;
  const out = r.from ? PLAYER_R + BADGE_R + 0.3 : BADGE_R + 0.4;
  return { x: sx + tx * 0.6 - ty * side * out, y: sy + ty * 0.6 + tx * side * out };
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
  for (const r of phase().routes) {
    const selected = isSelected('route', r.id);
    const cls = `route${selected ? ' selected' : ''}${isAttached(r) ? '' : ' loose'}`;
    const g = svgEl('g', { class: cls, 'data-kind': 'route', 'data-id': r.id }, layer);
    const geometry = routeGeometry(r);
    const { d } = drawnGeometry(r);
    if (selected) svgEl('path', { d, class: 'route-highlight', 'stroke-width': (ROUTE_TYPES[r.type]?.width ?? 0.3) + 0.9 }, g);
    svgEl('path', { d, class: 'route-hit', 'stroke-width': lineHit }, g);
    routePaths(g, 'path', { d }, r.type);

    // Badges go in their own layer above the players, so a nearby player can't cover them.
    if (Number.isFinite(r.order)) {
      const b = badgePosition(r, geometry);
      const badge = svgEl('g', { class: 'badge', 'data-kind': 'badge', 'data-id': r.id, transform: `translate(${b.x} ${b.y})${turn()}` }, layers.badges);
      svgEl('circle', { r: BADGE_R, stroke: ROUTE_TYPES[r.type]?.color ?? '#fff' }, badge);
      const text = String(r.order);
      svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': text.length > 1 ? 0.85 : 1.1 }, badge).textContent = text;
    }

    // While a route tool is active the handles are hidden, so pressing on a player always starts a new route.
    if (selected && !ui.tool) renderHandles(r, geometry, ppm);
  }
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

function renderPlayers() {
  const layer = layers.players;
  layer.replaceChildren();
  for (const p of state.players) {
    const pos = phase().positions[p.id];
    if (!pos) continue;
    const cls = `player ${p.team}${isSelected('player', p.id) ? ' selected' : ''}`;
    const g = svgEl('g', { class: cls, 'data-kind': 'player', 'data-id': p.id, transform: `translate(${pos.x} ${pos.y})${turn()}` }, layer);
    svgEl('circle', { r: PLAYER_R * 1.6, class: 'hit' }, g); // bigger touch target
    if (ui.snap === p.id || ui.snapTo === p.id) svgEl('circle', { r: PLAYER_R + 0.55, class: 'snap-ring' }, g);
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
function renderGhost() {
  const layer = layers.ghost;
  layer.replaceChildren();
  const prev = state.phases[ui.phase - 1];
  if (!ui.layers.ghost || !prev) return;
  const routes = svgEl('g', { class: 'ghost-routes' }, layer);
  for (const r of prev.routes) routePaths(routes, 'path', { d: drawnGeometry(r).d }, r.type);
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

// The scrum's "S" block shows only while the scrum or one of its players is selected.
function scrumActive(o) {
  const sel = ui.selected;
  return !!sel && ((sel.kind === 'object' && sel.id === o.id) || (sel.kind === 'player' && o.pack.includes(sel.id)));
}

function renderObjects() {
  const layer = layers.objects;
  layer.replaceChildren();
  for (const o of phase().objects) {
    const g = svgEl('g', { class: `marker ${o.type}`, 'data-kind': 'object', 'data-id': o.id, transform: `translate(${o.x} ${o.y})` }, layer);
    const selected = isSelected('object', o.id);

    if (o.type === 'scrum' && o.pack) {
      // Scrum preset: the mark between the front rows, and (when active) an "S" block clear of the
      // packs, which cover the mark, to drag the whole scrum by. The ball is its own object.
      svgEl('line', { x1: 0, y1: -3.8, x2: 0, y2: 3.8, class: 'scrum-mark' }, g);
      if (!scrumActive(o)) continue;
      const side = o.putIn === 'defense' ? 1 : -1; // the ball's side; the block goes on the other
      const tab = svgEl('g', { transform: `translate(0 ${-side * 6.5})`, class: 'scrum-tab' }, g);
      svgEl('circle', { r: 1.9, class: 'hit' }, tab);
      if (selected) svgEl('circle', { r: 1.9, class: 'select-ring' }, tab);
      svgEl('rect', { x: -1.2, y: -1.2, width: 2.4, height: 2.4, rx: 0.4, class: 'outline' }, tab);
      label(tab, 'S');
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
  document.querySelector('[data-action="add-attack"]').disabled = count('attack') >= MAX_PER_TEAM;
  document.querySelector('[data-action="add-defense"]').disabled = count('defense') >= MAX_PER_TEAM;
  document.querySelector('[data-action="delete"]').disabled = !ui.selected;
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', b.dataset.view === state.view);
  for (const b of document.querySelectorAll('[data-orientation]')) b.setAttribute('aria-pressed', b.dataset.orientation === state.orientation);
  for (const b of document.querySelectorAll('[data-route]')) b.setAttribute('aria-pressed', b.dataset.route === ui.tool);
  for (const c of document.querySelectorAll('[data-layer]')) c.checked = ui.layers[c.dataset.layer];
  svg.classList.toggle('drawing', !!ui.tool);
}

function updateHistoryButtons() {
  document.querySelector('[data-action="undo"]').disabled = !history.canUndo;
  document.querySelector('[data-action="redo"]').disabled = !history.canRedo;
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
  set(inputs.category, state.category, force);
  set(inputs.tags, state.tags.join(', '), force);
  set(inputs.note, phase().note, forceNote);
}

// --- Actions ---

function addPlayer(team) {
  const prefix = team === 'attack' ? 'a' : 'd';
  let n = 1;
  while (n <= MAX_PER_TEAM && state.players.some(p => p.id === prefix + n)) n++;
  if (n > MAX_PER_TEAM) return;
  const id = prefix + n;
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

function addScrum(putIn) {
  const scrum = placeScrum(state, phase(), viewCentre(state.view), putIn);
  ui.selected = { kind: 'object', id: scrum.id };
  ui.tool = null;
}

function moveObject(o, x, y) {
  if (o.type === 'scrum') moveScrum(phase(), o, x, y);
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
      each.routes = each.routes.filter(r => r.from !== sel.id && r.to !== sel.id);
    }
  } else if (sel.kind === 'route') {
    ph.routes = ph.routes.filter(r => r.id !== sel.id);
  } else if (sel.kind === 'object') {
    ph.objects = ph.objects.filter(o => o.id !== sel.id);
  }
  ui.selected = null;
}

function editLabel(id) {
  const player = state.players.find(p => p.id === id);
  if (!player) return;
  const value = prompt('Player label (number or position, e.g. 10 or FH)', player.label);
  if (value === null) return;
  const trimmed = value.trim().slice(0, 3);
  if (trimmed) player.label = trimmed;
  render();
}

function editOrder(id) {
  const route = phase().routes.find(r => r.id === id);
  if (!route) return;
  const value = prompt('Route order number (1-99)', route.order ?? '');
  if (value === null) return;
  const n = Number(value.trim());
  if (Number.isInteger(n) && n >= 1 && n <= 99) route.order = n;
  render();
}

function setOrientation(orientation) {
  state.orientation = orientation;
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
    if (!confirm(`Delete phase ${i + 1}? You can undo this.`)) return;
    phases.splice(i, 1);
    ui.phase = Math.min(i, phases.length - 1);
  }
}

async function fileAction(action) {
  $('file-menu').open = false;
  if (action === 'save') {
    downloadPlay(state);
  } else if (action === 'png') {
    savePng();
  } else if (action === 'pdf') {
    savePdf();
  } else if (action === 'load') {
    $('load-input').click();
  } else if (action === 'new') {
    if (!confirm('Start a new blank play? The current one is replaced (you can undo).')) return;
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
  if (!confirm(`Load "${play.name}"? It replaces the current play (you can undo).`)) return;
  replacePlay(play);
  render();
}

// --- Export ---

const legendItems = () => Object.entries(ROUTE_TYPES).map(([type, st]) => [type, st.label]);

// Phase i as a standalone picture, in the current view, orientation and layers, except that the
// previous-phase ghost is always left out, and so are selection highlights and handles (nothing is
// selected while it is drawn). Redraws the shown phase afterwards.
function phasePicture(i, { width, height, scale, css, cols, idPrefix }) {
  const keep = { phase: ui.phase, selected: ui.selected, snap: ui.snap, snapTo: ui.snapTo, layers: ui.layers };
  Object.assign(ui, { phase: i, selected: null, snap: null, snapTo: null, layers: { ...ui.layers, ghost: false } });
  drawScene();
  const legendOn = ui.layers.legend ? { items: legendItems(), sample: routeSample, cols } : null;
  const picture = pictureSvg(svg, { width, height, scale, css, legend: legendOn, idPrefix });
  Object.assign(ui, keep);
  drawScene();
  return picture;
}

// The shown phase as a PNG at twice its on-screen size.
async function savePng() {
  const { width, height } = svg.getBoundingClientRect();
  const cols = getComputedStyle(legend).gridTemplateColumns.split(' ').length / 2 || 1;
  let blob;
  try {
    blob = await svgToPng(phasePicture(ui.phase, { width, height, scale: 2, css: pageCss(), cols }));
  } catch (err) {
    showToast(err.message);
    return;
  }
  keepFile(new File([blob], safeFileName(state.name, `-phase-${ui.phase + 1}.png`), { type: 'image/png' }));
}

// Every phase as a PDF, one page each: the play name, "Phase n of N", the pitch picture (as in the PNG)
// and the phase's note. Horizontal plays get landscape pages, vertical ones portrait. jsPDF is only
// loaded the first time this runs.
async function savePdf() {
  const [, , vbW, vbH] = svg.getAttribute('viewBox').split(' ').map(Number);
  const orientation = state.orientation === 'vertical' ? 'portrait' : 'landscape';
  const size = pageFit(orientation, vbW / vbH);
  const n = state.phases.length;
  const css = pageCss();
  const title = state.name.trim() || 'Untitled play';
  let blob;
  try {
    const pages = [];
    for (const [i, ph] of state.phases.entries()) {
      const picture = phasePicture(i, { width: size.px.w, height: size.px.h, scale: PDF_SCALE, css, cols: 1 });
      pages.push({ title, caption: `Phase ${i + 1} of ${n}`, note: ph.note.trim(), png: await svgToPng(picture) });
    }
    blob = await makePdf(pages, orientation, size);
  } catch (err) {
    showToast(err.message);
    return;
  }
  keepFile(new File([blob], safeFileName(state.name, '.pdf'), { type: 'application/pdf' }));
}

// Hands a made file to the user. Computers download it. Phones and tablets get the share sheet (Save
// Image or Save to Files on iPhone); if sharing isn't possible there, the file opens in a dialog to save from.
async function keepFile(file) {
  if (!touchScreen.matches) {
    downloadBlob(file, file.name);
    return;
  }
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
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

function undo() {
  if (ui.dragging) return;
  document.activeElement?.blur?.(); // so the text boxes show the restored values
  if (history.undo()) render();
}

function redo() {
  if (ui.dragging) return;
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
  inputs.note.addEventListener('input', () => { phase().note = inputs.note.value; render(`note-${ui.phase}`); });

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
    if (key) { ui.layers[key] = e.target.checked; render(); }
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
    if (!b || b.disabled) return;
    phaseAction(b.dataset.phase, Number(b.dataset.index));
    render();
  });
}

function initSetPieceDialog() {
  const dialog = $('set-piece-dialog');
  dialog.addEventListener('close', () => {
    const [kind, putIn] = dialog.returnValue.split('-');
    if (kind === 'scrum') { addScrum(putIn); render(); }
  });
  return () => { dialog.returnValue = ''; dialog.showModal(); };
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
      if (!ui.selected) return;
      e.preventDefault();
      deleteSelected();
      render();
    } else if (e.key === 'Escape') {
      ui.selected = null;
      ui.tool = null;
      render();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (ui.dragging) return;
      e.preventDefault();
      phaseAction(e.key === 'ArrowLeft' ? 'prev' : 'next');
      render();
    }
  });
}

function init() {
  // Bring back the last play from this browser, if there is one.
  const saved = loadAutosave();
  if (saved) replacePlay(saved.play, saved.phase);
  history.reset();

  buildArrowMarkers($('defs'));
  buildRouteTools();
  initTopbar();
  initPhaseBar();
  initKeys();
  const openSetPiece = initSetPieceDialog();

  document.querySelector('.toolbar').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const { action, object, route } = b.dataset;
    if (action === 'add-attack') { addPlayer('attack'); ui.tool = null; }
    else if (action === 'add-defense') { addPlayer('defense'); ui.tool = null; }
    else if (action === 'set-piece') openSetPiece();
    else if (action === 'delete') deleteSelected();
    else if (object) { addObject(object); ui.tool = null; }
    else if (route) ui.tool = ui.tool === route ? null : route;
    render();
  });

  // Save straight away when the page is hidden or closed, rather than waiting for the timer.
  addEventListener('pagehide', flushAutosave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushAutosave(); });

  initEditor(svg, world, { state, ui, phase, render, editLabel, editOrder, moveObject });
  render();
}

init();
