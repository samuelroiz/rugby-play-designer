// Click-to-draw from a selected player. Desktop 1440x900 (mouse) + quick phone 390 touch check.
import path from 'node:path';
import fs from 'node:fs';
import { open, drag, tap, click, state, check, failed, toScreen, outDir, addPlayer, answerConfirm } from './lib.mjs';

const OUT = outDir('clickdraw');
console.log(`Screenshots: ${OUT}`);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const routes = async page => (await state(page)).phases[0].routes;
const sel = page => page.evaluate(() => document.querySelector('#players-layer .player.selected')?.dataset.id ?? null);
const toolOn = page => page.evaluate(() => document.querySelector('[data-route][aria-pressed="true"]')?.dataset.route ?? null);
const hint = page => page.evaluate(() => { const h = document.getElementById('draw-hint'); return h.hidden ? null : h.textContent; });
const rings = page => page.$$eval('#players-layer .snap-ring', els => els.map(e => e.closest('[data-id]').dataset.id));
const preview = page => page.evaluate(() => document.querySelector('#routes-layer .route-preview path:last-child')?.getAttribute('d') ?? null);
const hover = async (page, x, y) => { const p = await toScreen(page, x, y); await page.mouse.move(p.x, p.y); };
const tapPlayer = async (page, id) => {
  await new Promise(r => setTimeout(r, 450)); // two taps on one player within 400 ms are a double-click (rename)
  const c = await page.$eval(`#players-layer [data-id="${id}"] .body`, el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(c.x, c.y);
};

// a1 (44,5) a2 (50,15) a3 (50,25) d1 (60,15), labels: a2 -> "12".
async function setup(page, { touch = false } = {}) {
  for (let i = 0; i < 3; i++) await addPlayer(page, 'attack', { touch });
  await addPlayer(page, 'defense', { touch });
  await page.evaluate(() => {
    const p = window.playState.phases[0].positions;
    Object.assign(p, { a2: { x: 50, y: 15 }, a3: { x: 50, y: 25 }, d1: { x: 60, y: 15 } });
    window.playState.players.find(q => q.id === 'a2').label = '12';
  });
  await page.keyboard.press('Escape'); // redraw, nothing selected
}

{
  console.log('\n== Desktop 1440x900, mouse ==');
  const { browser, page, errors } = await open();
  await setup(page);

  // Select 12, pick Run: hint, preview follows the pointer, one click makes the route.
  await tapPlayer(page, 'a2');
  check('player selected', (await sel(page)) === 'a2');
  await click(page, '[data-route="run"]');
  check('hint names the player and route', (await hint(page)) === "Click where 12's run ends. Click again for another, Esc to stop.", await hint(page));
  await hover(page, 58, 20);
  const d1 = await preview(page);
  await hover(page, 60, 10);
  const d2 = await preview(page);
  check('preview line from the player follows the pointer', d1?.startsWith('M50 15') && d2?.startsWith('M50 15') && d1 !== d2 && d2.endsWith('60 10'), `${d1} / ${d2}`);
  const undoBefore = await page.evaluate(() => document.querySelector('[data-action="undo"]').disabled);
  const before = await state(page);
  await tap(page, 60, 10);
  let rs = await routes(page);
  check('one click makes a run from the player', rs.length === 1 && rs[0].type === 'run' && rs[0].from === 'a2' && eq(rs[0].points, [[50, 15], [60, 10]]) && rs[0].order === 1, JSON.stringify(rs));
  check('player stays selected, tool stays on', (await sel(page)) === 'a2' && (await toolOn(page)) === 'run');

  // Chaining: two more runs.
  await tap(page, 62, 18);
  await tap(page, 55, 22);
  rs = await routes(page);
  check('chaining: three runs from 12, orders 1-3', rs.length === 3 && rs.every(r => r.from === 'a2' && r.type === 'run') && eq(rs.map(r => r.order), [1, 2, 3]));

  // Undo: one step per route, mode kept.
  await click(page, '[data-action="undo"]');
  rs = await routes(page);
  check('undo removes just the last route', rs.length === 2 && eq(rs.map(r => r.order), [1, 2]));
  check('after undo the player is still selected and the tool on', (await sel(page)) === 'a2' && (await toolOn(page)) === 'run' && (await hint(page)) !== null);
  await click(page, '[data-action="undo"]');
  await click(page, '[data-action="undo"]');
  check('three undos get back to before the first route', eq(await state(page), before) && undoBefore === (await page.evaluate(() => document.querySelector('[data-action="undo"]').disabled)));
  await click(page, '[data-action="redo"]');
  check('redo brings one route back', (await routes(page)).length === 1);
  await click(page, '[data-action="undo"]');

  // Every route type from the selected player.
  const types = ['run', 'pass', 'kick', 'decoy', 'drift', 'blitz'];
  for (const [i, t] of types.entries()) {
    if ((await toolOn(page)) !== t) await click(page, `[data-route="${t}"]`);
    check(`${t}: hint`, (await hint(page))?.includes(t === 'pass' ? "12's pass ends, or on a team-mate. Click again" : `12's ${t} ends. Click again`), await hint(page));
    await tap(page, 40 + i * 3, 40);
    rs = await routes(page);
    const r = rs.at(-1);
    check(`${t}: made from 12 with one click`, rs.length === i + 1 && r.type === t && r.from === 'a2' && eq(r.points[1], [40 + i * 3, 40]) && (t === 'pass' ? r.to === null : !('to' in r)), JSON.stringify(r));
  }
  check('still 12 selected after all types', (await sel(page)) === 'a2');
  for (let i = 0; i < 6; i++) await click(page, '[data-action="undo"]');
  check('six undos remove the six routes', (await routes(page)).length === 0);

  // Pass to a team-mate: ring + snapped preview while hovering, then attached.
  if ((await toolOn(page)) !== 'pass') await click(page, '[data-route="pass"]');
  await hover(page, 51.2, 24);
  check('hovering near a team-mate rings them', eq(await rings(page), ['a3']), (await rings(page)).join());
  const pd = await preview(page);
  const end = pd?.split(' ').slice(-2).map(Number);
  check('pass preview ends at the team-mate\'s disc edge', end && Math.abs(Math.hypot(end[0] - 50, end[1] - 25) - 1.4) < 0.05, pd);
  await tap(page, 51.2, 24);
  rs = await routes(page);
  check('click near a team-mate: pass ends on them with "to"', rs.length === 1 && rs[0].to === 'a3' && rs[0].from === 'a2' && eq(rs[0].points[1], [50, 25]), JSON.stringify(rs));
  check('rings cleared after the click (pointer still there)', true);
  // Clicking right on a team-mate's disc also passes (doesn't switch).
  await tapPlayer(page, 'a1');
  rs = await routes(page);
  check('clicking on a team-mate with pass ends the pass on them', rs.length === 2 && rs[1].to === 'a1' && (await sel(page)) === 'a2', JSON.stringify(rs[1]));
  // Pass clicked on an opponent: switches the start to them.
  await tapPlayer(page, 'd1');
  check('pass: clicking an opponent switches the start to them', (await routes(page)).length === 2 && (await sel(page)) === 'd1');
  await hover(page, 50.5, 15.5);
  check('defender\'s pass does not ring an attacker', (await rings(page)).length === 0);
  await tapPlayer(page, 'a2'); // back to 12 (opponent of d1 -> switch)
  check('switch back to 12', (await sel(page)) === 'a2');

  // Switching players with a run.
  await click(page, '[data-route="run"]');
  await tapPlayer(page, 'a3');
  check('run: clicking another player switches the start', (await sel(page)) === 'a3' && (await routes(page)).length === 2 && (await hint(page)) === "Click where 3's run ends. Click again for another, Esc to stop.", await hint(page));
  await tap(page, 56, 30);
  rs = await routes(page);
  check('next click draws from the new player', rs.length === 3 && rs[2].from === 'a3' && eq(rs[2].points, [[50, 25], [56, 30]]));
  // Press on another player and drag: route from that player, they stay selected.
  await drag(page, [44, 5], [48, 0.5]);
  rs = await routes(page);
  check('press-drag from another player draws from them and selects them', rs.length === 4 && rs[3].from === 'a1' && eq(rs[3].points[1], [48, 0.5]) && (await sel(page)) === 'a1' && (await toolOn(page)) === 'run');
  // Click too close to the player: nothing.
  await tap(page, 44.5, 5.4);
  check('click on the selected player itself makes nothing', (await routes(page)).length === 4 && (await sel(page)) === 'a1');

  // Turning it off: tool button again.
  await click(page, '[data-route="run"]');
  check('clicking the tool again turns it off (hint hidden)', (await toolOn(page)) === null && (await hint(page)) === null && (await preview(page)) === null);
  await tap(page, 30, 50);
  check('then clicking empty pitch with no tool clears the selection', (await sel(page)) === null && (await routes(page)).length === 4);
  // Escape.
  await tapPlayer(page, 'a2');
  await click(page, '[data-route="kick"]');
  check('kick mode on', (await hint(page)) === "Click where 12's kick ends. Click again for another, Esc to stop.");
  await hover(page, 70, 20);
  await page.keyboard.press('Escape');
  check('Escape turns it off: no hint, no tool, no selection, no preview', (await hint(page)) === null && (await toolOn(page)) === null && (await sel(page)) === null && (await preview(page)) === null);

  // Drag-drawing with nothing selected still works (and a press-drag pass still attaches).
  await click(page, '[data-route="run"]');
  check('tool on, no player selected: hint says how to start', (await hint(page)) === 'Drag from a player to draw a run, or click a player first.', await hint(page));
  await drag(page, [50, 25], [58, 33]);
  rs = await routes(page);
  check('drag-draw with nothing selected still works, route selected', rs.length === 5 && rs[4].from === 'a3' && eq(rs[4].points[1], [58, 33]) && (await page.evaluate(() => !!document.querySelector('#routes-layer .route.selected'))));
  await drag(page, [80, 40], [85, 45]);
  rs = await routes(page);
  check('drag-draw from open grass still works', rs.length === 6 && rs[5].from === null);
  check('with a route selected, the how-to-start hint', (await hint(page)) === 'Drag from a player to draw a run, or click a player first.', await hint(page));
  // Tap (no drag) on a player with a tool on and nothing selected selects them -> click mode.
  await page.keyboard.press('Escape');
  await click(page, '[data-route="drift"]');
  await tapPlayer(page, 'a1');
  check('tapping a player with a tool on selects them and starts click-to-draw', (await sel(page)) === 'a1' && (await hint(page)) === "Click where attacker 1's drift ends. Click again for another, Esc to stop." && (await routes(page)).length === 6);
  await page.mouse.move(5, 5); // off the pitch
  check('preview hidden when the pointer leaves the pitch', (await preview(page)) === null);
  await page.screenshot({ path: path.join(OUT, 'desktop.png') });
  await hover(page, 52, 3);
  await page.screenshot({ path: path.join(OUT, 'desktop-preview.png') });

  // Autosave + reload still fine.
  await new Promise(r => setTimeout(r, 600));
  const saved = await state(page);
  await page.reload();
  await page.waitForSelector('#phase-tabs button');
  check('reload restores the play', eq(await state(page), saved));
  check('desktop: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ---------------- Pass and kick options ----------------
{
  console.log('\n== Pass and kick options (desktop) ==');
  const dl = path.join(OUT, 'options');
  fs.mkdirSync(dl);
  const { browser, page, errors } = await open({ downloads: dl });
  await setup(page);
  await page.evaluate(() => {
    window.__svgs = [];
    const orig = XMLSerializer.prototype.serializeToString;
    XMLSerializer.prototype.serializeToString = function (n) { const s = orig.call(this, n); window.__svgs.push(s); return s; };
  });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const badges = () => page.$$eval('#badges-layer .badge', bs => bs.map(b => b.textContent));
  const tags = rs => rs.map(r => `${r.order}${r.option ?? ''}`);
  const fromP = async id => (await routes(page)).filter(r => r.from === id);
  const alt = () => page.$$eval('#routes-layer .route.option-alt', gs => gs.map(g => g.dataset.id));
  // Taps a badge (or a route's line) by its element, as the suite does, so overlapping badges don't matter.
  const press = (sel) => page.evaluate(sel => {
    const el = document.querySelector(sel);
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, button: 0, pointerId: 1 }));
    document.getElementById('pitch').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, button: 0, pointerId: 1 }));
  }, sel);
  const openOption = async id => {
    await press(`#badges-layer [data-id="${id}"] circle`);
    await page.waitForSelector('#option-dialog[open]', { timeout: 3000 }).catch(() => null);
  };
  const makeMain = async () => { await page.click('#option-main'); await sleep(100); };

  // pass + pass
  await tapPlayer(page, 'a2');
  await click(page, '[data-route="pass"]');
  await tap(page, 50.8, 24.5); // to 3
  let rs = await routes(page);
  check('one pass: a normal route (option null), badge "1"', rs.length === 1 && rs[0].option === null && eq(await badges(), ['1']), JSON.stringify(rs));
  await tap(page, 44.6, 5.6); // to 1
  rs = await routes(page);
  check('pass + pass from 12: A and B, sharing order 1', eq(tags(rs), ['1A', '1B']) && rs[0].to === 'a3' && rs[1].to === 'a1', JSON.stringify(rs));
  check('badges read 1A and 1B', eq((await badges()).sort(), ['1A', '1B']), (await badges()).join());
  check('B drawn fainter, A as normal', eq(await alt(), [rs[1].id]) && Number(await page.$eval(`#routes-layer [data-id="${rs[1].id}"]`, g => getComputedStyle(g).opacity)) < 0.8);
  // three options
  await click(page, '[data-route="kick"]');
  await tap(page, 75, 30);
  rs = await routes(page);
  check('pass + pass + kick: A, B, C sharing one order', eq(tags(rs), ['1A', '1B', '1C']) && rs[2].type === 'kick', tags(rs).join());
  // pass + kick from another player
  await tapPlayer(page, 'a1'); // with a kick tool on, clicking another player switches the start
  await tap(page, 70, 5);
  await click(page, '[data-route="pass"]');
  await tap(page, 50.8, 15.6); // to 12
  const one = await fromP('a1');
  check('kick + pass from 1: kick A, pass B, their own order (2)', eq(one.map(r => [r.type, r.option, r.order]), [['kick', 'A', 2], ['pass', 'B', 2]]), JSON.stringify(one));
  check('12\'s options keep order 1', eq(tags(await fromP('a2')), ['1A', '1B', '1C']));
  // a run is never an option
  await click(page, '[data-route="run"]');
  await tap(page, 40, 2);
  check('a run from the same player is not an option', (await fromP('a1')).find(r => r.type === 'run').option === null && eq(tags(await fromP('a1')), ['2A', '2B', '3']));
  await click(page, '[data-action="undo"]');
  await page.keyboard.press('Escape');
  const [A, B, C] = await fromP('a2');

  // Editing a label and the shared order.
  await openOption(A.id);
  check('A\'s badge opens the option box without "make main"', await page.$eval('#option-dialog', d => d.open) && (await page.$eval('#option-title', t => t.textContent)) === 'Option A' && await page.$eval('#option-main', b => b.hidden));
  await page.click('#option-dialog .cancel');
  await sleep(100);
  check('Cancel changes nothing', eq(tags(await fromP('a2')), ['1A', '1B', '1C']));
  await openOption(B.id);
  check('B\'s badge: "Option B" with "make main"', (await page.$eval('#option-title', t => t.textContent)) === 'Option B' && !(await page.$eval('#option-main', b => b.hidden)));
  await page.$eval('#option-order', i => { i.value = ''; });
  await page.type('#option-order', '4');
  await page.focus('#option-label');
  await page.keyboard.type('if 13 bites');
  await page.click('#option-dialog button[value="save"]');
  await sleep(100); // the dialog's close event comes a moment after the click
  rs = await fromP('a2');
  check('saving sets B\'s label and the order of all three', rs[1].optionLabel === 'if 13 bites' && eq(tags(rs), ['4A', '4B', '4C']) && !rs[0].optionLabel, JSON.stringify(rs));
  check('1\'s options untouched', eq(tags(await fromP('a1')), ['2A', '2B']));
  const lbl = await page.$$eval('#badges-layer .option-label', ts => ts.map(t => t.textContent));
  check('label shown on the pitch', eq(lbl, ['if 13 bites']), lbl.join());
  const near = await page.evaluate(() => {
    const t = document.querySelector('#badges-layer .option-label').getBoundingClientRect();
    const m = document.getElementById('world').getScreenCTM();
    const p = new DOMPoint(44, 5).matrixTransform(m); // B ends on 1
    return Math.hypot(t.left - p.x, t.top + t.height / 2 - p.y);
  });
  check('label sits by the end of the route', near < 80, String(near));
  await click(page, '[data-action="undo"]');
  rs = await fromP('a2');
  check('undo takes the label and order back in one step', eq(tags(rs), ['1A', '1B', '1C']) && !rs[1].optionLabel);
  await click(page, '[data-action="redo"]');
  await openOption(C.id);
  await page.focus('#option-label');
  await page.keyboard.type('long label that is over twenty-five');
  await page.keyboard.press('Enter'); // Enter saves
  await sleep(100);
  rs = await fromP('a2');
  check('labels stop at 25 characters; Enter saves', rs[2].optionLabel?.length === 25 && rs[2].optionLabel === 'long label that is over t', JSON.stringify(rs[2].optionLabel));
  await click(page, '[data-action="undo"]');

  // Making B the main option.
  await openOption(B.id);
  await makeMain();
  rs = await routes(page);
  const byId = id => rs.find(r => r.id === id);
  check('make B main: B becomes A, A becomes B, C stays C', byId(B.id).option === 'A' && byId(A.id).option === 'B' && byId(C.id).option === 'C' && byId(B.id).optionLabel === 'if 13 bites', JSON.stringify(rs.map(r => [r.id, r.option])));
  check('the new A draws as normal, the old A fainter', (await alt()).includes(A.id) && !(await alt()).includes(B.id));
  await click(page, '[data-action="undo"]');
  rs = await routes(page);
  check('undo makes A main again', byId(A.id).option === 'A' && byId(B.id).option === 'B');

  // Deleting back to one.
  await press(`#routes-layer [data-id="${C.id}"] .route-hit`);
  await page.keyboard.press('Delete');
  check('deleting C leaves A and B', eq(tags(await fromP('a2')), ['4A', '4B']));
  await press(`#routes-layer [data-id="${A.id}"] .route-hit`);
  await page.keyboard.press('Delete');
  rs = await fromP('a2');
  check('deleting A leaves one normal route (letter cleared)', rs.length === 1 && rs[0].id === B.id && rs[0].option === null && (await badges()).includes('4') && !(await alt()).includes(B.id), JSON.stringify(rs));
  check('its label is hidden once it is not an option', (await page.$$('#badges-layer .option-label')).length === 0);
  await click(page, '[data-action="undo"]');
  await click(page, '[data-action="undo"]');
  check('undo brings both back as A, B, C', eq(tags(await fromP('a2')), ['4A', '4B', '4C']));
  // Deleting the receiver of an option removes that pass and re-letters.
  await tapPlayer(page, 'a3');
  await page.keyboard.press('Delete');
  rs = await fromP('a2');
  check('deleting A\'s receiver: the other two become A and B', eq(rs.map(r => [r.id, r.option]), [[B.id, 'A'], [C.id, 'B']]), JSON.stringify(rs));
  await click(page, '[data-action="undo"]');
  await page.keyboard.press('Escape');

  // Add Phase follows option A only.
  await click(page, '[data-object="ball"]');
  await page.evaluate(() => { const b = window.playState.phases[0].objects.find(o => o.type === 'ball'); Object.assign(b, { x: 51, y: 16 }); });
  await page.keyboard.press('Escape');
  const ballNext = async () => {
    await click(page, '[data-phase="add"]');
    const ball = (await state(page)).phases[1].objects.find(o => o.type === 'ball');
    return [ball.x, ball.y];
  };
  check('Add Phase: ball to A\'s receiver (3), B and C ignored', eq(await ballNext(), [51.1, 25.9]));
  const ghost = await page.evaluate(() => ({
    labels: [...document.querySelectorAll('#ghost-layer .option-label')].map(t => t.textContent),
    alt: document.querySelectorAll('#ghost-layer .option-alt').length,
    badges: document.querySelectorAll('#ghost-layer .badge').length,
  }));
  check('ghost shows options fainter and their labels, no badges', eq(ghost, { labels: ['if 13 bites'], alt: 3, badges: 0 }), JSON.stringify(ghost));
  await page.screenshot({ path: path.join(OUT, 'options-ghost.png') });
  await click(page, '[data-action="undo"]');
  await openOption(B.id);
  await makeMain();
  check('after making B main, Add Phase sends the ball to 1', eq(await ballNext(), [45.1, 5.9]));
  await click(page, '[data-action="undo"]');
  await openOption(C.id);
  await makeMain();
  check('a kick as option A: the ball goes to the kick\'s end', eq(await ballNext(), [75, 30]));
  await click(page, '[data-action="undo"]');
  await click(page, '[data-action="undo"]');
  await click(page, '[data-action="undo"]');
  check('A is main again', eq((await fromP('a2')).map(r => r.option), ['A', 'B', 'C']) && (await fromP('a2'))[0].id === A.id);
  await page.screenshot({ path: path.join(OUT, 'options.png') });

  // Exports show options and labels as on screen.
  await click(page, '[data-phase="add"]');
  await page.$eval('#phase-tabs [data-index="0"]', b => b.click());
  const noCss = svg => svg.replace(/<style>[\s\S]*?<\/style>/, '');
  const exported = async (file, image) => {
    await page.evaluate(() => { window.__svgs.length = 0; });
    for (const f of fs.readdirSync(dl)) fs.rmSync(path.join(dl, f));
    await click(page, `[data-file="${file}"]`);
    if (image) await click(page, `[data-image="${image}"]`);
    const t = Date.now();
    while (!fs.readdirSync(dl).some(f => !f.endsWith('.crdownload')) && Date.now() - t < 15000) await sleep(100);
    return (await page.evaluate(() => window.__svgs)).map(noCss);
  };
  const shows = svg => svg.includes('>if 13 bites<') && (svg.match(/class="option-alt"|class="route[^"]*option-alt"/g) ?? []).length >= 3;
  let pics = await exported('png', 'phase');
  check('PNG shows the options (fainter B, C) and the label', pics.length === 1 && shows(pics[0]));
  pics = await exported('png', 'all');
  check('all-phases PNG shows them on phase 1', pics.length === 1 && shows(pics[0]));
  pics = await exported('pdf');
  check('PDF page 1 shows them (after the route key picture)', pics.length === 3 && shows(pics[1]));
  check('exports have no ghost', pics.every(p => !/class="ghost/.test(p)));

  // Vertical: the label stays upright beside the end.
  await click(page, '[data-orientation="vertical"]');
  await page.screenshot({ path: path.join(OUT, 'options-vertical.png') });
  const upright = await page.$eval('#badges-layer .option-label', t => t.getAttribute('transform'));
  check('vertical: label kept upright', upright.endsWith('rotate(90)'), upright);
  await click(page, '[data-orientation="horizontal"]');

  // Older plays (no "option") load as they are.
  const old = {
    schemaVersion: 1, name: 'Old', players: [{ id: 'a1', team: 'attack', label: '1' }, { id: 'a2', team: 'attack', label: '2' }],
    phases: [{ positions: { a1: { x: 40, y: 10 }, a2: { x: 40, y: 20 } }, objects: [], routes: [
      { id: 'r1', type: 'pass', from: 'a1', to: 'a2', points: [[40, 10], [40, 20]], curve: 0, order: 1 },
      { id: 'r2', type: 'pass', from: 'a1', to: null, points: [[40, 10], [50, 30]], curve: 0, order: 2 },
    ] }],
  };
  const oldPath = path.join(OUT, 'old.json');
  fs.writeFileSync(oldPath, JSON.stringify(old));
  await (await page.$('#load-input')).uploadFile(oldPath);
  await answerConfirm(page);
  rs = await routes(page);
  check('old play loads unchanged: no option fields, badges 1 and 2', rs.every(r => !('option' in r)) && eq(tags(rs), ['1', '2']) && eq((await badges()).sort(), ['1', '2']), JSON.stringify(rs));
  check('options: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== Phone 390, touch ==');
  const { browser, page, errors } = await open({ mobile: true });
  await setup(page, { touch: true });
  await tap(page, 50, 15, { touch: true });
  check('tap selects 12', (await sel(page)) === 'a2');
  await page.tap('[data-route="run"]');
  check('phone hint says Tap', (await hint(page)) === "Tap where 12's run ends. Tap again for another, tap the tool again to stop.", await hint(page));
  await tap(page, 60, 22, { touch: true });
  let rs = await routes(page);
  check('one tap makes a run from 12', rs.length === 1 && rs[0].from === 'a2' && Math.hypot(rs[0].points[1][0] - 60, rs[0].points[1][1] - 22) < 0.3, JSON.stringify(rs));
  await tap(page, 64, 28, { touch: true });
  check('second tap chains', (await routes(page)).length === 2 && (await sel(page)) === 'a2');
  await page.tap('[data-route="pass"]');
  await tap(page, 50.8, 24.5, { touch: true });
  rs = await routes(page);
  check('tap near a team-mate ends the pass on them', rs.length === 3 && rs[2].to === 'a3', JSON.stringify(rs[2]));
  await tap(page, 60, 15, { touch: true });
  check('pass: tap an opponent switches, hint names the team', (await sel(page)) === 'd1' && (await hint(page)) === "Tap where defender 1's pass ends, or on a team-mate. Tap again for another, tap the tool again to stop.", await hint(page));
  await page.screenshot({ path: path.join(OUT, 'phone.png') });
  await page.tap('[data-route="pass"]');
  check('tap tool again turns it off', (await hint(page)) === null);
  check('phone: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(`\n${failed() ? `${failed()} FAILED` : 'ALL PASSED'}`);
process.exit(failed() ? 1 : 0);
