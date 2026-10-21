// Drawing the editing pitch: the pitch itself, then the shown phase's players, routes (with their order
// badges, option labels and handles), markers, the previous phase's ghost, the selected player's cues, edge
// arrows in half views and Present mode's cue bubble. drawScene() redraws all of it from the state and touches
// nothing else; app.js's render() calls it, and so do the exports, to draw a phase as a picture.

import {
  drawPitch, setView, viewRange, isHalf, placeDirection, drawDirection, svgEl, routePaths, drawBall, drawLineoutMark, PLAYER_R, ROUTE_TYPES,
} from './pitch.js';
import { routeGeometry, isAttached, drawingFrom } from './editor.js';
import { optionGroup } from './options.js';
import { round2, playedRoutes, positionsAfter, BALL_ROUTES } from './model.js';
import { placeBubble, phaseCues, firedBetween, ageBubbles } from './cues.js';
import { frameAt, flightEnds, shownRoute } from './animate.js';
import { badgePosition, optionBadgePosition, badgedRoutes } from './badges.js';

const BADGE_R = 0.9;
const BALL_R = 0.75; // the ball's drawn half-length, for keeping badges off it
// Layers → Player size: how much player discs, their numbers and the route badges are scaled. A setting of
// this browser (kept in localStorage), not of the play; pictures and PDFs use the size on screen.
export const PLAYER_SIZES = { small: 0.8, medium: 1, large: 1.2 };
// Smallest touch target for route handles and lines, in screen pixels (converted to metres at draw time).
const HANDLE_HIT_PX = 22;
export const LINE_HIT_PX = 14;
// Option label text, in metres: at least as large as a player's number (1.2).
const OPTION_LABEL_SIZE = 1.25;

// playback is read when drawing (what's playing, and the option chosen in Present mode). turn() is the
// transform that keeps text upright on the turned pitch.
export function createScene({ state, ui, svg, world, legend, layers, phase, playback, locked, isSelected, turn }) {
  const $ = id => document.getElementById(id);

  // Drawn sizes, in metres, at the chosen player size.
  const sizeScale = () => PLAYER_SIZES[ui.playerSize] ?? 1;
  const playerR = () => PLAYER_R * sizeScale();
  const badgeR = () => BADGE_R * sizeScale();
  // A pass attached to a receiver stops this far from their centre, so its arrowhead touches their disc.
  const passEndGap = () => playerR() + 0.2;

  let pitchKey = '';

  // Draws the pitch and the current phase (players, routes, markers) without touching anything else.
  function drawScene() {
    // The pitch only changes with the view and layers, so it isn't redrawn on every drag.
    const key = [state.view, state.orientation, ui.layers.distances, ui.layers.grid, ui.layers.direction].join();
    if (key !== pitchKey) {
      pitchKey = key;
      setView(svg, world, state.view, state.orientation);
      drawPitch(layers.pitch, { view: state.view, orientation: state.orientation, ...ui.layers, direction: false });
    }
    if (ui.phase >= state.phases.length) ui.phase = state.phases.length - 1;
    dropMissingSelection();
    if (!drawingFrom(ui, phase())) ui.preview = null;
    legend.classList.toggle('hidden', !ui.layers.legend);
    svg.classList.toggle('focus-player', !!ui.focusPlayer);
    // An animation frame may have faded the routes out; a fresh drawing starts with them shown.
    for (const l of [layers.routes, layers.ballRoutes, layers.badges]) l.style.opacity = '';
    renderDirection();
    renderGhost();
    renderObjects();
    renderRoutes();
    renderPlayers();
    renderCueMarks();
    renderEdgeArrows();
  }

  // Layers → Direction: "Attack" and its arrow by the bottom edge, moved along it so it covers no player.
  let directionAt = null; // where it's drawn now, so a new player's usual spot keeps off it
  function renderDirection() {
    const layer = layers.direction;
    layer.replaceChildren();
    directionAt = null;
    if (!ui.layers.direction) return;
    const discs = state.players.filter(p => phase().positions[p.id]).map(p => ({ ...phase().positions[p.id], r: playerR() }));
    directionAt = placeDirection(state.view, state.orientation, discs);
    drawDirection(layer, state.view, state.orientation, directionAt);
  }

  // The routes of phase i as they're drawn: a pass or kick from where its passer is at its step, a pass to where
  // the receiver is when the ball gets there (animate.js flightEnds). Other routes as they are.
  function shownRoutes(i) {
    const ends = flightEnds(state, i);
    return r => shownRoute(r, ends.get(r.id));
  }

  // Present mode, I play: the chosen player's cues pop up in a bubble next to them as each one's step starts, as
  // in the phone viewer (each held CUE.holdMs; several at once share the bubble). Only while playing or paused.
  let presentBubbles = { phase: null, list: [] };
  function presentCueTick(sched, from, to, wall) {
    const id = ui.presenting ? ui.focusPlayer : null;
    if (!id) { clearPresentCues(); return; }
    if (presentBubbles.phase !== sched.phase) presentBubbles = { phase: sched.phase, list: [] };
    presentBubbles.list = ageBubbles(presentBubbles.list, wall);
    presentBubbles.list.push(...firedBetween(phaseCues(state, sched.phase, id, sched), from, to).map(c => ({ text: c.text, age: 0 })));
    drawPresentCues(frameAt(sched, to).players[id]);
  }
  function clearPresentCues() {
    presentBubbles = { phase: null, list: [] };
    $('present-cue-layer').replaceChildren();
  }
  // The bubble, in the SVG's screen units (outside the turned pitch), about 2.6% of the window's height in type,
  // beside the player (pitch metres `pos`) and inside the view, never over their disc (cues.js placeBubble).
  function drawPresentCues(pos) {
    const layer = $('present-cue-layer');
    layer.replaceChildren();
    if (!pos || !presentBubbles.list.length) return;
    const [vx, vy, vw, vh] = svg.getAttribute('viewBox').split(' ').map(Number);
    const k = svg.clientHeight / vh || 1; // px per unit
    const size = Math.max(18, innerHeight * 0.026) / k;
    const pad = size * 0.45;
    const lines = presentBubbles.list.map(b => b.text.toUpperCase());
    const w = Math.max(...lines.map(l => l.length)) * size * 0.66 + 2 * pad;
    const h = lines.length * size * 1.2 + 2 * pad - size * 0.2;
    const [sx, sy] = state.orientation === 'vertical' ? [pos.y, -pos.x] : [pos.x, pos.y];
    const at = placeBubble({ x: sx - vx, y: sy - vy, r: playerR() + 0.75, w, h, width: vw, height: vh, margin: size * 0.4, gap: size * 0.35 });
    const g = svgEl('g', { class: 'present-cue', transform: `translate(${round2(vx + at.left)} ${round2(vy + at.top)})` }, layer);
    svgEl('rect', { width: round2(w), height: round2(h), rx: round2(size * 0.35), 'stroke-width': round2(size * 0.08) }, g);
    lines.forEach((line, i) => {
      svgEl('text', { x: round2(w / 2), y: round2(pad + size * (0.5 + i * 1.2)), 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': round2(size) }, g).textContent = line;
    });
  }

  // The selected player's cues for this phase, as small bubbles stacked over them (each "2 JUMP!": its step
  // and text), only while editing. Never in pictures, which are drawn with nothing selected.
  function renderCueMarks() {
    const layer = layers.cues;
    layer.replaceChildren();
    const id = ui.selected?.kind === 'player' && !locked() ? ui.selected.id : null;
    const pos = id && phase().positions[id];
    const cues = (phase().cues ?? []).filter(c => c.player === id).sort((a, b) => a.step - b.step);
    if (!pos || !cues.length) return;
    const g = svgEl('g', { class: 'cue-marks', transform: `translate(${pos.x} ${pos.y})${turn()}` }, layer);
    const [size, stepSize, h, gap] = [1.1, 0.8, 1.8, 0.35];
    cues.forEach((c, i) => {
      const text = c.text.toUpperCase();
      const stepW = String(c.step).length * stepSize * 0.6 + 0.6;
      const w = round2(stepW + text.length * size * 0.66 + 0.8);
      const mark = svgEl('g', { class: 'cue-mark', transform: `translate(${round2(-w / 2)} ${round2(-(playerR() + 0.7 + h + i * (h + gap)))})` }, g);
      svgEl('rect', { width: w, height: h, rx: 0.5 }, mark);
      svgEl('text', { x: 0.45, y: h / 2, 'dominant-baseline': 'central', 'font-size': stepSize, class: 'cue-step-num' }, mark).textContent = c.step;
      svgEl('text', { x: round2(stepW + 0.2), y: h / 2, 'dominant-baseline': 'central', 'font-size': size, class: 'cue-mark-text' }, mark).textContent = text;
    });
  }

  // Half views: a player off the shown half gets a small arrow at the edge (halfway), in their team's colour
  // with their number, pointing the way to them.
  function renderEdgeArrows() {
    const layer = layers.edges;
    layer.replaceChildren();
    if (!isHalf(state.view)) return;
    const { minX, maxX } = viewRange(state.view);
    for (const p of state.players) {
      const pos = phase().positions[p.id];
      if (!pos || (pos.x >= minX && pos.x <= maxX)) continue;
      const left = pos.x < minX; // the player is past the -x edge
      const x = left ? minX + 1.3 : maxX - 1.3;
      const y = Math.min(68.5, Math.max(1.5, pos.y));
      const g = svgEl('g', { class: `edge-arrow ${p.team}`, 'data-edge': p.id, transform: `translate(${x} ${y})` }, layer);
      svgEl('path', { d: 'M1 0L-0.8 -0.9L-0.8 0.9z', transform: left ? 'rotate(180)' : null, class: 'edge-head' }, g);
      svgEl('text', {
        transform: `translate(${left ? 1.9 : -1.9} 0)${turn()}`,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'font-size': 0.95,
      }, g).textContent = p.label;
    }
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

  // Discs a badge mustn't cover: every player and ball in the shown phase.
  function badgeObstacles() {
    const ph = phase();
    return [
      ...state.players.filter(p => ph.positions[p.id]).map(p => ({ ...ph.positions[p.id], r: playerR() })),
      ...ph.objects.filter(o => o.type === 'ball').map(o => ({ x: o.x, y: o.y, r: BALL_R })),
    ];
  }

  // The drawn shape of a route: a pass to a receiver stops at the edge of their disc.
  const drawnGeometry = r => routeGeometry(r, { endGap: r.to ? passEndGap() : 0 });

  function renderRoutes() {
    const layer = layers.routes;
    layer.replaceChildren();
    layers.badges.replaceChildren();
    layers.handles.replaceChildren();
    const ppm = pxPerMetre();
    const lineHit = Math.max(1.6, LINE_HIT_PX / ppm);
    layers.ballRoutes.replaceChildren();
    svg.classList.toggle('option-focusing', !!ui.optionFocus);
    // A badge under the mouse (or whose number is being typed) highlights its route and fades the others.
    // Not while playing or presenting, where nothing is edited.
    const hovered = ui.optionFocus || locked() ? null : ui.orderEdit ?? ui.hoverRoute;
    svg.classList.toggle('route-hovering', !!hovered && phase().routes.some(r => r.id === hovered));
    const taken = badgeObstacles();
    const routes = phase().routes;
    const shown = shownRoutes(ui.phase);
    // Of each player's options, the one that plays draws as the main plan: A, or the one chosen in Present mode.
    const played = new Set(playedRoutes(routes, playback.option));
    // Option badges are placed first, so the start-of-route badges make way for them.
    const badged = badgedRoutes(routes, state.players, ui.layers.steps);
    const sizes = { playerR: playerR(), badgeR: badgeR() };
    const ordered = [...routes.filter(r => r.option), ...routes.filter(r => !r.option)];
    const badgeAt = new Map();
    for (const r of ordered) {
      if (!badged.has(r)) continue;
      const b = r.option
        ? optionBadgePosition(shown(r), optionGroup(routes, r.from).filter(o => o !== r).map(shown), taken, sizes)
        : badgePosition(shown(r), routeGeometry(shown(r)), taken, sizes);
      taken.push({ ...b, r: badgeR() });
      badgeAt.set(r.id, b);
    }
    for (const r of routes) {
      const selected = isSelected('route', r.id);
      const focus = ui.optionFocus === r.id;
      const dim = faded(r.from) ? ' dim' : '';
      const hover = hovered === r.id;
      const extra = `${r.option && !played.has(r) ? ' option-alt' : ''}${focus ? ' option-focus' : ''}${hover ? ' hover-focus' : ''}${dim}`;
      const cls = `route${selected ? ' selected' : ''}${isAttached(r) ? '' : ' loose'}${extra}`;
      const g = svgEl('g', { class: cls, 'data-kind': 'route', 'data-id': r.id }, layer);
      const drawn = shown(r);
      const geometry = routeGeometry(drawn);
      const { d } = drawnGeometry(drawn);
      svgEl('path', { d, class: 'route-hit', 'stroke-width': lineHit }, g);
      // Passes and kicks are seen above the players; their touch area stays under them, so a press on the
      // passer still picks up the passer.
      const lines = BALL_ROUTES.has(r.type) ? svgEl('g', { class: `route-line${extra}`, 'data-id': r.id }, layers.ballRoutes) : g;
      const width = ROUTE_TYPES[r.type]?.width ?? 0.3;
      if (focus) svgEl('path', { d, class: 'route-focus', 'stroke-width': width + 1.3 }, lines);
      else if (hover) svgEl('path', { d, class: 'route-hover', 'stroke-width': width + 1.3 }, lines);
      else if (selected) svgEl('path', { d, class: 'route-highlight', 'stroke-width': width + 0.9 }, lines);
      routePaths(lines, 'path', { d }, r.type);

      // Badges go in their own layer above the players, so a nearby player can't cover them.
      if (badgeAt.has(r.id)) {
        const b = badgeAt.get(r.id);
        const badge = svgEl('g', { class: `badge${hover ? ' hover-focus' : ''}${dim}`, 'data-kind': 'badge', 'data-id': r.id, transform: `translate(${b.x} ${b.y})${turn()}` }, layers.badges);
        svgEl('circle', { r: badgeR(), stroke: ROUTE_TYPES[r.type]?.color ?? '#fff' }, badge);
        // "2", or "2A" / "2B" for options.
        const text = `${r.order}${r.option ?? ''}`;
        const size = [1.1, 0.85, 0.7][Math.min(text.length, 3) - 1] * sizeScale();
        svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': round2(size) }, badge).textContent = text;
      }
      optionLabel(layers.badges, drawn, dim);

      // While a route tool is active the handles are hidden, so pressing on a player always starts a new route.
      if (selected && !ui.tool) renderHandles(drawn, geometry, ppm);
    }
    renderPreview(layer);
  }

  // An option's label (e.g. "if 13 bites"), small, just past the end of the route, kept upright and
  // anchored so it reads away from the route. Past the receiver's disc for a pass to a team-mate.
  function optionLabel(parent, r, extraClass = '') {
    const text = r.option && r.optionLabel?.trim();
    if (!text) return;
    const { control } = routeGeometry(r);
    const [ex, ey] = r.points[r.points.length - 1];
    let [tx, ty] = [ex - control.x, ey - control.y];
    const len = Math.hypot(tx, ty) || 1;
    [tx, ty] = [tx / len, ty / len];
    const gap = r.to ? playerR() + 0.7 : 1;
    // Direction on screen: vertical turns the pitch a quarter turn anticlockwise, (x, y) -> (y, -x).
    const [sx, sy] = state.orientation === 'vertical' ? [ty, -tx] : [tx, ty];
    const across = Math.abs(sx) >= Math.abs(sy);
    svgEl('text', {
      class: `option-label${extraClass}`,
      transform: `translate(${round2(ex + tx * gap)} ${round2(ey + ty * gap)})${turn()}`,
      'text-anchor': across ? (sx > 0 ? 'start' : 'end') : 'middle',
      'dominant-baseline': across ? 'central' : sy > 0 ? 'hanging' : 'alphabetic',
      'font-size': OPTION_LABEL_SIZE,
    }, parent).textContent = text;
  }

  // Click-to-draw: a faint line from the selected player to where the next click would end the route.
  // A pass aimed at a team-mate ends on them (they're ringed too).
  function renderPreview(layer) {
    const from = drawingFrom(ui, phase());
    if (!from || !ui.preview) return;
    // Where the new route will be drawn from: the end of their runs (a new run carries on from there, and a new
    // pass, the next step, leaves from there).
    const start = positionsAfter(phase().routes, phase().positions)[from];
    const end = ui.snapTo ? phase().positions[ui.snapTo] : ui.preview;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 0.5) return;
    const r = { points: [[start.x, start.y], [end.x, end.y]], curve: 0, to: ui.snapTo };
    const g = svgEl('g', { class: 'route-preview', 'pointer-events': 'none' }, layer);
    routePaths(g, 'path', { d: drawnGeometry(r).d }, ui.tool);
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

  // "I play": the chosen player's team-mates (and their routes) fade; the opposition stays at full strength.
  function faded(id) {
    if (!ui.focusPlayer || id === ui.focusPlayer) return false;
    const team = pid => state.players.find(p => p.id === pid)?.team;
    return !!id && team(id) === team(ui.focusPlayer);
  }

  // The discs go under the passes and kicks; the numbers go in their own layer above every route line, so a
  // line can cross a disc but never its number.
  function renderPlayers() {
    const layer = layers.players;
    layer.replaceChildren();
    layers.labels.replaceChildren();
    for (const p of state.players) {
      const pos = phase().positions[p.id];
      if (!pos) continue;
      const me = ui.focusPlayer === p.id;
      const dim = faded(p.id) ? ' dim' : '';
      const cls = `player ${p.team}${isSelected('player', p.id) ? ' selected' : ''}${dim}`;
      const transform = `translate(${pos.x} ${pos.y})${turn()}`;
      const g = svgEl('g', { class: cls, 'data-kind': 'player', 'data-id': p.id, transform }, layer);
      const R = playerR();
      svgEl('circle', { r: Math.max(R, PLAYER_R) * 1.6, class: 'hit' }, g); // bigger touch target
      if (ui.snap === p.id || ui.snapTo === p.id) svgEl('circle', { r: R + 0.55, class: 'snap-ring' }, g);
      if (me) svgEl('circle', { r: R + 0.75, class: 'me-ring' }, g);
      svgEl('circle', { r: R, class: 'body' }, g);
      playerText(svgEl('g', { class: `player-label ${p.team}${dim}`, 'data-id': p.id, transform }, layers.labels), p.label);
    }
  }

  function playerText(g, label) {
    svgEl('text', {
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': round2((label.length > 2 ? 0.85 : 1.2) * sizeScale()),
    }, g).textContent = label;
  }

  // The previous phase's routes and players, faintly, so you can see who moved where. The whole layer
  // ignores the pointer. Routes have no badges or handles, so nothing in it reads as the current phase.
  // Of a player's options only A, the plan the phase was built from, is shown.
  function renderGhost() {
    const layer = layers.ghost;
    layer.replaceChildren();
    const prev = state.phases[ui.phase - 1];
    // Not while playing or presenting: it's an editing aid.
    if (!ui.layers.ghost || !prev || ui.presenting || playback.playing) return;
    const routes = svgEl('g', { class: 'ghost-routes' }, layer);
    const shown = shownRoutes(ui.phase - 1);
    for (const r of prev.routes) {
      if (r.option && r.option !== 'A') continue;
      routePaths(routes, 'path', { d: drawnGeometry(shown(r)).d }, r.type);
      optionLabel(routes, shown(r));
    }
    for (const p of state.players) {
      const pos = prev.positions[p.id];
      if (!pos) continue;
      const g = svgEl('g', { class: `ghost ${p.team}`, 'data-ghost': p.id, transform: `translate(${pos.x} ${pos.y})${turn()}` }, layer);
      svgEl('circle', { r: playerR() }, g);
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

  // A set piece's drag block (S for a scrum, L for a lineout) shows only while it or one of its players is selected.
  function groupActive(o) {
    const sel = ui.selected;
    return !!sel && ((sel.kind === 'object' && sel.id === o.id) || (sel.kind === 'player' && o.pack.includes(sel.id)));
  }

  // The drag block of a scrum or lineout, at (x, y) from its mark. Pressing it drags the whole set piece.
  function groupTab(g, x, y, letter, selected, name) {
    const tab = svgEl('g', { transform: `translate(${x} ${y})`, class: 'group-tab', 'aria-label': name }, g);
    svgEl('title', {}, tab).textContent = name;
    svgEl('circle', { r: 1.9, class: 'hit' }, tab);
    if (selected) svgEl('circle', { r: 1.9, class: 'select-ring' }, tab);
    svgEl('rect', { x: -1.2, y: -1.2, width: 2.4, height: 2.4, rx: 0.4, class: 'outline' }, tab);
    label(tab, letter);
  }

  // Markers go under the routes and players; balls go in their own layer above the players, so a player
  // holding the ball never hides it.
  function renderObjects() {
    layers.objects.replaceChildren();
    layers.balls.replaceChildren();
    for (const o of phase().objects) {
      const layer = o.type === 'ball' ? layers.balls : layers.objects;
      const g = svgEl('g', { class: `marker ${o.type}`, 'data-kind': 'object', 'data-id': o.id, transform: `translate(${o.x} ${o.y})` }, layer);
      const selected = isSelected('object', o.id);

      if (o.type === 'scrum' && o.pack) {
        // Scrum preset: the mark between the front rows, and (when active) an "S" block clear of the
        // packs, which cover the mark, to drag the whole scrum by. The ball is its own object.
        svgEl('line', { x1: 0, y1: -3.8, x2: 0, y2: 3.8, class: 'scrum-mark' }, g);
        if (!groupActive(o)) continue;
        const side = o.putIn === 'defense' ? 1 : -1; // the ball's side; the block goes on the other
        groupTab(g, 0, -side * 6.5, 'S', selected, 'Drag to move the scrum');
        continue;
      }

      if (o.type === 'lineout' && o.pack) {
        // Lineout preset: the marker on the 5 m line, which can be selected and dragged, and (when active) an
        // "L" block beside the defense's line, into the field, to drag the whole lineout by.
        svgEl('circle', { r: 2.4, class: 'hit' }, g);
        if (selected) svgEl('circle', { r: 2.4, class: 'select-ring' }, g);
        drawLineoutMark(g);
        if (groupActive(o)) groupTab(g, 5, (o.y <= 35 ? 1 : -1) * 5, 'L', selected, 'Drag to move the lineout');
        continue;
      }

      const ringR = o.type === 'ball' ? 1.4 : 3;
      svgEl('circle', { r: ringR, class: 'hit' }, g);
      if (selected) svgEl('circle', { r: ringR, class: 'select-ring' }, g);

      if (o.type === 'ball') {
        drawBall(g);
      } else if (o.type === 'ruck') {
        svgEl('circle', { r: 2, class: 'outline' }, g);
        label(g, 'R');
      } else if (o.type === 'scrum') {
        // Plain scrum marker from older plays.
        svgEl('rect', { x: -2.5, y: -1.5, width: 5, height: 3, class: 'outline' }, g);
        label(g, 'S');
      } else if (o.type === 'lineout') {
        drawLineoutMark(g);
        label(g, 'L', 0, -2.9);
      }
    }
  }

  return {
    drawScene, shownRoutes, presentCueTick, clearPresentCues, pxPerMetre, playerR, badgeR,
    // Where Layers → Direction's arrow is drawn now, or null.
    directionAt: () => directionAt,
    // The next drawScene() redraws the pitch too.
    redrawPitch: () => { pitchKey = ''; },
  };
}
