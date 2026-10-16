// Headless Chrome checks: the four fixes plus regressions of earlier features. Desktop 1440x900 + phone 390 touch.
import fs from 'node:fs';
import path from 'node:path';
import { open, drag, tap, click, state, shown, check, failed, toScreen, outDir } from './lib.mjs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const OUT = outDir('suite');
console.log(`Downloads and screenshots: ${OUT}`);

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFile(dir, ext, ms = 15000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const f = fs.readdirSync(dir).filter(n => n.endsWith(ext));
    if (f.length) { await sleep(300); return path.join(dir, f[0]); }
    await sleep(100);
  }
  return null;
}
async function pdfInfo(bytes) {
  const doc = await getDocument({ data: new Uint8Array(bytes), disableFontFace: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const v = p.getViewport({ scale: 1 });
    const text = (await p.getTextContent()).items.map(t => t.str).join(' ');
    const ops = await p.getOperatorList();
    pages.push({ w: v.width, h: v.height, text, images: ops.fnArray.filter(f => f === 85 /* paintImageXObject */).length });
  }
  return { numPages: doc.numPages, pages };
}
// Every SVG serialized (i.e. every export picture) is kept so we can inspect what went into it.
const captureSvgs = page => page.evaluate(() => {
  window.__svgs = [];
  const orig = XMLSerializer.prototype.serializeToString;
  XMLSerializer.prototype.serializeToString = function (n) { const s = orig.call(this, n); window.__svgs.push(s); return s; };
  window.__prints = 0;
  window.print = () => { window.__prints++; };
});
const svgs = page => page.evaluate(() => window.__svgs);
// Turns a route tool on (type) or all off (null), whatever is on now.
// Turning a tool on first clears the selection (Escape), so drawing is press-and-drag as these checks expect.
async function tool(page, type) {
  if (type) await page.keyboard.press('Escape');
  const on = await page.evaluate(() => document.querySelector('[data-route][aria-pressed="true"]')?.dataset.route ?? null);
  if (on === type) return;
  if (type) await click(page, `[data-route="${type}"]`);
  else await click(page, `[data-route="${on}"]`);
}
// Picture markup without the embedded stylesheet (which names every class).
const noCss = svg => svg.replace(/<style>[\s\S]*?<\/style>/, '');
// Taps a player by its element, not by guessed coordinates.
async function tapPlayer(page, id) {
  const c = await page.$eval(`#players-layer [data-id="${id}"] .body`, el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(c.x, c.y);
}
const rings = page => page.$$eval('#players-layer .snap-ring', els => els.map(e => e.closest('[data-id]').dataset.id));

// Press, move to `to`, report, then release.
async function dragHold(page, from, to, during) {
  const a = await toScreen(page, ...from);
  const b = await toScreen(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8);
  const r = await during();
  await page.mouse.up();
  return r;
}

// ---------------- Desktop ----------------
{
  console.log('\n== Desktop 1440x900 ==');
  const dl = path.join(OUT, 'desk');
  fs.mkdirSync(dl);
  const { browser, page, errors } = await open({ downloads: dl });
  const requests = [];
  page.on('request', r => requests.push(r.url()));
  await captureSvgs(page);

  check('jsPDF not loaded on page load', !requests.some(u => u.includes('jspdf')) && !(await page.evaluate(() => !!window.jspdf)));
  for (let i = 0; i < 4; i++) await click(page, '[data-action="add-attack"]');
  await click(page, '[data-action="add-defense"]');
  let s = await state(page);
  check('4 attackers + 1 defender', s.players.length === 5);

  // Spread players out by dragging (regression: drag players).
  await drag(page, [44, 9.3], [50, 15]);
  await drag(page, [44, 13.6], [50, 25]);
  await drag(page, [56, 5], [52, 15]); // defender d1 near a2's area
  await drag(page, [52, 15], [60, 15]);
  s = await state(page);
  check('drag players', eq(s.phases[0].positions.a2, { x: 50, y: 15 }) && eq(s.phases[0].positions.a3, { x: 50, y: 25 }) && eq(s.phases[0].positions.d1, { x: 60, y: 15 }), JSON.stringify(s.phases[0].positions));

  // Regression: run from a1 snaps (pressed 1.5 m away), follows the player.
  await tool(page, 'run');
  await drag(page, [45, 6], [48, 2]);
  s = await state(page);
  let run = s.phases[0].routes[0];
  check('run attaches from 1.5 m and snaps', run.from === 'a1' && eq(run.points[0], [44, 5]) && run.order === 1 && !('to' in run), JSON.stringify(run));

  // --- 1. Pass attaches at both ends ---
  await tool(page, 'pass');
  const during = await dragHold(page, [44, 5], [51.2, 14.2], () => rings(page));
  check('ring on passer and receiver while drawing', during.includes('a1') && during.includes('a2') && during.length === 2, during.join());
  s = await state(page);
  let pass = s.phases[0].routes.find(r => r.type === 'pass');
  check('pass end snaps onto a2 within 2 m and stores "to"', pass.from === 'a1' && pass.to === 'a2' && eq(pass.points[1], [50, 15]), JSON.stringify(pass));
  const passD = await page.$eval(`#routes-layer [data-id="${pass.id}"] path:last-child`, p => p.getAttribute('d'));
  const endPt = passD.split(' ').slice(-2).map(Number);
  const gap = Math.hypot(endPt[0] - 50, endPt[1] - 15);
  check('drawn pass stops at the receiver disc edge', gap > 1.2 && gap < 1.6, passD);

  // Pass released > 2 m from everyone: loose end.
  const p2 = await dragHold(page, [44, 5], [44, 20], () => rings(page));
  s = await state(page);
  const loosePass = s.phases[0].routes.filter(r => r.type === 'pass')[1];
  check('pass ending in open grass has no "to"', loosePass.to === null && p2.join() === 'a1', `${JSON.stringify(loosePass)} rings ${p2}`);
  // Pass ending near an opponent doesn't attach.
  await drag(page, [44, 5], [59.5, 15.5]);
  s = await state(page);
  const oppPass = s.phases[0].routes.filter(r => r.type === 'pass')[2];
  check('pass ending near an opponent does not attach', oppPass.to === null, JSON.stringify(oppPass));
  // Clean those two up with undo (regression: undo).
  await click(page, '[data-action="undo"]');
  await click(page, '[data-action="undo"]');
  s = await state(page);
  check('undo removes the last two routes', s.phases[0].routes.length === 2);
  await tool(page, null);

  // Receiver moves -> end follows; passer moves -> start follows.
  await drag(page, [50, 15], [52, 17]);
  s = await state(page);
  pass = s.phases[0].routes.find(r => r.type === 'pass');
  check('pass end follows the receiver', eq(pass.points[1], [52, 17]) && pass.to === 'a2', JSON.stringify(pass));
  await drag(page, [44, 5], [44, 6]);
  s = await state(page);
  pass = s.phases[0].routes.find(r => r.type === 'pass');
  run = s.phases[0].routes.find(r => r.type === 'run');
  check('pass start (and run) follow the passer', eq(pass.points[0], [44, 6]) && eq(run.points[0], [44, 6]), JSON.stringify([pass, run]));

  // End handle: select the pass, drag its end away (> 2 m) -> detach; back near a3 -> attach to a3.
  await tap(page, 48, 11.5);
  check('pass selected by clicking its line', eq((await page.evaluate(() => 1)), 1) && (await page.$$('#handles-layer .handle')).length === 3);
  await drag(page, [52, 17], [56, 22]);
  s = await state(page);
  pass = s.phases[0].routes.find(r => r.type === 'pass');
  check('end handle dropped in open grass detaches', pass.to === null && eq(pass.points[1], [56, 22]), JSON.stringify(pass));
  const ringDuring = await dragHold(page, [56, 22], [51, 24], () => rings(page));
  s = await state(page);
  pass = s.phases[0].routes.find(r => r.type === 'pass');
  check('end handle dropped near a team-mate attaches (ringed while dragging)', pass.to === 'a3' && eq(pass.points[1], [50, 25]) && ringDuring.includes('a3'), `${JSON.stringify(pass)} ${ringDuring}`);
  // Attached at both ends: can't be dragged by the line.
  const before = JSON.stringify((await state(page)).phases[0].routes);
  await drag(page, [45.5, 10.75], [45.5, 30]);
  check('attached pass cannot be shifted by its line', JSON.stringify((await state(page)).phases[0].routes) === before);
  // Back to a2 for the rest.
  await tap(page, 45.5, 10.75);
  await drag(page, [50, 25], [51, 16]);
  s = await state(page);
  pass = s.phases[0].routes.find(r => r.type === 'pass');
  check('re-attach to a2', pass.to === 'a2', JSON.stringify(pass));

  // Ball + Add Phase: ball goes to "to" after their run, even with a3 nearer the pass end.
  await click(page, '[data-object="ball"]');
  await page.evaluate(() => { const b = window.playState.phases[0].objects[0]; Object.assign(b, { x: 45, y: 7 }); });
  await tool(page, 'run');
  await drag(page, [52, 17], [58, 20]); // a2 runs
  await tool(page, null);
  await page.evaluate(() => { const p = window.playState.phases[0]; p.positions.a3 = { x: 51.5, y: 17.5 }; });
  await click(page, '[data-phase="add"]');
  s = await state(page);
  const ball2 = s.phases[1].objects.find(o => o.type === 'ball');
  check('Add Phase: ball goes to the pass\'s "to" after their run', eq([ball2.x, ball2.y], [59.1, 20.9]), JSON.stringify(ball2));
  check('Add Phase: runners at the end of their runs', eq(s.phases[1].positions.a2, { x: 58, y: 20 }) && eq(s.phases[1].positions.a1, { x: 48, y: 2 }));

  // --- 2. Ghost shows previous routes ---
  const ghost = await page.evaluate(() => {
    const g = document.querySelector('#ghost-layer .ghost-routes');
    return {
      paths: g ? g.querySelectorAll('path').length : 0,
      opacity: g ? getComputedStyle(g).opacity : null,
      badges: document.querySelectorAll('#ghost-layer .badge, #ghost-layer [data-kind]').length,
      pe: document.getElementById('ghost-layer').getAttribute('pointer-events'),
      players: document.querySelectorAll('#ghost-layer [data-ghost]').length,
    };
  });
  check('ghost draws previous routes faintly (2 paths per route), no badges or clickable parts', ghost.paths === 6 && Number(ghost.opacity) <= 0.35 && ghost.badges === 0 && ghost.pe === 'none' && ghost.players === 5, JSON.stringify(ghost));
  check('current phase has no badges yet', (await page.$$('#badges-layer .badge')).length === 0);
  await tap(page, 47, 9); // where phase 1's pass is drawn
  check('clicking a ghost route selects nothing', (await page.evaluate(() => document.querySelector('[data-action="delete"]').disabled)));
  await click(page, '[data-layer="ghost"]');
  check('ghost layer off hides ghost routes', (await page.$$('#ghost-layer *')).length === 0);
  await click(page, '[data-layer="ghost"]');
  // Ghost passes with "to" are trimmed too
  check('ghost pass also stops short of the receiver', (await page.$$eval('#ghost-layer .ghost-routes path', ps => ps.map(p => p.getAttribute('d')))).length === 6);

  // --- 3. Insert in the middle of 5 phases ---
  // Build phases 2..5 with routes, notes, ball moved by passes.
  for (let ph = 1; ph < 5; ph++) {
    s = await state(page);
    const pos = s.phases[ph].positions;
    await tool(page, 'run');
    await drag(page, [pos.a1.x, pos.a1.y], [pos.a1.x + 3, pos.a1.y + 4]);
    await tool(page, 'pass');
    await drag(page, [pos.a1.x, pos.a1.y], [pos.a3.x + 0.5, pos.a3.y + 0.5]);
    await tool(page, null);
    await page.focus('#phase-note');
    await page.keyboard.type(`note ${ph + 1}`);
    if (ph < 4) await click(page, '[data-phase="add"]');
  }
  await page.$eval('#phase-tabs [data-index="0"]', b => b.click());
  await page.focus('#phase-note');
  await page.keyboard.type('note 1');
  const five = await state(page);
  check('5 phases with routes, notes and a ball each', five.phases.length === 5 && five.phases.every((p, i) => p.note === `note ${i + 1}` && p.routes.length >= 2 && p.objects.some(o => o.type === 'ball')), five.phases.map(p => `${p.note}/${p.routes.length}`).join());

  await page.$eval('#phase-tabs [data-index="1"]', b => b.click());
  await click(page, '[data-phase="insert"]');
  let after = await state(page);
  check('Insert after phase 2 shows the new phase 3', (await shown(page)) === 2 && after.phases.length === 6);
  check('phases 1-2 unchanged after insert', eq(after.phases.slice(0, 2), five.phases.slice(0, 2)));
  for (let k = 2; k < 5; k++) check(`old phase ${k + 1} is unchanged as phase ${k + 2}`, eq(after.phases[k + 1], five.phases[k]));
  const ins = after.phases[2];
  const p2run = five.phases[1].routes.find(r => r.type === 'run');
  check('inserted phase built from phase 2 (runner moved, no routes, empty note)', eq(ins.positions[p2run.from], { x: p2run.points[1][0], y: p2run.points[1][1] }) && ins.routes.length === 0 && ins.note === '');
  const lastPass2 = five.phases[1].routes.filter(r => r.type === 'pass').at(-1);
  const insBall = ins.objects.find(o => o.type === 'ball');
  const rcv = ins.positions[lastPass2.to];
  check('inserted phase: ball to the receiver', lastPass2.to && Math.abs(insBall.x - rcv.x - 1.1) < 0.01 && Math.abs(insBall.y - rcv.y - 0.9) < 0.01, JSON.stringify([insBall, rcv, lastPass2.to]));
  check('note box shows the new phase\'s (empty) note', (await page.$eval('#phase-note', t => t.value)) === '');
  await click(page, '[data-action="undo"]');
  check('insert undoes as one step', eq(await state(page), five));
  await click(page, '[data-action="redo"]');
  check('redo restores the insert', eq(await state(page), after));
  await click(page, '[data-action="undo"]');

  // "+" from phase 2 adds at the end.
  await page.$eval('#phase-tabs [data-index="1"]', b => b.click());
  await click(page, '[data-phase="add"]');
  after = await state(page);
  check('"+" on phase 2 adds at the end, leaves 1-5 unchanged', after.phases.length === 6 && (await shown(page)) === 5 && eq(after.phases.slice(0, 5), five.phases));
  await click(page, '[data-action="undo"]');

  // Moves never change contents.
  await page.$eval('#phase-tabs [data-index="2"]', b => b.click());
  await click(page, '[data-phase="right"]');
  after = await state(page);
  check('move right swaps 3 and 4 without changing them', eq(after.phases, [five.phases[0], five.phases[1], five.phases[3], five.phases[2], five.phases[4]]) && (await shown(page)) === 3);
  await click(page, '[data-phase="left"]');
  await click(page, '[data-phase="left"]');
  after = await state(page);
  check('move left twice: phase 3 now 2nd, others unchanged', eq(after.phases, [five.phases[0], five.phases[2], five.phases[1], five.phases[3], five.phases[4]]));
  await click(page, '[data-action="undo"]');
  await click(page, '[data-action="undo"]');
  await click(page, '[data-action="undo"]');
  check('each move is one undo step', eq(await state(page), five));

  // The bug: focus stays in the note box (as in Safari) while tapping phase buttons.
  await page.$eval('#phase-tabs [data-index="1"]', b => b.click());
  await page.focus('#phase-note');
  await page.$eval('[data-phase="insert"]', b => b.click()); // focus doesn't move, like Safari
  check('note box follows the phase even while focused', (await page.$eval('#phase-note', t => t.value)) === '');
  await page.keyboard.type('new');
  await page.$eval('#phase-tabs [data-index="3"]', b => b.click());
  check('note box shows phase 4\'s own note while still focused', (await page.$eval('#phase-note', t => t.value)) === 'note 3');
  await page.keyboard.type('!');
  after = await state(page);
  check('typing only changes the shown phase\'s note', eq(after.phases.map(p => p.note), ['note 1', 'note 2', 'new', 'note 3!', 'note 4', 'note 5']), after.phases.map(p => p.note).join('|'));
  await page.$eval('#phase-note', t => t.blur());
  await click(page, '[data-action="undo"]');
  await click(page, '[data-action="undo"]');
  await click(page, '[data-action="undo"]');
  check('back to the 5-phase play', eq(await state(page), five));

  // Regression: delete a player removes passes to or from them, in every phase.
  const passesTo = st => st.phases.flatMap(p => p.routes).filter(r => r.to === 'a3' || r.from === 'a3').length;
  check('some passes go to a3', passesTo(five) > 0);
  await page.$eval('#phase-tabs [data-index="0"]', b => b.click());
  await tapPlayer(page, 'a3');
  await click(page, '[data-action="delete"]');
  s = await state(page);
  check('deleting a player removes passes to/from them everywhere', passesTo(s) === 0 && !s.players.some(p => p.id === 'a3'));
  await click(page, '[data-action="undo"]');
  check('undo brings player and passes back', eq(await state(page), five));

  // --- 4. PDF and PNG exports ---
  await page.evaluate(() => { window.__svgs.length = 0; });
  // Select a route so we can check handles are left out.
  await page.$eval('#phase-tabs [data-index="1"]', b => b.click());
  const r0 = five.phases[1].routes[0];
  await page.evaluate(id => document.querySelector(`#routes-layer [data-id="${id}"] .route-hit`).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, button: 0, pointerId: 1 })), r0.id);
  await page.evaluate(() => document.getElementById('pitch').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, button: 0, pointerId: 1 })));
  check('route selected with handles before export', (await page.$$('#handles-layer .handle')).length === 3 && (await page.$$('#ghost-layer [data-ghost]')).length > 0);
  await page.$eval('#play-name', i => { i.value = 'Blind side: 2nd "wave"'; i.dispatchEvent(new Event('input')); });
  await click(page, '[data-file="png"]');
  check('Save image asks: this phase or all phases', await page.$eval('#image-dialog', d => d.open));
  await click(page, '[data-image="phase"]');
  const png = await waitFile(dl, '.png');
  check('PNG downloaded with phase number', png && path.basename(png) === 'Blind side 2nd wave-phase-2.png', String(png));
  check('PNG is a real PNG', png && fs.readFileSync(png).subarray(1, 4).toString() === 'PNG');
  let pics = await svgs(page);
  check('PNG picture has no ghost, handles or highlight', pics.length === 1 && !/class="(ghost|ghost-routes|handle[^"]*|route-highlight|snap-ring)"/.test(noCss(pics[0])), pics[0]?.match(/class="(ghost[^"]*|handle[^"]*|route-highlight)"/)?.[0]);
  check('selection survives the export', (await page.$$('#handles-layer .handle')).length === 3);

  await page.evaluate(() => { window.__svgs.length = 0; });
  await click(page, '[data-file="pdf"]');
  const pdf = await waitFile(dl, '.pdf');
  check('PDF downloaded as <play-name>.pdf', pdf && path.basename(pdf) === 'Blind side 2nd wave.pdf', String(pdf));
  check('print dialog never opened', (await page.evaluate(() => window.__prints)) === 0);
  check('jsPDF loaded only on export, from vendor/', requests.some(u => u.endsWith('/vendor/jspdf.umd.min.js')) && !requests.some(u => /cdn|unpkg|jsdelivr/.test(u)));
  pics = await svgs(page);
  check('PDF pictures: 5, none with ghost or handles', pics.length === 5 && pics.every(p => !/class="(ghost[^"]*|handle[^"]*|route-highlight)"/.test(noCss(p))));
  if (pdf) {
    const bytes = fs.readFileSync(pdf);
    check('PDF starts with %PDF', bytes.subarray(0, 4).toString() === '%PDF');
    const info = await pdfInfo(bytes);
    check('PDF has one page per phase', info.numPages === 5, String(info.numPages));
    check('horizontal play -> landscape A4 pages', info.pages.every(p => Math.round(p.w) === 842 && Math.round(p.h) === 595), JSON.stringify(info.pages.map(p => [p.w, p.h])));
    check('each page: name, Phase n of 5, note, a picture', info.pages.every((p, i) => p.text.includes('Blind side: 2nd "wave"') && p.text.includes(`Phase ${i + 1} of 5`) && p.text.includes(`note ${i + 1}`) && p.images >= 1), JSON.stringify(info.pages.map(p => [p.text, p.images])));
    fs.copyFileSync(pdf, path.join(OUT, 'horizontal.pdf'));
    fs.rmSync(pdf);
  }

  // Vertical -> portrait. Non-Latin note -> still on the page (as a picture).
  await click(page, '[data-orientation="vertical"]');
  await page.$eval('#phase-tabs [data-index="0"]', b => b.click());
  await page.$eval('#phase-note', t => { t.value = 'Whāia te iti kahurangi — 🏉 long note '.repeat(30); t.dispatchEvent(new Event('input')); t.blur(); });
  await click(page, '[data-file="pdf"]');
  const pdfV = await waitFile(dl, '.pdf');
  if (pdfV) {
    const info = await pdfInfo(fs.readFileSync(pdfV));
    check('vertical play -> portrait A4 pages', info.numPages === 5 && info.pages.every(p => Math.round(p.w) === 595 && Math.round(p.h) === 842), JSON.stringify(info.pages.map(p => [p.w, p.h])));
    check('non-Latin note drawn as a picture on page 1', info.pages[0].images >= 2 && !info.pages[0].text.includes('Whāia'), `${info.pages[0].images} ${info.pages[0].text.slice(0, 80)}`);
    fs.copyFileSync(pdfV, path.join(OUT, 'vertical.pdf'));
  } else check('vertical PDF downloaded', false);
  await page.screenshot({ path: path.join(OUT, 'desktop-vertical.png') });
  await click(page, '[data-orientation="horizontal"]');
  await page.$eval('#phase-tabs [data-index="1"]', b => b.click());
  await page.screenshot({ path: path.join(OUT, 'desktop-phase2.png') });

  // Regression: scrum preset, autosave reload, save/load file.
  await page.$eval('#phase-tabs [data-index="4"]', b => b.click());
  await click(page, '[data-action="set-piece"]');
  await page.click('#set-piece-dialog button[value="scrum-attack"]');
  await sleep(300);
  s = await state(page);
  check('scrum preset adds 1-8 of both teams', s.players.length === 16 && s.players.filter(p => p.team === 'attack').length === 8 && s.phases[4].objects.some(o => o.type === 'scrum' && o.pack.length === 16), JSON.stringify(s.players.map(p => p.id)));
  await sleep(600);
  const saved = await state(page);
  await page.reload();
  await page.waitForSelector('#phase-tabs button');
  await captureSvgs(page);
  check('autosave restores the play after reload', eq(await state(page), saved));
  check('autosave keeps pass "to"', (await state(page)).phases[0].routes.some(r => r.to === 'a2'));
  for (const f of fs.readdirSync(dl)) fs.rmSync(path.join(dl, f));
  await click(page, '[data-file="save"]');
  const json = await waitFile(dl, '.json');
  check('Save file downloads JSON with "to" on passes', json && JSON.parse(fs.readFileSync(json)).phases[0].routes.some(r => r.to === 'a2'));
  // Load a file with a pass "to" a missing player: loads with the end loose.
  const bad = JSON.parse(fs.readFileSync(json));
  bad.phases[0].routes.find(r => r.to === 'a2').to = 'a99';
  const badPath = path.join(OUT, 'bad.json');
  fs.writeFileSync(badPath, JSON.stringify(bad));
  page.once('dialog', d => d.accept());
  const input = await page.$('#load-input');
  await input.uploadFile(badPath);
  await sleep(500);
  s = await state(page);
  check('loading a pass to an unknown player leaves its end loose', s.phases[0].routes.filter(r => r.type === 'pass').every(r => r.to === null || s.players.some(p => p.id === r.to)) && s.phases[0].routes.some(r => r.type === 'pass' && r.to === null));
  check('Escape clears selection', await (async () => { await page.keyboard.press('Escape'); return page.evaluate(() => document.querySelector('[data-action="delete"]').disabled); })());

  check('desktop: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ---------------- Templates and the all-phases PNG (desktop) ----------------
{
  console.log('\n== Templates and all-phases PNG (desktop) ==');
  const dl = path.join(OUT, 'sheet');
  fs.mkdirSync(dl);
  const { browser, page, errors } = await open({ downloads: dl });
  await captureSvgs(page);
  const dialogs = [];
  let accept = true;
  page.on('dialog', d => { dialogs.push(d.message()); if (accept) d.accept(); else d.dismiss(); });

  const index = JSON.parse(fs.readFileSync(new URL('../../templates/index.json', import.meta.url)));
  const TEAMS = { Blank: [0, 0], 'Backline attack': [15, 0], 'Attack vs defense': [15, 15], Scrum: [15, 15], Lineout: [15, 15], 'Kick-off': [15, 15] };
  check('index lists the six starter templates', eq(index.map(t => t.name), Object.keys(TEAMS)), JSON.stringify(index));
  check('a new play starts with an empty pitch', (await state(page)).players.length === 0);

  const openPicker = async () => { await click(page, '#templates-button'); await page.waitForSelector('#templates-dialog[open] .template-card'); };
  await openPicker();
  const cards = await page.$$eval('.template-card', cs => cs.map(c => ({
    name: c.querySelector('span').textContent,
    lines: c.querySelectorAll('svg .line').length,
    attack: c.querySelectorAll('.thumb-player.attack').length,
    defense: c.querySelectorAll('.thumb-player.defense').length,
    h: c.querySelector('svg').getBoundingClientRect().height,
  })));
  check('picker: one card per template, in index order, name under it', eq(cards.map(c => c.name), index.map(t => t.name)));
  check('picker: thumbnails drawn from the data (pitch lines, right players)', cards.every(c => c.lines > 10 && c.h > 40 && c.attack === TEAMS[c.name][0] && c.defense === TEAMS[c.name][1]), JSON.stringify(cards));
  await page.screenshot({ path: path.join(OUT, 'templates-picker.png') });
  const empty = await state(page);
  await page.click('#templates-dialog .cancel');
  check('picker: Cancel closes it and changes nothing', !(await page.$eval('#templates-dialog', d => d.open)) && eq(await state(page), empty) && dialogs.length === 0);

  let prevEmpty = true;
  for (const [i, t] of index.entries()) {
    await openPicker();
    dialogs.length = 0;
    await page.$eval(`.template-card[data-template="${i}"]`, b => b.click());
    const s = await state(page);
    const pos = s.phases[0].positions;
    const count = team => s.players.filter(p => p.team === team).length;
    const ids = s.players.map(p => p.id);
    check(`${t.name}: confirm only if the play had something in it`, dialogs.length === (prevEmpty ? 0 : 1), dialogs.join());
    check(`${t.name}: ${TEAMS[t.name][0]} attack, ${TEAMS[t.name][1]} defense`, count('attack') === TEAMS[t.name][0] && count('defense') === TEAMS[t.name][1]);
    check(`${t.name}: no duplicate ids, ids a/d + number 1-15, label = number`, new Set(ids).size === ids.length && s.players.every(p => p.id === (p.team === 'attack' ? 'a' : 'd') + p.label && Number(p.label) >= 1 && Number(p.label) <= 15), ids.join());
    const off = ids.filter(id => !pos[id] || pos[id].x < 0 || pos[id].x > 100 || pos[id].y < 0 || pos[id].y > 70);
    check(`${t.name}: everyone on the pitch`, off.length === 0 && Object.keys(pos).length === ids.length, off.join());
    const close = [];
    ids.forEach((a, j) => ids.slice(j + 1).forEach(b => { if (Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y) < 2.4) close.push(`${a}-${b}`); }));
    check(`${t.name}: no overlapping players`, close.length === 0, close.join());
    check(`${t.name}: drawn on the pitch`, (await page.$$('#players-layer .player')).length === ids.length && s.phases.length === 1);
    check(`${t.name}: name from the template`, (await page.$eval('#play-name', i => i.value)) === (t.name === 'Blank' ? 'Untitled play' : t.name));
    if (t.name === 'Lineout') check('Lineout: a lineout marker 5 m in from touch, hooker by touch', s.phases[0].objects.some(o => o.type === 'lineout' && o.y === 5) && pos.a2.y < 5);
    if (t.name === 'Scrum') check('Scrum: the preset scrum on the middle spot with both packs', s.phases[0].objects.some(o => o.type === 'scrum' && o.y === 35 && o.pack.length === 16));
    if (t.name === 'Backline attack') check('Backline attack: a ruck with 9 at it', s.phases[0].objects.some(o => o.type === 'ruck' && Math.hypot(o.x - pos.a9.x, o.y - pos.a9.y) < 4));
    if (t.name !== 'Blank') await page.screenshot({ path: path.join(OUT, `template-${t.file.replace('.json', '')}.png`) });
    prevEmpty = t.name === 'Blank';
  }

  // Routes and phases work on a template: 10 runs, Add Phase moves him.
  const kickOff = await state(page);
  await tool(page, 'run');
  await drag(page, [kickOff.phases[0].positions.a10.x, 35], [56, 40]);
  await tool(page, null);
  await click(page, '[data-phase="add"]');
  let s = await state(page);
  check('template players run and follow into the next phase', eq(s.phases[1].positions.a10, { x: 56, y: 40 }), JSON.stringify(s.phases[1].positions.a10));
  await click(page, '[data-action="undo"]');
  await click(page, '[data-action="undo"]');
  check('back to the Kick-off template', eq(await state(page), kickOff));

  // Confirm declined: nothing changes. Accepted: one undo step back.
  await openPicker();
  accept = false;
  dialogs.length = 0;
  await page.$eval('.template-card[data-template="3"]', b => b.click());
  check('declining the confirm keeps the play', dialogs.length === 1 && eq(await state(page), kickOff));
  accept = true;
  await openPicker();
  await page.$eval('.template-card[data-template="3"]', b => b.click());
  const scrum = await state(page);
  check('accepting loads Scrum', scrum.name === 'Scrum');
  await click(page, '[data-action="undo"]');
  check('choosing a template is one undo step', eq(await state(page), kickOff));
  await click(page, '[data-action="redo"]');
  check('redo brings the template back', eq(await state(page), scrum));

  // Thumbnails and the loaded play follow the current orientation.
  await click(page, '[data-orientation="vertical"]');
  await openPicker();
  const ar = await page.$eval('.template-card svg', svg => { const r = svg.getBoundingClientRect(); return r.width / r.height; });
  check('vertical: thumbnails are vertical', ar < 1, String(ar));
  await page.$eval('.template-card[data-template="4"]', b => b.click());
  check('vertical: the template loads vertical', (await state(page)).orientation === 'vertical');
  await click(page, '[data-orientation="horizontal"]');

  // --- All-phases PNG ---
  // Leaves `n` phases (from a blank play), with notes, then saves all phases and reads back the sheet.
  async function sheet(n, { orientation = 'horizontal', longNote = false } = {}) {
    await page.evaluate(() => localStorage.clear());
    accept = true;
    await click(page, '[data-file="new"]');
    await click(page, `[data-orientation="${orientation}"]`);
    await page.$eval('#play-name', i => { i.value = 'Sheet: test'; i.dispatchEvent(new Event('input')); });
    await click(page, '[data-action="add-attack"]');
    await click(page, '[data-action="add-attack"]');
    for (let i = 0; i < n; i++) {
      if (i) await click(page, '[data-phase="add"]');
      const note = longNote && i === 0 ? 'Long note that goes on and on. '.repeat(20) : `note ${i + 1}`;
      await page.$eval('#phase-note', (t, v) => { t.value = v; t.dispatchEvent(new Event('input')); t.blur(); }, note);
    }
    // Draw a pass and keep it selected, with the ghost on, so the export has something to leave out.
    await tool(page, 'pass');
    const st = await state(page);
    const [p1, p2] = [st.phases.at(-1).positions.a1, st.phases.at(-1).positions.a2];
    await drag(page, [p1.x, p1.y], [p2.x, p2.y]);
    await tool(page, null);
    await page.evaluate(() => { window.__svgs.length = 0; });
    for (const f of fs.readdirSync(dl)) fs.rmSync(path.join(dl, f));
    await click(page, '[data-file="png"]');
    await click(page, '[data-image="all"]');
    const file = await waitFile(dl, '.png');
    const pics = await svgs(page);
    const info = await page.evaluate(xml => {
      const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
      const root = doc.documentElement;
      const tiles = [...root.children].filter(e => e.tagName === 'svg' && e.getAttribute('class') === 'tile');
      const texts = cls => [...root.querySelectorAll(`.${cls}`)].map(t => t.textContent);
      return {
        width: Number(root.getAttribute('width')),
        height: Number(root.getAttribute('height')),
        cols: new Set(tiles.map(t => t.getAttribute('x'))).size,
        rows: new Set(tiles.map(t => t.getAttribute('y'))).size,
        tiles: tiles.length,
        title: texts('sheet-title'),
        labels: texts('tile-label'),
        notes: texts('tile-note'),
      };
    }, pics.at(-1) ?? '<svg/>');
    const bytes = file ? fs.readFileSync(file) : Buffer.alloc(24);
    return { file, pics, info, png: { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) } };
  }
  const grids = [[1, 'horizontal', 1, 1], [3, 'horizontal', 2, 2], [5, 'horizontal', 2, 3], [1, 'vertical', 1, 1], [3, 'vertical', 3, 1], [5, 'vertical', 3, 2]];
  for (const [n, orientation, cols, rows] of grids) {
    const r = await sheet(n, { orientation, longNote: n === 5 && orientation === 'horizontal' });
    const tag = `${n} phase${n > 1 ? 's' : ''} ${orientation}`;
    check(`all phases, ${tag}: one PNG named <play>-all-phases.png`, r.file && path.basename(r.file) === 'Sheet test-all-phases.png' && r.pics.length === 1, String(r.file));
    check(`all phases, ${tag}: ${cols} x ${rows} grid`, r.info.tiles === n && r.info.cols === cols && r.info.rows === rows, JSON.stringify(r.info));
    check(`all phases, ${tag}: PNG is the sheet's size`, r.png.w === r.info.width && r.png.h === r.info.height && r.png.w > 0, JSON.stringify(r.png));
    check(`all phases, ${tag}: play name on top, "Phase n" on each tile`, eq(r.info.title, ['Sheet: test']) && eq(r.info.labels, Array.from({ length: n }, (_, i) => `Phase ${i + 1}`)));
    check(`all phases, ${tag}: no ghost, handles or highlight`, !/class="(ghost|ghost-routes|handle[^"]*|route-highlight|snap-ring)"/.test(noCss(r.pics[0] ?? 'class="ghost"')));
    if (n === 5 && orientation === 'horizontal') {
      const first = r.info.notes.filter(t => t.startsWith('Long') || !/^note \d$/.test(t));
      check('long note cut to two lines ending in "…"', first.length === 2 && first[1].endsWith('…'), JSON.stringify(first));
      check('other notes under their tiles', ['note 2', 'note 3', 'note 4', 'note 5'].every(t => r.info.notes.includes(t)));
      fs.copyFileSync(r.file, path.join(OUT, 'all-phases-horizontal.png'));
    }
    if (n === 5 && orientation === 'vertical') fs.copyFileSync(r.file, path.join(OUT, 'all-phases-vertical.png'));
  }
  check('selection survives the all-phases export', (await page.$$('#handles-layer .handle')).length === 3);
  await click(page, '[data-file="png"]');
  await page.click('#image-dialog .cancel');
  check('Cancel in Save image saves nothing', !(await page.$eval('#image-dialog', d => d.open)));

  check('templates/sheet: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ---------------- Phone 390 portrait, touch ----------------
{
  console.log('\n== Phone 390 portrait (touch) ==');
  const { browser, page, errors } = await open({ mobile: true });
  await captureSvgs(page);
  const s0 = await state(page);
  check('phone starts vertical', s0.orientation === 'vertical');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('no horizontal page scroll', overflow <= 0, String(overflow));
  const insertBox = await page.$eval('[data-phase="insert"]', b => { const r = b.getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width }; });
  check('Insert after button fits on screen', insertBox.l >= 0 && insertBox.r <= 390 && insertBox.w > 30, JSON.stringify(insertBox));

  for (let i = 0; i < 3; i++) await page.tap('[data-action="add-attack"]');
  await drag(page, [44, 9.3], [50, 15], { touch: true });
  let s = await state(page);
  check('touch drag player', Math.hypot(s.phases[0].positions.a2.x - 50, s.phases[0].positions.a2.y - 15) < 0.3, JSON.stringify(s.phases[0].positions.a2));
  await page.keyboard.press('Escape');
  await page.tap('[data-route="pass"]');
  await drag(page, [44.5, 5.5], [51, 16], { touch: true });
  s = await state(page);
  const pass = s.phases[0].routes[0];
  check('touch-drawn pass attaches both ends', pass?.from === 'a1' && pass?.to === 'a2', JSON.stringify(pass));
  await page.tap('[data-route="pass"]');
  await page.$eval('#phase-note', t => { t.value = 'p1'; t.dispatchEvent(new Event('input')); t.blur(); });
  await page.tap('[data-phase="add"]');
  await page.$eval('#phase-note', t => { t.value = 'p2'; t.dispatchEvent(new Event('input')); t.blur(); });
  const two = await state(page);
  await page.tap('#phase-tabs [data-index="0"]');
  await page.tap('[data-phase="insert"]');
  s = await state(page);
  check('tap Insert after: phase 2 kept as phase 3', s.phases.length === 3 && eq(s.phases[2], two.phases[1]) && (await shown(page)) === 1);
  check('ghost on the inserted phase shows phase 1\'s pass', (await page.$$('#ghost-layer .ghost-routes path')).length === 2);

  // PDF on a phone with no file sharing: the fallback dialog, a real PDF behind "Open in new tab".
  await page.evaluate(() => { window.__svgs.length = 0; navigator.canShare = undefined; });
  await page.tap('summary');
  await page.tap('[data-file="pdf"]');
  await page.waitForSelector('#save-dialog[open]', { timeout: 15000 }).catch(() => null);
  const dlg = await page.evaluate(async () => {
    const d = document.getElementById('save-dialog');
    const href = document.getElementById('save-open').href;
    const buf = href ? new Uint8Array(await (await fetch(href)).arrayBuffer()) : new Uint8Array();
    return { open: d.open, title: document.getElementById('save-title').textContent, previewHidden: document.getElementById('save-preview').hidden, bytes: [...buf] };
  });
  check('phone PDF fallback dialog opens (no share available)', dlg.open && dlg.title === 'Save PDF' && dlg.previewHidden, JSON.stringify({ ...dlg, bytes: dlg.bytes.length }));
  check('print dialog never opened (phone)', (await page.evaluate(() => window.__prints)) === 0);
  if (dlg.bytes.length) {
    const info = await pdfInfo(Buffer.from(dlg.bytes));
    check('phone PDF: 3 portrait pages', info.numPages === 3 && info.pages.every(p => p.h > p.w), JSON.stringify(info.pages.map(p => [p.w, p.h])));
  }
  await page.screenshot({ path: path.join(OUT, 'phone-pdf-dialog.png') });
  await page.evaluate(() => document.getElementById('save-dialog').close());

  // With file sharing: the share sheet gets <name>.pdf.
  await page.evaluate(() => {
    window.__shared = null;
    navigator.canShare = () => true;
    navigator.share = async d => { window.__shared = d.files.map(f => ({ name: f.name, type: f.type, size: f.size })); };
  });
  await page.tap('summary');
  await page.tap('[data-file="pdf"]');
  await page.waitForFunction(() => window.__shared, { timeout: 15000 }).catch(() => null);
  const shared = await page.evaluate(() => window.__shared);
  check('phone PDF goes to the share sheet as Untitled play.pdf', shared?.[0]?.name === 'Untitled play.pdf' && shared[0].type === 'application/pdf' && shared[0].size > 1000, JSON.stringify(shared));
  await page.evaluate(() => { window.__shared = null; window.__svgs.length = 0; });
  await page.tap('summary');
  await page.tap('[data-file="png"]');
  await page.tap('[data-image="phase"]');
  await page.waitForFunction(() => window.__shared, { timeout: 15000 }).catch(() => null);
  const sharedPng = await page.evaluate(() => window.__shared);
  check('phone PNG goes to the share sheet', sharedPng?.[0]?.name === 'Untitled play-phase-2.png', JSON.stringify(sharedPng));
  await page.evaluate(() => { window.__shared = null; });
  await page.tap('summary');
  await page.tap('[data-file="png"]');
  await page.tap('[data-image="all"]');
  await page.waitForFunction(() => window.__shared, { timeout: 15000 }).catch(() => null);
  const sharedAll = await page.evaluate(() => window.__shared);
  check('phone all-phases PNG goes to the share sheet', sharedAll?.[0]?.name === 'Untitled play-all-phases.png' && sharedAll[0].type === 'image/png', JSON.stringify(sharedAll));
  await page.evaluate(() => { window.__shared = null; navigator.canShare = undefined; });
  await page.tap('summary');
  await page.tap('[data-file="png"]');
  await page.tap('[data-image="all"]');
  await page.waitForSelector('#save-dialog[open]', { timeout: 15000 }).catch(() => null);
  check('phone all-phases PNG falls back to the save box without sharing', await page.evaluate(() => document.getElementById('save-dialog').open && !document.getElementById('save-preview').hidden && document.getElementById('save-title').textContent === 'Save image'));
  await page.evaluate(() => document.getElementById('save-dialog').close());
  await page.tap('#templates-button');
  await page.waitForSelector('.template-card');
  const thumbs = await page.$$eval('.template-card', cs => cs.map(c => { const r = c.getBoundingClientRect(); return { r: r.right, h: c.querySelector('svg').getBoundingClientRect().height }; }));
  check('phone: template cards fit on screen, thumbnails vertical like the pitch', thumbs.length === 6 && thumbs.every(t => t.r <= 390 && t.h > 100), JSON.stringify(thumbs));
  await page.screenshot({ path: path.join(OUT, 'phone-templates.png') });
  await page.tap('#templates-dialog .cancel');
  check('phone PNG has no ghost', !/class="ghost/.test(noCss((await svgs(page))[0] ?? 'class="ghost')));
  await page.screenshot({ path: path.join(OUT, 'phone.png') });
  check('phone: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(`\n${failed() ? `${failed()} FAILED` : 'ALL PASSED'}`);
process.exit(failed() ? 1 : 0);
