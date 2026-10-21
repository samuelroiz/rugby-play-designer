// Pitch drawing and metre <-> screen helpers.
// x: 0..100 between try lines (in-goal -10..0 and 100..110), y: 0..70 touchline to touchline.

import { round1 } from './model.js';

export const NS = 'http://www.w3.org/2000/svg';

export const BOUNDS = { minX: -10, maxX: 110, minY: 0, maxY: 70 };
export const PLAYER_R = 1.2; // radius of a player disc

// Look of each route type. Widths and dashes are in metres. No reds or blues: those are the team colours.
// Every route also gets a thin dark casing (see routePaths) so the light colours read on grass and on the white lines.
export const ROUTE_TYPES = {
  run:   { label: 'Run',   color: '#ffe14d', width: 0.3 },
  pass:  { label: 'Pass',  color: '#ffffff', width: 0.25, dash: '1 0.7' },
  kick:  { label: 'Kick',  color: '#ffa033', width: 0.5,  dash: '0.01 0.95', cap: 'round' },
  decoy: { label: 'Decoy', color: '#d4d4d4', width: 0.35, dash: '0.45 0.55' },
  drift: { label: 'Drift', color: '#cfa6ff', width: 0.3 },
  blitz: { label: 'Blitz', color: '#ff8fd0', width: 0.6 },
};

// Length of pitch each view shows. The full width (y 0..70) is always shown, and nothing outside it.
// 'half' is the half attack plays into (halfway to the dead ball line at x=110), 'half-own' the other one.
// Each half also shows HALF_MARGIN metres past halfway, so players on or near it (a kick-off) are in view.
const HALF_MARGIN = 5;
const VIEWS = {
  full: { minX: -10, maxX: 110 },
  half: { minX: 50 - HALF_MARGIN, maxX: 110 },
  'half-own': { minX: -10, maxX: 50 + HALF_MARGIN },
};
export const isHalf = view => view === 'half' || view === 'half-own';
export const viewRange = view => VIEWS[view] ?? VIEWS.full;

// Distance labels painted beside the lines, as on a real pitch: [x, text, distance in from each touchline].
// The 10 m labels sit further along their lines than the 50, so the three don't read as one cluster.
const DISTANCE_LABELS = [[5, '5m', 10], [22, '22', 10], [40, '10', 20], [50, '50', 10], [60, '10', 20], [78, '22', 10], [95, '5m', 10]];
const ATTACK_COLOUR = '#d32f2f';

export function svgEl(tag, attrs = {}, parent) {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null) el.setAttribute(key, value);
  }
  if (parent) parent.appendChild(el);
  return el;
}

// The SVG attributes of a route line of `type`, with its arrowhead (see buildArrowMarkers).
export function strokeAttrs(type) {
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

// Dark casing underneath, then the coloured line. Used on the pitch, in the viewer and for the samples.
export function routePaths(parent, tag, geometry, type) {
  const attrs = strokeAttrs(type);
  svgEl(tag, { ...geometry, ...attrs, class: 'route-casing', 'stroke-width': attrs['stroke-width'] + 0.16, 'marker-end': null }, parent);
  svgEl(tag, { ...geometry, ...attrs, 'pointer-events': 'none' }, parent);
}

// An arrowhead marker per route type, in its colour, for strokeAttrs' marker-end.
export function buildArrowMarkers(defs) {
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

// Small sample line for a route type (used on the buttons, in the legend and on exports).
export function routeSample(type) {
  const s = svgEl('svg', { viewBox: '0 -1 8 2', class: 'route-sample', 'aria-hidden': 'true' });
  routePaths(s, 'line', { x1: 0.4, y1: 0, x2: 6.6, y2: 0 }, type);
  return s;
}

// The ball, and a lineout's mark (two short lines), drawn at the origin of `g`.
export const drawBall = g => svgEl('ellipse', { rx: 0.7, ry: 0.45, class: 'ball', transform: 'rotate(-25)' }, g);
export function drawLineoutMark(g) {
  svgEl('line', { x1: -0.7, y1: -2, x2: -0.7, y2: 2, class: 'outline' }, g);
  svgEl('line', { x1: 0.7, y1: -2, x2: 0.7, y2: 2, class: 'outline' }, g);
}

// Rotation that keeps text upright inside the (possibly turned) pitch.
export const uprightTurn = orientation => (orientation === 'vertical' ? ' rotate(90)' : '');

// Fits the viewBox exactly to the view. Vertical turns the pitch a quarter turn anticlockwise
// (rotate(-90) on the world group), so pitch (x, y) is drawn at (y, -x): x=110 at the top, y=0 on the left.
// --ar is the view's width/height; the CSS sizes the SVG to it so no extra field shows at any screen shape.
export function setView(svg, world, view, orientation) {
  const { minX, maxX } = viewRange(view);
  setBox(svg, world, { minX, maxX, minY: BOUNDS.minY, maxY: BOUNDS.maxY }, orientation);
}

// Shows exactly the part of the pitch in `box` (pitch metres: { minX, maxX, minY, maxY }), turned like
// setView, with --ar set to its shape on screen.
export function setBox(svg, world, { minX, maxX, minY, maxY }, orientation) {
  const box = orientation === 'vertical' ? [minY, -maxX, maxY - minY, maxX - minX] : [minX, minY, maxX - minX, maxY - minY];
  svg.setAttribute('viewBox', box.map(round1).join(' '));
  svg.style.setProperty('--ar', box[2] / box[3]);
  if (orientation === 'vertical') world.setAttribute('transform', 'rotate(-90)');
  else world.removeAttribute('transform');
}

// Thumbnails and the phone viewer: the part of the pitch to show for things at `points` (pitch metres):
// their bounding box with `margin` metres round it, grown to the shape `ar` (length along the pitch over
// width across it; the full pitch's 120 x 70 unless given) and to at least a quarter of the pitch's area, then
// moved (not shrunk) to stay on the pitch. It never grows past the pitch: a shape the points can't fit
// inside the pitch is given up on that side. No points: the full pitch.
export function fitBox(points, margin = 8, ar = (BOUNDS.maxX - BOUNDS.minX) / (BOUNDS.maxY - BOUNDS.minY)) {
  const W = BOUNDS.maxX - BOUNDS.minX;
  const H = BOUNDS.maxY - BOUNDS.minY;
  if (!points.length) return { ...BOUNDS };
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const [x0, x1] = [Math.min(...xs) - margin, Math.max(...xs) + margin];
  const [y0, y1] = [Math.min(...ys) - margin, Math.max(...ys) + margin];
  // Height first, from whichever needs more: the points, their width at that shape, or a quarter of the pitch.
  let h = Math.max(y1 - y0, (x1 - x0) / ar, Math.sqrt((W * H) / 4 / ar));
  let w = h * ar;
  if (h > H) { h = H; w = Math.min(W, Math.max(x1 - x0, h * ar)); }
  if (w > W) { w = W; h = Math.min(H, Math.max(y1 - y0, w / ar)); }
  const place = (lo, hi, size, min, max) => {
    const start = (lo + hi) / 2 - size / 2;
    return Math.min(Math.max(start, min), max - size);
  };
  const minX = place(x0, x1, w, BOUNDS.minX, BOUNDS.maxX);
  const minY = place(y0, y1, h, BOUNDS.minY, BOUNDS.maxY);
  return { minX, maxX: minX + w, minY, maxY: minY + h };
}

export function viewCentre(view) {
  const { minX, maxX } = viewRange(view);
  return { x: (minX + maxX) / 2, y: 35 };
}

// Where a new player number n starts: each team lined up across the pitch either side of the view centre.
export function startSpot(team, n, view) {
  const c = viewCentre(view);
  return { x: c.x + (team === 'attack' ? -6 : 6), y: round1(5 + (n - 1) * 4.3) };
}

// Pointer event -> pitch coordinates in metres. `space` is the element whose user space is in metres.
export function toMetres(space, evt) {
  const p = new DOMPoint(evt.clientX, evt.clientY).matrixTransform(space.getScreenCTM().inverse());
  return { x: p.x, y: p.y };
}

export function drawPitch(layer, { view, orientation, distances, grid, direction }) {
  layer.replaceChildren();
  const line = (x1, y1, x2, y2, cls = 'line', parent = layer) => svgEl('line', { x1, y1, x2, y2, class: cls }, parent);

  svgEl('rect', { x: -10, y: 0, width: 120, height: 70, class: 'grass' }, layer);
  for (let x = 10; x < 100; x += 20) {
    svgEl('rect', { x, y: 0, width: 10, height: 70, class: 'stripe' }, layer);
  }
  svgEl('rect', { x: -10, y: 0, width: 10, height: 70, class: 'ingoal' }, layer);
  svgEl('rect', { x: 100, y: 0, width: 10, height: 70, class: 'ingoal' }, layer);

  if (grid) {
    const g = svgEl('g', { class: 'grid' }, layer);
    for (let x = -5; x < 110; x += 5) line(x, 0, x, 70, null, g);
    for (let y = 5; y < 70; y += 5) line(-10, y, 110, y, null, g);
  }

  // Touchlines and dead ball lines sit on the edge of the view, which clips their outer half,
  // so they are drawn twice as thick to look the same as the other lines.
  svgEl('rect', { x: -10, y: 0, width: 120, height: 70, class: 'line edge' }, layer);

  // Try lines, 22s, halfway
  for (const x of [0, 22, 50, 78, 100]) line(x, 0, x, 70);
  // Dashed 10 m and 5 m lines
  for (const x of [40, 60, 5, 95]) line(x, 0, x, 70, 'line dash');
  // Short dashed lines 5 m and 15 m in from each touchline
  for (const y of [5, 15, 55, 65]) line(0, y, 100, y, 'line short');

  // Goal posts: uprights 5.6 m apart, centred on each try line
  for (const x of [0, 100]) {
    line(x, 32.2, x, 37.8, 'crossbar');
    svgEl('circle', { cx: x, cy: 32.2, r: 0.4, class: 'post' }, layer);
    svgEl('circle', { cx: x, cy: 37.8, r: 0.4, class: 'post' }, layer);
  }

  if (distances) drawDistances(layer, orientation, view);
  if (direction) drawDirection(layer, view, orientation);
}

// "Attack" and an arrow in the attack's colour near the bottom edge of the view, pointing the way attack
// plays (towards x=110): right when horizontal, up when vertical. The arrow is drawn in pitch metres along
// +x, so it turns with the pitch; the word stays upright, to its left on screen.
const DIRECTION_LEN = 6;
const directionAt = (view, orientation) => (orientation === 'vertical' ? [viewRange(view).minX + 2.5, 37] : [viewCentre(view).x + 1, 67.6]);

// The ground the direction arrow and its "Attack" word cover, in pitch metres, so new players can keep off it.
// `at` is where it's drawn (placeDirection), its usual spot if not given.
export function directionBox(view, orientation, at = directionAt(view, orientation)) {
  const [x, y] = at;
  return orientation === 'vertical'
    ? { minX: x - 0.4, maxX: x + DIRECTION_LEN, minY: y - 1.2 - 6.6, maxY: y + 1.1 }
    : { minX: x - 0.8 - 6.6, maxX: x + DIRECTION_LEN, minY: y - 1.1, maxY: y + 1.1 };
}

// Where the direction arrow goes so it covers none of `discs` ({ x, y, r } in pitch metres, e.g. the players):
// its usual spot, or the nearest clear one along the same edge of the view (along the bottom touchline when
// horizontal, along the bottom of the screen when vertical). If the whole edge is taken, the usual spot.
export function placeDirection(view, orientation, discs = []) {
  const home = directionAt(view, orientation);
  const clear = at => {
    const b = directionBox(view, orientation, at);
    return discs.every(d => {
      const nx = Math.min(Math.max(d.x, b.minX), b.maxX);
      const ny = Math.min(Math.max(d.y, b.minY), b.maxY);
      return Math.hypot(d.x - nx, d.y - ny) >= d.r + 0.2;
    });
  };
  if (clear(home)) return home;
  const vertical = orientation === 'vertical';
  const { minX, maxX } = viewRange(view);
  // The range the arrow's anchor can move along, keeping the whole box on the pitch.
  const [lo, hi] = vertical ? [1 + 6.6 + 1.2, 70 - 1.1 - 1] : [minX + 0.8 + 6.6 + 0.5, maxX - DIRECTION_LEN - 0.5];
  const along = vertical ? home[1] : home[0];
  for (let step = 1; step * 0.5 <= hi - lo; step++) {
    for (const s of [1, -1]) {
      const v = along + s * step * 0.5;
      if (v < lo || v > hi) continue;
      const at = vertical ? [home[0], v] : [v, home[1]];
      if (clear(at)) return at;
    }
  }
  return home;
}

export function drawDirection(layer, view, orientation, at = directionAt(view, orientation)) {
  const vertical = orientation === 'vertical';
  const len = DIRECTION_LEN;
  // Horizontal: between the 5 m line and the near touchline, centred on the view. Vertical: in the in-goal
  // (or just inside halfway in the half view), at the bottom of the screen, left of centre. `at` moves it
  // along that edge (see placeDirection).
  const [x, y] = at;
  const g = svgEl('g', { class: 'direction', 'aria-hidden': 'true' }, layer);
  const shaft = { x1: x, y1: y, x2: x + len - 0.9, y2: y };
  svgEl('line', { ...shaft, class: 'direction-casing' }, g);
  svgEl('line', { ...shaft, class: 'direction-shaft', stroke: ATTACK_COLOUR }, g);
  svgEl('path', { d: `M${x + len} ${y} l-1.6 -1 v2 z`, class: 'direction-head', fill: ATTACK_COLOUR }, g);
  const [tx, ty] = vertical ? [x + len / 2, y - 1.2] : [x - 0.8, y];
  svgEl('text', {
    transform: `translate(${tx} ${ty})${uprightTurn(orientation)}`,
    'text-anchor': 'end',
    'dominant-baseline': 'central',
    'font-size': 1.7,
    fill: ATTACK_COLOUR,
  }, g).textContent = 'Attack';
}

// Each label sits just beside its line on the halfway side (the 50 on the side of the half shown, so it
// stays well inside the half view), between the 5 m and 15 m lines from each touchline (the 10 m labels
// 20 m in), and stays upright.
function drawDistances(layer, orientation, view) {
  const vertical = orientation === 'vertical';
  for (const [x, text, inFrom] of DISTANCE_LABELS) {
    const side = x === 50 && view === 'half-own' ? -1 : x <= 50 ? 1 : -1;
    for (const y of [inFrom, 70 - inFrom]) {
      // Horizontal: the label sits to the left/right of the line. Vertical: +x is up the screen, so above/below it.
      const at = vertical ? x + side * 1.5 : x + side * 0.6;
      svgEl('text', {
        transform: `translate(${at} ${y})${uprightTurn(orientation)}`,
        'text-anchor': vertical ? 'middle' : side > 0 ? 'start' : 'end',
        'dominant-baseline': 'central',
        'font-size': text.length > 2 ? 1.7 : 2.2,
        class: 'distance',
      }, layer).textContent = text;
    }
  }
}
