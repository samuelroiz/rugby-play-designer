// Stability: damaged files and autosaves, two tabs, full storage, phase changes mid-drag, the paused frame,
// locks while playing and presenting, turning the pitch, the route bar's Order, deleting set-piece players,
// hover and drag redraws, exports from a copy, and empty or one-phase plays through Play, Present, PNG and
// PDF. Desktop 1440x900.
import fs from 'node:fs';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { open, drag, tap, click, state, shown, check, failed, toScreen, outDir, addPlayer, placeSetPiece, nextFrame, URL_, openId, plays, stored, loadFile } from './lib.mjs';
import { TIMING } from '../../js/animate.js';
import { animPlay } from '../anim-play.mjs';

const OUT = outDir('stability');
console.log(`Downloads: ${OUT}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const AUTOSAVE = 'rugby-play-designer.autosave';
const BACKUP = 'rugby-play-designer.autosave-backup';

// Puts a play in the app (as Undo would) and redraws.
async function loadPlay(page, play) {
  await page.evaluate(p => {
    const s = window.playState;
    for (const k of Object.keys(s)) delete s[k];
    Object.assign(s, structuredClone(p));
  }, play);
  await page.keyboard.press('Escape');
}
const toast = page => page.$eval('#toast', t => (t.hidden ? null : t.textContent));
const disabled = (page, sel) => page.$eval(sel, b => b.disabled);
const pb = page => page.evaluate(() => ({ playing: rugbyPlayback.playing, paused: rugbyPlayback.paused, time: rugbyPlayback.time }));
const drawnAt = (page, id) => page.$eval(`#players-layer [data-id="${id}"]`, g => {
  const m = /translate\(([^ ]+) ([^)]+)\)/.exec(g.getAttribute('transform'));
  return { x: Number(m[1]), y: Number(m[2]) };
});
const undoKey = async (page, shift = false) => {
  await page.keyboard.down('Control');
  if (shift) await page.keyboard.down('Shift');
  await page.keyboard.press('z');
  if (shift) await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
};

// The next file with this extension to land in `dir`.
async function newFile(dir, ext, seen, ms = 20000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const f = fs.readdirSync(dir).find(n => n.endsWith(ext) && !seen.has(n));
    if (f) { await sleep(300); seen.add(f); return path.join(dir, f); }
    await sleep(100);
  }
  return null;
}
async function pdfText(file) {
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), disableFontFace: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map(t => t.str).join(' '));
  return pages;
}
// PNG width and height from its header.
const pngSize = file => { const b = fs.readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

// Play to the end, Present (in and out), this-phase PNG, all-phases PNG and PDF. Returns what came out.
async function throughEverything(page, dir, seen, label) {
  await page.evaluate(() => { rugbyPlayback.timeScale = 0; });
  await page.evaluate(() => rugbyPlayback.jump(0));
  await page.keyboard.press('Space');
  await page.evaluate(() => rugbyPlayback.advance(1e6));
  const played = await pb(page);
  check(`${label}: Play runs to the end and stops`, !played.playing && (await shown(page)) === (await state(page)).phases.length - 1, JSON.stringify(played));
  await click(page, '#present-button');
  await page.keyboard.press('Space');
  await page.evaluate(() => rugbyPlayback.advance(1e6));
  const presented = await page.evaluate(() => document.body.classList.contains('presenting') && !rugbyPlayback.playing);
  await page.keyboard.press('Escape');
  check(`${label}: Present plays it and leaves`, presented && !(await page.evaluate(() => document.body.classList.contains('presenting'))));
  await click(page, '[data-file="png"]');
  await click(page, '[data-image="phase"]');
  const png = await newFile(dir, '.png', seen);
  await click(page, '[data-file="png"]');
  await click(page, '[data-image="all"]');
  const sheet = await newFile(dir, '.png', seen);
  await click(page, '[data-file="pdf"]');
  const pdf = await newFile(dir, '.pdf', seen);
  const pages = pdf ? await pdfText(pdf) : [];
  check(`${label}: PNG of the phase and of all phases`, !!png && !!sheet && pngSize(png).w > 100 && pngSize(sheet).w > 100, `${png} ${sheet}`);
  check(`${label}: PDF with a page a phase`, pages.length === (await state(page)).phases.length, JSON.stringify(pages));
  return { pages };
}

// ---------------- Files, exports and empty plays ----------------
{
  console.log('\n== Damaged files, empty and one-phase plays ==');
  const dl = path.join(OUT, 'files');
  fs.mkdirSync(dl);
  const seen = new Set();
  const { browser, page, errors } = await open({ downloads: dl });

  // Empty play.
  await throughEverything(page, dl, seen, 'empty play');

  // One phase with players and routes.
  const one = animPlay();
  one.phases = [one.phases[0]];
  await loadPlay(page, one);
  await throughEverything(page, dl, seen, 'one-phase play');

  // A file with the wrong type in every optional field.
  const bad = animPlay();
  bad.name = 'N'.repeat(90);
  bad.tags = ['ok', 7, null, { x: 1 }];
  bad.category = 42;
  bad.players[0].label = { no: 1 };
  const [ph] = bad.phases;
  ph.note = 12;
  ph.positions.ghost = { x: 1, y: 1 };
  ph.positions.a13 = { x: 'far', y: null };
  ph.objects.push({ id: 'o3', type: 'scrum', x: 50, y: 35, putIn: 'sideways', pack: 'a1' }, { id: 'o4', type: 'lineout', x: 40, y: 5, throwIn: 3, pack: ['a10', 'zz', 9, 'a10'] });
  Object.assign(ph.routes[0], { order: -2, curve: 'big', option: 7 });
  Object.assign(ph.routes[1], { order: 1.5, curve: Infinity, option: 'B' }); // a run can't be an option
  Object.assign(ph.routes[2], { option: ['A'], optionLabel: 5, to: 'nobody' });
  Object.assign(ph.routes[3], { optionLabel: 'x'.repeat(60), from: 99 });
  Object.assign(ph.routes[4], { option: 'b', order: '2' });
  const badFile = path.join(OUT, 'damaged.json');
  fs.writeFileSync(badFile, JSON.stringify(bad));
  await loadFile(page, badFile);
  const s = await state(page);
  const r = s.phases[0].routes;
  check('a damaged file loads, cleaned up', s.name.length === 60 && eq(s.tags, ['ok']) && s.category === 'attack' && s.players[0].label === '10' && s.phases[0].note === ''
    && !('ghost' in s.phases[0].positions) && Number.isFinite(s.phases[0].positions.a13.x), JSON.stringify({ name: s.name.length, tags: s.tags, label: s.players[0].label }));
  check('…routes: bad order dropped, bad curve 0, bad option null, label cut to 25, unknown players loose',
    !('order' in r[0]) && r[0].curve === 0 && r[0].option === null && !('order' in r[1]) && r[1].curve === 0 && r[1].option === null
    && r[2].option === null && !('optionLabel' in r[2]) && r[2].to === null && r[3].option === 'B' && r[3].optionLabel.length === 25 && r[3].from === null
    && r[4].option === null && !('order' in r[4]), JSON.stringify(r));
  const o = s.phases[0].objects;
  check('…markers: a pack that isn\'t a list goes, unknown ids leave a pack, bad put-in and throw-in go',
    !('pack' in o[2]) && !('putIn' in o[2]) && eq(o[3].pack, ['a10']) && !('throwIn' in o[3]), JSON.stringify(o.slice(2)));
  await throughEverything(page, dl, seen, 'damaged file');
  // The route with no order can still get one from the route bar (see below); here: it draws without a badge.
  check('…a route with no order has no badge', (await page.$$(`#badges-layer .badge[data-id="${r[0].id}"]`)).length === 0);

  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ---------------- Broken autosave on startup ----------------
{
  console.log('\n== Broken autosave ==');
  const { browser, page, errors } = await open();
  await sleep(600); // the blank play's own autosave is written, so leaving the page doesn't write it again
  // An autosave that isn't JSON.
  await page.evaluate(k => localStorage.setItem(k, '{"play": {not json'), AUTOSAVE);
  await page.reload();
  await page.waitForSelector('#phase-tabs button');
  check('unreadable autosave: message in the status line', (await toast(page)) === "Your last play couldn't be opened. A backup was kept.", await toast(page));
  check('…the raw autosave is kept under the backup key', (await page.evaluate(k => localStorage.getItem(k), BACKUP)) === '{"play": {not json');
  check('…and a blank play starts', (await state(page)).players.length === 0 && (await state(page)).name === 'Untitled play');
  await sleep(600);
  check('…which is saved in the library in its place, and the old autosave is gone',
    JSON.parse(await stored(page))?.play.players.length === 0 && (await page.evaluate(k => localStorage.getItem(k), AUTOSAVE)) === null);

  // An autosave that loads but breaks the first drawing (forced here: the first getScreenCTM call throws).
  await page.evaluateOnNewDocument(() => {
    const orig = SVGGraphicsElement.prototype.getScreenCTM;
    SVGGraphicsElement.prototype.getScreenCTM = function () {
      if (sessionStorage.getItem('break-render')) { sessionStorage.removeItem('break-render'); throw new Error('drawing broke'); }
      return orig.call(this);
    };
  });
  const raw = JSON.stringify({ play: animPlay(), phase: 1 });
  await page.evaluate((k, v) => { localStorage.removeItem('rugby-play-designer.autosave-backup'); localStorage.setItem(k, v); sessionStorage.setItem('break-render', '1'); }, AUTOSAVE, raw);
  await page.reload();
  await page.waitForSelector('#phase-tabs button');
  // It's moved into the library like any old autosave, so the library entry is its backup.
  check('autosave whose first drawing fails: message, kept in the library, a blank play opens',
    (await toast(page)) === "Your last play couldn't be opened. A backup was kept." && (await plays(page)).some(p => p.name === animPlay().name && p.play.players.length === animPlay().players.length)
    && (await state(page)).players.length === 0, await toast(page));
  await addPlayer(page, 'attack');
  check('…and the app works on as usual', (await state(page)).players.length === 1);
  // A good autosave still comes back.
  await sleep(600);
  await page.reload();
  await page.waitForSelector('#phase-tabs button');
  check('a good autosave comes back without a message', (await state(page)).players.length === 1 && (await toast(page)) === null);

  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ---------------- Two tabs and full storage ----------------
{
  console.log('\n== Two tabs, full storage ==');
  const { browser, page: a, errors } = await open();
  const b = await browser.newPage();
  await b.setViewport({ width: 1440, height: 900 });
  b.on('console', m => { if (m.type() === 'error') errors.push(`tab B: ${m.text()}`); });
  b.on('pageerror', e => errors.push(`tab B: ${e}`));
  await b.goto(URL_);
  await b.waitForSelector('#phase-tabs button');
  const dialogOpen = p => p.$eval('#tab-dialog', d => d.open);

  await a.bringToFront();
  await addPlayer(a, 'attack');
  await sleep(700);
  check('tab B: "This play was changed in another tab" with Use theirs / Keep mine', (await dialogOpen(b))
    && (await b.$eval('#tab-message', p => p.textContent)) === 'This play was changed in another tab.'
    && eq(await b.$$eval('#tab-dialog button', bs => bs.map(x => x.textContent)), ['Use theirs', 'Keep mine']));
  check('tab A: no question (its own save)', !(await dialogOpen(a)));
  await b.bringToFront();
  await b.click('#tab-theirs');
  await sleep(100);
  check('Use theirs: tab B now has tab A\'s play', (await state(b)).players.length === 1 && !(await dialogOpen(b)));
  check('…as one undo step', !(await disabled(b, '[data-action="undo"]')));
  await sleep(700);
  check('…and tab A isn\'t asked again (same play)', !(await dialogOpen(a)));

  // Only turning the pitch in one tab: not a change to the play.
  await click(a, '[data-orientation="vertical"]');
  await sleep(700);
  check('turning the pitch in tab A doesn\'t ask tab B', !(await dialogOpen(b)));

  await addPlayer(b, 'defense');
  await sleep(700);
  check('tab A is asked when tab B changes the play', await dialogOpen(a));
  const mine = await state(a);
  await a.bringToFront();
  await a.click('#tab-mine');
  await sleep(200);
  check('Keep mine: tab A keeps its play and saves it again', eq(await state(a), mine)
    && JSON.parse(await stored(a)).play.players.length === 1);
  await sleep(600);
  check('…so tab B is asked in turn', await dialogOpen(b));
  await b.bringToFront();
  await b.click('#tab-theirs');
  await sleep(700);
  check('tab B takes it; nobody is asked again', (await state(b)).players.length === 1 && !(await dialogOpen(a)) && !(await dialogOpen(b)));

  // Two tabs with different plays: neither is ever asked, and both plays are kept.
  const aId = await openId(a);
  await click(b, '[data-file="new"]');
  const bId = await openId(b);
  await addPlayer(a, 'attack', { n: 7 });
  await sleep(700);
  check('different plays: tab B isn\'t asked when tab A edits its play', !(await dialogOpen(b)) && bId !== aId);
  await b.bringToFront();
  await addPlayer(b, 'defense', { n: 4 });
  await sleep(700);
  check('…nor tab A when tab B edits its own', !(await dialogOpen(a)));
  const lib = await plays(a);
  check('…and the library has both, each with its own edits', lib.find(p => p.id === aId)?.play.players.some(p => p.id === 'a7') && lib.find(p => p.id === bId)?.play.players.some(p => p.id === 'd4') && !lib.find(p => p.id === bId).play.players.some(p => p.id === 'a7'));
  await b.close();

  // Storage full: every write to the library fails.
  await a.bringToFront();
  await a.evaluate(() => { IDBObjectStore.prototype.put = function () { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); }; });
  await addPlayer(a, 'attack');
  await sleep(700);
  check('storage full: says so, and points to Back up', (await toast(a)) === "Couldn't save: this browser's storage is full. Your play is still here: use Plays → Back up all plays to keep it.", await toast(a));
  await addPlayer(a, 'attack');
  check('…and editing carries on', (await state(a)).players.length === 4);

  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ---------------- Drags, the paused frame, locks ----------------
{
  console.log('\n== Drags, paused frame, locks ==');
  const { browser, page, errors } = await open();
  const play = animPlay();
  await loadPlay(page, play);
  await page.evaluate(() => { rugbyPlayback.timeScale = 0; });

  // --- Phase changes during a drag do nothing ---
  const a = await toScreen(page, 45, 20); // 13
  const mid = await toScreen(page, 47, 24);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + mid.x) / 2, (a.y + mid.y) / 2);
  await page.mouse.move(mid.x, mid.y);
  await page.$eval('#phase-tabs [data-index="1"]', x => x.click());
  await page.$eval('[data-phase="next"]', x => x.click());
  await page.keyboard.press('ArrowRight');
  await page.evaluate(() => { rugbyPlayback.jump(2); location.hash = '#phase=3'; });
  await sleep(100);
  check('mid-drag: phase tabs, Next, →, jump and #phase do nothing', (await shown(page)) === 0);
  await page.mouse.up();
  const s = await state(page);
  check('the drag finishes on the phase it started in', eq(s.phases[0].positions.a13, { x: 47, y: 24 }) && eq(s.phases[1].positions.a13, play.phases[1].positions.a13), JSON.stringify(s.phases[0].positions.a13));
  await nextFrame(page);
  check('the address shows that phase again', (await page.evaluate(() => location.hash)) === '#phase=1');

  // A drag whose route vanishes under it (another tab's play taken) is dropped.
  await page.keyboard.press('Escape');
  await tap(page, 46.9, 42.8); // the middle of 12's curved run (r2)
  const r2 = (await state(page)).phases[0].routes.find(r => r.id === 'r2');
  const end = await page.$eval('#handles-layer .handle.end .handle-dot', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  check('route selected, handles shown', !!end && !!r2);
  await page.mouse.move(end.x, end.y);
  await page.mouse.down();
  await page.mouse.move(end.x + 20, end.y + 10);
  await page.evaluate(() => { window.playState.phases[0].routes = window.playState.phases[0].routes.filter(r => r.id !== 'r2'); });
  await page.mouse.move(end.x + 40, end.y + 20);
  await page.mouse.up();
  check('a drag whose route is gone stops, nothing is made', !(await state(page)).phases[0].routes.some(r => r.id === 'r2'));
  await drag(page, [47, 24], [48, 25]);
  check('the next drag works', eq((await state(page)).phases[0].positions.a13, { x: 48, y: 25 }));
  await loadPlay(page, play);

  // --- The paused frame gives way to real positions ---
  const pauseMidRun = async () => {
    await page.evaluate(() => rugbyPlayback.jump(0));
    await page.keyboard.press('Space');
    await page.evaluate(ms => rugbyPlayback.advance(ms), TIMING.lead + 700);
    await page.keyboard.press('Space');
  };
  await pauseMidRun();
  check('paused mid-run: 10 is drawn on the way', (await pb(page)).paused && !eq(await drawnAt(page, 'a10'), play.phases[0].positions.a10));
  await tap(page, 80, 60); // open grass
  check('a press on the pitch drops the paused frame', !(await pb(page)).paused && eq(await drawnAt(page, 'a10'), play.phases[0].positions.a10));
  await pauseMidRun();
  await click(page, '[data-route="run"]');
  check('picking a tool drops it', !(await pb(page)).paused && eq(await drawnAt(page, 'a10'), play.phases[0].positions.a10));
  await page.keyboard.press('Escape');
  await pauseMidRun();
  await click(page, '[data-object="ruck"]'); // adds a ruck and selects it
  check('a new selection drops it', !(await pb(page)).paused && eq(await drawnAt(page, 'a10'), play.phases[0].positions.a10));
  await page.keyboard.press('Delete');
  await pauseMidRun();
  await page.keyboard.press('Escape'); // nothing was selected: no change
  check('…but a redraw that changes nothing keeps it', (await pb(page)).paused);
  await page.evaluate(() => rugbyPlayback.jump(0));

  // --- Locks: undo and redo in Present mode and while playing; the details while playing ---
  await addPlayer(page, 'attack');
  const edited = await state(page);
  await click(page, '#present-button');
  await undoKey(page);
  check('Present: Ctrl+Z does nothing', eq(await state(page), edited));
  check('Present: undo and redo are disabled', (await disabled(page, '[data-action="undo"]')) && (await disabled(page, '[data-action="redo"]')));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Space');
  await undoKey(page);
  await undoKey(page, true);
  check('playing: Ctrl+Z and Ctrl+Shift+Z do nothing', eq(await state(page), edited));
  const keyboard = await page.evaluate(() => {
    const tryFocus = el => { el.focus(); return document.activeElement === el; };
    return { menuInert: document.getElementById('file-menu').inert, summary: tryFocus(document.querySelector('#file-menu summary')) };
  });
  check('playing: the File menu is inert and can\'t take the focus', keyboard.menuInert && !keyboard.summary, JSON.stringify(keyboard));
  check('playing: the name, category and tags are not disabled', await page.evaluate(() => ['play-name', 'play-category', 'play-tags'].every(id => !document.getElementById(id).disabled)));
  // Tab goes through the page; the first text box it reaches stops the play, so typing there is kept.
  await page.evaluate(() => document.activeElement?.blur());
  const reached = [];
  let stoppedOnName = null;
  for (let i = 0; i < 40 && stoppedOnName == null; i++) {
    await page.keyboard.press('Tab');
    const at = await page.evaluate(() => ({ id: document.activeElement.closest('#file-menu') ? 'file' : document.activeElement.id || document.activeElement.tagName, playing: rugbyPlayback.playing, paused: rugbyPlayback.paused }));
    reached.push(at.id);
    if (at.id === 'play-name') stoppedOnName = !at.playing && !at.paused;
  }
  check('playing: Tab never reaches the File menu; reaching the play name stops the play', !reached.includes('file') && stoppedOnName === true, reached.join());
  await page.keyboard.type('XYZ');
  check('…and typing there renames the play (nothing is lost)', (await state(page)).name === 'XYZ' && eq({ ...(await state(page)), name: edited.name }, edited), (await state(page)).name);
  check('stopped: the File menu is usable again', await page.evaluate(() => !document.getElementById('file-menu').inert));
  await page.evaluate(() => rugbyPlayback.jump(0));

  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ---------------- Rotation, route bar Order, packs, redraws, exports from a copy ----------------
{
  console.log('\n== Rotation, Order, packs, redraws, export copy ==');
  const dl = path.join(OUT, 'copy');
  fs.mkdirSync(dl);
  const { browser, page, errors } = await open({ downloads: dl });

  // --- Turning the pitch is not an undo step ---
  await addPlayer(page, 'attack');
  await addPlayer(page, 'attack');
  await click(page, '[data-action="undo"]');
  // The phone held upright: the pitch turns by itself.
  await page.setViewport({ width: 390, height: 844 });
  await sleep(200);
  let s = await state(page);
  check('turning by itself (portrait phone): vertical, redo kept, undo still one step back',
    s.orientation === 'vertical' && !(await disabled(page, '[data-action="redo"]')) && !(await disabled(page, '[data-action="undo"]')) && s.players.length === 1);
  await page.setViewport({ width: 1440, height: 900 });
  await sleep(200);
  await click(page, '[data-orientation="vertical"]');
  await click(page, '[data-action="undo"]');
  s = await state(page);
  check('undo after turning skips the turn: no players, still vertical', s.players.length === 0 && s.orientation === 'vertical', JSON.stringify([s.players.length, s.orientation]));
  await click(page, '[data-orientation="horizontal"]');
  await click(page, '[data-action="redo"]');
  await click(page, '[data-action="redo"]');
  s = await state(page);
  check('redo still works after turning: both players back, horizontal', s.players.length === 2 && s.orientation === 'horizontal' && (await disabled(page, '[data-action="redo"]')));

  // --- Route bar Order for a route with no order ---
  const play = animPlay();
  delete play.phases[0].routes[4].order; // the drift, r5
  await loadPlay(page, play);
  await tap(page, 59, 33);
  const bar = await page.$eval('#route-bar', b => !b.hidden && b.dataset.id);
  check('a route with no order selected: the route bar shows', bar === 'r5', String(bar));
  await click(page, '[data-route-action="order"]');
  const r5 = (await state(page)).phases[0].routes.find(r => r.id === 'r5');
  check('Order gives it the next number and opens the editor on its new badge', r5.order === 2 && (await page.$eval('#inline-edit', i => !i.hidden && i.value)) === '2'
    && (await page.$$('#badges-layer .badge[data-id="r5"]')).length === 1, JSON.stringify(r5));
  await page.keyboard.press('Escape');

  // --- Deleting a player takes them out of scrum and lineout packs ---
  await page.keyboard.press('Escape');
  await placeSetPiece(page, 'scrum-attack');
  await sleep(100);
  await page.$eval('#players-layer [data-id="a1"] .body', el => {
    const r = el.getBoundingClientRect();
    const at = { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true, isPrimary: true, button: 0, pointerId: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', at));
    el.dispatchEvent(new PointerEvent('pointerup', at));
  });
  await page.keyboard.press('Delete');
  const scrum = (await state(page)).phases[0].objects.find(o => o.type === 'scrum');
  check('deleting 1 removes them from the scrum\'s pack', !scrum.pack.includes('a1') && scrum.pack.includes('a2'), JSON.stringify(scrum.pack));

  // --- Hover redraws record nothing: no undo snapshot (the play isn't even read) and no autosave ---
  await page.keyboard.press('Escape');
  await tap(page, 45, 20); // select 13
  await click(page, '[data-route="pass"]'); // click-to-draw from 13: the preview follows the pointer
  await sleep(600);
  await page.evaluate(() => {
    window.__reads = 0;
    window.__writes = 0;
    const stringify = JSON.stringify;
    JSON.stringify = function (v, ...rest) {
      if (v === window.playState || v?.play === window.playState) window.__reads++;
      return stringify.call(this, v, ...rest);
    };
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (...a) { window.__writes++; return setItem.apply(this, a); };
  });
  for (let i = 0; i < 20; i++) {
    const p = await toScreen(page, 30 + i, 20 + i / 2);
    await page.mouse.move(p.x, p.y);
  }
  await sleep(600);
  const hover = await page.evaluate(() => ({ reads: window.__reads, writes: window.__writes, preview: !!document.querySelector('.route-preview') }));
  check('hovering to aim a route: the preview draws, but no undo snapshot or autosave', hover.preview && hover.reads === 0 && hover.writes === 0, JSON.stringify(hover));
  await page.keyboard.press('Escape');

  // --- A drag redraws once per animation frame ---
  const p13 = await toScreen(page, 45, 20);
  await page.mouse.move(p13.x, p13.y);
  await page.mouse.down();
  const redraws = await page.evaluate(async start => {
    const layer = document.getElementById('players-layer');
    // Each redraw empties the players layer (one record that removes nodes), then adds them back one by one.
    let redrawn = 0;
    const clears = records => records.filter(r => r.removedNodes.length).length;
    const seen = new MutationObserver(records => { redrawn += clears(records); });
    seen.observe(layer, { childList: true });
    const svg = document.getElementById('pitch');
    for (let i = 1; i <= 20; i++) svg.dispatchEvent(new PointerEvent('pointermove', { clientX: start.x + i * 2, clientY: start.y + i, bubbles: true, isPrimary: true, pointerId: 1 }));
    const sameTick = redrawn + clears(seen.takeRecords());
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    const afterFrame = redrawn + clears(seen.takeRecords());
    seen.disconnect();
    return { sameTick, afterFrame };
  }, p13);
  await page.mouse.up();
  check('20 pointer moves in one frame: no redraw until the frame, then one', redraws.sameTick === 0 && redraws.afterFrame === 1, JSON.stringify(redraws));

  // --- Exports work from a copy taken at the start, and lock editing until done ---
  await page.$eval('#play-name', i => { i.value = 'Original'; i.dispatchEvent(new Event('input')); });
  const seen = new Set();
  const during = await page.evaluate(() => {
    document.querySelector('[data-file="pdf"]').click();
    const out = {
      undo: document.querySelector('[data-action="undo"]').disabled,
      tools: document.querySelector('[data-action="add-attack"]').disabled,
      menu: document.getElementById('file-menu').inert,
      note: document.getElementById('phase-note').disabled,
    };
    // A change from outside (another tab, say) while the PDF is being made.
    window.playState.name = 'Changed';
    window.playState.phases.push(structuredClone(window.playState.phases[0]));
    return out;
  });
  check('while exporting: undo, tools, File menu and note are locked', Object.values(during).every(Boolean), JSON.stringify(during));
  const pdf = await newFile(dl, '.pdf', seen);
  const pages = pdf ? await pdfText(pdf) : [];
  check('the PDF is of the play as it was when the export started', pages.length === 3 && pages[0].includes('Original') && !pages.join(' ').includes('Changed'), JSON.stringify(pages.map(p => p.slice(0, 40))));
  check('after the export, editing is unlocked', !(await disabled(page, '[data-action="add-attack"]')) && !(await page.$eval('#file-menu', m => m.inert)));

  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(`\n${failed() ? `${failed()} FAILED` : 'ALL PASSED'}`);
process.exit(failed() ? 1 : 0);
