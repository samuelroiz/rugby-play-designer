// Pointer interaction: drag players/markers, draw, edit and move routes, select.
// Mouse, touch and pen all go through the same pointer events.

import { BOUNDS, PLAYER_R, toMetres } from './pitch.js';

const DOUBLE_TAP_MS = 400;
const MIN_ROUTE_LENGTH = 1; // metres; shorter drags are treated as a mis-tap
const MOVE_THRESHOLD = 0.3; // metres a press must travel before it counts as a drag
const ATTACH_RADIUS = PLAYER_R * 1.6; // dropping a route's start this close to a player attaches it
const HANDLE_MODES = ['start', 'end', 'bend'];

const round = v => Math.round(v * 10) / 10;
const clampX = x => Math.min(BOUNDS.maxX, Math.max(BOUNDS.minX, x));
const clampY = y => Math.min(BOUNDS.maxY, Math.max(BOUNDS.minY, y));

// Moves a player (clamped to the pitch) and the start of every route that belongs to them.
export function movePlayer(phase, id, x, y) {
  const pos = { x: round(clampX(x)), y: round(clampY(y)) };
  phase.positions[id] = pos;
  for (const r of phase.routes) if (r.from === id) r.points[0] = [pos.x, pos.y];
}

// Order number for a new route: one more than the highest so far. Deleting a route leaves the others as they are.
const nextOrder = routes => routes.reduce((max, r) => Math.max(max, r.order || 0), 0) + 1;

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
    control: { x: cx, y: cy },
    mid,
    normal,
  };
}

// `space` is the group that holds the pitch: its transform includes the vertical rotation, so pointer
// positions converted through it land under the finger in either orientation.
// While a drag is in progress ui.dragging is true, so the app records one undo step when it ends.
export function initEditor(svg, space, { state, ui, phase, render, editLabel, editOrder, moveObject }) {
  let drag = null;
  let lastTap = { id: null, time: 0 };
  const findRoute = id => phase().routes.find(r => r.id === id);
  const findObject = id => phase().objects.find(o => o.id === id);

  // Nearest player whose disc (with its touch margin) is under p, or null.
  const playerAt = p => {
    let best = null;
    let bestD = ATTACH_RADIUS;
    for (const pl of state.players) {
      const pos = phase().positions[pl.id];
      if (!pos) continue;
      const d = Math.hypot(pos.x - p.x, pos.y - p.y);
      if (d <= bestD) { best = pl.id; bestD = d; }
    }
    return best;
  };

  svg.addEventListener('pointerdown', e => {
    if (!e.isPrimary || e.button !== 0 || drag) return;
    document.activeElement?.blur(); // so Delete/Escape reach the editor, not a text field
    const p = toMetres(space, e);
    const hit = e.target.closest('[data-kind]');
    const kind = hit?.dataset.kind;
    const id = hit?.dataset.id;

    if (kind === 'handle') {
      // Route handles: start, end, or bend (the midpoint). Nothing changes until the pointer has moved,
      // so a tap on a start handle sitting on a player can still select that player (see endDrag).
      ui.selected = { kind: 'route', id };
      drag = { mode: hit.dataset.handle, id, start: p, moved: false };
    } else if (kind === 'badge') {
      // Tapping a route's order badge edits the number (on release, see endDrag).
      ui.selected = { kind: 'route', id };
      drag = { mode: 'badge', id };
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
        order: nextOrder(phase().routes),
      };
      phase().routes.push(route);
      drag = { mode: 'route', id: route.id };
    } else if (kind === 'player' || kind === 'object') {
      const pos = kind === 'player' ? phase().positions[id] : findObject(id);
      ui.selected = { kind, id };
      drag = { mode: 'move', kind, id, dx: pos.x - p.x, dy: pos.y - p.y, start: p, moved: false };
    } else if (kind === 'route') {
      ui.selected = { kind, id };
      // A route that isn't attached to a player can be moved by dragging its line.
      if (!findRoute(id).from) drag = { mode: 'shift', id, last: p, start: p, moved: false };
    } else {
      ui.selected = null;
    }

    if (drag) {
      ui.dragging = true;
      svg.setPointerCapture(e.pointerId);
    }
    e.preventDefault();
    render();
  });

  svg.addEventListener('pointermove', e => {
    if (!drag) return;
    const p = toMetres(space, e);
    const r = drag.mode === 'move' ? null : findRoute(drag.id);
    const last = r ? r.points.length - 1 : 0;
    if (HANDLE_MODES.includes(drag.mode) && !drag.moved) {
      if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) <= MOVE_THRESHOLD) return;
      drag.moved = true;
    }

    if (drag.mode === 'move') {
      const x = round(clampX(p.x + drag.dx));
      const y = round(clampY(p.y + drag.dy));
      if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > MOVE_THRESHOLD) drag.moved = true;
      if (!drag.moved) return;
      if (drag.kind === 'player') movePlayer(phase(), drag.id, x, y); // routes from this player follow it
      else moveObject(findObject(drag.id), x, y);
    } else if (drag.mode === 'route' || drag.mode === 'end') {
      r.points[last] = [round(clampX(p.x)), round(clampY(p.y))];
    } else if (drag.mode === 'start') {
      // Over a player: snap to them and attach. Over open grass: detach and follow the pointer.
      const onto = playerAt(p);
      const pos = onto ? phase().positions[onto] : { x: clampX(p.x), y: clampY(p.y) };
      r.from = onto;
      r.points[0] = [round(pos.x), round(pos.y)];
    } else if (drag.mode === 'bend') {
      const g = routeGeometry(r);
      r.curve = round((p.x - g.mid.x) * g.normal.x + (p.y - g.mid.y) * g.normal.y);
    } else if (drag.mode === 'shift') {
      if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) <= MOVE_THRESHOLD) return;
      drag.moved = true;
      // Move every point by the same amount, limited so the whole route stays on the pitch.
      const xs = r.points.map(q => q[0]);
      const ys = r.points.map(q => q[1]);
      const dx = Math.min(BOUNDS.maxX - Math.max(...xs), Math.max(BOUNDS.minX - Math.min(...xs), p.x - drag.last.x));
      const dy = Math.min(BOUNDS.maxY - Math.max(...ys), Math.max(BOUNDS.minY - Math.min(...ys), p.y - drag.last.y));
      r.points = r.points.map(([x, y]) => [round(x + dx), round(y + dy)]);
      drag.last = { x: drag.last.x + dx, y: drag.last.y + dy };
    }
    render();
  });

  const endDrag = e => {
    if (!drag) return;
    const done = drag;
    drag = null;
    ui.dragging = false;

    if (done.mode === 'route') {
      const r = findRoute(done.id);
      const [a, b] = [r.points[0], r.points[r.points.length - 1]];
      if (e.type === 'pointercancel' || Math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_ROUTE_LENGTH) {
        phase().routes = phase().routes.filter(x => x !== r);
      } else {
        ui.selected = { kind: 'route', id: r.id };
      }
    }

    if (done.mode === 'badge' && e.type === 'pointerup') setTimeout(() => editOrder(done.id));

    if (e.type === 'pointerup' && !done.moved) {
      if (done.mode === 'move' && done.kind === 'player') tapPlayer(done.id);
      if (HANDLE_MODES.includes(done.mode)) tapThroughHandle(e);
    }
    render();
  };

  // Handles have big touch areas that can cover players, badges and other routes. A press on a handle
  // that doesn't move is passed on to whatever is under the pointer apart from the handle itself.
  function tapThroughHandle(e) {
    const under = document.elementsFromPoint(e.clientX, e.clientY)
      .map(el => el.closest('[data-kind]'))
      .find(el => el && el.dataset.kind !== 'handle');
    if (!under) return; // open grass: keep the route selected, the user was aiming at the handle
    const { kind, id } = under.dataset;
    if (kind === 'player') {
      ui.selected = { kind, id };
      tapPlayer(id);
    } else if (kind === 'badge') {
      ui.selected = { kind: 'route', id };
      setTimeout(() => editOrder(id));
    } else if (kind === 'object' || kind === 'route') {
      ui.selected = { kind, id };
    }
  }

  // Double-click / double-tap on a player (without dragging) edits its label.
  function tapPlayer(id) {
    const now = performance.now();
    if (lastTap.id === id && now - lastTap.time < DOUBLE_TAP_MS) {
      lastTap = { id: null, time: 0 };
      setTimeout(() => editLabel(id)); // let the pointer event finish before the prompt blocks
    } else {
      lastTap = { id, time: now };
    }
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
}
