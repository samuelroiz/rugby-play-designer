// Boxes over the pitch for changing what's on it: a player's label and a route's order number, typed in a
// small box in place (inlineEdit); an option's box (its order, label and "Make this the main option"); and the
// route bar beside a selected route.

import { ROUTE_TYPES } from './pitch.js';
import { nextOrder } from './model.js';
import { makeMainOption, optionGroup, OPTION_LABEL_MAX } from './options.js';
import { LINE_HIT_PX } from './scene.js';

// scene: the editing pitch's drawing (scene.js), for sizes on screen. stepText(route) is the route bar's
// "Step 2, together with: …"; deleteSelected() deletes the selected route.
export function createPitchEdits({ state, ui, phase, render, svg, world, layers, scene, stepText, deleteSelected, phoneLayout }) {
  const $ = id => document.getElementById(id);
  const { pxPerMetre, playerR, badgeR } = scene;

  // A small text box over the pitch, just above (or below, near the top) a point on screen. Enter or clicking
  // away saves, Escape cancels. Opening another first saves the one already open.
  let finishInline = null;
  function inlineEdit({ at, gap, value, maxLength, numeric = false, label, onSave, onClose = null }) {
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
      onClose?.();
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
      gap: playerR() * pxPerMetre() + 6,
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
    // The number box opens at the badge, or at the route's start when its badge isn't shown (see badgedRoutes).
    let badge = layers.badges.querySelector(`.badge[data-id="${id}"]`)?.getBoundingClientRect();
    if (!badge) {
      const start = screenPoint(...route.points[0]);
      const r = badgeR() * pxPerMetre();
      badge = { x: start.x - r, y: start.y - r, width: 2 * r, height: 2 * r };
    }
    // While the number is typed, its route is highlighted and the others fade (how a tap on a badge shows
    // its route on a touch screen).
    finishInline?.(true); // an edit already open is saved first (and drops its own highlight)
    ui.orderEdit = id;
    render(null, { record: false });
    inlineEdit({
      onClose: () => {
        if (ui.orderEdit !== id) return;
        ui.orderEdit = null;
        render(null, { record: false });
      },
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
    const step = $('route-step');
    step.textContent = stepText(route);
    step.hidden = !step.textContent;
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

  return {
    editLabel, editOrder, updateRouteBar, initOptionDialog, initRouteBar,
    // Closes a box being typed in, saving what's in it or not.
    finishEdit: save => finishInline?.(save),
  };
}
