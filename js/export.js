// Pictures of the pitch: a PNG of one phase, and a PDF with one page per phase made with jsPDF
// (vendor/jspdf.umd.min.js, loaded on first use). Both start from a copy of the pitch SVG as currently
// drawn; the app redraws the phase with nothing selected and no ghost before copying.

import { svgEl } from './pitch.js';

const NS = 'http://www.w3.org/2000/svg';
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const PX_PER_MM = 96 / 25.4;

// PDF pages are A4 with 10 mm margins. PAGE_BOX is the room for the pitch, in mm, leaving space for the
// play name above and the phase line and note below. It would also fit US Letter.
const MARGIN = 10;
const PAGE_BOX = { landscape: { w: 257, h: 140 }, portrait: { w: 190, h: 200 } };
const PT_TO_MM = 25.4 / 72;
const JSPDF_URL = new URL('../vendor/jspdf.umd.min.js', import.meta.url).href;

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

// Pitch size on a PDF page, in mm, for a view of aspect ratio `ar` (width / height).
export function pageFit(orientation, ar) {
  const box = PAGE_BOX[orientation];
  const w = Math.min(box.w, box.h * ar);
  return { w, h: w / ar, px: { w: w * PX_PER_MM, h: (w / ar) * PX_PER_MM } };
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

// pages: one { title, caption, note, png (Blob) } per phase. size: the pitch on the page, from pageFit().
// Returns the PDF as a Blob.
export async function makePdf(pages, orientation, size) {
  const JsPDF = await loadJsPdf();
  const doc = new JsPDF({ orientation, unit: 'mm', format: 'a4', compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const textW = Math.min(180, pageW - 2 * MARGIN);
  for (const [i, page] of pages.entries()) {
    if (i) doc.addPage('a4', orientation);
    let y = MARGIN;
    y = writeText(doc, page.title, { y, pageW, textW, pt: 16, bold: true, maxLines: 2 });
    y += 3;
    const png = new Uint8Array(await page.png.arrayBuffer());
    doc.addImage(png, 'PNG', (pageW - size.w) / 2, y, size.w, size.h, `phase-${i + 1}`, 'FAST');
    y += size.h + 4;
    y = writeText(doc, page.caption, { y, pageW, textW, pt: 12, bold: true, maxLines: 1 });
    if (page.note) {
      const lineH = 11 * PT_TO_MM * 1.25;
      writeText(doc, page.note, { y: y + 1, pageW, textW, pt: 11, maxLines: Math.max(1, Math.floor((pageH - MARGIN - y - 1) / lineH)) });
    }
  }
  return doc.output('blob');
}

// The PDF's built-in Helvetica only has Western European letters (Windows-1252). Text with anything else
// (macrons, other alphabets, emoji) is drawn as a picture instead, so it still reads correctly.
const WIN_1252 = /^[\n\t\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/;

// Writes text centred across the page with its top at y (mm), wrapped to textW and cut to maxLines.
// Returns the y just below it.
function writeText(doc, text, { y, pageW, textW, pt, bold = false, maxLines }) {
  const lineH = pt * PT_TO_MM * 1.25;
  if (!WIN_1252.test(text)) return y + textPicture(doc, text, { y, pageW, textW, pt, bold, maxLines, lineH });
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(pt);
  doc.setTextColor(0, 0, 0);
  const lines = cutLines(doc.splitTextToSize(text, textW), maxLines, line => doc.getTextWidth(line), textW);
  doc.text(lines, pageW / 2, y, { align: 'center', baseline: 'top', lineHeightFactor: 1.25 });
  return y + lines.length * lineH;
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

// Draws text into a canvas with the system font and puts it on the page as a picture. Returns its height in mm.
function textPicture(doc, text, { y, pageW, textW, pt, bold, maxLines, lineH }) {
  const pxPerMm = 8; // about 200 dpi
  const ctx = document.createElement('canvas').getContext('2d');
  const font = `${bold ? 700 : 400} ${pt * PT_TO_MM * pxPerMm}px ${FONT}`;
  ctx.font = font;
  const maxW = textW * pxPerMm;
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
  const kept = cutLines(lines, maxLines, width, maxW);
  const canvas = ctx.canvas;
  canvas.width = Math.ceil(maxW);
  canvas.height = Math.ceil(kept.length * lineH * pxPerMm);
  Object.assign(ctx, { font, fillStyle: '#000', textAlign: 'center', textBaseline: 'middle' });
  kept.forEach((line, i) => ctx.fillText(line, canvas.width / 2, (i + 0.5) * lineH * pxPerMm));
  const h = kept.length * lineH;
  doc.addImage(canvas, 'PNG', (pageW - textW) / 2, y, textW, h);
  return h;
}
