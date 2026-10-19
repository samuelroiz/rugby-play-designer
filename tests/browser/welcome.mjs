// The Welcome box on a first visit, and the Play / Pause labels. Desktop 1440x900, then a 390px phone.
import fs from 'node:fs';
import { open, URL_, WELCOME_KEY, addPlayer, answerConfirm, click, state, shown, check, failed } from './lib.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const example = JSON.parse(fs.readFileSync(new URL('../../templates/example.json', import.meta.url)));
const isOpen = (page, id = 'welcome-dialog') => page.$eval(`#${id}`, d => d.open);
const seen = page => page.evaluate(k => localStorage.getItem(k), WELCOME_KEY);
const autosave = page => page.evaluate(() => localStorage.getItem('rugby-play-designer.autosave'));
// Everything opening and closing the box must leave alone: the play, the phase, undo/redo and the autosave.
const snapshot = async page => ({
  play: await state(page), phase: await shown(page), autosave: await autosave(page),
  undo: await page.$eval('[data-action="undo"]', b => b.disabled), redo: await page.$eval('[data-action="redo"]', b => b.disabled),
});
// A fresh first visit, with the box open, ready for one way of closing it.
const firstVisit = async (opts = {}) => {
  const run = await open({ welcome: true, ...opts });
  await page_ready(run.page);
  return run;
};
// A fresh load of the bare address (a reload would keep the #phase=1 the app writes, which counts as a link).
const fresh = async page => { await page.goto('about:blank'); await page.goto(URL_); };
const page_ready = page => page.waitForFunction(() => document.getElementById('welcome-dialog').open, { timeout: 5000 }).catch(() => {});

// The play button's icon and label: separate, icon first, a visible gap, and nothing overlapping.
const playLabel = page => page.$eval('#play-button', b => {
  const icon = b.querySelector('.play-icon');
  const text = b.querySelector('.play-text');
  const range = document.createRange();
  range.selectNodeContents(icon);
  const glyph = range.getBoundingClientRect(); // the glyph itself, not its box
  const t = text.getBoundingClientRect();
  const bb = b.getBoundingClientRect();
  return {
    icon: icon.textContent, text: text.textContent, label: b.getAttribute('aria-label'),
    gap: t.left - glyph.right, iconFirst: glyph.right <= t.left, sameLine: Math.abs((glyph.top + glyph.bottom) / 2 - (t.top + t.bottom) / 2) < 4,
    inside: glyph.left >= bb.left && t.right <= bb.right, oneLine: t.height < 2 * parseFloat(getComputedStyle(text).lineHeight || 20),
  };
});
function checkLabel(name, l, playing) {
  const want = playing ? { icon: '⏸︎', text: 'Pause' } : { icon: '▶︎', text: 'Play' };
  check(`${name}: "${want.text}" with its icon first and a clear gap (${l.gap.toFixed(1)}px)`,
    l.icon === want.icon && l.text === want.text && l.label === want.text && l.iconFirst && l.gap >= 4 && l.sameLine && l.inside && l.oneLine,
    JSON.stringify(l));
}

{
  console.log('\n== Welcome (desktop) ==');
  const { browser, page, errors } = await firstVisit();
  check('a first visit opens the Welcome box', await isOpen(page));
  check('…and About stays closed', !(await isOpen(page, 'about-dialog')));
  const text = await page.$eval('#welcome-dialog', d => ({
    title: d.querySelector('h2').textContent,
    line: d.querySelector('p:not(.tip):not(.about-team)').textContent,
    team: d.querySelector('#welcome-team').textContent, teamShown: !d.querySelector('#welcome-team').hidden,
    logo: !d.querySelector('#welcome-logo').hidden && d.querySelector('#welcome-logo').naturalWidth > 0,
    buttons: [...d.querySelectorAll('.choices > *')].map(b => b.textContent),
    link: d.querySelector('#welcome-about').textContent,
  }));
  check('title', text.title === 'Welcome to Rugby Play Designer', text.title);
  check('short line', text.line === 'Design rugby plays, animate them phase by phase, and export them to share with your team. Free, no account needed.', text.line);
  check('team logo and "Made for <team name>"', text.logo && text.teamShown && text.team === 'Made for San Fernando Valley Rugby Club', JSON.stringify(text));
  check('buttons: Try an example, Start from a template, Start blank', eq(text.buttons, ['Try an example', 'Start from a template', 'Start blank']), text.buttons.join());
  check('"About this project" link', text.link === 'About this project');
  const looks = await page.evaluate(() => ['welcome-dialog', 'about-dialog'].map(id => {
    const cs = getComputedStyle(document.getElementById(id));
    return [cs.maxWidth, cs.padding, cs.borderRadius, cs.boxShadow].join();
  }));
  check('styled like About', looks[0] === looks[1], looks.join(' / '));
  const blank = await snapshot(page);

  await page.click('#welcome-blank');
  await sleep(600); // past the autosave delay
  check('Start blank just closes it', !(await isOpen(page)) && !(await isOpen(page, 'templates-dialog')) && !(await isOpen(page, 'about-dialog')));
  check('…and records it was seen', (await seen(page)) !== null);
  check('opening and closing it changes nothing: play, phase, undo, redo, autosave', eq(await snapshot(page), blank), JSON.stringify(await snapshot(page)));

  await fresh(page);
  await page.waitForSelector('#phase-tabs button');
  await sleep(300);
  check('a second visit: it does not open', !(await isOpen(page)));
  await page.evaluate(() => rugbyWelcome.maybeOpen());
  check('…not even when asked again', !(await isOpen(page)));
  check('About still opens', await (async () => { await click(page, '#about-button'); const o = await isOpen(page, 'about-dialog'); await page.keyboard.press('Escape'); return o; })());

  // --- Play / Pause labels (here, on desktop) ---
  await addPlayer(page, 'attack');
  checkLabel('desktop', await playLabel(page), false);
  await page.evaluate(() => { rugbyPlayback.timeScale = 0; });
  await page.keyboard.press('Space');
  checkLabel('desktop, playing', await playLabel(page), true);
  await page.keyboard.press('Space');
  await click(page, '#present-button');
  await sleep(100);
  checkLabel('Present mode', await playLabel(page), false);
  await page.keyboard.press('Space');
  checkLabel('Present mode, playing', await playLabel(page), true);
  await page.keyboard.press('Space');

  // --- Not in Present mode ---
  await page.evaluate(k => localStorage.removeItem(k), WELCOME_KEY);
  await page.evaluate(() => rugbyWelcome.maybeOpen());
  check('not in Present mode (even with nothing stored)', !(await isOpen(page)));
  await click(page, '[data-play="exit"]');
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

for (const [how, close] of [
  ['Escape', async page => page.keyboard.press('Escape')],
  ['a click outside', async page => page.mouse.click(8, 450)],
]) {
  const { browser, page, errors } = await firstVisit();
  const before = await snapshot(page);
  await page.click('#welcome-dialog h2'); // inside, not on a button
  await sleep(50);
  const stays = await isOpen(page);
  await close(page);
  await sleep(600);
  check(`${how} closes it and records it was seen`, stays && !(await isOpen(page)) && (await seen(page)) !== null);
  check(`…and changes nothing (${how})`, eq(await snapshot(page), before));
  await fresh(page);
  await page.waitForSelector('#phase-tabs button');
  await sleep(300);
  check(`…and it does not open again (${how})`, !(await isOpen(page)));
  check(`no console errors (${how})`, errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== Welcome: Try an example ==');
  const { browser, page, errors } = await firstVisit();
  await page.click('#welcome-example');
  await page.waitForFunction(() => window.playState.name === 'Example: Scrum 12 crash', { timeout: 5000 });
  const loaded = await state(page);
  const pb = await page.evaluate(() => ({ playing: rugbyPlayback.playing, speed: rugbyPlayback.speed, loop: rugbyPlayback.loop }));
  check('loads the example (the play was empty, so no question)', eq(loaded.phases, example.phases) && eq(loaded.players, example.players) && !(await page.$eval('#confirm-dialog', d => d.open)));
  check('…closes the box, records it was seen, and plays once from phase 1 at 1x',
    !(await isOpen(page)) && (await seen(page)) !== null && pb.playing && pb.speed === 1 && !pb.loop && (await shown(page)) === 0, JSON.stringify(pb));
  await page.evaluate(() => rugbyPlayback.stop());
  await click(page, '[data-action="undo"]');
  check('…as one undo step', (await state(page)).players.length === 0);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== Welcome: Try an example over a play ==');
  // A first visit to the Welcome box, but with a play already autosaved: it asks first, like About.
  const { browser, page, errors } = await open();
  await addPlayer(page, 'attack');
  await sleep(600);
  await page.evaluate(k => localStorage.removeItem(k), WELCOME_KEY);
  await fresh(page);
  await page_ready(page);
  check('opens over an autosaved play', await isOpen(page));
  const mine = await state(page);
  await page.click('#welcome-example');
  const message = await answerConfirm(page, false);
  check('asks first; Cancel keeps the play and the box is closed', /example/.test(message) && eq(await state(page), mine) && !(await isOpen(page)), message);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== Welcome: Start from a template ==');
  const { browser, page, errors } = await firstVisit();
  const before = await snapshot(page);
  await page.click('#welcome-template');
  await page.waitForSelector('.template-card');
  check('closes Welcome and opens the Templates picker', !(await isOpen(page)) && (await isOpen(page, 'templates-dialog')) && (await seen(page)) !== null);
  check('…without changing the play yet', eq((await snapshot(page)).play, before.play));
  await page.$eval('.template-card[data-template="1"]', b => b.click()); // Backline attack (0 is Blank)
  await sleep(100);
  check('picking a template starts the play from it', (await state(page)).players.length > 0 && !(await isOpen(page, 'templates-dialog')));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== Welcome: About this project ==');
  const { browser, page, errors } = await firstVisit();
  const before = await snapshot(page);
  await page.click('#welcome-about');
  await sleep(50);
  check('switches to the About box', !(await isOpen(page)) && (await isOpen(page, 'about-dialog')) && (await seen(page)) !== null);
  await page.keyboard.press('Escape');
  await sleep(600);
  check('…and changes nothing', !(await isOpen(page, 'about-dialog')) && eq(await snapshot(page), before));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== Welcome: a link to a phase ==');
  const { browser, page, errors } = await open({ welcome: true, hash: '#phase=1' });
  await sleep(300);
  check('#phase= in the URL: it does not open', !(await isOpen(page)));
  check('…and it is still a first visit next time', (await seen(page)) === null);
  await page.goto('about:blank');
  await page.goto(URL_);
  await page_ready(page);
  check('…so it opens without the hash', await isOpen(page));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== Welcome: storage blocked ==');
  const { browser, page, errors } = await open({ welcome: true });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
  });
  await fresh(page);
  await page.waitForSelector('#phase-tabs button');
  await sleep(300);
  check('storage blocked: it does not open, quietly', !(await isOpen(page)));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== Welcome and Play / Pause (phone, 390px) ==');
  const { browser, page, errors } = await firstVisit({ mobile: true });
  check('phone: a first visit opens it', await isOpen(page));
  const fits = await page.$eval('#welcome-dialog', d => {
    const r = d.getBoundingClientRect();
    const buttons = [...d.querySelectorAll('.choices > *')].every(b => { const s = b.getBoundingClientRect(); return s.left >= r.left && s.right <= r.right && b.scrollWidth <= b.clientWidth + 1; });
    return r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth && buttons;
  });
  check('phone: the box and its buttons fit the screen', fits);
  await page.tap('#welcome-blank');
  await sleep(50);
  check('phone: Start blank closes it', !(await isOpen(page)) && (await seen(page)) !== null);
  await addPlayer(page, 'attack', { touch: true });
  checkLabel('phone', await playLabel(page), false);
  await page.evaluate(() => { rugbyPlayback.timeScale = 0; });
  await page.tap('#play-button');
  checkLabel('phone, playing', await playLabel(page), true);
  await page.tap('#play-button');
  check('phone: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(`\n${failed() ? `${failed()} FAILED` : 'ALL PASSED'}`);
process.exit(failed() ? 1 : 0);
