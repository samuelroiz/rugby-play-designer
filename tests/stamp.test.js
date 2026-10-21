// The version stamp (tools/stamp.mjs, `npm run stamp`): both pages carry the hash of the site's JS and CSS as it
// is now, on the stylesheet, the module script and every entry of an import map that covers every module. A
// change to a JS or CSS file without `npm run stamp` fails here. Run with: node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, PAGES, moduleFiles, siteVersion, stampedVersion, stampPage } from '../tools/stamp.mjs';

const read = page => fs.readFileSync(path.join(ROOT, page), 'utf8');
const map = html => JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]).imports;

test('both pages are stamped with the current files\' hash (run `npm run stamp` after changing JS or CSS)', () => {
  const version = siteVersion();
  for (const page of PAGES) assert.equal(stampedVersion(page), version, `${page} is stamped ${stampedVersion(page)}, the files hash to ${version}`);
});

test('stamping again changes nothing', () => {
  for (const page of PAGES) assert.equal(stampPage(read(page), siteVersion()), read(page), page);
});

test('the import map sends every module (js/*.js and vendor ES modules) to itself with ?v=', () => {
  const version = siteVersion();
  for (const page of PAGES) {
    const imports = map(read(page));
    assert.deepEqual(Object.keys(imports).sort(), moduleFiles().map(f => `./${f}`).sort(), page);
    for (const [from, to] of Object.entries(imports)) assert.equal(to, `${from}?v=${version}`, page);
  }
});

test('the stylesheet and the module script are versioned, after the import map', () => {
  const version = siteVersion();
  for (const [page, css, js] of [['index.html', 'styles.css', 'js/app.js'], ['view.html', 'view.css', 'js/view.js']]) {
    const html = read(page);
    assert.ok(html.includes(`<link rel="stylesheet" href="${css}?v=${version}">`), `${page}: ${css}`);
    const script = html.indexOf(`<script type="module" src="${js}?v=${version}"></script>`);
    assert.ok(script > html.indexOf('<script type="importmap">'), `${page}: ${js} after the import map`);
    for (const m of html.matchAll(/(?:href|src)="(?![a-z]+:)([^"]+\.(?:js|css)[^"]*)"/g)) assert.match(m[1], new RegExp(`\\?v=${version}$`), `${page}: ${m[1]}`);
  }
});

test('both pages have the same load watchdog, before the module script', () => {
  const watchdog = html => /<script>\n\s*\(\(\) => \{[\s\S]*?<\/script>/.exec(html)?.[0];
  const [a, b] = PAGES.map(page => watchdog(read(page)));
  assert.ok(a && a.includes('window.appReady') && a.includes("Couldn't load the app. This can happen right after an update."));
  assert.equal(a, b);
  for (const page of PAGES) assert.ok(read(page).indexOf(a) < read(page).indexOf('<script type="module"'), page);
});
