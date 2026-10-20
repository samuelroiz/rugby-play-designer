// Fixes from a test session. Desktop 1440x900 unless said otherwise.
// 1. Typing in the phase note (or any text box) during playback stops the play and keeps what's typed.
// 2. A pass at a later step is drawn from where the passer is then (on screen, in the ghost, PNG and PDF).
// 3. A pop pass to a runner meets him on his run: in the animation and where the arrow ends.
// 4. A second run from a player carries on from the end of the first, as the next step.
// 5. Half views show 5 m past halfway, so kick-off players on halfway are on the pitch.
// 6. Polish: numbers above route lines, the Attack label clear of players, the header (long names, the
//    Other half slot), the File menu (Escape, a short window), Play details, the L block's tooltip, the
//    note's fixed height, hints never cut off.
import fs from 'node:fs';
import { open, click, state, check, failed, outDir, tap, drag, toScreen, placeSetPiece } from './lib.mjs';

const OUT = outDir('session');
console.log(`Downloads: ${OUT}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (p, q, tol) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;
const P = (x, y) => ({ x, y });
const players = ids => ids.map(id => ({ id, team: id[0] === 'a' ? 'attack' : 'defense', label: id.slice(1) }));
const R = (id, type, from, points, order, extra = {}) => ({ id, type, from, to: null, points, curve: 0, order, option: null, ...extra });
const play = (phases, extra = {}) => ({
  schemaVersion: 1, name: 'Session', category: 'attack', tags: [], view: 'full', orientation: 'horizontal',
  players: players(['a8', 'a10', 'a12', 'd10']), phases, ...extra,
});
const POS = { a8: P(30, 50), a10: P(40, 30), a12: P(38, 40), d10: P(60, 30) };

async function paste(page, p) {
  await page.click('#file-menu summary');
  await page.click('[data-file="paste"]');
  await page.waitForSelector('#paste-dialog[open]');
  await page.$eval('#paste-play-text', (t, text) => { t.value = text; }, JSON.stringify(p));
  await click(page, '#paste-play-import');
  await sleep(150);
}
// The drawn line of a route: its path's d, and its first and last points.
const line = (page, id) => page.evaluate(id => {
  const path = document.querySelector(`#ball-routes-layer [data-id="${id}"] path:last-child, #routes-layer [data-id="${id}"] path:last-child`);
  if (!path) return null;
  const d = path.getAttribute('d');
  const n = d.match(/-?[\d.]+/g).map(Number);
  return { d, start: { x: n[0], y: n[1] }, end: { x: n.at(-2), y: n.at(-1) } };
}, id);
const translate = (page, sel) => page.$eval(sel, g => { const m = g.getAttribute('transform').match(/translate\(([-\d.]+) ([-\d.]+)\)/); return { x: +m[1], y: +m[2] }; });
const rect = (page, sel) => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; });
const inside = (a, b) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.right <= b.right + 1 && a.bottom <= b.bottom + 1;
// The app's own animation rules (the page's copy of animate.js), for phase i of the open play.
const schedule = (page, i = 0) => page.evaluate(async i => {
  const { buildSchedule, frameAt } = await import(new URL('js/animate.js', location.href));
  const s = buildSchedule(window.playState, i);
  const f = s.flights[0];
  const at = t => frameAt(s, t);
  return { flight: f && { start: f.start, end: f.end, release: f.release, catchAt: f.catchAt }, moves: s.moves.map(m => ({ id: m.route.id, start: m.start, end: m.end })), routesEnd: s.routesEnd, atEnd: f && at(f.end), atRoutesEnd: at(s.routesEnd) };
}, i);

{
  console.log('\n== 1. Typing during playback ==');
  const { browser, page, errors } = await open();
  await page.evaluate(() => { window.rugbyPlayback.timeScale = 0; });
  await paste(page, play([
    { note: '', positions: POS, objects: [], routes: [R('r1', 'run', 'a10', [[40, 30], [46, 28]], 1)] },
    { note: '', positions: { ...POS, a10: P(46, 28) }, objects: [], routes: [] },
  ]));
  await click(page, '#play-button');
  await page.evaluate(() => window.rugbyPlayback.advance(1200));
  check('playing', await page.evaluate(() => window.rugbyPlayback.playing));
  check('the note box is not read-only while playing', await page.$eval('#phase-note', t => !t.readOnly && !t.disabled));
  await page.click('#phase-note');
  const after = await page.evaluate(() => ({ playing: rugbyPlayback.playing, paused: rugbyPlayback.paused }));
  check('focusing the note stops the play and drops the paused frame', !after.playing && !after.paused, JSON.stringify(after));
  await page.keyboard.type('Ten runs hard');
  check('…and what is typed is kept in the phase', (await state(page)).phases[0].note === 'Ten runs hard' && (await page.$eval('#phase-note', t => t.value)) === 'Ten runs hard');
  check('…the players are drawn where they stand in the phase', eq(await translate(page, '#players-layer [data-id="a10"]'), P(40, 30)));
  await page.$eval('#phase-note', t => t.blur());

  // Paused mid-route: focusing the note drops the frame, and typing is kept.
  await click(page, '#play-button');
  await page.evaluate(() => window.rugbyPlayback.advance(1500));
  await click(page, '#play-button');
  check('paused mid-route: a frame is on screen', await page.evaluate(() => rugbyPlayback.paused) && !eq(await translate(page, '#players-layer [data-id="a10"]'), P(40, 30)));
  await page.click('#phase-note');
  check('focusing the note drops the paused frame', await page.evaluate(() => !rugbyPlayback.paused && !rugbyPlayback.playing) && eq(await translate(page, '#players-layer [data-id="a10"]'), P(40, 30)));
  await page.keyboard.type(', then passes');
  check('…and typing is kept', (await state(page)).phases[0].note === 'Ten runs hard, then passes', (await state(page)).phases[0].note);
  await page.$eval('#phase-note', t => t.blur());

  // Any text box: the play's name too.
  await click(page, '#play-button');
  await page.evaluate(() => window.rugbyPlayback.advance(600));
  await page.click('#play-name');
  check('focusing the play name while playing stops the play', await page.evaluate(() => !rugbyPlayback.playing && !rugbyPlayback.paused));
  await page.keyboard.type('Crash ball');
  check('…and typing renames the play', (await state(page)).name === 'Crash ball', (await state(page)).name);
  await page.$eval('#play-name', i => i.blur());
  check('typing: no console errors or native dialogs', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== 2. A pass at step 2 is drawn from the passer\'s step-2 spot ==');
  const { browser, page, errors } = await open({ downloads: OUT });
  await page.evaluate(() => {
    window.__svgs = [];
    const orig = XMLSerializer.prototype.serializeToString;
    XMLSerializer.prototype.serializeToString = function (n) { const s = orig.call(this, n); window.__svgs.push(s); return s; };
  });
  // 10 runs (step 1), 12 runs (step 1), then 10 passes to 12 (step 2).
  await paste(page, play([{
    note: 'Step 2 pass', positions: POS, objects: [{ id: 'o1', type: 'ball', x: 41.1, y: 30.9 }],
    routes: [
      R('r1', 'run', 'a10', [[40, 30], [46, 28]], 1),
      R('r2', 'run', 'a12', [[38, 40], [43, 41]], 1),
      R('r3', 'pass', 'a10', [[40, 30], [38, 40]], 2, { to: 'a12' }),
    ],
  }]));
  const pass = await line(page, 'r3');
  check('on screen: the pass starts where 10 is at step 2 (the end of his run)', pass && eq(pass.start, P(46, 28)), pass?.d);
  check('…and ends at 12\'s disc where he catches it (the end of his step-1 run)', pass && Math.abs(Math.hypot(pass.end.x - 43, pass.end.y - 41) - 1.4) < 0.05, pass?.d);
  const run = await line(page, 'r1');
  check('runs still start where the player starts the phase', run && eq(run.start, P(40, 30)), run?.d);
  check('the data is unchanged: the pass is still stored from 10\'s start to 12\'s', eq((await state(page)).phases[0].routes[2].points, [[40, 30], [38, 40]]));

  // The animation uses the same spots.
  const s = await schedule(page);
  check('the animation releases the pass at the same spot', near(s.flight.release, P(46, 28), 1e-6) && near(s.flight.catchAt, P(43, 41), 1e-6), JSON.stringify(s.flight));

  // The ghost of phase 1 on phase 2.
  await click(page, '[data-phase="add"]');
  const ghost = await page.$$eval('#ghost-layer .ghost-routes path:not(.route-casing)', ps => ps.map(p => p.getAttribute('d')));
  check('ghost: the pass starts at (46, 28) too', ghost.some(d => d.startsWith('M46 28')) && ghost.filter(d => d.startsWith('M40 30')).length === 1, ghost.join(' | '));
  await page.$eval('#phase-tabs [data-index="0"]', b => b.click());
  await sleep(50);

  // PNG and PDF: the pictures are drawn by the same code.
  const passInSvg = () => page.evaluate(() => window.__svgs.map(text => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    return doc.querySelector('.route-line[data-id="r3"] path:last-child')?.getAttribute('d') ?? null;
  }).filter(Boolean));
  await page.evaluate(() => { window.__svgs = []; });
  await page.click('#file-menu summary');
  await page.click('[data-file="png"]');
  await page.waitForSelector('#image-dialog[open]');
  await page.click('[data-image="phase"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.startsWith('Saved'), { timeout: 15000 });
  let ds = await passInSvg();
  check('PNG: the pass starts at (46, 28)', ds.length > 0 && ds.every(d => d.startsWith('M46 28')), ds.join(' | '));
  await page.evaluate(() => { window.__svgs = []; document.getElementById('toast').textContent = ''; });
  await page.click('#file-menu summary');
  await page.click('[data-file="pdf"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.startsWith('Saved'), { timeout: 20000 });
  ds = await passInSvg();
  check('PDF: the pass starts at (46, 28)', ds.length > 0 && ds.every(d => d.startsWith('M46 28')), ds.join(' | '));
  check('step-2 pass: no console errors or native dialogs', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== 3. A pop pass meets the runner on his run ==');
  const { browser, page, errors } = await open();
  await page.evaluate(() => { window.rugbyPlayback.timeScale = 0; });
  // 12 runs a long, curved line (step 1); 10 passes to him in the same step, while he's still running.
  await paste(page, play([{
    note: 'Pop pass', positions: POS, objects: [{ id: 'o1', type: 'ball', x: 41.1, y: 30.9 }],
    routes: [
      R('r1', 'run', 'a12', [[38, 40], [56, 44]], 1, { curve: -2 }),
      R('r2', 'pass', 'a10', [[40, 30], [38, 40]], 1, { to: 'a12' }),
    ],
  }]));
  const s = await schedule(page);
  const run = s.moves.find(m => m.id === 'r1');
  const { flight } = s;
  check('the ball arrives while 12 is still running', flight.end > run.start && flight.end < run.end, JSON.stringify({ flight, run }));
  const caught = s.atEnd;
  const ball = caught.objects.o1;
  check('when it arrives the ball is in 12\'s hands', near(ball, { x: caught.players.a12.x + 1.1, y: caught.players.a12.y + 0.9 }, 1e-6), JSON.stringify([ball, caught.players.a12]));
  check('…at the catch point, part way along his run', near(caught.players.a12, flight.catchAt, 1e-6) && Math.hypot(flight.catchAt.x - 38, flight.catchAt.y - 40) > 1 && Math.hypot(flight.catchAt.x - 56, flight.catchAt.y - 44) > 5, JSON.stringify(flight.catchAt));
  // The catch point is on his curved run: as close to it as the samples are to each other.
  const onCurve = await page.evaluate(async c => {
    const { curvePoint } = await import(new URL('js/model.js', location.href));
    const r = window.playState.phases[0].routes[0];
    return Math.min(...Array.from({ length: 2001 }, (_, i) => { const p = curvePoint(r, i / 2000); return Math.hypot(p.x - c.x, p.y - c.y); }));
  }, flight.catchAt);
  check('…which is on his curved run', onCurve < 0.02, String(onCurve));
  // The flight takes the pass's time over that distance (the ball and the runner meet; the ball doesn't chase).
  const dist = Math.hypot(flight.catchAt.x - flight.release.x, flight.catchAt.y - flight.release.y);
  check('the flight lasts as long as the pass takes over that distance (9 m/s, at least 0.9 s)', Math.abs((flight.end - flight.start) - Math.max(900, dist / 9 * 1000)) < 2, JSON.stringify({ ms: flight.end - flight.start, dist }));
  check('after the catch 12 carries on with the ball', near(s.atRoutesEnd.objects.o1, { x: 56 + 1.1, y: 44 + 0.9 }, 1e-6), JSON.stringify(s.atRoutesEnd.objects.o1));

  // The arrow ends there.
  const pass = await line(page, 'r2');
  check('the pass arrow ends at the catch point (at the edge of 12\'s disc there)', pass && Math.abs(Math.hypot(pass.end.x - flight.catchAt.x, pass.end.y - flight.catchAt.y) - 1.4) < 0.05, `${pass?.d} ${JSON.stringify(flight.catchAt)}`);

  // On screen, playing: the ball and 12 meet at that moment, where the arrow ends.
  await click(page, '#play-button');
  await page.evaluate(ms => window.rugbyPlayback.advance(ms), flight.end);
  const drawn = { a12: await translate(page, '#players-layer [data-id="a12"]'), label: await translate(page, '#labels-layer [data-id="a12"]'), ball: await translate(page, '#ball-layer [data-id="o1"]') };
  check('playing: at the catch the drawn ball is in 12\'s hands, at the catch point', near(drawn.a12, flight.catchAt, 0.01) && near(drawn.ball, { x: drawn.a12.x + 1.1, y: drawn.a12.y + 0.9 }, 0.01), JSON.stringify(drawn));
  check('playing: 12\'s number moves with him', eq(drawn.label, drawn.a12), JSON.stringify(drawn));
  await page.evaluate(() => window.rugbyPlayback.stop());

  // A receiver who has finished his run: the pass goes to where he finishes, as before.
  await paste(page, play([{
    note: 'Finished', positions: POS, objects: [{ id: 'o1', type: 'ball', x: 41.1, y: 30.9 }],
    routes: [R('r1', 'run', 'a12', [[38, 40], [39, 43]], 1), R('r2', 'run', 'a10', [[40, 30], [44, 30]], 1), R('r3', 'pass', 'a10', [[40, 30], [38, 40]], 1, { to: 'a12' })],
  }]));
  const s2 = await schedule(page);
  check('a receiver who has finished his run: caught where he finishes', near(s2.flight.catchAt, P(39, 43), 1e-6), JSON.stringify(s2.flight));
  const pass2 = await line(page, 'r3');
  check('…and the arrow ends there', pass2 && eq(pass2.start, P(44, 30)) && Math.abs(Math.hypot(pass2.end.x - 39, pass2.end.y - 43) - 1.4) < 0.05, pass2?.d);
  check('pop pass: no console errors or native dialogs', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== 4. A second run continues the first ==');
  const { browser, page, errors } = await open();
  await paste(page, play([{ note: '', positions: POS, objects: [], routes: [R('r1', 'run', 'a8', [[30, 50], [36, 52]], 1), R('r2', 'pass', 'a10', [[40, 30], [38, 40]], 2, { to: 'a12' })] }]));
  await click(page, '[data-route="run"]');
  const at = await toScreen(page, 30, 50);
  await page.mouse.move(at.x, at.y);
  await sleep(50);
  const hint = () => page.$eval('#draw-hint', h => (h.hidden ? null : h.textContent));
  check('Run on, hovering 8 who has a run: the hint says the new one continues it', (await hint(page))?.startsWith("Continues 8's run"), await hint(page));
  await drag(page, [30, 50], [42, 56]);
  let r = (await state(page)).phases[0].routes.at(-1);
  check('the new run starts at the end of 8\'s last route and is the next step', r.from === 'a8' && eq(r.points, [[36, 52], [42, 56]]) && r.order === 3, JSON.stringify(r));
  check('…and the status line says so', (await page.$eval('#toast', t => t.textContent)) === "Continues 8's run as step 3.", await page.$eval('#toast', t => t.textContent));
  const run2 = await line(page, r.id);
  check('…drawn from there', run2 && eq(run2.start, P(36, 52)), run2?.d);
  // Click-to-draw from 8 (selected): the hint, then a third run from the end of the second.
  await page.keyboard.press('Escape');
  await tap(page, 30, 50);
  await click(page, '[data-route="decoy"]');
  check('8 selected, Decoy on: "Continues 8\'s run"', (await hint(page)) === "Continues 8's run: click where it ends. Click again for another, Esc to stop.", await hint(page));
  await tap(page, 46, 62);
  r = (await state(page)).phases[0].routes.at(-1);
  check('a click adds a decoy from the end of the second run, as step 4', r.type === 'decoy' && eq(r.points, [[42, 56], [46, 62]]) && r.order === 4, JSON.stringify(r));
  await page.keyboard.press('Escape');
  // Dragging 8 moves his first run's start; the runs that carry on keep starting where the one before ends.
  await drag(page, [30, 50], [31, 49]);
  const routes = (await state(page)).phases[0].routes.filter(q => q.from === 'a8');
  check('dragging 8: his first run follows him, the others stay joined to the one before', eq(routes.map(q => q.points[0]), [[31, 49], [36, 52], [42, 56]]), JSON.stringify(routes.map(q => q.points)));
  // The next phase starts with him at the end of his last route.
  await click(page, '[data-phase="add"]');
  check('Add phase: 8 starts the next phase where his last route ends', eq((await state(page)).phases[1].positions.a8, P(46, 62)));
  check('second run: no console errors or native dialogs', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== 5. Half pitch shows players on halfway ==');
  const { browser, page, errors } = await open();
  await click(page, '#templates-button');
  await page.waitForSelector('.template-card');
  await page.$$eval('.template-card', cs => cs.find(c => c.textContent.includes('Kick-off')).click());
  await sleep(150);
  check('the Kick-off template is open', (await state(page)).name.toLowerCase().includes('kick'), (await state(page)).name);
  const pitch = await rect(page, '#pitch');
  for (const view of ['half', 'half-own']) {
    await page.evaluate(v => { window.playState.view = v; }, view);
    await click(page, '[data-view="half"]'); // a redraw in the half view chosen
    if ((await state(page)).view !== view) await click(page, '#flip-half');
    const s = await state(page);
    const [lo, hi] = view === 'half' ? [45, 110] : [-10, 55];
    const near50 = Object.entries(s.phases[0].positions).filter(([, p]) => p.x >= 45 && p.x <= 55).map(([id]) => id);
    const arrows = await page.$$eval('#edge-layer [data-edge]', gs => gs.map(g => g.dataset.edge));
    const box = await rect(page, '#pitch');
    const shown = await page.evaluate(ids => ids.map(id => {
      // Its whole disc is on the pitch (the chasers 3 m behind halfway too).
      const r = document.querySelector(`#players-layer [data-id="${id}"] .body`).getBoundingClientRect();
      const p = document.getElementById('pitch').getBoundingClientRect();
      return r.left >= p.left - 1 && r.right <= p.right + 1;
    }), near50);
    check(`${view}: the view runs from ${lo} to ${hi}`, (await page.$eval('#pitch', p => p.getAttribute('viewBox'))) === `${lo} 0 ${hi - lo} 70`);
    check(`${view}: the kick-off players on or near halfway are whole on the pitch, not edge arrows`, near50.length >= 10 && near50.every(id => !arrows.includes(id)) && shown.every(Boolean), JSON.stringify({ near50, arrows, shown }));
    check(`${view}: players further off still get an arrow`, arrows.length > 0 && arrows.every(id => { const p = s.phases[0].positions[id]; return p.x < lo || p.x > hi; }), arrows.join());
    check(`${view}: the pitch is as large as fits`, box.w > pitch.w * 0.4, JSON.stringify(box));
  }
  check('half view: no console errors or native dialogs', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== 6. Polish ==');
  const { browser, page, errors } = await open({ downloads: OUT });
  // A pass crossing 12's disc.
  await paste(page, play([{
    note: '', positions: { ...POS, a12: P(45, 35) }, objects: [{ id: 'o1', type: 'ball', x: 41.1, y: 30.9 }],
    routes: [R('r1', 'pass', 'a10', [[40, 30], [50, 40]], 1), R('r2', 'run', 'a8', [[30, 50], [45, 35]], 1)],
  }]));
  const order = await page.evaluate(() => {
    const ids = [...document.getElementById('world').children].map(g => g.id);
    return { ids, labels: document.querySelectorAll('#labels-layer .player-label text').length, discText: document.querySelectorAll('#players-layer text').length };
  });
  const idx = id => order.ids.indexOf(id);
  check('player numbers are in a layer above every route line (passes too), discs below the passes',
    idx('labels-layer') > idx('ball-routes-layer') && idx('labels-layer') > idx('routes-layer') && idx('players-layer') < idx('ball-routes-layer') && order.labels === 4 && order.discText === 0, JSON.stringify(order));
  // The pixels in 12's number change when the pass's layer is hidden only if the line covers it: it mustn't.
  const num = await page.$eval('#labels-layer [data-id="a12"] text', t => { const r = t.getBoundingClientRect(); return { x: r.x + r.width * 0.3, y: r.y + r.height * 0.3, width: r.width * 0.4, height: r.height * 0.4 }; });
  const withLine = await page.screenshot({ clip: num });
  await page.$eval('#labels-layer', g => { g.style.visibility = 'hidden'; });
  const noNumber = await page.screenshot({ clip: num });
  await page.$eval('#labels-layer', g => { g.style.visibility = ''; });
  check('…the number shows over the pass crossing the disc', !Buffer.from(withLine).equals(Buffer.from(noNumber)));

  // The Attack label: players on its usual spot push it along the edge.
  const dirBox = () => page.evaluate(() => { const b = document.querySelector('#direction-layer .direction').getBBox(); return { minX: b.x, maxX: b.x + b.width, minY: b.y, maxY: b.y + b.height }; });
  const clearOf = (box, ps, r = 1.2) => ps.every(p => { const x = Math.min(Math.max(p.x, box.minX), box.maxX); const y = Math.min(Math.max(p.y, box.minY), box.maxY); return Math.hypot(p.x - x, p.y - y) >= r; });
  const home = await dirBox();
  const crowd = { a8: P(48, 67), a10: P(52, 67.5), a12: P(56, 67), d10: P(44, 67.8) };
  await paste(page, play([{ note: '', positions: crowd, objects: [], routes: [] }]));
  let box = await dirBox();
  check('Attack label: with players on its usual spot it moves along the bottom edge, clear of all of them', clearOf(box, Object.values(crowd)) && Math.abs(box.minY - home.minY) < 0.01 && Math.abs(box.minX - home.minX) > 1, JSON.stringify({ home, box }));
  await click(page, '[data-orientation="vertical"]');
  const vcrowd = { a8: P(-7.5, 36), a10: P(-7.5, 33), a12: P(-6, 40), d10: P(-4, 30) };
  await paste(page, play([{ note: '', positions: vcrowd, objects: [], routes: [] }], { orientation: 'vertical' }));
  box = await dirBox();
  check('vertical: also clear of every player', clearOf(box, Object.values(vcrowd)), JSON.stringify(box));
  await click(page, '[data-orientation="horizontal"]');

  // Header: at 1080 wide, a long name is cut with "…" (full name in the tooltip), and nothing shifts.
  await page.setViewport({ width: 1080, height: 720 });
  const headerXs = () => page.evaluate(() => ['#details-button', '[data-action="undo"]', '#file-menu summary', '#plays-button', '#templates-button', '#present-button',
    '[data-view="full"]', '[data-orientation="vertical"]', '#layers summary', '#about-button'].map(sel => Math.round(document.querySelector(sel).getBoundingClientRect().x)));
  const setName = name => page.$eval('#play-name', (i, n) => { i.value = n; i.dispatchEvent(new Event('input')); }, name);
  await setName('Short');
  const full = await headerXs();
  await click(page, '[data-view="half"]');
  const half = await headerXs();
  check('header: the Other half button showing moves nothing else', eq(full.slice(1), half.slice(1)), JSON.stringify([full, half]));
  const longName = 'Scrum on halfway, twelve crash ball, thirteen loops round';
  await setName(longName);
  const long = await headerXs();
  const nameBox = await page.$eval('#play-name', i => ({ overflow: getComputedStyle(i).textOverflow, cut: i.scrollWidth > i.clientWidth, title: i.title, w: i.getBoundingClientRect().width }));
  check('header: a long name is shortened with "…", the full name in the tooltip', nameBox.overflow === 'ellipsis' && nameBox.cut && nameBox.title === longName, JSON.stringify(nameBox));
  check('header: a long name moves none of the buttons after it', eq(long.slice(1), half.slice(1)), JSON.stringify([half, long]));
  await click(page, '[data-view="full"]');
  check('header: back to Full, still nothing moves', eq((await headerXs()).slice(1), long.slice(1)));
  check('header: the Other half slot is kept while it is hidden', await page.$eval('#flip-half', b => b.hidden && getComputedStyle(b).visibility === 'hidden' && b.getBoundingClientRect().width > 0));

  // File menu: Escape closes it, and it fits a 648 px tall window.
  await page.setViewport({ width: 1080, height: 648 });
  await page.click('#file-menu summary');
  check('the File menu opens', await page.$eval('#file-menu', m => m.open));
  await page.keyboard.press('Escape');
  check('Escape closes the File menu', await page.$eval('#file-menu', m => !m.open));
  await page.click('#file-menu summary');
  await page.focus('[data-file="save"]');
  await page.keyboard.press('Escape');
  check('…also with the focus on one of its buttons (and the focus goes back to File)', await page.evaluate(() => !document.getElementById('file-menu').open && document.activeElement === document.querySelector('#file-menu summary')));
  for (const height of [648, 480]) {
    await page.setViewport({ width: 1080, height });
    await page.click('#file-menu summary');
    const panel = await page.$eval('#file-menu .menu-panel', p => { const r = p.getBoundingClientRect(); return { bottom: r.bottom, vh: innerHeight, sh: p.scrollHeight, ch: p.clientHeight, docH: document.documentElement.scrollHeight }; });
    check(`${height} px tall: the File menu fits the window and the page doesn't grow`, panel.bottom <= panel.vh && panel.docH <= panel.vh, JSON.stringify(panel));
    const last = await page.$eval('#file-menu .menu-panel', p => { p.lastElementChild.previousElementSibling?.scrollIntoView({ block: 'nearest' }); return true; });
    const r = await rect(page, '#file-menu .menu-panel');
    await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2);
    await page.mouse.wheel({ deltaY: 600 });
    await sleep(150);
    const scrolled = await page.evaluate(() => ({ page: scrollY + document.documentElement.scrollTop + document.body.scrollTop, about: (() => { const a = document.querySelector('#file-menu [data-file="logo"]').getBoundingClientRect(); return a.bottom <= innerHeight; })() }));
    check(`${height} px tall: scrolling over the menu never scrolls the page, and every item can be reached`, last && scrolled.page === 0 && scrolled.about, JSON.stringify(scrolled));
    if (height === 480) check('480 px tall: the menu scrolls inside itself', panel.sh > panel.ch, JSON.stringify(panel));
    await page.keyboard.press('Escape');
  }
  await page.setViewport({ width: 1440, height: 900 });

  // Play details.
  check('the File menu no longer has the category or tags', await page.evaluate(() => !document.querySelector('#file-menu #play-category, #file-menu #play-tags')));
  await page.click('#details-button');
  check('the pencil opens Play details', await page.$eval('#play-details', p => p.matches(':popover-open')));
  await page.select('#play-category', 'defense');
  await page.click('#play-tags', { clickCount: 3 });
  await page.keyboard.type('backs, set move');
  const s = await state(page);
  check('Play details sets the category and tags', s.category === 'defense' && eq(s.tags, ['backs', 'set move']), JSON.stringify([s.category, s.tags]));
  const pop = await rect(page, '#play-details');
  const pencil = await rect(page, '#details-button');
  check('…opening just under the pencil', pop.y >= pencil.bottom && pop.y - pencil.bottom < 20 && Math.abs(pop.x - pencil.x) < 40, JSON.stringify([pop, pencil]));
  await page.keyboard.press('Escape');
  check('Escape closes Play details', await page.$eval('#play-details', p => !p.matches(':popover-open')));
  await click(page, '[data-action="undo"]');
  check('the tags are one undo step', eq((await state(page)).tags, []) && (await state(page)).category === 'defense');

  // The lineout's L block.
  await placeSetPiece(page, 'lineout-attack', [40, 5]);
  const tab = await page.evaluate(() => { const g = [...document.querySelectorAll('.group-tab')].find(t => t.textContent.includes('L')); return g && { aria: g.getAttribute('aria-label'), title: g.querySelector('title')?.textContent }; });
  check('the lineout\'s L block: tooltip and aria-label "Drag to move the lineout"', tab?.aria === 'Drag to move the lineout' && tab.title === 'Drag to move the lineout', JSON.stringify(tab));

  // The note keeps its height: a two-line note doesn't move the pitch.
  await page.keyboard.press('Escape');
  const before = { note: await rect(page, '#phase-note'), pitch: await rect(page, '#pitch') };
  await page.click('#phase-note');
  await page.keyboard.type('Ten hits the line hard and pops it to twelve, who runs a short angle.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Thirteen holds width.');
  const afterNote = { note: await rect(page, '#phase-note'), pitch: await rect(page, '#pitch') };
  check('a two-line note never makes the pitch jump (the note box keeps its height)', eq(before, afterNote), JSON.stringify([before, afterNote]));
  check('…the note is kept', (await state(page)).phases[0].note.includes('Thirteen holds width.'));
  await page.$eval('#phase-note', t => t.blur());

  // Route hints are never cut off: wrapped or shortened, inside the status line, at several widths.
  const hintFits = () => page.evaluate(() => {
    const h = document.getElementById('draw-hint');
    const r = h.getBoundingClientRect();
    const bar = document.getElementById('statusbar').getBoundingClientRect();
    return { text: h.textContent, fits: h.scrollWidth <= h.clientWidth + 1 && h.scrollHeight <= h.clientHeight + 1, inBar: r.top >= bar.top - 1 && r.bottom <= bar.bottom + 1 && r.right <= bar.right + 1, shown: !h.hidden && r.width > 0 };
  });
  await paste(page, play([{ note: '', positions: POS, objects: [], routes: [R('r1', 'run', 'a8', [[30, 50], [36, 52]], 1)] }]));
  for (const width of [1440, 1080, 800]) {
    await page.setViewport({ width, height: 720 });
    await tap(page, 30, 50);
    for (const tool of ['pass', 'run']) {
      await click(page, `[data-route="${tool}"]`);
      const h = await hintFits();
      check(`${width} px: the ${tool} hint is shown in full in the status line ("${h.text}")`, h.shown && h.fits && h.inBar, JSON.stringify(h));
      await click(page, `[data-route="${tool}"]`);
    }
    await page.keyboard.press('Escape');
  }
  await page.setViewport({ width: 1440, height: 900 });
  check('polish: no console errors or native dialogs', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== Phone 390x844: hints and the File menu ==');
  const { browser, page, errors } = await open({ mobile: true });
  await paste(page, play([{ note: '', positions: POS, objects: [], routes: [R('r1', 'run', 'a8', [[30, 50], [36, 52]], 1)] }], { orientation: 'vertical' }));
  await tap(page, 30, 50, { touch: true });
  await page.tap('[data-route="run"]');
  const h = await page.evaluate(() => { const el = document.getElementById('draw-hint'); return { text: el.textContent, fits: el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1 }; });
  check(`phone: the hint is shown in full ("${h.text}")`, h.fits && h.text.startsWith("Continues 8's run"), JSON.stringify(h));
  await page.tap('#file-menu summary');
  const panel = await page.$eval('#file-menu .menu-panel', p => ({ bottom: p.getBoundingClientRect().bottom, vh: innerHeight }));
  check('phone: the File menu fits the screen', panel.bottom <= panel.vh, JSON.stringify(panel));
  check('phone: no console errors or native dialogs', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(failed() ? `\n${failed()} FAILED` : '\nALL PASSED');
process.exit(failed() ? 1 : 0);
