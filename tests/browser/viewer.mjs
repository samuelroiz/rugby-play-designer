// Player instructions, File → Share link…, and the phone viewer (view.html) it links to.
// Editor (desktop 1440x900): the instruction box for a selected player (undoable, saved with the play), and
// Share link copying a working link, with the long-link warning and Drop the logo. Viewer (390x844, touch):
// the start screen's positions, following 10 (always in view, team-mates faded, opponents near 10 in full,
// 10's instruction or their made job as the job line), the zoom out and replay, the end screen and Share, swipes and
// buttons, the remembered position, Watch the whole play, broken links, and what the page loads.
import { open, click, state, check, failed, tap, URL_ } from './lib.mjs';
import { animPlay } from '../anim-play.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The animation play, with 10's instructions in phases 1 and 2 (in phase 3, 10's job is made from their
// routes: they have none).
const play = animPlay();
play.name = 'Ten follows';
play.phases[0].instructions = { a10: 'Flat, call for it early.' };
play.phases[1].instructions = { a10: 'Chase the kick.', a12: 'Kick long.' };
play.phases[2].note = 'Regroup at the ruck';
const NOTES = play.phases.map(ph => ph.note);
const FOR_10 = ['Flat, call for it early.', 'Chase the kick.', 'Hold your spot'];

async function pastePlay(page, p) {
  await click(page, '#file-menu summary');
  await click(page, '[data-file="paste"]');
  await page.waitForSelector('#paste-dialog[open]');
  await page.$eval('#paste-play-text', (t, text) => { t.value = text; t.dispatchEvent(new Event('input', { bubbles: true })); }, JSON.stringify(p));
  await click(page, '#paste-play-import');
  await sleep(150);
}
// File → Share link…; resolves with what was copied (the clipboard is stubbed) once the box says so.
async function shareLink(page) {
  await page.evaluate(() => { window.__copied = []; navigator.clipboard.writeText = async t => { window.__copied.push(t); }; });
  await click(page, '#file-menu summary');
  await click(page, '[data-file="share"]');
  await page.waitForSelector('#share-dialog[open]');
  await page.waitForFunction(() => window.__copied.length > 0, { timeout: 10000 }).catch(() => null);
  return page.evaluate(() => window.__copied.at(-1) ?? null);
}

// ===================== Editor =====================
console.log('\n== Editor: instructions ==');
let { browser, page, errors } = await open();
await pastePlay(page, animPlay());
check('no instruction box with nothing selected', await page.$eval('#instruction-group', g => g.hidden));
// 10's disc, on the side away from the ball they hold.
const p10 = { x: 39.4, y: 29.6 };
await tap(page, p10.x, p10.y);
await sleep(100);
const box = await page.evaluate(() => ({ hidden: document.getElementById('instruction-group').hidden, title: document.getElementById('instruction-title').textContent, value: document.getElementById('player-instruction').value, max: document.getElementById('player-instruction').maxLength }));
check('selecting 10: "Your job (this phase)", empty, at most 120 characters', !box.hidden && box.title === 'Your job (this phase)' && box.value === '' && box.max === 120, JSON.stringify(box));
await page.click('#player-instruction');
await page.keyboard.type('Flat, call for it early.');
await page.$eval('#player-instruction', t => t.blur());
let s = await state(page);
check('typing it sets phases[0].instructions.a10', eq(s.phases[0].instructions, { a10: 'Flat, call for it early.' }), JSON.stringify(s.phases[0].instructions));
check('…and only phase 1 has it', s.phases.slice(1).every(ph => !ph.instructions));
// The autosave runs shortly after the last change (AUTOSAVE_MS), so wait for it rather than read at once.
const readSaved = () => page.evaluate(async () => { const lib = window.rugbyLibrary; await lib.settled(); return (await lib.read(lib.openId())).play.phases[0].instructions ?? null; });
let saved = null;
for (let i = 0; i < 30 && !saved; i++) { saved = await readSaved(); if (!saved) await sleep(100); }
check('…and it is autosaved', eq(saved, { a10: 'Flat, call for it early.' }), JSON.stringify(saved));
await click(page, '[data-action="undo"]');
s = await state(page);
check('Undo takes it away (one step for the typing)', !s.phases[0].instructions, JSON.stringify(s.phases[0].instructions));
await click(page, '[data-action="redo"]');
s = await state(page);
check('Redo brings it back', s.phases[0].instructions?.a10 === 'Flat, call for it early.');
await tap(page, p10.x, p10.y);
await sleep(50);
check('the box shows the saved instruction when 10 is selected again', (await page.$eval('#player-instruction', t => t.value)) === 'Flat, call for it early.');
await page.$eval('#phase-tabs [data-index="1"]', b => b.click());
await sleep(50);
const other = await page.evaluate(() => ({ hidden: document.getElementById('instruction-group').hidden, value: document.getElementById('player-instruction').value }));
check('another phase has its own (empty) instruction for 10', other.hidden || other.value === '', JSON.stringify(other));
await page.keyboard.press('Escape');

console.log('\n== Editor: Share link ==');
await pastePlay(page, play);
const url = await shareLink(page);
const dlg = await page.evaluate(() => ({ status: document.getElementById('share-status').textContent, field: document.getElementById('share-url').value, warn: !document.getElementById('share-warning').hidden, logo: document.getElementById('share-logo').checked }));
check('Share link copies a link to view.html#p=…', !!url && url.startsWith(new URL('view.html', URL_).href + '#p=') && /#p=[A-Za-z0-9_-]+$/.test(url), String(url).slice(0, 80));
check('…shows it in the box with "Link copied" and its length', dlg.field === url && dlg.status === `Link copied (${url.length.toLocaleString('en')} characters)`, dlg.status);
check('…"Include team logo" is on by default, and a short link gets no warning', dlg.logo && !dlg.warn);
const decoded = await page.evaluate(u => import('./js/share.js').then(m => m.decodeShare(m.hashData(new URL(u).hash))), url);
check('…the link holds the play (instructions too) and the team', eq(decoded.play.phases.map(ph => ph.instructions ?? null), play.phases.map(ph => ph.instructions ?? null)) && decoded.play.name === 'Ten follows' && decoded.team?.logo === 'default' && !!decoded.team?.name, JSON.stringify(decoded.team));
await click(page, '#share-logo');
await page.waitForFunction(n => window.__copied.length > n, { timeout: 5000 }, 1).catch(() => null);
const noLogo = await page.evaluate(() => window.__copied.at(-1));
const noTeam = await page.evaluate(u => import('./js/share.js').then(m => m.decodeShare(m.hashData(new URL(u).hash))), noLogo);
check('unticking "Include team logo" copies a link without the team name or logo', noTeam.team === null && noLogo !== url);
await page.click('#share-dialog .cancel');
await browser.close();

// A big logo makes a long link: the warning and Drop the logo.
({ browser, page, errors } = await open());
await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = c.height = 200;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(200, 200);
  for (let i = 0; i < img.data.length; i++) img.data[i] = (i * 2654435761 >>> 13) & 255;
  ctx.putImageData(img, 0, 0);
  localStorage.setItem('rugby-play-designer.team-logo', JSON.stringify({ logo: c.toDataURL('image/png'), name: 'Big logo RFC', exports: true }));
});
await page.reload();
await page.waitForSelector('#phase-tabs button');
await pastePlay(page, play);
const longUrl = await shareLink(page);
let warn = await page.evaluate(() => ({ shown: !document.getElementById('share-warning').hidden, text: document.getElementById('share-warning-text').textContent, drop: !document.getElementById('share-drop-logo').hidden }));
check(`a link over 16000 characters (${longUrl?.length}) warns that some apps may cut it`, longUrl?.length > 16000 && warn.shown && /some apps may cut it/i.test(warn.text), JSON.stringify(warn));
check('…and offers to drop the logo', warn.drop);
await click(page, '#share-drop-logo');
await page.waitForFunction(n => window.__copied.length > n, { timeout: 5000 }, 1).catch(() => null);
const shortUrl = await page.evaluate(() => window.__copied.at(-1));
warn = await page.evaluate(() => ({ shown: !document.getElementById('share-warning').hidden, logo: document.getElementById('share-logo').checked }));
check('Drop the logo: the tick goes, a short link is copied, no warning', !warn.logo && shortUrl.length < 16000 && !warn.shown, `${shortUrl?.length} ${JSON.stringify(warn)}`);
check('editor: no console errors', errors.length === 0, errors.join(' | '));
await browser.close();

// ===================== Viewer =====================
console.log('\n== Viewer: start screen ==');
({ browser, page, errors } = await open({ mobile: true }));
const requests = [];
page.on('request', r => requests.push(new URL(r.url()).pathname));
await page.goto('about:blank');
await page.goto(url);
await page.waitForSelector('#start:not([hidden])');
const start = await page.evaluate(() => ({
  name: document.getElementById('start-name').textContent,
  team: document.getElementById('start-team').hidden ? null : document.getElementById('start-team-name').textContent,
  logo: !document.getElementById('start-logo').hidden,
  question: document.querySelector('#start h2').textContent,
  positions: [...document.querySelectorAll('#positions button')].map(b => ({ id: b.dataset.id, text: b.textContent, h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width, pressed: b.getAttribute('aria-pressed') })),
  whole: document.getElementById('watch-all').textContent,
  scroll: document.documentElement.scrollWidth - innerWidth,
}));
check('the play name, the team name and logo', start.name === 'Ten follows' && !!start.team && start.logo, JSON.stringify(start));
check('"Which position do you play?" with a button for each attacking number in the play', start.question === 'Which position do you play?' && eq(start.positions.map(p => [p.id, p.text]), [['a10', '10'], ['a12', '12'], ['a13', '13']]), JSON.stringify(start.positions));
check('…large buttons (at least 44 px), none picked yet', start.positions.every(p => p.h >= 44 && p.w >= 44 && p.pressed === 'false'));
check('…and "Watch the whole play"', start.whole === 'Watch the whole play');
check('no horizontal scroll', start.scroll <= 0, String(start.scroll));
const page1 = await page.evaluate(() => ({
  viewport: document.querySelector('meta[name="viewport"]').content,
  touch: getComputedStyle(document.body).touchAction,
  inputs: document.querySelectorAll('input, textarea, select').length,
  welcome: !!document.getElementById('welcome-dialog'),
}));
check('iPhone: viewport-fit=cover (safe areas), no double-tap zoom (touch-action: manipulation)', /viewport-fit=cover/.test(page1.viewport) && page1.touch === 'manipulation', JSON.stringify(page1));
check('read-only: no text boxes, no Welcome box', page1.inputs === 0 && !page1.welcome);
const loaded = requests.filter(p => p.endsWith('.js')).map(p => p.split('/').pop());
check('loads only what it needs: no editor, library, app or exports', !loaded.some(f => ['app.js', 'editor.js', 'library.js', 'plays.js', 'present.js', 'export.js', 'history.js', 'templates.js'].includes(f)) && loaded.includes('view.js') && loaded.includes('animate.js'), loaded.join());

console.log('\n== Viewer: following 10 ==');
await page.evaluate(() => {
  window.__frames = [];
  window.rugbyViewer.timeScale = 4;
  window.rugbyViewer.onFrame(f => window.__frames.push({ ...f, caption: document.getElementById('caption').textContent, job: document.getElementById('job-box').hidden ? null : document.getElementById('job').textContent, head: document.getElementById('watch-phase').textContent, who: document.getElementById('watch-who').textContent, viewBox: document.getElementById('pitch').getAttribute('viewBox') }));
});
await page.tap('#positions [data-id="a10"]');
await sleep(100);
let st = await page.evaluate(() => window.rugbyViewer.state());
check('picking 10 starts playing at 1x from phase 1, following 10', st.screen === 'watch' && st.mode === 'focus' && st.focus === 'a10' && st.playing && st.speed === 1 && st.phase === 0, JSON.stringify(st));
check('10 is remembered in this browser', (await page.evaluate(() => localStorage.getItem('rugby-play-designer.viewer-position'))) === '10');
await page.waitForFunction(() => window.rugbyViewer.state().mode === 'replay', { timeout: 60000 }).catch(() => null);
const focus = await page.evaluate(() => window.__frames.filter(f => f.mode === 'focus'));
const inView = (f, p, m = 0) => p.y >= f.cam.x + m && p.y <= f.cam.x + f.cam.w - m && -p.x >= f.cam.y + m && -p.x <= f.cam.y + f.cam.h - m;
check(`10 stays inside the view on every frame (${focus.length} frames)`, focus.length > 30 && focus.every(f => inView(f, f.players.a10)), JSON.stringify(focus.find(f => !inView(f, f.players.a10))));
check('…the view is zoomed in on 10 (narrower than the pitch)', focus.every(f => f.cam.w < 60), String(Math.max(...focus.map(f => f.cam.w))));
check('…and drawn as it says (the SVG\'s viewBox)', focus.every(f => { const [x, y, w, h] = f.viewBox.split(' ').map(Number); return Math.abs(x - f.cam.x) < 0.01 && Math.abs(y - f.cam.y) < 0.01 && Math.abs(w - f.cam.w) < 0.01 && Math.abs(h - f.cam.h) < 0.01; }));
const near = (f, id) => Math.hypot(f.players[id].x - f.players.a10.x, f.players[id].y - f.players.a10.y);
const opp = focus.flatMap(f => ['d10', 'd12'].map(id => ({ d: near(f, id), o: f.players[id].opacity })));
check('opponents within 15 m of 10 are at full strength, the others faded', opp.some(o => o.d <= 15) && opp.every(o => (o.d <= 15 ? o.o === 1 : o.o < 1)), JSON.stringify(opp.find(o => (o.d <= 15) !== (o.o === 1))));
check('…10 in full, 10\'s team-mates faded', focus.every(f => f.players.a10.opacity === 1 && f.players.a12.opacity < 1 && f.players.a13.opacity < 1));
const ballNear = focus.filter(f => f.ball && Math.hypot(f.ball.x - f.players.a10.x, f.ball.y - f.players.a10.y) <= 15);
check('…and the ball in view whenever it is near 10', ballNear.length > 0 && ballNear.every(f => inView(f, f.ball)), String(ballNear.length));
const captions = [0, 1, 2].map(i => [...new Set(focus.filter(f => f.phase === i).map(f => f.job))]);
check('the job line is 10\'s instruction for each phase, or the job made from their routes where there is none', eq(captions, FOR_10.map(c => [c])), JSON.stringify(captions));
const heads = [...new Set(focus.map(f => `${f.head} / ${f.who}`))];
check('the header: "Phase n of 3" and "Position 10"', eq(heads, ['Phase 1 of 3 / Position 10', 'Phase 2 of 3 / Position 10', 'Phase 3 of 3 / Position 10']), JSON.stringify(heads));

console.log('\n== Viewer: the end ==');
await page.waitForFunction(() => window.rugbyViewer.state().ended, { timeout: 60000 }).catch(() => null);
const replay = await page.evaluate(() => window.__frames.filter(f => f.mode === 'replay'));
const all = play.phases.flatMap(ph => Object.values(ph.positions));
const area = c => c.w * c.h;
check('after the last phase it zooms out to the whole play', replay.length > 10 && all.every(p => inView(replay.at(-1), p)) && area(replay.at(-1).cam) > area(focus[0].cam),
  JSON.stringify([replay.at(-1)?.cam, focus[0]?.cam]));
check('…and replays it once from phase 1, everyone at full strength', replay.some(f => f.phase === 0) && replay.at(-1).phase === 2 && replay.filter(f => f.phase === 0 && f.t > 0).length > 0 && replay.every(f => Object.values(f.players).every(p => p.opacity === 1)));
const replayCaps = [0, 1, 2].map(i => [...new Set(replay.filter(f => f.phase === i && f.t > 0).map(f => f.caption))]);
check('…with the phase notes as captions, and "Whole play" in the header', eq(replayCaps, NOTES.map(n => [n])) && replay.every(f => f.who === 'Whole play'), JSON.stringify(replayCaps));
const end = await page.evaluate(() => ({
  shown: !document.getElementById('end').hidden,
  name: document.getElementById('end-name').textContent,
  buttons: [...document.querySelectorAll('#end button')].map(b => [b.textContent, b.getBoundingClientRect().height >= 44]),
}));
check('then the end screen: the play name, Watch again, Another position, Share', end.shown && end.name === 'Ten follows' && eq(end.buttons, [['Watch again', true], ['Another position', true], ['Share', true]]), JSON.stringify(end));
await page.evaluate(() => { window.__shared = null; navigator.share = async d => { window.__shared = d; }; });
await page.tap('#share');
await sleep(100);
const shared = await page.evaluate(() => window.__shared);
check('Share opens the share sheet with the same link', shared?.url === url && shared.title === 'Ten follows', JSON.stringify(shared));
await page.tap('#watch-again');
await sleep(50);
st = await page.evaluate(() => window.rugbyViewer.state());
check('Watch again follows 10 again from phase 1', st.mode === 'focus' && st.focus === 'a10' && st.playing && !st.ended && st.phase === 0, JSON.stringify(st));

console.log('\n== Viewer: controls ==');
await page.evaluate(() => { window.rugbyViewer.timeScale = 1; });
await page.tap('#toggle');
st = await page.evaluate(() => window.rugbyViewer.state());
const t0 = st.t;
await sleep(300);
st = await page.evaluate(() => window.rugbyViewer.state());
check('Pause stops it there', !st.playing && st.t === t0 && (await page.$eval('#toggle', b => b.getAttribute('aria-label'))) === 'Play');
const controls = await page.$$eval('.controls button', bs => bs.map(b => { const r = b.getBoundingClientRect(); return [b.id || b.textContent, Math.round(r.width), Math.round(r.height)]; }));
check('every control is at least 44 px', controls.every(([, w, h]) => w >= 44 && h >= 44), JSON.stringify(controls));
await page.tap('#next');
check('Next goes to phase 2', (await page.evaluate(() => window.rugbyViewer.state().phase)) === 1);
await page.tap('#back');
check('Back goes to phase 1', (await page.evaluate(() => window.rugbyViewer.state().phase)) === 0);
const stage = await page.$eval('#stage', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; });
const swipe = async dx => {
  await page.touchscreen.touchStart(stage.x - dx / 2, stage.y);
  for (let i = 1; i <= 6; i++) await page.touchscreen.touchMove(stage.x - dx / 2 + (dx * i) / 6, stage.y + i);
  await page.touchscreen.touchEnd();
  await sleep(50);
  return page.evaluate(() => window.rugbyViewer.state().phase);
};
check('swiping left goes to the next phase', (await swipe(-150)) === 1);
check('…and again', (await swipe(-150)) === 2);
check('swiping right goes back', (await swipe(150)) === 1);
check('a short drag changes nothing', (await swipe(-20)) === 1);
check('the job line follows: 10\'s instruction for phase 2', (await page.$eval('#job', c => c.textContent)) === FOR_10[1]);
await page.tap('[data-speed="0.5"]');
st = await page.evaluate(() => window.rugbyViewer.state());
check('0.5x: half speed', st.speed === 0.5 && (await page.$eval('[data-speed="0.5"]', b => b.getAttribute('aria-pressed'))) === 'true');
await page.tap('#toggle');
const before = await page.evaluate(() => window.rugbyViewer.state().t);
await sleep(400);
const after = await page.evaluate(() => window.rugbyViewer.state().t);
check('Play carries on, at half speed', after > before && after - before < 330, `${after - before} ms in 400 ms`);
const layout = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth - innerWidth, h: document.documentElement.scrollHeight - innerHeight, stage: document.getElementById('stage').getBoundingClientRect().height }));
check('watching: no scroll either way, a good-sized pitch', layout.scroll <= 0 && layout.h <= 0 && layout.stage > 350, JSON.stringify(layout));

console.log('\n== Viewer: remembered position, whole play ==');
await page.reload();
await page.waitForSelector('#start:not([hidden])');
const pressed = await page.$$eval('#positions button', bs => bs.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent));
check('reloading: 10 is preselected', eq(pressed, ['10']), JSON.stringify(pressed));
await page.evaluate(() => {
  window.__frames = [];
  window.rugbyViewer.timeScale = 4;
  window.rugbyViewer.onFrame(f => window.__frames.push(f));
});
await page.tap('#watch-all');
await sleep(150);
st = await page.evaluate(() => window.rugbyViewer.state());
check('Watch the whole play: the whole view with the phase note, playing', st.mode === 'whole' && st.playing && st.caption === NOTES[0] && (await page.$eval('#watch-who', w => w.textContent)) === 'Whole play', JSON.stringify(st));
await page.waitForFunction(() => window.rugbyViewer.state().ended, { timeout: 60000 }).catch(() => null);
const whole = await page.evaluate(() => window.__frames);
check('…everyone at full strength, then straight to the end screen', whole.every(f => f.mode === 'whole' && Object.values(f.players).every(p => p.opacity === 1)) && (await page.$eval('#end', e => !e.hidden)));
await page.tap('#another');
check('Another position goes back to the start screen', await page.$eval('#start', s => !s.hidden));

console.log('\n== Viewer: broken links ==');
for (const [name, hash] of [['a cut link', url.split('#p=')[1].slice(0, 200)], ['nonsense', 'hello!'], ['no play at all', '']]) {
  await page.goto('about:blank');
  await page.goto(`${new URL('view.html', URL_).href}${hash ? `#p=${hash}` : ''}`);
  await page.waitForSelector('#broken:not([hidden])', { timeout: 5000 }).catch(() => null);
  const b = await page.evaluate(() => ({ shown: !document.getElementById('broken').hidden, text: document.getElementById('broken-text').textContent, link: document.querySelector('#broken a')?.getAttribute('href'), start: !document.getElementById('start').hidden }));
  check(`${name}: a friendly message with a link to the app`, b.shown && !b.start && b.text.length > 20 && b.link === './', JSON.stringify(b));
}

check('viewer: no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`\n${failed() ? `${failed()} FAILED` : 'ALL PASSED'}`);
process.exit(failed() ? 1 : 0);
