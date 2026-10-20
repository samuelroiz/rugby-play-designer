// Pictures of the pitch: a PNG of one phase, a PNG of every phase in a grid, and a PDF with one page per
// phase made with jsPDF (vendor/jspdf.umd.min.js, loaded on first use). All start from a copy of the pitch
// SVG as currently drawn; the app redraws the phase with nothing selected and no ghost before copying.

import { svgEl } from './pitch.js';

const NS = 'http://www.w3.org/2000/svg';
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const PX_PER_MM = 96 / 25.4;

// PDF pages are A4 with 10 mm margins. Above the pitch: the header line (play name, category and tags).
// Below it: the phase line with the route key beside it, then at least two lines of note. Sizes in mm.
const MARGIN = 10;
const PAGE_MM = { landscape: { w: 297, h: 210 }, portrait: { w: 210, h: 297 } };
const HEADER_MM = 9;
const ROW_MM = 6; // the phase line; taller if the route key beside it is
const NOTE_MM = 11;
const GAP_MM = 2;
const PT_TO_MM = 25.4 / 72;
// Darker pitch lines and labels for PDF pages, so they survive black and white printing. Only pictures
// made with `print` get the class these rules hang on; the screen keeps its white lines.
const PRINT_CSS = `
.print .line, .print .crossbar, .print .scrum-mark { stroke: #141414; }
.print .post { fill: #141414; stroke: #141414; }
.print .distance { fill: rgba(0, 0, 0, .72); }
.print .grid line { stroke: rgba(0, 0, 0, .28); }
.print .marker .outline { stroke: #141414; }`;
const JSPDF_URL = new URL('../vendor/jspdf.umd.min.js', import.meta.url).href;

// All-phases PNG, in CSS px before scaling: outer margin, gap between tiles, text sizes, and at most
// two lines of note under each pitch. The scale is cut if the picture would pass MAX_PIXELS, which keeps
// it under the canvas size limit on iPhones (about 16.7 million pixels).
const SHEET = { margin: 24, gap: 24, titlePx: 22, labelPx: 15, notePx: 13, noteLines: 2 };
const MAX_PIXELS = 16e6;
// The team logo on a PNG: this share of the picture's width (less for a very tall logo, which is kept to
// LOGO_MAX_H of the width), in the top right corner.
const LOGO_W = 0.08;
const LOGO_MAX_H = 0.12;
// In the PDF header line, left of the play name: this tall (mm), and at most LOGO_PDF_MAX_W wide.
const LOGO_PDF_H = 7;
const LOGO_PDF_MAX_W = 21;

// The logo's size for a picture `width` wide. logo: { href, w, h } from exportLogo().
function logoBox(logo, width) {
  let w = width * LOGO_W;
  let h = w * logo.h / logo.w;
  if (h > width * LOGO_MAX_H) { h = width * LOGO_MAX_H; w = h * logo.w / logo.h; }
  return { w, h };
}
const logoImage = (logo, attrs, parent) => svgEl('image', { href: logo.href, preserveAspectRatio: 'xMidYMid meet', class: 'export-logo', ...attrs }, parent);

// Copy of the pitch as a standalone SVG of width x height (CSS px), drawn `scale` times larger.
// legend: { items: [[type, label]], sample: type -> <svg> } adds the route key in a white strip under the
// pitch (never on it), in as many columns as fit, which makes the picture that much taller.
// css: style rules to embed, needed when the SVG is used as an image rather than inside the page.
// idPrefix keeps marker ids unique when several copies sit in one page. print darkens the pitch lines.
// logo: { href, w, h } puts the team logo in the top right corner, in a white strip above the pitch so it
// never covers it. caption (e.g. "Phase 2") goes on the left of that strip, which is made tall enough for it.
export function pictureSvg(svg, { width, height, scale = 1, legend = null, css = '', idPrefix = 'x-', print = false, logo = null, caption = null }) {
  const key = legend ? fitLegend(legend, width - 16) : null;
  const mark = logo ? logoBox(logo, width) : null;
  const pad = Math.round(width * 0.012);
  const captionPx = Math.round(width * 0.028);
  const top = Math.max(mark ? mark.h + 2 * pad : 0, caption ? Math.round(captionPx * 1.7) : 0);
  const fullH = top + (key ? height + key.h + 16 : height);
  const out = svgEl('svg', { xmlns: NS, width: width * scale, height: fullH * scale, viewBox: `0 0 ${width} ${fullH}`, class: print ? 'print' : null });
  if (css || print) svgEl('style', {}, out).textContent = css + (print ? PRINT_CSS : '');
  if (key || mark || caption) svgEl('rect', { width, height: fullH, fill: '#fff' }, out);
  if (mark) logoImage(logo, { x: width - pad - mark.w, y: (top - mark.h) / 2, width: mark.w, height: mark.h }, out);
  if (caption) {
    svgEl('text', {
      x: 2 * pad, y: top / 2, 'font-size': captionPx, 'font-weight': 700, 'font-family': FONT, fill: '#1d1d1d',
      'dominant-baseline': 'central', class: 'export-caption',
    }, out).textContent = caption;
  }

  const pitch = svg.cloneNode(true);
  for (const attr of ['id', 'class', 'style', 'role', 'aria-label']) pitch.removeAttribute(attr);
  Object.entries({ x: 0, y: top, width, height, preserveAspectRatio: 'xMidYMid meet' }).forEach(([k, v]) => pitch.setAttribute(k, v));
  // Invisible touch targets aren't needed in a picture.
  for (const el of pitch.querySelectorAll('.hit, .route-hit, .handle')) el.remove();
  for (const el of pitch.querySelectorAll('[id]')) {
    if (el.tagName === 'marker') el.id = idPrefix + el.id;
    else el.removeAttribute('id');
  }
  out.appendChild(pitch);

  if (key) {
    key.g.setAttribute('transform', `translate(8 ${top + height + 8})`);
    out.appendChild(key.g);
  }
  // Arrowheads on the pitch and in the legend point at the renamed markers.
  for (const el of out.querySelectorAll('[marker-end]')) {
    el.setAttribute('marker-end', el.getAttribute('marker-end').replace('url(#', `url(#${idPrefix}`));
  }
  return out;
}

// Animation frames (GIF and video): a header with the team logo (if any), the play name in bold and
// "Phase n of N", the picture from pictureSvg under it, and the phase's note under that as a caption large
// enough to read on a phone: at least CAPTION.notePx of the frame's height, wrapped to at most
// CAPTION.maxLines lines and cut with "…". Sizes are shares of the frame's width, except the note's.
const CAPTION = { titlePx: 0.03, labelPx: 0.022, pad: 0.016, notePx: 0.04, lineH: 1.25, maxLines: 3, logoMaxW: 0.2 };

// The frame's layout, the same for every frame of the play so the size never changes: the caption has room
// for as many lines as the longest of `notes` needs (none if no phase has a note). pictureH: the picture's
// height at `width`. logo: { href, w, h } or null.
export function captionLayout({ width, pictureH, notes, logo = null }) {
  const pad = Math.round(width * CAPTION.pad);
  const titlePx = Math.round(width * CAPTION.titlePx);
  const labelPx = Math.round(width * CAPTION.labelPx);
  const headerH = Math.round(2 * pad + titlePx * 1.2 + labelPx * 1.3);
  let mark = null;
  if (logo) {
    const h = headerH - 2 * pad;
    const w = Math.min(width * CAPTION.logoMaxW, h * logo.w / logo.h);
    mark = { w, h: w * logo.h / logo.w };
  }
  const textW = width - 2 * pad;
  const size = lines => {
    const height = Math.ceil((headerH + pictureH + (lines ? 2 * pad : 0)) / (1 - lines * CAPTION.lineH * CAPTION.notePx));
    return { height, notePx: Math.ceil(height * CAPTION.notePx) };
  };
  // The note's size depends on the frame's height, which depends on how many lines it takes: size it for the
  // most lines, see how many the notes need at that size, then size it for those (a smaller font never needs more).
  const most = size(CAPTION.maxLines);
  const lines = Math.max(0, ...notes.map(n => wrapLines(n, textW, `400 ${most.notePx}px ${FONT}`, CAPTION.maxLines).length));
  return { width, pad, titlePx, labelPx, headerH, mark, textW, lines, ...size(lines) };
}

// One frame: `picture` (from pictureSvg, layout.width wide) framed as captionLayout() says.
export function captionedSvg(picture, layout, { title, label, note, logo = null }) {
  const { width, height, pad, titlePx, labelPx, headerH, mark, textW, lines, notePx } = layout;
  const out = svgEl('svg', { xmlns: NS, width, height, viewBox: `0 0 ${width} ${height}` });
  svgEl('rect', { width, height, fill: '#fff' }, out);
  const text = (str, y, px, attrs) => {
    svgEl('text', { x: pad, y, 'font-size': px, 'font-family': FONT, fill: '#1d1d1d', 'dominant-baseline': 'hanging', ...attrs }, out).textContent = str;
  };
  const headW = textW - (mark ? mark.w + pad : 0);
  text(wrapLines(title, headW, `700 ${titlePx}px ${FONT}`, 1)[0] ?? '', pad, titlePx, { 'font-weight': 700, class: 'export-title' });
  text(label, pad + titlePx * 1.2, labelPx, { fill: '#444', 'font-weight': 600, class: 'export-caption' });
  if (mark) logoImage(logo, { x: width - pad - mark.w, y: (headerH - mark.h) / 2, width: mark.w, height: mark.h }, out);
  picture.setAttribute('x', 0);
  picture.setAttribute('y', headerH);
  out.appendChild(picture);
  const top = headerH + Number(picture.getAttribute('height')) + pad;
  wrapLines(note, textW, `400 ${notePx}px ${FONT}`, lines).forEach((line, i) => {
    text(line, top + i * notePx * CAPTION.lineH, notePx, { class: 'export-note' });
  });
  return out;
}

// A position's animation frame (GIF 720 x 1280, video 1080 x 1920): a header with the team logo, the play
// name and "Phase n of N · Position 10", the pitch following the player, and their job at the bottom in large
// bold text, shrunk to fit at most FOCUS.jobLines lines (and cut with "…" past that). Sizes are shares of the
// frame's width.
const FOCUS = { titlePx: 0.045, labelPx: 0.032, pad: 0.03, jobLabelPx: 0.028, jobPx: 0.058, jobMinPx: 0.04, lineH: 1.2, jobLines: 2, logoMaxW: 0.22, cuePx: 0.06 };

export function focusLayout({ width, height, logo = null }) {
  const pad = Math.round(width * FOCUS.pad);
  const titlePx = Math.round(width * FOCUS.titlePx);
  const labelPx = Math.round(width * FOCUS.labelPx);
  const headerH = Math.round(2 * pad + titlePx * 1.2 + labelPx * 1.3);
  let mark = null;
  if (logo) {
    const h = headerH - 2 * pad;
    const w = Math.min(width * FOCUS.logoMaxW, h * logo.w / logo.h);
    mark = { w, h: w * logo.h / logo.w };
  }
  const jobLabelPx = Math.round(width * FOCUS.jobLabelPx);
  const jobPx = Math.round(width * FOCUS.jobPx);
  const jobH = Math.round(2 * pad + jobLabelPx * 1.5 + FOCUS.jobLines * jobPx * FOCUS.lineH);
  return { width, height, pad, titlePx, labelPx, headerH, mark, jobLabelPx, jobPx, jobH, pitchH: height - headerH - jobH, textW: width - 2 * pad };
}

// The job line's size and lines: as large as fits FOCUS.jobLines lines, down to FOCUS.jobMinPx of the width.
function fitJob(job, layout) {
  const min = Math.round(layout.width * FOCUS.jobMinPx);
  for (let px = layout.jobPx; px > min; px -= 2) {
    const lines = wrapLines(job, layout.textW, `800 ${px}px ${FONT}`, 99);
    if (lines.length <= FOCUS.jobLines) return { px, lines };
  }
  return { px: min, lines: wrapLines(job, layout.textW, `800 ${min}px ${FONT}`, FOCUS.jobLines) };
}

// The size of a cue bubble with these lines of text, for placing it (cues.js placeBubble) before drawing it.
export function cueBubbleSize(lines, layout) {
  const px = Math.round(layout.width * FOCUS.cuePx);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `900 ${px}px ${FONT}`;
  const padX = px * 0.5;
  const padY = px * 0.3;
  const w = Math.min(layout.width - 2 * layout.pad, Math.max(...lines.map(l => ctx.measureText(l).width)) + 2 * padX);
  return { px, w, h: lines.length * px * 1.15 + 2 * padY, padY };
}

// One frame: `picture` (from pictureSvg, layout.width x layout.pitchH, already framed on the player) under
// the header, the job under it, and bubble: { lines, left, top, scale } (top left in the pitch's px) or null.
export function focusFrameSvg(picture, layout, { title, label, job, logo = null, bubble = null }) {
  const { width, height, pad, titlePx, labelPx, headerH, mark, jobLabelPx, pitchH, textW } = layout;
  const out = svgEl('svg', { xmlns: NS, width, height, viewBox: `0 0 ${width} ${height}` });
  svgEl('rect', { width, height, fill: '#fff' }, out);
  const text = (str, x, y, px, attrs) => {
    svgEl('text', { x, y, 'font-size': px, 'font-family': FONT, fill: '#1d1d1d', 'dominant-baseline': 'hanging', ...attrs }, out).textContent = str;
  };
  const headW = textW - (mark ? mark.w + pad : 0);
  text(wrapLines(title, headW, `700 ${titlePx}px ${FONT}`, 1)[0] ?? '', pad, pad, titlePx, { 'font-weight': 700, class: 'export-title' });
  text(label, pad, pad + titlePx * 1.2, labelPx, { fill: '#444', 'font-weight': 600, class: 'export-caption' });
  if (mark) logoImage(logo, { x: width - pad - mark.w, y: (headerH - mark.h) / 2, width: mark.w, height: mark.h }, out);
  picture.setAttribute('x', 0);
  picture.setAttribute('y', headerH);
  out.appendChild(picture);
  if (bubble) {
    const size = cueBubbleSize(bubble.lines, layout);
    const cx = bubble.left + size.w / 2;
    const cy = headerH + bubble.top + size.h / 2;
    const s = Math.round(bubble.scale * 100) / 100;
    const g = svgEl('g', { class: 'export-cue-bubble', transform: `translate(${cx} ${cy}) scale(${s}) translate(${-size.w / 2} ${-size.h / 2})` }, out);
    svgEl('rect', { width: size.w, height: size.h, rx: size.px * 0.4, fill: '#ffeb3b', stroke: '#1d1d1d', 'stroke-width': Math.max(2, size.px * 0.07) }, g);
    bubble.lines.forEach((line, i) => {
      svgEl('text', {
        x: size.w / 2, y: size.padY + i * size.px * 1.15, 'font-size': size.px, 'font-weight': 900, 'font-family': FONT, fill: '#1d1d1d',
        'text-anchor': 'middle', 'dominant-baseline': 'hanging', class: 'export-cue',
      }, g).textContent = line;
    });
  }
  const top = headerH + pitchH + pad;
  text('YOUR JOB', pad, top, jobLabelPx, { fill: '#555', 'font-weight': 700, 'letter-spacing': jobLabelPx * 0.08 });
  const { px, lines } = fitJob(job, layout);
  lines.forEach((line, i) => text(line, pad, top + jobLabelPx * 1.5 + i * px * FOCUS.lineH, px, { 'font-weight': 800, class: 'export-job' }));
  return out;
}

// The route key as SVG, laid out like the on-screen legend: `cols` type/label pairs per row.
// Returns the group (top left at 0, 0) and its size.
function legendBox({ items, sample, cols }) {
  const font = 12;
  const sw = 38;
  const sh = 14;
  const rowH = 16;
  const pad = { x: 9, y: 6 };
  const gap = { x: 8, y: 3 };
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `${font}px ${FONT}`;

  const rows = Math.ceil(items.length / cols);
  const colW = [];
  items.forEach(([, label], i) => {
    const c = i % cols;
    colW[c] = Math.max(colW[c] ?? 0, sw + gap.x + measure.measureText(label).width);
  });
  const w = pad.x * 2 + colW.reduce((a, b) => a + b, 0) + gap.x * 1.5 * (cols - 1);
  const h = pad.y * 2 + rows * rowH + (rows - 1) * gap.y;
  const g = svgEl('g', { class: 'legend-key' });
  svgEl('rect', { width: w, height: h, rx: 6, fill: 'rgba(255, 255, 255, .9)' }, g);

  items.forEach(([type, label], i) => {
    const c = i % cols;
    const x = pad.x + colW.slice(0, c).reduce((a, b) => a + b, 0) + c * gap.x * 1.5;
    const y = pad.y + Math.floor(i / cols) * (rowH + gap.y);
    svgEl('rect', { x, y: y + (rowH - sh) / 2, width: sw, height: sh, rx: 3, fill: '#3d8b40' }, g);
    const s = sample(type);
    s.removeAttribute('class');
    Object.entries({ x, y: y + (rowH - sh) / 2, width: sw, height: sh, overflow: 'visible' }).forEach(([k, v]) => s.setAttribute(k, v));
    g.appendChild(s);
    svgEl('text', { x: x + sw + gap.x, y: y + rowH / 2, 'font-size': font, 'font-family': FONT, fill: '#1d1d1d', 'dominant-baseline': 'central' }, g).textContent = label;
  });
  return { g, w, h };
}

// The route key in as many columns (6, 3, 2 or 1) as fit maxW.
function fitLegend(legend, maxW) {
  let key = null;
  for (const cols of [6, 3, 2, 1]) {
    key = legendBox({ ...legend, cols });
    if (key.w <= maxW) break;
  }
  return key;
}

// The route key on its own as an SVG, `scale` times its size in CSS px, in as many columns as fit maxW.
// defs: the pitch's <defs>, whose arrowheads the samples use. Returns { svg, w, h } (w, h in CSS px).
export function legendSvg(legend, { maxW, scale = 1, css = '', defs }) {
  const key = fitLegend(legend, maxW);
  const out = svgEl('svg', { xmlns: NS, width: Math.ceil(key.w * scale), height: Math.ceil(key.h * scale), viewBox: `0 0 ${key.w} ${key.h}` });
  if (css) svgEl('style', {}, out).textContent = css;
  out.appendChild(defs.cloneNode(true)).removeAttribute('id');
  out.appendChild(key.g);
  return { svg: out, w: key.w, h: key.h };
}

// Every phase on one sheet: the play name at the top, then a grid of tiles, each "Phase n" over its pitch
// with the note under it (cut to two lines with "…"), and the route key under the grid if `legend` is set.
// tiles: [{ picture (from pictureSvg, tileW x tileH at scale 1), label, note }]. legend: { items, sample }.
// logo: { href, w, h } puts the team logo in the top right corner, beside the title; the title row grows
// to fit it, so it never reaches the first pitch.
export function allPhasesSvg({ title, tiles, tileW, tileH, cols, scale = 2, css = '', legend = null, logo = null }) {
  const { margin, gap, titlePx, labelPx, notePx, noteLines } = SHEET;
  const labelH = labelPx * 1.6;
  const noteLineH = notePx * 1.35;
  const tileFullH = labelH + tileH + 6 + noteLines * noteLineH;
  const rows = Math.ceil(tiles.length / cols);
  const width = margin * 2 + cols * tileW + (cols - 1) * gap;
  const mark = logo ? logoBox(logo, width) : null;
  const titleH = Math.max(titlePx * 1.3, mark?.h ?? 0) + 14;
  // The route key under the grid, in one row if it fits the sheet, otherwise in fewer columns.
  const key = legend ? fitLegend(legend, width - 2 * margin) : null;
  const gridH = rows * tileFullH + (rows - 1) * gap;
  const height = margin + titleH + gridH + (key ? gap / 2 + key.h : 0) + margin;
  const s = Math.min(scale, Math.sqrt(MAX_PIXELS / (width * height)));

  const out = svgEl('svg', { xmlns: NS, width: Math.round(width * s), height: Math.round(height * s), viewBox: `0 0 ${width} ${height}` });
  if (css) svgEl('style', {}, out).textContent = css;
  svgEl('rect', { width, height, fill: '#fff' }, out);
  const text = (str, x, y, px, attrs = {}) => {
    svgEl('text', { x, y, 'font-size': px, 'font-family': FONT, fill: '#1d1d1d', 'dominant-baseline': 'hanging', ...attrs }, out).textContent = str;
  };
  const titleLine = wrapLines(title, width - 2 * margin - (mark ? mark.w + gap : 0), `700 ${titlePx}px ${FONT}`, 1)[0];
  text(titleLine, margin, margin, titlePx, { 'font-weight': 700, class: 'sheet-title' });
  if (mark) logoImage(logo, { x: width - margin - mark.w, y: margin, width: mark.w, height: mark.h }, out);

  tiles.forEach(({ picture, label, note }, i) => {
    const x = margin + (i % cols) * (tileW + gap);
    const y = margin + titleH + Math.floor(i / cols) * (tileFullH + gap);
    text(label, x, y, labelPx, { 'font-weight': 700, class: 'tile-label' });
    picture.setAttribute('x', x);
    picture.setAttribute('y', y + labelH);
    picture.setAttribute('class', 'tile');
    out.appendChild(picture);
    wrapLines(note, tileW, `400 ${notePx}px ${FONT}`, noteLines).forEach((line, j) => {
      text(line, x, y + labelH + tileH + 6 + j * noteLineH, notePx, { fill: '#444', class: 'tile-note' });
    });
  });

  if (key) {
    key.g.setAttribute('transform', `translate(${margin} ${margin + titleH + gridH + gap / 2})`);
    out.appendChild(key.g);
  }
  return out;
}

// Wraps text to maxW (px, in the given canvas font) and keeps at most maxLines, ending with "…" if cut.
function wrapLines(text, maxW, font, maxLines) {
  if (!text) return [];
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = font;
  const width = s => ctx.measureText(s).width;
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (line && width(line + word) > maxW && word.trim()) { lines.push(line.trimEnd()); line = word.trimStart(); }
      else line += word;
    }
    lines.push(line);
  }
  return cutLines(lines, maxLines, width, maxW);
}

// Style rules from the page's stylesheets, for embedding in an SVG that is drawn as an image.
export function pageCss() {
  const rules = [];
  for (const sheet of document.styleSheets) {
    try {
      for (const r of sheet.cssRules) if (r instanceof CSSStyleRule) rules.push(r.cssText);
    } catch { /* a stylesheet we can't read: skip it */ }
  }
  return rules.join('\n');
}

// SVG element -> PNG Blob, at the SVG's own width and height attributes.
export async function svgToPng(picture) {
  const width = Number(picture.getAttribute('width'));
  const height = Number(picture.getAttribute('height'));
  const xml = new XMLSerializer().serializeToString(picture);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("The picture couldn't be drawn."));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error("The picture couldn't be saved.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Pitch size on a PDF page, in mm, for a view of aspect ratio `ar` (width / height): the full width
// between the margins if the page is tall enough, otherwise as tall as leaves room for the header, the
// phase line (at least legendH, the route key's height) and two lines of note.
export function pageFit(orientation, ar, legendH = 0) {
  const page = PAGE_MM[orientation];
  const boxW = page.w - 2 * MARGIN;
  const boxH = page.h - 2 * MARGIN - HEADER_MM - GAP_MM - Math.max(ROW_MM, legendH) - GAP_MM - NOTE_MM;
  const w = Math.min(boxW, boxH * ar);
  return { w, h: w / ar, row: Math.max(ROW_MM, legendH), px: { w: w * PX_PER_MM, h: (w / ar) * PX_PER_MM } };
}

// jsPDF, loaded once by adding its script to the page. A failed load can be tried again.
let jsPdfLoading = null;
function loadJsPdf() {
  jsPdfLoading ??= new Promise((resolve, reject) => {
    if (globalThis.jspdf) return resolve(globalThis.jspdf.jsPDF);
    const script = document.createElement('script');
    script.src = JSPDF_URL;
    script.onload = () => (globalThis.jspdf ? resolve(globalThis.jspdf.jsPDF) : reject(new Error()));
    script.onerror = reject;
    document.head.appendChild(script);
  }).catch(() => {
    jsPdfLoading = null;
    throw new Error("The PDF maker couldn't be loaded. Check your connection and try again.");
  });
  return jsPdfLoading;
}

// pages: one { title, meta, caption, note, png (Blob) } per phase. size: the pitch on the page, from pageFit().
// legend: { png (Blob), w, h } in mm, or null. logo: { href, w, h, format } or null. Returns the PDF as a Blob.
// Each page: the team logo (if any) and the play name on the left of the header line and its category and tags on the right, the pitch,
// "Phase n of N" under its left edge with the route key under its right edge, then the note.
export async function makePdf(pages, orientation, size, legend = null, logo = null) {
  const JsPDF = await loadJsPdf();
  const doc = new JsPDF({ orientation, unit: 'mm', format: 'a4', compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = (pageW - size.w) / 2;
  const right = left + size.w;
  const legendPng = legend && new Uint8Array(await legend.png.arrayBuffer());
  const mark = logo && { h: Math.min(LOGO_PDF_H, LOGO_PDF_MAX_W * logo.h / logo.w), w: Math.min(LOGO_PDF_MAX_W, LOGO_PDF_H * logo.w / logo.h) };
  const titleX = mark ? left + mark.w + 2.5 : left;
  for (const [i, page] of pages.entries()) {
    if (i) doc.addPage('a4', orientation);
    let y = MARGIN;
    const meta = page.meta
      ? writeText(doc, page.meta, { x: right, y: y + 1.6, align: 'right', maxW: size.w * 0.45, pt: 10, maxLines: 1, grey: true })
      : { w: 0 };
    if (mark) doc.addImage(logo.href, logo.format, left, y - 1 + (LOGO_PDF_H - mark.h) / 2, mark.w, mark.h, 'team-logo', 'FAST');
    writeText(doc, page.title, { x: titleX, y, align: 'left', maxW: size.w - meta.w - 6 - (titleX - left), pt: 15, bold: true, maxLines: 1 });
    y += HEADER_MM;
    const png = new Uint8Array(await page.png.arrayBuffer());
    doc.addImage(png, 'PNG', left, y, size.w, size.h, `phase-${i + 1}`, 'FAST');
    y += size.h + GAP_MM;
    writeText(doc, page.caption, { x: left, y, align: 'left', maxW: size.w / 2, pt: 12, bold: true, maxLines: 1 });
    if (legendPng) doc.addImage(legendPng, 'PNG', right - legend.w, y, legend.w, legend.h, 'legend', 'FAST');
    y += size.row + GAP_MM;
    if (page.note) {
      const lineH = 11 * PT_TO_MM * 1.25;
      writeText(doc, page.note, { x: left, y, align: 'left', maxW: size.w, pt: 11, maxLines: Math.max(1, Math.floor((pageH - MARGIN - y) / lineH)) });
    }
  }
  return doc.output('blob');
}

// The PDF's built-in Helvetica only has Western European letters (Windows-1252). Text with anything else
// (macrons, other alphabets, emoji) is drawn as a picture instead, so it still reads correctly.
const WIN_1252 = /^[\n\t\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/;

// Writes text with its top at y (mm), its `align` edge (left, right or centre) at x, wrapped to maxW and cut
// to maxLines. grey: a softer colour for secondary text. Returns { bottom, w } (the y below it, its width).
function writeText(doc, text, { x, y, align = 'center', maxW, pt, bold = false, maxLines, grey = false }) {
  const lineH = pt * PT_TO_MM * 1.25;
  if (!WIN_1252.test(text)) {
    const { h, w } = textPicture(doc, text, { x, y, align, maxW, pt, bold, maxLines, lineH, grey });
    return { bottom: y + h, w };
  }
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(pt);
  doc.setTextColor(...(grey ? [90, 90, 90] : [0, 0, 0]));
  const lines = cutLines(doc.splitTextToSize(text, maxW), maxLines, line => doc.getTextWidth(line), maxW);
  doc.text(lines, x, y, { align, baseline: 'top', lineHeightFactor: 1.25 });
  return { bottom: y + lines.length * lineH, w: Math.max(...lines.map(l => doc.getTextWidth(l))) };
}

// Keeps at most maxLines lines, ending the last kept one with "…" (shortened to fit) if any were dropped.
function cutLines(lines, maxLines, width, maxW) {
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && width(`${last}…`) > maxW) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

// Draws text into a canvas with the system font and puts it on the page as a picture, placed like
// writeText. Returns its height and width in mm.
function textPicture(doc, text, { x, y, align, maxW, pt, bold, maxLines, lineH, grey }) {
  const pxPerMm = 8; // about 200 dpi
  const font = `${bold ? 700 : 400} ${pt * PT_TO_MM * pxPerMm}px ${FONT}`;
  const kept = wrapLines(text, maxW * pxPerMm, font, maxLines);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = font;
  const widthPx = Math.ceil(Math.max(1, ...kept.map(l => ctx.measureText(l).width)));
  const canvas = ctx.canvas;
  canvas.width = widthPx;
  canvas.height = Math.ceil(kept.length * lineH * pxPerMm);
  Object.assign(ctx, { font, fillStyle: grey ? '#5a5a5a' : '#000', textAlign: align === 'center' ? 'center' : align, textBaseline: 'middle' });
  const at = align === 'left' ? 0 : align === 'right' ? widthPx : widthPx / 2;
  kept.forEach((line, i) => ctx.fillText(line, at, (i + 0.5) * lineH * pxPerMm));
  const w = widthPx / pxPerMm;
  const h = kept.length * lineH;
  doc.addImage(canvas, 'PNG', align === 'left' ? x : align === 'right' ? x - w : x - w / 2, y, w, h);
  return { h, w };
}
