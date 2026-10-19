// The play library: moving the old autosave in, New / template / example / Load file each making a new play,
// the Plays panel (list, search, filter, open, duplicate, rename, delete, Recently deleted and its limit of
// 20), backup and restore, storage blocked, and a fresh undo history per play. Desktop 1440x900, then a 390px
// phone. (Two tabs with different plays, and storage full, are in stability.mjs.)
import fs from 'node:fs';
import path from 'node:path';
import {
  open, URL_, addPlayer, click, state, check, failed, outDir, answerConfirm, clearStorage, openId, plays, stored, loadFile,
} from './lib.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const toast = page => page.$eval('#toast', t => (t.hidden ? null : t.textContent));
const live = async page => (await plays(page)).filter(p => !p.deleted);
const undoOff = page => page.$eval('[data-action="undo"]', b => b.disabled);
const setName = (page, name) => page.$eval('#play-name', (i, v) => { i.value = v; i.dispatchEvent(new Event('input')); }, name);
const panelOpen = page => page.$eval('#plays-dialog', d => d.open);
const showPanel = async page => { if (!(await panelOpen(page))) await click(page, '#plays-button'); await page.waitForSelector('#plays-dialog[open]'); };
const rows = page => page.$$eval('#plays-list .play-row', rs => rs.map(r => ({
  id: r.dataset.id,
  name: r.querySelector('.play-name')?.textContent,
  meta: r.querySelector('.play-meta').textContent,
  current: r.getAttribute('aria-current') === 'true',
  badge: !!r.querySelector('.open-badge'),
  thumb: !!r.querySelector('svg.thumb .thumb-player') || !!r.querySelector('svg.thumb'),
})));
const rowAct = (page, id, act) => page.click(`.play-row[data-id="${id}"] [data-act="${act}"]`);
async function waitFile(dir, ext, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const f = fs.readdirSync(dir).find(n => n.endsWith(ext) && !n.endsWith('.crdownload'));
    if (f) { await sleep(100); return path.join(dir, f); }
    await sleep(100);
  }
  return null;
}
// A small valid play, written straight into the library through the test hook.
const seed = (page, id, name, extra = {}) => page.evaluate((id, name, extra) => window.rugbyLibrary.save({
  id, phase: 0, created: Date.now(), updated: Date.now(), deletedAt: null, ...extra,
  play: {
    schemaVersion: 1, name, category: extra.category ?? 'attack', tags: extra.tags ?? [], view: 'full', orientation: 'horizontal',
    players: [{ id: 'a1', team: 'attack', label: '1' }],
    phases: [{ note: '', positions: { a1: { x: 40, y: 30 } }, objects: [], routes: [] }],
  },
}), id, name, extra);

{
  console.log('\n== First run: the old autosave moves into the library ==');
  const { browser, page, errors } = await open();
  const old = {
    schemaVersion: 1, name: 'Before the library', category: 'scrum', tags: ['old'], view: 'full', orientation: 'horizontal',
    players: [{ id: 'a1', team: 'attack', label: '1' }, { id: 'd2', team: 'defense', label: '2' }],
    phases: [{ note: 'one', positions: { a1: { x: 40, y: 30 }, d2: { x: 60, y: 30 } }, objects: [], routes: [] },
      { note: 'two', positions: { a1: { x: 45, y: 30 }, d2: { x: 60, y: 30 } }, objects: [], routes: [] }],
  };
  // A browser from before the library: no library, just the old autosave.
  await page.evaluate(clearStorage, false, 'rugby-play-designer.welcome-seen');
  await page.evaluate(v => localStorage.setItem('rugby-play-designer.autosave', v), JSON.stringify({ play: old, phase: 1 }));
  await page.goto('about:blank');
  await page.goto(URL_);
  await page.waitForSelector('#phase-tabs button');
  await sleep(300);
  const all = await plays(page);
  const same = p => p.name === old.name && p.category === 'scrum' && eq(p.tags, ['old']) && p.players.length === 2 && eq(p.phases.map(ph => ph.note), ['one', 'two']);
  check('the old autosave is the library\'s one play, and it\'s open on its phase', all.length === 1 && same(all[0].play) && (await openId(page)) === all[0].id
    && same(await state(page)) && (await page.$eval('#phase-tabs [aria-current="step"]', b => b.dataset.index)) === '1', JSON.stringify(all.map(p => p.name)));
  check('…it\'s stored, and the old autosave key is gone', JSON.parse(await stored(page)).play.name === 'Before the library'
    && (await page.evaluate(() => localStorage.getItem('rugby-play-designer.autosave'))) === null);
  await page.goto('about:blank');
  await page.goto(URL_);
  await page.waitForSelector('#phase-tabs button');
  check('…and a second visit doesn\'t move it again', (await plays(page)).length === 1);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== New, template, example and Load file make new plays ==');
  const dl = outDir('library');
  const { browser, page, errors } = await open({ downloads: dl });
  await addPlayer(page, 'attack');
  await setName(page, 'Mine');
  await sleep(600);
  const firstId = await openId(page);
  const mine = await state(page);
  check('the open play is a library entry', (await live(page)).length === 1 && JSON.parse(await stored(page)).play.name === 'Mine');

  await click(page, '[data-file="new"]');
  check('New play: no question, a new blank play opens', !(await page.$eval('#confirm-dialog', d => d.open)) && (await state(page)).players.length === 0 && (await openId(page)) !== firstId);
  check('…and "Mine" is still in the library, unchanged', eq((await plays(page)).find(p => p.id === firstId)?.play, mine));
  // An untouched blank play isn't left behind when another play is made from it.
  await click(page, '#templates-button');
  await page.waitForSelector('.template-card[data-template="1"]');
  await page.$eval('.template-card[data-template="1"]', b => b.click());
  await sleep(100);
  let names = (await live(page)).map(p => p.name).sort();
  check('a template opens as a new play (the empty blank one isn\'t kept)', (await state(page)).name === 'Backline attack' && eq(names, ['Backline attack', 'Mine']), names.join());
  await click(page, '#about-button');
  await page.click('#about-example');
  await page.waitForFunction(() => window.playState.name === 'Example: Scrum 12 crash', { timeout: 5000 });
  await page.evaluate(() => window.rugbyPlayback.stop());
  names = (await live(page)).map(p => p.name).sort();
  check('Try an example opens as a new play', eq(names, ['Backline attack', 'Example: Scrum 12 crash', 'Mine']), names.join());
  const file = path.join(dl, 'loaded.json');
  fs.writeFileSync(file, JSON.stringify({ ...mine, name: 'From a file' }));
  await loadFile(page, file);
  names = (await live(page)).map(p => p.name).sort();
  check('Load file opens as a new play, and says so', (await state(page)).name === 'From a file' && names.length === 4 && /new play/.test(await toast(page) ?? ''), `${names.join()} / ${await toast(page)}`);
  fs.rmSync(file);

  // --- The Plays panel ---
  await click(page, '#plays-button');
  await page.waitForSelector('#plays-dialog[open] .play-row');
  let r = await rows(page);
  check('Plays lists every play, most recently edited first', eq(r.map(x => x.name), ['From a file', 'Example: Scrum 12 crash', 'Backline attack', 'Mine']), JSON.stringify(r.map(x => x.name)));
  check('…each with a thumbnail, category, phase count and when it was edited', r.every(x => x.thumb && /phases? · Edited /.test(x.meta)) && /^Scrum · example, backs, set move · 3 phases · Edited just now$/.test(r[1].meta), JSON.stringify(r.map(x => x.meta)));
  check('…the open play is marked', r[0].current && r[0].badge && r.filter(x => x.current).length === 1);

  // Search and filter.
  await page.type('#plays-search', 'backline');
  check('search by name', eq((await rows(page)).map(x => x.name), ['Backline attack']));
  await page.$eval('#plays-search', i => { i.value = ''; });
  const exampleTags = (await plays(page)).find(p => p.name.startsWith('Example')).play.tags;
  if (exampleTags.length) {
    await page.type('#plays-search', exampleTags[0]);
    check('search by tag', (await rows(page)).some(x => x.name.startsWith('Example')));
    await page.$eval('#plays-search', i => { i.value = ''; i.dispatchEvent(new Event('input')); });
  }
  await page.$eval('#plays-search', i => i.dispatchEvent(new Event('input')));
  await page.select('#plays-category', 'scrum');
  r = await rows(page);
  check('category filter', r.length >= 1 && (await plays(page)).filter(p => !p.deleted && r.some(x => x.id === p.id)).every(p => p.play.category === 'scrum'), JSON.stringify(r.map(x => x.name)));
  await page.select('#plays-category', 'defense');
  check('…with nothing in it: "No plays match."', (await rows(page)).length === 0 && (await page.$eval('#plays-empty', e => !e.hidden && e.textContent)) === 'No plays match.');
  await page.select('#plays-category', '');

  // Open: undo history starts afresh.
  await page.keyboard.press('Escape');
  await addPlayer(page, 'defense');
  check('(an edit to undo)', !(await undoOff(page)));
  await showPanel(page);
  await rowAct(page, firstId, 'open');
  await sleep(50);
  check('Open opens the play and closes the panel', (await openId(page)) === firstId && eq(await state(page), mine) && !(await panelOpen(page)));
  check('…with a fresh undo history', await undoOff(page));
  const fileId = (await plays(page)).find(p => p.name === 'From a file').id;
  check('the play left keeps its edit', (await plays(page)).find(p => p.id === fileId).play.players.length === 2);
  await showPanel(page);
  await page.click(`.play-row[data-id="${fileId}"] .play-meta`);
  await sleep(50);
  check('clicking a row opens it too', (await openId(page)) === fileId && (await state(page)).name === 'From a file');

  // Duplicate.
  await showPanel(page);
  await rowAct(page, firstId, 'duplicate');
  await sleep(50);
  const copy = (await live(page)).find(p => p.name === 'Mine copy');
  check('Duplicate adds "Mine copy" (the same play) without opening it', copy && eq({ ...copy.play, name: 'Mine' }, mine) && (await openId(page)) === fileId);

  // Rename: an in-app field.
  await rowAct(page, copy.id, 'rename');
  check('Rename shows a field in the row, with the name selected', await page.$eval('.play-rename', i => document.activeElement === i && i.value === 'Mine copy'));
  await page.keyboard.press('Escape');
  await sleep(50);
  check('Escape cancels it (the panel stays open)', (await panelOpen(page)) && (await live(page)).some(p => p.name === 'Mine copy'));
  await rowAct(page, copy.id, 'rename');
  await page.keyboard.type('Blind side'); // replaces the selected name
  await page.keyboard.press('Enter');
  await sleep(50);
  check('Enter saves the new name', (await plays(page)).find(p => p.id === copy.id).name === 'Blind side' && (await rows(page)).some(x => x.name === 'Blind side'));
  await rowAct(page, fileId, 'rename');
  await page.keyboard.press('End');
  await page.keyboard.type(' v2');
  await page.keyboard.press('Enter');
  await sleep(50);
  check('renaming the open play renames it on screen too (one undo step)', (await state(page)).name.endsWith(' v2') && (await page.$eval('#play-name', i => i.value)).endsWith(' v2') && !(await undoOff(page)));

  // Delete, Recently deleted, Restore, Delete forever.
  await rowAct(page, copy.id, 'trash');
  await sleep(50);
  check('Delete moves a play to Recently deleted (collapsed)', !(await rows(page)).some(x => x.id === copy.id) && (await plays(page)).find(p => p.id === copy.id).deleted
    && (await page.$eval('#plays-deleted', d => !d.hidden && !d.open)) && (await page.$eval('#plays-deleted-count', s => s.textContent)) === 'Recently deleted (1)');
  await page.click('#plays-deleted summary');
  await page.click(`#plays-deleted-list [data-id="${copy.id}"] [data-act="restore"]`);
  await sleep(50);
  check('Restore brings it back', (await rows(page)).some(x => x.id === copy.id) && !(await plays(page)).find(p => p.id === copy.id).deleted);
  await rowAct(page, copy.id, 'trash');
  await sleep(50);
  await page.click(`#plays-deleted-list [data-id="${copy.id}"] [data-act="purge"]`);
  const msg = await answerConfirm(page, false);
  check('Delete forever asks first (in the app)', /forever/.test(msg) && (await plays(page)).some(p => p.id === copy.id), msg);
  await page.click(`#plays-deleted-list [data-id="${copy.id}"] [data-act="purge"]`);
  await answerConfirm(page, true);
  await sleep(100);
  check('…and OK deletes it for good, from storage too', !(await plays(page)).some(p => p.id === copy.id)
    && (await page.evaluate(id => window.rugbyLibrary.settled().then(() => window.rugbyLibrary.read(id)), copy.id)) == null);
  // Deleting the open play opens the most recently edited other one.
  await rowAct(page, fileId, 'trash');
  await sleep(100);
  check('deleting the open play opens another', (await openId(page)) !== fileId && (await rows(page)).some(x => x.current));

  // --- Backup ---
  await page.click('#plays-backup');
  const backupFile = await waitFile(dl, '.json');
  const backup = JSON.parse(fs.readFileSync(backupFile));
  check('Back up all plays: rugby-plays-backup-YYYY-MM-DD.json', /^rugby-plays-backup-\d{4}-\d{2}-\d{2}\.json$/.test(path.basename(backupFile)), path.basename(backupFile));
  const libraryNow = await plays(page);
  check('…with every play, Recently deleted ones marked', backup.plays.length === libraryNow.length && backup.plays.find(p => p.id === fileId)?.deleted === true
    && backup.plays.filter(p => !p.deleted).length === libraryNow.filter(p => !p.deleted).length);
  fs.rmSync(backupFile);

  // --- Restore: adds, never overwrites ---
  const changed = structuredClone(backup.plays.find(p => p.id === firstId));
  changed.play.name = 'Mine';
  changed.play.players.push({ id: 'a2', team: 'attack', label: '2' });
  changed.play.phases[0].positions.a2 = { x: 30, y: 30 };
  const brandNew = { ...structuredClone(backup.plays[0]), id: 'restored-new', deleted: false, deletedAt: null };
  brandNew.play.name = 'Only in the backup';
  const restoreFile = path.join(dl, 'my-backup.json');
  fs.writeFileSync(restoreFile, JSON.stringify({ ...backup, plays: [...backup.plays, changed, brandNew, { id: 'junk', play: { name: 'no schema' } }] }));
  await (await page.$('#restore-input')).uploadFile(restoreFile);
  await page.waitForFunction(() => !document.getElementById('plays-status').hidden, { timeout: 5000 });
  const summary = await page.$eval('#plays-status', s => s.textContent);
  const skipped = backup.plays.length;
  check('Restore: a summary of what was added and skipped', summary === `Added 2 plays, ${skipped} skipped (already here), 1 play couldn't be read`, summary);
  const after = await plays(page);
  check('…the changed play comes back as a "(restored)" copy, the original untouched', after.find(p => p.id === firstId)?.play.players.length === 1
    && after.some(p => p.name === 'Mine (restored)' && p.id !== firstId && p.play.players.length === 2), JSON.stringify(after.map(p => p.name)));
  check('…a play that wasn\'t here is added with its id', after.some(p => p.id === 'restored-new' && p.name === 'Only in the backup'));
  check('…and nothing already here is duplicated', after.length === libraryNow.length + 2);
  fs.writeFileSync(restoreFile, JSON.stringify({ schemaVersion: 1, name: 'one play' }));
  await (await page.$('#restore-input')).uploadFile(restoreFile);
  await page.waitForFunction(() => document.getElementById('plays-status').classList.contains('error'), { timeout: 5000 });
  check('a file that isn\'t a backup: a clear message, nothing added', /isn't a plays backup/.test(await page.$eval('#plays-status', s => s.textContent)) && (await plays(page)).length === after.length);
  fs.rmSync(restoreFile);

  // --- Recently deleted keeps the last 20 ---
  for (let i = 1; i <= 22; i++) await seed(page, `bulk-${i}`, `Bulk ${i}`);
  await page.keyboard.press('Escape');
  await showPanel(page);
  for (let i = 1; i <= 22; i++) {
    await rowAct(page, `bulk-${i}`, 'trash');
    await sleep(20);
  }
  await sleep(200);
  const deleted = (await plays(page)).filter(p => p.deleted).map(p => p.id);
  check('Recently deleted keeps the last 20; older ones go for good', deleted.length === 20 && !deleted.includes('bulk-1') && !deleted.includes(fileId) && deleted.includes('bulk-22')
    && (await page.$eval('#plays-deleted-count', s => s.textContent)) === 'Recently deleted (20)', JSON.stringify(deleted));
  check('…from storage too', (await page.evaluate(() => window.rugbyLibrary.settled().then(() => window.rugbyLibrary.read('bulk-1')))) == null);
  await page.keyboard.press('Escape');

  // A reload brings back this tab's play and the whole library.
  const openNow = await openId(page);
  await sleep(600);
  await page.reload();
  await page.waitForSelector('#phase-tabs button');
  check('after a reload: the same play is open, and the library is all there', (await openId(page)) === openNow && (await plays(page)).length === after.length + 22 - 2 - 1);
  check('no console errors', errors.length === 0, errors.join(' | '));
  fs.rmSync(dl, { recursive: true, force: true });
  await browser.close();
}

{
  console.log('\n== Thumbnails fit the players ==');
  const { browser, page, errors } = await open();
  // The thumbnail's view (pitch metres) and its player discs.
  const thumbInfo = (page, sel) => page.$eval(sel, svg => {
    const [x, y, w, h] = svg.getAttribute('viewBox').split(' ').map(Number);
    const discs = [...svg.querySelectorAll('.thumb-player')].map(c => ({ x: +c.getAttribute('cx'), y: +c.getAttribute('cy'), r: +c.getAttribute('r') }));
    return { box: [x, y, w, h], ar: w / h, discs, vertical: svg.querySelector('g')?.getAttribute('transform') === 'rotate(-90)' };
  });
  const inside = (t, margin) => t.discs.every(d => d.x - margin >= t.box[0] - 1e-6 && d.x + margin <= t.box[0] + t.box[2] + 1e-6
    && d.y - margin >= t.box[1] - 1e-6 && d.y + margin <= t.box[1] + t.box[3] + 1e-6);
  await page.evaluate(() => window.rugbyLibrary.save({
    id: 'two', phase: 0, created: Date.now(), updated: Date.now() + 1000, deletedAt: null,
    play: {
      schemaVersion: 1, name: 'Two players', category: 'attack', tags: [], view: 'full', orientation: 'horizontal',
      players: [{ id: 'a1', team: 'attack', label: '1' }, { id: 'a2', team: 'attack', label: '2' }],
      phases: [{ note: '', positions: { a1: { x: 40, y: 30 }, a2: { x: 50, y: 35 } }, objects: [], routes: [] }],
    },
  }));
  await showPanel(page);
  let t = await thumbInfo(page, '.play-row[data-id="two"] svg.thumb');
  check('2 players: zoomed to them with 8 m round them, at the smallest size (a quarter of the pitch), pitch shaped',
    eq(t.box, [15, 15, 60, 35]) && inside(t, 8) && Math.abs(t.ar - 120 / 70) < 1e-9, JSON.stringify(t));
  check('…their discs drawn larger than on the pitch (1.2 m)', t.discs.length === 2 && t.discs.every(d => d.r >= 1.5), JSON.stringify(t.discs));
  const blankId = await openId(page);
  t = await thumbInfo(page, `.play-row[data-id="${blankId}"] svg.thumb`);
  check('a play with no players: the full pitch', eq(t.box, [-10, 0, 120, 70]), JSON.stringify(t.box));
  await page.keyboard.press('Escape');

  await click(page, '#templates-button');
  await page.waitForSelector('#templates-dialog[open] .template-card');
  t = await thumbInfo(page, '.template-card[data-template="2"] svg'); // Attack vs defense, 30 players
  // (The 8 m margin can be cut by the pitch's edge, where the view is moved rather than shrunk.)
  check('a full template: every player in view, pitch shaped, within the pitch',
    t.discs.length === 30 && inside(t, 0) && Math.abs(t.ar - 120 / 70) < 1e-9 && t.box[2] >= 60 && t.box[2] <= 120
    && t.box[0] >= -10 && t.box[0] + t.box[2] <= 110 && t.box[1] >= 0 && t.box[1] + t.box[3] <= 70, JSON.stringify(t.box));
  check('…discs larger than on the pitch', t.discs.every(d => d.r >= 1.5));
  t = await thumbInfo(page, '.template-card[data-template="0"] svg'); // Blank
  check('the Blank template: the full pitch', eq(t.box, [-10, 0, 120, 70]), JSON.stringify(t.box));
  await page.keyboard.press('Escape');
  await click(page, '[data-orientation="vertical"]');
  await showPanel(page);
  t = await thumbInfo(page, '.play-row[data-id="two"] svg.thumb');
  check('vertical: the same part of the pitch, turned', t.vertical && eq(t.box, [15, -75, 35, 60]), JSON.stringify(t));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== Storage blocked ==');
  const dl = outDir('library-blocked');
  const { browser, page, errors } = await open({ downloads: dl });
  await page.evaluateOnNewDocument(() => {
    const deny = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
    Object.defineProperty(window, 'indexedDB', { get: deny });
    Object.defineProperty(window, 'localStorage', { get: deny });
  });
  await page.reload();
  await page.waitForSelector('#phase-tabs button');
  check('storage blocked: a clear message pointing to Back up', (await toast(page)) === "Plays can't be saved in this browser (storage is blocked). Use Plays → Back up all plays to keep your work.", await toast(page));
  await addPlayer(page, 'attack');
  await setName(page, 'Kept on screen');
  await click(page, '[data-file="new"]');
  await addPlayer(page, 'defense');
  check('…editing, New play and the library all work for this visit', (await live(page)).length === 2 && (await state(page)).players.length === 1);
  await showPanel(page);
  check('…Plays lists both', (await rows(page)).length === 2);
  await page.click('#plays-backup');
  const file = await waitFile(dl, '.json');
  check('…and Back up saves them', file && JSON.parse(fs.readFileSync(file)).plays.some(p => p.play.name === 'Kept on screen'));
  check('no console errors', errors.length === 0, errors.join(' | '));
  fs.rmSync(dl, { recursive: true, force: true });
  await browser.close();
}

{
  console.log('\n== Plays on a phone (390px) ==');
  const { browser, page, errors } = await open({ mobile: true });
  check('phone: no Plays button in the top bar', await page.$eval('#plays-button', b => getComputedStyle(b).display === 'none'));
  await page.tap('#file-menu summary');
  await page.waitForSelector('#file-menu[open]');
  await page.tap('[data-file="plays"]');
  await page.waitForSelector('#plays-dialog[open]');
  const fits = await page.$eval('#plays-dialog', d => { const r = d.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; });
  check('phone: File → Plays… opens the panel, and it fits', fits && (await rows(page)).length === 1);
  check('phone: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(`\n${failed() ? `${failed()} FAILED` : 'ALL PASSED'}`);
process.exit(failed() ? 1 : 0);
