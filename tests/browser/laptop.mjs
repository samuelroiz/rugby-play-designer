// Laptop widths and editing paper cuts from a coach's test session.
// 1. The play's name never shrinks to a sliver: from 760 to 1440 px wide it's at least 150 px, a click on it
//    focuses it, typing (spaces too) renames the play and never starts playing. When the buttons leave too
//    little room, the view controls take a second row, decided by the buttons alone (a long name moves nothing).
// 2. Present mode: every control is on screen at any width. What doesn't fit goes into More (opening upwards,
//    inside the window); Play, More and Exit are always on the bar. The controls in More work, resizing refits,
//    and leaving puts every control back in its place.
// 3. Click-to-draw: a click on another player makes them the start; a toast says so and offers to end the route
//    on their spot instead (a drift one channel across).
// 4. Selecting a player brings "Your job" and "Cues" into view in the side panel (not the page).
import { open, click, state, check, failed, tap, drag, toScreen } from './lib.mjs';
import { animPlay } from '../anim-play.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const LONG = 'Scrum on halfway, twelve crash ball, thirteen loops round';

async function paste(page, p) {
  await click(page, '#file-menu summary');
  await click(page, '[data-file="paste"]');
  await page.waitForSelector('#paste-dialog[open]');
  await page.$eval('#paste-play-text', (t, text) => { t.value = text; }, JSON.stringify(p));
  await click(page, '#paste-play-import');
  await sleep(150);
}
const setName = (page, name) => page.$eval('#play-name', (i, n) => { i.value = n; i.dispatchEvent(new Event('input')); }, name);
const box = (page, sel) => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; });
async function mouseClick(page, sel) {
  const r = await box(page, sel);
  await page.mouse.click(r.left + r.w / 2, r.top + r.h / 2);
}

{
  console.log('\n== 1. The play name at laptop widths ==');
  const { browser, page, errors } = await open();
  const HEADER = ['#details-button', '[data-action="undo"]', '[data-action="redo"]', '#file-menu summary', '#plays-button', '#templates-button', '#present-button',
    '[data-view="full"]', '[data-view="half"]', '[data-orientation="horizontal"]', '[data-orientation="vertical"]', '#layers summary', '#about-button'];
  const header = () => page.evaluate(sels => sels.map(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), right: r.right, w: r.width }; }), HEADER);
  for (const width of [760, 800, 894, 1000, 1081, 1250, 1440]) {
    await page.setViewport({ width, height: 648 });
    await setName(page, LONG);
    await sleep(100);
    const name = await box(page, '#play-name');
    const pencil = await box(page, '#details-button');
    const btns = await header();
    const twoRows = await page.$eval('.topbar', b => b.classList.contains('two-rows'));
    check(`${width} px: the name box is at least 150 px wide (${Math.round(name.w)}), ${twoRows ? 'two rows' : 'one row'}`, name.w >= 150, JSON.stringify(name));
    check(`${width} px: every top bar button is in the window, none over the name`, btns.every(b => b.w > 0 && b.right <= width + 0.5) && name.right <= pencil.left + 1 && btns.slice(1).every(b => b.y > name.bottom - 2 || b.x >= pencil.right - 1), JSON.stringify(btns));
    // A real click on it, select all, type with spaces, Enter.
    await page.mouse.click(name.left + name.w / 2, name.top + name.h / 2);
    check(`${width} px: a click on the name focuses it`, await page.evaluate(() => document.activeElement?.id === 'play-name'), await page.evaluate(() => document.activeElement?.tagName));
    await page.evaluate(() => document.activeElement.select());
    const typed = `Renamed at ${width} px`;
    await page.keyboard.type(typed);
    await page.keyboard.press('Enter');
    await sleep(100);
    const after = await page.evaluate(() => ({ name: window.playState.name, playing: document.body.classList.contains('playing') || window.rugbyPlayback.playing }));
    check(`${width} px: typing renames the play, and Space never starts playing`, after.name === typed && !after.playing, JSON.stringify(after));
  }
  // At 894 the view controls are on a second row, decided by the buttons alone: a short or long name moves nothing.
  await page.setViewport({ width: 894, height: 649 });
  await setName(page, 'Short');
  await sleep(100);
  const short = await header();
  const shortTwo = await page.$eval('.topbar', b => b.classList.contains('two-rows'));
  await setName(page, LONG);
  await sleep(100);
  const long = await header();
  check('894 px: the view controls take a second row', shortTwo && long[7].y > long[1].y + 10, JSON.stringify(long));
  check('894 px: a long or short name moves none of the buttons', eq(short.slice(1), long.slice(1)), JSON.stringify([short, long]));
  await page.setViewport({ width: 1440, height: 900 });
  await sleep(100);
  check('1440 px: one row', !(await page.$eval('.topbar', b => b.classList.contains('two-rows'))));
  check('names: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== 2. Present mode at laptop widths ==');
  const { browser, page, errors } = await open();
  await paste(page, animPlay());
  await page.evaluate(() => { window.rugbyPlayback.timeScale = 0; });
  const ids = () => page.$$eval('#play-controls > *', els => els.map(el => el.dataset.play || el.id || el.className));
  const bar = () => page.evaluate(() => {
    const controls = document.getElementById('play-controls');
    const shown = [...controls.children].filter(el => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0);
    return {
      w: innerWidth,
      items: shown.map(el => { const r = el.getBoundingClientRect(); return { id: el.dataset.play || el.id || el.className, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }),
      more: !document.getElementById('present-more').hidden,
      inMore: [...document.getElementById('present-more-panel').children].map(el => el.dataset.play || el.id || el.className),
    };
  });
  const before = await ids();
  for (const width of [600, 800, 894, 1081, 1280, 1440]) {
    await page.setViewport({ width, height: 649 });
    await click(page, '#present-button');
    await sleep(150);
    const b = await bar();
    const inside = b.items.every(i => i.left >= -0.5 && i.right <= b.w + 0.5);
    const has = id => b.items.some(i => i.id === id);
    check(`${width} px: every control on the bar is inside the window${b.more ? ` (More has ${b.inMore.length})` : ''}`, inside, JSON.stringify(b.items.filter(i => i.left < 0 || i.right > b.w)));
    check(`${width} px: Play and Exit are on the bar${b.more ? ', with More' : ''}`, has('toggle') && has('exit') && (b.more ? has('present-more') : true), JSON.stringify(b.items.map(i => i.id)));
    check(`${width} px: one row`, b.items.every(i => Math.abs(i.top - b.items[0].top) < 12), JSON.stringify(b.items.map(i => i.top)));
    if (width === 1440) check('1440 px: everything fits, so no More', !b.more && b.inMore.length === 0, JSON.stringify(b));
    if (width <= 894) check(`${width} px: the pen colours went into More first`, b.more && b.inMore.some(id => /pen-colours/.test(id)), JSON.stringify(b.inMore));
    if (b.more) {
      await mouseClick(page, '#present-more summary');
      await sleep(50);
      const panel = await box(page, '#present-more-panel');
      check(`${width} px: More opens upwards, inside the window`, panel.top >= 0 && panel.left >= 0 && panel.right <= width + 0.5 && panel.h > 0, JSON.stringify(panel));
      await mouseClick(page, '#present-more summary'); // closes it
    }
    await page.keyboard.press('Escape');
    await sleep(100);
    check(`${width} px: after leaving, every control is back in its place`, eq(await ids(), before) && !(await page.evaluate(() => window.rugbyPresent && document.body.classList.contains('presenting'))), JSON.stringify(await ids()));
  }

  // At 894: the pen, a stroke, then Clear and Exit, all with real clicks (opening More where they are).
  await page.setViewport({ width: 894, height: 649 });
  await click(page, '#present-button');
  await sleep(150);
  const press = async sel => {
    if (await page.$eval(sel, el => !!el.closest('#present-more-panel'))) {
      if (!(await page.$eval('#present-more', d => d.open))) await mouseClick(page, '#present-more summary');
      await sleep(50);
    }
    await mouseClick(page, sel);
    await sleep(50);
  };
  await press('[data-play="pen"]');
  check('894 px: Pen picks up the pen', await page.evaluate(() => window.rugbyPresent.pen));
  await drag(page, [30, 20], [40, 25]);
  await drag(page, [30, 40], [40, 45]);
  check('…two strokes drawn', (await page.$$('#pen-layer .pen-mark')).length === 2);
  await press('[data-play="undo-stroke"]');
  check('…Undo stroke (from More) takes one back, and More closes', (await page.$$('#pen-layer .pen-mark')).length === 1 && !(await page.$eval('#present-more', d => d.open)));
  await press('[data-pen-colour="magenta"]');
  check('…a pen colour from More', (await page.$eval('[data-pen-colour="magenta"]', b => b.getAttribute('aria-pressed'))) === 'true');
  await press('[data-play="clear"]');
  check('…Clear (from More) clears the drawing', (await page.$$('#pen-layer .pen-mark')).length === 0);
  // Resizing while presenting refits the bar.
  await page.setViewport({ width: 1440, height: 900 });
  await sleep(150);
  let b = await bar();
  check('widening to 1440 while presenting: everything back on the bar, no More', !b.more && b.inMore.length === 0, JSON.stringify(b.inMore));
  await page.setViewport({ width: 800, height: 649 });
  await sleep(150);
  b = await bar();
  check('narrowing to 800: More again, everything inside the window', b.more && b.items.every(i => i.left >= -0.5 && i.right <= b.w + 0.5), JSON.stringify(b.items));
  await press('[data-play="exit"]');
  check('Exit (a real click) leaves Present mode', !(await page.evaluate(() => document.body.classList.contains('presenting'))));
  check('…every control back in its place', eq(await ids(), before), JSON.stringify(await ids()));
  check('Present: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== 3. Click-to-draw onto a player\'s spot ==');
  const { browser, page, errors } = await open();
  // A flat defensive line, a slot apart, and the attack's 10.
  const line = [20, 26, 32, 38];
  const p = {
    schemaVersion: 1, name: 'Flat line', category: 'defense', tags: [], view: 'full', orientation: 'horizontal',
    players: [...line.map((_, k) => ({ id: `d${k + 1}`, team: 'defense', label: String(k + 1) })), { id: 'a10', team: 'attack', label: '10' }],
    phases: [{ note: '', positions: { ...Object.fromEntries(line.map((y, k) => [`d${k + 1}`, { x: 60, y }])), a10: { x: 45, y: 30 } }, objects: [], routes: [] }],
  };
  await paste(page, p);
  await tap(page, 60, 20);
  await click(page, '[data-route="drift"]');
  await tap(page, 60, 26);
  await sleep(100);
  let s = await state(page);
  const toast = () => page.evaluate(() => { const t = document.getElementById('toast'); return { shown: !t.hidden, text: t.firstChild?.textContent ?? '', action: t.querySelector('.toast-action')?.textContent ?? null }; });
  let t = await toast();
  check('a click on 2 while drifting from 1: no route, 2 is the new start', s.phases[0].routes.length === 0 && (await page.$eval('#players-layer [data-id="d2"]', g => g.classList.contains('selected'))), JSON.stringify(s.phases[0].routes));
  check('…and a toast says so, offering to end 1\'s drift on 2\'s spot', t.shown && t.text === 'Now drawing from 2.' && t.action === "End 1's drift on 2's spot", JSON.stringify(t));
  await mouseClick(page, '#toast .toast-action');
  await sleep(100);
  s = await state(page);
  const r = s.phases[0].routes;
  check('pressing it draws 1\'s drift to where 2 stands', r.length === 1 && r[0].type === 'drift' && r[0].from === 'd1' && eq(r[0].points, [[60, 20], [60, 26]]), JSON.stringify(r));
  check('…the toast closes', !(await toast()).shown);
  await click(page, '[data-action="undo"]');
  check('…one undo takes it back', (await state(page)).phases[0].routes.length === 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // A pass: clicking an opponent switches the start too; ending a pass on an opponent makes no sense, so no offer.
  await tap(page, 45, 30);
  await click(page, '[data-route="pass"]');
  await tap(page, 60, 32);
  await sleep(100);
  t = await toast();
  check('a pass from 10, clicking the defense\'s 3: "Now drawing from 3." with no offer', t.shown && t.text === 'Now drawing from 3.' && t.action === null, JSON.stringify(t));
  check('click-to-draw: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== 4. Selecting a player shows their job and cues ==');
  const { browser, page, errors } = await open();
  await page.setViewport({ width: 1081, height: 648 });
  await paste(page, animPlay());
  const seen = () => page.evaluate(() => {
    const bar = document.querySelector('.toolbar').getBoundingClientRect();
    const g = document.getElementById('instruction-group').getBoundingClientRect();
    const add = document.getElementById('cue-add').getBoundingClientRect();
    const job = document.getElementById('player-instruction').getBoundingClientRect();
    return { inView: job.top >= bar.top - 1 && add.bottom <= bar.bottom + 1, fits: g.height <= bar.height, top: document.querySelector('.toolbar').scrollTop, page: document.scrollingElement.scrollTop };
  });
  await page.$eval('.toolbar', t => { t.scrollTop = 0; });
  await tap(page, 40, 30);
  await sleep(100);
  let v = await seen();
  check('1081x648: selecting 10 shows "Your job" and Add cue in the side panel', v.inView, JSON.stringify(v));
  check('…by scrolling the panel, not the page', v.page === 0, JSON.stringify(v));
  await page.$eval('.toolbar', t => { t.scrollTop = 0; });
  await tap(page, 40, 30); // the same player again
  await sleep(100);
  check('selecting the same player again leaves the panel where it was put', (await seen()).top === 0);
  await tap(page, 45, 40);
  await sleep(100);
  check('selecting 12 shows their job and cues again', (await seen()).inView);
  check('side panel: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== 4. Phone: the job box comes into view ==');
  const { browser, page, errors } = await open({ mobile: true });
  await paste(page, animPlay());
  await page.$eval('.toolbar', t => { t.scrollLeft = 0; });
  const p10 = await toScreen(page, 40, 30);
  await page.touchscreen.tap(p10.x, p10.y);
  await sleep(150);
  const v = await page.evaluate(() => {
    const bar = document.querySelector('.toolbar').getBoundingClientRect();
    const job = document.getElementById('player-instruction').getBoundingClientRect();
    return { shown: !document.getElementById('instruction-group').hidden, inView: job.left >= bar.left - 1 && job.right <= bar.right + 1, scroll: document.scrollingElement.scrollLeft };
  });
  check('390 px: selecting 10 scrolls the tool row to the job box', v.shown && v.inView && v.scroll === 0, JSON.stringify(v));
  check('phone: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(failed() ? `\n${failed()} FAILED` : '\nALL PASSED');
process.exit(failed() ? 1 : 0);
