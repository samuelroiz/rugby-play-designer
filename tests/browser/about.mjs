// The About box and its "Try an example". Desktop 1440x900, then a 390px phone.
import fs from 'node:fs';
import { open, addPlayer, answerConfirm, click, state, shown, check, failed } from './lib.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const example = JSON.parse(fs.readFileSync(new URL('../../templates/example.json', import.meta.url)));
const isOpen = page => page.$eval('#about-dialog', d => d.open);
const visible = (page, sel) => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0; });
const autosave = page => page.evaluate(() => localStorage.getItem('rugby-play-designer.autosave'));
const undoDisabled = page => page.$eval('[data-action="undo"]', b => b.disabled);
// Everything opening and closing the box must leave alone: the play, the phase, undo/redo and the autosave.
const snapshot = async page => ({
  play: await state(page), phase: await shown(page), autosave: await autosave(page),
  undo: await undoDisabled(page), redo: await page.$eval('[data-action="redo"]', b => b.disabled),
});

{
  console.log('\n== About (desktop) ==');
  const { browser, page, errors } = await open();
  await sleep(600);
  check('never opens by itself', !(await isOpen(page)));

  const placement = await page.evaluate(() => {
    const bar = document.querySelector('.topbar');
    const about = document.getElementById('about-button');
    const rights = [...bar.children].filter(el => el !== about).map(el => el.getBoundingClientRect().right);
    return { right: about.getBoundingClientRect().right, others: Math.max(...rights), cls: about.className, tag: about.tagName };
  });
  check('About is a text button at the right end of the top bar', placement.tag === 'BUTTON' && placement.right > placement.others, JSON.stringify(placement));
  const looks = await page.evaluate(() => ['about-button', 'templates-button'].map(id => {
    const cs = getComputedStyle(document.getElementById(id));
    return [cs.borderRadius, cs.padding, cs.fontSize, cs.backgroundColor, cs.borderTopColor].join();
  }));
  check('…styled like Templates', looks[0] === looks[1], looks.join(' / '));
  check('…and not in the File menu on desktop', !(await visible(page, '[data-file="about"]').catch(() => false)));

  await addPlayer(page, 'attack');
  await sleep(600); // let the autosave catch up
  const before = await snapshot(page);

  await click(page, '#about-button');
  check('About opens the box', await isOpen(page));
  const text = await page.$eval('#about-dialog', d => ({
    title: d.querySelector('h2').textContent,
    paras: [...d.querySelectorAll('p:not(.tip)')].map(p => p.textContent),
    actions: [...d.querySelectorAll('.choices > *')].map(b => b.textContent),
    footer: d.querySelector('.about-footer').textContent,
  }));
  check('title', text.title === 'About Rugby Play Designer', text.title);
  check('text', eq(text.paras, [
    'I built Rugby Play Designer because I wanted a simple, free way to create and visualize rugby plays without paying for a subscription.',
    "It's a browser-based tool for designing formations, mapping player movements, and animating plays phase by phase.",
    "It's free to use. You can design plays, export them as images or PDFs, and save them as files to load again later. No account needed, and your plays stay in your browser.",
    'Built with plain JavaScript and SVG, no framework.',
  ]), JSON.stringify(text.paras));
  check('actions: Try an example, Source on GitHub, Close', eq(text.actions, ['Try an example', 'Source on GitHub', 'Close']), text.actions.join());
  check('footer', text.footer === 'Built by Samuel Roiz', text.footer);
  const link = await page.$eval('#about-source', a => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel }));
  check('GitHub link: URL, new tab, rel="noopener"', eq(link, { href: 'https://github.com/samuelroiz/rugby-play-designer', target: '_blank', rel: 'noopener' }), JSON.stringify(link));

  await page.keyboard.press('Escape');
  await sleep(50);
  check('Escape closes it', !(await isOpen(page)));

  await click(page, '#about-button');
  await page.click('#about-dialog .cancel');
  await sleep(50);
  check('Close closes it', !(await isOpen(page)));

  await click(page, '#about-button');
  await page.mouse.click(8, 450); // the backdrop, left of the box
  await sleep(50);
  check('a click outside closes it', !(await isOpen(page)));

  await click(page, '#about-button');
  await page.click('#about-dialog h2'); // inside, not on a button
  await sleep(50);
  check('a click inside keeps it open', await isOpen(page));
  await page.keyboard.press('Escape');
  await sleep(600); // past the autosave delay
  check('opening and closing it changes nothing: play, phase, undo, redo, autosave', eq(await snapshot(page), before), JSON.stringify(await snapshot(page)));
  await click(page, '[data-action="undo"]');
  check('…and one undo still takes back the last edit', (await state(page)).players.length === 0);
  await click(page, '[data-action="redo"]');

  // --- Present mode ---
  await click(page, '#present-button');
  await sleep(100);
  check('Present mode: About hidden', !(await visible(page, '#about-button')));
  await click(page, '[data-play="exit"]');
  await sleep(100);
  check('after Present mode: About shows again', await visible(page, '#about-button'));

  // --- Try an example ---
  const mine = await state(page);
  await click(page, '#about-button');
  await page.click('#about-example');
  const message = await answerConfirm(page, false);
  check('Try an example on a play with something in it asks first', /example/.test(message), message);
  check('…Cancel keeps the play, and the box is closed', eq(await state(page), mine) && !(await isOpen(page)));

  await click(page, '#about-button');
  await page.click('#about-example');
  await answerConfirm(page, true);
  const loaded = await state(page);
  const pb = await page.evaluate(() => ({ playing: rugbyPlayback.playing, speed: rugbyPlayback.speed, loop: rugbyPlayback.loop }));
  check('OK loads the example', loaded.name === 'Example: Scrum 12 crash' && eq(loaded.phases, example.phases) && eq(loaded.players, example.players));
  check('…closes the box and plays it once from phase 1 at 1x', !(await isOpen(page)) && pb.playing && pb.speed === 1 && !pb.loop && (await shown(page)) === 0, JSON.stringify(pb));
  await page.evaluate(() => rugbyPlayback.stop());
  await click(page, '[data-action="undo"]');
  check('…as one undo step', eq(await state(page), mine));

  // An empty play: no question.
  await page.evaluate(() => { rugbyPlayback.setLoop(true); rugbyPlayback.speed = 2; });
  await click(page, '[data-file="new"]');
  await answerConfirm(page, true);
  await click(page, '#about-button');
  await page.click('#about-example');
  await page.waitForFunction(() => window.playState.name === 'Example: Scrum 12 crash', { timeout: 5000 });
  const pb2 = await page.evaluate(() => ({ playing: rugbyPlayback.playing, speed: rugbyPlayback.speed, loop: rugbyPlayback.loop }));
  check('on an empty play it loads without asking, and plays once at 1x even after 2x and Loop',
    !(await page.$eval('#confirm-dialog', d => d.open)) && pb2.playing && pb2.speed === 1 && !pb2.loop, JSON.stringify(pb2));
  await page.evaluate(() => rugbyPlayback.stop());

  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== About (phone, 390px) ==');
  const { browser, page, errors } = await open({ mobile: true });
  check('phone: no About in the top bar', !(await visible(page, '#about-button')));
  await page.tap('#file-menu summary');
  await page.waitForSelector('#file-menu[open]');
  check('phone: About is in the File menu', await visible(page, '[data-file="about"]'));
  await page.tap('[data-file="about"]');
  await sleep(100);
  check('phone: it opens the box and closes the menu', (await isOpen(page)) && !(await page.$eval('#file-menu', d => d.open)));
  const fits = await page.$eval('#about-dialog', d => { const r = d.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; });
  check('phone: the box fits the screen', fits);
  await page.tap('#about-dialog .cancel');
  await sleep(50);
  check('phone: Close closes it', !(await isOpen(page)));
  check('phone: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(`\n${failed() ? `${failed()} FAILED` : 'ALL PASSED'}`);
process.exit(failed() ? 1 : 0);
