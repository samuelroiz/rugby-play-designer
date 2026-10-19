// Pitch drawing and metre <-> screen helpers.
// x: 0..100 between try lines (in-goal -10..0 and 100..110), y: 0..70 touchline to touchline.

import { round1 } from './model.js';

const NS = 'http://www.w3.org/2000/svg';

export const BOUNDS = { minX: -10, maxX: 110, minY: 0, maxY: 70 };
export const PLAYER_R = 1.2; // radius of a player disc

// Length of pitch each view shows. The full width (y 0..70) is always shown, and nothing outside it.
// 'half' is the half attack plays into (halfway to the dead ball line at x=110), 'half-own' the other one.
export const VIEWS = {
  full: { minX: -10, maxX: 110 },
  half: { minX: 50, maxX: 110 },
  'half-own': { minX: -10, maxX: 50 },
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

// Rotation that keeps text upright inside the (possibly turned) pitch.
export const uprightTurn = orientation => (orientation === 'vertical' ? ' rotate(90)' : '');

// Fits the viewBox exactly to the view. Vertical turns the pitch a quarter turn anticlockwise
// (rotate(-90) on the world group), so pitch (x, y) is drawn at (y, -x): x=110 at the top, y=0 on the left.
// --ar is the view's width/height; the CSS sizes the SVG to it so no extra field shows at any screen shape.
export function setView(svg, world, view, orientation) {
  const { minX, maxX } = VIEWS[view] ?? VIEWS.full;
  const length = maxX - minX;
  const width = BOUNDS.maxY - BOUNDS.minY;
  const box = orientation === 'vertical' ? [0, -maxX, width, length] : [minX, 0, length, width];
  svg.setAttribute('viewBox', box.join(' '));
  svg.style.setProperty('--ar', box[2] / box[3]);
  if (orientation === 'vertical') world.setAttribute('transform', 'rotate(-90)');
  else world.removeAttribute('transform');
}

export function viewCentre(view) {
  return view === 'half' ? { x: 77.5, y: 35 } : view === 'half-own' ? { x: 22.5, y: 35 } : { x: 50, y: 35 };
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

  // Try lines, 22s, halfway (also an edge in the half views)
  for (const x of [0, 22, 50, 78, 100]) line(x, 0, x, 70, x === 50 && isHalf(view) ? 'line edge' : 'line');
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

  if (distances) drawDistances(layer, orientation);
  if (direction) drawDirection(layer, view, orientation);
}

// "Attack" and an arrow in the attack's colour near the bottom edge of the view, pointing the way attack
// plays (towards x=110): right when horizontal, up when vertical. The arrow is drawn in pitch metres along
// +x, so it turns with the pitch; the word stays upright, to its left on screen.
const DIRECTION_LEN = 6;
const directionAt = (view, orientation) => (orientation === 'vertical' ? [viewRange(view).minX + 2.5, 37] : [viewCentre(view).x + 1, 67.6]);

// The ground the direction arrow and its "Attack" word cover, in pitch metres, so new players can keep off it.
export function directionBox(view, orientation) {
  const [x, y] = directionAt(view, orientation);
  return orientation === 'vertical'
    ? { minX: x - 0.4, maxX: x + DIRECTION_LEN, minY: y - 1.2 - 6.6, maxY: y + 1.1 }
    : { minX: x - 0.8 - 6.6, maxX: x + DIRECTION_LEN, minY: y - 1.1, maxY: y + 1.1 };
}

function drawDirection(layer, view, orientation) {
  const vertical = orientation === 'vertical';
  const len = DIRECTION_LEN;
  // Horizontal: between the 5 m line and the near touchline, centred on the view. Vertical: in the in-goal
  // (or just inside halfway in the half view), at the bottom of the screen, left of centre.
  const [x, y] = directionAt(view, orientation);
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

// Each label sits just beside its line on the halfway side (the 50 on the +x side, so it stays
// inside the half view), between the 5 m and 15 m lines from each touchline (the 10 m labels 20 m in),
// and stays upright.
function drawDistances(layer, orientation) {
  const vertical = orientation === 'vertical';
  for (const [x, text, inFrom] of DISTANCE_LABELS) {
    const side = x <= 50 ? 1 : -1;
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
