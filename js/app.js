// App state, toolbar wiring and redraw. The editor changes state, then render() redraws the SVG from it.

import { drawPitch, setView, viewCentre, svgEl } from './pitch.js';
import { initEditor, routeGeometry, nextId } from './editor.js';

const MAX_PER_TEAM = 15;
const PLAYER_R = 1.2;

// Look of each route type. Widths and dashes are in metres.
const ROUTE_TYPES = {
  run:   { label: 'Run',   color: '#111',    width: 0.3 },
  pass:  { label: 'Pass',  color: '#111',    width: 0.25, dash: '1 0.7' },
  kick:  { label: 'Kick',  color: '#111',    width: 0.3,  dash: '0.01 0.6', cap: 'round' },
  decoy: { label: 'Decoy', color: '#bdbdbd', width: 0.15, dash: '0.8 0.6' },
  drift: { label: 'Drift', color: '#ffd54f', width: 0.3 },
  blitz: { label: 'Blitz', color: '#111',    width: 0.6 },
};

const state = {
  schemaVersion: 1,
  name: 'Untitled play',
  category: 'attack',
  view: 'full',
  players: [],
  phases: [{ note: '', positions: {}, objects: [], routes: [] }],
};
window.playState = state;

// UI-only state, not part of the saved play.
const ui = { tool: null, selected: null };

const svg = document.getElementById('pitch');
const layers = {
  pitch: document.getElementById('pitch-layer'),
  objects: document.getElementById('objects-layer'),
  routes: document.getElementById('routes-layer'),
  players: document.getElementById('players-layer'),
};
const phase = () => state.phases[0];
const isSelected = (kind, id) => ui.selected?.kind === kind && ui.selected.id === id;

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

// --- Rendering ---

function render() {
  setView(svg, state.view);
  renderObjects();
  renderRoutes();
  renderPlayers();
  updateToolbar();
}

function renderRoutes() {
  const layer = layers.routes;
  layer.replaceChildren();
  for (const r of phase().routes) {
    const selected = isSelected('route', r.id);
    const g = svgEl('g', { class: selected ? 'route selected' : 'route', 'data-kind': 'route', 'data-id': r.id }, layer);
    const { d, handle } = routeGeometry(r);
    if (selected) svgEl('path', { d, class: 'route-highlight', 'stroke-width': ROUTE_TYPES[r.type].width + 0.8 }, g);
    svgEl('path', { d, class: 'route-hit' }, g);
    svgEl('path', { d, 'pointer-events': 'none', ...strokeAttrs(r.type) }, g);
    svgEl('circle', { cx: handle.x, cy: handle.y, r: 0.6, class: 'handle', 'data-kind': 'handle', 'data-id': r.id }, g);
  }
}

function renderPlayers() {
  const layer = layers.players;
  layer.replaceChildren();
  for (const p of state.players) {
    const pos = phase().positions[p.id];
    if (!pos) continue;
    const cls = `player ${p.team}${isSelected('player', p.id) ? ' selected' : ''}`;
    const g = svgEl('g', { class: cls, 'data-kind': 'player', 'data-id': p.id, transform: `translate(${pos.x} ${pos.y})` }, layer);
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

function label(g, text, y = 0) {
  svgEl('text', { y, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 1.3 }, g).textContent = text;
}

function renderObjects() {
  const layer = layers.objects;
  layer.replaceChildren();
  for (const o of phase().objects) {
    const g = svgEl('g', { class: `marker ${o.type}`, 'data-kind': 'object', 'data-id': o.id, transform: `translate(${o.x} ${o.y})` }, layer);
    const ringR = o.type === 'ball' ? 1.4 : 3;
    svgEl('circle', { r: ringR, class: 'hit' }, g);
    if (isSelected('object', o.id)) svgEl('circle', { r: ringR, class: 'select-ring' }, g);

    if (o.type === 'ball') {
      svgEl('ellipse', { rx: 0.7, ry: 0.45, class: 'ball', transform: 'rotate(-25)' }, g);
    } else if (o.type === 'ruck') {
      svgEl('circle', { r: 2, class: 'outline' }, g);
      label(g, 'R');
    } else if (o.type === 'scrum') {
      svgEl('rect', { x: -2.5, y: -1.5, width: 5, height: 3, class: 'outline' }, g);
      label(g, 'S');
    } else if (o.type === 'lineout') {
      svgEl('line', { x1: -0.7, y1: -2, x2: -0.7, y2: 2, class: 'outline' }, g);
      svgEl('line', { x1: 0.7, y1: -2, x2: 0.7, y2: 2, class: 'outline' }, g);
      label(g, 'L', -2.9);
    }
  }
}

function updateToolbar() {
  const count = team => state.players.filter(p => p.team === team).length;
  document.querySelector('[data-action="add-attack"]').disabled = count('attack') >= MAX_PER_TEAM;
  document.querySelector('[data-action="add-defense"]').disabled = count('defense') >= MAX_PER_TEAM;
  document.querySelector('[data-action="delete"]').disabled = !ui.selected;
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', b.dataset.view === state.view);
  for (const b of document.querySelectorAll('[data-route]')) b.setAttribute('aria-pressed', b.dataset.route === ui.tool);
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
    svgEl('path', { d: 'M0 0L10 5L0 10z', fill: st.color }, marker);
  }
}

// Small sample line for a route type (used on the buttons and in the legend).
function routeSample(type) {
  const s = svgEl('svg', { viewBox: '0 -1 8 2', class: 'route-sample', 'aria-hidden': 'true' });
  svgEl('line', { x1: 0.4, y1: 0, x2: 6.6, y2: 0, ...strokeAttrs(type) }, s);
  return s;
}

function buildRouteTools() {
  const group = document.getElementById('route-tools');
  const legend = document.getElementById('legend');
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

function init() {
  buildArrowMarkers(document.getElementById('defs'));
  buildRouteTools();
  drawPitch(layers.pitch);

  const nameInput = document.getElementById('play-name');
  nameInput.value = state.name;
  nameInput.addEventListener('input', () => { state.name = nameInput.value; });

  for (const b of document.querySelectorAll('[data-view]')) {
    b.addEventListener('click', () => { state.view = b.dataset.view; render(); });
  }

  document.querySelector('.toolbar').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const { action, object, route } = b.dataset;
    if (action === 'add-attack') { addPlayer('attack'); ui.tool = null; }
    else if (action === 'add-defense') { addPlayer('defense'); ui.tool = null; }
    else if (action === 'delete') deleteSelected();
    else if (object) { addObject(object); ui.tool = null; }
    else if (route) ui.tool = ui.tool === route ? null : route;
    render();
  });

  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea')) return;
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

  initEditor(svg, { state, ui, render, editLabel });
  render();
}

init();
