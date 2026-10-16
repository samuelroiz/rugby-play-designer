// Shared helpers for driving the app in headless Chrome.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';

// Set by tests/run.mjs, which serves the repo on a free port.
export const URL_ = process.env.BASE_URL ?? 'http://localhost:8000/';

// Fresh folder for downloads and screenshots, outside the repo.
export const outDir = name => fs.mkdtempSync(path.join(os.tmpdir(), `rugby-${name}-`));

export async function open({ mobile = false, downloads = null } = {}) {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
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
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#phase-tabs button');
  return { browser, page, errors };
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
export const state = page => page.evaluate(() => JSON.parse(JSON.stringify(window.playState)));
export const shown = page => page.evaluate(() => Number(document.querySelector('#phase-tabs [aria-current="step"]').dataset.index));

let failures = 0;
export function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` -- ${detail}` : ''}`);
}
export const failed = () => failures;
