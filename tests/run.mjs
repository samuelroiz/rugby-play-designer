// Runs every test: the Node tests, then both browser suites against the site served on a free local port.
// Used by `npm test`. The server is Node's own http module, so the site itself still needs no packages.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(data);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE_URL = `http://127.0.0.1:${server.address().port}/`;
console.log(`Serving ${ROOT} at ${BASE_URL}`);

const testFiles = fs.readdirSync(path.join(ROOT, 'tests')).filter(f => f.endsWith('.test.js')).map(f => path.join('tests', f));
const steps = [
  ['Node tests', ['--test', ...testFiles]],
  ['Browser suite', ['tests/browser/suite.mjs']],
  ['Click-to-draw suite', ['tests/browser/clickdraw.mjs']],
];

// Async child processes, so this process keeps serving while they run.
const run = args => new Promise(r => spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, BASE_URL } }).on('exit', code => r(code ?? 1)));

const results = [];
for (const [name, args] of steps) {
  console.log(`\n##### ${name}`);
  results.push([name, await run(args)]);
}
server.close();

console.log('\n##### Summary');
for (const [name, code] of results) console.log(`${code === 0 ? 'PASS' : 'FAIL'} ${name}`);
process.exit(results.every(([, code]) => code === 0) ? 0 : 1);
