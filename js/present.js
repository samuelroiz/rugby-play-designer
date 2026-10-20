// Present mode: the pitch alone, full screen and as large as it fits, for a TV or a screen recording.
// The phase note is a large caption under it and "Phase n of N" sits in a corner. The play controls sit
// between the pitch and the caption and fade after a while without mouse movement. "I play" (click a player,
// or pick one from the list) fades the rest of that player's team and, as in the phone viewer, shows their
// job line in the note's place (the app pops up their cue bubbles as each step starts). The pen draws over the pitch for the
// moment: never saved, kept through phase changes until Clear, and gone when Present mode ends.
// Editing is off while presenting, so there are no hover hints, handles or selection highlights.

import { svgEl, toMetres } from './pitch.js';
import { round2, playersOurFirst, positionName } from './model.js';
import { jobLine } from './jobs.js';

// The job line is shrunk (to no less than this share of the caption's size) to fit the caption's room (at least
// one line, or the note's height), on at most JOB_LINES lines.
const JOB_LINES = 2;
const JOB_MIN = 0.45;

const IDLE_MS = 2000;
const PEN_STEP = 0.15; // metres the pointer must move before the stroke gets another point
// Pen colours (each stroke gets its class; styles.css draws them). None is a route's or a team's colour.
export const PEN_COLOURS = ['black', 'cyan', 'magenta'];

// render(): the app's redraw. phase(): the shown phase. penLayer: the group in pitch metres strokes go in.
// playback: picking up the pen pauses it, and leaving stops it.
export function initPresent({ state, ui, svg, world, penLayer, render, phase, playback }) {
  const body = document.body;
  const pick = document.getElementById('i-play');
  const api = { idleMs: IDLE_MS, pen: false, penColour: 'black' };
  let idleTimer = 0;
  let enteredFullscreen = false;
  let stroke = null;

  function enter() {
    if (ui.presenting) return;
    ui.presenting = true;
    ui.selected = null;
    ui.tool = null;
    document.activeElement?.blur?.();
    body.classList.add('presenting');
    fillPicker();
    wake();
    render();
    // Full screen needs a real click or key press; without one, or if the browser refuses, it presents
    // in the window.
    if (navigator.userActivation?.isActive !== false) {
      document.documentElement.requestFullscreen?.().then(() => { enteredFullscreen = true; }, () => {});
    }
  }

  function exit() {
    if (!ui.presenting) return;
    // Playing stops and the paused frame goes, so editing starts from the phase as it is.
    playback.stop();
    ui.presenting = false;
    ui.focusPlayer = null;
    setPen(false);
    clearPen();
    setPenColour('black');
    clearTimeout(idleTimer);
    body.classList.remove('presenting', 'controls-idle');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    enteredFullscreen = false;
    render();
  }

  // In full screen the browser takes Escape for itself and leaves full screen: leave Present mode with it.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && enteredFullscreen) exit();
  });

  // The controls show while the mouse moves and fade after IDLE_MS without movement.
  function wake() {
    body.classList.remove('controls-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (ui.presenting) body.classList.add('controls-idle'); }, api.idleMs);
  }
  document.addEventListener('pointermove', () => { if (ui.presenting) wake(); });

  // "I play": None, then both teams by number, our team first (the defense for a defense play), e.g. "Defense 13".
  function fillPicker() {
    const none = new Option('None', '');
    pick.replaceChildren(none, ...playersOurFirst(state).map(p => new Option(positionName(p), p.id)));
    pick.value = ui.focusPlayer ?? '';
  }
  pick.addEventListener('change', () => {
    ui.focusPlayer = pick.value || null;
    pick.blur(); // so Space and the arrow keys work again straight away
    render();
  });
  // Clicking a player picks them; clicking them again clears it.
  function pickPlayer(id) {
    ui.focusPlayer = ui.focusPlayer === id ? null : id;
    pick.value = ui.focusPlayer ?? '';
    render();
  }

  // Picking up the pen pauses the play, so there's a still picture to draw on.
  function setPen(on) {
    if (on) playback.pause();
    api.pen = on;
    body.classList.toggle('pen-on', on);
    document.querySelector('[data-play="pen"]').setAttribute('aria-pressed', on);
  }
  const togglePen = () => setPen(!api.pen);

  // Picking a colour also picks up the pen.
  function setPenColour(colour) {
    if (!PEN_COLOURS.includes(colour)) return;
    api.penColour = colour;
    for (const b of document.querySelectorAll('[data-pen-colour]')) b.setAttribute('aria-pressed', b.dataset.penColour === colour);
    if (ui.presenting && !api.pen) setPen(true);
  }

  function clearPen() {
    penLayer.replaceChildren();
    stroke = null;
  }

  // Takes back the last stroke (Undo stroke, or Z while the pen is on).
  function undoStroke() {
    if (stroke) return;
    penLayer.lastElementChild?.remove();
  }

  // A stroke is a line over a contrasting outline, in the chosen colour: black on white (the default),
  // cyan on dark, or magenta on white. They read on grass, on white lines and on players.
  svg.addEventListener('pointerdown', e => {
    if (!ui.presenting || !e.isPrimary || e.button !== 0) return;
    if (!api.pen) {
      const id = e.target.closest('[data-kind="player"]')?.dataset.id;
      if (id) pickPlayer(id);
      return;
    }
    const p = toMetres(world, e);
    const g = svgEl('g', { class: `pen-mark ${api.penColour}` }, penLayer);
    const d = `M${round2(p.x)} ${round2(p.y)}l0 0`;
    stroke = { points: [p], paths: [svgEl('path', { class: 'pen-outline', d }, g), svgEl('path', { class: 'pen-stroke', d }, g)] };
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  svg.addEventListener('pointermove', e => {
    if (!stroke) return;
    const p = toMetres(world, e);
    const lastPoint = stroke.points.at(-1);
    if (Math.hypot(p.x - lastPoint.x, p.y - lastPoint.y) < PEN_STEP) return;
    stroke.points.push(p);
    const d = `M${stroke.points.map(q => `${round2(q.x)} ${round2(q.y)}`).join('L')}`;
    for (const path of stroke.paths) path.setAttribute('d', d);
  });
  const endStroke = () => { stroke = null; };
  svg.addEventListener('pointerup', endStroke);
  svg.addEventListener('pointercancel', endStroke);

  // Called from every render: the caption (the note, or with I play the chosen player's job line in its
  // place) and the phase count follow the shown phase.
  function update() {
    const note = phase().note.trim();
    const caption = document.getElementById('present-caption');
    caption.textContent = note;
    caption.hidden = !note;
    const player = ui.presenting && ui.focusPlayer ? state.players.find(p => p.id === ui.focusPlayer) : null;
    caption.classList.toggle('covered', !!player);
    const job = document.getElementById('present-job');
    job.hidden = !player;
    if (player) {
      document.getElementById('present-job-who').textContent = player.label;
      document.getElementById('present-job-text').textContent = jobLine(state, ui.phase, player.id);
      fitJob(job);
    }
    document.getElementById('present-count').textContent = `Phase ${ui.phase + 1} of ${state.phases.length}`;
  }

  // As large as fits the room the caption has without it (the note's height, or one line), on at most
  // JOB_LINES lines, so the caption, and the controls above it, keep their place. Only measured again when the
  // text, the note or the window changes.
  let fitted = '';
  function fitJob(job) {
    const caption = document.getElementById('present-caption');
    const key = [job.textContent, caption.textContent, innerWidth, innerHeight].join('|');
    if (key === fitted) return;
    fitted = key;
    job.style.fontSize = '';
    const full = parseFloat(getComputedStyle(job).fontSize);
    const line = parseFloat(getComputedStyle(job).lineHeight);
    const room = Math.max(caption.hidden ? 0 : caption.offsetHeight, line);
    for (let k = 1; k >= JOB_MIN - 1e-9; k -= 0.05) {
      job.style.fontSize = `${full * k}px`;
      if (job.offsetHeight <= room + 1 && job.offsetHeight <= Math.ceil(JOB_LINES * line * k) + 1) return;
    }
  }

  return Object.assign(api, { enter, exit, togglePen, clearPen, undoStroke, setPenColour, update });
}
