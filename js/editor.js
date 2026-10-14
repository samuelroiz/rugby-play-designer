// Pointer interaction: drag players/markers, draw and bend routes, select.
// Mouse, touch and pen all go through the same pointer events.

import { BOUNDS, toMetres } from './pitch.js';

const DOUBLE_TAP_MS = 400;
const MIN_ROUTE_LENGTH = 1; // metres; shorter drags are treated as a mis-tap

const round = v => Math.round(v * 10) / 10;
const clampX = x => Math.min(BOUNDS.maxX, Math.max(BOUNDS.minX, x));
const clampY = y => Math.min(BOUNDS.maxY, Math.max(BOUNDS.minY, y));

// Next free id like "r3" given existing items with ids "r1", "r2".
export function nextId(prefix, items) {
  let max = 0;
  for (const item of items) {
    if (item.id.startsWith(prefix)) max = Math.max(max, Number(item.id.slice(prefix.length)) || 0);
  }
  return prefix + (max + 1);
}

// A route is a quadratic bezier from its first to its last point.
// "curve" is how far (metres) the route's midpoint is pushed sideways from the
// straight line; the bezier control point sits at twice that offset.
export function routeGeometry(route) {
  const [x1, y1] = route.points[0];
  const [x2, y2] = route.points[route.points.length - 1];
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const normal = { x: -(y2 - y1) / len, y: (x2 - x1) / len };
  const mid = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  const c = route.curve || 0;
  const cx = mid.x + 2 * normal.x * c;
  const cy = mid.y + 2 * normal.y * c;
  return {
    d: `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`,
    handle: { x: mid.x + normal.x * c, y: mid.y + normal.y * c },
    mid,
    normal,
  };
}

export function initEditor(svg, { state, ui, render, editLabel }) {
  let drag = null;
  let lastTap = { id: null, time: 0 };
  const phase = () => state.phases[0];
  const findRoute = id => phase().routes.find(r => r.id === id);
  const findObject = id => phase().objects.find(o => o.id === id);

  svg.addEventListener('pointerdown', e => {
    if (!e.isPrimary || e.button !== 0 || drag) return;
    document.activeElement?.blur(); // so Delete/Escape reach the editor, not the name field
    const p = toMetres(svg, e);
    const hit = e.target.closest('[data-kind]');
    const kind = hit?.dataset.kind;
    const id = hit?.dataset.id;

    if (kind === 'handle') {
      ui.selected = { kind: 'route', id };
      drag = { mode: 'bend', id };
    } else if (ui.tool) {
      // Start a new route, from a player if we pressed on one.
      const from = kind === 'player' ? id : null;
      const start = from ? phase().positions[from] : { x: clampX(p.x), y: clampY(p.y) };
      const route = {
        id: nextId('r', phase().routes),
        type: ui.tool,
        from,
        points: [[round(start.x), round(start.y)], [round(start.x), round(start.y)]],
        curve: 0,
      };
      phase().routes.push(route);
      drag = { mode: 'route', id: route.id };
    } else if (kind === 'player' || kind === 'object') {
      const pos = kind === 'player' ? phase().positions[id] : findObject(id);
      ui.selected = { kind, id };
      drag = { mode: 'move', kind, id, dx: pos.x - p.x, dy: pos.y - p.y, start: p, moved: false };
    } else if (kind === 'route') {
      ui.selected = { kind, id };
    } else {
      ui.selected = null;
    }

    if (drag) svg.setPointerCapture(e.pointerId);
    e.preventDefault();
    render();
  });

  svg.addEventListener('pointermove', e => {
    if (!drag) return;
    const p = toMetres(svg, e);

    if (drag.mode === 'move') {
      const x = round(clampX(p.x + drag.dx));
      const y = round(clampY(p.y + drag.dy));
      if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 0.3) drag.moved = true;
      if (drag.kind === 'player') {
        phase().positions[drag.id] = { x, y };
        // Routes that start at this player follow it.
        for (const r of phase().routes) if (r.from === drag.id) r.points[0] = [x, y];
      } else {
        Object.assign(findObject(drag.id), { x, y });
      }
    } else if (drag.mode === 'route') {
      const r = findRoute(drag.id);
      r.points[r.points.length - 1] = [round(clampX(p.x)), round(clampY(p.y))];
    } else if (drag.mode === 'bend') {
      const r = findRoute(drag.id);
      const g = routeGeometry(r);
      r.curve = round((p.x - g.mid.x) * g.normal.x + (p.y - g.mid.y) * g.normal.y);
    }
    render();
  });

  const endDrag = e => {
    if (!drag) return;
    const done = drag;
    drag = null;

    if (done.mode === 'route') {
      const r = findRoute(done.id);
      const [a, b] = [r.points[0], r.points[r.points.length - 1]];
      if (e.type === 'pointercancel' || Math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_ROUTE_LENGTH) {
        phase().routes = phase().routes.filter(x => x !== r);
      } else {
        ui.selected = { kind: 'route', id: r.id };
      }
    }

    // Double-click / double-tap on a player (without dragging) edits its label.
    if (done.mode === 'move' && done.kind === 'player' && !done.moved && e.type === 'pointerup') {
      const now = performance.now();
      if (lastTap.id === done.id && now - lastTap.time < DOUBLE_TAP_MS) {
        lastTap = { id: null, time: 0 };
        setTimeout(() => editLabel(done.id)); // let the pointer event finish before the prompt blocks
      } else {
        lastTap = { id: done.id, time: now };
      }
    }
    render();
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
}
