// The team logo: the default club logo, uploading (PNG, JPG, SVG), shrinking, the preview, Remove logo, the
// team name in About, storage failing, Present mode, and the logo on PNG and PDF exports only when "Show logo
// on exports" is on. It must never get into the play, a saved play file, the autosave or the undo history.
// Desktop 1440x900.
import fs from 'node:fs';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { open, click, state, check, failed, outDir, addPlayer, stored as storedPlay, sleep } from './lib.mjs';

const OUT = outDir('logo');
const FILES = outDir('logo-files');
console.log(`Downloads: ${OUT}`);
const KEY = 'rugby-play-designer.team-logo';
const DEFAULT_NAME = 'San Fernando Valley Rugby Club';

// Every SVG serialized (each export picture, and the cleaned SVG of an upload) is kept to look at.
const captureSvgs = page => page.evaluate(() => {
  window.__svgs = [];
  const orig = XMLSerializer.prototype.serializeToString;
  XMLSerializer.prototype.serializeToString = function (n) { const s = orig.call(this, n); window.__svgs.push(s); return s; };
});
const lastSvg = page => page.evaluate(() => window.__svgs.at(-1) ?? '');
const stored = page => page.evaluate(k => localStorage.getItem(k), KEY);
const settings = page => page.evaluate(() => window.rugbyLogo.settings());
const toast = page => page.$eval('#toast', t => (t.hidden ? null : t.textContent));
const status = page => page.$eval('#logo-status', s => ({ text: s.textContent, error: s.classList.contains('error') }));
const visible = (page, sel) => page.$eval(sel, el => {
  const r = el.getBoundingClientRect();
  return !el.hidden && getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0;
});
const box = (page, sel) => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; });
const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const imageSize = (page, src) => page.evaluate(src => new Promise(r => {
  const img = new Image();
  img.onload = () => r({ w: img.naturalWidth, h: img.naturalHeight });
  img.onerror = () => r(null);
  img.src = src;
}), src);

// A solid-colour picture made in the page, written to a file to upload.
async function makeImage(page, name, { w, h, type = 'image/png', color = '#ff00ff' }) {
  const data = await page.evaluate((w, h, type, color) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    return c.toDataURL(type, 0.95).split(',')[1];
  }, w, h, type, color);
  const file = path.join(FILES, name);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

async function openLogo(page) {
  if (await page.$eval('#logo-dialog', d => d.open)) return;
  await click(page, '[data-file="logo"]');
  await page.waitForSelector('#logo-dialog[open]');
}
async function closeLogo(page) {
  await page.click('#logo-dialog .cancel');
  await page.waitForFunction(() => !document.getElementById('logo-dialog').open);
}
// Picks the file in the logo box and waits until it has been read (or refused).
async function upload(page, file) {
  await openLogo(page);
  await page.$eval('#logo-status', s => { s.textContent = ''; });
  const input = await page.$('#logo-input');
  await input.uploadFile(file);
  await page.waitForFunction(() => { const t = document.getElementById('logo-status').textContent; return t && t !== 'Reading the image…'; }, { timeout: 10000 });
  return status(page);
}

// The next file with this extension in OUT (older ones are deleted first by `clean`).
const clean = () => { for (const f of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, f)); };
async function waitFile(ext, ms = 20000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const f = fs.readdirSync(OUT).find(n => n.endsWith(ext));
    if (f) { await sleep(300); return path.join(OUT, f); }
    await sleep(100);
  }
  return null;
}
async function exportPng(page, which) {
  clean();
  await page.evaluate(() => { window.__svgs.length = 0; });
  await click(page, '[data-file="png"]');
  await click(page, `[data-image="${which}"]`);
  const file = await waitFile('.png');
  return { file, svg: await lastSvg(page) };
}
async function exportPdf(page) {
  clean();
  await click(page, '[data-file="pdf"]');
  return waitFile('.pdf');
}

// The PNG's size and the box around its magenta pixels (the uploaded logo's colour), or null if it has none.
const magenta = (page, file) => page.evaluate(async b64 => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i] > 220 && d[i + 1] < 50 && d[i + 2] > 220) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
  }
  return { w: c.width, h: c.height, logo: x1 < 0 ? null : { left: x0, top: y0, right: x1 + 1, bottom: y1 + 1 } };
}, fs.readFileSync(file).toString('base64'));

// Page 1 of a PDF: where each image is drawn (pt, from the bottom left) and where the play name starts.
async function pdfPage(file, title) {
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), disableFontFace: true }).promise;
  const p = await doc.getPage(1);
  const ops = await p.getOperatorList();
  const boxes = [];
  let m = [1, 0, 0, 1, 0, 0];
  const stack = [];
  ops.fnArray.forEach((f, i) => {
    const a = ops.argsArray[i];
    if (f === 10) stack.push(m);
    else if (f === 11) m = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (f === 12) m = [m[0] * a[0] + m[2] * a[1], m[1] * a[0] + m[3] * a[1], m[0] * a[2] + m[2] * a[3], m[1] * a[2] + m[3] * a[3], m[0] * a[4] + m[2] * a[5] + m[4], m[1] * a[4] + m[3] * a[5] + m[5]];
    else if (f === 85) boxes.push({ x: m[4], y: m[5], w: m[0], h: m[3] });
  });
  const items = (await p.getTextContent()).items;
  const name = items.find(t => t.str.includes(title));
  const pitch = [...boxes].sort((a, b) => b.w * b.h - a.w * a.h)[0];
  // The logo: a small picture above the pitch (the route key is below it).
  const logo = boxes.find(b => b !== pitch && b.y >= pitch.y + pitch.h - 1) ?? null;
  return { boxes, pitch, logo, name: name ? { x: name.transform[4], y: name.transform[5], h: name.height } : null };
}

const { browser, page, errors } = await open({ downloads: OUT });
const requests = [];
page.on('request', r => requests.push(r.url()));
await captureSvgs(page);
await page.evaluate(() => { document.getElementById('play-name').value = 'Crash ball'; document.getElementById('play-name').dispatchEvent(new Event('input')); });

// --- The default: the club logo and name, until something is set in this browser ---
console.log('\n== Default logo ==');
await page.waitForFunction(() => { const i = document.getElementById('topbar-logo'); return i.complete && i.naturalWidth > 0; }, { timeout: 5000 }).catch(() => {});
const top = await page.evaluate(() => {
  const img = document.getElementById('topbar-logo');
  const r = img.getBoundingClientRect();
  return { src: img.getAttribute('src'), loaded: img.naturalWidth > 0, hidden: img.hidden, h: r.height, right: r.right, nameLeft: document.getElementById('play-name').getBoundingClientRect().left };
});
check('default logo in the top bar: assets/sfv-logo.jpeg, loaded', /assets\/sfv-logo\.jpeg$/.test(top.src) && top.loaded && !top.hidden, JSON.stringify(top));
check('…about 28 px tall, left of the play name', Math.abs(top.h - 28) <= 2 && top.right <= top.nameLeft, JSON.stringify(top));
check('nothing is stored until it is changed', (await stored(page)) === null);

await click(page, '#about-button');
const about = await page.evaluate(() => {
  const line = document.getElementById('about-team');
  return { text: line.textContent, shown: !line.hidden, above: line.getBoundingClientRect().bottom <= document.getElementById('about-source').getBoundingClientRect().top };
});
check(`About: "Made for ${DEFAULT_NAME}" above the GitHub link`, about.text === `Made for ${DEFAULT_NAME}` && about.shown && about.above, JSON.stringify(about));
await page.keyboard.press('Escape');

await openLogo(page);
const dlg = await page.evaluate(() => ({
  preview: document.getElementById('logo-preview').getAttribute('src'),
  previewShown: !document.getElementById('logo-preview').hidden,
  name: document.getElementById('logo-name').value,
  exports: document.getElementById('logo-exports').checked,
  remove: !document.getElementById('logo-remove').disabled,
}));
check('the box: preview of the default logo, the team name, "Show logo on exports" on, Remove logo', /sfv-logo\.jpeg$/.test(dlg.preview) && dlg.previewShown && dlg.name === DEFAULT_NAME && dlg.exports && dlg.remove, JSON.stringify(dlg));
await closeLogo(page);

let r = await exportPng(page, 'phase');
check('PNG with the default logo: the club logo in the picture', /<image[^>]*class="export-logo"/.test(r.svg) && /href="data:image\/jpeg;base64,/.test(r.svg));

// --- Upload: PNG and JPG, shrunk to 512 px on the long side, never enlarged ---
console.log('\n== Upload ==');
const bigPng = await makeImage(page, 'wide.png', { w: 1024, h: 600 });
let st = await upload(page, bigPng);
let s = await settings(page);
check('PNG upload: "Logo saved."', st.text === 'Logo saved.' && !st.error, JSON.stringify(st));
check('…stored as a PNG data URL under its own key', s.logo?.startsWith('data:image/png;base64,') && JSON.parse(await stored(page)).logo === s.logo);
check('…shrunk to 512 x 300, keeping its shape', JSON.stringify(await imageSize(page, s.logo)) === '{"w":512,"h":300}', JSON.stringify(await imageSize(page, s.logo)));
const shown = await page.evaluate(() => ({ preview: document.getElementById('logo-preview').src, top: document.getElementById('topbar-logo').src, topHidden: document.getElementById('topbar-logo').hidden }));
check('…the preview and the top bar show it', shown.preview === s.logo && shown.top === s.logo && !shown.topHidden);

st = await upload(page, await makeImage(page, 'tall.jpg', { w: 800, h: 1200, type: 'image/jpeg' }));
s = await settings(page);
check('JPG upload: stored as a JPEG data URL', st.text === 'Logo saved.' && s.logo?.startsWith('data:image/jpeg;base64,'), JSON.stringify(st));
check('…shrunk to 341 x 512', JSON.stringify(await imageSize(page, s.logo)) === '{"w":341,"h":512}', JSON.stringify(await imageSize(page, s.logo)));

await upload(page, await makeImage(page, 'small.png', { w: 200, h: 100 }));
check('a small picture is not enlarged', JSON.stringify(await imageSize(page, (await settings(page)).logo)) === '{"w":200,"h":100}');

const before = (await settings(page)).logo;
const huge = path.join(FILES, 'huge.png');
fs.writeFileSync(huge, Buffer.alloc(2 * 1024 * 1024 + 10, 1));
st = await upload(page, huge);
check('over 2 MB: refused with a message, logo kept', /2 MB/.test(st.text) && st.error && (await settings(page)).logo === before, JSON.stringify(st));
const gif = path.join(FILES, 'logo.gif');
fs.writeFileSync(gif, Buffer.from('GIF89a'));
st = await upload(page, gif);
check('a GIF: refused ("PNG, JPG or SVG")', /PNG, JPG or SVG/.test(st.text) && st.error && (await settings(page)).logo === before, JSON.stringify(st));

st = await upload(page, bigPng);
await closeLogo(page);

// --- Team name ---
console.log('\n== Team name ==');
const setName = async value => {
  await openLogo(page);
  await page.click('#logo-name', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  if (value) await page.keyboard.type(value);
  await closeLogo(page);
};
const aboutLine = async () => {
  await click(page, '#about-button');
  const line = await page.$eval('#about-team', l => (l.hidden ? null : l.textContent));
  await page.keyboard.press('Escape');
  return line;
};
await setName('Valley Blues');
check('a new team name: "Made for Valley Blues" in About, and stored', (await aboutLine()) === 'Made for Valley Blues' && JSON.parse(await stored(page)).name === 'Valley Blues');
await setName('');
check('no team name: no "Made for" line', (await aboutLine()) === null);
await setName('x'.repeat(50));
check('the team name stops at 40 characters', (await settings(page)).name.length === 40);
await setName('Valley Blues');

// --- Never in the play, a saved file, the autosave or the undo history ---
console.log('\n== Not part of the play ==');
await addPlayer(page, 'attack');
await sleep(700); // past the autosave delay
const undoBefore = await page.$eval('[data-action="undo"]', b => b.disabled);
const autosaveBefore = await storedPlay(page);
await upload(page, await makeImage(page, 'other.png', { w: 300, h: 300, color: '#00ffff' }));
await closeLogo(page);
await sleep(700);
check('changing the logo: no undo step, no autosave', (await page.$eval('[data-action="undo"]', b => b.disabled)) === undoBefore && (await storedPlay(page)) === autosaveBefore);
await upload(page, bigPng);
await closeLogo(page);
const leaks = text => /data:image|logo|Valley Blues/i.test(text ?? '');
check('the play has no logo or team name in it', !leaks(JSON.stringify(await state(page))));
check('…nor does the autosave', !!autosaveBefore && !leaks(await storedPlay(page)));
clean();
await click(page, '[data-file="save"]');
const saved = await waitFile('.json');
check('…nor a saved play file', !!saved && !leaks(fs.readFileSync(saved, 'utf8')), saved);
await click(page, '[data-action="undo"]');
check('undo takes back the play edit and leaves the logo', (await state(page)).players.length === 0 && (await settings(page)).logo?.startsWith('data:image/png'));
await click(page, '[data-action="redo"]');

// --- Exports: only with "Show logo on exports" on ---
console.log('\n== Exports ==');
await page.$eval('[data-layer="legend"]', c => c.click()); // legend off: the picture is the logo strip and the pitch
const pitch = await box(page, '#pitch');
r = await exportPng(page, 'phase');
let px = await magenta(page, r.file);
const strip = px.h - Math.round(pitch.height * 2);
check('PNG, logo on: the logo is in the picture', !!px.logo, JSON.stringify(px));
check('…in the top right corner, about 8% of the width', px.logo && px.w - px.logo.right < px.w * 0.03 && px.logo.top < px.h * 0.05 && Math.abs((px.logo.right - px.logo.left) / px.w - 0.08) < 0.01, JSON.stringify(px));
check('…in a strip above the pitch, never on it', strip > 0 && px.logo && px.logo.bottom <= strip && Math.abs(px.w - pitch.width * 2) <= 1, JSON.stringify({ px, strip }));
fs.copyFileSync(r.file, path.join(FILES, 'phase-with-logo.png'));

r = await exportPng(page, 'all');
px = await magenta(page, r.file);
const sheet = await page.evaluate(xml => {
  const root = new DOMParser().parseFromString(xml, 'image/svg+xml').documentElement;
  const img = root.querySelector('image.export-logo');
  const tile = root.querySelector('svg.tile');
  return img && { bottom: Number(img.getAttribute('y')) + Number(img.getAttribute('height')), tileTop: Number(tile.getAttribute('y')), w: Number(img.getAttribute('width')), sheetW: Number(root.getAttribute('viewBox').split(' ')[2]) };
}, r.svg);
check('all-phases PNG, logo on: the logo in the top right corner, about 8% of the width', px.logo && px.w - px.logo.right < px.w * 0.05 && px.logo.top < px.h * 0.1 && sheet && Math.abs(sheet.w / sheet.sheetW - 0.08) < 0.005, JSON.stringify({ px, sheet }));
check('…above the first pitch', sheet && sheet.bottom <= sheet.tileTop, JSON.stringify(sheet));

let pdf = await exportPdf(page);
let pg = pdf && await pdfPage(pdf, 'Crash ball');
check('PDF, logo on: a logo in the header line, left of the play name', pg?.logo && pg.name && pg.logo.x + pg.logo.w <= pg.name.x && pg.logo.w < 40 && pg.logo.y < pg.name.y + 20 && pg.logo.y + pg.logo.h > pg.name.y - 5, JSON.stringify(pg && { logo: pg.logo, name: pg.name }));

await openLogo(page);
await page.click('#logo-exports');
await closeLogo(page);
check('"Show logo on exports" off is stored', JSON.parse(await stored(page)).exports === false);
r = await exportPng(page, 'phase');
px = await magenta(page, r.file);
check('PNG, logo off: no logo, no strip, just the pitch', !px.logo && !/export-logo/.test(r.svg) && Math.abs(px.h - pitch.height * 2) <= 1, JSON.stringify(px));
r = await exportPng(page, 'all');
px = await magenta(page, r.file);
check('all-phases PNG, logo off: no logo', !px.logo && !/export-logo/.test(r.svg));
pdf = await exportPdf(page);
pg = pdf && await pdfPage(pdf, 'Crash ball');
check('PDF, logo off: no logo, the name at the left edge', pg && !pg.logo && Math.abs(pg.name.x - pg.pitch.x) < 2, JSON.stringify(pg && { boxes: pg.boxes, name: pg.name }));
check('…the top bar still shows the logo', await visible(page, '#topbar-logo'));
await openLogo(page);
await page.click('#logo-exports');
await closeLogo(page);

// --- Kept in this browser: it's still there after a reload ---
await page.reload();
await page.waitForSelector('#phase-tabs button');
await captureSvgs(page);
s = await settings(page);
check('after a reload: the uploaded logo, name and export setting are back', s.logo?.startsWith('data:image/png') && s.name === 'Valley Blues' && s.exports && (await page.$eval('#topbar-logo', i => i.src)) === s.logo);

// --- Present mode ---
console.log('\n== Present mode ==');
await page.evaluate(() => { const n = document.getElementById('phase-note'); n.value = 'A note for the caption'; n.dispatchEvent(new Event('input')); });
await click(page, '#present-button');
await sleep(300);
const pres = await page.evaluate(() => {
  const r = el => { const b = document.getElementById(el).getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
  const bar = document.querySelector('.phasebar').getBoundingClientRect();
  return { logo: r('present-logo'), count: r('present-count'), caption: r('present-caption'), bar: { left: bar.left, right: bar.right, top: bar.top, bottom: bar.bottom }, src: document.getElementById('present-logo').src, h: innerHeight };
});
check('Present mode: the logo in the top left corner', (await visible(page, '#present-logo')) && pres.logo.top < 40 && pres.logo.left < 60 && pres.src.startsWith('data:image/png'), JSON.stringify(pres.logo));
check('…clear of the phase count, the controls and the caption', !overlap(pres.logo, pres.count) && !overlap(pres.logo, pres.bar) && !overlap(pres.logo, pres.caption), JSON.stringify(pres));
await click(page, '[data-play="exit"]');
await sleep(100);
check('after Present mode: no corner logo', !(await visible(page, '#present-logo')));

// --- Remove logo ---
console.log('\n== Remove logo ==');
await openLogo(page);
await page.click('#logo-remove');
st = await status(page);
const removed = await page.evaluate(() => ({
  preview: !document.getElementById('logo-preview').hidden,
  empty: !document.getElementById('logo-empty').hidden,
  remove: document.getElementById('logo-remove').disabled,
}));
check('Remove logo: "Logo removed.", no preview, Remove greyed out', st.text === 'Logo removed.' && !removed.preview && removed.empty && removed.remove, JSON.stringify([st, removed]));
await closeLogo(page);
check('…no logo in the top bar', !(await visible(page, '#topbar-logo')));
await page.reload();
await page.waitForSelector('#phase-tabs button');
await captureSvgs(page);
await page.$eval('[data-layer="legend"]', c => c.click()); // layers aren't kept: the reload turned the route key back on
check('…and after a reload, no logo (the default does not come back)', JSON.parse(await stored(page)).logo === null && !(await visible(page, '#topbar-logo')));
await click(page, '#present-button');
await sleep(200);
check('…none in Present mode', !(await visible(page, '#present-logo')));
await click(page, '[data-play="exit"]');
await sleep(100);
r = await exportPng(page, 'phase');
px = await magenta(page, r.file);
check('…exports as before: PNG with no logo and no strip (export setting still on)', (await settings(page)).exports && !/export-logo/.test(r.svg) && Math.abs(px.h - pitch.height * 2) <= 1, JSON.stringify(px));
r = await exportPng(page, 'all');
check('…all-phases PNG with no logo', !/export-logo/.test(r.svg));
pdf = await exportPdf(page);
pg = pdf && await pdfPage(pdf, 'Crash ball');
check('…PDF with no logo', pg && !pg.logo && Math.abs(pg.name.x - pg.pitch.x) < 2, JSON.stringify(pg && pg.boxes));
check('…the team name stays for About', (await aboutLine()) === 'Made for Valley Blues');

// --- Storage failing ---
console.log('\n== Storage failing ==');
await page.evaluate(k => {
  const setItem = Storage.prototype.setItem;
  window.__restoreSetItem = () => { Storage.prototype.setItem = setItem; };
  Storage.prototype.setItem = function (key, value) {
    if (key === k) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    return setItem.call(this, key, value);
  };
}, KEY);
st = await upload(page, bigPng);
check('a logo that can\'t be stored: a message in the box', /Couldn't save/.test(st.text) && st.error, JSON.stringify(st));
check('…and in the status line', /Couldn't save/.test(await toast(page) ?? ''), String(await toast(page)));
await closeLogo(page);
check('…it is still used until the page is closed', (await page.$eval('#topbar-logo', i => !i.hidden && i.src.startsWith('data:image/png'))));
await page.evaluate(() => window.__restoreSetItem());
await page.reload();
await page.waitForSelector('#phase-tabs button');
await captureSvgs(page);
check('…after a reload it is gone (it was never stored)', JSON.parse(await stored(page)).logo === null && !(await visible(page, '#topbar-logo')));

// --- A malicious SVG is cleaned, then drawn to a PNG ---
console.log('\n== SVG ==');
const evil = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="100" onload="alert('svg onload')">
  <script>alert('svg script')</script>
  <style>@import url("http://evil.example/style.css"); rect { stroke: blue; }</style>
  <rect width="200" height="100" fill="#ff00ff" onclick="alert('click')"/>
  <image href="http://evil.example/track.png" width="10" height="10"/>
  <image xlink:href="https://evil.example/track2.png" width="10" height="10"/>
  <a href="javascript:alert('link')"><circle cx="20" cy="20" r="5" fill="url(http://evil.example/p.svg#g)"/></a>
  <foreignObject width="50" height="50"><div xmlns="http://www.w3.org/1999/xhtml"><iframe src="http://evil.example/"></iframe></div></foreignObject>
  <set attributeName="href" to="javascript:alert('set')"/>
</svg>`;
const evilFile = path.join(FILES, 'evil.svg');
fs.writeFileSync(evilFile, evil);
const cleaned = await page.evaluate(text => window.rugbyLogo.sanitizeSvg(text), evil);
check('cleaned SVG: no script, event handlers, outside references, foreignObject or set',
  !/<script|onload|onclick|evil\.example|javascript:|foreignObject|iframe|@import|<set/i.test(cleaned), cleaned);
check('…the drawing is kept (the magenta rect)', /<rect[^>]*fill="#ff00ff"/.test(cleaned), cleaned);
st = await upload(page, evilFile);
s = await settings(page);
check('SVG upload: saved, as a PNG (never an SVG)', st.text === 'Logo saved.' && s.logo?.startsWith('data:image/png;base64,') && !/svg/i.test(JSON.parse(await stored(page)).logo.slice(0, 30)), JSON.stringify(st));
check('…drawn 512 px on its long side', JSON.stringify(await imageSize(page, s.logo)) === '{"w":512,"h":256}', JSON.stringify(await imageSize(page, s.logo)));
await sleep(300);
check('…nothing was fetched from outside', !requests.some(u => u.includes('evil.example')), requests.filter(u => u.includes('evil')).join());
const notSvg = path.join(FILES, 'fake.svg');
fs.writeFileSync(notSvg, '<html><body>not an svg</body></html>');
st = await upload(page, notSvg);
check('a file that isn\'t an SVG: refused, logo kept', st.error && /SVG/.test(st.text) && (await settings(page)).logo === s.logo, JSON.stringify(st));
await closeLogo(page);

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();

console.log(`\n${failed() ? `${failed()} FAILED` : 'ALL PASSED'}`);
process.exit(failed() ? 1 : 0);
