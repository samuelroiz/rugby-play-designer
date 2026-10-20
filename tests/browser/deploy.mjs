// Versioned modules and load failures. Every JS and CSS request of the editor and the viewer carries the
// stamped ?v= (tools/stamp.mjs), lazy loads (jsPDF) too. Right after an update a browser may hold an old
// module: the test server's /__broken__/ copy of the site serves a js/model.js without the exports the other
// modules import, and /__hang__/ one that never arrives. Each page then shows "Couldn't load the app…" with
// a Reload button (within 8 s, never "Opening the play…" for ever), and Reload loads the page again with
// ?r=<time>, keeping the #hash. An uncaught error while the viewer opens a play shows the same message.
import fs from 'node:fs';
import { launch, open, click, check, failed, outDir, URL_ } from './lib.mjs';
import { stampedVersion } from '../../tools/stamp.mjs';
import { encodeShare } from '../../js/share.js';
import { animPlay } from '../anim-play.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const VERSION = stampedVersion('index.html');
const MESSAGE = "Couldn't load the app. This can happen right after an update.";
const HASH = `#p=${await encodeShare(animPlay())}`;

check('both pages are stamped with one version', VERSION && stampedVersion('view.html') === VERSION, `${VERSION} / ${stampedVersion('view.html')}`);

// Same-origin JS and CSS requests whose ?v= isn't the stamped version.
const site = new URL(URL_).origin;
const watchRequests = page => {
  const seen = [];
  page.on('request', r => {
    const u = new URL(r.url());
    if (u.origin === site && /\.(js|css)$/.test(u.pathname)) seen.push(u);
  });
  return {
    all: () => seen.map(u => u.pathname.split('/').pop()),
    unversioned: () => seen.filter(u => u.search !== `?v=${VERSION}`).map(u => u.pathname + u.search),
  };
};
const failure = page => page.evaluate(() => {
  const box = document.getElementById('load-failed');
  const loading = document.getElementById('loading');
  return box && {
    text: box.querySelector('p')?.textContent, button: box.querySelector('#load-failed-reload')?.textContent,
    covers: (() => { const r = box.getBoundingClientRect(); return r.width >= innerWidth - 1 && r.height >= innerHeight - 1; })(),
    loading: loading ? !loading.hidden : null,
  };
});

{
  console.log('\n== Editor: every module versioned ==');
  const dl = outDir('deploy');
  const { browser, page, errors } = await open({ downloads: dl });
  const requests = watchRequests(page);
  await page.goto('about:blank');
  await page.goto(URL_);
  await page.waitForSelector('#phase-tabs button');
  await sleep(300);
  check('the editor loads its modules and styles.css', ['app.js', 'model.js', 'editor.js', 'styles.css'].every(f => requests.all().includes(f)), requests.all().join());
  await click(page, '#file-menu summary');
  await click(page, '[data-file="pdf"]');
  for (let i = 0; i < 100 && !fs.readdirSync(dl).some(f => f.endsWith('.pdf')); i++) await sleep(100);
  check('…and jsPDF on Save PDF', requests.all().includes('jspdf.umd.min.js'), requests.all().join());
  check(`…every one with ?v=${VERSION}`, requests.unversioned().length === 0, requests.unversioned().join());
  const modules = await page.evaluate(() => import('./js/model.js').then(m => Object.keys(m).length));
  check('an import of ./js/model.js gets the versioned one (the import map)', modules > 0 && requests.unversioned().length === 0, requests.unversioned().join());
  check('no load message on a good load', !(await failure(page)));
  check('editor: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== Viewer: every module versioned, no message after 8 s ==');
  const { browser, page, errors } = await launch({ mobile: true });
  const requests = watchRequests(page);
  await page.goto(new URL('view.html', URL_).href + HASH);
  await page.waitForSelector('#start:not([hidden])', { timeout: 8000 });
  check('the viewer loads view.js, model.js and view.css', ['view.js', 'model.js', 'view.css'].every(f => requests.all().includes(f)), requests.all().join());
  check(`…every one with ?v=${VERSION}`, requests.unversioned().length === 0, requests.unversioned().join());
  await sleep(8500);
  check('8.5 s later the play is still open, no load message', !(await failure(page)) && await page.$eval('#start', s => !s.hidden));
  // The play opening again (a new link) and an uncaught error meanwhile: the message, not "Opening the play…".
  await page.evaluate(() => {
    window.DecompressionStream = class { constructor() { return new TransformStream({ flush: () => new Promise(() => {}) }); } };
    location.hash = '#p=AAAA';
  });
  await page.waitForFunction(() => !document.getElementById('loading').hidden);
  await page.evaluate(() => setTimeout(() => { throw new Error('simulated error while opening'); }));
  await page.waitForSelector('#load-failed', { timeout: 2000 }).catch(() => null);
  const f = await failure(page);
  check('an uncaught error while "Opening the play…" shows the load message instead', f?.text === MESSAGE && f.button === 'Reload' && f.loading === false, JSON.stringify(f));
  check('viewer: no errors but the simulated one', errors.every(e => e.includes('simulated error while opening')), errors.join(' | '));
  await browser.close();
}

// A page under /__broken__/ or /__hang__/: how long the message took, and Reload.
async function brokenLoad(kind, pageName, hash, { mobile }) {
  const { browser, page, errors } = await launch({ mobile });
  const url = `${URL_}${kind}/${pageName}${hash}`;
  const t0 = Date.now();
  // Not awaited: with a module that never arrives, the page never finishes loading.
  page.goto(url).catch(() => {});
  await page.waitForSelector('#load-failed', { timeout: 10000 }).catch(() => null);
  const ms = Date.now() - t0;
  const f = await failure(page);
  if (f) await page.click('#load-failed-reload');
  for (let i = 0; i < 50 && !new URL(page.url()).searchParams.has('r'); i++) await sleep(100);
  const after = new URL(page.url());
  await sleep(300);
  await page.waitForSelector('#load-failed', { timeout: 10000 }).catch(() => null);
  const again = await failure(page).catch(() => null);
  await browser.close();
  return { ms, f, after, again, errors };
}

for (const [pageName, hash, mobile] of [['view.html', HASH, true], ['index.html', '#phase=2', false]]) {
  console.log(`\n== ${pageName}: an old model.js without its exports ==`);
  const { ms, f, after, again, errors } = await brokenLoad('__broken__', pageName, hash, { mobile });
  check(`the load message within 8 s (${ms} ms)`, f && ms < 8000 && f.text === MESSAGE && f.button === 'Reload' && f.covers, JSON.stringify(f));
  if (pageName === 'view.html') check('…in place of "Opening the play…"', f?.loading === false, JSON.stringify(f));
  check('the error was the missing export', errors.some(e => /does not provide an export named/.test(e)), errors.join(' | '));
  check('Reload loads the page again with ?r=<time>, keeping the #hash', after.pathname.endsWith(`/__broken__/${pageName}`) && /^\d{13}$/.test(after.searchParams.get('r') ?? '') && after.hash === hash, after.href.slice(0, 120));
  check('…(still the old file here, so the message again)', again?.text === MESSAGE, JSON.stringify(again));
}

{
  console.log('\n== view.html: a module that never arrives ==');
  const { ms, f, after } = await brokenLoad('__hang__', 'view.html', HASH, { mobile: true });
  check(`the load message after 8 s (${ms} ms), not "Opening the play…" for ever`, f && ms >= 7500 && ms < 9500 && f.text === MESSAGE && f.loading === false, JSON.stringify(f));
  check('Reload keeps the #hash', after.hash === HASH && after.searchParams.has('r'));
}

process.exit(failed() ? 1 : 0);
