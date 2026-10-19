// Pointer interaction: drag players/markers, draw, edit and move routes, select.
// Mouse, touch and pen all go through the same pointer events.

import { BOUNDS, toMetres } from './pitch.js';
import { syncOptions } from './options.js';
import { nextId, newRouteOrder, round1 as round, round3, curveControl, curvePoint } from './model.js';

const DOUBLE_TAP_MS = 400;
const MIN_ROUTE_LENGTH = 1; // metres; shorter drags are treated as a mis-tap
const MOVE_THRESHOLD = 0.3; // metres a press must travel before it counts as a drag
const SNAP_RADIUS = 2; // metres from a player's centre: a route starting (or a pass ending) this close attaches to them
const HANDLE_MODES = ['start', 'end', 'bend'];

const clampX = x => Math.min(BOUNDS.maxX, Math.max(BOUNDS.minX, x));
const clampY = y => Math.min(BOUNDS.maxY, Math.max(BOUNDS.minY, y));

// Moves a player (clamped to the pitch), the start of every route that belongs to them and the end of
// every pass to them.
export function movePlayer(phase, id, x, y) {
  const pos = { x: round(clampX(x)), y: round(clampY(y)) };
  phase.positions[id] = pos;
  for (const r of phase.routes) {
    if (r.from === id) r.points[0] = [pos.x, pos.y];
    if (r.to === id) r.points[r.points.length - 1] = [pos.x, pos.y];
  }
}

// A route that follows a player at either end can't be dragged by its line.
export const isAttached = r => !!(r.from || r.to);

// A route is drawn as the quadratic Bézier in model.js (curveControl, curvePoint).
// endGap (metres) stops the drawn line that far short of its end, so a pass's arrowhead touches the
// receiver's disc instead of hiding under it. Handles still use the full route.
export function routeGeometry(route, { endGap = 0 } = {}) {
  const [x1, y1] = route.points[0];
  const [x2, y2] = route.points[route.points.length - 1];
  const { control, mid, normal, len } = curveControl(route);
  const { x: cx, y: cy } = control;
  const c = route.curve || 0;
  let d = `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`;
  if (endGap && len > endGap * 1.5) {
    // Find t where the curve is endGap from the end, then keep the part of the curve before it.
    const at = t => curvePoint(route, t);
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const t = (lo + hi) / 2;
      const q = at(t);
      if (Math.hypot(q.x - x2, q.y - y2) > endGap) lo = t; else hi = t;
    }
    const t = lo;
    const e = at(t);
    d = `M${x1} ${y1} Q${round3(x1 + (cx - x1) * t)} ${round3(y1 + (cy - y1) * t)} ${round3(e.x)} ${round3(e.y)}`;
  }
  return {
    d,
    handle: { x: mid.x + normal.x * c, y: mid.y + normal.y * c },
    control,
    mid,
    normal,
  };
}

// Click-to-draw: with a route tool on and a player selected, each click on the pitch adds a route from
// that player. Returns that player's id, or null when drawing is by press-and-drag instead.
export function drawingFrom(ui, phase) {
  const sel = ui.selected;
  return ui.tool && sel?.kind === 'player' && phase.positions[sel.id] ? sel.id : null;
}

// `space` is the group that holds the pitch: its transform includes the vertical rotation, so pointer
// positions converted through it land under the finger in either orientation.
// While a drag is in progress ui.dragging is true, so the app records one undo step when it ends.
// ui.snap is the player a route being drawn (or about to be, or whose start is being dragged) attaches to;
// ui.snapTo is the receiver a pass being drawn (or whose end is being dragged) will end on.
// ui.preview is where a click-to-draw route would end if the pointer were pressed (or released) now.
// locked(): true while the play is playing, presented or exported, when nothing on the pitch can be edited.
// render() redraws and records the change; renderSoon() redraws on the next animation frame (several pointer
// moves in one frame make one redraw); hint() redraws for hover feedback only, recording nothing.
// pressed(): a press on the pitch is about to edit, so a paused animation frame gives way to the real positions.
// place(p): while ui.placing is set (a player or set piece waiting for "click where it goes"), a press puts it at p.
// drew(route): a new route has just been drawn. ui.hoverRoute is the route whose badge the mouse is over.
export function initEditor(svg, space, {
  state, ui, phase, render, renderSoon, hint, editLabel, editOrder, moveObject, locked, pressed, place, drew,
}) {
  let drag = null;
  let lastTap = { id: null, time: 0 };
  const findRoute = id => phase().routes.find(r => r.id === id);
  const findObject = id => phase().objects.find(o => o.id === id);

  // Nearest player whose centre is within SNAP_RADIUS of p (and for whom ok(player) holds), or null.
  const playerAt = (p, ok = () => true) => {
    let best = null;
    let bestD = SNAP_RADIUS;
    for (const pl of state.players) {
      const pos = phase().positions[pl.id];
      if (!pos || !ok(pl)) continue;
      const d = Math.hypot(pos.x - p.x, pos.y - p.y);
      if (d <= bestD) { best = pl.id; bestD = d; }
    }
    return best;
  };
  const teamOf = id => state.players.find(p => p.id === id)?.team;
  // Who a pass ending at p is caught by: a team-mate of the passer (anyone, for a pass from open grass).
  const receiverAt = (r, p) => playerAt(p, pl => pl.id !== r.from && (!r.from || pl.team === teamOf(r.from)));
  // Puts the end of route r at p. A pass's end snaps onto a receiver within 2 m and attaches to them.
  const setEnd = (r, p) => {
    let pos = { x: clampX(p.x), y: clampY(p.y) };
    if (r.type === 'pass') {
      r.to = receiverAt(r, p);
      ui.snapTo = r.to;
      if (r.to) pos = phase().positions[r.to];
    }
    r.points[r.points.length - 1] = [round(pos.x), round(pos.y)];
  };

  // A new route of the current tool's type, with both ends at `start`, to be dragged out.
  const startRoute = (from, start) => {
    const route = {
      id: nextId('r', phase().routes),
      type: ui.tool,
      from,
      points: [[round(start.x), round(start.y)], [round(start.x), round(start.y)]],
      curve: 0,
      order: newRouteOrder(ui.tool, phase().routes),
      option: null,
    };
    if (ui.tool === 'pass') route.to = null;
    phase().routes.push(route);
    return route;
  };

  // Click-to-draw: aim the preview at p, ringing the receiver a pass would end on.
  const aim = p => {
    const from = drawingFrom(ui, phase());
    ui.snapTo = ui.tool === 'pass' ? receiverAt({ from }, p) : null;
    ui.preview = { x: round(clampX(p.x)), y: round(clampY(p.y)) };
  };
  // Click-to-draw, on release: a pass on a team-mate ends on them; another player becomes the new start;
  // anywhere else ends the route there. The player stays selected and the tool stays on for the next one.
  function finishAim(e) {
    const from = drawingFrom(ui, phase());
    if (!from) return;
    const p = toMetres(space, e);
    const to = ui.tool === 'pass' ? receiverAt({ from }, p) : null;
    const onPlayer = document.elementsFromPoint(e.clientX, e.clientY)
      .map(el => el.closest('[data-kind="player"]')).find(Boolean)?.dataset.id;
    if (!to && onPlayer) {
      ui.selected = { kind: 'player', id: onPlayer };
      return;
    }
    const start = phase().positions[from];
    const end = to ? phase().positions[to] : { x: clampX(p.x), y: clampY(p.y) };
    if (Math.hypot(end.x - start.x, end.y - start.y) < MIN_ROUTE_LENGTH) return;
    const route = startRoute(from, start);
    route.points[1] = [round(end.x), round(end.y)];
    if (ui.tool === 'pass') route.to = to;
    syncOptions(phase().routes, [from]);
    drew(route);
  }

  svg.addEventListener('pointerdown', e => {
    if (!e.isPrimary || e.button !== 0 || drag || locked()) return;
    document.activeElement?.blur(); // so Delete/Escape reach the editor, not a text field
    pressed();
    const p = toMetres(space, e);
    if (ui.placing) {
      e.preventDefault();
      place({ x: clampX(p.x), y: clampY(p.y) });
      return;
    }
    const hit = e.target.closest('[data-kind]');
    const kind = hit?.dataset.kind;
    const id = hit?.dataset.id;

    const clickFrom = drawingFrom(ui, phase());
    const passTo = clickFrom && ui.tool === 'pass' && kind === 'player' && teamOf(id) === teamOf(clickFrom);
    if (clickFrom && !(kind === 'player' && id !== clickFrom && !passTo)) {
      // Click-to-draw: nothing is made until release, so a press can still be moved to aim (and on a
      // phone, where there's no hover, that's how the preview shows).
      drag = { mode: 'aim' };
      aim(p);
    } else if (clickFrom) {
      // Pressing another player switches the start to them. Dragging from there draws a route from them
      // as usual; either way they stay selected, so click-to-draw carries on from them.
      ui.selected = { kind: 'player', id };
      ui.preview = null;
      drag = { mode: 'route', id: startRoute(id, phase().positions[id]).id, keepPlayer: id };
      ui.snap = id;
    } else if (kind === 'handle') {
      // Route handles: start, end, or bend (the midpoint). Nothing changes until the pointer has moved,
      // so a tap on a start handle sitting on a player can still select that player (see endDrag).
      ui.selected = { kind: 'route', id };
      drag = { mode: hit.dataset.handle, id, start: p, moved: false, from: findRoute(id).from };
    } else if (kind === 'badge') {
      // Tapping a route's order badge edits the number (on release, see endDrag).
      ui.selected = { kind: 'route', id };
      drag = { mode: 'badge', id };
    } else if (ui.tool) {
      // Start a new route, from the nearest player if we pressed on or next to one.
      const from = playerAt(p);
      const start = from ? phase().positions[from] : { x: clampX(p.x), y: clampY(p.y) };
      drag = { mode: 'route', id: startRoute(from, start).id };
      ui.snap = from;
    } else if (kind === 'player' || kind === 'object') {
      const pos = kind === 'player' ? phase().positions[id] : findObject(id);
      ui.selected = { kind, id };
      drag = { mode: 'move', kind, id, dx: pos.x - p.x, dy: pos.y - p.y, start: p, moved: false };
    } else if (kind === 'route') {
      ui.selected = { kind, id };
      // A route that isn't attached to a player can be moved by dragging its line.
      if (!isAttached(findRoute(id))) drag = { mode: 'shift', id, last: p, start: p, moved: false };
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
    if (locked()) return;
    if (!drag) {
      // A mouse or pen over a route's badge highlights that route (the others fade).
      const over = e.pointerType === 'touch' ? null : e.target.closest?.('[data-kind="badge"]')?.dataset.id ?? null;
      if (over !== ui.hoverRoute) { ui.hoverRoute = over; hint(); }
      if (drawingFrom(ui, phase())) {
        // Click-to-draw: the preview line follows a hovering mouse or pen.
        aim(toMetres(space, e));
        hint();
      } else if (ui.tool && e.pointerType !== 'touch') {
        // With a route tool and a mouse or pen hovering, show which player a press here would attach to.
        setSnap(playerAt(toMetres(space, e)));
      }
      return;
    }
    if (drag.mode === 'aim') {
      aim(toMetres(space, e));
      renderSoon();
      return;
    }
    const p = toMetres(space, e);
    const r = drag.mode === 'move' ? null : findRoute(drag.id);
    // What's being dragged can vanish under the pointer (the play replaced from another tab): drop the drag.
    if (drag.mode === 'move' ? !(drag.kind === 'player' ? phase().positions[drag.id] : findObject(drag.id)) : !r) {
      cancelDrag();
      return;
    }
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
      setEnd(r, p);
    } else if (drag.mode === 'start') {
      // Over a player: snap to them and attach. Over open grass: detach and follow the pointer.
      // A pass can't start on its own receiver; moving it to the other team drops the receiver.
      const onto = playerAt(p, pl => pl.id !== r.to);
      const pos = onto ? phase().positions[onto] : { x: clampX(p.x), y: clampY(p.y) };
      r.from = onto;
      ui.snap = onto;
      if (r.to && onto && teamOf(onto) !== teamOf(r.to)) r.to = null;
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
    renderSoon();
  });

  function cancelDrag() {
    drag = null;
    ui.dragging = false;
    ui.snap = null;
    ui.snapTo = null;
    render();
  }

  const endDrag = e => {
    if (!drag) return;
    const done = drag;
    drag = null;
    ui.dragging = false;
    ui.snap = null;
    ui.snapTo = null;

    if (done.mode === 'aim' && e.type === 'pointerup') finishAim(e);

    if (done.mode === 'route' && findRoute(done.id)) {
      const r = findRoute(done.id);
      const [a, b] = [r.points[0], r.points[r.points.length - 1]];
      if (e.type === 'pointercancel' || Math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_ROUTE_LENGTH) {
        phase().routes = phase().routes.filter(x => x !== r);
        // A tap on a player (no drag) with a route tool on selects them, which starts click-to-draw.
        if (e.type === 'pointerup' && r.from) ui.selected = { kind: 'player', id: r.from };
      } else {
        ui.selected = done.keepPlayer ? { kind: 'player', id: done.keepPlayer } : { kind: 'route', id: r.id };
        // A second pass or kick from the same player makes them options.
        syncOptions(phase().routes, [r.from]);
        drew(r);
      }
    }

    // A route whose start moved to another player leaves its old options and joins theirs as the last.
    if (done.mode === 'start' && done.moved) {
      const r = findRoute(done.id);
      if (r && r.from !== done.from) {
        if (r.option) r.option = null;
        syncOptions(phase().routes, [done.from, r.from]);
      }
    }

    // Editors open straight from the tap (they're in-page, not blocking), so phones show the keyboard.
    if (done.mode === 'badge' && e.type === 'pointerup') editOrder(done.id);

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
      editOrder(id);
    } else if (kind === 'object' || kind === 'route') {
      ui.selected = { kind, id };
    }
  }

  // Double-click / double-tap on a player (without dragging) edits its label.
  function tapPlayer(id) {
    const now = performance.now();
    if (lastTap.id === id && now - lastTap.time < DOUBLE_TAP_MS) {
      lastTap = { id: null, time: 0 };
      editLabel(id);
    } else {
      lastTap = { id, time: now };
    }
  }
  function setSnap(id) {
    if (ui.snap === id) return;
    ui.snap = id;
    hint();
  }
  svg.addEventListener('pointerleave', () => {
    if (ui.hoverRoute) { ui.hoverRoute = null; hint(); }
    if (drag) return;
    if (ui.preview) {
      ui.preview = null;
      ui.snapTo = null;
      hint();
    }
    setSnap(null);
  });
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
}
