// Fixes from the usability review: pitch size, player size, decoys, the legend under the pitch, the pen's
// colours, set pieces and players placed by a click, the half views, badge hover, route order defaults,
// "End of play", and the sidebar fitting. Desktop first (1080 and 1500 px wide), then a 390px phone.
import fs from 'node:fs';
import { open, addPlayer, placeSetPiece, tap, drag, click, state, shown, check, failed, outDir, stored } from './lib.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rect = (page, sel) => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height }; });
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const hint = page => page.$eval('#draw-hint', h => (h.hidden ? null : h.textContent));
const toast = page => page.$eval('#toast', t => (t.hidden ? null : t.textContent));
const routes = async page => (await state(page)).phases[await shown(page)].routes;
const pos = async (page, id) => (await state(page)).phases[await shown(page)].positions[id];
const view = page => page.evaluate(() => window.playState.view);
const viewBox = page => page.$eval('#pitch', s => s.getAttribute('viewBox'));
// Selects a player by tapping their disc (a short wait so two taps never count as a double-click).
const tapPlayer = async (page, id) => { const p = await pos(page, id); await sleep(450); await tap(page, p.x, p.y); };
const draw = async (page, type, from, to) => {
  await tapPlayer(page, from);
  await click(page, `[data-route="${type}"]`);
  await tap(page, ...to);
  await page.keyboard.press('Escape');
};
// Taps an element by dispatching a press and release on it (as a finger would, without hover).
const press = (page, sel) => page.evaluate(sel => {
  const el = document.querySelector(sel);
  const r = el.getBoundingClientRect();
  const at = { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true, isPrimary: true, button: 0, pointerId: 1, pointerType: 'touch' };
  el.dispatchEvent(new PointerEvent('pointerdown', at));
  document.getElementById('pitch').dispatchEvent(new PointerEvent('pointerup', at));
}, sel);

// --- 1. The pitch fills the space; 12. the sidebar fits ---
// "Before" is measured by putting back the old spacing (paddings, the status line's height, the phase bar
// on three rows under 1100 px) and taking the legend out of the layout, as it used to float over the pitch.
const OLD_LAYOUT = `
  .topbar { padding: .5rem .75rem !important; }
  .pitch-wrap { padding: .5rem !important; }
  .statusbar { height: 2.1rem !important; }
  .statusbar .legend { display: none !important; }
  .phasebar { padding: .5rem .75rem !important; gap: .5rem 1rem !important; }
  @media (max-width: 1100px) {
    .phasebar .long { display: inline !important; }
    .phase-tools { flex-wrap: wrap !important; }
    #phase-note { flex-basis: 100% !important; }
  }`;
const pitchSize = page => page.evaluate(() => {
  const p = document.getElementById('pitch').getBoundingClientRect();
  const w = document.querySelector('.pitch-wrap').getBoundingClientRect();
  return { w: Math.round(p.width), h: Math.round(p.height), wrapW: Math.round(w.width), wrapH: Math.round(w.height) };
});
for (const [width, height] of [[1080, 720], [1500, 780]]) {
  console.log(`\n== Layout at ${width}x${height} ==`);
  const { browser, page, errors } = await open();
  await page.setViewport({ width, height });
  await addPlayer(page, 'attack');
  await sleep(100);
  const style = await page.addStyleTag({ content: OLD_LAYOUT });
  await sleep(50);
  const before = await pitchSize(page);
  await style.evaluate(s => s.remove());
  await sleep(50);
  const after = await pitchSize(page);
  console.log(`   pitch before ${before.w}x${before.h}, after ${after.w}x${after.h}`);
  check(`${width}x${height}: the pitch is bigger than with the old spacing (${before.w}x${before.h} -> ${after.w}x${after.h})`, after.w > before.w && after.h > before.h, JSON.stringify([before, after]));
  check(`${width}x${height}: the pitch fills its area edge to edge in one direction`, after.wrapW - after.w <= 10 || after.wrapH - after.h <= 10, JSON.stringify(after));
  const bar = await rect(page, '.phasebar');
  check(`${width}x${height}: the phase bar takes ${width < 1100 ? 'at most two rows' : 'one row'}`, bar.h <= (width < 1100 ? 96 : 52), JSON.stringify(bar));
  for (const o of ['horizontal', 'vertical']) {
    await click(page, `[data-orientation="${o}"]`);
    const m = await pitchSize(page);
    check(`${width}x${height} ${o}: still edge to edge`, m.wrapW - m.w <= 10 || m.wrapH - m.h <= 10, JSON.stringify(m));
  }
  await click(page, '[data-orientation="horizontal"]');
  if (width === 1500) {
    const side = await page.evaluate(() => {
      const t = document.querySelector('.toolbar');
      const box = sel => { const r = document.querySelector(sel).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
      return {
        scroll: t.scrollHeight - t.clientHeight, inner: innerHeight,
        del: box('[data-action="delete"]').bottom, blitz: box('[data-route="blitz"]').bottom,
        run: box('[data-route="run"]'), pass: box('[data-route="pass"]'), decoy: box('[data-route="decoy"]'),
      };
    });
    check('1500x780: the sidebar fits without scrolling', side.scroll <= 0, JSON.stringify(side));
    check('…Delete and Blitz are visible', side.del <= side.inner && side.blitz <= side.inner, JSON.stringify(side));
    check('…route types in two columns', Math.abs(side.run.top - side.pass.top) < 2 && side.pass.left > side.run.right - 1 && side.decoy.top > side.run.bottom - 1, JSON.stringify(side));
  }
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== Player size, decoys, legend (desktop) ==');
  const dl = outDir('usability');
  const { browser, page, errors } = await open({ downloads: dl });
  await page.evaluate(() => {
    window.__svgs = [];
    const orig = XMLSerializer.prototype.serializeToString;
    XMLSerializer.prototype.serializeToString = function (n) { const s = orig.call(this, n); window.__svgs.push(s); return s; };
  });
  await addPlayer(page, 'attack', { n: 9, at: [40, 30] });
  await addPlayer(page, 'attack', { n: 10, at: [45, 38] });
  await addPlayer(page, 'attack', { n: 12, at: [40, 45] });
  await draw(page, 'pass', 'a9', [45, 38]);
  await draw(page, 'decoy', 'a12', [52, 50]);

  // --- 2. Player size ---
  const sizes = () => page.evaluate(() => ({
    body: Number(document.querySelector('#players-layer [data-id="a9"] .body').getAttribute('r')),
    text: Number(document.querySelector('#players-layer [data-id="a9"] text').getAttribute('font-size')),
    badge: Number(document.querySelector('#badges-layer .badge circle').getAttribute('r')),
  }));
  const medium = await sizes();
  check('Medium is the default: discs 1.2 m, numbers 1.2, badges 0.9', eq(medium, { body: 1.2, text: 1.2, badge: 0.9 }) && (await page.$eval('[name="player-size"][value="medium"]', r => r.checked)), JSON.stringify(medium));
  const before = { play: await state(page), undo: await page.$eval('[data-action="undo"]', b => b.disabled) };
  await sleep(600);
  const autosaveBefore = await stored(page);
  await page.click('#layers summary');
  await page.click('[name="player-size"][value="large"]');
  const large = await sizes();
  check('Large scales discs, numbers and badges by 1.2', Math.abs(large.body - 1.44) < 1e-9 && Math.abs(large.text - 1.44) < 1e-9 && Math.abs(large.badge - 1.08) < 1e-9, JSON.stringify(large));
  await sleep(600);
  check('…a setting of this browser: not in the play, the undo history or the autosave',
    eq(await state(page), before.play) && (await page.$eval('[data-action="undo"]', b => b.disabled)) === before.undo
    && (await stored(page)) === autosaveBefore
    && (await page.evaluate(() => localStorage.getItem('rugby-play-designer.player-size'))) === 'large');
  await page.click('[name="player-size"][value="small"]');
  const small = await sizes();
  check('Small scales them by 0.8', Math.abs(small.body - 0.96) < 1e-9 && Math.abs(small.badge - 0.72) < 1e-9, JSON.stringify(small));
  await page.click('[name="player-size"][value="large"]');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__svgs.length = 0; });
  await click(page, '[data-file="png"]');
  await click(page, '[data-image="phase"]');
  await page.waitForFunction(() => window.__svgs.length > 0, { timeout: 10000 });
  await sleep(300);
  const picture = await page.evaluate(() => window.__svgs.at(-1));
  check('the PNG uses the size on screen (Large)', /r="1\.44" class="body"/.test(picture) && !/r="1\.2" class="body"/.test(picture));
  await page.reload();
  await page.waitForSelector('#phase-tabs button');
  check('…and it is kept after a reload', (await sizes()).body === 1.44 && (await page.$eval('[name="player-size"][value="large"]', r => r.checked)));
  await page.click('#layers summary');
  await page.click('[name="player-size"][value="medium"]');
  await page.keyboard.press('Escape');

  // --- 3. Decoys ---
  const decoy = await page.evaluate(() => {
    const id = window.playState.phases[0].routes.find(r => r.type === 'decoy').id;
    const paths = document.querySelectorAll(`#routes-layer [data-id="${id}"] path:not(.route-hit)`);
    const run = document.querySelector('[data-route="run"] .route-sample line:not(.route-casing)');
    return {
      casing: paths[0].getAttribute('class'), casingStroke: getComputedStyle(paths[0]).stroke, casingW: Number(paths[0].getAttribute('stroke-width')),
      color: paths[1].getAttribute('stroke'), w: Number(paths[1].getAttribute('stroke-width')), runW: Number(run.getAttribute('stroke-width')),
    };
  });
  const lightness = hex => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) + ((n >> 8) & 255) + (n & 255)) / 3; };
  check('decoy: lighter grey than before, thicker, with the same dark outline as other routes',
    decoy.color === '#d4d4d4' && lightness(decoy.color) > lightness('#b8b8b8') && decoy.w > 0.2 && decoy.w >= decoy.runW
    && decoy.casing === 'route-casing' && decoy.casingStroke === 'rgba(0, 0, 0, 0.4)' && Math.abs(decoy.casingW - decoy.w - 0.16) < 1e-9, JSON.stringify(decoy));

  // --- 4. Legend under the pitch, every view and orientation ---
  for (const v of ['full', 'half']) {
    for (const o of ['horizontal', 'vertical']) {
      await click(page, `[data-view="${v}"]`);
      await click(page, `[data-orientation="${o}"]`);
      const [legend, pitch] = [await rect(page, '#legend'), await rect(page, '#pitch')];
      check(`legend under the pitch, never over it (${v}, ${o})`, legend.h > 0 && legend.top >= pitch.bottom - 0.5 && !overlaps(legend, pitch), JSON.stringify([legend, pitch]));
    }
  }
  await click(page, '[data-view="full"]');
  await click(page, '[data-orientation="horizontal"]');
  await click(page, '#present-button');
  await sleep(100);
  check('Present mode: no legend', await page.$eval('#legend', l => getComputedStyle(l).display === 'none'));

  // --- 5. Pen colours, Undo stroke ---
  const visible = sel => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && r.width > 0; });
  check('Present mode: three pen colours and Undo stroke', (await visible('.pen-colours')) && (await page.$$('[data-pen-colour]')).length === 3 && (await visible('[data-play="undo-stroke"]')));
  const stroke = async (from, to) => { await drag(page, from, to); await sleep(50); };
  const marks = () => page.$$eval('#pen-layer .pen-mark', ms => ms.map(m => ({ cls: m.getAttribute('class'), line: getComputedStyle(m.querySelector('.pen-stroke')).stroke, edge: getComputedStyle(m.querySelector('.pen-outline')).stroke })));
  await click(page, '[data-pen-colour="magenta"]');
  check('picking a colour picks up the pen', await page.evaluate(() => window.rugbyPresent.pen) && (await page.$eval('[data-pen-colour="magenta"]', b => b.getAttribute('aria-pressed'))) === 'true');
  await stroke([20, 20], [30, 25]);
  await click(page, '[data-pen-colour="cyan"]');
  await stroke([20, 40], [30, 45]);
  await click(page, '[data-pen-colour="black"]');
  await stroke([20, 50], [30, 55]);
  let m = await marks();
  const routeAndTeam = ['#ffe14d', '#ffffff', '#ffa033', '#d4d4d4', '#cfa6ff', '#ff8fd0', '#d32f2f', '#1565c0'].map(hex => {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
  });
  check('magenta, cyan and black strokes, each with a contrasting outline',
    eq(m.map(x => x.cls), ['pen-mark magenta', 'pen-mark cyan', 'pen-mark black'])
    && eq(m.map(x => x.line), ['rgb(230, 0, 230)', 'rgb(0, 229, 255)', 'rgb(0, 0, 0)'])
    && eq(m.map(x => x.edge), ['rgb(255, 255, 255)', 'rgb(29, 29, 29)', 'rgb(255, 255, 255)']), JSON.stringify(m));
  check('no pen colour is a route or team colour', ['rgb(230, 0, 230)', 'rgb(0, 229, 255)', 'rgb(0, 0, 0)'].every(c => !routeAndTeam.includes(c)));
  await click(page, '[data-play="undo-stroke"]');
  check('Undo stroke takes back the last stroke', eq((await marks()).map(x => x.cls), ['pen-mark magenta', 'pen-mark cyan']));
  await page.keyboard.press('z');
  check('Z (pen on) takes back another', eq((await marks()).map(x => x.cls), ['pen-mark magenta']));
  await page.keyboard.press('c');
  check('C still clears', (await marks()).length === 0);
  await click(page, '[data-play="exit"]');
  check('no console errors', errors.length === 0, errors.join(' | '));
  fs.rmSync(dl, { recursive: true, force: true });
  await browser.close();
}

{
  console.log('\n== Set pieces and players placed by a click ==');
  const { browser, page, errors } = await open();
  // --- 11. Adding players ---
  await click(page, '[data-phase="add"]');
  await click(page, '#phase-tabs [data-index="0"]');
  await click(page, '[data-action="add-attack"]');
  await page.waitForSelector('#number-dialog[open]');
  await click(page, '#number-grid [data-n="12"]');
  check('picking 12: "Click where 12 stands", nobody added yet', (await hint(page))?.startsWith('Click where 12 stands') && (await state(page)).players.length === 0, await hint(page));
  await tap(page, 30, 40);
  let s = await state(page);
  check('…one click places them there, in every phase', s.players.some(p => p.id === 'a12') && s.phases.every(ph => eq(ph.positions.a12, { x: 30, y: 40 })) && (await hint(page)) === null, JSON.stringify(s.phases.map(ph => ph.positions.a12)));
  await click(page, '[data-action="undo"]');
  check('placing is one undo step', !(await state(page)).players.some(p => p.id === 'a12'));
  await click(page, '[data-action="redo"]');
  await click(page, '[data-action="add-attack"]');
  await page.waitForSelector('#number-dialog[open]');
  await page.keyboard.press('Enter');
  check('Enter picks the highlighted number, then waits for a click', (await hint(page))?.startsWith('Click where 1 stands'), await hint(page));
  await tap(page, 35, 20);
  check('…and the click places them', eq(await pos(page, 'a1'), { x: 35, y: 20 }));
  await addPlayer(page, 'defense', { n: 3 }); // Escape
  check('Escape places them at the usual spot', eq(await pos(page, 'd3'), { x: 56, y: 13.6 }));
  // A defender on attack 13's usual spot (44, 56.6): attack 13 goes next to them, not on top.
  await addPlayer(page, 'defense', { n: 13, at: [44, 56.6] });
  await addPlayer(page, 'attack', { n: 13 });
  const a13 = await pos(page, 'a13');
  check('a usual spot taken by another player: the new one goes beside them', Math.hypot(a13.x - 44, a13.y - 56.6) >= 2.7 && Math.hypot(a13.x - 44, a13.y - 56.6) < 8, JSON.stringify(a13));
  // Defense 15's usual spot (56, 65.2) touches the direction arrow.
  await addPlayer(page, 'defense', { n: 15 });
  const d15 = await pos(page, 'd15');
  const arrow = await page.evaluate(() => { const b = document.querySelector('#pitch-layer .direction').getBBox(); return { minX: b.x, maxX: b.x + b.width, minY: b.y, maxY: b.y + b.height }; });
  // The disc, with a little room, must not touch the arrow or its "Attack" word.
  const onArrow = (p, r = 1.5) => p.x + r > arrow.minX && p.x - r < arrow.maxX && p.y + r > arrow.minY && p.y - r < arrow.maxY;
  check('a usual spot next to the direction arrow: the new player goes clear of it', !eq(d15, { x: 56, y: 65.2 }) && !onArrow(d15), JSON.stringify([d15, arrow]));
  const all = Object.entries((await state(page)).phases[0].positions);
  check('no two players on top of each other', all.every(([a, p]) => all.every(([b, q]) => a === b || Math.hypot(p.x - q.x, p.y - q.y) >= 2.4)), JSON.stringify(all));

  // --- 6. Set pieces: click where the mark goes, one ball, Escape cancels ---
  await click(page, '[data-object="ball"]');
  const ballBefore = (await state(page)).phases[0].objects.find(o => o.type === 'ball');
  const beforeScrum = await state(page);
  await click(page, '[data-action="set-piece"]');
  await page.click('#set-piece-dialog button[value="scrum-attack"]');
  await sleep(50);
  check('Scrum: "Click where the mark goes", nothing placed yet', (await hint(page))?.startsWith('Click where the mark goes') && eq(await state(page), beforeScrum), await hint(page));
  await page.keyboard.press('Escape');
  check('Escape cancels it', (await hint(page)) === null && eq(await state(page), beforeScrum));
  await placeSetPiece(page, 'scrum-attack', [30, 19]);
  s = await state(page);
  let ph = s.phases[0];
  const scrum = ph.objects.find(o => o.type === 'scrum');
  check('the scrum goes where clicked, snapped to the nearest mark (15 m line)', scrum && scrum.x === 30 && scrum.y === 15, JSON.stringify(scrum));
  const balls = ph.objects.filter(o => o.type === 'ball');
  check('…reusing the phase\'s ball (moved to the put-in), not a second one', balls.length === 1 && balls[0].id === ballBefore.id && Math.hypot(balls[0].x - 30, balls[0].y - 15) < 6, JSON.stringify(balls));
  await placeSetPiece(page, 'lineout-defense', [60, 61]);
  ph = (await state(page)).phases[0];
  const lo = ph.objects.find(o => o.type === 'lineout');
  check('the lineout goes where clicked, on the 5 m line of the nearer touchline', lo && lo.x === 60 && lo.y === 65, JSON.stringify(lo));
  check('…still one ball, at the thrower', ph.objects.filter(o => o.type === 'ball').length === 1 && ph.objects.find(o => o.type === 'ball').y > 66);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== Half pitch ==');
  const { browser, page, errors } = await open();
  for (const [n, x] of [[1, 10], [2, 20], [3, 30]]) await addPlayer(page, 'attack', { n, at: [x, 20 + n * 5] });
  await addPlayer(page, 'defense', { n: 1, at: [80, 30] });
  await click(page, '[data-view="half"]');
  check('Half shows the half where most players are (-10 to 50)', (await view(page)) === 'half-own' && (await viewBox(page)) === '-10 0 60 70', `${await view(page)} ${await viewBox(page)}`);
  let arrows = await page.$$eval('#edge-layer .edge-arrow', gs => gs.map(g => ({ id: g.dataset.edge, t: g.getAttribute('transform'), label: g.textContent })));
  check('…a player off it gets an arrow at the edge pointing to them', eq(arrows.map(a => a.id), ['d1']) && arrows[0].t === 'translate(48.7 30)' && arrows[0].label === '1', JSON.stringify(arrows));
  check('the other-half toggle shows', !(await page.$eval('#flip-half', b => b.hidden)));
  await click(page, '#flip-half');
  check('the toggle flips to 50 to 110', (await view(page)) === 'half' && (await viewBox(page)) === '50 0 60 70');
  arrows = await page.$$eval('#edge-layer .edge-arrow', gs => gs.map(g => g.dataset.edge));
  check('…with arrows for the three now off it', eq(arrows.sort(), ['a1', 'a2', 'a3']), arrows.join());
  await click(page, '[data-action="undo"]');
  check('the half is kept in the play\'s view (one undo step)', (await view(page)) === 'half-own');
  await click(page, '[data-action="redo"]');
  await sleep(600);
  await page.reload();
  await page.waitForSelector('#phase-tabs button');
  check('…and after a reload', (await view(page)) === 'half' && (await viewBox(page)) === '50 0 60 70');
  await click(page, '[data-orientation="vertical"]');
  check('vertical: the same half', (await viewBox(page)) === '0 -110 70 60');
  await click(page, '[data-orientation="horizontal"]');
  await click(page, '[data-view="full"]');
  check('Full: no toggle, no arrows', (await page.$eval('#flip-half', b => b.hidden)) && (await page.$$('#edge-layer .edge-arrow')).length === 0);
  // Most players in the other half.
  for (const [n, x] of [[4, 70], [5, 75], [6, 85]]) await addPlayer(page, 'defense', { n, at: [x, 40] });
  await click(page, '[data-view="half"]');
  check('Half with most players beyond halfway: 50 to 110', (await view(page)) === 'half');
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== Badges, route order, End of play ==');
  const { browser, page, errors } = await open();
  await addPlayer(page, 'attack', { n: 9, at: [40, 30] });
  await addPlayer(page, 'attack', { n: 10, at: [46, 38] });
  await addPlayer(page, 'attack', { n: 12, at: [40, 48] });
  await addPlayer(page, 'attack', { n: 13, at: [44, 58] });

  // --- 9. Route order defaults ---
  await draw(page, 'pass', 'a9', [46, 38]);
  await tapPlayer(page, 'a12');
  await click(page, '[data-route="run"]');
  await tap(page, 55, 46);
  let rs = await routes(page);
  check('a pass is step 1; a run drawn next moves with it (step 1)', eq(rs.map(r => [r.type, r.order]), [['pass', 1], ['run', 1]]), JSON.stringify(rs));
  check('the hint says so', (await toast(page)) === 'Runs with step 1. Change the number to run before or after.', await toast(page));
  await page.keyboard.press('Escape');
  await draw(page, 'kick', 'a10', [75, 35]);
  await draw(page, 'drift', 'a13', [52, 62]);
  rs = await routes(page);
  check('a kick is the next step (2); a drift drawn next moves with it (2)', eq(rs.map(r => [r.type, r.order]), [['pass', 1], ['run', 1], ['kick', 2], ['drift', 2]]), JSON.stringify(rs));
  const run = rs.find(r => r.type === 'run');
  await press(page, `#routes-layer [data-id="${run.id}"] .route-hit`);
  await sleep(50);
  const stepText = await page.$eval('#route-step', s => (s.hidden ? null : s.textContent));
  check('the route bar: "Step 1, together with: pass 9 to 10"', stepText === 'Step 1, together with: pass 9 to 10', stepText);
  await page.keyboard.press('Escape');

  // --- 8. Badge hover ---
  const pass = rs.find(r => r.type === 'pass');
  const badge = await rect(page, `#badges-layer [data-id="${run.id}"] circle`);
  await page.mouse.move(badge.left + badge.w / 2, badge.top + badge.h / 2);
  await sleep(50);
  const lit = () => page.evaluate(({ run, pass }) => ({
    on: document.getElementById('pitch').classList.contains('route-hovering'),
    halo: !!document.querySelector(`#routes-layer [data-id="${run}"] .route-hover`),
    other: Number(getComputedStyle(document.querySelector(`#ball-routes-layer [data-id="${pass}"]`)).opacity),
    own: Number(getComputedStyle(document.querySelector(`#routes-layer [data-id="${run}"]`)).opacity),
  }), { run: run.id, pass: pass.id });
  let l = await lit();
  check('hovering a badge highlights its route and fades the others', l.on && l.halo && l.other < 0.5 && l.own === 1, JSON.stringify(l));
  const undoState = await page.$eval('[data-action="undo"]', b => b.disabled);
  await page.mouse.move(5, 5);
  await sleep(50);
  l = await lit();
  check('…until the pointer leaves', !l.on && !l.halo && l.other === 1, JSON.stringify(l));
  check('…and hovering records nothing', (await page.$eval('[data-action="undo"]', b => b.disabled)) === undoState);
  await press(page, `#badges-layer [data-id="${run.id}"] circle`);
  await sleep(50);
  l = await lit();
  check('tapping a badge (touch) highlights its route while its number is edited', l.on && l.halo && !(await page.$eval('#inline-edit', i => i.hidden)), JSON.stringify(l));
  await page.keyboard.press('Escape');
  await sleep(50);
  check('…and the highlight goes when the edit closes', !(await lit()).on);

  // --- 10. End of play ---
  await click(page, '[data-phase="add"]');
  await click(page, '#phase-tabs [data-index="0"]');
  await page.evaluate(() => { window.rugbyPlayback.timeScale = 0; });
  const end = () => page.$eval('#end-of-play', e => (e.hidden ? null : e.textContent));
  const playToEnd = async () => {
    await page.keyboard.press('Space');
    await page.evaluate(() => { for (let i = 0; i < 400; i++) window.rugbyPlayback.advance(100); });
    await sleep(50);
  };
  check('no "End of play" before playing', (await end()) === null);
  await playToEnd();
  check('the last phase finished: "End of play" and Replay in the status line', (await end()) === 'End of playReplay' && (await shown(page)) === 1, await end());
  await click(page, '#replay-button');
  check('Replay plays again from phase 1, and the message goes', (await page.evaluate(() => window.rugbyPlayback.playing)) && (await shown(page)) === 0 && (await end()) === null);
  await page.evaluate(() => { for (let i = 0; i < 400; i++) window.rugbyPlayback.advance(100); });
  check('it comes back at the end', (await end()) !== null);
  await click(page, '#phase-tabs [data-index="0"]');
  check('changing phase clears it', (await end()) === null);
  await playToEnd();
  const p12 = await pos(page, 'a12');
  await drag(page, [p12.x, p12.y], [p12.x + 2, p12.y + 2]);
  check('an edit clears it', (await end()) === null);
  await click(page, '#phase-tabs [data-index="0"]');
  await playToEnd();
  check('(at the end again)', (await end()) !== null);
  await page.keyboard.press('Space');
  check('Play clears it', (await end()) === null && (await page.evaluate(() => window.rugbyPlayback.playing)));
  await page.evaluate(() => window.rugbyPlayback.stop());
  await page.evaluate(() => { window.rugbyPlayback.setLoop(true); });
  await click(page, '#phase-tabs [data-index="0"]');
  await playToEnd();
  check('with Loop on there is no end', (await end()) === null);
  await page.evaluate(() => window.rugbyPlayback.stop());
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== Phone (390px) ==');
  const { browser, page, errors } = await open({ mobile: true });
  await addPlayer(page, 'attack', { touch: true, at: [40, 30] });
  const a1 = await pos(page, 'a1');
  // A finger lands on whole pixels, so allow a few centimetres.
  check('phone: a tap places the picked player', a1 && Math.hypot(a1.x - 40, a1.y - 30) < 0.4, JSON.stringify(a1));
  const [legend, pitch] = [await rect(page, '#legend'), await rect(page, '#pitch')];
  check('phone: the legend is under the pitch, on screen', legend.top >= pitch.bottom - 0.5 && legend.right <= 390, JSON.stringify([legend, pitch]));
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check('phone: nothing wider than the screen', fits);
  check('phone: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(`\n${failed() ? `${failed()} FAILED` : 'ALL PASSED'}`);
process.exit(failed() ? 1 : 0);
