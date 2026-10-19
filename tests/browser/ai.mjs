// For AI assistants: File → Paste play…, the AI play guide's links in About and the File menu, Copy guide,
// and llms.txt and the guide served by the site. Desktop 1440x900, then a 390px phone.
import fs from 'node:fs';
import { open, addPlayer, click, state, check, failed, openId, plays, URL_ } from './lib.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const example = JSON.parse(fs.readFileSync(new URL('../../templates/example.json', import.meta.url)));
const guide = fs.readFileSync(new URL('../../docs/AI_PLAY_GUIDE.md', import.meta.url), 'utf8');
const GUIDE_HEADING = guide.split('\n')[0];
const isOpen = page => page.$eval('#paste-dialog', d => d.open);
const visible = (page, sel) => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0; });
const toast = page => page.$eval('#toast', t => (t.hidden ? '' : t.textContent));
const errorText = page => page.$eval('#paste-play-error', p => (p.hidden ? '' : p.textContent));

async function openPaste(page) {
  await page.click('#file-menu summary');
  await page.click('[data-file="paste"]');
  await page.waitForSelector('#paste-dialog[open]');
}
// Puts `text` in the box as if pasted.
const paste = (page, text) => page.$eval('#paste-play-text', (t, text) => {
  t.value = text;
  t.dispatchEvent(new Event('input', { bubbles: true }));
}, text);

{
  console.log('\n== Paste play (desktop) ==');
  const { browser, page, errors } = await open();
  await browser.defaultBrowserContext().overridePermissions(new URL(URL_).origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);

  await addPlayer(page, 'attack');
  await sleep(400);
  const before = { id: await openId(page), play: await state(page), count: (await plays(page)).length };

  await openPaste(page);
  const box = await page.evaluate(() => {
    const d = document.getElementById('paste-dialog');
    const t = document.getElementById('paste-play-text');
    return {
      title: document.getElementById(d.getAttribute('aria-labelledby')).textContent,
      tag: t.tagName, label: t.getAttribute('aria-label'), focused: document.activeElement === t, empty: t.value === '',
      buttons: [...d.querySelectorAll('.choices button')].map(b => [b.id, b.textContent]),
    };
  });
  check('File → Paste play… opens the box', box.title === 'Paste play', box.title);
  check('a textarea labelled "Play JSON", focused and empty', box.tag === 'TEXTAREA' && box.label === 'Play JSON' && box.focused && box.empty, JSON.stringify(box));
  check('Import and Cancel buttons with ids', eq(box.buttons, [['paste-play-import', 'Import'], ['paste-play-cancel', 'Cancel']]), JSON.stringify(box.buttons));

  // Typing in the box is just typing: the app's own keys (Delete, space for Play) stay out of it.
  await page.type('#paste-play-text', 'ab ');
  await page.keyboard.press('Backspace');
  check('typing in the box goes to the box', (await page.$eval('#paste-play-text', t => t.value)) === 'ab' && eq((await state(page)).players, before.play.players));

  // Invalid JSON: the error shows in the box, which stays open with the text.
  await paste(page, '{ "schemaVersion": 1, ');
  await click(page, '#paste-play-import');
  await sleep(50);
  check('invalid JSON: the box stays open', await isOpen(page));
  check('…with a friendly error', (await errorText(page)) === "That isn't a play: it isn't valid JSON.", await errorText(page));
  check('…and the text kept', (await page.$eval('#paste-play-text', t => t.value)) === '{ "schemaVersion": 1, ');
  check('…and nothing added or opened', (await plays(page)).length === before.count && (await openId(page)) === before.id);

  // Valid JSON that isn't a play: parsePlay's error, the same rules as Load file.
  const notPlay = JSON.stringify({ schemaVersion: 1, players: [], phases: [] });
  await paste(page, notPlay);
  check('typing again hides the old error', (await errorText(page)) === '');
  await click(page, '#paste-play-import');
  await sleep(50);
  check('invalid play: the box stays open', await isOpen(page));
  check('…with parsePlay\'s error', (await errorText(page)) === "That text isn't a rugby play: it has no phases.", await errorText(page));
  check('…and the text kept', (await page.$eval('#paste-play-text', t => t.value)) === notPlay);
  check('…and nothing added', (await plays(page)).length === before.count && (await openId(page)) === before.id);

  // Cancel closes it and changes nothing; so does Escape.
  await click(page, '#paste-play-cancel');
  await sleep(50);
  check('Cancel closes the box', !(await isOpen(page)));
  check('…and changes nothing', eq(await state(page), before.play) && (await plays(page)).length === before.count && (await openId(page)) === before.id);
  await openPaste(page);
  check('the box opens empty again', (await page.$eval('#paste-play-text', t => t.value)) === '' && (await errorText(page)) === '');
  await paste(page, notPlay);
  await page.keyboard.press('Escape');
  await sleep(50);
  check('Escape closes it', !(await isOpen(page)) && (await plays(page)).length === before.count);

  // A valid play: a new library entry, opened, the box closed, "Imported <name>", the old play kept.
  const pasted = { ...example, name: 'Pasted 12 crash' };
  await openPaste(page);
  await paste(page, JSON.stringify(pasted, null, 2));
  await click(page, '#paste-play-import');
  await page.waitForFunction(id => window.rugbyLibrary.openId() !== id, { timeout: 5000 }, before.id);
  await sleep(50);
  const after = await plays(page);
  const now = await state(page);
  check('a valid play closes the box', !(await isOpen(page)));
  check('…opens as a new play', (await openId(page)) !== before.id && now.name === 'Pasted 12 crash' && eq(now.phases, example.phases) && eq(now.players, example.players), now.name);
  const newId = await openId(page);
  check('…as a new library entry', after.length === before.count + 1 && after.find(r => r.id === newId)?.name === 'Pasted 12 crash', after.map(r => r.name).join());
  const old = after.find(r => r.id === before.id);
  check('…and the play before is still there, unchanged', !!old && !old.deleted && eq(old.play.players, before.play.players), JSON.stringify(old?.name));
  check('…says "Imported <name>"', (await toast(page)) === 'Imported Pasted 12 crash', await toast(page));

  // Ctrl+Enter in the box imports too.
  await openPaste(page);
  await paste(page, JSON.stringify({ ...example, name: 'By keyboard' }));
  await page.focus('#paste-play-text');
  await page.keyboard.down('Control');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Control');
  await sleep(100);
  check('Ctrl+Enter imports', !(await isOpen(page)) && (await state(page)).name === 'By keyboard');

  console.log('\n== The AI play guide (desktop) ==');
  // About: the line, the link and Copy guide.
  await click(page, '#about-button');
  const about = await page.evaluate(() => {
    const line = document.querySelector('#about-dialog .about-ai');
    const a = document.getElementById('about-guide');
    return { text: line?.textContent.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href'), url: a.href, target: a.target, rel: a.rel, inLine: line?.contains(a) };
  });
  check('About: "Using an AI assistant?" with the guide link and Copy guide', about.text === 'Using an AI assistant? AI play guide Copy guide' && about.inLine, about.text);
  check('…link to docs/AI_PLAY_GUIDE.md, new tab, rel="noopener"', eq([about.href, about.target, about.rel], ['docs/AI_PLAY_GUIDE.md', '_blank', 'noopener']), JSON.stringify(about));
  const linked = await page.evaluate(async url => { const r = await fetch(url); return { ok: r.ok, text: await r.text() }; }, about.url);
  check('…which loads the guide', linked.ok && linked.text === guide);

  await page.evaluate(() => navigator.clipboard.writeText(''));
  await click(page, '#about-copy-guide');
  await page.waitForFunction(() => document.getElementById('about-copy-guide').textContent === 'Copied', { timeout: 3000 }).catch(() => {});
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  check('About → Copy guide: the clipboard has the guide', copied.split('\n')[0] === GUIDE_HEADING && copied === guide, copied.slice(0, 60));
  check('…and the button says "Copied"', (await page.$eval('#about-copy-guide', b => b.textContent)) === 'Copied');
  check('…and About stays open', await page.$eval('#about-dialog', d => d.open));
  await sleep(2100);
  check('…then "Copy guide" again', (await page.$eval('#about-copy-guide', b => b.textContent)) === 'Copy guide');
  await page.keyboard.press('Escape');
  await sleep(50);

  // The File menu: the same link and button.
  await page.click('#file-menu summary');
  const menu = await page.$eval('#menu-guide', a => ({ text: a.textContent, href: a.getAttribute('href'), target: a.target, rel: a.rel }));
  check('File menu: "AI play guide" link, new tab, rel="noopener"', eq(menu, { text: 'AI play guide', href: 'docs/AI_PLAY_GUIDE.md', target: '_blank', rel: 'noopener' }), JSON.stringify(menu));
  check('…and Copy guide', (await page.$eval('#menu-copy-guide', b => b.textContent)) === 'Copy guide' && (await visible(page, '#menu-copy-guide')));
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.click('#menu-copy-guide');
  await page.waitForFunction(() => document.getElementById('toast').textContent === 'Copied the AI play guide', { timeout: 3000 }).catch(() => {});
  const fromMenu = await page.evaluate(() => navigator.clipboard.readText());
  check('File → Copy guide: the clipboard has the guide', fromMenu.split('\n')[0] === GUIDE_HEADING, fromMenu.slice(0, 60));
  check('…closes the menu and says so', !(await page.$eval('#file-menu', d => d.open)) && (await toast(page)) === 'Copied the AI play guide', await toast(page));

  console.log('\n== Served files ==');
  const served = await page.evaluate(async () => {
    const get = async path => { const r = await fetch(path); return { status: r.status, type: r.headers.get('content-type'), text: await r.text() }; };
    const help = document.querySelector('link[rel="help"]');
    const comment = [...document.head.childNodes].filter(n => n.nodeType === Node.COMMENT_NODE).map(n => n.textContent).join(' ');
    return { llms: await get('llms.txt'), guide: await get('docs/AI_PLAY_GUIDE.md'), help: help?.getAttribute('href'), helpUrl: help?.href, comment };
  });
  check('llms.txt loads as plain text', served.llms.status === 200 && /^text\/plain/.test(served.llms.type) && served.llms.text.startsWith('# Rugby Play Designer\n'), `${served.llms.status} ${served.llms.type}`);
  check('…links the guide and says how to paste a play', served.llms.text.includes('/docs/AI_PLAY_GUIDE.md') && served.llms.text.includes('File → Paste play…') && served.llms.text.includes('Import'));
  check('the guide loads as text', served.guide.status === 200 && /^text\//.test(served.guide.type) && served.guide.text === guide, `${served.guide.status} ${served.guide.type}`);
  check('the guide starts with how to put a play into the app', guide.includes('## Putting a play into the app') && guide.indexOf('## Putting a play into the app') < guide.indexOf('## 1. The pitch'));
  check('<link rel="help"> points to the guide', served.help === 'docs/AI_PLAY_GUIDE.md' && served.helpUrl === new URL('docs/AI_PLAY_GUIDE.md', URL_).href, served.help);
  check('a comment in <head> for AI agents names llms.txt and the guide', served.comment.includes('llms.txt') && served.comment.includes('docs/AI_PLAY_GUIDE.md'), served.comment);

  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== Paste play (390px phone) ==');
  const { browser, page, errors } = await open({ mobile: true });
  await page.tap('#file-menu summary');
  check('Paste play… and the guide are in the File menu', (await visible(page, '[data-file="paste"]')) && (await visible(page, '#menu-guide')) && (await visible(page, '#menu-copy-guide')));
  await page.tap('[data-file="paste"]');
  await page.waitForSelector('#paste-dialog[open]');
  const fits = await page.$eval('#paste-dialog', d => { const r = d.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
  check('the box fits the screen', fits);
  await paste(page, JSON.stringify(example));
  await page.tap('#paste-play-import');
  await sleep(200);
  check('imports on a phone', !(await isOpen(page)) && (await state(page)).name === example.name);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

process.exit(failed() ? 1 : 0);
