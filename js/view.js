// The phone viewer (view.html): a play opened from a share link (view.html#p=<data>, see share.js), read-only.
// It loads only the pitch drawing, the animation and the play checks: no editor, library, autosave or Welcome
// box. The start screen asks which position you play: our team's numbers (model.js ourTeam: the defense for a
// defense play, else the attack), with an Attack / Defense switch for the other side. Focus mode then plays the play on a vertical pitch
// (attack playing up) with the view following that player (follow.js), their team-mates faded and opponents
// near them at full strength, and their job for each phase at the bottom (jobs.js: the coach's instruction, or
// one made from their routes), with the phase note a tap away in a sheet. Their cues (cues.js) pop up next to
// them as each one's step starts, and playback eases to half speed for a moment so they register.
// At the end it zooms out and replays the whole play once with everyone at full strength and the phase notes,
// then offers Watch again, Another position and Share. "Watch the whole play" goes straight to that view.

import { drawPitch, svgEl, fitBox, uprightTurn, routePaths, buildArrowMarkers, drawBall, drawLineoutMark, PLAYER_R } from './pitch.js';
import { buildSchedule, frameAt, flightEnds, shownRoute } from './animate.js';
import { playedRoutes, curveControl, playPoints, BALL_ROUTES, ourTeam, teamPlayers, positionName, TEAM_NAMES } from './model.js';
import { decodeShare, hashData } from './share.js';
import { logoSrc } from './logo.js';
import { shaped, screenBox, followTarget, glide, strength, ballIn } from './follow.js';
import { phaseCues, firedBetween, cueSpeed, ageBubbles, placeBubble } from './cues.js';
import { jobLine } from './jobs.js';

// The last position picked in this browser, preselected next time: its team and number as JSON,
// {"team":"defense","number":"10"} (an older plain "10" is the attack's 10).
const POSITION_KEY = 'rugby-play-designer.viewer-position';
const JOB_LINES = 2; // the job line is shrunk to fit this many lines
const JOB_PX = { max: 24, min: 15 };
const ZOOM_OUT_MS = 1400; // after the focus run: the last moment held while the view zooms out to the whole play
const MAX_FRAME_MS = 100;
const SWIPE_PX = 50;
const UP = uprightTurn('vertical');

const $ = id => document.getElementById(id);
const svg = $('pitch');
const layers = {
  pitch: $('pitch-layer'), objects: $('objects-layer'), routes: $('routes-layer'), players: $('players-layer'),
  ballRoutes: $('ball-routes-layer'), labels: $('labels-layer'), balls: $('ball-layer'),
};

let play = null;
let team = null;
let listTeam = 'attack'; // the side the start screen lists: our team, until the switch picks the other
const v = {
  screen: 'loading',
  mode: null, // 'focus' (following a player), 'replay' (the whole play after a focus run) or 'whole'
  focus: null, // the followed player's id
  phase: 0,
  sched: null,
  t: 0, // ms into the phase's animation, at 1x
  hold: 0, // ms (at 1x) left before the replay starts
  playing: false,
  ended: false,
  speed: 1,
  cam: null, // the view, in screen units (SVG user units after the pitch's quarter turn): { x, y, w, h }
  cues: [], // the followed player's cues in this phase: [{ text, step, time }]
  bubbles: [], // the cues up now: [{ text, age }] (age in ms)
  timeScale: 1, // for tests: 4 runs the clock (and the camera) 4 times faster
};
let els = { players: new Map(), labels: new Map(), objects: new Map(), routes: [], extraBall: null };
let raf = 0;
let last = 0;
let frameHook = null;

// --- Loading ---

async function load() {
  show('loading');
  resumePhase = null;
  const data = hashData(location.hash);
  try {
    if (!data) throw new Error('This page shows plays shared from the Rugby Play Designer. Open a share link, or make a play in the designer.');
    ({ play, team } = await decodeShare(data));
  } catch (err) {
    $('broken-text').textContent = err.message;
    show('broken');
    return;
  }
  document.title = `${play.name} · Rugby play`;
  wholeView = null;
  listTeam = ourTeam(play);
  buildStart();
  drawPitch(layers.pitch, { view: 'full', orientation: 'vertical', distances: true, grid: false, direction: false });
  $('defs').replaceChildren();
  buildArrowMarkers($('defs'));
  buildPlayers();
  show('start');
}

function show(screen) {
  v.screen = screen;
  for (const id of ['loading', 'broken', 'start', 'watch']) $(id).hidden = id !== screen;
  if (screen === 'watch') startLoop();
  else stopLoop();
}

// --- Start screen ---

function remembered() {
  let raw = null;
  try { raw = localStorage.getItem(POSITION_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const r = JSON.parse(raw);
    if (r && typeof r === 'object') return { team: r.team, number: String(r.number) };
  } catch { /* an older plain number */ }
  return { team: 'attack', number: raw };
}
const remember = p => {
  try { localStorage.setItem(POSITION_KEY, JSON.stringify({ team: p.team, number: p.label })); } catch { /* storage blocked: not remembered */ }
};

function buildStart() {
  $('start-name').textContent = play.name;
  const n = play.phases.length;
  $('start-meta').textContent = `${n} phase${n === 1 ? '' : 's'}`;
  $('start-team').hidden = !team;
  $('start-team-name').textContent = team?.name ?? '';
  const logo = team && logoSrc(team);
  $('start-logo').hidden = !logo;
  if (logo) $('start-logo').src = logo;
  // Attack / Defense, when both teams have players.
  const sides = ['attack', 'defense'].filter(t => teamPlayers(play, t).length);
  if (!sides.includes(listTeam)) listTeam = sides[0] ?? ourTeam(play);
  const switcher = $('team-switch');
  switcher.hidden = sides.length < 2;
  for (const b of switcher.querySelectorAll('[data-team]')) {
    b.setAttribute('aria-pressed', String(b.dataset.team === listTeam));
    b.onclick = () => { listTeam = b.dataset.team; buildStart(); };
  }
  const box = $('positions');
  box.replaceChildren();
  box.setAttribute('aria-label', `${TEAM_NAMES[listTeam]} positions`);
  const picked = remembered();
  for (const p of teamPlayers(play, listTeam)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = p.id;
    b.className = p.team;
    b.textContent = p.label;
    b.setAttribute('aria-label', `I play ${positionName(p)}`);
    b.setAttribute('aria-pressed', String(!!picked && picked.team === p.team && picked.number === p.label));
    b.addEventListener('click', () => {
      remember(p);
      for (const other of box.children) other.setAttribute('aria-pressed', String(other === b));
      watch('focus', p.id, resumeAt());
    });
    box.appendChild(b);
  }
  if (!box.children.length) {
    const none = document.createElement('p');
    none.className = 'meta';
    none.textContent = 'This play has no players to follow.';
    box.appendChild(none);
  }
}

// --- Drawing ---

// The discs, and their numbers in a layer above every route line (a line can cross a disc, never its number).
function buildPlayers() {
  layers.players.replaceChildren();
  layers.labels.replaceChildren();
  els.players = new Map();
  els.labels = new Map();
  for (const p of play.players) {
    const g = svgEl('g', { class: `player ${p.team}`, 'data-id': p.id }, layers.players);
    svgEl('circle', { r: PLAYER_R + 0.75, class: 'me-ring' }, g);
    svgEl('circle', { r: PLAYER_R, class: 'body' }, g);
    const label = svgEl('g', { class: `player-label ${p.team}`, 'data-id': p.id }, layers.labels);
    svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': p.label.length > 2 ? 0.85 : 1.2 }, label).textContent = p.label;
    els.players.set(p.id, g);
    els.labels.set(p.id, label);
  }
}

// The markers and the routes that play (option A) of phase i.
function buildPhase(i) {
  const ph = play.phases[i];
  for (const l of [layers.objects, layers.balls, layers.routes, layers.ballRoutes]) l.replaceChildren();
  els.objects = new Map();
  els.extraBall = null;
  for (const o of ph.objects) {
    const g = svgEl('g', { class: `marker ${o.type}`, 'data-id': o.id }, o.type === 'ball' ? layers.balls : layers.objects);
    if (o.type === 'ball') drawBall(g);
    else if (o.type === 'ruck') {
      svgEl('circle', { r: 2, class: 'outline' }, g);
      svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 1.3, transform: UP.trim() }, g).textContent = 'R';
    } else if (o.type === 'scrum') svgEl('line', { x1: 0, y1: -3.8, x2: 0, y2: 3.8, class: 'scrum-mark' }, g);
    else if (o.type === 'lineout') drawLineoutMark(g);
    els.objects.set(o.id, g);
  }
  els.routes = [];
  // A pass or kick is drawn from where its passer is at its step to where the ball is caught (animate.js).
  const ends = flightEnds(play, i);
  for (const route of playedRoutes(ph.routes, 'A')) {
    const r = shownRoute(route, ends.get(route.id));
    const [x1, y1] = r.points[0];
    const [x2, y2] = r.points[r.points.length - 1];
    const { control: c } = curveControl(r);
    const d = `M${x1} ${y1} Q${c.x} ${c.y} ${x2} ${y2}`;
    const g = svgEl('g', { class: 'route', 'data-from': r.from ?? '' }, BALL_ROUTES.has(r.type) ? layers.ballRoutes : layers.routes);
    routePaths(g, 'path', { d }, r.type);
    els.routes.push({ g, from: r.from });
  }
}

const setAttr = (el, name, value) => { if (el.getAttribute(name) !== value) el.setAttribute(name, value); };
const setOpacity = (el, o) => { const s = o >= 1 ? '' : String(Math.max(0, Math.round(o * 100) / 100)); if (el.style.opacity !== s) el.style.opacity = s; };

// --- The view ---

const stageAspect = () => {
  const { clientWidth: sw, clientHeight: sh } = $('stage');
  return sw && sh ? sw / sh : 0.6;
};
const ballAt = f => ballIn(v.sched, f);

let wholeView = null; // the whole play's view, for the stage's size: { key, box }

// Where the view should be: round the followed player (and the ball when it's near them), or the whole play.
function target(f) {
  const aspect = stageAspect();
  if (v.mode !== 'focus') {
    const { clientWidth: sw, clientHeight: sh } = $('stage');
    const key = [sw, sh].join();
    if (wholeView?.key !== key) wholeView = { key, box: shaped(screenBox(fitBox(playPoints(play), 8, sw && sh ? sh / sw : 1.6)), aspect) };
    return { ...wholeView.box };
  }
  return followTarget(f.players[v.focus], ballAt(f), aspect);
}

// Glides the view towards the target; the followed player never leaves it, however fast they (or a phase
// change) move.
function moveCamera(f, dt) {
  v.cam = glide(v.cam, target(f), dt, v.mode === 'focus' ? f.players[v.focus] : null);
  const r = n => Math.round(n * 1000) / 1000;
  setAttr(svg, 'viewBox', `${r(v.cam.x)} ${r(v.cam.y)} ${r(v.cam.w)} ${r(v.cam.h)}`);
}

// The cue bubble: next to the followed player, inside the view and clear of their disc. Returns where it is
// (stage px) for the test hook, or null when none is up.
let bubbleText = '';
function placeCueBubble(f, scale) {
  const el = $('cue-bubble');
  const text = v.mode === 'focus' ? v.bubbles.map(b => b.text.toUpperCase()).join('\n') : '';
  el.hidden = !text;
  if (!text) { bubbleText = ''; return null; }
  if (text !== bubbleText) {
    const fresh = v.bubbles.length > bubbleText.split('\n').filter(Boolean).length;
    bubbleText = text;
    el.firstElementChild.textContent = text;
    if (fresh) el.firstElementChild.animate?.([{ transform: 'scale(.6)', opacity: 0.4 }, { transform: 'scale(1)', opacity: 1 }], { duration: 180, easing: 'ease-out' });
  }
  const { clientWidth: width, clientHeight: height } = $('stage');
  const me = f.players[v.focus];
  const c = v.cam;
  const k = width / c.w;
  const x = (me.y - c.x) * k;
  const y = (-me.x - c.y) * k;
  const r = (PLAYER_R + 0.75) * scale * k;
  const at = placeBubble({ x, y, r, w: el.offsetWidth, h: el.offsetHeight, width, height });
  el.style.transform = `translate(${Math.round(at.left)}px, ${Math.round(at.top)}px)`;
  return { left: at.left, top: at.top, w: el.offsetWidth, h: el.offsetHeight, player: { x, y, r }, width, height, text };
}

function paint(dt) {
  if (!v.sched) return;
  const f = frameAt(v.sched, v.t);
  const on = strength(play.players, f, v.mode === 'focus' ? v.focus : null);
  // Discs grow a little when the view shows more of the pitch, so they stay easy to see.
  const k = Math.min(1.6, Math.max(1, (v.cam?.w ?? 40) / 45));
  for (const [id, g] of els.players) {
    const p = f.players[id];
    const label = els.labels.get(id);
    g.style.display = label.style.display = p ? '' : 'none';
    if (!p) continue;
    const transform = `translate(${p.x} ${p.y})${UP} scale(${Math.round(k * 100) / 100})`;
    setAttr(g, 'transform', transform);
    setAttr(label, 'transform', transform);
    setOpacity(g, on[id]);
    setOpacity(label, on[id]);
    g.classList.toggle('me', v.mode === 'focus' && id === v.focus);
  }
  for (const [id, g] of els.objects) {
    const o = f.objects[id];
    if (!o) continue;
    setAttr(g, 'transform', `translate(${o.x} ${o.y})`);
    setOpacity(g, o.opacity);
  }
  if (f.extraBall && !els.extraBall) {
    els.extraBall = svgEl('g', { class: 'marker ball' }, layers.balls);
    drawBall(els.extraBall);
  }
  if (els.extraBall) {
    els.extraBall.style.display = f.extraBall ? '' : 'none';
    if (f.extraBall) {
      setAttr(els.extraBall, 'transform', `translate(${f.extraBall.x} ${f.extraBall.y})`);
      setOpacity(els.extraBall, f.extraBall.opacity);
    }
  }
  for (const r of els.routes) setOpacity(r.g, f.routeOpacity * (r.from ? on[r.from] ?? 1 : 1));
  moveCamera(f, dt);
  const bubble = placeCueBubble(f, k);
  frameHook?.({
    phase: v.phase, t: v.t, mode: v.mode, cam: { ...v.cam }, wall: dt, factor: cueSpeed(v.bubbles), bubble,
    players: Object.fromEntries(Object.entries(f.players).map(([id, p]) => [id, { ...p, opacity: on[id] }])), ball: ballAt(f),
  });
}

// --- Playing ---

function setPhase(i) {
  v.phase = i;
  v.sched = buildSchedule(play, i);
  v.cues = v.focus ? phaseCues(play, i, v.focus, v.sched) : [];
  v.t = 0;
  buildPhase(i);
  $('caption').classList.remove('expanded');
  updateText();
}

// The job line is as large as fits on JOB_LINES lines (the whole of it is in the Coach's note sheet).
function fitJob() {
  const el = $('job');
  const lineH = 1.2;
  let px = JOB_PX.max;
  el.style.fontSize = `${px}px`;
  while (px > JOB_PX.min && el.scrollHeight > Math.ceil(JOB_LINES * lineH * px) + 1) el.style.fontSize = `${--px}px`;
}

function updateText() {
  const n = play.phases.length;
  $('watch-phase').textContent = `Phase ${v.phase + 1} of ${n}`;
  const me = play.players.find(p => p.id === v.focus);
  const focus = v.mode === 'focus';
  $('watch-who').textContent = focus && me ? positionName(me) : 'Whole play'; // "Defense 13": whose view it is
  const ph = play.phases[v.phase];
  // Following a player: their job, with the phase note in the sheet. Otherwise the note, all of it.
  $('job-box').hidden = !focus;
  $('caption').hidden = focus;
  const note = ph.note.trim();
  if (focus) {
    const job = jobLine(play, v.phase, v.focus);
    if ($('job').textContent !== job) { $('job').textContent = job; fitJob(); }
    $('note-button').hidden = !note;
    $('caption').textContent = ''; // the whole-play note goes: following a player shows their job
  } else if ($('caption').textContent !== note) {
    $('caption').textContent = note;
  }
  // A note longer than the caption's box scrolls, and a tap shows all of it.
  const cap = $('caption');
  cap.classList.toggle('more', !focus && !cap.classList.contains('expanded') && cap.scrollHeight > cap.clientHeight + 1);
  const toggle = $('toggle');
  toggle.textContent = v.playing ? '❚❚' : '▶︎';
  toggle.setAttribute('aria-label', v.playing ? 'Pause' : 'Play');
  for (const b of document.querySelectorAll('[data-speed]')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === v.speed));
  $('end').hidden = !v.ended;
}

// Starts watching at 1x, from the start of phase `from` (phase 1 unless given): following `focus` (mode
// 'focus') or the whole play ('whole'). Everything from what was watched before goes: the mode, the notes or
// job line, the cues and the camera.
function watch(mode, focus = null, from = 0) {
  Object.assign(v, { mode, focus, speed: 1, playing: true, ended: false, hold: 0, cam: null, bubbles: [] });
  setPhase(Math.min(Math.max(0, from), play.phases.length - 1));
  show('watch');
  updateText(); // now the screen is shown, the caption's size can be measured
}

// ms: how far the play moves on (at 1x, after the speed and any cue's slowdown); wall: the time that passed,
// which the cue bubbles age by.
function advance(ms, wall = ms) {
  if (!v.playing) return;
  if (v.hold > 0) {
    v.hold -= ms;
    if (v.hold <= 0) { v.hold = 0; setPhase(0); }
    return;
  }
  v.bubbles = ageBubbles(v.bubbles, wall);
  const from = v.t;
  v.t += ms;
  const fire = (a, b) => { if (v.mode === 'focus') v.bubbles.push(...firedBetween(v.cues, a, b).map(c => ({ text: c.text, age: 0 }))); };
  fire(from, Math.min(v.t, v.sched.total));
  while (v.t >= v.sched.total) {
    const rest = v.t - v.sched.total;
    if (v.phase < play.phases.length - 1) {
      setPhase(v.phase + 1);
      v.t = rest;
      fire(0, rest);
    } else {
      v.t = v.sched.total;
      finish();
      return;
    }
  }
}

// The end of a run through the play: after following a player, zoom out and replay it whole; after that
// (or after watching it whole), the end screen.
function finish() {
  v.bubbles = [];
  if (v.mode === 'focus') {
    v.mode = 'replay';
    v.hold = ZOOM_OUT_MS;
  } else {
    v.playing = false;
    v.ended = true;
    $('end-name').textContent = play.name;
    $('end-status').textContent = '';
  }
  updateText();
}

function jump(delta) {
  if (v.ended) return;
  const i = v.phase + delta;
  if (i >= play.phases.length) { v.hold = 0; v.t = v.sched.total; finish(); return; }
  v.hold = 0;
  v.bubbles = [];
  setPhase(Math.max(0, i));
}

function toggle() {
  if (v.ended) { watchAgain(); return; }
  v.playing = !v.playing;
  updateText();
}

function watchAgain() {
  watch(v.focus ? 'focus' : 'whole', v.focus);
}

// ☰ during a run through the play remembers the phase it was on, so picking a position (or the whole play)
// carries on from there, following the new choice from that phase's start. After the end, or from a fresh
// start, it starts at phase 1.
let resumePhase = null;
const resumeAt = () => resumePhase ?? 0;
function backToPositions() {
  resumePhase = v.screen === 'watch' && !v.ended ? v.phase : null;
  v.playing = false;
  const me = play.players.find(p => p.id === v.focus);
  if (me) listTeam = me.team;
  buildStart();
  show('start');
}

async function share() {
  const url = location.href;
  try {
    if (navigator.share) {
      await navigator.share({ title: play.name, text: `${play.name}: pick your position and watch the play.`, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    $('end-status').textContent = 'Link copied';
  } catch (err) {
    if (err?.name !== 'AbortError') $('end-status').textContent = "Couldn't share the link from here: copy it from the address bar.";
  }
}

function loop(now) {
  raf = requestAnimationFrame(loop);
  const dt = Math.min(MAX_FRAME_MS, now - last) * v.timeScale;
  last = now;
  advance(dt * v.speed * cueSpeed(v.bubbles), dt);
  paint(dt);
}
function startLoop() {
  cancelAnimationFrame(raf);
  last = performance.now();
  raf = requestAnimationFrame(loop);
}
function stopLoop() {
  cancelAnimationFrame(raf);
  raf = 0;
}

// --- Controls ---

function initControls() {
  $('watch-all').addEventListener('click', () => watch('whole', null, resumeAt()));
  $('toggle').addEventListener('click', toggle);
  $('back').addEventListener('click', () => jump(-1));
  $('next').addEventListener('click', () => jump(1));
  $('home').addEventListener('click', backToPositions);
  for (const b of document.querySelectorAll('[data-speed]')) {
    b.addEventListener('click', () => { v.speed = Number(b.dataset.speed); updateText(); });
  }
  $('watch-again').addEventListener('click', watchAgain);
  $('another').addEventListener('click', backToPositions);
  $('share').addEventListener('click', share);
  // The Coach's note sheet (the job line opens it too): the phase note in full. Playing pauses while it's open.
  const sheet = $('note-sheet');
  let resume = false;
  const openSheet = () => {
    const ph = play.phases[v.phase];
    $('sheet-phase').textContent = `Phase ${v.phase + 1} of ${play.phases.length}`;
    $('sheet-job').textContent = jobLine(play, v.phase, v.focus);
    $('sheet-note').textContent = ph.note.trim();
    $('sheet-note-box').hidden = !ph.note.trim();
    resume = v.playing;
    v.playing = false;
    updateText();
    sheet.showModal();
  };
  $('note-button').addEventListener('click', openSheet);
  $('job').addEventListener('click', openSheet);
  sheet.addEventListener('close', () => {
    if (resume && v.screen === 'watch' && !v.ended) v.playing = true;
    resume = false;
    updateText();
  });
  sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); }); // a tap outside the sheet
  $('caption').addEventListener('click', () => {
    $('caption').classList.toggle('expanded');
    updateText();
  });

  // Swipe left for the next phase, right for the one before.
  let down = null;
  const stage = $('stage');
  stage.addEventListener('pointerdown', e => { down = e.isPrimary ? { x: e.clientX, y: e.clientY, at: e.timeStamp } : null; });
  stage.addEventListener('pointerup', e => {
    if (!down || !e.isPrimary || v.ended) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    down = null;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > 1.5 * Math.abs(dy)) jump(dx < 0 ? 1 : -1);
  });
  stage.addEventListener('pointercancel', () => { down = null; });
  addEventListener('hashchange', load);
  addEventListener('keydown', e => {
    if (v.screen !== 'watch' || $('note-sheet').open || e.target.closest?.('button') && e.key === ' ') return;
    if (e.key === ' ') { e.preventDefault(); toggle(); } else if (e.key === 'ArrowRight') jump(1); else if (e.key === 'ArrowLeft') jump(-1);
  });
}

// For tests: the viewer's state, its clock's pace, and a call on every drawn frame.
window.rugbyViewer = {
  state: () => ({
    screen: v.screen, mode: v.mode, focus: v.focus, phase: v.phase, t: v.t, playing: v.playing, ended: v.ended,
    speed: v.speed, hold: v.hold, caption: $('caption').textContent, job: $('job-box').hidden ? null : $('job').textContent,
    cam: v.cam && { ...v.cam }, bubbles: v.bubbles.map(b => ({ ...b })), factor: cueSpeed(v.bubbles),
  }),
  set timeScale(s) { v.timeScale = s; },
  get timeScale() { return v.timeScale; },
  onFrame: fn => { frameHook = fn; },
};

initControls();
load();
