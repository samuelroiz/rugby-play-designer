// Playing a play: Play/Pause, speed, Loop, a chosen option, and drawing each frame. The app's render() draws
// the phase as usual (routes, badges, players, markers); each animation frame then only moves the players and
// markers whose spot has changed, by their transform. Pausing keeps that exact frame on screen until the play
// or the phase changes, or an edit starts (a press on the pitch, a new selection or tool), and Play carries
// on from it. Editing is locked while playing (the app checks `playing`).

import { buildSchedule, frameAt } from './animate.js';
import { svgEl } from './pitch.js';

// Longest step between two frames, so a tab that was hidden for a while doesn't jump through the play.
const MAX_FRAME_MS = 100;

// The drawn players (and their numbers, in a layer of their own above the routes), markers and badges of
// the shown phase, by id.
function findElements(layers) {
  const els = { players: new Map(), labels: new Map(), objects: new Map(), badges: new Map(), extraBall: null };
  for (const g of layers.players.querySelectorAll(':scope > [data-id]')) els.players.set(g.dataset.id, g);
  for (const g of layers.labels?.querySelectorAll(':scope > [data-id]') ?? []) els.labels.set(g.dataset.id, g);
  for (const g of [...layers.objects.children, ...layers.balls.children]) if (g.dataset.id) els.objects.set(g.dataset.id, g);
  for (const g of layers.badges.querySelectorAll('.badge[data-id]')) els.badges.set(g.dataset.id, g);
  return els;
}

const setTransform = (g, value) => { if (g.getAttribute('transform') !== value) g.setAttribute('transform', value); };
const setOpacity = (el, o) => { const v = o >= 1 ? '' : String(Math.max(0, o)); if (el.style.opacity !== v) el.style.opacity = v; };

// Puts the drawn phase where the animation has it at time t of schedule `sched`: players and markers moved,
// the badges of routes that have started hidden, and the routes faded during the slide to the next phase.
// up: the transform that keeps numbers upright. Only what has changed is touched.
function paint(els, layers, sched, t, up) {
  const f = frameAt(sched, t);
  for (const [id, g] of [...els.players, ...els.labels]) {
    const p = f.players[id];
    if (p) setTransform(g, `translate(${p.x} ${p.y})${up}`);
  }
  for (const [id, g] of els.objects) {
    const o = f.objects[id];
    if (!o) continue;
    setTransform(g, `translate(${o.x} ${o.y})`);
    setOpacity(g, o.opacity);
  }
  // A route's order badge goes once the route starts moving.
  for (const [id, g] of els.badges) {
    const gone = sched.starts.has(id) && t > sched.starts.get(id);
    if (g.classList.contains('moving') !== gone) g.classList.toggle('moving', gone);
  }
  if (f.extraBall && !els.extraBall) {
    // A phase with a pass but no ball: one is drawn for the animation only.
    els.extraBall = svgEl('g', { class: 'marker ball anim-ball', 'pointer-events': 'none' }, layers.balls);
    svgEl('ellipse', { rx: 0.7, ry: 0.45, class: 'ball', transform: 'rotate(-25)' }, els.extraBall);
  }
  if (els.extraBall) {
    els.extraBall.style.display = f.extraBall ? '' : 'none';
    if (f.extraBall) {
      setTransform(els.extraBall, `translate(${f.extraBall.x} ${f.extraBall.y})`);
      setOpacity(els.extraBall, f.extraBall.opacity);
    }
  }
  for (const l of [layers.routes, layers.ballRoutes, layers.badges]) setOpacity(l, f.routeOpacity);
}

// The same, on a phase just drawn by the app: how the animation export draws each frame.
export function paintFrame(layers, sched, t, up) {
  paint(findElements(layers), layers, sched, t, up);
}

// show(i): make phase i the shown phase and render. changed(): playing or paused, so refresh the controls.
export function createPlayback({ state, ui, layers, turn, show, changed }) {
  const pb = {
    playing: false,
    speed: 1,
    loop: false,
    option: 'A', // the option letter that plays (Present mode's Option buttons); A is the main plan
    timeScale: 1, // for tests: 0 stops the clock (frames then only move with advance()), 10 plays 10x faster
  };
  let sched = null;
  let t = 0;
  let raf = 0;
  let last = 0;
  // Paused: { phase, stamp (the play as JSON), edit (the selection and tool), end }. end is 'play' once
  // stopped after the last phase, 'option' after a chosen option's phase.
  let frozen = null;
  let els = null; // the shown elements, found after each render

  // Turning the pitch isn't a change to the play: the paused frame stays.
  const stamp = () => JSON.stringify({ ...state, orientation: null });
  const editKey = () => JSON.stringify([ui.selected, ui.tool]);
  const build = i => buildSchedule(state, i, { option: pb.option, loop: pb.loop });

  function start(i, at = 0) {
    sched = build(i);
    t = at;
    show(i);
  }

  function play() {
    if (pb.playing) return;
    pb.playing = true;
    ui.selected = null;
    ui.tool = null;
    if (frozen?.end === 'play') start(0); // after the end, Play starts again from the first phase
    else if (frozen?.end === 'option') { pb.option = 'A'; start(ui.phase); } // and after an option, its phase with A
    else if (frozen) show(ui.phase); // carry on from the paused frame
    else start(ui.phase);
    frozen = null;
    run();
  }

  function run() {
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
    changed();
  }

  function pause({ end = null } = {}) {
    if (!pb.playing) return;
    pb.playing = false;
    cancelAnimationFrame(raf);
    frozen = { phase: ui.phase, stamp: stamp(), edit: editKey(), end };
    changed();
  }

  // Stops playing and drops the paused frame, so the phase is drawn as it is (leaving Present mode).
  function stop() {
    pause();
    pb.option = 'A';
    frozen = null;
    changed();
  }

  // Plays the shown phase with option `letter` instead of A, stopping at its end; 'A' plays on as usual.
  function playOption(letter) {
    pb.option = letter;
    frozen = null;
    pb.playing = true;
    start(ui.phase);
    run();
  }

  // Step back or forward, or a phase tab. Playing carries on from the start of that phase; otherwise it
  // just shows it, for editing. Nothing changes phase in the middle of a drag.
  function jump(i) {
    if (ui.dragging || i < 0 || i >= state.phases.length) return;
    frozen = null;
    pb.option = 'A';
    if (pb.playing) start(i);
    else show(i);
  }

  // Loop on or off. On the last phase the schedule is rebuilt (its end holds and slides back to phase 1, or
  // just holds), keeping the time, so a paused or playing frame stays where it is.
  function setLoop(on) {
    pb.loop = on;
    if (sched && (pb.playing || frozen) && sched.phase === state.phases.length - 1 && sched.option === 'A') {
      const at = t;
      sched = build(sched.phase);
      t = Math.min(at, sched.total);
      draw();
    }
    changed();
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(MAX_FRAME_MS, now - last) * pb.timeScale;
    last = now;
    advance(dt);
  }

  // Moves the clock on by `ms` (at 1x; the speed is applied here) and draws the frame.
  function advance(ms) {
    if (!pb.playing) return;
    t += ms * pb.speed;
    while (t >= sched.total) {
      const rest = t - sched.total;
      if (sched.looping) start(0, rest);
      else if (sched.next) start(ui.phase + 1, rest);
      else {
        t = sched.total;
        draw();
        pause({ end: sched.option === 'A' ? 'play' : 'option' });
        return;
      }
    }
    draw();
  }

  // The paused frame gives way to the phase as it is: before an edit, so editing uses real positions.
  function dropFrame() {
    if (!frozen) return;
    frozen = null;
    pb.option = 'A';
    changed();
  }

  // Called at the end of every render(): finds the freshly drawn elements, and puts them where the
  // animation has them while playing or paused. A paused frame is dropped once the play or the phase changes,
  // or something is selected or a tool picked.
  function afterRender() {
    for (const l of [layers.routes, layers.ballRoutes, layers.badges]) l.style.opacity = '';
    if (frozen && (frozen.phase !== ui.phase || frozen.edit !== editKey() || frozen.stamp !== stamp())) {
      frozen = null;
      pb.option = 'A';
    }
    els = null;
    if (!sched || !(pb.playing || frozen)) return;
    els = findElements(layers);
    draw();
  }

  function draw() {
    if (els) paint(els, layers, sched, t, turn());
  }

  Object.assign(pb, {
    play,
    pause: () => pause(),
    toggle: () => (pb.playing ? pause() : play()),
    stop,
    playOption,
    jump,
    setLoop,
    advance,
    afterRender,
    dropFrame,
  });
  return Object.defineProperties(pb, {
    time: { get: () => t }, // ms into the shown phase's animation
    paused: { get: () => !!frozen }, // a paused frame is on screen
    ended: { get: () => frozen?.end === 'play' }, // stopped after the last phase (Loop off)
    shownPhase: { get: () => sched?.phase ?? null }, // the phase the animation is on
  });
}
