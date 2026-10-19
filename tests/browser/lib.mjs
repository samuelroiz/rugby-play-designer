// Shared helpers for driving the app in headless Chrome.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';

// Set by tests/run.mjs, which serves the repo on a free port.
export const URL_ = process.env.BASE_URL ?? 'http://localhost:8000/';

// Fresh folder for downloads and screenshots, outside the repo.
export const outDir = name => fs.mkdtempSync(path.join(os.tmpdir(), `rugby-${name}-`));

// A fresh browser on the app with storage cleared. The Welcome box (first visit) is marked as seen, so it
// doesn't open over the other suites; `welcome: true` leaves it a true first visit, and `hash` opens with
// that address hash (e.g. '#phase=2').
export const WELCOME_KEY = 'rugby-play-designer.welcome-seen';
export async function open({ mobile = false, downloads = null, welcome = false, hash = '' } = {}) {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  // The app must never open a native prompt, alert or confirm: any one fails the suite.
  page.on('dialog', d => {
    check(`no native ${d.type()} dialog`, false, d.message());
    errors.push(`native ${d.type()}: ${d.message()}`);
    d.dismiss().catch(() => {});
  });
  if (mobile) {
    await page.emulate({
      viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });
  } else {
    await page.setViewport({ width: 1440, height: 900 });
  }
  if (downloads) {
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
  }
  await page.goto(URL_);
  await page.waitForSelector('#phase-tabs button'); // the app has opened its library
  await page.evaluate(clearStorage, welcome, WELCOME_KEY);
  // A fresh load of the address (a reload would keep the #phase=1 the first load wrote).
  await page.goto('about:blank');
  await page.goto(URL_ + hash);
  await page.waitForSelector('#phase-tabs button');
  return { browser, page, errors };
}

// Empties everything the site keeps in this browser: localStorage, sessionStorage and the play library's
// IndexedDB database (the app closes its connection when asked, so the delete goes through).
export async function clearStorage(welcome = true, key = WELCOME_KEY) {
  localStorage.clear();
  sessionStorage.clear();
  if (!welcome) localStorage.setItem(key, '1');
  await new Promise(r => { const q = indexedDB.deleteDatabase('rugby-play-designer'); q.onsuccess = q.onerror = q.onblocked = () => r(); });
}

// The play library, through the app's test hook (window.rugbyLibrary).
export const openId = page => page.evaluate(() => window.rugbyLibrary.openId());
// Every entry (most recently edited first): { id, name, deleted, play, updated }.
export const plays = page => page.evaluate(() => window.rugbyLibrary.all().map(r => ({ id: r.id, name: r.play.name, deleted: r.deletedAt != null, play: r.play, updated: r.updated })));
// The open play's entry as written to storage (after any writes in flight), as text: { play, phase, updated }.
export const stored = page => page.evaluate(async () => {
  const lib = window.rugbyLibrary;
  await lib.settled();
  const r = await lib.read(lib.openId());
  return r ? JSON.stringify({ play: r.play, phase: r.phase, updated: r.updated }) : null;
});

// File → Load file…: picks `file` and waits for it to open as a new play.
export async function loadFile(page, file) {
  const before = await openId(page);
  await (await page.$('#load-input')).uploadFile(file);
  await page.waitForFunction(id => window.rugbyLibrary.openId() !== id, { timeout: 5000 }, before);
  await new Promise(r => setTimeout(r, 50));
}

// Pitch metres -> client px.
export const toScreen = (page, x, y) => page.evaluate((x, y) => {
  const m = document.getElementById('world').getScreenCTM();
  const p = new DOMPoint(x, y).matrixTransform(m);
  return { x: p.x, y: p.y };
}, x, y);

// Drag in pitch metres with the mouse (or touch-style pointer events when `touch`).
export async function drag(page, from, to, { touch = false, steps = 8 } = {}) {
  const a = await toScreen(page, from[0], from[1]);
  const b = await toScreen(page, to[0], to[1]);
  if (!touch) {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) await page.mouse.move(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps);
    await page.mouse.up();
    return;
  }
  await page.touchscreen.touchStart(a.x, a.y);
  for (let i = 1; i <= steps; i++) await page.touchscreen.touchMove(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps);
  await page.touchscreen.touchEnd();
}

export async function tap(page, x, y, { touch = false } = {}) {
  const a = await toScreen(page, x, y);
  if (touch) await page.touchscreen.tap(a.x, a.y);
  else await page.mouse.click(a.x, a.y);
}

export const click = (page, sel) => page.$eval(sel, b => b.click());

// Resolves after the page's next animation frame (drags redraw once a frame).
export const nextFrame = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));

// Add attack / Add defender: opens the number picker, then Enter picks the highlighted (next free) number,
// or `n` picks that number. On a phone (`touch`) the buttons are tapped. The player then waits to be placed:
// `at` ([x, y] in pitch metres) clicks (or taps) there; otherwise Escape puts them at their usual spot.
export async function addPlayer(page, team, { n = null, touch = false, at = null } = {}) {
  const button = `[data-action="add-${team === 'attack' ? 'attack' : 'defense'}"]`;
  if (touch) await page.tap(button); else await click(page, button);
  await page.waitForSelector('#number-dialog[open]');
  if (n == null && !touch) await page.keyboard.press('Enter');
  else if (touch) await page.tap(n == null ? '#number-grid .next' : `#number-grid [data-n="${n}"]`);
  else await click(page, `#number-grid [data-n="${n}"]`);
  if (at) await tap(page, at[0], at[1], { touch });
  else await page.keyboard.press('Escape');
}

// Set piece: picks `value` (e.g. 'scrum-attack', 'lineout-defense') in the Set piece box, then clicks where the
// mark goes: `at` ([x, y] in pitch metres), or where the box used to put it (the phase's scrum or lineout
// marker if it has one, otherwise the middle of the view, on the 5 m line for a lineout).
export async function placeSetPiece(page, value, at = null) {
  await click(page, '[data-action="set-piece"]');
  await page.waitForSelector('#set-piece-dialog[open]');
  await page.click(`#set-piece-dialog button[value="${value}"]`);
  await new Promise(r => setTimeout(r, 50)); // the box's close event, which starts placing
  at ??= await page.evaluate(kind => {
    const s = window.playState;
    const ph = s.phases[Number(document.querySelector('#phase-tabs [aria-current="step"]').dataset.index)];
    const o = ph.objects.find(q => q.type === kind && (kind === 'lineout' || q.pack));
    if (o) return [o.x, o.y];
    const x = { full: 50, half: 77.5, 'half-own': 22.5 }[s.view] ?? 50;
    return kind === 'lineout' ? [x, 5] : [x, 35];
  }, value.split('-')[0]);
  await tap(page, at[0], at[1]);
}

// Answers the app's own confirm box (OK or Cancel) once it is open. Returns its message.
export async function answerConfirm(page, ok = true) {
  await page.waitForSelector('#confirm-dialog[open]', { timeout: 5000 });
  const message = await page.$eval('#confirm-message', p => p.textContent);
  await page.click(ok ? '#confirm-ok' : '#confirm-dialog .cancel');
  await page.waitForFunction(() => !document.getElementById('confirm-dialog').open);
  await new Promise(r => setTimeout(r, 50)); // the close event, then the change
  return message;
}
export const state = page => page.evaluate(() => JSON.parse(JSON.stringify(window.playState)));
export const shown = page => page.evaluate(() => Number(document.querySelector('#phase-tabs [aria-current="step"]').dataset.index));

let failures = 0;
export function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` -- ${detail}` : ''}`);
}
export const failed = () => failures;
