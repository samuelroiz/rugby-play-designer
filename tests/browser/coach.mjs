// Fixes for the phone viewer, Present mode, auto jobs and restoring a backup.
// 1. Viewer: picking a position at any moment (☰ while the whole play runs) follows that player from the
//    current phase, with their job line and cues, and none of the whole-play notes.
// 2. Present mode, I play: the chosen player's job line in the note's place and their cue bubbles; choosing
//    never moves the controls.
// 3. Pausing, then changing the speed, doesn't restart or resume playing (editor, Present mode, viewer).
// 4. The editor's "Your job" and "Cues", each with a one-line hint.
// 5. Auto jobs: "Box kick" only for 9 (or by a ruck), "Cover the backfield" for the back three.
// 6. Restore from backup keeps a library copy that's newer than the backup's ("kept newer").
import fs from 'node:fs';
import path from 'node:path';
import { open, click, state, check, failed, outDir, tap, toScreen, openId, plays, URL_, sleep, eq, pastePlay as paste } from './lib.mjs';
import { encodeShare } from '../../js/share.js';
import { animPlay } from '../anim-play.mjs';

const OUT = outDir('coach');
console.log(`Downloads: ${OUT}`);

const rect = (page, sel) => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });

// The animation play: 10 runs and passes to 12 (phase 1), 12 kicks (phase 2). 10 has a written job in phase 1,
// and cues: 12 "Hit it" at step 1 in phase 1, 10 "Chase" at step 1 in phase 2.
function cuePlay() {
  const p = animPlay();
  p.name = 'Coach fixes';
  p.phases[0].instructions = { a10: 'Flat, call for it early.' };
  p.phases[0].cues = [{ player: 'a12', step: 1, text: 'Hit it' }];
  p.phases[1].cues = [{ player: 'a10', step: 1, text: 'Chase' }];
  return p;
}

{
  console.log('\n== 1. Viewer: picking a position at any moment ==');
  const { browser, page, errors } = await open({ mobile: true });
  await page.goto('about:blank');
  await page.goto(`${new URL('view.html', URL_).href}#p=${await encodeShare(cuePlay())}`);
  await page.waitForSelector('#start:not([hidden])');
  const st = () => page.evaluate(() => window.rugbyViewer.state());
  await page.evaluate(() => { window.__frames = []; window.rugbyViewer.onFrame(f => window.__frames.push(f)); window.rugbyViewer.timeScale = 6; });
  await page.tap('#watch-all');
  await page.waitForFunction(() => window.rugbyViewer.state().phase === 1, { timeout: 20000 });
  let s = await st();
  check('watching the whole play, on phase 2, with its note', s.mode === 'whole' && s.phase === 1 && s.caption === 'Twelve kicks' && s.job === null, JSON.stringify(s));
  await page.tap('#home');
  await page.tap('#positions [data-id="a10"]');
  await sleep(50);
  s = await st();
  check('picking 10 then: following 10 from the start of phase 2, playing', s.mode === 'focus' && s.focus === 'a10' && s.phase === 1 && s.t < 800 && s.playing, JSON.stringify(s));
  const shown = await page.evaluate(() => ({
    caption: document.getElementById('caption').textContent, captionHidden: document.getElementById('caption').hidden,
    job: document.getElementById('job-box').hidden ? null : document.getElementById('job').textContent, who: document.getElementById('watch-who').textContent,
  }));
  check('…his job line, not the whole-play note', shown.captionHidden && shown.caption === '' && shown.job === 'Hold your spot' && shown.who === 'Attack 10', JSON.stringify(shown));
  await page.waitForFunction(() => window.rugbyViewer.state().bubbles.some(b => b.text === 'Chase'), { timeout: 10000 }).catch(() => null);
  check('…his cue for phase 2 pops up', (await st()).bubbles.some(b => b.text === 'Chase'), JSON.stringify((await st()).bubbles));
  await page.evaluate(() => { window.__frames = []; });
  await sleep(600);
  const frames = await page.evaluate(() => window.__frames.slice(-5));
  const inView = f => { const p = f.players.a10; const x = p.y; const y = -p.x; return x >= f.cam.x && x <= f.cam.x + f.cam.w && y >= f.cam.y && y <= f.cam.y + f.cam.h; };
  check('…the view follows him', frames.length > 0 && frames.every(f => f.mode === 'focus' && inView(f) && f.players.a12.opacity < 1), JSON.stringify(frames.map(f => f.mode)));
  // Switching straight from 10 to 12, mid phase.
  await page.tap('#home');
  await page.tap('#positions [data-id="a12"]');
  await sleep(50);
  s = await st();
  check('switching to 12 mid-play: following 12, on the same phase, with 12\'s job', s.mode === 'focus' && s.focus === 'a12' && s.phase >= 1 && s.job !== null && s.job.startsWith('Kick') && s.caption === '' && s.bubbles.length === 0, JSON.stringify(s));
  // After the end (or from a fresh link) a position starts at phase 1.
  await page.evaluate(() => { window.rugbyViewer.timeScale = 40; });
  await page.waitForFunction(() => window.rugbyViewer.state().ended, { timeout: 30000 });
  await page.tap('#another');
  await page.tap('#positions [data-id="a10"]');
  await sleep(50);
  s = await st();
  check('after the end, a position starts again from phase 1', s.mode === 'focus' && s.phase === 0 && s.job === 'Flat, call for it early.', JSON.stringify(s));

  console.log('\n== 3. Viewer: pause, then change the speed ==');
  await page.evaluate(() => { window.rugbyViewer.timeScale = 1; });
  await sleep(300);
  await page.tap('#toggle');
  const paused = await st();
  await page.tap('[data-speed="0.5"]');
  await sleep(400);
  const after = await st();
  check('paused, then 0.5×: still paused, same moment, same phase', !after.playing && after.speed === 0.5 && after.t === paused.t && after.phase === paused.phase, JSON.stringify([paused, after]));
  await page.tap('#toggle');
  await sleep(300);
  const resumed = await st();
  check('…and Play carries on from that moment at 0.5×', resumed.playing && resumed.phase === paused.phase && resumed.t > paused.t && resumed.t < paused.t + 400, JSON.stringify(resumed));
  check('viewer: no console errors or native dialogs', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== 2. Present mode: I play shows the job line and cues ==');
  const { browser, page, errors } = await open();
  await page.evaluate(() => { window.rugbyPlayback.timeScale = 0; });
  await paste(page, cuePlay());
  await click(page, '#present-button');
  await sleep(100);
  const layout = async () => ({ bar: await rect(page, '.phasebar'), pitch: await rect(page, '#pitch'), text: await rect(page, '#present-text') });
  const words = () => page.evaluate(() => ({
    note: document.getElementById('present-caption').textContent,
    noteShown: getComputedStyle(document.getElementById('present-caption')).visibility === 'visible' && !document.getElementById('present-caption').hidden,
    job: document.getElementById('present-job').hidden ? null : document.getElementById('present-job').textContent,
  }));
  const before = await layout();
  check('Present: the phase note as the caption', eq(await words(), { note: 'Ten runs, then the pass', noteShown: true, job: null }), JSON.stringify(await words()));
  await page.select('#i-play', 'a10');
  await sleep(50);
  let w = await words();
  check('I play 10: his job line in the note\'s place', !w.noteShown && w.job === '10Flat, call for it early.', JSON.stringify(w));
  check('…and the controls (and the pitch) don\'t move', eq(await layout(), before), JSON.stringify([before, await layout()]));
  const job = await page.$eval('#present-job', j => ({ lines: Math.round(j.getBoundingClientRect().height / parseFloat(getComputedStyle(j).lineHeight)), size: parseFloat(getComputedStyle(j).fontSize), note: parseFloat(getComputedStyle(document.getElementById('present-caption')).fontSize) }));
  check('…as large as the note (it fits the note\'s line), on no more than two lines', job.lines <= 2 && job.size === job.note && job.size >= 19, JSON.stringify(job));
  // A long job and a phase with no note: still nothing moves.
  await page.evaluate(() => { window.playState.phases[0].instructions.a10 = 'Flat and hard at the line, call for it early, then loop round twelve and look for the inside ball from thirteen'; });
  await page.select('#i-play', '');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  const plain = await layout();
  await page.select('#i-play', 'a10');
  await sleep(50);
  w = await words();
  const long = await page.$eval('#present-job', j => ({ fits: j.getBoundingClientRect().height <= 2 * parseFloat(getComputedStyle(j).lineHeight) + 2, all: j.scrollHeight <= j.clientHeight + 1 }));
  check('a long job line is shrunk to two lines, all of it shown, and nothing moves', w.job.endsWith('from thirteen') && long.fits && long.all && eq(await layout(), plain), JSON.stringify([long, plain, await layout()]));
  await page.select('#i-play', '');
  await page.evaluate(() => { window.playState.phases[1].note = ''; });
  await page.keyboard.press('ArrowRight');
  const noNote = await layout();
  await page.select('#i-play', 'a12');
  await sleep(50);
  check('a phase with no note: I play shows the job, and nothing moves', (await words()).job === '12Kick' && eq(await layout(), noNote), JSON.stringify([noNote, await layout(), await words()]));
  // Clicking a player picks them too; None brings the note back, nothing moving.
  await page.select('#i-play', '');
  await page.keyboard.press('ArrowLeft');
  const back = await layout();
  const p12 = await toScreen(page, 45, 40);
  await page.mouse.click(p12.x, p12.y);
  await sleep(50);
  check('clicking 12 on the pitch picks him: his job line', (await words()).job === '12Run your line, then take the pass from 10' && eq(await layout(), back), JSON.stringify(await words()));

  // Cue bubbles: 12's "Hit it" pops up at step 1, next to him, and goes after about 1.5 s.
  const sched = await page.evaluate(async () => {
    const { buildSchedule } = await import(new URL('js/animate.js', location.href));
    const s = buildSchedule(window.playState, 0);
    return { first: Math.min(...s.moves.map(m => m.start)) };
  });
  const bubble = () => page.evaluate(() => {
    const g = document.querySelector('#present-cue-layer .present-cue');
    if (!g) return null;
    const b = g.getBoundingClientRect();
    const d = document.querySelector('#players-layer [data-id="a12"] .body').getBoundingClientRect();
    const p = document.getElementById('pitch').getBoundingClientRect();
    const overlap = !(b.right <= d.left || b.left >= d.right || b.bottom <= d.top || b.top >= d.bottom);
    const inside = b.left >= p.left - 1 && b.right <= p.right + 1 && b.top >= p.top - 1 && b.bottom <= p.bottom + 1;
    const near = Math.hypot((b.left + b.right) / 2 - (d.left + d.right) / 2, (b.top + b.bottom) / 2 - (d.top + d.bottom) / 2) < 200;
    return { text: g.textContent, overlap, inside, near, h: b.height };
  });
  await page.keyboard.press('Space');
  await page.evaluate(ms => window.rugbyPlayback.advance(ms), sched.first - 50);
  check('before step 1: no bubble', (await bubble()) === null);
  await page.evaluate(() => window.rugbyPlayback.advance(100));
  let b = await bubble();
  check('as step 1 starts: "HIT IT" in a bubble next to 12, inside the pitch, clear of his disc', b?.text === 'HIT IT' && b.inside && !b.overlap && b.near && b.h > 18, JSON.stringify(b));
  await page.evaluate(() => window.rugbyPlayback.advance(400));
  b = await bubble();
  check('…it moves with him while it\'s up', b?.text === 'HIT IT' && !b.overlap, JSON.stringify(b));
  await page.keyboard.press('Space');
  await sleep(100);
  check('paused: the bubble stays', (await bubble())?.text === 'HIT IT');
  check('…and the job line stays (12\'s, not the note)', (await words()).job === '12Run your line, then take the pass from 10');
  await page.keyboard.press('Space');
  await page.evaluate(() => window.rugbyPlayback.advance(1200));
  check('after about 1.5 s the bubble goes', (await bubble()) === null);
  // Another player's cues don't show.
  await page.evaluate(() => window.rugbyPlayback.stop());
  await page.select('#i-play', 'a10');
  await page.keyboard.press('Space');
  await page.evaluate(ms => window.rugbyPlayback.advance(ms), sched.first + 50);
  check('I play 10: 12\'s cue doesn\'t show', (await bubble()) === null);
  await page.evaluate(() => window.rugbyPlayback.stop());
  // Choosing while playing doesn't move anything either.
  const playingBefore = await layout();
  await page.select('#i-play', '');
  await page.keyboard.press('Space');
  await page.evaluate(() => window.rugbyPlayback.advance(300));
  await page.select('#i-play', 'a12');
  await sleep(50);
  check('choosing I play while playing: the controls stay where they are', eq(await layout(), playingBefore), JSON.stringify([playingBefore, await layout()]));
  await page.evaluate(() => window.rugbyPlayback.stop());
  await page.keyboard.press('Escape');
  await sleep(100);
  check('leaving Present mode: no job line or bubbles left', await page.evaluate(() => !document.querySelector('#present-cue-layer *') && getComputedStyle(document.getElementById('present-text')).display === 'none'));

  console.log('\n== 3. Editor and Present mode: pause, then change the speed ==');
  const pb = () => page.evaluate(() => ({ playing: rugbyPlayback.playing, paused: rugbyPlayback.paused, t: rugbyPlayback.time, phase: rugbyPlayback.shownPhase, a10: document.querySelector('#players-layer [data-id="a10"]').getAttribute('transform') }));
  for (const where of ['editor', 'Present mode']) {
    if (where === 'Present mode') await click(page, '#present-button');
    await page.keyboard.press('Space');
    await page.evaluate(() => window.rugbyPlayback.advance(1700));
    await page.keyboard.press('Space');
    const held = await pb();
    for (const speed of ['2', '0.5', '1']) {
      await page.click(`[data-speed="${speed}"]`);
      await sleep(50);
      const now = await pb();
      check(`${where}: paused, then ${speed}×: still paused on the same frame`, eq(now, held) && (await page.evaluate(() => rugbyPlayback.speed)) === Number(speed), JSON.stringify([held, now]));
    }
    await page.click('[data-speed="2"]');
    await page.keyboard.press('Space');
    await page.evaluate(() => window.rugbyPlayback.advance(100));
    const on = await pb();
    check(`${where}: Play carries on from that moment, at the new speed`, on.playing && on.phase === held.phase && Math.abs(on.t - (held.t + 200)) < 1e-6, JSON.stringify([held, on]));
    await page.evaluate(() => window.rugbyPlayback.stop());
    await page.click('[data-speed="1"]');
    if (where === 'Present mode') await page.keyboard.press('Escape');
  }

  console.log('\n== 4. Editor labels ==');
  await page.evaluate(() => window.rugbyPlayback.jump(0));
  await tap(page, 39.4, 29.6); // 10
  await sleep(50);
  const labels = await page.evaluate(() => {
    const shownText = id => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none' ? el.textContent.trim() : null; };
    const hint = document.getElementById('instruction-hint');
    return {
      job: shownText('instruction-title'), jobHint: shownText('instruction-hint'), cues: shownText('cues-title'), cuesHint: shownText('cues-hint'),
      hintLines: Math.round(hint.getBoundingClientRect().height / parseFloat(getComputedStyle(hint).lineHeight)),
      order: [...document.getElementById('instruction-group').querySelectorAll('h2, .side-hint, textarea, #cue-list')].map(e => e.id),
    };
  });
  check('"Your job" with its hint under it: "One line shown at the bottom of the phone viewer."', labels.job === 'Your job' && labels.jobHint === 'One line shown at the bottom of the phone viewer.', JSON.stringify(labels));
  check('"Cues" with its hint under it: "Short shouts that pop up at a moment."', labels.cues === 'Cues' && labels.cuesHint === 'Short shouts that pop up at a moment.', JSON.stringify(labels));
  check('…each hint sits between its label and its box', eq(labels.order, ['instruction-title', 'instruction-hint', 'player-instruction', 'cues-title', 'cues-hint', 'cue-list']), labels.order.join());
  check('the job box is still labelled with the player', (await page.$eval('#player-instruction', t => t.getAttribute('aria-label'))) === "10's job in this phase");
  await page.keyboard.press('Escape');
  check('Present mode / editing: no console errors or native dialogs', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== 5. Auto jobs in the editor and the viewer ==');
  const { browser, page, errors } = await open();
  const pl = ids => ids.map(id => ({ id, team: 'attack', label: id.slice(1) }));
  const pos = { a9: { x: 50, y: 30 }, a10: { x: 44, y: 32 }, a13: { x: 40, y: 48 }, a14: { x: 36, y: 62 }, a15: { x: 30, y: 35 } };
  const R = (id, type, from, points, order = 1) => ({ id, type, from, to: null, points, curve: 0, order, option: null });
  await paste(page, {
    schemaVersion: 1, name: 'Kicks', category: 'attack', tags: [], view: 'full', orientation: 'horizontal', players: pl(Object.keys(pos)),
    phases: [
      // 9 box kicks; 13 chases; 15 holds deep; 14 drops back.
      { note: '', positions: pos, objects: [{ id: 'o1', type: 'ball', x: 51.1, y: 30.9 }], routes: [R('r1', 'kick', 'a9', [[50, 30], [72, 30]]), R('r2', 'run', 'a13', [[40, 48], [66, 34]]), R('r3', 'run', 'a14', [[36, 62], [30, 60]])] },
      // 10 kicks the same length: "Kick".
      { note: '', positions: pos, objects: [{ id: 'o1', type: 'ball', x: 45.1, y: 32.9 }], routes: [R('r1', 'kick', 'a10', [[44, 32], [66, 32]])] },
    ],
  });
  const placeholder = async (x, y) => { await tap(page, x, y); await sleep(50); const p = await page.$eval('#player-instruction', t => t.placeholder); await page.keyboard.press('Escape'); return p; };
  check('9\'s 22 m kick: "Box kick"', (await placeholder(49.4, 29.6)) === '9: Box kick');
  check('15 deep while 13 chases: "Cover the backfield"', (await placeholder(30, 35)) === '15: Cover the backfield');
  check('14 running back: "Cover the backfield"', (await placeholder(36, 62)) === '14: Cover the backfield');
  check('13 chasing: "Chase the kick"', (await placeholder(40, 48)) === '13: Chase the kick');
  await page.$eval('#phase-tabs [data-index="1"]', b => b.click());
  await sleep(50);
  check('10\'s kick of the same length: "Kick", not "Box kick"', (await placeholder(43.4, 31.6)) === '10: Kick');
  check('auto jobs: no console errors or native dialogs', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== 6. Restore from backup keeps a newer library copy ==');
  const { browser, page, errors } = await open({ downloads: OUT });
  await paste(page, { ...animPlay(), name: 'Mine' });
  await sleep(600); // the autosave
  const id = await openId(page);
  const here = (await plays(page)).find(p => p.id === id);
  const entry = (name, updated, extra = {}) => ({ id, created: here.updated - 1e6, updated, deleted: false, deletedAt: null, phase: 0, play: { ...structuredClone(here.play), name }, ...extra });
  const file = path.join(OUT, 'backup.json');
  const restore = async entries => {
    fs.writeFileSync(file, JSON.stringify({ app: 'rugby-play-designer', kind: 'plays-backup', version: 1, saved: new Date().toISOString(), plays: entries }));
    await click(page, '#plays-button');
    await page.waitForSelector('#plays-dialog[open]');
    await page.$eval('#plays-status', s => { s.hidden = true; s.textContent = ''; });
    await (await page.$('#restore-input')).uploadFile(file);
    await page.waitForFunction(() => !document.getElementById('plays-status').hidden, { timeout: 5000 });
    const summary = await page.$eval('#plays-status', s => s.textContent);
    await page.keyboard.press('Escape');
    await sleep(100);
    return summary;
  };
  const count = async () => (await plays(page)).filter(p => !p.deleted).length;
  const n = await count();
  let summary = await restore([entry('Mine, an older version', here.updated - 60000)]);
  let after = await plays(page);
  check('an older version of a play that\'s here: kept newer, no "(restored)" copy', summary === 'Added 0 plays, 1 kept newer (the copy here is newer)' && (await count()) === n && !after.some(p => p.name.includes('(restored)')), summary);
  check('…the play here is untouched', after.find(p => p.id === id)?.name === 'Mine' && after.find(p => p.id === id).updated === here.updated);
  summary = await restore([entry('Mine, a newer version', here.updated + 60000)]);
  after = await plays(page);
  check('a newer version: added as a "(restored)" copy beside it', summary === 'Added 1 play' && after.some(p => p.name === 'Mine, a newer version (restored)' && p.id !== id) && after.find(p => p.id === id)?.name === 'Mine', summary);
  const untimed = entry('Mine, no time');
  delete untimed.updated;
  summary = await restore([untimed]);
  after = await plays(page);
  check('a different version with no update time to compare: a "(restored)" copy', summary === 'Added 1 play' && after.some(p => p.name === 'Mine, no time (restored)'), summary);
  summary = await restore([entry('Mine', here.updated - 60000, { play: here.play })]);
  check('the same play: skipped (already here), whatever its time', summary === 'Added 0 plays, 1 skipped (already here)', summary);
  check('restore: no console errors or native dialogs', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(failed() ? `\n${failed()} FAILED` : '\nALL PASSED');
process.exit(failed() ? 1 : 0);
