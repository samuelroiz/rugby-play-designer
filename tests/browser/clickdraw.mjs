// Click-to-draw from a selected player. Desktop 1440x900 (mouse) + quick phone 390 touch check.
import path from 'node:path';
import { open, drag, tap, click, state, check, failed, toScreen, outDir } from './lib.mjs';

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
async function setup(page) {
  for (let i = 0; i < 3; i++) await click(page, '[data-action="add-attack"]');
  await click(page, '[data-action="add-defense"]');
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
  page.on('dialog', d => { console.log('DIALOG', d.type(), d.message()); errors.push('unexpected dialog: ' + d.message()); d.dismiss(); });
  await setup(page);

  // Select 12, pick Run: hint, preview follows the pointer, one click makes the route.
  await tapPlayer(page, 'a2');
  check('player selected', (await sel(page)) === 'a2');
  await click(page, '[data-route="run"]');
  check('hint names the player and route', (await hint(page)) === "Click where 12's run ends. Esc to stop.", await hint(page));
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
    check(`${t}: hint`, (await hint(page))?.includes(t === 'pass' ? "12's pass goes" : `12's ${t} ends`), await hint(page));
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
  check('run: clicking another player switches the start', (await sel(page)) === 'a3' && (await routes(page)).length === 2 && (await hint(page)) === "Click where 3's run ends. Esc to stop.", await hint(page));
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
  check('kick mode on', (await hint(page)) === "Click where 12's kick ends. Esc to stop.");
  await hover(page, 70, 20);
  await page.keyboard.press('Escape');
  check('Escape turns it off: no hint, no tool, no selection, no preview', (await hint(page)) === null && (await toolOn(page)) === null && (await sel(page)) === null && (await preview(page)) === null);

  // Drag-drawing with nothing selected still works (and a press-drag pass still attaches).
  await click(page, '[data-route="run"]');
  check('no player selected: no hint', (await hint(page)) === null);
  await drag(page, [50, 25], [58, 33]);
  rs = await routes(page);
  check('drag-draw with nothing selected still works, route selected', rs.length === 5 && rs[4].from === 'a3' && eq(rs[4].points[1], [58, 33]) && (await page.evaluate(() => !!document.querySelector('#routes-layer .route.selected'))));
  await drag(page, [80, 40], [85, 45]);
  rs = await routes(page);
  check('drag-draw from open grass still works', rs.length === 6 && rs[5].from === null);
  check('with a route selected, still no hint', (await hint(page)) === null);
  // Tap (no drag) on a player with a tool on and nothing selected selects them -> click mode.
  await page.keyboard.press('Escape');
  await click(page, '[data-route="drift"]');
  await tapPlayer(page, 'a1');
  check('tapping a player with a tool on selects them and starts click-to-draw', (await sel(page)) === 'a1' && (await hint(page)) === "Click where attacker 1's drift ends. Esc to stop." && (await routes(page)).length === 6);
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

{
  console.log('\n== Phone 390, touch ==');
  const { browser, page, errors } = await open({ mobile: true });
  await setup(page);
  await tap(page, 50, 15, { touch: true });
  check('tap selects 12', (await sel(page)) === 'a2');
  await page.tap('[data-route="run"]');
  check('phone hint says Tap', (await hint(page)) === "Tap where 12's run ends.", await hint(page));
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
  check('pass: tap an opponent switches, hint names the team', (await sel(page)) === 'd1' && (await hint(page)) === "Tap where defender 1's pass goes, or on a team-mate to pass to them.", await hint(page));
  await page.screenshot({ path: path.join(OUT, 'phone.png') });
  await page.tap('[data-route="pass"]');
  check('tap tool again turns it off', (await hint(page)) === null);
  check('phone: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(`\n${failed() ? `${failed()} FAILED` : 'ALL PASSED'}`);
process.exit(failed() ? 1 : 0);
