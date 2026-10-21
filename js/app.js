// App state, toolbar wiring and redraw. The editor changes state, then render() redraws the SVG from it.
// render() is also where changes are recorded: it commits an undo step (unless a drag is in progress)
// and schedules the autosave, so every change to the play is undoable and saved without extra wiring.
// Redraws that only show hover feedback pass { record: false } and record nothing.
// The larger parts live in their own modules, each set up here with what it needs: the pitch's drawing
// (scene.js), the open play and library (open-play.js), the boxes over the pitch (pitch-edits.js), the
// exports (exporting.js, share-dialog.js), the side panel's cues (cue-panel.js), the drawing hint
// (draw-hint.js) and Templates, About, Welcome and Paste play (start.js).

import {
  routeSample, viewCentre, viewRange, isHalf, startSpot, directionBox, uprightTurn, buildArrowMarkers, BOUNDS, ROUTE_TYPES,
} from './pitch.js';
import { initEditor } from './editor.js';
import { placeScrum, moveScrum, placeLineout, moveLineout } from './setpiece.js';
import { appendPhase, insertPhaseAfter, movePhase } from './phases.js';
import { createHistory } from './history.js';
import { blankPlay, downloadPlay, readPlayFile, safeFileName, INSTRUCTION_MAX } from './storage.js';
import { syncOptions, optionLetters } from './options.js';
import { nextId, round1, BALL_ROUTES, MOVING_ROUTES } from './model.js';
import { createPlayback } from './playback.js';
import { autoJob } from './jobs.js';
import { readLogoSettings, saveLogoSettings, logoSrc, readLogoFile, sanitizeSvg, LOGO_KEY, TEAM_NAME_MAX } from './logo.js';
import { initPresent } from './present.js';
import { createScene, PLAYER_SIZES } from './scene.js';
import { createExporting } from './exporting.js';
import { createShareDialog } from './share-dialog.js';
import { createCuePanel } from './cue-panel.js';
import { createDrawHint } from './draw-hint.js';
import { createPitchEdits } from './pitch-edits.js';
import { closeOnClickOutside, askConfirm } from './dialogs.js';
import { createStart } from './start.js';
import { createOpenPlay } from './open-play.js';

const MAX_PER_TEAM = 15;
// Layers → Player size (scene.js PLAYER_SIZES): a setting of this browser, not of the play; pictures and PDFs
// use the size on screen.
const PLAYER_SIZE_KEY = 'rugby-play-designer.player-size';
// Layers → Step numbers: whether route order badges are shown, on screen and in every export. Also a
// setting of this browser, not of the play.
const STEP_NUMBERS_KEY = 'rugby-play-designer.step-numbers';
// A phone held upright gets the vertical pitch; anything else starts horizontal.
const portraitPhone = matchMedia('(max-width: 700px) and (orientation: portrait)');
// Phones and tablets: a saved picture goes to the share sheet rather than a download.
const touchScreen = matchMedia('(pointer: coarse)');
// The phone layout (toolbar at the bottom): pickers open in the middle of the screen, not by their button.
const phoneLayout = matchMedia('(max-width: 700px)');

// The play. Always the same object (window.playState): undo, load and New play replace its contents.
const state = blankPlay({ orientation: portraitPhone.matches ? 'vertical' : 'horizontal' });
window.playState = state;

// UI-only state, not part of the saved play.
const ui = {
  phase: 0, // index of the phase being shown
  tool: null,
  selected: null,
  dragging: false,
  snap: null, // player a route being drawn will attach to (highlighted)
  snapTo: null, // receiver a pass being drawn will end on (highlighted)
  preview: null, // click-to-draw: where the next route would end, { x, y }
  optionFocus: null, // the route whose option box is open, highlighted on the pitch
  layers: { distances: true, grid: false, legend: true, ghost: true, direction: true, steps: readStepNumbers() },
  orientationChosen: false, // once the user picks one, stop following the phone's rotation
  presenting: false, // Present mode
  focusPlayer: null, // Present mode's "I play": the rest of that player's team fades
  exporting: false, // a PNG or PDF is being made: editing waits until it's done
  // Waiting for "click where it goes": { kind: 'player', team, n } after a number is picked, or
  // { kind: 'scrum' | 'lineout', team } after a set piece is chosen. The next press on the pitch places it.
  placing: null,
  hoverRoute: null, // the route whose badge the mouse is over: it's highlighted and the others fade
  orderEdit: null, // the route whose order number is being typed: highlighted the same way
  playerSize: readPlayerSize(),
};

function readPlayerSize() {
  try {
    const saved = localStorage.getItem(PLAYER_SIZE_KEY);
    return saved in PLAYER_SIZES ? saved : 'medium';
  } catch {
    return 'medium';
  }
}
function readStepNumbers() {
  try { return localStorage.getItem(STEP_NUMBERS_KEY) !== 'off'; } catch { return true; }
}
function saveStepNumbers(on) {
  try { localStorage.setItem(STEP_NUMBERS_KEY, on ? 'on' : 'off'); } catch { /* storage blocked: it lasts until the page closes */ }
}
function savePlayerSize(size) {
  try { localStorage.setItem(PLAYER_SIZE_KEY, size); } catch { /* storage blocked: it lasts until the page closes */ }
}

const $ = id => document.getElementById(id);
const svg = $('pitch');
const world = $('world');
const legend = $('legend');
const layers = {
  pitch: $('pitch-layer'),
  direction: $('direction-layer'),
  ghost: $('ghost-layer'),
  objects: $('objects-layer'),
  routes: $('routes-layer'),
  players: $('players-layer'),
  ballRoutes: $('ball-routes-layer'),
  labels: $('labels-layer'),
  balls: $('ball-layer'),
  badges: $('badges-layer'),
  cues: $('cue-layer'),
  handles: $('handles-layer'),
  edges: $('edge-layer'),
  pen: $('pen-layer'),
};
const inputs = { name: $('play-name'), category: $('play-category'), tags: $('play-tags'), note: $('phase-note'), instruction: $('player-instruction') };
// Boxes that are typed in (or picked from, for the details): focusing one stops the play (see initTopbar).
const TEXT_FIELDS = 'textarea, select, input:not([type]), input[type="text"], input[type="search"], input[type="number"]';

const phase = () => state.phases[ui.phase];
// Editing is off while the play is playing or a picture is being made (the toolbar, undo, phase editing and
// the play's details grey out), and on the pitch also while presenting.
const busy = () => playback.playing || ui.exporting;
const locked = () => busy() || ui.presenting;
const isSelected = (kind, id) => ui.selected?.kind === kind && ui.selected.id === id;
const turn = () => uprightTurn(state.orientation);

// keepTools (undo/redo) keeps the route tool and the selection, so undoing one click-drawn route doesn't
// stop click-to-draw. A selection that no longer exists is dropped at the next redraw.
function replacePlay(play, phaseIndex = 0, { keepTools = false } = {}) {
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, structuredClone(play));
  ui.phase = Math.min(Math.max(0, phaseIndex), state.phases.length - 1);
  if (!keepTools) {
    ui.selected = null;
    ui.tool = null;
  }
  inputsStale = true;
}

const history = createHistory({
  read: () => ({ play: JSON.stringify(state), phase: ui.phase }),
  write: (json, phaseIndex) => replacePlay(JSON.parse(json), phaseIndex, { keepTools: true }),
});

// Playing the play, and Present mode. Both are drawn by render(), which calls them back.
const playback = createPlayback({
  state, ui, layers, turn,
  show: i => { ui.phase = i; ui.tool = null; render(); },
  changed: () => render(),
  tick: (...args) => scene.presentCueTick(...args),
});
const scene = createScene({ state, ui, svg, world, legend, layers, phase, playback, locked, isSelected, turn });
const { drawScene, shownRoutes, clearPresentCues, playerR } = scene;
// Boxes over the pitch: a label or order number typed in place, an option's box and the route bar.
const { editLabel, editOrder, updateRouteBar, initOptionDialog, initRouteBar, finishEdit } = createPitchEdits({
  state, ui, phase, render, svg, world, layers, scene, stepText, deleteSelected, phoneLayout,
});
const present = initPresent({ state, ui, svg, world, penLayer: layers.pen, render, phase, playback });
// For tests and debugging, like window.playState.
window.rugbyPlayback = playback;
window.rugbyPresent = present;

// The team logo: a setting of this browser, not of the play (see logo.js), so it never goes in the play,
// its files, the autosave or the undo history.
let teamLogo = readLogoSettings();

// File → Save image, Save PDF and Save animation.
const { savePdf, openAnimationDialog, initAnimationDialog, initImageDialog } = createExporting({
  state, ui, svg, layers, scene, playback, render, finishEdit, showToast, busy,
  teamLogo: () => teamLogo, touchScreen, turn,
});
// The open play, its autosave, the play library and the Plays panel.
const {
  scheduleAutosave, flushAutosave, createAndOpen, replaceOpenPlay, openPlays, initTabs, initPlays, openStartPlay, openBlank,
} = createOpenPlay({
  state, ui, history, replacePlay, render, playback, present, busy, finishEdit, showToast, refreshInputs: () => { inputsStale = true; },
});
// Templates, About, Welcome, the AI play guide and Paste play.
const {
  openPasteDialog, initPasteDialog, initGuideLinks, initTemplatesDialog, openAbout, initAboutDialog, initWelcomeDialog,
} = createStart({ state, ui, busy, playback, showToast, createAndOpen, replaceOpenPlay });
// The status line's hint while drawing or placing.
const { updateDrawHint, fitHint } = createDrawHint({ state, ui, phase, playerName, touchScreen, showToast });
// The selected player's cues, in the side panel.
const { syncCues, initCues } = createCuePanel({ state, ui, phase, locked, render });
// File → Share link.
const { open: openShareDialog, init: initShareDialog } = createShareDialog({ state, teamLogo: () => teamLogo });

// A short message in the status line under the pitch: an error (the default), or `ok` for "Saved …".
// action: an optional button after the message, { label, run }; pressing it runs it and closes the toast.
// keepWhile: instead of fading after a few seconds, the toast stays up for as long as keepWhile() holds
// (checked after every render).
function showToast(message, kind = 'error', action = null, keepWhile = null) {
  const toast = $('toast');
  toast.classList.toggle('ok', kind === 'ok');
  toast.setAttribute('role', kind === 'ok' ? 'status' : 'alert');
  toast.textContent = message;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-action';
    b.textContent = action.label;
    b.addEventListener('click', () => { hideToast(); action.run(); });
    toast.append(' ', b);
  }
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.keepWhile = keepWhile;
  if (!keepWhile) showToast.timer = setTimeout(hideToast, action ? 8000 : 5000);
}
function hideToast() {
  clearTimeout(showToast.timer);
  showToast.keepWhile = null;
  $('toast').hidden = true;
  fitHint();
}
// A kept toast whose reason has gone (see showToast's keepWhile).
function dropKeptToast() {
  if (showToast.keepWhile && !showToast.keepWhile()) hideToast();
}

// Click-to-draw: a click on another player made them the start instead of ending the route on their spot.
// Say so, and offer to end the route there after all (a drift one channel across, onto a team-mate's spot).
function startSwitched(from, to) {
  const tool = ui.tool;
  const at = { ...phase().positions[to] };
  const where = ui.phase;
  const action = tool && tool !== 'pass' ? {
    label: `End ${playerName(from)}'s ${ROUTE_TYPES[tool]?.label.toLowerCase() ?? 'route'} on ${playerName(to)}'s spot`,
    run: () => {
      if (!applies()) return;
      if (editor.drawTo(from, at)) render();
    },
  } : null;
  // The same route tool, phase and start, both players still there, and not playing.
  const applies = () => ui.tool === tool && ui.phase === where && !locked() && isSelected('player', to)
    && state.players.some(p => p.id === from) && state.players.some(p => p.id === to);
  // With the offer, the message stays up while it still applies; a plain one fades as usual.
  showToast(`Now drawing from ${playerName(to)}.`, 'ok', action, action && applies);
}

// --- Rendering ---

let renderFrame = 0;

// `commitKey` groups typing in one text box into a single undo step. `record: false` is for redraws that
// change nothing in the play (hover hints): no undo snapshot, no autosave.
function render(commitKey = null, { record = true } = {}) {
  cancelAnimationFrame(renderFrame);
  renderFrame = 0;
  if (!ui.tool && !ui.dragging) ui.snap = null;
  if (!ui.dragging && !ui.preview) ui.snapTo = null;
  drawScene();
  updateToolbar();
  updatePhaseBar();
  syncInputs();
  updateRouteBar();
  updatePlayControls();
  present.update();
  if (!ui.presenting || !ui.focusPlayer || !(playback.playing || playback.paused)) clearPresentCues();
  syncHash();

  if (record && !ui.dragging) {
    history.commit(commitKey);
    scheduleAutosave();
  }
  updateHistoryButtons();
  playback.afterRender();
  updateEndOfPlay();
  dropKeptToast();
  if (drawnNote) { showToast(drawnNote, 'ok'); drawnNote = null; }
}

// After the last phase has played (Loop off): "End of play" and Replay in the status line, until the play is
// edited, another phase is shown, or Play is pressed (each drops the end frame).
function updateEndOfPlay() {
  $('end-of-play').hidden = !playback.ended || ui.presenting;
}

// A run, decoy, drift or blitz moves with the latest step: say so when it shares that step with other routes.
// One from a player who already had one carries it on, as the next step: say that instead.
let drawnNote = null;
function drew(route) {
  if (BALL_ROUTES.has(route.type) || !Number.isFinite(route.order)) return;
  const before = route.from && phase().routes.find(r => r !== route && r.from === route.from && MOVING_ROUTES.has(r.type));
  if (before) {
    drawnNote = `Continues ${playerName(route.from)}'s ${ROUTE_TYPES[before.type].label.toLowerCase()} as step ${route.order}.`;
    return;
  }
  if (!phase().routes.some(r => r !== route && r.order === route.order)) return;
  drawnNote = `Runs with step ${route.order}. Change the number to run before or after.`;
}

// "12", or "defender 1" when both teams have a 1.
function playerName(id) {
  const player = state.players.find(p => p.id === id);
  if (!player) return '';
  const shared = state.players.some(p => p !== player && p.label === player.label);
  return shared ? `${player.team === 'attack' ? 'attacker' : 'defender'} ${player.label}` : player.label;
}

// "pass 9 to 10", "run 12", "kick" (from open grass).
function routeName(r) {
  const label = id => state.players.find(p => p.id === id)?.label;
  const from = r.from && label(r.from);
  const to = r.to && label(r.to);
  return [ROUTE_TYPES[r.type]?.label.toLowerCase() ?? 'route', from, to && `to ${to}`].filter(Boolean).join(' ');
}

// The route bar's "Step 2, together with: pass 9 to 10": the routes that start at the same step. A player's
// other options are alternatives, not together, so they're left out.
function stepText(route) {
  if (!Number.isFinite(route.order)) return '';
  const together = phase().routes.filter(r => r !== route && r.order === route.order && !(route.option && r.option && r.from === route.from));
  return `Step ${route.order}${together.length ? `, together with: ${together.map(routeName).join(', ')}` : ''}`;
}

// During a drag: one redraw per animation frame, however many pointer moves there are.
function renderSoon() {
  renderFrame ||= requestAnimationFrame(() => { renderFrame = 0; render(); });
}
const renderHint = () => render(null, { record: false });

// Switching to Half shows the half where most of the shown phase's players are (the half attack plays into
// on a tie).
function busierHalf() {
  const xs = Object.values(phase().positions).map(p => p.x);
  return xs.filter(x => x < 50).length > xs.filter(x => x > 50).length ? 'half-own' : 'half';
}

function updateToolbar() {
  const count = team => state.players.filter(p => p.team === team).length;
  // Editing is locked while playing or exporting.
  for (const b of document.querySelectorAll('.toolbar .group button')) b.disabled = busy();
  document.querySelector('[data-action="add-attack"]').disabled ||= count('attack') >= MAX_PER_TEAM;
  document.querySelector('[data-action="add-defense"]').disabled ||= count('defense') >= MAX_PER_TEAM;
  document.querySelector('[data-action="delete"]').disabled ||= !ui.selected;
  $('templates-button').disabled = busy();
  $('plays-button').disabled = busy();
  $('present-button').disabled = ui.exporting;
  // The File menu is inert and closed. The play's name and details stay usable while playing (focusing one
  // stops the play, see initTopbar), but not while a picture is being made.
  const fileMenu = $('file-menu');
  fileMenu.inert = busy();
  if (busy()) fileMenu.open = false;
  for (const el of [inputs.name, inputs.category, inputs.tags, $('details-button')]) el.disabled = ui.exporting;
  if (ui.exporting && $('play-details').matches(':popover-open')) $('play-details').hidePopover();
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', b.dataset.view === 'half' ? isHalf(state.view) : state.view === b.dataset.view);
  for (const b of document.querySelectorAll('[data-orientation]')) b.setAttribute('aria-pressed', b.dataset.orientation === state.orientation);
  for (const b of document.querySelectorAll('[data-route]')) b.setAttribute('aria-pressed', b.dataset.route === ui.tool);
  for (const c of document.querySelectorAll('[data-layer]')) c.checked = ui.layers[c.dataset.layer];
  svg.classList.toggle('drawing', !!ui.tool || !!ui.placing);
  for (const r of document.querySelectorAll('[name="player-size"]')) r.checked = r.value === ui.playerSize;
  // The other half: it keeps its slot in the top bar when hidden (see styles.css), so nothing beside it shifts.
  const flip = $('flip-half');
  flip.hidden = !isHalf(state.view);
  flip.disabled = busy();
  updateDrawHint();
  updateSelectionStatus();
}

// "Selected: 9", "Selected: ball", "Selected: ruck", "Selected: 10's pass to 12" in the status line. The
// drawing hint, a message and End of play each take its place while they're up (see styles.css).
function updateSelectionStatus() {
  const line = $('selection-status');
  const sel = ui.selected;
  let what = '';
  if (sel && !locked()) {
    if (sel.kind === 'player') what = playerName(sel.id);
    else if (sel.kind === 'object') what = phase().objects.find(o => o.id === sel.id)?.type ?? '';
    else if (sel.kind === 'route') {
      const r = phase().routes.find(q => q.id === sel.id);
      const type = r && (ROUTE_TYPES[r.type]?.label.toLowerCase() ?? 'route');
      if (r) what = [r.from ? `${playerName(r.from)}'s ${type}` : type, r.to && `to ${playerName(r.to)}`].filter(Boolean).join(' ');
    }
  }
  line.hidden = !what;
  line.textContent = what ? `Selected: ${what}` : '';
  line.title = line.textContent;
}

function updateHistoryButtons() {
  document.querySelector('[data-action="undo"]').disabled = !history.canUndo || locked();
  document.querySelector('[data-action="redo"]').disabled = !history.canRedo || locked();
}

let shownPhase = -1;

function updatePhaseBar() {
  const n = state.phases.length;
  const tabs = $('phase-tabs');
  if (tabs.children.length !== n) {
    tabs.replaceChildren(...state.phases.map((_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.phase = 'goto';
      b.dataset.index = i;
      b.textContent = i + 1;
      b.setAttribute('aria-label', `Phase ${i + 1}`);
      return b;
    }));
  }
  [...tabs.children].forEach((b, i) => b.setAttribute('aria-current', i === ui.phase ? 'step' : 'false'));
  if (shownPhase !== ui.phase) {
    shownPhase = ui.phase;
    tabs.children[ui.phase]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  $('phase-count').textContent = `Phase ${ui.phase + 1} of ${n}`;
  const btn = name => document.querySelector(`[data-phase="${name}"]`);
  btn('prev').disabled = ui.phase === 0;
  btn('next').disabled = ui.phase === n - 1;
  btn('left').disabled = ui.phase === 0;
  btn('right').disabled = ui.phase === n - 1;
  btn('delete').disabled = n === 1;
  btn('add').disabled = false;
  btn('insert').disabled = false;
  // While playing (or exporting) only moving between phases works; the phases can't be changed.
  if (busy()) for (const name of ['add', 'left', 'right', 'insert', 'delete']) btn(name).disabled = true;
  // While playing the note can still be typed in: focusing it stops the play (see initTopbar).
  inputs.note.disabled = ui.exporting;
}

// Play/Pause, speed and Loop. Tooltips only outside Present mode, so nothing pops up on a recording.
function updatePlayControls() {
  document.body.classList.toggle('playing', playback.playing);
  const play = $('play-button');
  play.setAttribute('aria-label', playback.playing ? 'Pause' : 'Play');
  // U+FE0E asks for the plain text glyph, not an emoji, so both icons match the label's colour and size.
  play.querySelector('.play-icon').textContent = playback.playing ? '⏸\uFE0E' : '▶\uFE0E';
  play.querySelector('.play-text').textContent = playback.playing ? 'Pause' : 'Play';
  for (const b of document.querySelectorAll('[data-speed]')) b.setAttribute('aria-pressed', Number(b.dataset.speed) === playback.speed);
  document.querySelector('[data-play="loop"]').setAttribute('aria-pressed', playback.loop);
  updateOptionButtons();
  for (const b of document.querySelectorAll('#play-controls [data-tip]')) {
    if (ui.presenting) b.removeAttribute('title');
    else b.title = b.dataset.tip;
  }
}

// Present mode: "Option A / B / C" when the shown phase has pass or kick options. Choosing one plays the
// phase with it (the ball follows it) and stops at the phase's end; A is the main plan.
function updateOptionButtons() {
  const box = $('option-buttons');
  const letters = optionLetters(phase().routes);
  box.hidden = letters.length < 2;
  if (box.dataset.letters !== letters.join()) {
    box.dataset.letters = letters.join();
    box.replaceChildren(...letters.map(letter => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.option = letter;
      b.textContent = `Option ${letter}`;
      return b;
    }));
  }
  for (const b of box.children) b.setAttribute('aria-pressed', b.dataset.option === playback.option && (playback.playing || playback.paused));
}

// The address shows the phase (#phase=2), so a link opens on it.
function syncHash() {
  const hash = `#phase=${ui.phase + 1}`;
  if (location.hash !== hash) window.history.replaceState(null, '', hash);
}
function hashPhase() {
  const m = /^#phase=(\d+)$/.exec(location.hash);
  return m ? Math.min(Math.max(Number(m[1]), 1), state.phases.length) - 1 : null;
}

// Text boxes follow the state, except the one being typed in. But when the play is replaced (undo, load,
// New play) or the note box's phase changes, every box is refreshed even if it has the focus: Safari keeps
// the focus in a text box when a button is tapped, and a stale box would write its old text over the new
// play or phase on the next keystroke.
let inputsStale = true;
let notePhase = null; // the phase object whose note the note box shows
let instructionKey = null; // the player and phase whose instruction the box shows
function syncInputs() {
  const force = inputsStale;
  const forceNote = force || notePhase !== phase();
  inputsStale = false;
  notePhase = phase();
  const set = (el, value, always) => { if ((always || document.activeElement !== el) && el.value !== value) el.value = value; };
  set(inputs.name, state.name, force);
  $('title-size').dataset.value = inputs.name.value;
  // A long name is shortened with "…" in the top bar; the tooltip has all of it.
  inputs.name.title = inputs.name.value;
  set(inputs.category, state.category, force);
  set(inputs.tags, state.tags.join(', '), force);
  if (inputs.note.value !== phase().note || forceNote) set(inputs.note, phase().note, forceNote);
  // One player selected (and editing on): their job for this phase, in the side panel, with the one made
  // from their routes as the placeholder (what the phone viewer shows when the box is empty), and their cues.
  const sel = ui.selected?.kind === 'player' && !locked() ? state.players.find(p => p.id === ui.selected.id) : null;
  $('instruction-group').hidden = !sel;
  if (sel) {
    const key = [sel.id, ui.phase].join();
    $('instruction-title').textContent = 'Your job';
    inputs.instruction.setAttribute('aria-label', `${sel.label}'s job in this phase`);
    inputs.instruction.placeholder = `${sel.label}: ${autoJob(state, ui.phase, sel.id)}`;
    set(inputs.instruction, phase().instructions?.[sel.id] ?? '', force || instructionKey !== key);
    instructionKey = key;
  } else {
    instructionKey = null;
  }
  syncCues(sel);
  // Selecting a player brings their job and cues into view in the side panel (it scrolls by itself only
  // when another player is selected, so scrolling it by hand afterwards sticks).
  if (sel && sel.id !== jobBoxFor) revealJobBox();
  jobBoxFor = sel?.id ?? null;
}
let jobBoxFor = null;
let editor = null; // initEditor's: drawTo // the player whose job box was last brought into view

// Scrolls the side panel (not the page) the least it takes to show the whole job and cues box: down (or, on
// a phone, where the panel is a row, sideways) so its end is in view, but never so far its start goes.
function revealJobBox() {
  const bar = document.querySelector('.toolbar');
  const box = $('instruction-group').getBoundingClientRect();
  const view = bar.getBoundingClientRect();
  const margin = 8;
  if (matchMedia('(max-width: 700px)').matches) {
    const over = Math.min(box.right + margin - view.right, box.left - margin - view.left);
    if (over > 0) bar.scrollLeft += over;
    else if (box.left < view.left) bar.scrollLeft -= view.left - box.left + margin;
  } else {
    const over = Math.min(box.bottom + margin - view.bottom, box.top - margin - view.top);
    if (over > 0) bar.scrollTop += over;
    else if (box.top < view.top) bar.scrollTop -= view.top - box.top + margin;
  }
}

// --- Actions ---

// Free numbers (1-15) for a team, lowest first.
function freeNumbers(team) {
  return Array.from({ length: MAX_PER_TEAM }, (_, i) => i + 1).filter(n => !state.players.some(p => p.id === playerId(team, n)));
}
// Player n of `team` is always "a<n>" or "d<n>".
const playerId = (team, n) => (team === 'attack' ? 'a' : 'd') + n;

// Adds player n of `team` at `at` (where the user clicked), or at their usual spot.
function addPlayer(team, n, at = null) {
  const id = playerId(team, n);
  if (!freeNumbers(team).includes(n)) return;
  const spot = at ? { x: round1(at.x), y: round1(at.y) } : defaultSpot(team, n);
  state.players.push({ id, team, label: String(n) });
  // A player is one person across the whole play: they're in every phase, at the same spot.
  for (const each of state.phases) each.positions[id] = { ...spot };
  ui.selected = { kind: 'player', id };
}

// A new player's usual spot: each team lined up across the shown view (startSpot), or, if another player
// or the direction arrow is there, the nearest clear spot around it in the view.
function defaultSpot(team, n) {
  const start = startSpot(team, n, state.view);
  const R = playerR();
  const { minX, maxX } = viewRange(state.view);
  const arrow = ui.layers.direction ? directionBox(state.view, state.orientation, scene.directionAt() ?? undefined) : null;
  const others = Object.values(phase().positions);
  const clear = p => p.x >= Math.max(minX, BOUNDS.minX) + R && p.x <= Math.min(maxX, BOUNDS.maxX) - R
    && p.y >= R && p.y <= 70 - R
    && others.every(o => Math.hypot(o.x - p.x, o.y - p.y) >= 2 * R + 0.3)
    && !(arrow && p.x + R + 0.2 > arrow.minX && p.x - R - 0.2 < arrow.maxX && p.y + R + 0.2 > arrow.minY && p.y - R - 0.2 < arrow.maxY);
  if (clear(start)) return start;
  for (let ring = 1; ring <= 8; ring++) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * 2 * Math.PI;
      const p = { x: round1(start.x + Math.cos(a) * ring * 2.6), y: round1(start.y + Math.sin(a) * ring * 2.6) };
      if (clear(p)) return p;
    }
  }
  return start;
}

function addObject(type) {
  const c = viewCentre(state.view);
  const n = phase().objects.length;
  const id = nextId('o', phase().objects);
  // Spread new markers in a small grid so they don't stack on top of each other.
  phase().objects.push({ id, type, x: c.x - 9 + (n % 4) * 6, y: c.y - 6 + (Math.floor(n / 4) % 3) * 6 });
  ui.selected = { kind: 'object', id };
}

function addLineout(throwIn, at) {
  const marker = placeLineout(state, phase(), at, throwIn);
  ui.selected = { kind: 'object', id: marker.id };
  ui.tool = null;
}

function addScrum(putIn, at) {
  const scrum = placeScrum(state, phase(), at, putIn);
  ui.selected = { kind: 'object', id: scrum.id };
  ui.tool = null;
}

// "Click where it goes": a player waiting to be placed (after their number is picked) or a set piece (after
// Scrum or Lineout is chosen). The next press on the pitch places it there, as one undo step.
function startPlacing(what) {
  ui.placing = what;
  ui.tool = null;
  // The picker or Set piece box just closed, and its button may keep the focus: move it off, so keys
  // (Escape) reach the page.
  if (document.activeElement?.closest('dialog')) document.activeElement.blur();
  render(null, { record: false });
}

function place(at) {
  const what = ui.placing;
  ui.placing = null;
  if (what?.kind === 'player') addPlayer(what.team, what.n, at);
  else if (what?.kind === 'scrum') addScrum(what.team, at);
  else if (what?.kind === 'lineout') addLineout(what.team, at);
  render();
}

// Anything else done while waiting (Escape, another button, a key) settles it first: a player goes to their
// usual spot, so a picked number is never lost; a set piece is cancelled.
function settlePlacing() {
  const what = ui.placing;
  if (!what) return;
  ui.placing = null;
  if (what.kind === 'player') {
    addPlayer(what.team, what.n);
    render();
  } else {
    render(null, { record: false });
  }
}

function moveObject(o, x, y) {
  if (o.type === 'scrum') moveScrum(phase(), o, x, y);
  else if (o.type === 'lineout' && o.pack) moveLineout(phase(), o, x);
  else Object.assign(o, { x, y });
}

function deleteSelected() {
  const sel = ui.selected;
  if (!sel) return;
  const ph = phase();
  if (sel.kind === 'player') {
    // A player is one person across the whole play, so they leave every phase.
    state.players = state.players.filter(p => p.id !== sel.id);
    for (const each of state.phases) {
      delete each.positions[sel.id];
      if (each.instructions) {
        delete each.instructions[sel.id];
        if (!Object.keys(each.instructions).length) delete each.instructions;
      }
      if (each.cues) {
        each.cues = each.cues.filter(c => c.player !== sel.id);
        if (!each.cues.length) delete each.cues;
      }
      for (const o of each.objects) if (o.pack) o.pack = o.pack.filter(id => id !== sel.id);
      // Passers who lose a pass to this player may be down to one option.
      const passers = each.routes.filter(r => r.to === sel.id).map(r => r.from);
      each.routes = each.routes.filter(r => r.from !== sel.id && r.to !== sel.id);
      syncOptions(each.routes, passers);
    }
  } else if (sel.kind === 'route') {
    const route = ph.routes.find(r => r.id === sel.id);
    ph.routes = ph.routes.filter(r => r.id !== sel.id);
    // The remaining options close up their letters; a single one left is a normal route again.
    if (route) syncOptions(ph.routes, [route.from]);
  } else if (sel.kind === 'object') {
    ph.objects = ph.objects.filter(o => o.id !== sel.id);
  }
  ui.selected = null;
}

// "Add attack" / "Add defender": the numbers not yet used, the next free one highlighted (Enter adds it).
// On a computer it opens beside its button; on a phone in the middle of the screen.
function openNumberPicker(team, button) {
  const dialog = $('number-dialog');
  const free = freeNumbers(team);
  if (!free.length) return;
  dialog.dataset.team = team;
  $('number-title').textContent = team === 'attack' ? 'Add attacker' : 'Add defender';
  const grid = $('number-grid');
  grid.className = `number-grid ${team}`;
  grid.replaceChildren(...Array.from({ length: MAX_PER_TEAM }, (_, i) => {
    const n = i + 1;
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.n = n;
    b.textContent = n;
    b.disabled = !free.includes(n);
    if (n === free[0]) b.classList.add('next');
    b.setAttribute('aria-label', `Number ${n}${b.disabled ? ' (in use)' : ''}`);
    return b;
  }));
  dialog.style.cssText = '';
  dialog.returnValue = '';
  dialog.showModal();
  if (!phoneLayout.matches) {
    const r = button.getBoundingClientRect();
    const top = Math.min(r.top, innerHeight - dialog.offsetHeight - 8);
    dialog.style.cssText = `margin: 0; inset: auto; left: ${r.right + 8}px; top: ${Math.max(8, top)}px;`;
  }
  grid.querySelector('.next').focus();
}

function initNumberPicker() {
  const dialog = $('number-dialog');
  $('number-grid').addEventListener('click', e => {
    const b = e.target.closest('[data-n]');
    if (!b || b.disabled) return;
    dialog.close();
    startPlacing({ kind: 'player', team: dialog.dataset.team, n: Number(b.dataset.n) });
  });
  closeOnClickOutside(dialog);
}

// Turning the pitch is a view choice, not an edit: it changes every undo and redo snapshot too (rebase), so
// it adds no undo step, keeps redo, and undo never turns the pitch back.
const ORIENTATION_JSON = /"orientation":"(horizontal|vertical)"/;
function setOrientation(orientation) {
  if (state.orientation === orientation) return;
  state.orientation = orientation;
  history.rebase(json => json.replace(ORIENTATION_JSON, `"orientation":"${orientation}"`));
  render();
}

function goToPhase(i) {
  if (i < 0 || i >= state.phases.length || i === ui.phase) return;
  ui.phase = i;
  ui.tool = null;
}

// Phase bar actions. Each returns after changing state; the caller re-renders, which records one undo step.
function phaseAction(action, index) {
  const i = ui.phase;
  const phases = state.phases;
  if (action === 'prev') goToPhase(i - 1);
  else if (action === 'next') goToPhase(i + 1);
  else if (action === 'goto') goToPhase(index);
  else if (action === 'add' || action === 'insert') {
    ui.phase = action === 'add' ? appendPhase(phases, state.players) : insertPhaseAfter(phases, i, state.players);
    ui.tool = null;
  } else if (action === 'left' || action === 'right') {
    ui.phase = movePhase(phases, i, action === 'left' ? i - 1 : i + 1);
  } else if (action === 'delete') {
    if (phases.length === 1) return;
    askConfirm(`Delete phase ${i + 1}? You can undo this.`, 'Delete phase').then(ok => {
      if (!ok || state.phases !== phases) return;
      phases.splice(i, 1);
      ui.phase = Math.min(i, phases.length - 1);
      render();
    });
  }
}

function fileAction(action) {
  $('file-menu').open = false;
  if (busy()) return;
  if (action === 'about') {
    openAbout();
  } else if (action === 'plays') {
    openPlays();
  } else if (action === 'save') {
    downloadPlay(state);
    showToast(`Saved ${safeFileName(state.name)}`, 'ok');
  } else if (action === 'logo') {
    openLogoDialog();
  } else if (action === 'png') {
    $('image-dialog').showModal();
  } else if (action === 'pdf') {
    savePdf();
  } else if (action === 'animation') {
    openAnimationDialog();
  } else if (action === 'share') {
    openShareDialog();
  } else if (action === 'load') {
    $('load-input').click();
  } else if (action === 'paste') {
    openPasteDialog();
  } else if (action === 'new') {
    createAndOpen(blankPlay({ view: state.view, orientation: state.orientation }));
  }
}

async function loadFromInput(input) {
  const file = input.files?.[0];
  input.value = ''; // so picking the same file again still fires "change"
  if (!file) return;
  let play;
  try {
    play = await readPlayFile(file);
  } catch (err) {
    showToast(err.message);
    return;
  }
  if (busy()) return;
  createAndOpen(play);
  showToast(`Opened "${play.name}" as a new play (the one before is in Plays).`, 'ok');
}

// Undo and redo do nothing mid-drag, while playing, presenting or exporting.
function undo() {
  if (ui.dragging || locked()) return;
  document.activeElement?.blur?.(); // so the text boxes show the restored values
  if (history.undo()) render();
}

function redo() {
  if (ui.dragging || locked()) return;
  document.activeElement?.blur?.();
  if (history.redo()) render();
}

// --- Setup ---

function buildRouteTools() {
  const group = $('route-tools');
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

// The play's name always gets at least NAME_MIN_REM of the top bar. If the buttons leave less than that on
// one row, the view controls go to a second row (.two-rows). Measured from the buttons alone (they never
// change size with the name), so typing a name never moves them.
const NAME_MIN_REM = 11;
function fitTopbar() {
  const bar = document.querySelector('.topbar');
  if (!bar || matchMedia('(max-width: 700px)').matches) { bar?.classList.remove('two-rows'); return; }
  if (!bar.clientWidth) return; // hidden (Present mode): keep it as it is until it shows again
  // Measured on one row: on two, the view controls stretch to the bar's width.
  bar.classList.remove('two-rows');
  const cs = getComputedStyle(bar);
  const gap = parseFloat(cs.columnGap) || 0;
  const items = [...bar.children].filter(el => !el.matches('.title-edit, [popover]') && el.offsetWidth > 0);
  // Left margins only: the pencil's right margin is "auto" (it takes the free space).
  const used = items.reduce((sum, el) => sum + el.getBoundingClientRect().width + (parseFloat(getComputedStyle(el).marginLeft) || 0), 0)
    + gap * items.length;
  const room = bar.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - used;
  bar.classList.toggle('two-rows', room < NAME_MIN_REM * parseFloat(getComputedStyle(document.documentElement).fontSize));
}

function initTopbar() {
  new ResizeObserver(fitTopbar).observe(document.querySelector('.topbar'));
  $('topbar-logo').addEventListener('load', fitTopbar);
  inputs.name.addEventListener('input', () => { state.name = inputs.name.value; render('name'); });
  inputs.category.addEventListener('change', () => { state.category = inputs.category.value; render(); });
  inputs.tags.addEventListener('input', () => {
    state.tags = inputs.tags.value.split(',').map(t => t.trim()).filter(Boolean);
    render('tags');
  });
  inputs.note.addEventListener('input', () => { phase().note = inputs.note.value; render(`note-${ui.phase}`); });
  // A phase keeps instructions only for players who have one, and none at all when nobody has.
  inputs.instruction.addEventListener('input', () => {
    if (ui.selected?.kind !== 'player') return;
    const id = ui.selected.id;
    const ph = phase();
    const text = inputs.instruction.value.slice(0, INSTRUCTION_MAX);
    if (text.trim()) (ph.instructions ??= {})[id] = text;
    else if (ph.instructions) {
      delete ph.instructions[id];
      if (!Object.keys(ph.instructions).length) delete ph.instructions;
    }
    render(`instruction-${ui.phase}-${id}`);
  });
  addEventListener('resize', fitHint);
  // Typing is never lost: focusing a text box (the note, the play's name or details) while the play is playing
  // or paused stops it and drops the paused frame, so the box can be typed in and what's typed is kept.
  document.addEventListener('focusin', e => {
    const el = e.target;
    if (!(el instanceof Element) || !el.matches(TEXT_FIELDS) || el.closest('#play-controls')) return;
    if (!playback.playing && !playback.paused) return;
    playback.stop();
    render(null, { record: false });
  });
  // The pencil by the name opens Play details (category and tags), just under it.
  const details = $('play-details');
  details.addEventListener('beforetoggle', e => {
    if (e.newState !== 'open') return;
    const b = $('details-button').getBoundingClientRect();
    details.style.top = `${b.bottom + 6}px`;
    const w = Math.min(256, innerWidth - 16); // its width (16rem) before it opens
    details.style.left = `${Math.max(8, Math.min(b.left - 8, innerWidth - w - 8))}px`;
  });
  // Clicking the name selects all of it, so typing replaces it. A press on the box
  // itself would otherwise put the cursor where it landed, so the first press focuses it by hand; once it
  // has the focus, clicks place the cursor as usual.
  inputs.name.addEventListener('focus', () => inputs.name.select());
  inputs.name.addEventListener('mousedown', e => {
    if (document.activeElement === inputs.name) return;
    e.preventDefault();
    inputs.name.focus();
  });

  document.querySelector('[data-action="undo"]').addEventListener('click', undo);
  document.querySelector('[data-action="redo"]').addEventListener('click', redo);
  for (const b of document.querySelectorAll('[data-file]')) b.addEventListener('click', () => fileAction(b.dataset.file));
  $('load-input').addEventListener('change', e => loadFromInput(e.target));

  for (const b of document.querySelectorAll('[data-view]')) {
    b.addEventListener('click', () => {
      if (b.dataset.view === 'full') state.view = 'full';
      else if (!isHalf(state.view)) state.view = busierHalf();
      render();
    });
  }
  // The other half: halfway to x=110, or the in-goal at x=-10 to halfway. Kept in the play's view.
  $('flip-half').addEventListener('click', () => {
    if (!isHalf(state.view) || busy()) return;
    state.view = state.view === 'half' ? 'half-own' : 'half';
    render();
  });
  for (const b of document.querySelectorAll('[data-orientation]')) {
    b.addEventListener('click', () => { ui.orientationChosen = true; setOrientation(b.dataset.orientation); });
  }
  portraitPhone.addEventListener('change', e => {
    if (!ui.orientationChosen) setOrientation(e.matches ? 'vertical' : 'horizontal');
  });

  $('layers').addEventListener('change', e => {
    const key = e.target.dataset.layer;
    if (key) {
      ui.layers[key] = e.target.checked;
      if (key === 'steps') saveStepNumbers(e.target.checked);
      render(null, { record: false });
    }
    if (e.target.name === 'player-size' && e.target.value in PLAYER_SIZES) {
      ui.playerSize = e.target.value;
      savePlayerSize(ui.playerSize);
      render(null, { record: false });
    }
  });
  // Close the drop-down menus when tapping anywhere else.
  const menus = [...document.querySelectorAll('details.menu')];
  document.addEventListener('pointerdown', e => {
    for (const m of menus) if (m.open && !m.contains(e.target)) m.open = false;
  });
  // Only one menu open at a time.
  for (const m of menus) m.addEventListener('toggle', () => { if (m.open) for (const o of menus) if (o !== m) o.open = false; });
}

function initPhaseBar() {
  document.querySelector('.phasebar').addEventListener('click', e => {
    const b = e.target.closest('[data-phase]');
    // Nothing changes phase in the middle of a drag (a second finger, or a key).
    if (!b || b.disabled || ui.dragging) return;
    const action = b.dataset.phase;
    // Moving between phases also works while playing (it carries on from that phase).
    if (action === 'prev' || action === 'next') { step(action === 'prev' ? -1 : 1); return; }
    if (action === 'goto') { playback.jump(Number(b.dataset.index)); return; }
    if (busy()) return;
    phaseAction(action, Number(b.dataset.index));
    render();
  });
}

function initSetPieceDialog() {
  const dialog = $('set-piece-dialog');
  dialog.addEventListener('close', () => {
    const [kind, team] = dialog.returnValue.split('-');
    if (kind === 'scrum' || kind === 'lineout') startPlacing({ kind, team });
  });
  return () => { dialog.returnValue = ''; dialog.showModal(); };
}

// Team logo: shown left of the play name, in a corner in Present mode, on exports (if "Show logo on exports"
// is on) and, through the team name, in the About box. Every change in the box is kept straight away.
function updateLogo() {
  const src = logoSrc(teamLogo);
  const name = teamLogo.name.trim();
  for (const img of [$('topbar-logo'), $('present-logo'), $('welcome-logo')]) {
    if (!src) { img.hidden = true; img.removeAttribute('src'); continue; }
    img.alt = name ? `${name} logo` : 'Team logo';
    if (img.getAttribute('src') !== src) { img.hidden = false; img.src = src; }
  }
  for (const line of [$('about-team'), $('welcome-team')]) {
    line.textContent = name ? `Made for ${name}` : '';
    line.hidden = !name;
  }
  fitTopbar();
}

function openLogoDialog() {
  const dialog = $('logo-dialog');
  $('logo-name').value = teamLogo.name;
  $('logo-exports').checked = teamLogo.exports;
  logoStatus('');
  updateLogoPreview();
  dialog.returnValue = '';
  dialog.showModal();
}

function updateLogoPreview() {
  const src = logoSrc(teamLogo);
  const preview = $('logo-preview');
  preview.hidden = !src;
  if (src) preview.src = src; else preview.removeAttribute('src');
  $('logo-empty').hidden = !!src;
  $('logo-remove').disabled = !src;
}

function logoStatus(message, error = false) {
  const status = $('logo-status');
  status.textContent = message;
  status.classList.toggle('error', error);
}

// Keeps the setting; if storage is blocked or full it still applies until the page is closed.
const LOGO_NOT_SAVED = "Couldn't save the logo setting in this browser. It's used until you close this page.";
function keepLogo(done) {
  updateLogo();
  updateLogoPreview();
  if (saveLogoSettings(teamLogo)) {
    if (done) logoStatus(done);
    return;
  }
  logoStatus(LOGO_NOT_SAVED, true);
  showToast(LOGO_NOT_SAVED);
}

function initLogoDialog() {
  const dialog = $('logo-dialog');
  const input = $('logo-input');
  const name = $('logo-name');
  name.maxLength = TEAM_NAME_MAX;
  $('logo-upload').addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = ''; // so picking the same file again still fires "change"
    if (!file) return;
    logoStatus('Reading the image…');
    try {
      teamLogo.logo = await readLogoFile(file);
    } catch (err) {
      logoStatus(err.message, true);
      return;
    }
    keepLogo('Logo saved.');
  });
  $('logo-remove').addEventListener('click', () => {
    teamLogo.logo = null;
    keepLogo('Logo removed.');
  });
  $('logo-exports').addEventListener('change', e => {
    teamLogo.exports = e.target.checked;
    keepLogo('');
  });
  // The name shows in the About box as it's typed, and is kept when it's done (on change, or on closing).
  let nameChanged = false;
  name.addEventListener('input', () => {
    teamLogo.name = name.value.slice(0, TEAM_NAME_MAX);
    nameChanged = true;
    updateLogo();
  });
  const keepName = () => { if (nameChanged) { nameChanged = false; keepLogo(''); } };
  name.addEventListener('change', keepName);
  dialog.addEventListener('close', keepName);
  closeOnClickOutside(dialog);
  // A logo that can't be shown (the default file missing, say) is hidden rather than drawn broken.
  for (const img of [$('topbar-logo'), $('present-logo'), $('welcome-logo'), $('logo-preview')]) {
    img.addEventListener('error', () => { img.hidden = true; });
  }
  // Another tab changed it.
  addEventListener('storage', e => {
    if (e.key !== LOGO_KEY) return;
    teamLogo = readLogoSettings();
    updateLogo();
  });
  updateLogo();
}
// For tests: the SVG cleaner, so a check can look at what it keeps.
window.rugbyLogo = { sanitizeSvg, settings: () => ({ ...teamLogo }) };

// "? Tips" at the top of the sidebar opens a small popup beside it (a popover, so clicking away or
// Escape closes it). It floats over the page and never moves the toolbar.
function initTips() {
  const tips = $('tips');
  tips.addEventListener('beforetoggle', e => {
    if (e.newState !== 'open') return;
    const b = $('help').getBoundingClientRect();
    tips.style.left = `${b.right + 8}px`;
    tips.style.top = `${b.top}px`;
  });
}

function initKeys() {
  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    // Escape closes an open menu (File, Layers), even from a box inside it, and does nothing else.
    const menu = document.querySelector('details.menu[open]');
    if (e.key === 'Escape' && menu && !e.target.closest('dialog')) {
      e.preventDefault();
      menu.open = false;
      menu.querySelector('summary').focus();
      return;
    }
    const typing = e.target.closest('input, textarea, select, dialog');
    // A player or set piece waiting to be placed: Escape settles it (see settlePlacing) and does nothing
    // else; any other key (undo too) settles it first.
    if (ui.placing && !typing && !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
      settlePlacing();
      if (e.key === 'Escape') return;
    }
    // Undo/redo. In a text box the browser's own text undo handles it.
    if (mod && !typing && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
      e.preventDefault();
      if (e.key === 'y' || e.shiftKey) redo();
      else undo();
      return;
    }
    if (typing || mod || e.altKey) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!ui.selected || locked()) return;
      e.preventDefault();
      deleteSelected();
      render();
    } else if (e.key === 'Escape') {
      if (ui.presenting) present.exit();
      else if (playback.playing) playback.pause();
      else {
        ui.selected = null;
        ui.tool = null;
        render();
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (ui.dragging) return;
      e.preventDefault();
      step(e.key === 'ArrowLeft' ? -1 : 1);
    } else if (e.key === ' ') {
      if (ui.dragging) return;
      e.preventDefault();
      // A focused button would also be clicked by the space bar.
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
      playback.toggle();
    } else if (ui.presenting && (e.key === 'p' || e.key === 'P')) {
      present.togglePen();
    } else if (ui.presenting && (e.key === 'c' || e.key === 'C')) {
      present.clearPen();
    } else if (ui.presenting && present.pen && (e.key === 'z' || e.key === 'Z')) {
      present.undoStroke();
    }
  });
}

// Back or forward one phase (Prev/Next, the arrow keys, the step buttons). While playing, playing
// carries on from there.
function step(delta) {
  playback.jump(ui.phase + delta);
}

// Play/Pause, step, speed, Loop, and in Present mode the pen and Exit.
function initPlayControls() {
  $('play-controls').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const action = b.dataset.play;
    if (b.dataset.speed) { playback.speed = Number(b.dataset.speed); updatePlayControls(); }
    else if (b.dataset.option) playback.playOption(b.dataset.option);
    else if (b.dataset.penColour) present.setPenColour(b.dataset.penColour);
    else if (action === 'undo-stroke') present.undoStroke();
    else if (action === 'toggle') playback.toggle();
    else if (action === 'first') playback.jump(0);
    else if (action === 'back') step(-1);
    else if (action === 'forward') step(1);
    else if (action === 'loop') playback.setLoop(!playback.loop);
    else if (action === 'pen') present.togglePen();
    else if (action === 'clear') present.clearPen();
    else if (action === 'exit') present.exit();
    // Space and the arrow keys go to the play, not to the button that was clicked last.
    b.blur();
  });
  $('present-button').addEventListener('click', () => present.enter());
  $('replay-button').addEventListener('click', () => { if (playback.ended) playback.play(); });
  addEventListener('hashchange', () => {
    const i = hashPhase();
    if (i != null && i !== ui.phase) playback.jump(i);
  });
}

async function init() {
  // Read now: the first render puts #phase=1 in the address.
  const linked = /^#phase=/.test(location.hash);
  // If the play can't be opened (or drawn), it stays in the library (or, for the old autosave, under its
  // backup key) and a new blank play opens instead.
  let { broken } = await openStartPlay();
  // A link to a phase (#phase=3) opens on it.
  ui.phase = hashPhase() ?? ui.phase;
  history.reset();

  buildArrowMarkers($('defs'));
  buildRouteTools();
  initTopbar();
  initPhaseBar();
  initKeys();
  initImageDialog();
  initAnimationDialog();
  initCues();
  initShareDialog();
  initOptionDialog();
  initNumberPicker();
  initTips();
  initRouteBar();
  const openTemplates = initTemplatesDialog();
  initAboutDialog();
  initPasteDialog();
  initGuideLinks();
  initLogoDialog();
  initPlayControls();
  initTabs();
  initPlays();
  const openSetPiece = initSetPieceDialog();

  document.querySelector('.toolbar').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const { action, object, route } = b.dataset;
    if (action === 'add-attack') openNumberPicker('attack', b);
    else if (action === 'add-defense') openNumberPicker('defense', b);
    else if (action === 'set-piece') openSetPiece();
    else if (action === 'delete') deleteSelected();
    else if (object) { addObject(object); ui.tool = null; }
    else if (route) ui.tool = ui.tool === route ? null : route;
    render();
  });

  // Save straight away when the page is hidden or closed, rather than waiting for the timer.
  addEventListener('pagehide', flushAutosave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushAutosave(); });

  // No editing while playing, presenting or exporting. A press on the pitch drops a paused frame.
  editor = initEditor(svg, world, {
    state, ui, phase, render, renderSoon, hint: renderHint, editLabel, editOrder, moveObject, locked,
    pressed: () => playback.dropFrame(), place, drew, shown: r => shownRoutes(ui.phase)(r), switched: startSwitched,
  });
  // A press anywhere off the pitch (a button, a menu) while a player or set piece waits to be placed settles
  // it first, so the button then acts on the play as it will be.
  document.addEventListener('pointerdown', e => {
    if (ui.placing && !svg.contains(e.target)) settlePlacing();
  }, true);

  if (!broken) {
    try {
      render();
    } catch {
      broken = true;
    }
  }
  if (broken) {
    openBlank();
    scene.redrawPitch();
    render();
    showToast("Your last play couldn't be opened. A backup was kept.");
  }
  initWelcomeDialog(openTemplates, linked);
  // Drawn: tell the page's load watchdog (index.html) the app is up.
  window.appReady?.();
}

init();
