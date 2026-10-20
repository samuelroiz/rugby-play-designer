// `npm run stamp`: versions the site's JS and CSS so a browser never mixes old and new files after a deploy.
// It hashes every site JS/CSS file and writes the short hash into index.html and view.html: as ?v=<hash> on
// the stylesheet and the module script, and in an import map that sends every local module (js/*.js and the
// vendor ES modules) to the same file with ?v=<hash>. The site itself still has no build step: the pages are
// committed stamped, and tests/stamp.test.js fails if the stamp doesn't match the files.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PAGES = ['index.html', 'view.html'];

const list = dir => fs.readdirSync(path.join(ROOT, dir)).sort().map(f => `${dir}/${f}`);
// Every module an import can reach: the app's and the vendor ES modules (jsPDF is a plain script).
export const moduleFiles = () => [...list('js').filter(f => f.endsWith('.js')), ...list('vendor').filter(f => f.endsWith('.esm.js'))];
// Everything the version covers: the modules, jsPDF and the stylesheets.
export const siteFiles = () => [...moduleFiles(), ...list('vendor').filter(f => f.endsWith('.js') && !f.endsWith('.esm.js')), 'styles.css', 'view.css'].sort();

// A short hash of the files' names and contents.
export function siteVersion() {
  const h = crypto.createHash('sha256');
  for (const f of siteFiles()) h.update(`${f}\0`).update(fs.readFileSync(path.join(ROOT, f))).update('\0');
  return h.digest('hex').slice(0, 10);
}

// The version a page is stamped with: the one ?v= value it uses throughout, or null if it has none or several.
export function stampedVersion(page = 'index.html') {
  const found = new Set([...fs.readFileSync(path.join(ROOT, page), 'utf8').matchAll(/\?v=([0-9a-f]+)/g)].map(m => m[1]));
  return found.size === 1 ? [...found][0] : null;
}

export function importMap(version) {
  const imports = Object.fromEntries(moduleFiles().map(f => [`./${f}`, `./${f}?v=${version}`]));
  return JSON.stringify({ imports }, null, 2).replace(/\n/g, '\n  ');
}

const MAP = /<script type="importmap">[\s\S]*?<\/script>/;
// A local stylesheet or script: href="styles.css", src="js/app.js", with or without an old ?v=.
const LOCAL = /((?:href|src)="(?![a-z]+:)[^"?#]+\.(?:js|css))(?:\?v=[^"]*)?"/g;

export function stampPage(html, version) {
  if (!MAP.test(html)) throw new Error('no <script type="importmap"> block to fill');
  return html.replace(MAP, () => `<script type="importmap">\n  ${importMap(version)}\n  </script>`).replace(LOCAL, `$1?v=${version}"`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = siteVersion();
  for (const page of PAGES) {
    const file = path.join(ROOT, page);
    const before = fs.readFileSync(file, 'utf8');
    const after = stampPage(before, version);
    if (after !== before) fs.writeFileSync(file, after);
    console.log(`${page}: v=${version}${after === before ? ' (unchanged)' : ''}`);
  }
}
