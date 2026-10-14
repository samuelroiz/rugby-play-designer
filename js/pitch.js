// Pitch drawing and metre <-> screen helpers.
// x: 0..100 between try lines (in-goal -10..0 and 100..110), y: 0..70 touchline to touchline.

const NS = 'http://www.w3.org/2000/svg';

export const BOUNDS = { minX: -10, maxX: 110, minY: 0, maxY: 70 };

// viewBox per view, with 1 m of padding so edge lines aren't clipped.
const VIEWS = {
  full: '-11 -1 122 72',
  half: '44 -1 67 72',
};

export function svgEl(tag, attrs = {}, parent) {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null) el.setAttribute(key, value);
  }
  if (parent) parent.appendChild(el);
  return el;
}

export function setView(svg, view) {
  svg.setAttribute('viewBox', VIEWS[view] ?? VIEWS.full);
}

export function viewCentre(view) {
  return view === 'half' ? { x: 77.5, y: 35 } : { x: 50, y: 35 };
}

// Pointer event -> pitch coordinates in metres.
export function toMetres(svg, evt) {
  const p = new DOMPoint(evt.clientX, evt.clientY).matrixTransform(svg.getScreenCTM().inverse());
  return { x: p.x, y: p.y };
}

export function drawPitch(layer) {
  layer.replaceChildren();
  const line = (x1, y1, x2, y2, cls = 'line') => svgEl('line', { x1, y1, x2, y2, class: cls }, layer);

  svgEl('rect', { x: -10, y: 0, width: 120, height: 70, class: 'grass' }, layer);
  for (let x = 10; x < 100; x += 20) {
    svgEl('rect', { x, y: 0, width: 10, height: 70, class: 'stripe' }, layer);
  }
  svgEl('rect', { x: -10, y: 0, width: 10, height: 70, class: 'ingoal' }, layer);
  svgEl('rect', { x: 100, y: 0, width: 10, height: 70, class: 'ingoal' }, layer);

  // Touchlines and dead ball lines
  svgEl('rect', { x: -10, y: 0, width: 120, height: 70, class: 'line' }, layer);

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
}
