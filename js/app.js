// App state, toolbar wiring and redraw. The editor changes state, then render() redraws the SVG from it.

import { drawPitch, setView, viewCentre, svgEl, uprightTurn } from './pitch.js';
import { initEditor, routeGeometry, nextId } from './editor.js';
import { placeScrum, moveScrum, putInSide } from './setpiece.js';

const MAX_PER_TEAM = 15;
const PLAYER_R = 1.2;
const BADGE_R = 0.9;

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

const state = {
  schemaVersion: 1,
  name: 'Untitled play',
  category: 'attack',
  view: 'full',
  orientation: portraitPhone.matches ? 'vertical' : 'horizontal',
  players: [],
  phases: [{ note: '', positions: {}, objects: [], routes: [] }],
};
window.playState = state;

// UI-only state, not part of the saved play.
const ui = {
  tool: null,
  selected: null,
  layers: { distances: true, grid: false, legend: true },
  orientationChosen: false, // once the user picks one, stop following the phone's rotation
};

const svg = document.getElementById('pitch');
const world = document.getElementById('world');
const legend = document.getElementById('legend');
const layers = {
  pitch: document.getElementById('pitch-layer'),
  objects: document.getElementById('objects-layer'),
  routes: document.getElementById('routes-layer'),
  players: document.getElementById('players-layer'),
};
const phase = () => state.phases[0];
const isSelected = (kind, id) => ui.selected?.kind === kind && ui.selected.id === id;
const turn = () => uprightTurn(state.orientation);

function strokeAttrs(type) {
  const st = ROUTE_TYPES[type];
  return {
    fill: 'none',
    stroke: st.color,
    'stroke-width': st.width,
    'stroke-dasharray': st.dash ?? 'none',
    'stroke-linecap': st.cap ?? 'butt',
    'marker-end': `url(#arrow-${type})`,
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

function render() {
  // The pitch only changes with the view and layers, so it isn't redrawn on every drag.
  const key = [state.view, state.orientation, ui.layers.distances, ui.layers.grid].join();
  if (key !== pitchKey) {
    pitchKey = key;
    setView(svg, world, state.view, state.orientation);
    drawPitch(layers.pitch, { view: state.view, orientation: state.orientation, ...ui.layers });
  }
  legend.classList.toggle('hidden', !ui.layers.legend);
  renderObjects();
  renderRoutes();
  renderPlayers();
  updateToolbar();
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

function renderRoutes() {
  const layer = layers.routes;
  layer.replaceChildren();
  for (const r of phase().routes) {
    const selected = isSelected('route', r.id);
    const g = svgEl('g', { class: selected ? 'route selected' : 'route', 'data-kind': 'route', 'data-id': r.id }, layer);
    const geometry = routeGeometry(r);
    const { d, handle } = geometry;
    if (selected) svgEl('path', { d, class: 'route-highlight', 'stroke-width': ROUTE_TYPES[r.type].width + 0.9 }, g);
    svgEl('path', { d, class: 'route-hit' }, g);
    routePaths(g, 'path', { d }, r.type);
    svgEl('circle', { cx: handle.x, cy: handle.y, r: 0.6, class: 'handle', 'data-kind': 'handle', 'data-id': r.id }, g);

    if (Number.isFinite(r.order)) {
      const b = badgePosition(r, geometry);
      const badge = svgEl('g', { class: 'badge', 'data-kind': 'badge', 'data-id': r.id, transform: `translate(${b.x} ${b.y})${turn()}` }, g);
      svgEl('circle', { r: BADGE_R, stroke: ROUTE_TYPES[r.type].color }, badge);
      const text = String(r.order);
      svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': text.length > 1 ? 0.85 : 1.1 }, badge).textContent = text;
    }
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
    svgEl('circle', { r: PLAYER_R, class: 'body' }, g);
    const text = svgEl('text', {
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': p.label.length > 2 ? 0.85 : 1.2,
    }, g);
    text.textContent = p.label;
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

function renderObjects() {
  const layer = layers.objects;
  layer.replaceChildren();
  for (const o of phase().objects) {
    const g = svgEl('g', { class: `marker ${o.type}`, 'data-kind': 'object', 'data-id': o.id, transform: `translate(${o.x} ${o.y})` }, layer);
    const selected = isSelected('object', o.id);

    if (o.type === 'scrum' && o.pack) {
      // Scrum preset: the mark between the front rows, the ball on the put-in side, and an "S" tab
      // clear of the packs (which cover the mark) to drag the whole scrum by.
      const side = putInSide(o.putIn);
      svgEl('line', { x1: 0, y1: -3.8, x2: 0, y2: 3.8, class: 'scrum-mark' }, g);
      svgEl('ellipse', { cx: 0, cy: side * 4.7, rx: 0.7, ry: 0.45, class: 'ball', transform: `rotate(-25 0 ${side * 4.7})` }, g);
      const tab = svgEl('g', { transform: `translate(0 ${-side * 6.5})` }, g);
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

// --- Actions ---

function addPlayer(team) {
  const prefix = team === 'attack' ? 'a' : 'd';
  let n = 1;
  while (n <= MAX_PER_TEAM && state.players.some(p => p.id === prefix + n)) n++;
  if (n > MAX_PER_TEAM) return;
  const id = prefix + n;
  const c = viewCentre(state.view);
  state.players.push({ id, team, label: String(n) });
  // Line each team up across the pitch either side of the view centre.
  phase().positions[id] = { x: c.x + (team === 'attack' ? -6 : 6), y: Math.round((5 + (n - 1) * 4.3) * 10) / 10 };
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
    state.players = state.players.filter(p => p.id !== sel.id);
    delete ph.positions[sel.id];
    ph.routes = ph.routes.filter(r => r.from !== sel.id);
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
  const group = document.getElementById('route-tools');
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
  const nameInput = document.getElementById('play-name');
  nameInput.value = state.name;
  nameInput.addEventListener('input', () => { state.name = nameInput.value; });

  for (const b of document.querySelectorAll('[data-view]')) {
    b.addEventListener('click', () => { state.view = b.dataset.view; render(); });
  }
  for (const b of document.querySelectorAll('[data-orientation]')) {
    b.addEventListener('click', () => { ui.orientationChosen = true; setOrientation(b.dataset.orientation); });
  }
  portraitPhone.addEventListener('change', e => {
    if (!ui.orientationChosen) setOrientation(e.matches ? 'vertical' : 'horizontal');
  });

  const layersPanel = document.getElementById('layers');
  layersPanel.addEventListener('change', e => {
    const key = e.target.dataset.layer;
    if (key) { ui.layers[key] = e.target.checked; render(); }
  });
  // Close the layers panel when tapping anywhere else.
  document.addEventListener('pointerdown', e => {
    if (layersPanel.open && !layersPanel.contains(e.target)) layersPanel.open = false;
  });
}

function initSetPieceDialog() {
  const dialog = document.getElementById('set-piece-dialog');
  dialog.addEventListener('close', () => {
    const [kind, putIn] = dialog.returnValue.split('-');
    if (kind === 'scrum') { addScrum(putIn); render(); }
  });
  return () => { dialog.returnValue = ''; dialog.showModal(); };
}

function init() {
  buildArrowMarkers(document.getElementById('defs'));
  buildRouteTools();
  initTopbar();
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

  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, dialog')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!ui.selected) return;
      e.preventDefault();
      deleteSelected();
      render();
    } else if (e.key === 'Escape') {
      ui.selected = null;
      ui.tool = null;
      render();
    }
  });

  initEditor(svg, world, { state, ui, render, editLabel, editOrder, moveObject });
  render();
}

init();
