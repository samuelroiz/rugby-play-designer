// Selection in crowded spots, and "Selected: …" in the status line. A click where a player overlaps the
// ball or a ruck picks the player; the same spot clicked again picks what's under them (and round again);
// a part of the ball or ruck clear of the player picks it straight away; a double click still edits the
// number. The status line names what's selected while no hint or message is up.
import { open, click, tap, toScreen, check, failed } from './lib.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const SLOW = 500; // between clicks on the same spot: slower than a double click (400 ms)

const play = {
  schemaVersion: 1, name: 'Crowded', category: 'attack', tags: [], view: 'full', orientation: 'horizontal',
  players: [
    { id: 'a9', team: 'attack', label: '9' }, { id: 'a7', team: 'attack', label: '7' },
    { id: 'a10', team: 'attack', label: '10' }, { id: 'a12', team: 'attack', label: '12' },
  ],
  phases: [{
    note: '',
    positions: { a9: { x: 50, y: 35 }, a7: { x: 40, y: 20 }, a10: { x: 55, y: 45 }, a12: { x: 60, y: 55 } },
    objects: [{ id: 'o1', type: 'ball', x: 51.5, y: 35 }, { id: 'o2', type: 'ruck', x: 40, y: 20 }],
    routes: [
      { id: 'r1', type: 'pass', from: 'a10', to: 'a12', points: [[55, 45], [60, 55]], order: 1 },
      { id: 'r2', type: 'run', from: 'a12', points: [[60, 55], [72, 55]], order: 2 },
    ],
  }],
};

async function paste(page, p) {
  await click(page, '#file-menu summary');
  await click(page, '[data-file="paste"]');
  await page.waitForSelector('#paste-dialog[open]');
  await page.$eval('#paste-play-text', (t, text) => { t.value = text; }, JSON.stringify(p));
  await click(page, '#paste-play-import');
  await sleep(150);
  // "Imported Crowded" is up for a few seconds, in the status line's place: wait for it to go.
  await page.waitForFunction(() => document.getElementById('toast').hidden, { timeout: 7000 });
}

// What's selected, from the drawing: 'player a9', 'object o1', 'route r1' or null.
const selected = page => page.evaluate(() => {
  const p = document.querySelector('#players-layer [data-kind="player"].selected');
  if (p) return `player ${p.dataset.id}`;
  const o = document.querySelector('[data-kind="object"]:has(.select-ring)');
  if (o) return `object ${o.dataset.id}`;
  const h = document.querySelector('#handles-layer [data-kind="handle"]');
  return h ? `route ${h.dataset.id}` : null;
});
// The status line's "Selected: …", or null when it isn't showing.
const status = page => page.$eval('#selection-status', s => (s.hidden || !s.offsetWidth ? null : s.textContent));
// What's under a pitch point, top down.
const under = (page, x, y) => toScreen(page, x, y).then(q => page.evaluate(q => document.elementsFromPoint(q.x, q.y)
  .map(el => el.closest('[data-kind]')).filter(Boolean).map(el => `${el.dataset.kind} ${el.dataset.id}`), q));
const clickAt = async (page, x, y) => { await tap(page, x, y); await sleep(SLOW); };
const grass = page => clickAt(page, 85, 10);

{
  console.log('\n== A player on the ball ==');
  const { browser, page, errors } = await open();
  await paste(page, play);
  check('no status with nothing selected', (await status(page)) === null);
  const both = await under(page, 50.8, 35);
  check('the spot (50.8, 35) is on the ball and on 9, the ball on top', both[0] === 'object o1' && both.includes('player a9'), both.join());
  await clickAt(page, 50.8, 35);
  check('the first click picks the player', (await selected(page)) === 'player a9', await selected(page));
  check('…"Selected: 9"', (await status(page)) === 'Selected: 9', await status(page));
  await clickAt(page, 50.8, 35);
  check('the same spot again picks the ball', (await selected(page)) === 'object o1', await selected(page));
  check('…"Selected: ball"', (await status(page)) === 'Selected: ball', await status(page));
  await clickAt(page, 50.8, 35);
  check('…and again goes back to 9', (await selected(page)) === 'player a9', await selected(page));

  await grass(page);
  check('a click on grass selects nothing, no status', (await selected(page)) === null && (await status(page)) === null);
  const clear = await under(page, 52.7, 35);
  check('(52.7, 35) is on the ball, clear of any player', clear.includes('object o1') && !clear.some(k => k.startsWith('player')), clear.join());
  await clickAt(page, 52.7, 35);
  check('a part of the ball clear of the player picks the ball', (await selected(page)) === 'object o1', await selected(page));
  await clickAt(page, 50.8, 35);
  check('then a click on the overlap (a new spot) picks 9', (await selected(page)) === 'player a9', await selected(page));

  // Dragging the ball after picking it: pressing the same spot keeps the ball, so the drag moves it.
  await clickAt(page, 50.8, 35);
  const a = await toScreen(page, 50.8, 35);
  const b = await toScreen(page, 50.8, 25);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(a.x, a.y + (b.y - a.y) * i / 8);
  await page.mouse.up();
  await sleep(100);
  const s = await page.evaluate(() => JSON.parse(JSON.stringify(window.playState)));
  const ball = s.phases[0].objects.find(o => o.id === 'o1');
  check('after picking the ball, a drag from the same spot moves the ball, not 9', Math.abs(ball.y - 25) < 0.6 && s.phases[0].positions.a9.y === 35, JSON.stringify({ ball, a9: s.phases[0].positions.a9 }));
  await click(page, '[data-action="undo"]');
  await sleep(100);

  // A double click on the player still edits the number.
  await grass(page);
  await tap(page, 50.8, 35);
  await sleep(80);
  await tap(page, 50.8, 35);
  await sleep(100);
  const edit = await page.$eval('#inline-edit', i => (i.hidden ? null : i.value));
  check('a double click on 9 over the ball edits 9\'s number', edit === '9', String(edit));
  await page.keyboard.press('Escape');
  check('ball: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== A ruck under a player, and the status for each kind ==');
  const { browser, page, errors } = await open();
  await paste(page, play);
  await clickAt(page, 40, 20);
  check('a click on 7, standing on the ruck, picks 7', (await selected(page)) === 'player a7' && (await status(page)) === 'Selected: 7', `${await selected(page)} / ${await status(page)}`);
  await clickAt(page, 40, 20);
  check('the same spot again picks the ruck: "Selected: ruck"', (await selected(page)) === 'object o2' && (await status(page)) === 'Selected: ruck', `${await selected(page)} / ${await status(page)}`);
  await grass(page);
  await clickAt(page, 42.5, 20);
  check('a part of the ruck clear of 7 picks the ruck', (await selected(page)) === 'object o2', await selected(page));

  await grass(page);
  await clickAt(page, 57.5, 50);
  check('the pass: "Selected: 10\'s pass to 12"', (await status(page)) === "Selected: 10's pass to 12", await status(page));
  await grass(page);
  await clickAt(page, 67, 55);
  check('a run: "Selected: 12\'s run"', (await status(page)) === "Selected: 12's run", await status(page));

  // Something else being said takes its place: a tool's hint, a message.
  await clickAt(page, 50, 35);
  await click(page, '[data-route="run"]');
  await sleep(100);
  const hint = await page.$eval('#draw-hint', h => (h.hidden ? null : h.textContent));
  check('with a route tool on, the hint shows instead', hint && (await status(page)) === null, `${hint} / ${await status(page)}`);
  await click(page, '[data-route="run"]');
  await sleep(100);
  check('…the tool off: "Selected: 9" again', (await status(page)) === 'Selected: 9', await status(page));
  await page.evaluate(() => { const t = document.getElementById('toast'); t.textContent = 'Saved Crowded.png'; t.hidden = false; });
  check('a message in the status line hides it', (await status(page)) === null);
  await page.evaluate(() => { document.getElementById('toast').hidden = true; });
  await page.keyboard.press('Escape');
  await sleep(100);
  check('Escape: nothing selected, no status', (await status(page)) === null);
  check('status: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== Phone 390x844 (touch) ==');
  const { browser, page, errors } = await open({ mobile: true });
  await paste(page, play);
  const touch = async (x, y) => { await tap(page, x, y, { touch: true }); await sleep(SLOW); };
  const before = await toScreen(page, 50.8, 35);
  await touch(50.8, 35);
  check('a tap on 9 over the ball picks 9', (await selected(page)) === 'player a9', await selected(page));
  // Selecting 9 may resize the pitch (the side panel): the same pitch spot, wherever it now is on screen.
  const after = await toScreen(page, 50.8, 35);
  await touch(50.8, 35);
  check('a second tap on the same pitch spot picks the ball', (await selected(page)) === 'object o1', `${await selected(page)}; the spot moved from ${JSON.stringify(before)} to ${JSON.stringify(after)}`);
  check('phone: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

process.exit(failed() ? 1 : 0);
