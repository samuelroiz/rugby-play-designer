// File → Save animation…: the box and its choices, a GIF of a 2-phase play (GIF89a, loops forever, about
// one frame per 1/12 s of the play, the last held 1.5 s, each frame headed with the play name and "Phase n
// of N" and captioned with the phase's note, a long one cut to 3 lines with "…"), a video where MediaRecorder can make one (MP4 or
// WebM, matching its name), Cancel stopping it, editing locked while it renders, the team logo only while
// "Show logo on exports" is on, and the size of a Medium GIF of the 3-phase example. Desktop 1440x900.
import fs from 'node:fs';
import path from 'node:path';
import { open, click, state, check, failed, outDir, sleep, eq, pastePlay } from './lib.mjs';
import { animPlay } from '../anim-play.mjs';
import { buildSchedule } from '../../js/animate.js';
import { stampedVersion } from '../../tools/stamp.mjs';

const OUT = outDir('animation');
console.log(`Downloads: ${OUT}`);
const toast = page => page.$eval('#toast', t => (t.hidden ? '' : t.textContent));
const dialogOpen = page => page.$eval('#animation-dialog', d => d.open);
const example = JSON.parse(fs.readFileSync(new URL('../../templates/example.json', import.meta.url)));

// The play's length in ms at 1x, as Play runs it: every phase to its end, the last until its routes end.
const playLength = play => play.phases.reduce((ms, _, i) => {
  const s = buildSchedule(play, i);
  return ms + (i === play.phases.length - 1 ? s.routesEnd : s.total);
}, 0);

const clean = () => { for (const f of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, f), { recursive: true }); };
async function waitFile(exts, ms = 120000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const f = fs.readdirSync(OUT).find(n => exts.some(e => n.endsWith(e)));
    if (f) { await sleep(300); return path.join(OUT, f); }
    await sleep(100);
  }
  return null;
}

// Every picture the app serializes is summed up (not kept, there are hundreds): its caption, and whether it
// has the team logo, a ghost or handles.
const watchPictures = page => page.evaluate(() => {
  window.__pics = [];
  const orig = XMLSerializer.prototype.serializeToString;
  XMLSerializer.prototype.serializeToString = function (n) {
    const s = orig.call(this, n);
    const outer = s.match(/^<svg[^>]*>/)?.[0] ?? '';
    window.__pics.push({
      caption: s.match(/class="export-caption"[^>]*>([^<]*)</)?.[1] ?? null,
      title: s.match(/class="export-title"[^>]*>([^<]*)</)?.[1] ?? null,
      note: [...s.matchAll(/<text[^>]*class="export-note"[^>]*>([^<]*)</g)].map(m => m[1]),
      notePx: Number(s.match(/<text[^>]*font-size="([\d.]+)"[^>]*class="export-note"/)?.[1] ?? 0),
      w: Number(outer.match(/ width="([\d.]+)"/)?.[1] ?? 0),
      h: Number(outer.match(/ height="([\d.]+)"/)?.[1] ?? 0),
      logo: /class="export-logo"/.test(s),
      ghost: /class="ghost/.test(s),
      handles: /class="handle/.test(s),
    });
    return s;
  };
});
const pictures = page => page.evaluate(() => window.__pics.splice(0));

async function openAnimation(page) {
  await page.click('#file-menu summary');
  await page.click('[data-file="animation"]');
  await page.waitForSelector('#animation-dialog[open]');
}
// Picks the choices and presses Save; returns once the box has closed (or the time runs out).
async function startAnimation(page, { format = 'gif', speed = '1', size = 'medium' } = {}) {
  await openAnimation(page);
  for (const [name, value] of [['format', format], ['speed', speed], ['size', size]]) await page.click(`[name="animation-${name}"][value="${value}"]`);
  await page.click('#animation-save');
}
const finished = (page, ms = 120000) => page.waitForFunction(() => !document.getElementById('animation-dialog').open, { timeout: ms }).then(() => true, () => false);

// A GIF's blocks: the loop count (NETSCAPE2.0), and each frame's delay (ms) and size.
function readGif(buf) {
  const out = { header: buf.subarray(0, 6).toString('latin1'), width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), loop: null, frames: [], ended: false };
  let p = 13;
  if (buf[10] & 0x80) p += 3 * (2 << (buf[10] & 7));
  const skipBlocks = () => { while (buf[p] !== 0) p += buf[p] + 1; p++; };
  let delay = 0;
  while (p < buf.length) {
    const kind = buf[p++];
    if (kind === 0x3b) { out.ended = true; break; }
    if (kind === 0x21) {
      const label = buf[p++];
      if (label === 0xf9) delay = buf.readUInt16LE(p + 2) * 10;
      if (label === 0xff && buf.subarray(p + 1, p + 12).toString('latin1') === 'NETSCAPE2.0') out.loop = buf.readUInt16LE(p + 14);
      skipBlocks();
    } else if (kind === 0x2c) {
      const w = buf.readUInt16LE(p + 4);
      const h = buf.readUInt16LE(p + 6);
      const packed = buf[p + 8];
      p += 9;
      if (packed & 0x80) p += 3 * (2 << (packed & 7));
      p++; // LZW minimum code size
      skipBlocks();
      out.frames.push({ delay, w, h });
    } else {
      break; // not a GIF block: the file is broken
    }
  }
  return out;
}

const { browser, page, errors } = await open({ downloads: OUT });
await watchPictures(page);
const two = animPlay();
two.phases = two.phases.slice(0, 2);
two.name = 'Two phases';
await pastePlay(page, two);

// --- The box ---
console.log('\n== The Save animation box ==');
await openAnimation(page);
const box = await page.evaluate(() => {
  const d = document.getElementById('animation-dialog');
  const choices = name => [...d.querySelectorAll(`[name="animation-${name}"]`)].map(r => [r.value, r.checked, r.parentElement.textContent.trim()]);
  return { title: document.getElementById('animation-title').textContent, format: choices('format'), speed: choices('speed'), size: choices('size'), text: d.textContent, busy: !document.getElementById('animation-busy').hidden };
});
check('File → Save animation… opens the box', box.title === 'Save animation');
check('Format: GIF (plays everywhere, loops), the default, or Video (best quality …)', eq(box.format, [['gif', true, 'GIF: plays everywhere, loops'], ['video', false, "Video: best quality (MP4, or WebM if the browser can't make MP4)"]]), JSON.stringify(box.format));
check('Speed: 0.5x, 1x (default), 2x', eq(box.speed.map(c => [c[0], c[1]]), [['0.5', false], ['1', true], ['2', false]]), JSON.stringify(box.speed));
check('Size: Small 640, Medium 960 (default), Large 1280', eq(box.size.map(c => [c[0], c[1]]), [['small', false], ['medium', true], ['large', false]]) && /640/.test(box.size[0][2]) && /960/.test(box.size[1][2]) && /1280/.test(box.size[2][2]), JSON.stringify(box.size));
check('…says a video doesn\'t loop by itself', /doesn't loop/.test(box.text));
check('…no progress bar until it starts', !box.busy);
await page.keyboard.press('Escape');
check('Escape closes it, saving nothing', !(await dialogOpen(page)) && fs.readdirSync(OUT).length === 0);

// --- GIF of a 2-phase play (Small, 2x) ---
console.log('\n== GIF ==');
const gifenc = [];
page.on('request', r => { if (r.url().includes('gifenc')) gifenc.push(r.url()); });
check('gifenc is not loaded with the page', gifenc.length === 0 && !(await page.evaluate(() => performance.getEntriesByType('resource').some(e => e.name.includes('gifenc')))));
clean();
await pictures(page);
await startAnimation(page, { format: 'gif', speed: '2', size: 'small' });
await sleep(200);
const during = await page.evaluate(() => ({
  bar: !document.getElementById('animation-busy').hidden && document.getElementById('animation-progress').max === 1,
  locked: document.getElementById('plays-button').disabled && document.getElementById('play-name').disabled && document.getElementById('file-menu').inert,
  save: document.getElementById('animation-save').hidden,
}));
check('while it renders: a progress bar, Save gone, Cancel there', during.bar && during.save, JSON.stringify(during));
check('…and editing is locked', during.locked);
check('…it finishes and the box closes', await finished(page));
let file = await waitFile(['.gif']);
check('downloads "<play-name>.gif"', file && path.basename(file) === 'Two phases.gif', String(file));
check('…"Saved Two phases.gif"', (await toast(page)) === 'Saved Two phases.gif', await toast(page));
check('gifenc loaded only now, from vendor/, versioned', gifenc.length >= 1 && gifenc.every(u => u.endsWith(`/vendor/gifenc.esm.js?v=${stampedVersion()}`)), gifenc.join());
let gif = readGif(fs.readFileSync(file));
check('a GIF89a, read to its end', gif.header === 'GIF89a' && gif.ended, JSON.stringify({ header: gif.header, ended: gif.ended }));
check('…with the loop extension, looping forever (count 0)', gif.loop === 0, String(gif.loop));
check('…640 px wide, even sides, every frame the full size', gif.width === 640 && gif.height % 2 === 0 && gif.frames.every(f => f.w === gif.width && f.h === gif.height), `${gif.width}x${gif.height}`);
const length = playLength(two) / 2; // ms at 2x
const expected = (length / 1000) * 12;
check(`…about one frame per 1/12 s of the play (${gif.frames.length}, expected about ${Math.round(expected)})`, Math.abs(gif.frames.length - expected) <= 3, `${gif.frames.length} vs ${expected}`);
const total = gif.frames.reduce((ms, f) => ms + f.delay, 0);
check(`…lasting the play plus the 1.5 s hold (${total} ms)`, Math.abs(total - (length + 1500)) <= 100, `${total} vs ${length + 1500}`);
check('…the last frame held 1.5 s', gif.frames.at(-1).delay >= 1500, String(gif.frames.at(-1).delay));
let pics = await pictures(page);
// The first pictures are the frames the shared palette is made from; the GIF's frames are the last ones.
const encoded = pics.slice(-gif.frames.length).map(p => p.caption);
check('the GIF\'s frames are headed "Phase 1 of 2", then "Phase 2 of 2"', pics.length >= gif.frames.length && encoded[0] === 'Phase 1 of 2' && encoded.at(-1) === 'Phase 2 of 2'
  && encoded.indexOf('Phase 2 of 2') > encoded.lastIndexOf('Phase 1 of 2'), JSON.stringify([...new Set(encoded)]));
const frames = pics.slice(-gif.frames.length);
check('…under the play name, in bold, on every frame', frames.every(p => p.title === 'Two phases'), JSON.stringify([...new Set(frames.map(p => p.title))]));
check('…with each phase\'s note as the caption under the pitch', frames.every(p => p.note.join(' ') === (p.caption === 'Phase 1 of 2' ? 'Ten runs, then the pass' : 'Twelve kicks')),
  JSON.stringify([...new Set(frames.map(p => `${p.caption}: ${p.note.join(' ')}`))]));
check('…in large text: at least 4% of the frame\'s height', frames.every(p => p.notePx >= 0.04 * p.h), JSON.stringify(frames[0] && { px: frames[0].notePx, h: frames[0].h }));
check('…every frame the GIF\'s own size (640 wide, the header and caption included)', frames.every(p => p.w === 640 && Math.ceil(p.h / 2) * 2 === gif.height), `${frames[0]?.w}x${frames[0]?.h} vs ${gif.width}x${gif.height}`);
check('…with the team logo (Show logo on exports is on), no ghost and no handles', pics.every(p => p.logo && !p.ghost && !p.handles));
check('editing is back after it', !(await page.$eval('#plays-button', b => b.disabled)) && (await state(page)).name === 'Two phases');

// --- Logo off ---
await page.click('#file-menu summary');
await page.click('[data-file="logo"]');
await page.waitForSelector('#logo-dialog[open]');
await page.click('#logo-exports');
await page.click('#logo-dialog .cancel');
clean();
await startAnimation(page, { format: 'gif', speed: '2', size: 'small' });
await finished(page);
file = await waitFile(['.gif']);
pics = await pictures(page);
check('logo off: a GIF is still made', !!file && readGif(fs.readFileSync(file)).ended);
check('…and no frame has the logo', pics.length > 10 && pics.every(p => !p.logo), String(pics.filter(p => p.logo).length));

// --- Cancel ---
console.log('\n== Cancel ==');
clean();
await startAnimation(page, { format: 'gif', speed: '0.5', size: 'large' });
await page.waitForFunction(() => document.getElementById('animation-progress').value > 0.05, { timeout: 60000 });
await page.click('#animation-cancel');
check('Cancel stops it: the box closes', await finished(page, 10000));
await sleep(1500);
check('…nothing is saved', fs.readdirSync(OUT).length === 0, fs.readdirSync(OUT).join());
check('…"Animation cancelled"', (await toast(page)) === 'Animation cancelled', await toast(page));
check('…and editing is back', !(await page.$eval('#plays-button', b => b.disabled)) && !(await page.$eval('#file-menu', m => m.inert)));
await pictures(page);

// --- Video ---
console.log('\n== Video ==');
const type = await page.evaluate(() => import('./js/animation.js').then(m => m.videoType()));
if (!type) {
  console.log('(MediaRecorder or canvas recording is not available here: no video checks)');
  check('Video is greyed out when the browser can\'t record', await page.$eval('[name="animation-format"][value="video"]', r => r.disabled));
} else {
  console.log(`   recording as ${type}`);
  // The logo back on, so the video has it.
  await page.click('#file-menu summary');
  await page.click('[data-file="logo"]');
  await page.waitForSelector('#logo-dialog[open]');
  await page.click('#logo-exports');
  await page.click('#logo-dialog .cancel');
  clean();
  await startAnimation(page, { format: 'video', speed: '2', size: 'small' });
  check('the video finishes', await finished(page));
  const ext = type.startsWith('video/mp4') ? '.mp4' : '.webm';
  file = await waitFile(['.mp4', '.webm']);
  const bytes = file ? fs.readFileSync(file) : Buffer.alloc(0);
  const header = ext === '.mp4' ? bytes.subarray(4, 8).toString('latin1') === 'ftyp' : bytes.subarray(0, 4).toString('hex') === '1a45dfa3';
  check(`downloads "Two phases${ext}" (${type.split(';')[0]}), not empty`, file && path.basename(file) === `Two phases${ext}` && bytes.length > 1000, `${file} ${bytes.length}`);
  check(`…a real ${ext.slice(1).toUpperCase()} file`, header, bytes.subarray(0, 12).toString('hex'));
  check(`…"Saved Two phases${ext}"`, (await toast(page)) === `Saved Two phases${ext}`, await toast(page));
  pics = await pictures(page);
  check('…its frames have the logo and the captions', pics.length > 10 && pics.every(p => p.logo) && pics.some(p => p.caption === 'Phase 2 of 2' && p.note.join(' ') === 'Twelve kicks'));
  const rate = await page.evaluate(() => import('./js/animation.js').then(m => [m.videoBitrate(640), m.videoBitrate(1080), m.videoBitrate(1280)]));
  check('…recorded at about 8 Mbps up to 1080 px wide, more above that', rate[0] === 8e6 && rate[1] === 8e6 && rate[2] > 9e6, JSON.stringify(rate));

  clean();
  await startAnimation(page, { format: 'video', speed: '0.5', size: 'small' });
  await page.waitForFunction(() => document.getElementById('animation-progress').value > 0.05, { timeout: 60000 });
  await page.keyboard.press('Escape');
  check('Escape cancels a video too', await finished(page, 10000));
  await sleep(1500);
  check('…nothing is saved', fs.readdirSync(OUT).length === 0, fs.readdirSync(OUT).join());
  await pictures(page);
}

// --- A long note: cut to three lines with "…" ---
console.log('\n== Long notes ==');
const long = structuredClone(two);
long.name = 'Long notes';
long.phases[0].note = 'Ten takes the ball flat to the line and holds the defender, '.repeat(8).trim();
long.phases[1].note = '';
await pastePlay(page, long);
clean();
await pictures(page);
await startAnimation(page, { format: 'gif', speed: '2', size: 'small' });
await finished(page);
pics = (await pictures(page)).filter(p => p.title === 'Long notes');
const first = pics.find(p => p.caption === 'Phase 1 of 2');
check('a long note is wrapped to 3 lines, the last ending in "…"', first && first.note.length === 3 && first.note[2].endsWith('…') && !first.note[0].endsWith('…'), JSON.stringify(first?.note));
check('…and a phase with no note has no caption', pics.some(p => p.caption === 'Phase 2 of 2') && pics.filter(p => p.caption === 'Phase 2 of 2').every(p => p.note.length === 0));
check('…the frame keeps one size through both phases', new Set(pics.map(p => `${p.w}x${p.h}`)).size === 1, JSON.stringify([...new Set(pics.map(p => `${p.w}x${p.h}`))]));

// --- Size: a Medium GIF of the 3-phase example ---
console.log('\n== GIF size ==');
await pastePlay(page, example);
clean();
const started = Date.now();
await startAnimation(page, { format: 'gif', speed: '1', size: 'medium' });
await finished(page, 300000);
file = await waitFile(['.gif']);
const mb = file ? fs.statSync(file).size / 1e6 : Infinity;
gif = file ? readGif(fs.readFileSync(file)) : null;
console.log(`   Medium GIF of the ${example.phases.length}-phase example: ${mb.toFixed(2)} MB, ${gif?.frames.length} frames, ${gif?.width}x${gif?.height}, made in ${((Date.now() - started) / 1000).toFixed(1)} s`);
check('a Medium GIF of the 3-phase example is under about 8 MB', mb < 8.5, `${mb.toFixed(2)} MB`);
check('…960 px wide', gif?.width === 960);
await pictures(page);

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
fs.rmSync(OUT, { recursive: true, force: true });
console.log(`\n${failed() ? `${failed()} FAILED` : 'ALL PASSED'}`);
process.exit(failed() ? 1 : 0);
