// Animation, Present mode and links to a phase. Desktop 1440x900.
// The animation clock is stopped (timeScale 0) and moved on by hand with rugbyPlayback.advance(ms), so
// nothing waits in real time; one run at 20x checks that it also plays by itself.
import path from 'node:path';
import { open, drag, click, state, shown, check, failed, toScreen, outDir, URL_ } from './lib.mjs';
import { buildSchedule, TIMING } from '../../js/animate.js';
import { animPlay } from '../anim-play.mjs';

const OUT = outDir('playback');
console.log(`Screenshots: ${OUT}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (p, q, tol) => !!p && !!q && Math.hypot(p.x - q.x, p.y - q.y) <= tol;
const moved = (p, q) => p.x !== q.x || p.y !== q.y;

// Puts a play in the app (as Undo would) and redraws.
async function loadPlay(page, play) {
  await page.evaluate(p => {
    const s = window.playState;
    for (const k of Object.keys(s)) delete s[k];
    Object.assign(s, structuredClone(p));
  }, play);
  await page.keyboard.press('Escape');
}
// Where every player and marker is drawn, from its transform.
const drawn = page => page.evaluate(() => {
  const out = {};
  for (const g of document.querySelectorAll('#players-layer > [data-id], #objects-layer > [data-id], #ball-layer > [data-id]')) {
    const m = /translate\(([^ ]+) ([^)]+)\)/.exec(g.getAttribute('transform'));
    out[g.dataset.id] = { x: Number(m[1]), y: Number(m[2]) };
  }
  return out;
});
const pb = page => page.evaluate(() => ({ playing: rugbyPlayback.playing, time: rugbyPlayback.time, speed: rugbyPlayback.speed, loop: rugbyPlayback.loop }));
const advance = (page, ms) => page.evaluate(ms => rugbyPlayback.advance(ms), ms);
const playLabel = page => page.$eval('#play-button', b => b.getAttribute('aria-label'));
const visible = (page, sel) => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0; });
const pitchArea = page => page.$eval('#pitch', el => { const r = el.getBoundingClientRect(); return r.width * r.height; });

{
  console.log('\n== Animation (desktop) ==');
  const { browser, page, errors } = await open();
  const play = animPlay();
  await loadPlay(page, play);
  await page.evaluate(() => { rugbyPlayback.timeScale = 0; });
  const s0 = buildSchedule(play, 0);
  const move = id => s0.moves.find(m => m.route.id === id);
  const flight = s0.flights[0];
  const start = play.phases[0].positions;

  check('controls: Play, 1x, Loop off', (await playLabel(page)) === 'Play'
    && (await page.$eval('[data-speed="1"]', b => b.getAttribute('aria-pressed'))) === 'true'
    && (await page.$eval('[data-play="loop"]', b => b.getAttribute('aria-pressed'))) === 'false');
  check('URL shows #phase=1', (await page.evaluate(() => location.hash)) === '#phase=1', await page.evaluate(() => location.hash));

  // --- Order: same-order routes start together, the ball after the passer ---
  await page.keyboard.press('Space');
  check('Space plays: button says Pause, editing locked', (await pb(page)).playing && (await playLabel(page)) === 'Pause'
    && (await page.evaluate(() => document.body.classList.contains('playing'))));
  await advance(page, TIMING.lead - 1);
  let d = await drawn(page);
  check('nothing moves before the first step', ['a10', 'a12', 'd10', 'd12'].every(id => eq(d[id], start[id])), JSON.stringify(d));
  await advance(page, 30);
  d = await drawn(page);
  check('order 1: 10 and 12 start together', moved(d.a10, start.a10) && moved(d.a12, start.a12), JSON.stringify(d));
  check('order 2 (the drift) waits', eq(d.d10, start.d10));
  check('the ball moves with 10 while he runs', near({ x: d.o1.x - d.a10.x, y: d.o1.y - d.a10.y }, { x: 1.1, y: 0.9 }, 1e-6), JSON.stringify(d.o1));

  // Every frame from here to the end of the phase, sampled in the page.
  const samples = await page.evaluate(async (until, step) => {
    const out = [];
    const read = () => {
      const pos = {};
      for (const g of document.querySelectorAll('#players-layer > [data-id], #ball-layer > [data-id]')) {
        const m = /translate\(([^ ]+) ([^)]+)\)/.exec(g.getAttribute('transform'));
        pos[g.dataset.id] = { x: Number(m[1]), y: Number(m[2]) };
      }
      const b = document.querySelector('#ball-routes-layer [data-id="r4"] path:last-child');
      return { t: rugbyPlayback.time, pos, bLine: b?.getAttribute('d') ?? null, bAlt: b?.parentElement.classList.contains('option-alt') ?? null };
    };
    while (rugbyPlayback.time + step < until) { rugbyPlayback.advance(step); out.push(read()); }
    return out;
  }, s0.total - 2, 10);
  const before = samples.filter(f => f.t < flight.start - 1);
  check('the ball stays in 10\'s hands until his run ends', before.length > 5 && before.every(f => near({ x: f.pos.o1.x - f.pos.a10.x, y: f.pos.o1.y - f.pos.a10.y }, { x: 1.1, y: 0.9 }, 1e-6)));
  const leaves = samples.find(f => !near({ x: f.pos.o1.x - f.pos.a10.x, y: f.pos.o1.y - f.pos.a10.y }, { x: 1.1, y: 0.9 }, 0.01));
  check('the ball leaves only after 10 has stopped', !!leaves && leaves.t >= move('r1').end && eq(leaves.pos.a10, { x: 44, y: 32 }), JSON.stringify(leaves));
  const drift = samples.find(f => moved(f.pos.d10, start.d10));
  check('the drift (order 2) starts after order 1 has finished', !!drift && drift.t > flight.end && drift.t > move('r2').end, JSON.stringify(drift?.t));
  check('option B never animates: the ball never heads to 13, the line stays faint and still',
    samples.every(f => f.pos.o1.y > 29) && samples.every(f => f.bAlt === true && f.bLine === samples[0].bLine) && samples.every(f => eq(f.pos.a13, start.a13) || f.t > s0.routesEnd));
  const mid = samples.find(f => f.t > s0.routesEnd + TIMING.tween / 2);
  check('players with no route slide to the next phase', mid && moved(mid.pos.d12, start.d12) && moved(mid.pos.d12, play.phases[1].positions.d12));
  const last = samples.at(-1);
  check('just before the end, everyone is all but in the next phase', Object.entries(play.phases[1].positions).every(([id, p]) => near(last.pos[id], p, 0.01)), JSON.stringify(last.pos));

  // --- End of the animation: exactly the next phase ---
  await advance(page, s0.total - (await pb(page)).time + 0.001);
  d = await drawn(page);
  check('the next phase is shown, still playing', (await shown(page)) === 1 && (await pb(page)).playing);
  check('positions at the end match the next phase exactly',
    Object.entries(play.phases[1].positions).every(([id, p]) => eq(d[id], p)) && eq(d.o1, { x: 51.1, y: 44.9 }), JSON.stringify(d));
  check('URL follows the phase while playing', (await page.evaluate(() => location.hash)) === '#phase=2');

  // --- Pause returns to editing on that phase ---
  await page.keyboard.press('Space');
  check('Space pauses on the phase it reached', !(await pb(page)).playing && (await shown(page)) === 1 && (await playLabel(page)) === 'Play'
    && !(await page.evaluate(() => document.body.classList.contains('playing'))));
  await drag(page, [47, 21], [47, 25]);
  check('after pausing, a player can be dragged', eq((await state(page)).phases[1].positions.a13, { x: 47, y: 25 }), JSON.stringify((await state(page)).phases[1].positions.a13));

  // --- Editing is locked while playing ---
  await page.keyboard.press('Space');
  const locked = await state(page);
  await drag(page, [47, 25], [52, 30]);
  check('playing: dragging a player does nothing', eq(await state(page), locked));
  const disabled = await page.evaluate(() => ({
    tools: [...document.querySelectorAll('.toolbar .group button')].every(b => b.disabled),
    undo: document.querySelector('[data-action="undo"]').disabled,
    add: document.querySelector('[data-phase="add"]').disabled,
    insert: document.querySelector('[data-phase="insert"]').disabled,
    del: document.querySelector('[data-phase="delete"]').disabled,
  }));
  check('playing: tools, undo and phase editing are disabled', Object.values(disabled).every(Boolean), JSON.stringify(disabled));
  // The note isn't locked: focusing it stops the play, so what's typed is kept (see tests/browser/session.mjs).
  check('playing: the note box can still be typed in', await page.$eval('#phase-note', t => !t.readOnly && !t.disabled));
  await click(page, '[data-route="run"]');
  await drag(page, [47, 25], [55, 20]);
  await page.keyboard.press('Delete');
  await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta');
  check('playing: no route drawn, nothing deleted, no undo', eq(await state(page), locked));

  // --- Step back and forward ---
  await page.keyboard.press('ArrowRight');
  check('→ while playing: next phase, from its start, still playing', (await shown(page)) === 2 && (await pb(page)).playing && (await pb(page)).time === 0);
  await page.keyboard.press('ArrowLeft');
  check('← while playing: back a phase', (await shown(page)) === 1 && (await pb(page)).playing);
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  check('→ while paused: next phase, not playing', (await shown(page)) === 2 && !(await pb(page)).playing);
  await page.keyboard.press('ArrowLeft');
  check('← while paused: back a phase', (await shown(page)) === 1);

  // --- Speed ---
  for (const [sp, want] of [['2', 200], ['0.5', 50], ['1', 100]]) {
    await click(page, `[data-speed="${sp}"]`);
    await page.keyboard.press('Space');
    const t0 = (await pb(page)).time;
    await advance(page, 100);
    const t1 = (await pb(page)).time;
    await page.keyboard.press('Space');
    check(`speed ${sp}x: 100 ms moves the play on ${want} ms`, Math.abs(t1 - t0 - want) < 1e-9 && (await page.$eval(`[data-speed="${sp}"]`, b => b.getAttribute('aria-pressed'))) === 'true', `${t1 - t0}`);
  }

  // --- Loop ---
  await page.keyboard.press('ArrowRight'); // phase 3, the last
  await click(page, '[data-play="loop"]');
  check('Loop toggles on', (await pb(page)).loop && (await page.$eval('[data-play="loop"]', b => b.getAttribute('aria-pressed'))) === 'true');
  const s2 = buildSchedule(await state(page), 2);
  const s2loop = buildSchedule(await state(page), 2, { loop: true });
  await page.keyboard.press('Space');
  await advance(page, s2loop.total + 10);
  check('with Loop, after the last phase it starts again from phase 1', (await shown(page)) === 0 && (await pb(page)).playing);
  await click(page, '[data-play="loop"]');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await advance(page, s2.total + 10);
  check('without Loop, it stops after the last phase', (await shown(page)) === 2 && !(await pb(page)).playing && (await playLabel(page)) === 'Play');
  await click(page, '#play-button');
  check('Play after the end starts again from phase 1', (await shown(page)) === 0 && (await pb(page)).playing);
  await click(page, '#play-button');
  check('the Play button pauses too', !(await pb(page)).playing);

  // --- Plays by itself (requestAnimationFrame), here at 20x ---
  await page.evaluate(() => { rugbyPlayback.timeScale = 20; });
  await page.keyboard.press('Space');
  const ran = await page.waitForFunction(() => !rugbyPlayback.playing, { timeout: 15000 }).then(() => true, () => false);
  check('plays through to the last phase by itself', ran && (await shown(page)) === 2);
  await page.evaluate(() => { rugbyPlayback.timeScale = 0; });

  // --- Links to a phase ---
  await page.evaluate(() => { location.hash = '#phase=1'; });
  await sleep(100);
  check('changing #phase in the address goes to that phase', (await shown(page)) === 0);
  await sleep(500); // autosave
  await page.goto('about:blank');
  await page.goto(`${URL_}#phase=3`);
  await page.waitForSelector('#phase-tabs button');
  check('opening a link with #phase=3 starts on phase 3', (await shown(page)) === 2 && (await page.evaluate(() => location.hash)) === '#phase=3');
  await page.goto('about:blank');
  await page.goto(`${URL_}#phase=9`);
  await page.waitForSelector('#phase-tabs button');
  check('#phase past the end opens the last phase', (await shown(page)) === 2 && (await page.evaluate(() => location.hash)) === '#phase=3');

  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== Present mode (desktop) ==');
  const { browser, page, errors } = await open();
  await loadPlay(page, animPlay());
  await page.evaluate(() => { rugbyPlayback.timeScale = 0; });
  const normalArea = await pitchArea(page);
  // Something selected beforehand, to check Present mode clears it.
  const p = await toScreen(page, 40, 30);
  await page.mouse.click(p.x, p.y);
  check('a player is selected before presenting', (await page.$$('#players-layer .player.selected')).length === 1);

  await click(page, '#present-button');
  check('Present: toolbar, top bar and status line hidden', await page.evaluate(() => ['.topbar', '.toolbar', '.statusbar'].every(s => getComputedStyle(document.querySelector(s)).display === 'none'))
    && (await page.evaluate(() => document.body.classList.contains('presenting'))));
  const bigArea = await pitchArea(page);
  check('Present: the pitch is larger', bigArea > normalArea * 1.05, `${normalArea} -> ${bigArea}`);
  const cap = await page.evaluate(() => {
    const c = document.getElementById('present-caption');
    const r = c.getBoundingClientRect();
    return { text: c.textContent, h: r.height, top: r.top, size: parseFloat(getComputedStyle(c).fontSize), pitchBottom: document.getElementById('pitch').getBoundingClientRect().bottom };
  });
  check('Present: the note is a large caption under the pitch', cap.text === 'Ten runs, then the pass' && cap.h > 0 && cap.size >= 19 && cap.top >= cap.pitchBottom - 1, JSON.stringify(cap));
  check('Present: "Phase 1 of 3" in a corner', (await page.$eval('#present-count', e => e.textContent)) === 'Phase 1 of 3' && (await visible(page, '#present-count')));
  check('Present: the controls bar shows only the play controls', (await visible(page, '#play-controls')) && (await visible(page, '[data-play="pen"]'))
    && (await page.evaluate(() => getComputedStyle(document.querySelector('.phase-nav')).display === 'none' && getComputedStyle(document.querySelector('.phase-tools')).display === 'none')));
  check('Present: nothing selected, no handles, no route bar, no tooltips', await page.evaluate(() =>
    !document.querySelector('#pitch .selected') && !document.querySelector('#handles-layer *')
    && document.getElementById('route-bar').hidden && ![...document.querySelectorAll('#play-controls [title]')].length));
  const pl = await toScreen(page, 45, 40);
  await page.mouse.move(pl.x, pl.y);
  check('Present: no hover hints or grab cursor', await page.evaluate(() => !document.querySelector('.snap-ring') && getComputedStyle(document.querySelector('#players-layer .player')).cursor !== 'grab'));
  await drag(page, [45, 40], [50, 30]);
  check('Present: players can\'t be dragged', eq((await state(page)).phases[0].positions.a12, { x: 45, y: 40 }));
  await page.screenshot({ path: path.join(OUT, 'present.png') });

  // Controls fade after a while without mouse movement, and come back on movement.
  await page.evaluate(() => { rugbyPresent.idleMs = 150; });
  await page.mouse.move(pl.x + 5, pl.y + 5);
  await sleep(700);
  check('Present: the controls fade without mouse movement', await page.evaluate(() => document.body.classList.contains('controls-idle') && getComputedStyle(document.querySelector('.phasebar')).opacity === '0'));
  await page.mouse.move(pl.x + 30, pl.y + 30);
  check('Present: mouse movement brings them back', await page.evaluate(() => !document.body.classList.contains('controls-idle')));
  await page.evaluate(() => { rugbyPresent.idleMs = 60000; });

  // Same Play controls and keys.
  await page.keyboard.press('Space');
  check('Present: Space plays', (await pb(page)).playing);
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  check('Present: → steps forward, the corner follows', (await shown(page)) === 1 && (await page.$eval('#present-count', e => e.textContent)) === 'Phase 2 of 3');
  await click(page, '[data-play="back"]');
  check('Present: the step back button', (await shown(page)) === 0 && (await page.$eval('#present-caption', e => e.textContent)) === 'Ten runs, then the pass');

  // --- I play ---
  await page.select('#i-play', 'a12');
  const fade = await page.evaluate(() => {
    const op = el => Number(getComputedStyle(el).opacity);
    const players = [...document.querySelectorAll('#players-layer .player')];
    const me = players.find(g => g.dataset.id === 'a12');
    const mates = players.filter(g => g !== me && g.classList.contains('attack'));
    const opposition = players.filter(g => g.classList.contains('defense'));
    return {
      ring: !!me.querySelector('.me-ring'), meOp: op(me),
      mates: mates.length === 2 && mates.every(g => g.classList.contains('dim') && op(g) < 0.3),
      opposition: opposition.length === 2 && opposition.every(g => !g.classList.contains('dim') && op(g) === 1),
      myRoute: !document.querySelector('#routes-layer [data-id="r2"]').classList.contains('dim'),
      mateRoutes: ['r1'].every(id => document.querySelector(`#routes-layer [data-id="${id}"]`).classList.contains('dim'))
        && ['r3', 'r4'].every(id => op(document.querySelector(`#ball-routes-layer [data-id="${id}"]`)) < 0.3),
      oppositionRoute: !document.querySelector('#routes-layer [data-id="r5"]').classList.contains('dim'),
      focus: document.activeElement?.id !== 'i-play',
    };
  });
  check('I play 12: ring on 12, only the rest of the attack and their routes fade; the defense stays at full strength',
    fade.ring && fade.meOp === 1 && fade.mates && fade.opposition && fade.myRoute && fade.mateRoutes && fade.oppositionRoute && fade.focus, JSON.stringify(fade));
  await page.screenshot({ path: path.join(OUT, 'present-i-play.png') });
  await page.select('#i-play', '');
  check('I play None: nothing faded', await page.evaluate(() => !document.querySelector('#pitch .dim') && !document.querySelector('.me-ring')));

  // --- Pen ---
  const before = await state(page);
  await page.keyboard.press('p');
  check('P turns the pen on', await page.evaluate(() => rugbyPresent.pen && document.querySelector('[data-play="pen"]').getAttribute('aria-pressed') === 'true'));
  await drag(page, [40, 30], [55, 20], { steps: 12 });
  const stroke = await page.evaluate(() => {
    const marks = document.querySelectorAll('#pen-layer .pen-mark');
    const line = marks[0]?.querySelector('.pen-stroke');
    const edge = marks[0]?.querySelector('.pen-outline');
    const cs = line && getComputedStyle(line);
    const ce = edge && getComputedStyle(edge);
    // Every colour a route or a team uses.
    const used = new Set([...document.querySelectorAll('#defs marker path')].map(p => getComputedStyle(p).fill));
    for (const g of document.querySelectorAll('#players-layer .player .body')) used.add(getComputedStyle(g).fill);
    return {
      n: marks.length, points: line?.getAttribute('d').split('L').length, color: cs?.stroke, width: cs && parseFloat(cs.strokeWidth),
      outline: ce?.stroke, outlineWidth: ce && parseFloat(ce.strokeWidth), clash: used.has(cs?.stroke),
    };
  });
  check('the pen draws a thick black line with a white outline, a colour no route or team uses',
    stroke.n === 1 && stroke.points > 5 && stroke.color === 'rgb(0, 0, 0)' && stroke.width >= 0.5 && stroke.outline === 'rgb(255, 255, 255)' && stroke.outlineWidth > stroke.width && !stroke.clash, JSON.stringify(stroke));
  check('drawing with the pen changes nothing in the play', eq(await state(page), before));
  await page.screenshot({ path: path.join(OUT, 'present-pen.png') });
  await page.keyboard.press('c');
  check('C clears the pen', (await page.$$('#pen-layer .pen-mark')).length === 0);
  await drag(page, [40, 30], [55, 40]);
  await page.keyboard.press('ArrowRight');
  check('the marks stay when the phase changes', (await page.$$('#pen-layer .pen-mark')).length === 1 && (await shown(page)) === 1);
  await click(page, '[data-play="clear"]');
  check('the Clear button clears them', (await page.$$('#pen-layer .pen-mark')).length === 0);
  await page.keyboard.press('p');
  check('P turns the pen off', !(await page.evaluate(() => rugbyPresent.pen)));

  // --- Leave ---
  await page.select('#i-play', 'a10');
  await page.keyboard.press('Escape');
  check('Escape leaves Present mode', await page.evaluate(() => !document.body.classList.contains('presenting') && getComputedStyle(document.querySelector('.toolbar')).display !== 'none'));
  check('after Present: pitch back to its size, nothing faded, controls not shown', Math.abs((await pitchArea(page)) - normalArea) < 2
    && (await page.evaluate(() => !document.querySelector('#pitch .dim') && getComputedStyle(document.querySelector('[data-play="pen"]')).display === 'none' && getComputedStyle(document.getElementById('present-count')).display === 'none')));
  check('after Present: tooltips back on the play controls', (await page.$eval('#play-button', b => b.title)).includes('Space'));
  await click(page, '#present-button');
  await click(page, '[data-play="exit"]');
  check('the Exit button leaves Present mode', !(await page.evaluate(() => document.body.classList.contains('presenting'))));

  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== Coach test fixes (desktop) ==');
  const { browser, page, errors } = await open();
  const play = animPlay();
  await loadPlay(page, play);
  await page.evaluate(() => { rugbyPlayback.timeScale = 0; });
  const s0 = buildSchedule(play, 0);
  const s1 = buildSchedule(play, 1);
  const s2loop = buildSchedule(play, 2, { loop: true });
  const frame = async () => ({ shown: await shown(page), time: (await pb(page)).time, drawn: await drawn(page) });

  // --- 2. Pause keeps the exact frame, with Loop on too. First the coach's case: Loop on, Pause in the
  // middle of a later phase, and on the last phase while it holds before going round. ---
  await click(page, '[data-play="loop"]');
  await page.keyboard.press('Space');
  await advance(page, s0.total + s1.routesEnd / 2);
  let before = await frame();
  await click(page, '#play-button');
  let after = await frame();
  check('Loop on, Pause mid phase 2: stays on phase 2 at the same moment, every player where it was',
    before.shown === 1 && after.shown === 1 && after.time === before.time && eq(after.drawn, before.drawn) && !(await pb(page)).playing, JSON.stringify([before.shown, after.shown, before.time, after.time]));
  await click(page, '[data-layer="grid"]'); // a redraw that changes nothing in the play
  await click(page, '[data-layer="grid"]');
  check('the paused frame survives a redraw', eq((await frame()).drawn, before.drawn) && (await shown(page)) === 1);
  await click(page, '#play-button');
  await advance(page, 40);
  check('Play carries on from the paused moment', (await pb(page)).playing && (await shown(page)) === 1 && Math.abs((await pb(page)).time - before.time - 40) < 1e-6);
  // On to the last phase's hold, then pause there (Space this time).
  await advance(page, s1.total - (await pb(page)).time + s2loop.routesEnd + 700);
  before = await frame();
  await page.keyboard.press('Space');
  after = await frame();
  check('Loop on, Pause during the hold on the last phase: stays on the last phase, not phase 1',
    before.shown === 2 && after.shown === 2 && after.time === before.time && eq(after.drawn, before.drawn), JSON.stringify([before.shown, after.shown]));

  // --- 8. Loop holds the last phase 1.5 s, then slides back to phase 1 ---
  await page.keyboard.press('Space');
  await advance(page, s2loop.slideStart - (await pb(page)).time - 20);
  let d = await drawn(page);
  check('Loop: still holding the last phase just before 1.5 s', (await shown(page)) === 2 && eq(d.a10, play.phases[2].positions.a10), JSON.stringify(d.a10));
  await advance(page, 20 + 800);
  d = await drawn(page);
  check('Loop: then everyone slides back towards phase 1 (no snap)', (await shown(page)) === 2 && d.a10.x < 50 && d.a10.x > 40, JSON.stringify(d.a10));
  before = await frame();
  await page.keyboard.press('Space');
  check('Pause during the slide back keeps that frame', eq((await frame()).drawn, before.drawn) && (await shown(page)) === 2);
  await page.keyboard.press('Space');
  await advance(page, s2loop.total - (await pb(page)).time + 1);
  d = await drawn(page);
  check('Loop: arrives exactly on phase 1', (await shown(page)) === 0 && eq(d.a10, play.phases[0].positions.a10) && (await pb(page)).playing);
  await page.keyboard.press('Space');
  await click(page, '[data-play="loop"]');

  // --- 7. Pace: today's 0.5x is the new 1x ---
  check('speeds are 0.5x, 1x, 2x', eq(await page.$$eval('[data-speed]', bs => bs.map(b => b.textContent)), ['0.5×', '1×', '2×']));
  await click(page, '[data-play="first"]'); // phase 1, from its start
  await page.keyboard.press('Space');
  const r1 = s0.moves.find(m => m.route.id === 'r1');
  check('1x: 10\'s 4.5 m run takes 1.2 s or more (it took 0.64 s before)', r1.end - r1.start >= 1200, String(r1.end - r1.start));
  await advance(page, TIMING.lead + 700);
  d = await drawn(page);
  check('1x: 0.7 s into the run, 10 is still on the way', moved(d.a10, play.phases[0].positions.a10) && !eq(d.a10, { x: 44, y: 32 }), JSON.stringify(d.a10));

  // --- 12. A route's badge goes once it starts moving ---
  const badgeShown = id => page.$eval(`#badges-layer .badge[data-id="${id}"]`, g => getComputedStyle(g).display !== 'none');
  check('playing: the run\'s badge has gone once 10 runs; order 2 and option B badges still show',
    !(await badgeShown('r1')) && !(await badgeShown('r2')) && (await badgeShown('r5')) && (await badgeShown('r4')) && (await badgeShown('r3')));
  await advance(page, s0.flights[0].start - (await pb(page)).time + 10);
  check('the pass\'s badge goes as the ball leaves', !(await badgeShown('r3')) && (await badgeShown('r5')));
  await page.keyboard.press('Space');
  check('paused: the badges stay as they were in that frame', !(await badgeShown('r1')) && (await badgeShown('r5')));
  await page.keyboard.press('Escape'); // clears the selection: no change, the frame stays
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  check('back to editing (another phase shown): every badge shows again', (await badgeShown('r1')) && (await badgeShown('r3')));

  // --- Present mode ---
  await click(page, '#present-button');

  // --- 11. Legend: hidden in Present mode ---
  check('Present: no legend', await page.$eval('#legend', l => getComputedStyle(l).display === 'none'));

  // --- 6. ⏮ goes to phase 1; ‹ and › step ---
  await click(page, '[data-play="forward"]');
  await click(page, '[data-play="forward"]');
  check('› steps forward', (await shown(page)) === 2);
  await click(page, '[data-play="back"]');
  check('‹ steps back', (await shown(page)) === 1);
  await click(page, '[data-play="forward"]');
  await click(page, '[data-play="first"]');
  check('⏮ goes to phase 1', (await shown(page)) === 0);
  check('the step buttons are in the order ⏮ ‹ ▶ ›', eq(await page.$$eval('#play-controls > button', bs => bs.slice(0, 4).map(b => b.dataset.play)), ['first', 'back', 'toggle', 'forward']));

  // --- 3. Option buttons ---
  const options = () => page.$eval('#option-buttons', b => (getComputedStyle(b).display === 'none' ? null : [...b.children].map(c => c.textContent)));
  check('phase 1 has options: Option A and Option B buttons', eq(await options(), ['Option A', 'Option B']), JSON.stringify(await options()));
  await page.keyboard.press('ArrowRight');
  check('phase 2 has none: no option buttons', (await options()) === null);
  await page.keyboard.press('ArrowLeft');
  await click(page, '[data-option="B"]');
  const sB = buildSchedule(play, 0, { option: 'B' });
  check('Option B plays this phase', (await pb(page)).playing && (await shown(page)) === 0
    && (await page.$eval('[data-option="B"]', b => b.getAttribute('aria-pressed'))) === 'true');
  check('with B chosen, B draws as the main option and A as the alternative', await page.evaluate(() =>
    !document.querySelector('#ball-routes-layer [data-id="r4"]').classList.contains('option-alt') && document.querySelector('#ball-routes-layer [data-id="r3"]').classList.contains('option-alt')));
  await advance(page, sB.flights[0].end);
  d = await drawn(page);
  check('Option B: the ball follows B to 13', near(d.o1, { x: d.a13.x + 1.1, y: d.a13.y + 0.9 }, 1e-6), JSON.stringify([d.o1, d.a13]));
  await advance(page, sB.total);
  d = await drawn(page);
  check('Option B: stops at the end of the phase, still on phase 1, ball with 13', !(await pb(page)).playing && (await shown(page)) === 0 && near(d.o1, { x: d.a13.x + 1.1, y: d.a13.y + 0.9 }, 1e-6));
  await click(page, '[data-option="A"]');
  await advance(page, s0.flights[0].end);
  d = await drawn(page);
  check('Option A plays as usual: the ball goes to 12', near(d.o1, { x: d.a12.x + 1.1, y: d.a12.y + 0.9 }, 1e-6), JSON.stringify(d.o1));
  await advance(page, s0.total - (await pb(page)).time + 1);
  check('and carries on into phase 2', (await shown(page)) === 1 && (await pb(page)).playing);
  await page.keyboard.press('Space');
  await click(page, '[data-play="first"]');

  // --- 1. The pen pauses playback; marks stay until Clear ---
  await page.keyboard.press('Space');
  await advance(page, 900);
  const t0 = (await pb(page)).time;
  await click(page, '[data-play="pen"]');
  check('picking up the pen pauses playback on that frame', !(await pb(page)).playing && (await pb(page)).time === t0 && (await page.evaluate(() => rugbyPlayback.paused)));
  await drag(page, [30, 10], [40, 15]);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  check('the marks stay through phase changes', (await page.$$('#pen-layer .pen-mark')).length === 1);
  await page.keyboard.press('c');
  check('C clears them', (await page.$$('#pen-layer .pen-mark')).length === 0);
  await page.keyboard.press('p');

  // --- 10. I play by clicking a player ---
  await click(page, '[data-play="first"]');
  const tapPlayer = async id => {
    const c = await page.$eval(`#players-layer [data-id="${id}"] .body`, el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.click(c.x, c.y);
  };
  await tapPlayer('d10');
  let pick = await page.evaluate(() => ({
    value: document.getElementById('i-play').value,
    ring: !!document.querySelector('#players-layer [data-id="d10"] .me-ring'),
    mates: document.querySelector('#players-layer [data-id="d12"]').classList.contains('dim'),
    attack: [...document.querySelectorAll('#players-layer .player.attack')].every(g => !g.classList.contains('dim')),
  }));
  check('clicking a player picks them: the list follows, their team-mates fade, the attack stays', pick.value === 'd10' && pick.ring && pick.mates && pick.attack, JSON.stringify(pick));
  await tapPlayer('d10');
  check('clicking them again clears it', await page.evaluate(() => document.getElementById('i-play').value === '' && !document.querySelector('#pitch .dim')));
  await tapPlayer('a10');
  await tapPlayer('a12');
  check('clicking another player picks them instead', (await page.$eval('#i-play', s => s.value)) === 'a12');
  await page.select('#i-play', '');

  // --- 5. The controls never cover the note, which shows in full ---
  await page.evaluate(() => { window.playState.phases[0].note = 'A long note for the coach to read out: '.repeat(8).trim(); });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  const layout = await page.evaluate(() => {
    const r = sel => { const b = document.querySelector(sel).getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; };
    const c = document.getElementById('present-caption');
    return { bar: r('.phasebar'), caption: r('#present-caption'), pitch: r('#pitch'), full: c.scrollHeight <= c.clientHeight + 1, h: innerHeight, text: c.textContent.length };
  });
  check('Present: controls sit between the pitch and the caption, covering neither',
    layout.bar.top >= layout.pitch.bottom - 1 && layout.bar.bottom <= layout.caption.top + 1, JSON.stringify(layout));
  check('Present: the long caption is fully visible', layout.full && layout.caption.bottom <= layout.h + 1 && layout.text > 300, JSON.stringify(layout));
  await page.screenshot({ path: path.join(OUT, 'present-long-note.png') });

  // --- 9. Exit stops playback and unlocks editing ---
  await page.keyboard.press('Space');
  await advance(page, 900);
  await click(page, '[data-play="exit"]');
  check('Exit stops playback, drops the paused frame and unlocks editing', await page.evaluate(() =>
    !rugbyPlayback.playing && !rugbyPlayback.paused && !document.body.classList.contains('presenting')
    && !document.querySelector('[data-action="add-attack"]').disabled && !document.getElementById('phase-note').disabled));
  check('after Exit, players are drawn where they stand in the phase', eq((await drawn(page)).a10, play.phases[0].positions.a10));
  await drag(page, [45, 20], [47, 23]);
  check('after Exit, a player can be dragged', eq((await state(page)).phases[0].positions.a13, { x: 47, y: 23 }));
  check('editor: the legend still shows and toggles', await page.$eval('#legend', l => getComputedStyle(l).display !== 'none'));
  await click(page, '[data-layer="legend"]');
  check('editor: unticking Legend hides it', await page.$eval('#legend', l => getComputedStyle(l).display === 'none'));
  await click(page, '[data-layer="legend"]');

  // --- 4. Scrum template: the 10s stand on their 9's side ---
  await click(page, '#templates-button');
  await page.waitForSelector('.template-card[data-template="3"]');
  await page.$eval('.template-card[data-template="3"]', b => b.click());
  await sleep(100);
  const scrum = (await state(page)).phases[0];
  const mark = scrum.objects.find(o => o.type === 'scrum');
  check('Scrum template: each 10 is on the same side of the scrum as their 9',
    ['a', 'd'].every(t => Math.sign(scrum.positions[`${t}10`].y - mark.y) === Math.sign(scrum.positions[`${t}9`].y - mark.y)), JSON.stringify(mark));

  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(`\n${failed() ? `${failed()} FAILED` : 'ALL PASSED'}`);
process.exit(failed() ? 1 : 0);
