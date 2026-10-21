// File → Save image (this phase, or every phase on one sheet), Save PDF and Save animation: each is drawn from a
// copy of the play (export.js lays out the pictures and pages, animation.js encodes the frames), then handed
// to the user: downloaded on a computer, or the share sheet on a phone (keepFile).

import { svgEl, routeSample, ROUTE_TYPES } from './pitch.js';
import {
  pictureSvg, allPhasesSvg, legendSvg, pageCss, svgToPng, pageFit, makePdf, PX_PER_MM, captionLayout, captionedSvg, focusLayout,
  focusFrameSvg, cueBubbleSize,
} from './export.js';
import { downloadBlob, safeFileName } from './storage.js';
import { round2, playersOurFirst, positionName } from './model.js';
import { paintFrame } from './playback.js';
import { makeAnimation, videoType, videoExtension, ANIMATION_SIZES, POSITION_SIZES, GIF_FPS, VIDEO_FPS } from './animation.js';
import { focusFrames, strength } from './follow.js';
import { jobLine } from './jobs.js';
import { placeBubble } from './cues.js';
import { frameAt } from './animate.js';
import { exportLogo } from './logo.js';

// PDF pages: the pitch picture is drawn at this many times its size in CSS px on the page (about 190 dpi).
const PDF_SCALE = 2;
// All-phases PNG: width of each pitch tile in CSS px, and tiles per row (fewer if there are fewer phases).
const SHEET_TILE_W = { horizontal: 900, vertical: 420 };
const SHEET_COLS = { horizontal: 1, vertical: 2 };
const CATEGORY_LABELS = { attack: 'Attack', defense: 'Defense', lineout: 'Lineout', scrum: 'Scrum' };

// scene: the editing pitch's drawing (scene.js), which draws each picture. finishEdit(save) closes a box being
// typed in over the pitch. teamLogo() is the logo setting now; turn() keeps text upright on the turned pitch.
export function createExporting({ state, ui, svg, layers, scene, playback, render, finishEdit, showToast, busy, teamLogo, touchScreen, turn }) {
  const $ = id => document.getElementById(id);
  const { drawScene, playerR } = scene;

  const legendItems = () => Object.entries(ROUTE_TYPES).map(([type, st]) => [type, st.label]);

  // The pitch's shape as drawn now (its viewBox size), for sizing pictures of it.
  const viewBoxSize = () => {
    const [, , w, h] = svg.getAttribute('viewBox').split(' ').map(Number);
    return { w, h };
  };

  // The play's name on pictures and PDFs.
  const playTitle = play => play.name.trim() || 'Untitled play';

  // Every export works from a copy of the play taken when it starts, and editing is locked until the picture is
  // made, so nothing changed meanwhile (another tab's play, say) can end up half in it. make(play) returns
  // the File; it's then handed to the user. A second export while one is running is ignored.
  async function exportFile(make) {
    if (ui.exporting) return;
    ui.exporting = true;
    finishEdit(true);
    render(null, { record: false });
    let file = null;
    try {
      file = await make(structuredClone(state));
    } catch (err) {
      showToast(err.message);
    } finally {
      ui.exporting = false;
      render(null, { record: false });
    }
    if (file) keepFile(file);
  }

  // Draws with `play` in place of the live play, then puts the live play back. Synchronous, so nothing else
  // can run in between.
  function withPlay(play, draw) {
    const live = { ...state };
    const swap = from => { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, from); };
    swap(play);
    try {
      return draw();
    } finally {
      swap(live);
    }
  }

  // Phase i of `play` as a standalone picture, in the current view, orientation and layers, except that the
  // previous-phase ghost is always left out, and so are selection highlights and handles (nothing is
  // selected while it is drawn). `legend: false` leaves the route key off even if its layer is on.
  // at: { sched, t } draws the moment t of the phase's animation (schedule `sched`) instead of its start.
  // caption goes above the pitch (see pictureSvg). Redraws the shown phase afterwards.
  function phasePicture(play, i, { width, height, scale, css, idPrefix, legend = true, print = false, logo = null, at = null, caption = null }) {
    const keep = { phase: ui.phase, selected: ui.selected, snap: ui.snap, snapTo: ui.snapTo, preview: ui.preview, layers: ui.layers };
    Object.assign(ui, { phase: i, selected: null, snap: null, snapTo: null, preview: null, layers: { ...ui.layers, ghost: false } });
    let picture;
    try {
      picture = withPlay(play, () => {
        drawScene();
        if (at) paintFrame(layers, at.sched, at.t, turn());
        const legendOn = legend && ui.layers.legend ? { items: legendItems(), sample: routeSample } : null;
        return pictureSvg(svg, { width, height, scale, css, legend: legendOn, idPrefix, print, logo, caption });
      });
    } finally {
      Object.assign(ui, keep);
      drawScene();
      playback.afterRender(); // a paused animation frame stays on screen
    }
    return picture;
  }

  // The shown phase as a PNG at twice its on-screen size, with the route key under the pitch.
  function savePng() {
    const i = ui.phase;
    const { width, height } = svg.getBoundingClientRect();
    return exportFile(async play => {
      const logo = await exportLogo(teamLogo());
      const blob = await svgToPng(phasePicture(play, i, { width, height, scale: 2, css: pageCss(), logo }));
      return new File([blob], safeFileName(play.name, `-phase-${i + 1}.png`), { type: 'image/png' });
    });
  }

  // Every phase on one PNG: a grid of tiles, each "Phase n" over the pitch with its note under it, the play
  // name at the top, and one route key under the grid (if the Legend layer is on). Tiles are drawn as the
  // single PNG is, so there's no ghost and nothing selected.
  function saveAllPng() {
    const { w: vbW, h: vbH } = viewBoxSize();
    return exportFile(async play => {
      const tileW = SHEET_TILE_W[play.orientation];
      const tileH = Math.round(tileW * vbH / vbW);
      const css = pageCss();
      const logo = await exportLogo(teamLogo());
      const tiles = play.phases.map((ph, i) => ({
        picture: phasePicture(play, i, { width: tileW, height: tileH, scale: 1, css: '', legend: false, idPrefix: `p${i + 1}-` }),
        label: `Phase ${i + 1}`,
        note: ph.note.trim(),
      }));
      const sheet = allPhasesSvg({
        title: playTitle(play),
        tiles,
        tileW,
        tileH,
        cols: Math.min(SHEET_COLS[play.orientation], tiles.length),
        css,
        legend: ui.layers.legend ? { items: legendItems(), sample: routeSample } : null,
        logo,
      });
      const blob = await svgToPng(sheet);
      return new File([blob], safeFileName(play.name, '-all-phases.png'), { type: 'image/png' });
    });
  }

  // Every phase as a PDF, one page each: a header line with the play name and its category and tags, the
  // pitch picture (as in the PNG, but with darker lines for black and white printing) as large as fits, then
  // "Phase n of N" with the route key beside it, and the phase's note. Horizontal plays get landscape pages,
  // vertical ones portrait. jsPDF is only loaded the first time this runs.
  function savePdf() {
    const { w: vbW, h: vbH } = viewBoxSize();
    if (!ui.exporting) showToast('Making the PDF…', 'ok');
    return exportFile(async play => {
      const orientation = play.orientation === 'vertical' ? 'portrait' : 'landscape';
      const n = play.phases.length;
      const css = pageCss();
      const title = playTitle(play);
      const meta = [CATEGORY_LABELS[play.category] ?? play.category, play.tags.join(', ')].filter(Boolean).join(' · ');
      // The route key sits right of the phase line under the pitch, in as many columns as fit beside it.
      let size = pageFit(orientation, vbW / vbH);
      let legend = null;
      if (ui.layers.legend) {
        const items = { items: legendItems(), sample: routeSample };
        const fit = mm => legendSvg(items, { maxW: (mm - 45) * PX_PER_MM, scale: 3, css, defs: $('defs') });
        let key = fit(size.w);
        size = pageFit(orientation, vbW / vbH, key.h / PX_PER_MM);
        if (key.w / PX_PER_MM > size.w - 45) key = fit(size.w);
        legend = { png: await svgToPng(key.svg), w: key.w / PX_PER_MM, h: key.h / PX_PER_MM };
      }
      const pages = [];
      for (const [i, ph] of play.phases.entries()) {
        const picture = phasePicture(play, i, { width: size.px.w, height: size.px.h, scale: PDF_SCALE, css, legend: false, print: true });
        pages.push({ title, meta, caption: `Phase ${i + 1} of ${n}`, note: ph.note.trim(), png: await svgToPng(picture) });
      }
      const blob = await makePdf(pages, orientation, size, legend, await exportLogo(teamLogo()));
      return new File([blob], safeFileName(play.name, '.pdf'), { type: 'application/pdf' });
    });
  }

  // File → Save animation…: the whole play as Play runs it (every phase, option A), as a GIF that loops or a
  // video. Each frame is the pitch drawn like the PNG (route key, no ghost or handles) under a header with the
  // team logo, the play name and "Phase n of N", with the phase's note as a large caption under it (see
  // captionedSvg). The box shows the progress, and its Cancel (or Escape) stops it. Editing is locked meanwhile.
  let animationJob = null; // { cancelled } while an animation is being made
  function saveAnimation({ format, speed, size, who = '' }) {
    if (who && state.players.some(p => p.id === who)) return savePositionAnimation({ format, speed, who });
    const { w: vbW, h: vbH } = viewBoxSize();
    const width = ANIMATION_SIZES[size] ?? ANIMATION_SIZES.medium;
    const height = Math.round(width * vbH / vbW);
    return exportAnimation(format, async (play, cancelled) => {
      const css = pageCss();
      const logo = await exportLogo(teamLogo());
      const title = playTitle(play);
      const notes = play.phases.map(ph => ph.note.trim());
      let layout = null;
      const blob = await makeAnimation({
        play, format, speed,
        picture: ({ phase: i, sched, t }) => {
          const picture = phasePicture(play, i, { width, height, scale: 1, css, at: { sched, t } });
          layout ??= captionLayout({ width, pictureH: Number(picture.getAttribute('height')), notes, logo });
          return captionedSvg(picture, layout, { title, label: `Phase ${i + 1} of ${play.phases.length}`, note: notes[i], logo });
        },
        progress: showAnimationProgress,
        cancelled,
      });
      return { blob, name: play.name };
    });
  }

  // Makes an animation, with its progress in the box, whose Cancel stops it. make(play, cancelled) makes it
  // from the copy of the play and returns { blob, name }: blob is null if it was cancelled, and the file is
  // called `name` with the format's extension.
  function exportAnimation(format, make) {
    const dialog = $('animation-dialog');
    const job = { cancelled: false };
    animationJob = job;
    showAnimationProgress(0);
    return exportFile(async play => {
      try {
        const { blob, name } = await make(play, () => job.cancelled);
        if (!blob) {
          showToast('Animation cancelled', 'ok');
          return null;
        }
        const ext = format === 'gif' ? '.gif' : videoExtension(blob.type);
        return new File([blob], safeFileName(name, ext), { type: blob.type });
      } finally {
        animationJob = null;
        if (dialog.open) dialog.close();
      }
    });
  }

  // Save animation → Who: a position. The play follows that player on an upright pitch, as the phone viewer
  // does (follow.js, with the same timing: their cues pop up as each step starts, and it eases to half speed
  // while one is new), in a phone-shaped frame (POSITION_SIZES) with the header, their job for each phase at
  // the bottom (jobs.js) and the cue bubbles next to them. Named "<play name> - Attack 10.gif" (or video).
  function savePositionAnimation({ format, speed, who }) {
    const { width, height } = POSITION_SIZES[format] ?? POSITION_SIZES.gif;
    return exportAnimation(format, async (live, cancelled) => {
      const play = { ...live, view: 'full', orientation: 'vertical' };
      const css = pageCss();
      const logo = await exportLogo(teamLogo());
      const layout = focusLayout({ width, height, logo });
      const player = play.players.find(p => p.id === who);
      const title = playTitle(play);
      const jobs = play.phases.map((_, i) => jobLine(play, i, who));
      const frames = focusFrames(play, who, { fps: format === 'gif' ? GIF_FPS : VIDEO_FPS, speed, aspect: width / layout.pitchH });
      const blob = await makeAnimation({
        play, format, speed, frames,
        picture: frame => focusPicture(play, frame, { who, layout, css, logo, title, label: `Phase ${frame.phase + 1} of ${play.phases.length} · ${positionName(player)}`, job: jobs[frame.phase] }),
        progress: showAnimationProgress,
        cancelled,
      });
      return { blob, name: `${play.name} - ${positionName(player)}` };
    });
  }

  // One frame of a position's animation: the phase drawn like the PNG at the frame's moment, framed on the
  // player (the frame's camera), their team-mates and far opponents faded as in the viewer, a yellow ring on
  // them, and the cue bubble next to them, clear of their disc.
  function focusPicture(play, { phase: i, sched, t, cam, bubbles }, { who, layout, css, logo, title, label, job }) {
    const { width, pitchH } = layout;
    const picture = phasePicture(play, i, { width, height: pitchH, scale: 1, css, legend: false, at: { sched, t } });
    const pitch = picture.querySelector(':scope > svg');
    pitch.setAttribute('viewBox', [cam.x, cam.y, cam.w, cam.h].map(round2).join(' '));
    const f = frameAt(sched, t);
    const on = strength(play.players, f, who);
    const from = new Map(play.phases[i].routes.map(r => [r.id, r.from]));
    for (const g of pitch.querySelectorAll('.player[data-id], .player-label[data-id]')) {
      if (on[g.dataset.id] < 1) g.setAttribute('opacity', on[g.dataset.id]);
      if (g.dataset.id === who) g.querySelector('.body')?.before(svgEl('circle', { r: playerR() + 0.75, class: 'me-ring' }));
    }
    for (const g of pitch.querySelectorAll('[data-kind="route"][data-id], .route-line[data-id], .badge[data-id]')) {
      const o = on[from.get(g.dataset.id)] ?? 1;
      if (o < 1) g.setAttribute('opacity', o);
    }
    let bubble = null;
    const me = f.players[who];
    if (bubbles.length && me) {
      const lines = bubbles.map(b => b.text.toUpperCase());
      const size = cueBubbleSize(lines, layout);
      const k = width / cam.w;
      const at = placeBubble({ x: (me.y - cam.x) * k, y: (-me.x - cam.y) * k, r: (playerR() + 0.75) * k, w: size.w, h: size.h, width, height: pitchH, margin: layout.pad / 2, gap: layout.pad / 2 });
      const youngest = Math.min(...bubbles.map(b => b.age));
      bubble = { lines, ...at, scale: Math.min(1, 0.6 + 0.4 * youngest / 180) };
    }
    return focusFrameSvg(picture, layout, { title, label, job, logo, bubble });
  }

  function showAnimationProgress(done) {
    const busyNow = done != null && animationJob != null;
    $('animation-progress').value = done ?? 0;
    $('animation-status').textContent = `Making the animation… ${Math.floor((done ?? 0) * 100)}%`;
    $('animation-busy').hidden = !busyNow;
    $('animation-save').hidden = busyNow;
    for (const el of $('animation-dialog').querySelectorAll('fieldset')) el.disabled = busyNow;
    updateAnimationWho();
  }

  // Who: the whole team, or a position (both teams, our team first). A position has its own upright size.
  function updateAnimationWho() {
    const position = !!$('animation-who').value;
    $('animation-who-tip').hidden = !position;
    if (position) $('animation-size-choice').disabled = true;
  }

  function openAnimationDialog() {
    const select = $('animation-who');
    const keep = select.value;
    const players = playersOurFirst(state);
    select.replaceChildren(new Option('Whole team', ''), ...players.map(p => new Option(positionName(p), p.id)));
    select.value = players.some(p => p.id === keep) ? keep : '';
    showAnimationProgress(null);
    $('animation-dialog').showModal();
    $('animation-save').focus();
  }

  function initAnimationDialog() {
    const dialog = $('animation-dialog');
    const pick = name => dialog.querySelector(`[name="${name}"]:checked`)?.value;
    $('animation-save').addEventListener('click', () => {
      if (busy()) return;
      saveAnimation({ format: pick('animation-format'), speed: Number(pick('animation-speed')), size: pick('animation-size'), who: $('animation-who').value });
    });
    $('animation-who').addEventListener('change', () => showAnimationProgress(animationJob ? 0 : null));
    // Cancel, Escape: stop the animation being made (the box closes when it has stopped), or just close.
    const cancel = e => {
      if (!animationJob) return;
      e.preventDefault();
      animationJob.cancelled = true;
    };
    $('animation-cancel').addEventListener('click', cancel);
    dialog.addEventListener('cancel', cancel);
    // If the browser closes the box anyway (a second Escape), the animation stops too.
    dialog.addEventListener('close', () => { if (animationJob) animationJob.cancelled = true; });
    const video = dialog.querySelector('[name="animation-format"][value="video"]');
    if (!videoType()) {
      video.disabled = true;
      video.closest('label').title = "This browser can't record video";
    }
  }

  // Hands a made file to the user. Computers download it. Phones and tablets get the share sheet (Save
  // Image or Save to Files on iPhone); if sharing isn't possible there, the file opens in a dialog to save from.
  async function keepFile(file) {
    if (!touchScreen.matches) {
      downloadBlob(file, file.name);
      showToast(`Saved ${file.name}`, 'ok');
      return;
    }
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        showToast(`Saved ${file.name}`, 'ok');
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // the user closed the share sheet
      }
    }
    showFile(file);
  }

  // Fallback for phones that can't share the file straight away: the file, with ways to keep it.
  function showFile(file) {
    const dialog = $('save-dialog');
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    const url = URL.createObjectURL(file);
    $('save-title').textContent = isImage ? 'Save image' : isVideo ? 'Save video' : 'Save PDF';
    $('save-tip').textContent = isImage
      ? 'Press and hold the picture to save it, or open it in a new tab.'
      : `Open the ${isVideo ? 'video' : 'PDF'} in a new tab, then use Share to save it${isVideo ? '' : ' to Files'}.`;
    const preview = $('save-preview');
    preview.hidden = !isImage;
    if (isImage) preview.src = url; else preview.removeAttribute('src');
    $('save-open').href = url;
    const share = $('save-share');
    share.hidden = !navigator.canShare?.({ files: [file] });
    share.onclick = () => navigator.share({ files: [file] }).catch(() => {});
    dialog.addEventListener('close', () => URL.revokeObjectURL(url), { once: true });
    dialog.showModal();
  }

  // Save image: this phase or all phases. The buttons save straight from their click, so a phone's share
  // sheet still counts it as the user's tap.
  function initImageDialog() {
    const dialog = $('image-dialog');
    for (const b of dialog.querySelectorAll('[data-image]')) {
      b.addEventListener('click', () => {
        dialog.close();
        if (b.dataset.image === 'all') saveAllPng();
        else savePng();
      });
    }
  }

  return { savePng, saveAllPng, savePdf, openAnimationDialog, initAnimationDialog, initImageDialog };
}
