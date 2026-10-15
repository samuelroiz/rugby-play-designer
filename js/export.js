// Pictures of the pitch: a PNG of one phase, and a print view with one page per phase (the browser's
// print dialog turns it into a PDF). Both start from a copy of the pitch SVG as currently drawn; the app
// redraws the phase with nothing selected before copying, so no highlights or handles are in it.

import { svgEl } from './pitch.js';

const NS = 'http://www.w3.org/2000/svg';
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const PX_PER_MM = 96 / 25.4;

// Room for the pitch on a page, in mm. It fits A4 and US Letter with 10 mm margins, leaving space for the
// play name above and the phase line and note below.
const PAGE_BOX = { landscape: { w: 257, h: 140 }, portrait: { w: 190, h: 200 } };

// Copy of the pitch as a standalone SVG of width x height (CSS px), drawn `scale` times larger.
// legend: { items: [[type, label]], sample: type -> <svg>, cols } draws the route key bottom left.
// css: style rules to embed, needed when the SVG is used as an image rather than inside the page.
// idPrefix keeps marker ids unique when several copies sit in one page.
export function pictureSvg(svg, { width, height, scale = 1, legend = null, css = '', idPrefix = 'x-' }) {
  const out = svgEl('svg', { xmlns: NS, width: width * scale, height: height * scale, viewBox: `0 0 ${width} ${height}` });
  if (css) svgEl('style', {}, out).textContent = css;

  const pitch = svg.cloneNode(true);
  for (const attr of ['id', 'class', 'style', 'role', 'aria-label']) pitch.removeAttribute(attr);
  Object.entries({ x: 0, y: 0, width, height, preserveAspectRatio: 'xMidYMid meet' }).forEach(([k, v]) => pitch.setAttribute(k, v));
  // Invisible touch targets aren't needed in a picture.
  for (const el of pitch.querySelectorAll('.hit, .route-hit, .handle')) el.remove();
  for (const el of pitch.querySelectorAll('[id]')) {
    if (el.tagName === 'marker') el.id = idPrefix + el.id;
    else el.removeAttribute('id');
  }
  out.appendChild(pitch);

  if (legend) out.appendChild(legendGroup(legend, height));
  // Arrowheads on the pitch and in the legend point at the renamed markers.
  for (const el of out.querySelectorAll('[marker-end]')) {
    el.setAttribute('marker-end', el.getAttribute('marker-end').replace('url(#', `url(#${idPrefix}`));
  }
  return out;
}

// The route key as SVG, laid out like the on-screen legend: `cols` type/label pairs per row.
function legendGroup({ items, sample, cols }, height) {
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
  const g = svgEl('g', { transform: `translate(8 ${height - 8 - h})` });
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
  return g;
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

// Pitch size on a printed page, in mm, for a view of aspect ratio `ar` (width / height).
export function pageFit(orientation, ar) {
  const box = PAGE_BOX[orientation];
  const w = Math.min(box.w, box.h * ar);
  return { w, h: w / ar, px: { w: w * PX_PER_MM, h: (w / ar) * PX_PER_MM } };
}

// Shows `pages` (one { title, picture, caption, note } per phase) only when printing, and opens the
// print dialog. The print view stays (hidden) until the user next touches the app, because some browsers
// return from print() before they have laid the pages out.
export function printPages(pages, orientation, size) {
  clearPrintView();
  const view = document.createElement('div');
  view.className = 'print-view';
  view.id = 'print-view';
  const style = document.createElement('style');
  style.textContent = `@page { size: ${orientation}; margin: 10mm; }`;
  view.appendChild(style);
  for (const page of pages) {
    const section = document.createElement('section');
    section.className = 'print-page';
    const title = document.createElement('h1');
    title.textContent = page.title;
    page.picture.style.width = `${size.w}mm`;
    page.picture.style.height = `${size.h}mm`;
    const caption = document.createElement('p');
    caption.className = 'print-phase';
    caption.textContent = page.caption;
    section.append(title, page.picture, caption);
    if (page.note) {
      const note = document.createElement('p');
      note.className = 'print-note';
      note.textContent = page.note;
      section.appendChild(note);
    }
    view.appendChild(section);
  }
  document.body.appendChild(view);
  document.body.classList.add('printing');
  window.print();
  setTimeout(() => {
    for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, clearPrintView, { once: true, capture: true });
  });
}

function clearPrintView() {
  document.getElementById('print-view')?.remove();
  document.body.classList.remove('printing');
  for (const type of ['pointerdown', 'keydown']) document.removeEventListener(type, clearPrintView, { capture: true });
}
