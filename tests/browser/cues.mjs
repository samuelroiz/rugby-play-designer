// Position cues and jobs. Editor (desktop 1440x900): "Your job" with the made job as its
// placeholder, the Cues list (add, edit, delete, Escape, undo and redo, autosaved), the cue bubbles on the pitch
// while the player is selected and never in a PNG, deleting a player taking their cues, and the share link
// carrying cues. Viewer (390x844, touch): the job line (written vs made, at most 2 lines), a cue bubble at its
// step (inside the view, clear of the player, only the followed player's), the slowdown, the Coach's note
// sheet, and the whole play's long note never cut off. Save animation: Who, a position's GIF (720x1280, the cue
// and job drawn in its frames, its file name) and video (1080x1920).
import fs from 'node:fs';
import path from 'node:path';
import { open, click, state, check, failed, tap, outDir, URL_, sleep, eq, pastePlay } from './lib.mjs';
import { animPlay } from '../anim-play.mjs';
import { buildSchedule, TIMING } from '../../js/animate.js';

const OUT = outDir('cues');
console.log(`Downloads: ${OUT}`);

// The animation play with cues for 12 in phases 1 and 2 and for 10 in phase 2, a written job for 12 in
// phase 2 (phase 1's is made from 12's routes), and a long note on phase 1.
const LONG = 'Ten runs at the line and holds the defence before passing to twelve, who has run a hard line off his shoulder. '
  + 'Thirteen stays wide to keep their outside defender honest, and the forwards fill the next ruck. '
  + 'If their twelve rushes up early, look for the space in behind them for the kick.';
const play = animPlay();
play.name = 'Cue play';
play.phases[0].note = LONG;
play.phases[0].cues = [{ player: 'a12', step: 1, text: 'Jump!' }];
play.phases[1].cues = [{ player: 'a12', step: 1, text: 'Kick it' }, { player: 'a10', step: 1, text: 'Chase!' }];
play.phases[1].instructions = { a12: 'Kick long.' };
const JOB_12 = ['Run your line, then take the pass from 10', 'Kick long.', 'Hold your spot'];

const cues = async (page, i = 0) => (await state(page)).phases[i].cues;
const panel = page => page.evaluate(() => ({
  hidden: document.getElementById('instruction-group').hidden,
  title: document.getElementById('instruction-title').textContent,
  placeholder: document.getElementById('player-instruction').placeholder,
  list: [...document.querySelectorAll('#cue-list li')].map(li => [li.querySelector('.cue-text').textContent, li.querySelector('.cue-at').textContent]),
  form: !document.getElementById('cue-form').hidden,
  add: !document.getElementById('cue-add').hidden,
  marks: [...document.querySelectorAll('#cue-layer .cue-mark-text')].map(t => t.textContent),
}));
// Every picture the app serializes, summed up: its size and the texts of interest.
const watchPictures = page => page.evaluate(() => {
  window.__pics = [];
  const orig = XMLSerializer.prototype.serializeToString;
  XMLSerializer.prototype.serializeToString = function (n) {
    const s = orig.call(this, n);
    const outer = s.match(/^<svg[^>]*>/)?.[0] ?? '';
    const texts = cls => [...s.matchAll(new RegExp(`<text[^>]*class="${cls}"[^>]*>([^<]*)<`, 'g'))].map(m => m[1]);
    window.__pics.push({
      w: Number(outer.match(/ width="([\d.]+)"/)?.[1] ?? 0),
      h: Number(outer.match(/ height="([\d.]+)"/)?.[1] ?? 0),
      label: texts('export-caption')[0] ?? null,
      cue: texts('export-cue'),
      job: texts('export-job'),
      cueMarks: /class="cue-mark/.test(s), // the class, not the page's CSS, which every picture embeds
      ring: /class="me-ring"/.test(s),
    });
    return s;
  };
});
const pictures = page => page.evaluate(() => window.__pics.splice(0));

// ===================== Editor =====================
console.log('\n== Editor: job and cues ==');
let { browser, page, errors } = await open({ downloads: OUT });
await watchPictures(page);
const base = animPlay();
base.name = 'Cue edit';
await pastePlay(page, base);
await tap(page, 45, 40); // 12
await sleep(100);
let p = await panel(page);
check('selecting 12: "Your job", the made job as the placeholder, no cues yet', !p.hidden && p.title === 'Your job' && p.placeholder === `12: ${JOB_12[0]}` && p.list.length === 0 && !p.form && p.add, JSON.stringify(p));
await click(page, '#cue-add');
const form = await page.evaluate(() => ({
  shown: !document.getElementById('cue-form').hidden,
  focused: document.activeElement?.id,
  steps: [...document.getElementById('cue-step').options].map(o => [o.value, o.selected]),
  max: document.getElementById('cue-text').maxLength,
}));
check('Add cue: a text box (30 characters) with the focus, and "at step" listing this phase\'s steps (12\'s first route\'s step chosen)', form.shown && form.focused === 'cue-text' && form.max === 30 && eq(form.steps, [['1', true], ['2', false]]), JSON.stringify(form));
await page.keyboard.type('jump!');
await page.keyboard.press('Enter');
await sleep(50);
check('Enter saves it in phases[0].cues', eq(await cues(page), [{ player: 'a12', step: 1, text: 'jump!' }]), JSON.stringify(await cues(page)));
p = await panel(page);
check('…listed in capitals with its step, the form closed', eq(p.list, [['JUMP!', 'step 1']]) && !p.form && p.add, JSON.stringify(p));
check('…and shown as a bubble over 12 on the pitch', eq(p.marks, ['JUMP!']), JSON.stringify(p.marks));
await click(page, '#cue-add');
await page.keyboard.type('Hold');
await page.select('#cue-step', '2');
await click(page, '#cue-save');
await sleep(50);
check('a second cue at step 2 (Save)', eq(await cues(page), [{ player: 'a12', step: 1, text: 'jump!' }, { player: 'a12', step: 2, text: 'Hold' }]));
p = await panel(page);
check('…both listed and on the pitch, in step order', eq(p.list, [['JUMP!', 'step 1'], ['HOLD', 'step 2']]) && eq(p.marks, ['JUMP!', 'HOLD']), JSON.stringify(p));
await click(page, '[data-action="undo"]');
check('Undo takes the second away', eq(await cues(page), [{ player: 'a12', step: 1, text: 'jump!' }]), JSON.stringify(await cues(page)));
check('…from the list and the pitch too', eq((await panel(page)).marks, ['JUMP!']));
await click(page, '[data-action="redo"]');
check('Redo brings it back', (await cues(page))?.length === 2);
await click(page, '#cue-list [data-cue-action="edit"][data-index="0"]');
const editing = await page.evaluate(() => ({ text: document.getElementById('cue-text').value, step: document.getElementById('cue-step').value, listed: document.querySelectorAll('#cue-list li').length }));
check('Edit: the form holds the cue (and it leaves the list meanwhile)', editing.text === 'jump!' && editing.step === '1' && editing.listed === 1, JSON.stringify(editing));
await page.$eval('#cue-text', t => { t.value = ''; });
await page.keyboard.type('Jump now');
await page.select('#cue-step', '2');
await page.keyboard.press('Enter');
await sleep(50);
check('…saving changes it in place', eq(await cues(page), [{ player: 'a12', step: 2, text: 'Jump now' }, { player: 'a12', step: 2, text: 'Hold' }]), JSON.stringify(await cues(page)));
await click(page, '#cue-list [data-cue-action="edit"][data-index="1"]');
await page.keyboard.type(' xx');
await page.keyboard.press('Escape');
await sleep(50);
p = await panel(page);
check('Escape closes the form and changes nothing; 12 stays selected', !p.form && !p.hidden && eq(await cues(page), [{ player: 'a12', step: 2, text: 'Jump now' }, { player: 'a12', step: 2, text: 'Hold' }]), JSON.stringify(p));
await click(page, '#cue-list [data-cue-action="delete"][data-index="1"]');
check('Delete removes it', eq(await cues(page), [{ player: 'a12', step: 2, text: 'Jump now' }]));
await click(page, '#cue-list [data-cue-action="delete"][data-index="0"]');
let s = await state(page);
check('…and with none left the phase has no cues field', !('cues' in s.phases[0]), JSON.stringify(s.phases[0].cues));
await click(page, '[data-action="undo"]');
check('Undo brings the deleted cue back', eq(await cues(page), [{ player: 'a12', step: 2, text: 'Jump now' }]));
const readSaved = () => page.evaluate(async () => { const lib = window.rugbyLibrary; await lib.settled(); return (await lib.read(lib.openId())).play.phases[0].cues ?? null; });
let saved = null;
for (let i = 0; i < 30 && !eq(saved, [{ player: 'a12', step: 2, text: 'Jump now' }]); i++) { saved = await readSaved(); await sleep(100); }
check('cues are autosaved', eq(saved, [{ player: 'a12', step: 2, text: 'Jump now' }]), JSON.stringify(saved));
await page.$eval('#phase-tabs [data-index="1"]', b => b.click());
await sleep(50);
p = await panel(page);
check('another phase: its own cues (none) and its own made job', p.hidden || (p.list.length === 0 && p.marks.length === 0 && p.placeholder === '12: Kick'), JSON.stringify(p)); // 12's 30 m kick, not from 9 or a ruck
await page.$eval('#phase-tabs [data-index="0"]', b => b.click());
await tap(page, 45, 40);
await sleep(50);
await pictures(page);
await click(page, '#file-menu summary');
await click(page, '[data-file="png"]');
await page.waitForSelector('#image-dialog[open]');
await click(page, '[data-image="phase"]');
await page.waitForFunction(() => window.__pics.length > 0, { timeout: 10000 }).catch(() => null);
await sleep(300);
const png = await pictures(page);
check('a PNG has no cue bubbles, even with 12 selected', png.length > 0 && png.every(q => !q.cueMarks), JSON.stringify(png));
await page.keyboard.press('Escape');
await sleep(50);
check('nothing selected: no bubbles on the pitch', (await page.$$eval('#cue-layer *', els => els.length)) === 0);
await tap(page, 45, 40);
await sleep(50);
await page.keyboard.press('Delete');
await sleep(50);
s = await state(page);
check('deleting 12 takes their cues with them', s.phases.every(ph => !ph.cues), JSON.stringify(s.phases.map(ph => ph.cues)));
await browser.close();

console.log('\n== Editor: share link with cues ==');
({ browser, page, errors } = await open());
await pastePlay(page, play);
await page.evaluate(() => { window.__copied = []; navigator.clipboard.writeText = async t => { window.__copied.push(t); }; });
await click(page, '#file-menu summary');
await click(page, '[data-file="share"]');
await page.waitForFunction(() => document.getElementById('share-url').value && !document.getElementById('share-copy').disabled, { timeout: 10000 }).catch(() => null);
await click(page, '#share-copy');
await page.waitForFunction(() => window.__copied.length > 0, { timeout: 5000 }).catch(() => null);
const url = await page.evaluate(() => window.__copied.at(-1) ?? null);
const decoded = url && await page.evaluate(u => import('./js/share.js').then(m => m.decodeShare(m.hashData(new URL(u).hash))), url);
check('the share link carries the cues (and instructions)', eq(decoded?.play.phases.map(ph => ph.cues ?? null), play.phases.map(ph => ph.cues ?? null)) && eq(decoded.play.phases[1].instructions, play.phases[1].instructions), JSON.stringify(decoded?.play.phases.map(ph => ph.cues)));
check('editor: no console errors', errors.length === 0, errors.join(' | '));
await browser.close();

// ===================== Viewer =====================
console.log('\n== Viewer: job line and cues ==');
({ browser, page, errors } = await open({ mobile: true }));
await page.goto('about:blank');
await page.goto(url);
await page.waitForSelector('#start:not([hidden])');
await page.evaluate(() => {
  window.__frames = [];
  window.rugbyViewer.timeScale = 2;
  window.rugbyViewer.onFrame(f => window.__frames.push({ ...f, job: document.getElementById('job-box').hidden ? null : document.getElementById('job').textContent }));
});
await page.tap('#positions [data-id="a12"]');
await sleep(100);
const job = await page.evaluate(() => {
  const el = document.getElementById('job');
  const cs = getComputedStyle(el);
  return { text: el.textContent, px: parseFloat(cs.fontSize), lineH: parseFloat(cs.lineHeight), h: el.clientHeight, sh: el.scrollHeight, weight: cs.fontWeight, caption: document.getElementById('caption').hidden, note: !document.getElementById('note-button').hidden };
});
check('following 12: the job line is the job made from 12\'s routes (no written one in phase 1)', job.text === JOB_12[0], job.text);
check('…large, bold, on at most 2 lines and not cut', job.px >= 20 && Number(job.weight) >= 700 && job.h <= 2 * job.lineH + 1 && job.sh <= job.h + 1, JSON.stringify(job));
check('…with a Coach\'s note button, and the note itself not on screen', job.note && job.caption, JSON.stringify(job));
await page.tap('#note-button');
await sleep(100);
const sheet = await page.evaluate(() => ({ open: document.getElementById('note-sheet').open, note: document.getElementById('sheet-note').textContent, job: document.getElementById('sheet-job').textContent, playing: window.rugbyViewer.state().playing }));
check('Coach\'s note opens a sheet with the whole phase note (and the job), paused', sheet.open && sheet.note === LONG && sheet.job === JOB_12[0] && !sheet.playing, JSON.stringify({ ...sheet, note: sheet.note.slice(0, 40) }));
await page.tap('#note-close');
await sleep(100);
const closed = await page.evaluate(() => ({ open: document.getElementById('note-sheet').open, playing: window.rugbyViewer.state().playing }));
check('…Close shuts it and playing carries on', !closed.open && closed.playing, JSON.stringify(closed));
await page.evaluate(() => { window.__frames = []; });
await page.waitForFunction(() => window.rugbyViewer.state().mode === 'replay', { timeout: 60000 }).catch(() => null);
const frames = await page.evaluate(() => window.__frames.filter(f => f.mode === 'focus'));
const jobs = [0, 1, 2].map(i => [...new Set(frames.filter(f => f.phase === i).map(f => f.job))]);
check('the job line per phase: made, then written ("Kick long."), then made', eq(jobs, JOB_12.map(j => [j])), JSON.stringify(jobs));
const sched = [0, 1].map(i => buildSchedule(play, i));
const firstBubble = i => frames.findIndex(f => f.phase === i && f.bubble);
const b0 = firstBubble(0);
check('a cue bubble pops up as its step starts (phase 1, step 1)', b0 > 0 && frames[b0 - 1].t < TIMING.lead && frames[b0].t >= TIMING.lead && frames[b0].bubble.text === 'JUMP!', JSON.stringify(frames[b0]?.bubble));
const up = frames.filter(f => f.phase === 0 && f.bubble);
const inside = b => b.left >= 0 && b.top >= 0 && b.left + b.w <= b.width && b.top + b.h <= b.height;
const clear = b => b.left + b.w <= b.player.x - b.player.r || b.left >= b.player.x + b.player.r || b.top + b.h <= b.player.y - b.player.r || b.top >= b.player.y + b.player.r;
check(`…in capitals, inside the view and clear of 12 on every frame it shows (${up.length})`, up.length > 5 && up.every(f => inside(f.bubble) && clear(f.bubble)), JSON.stringify(up.find(f => !inside(f.bubble) || !clear(f.bubble))?.bubble));
const shownMs = up.reduce((ms, f) => ms + f.wall, 0);
check(`…for about 1.5 s (${Math.round(shownMs)} ms)`, shownMs > 1300 && shownMs < 1750);
const slow = frames.slice(b0 + 1).filter((f, k) => k + b0 + 1 < frames.length && frames[b0 + k].factor === 0.5 && f.phase === frames[b0 + k].phase);
const rates = slow.map(f => (f.t - frames[frames.indexOf(f) - 1].t) / f.wall);
check(`playback eases to half speed meanwhile (${slow.length} frames)`, slow.length > 3 && rates.every(r => Math.abs(r - 0.5) < 0.02), JSON.stringify(rates.slice(0, 6)));
const later = frames.filter(f => f.phase === 0 && !f.bubble && f.t > frames[b0].t + 2000);
const fast = later.slice(1).map(f => (f.t - frames[frames.indexOf(f) - 1].t) / f.wall);
check('…and back to full speed afterwards', fast.length > 3 && fast.every(r => Math.abs(r - 1) < 0.02), JSON.stringify(fast.slice(0, 6)));
const b1 = firstBubble(1);
check('phase 2: 12\'s own cue only (not 10\'s)', b1 > 0 && frames.filter(f => f.phase === 1 && f.bubble).every(f => f.bubble.text === 'KICK IT') && frames[b1].t >= sched[1].moves.concat(sched[1].flights).reduce((m, x) => Math.min(m, x.start), Infinity), JSON.stringify(frames[b1]?.bubble));
check('no bubble in phase 3 (no cues there)', frames.filter(f => f.phase === 2).every(f => !f.bubble));
const replay = await page.evaluate(() => window.__frames.filter(f => f.mode !== 'focus'));
check('no bubbles in the replay of the whole play', replay.every(f => !f.bubble));

console.log('\n== Viewer: following 10, and the whole play ==');
await page.waitForFunction(() => window.rugbyViewer.state().ended, { timeout: 60000 }).catch(() => null);
await page.tap('#another');
await page.evaluate(() => { window.__frames = []; });
await page.tap('#positions [data-id="a10"]');
await page.waitForFunction(() => window.rugbyViewer.state().mode === 'replay', { timeout: 60000 }).catch(() => null);
const ten = await page.evaluate(() => window.__frames.filter(f => f.mode === 'focus' && f.bubble).map(f => [f.phase, f.bubble.text]));
check('following 10: only 10\'s cue (phase 2 "CHASE!")', ten.length > 0 && ten.every(([ph, text]) => ph === 1 && text === 'CHASE!'), JSON.stringify([...new Set(ten.map(String))]));
await page.waitForFunction(() => window.rugbyViewer.state().ended, { timeout: 60000 }).catch(() => null);
await page.tap('#another');
await page.tap('#watch-all');
await page.evaluate(() => { window.rugbyViewer.timeScale = 0; });
await sleep(100);
const cap = await page.evaluate(() => {
  const c = document.getElementById('caption');
  return { text: c.textContent, hidden: c.hidden, job: !document.getElementById('job-box').hidden, more: c.classList.contains('more'), overflow: getComputedStyle(c).overflowY, sh: c.scrollHeight, h: c.clientHeight };
});
check('whole play: the phase note in full, word for word (never cut)', cap.text === LONG && !cap.hidden && !cap.job, cap.text.slice(-40));
check('…a long one scrolls, and shows there is more', cap.more && cap.overflow === 'auto' && cap.sh > cap.h, JSON.stringify(cap));
await page.tap('#caption');
await sleep(100);
const open2 = await page.evaluate(() => {
  const c = document.getElementById('caption');
  return { expanded: c.classList.contains('expanded'), more: c.classList.contains('more'), sh: c.scrollHeight, h: c.clientHeight, stage: document.getElementById('stage').clientHeight, scroll: document.documentElement.scrollHeight - innerHeight };
});
check('…a tap shows all of it, the pitch still there', open2.expanded && !open2.more && open2.sh <= open2.h + 1 && open2.stage > 150 && open2.scroll <= 0, JSON.stringify(open2));
await page.tap('#caption');
await sleep(50);
check('…and another tap folds it back', !(await page.$eval('#caption', c => c.classList.contains('expanded'))));
check('viewer: no console errors', errors.length === 0, errors.join(' | '));
await browser.close();

// ===================== Save animation: a position =====================
console.log('\n== Save animation: a position ==');
({ browser, page, errors } = await open({ downloads: OUT }));
await pastePlay(page, play);
await watchPictures(page);
await click(page, '#file-menu summary');
await click(page, '[data-file="animation"]');
await page.waitForSelector('#animation-dialog[open]');
const who = await page.$$eval('#animation-who option', os => os.map(o => [o.value, o.textContent, o.selected]));
check('Who: "Whole team" (the default), then both teams, our team (the attack) first, named with their team', eq(who, [['', 'Whole team', true], ['a10', 'Attack 10', false], ['a12', 'Attack 12', false], ['a13', 'Attack 13', false], ['d10', 'Defense 10', false], ['d12', 'Defense 12', false]]), JSON.stringify(who));
await page.select('#animation-who', 'a12');
const choice = await page.evaluate(() => ({ size: document.getElementById('animation-size-choice').disabled, tip: !document.getElementById('animation-who-tip').hidden }));
check('…a position has its own upright size (Size is greyed out, a tip says so)', choice.size && choice.tip, JSON.stringify(choice));
await page.click('[name="animation-format"][value="gif"]');
await page.click('[name="animation-speed"][value="2"]');
await pictures(page);
await page.click('#animation-save');
const done = await page.waitForFunction(() => !document.getElementById('animation-dialog').open, { timeout: 240000 }).then(() => true, () => false);
let file = null;
for (let i = 0; i < 50 && !file; i++) { file = fs.readdirSync(OUT).find(f => f.endsWith('.gif')); if (!file) await sleep(100); }
await sleep(300);
check('a position\'s GIF is saved as "<play name> - Attack 12.gif"', done && file === 'Cue play - Attack 12.gif', String(file));
const buf = file ? fs.readFileSync(path.join(OUT, file)) : Buffer.alloc(10);
check(`…720 x 1280 (${buf.readUInt16LE(6)} x ${buf.readUInt16LE(8)}), ${Math.round(buf.length / 1024)} KB`, buf.readUInt16LE(6) === 720 && buf.readUInt16LE(8) === 1280);
const pics = (await pictures(page)).filter(q => q.w === 720);
check(`…every frame 720 x 1280 with "Attack 12" in its header (${pics.length})`, pics.length > 20 && pics.every(q => q.h === 1280 && /· Attack 12$/.test(q.label)), JSON.stringify(pics[0]));
check('…the cue drawn in its frames, in capitals', pics.some(q => eq(q.cue, ['JUMP!'])) && pics.some(q => eq(q.cue, ['KICK IT'])) && !pics.some(q => q.cue.includes('CHASE!')), JSON.stringify([...new Set(pics.map(q => q.cue.join()))]));
const jobText = q => q.job.join(' ');
check('…the job line under the pitch, phase by phase (made, written, made)', pics.some(q => q.label.startsWith('Phase 1') && jobText(q) === JOB_12[0]) && pics.some(q => q.label.startsWith('Phase 2') && jobText(q) === JOB_12[1]) && pics.every(q => q.job.length >= 1 && q.job.length <= 2), JSON.stringify([...new Set(pics.map(jobText))]));
check('…and 12 ringed in yellow', pics.every(q => q.ring));
const hasVideo = await page.evaluate(() => typeof MediaRecorder !== 'undefined' && !document.querySelector('[name="animation-format"][value="video"]').disabled);
if (hasVideo) {
  await click(page, '#file-menu summary');
  await click(page, '[data-file="animation"]');
  await page.waitForSelector('#animation-dialog[open]');
  check('the box keeps the position picked', (await page.$eval('#animation-who', s => s.value)) === 'a12');
  await page.click('[name="animation-format"][value="video"]');
  await pictures(page);
  await page.click('#animation-save');
  await page.waitForFunction(() => window.__pics.length > 4, { timeout: 30000 }).catch(() => null);
  const vids = await pictures(page);
  check('a position\'s video is 1080 x 1920', vids.length > 4 && vids.every(q => q.w === 1080 && q.h === 1920), JSON.stringify(vids[0]));
  await page.click('#animation-cancel');
  await page.waitForFunction(() => !document.getElementById('animation-dialog').open, { timeout: 30000 }).catch(() => null);
} else {
  console.log('(this browser can\'t record video: the video size check is skipped)');
}
check('export: no console errors', errors.length === 0, errors.join(' | '));
await browser.close();

console.log(`\n${failed() ? `${failed()} FAILED` : 'ALL PASSED'}`);
process.exit(failed() ? 1 : 0);
