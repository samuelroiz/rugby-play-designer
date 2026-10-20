// Headless Chrome checks: the four fixes plus regressions of earlier features. Desktop 1440x900 + phone 390 touch.
import fs from 'node:fs';
import path from 'node:path';
import { open, drag, tap, click, state, shown, check, failed, toScreen, outDir, addPlayer, placeSetPiece, answerConfirm, nextFrame, openId, plays, loadFile } from './lib.mjs';
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
    const items = (await p.getTextContent()).items;
    const text = items.map(t => t.str).join(' ');
    const ops = await p.getOperatorList();
    // Where each image is drawn, in pt from the bottom left: the transform in force when it's painted
    // (save 10, restore 11, transform 12, paintImageXObject 85).
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
    pages.push({ w: v.width, h: v.height, text, items: items.map(t => ({ str: t.str, x: t.transform[4], y: t.transform[5] })), images: boxes.length, boxes });
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
  await nextFrame(page); // a drag redraws once per animation frame
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
  for (let i = 0; i < 4; i++) await addPlayer(page, 'attack');
  await addPlayer(page, 'defense');
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
  const passD = await page.$eval(`#ball-routes-layer [data-id="${pass.id}"] path:last-child`, p => p.getAttribute('d'));
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
  // The pass is step 2, after 1's run, so it's drawn from where that run ends (48, 2) to 2 (52, 17).
  await tap(page, 50, 9.5);
  check('pass selected by clicking its line', eq((await page.evaluate(() => 1)), 1) && (await page.$$('#handles-layer .handle')).length === 3);
  await drag(page, [52, 17], [56, 22]);
  s = await state(page);
  pass = s.phases[0].routes.find(r => r.type === 'pass');
  check('end handle dropped in open grass detaches', pass.to === null && eq(pass.points[1], [56, 22]), JSON.stringify(pass));
  const ringDuring = await dragHold(page, [56, 22], [51, 24], () => rings(page));
  s = await state(page);
  pass = s.phases[0].routes.find(r => r.type === 'pass');
  check('end handle dropped near a team-mate attaches (ringed while dragging)', pass.to === 'a3' && eq(pass.points[1], [50, 25]) && ringDuring.includes('a3'), `${JSON.stringify(pass)} ${ringDuring}`);
  // Attached at both ends: can't be dragged by the line (drawn from (48, 2) to 3 at (50, 25); pressed a
  // third of the way along, clear of its bend handle in the middle).
  const before = JSON.stringify((await state(page)).phases[0].routes);
  await drag(page, [48.6, 8.9], [48.6, 30]);
  check('attached pass cannot be shifted by its line', JSON.stringify((await state(page)).phases[0].routes) === before, `${before} ${JSON.stringify((await state(page)).phases[0].routes)}`);
  // Back to a2 for the rest.
  await tap(page, 48.6, 8.9);
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
  check('PDF pictures: the route key, then 5 pitches, none with ghost or handles', pics.length === 6 && pics.every(p => !/class="(ghost[^"]*|handle[^"]*|route-highlight)"/.test(noCss(p))));
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
    check('non-Latin note drawn as a picture on page 1', info.pages[0].images >= 3 && !info.pages[0].text.includes('Whāia'), `${info.pages[0].images} ${info.pages[0].text.slice(0, 80)}`);
    fs.copyFileSync(pdfV, path.join(OUT, 'vertical.pdf'));
  } else check('vertical PDF downloaded', false);
  await page.screenshot({ path: path.join(OUT, 'desktop-vertical.png') });
  await click(page, '[data-orientation="horizontal"]');
  await page.$eval('#phase-tabs [data-index="1"]', b => b.click());
  await page.screenshot({ path: path.join(OUT, 'desktop-phase2.png') });

  // Regression: scrum preset, autosave reload, save/load file.
  await page.$eval('#phase-tabs [data-index="4"]', b => b.click());
  await placeSetPiece(page, 'scrum-attack');
  await sleep(300);
  s = await state(page);
  check('scrum preset adds 1-9 of both teams', s.players.length === 18 && s.players.filter(p => p.team === 'attack').length === 9 && s.phases[4].objects.some(o => o.type === 'scrum' && o.pack.length === 18), JSON.stringify(s.players.map(p => p.id)));
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
  await loadFile(page, badPath);
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
  const confirmOpen = () => page.$eval('#confirm-dialog', d => d.open);

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
  check('picker: Cancel closes it and changes nothing', !(await page.$eval('#templates-dialog', d => d.open)) && eq(await state(page), empty) && !(await confirmOpen()));

  for (const [i, t] of index.entries()) {
    await openPicker();
    const before = await openId(page);
    await page.$eval(`.template-card[data-template="${i}"]`, b => b.click());
    await sleep(50);
    const asked = await confirmOpen();
    const s = await state(page);
    const pos = s.phases[0].positions;
    const count = team => s.players.filter(p => p.team === team).length;
    const ids = s.players.map(p => p.id);
    check(`${t.name}: never asks: it opens as a new play`, !asked && (await openId(page)) !== before);
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
    if (t.name === 'Scrum') check('Scrum: the preset scrum on the middle spot with both packs and 9s', s.phases[0].objects.some(o => o.type === 'scrum' && o.y === 35 && o.pack.length === 18));
    if (t.name === 'Backline attack') check('Backline attack: a ruck with 9 at it', s.phases[0].objects.some(o => o.type === 'ruck' && Math.hypot(o.x - pos.a9.x, o.y - pos.a9.y) < 4));
    if (t.name !== 'Blank') await page.screenshot({ path: path.join(OUT, `template-${t.file.replace('.json', '')}.png`) });
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

  // A template never replaces the open play: it opens as a new one, with a fresh undo history.
  const kickOffId = await openId(page);
  await openPicker();
  await page.$eval('.template-card[data-template="3"]', b => b.click());
  await sleep(50);
  const scrum = await state(page);
  check('choosing Scrum opens it as a new play', scrum.name === 'Scrum' && (await openId(page)) !== kickOffId && !(await confirmOpen()));
  check('…with a fresh undo history', await page.$eval('[data-action="undo"]', b => b.disabled));
  check('…and the Kick-off play is still in Plays, unchanged', eq((await plays(page)).find(p => p.id === kickOffId)?.play, kickOff));

  // Thumbnails and the loaded play follow the current orientation.
  await click(page, '[data-orientation="vertical"]');
  await openPicker();
  const ar = await page.$eval('.template-card svg', svg => { const r = svg.getBoundingClientRect(); return r.width / r.height; });
  check('vertical: thumbnails are vertical', ar < 1, String(ar));
  await page.$eval('.template-card[data-template="4"]', b => b.click());
  await sleep(50);
  check('vertical: the template loads vertical', (await state(page)).orientation === 'vertical');
  await click(page, '[data-orientation="horizontal"]');

  // --- All-phases PNG ---
  // Leaves `n` phases (from a blank play), with notes, then saves all phases and reads back the sheet.
  async function sheet(n, { orientation = 'horizontal', longNote = false } = {}) {
    await click(page, '[data-file="new"]');
    await click(page, `[data-orientation="${orientation}"]`);
    await page.$eval('#play-name', i => { i.value = 'Sheet: test'; i.dispatchEvent(new Event('input')); });
    await addPlayer(page, 'attack');
    await addPlayer(page, 'attack');
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
        tileW: Math.min(...tiles.map(t => Number(t.getAttribute('width')))),
        title: texts('sheet-title'),
        labels: texts('tile-label'),
        notes: texts('tile-note'),
      };
    }, pics.at(-1) ?? '<svg/>');
    const bytes = file ? fs.readFileSync(file) : Buffer.alloc(24);
    return { file, pics, info, png: { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) } };
  }
  // One pitch per row for a horizontal play, two for a vertical one, so they're drawn large.
  const grids = [[1, 'horizontal', 1, 1], [3, 'horizontal', 1, 3], [5, 'horizontal', 1, 5], [1, 'vertical', 1, 1], [3, 'vertical', 2, 2], [5, 'vertical', 2, 3]];
  for (const [n, orientation, cols, rows] of grids) {
    const r = await sheet(n, { orientation, longNote: n === 5 && orientation === 'horizontal' });
    const tag = `${n} phase${n > 1 ? 's' : ''} ${orientation}`;
    check(`all phases, ${tag}: one PNG named <play>-all-phases.png`, r.file && path.basename(r.file) === 'Sheet test-all-phases.png' && r.pics.length === 1, String(r.file));
    check(`all phases, ${tag}: ${cols} x ${rows} grid`, r.info.tiles === n && r.info.cols === cols && r.info.rows === rows, JSON.stringify(r.info));
    check(`all phases, ${tag}: large pitches`, r.info.tileW >= (orientation === 'horizontal' ? 800 : 400), String(r.info.tileW));
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

// ---------------- First-use polish (desktop) ----------------
{
  console.log('\n== First-use polish (desktop) ==');
  const dl = path.join(OUT, 'polish');
  fs.mkdirSync(dl);
  const { browser, page, errors } = await open({ downloads: dl });
  await captureSvgs(page);
  const rect = (sel) => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2, right: r.right, bottom: r.bottom }; });
  const toast = () => page.$eval('#toast', t => (t.hidden ? null : { text: t.textContent, ok: t.classList.contains('ok') }));
  const inline = () => page.$eval('#inline-edit', i => (i.hidden ? null : { value: i.value, focused: document.activeElement === i, numeric: i.classList.contains('numeric') }));
  const dblTap = async id => {
    const c = await rect(`#players-layer [data-id="${id}"] .body`);
    await page.mouse.click(c.cx, c.cy);
    await page.mouse.click(c.cx, c.cy);
  };
  let s;

  // --- 6. Number picker ---
  await click(page, '[data-action="add-attack"]');
  let picker = await page.evaluate(() => ({
    open: document.getElementById('number-dialog').open,
    title: document.getElementById('number-title').textContent,
    free: [...document.querySelectorAll('#number-grid button:not(:disabled)')].map(b => Number(b.dataset.n)),
    next: document.querySelector('#number-grid .next')?.dataset.n,
    focused: document.activeElement?.dataset?.n,
  }));
  check('Add attack opens a picker: 1-15 free, 1 highlighted and focused', picker.open && picker.title === 'Add attacker' && picker.free.length === 15 && picker.next === '1' && picker.focused === '1', JSON.stringify(picker));
  const btnBox = await rect('[data-action="add-attack"]');
  const dlgBox = await rect('#number-dialog');
  check('on a computer the picker opens beside its button', dlgBox.x >= btnBox.right && Math.abs(dlgBox.y - btnBox.y) < 40, JSON.stringify([btnBox, dlgBox]));
  await page.screenshot({ path: path.join(OUT, 'number-picker.png') });
  await click(page, '#number-grid [data-n="10"]');
  await page.keyboard.press('Escape'); // placed at the usual spot (clicking a spot is checked in usability.mjs)
  s = await state(page);
  check('clicking 10 adds attacker 10', eq(s.players, [{ id: 'a10', team: 'attack', label: '10' }]) && !(await page.$eval('#number-dialog', d => d.open)));
  await click(page, '[data-action="add-attack"]');
  picker = await page.evaluate(() => ({ used: document.querySelector('#number-grid [data-n="10"]').disabled, next: document.querySelector('#number-grid .next').dataset.n }));
  check('10 now shows as used; 1 is still the highlighted next', picker.used && picker.next === '1');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  check('Enter adds the highlighted number (as before)', (await state(page)).players.some(p => p.id === 'a1'));
  await click(page, '[data-action="add-attack"]');
  await page.keyboard.press('Escape');
  check('Escape closes the picker, adds nobody', (await state(page)).players.length === 2 && !(await page.$eval('#number-dialog', d => d.open)));
  await click(page, '[data-action="add-defense"]');
  check('Add defender: "Add defender", blue highlight', (await page.$eval('#number-title', t => t.textContent)) === 'Add defender' && (await page.$eval('#number-grid', g => g.classList.contains('defense'))));
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  check('defender 1 added', (await state(page)).players.some(p => p.id === 'd1'));
  await click(page, '[data-action="undo"]');
  check('adding a player is one undo step', !(await state(page)).players.some(p => p.id === 'd1'));
  await click(page, '[data-action="redo"]');

  // --- 1. Rename with an in-app box ---
  await page.keyboard.press('Escape');
  await dblTap('a10');
  let box = await inline();
  const near = await rect('#inline-edit');
  const disc = await rect('#players-layer [data-id="a10"] .body');
  check('double-click opens a small box by the player, focused, with the label', box?.value === '10' && box.focused && Math.hypot(near.cx - disc.cx, near.cy - disc.cy) < 70, JSON.stringify([box, near, disc]));
  await page.screenshot({ path: path.join(OUT, 'rename.png') });
  await page.keyboard.type('FH');
  await page.keyboard.press('Enter');
  s = await state(page);
  check('Enter saves the new label and closes the box', s.players.find(p => p.id === 'a10').label === 'FH' && !(await inline()));
  await click(page, '[data-action="undo"]');
  check('rename is one undo step', (await state(page)).players.find(p => p.id === 'a10').label === '10');
  await sleep(450);
  await dblTap('a10');
  await page.keyboard.type('XX');
  await page.keyboard.press('Escape');
  check('Escape cancels', (await state(page)).players.find(p => p.id === 'a10').label === '10' && !(await inline()));
  await sleep(450);
  await dblTap('a10');
  await page.keyboard.type('AB');
  await tap(page, 30, 50); // clicking away
  check('clicking away saves', (await state(page)).players.find(p => p.id === 'a10').label === 'AB' && !(await inline()));
  await click(page, '[data-action="undo"]');
  // The route order badge: an in-app box too.
  await tool(page, 'run');
  const a1 = (await state(page)).phases[0].positions.a1;
  await drag(page, [a1.x, a1.y], [a1.x + 8, a1.y + 3]);
  // A kick as a second step, so the run has a badge (routes that all share one step show none).
  await tool(page, 'kick');
  await drag(page, [a1.x, a1.y], [a1.x + 20, a1.y - 6]);
  await tool(page, null);
  const run = (await state(page)).phases[0].routes[0];
  const badge = await rect(`#badges-layer [data-id="${run.id}"] circle`);
  await page.mouse.click(badge.cx, badge.cy);
  box = await inline();
  check('tapping a route\'s order badge opens a number box', box?.value === '1' && box.numeric && box.focused, JSON.stringify(box));
  await page.keyboard.type('7');
  await page.keyboard.press('Enter');
  check('Enter sets the order', (await state(page)).phases[0].routes[0].order === 7 && (await page.$eval(`#badges-layer [data-id="${run.id}"] text`, t => t.textContent)) === '7');
  // Confirms are in-app.
  await click(page, '[data-phase="add"]');
  await click(page, '[data-phase="delete"]');
  let msg = await answerConfirm(page, false);
  check('Delete phase asks in the app; Cancel keeps it', msg.startsWith('Delete phase 2') && (await state(page)).phases.length === 2);
  await click(page, '[data-phase="delete"]');
  await answerConfirm(page);
  check('OK deletes the phase', (await state(page)).phases.length === 1);
  await click(page, '[data-action="undo"]');
  check('and it undoes', (await state(page)).phases.length === 2);
  await page.$eval('#phase-tabs [data-index="0"]', b => b.click());
  const kept = await state(page);
  const keptId = await openId(page);
  await click(page, '[data-file="new"]');
  check('New play doesn\'t ask: it opens a new blank play, and the one before stays in Plays',
    !(await page.$eval('#confirm-dialog', d => d.open)) && (await state(page)).players.length === 0 && (await openId(page)) !== keptId && eq((await plays(page)).find(p => p.id === keptId)?.play, kept));
  // Back to it, from the Plays panel.
  await click(page, '#plays-button');
  await page.waitForSelector(`#plays-dialog[open] .play-row[data-id="${keptId}"]`);
  await page.click(`.play-row[data-id="${keptId}"] .play-info`);
  check('…and opens again from Plays', (await openId(page)) === keptId && eq(await state(page), kept));

  // --- 2. Balls above players, badges clear of them ---
  check('balls are drawn in a layer above the players', await page.evaluate(() => {
    const ids = [...document.getElementById('world').children].map(g => g.id);
    return ids.indexOf('ball-layer') > ids.indexOf('players-layer') && ids.indexOf('badges-layer') > ids.indexOf('ball-layer');
  }));
  await click(page, '[data-object="ball"]');
  await page.evaluate(() => { const b = window.playState.phases[0].objects.find(o => o.type === 'ball'); const p = window.playState.phases[0].positions.a1; Object.assign(b, { x: p.x + 0.4, y: p.y + 0.3 }); });
  await page.keyboard.press('Escape');
  const ballAt = await rect('#ball-layer .ball');
  check('a ball on a player is on top (it gets the click)', await page.evaluate(({ cx, cy }) => document.elementFromPoint(cx, cy)?.closest('[data-kind]')?.dataset.kind === 'object', ballAt));
  // Kick-off: 10 has the ball. Routes from 10 and 9: no badge covers a player, a ball or another badge.
  await click(page, '#templates-button');
  await page.waitForSelector('.template-card');
  await page.$eval('.template-card[data-template="5"]', b => b.click());
  await sleep(50);
  const ko = (await state(page)).phases[0].positions;
  await tool(page, 'run');
  await drag(page, [ko.a10.x, ko.a10.y], [ko.a10.x + 6, ko.a10.y - 4]);
  await tool(page, 'kick');
  await drag(page, [ko.a10.x, ko.a10.y], [80, 50]);
  await tool(page, 'pass');
  await drag(page, [ko.a10.x, ko.a10.y], [ko.a9.x, ko.a9.y]);
  await tool(page, 'run');
  await drag(page, [ko.a9.x, ko.a9.y], [ko.a9.x + 5, ko.a9.y - 6]);
  await tool(page, null);
  await page.keyboard.press('Escape');
  const clash = await page.evaluate(() => {
    const ph = window.playState.phases[0];
    const discs = [
      ...Object.entries(ph.positions).map(([id, p]) => ({ id, ...p, r: 1.2 })),
      ...ph.objects.filter(o => o.type === 'ball').map(o => ({ id: 'ball', x: o.x, y: o.y, r: 0.75 })),
    ];
    const badges = [...document.querySelectorAll('#badges-layer .badge')].map(b => {
      const [x, y] = b.getAttribute('transform').match(/translate\(([-\d.]+) ([-\d.]+)\)/).slice(1).map(Number);
      return { id: b.dataset.id, x, y, r: 0.9 };
    });
    const out = [];
    badges.forEach((b, i) => {
      for (const d of [...discs, ...badges.slice(0, i)]) if (Math.hypot(b.x - d.x, b.y - d.y) < b.r + d.r) out.push(`${b.id}~${d.id}`);
    });
    return { n: badges.length, out };
  });
  check('badges cover no player, ball or other badge', clash.n === 4 && clash.out.length === 0, JSON.stringify(clash));
  await page.screenshot({ path: path.join(OUT, 'badges.png') });

  // --- 3. Scrum with 9s, 4. Lineout preset ---
  await click(page, '[data-file="new"]');
  await addPlayer(page, 'attack', { n: 9 });
  await placeSetPiece(page, 'scrum-attack');
  await sleep(200);
  s = await state(page);
  let ph = s.phases[0];
  let scrum = ph.objects.find(o => o.type === 'scrum');
  let ball = ph.objects.find(o => o.type === 'ball');
  check('scrum: 1-9 of both teams, the existing 9 reused', s.players.length === 18 && s.players.filter(p => p.id === 'a9').length === 1 && scrum.pack.includes('a9') && scrum.pack.includes('d9'), s.players.map(p => p.id).join());
  check('attack put-in: attack 9 next to the ball on the put-in side', Math.hypot(ph.positions.a9.x - ball.x, ph.positions.a9.y - ball.y) < 3 && ph.positions.a9.y < ball.y && ball.y < scrum.y, JSON.stringify([ph.positions.a9, ball, scrum]));
  check('the other 9 on the same side, by their pack', ph.positions.d9.y === ph.positions.a9.y && ph.positions.d9.x > scrum.x);
  await placeSetPiece(page, 'scrum-defense');
  await sleep(200);
  s = await state(page);
  ph = s.phases[0];
  scrum = ph.objects.find(o => o.type === 'scrum');
  ball = ph.objects.find(o => o.type === 'ball');
  check('defense put-in: defense 9 next to the ball, both 9s on that side', s.players.length === 18 && Math.hypot(ph.positions.d9.x - ball.x, ph.positions.d9.y - ball.y) < 3 && ph.positions.d9.y > scrum.y && ph.positions.a9.y > scrum.y);
  await page.screenshot({ path: path.join(OUT, 'scrum-9s.png') });

  const setPiece = await page.$$eval('#set-piece-dialog button[value]', bs => bs.map(b => b.value));
  check('Set piece offers Scrum and Lineout', ['scrum-attack', 'scrum-defense', 'lineout-attack', 'lineout-defense'].every(v => setPiece.includes(v)), setPiece.join());
  const before = await state(page);
  await placeSetPiece(page, 'lineout-attack');
  await sleep(200);
  s = await state(page);
  ph = s.phases[0];
  let lo = ph.objects.find(o => o.type === 'lineout');
  const line = (team, ns) => ns.map(n => ph.positions[(team === 'attack' ? 'a' : 'd') + n]);
  const ids = s.players.map(p => p.id);
  check('lineout: a marker added 5 m in from touch', lo && lo.y === 5, JSON.stringify(lo));
  check('lineout: players reused, no duplicates, 9 per team', new Set(ids).size === ids.length && s.players.length === 18);
  check('lineout: the phase\'s ball is reused, not a second one', ph.objects.filter(o => o.type === 'ball').length === 1);
  const aLine = line('attack', [1, 4, 3, 6, 5, 8, 7]);
  const dLine = line('defense', [1, 4, 3, 6, 5, 8, 7]);
  check('lineout: 1 and 3-8 of each team in a line from 5 m in, attack on their own side', aLine.every(p => p.x === lo.x - 1.2 && p.y > 5 && p.y < 23) && dLine.every(p => p.x === lo.x + 1.2), JSON.stringify([aLine, dLine]));
  ball = ph.objects.find(o => o.type === 'ball');
  check('lineout: attack hooker throwing from touch with the ball, the other in the 5 m channel', ph.positions.a2.y < 2 && Math.hypot(ball.x - ph.positions.a2.x, ball.y - ph.positions.a2.y) < 2 && ph.positions.d2.y > 2 && ph.positions.d2.y < 5);
  check('lineout: 9s behind the lineout', ph.positions.a9.y > 21 && ph.positions.d9.y > 21 && ph.positions.a9.x < lo.x && ph.positions.d9.x > lo.x);
  await page.screenshot({ path: path.join(OUT, 'lineout-preset.png') });
  await click(page, '[data-action="undo"]');
  check('the lineout preset is one undo step', eq(await state(page), before));
  // At a marker dragged to the far touchline, with the defense throwing.
  await click(page, '[data-object="lineout"]');
  await page.evaluate(() => { const o = window.playState.phases[0].objects.find(q => q.type === 'lineout'); Object.assign(o, { x: 30, y: 58 }); });
  await placeSetPiece(page, 'lineout-defense');
  await sleep(200);
  s = await state(page);
  ph = s.phases[0];
  lo = ph.objects.find(o => o.type === 'lineout');
  check('far touchline: snapped to 5 m in (y 65), lines run into the field', lo.x === 30 && lo.y === 65 && line('attack', [1, 7]).every(p => p.y < 65 && p.x === 28.8), JSON.stringify(lo));
  check('defense throwing: their hooker on the touchline', ph.positions.d2.y > 68 && ph.positions.a2.y < 68 && s.players.length === 18);
  check('only one lineout marker', ph.objects.filter(o => o.type === 'lineout').length === 1);

  // --- 5. Attack direction ---
  check('Direction layer on by default', await page.$eval('[data-layer="direction"]', c => c.checked));
  const dir = async () => page.evaluate(() => {
    const g = document.querySelector('#direction-layer .direction');
    if (!g) return null;
    const shaft = g.querySelector('.direction-shaft');
    const m = shaft.getScreenCTM();
    const a = new DOMPoint(+shaft.getAttribute('x1'), +shaft.getAttribute('y1')).matrixTransform(m);
    const b = new DOMPoint(+shaft.getAttribute('x2'), +shaft.getAttribute('y2')).matrixTransform(m);
    const pitch = document.getElementById('pitch').getBoundingClientRect();
    const box = g.getBoundingClientRect();
    return { dx: b.x - a.x, dy: b.y - a.y, fromBottom: (pitch.bottom - box.bottom) / pitch.height, text: g.querySelector('text').textContent, fill: g.querySelector('text').getAttribute('fill') };
  });
  let d = await dir();
  check('horizontal: "Attack" arrow in red near the bottom, pointing right (to x=110)', d && d.text === 'Attack' && d.fill === '#d32f2f' && d.dx > 20 && Math.abs(d.dy) < 1 && d.fromBottom < 0.1, JSON.stringify(d));
  await click(page, '[data-orientation="vertical"]');
  d = await dir();
  check('vertical: pointing up (x=110 is at the top), near the bottom', d && d.dy < -20 && Math.abs(d.dx) < 1 && d.fromBottom < 0.1, JSON.stringify(d));
  await page.screenshot({ path: path.join(OUT, 'direction-vertical.png') });
  await click(page, '[data-view="half"]');
  d = await dir();
  check('half view: still near the bottom, pointing up', d && d.dy < -20 && d.fromBottom < 0.12, JSON.stringify(d));
  await click(page, '[data-view="full"]');
  await click(page, '[data-orientation="horizontal"]');
  await click(page, '[data-layer="direction"]');
  check('unticking Direction hides it', (await dir()) === null);
  await click(page, '[data-layer="direction"]');

  // --- 7. Tool clarity ---
  await page.keyboard.press('Escape');
  await click(page, '[data-route="pass"]');
  const contrast = () => page.$eval('[data-route="pass"]', b => {
    const rgb = c => c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    const lum = ([r, g, bl]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl); };
    const cs = getComputedStyle(b);
    const [l1, l2] = [lum(rgb(cs.backgroundColor)), lum(rgb(cs.color))].sort((x, y) => y - x);
    return { ratio: (l1 + 0.05) / (l2 + 0.05), bg: cs.backgroundColor };
  });
  let c = await contrast();
  check('the active route tool is high contrast (dark, white text)', c.ratio >= 7 && c.bg === 'rgb(29, 29, 29)', JSON.stringify(c));
  await page.hover('[data-route="pass"]');
  c = await contrast();
  check('... and stays so while hovered', c.ratio >= 7, JSON.stringify(c));
  const hintText = await page.$eval('#draw-hint', h => (h.hidden ? null : h.textContent));
  check('picking a tool with no player selected shows how to start', hintText === 'Drag from a player to draw a pass, or click a player first.', hintText);
  await tapPlayer(page, 'a5');
  const hint2 = await page.$eval('#draw-hint', h => (h.hidden ? null : h.textContent));
  check('with a player selected: where to click, again, Esc', hint2 === "Click where attacker 5's pass ends, or on a team-mate. Click again for another, Esc to stop.", hint2);
  await page.keyboard.press('Escape');
  check('"? Tips" is at the top of the sidebar', await page.evaluate(() => {
    const help = document.querySelector('.toolbar').firstElementChild;
    return help.id === 'help' && help.textContent.includes('?') && document.getElementById('tips').textContent.includes('Double-click a player');
  }));

  // --- 8. Title pencil, halfway labels ---
  await page.$eval('#play-name', i => { i.value = 'Polish: test'; i.dispatchEvent(new Event('input')); });
  const title = await rect('#title-size');
  const pencil = await rect('.title-pencil');
  check('a pencil sits right after the play name', pencil.w > 8 && pencil.x - title.right >= 0 && pencil.x - title.right < 12 && Math.abs(pencil.cy - title.cy) < 6, JSON.stringify([title, pencil]));
  await page.mouse.click(pencil.cx, pencil.cy);
  check('clicking the pencil opens Play details, with the category and tags', await page.evaluate(() => {
    const pop = document.getElementById('play-details');
    return pop.matches(':popover-open') && pop.contains(document.getElementById('play-category')) && pop.contains(document.getElementById('play-tags'));
  }));
  await page.keyboard.press('Escape');
  check('…Escape closes it', await page.evaluate(() => !document.getElementById('play-details').matches(':popover-open')));
  const title2 = await rect('#title-size');
  await page.mouse.click(title2.cx, title2.cy);
  check('clicking the name puts the cursor in it', await page.evaluate(() => document.activeElement?.id === 'play-name'));
  await page.$eval('#play-name', i => i.blur());
  const labels = await page.$$eval('#pitch-layer .distance', ts => ts.map(t => ({ text: t.textContent, at: t.getAttribute('transform').match(/translate\(([-\d.]+) ([-\d.]+)\)/).slice(1).map(Number) })));
  const fifties = labels.filter(l => l.text === '50');
  const tens = labels.filter(l => l.text === '10');
  const gapTo50 = Math.min(...tens.flatMap(t => fifties.map(f => Math.hypot(t.at[0] - f.at[0], t.at[1] - f.at[1]))));
  check('halfway is labelled "50" only, the 10 m labels well away from it', fifties.length === 2 && tens.length === 4 && gapTo50 > 9, `${gapTo50} ${JSON.stringify(labels)}`);

  // --- 9. Exports: toasts, PDF layout, print lines ---
  await page.$eval('#play-tags', i => { i.value = 'backs, restart'; i.dispatchEvent(new Event('input')); });
  const saved = async (file, image, ext) => {
    for (const f of fs.readdirSync(dl)) fs.rmSync(path.join(dl, f));
    await page.evaluate(() => { window.__svgs.length = 0; document.getElementById('toast').hidden = true; });
    await click(page, `[data-file="${file}"]`);
    if (image) await click(page, `[data-image="${image}"]`);
    const f = await waitFile(dl, ext);
    await page.waitForFunction(() => !document.getElementById('toast').hidden, { timeout: 15000 }).catch(() => null);
    return { file: f && path.basename(f), path: f, toast: await toast(), pics: await svgs(page) };
  };
  let r = await saved('save', null, '.json');
  check('Save file: toast "Saved Polish test.json"', r.toast?.text === 'Saved Polish test.json' && r.toast.ok && r.file === 'Polish test.json', JSON.stringify(r.toast));
  r = await saved('png', 'phase', '.png');
  check('PNG: toast with its name, and the direction arrow in the picture', r.toast?.text === `Saved ${r.file}` && r.file === 'Polish test-phase-1.png' && /class="direction"/.test(r.pics[0]), JSON.stringify(r.toast));
  r = await saved('png', 'all', '.png');
  const sheet = await page.evaluate(xml => {
    const root = new DOMParser().parseFromString(xml, 'image/svg+xml').documentElement;
    const tiles = [...root.children].filter(e => e.getAttribute('class') === 'tile');
    const key = [...root.children].find(e => e.getAttribute('class') === 'legend-key');
    const keyY = key ? Number(key.getAttribute('transform').match(/translate\([-\d.]+ ([-\d.]+)\)/)[1]) : null;
    const tileBottom = Math.max(...tiles.map(t => Number(t.getAttribute('y')) + Number(t.getAttribute('height'))));
    return { keyY, tileBottom, inTiles: tiles.some(t => t.querySelector('.legend-key')) };
  }, r.pics.at(-1));
  check('all-phases PNG: toast, route key below the grid and not on a pitch', r.toast?.text === 'Saved Polish test-all-phases.png' && sheet.keyY > sheet.tileBottom && !sheet.inTiles, JSON.stringify([r.toast, sheet]));
  r = await saved('pdf', null, '.pdf');
  check('PDF: toast with its name', r.toast?.text === 'Saved Polish test.pdf', JSON.stringify(r.toast));
  check('PDF: the route key is its own picture, not on the pitch', r.pics.length === 2 && r.pics[0].includes('legend-key') && !r.pics[1].includes('legend-key'));
  check('PDF: darker pitch lines for printing; the screen keeps white lines', /<svg[^>]*class="print"/.test(r.pics[1]) && r.pics[1].includes('.print .line') && (await page.$eval('#pitch-layer .line', l => getComputedStyle(l).stroke)) === 'rgb(255, 255, 255)');
  check('PDF: the direction arrow is in the picture', /class="direction"/.test(r.pics[1]));
  if (r.path) {
    const info = await pdfInfo(fs.readFileSync(r.path));
    const pg = info.pages[0];
    const [pitchBox, keyBox] = [...pg.boxes].sort((a, b) => b.w * b.h - a.w * a.h);
    const titleItem = pg.items.find(t => t.str.includes('Polish: test'));
    const metaItem = pg.items.find(t => t.str.includes('Attack'));
    check('PDF header: name on the left, category and tags on the right of the same line', titleItem && metaItem && metaItem.str.includes('backs, restart') && titleItem.x < metaItem.x && Math.abs(titleItem.y - metaItem.y) < 10, JSON.stringify(pg.items));
    check('PDF: the pitch is as wide as fits (over 750 pt of the 842 pt page)', pitchBox.w > 750, JSON.stringify(pg.boxes));
    check('PDF: the route key is below the pitch', keyBox && keyBox.y + keyBox.h <= pitchBox.y + 1, JSON.stringify(pg.boxes));
    fs.copyFileSync(r.path, path.join(OUT, 'polish.pdf'));
  }
  await click(page, '[data-orientation="vertical"]');
  r = await saved('pdf', null, '.pdf');
  if (r.path) {
    const pg = (await pdfInfo(fs.readFileSync(r.path))).pages[0];
    const [pitchBox, keyBox] = [...pg.boxes].sort((a, b) => b.w * b.h - a.w * a.h);
    check('portrait PDF: pitch fills the height left, key below it', pitchBox.h > 600 && keyBox.y + keyBox.h <= pitchBox.y + 1, JSON.stringify(pg.boxes));
    fs.copyFileSync(r.path, path.join(OUT, 'polish-vertical.pdf'));
  }
  check('polish: no console errors or native dialogs', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ---------------- Lineout group drag, single PNG route key ----------------
{
  console.log('\n== Lineout group drag, PNG key (desktop) ==');
  const dl = path.join(OUT, 'group');
  fs.mkdirSync(dl);
  const { browser, page, errors } = await open({ downloads: dl });
  await captureSvgs(page);
  const tabText = () => page.$$eval('#objects-layer .marker.lineout .group-tab text', ts => ts.map(t => t.textContent));
  // The marker's free part: its half towards touch (its middle is under the front lifters' touch areas).
  const markerSpot = o => [o.x, o.y + (o.y <= 35 ? -1.5 : 1.5)];
  const underIsMarker = async o => {
    const p = await toScreen(page, ...markerSpot(o));
    return page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-kind]')?.dataset.kind === 'object', p);
  };
  const lineoutPreset = async team => {
    await placeSetPiece(page, `lineout-${team}`);
    await sleep(200);
  };
  await addPlayer(page, 'attack', { n: 12 });
  await lineoutPreset('attack');
  let s = await state(page);
  let ph = s.phases[0];
  let lo = ph.objects.find(o => o.type === 'lineout');
  check('the lineout preset records its players (1-9 of both teams) and who throws', lo.pack.length === 18 && !lo.pack.includes('a12') && lo.throwIn === 'attack', JSON.stringify(lo));
  check('the L block shows while the lineout is selected (just placed)', eq(await tabText(), ['L']));
  await page.keyboard.press('Escape');
  check('nothing selected: no L block', (await tabText()).length === 0);
  await tapPlayer(page, 'a4');
  check('one of its players selected: the L block shows', eq(await tabText(), ['L']));
  await tapPlayer(page, 'a12');
  check('a player outside it selected: no L block', (await tabText()).length === 0);
  await page.keyboard.press('Escape');
  check('the marker can be pressed (its half towards touch is clear of players)', await underIsMarker(lo));
  await tap(page, ...markerSpot(lo));
  check('clicking the marker selects it and shows the block', eq(await tabText(), ['L']) && (await page.$$('#objects-layer .marker.lineout > .select-ring')).length === 1);

  // Drag by the L block: along the touchline only, 5 m line kept.
  const before = await state(page);
  const tabAt = await page.$eval('#objects-layer .marker.lineout .group-tab rect', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const target = await toScreen(page, lo.x + 5 + 12, lo.y + 5 + 9); // 12 m along, and 9 m into the field (ignored)
  await page.mouse.move(tabAt.x, tabAt.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(tabAt.x + (target.x - tabAt.x) * i / 8, tabAt.y + (target.y - tabAt.y) * i / 8);
  await page.mouse.up();
  s = await state(page);
  ph = s.phases[0];
  const lo2 = ph.objects.find(o => o.type === 'lineout');
  const moved = id => [Math.round((ph.positions[id].x - before.phases[0].positions[id].x) * 10) / 10, Math.round((ph.positions[id].y - before.phases[0].positions[id].y) * 10) / 10];
  check('dragging the L block moves the marker along the touchline, still on the 5 m line', Math.abs(lo2.x - lo.x - 12) < 0.6 && lo2.y === 5, JSON.stringify(lo2));
  const dx = Math.round((lo2.x - lo.x) * 10) / 10;
  check('every lineout player moves with it by the same amount', lo.pack.every(id => eq(moved(id), [dx, 0])), JSON.stringify(lo.pack.map(id => [id, moved(id)])));
  const b0 = before.phases[0].objects.find(o => o.type === 'ball');
  const b1 = ph.objects.find(o => o.type === 'ball');
  check('the ball moves with the thrower', Math.round((b1.x - b0.x) * 10) / 10 === dx && b1.y === b0.y, JSON.stringify([b0, b1]));
  check('a player outside the lineout stays put', eq(ph.positions.a12, before.phases[0].positions.a12));
  await click(page, '[data-action="undo"]');
  check('the group drag is one undo step', eq(await state(page), before));
  await click(page, '[data-action="redo"]');

  // Dragging the marker itself does the same; it can't leave the field of play.
  lo = (await state(page)).phases[0].objects.find(o => o.type === 'lineout');
  await drag(page, markerSpot(lo), [lo.x + 80, lo.y + 30]);
  s = await state(page);
  const lo3 = s.phases[0].objects.find(o => o.type === 'lineout');
  check('dragging the marker moves the group too, kept in the field (x 97 at most), on 5 m', lo3.x === 97 && lo3.y === 5 && s.phases[0].positions.a1.x === 95.8, JSON.stringify([lo3, s.phases[0].positions.a1]));
  // Players can still be dragged one at a time.
  const a4 = s.phases[0].positions.a4;
  await page.keyboard.press('Escape');
  await drag(page, [a4.x, a4.y], [a4.x - 6, a4.y + 4]);
  s = await state(page);
  check('a lineout player can still be dragged on their own', Math.hypot(s.phases[0].positions.a4.x - (a4.x - 6), s.phases[0].positions.a4.y - (a4.y + 4)) < 0.3 && s.phases[0].positions.a1.x === 95.8);
  // A scrum takes its players out of the lineout's group.
  await placeSetPiece(page, 'scrum-attack');
  await sleep(200);
  s = await state(page);
  check('a scrum takes 1-9 out of the lineout group (no player in two)', s.phases[0].objects.find(o => o.type === 'lineout').pack.length === 0 && s.phases[0].objects.find(o => o.type === 'scrum').pack.length === 18);
  await click(page, '[data-action="undo"]');

  // Far touchline, defense throwing: the 65 m line is kept.
  await click(page, '[data-file="new"]');
  await click(page, '[data-object="lineout"]');
  await page.evaluate(() => { const o = window.playState.phases[0].objects.find(q => q.type === 'lineout'); Object.assign(o, { x: 40, y: 60 }); });
  await lineoutPreset('defense');
  lo = (await state(page)).phases[0].objects.find(o => o.type === 'lineout');
  check('far touchline: the marker can be pressed too', await underIsMarker(lo));
  await drag(page, markerSpot(lo), [lo.x - 10, lo.y - 40]);
  s = await state(page);
  const far = s.phases[0].objects.find(o => o.type === 'lineout');
  check('far touchline: the drag keeps it on its 5 m line (y 65)', far.y === 65 && Math.abs(far.x - 30) < 0.6 && Math.abs(s.phases[0].positions.d2.x - (far.x + 0.5)) < 0.01, JSON.stringify([far, s.phases[0].positions.d2]));
  await page.screenshot({ path: path.join(OUT, 'lineout-group.png') });
  // A plain lineout marker (not from the preset) still moves on its own.
  await click(page, '[data-file="new"]');
  await addPlayer(page, 'attack');
  await click(page, '[data-object="lineout"]');
  const plain = (await state(page)).phases[0].objects.find(o => o.type === 'lineout');
  await page.keyboard.press('Escape');
  check('a plain lineout marker has no block', (await tabText()).length === 0);
  const p1 = (await state(page)).phases[0].positions.a1;
  await drag(page, [plain.x, plain.y], [plain.x + 5, plain.y + 7]);
  s = await state(page);
  const plain2 = s.phases[0].objects.find(o => o.type === 'lineout');
  check('a plain marker drags freely and moves nobody', Math.abs(plain2.x - plain.x - 5) < 0.3 && Math.abs(plain2.y - plain.y - 7) < 0.3 && eq(s.phases[0].positions.a1, p1), JSON.stringify(plain2));

  // --- Single-phase PNG: route key under the pitch, never on it ---
  const png = async () => {
    for (const f of fs.readdirSync(dl)) fs.rmSync(path.join(dl, f));
    await page.evaluate(() => { window.__svgs.length = 0; });
    await click(page, '[data-file="png"]');
    await click(page, '[data-image="phase"]');
    const file = await waitFile(dl, '.png');
    const xml = (await svgs(page)).at(-1);
    const info = await page.evaluate(xml => {
      const root = new DOMParser().parseFromString(xml, 'image/svg+xml').documentElement;
      const pitch = [...root.children].find(e => e.tagName === 'svg');
      const key = [...root.children].find(e => e.getAttribute('class') === 'legend-key');
      return {
        h: Number(root.getAttribute('viewBox').split(' ')[3]),
        pitchH: Number(pitch.getAttribute('height')),
        // The team logo's strip above the pitch (the default logo is on), 0 without it.
        top: Number(pitch.getAttribute('y')),
        keyY: key ? Number(key.getAttribute('transform').match(/translate\([-\d.]+ ([-\d.]+)\)/)[1]) : null,
        keyInPitch: !!pitch.querySelector('.legend-key'),
      };
    }, xml);
    const bytes = fs.readFileSync(file);
    return { ...info, png: { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) }, file };
  };
  const pitchBox = await page.$eval('#pitch', el => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  let r = await png();
  check('PNG: the route key sits under the pitch, not on it', r.keyY >= r.pitchH && !r.keyInPitch && r.h > r.pitchH && Math.abs(r.pitchH - pitchBox.h) < 1, JSON.stringify(r));
  check('PNG: the picture is taller by the key\'s strip, at twice the size', Math.abs(r.png.h - r.h * 2) <= 1 && Math.abs(r.png.w - pitchBox.w * 2) <= 1, JSON.stringify([r.png, r.h, pitchBox]));
  fs.copyFileSync(r.file, path.join(OUT, 'png-key-below.png'));
  await page.$eval('[data-layer="legend"]', c => c.click());
  r = await png();
  check('PNG with the Legend layer off: just the pitch (and the logo strip above it), no key', r.keyY === null && r.h === r.top + r.pitchH, JSON.stringify(r));
  await page.$eval('[data-layer="legend"]', c => c.click());
  await click(page, '[data-orientation="vertical"]');
  r = await png();
  check('vertical PNG: key under the pitch too', r.keyY >= r.pitchH && !r.keyInPitch, JSON.stringify(r));
  fs.copyFileSync(r.file, path.join(OUT, 'png-key-below-vertical.png'));

  check('group/PNG: no console errors or native dialogs', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ---------------- Second first-use fixes (desktop) ----------------
{
  console.log('\n== Second first-use fixes (desktop) ==');
  const dl = path.join(OUT, 'second');
  fs.mkdirSync(dl);
  const { browser, page, errors } = await open({ downloads: dl });
  await captureSvgs(page);
  const rect = sel => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; });
  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const inside = (a, b) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
  // Presses an element (a badge or a route's touch line) by dispatching the pointer events on it.
  const press = sel => page.evaluate(sel => {
    const el = document.querySelector(sel);
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, button: 0, pointerId: 1 }));
    document.getElementById('pitch').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, button: 0, pointerId: 1 }));
  }, sel);
  const selectPlayer = async id => {
    await sleep(450); // two taps within 400 ms would be a double-click
    await tapPlayer(page, id);
  };
  const routesNow = async () => (await state(page)).phases[0].routes;
  const dialogOpen = () => page.$eval('#option-dialog', d => d.open);
  const closeOption = async () => { await page.click('#option-dialog .cancel'); await sleep(100); };
  let s;

  // 12 (a2) in the middle with 3 below, 1 above; 4 lower left with 5 near it.
  for (let i = 0; i < 5; i++) await addPlayer(page, 'attack');
  await page.evaluate(() => {
    const p = window.playState.phases[0].positions;
    Object.assign(p, { a1: { x: 52, y: 25 }, a2: { x: 50, y: 35 }, a3: { x: 52, y: 45 }, a4: { x: 40, y: 52 }, a5: { x: 46, y: 60 } });
    window.playState.players.find(q => q.id === 'a2').label = '12';
  });
  await page.keyboard.press('Escape');
  // 12: pass to 3 (A), pass to 1 (B), kick (C). 4: pass to 5 (A), kick (B), only about 25 degrees apart.
  await selectPlayer('a2');
  await click(page, '[data-route="pass"]');
  await tap(page, 52.5, 45.5);
  await tap(page, 52.5, 24.5);
  await click(page, '[data-route="kick"]');
  await tap(page, 80, 35);
  await page.keyboard.press('Escape');
  await selectPlayer('a4');
  await click(page, '[data-route="pass"]');
  await tap(page, 46.3, 60.3);
  await click(page, '[data-route="kick"]');
  await tap(page, 62, 63);
  await page.keyboard.press('Escape');
  s = await state(page);
  const opts = s.phases[0].routes;
  check('setup: 12 has options A, B, C and 4 has A, B', eq(opts.map(r => `${r.from}${r.option}`), ['a2A', 'a2B', 'a2C', 'a4A', 'a4B']), JSON.stringify(opts));
  const [A, B, C, A4, B4] = opts;

  // --- 1. Each option's badge is on its own route ---
  const badgeFit = await page.evaluate(ids => {
    const samples = id => {
      const p = document.querySelector(`#ball-routes-layer [data-id="${id}"] path.route-casing`);
      const len = p.getTotalLength();
      return Array.from({ length: 81 }, (_, i) => p.getPointAtLength(len * i / 80));
    };
    const dist = (pts, b) => Math.min(...pts.map(q => Math.hypot(q.x - b.x, q.y - b.y)));
    const route = id => window.playState.phases[0].routes.find(r => r.id === id);
    return ids.map(id => {
      const r = route(id);
      const [x, y] = document.querySelector(`#badges-layer .badge[data-id="${id}"]`).getAttribute('transform').match(/translate\(([-\d.]+) ([-\d.]+)\)/).slice(1).map(Number);
      const b = { x, y };
      const siblings = window.playState.phases[0].routes.filter(o => o.from === r.from && o.option && o.id !== id);
      return {
        id,
        own: dist(samples(id), b),
        sibling: Math.min(...siblings.map(o => dist(samples(o.id), b))),
        fromStart: Math.hypot(b.x - r.points[0][0], b.y - r.points[0][1]),
      };
    });
  }, opts.map(r => r.id));
  check('each option badge sits on its own route, clearly nearer it than any sibling option',
    badgeFit.every(f => f.own < 1.6 && f.sibling - f.own >= 1), JSON.stringify(badgeFit));
  check('... a short way along the route, clear of the passer', badgeFit.every(f => f.fromStart > 2.1 && f.fromStart < 9), JSON.stringify(badgeFit));
  await page.screenshot({ path: path.join(OUT, 'option-badges.png') });

  // The option box names the route and highlights it.
  await press(`#badges-layer [data-id="${A.id}"] circle`);
  await page.waitForSelector('#option-dialog[open]', { timeout: 3000 }).catch(() => null);
  let title = await page.$eval('#option-title', t => t.textContent);
  check('option box title names the route: "Option A: Pass to 3"', title === 'Option A: Pass to 3', title);
  const focus = await page.evaluate(id => ({
    focused: !!document.querySelector(`#ball-routes-layer .route-line.option-focus[data-id="${id}"] .route-focus`),
    own: Number(getComputedStyle(document.querySelector(`#ball-routes-layer [data-id="${id}"]`)).opacity),
    others: [...document.querySelectorAll('#ball-routes-layer .route-line')].filter(g => g.dataset.id !== id).map(g => Number(getComputedStyle(g).opacity)),
  }), A.id);
  check('while its box is open the route is highlighted strongly and the others fade', focus.focused && focus.own === 1 && focus.others.every(o => o <= 0.3), JSON.stringify(focus));
  const aBox = await rect(`#ball-routes-layer [data-id="${A.id}"]`);
  const dBox = await rect('#option-dialog');
  check('the option box does not cover its route', !overlaps(aBox, dBox), JSON.stringify([aBox, dBox]));
  await page.screenshot({ path: path.join(OUT, 'option-focus.png') });
  await closeOption();
  check('closing the box ends the highlight', (await page.$$('.route-focus, .option-focus')).length === 0 && !(await page.$eval('#pitch', p => p.classList.contains('option-focusing'))));
  await press(`#badges-layer [data-id="${C.id}"] circle`);
  await page.waitForSelector('#option-dialog[open]');
  title = await page.$eval('#option-title', t => t.textContent);
  check('a kick option: "Option C: Kick"', title === 'Option C: Kick', title);
  await closeOption();
  await press(`#badges-layer [data-id="${B.id}"] circle`);
  await page.waitForSelector('#option-dialog[open]');
  title = await page.$eval('#option-title', t => t.textContent);
  check('"Option B: Pass to 1" uses the receiver\'s label', title === 'Option B: Pass to 1', title);
  await closeOption();

  // --- 2. Route action bar ---
  await page.keyboard.press('Escape');
  const bar = () => page.evaluate(() => {
    const b = document.getElementById('route-bar');
    if (b.hidden) return null;
    return [...b.querySelectorAll('button')].filter(x => !x.hidden && x.offsetParent).map(x => x.textContent);
  });
  check('no bar with nothing selected', (await bar()) === null);
  await press(`#routes-layer [data-id="${A.id}"] .route-hit`);
  check('selecting option A shows Label, Order, Delete (no Make main)', eq(await bar(), ['Label', 'Order', 'Delete']), JSON.stringify(await bar()));
  const clearOfHandles = async () => {
    const b = await rect('#route-bar');
    const hs = await page.$$eval('#handles-layer .handle-hit', els => els.map(e => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }));
    const wrap = await rect('.pitch-wrap');
    return { ok: hs.length === 3 && hs.every(h => !overlaps(b, h)) && inside(b, wrap), b, hs };
  };
  let clear = await clearOfHandles();
  check('the bar sits by the route, clear of its handles', clear.ok, JSON.stringify(clear));
  const near = await page.evaluate(id => {
    const b = document.getElementById('route-bar').getBoundingClientRect();
    const l = document.querySelector(`#routes-layer [data-id="${id}"] .route-hit`).getBoundingClientRect();
    return Math.max(0, b.top - l.bottom, l.top - b.bottom, b.left - l.right, l.left - b.right);
  }, A.id);
  check('... and next to it (within 60 px)', near < 60, String(near));
  await page.screenshot({ path: path.join(OUT, 'route-bar.png') });
  await press(`#routes-layer [data-id="${B.id}"] .route-hit`);
  check('option B also gets Make main', eq(await bar(), ['Label', 'Make main', 'Order', 'Delete']), JSON.stringify(await bar()));
  clear = await clearOfHandles();
  check('B\'s bar is clear of its handles too', clear.ok, JSON.stringify(clear));
  await click(page, '[data-route-action="label"]');
  check('Label opens the option box on the label field', (await dialogOpen()) && (await page.evaluate(() => document.activeElement?.id)) === 'option-label');
  await page.keyboard.type('if 13 bites');
  await page.keyboard.press('Enter');
  await sleep(100);
  check('... and saves the label', (await routesNow()).find(r => r.id === B.id).optionLabel === 'if 13 bites');
  await press(`#routes-layer [data-id="${B.id}"] .route-hit`);
  await click(page, '[data-route-action="order"]');
  check('Order on an option opens the option box on the order field', (await dialogOpen()) && (await page.evaluate(() => document.activeElement?.id)) === 'option-order');
  await closeOption();
  await press(`#routes-layer [data-id="${B.id}"] .route-hit`);
  await click(page, '[data-route-action="main"]');
  s = await state(page);
  check('Make main makes B the main option', s.phases[0].routes.find(r => r.id === B.id).option === 'A' && s.phases[0].routes.find(r => r.id === A.id).option === 'B');
  await click(page, '[data-action="undo"]');
  check('... one undo step', (await routesNow()).find(r => r.id === A.id).option === 'A');
  // A run: Order and Delete only; Order opens the number box.
  await selectPlayer('a3');
  await click(page, '[data-route="run"]');
  await tap(page, 60, 50);
  await click(page, '[data-route="run"]');
  const runR = (await routesNow()).find(r => r.type === 'run');
  await press(`#routes-layer [data-id="${runR.id}"] .route-hit`);
  check('a run gets Order and Delete', eq(await bar(), ['Order', 'Delete']), JSON.stringify(await bar()));
  await click(page, '[data-route-action="order"]');
  const box = await page.$eval('#inline-edit', i => (i.hidden ? null : { numeric: i.classList.contains('numeric'), focused: document.activeElement === i }));
  check('Order on a run opens the number box', box?.numeric && box.focused, JSON.stringify(box));
  await page.keyboard.press('Escape');
  await press(`#routes-layer [data-id="${runR.id}"] .route-hit`);
  await click(page, '[data-route-action="delete"]');
  check('Delete removes the route', !(await routesNow()).some(r => r.id === runR.id) && (await bar()) === null);
  await press(`#routes-layer [data-id="${A.id}"] .route-hit`);
  await click(page, '[data-route="pass"]');
  check('turning a route tool on hides the bar', (await bar()) === null);
  await page.keyboard.press('Escape');
  check('the tips mention the bar', (await page.$eval('#tips', t => t.textContent)).includes('Make main'));

  // --- 4. Passes and kicks above the players ---
  check('pass/kick lines in a layer above the players, below balls and badges', await page.evaluate(() => {
    const ids = [...document.getElementById('world').children].map(g => g.id);
    const at = id => ids.indexOf(id);
    return at('routes-layer') < at('players-layer') && at('players-layer') < at('ball-routes-layer') && at('ball-routes-layer') < at('ball-layer') && at('ball-layer') < at('badges-layer');
  }));
  check('a pass is drawn in the upper layer, its touch line under the players', await page.evaluate(id => !!document.querySelector(`#ball-routes-layer [data-id="${id}"] path.route-casing`) && !!document.querySelector(`#routes-layer [data-id="${id}"] .route-hit`) && !document.querySelector(`#routes-layer [data-id="${id}"] .route-casing`), A.id));

  // --- 3. Kicks: thicker, bigger dots, dark outline ---
  const kick = await page.$eval(`#ball-routes-layer [data-id="${C.id}"]`, g => {
    const [casing, line] = g.querySelectorAll('path');
    return { w: Number(line.getAttribute('stroke-width')), dash: line.getAttribute('stroke-dasharray'), cap: line.getAttribute('stroke-linecap'), casing: casing.getAttribute('class'), cw: Number(casing.getAttribute('stroke-width')), color: line.getAttribute('stroke') };
  });
  check('kick line is thicker with bigger dots, orange, with the dark outline', kick.w >= 0.45 && kick.cap === 'round' && /^0\.01 /.test(kick.dash) && kick.color === '#ffa033' && kick.casing === 'route-casing' && kick.cw > kick.w, JSON.stringify(kick));

  // Exports: the option label is at least as large as the player numbers.
  const exportPics = async (file, image) => {
    for (const f of fs.readdirSync(dl)) fs.rmSync(path.join(dl, f));
    await page.evaluate(() => { window.__svgs.length = 0; });
    await click(page, `[data-file="${file}"]`);
    if (image) await click(page, `[data-image="${image}"]`);
    await waitFile(dl, file === 'pdf' ? '.pdf' : '.png');
    return svgs(page);
  };
  const labelSizes = xml => page.evaluate(xml => {
    const root = new DOMParser().parseFromString(xml, 'image/svg+xml').documentElement;
    const sizes = sel => [...root.querySelectorAll(sel)].map(t => Number(t.getAttribute('font-size')));
    return { labels: sizes('.option-label'), players: sizes('.player text'), kickW: [...root.querySelectorAll('[stroke="#ffa033"]')].map(p => Number(p.getAttribute('stroke-width'))) };
  }, xml);
  for (const [file, image] of [['png', 'phase'], ['pdf', null]]) {
    const pics = await exportPics(file, image);
    const z = await labelSizes(pics.map(noCss).find(p => p.includes('option-label')) ?? '<svg/>');
    check(`${file.toUpperCase()}: option labels at least as large as player numbers, kicks thick`, z.labels.length === 1 && z.labels[0] >= Math.max(...z.players) && z.kickW.some(w => w >= 0.45), JSON.stringify(z));
  }

  // --- 7d. Ghost: only option A ---
  await click(page, '[data-phase="add"]');
  const ghost = await page.evaluate(() => ({
    paths: document.querySelectorAll('#ghost-layer .ghost-routes path').length,
    labels: document.querySelectorAll('#ghost-layer .option-label').length,
  }));
  check('previous-phase ghost shows only option A of each player (2 routes, no B label)', ghost.paths === 4 && ghost.labels === 0, JSON.stringify(ghost));
  await click(page, '[data-action="undo"]');

  // --- 4. A lineout throw drawn as a pass shows over the forwards ---
  await click(page, '#templates-button');
  await page.waitForSelector('.template-card');
  await page.$eval('.template-card[data-template="4"]', b => b.click());
  await sleep(50);
  await page.keyboard.press('Escape');
  await tool(page, 'pass');
  await drag(page, [39.5, 1.2], [38.8, 13.7]); // hooker down the line to 6, over 1, 4 and 3
  await tool(page, null);
  await page.keyboard.press('Escape');
  const throwPass = (await routesNow()).find(r => r.type === 'pass');
  check('lineout: a pass from the hooker down the line', throwPass?.from === 'a2' && throwPass.to === 'a6', JSON.stringify(throwPass));
  // Inside 1's disc, the picture changes when the pass's layer is hidden: the pass is drawn over the player.
  const disc = await rect('#players-layer [data-id="a1"] .body');
  const clip = { x: disc.cx - disc.w * 0.35, y: disc.cy - disc.h * 0.35, width: disc.w * 0.7, height: disc.h * 0.7 };
  const shownPx = await page.screenshot({ clip });
  await page.$eval('#ball-routes-layer', g => { g.style.visibility = 'hidden'; });
  const hiddenPx = await page.screenshot({ clip });
  await page.$eval('#ball-routes-layer', g => { g.style.visibility = ''; });
  check('lineout: the throw is visible over the forwards\' discs', !Buffer.from(shownPx).equals(Buffer.from(hiddenPx)));
  await page.screenshot({ path: path.join(OUT, 'lineout-throw.png') });

  // --- 5. Title rename selects the whole name ---
  const nameBox = await rect('#play-name');
  await page.mouse.click(nameBox.cx, nameBox.cy);
  await page.keyboard.type('Blindside');
  check('clicking the title selects it all: typing replaces the name', (await state(page)).name === 'Blindside', (await state(page)).name);
  await page.$eval('#play-name', i => i.blur());
  // The pencil opens Play details (category and tags) and leaves the name as it is.
  const pencil = await rect('.title-pencil');
  await page.mouse.click(pencil.cx, pencil.cy);
  check('clicking the pencil opens Play details and leaves the name alone', (await page.$eval('#play-details', p => p.matches(':popover-open'))) && (await state(page)).name === 'Blindside');
  await page.keyboard.press('Escape');
  await page.mouse.click(nameBox.cx, nameBox.cy);
  await page.keyboard.type('Wide');
  check('…and clicking the name again selects it all', (await state(page)).name === 'Wide', (await state(page)).name);
  await page.$eval('#play-name', i => i.blur());

  // --- 6. Nothing covers the pitch ---
  const pitchBefore = await rect('#pitch');
  await click(page, '[data-file="save"]'); // a "Saved" message still showing gives way to the hint
  await tool(page, 'run');
  const hintBox = await rect('#draw-hint');
  const pitchAfter = await rect('#pitch');
  check('the drawing hint is shown off the pitch', hintBox.w > 0 && !overlaps(hintBox, pitchBefore) && inside(hintBox, await rect('#statusbar')), JSON.stringify([hintBox, pitchBefore]));
  check('showing the hint does not resize the pitch', eq(pitchBefore, pitchAfter), JSON.stringify([pitchBefore, pitchAfter]));
  await tool(page, null);
  await page.evaluate(() => { document.getElementById('toast').hidden = true; });
  await click(page, '[data-file="save"]');
  const toastBox = await rect('#toast');
  check('the "Saved" message is shown off the pitch', toastBox.w > 0 && !overlaps(toastBox, pitchBefore) && (await page.$eval('#toast', t => t.textContent)) === 'Saved Wide.json', JSON.stringify(toastBox));

  // --- 7a. Save PDF says "Saved <file>" like the images ---
  for (const f of fs.readdirSync(dl)) fs.rmSync(path.join(dl, f));
  await click(page, '[data-file="pdf"]');
  const making = await page.$eval('#toast', t => (t.hidden ? null : t.textContent));
  await waitFile(dl, '.pdf');
  await page.waitForFunction(() => document.getElementById('toast').textContent.startsWith('Saved'), { timeout: 15000 }).catch(() => null);
  check('Save PDF: "Making the PDF…", then "Saved Wide.pdf" in the status line', making === 'Making the PDF…' && (await page.$eval('#toast', t => (t.hidden ? null : t.textContent))) === 'Saved Wide.pdf', making);

  // --- 7b. Tips popup ---
  check('tips start closed', !(await page.$eval('#tips', t => t.matches(':popover-open'))));
  const playersBefore = await rect('.toolbar .group');
  await page.click('#help');
  const tipsBox = await rect('#tips');
  const helpBox = await rect('#help');
  check('"? Tips" opens a small popup beside the button', (await page.$eval('#tips', t => t.matches(':popover-open'))) && tipsBox.left >= helpBox.right && Math.abs(tipsBox.top - helpBox.top) < 4, JSON.stringify([tipsBox, helpBox]));
  check('... which doesn\'t push the toolbar down', eq(await rect('.toolbar .group'), playersBefore));
  await page.keyboard.press('Escape');
  check('Escape closes the tips', !(await page.$eval('#tips', t => t.matches(':popover-open'))));
  await page.click('#help');
  const empty = await toScreen(page, 90, 66);
  await page.mouse.click(empty.x, empty.y);
  check('clicking away closes the tips', !(await page.$eval('#tips', t => t.matches(':popover-open'))));

  // --- 7c. The note keeps its width with many phases; long notes wrap ---
  for (let i = 0; i < 29; i++) await click(page, '[data-phase="add"]');
  const bar7 = await page.evaluate(() => {
    const note = document.getElementById('phase-note').getBoundingClientRect();
    const tabs = document.getElementById('phase-tabs');
    const cur = tabs.querySelector('[aria-current="step"]').getBoundingClientRect();
    const t = tabs.getBoundingClientRect();
    return { phases: tabs.children.length, noteW: note.width, noteRight: note.right, scrolls: tabs.scrollWidth > tabs.clientWidth, curShown: cur.left >= t.left - 1 && cur.right <= t.right + 1, vw: innerWidth };
  });
  check('30 phases: the note keeps a usable width, tabs scroll sideways', bar7.phases === 30 && bar7.noteW >= 250 && bar7.noteRight <= bar7.vw && bar7.scrolls && bar7.curShown, JSON.stringify(bar7));
  // The note box keeps one height: a long note wraps (two lines show) and scrolls inside, so the pitch never moves.
  const longNote = 'Twelve hits the line hard, thirteen loops round the back and fifteen comes in at pace on the short side. ';
  const noteBefore = { note: await rect('#phase-note'), pitch: await rect('#pitch') };
  await page.$eval('#phase-note', (t, v) => { t.focus(); t.value = v; t.dispatchEvent(new Event('input')); }, longNote.repeat(4));
  const fit = await page.$eval('#phase-note', t => ({ sh: t.scrollHeight, ch: t.clientHeight, sw: t.scrollWidth, cw: t.clientWidth, line: parseFloat(getComputedStyle(t).lineHeight), overflow: getComputedStyle(t).overflowY }));
  check('a long note wraps (two lines show) and scrolls inside the box', fit.sw <= fit.cw && fit.sh > fit.ch && fit.ch >= 2 * fit.line - 1 && fit.overflow === 'auto', JSON.stringify(fit));
  check('…and the note box and the pitch keep their size', eq(await rect('#phase-note'), noteBefore.note) && eq(await rect('#pitch'), noteBefore.pitch), JSON.stringify([noteBefore, await rect('#phase-note')]));
  await page.$eval('#phase-note', t => t.blur());

  check('second fixes: no console errors or native dialogs', errors.length === 0, errors.join(' | '));
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

  for (let i = 0; i < 3; i++) await addPlayer(page, 'attack', { touch: true });
  await drag(page, [44, 9.3], [50, 15], { touch: true });
  let s = await state(page);
  check('touch drag player', Math.hypot(s.phases[0].positions.a2.x - 50, s.phases[0].positions.a2.y - 15) < 0.3, JSON.stringify(s.phases[0].positions.a2));
  // Rename by double tap: the in-app box, no prompt.
  await page.keyboard.press('Escape');
  await sleep(450);
  const a3 = (await state(page)).phases[0].positions.a3;
  await tap(page, a3.x, a3.y, { touch: true });
  await tap(page, a3.x, a3.y, { touch: true });
  const phoneBox = await page.$eval('#inline-edit', i => (i.hidden ? null : { value: i.value, r: i.getBoundingClientRect().right, focused: document.activeElement === i }));
  check('phone: double tap opens the rename box on screen', phoneBox?.value === '3' && phoneBox.focused && phoneBox.r <= 390, JSON.stringify(phoneBox));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape'); // the first Escape cancels the rename, the second clears the selection
  await page.tap('[data-action="add-defense"]');
  await page.waitForSelector('#number-dialog[open]');
  const pickBox = await page.$eval('#number-dialog', d => { const r = d.getBoundingClientRect(); return { l: r.left, r: r.right }; });
  check('phone: number picker in the middle of the screen', pickBox.l > 0 && pickBox.r < 390 && Math.abs((pickBox.l + pickBox.r) / 2 - 195) < 4, JSON.stringify(pickBox));
  await page.keyboard.press('Escape');
  await page.tap('[data-route="pass"]');
  await drag(page, [44.5, 5.5], [51, 16], { touch: true });
  s = await state(page);
  const pass = s.phases[0].routes[0];
  check('touch-drawn pass attaches both ends', pass?.from === 'a1' && pass?.to === 'a2', JSON.stringify(pass));
  const offPitch = await page.evaluate(() => {
    const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width }; };
    const p = box(document.getElementById('pitch'));
    const h = box(document.getElementById('draw-hint'));
    return { shown: !document.getElementById('draw-hint').hidden && h.w > 0, clear: h.top >= p.bottom || h.bottom <= p.top, fits: h.right <= innerWidth, p, h };
  });
  check('phone: the drawing hint is under the pitch, not on it', offPitch.shown && offPitch.clear && offPitch.fits, JSON.stringify(offPitch));
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
  await page.waitForFunction(() => document.getElementById('toast').textContent.startsWith('Saved'), { timeout: 5000 }).catch(() => null);
  const phoneToast = await page.evaluate(() => {
    const t = document.getElementById('toast').getBoundingClientRect();
    const p = document.getElementById('pitch').getBoundingClientRect();
    return { shown: !document.getElementById('toast').hidden && t.width > 0, clear: t.top >= p.bottom || t.bottom <= p.top, right: t.right };
  });
  check('phone: the "Saved" message is under the pitch, not on it', phoneToast.shown && phoneToast.clear && phoneToast.right <= 390, JSON.stringify(phoneToast));
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
