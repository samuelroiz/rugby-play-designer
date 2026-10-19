// Fewer step badges, deleting the open play, and Paste play's replace option. Desktop 1440x900.
// - Badges: none in a phase whose routes all share one step; a drift or blitz only when its step differs
//   from every attacking route's; Layers → Step numbers (a setting of this browser) hiding them on screen and
//   in the PNG, all-phases PNG and PDF; Order in the route bar for a route whose badge is hidden.
// - Deleting the open play again and again never fills Recently deleted with blank plays.
// - Paste play → Replace the open play: same library id, the old version in Recently deleted, one undo step.
import fs from 'node:fs';
import path from 'node:path';
import { open, click, state, check, failed, outDir, openId, plays, tap, stored } from './lib.mjs';

const OUT = outDir('fixes');
console.log(`Downloads: ${OUT}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const STEPS_KEY = 'rugby-play-designer.step-numbers';
const badges = page => page.$$eval('#badges-layer .badge', bs => bs.map(b => b.dataset.id).sort());
const live = async page => (await plays(page)).filter(p => !p.deleted);
const gone = async page => (await plays(page)).filter(p => p.deleted);
const toast = page => page.$eval('#toast', t => (t.hidden ? '' : t.textContent));

async function openPaste(page) {
  await page.click('#file-menu summary');
  await page.click('[data-file="paste"]');
  await page.waitForSelector('#paste-dialog[open]');
}
// Pastes `play` and imports it, as a new play or replacing the open one.
async function pastePlay(page, play, mode = null) {
  await openPaste(page);
  await page.$eval('#paste-play-text', (t, text) => { t.value = text; t.dispatchEvent(new Event('input', { bubbles: true })); }, JSON.stringify(play));
  if (mode) await page.click(`[name="paste-mode"][value="${mode}"]`);
  await click(page, '#paste-play-import');
  await sleep(150);
}

const P = (id, x, y) => [id, { x, y }];
const route = (id, type, from, points, order, extra = {}) => ({ id, type, from, to: null, points, curve: 0, order, option: null, ...extra });
// Phase 1: every route on step 1 (no badges). Phase 2: a pass (1), a run (2) and a kick (3) by the attack; a
// drift on 1 and a drift on 2 (steps the attack uses: no badge) and a blitz on 4 (its own step: a badge).
function badgePlay() {
  const players = ['a9', 'a10', 'a12', 'd10', 'd12', 'd13'].map(id => ({ id, team: id[0] === 'a' ? 'attack' : 'defense', label: id.slice(1) }));
  const positions = Object.fromEntries([P('a9', 30, 30), P('a10', 36, 38), P('a12', 34, 48), P('d10', 50, 38), P('d12', 50, 48), P('d13', 50, 56)]);
  return {
    schemaVersion: 1, name: 'Badges', category: 'attack', tags: [], view: 'full', orientation: 'horizontal', players,
    phases: [
      {
        note: 'all on step 1', positions, objects: [],
        routes: [
          route('r1', 'pass', 'a9', [[30, 30], [36, 38]], 1, { to: 'a10' }),
          route('r2', 'run', 'a10', [[36, 38], [44, 36]], 1),
          route('r3', 'run', 'a12', [[34, 48], [42, 52]], 1),
          route('r4', 'drift', 'd10', [[50, 38], [47, 44]], 1),
        ],
      },
      {
        note: 'steps', positions, objects: [],
        routes: [
          route('s1', 'pass', 'a9', [[30, 30], [36, 38]], 1, { to: 'a10' }),
          route('s2', 'run', 'a10', [[36, 38], [44, 32]], 2),
          route('s3', 'kick', 'a10', [[36, 38], [70, 20]], 3),
          route('s4', 'drift', 'd10', [[50, 38], [47, 44]], 1),
          route('s5', 'drift', 'd12', [[50, 48], [46, 52]], 2),
          route('s6', 'blitz', 'd13', [[50, 56], [42, 56]], 4),
        ],
      },
    ],
  };
}
const showPhase = async (page, i) => { await page.$eval(`#phase-tabs [data-index="${i}"]`, b => b.click()); await sleep(50); };

{
  console.log('\n== Fewer step badges ==');
  const { browser, page, errors } = await open({ downloads: OUT });
  await page.evaluate(() => {
    window.__svgs = [];
    const orig = XMLSerializer.prototype.serializeToString;
    XMLSerializer.prototype.serializeToString = function (n) { const s = orig.call(this, n); window.__svgs.push(s); return s; };
  });
  await pastePlay(page, badgePlay());
  await showPhase(page, 0);
  check('a phase where every route is step 1 shows no badges', eq(await badges(page), []), (await badges(page)).join());
  await showPhase(page, 1);
  check('drifts on steps the attack uses have no badge; the blitz on its own step and the attack\'s routes do',
    eq(await badges(page), ['s1', 's2', 's3', 's6']), (await badges(page)).join());

  // Badges stay editable where shown.
  await page.$eval('#badges-layer .badge[data-id="s2"] circle', el => {
    const r = el.getBoundingClientRect();
    const at = { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true, isPrimary: true, button: 0, pointerId: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', at));
    document.getElementById('pitch').dispatchEvent(new PointerEvent('pointerup', at));
  });
  await sleep(50);
  check('a shown badge opens its number box', (await page.$eval('#inline-edit', i => !i.hidden && i.value)) === '2');
  await page.keyboard.press('Escape');

  // A hidden badge: Order in the route bar still edits the number.
  await showPhase(page, 0);
  await tap(page, 40, 37); // the middle of 10's run
  await sleep(50);
  check('a route with a hidden badge: the route bar shows', (await page.$eval('#route-bar', b => !b.hidden && b.dataset.id)) === 'r2');
  await click(page, '[data-route-action="order"]');
  await sleep(50);
  const box = await page.$eval('#inline-edit', i => ({ shown: !i.hidden, value: i.value }));
  check('…Order opens the number box for it', box.shown && box.value === '1', JSON.stringify(box));
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');
  await sleep(50);
  check('…Enter sets it (one undo step), and with two steps the badges show',
    (await state(page)).phases[0].routes.find(r => r.id === 'r2').order === 2 && eq(await badges(page), ['r1', 'r2', 'r3']), (await badges(page)).join());
  await click(page, '[data-action="undo"]');
  check('…undo puts it back on step 1, with no badges', (await state(page)).phases[0].routes.find(r => r.id === 'r2').order === 1 && eq(await badges(page), []));
  await page.keyboard.press('Escape');

  // Layers → Step numbers.
  await showPhase(page, 1);
  check('Step numbers is on by default', await page.$eval('[data-layer="steps"]', c => c.checked));
  const before = { play: JSON.stringify(await state(page)), undo: await page.$eval('[data-action="undo"]', b => b.disabled) };
  await sleep(600);
  const savedBefore = await stored(page);
  await page.click('#layers summary');
  await page.click('[data-layer="steps"]');
  await page.keyboard.press('Escape');
  check('turning it off hides every badge on screen', eq(await badges(page), []));
  await sleep(600);
  check('…a setting of this browser: not in the play, the undo history or the autosave',
    JSON.stringify(await state(page)) === before.play && (await page.$eval('[data-action="undo"]', b => b.disabled)) === before.undo
    && (await stored(page)) === savedBefore && (await page.evaluate(k => localStorage.getItem(k), STEPS_KEY)) === 'off');

  const clean = () => { for (const f of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, f), { recursive: true }); };
  const exported = async (file, image) => {
    clean();
    await page.evaluate(() => { window.__svgs.length = 0; });
    await click(page, `[data-file="${file}"]`);
    if (image) await click(page, `[data-image="${image}"]`);
    const t = Date.now();
    while (!fs.readdirSync(OUT).some(f => !f.endsWith('.crdownload')) && Date.now() - t < 15000) await sleep(100);
    await sleep(300);
    return page.evaluate(() => window.__svgs);
  };
  const badgeCount = svgs => svgs.reduce((n, s) => n + (s.match(/class="badge/g) ?? []).length, 0);
  let svgs = await exported('png', 'phase');
  check('off: the PNG has no badges', svgs.length === 1 && badgeCount(svgs) === 0, String(badgeCount(svgs)));
  svgs = await exported('png', 'all');
  check('off: the all-phases PNG has no badges', svgs.length === 1 && badgeCount(svgs) === 0, String(badgeCount(svgs)));
  svgs = await exported('pdf');
  check('off: the PDF has no badges', svgs.length >= 2 && badgeCount(svgs) === 0, String(badgeCount(svgs)));

  await page.reload();
  await page.waitForSelector('#phase-tabs button');
  await page.evaluate(() => {
    window.__svgs = [];
    const orig = XMLSerializer.prototype.serializeToString;
    XMLSerializer.prototype.serializeToString = function (n) { const s = orig.call(this, n); window.__svgs.push(s); return s; };
  });
  await showPhase(page, 1);
  check('…still off after a reload', !(await page.$eval('[data-layer="steps"]', c => c.checked)) && eq(await badges(page), []));
  await page.click('#layers summary');
  await page.click('[data-layer="steps"]');
  await page.keyboard.press('Escape');
  check('on again: phase 2\'s badges are back', eq(await badges(page), ['s1', 's2', 's3', 's6']));
  svgs = await exported('png', 'phase');
  check('on: the PNG has phase 2\'s 4 badges', badgeCount(svgs) === 4, String(badgeCount(svgs)));
  svgs = await exported('png', 'all');
  check('on: the all-phases PNG has 4 (none in phase 1)', badgeCount(svgs) === 4, String(badgeCount(svgs)));
  svgs = await exported('pdf');
  check('on: the PDF has 4 (none on page 1)', badgeCount(svgs) === 4, String(badgeCount(svgs)));

  // Options always show their badges, even when every route is on one step; the run beside them doesn't.
  const opts = badgePlay();
  opts.phases = [opts.phases[0]];
  opts.phases[0].routes = [
    route('o1', 'pass', 'a9', [[30, 30], [36, 38]], 1, { to: 'a10', option: 'A' }),
    route('o2', 'pass', 'a9', [[30, 30], [34, 48]], 1, { to: 'a12', option: 'B' }),
    route('o3', 'run', 'a10', [[36, 38], [44, 36]], 1),
  ];
  await pastePlay(page, opts);
  const optBadges = await page.$$eval('#badges-layer .badge', bs => bs.map(b => b.textContent).sort());
  check('one step with options: the options show 1A and 1B, the run no badge', eq(optBadges, ['1A', '1B']), optBadges.join());
  await page.click('#layers summary');
  await page.click('[data-layer="steps"]');
  await page.keyboard.press('Escape');
  check('…and Step numbers off hides the option badges too', eq(await badges(page), []));
  await page.click('#layers summary');
  await page.click('[data-layer="steps"]');
  await page.keyboard.press('Escape');
  check('badges: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== Deleting the open play ==');
  const { browser, page, errors } = await open();
  const deleteOpen = async () => {
    if (!(await page.$eval('#plays-dialog', d => d.open))) {
      await click(page, '#plays-button');
      await page.waitForSelector('#plays-dialog[open]');
    }
    const id = await openId(page);
    await page.click(`.play-row[data-id="${id}"] [data-act="trash"]`);
    await sleep(150);
    return id;
  };
  // The only play is the blank one the app opened with.
  const first = await openId(page);
  for (let i = 0; i < 5; i++) await deleteOpen();
  check('deleting the blank open play 5 times: never into Recently deleted', (await gone(page)).length === 0, JSON.stringify(await gone(page)));
  check('…one blank "Untitled play" is open, and it is the only play', (await live(page)).length === 1 && (await live(page))[0].name === 'Untitled play'
    && (await state(page)).players.length === 0 && (await openId(page)) !== first);

  // A real play and a blank one: deleting the blank opens the real one and makes no new play.
  await page.keyboard.press('Escape');
  await pastePlay(page, badgePlay());
  const real = await openId(page);
  await click(page, '[data-file="new"]');
  await sleep(100);
  const blank = await openId(page);
  check('setup: a real play and a new blank one', (await live(page)).length === 2 && blank !== real);
  await deleteOpen();
  check('deleting the blank open play removes it for good and opens the other, with no new play',
    (await openId(page)) === real && (await live(page)).length === 1 && (await gone(page)).length === 0 && !(await plays(page)).some(p => p.id === blank));

  // Deleting a real open play: it goes to Recently deleted; with nothing left, one blank opens.
  await deleteOpen();
  check('deleting the real open play: into Recently deleted, a blank "Untitled play" opens',
    eq((await gone(page)).map(p => p.id), [real]) && (await live(page)).length === 1 && (await live(page))[0].name === 'Untitled play');
  for (let i = 0; i < 3; i++) await deleteOpen();
  check('…deleting that blank again and again adds nothing to Recently deleted', eq((await gone(page)).map(p => p.id), [real]) && (await live(page)).length === 1);

  // Two real plays: deleting the open one opens the most recently edited other one.
  await page.click('#plays-deleted summary'); // the Plays panel is still open from the last delete
  await page.click(`#plays-deleted-list [data-id="${real}"] [data-act="restore"]`);
  await sleep(100);
  await page.keyboard.press('Escape');
  await pastePlay(page, { ...badgePlay(), name: 'Second' });
  const second = await openId(page);
  await pastePlay(page, { ...badgePlay(), name: 'Third' });
  await deleteOpen();
  check('deleting the open play opens the most recently edited other one', (await openId(page)) === second, JSON.stringify((await live(page)).map(p => p.name)));
  check('delete: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== Paste play: replace the open play ==');
  const { browser, page, errors } = await open();
  await pastePlay(page, { ...badgePlay(), name: 'Old version' });
  await sleep(500);
  const id = await openId(page);
  const old = await state(page);
  const count = (await plays(page)).length;

  await openPaste(page);
  const choice = await page.evaluate(() => [...document.querySelectorAll('[name="paste-mode"]')].map(r => [r.value, r.checked, r.parentElement.textContent.trim()]));
  check('the box offers "Add as a new play" (the default) and "Replace the open play"',
    eq(choice, [['new', true, 'Add as a new play'], ['replace', false, 'Replace the open play']]), JSON.stringify(choice));
  await page.keyboard.press('Escape');

  const replacement = { ...badgePlay(), name: 'New version' };
  replacement.phases = [replacement.phases[1]];
  await pastePlay(page, replacement, 'replace');
  let s = await state(page);
  check('Replace: the pasted play is open, under the same library id', s.name === 'New version' && s.phases.length === 1 && (await openId(page)) === id);
  check('…"Imported New version"', (await toast(page)) === 'Imported New version', await toast(page));
  const deleted = await gone(page);
  check('…the old version is in Recently deleted', deleted.length === 1 && deleted[0].name === 'Old version' && deleted[0].id !== id
    && eq(deleted[0].play.phases, old.phases), JSON.stringify(deleted.map(p => p.name)));
  check('…and no other play was added', (await live(page)).length === count);
  await sleep(600);
  check('…the library entry holds the new version', JSON.parse(await stored(page)).play.name === 'New version');

  await click(page, '[data-action="undo"]');
  s = await state(page);
  check('one undo step brings the old version back in the open play', s.name === 'Old version' && s.phases.length === 2 && (await openId(page)) === id);
  await click(page, '[data-action="redo"]');
  check('…and redo the new one', (await state(page)).name === 'New version');

  await click(page, '#plays-button');
  await page.waitForSelector('#plays-dialog[open]');
  await page.click('#plays-deleted summary');
  await page.click(`#plays-deleted-list [data-id="${deleted[0].id}"] [data-act="restore"]`);
  await sleep(100);
  const restored = (await live(page)).find(p => p.id === deleted[0].id);
  check('Restore brings the old version back as its own play', restored?.name === 'Old version' && (await live(page)).length === count + 1);
  await page.keyboard.press('Escape');

  await openPaste(page);
  check('the box opens on "Add as a new play" again', await page.$eval('[name="paste-mode"][value="new"]', r => r.checked));
  await page.keyboard.press('Escape');
  check('replace: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(`\n${failed() ? `${failed()} FAILED` : 'ALL PASSED'}`);
process.exit(failed() ? 1 : 0);
