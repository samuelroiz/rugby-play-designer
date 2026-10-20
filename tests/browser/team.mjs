// Following the right team. "Our team" is the defense for a play in the "defense" category, else the attack
// (model.js ourTeam).
// 1. Phone viewer, defense play: the start screen lists the defenders, and picking one follows him like an
//    attacker (ring, team-mates faded, opponents near him in full, his job line and cues, "Defense 10" in the
//    header). An Attack / Defense switch lists the other side. Only one team: no switch.
// 2. The remembered position is per team: the attack's 10 doesn't preselect the defense's 10 (and an older
//    plain "10" is the attack's).
// 3. An attack play behaves as before: the attackers listed first, the switch on Attack.
// 4. Present mode's I play and Save animation's Who list both teams, our team first, "Defense 10" / "Attack 10".
import { open, click, check, failed, URL_, sleep, eq, pastePlay as paste } from './lib.mjs';
import { encodeShare } from '../../js/share.js';
import { animPlay } from '../anim-play.mjs';

const KEY = 'rugby-play-designer.viewer-position';

// The animation play as a defense play: the defense's 10 drifts in phase 1 (made job "Drift across") with a cue,
// a written job in phase 2, and nothing to do in phase 3. The attack's 10 has a cue too, which 10 of the
// defense must never see.
function defensePlay() {
  const p = animPlay();
  p.name = 'Drift defense';
  p.category = 'defense';
  p.phases[0].cues = [{ player: 'd10', step: 2, text: 'Drift!' }, { player: 'a10', step: 2, text: 'Go' }];
  p.phases[1].instructions = { d10: 'Watch 12 kick' };
  return p;
}
const D10_JOBS = ['Drift across', 'Watch 12 kick', 'Hold your spot'];
const attackPlay = () => ({ ...animPlay(), name: 'Attack play' });

async function openViewer(page, p) {
  await page.goto('about:blank');
  await page.goto(`${new URL('view.html', URL_).href}#p=${await encodeShare(p)}`);
  await page.waitForSelector('#start:not([hidden])');
}
const startScreen = page => page.evaluate(() => ({
  switchShown: !document.getElementById('team-switch').hidden,
  side: document.querySelector('#team-switch [aria-pressed="true"]')?.dataset.team ?? null,
  positions: [...document.querySelectorAll('#positions button')].map(b => [b.dataset.id, b.textContent]),
  pressed: [...document.querySelectorAll('#positions button[aria-pressed="true"]')].map(b => b.dataset.id),
  label: document.getElementById('positions').getAttribute('aria-label'),
}));
const remembered = page => page.evaluate(k => localStorage.getItem(k), KEY);

{
  console.log('\n== 1. Viewer: a defense play follows a defender ==');
  const { browser, page, errors } = await open({ mobile: true });
  await openViewer(page, defensePlay());
  let s = await startScreen(page);
  check('a defense play lists the defense\'s numbers', eq(s.positions, [['d10', '10'], ['d12', '12']]) && s.label === 'Defense positions', JSON.stringify(s));
  check('…with the Attack / Defense switch on Defense', s.switchShown && s.side === 'defense', JSON.stringify(s));
  const sw = await page.$$eval('#team-switch button', bs => bs.map(b => ({ text: b.textContent, h: b.getBoundingClientRect().height })));
  check('…the switch says Attack and Defense, buttons at least 44 px tall', eq(sw.map(b => b.text), ['Attack', 'Defense']) && sw.every(b => b.h >= 44), JSON.stringify(sw));
  check('…nothing picked yet', s.pressed.length === 0);
  check('no horizontal scroll', (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);

  await page.evaluate(() => {
    window.__frames = [];
    window.rugbyViewer.timeScale = 4;
    window.rugbyViewer.onFrame(f => window.__frames.push({
      phase: f.phase, mode: f.mode, players: f.players, bubble: f.bubble?.text ?? null,
      job: document.getElementById('job-box').hidden ? null : document.getElementById('job').textContent,
      who: document.getElementById('watch-who').textContent,
      ring: document.querySelector('#players-layer [data-id="d10"]').classList.contains('me'),
      otherRings: document.querySelectorAll('#players-layer .me').length,
    }));
  });
  await page.tap('#positions [data-id="d10"]');
  await sleep(100);
  let st = await page.evaluate(() => window.rugbyViewer.state());
  check('picking 10 follows the defense\'s 10', st.screen === 'watch' && st.mode === 'focus' && st.focus === 'd10' && st.playing, JSON.stringify(st));
  check('…remembered with his team', (await remembered(page)) === JSON.stringify({ team: 'defense', number: '10' }), await remembered(page));
  await page.waitForFunction(() => window.rugbyViewer.state().mode === 'replay', { timeout: 60000 }).catch(() => null);
  const focus = await page.evaluate(() => window.__frames.filter(f => f.mode === 'focus'));
  check(`the header says "Defense 10" (${focus.length} frames)`, focus.length > 30 && focus.every(f => f.who === 'Defense 10'), JSON.stringify([...new Set(focus.map(f => f.who))]));
  check('…he has the ring, and only he', focus.every(f => f.ring && f.otherRings === 1));
  check('…his team-mate (12) faded, him in full', focus.every(f => f.players.d10.opacity === 1 && f.players.d12.opacity < 1));
  const near = (f, id) => Math.hypot(f.players[id].x - f.players.d10.x, f.players[id].y - f.players.d10.y);
  const opp = focus.flatMap(f => ['a10', 'a12', 'a13'].map(id => ({ d: near(f, id), o: f.players[id].opacity })));
  check('…attackers within 15 m of him at full strength, the others faded', opp.some(o => o.d <= 15) && opp.some(o => o.d > 15) && opp.every(o => (o.d <= 15 ? o.o === 1 : o.o < 1)), JSON.stringify(opp.find(o => (o.d <= 15) !== (o.o === 1))));
  const jobs = [0, 1, 2].map(i => [...new Set(focus.filter(f => f.phase === i).map(f => f.job))]);
  check('…his job line for each phase: made ("Drift across"), written, made ("Hold your spot")', eq(jobs, D10_JOBS.map(j => [j])), JSON.stringify(jobs));
  const bubbles = [...new Set(focus.map(f => f.bubble).filter(Boolean))];
  check('…his cue pops up, never the attack\'s 10\'s', eq(bubbles, ['DRIFT!']), JSON.stringify(bubbles));

  console.log('\n== 1. Viewer: the switch lists the attackers ==');
  await page.tap('#home');
  s = await startScreen(page);
  check('back to the positions: still on Defense, his 10 picked', s.side === 'defense' && eq(s.pressed, ['d10']), JSON.stringify(s));
  await page.tap('#team-switch [data-team="attack"]');
  s = await startScreen(page);
  check('Attack lists the attack\'s numbers', s.side === 'attack' && eq(s.positions, [['a10', '10'], ['a12', '12'], ['a13', '13']]) && s.label === 'Attack positions', JSON.stringify(s));
  check('…and the attack\'s 10 isn\'t picked (the remembered 10 is the defense\'s)', s.pressed.length === 0, JSON.stringify(s.pressed));
  await page.evaluate(() => { window.__frames = []; });
  await page.tap('#positions [data-id="a10"]');
  await sleep(300);
  st = await page.evaluate(() => window.rugbyViewer.state());
  const last = await page.evaluate(() => window.__frames.at(-1));
  check('picking the attack\'s 10 follows him, "Attack 10" in the header', st.focus === 'a10' && st.mode === 'focus' && last?.who === 'Attack 10' && last.players.a12.opacity < 1, JSON.stringify({ focus: st.focus, who: last?.who }));
  check('…remembered as the attack\'s 10', (await remembered(page)) === JSON.stringify({ team: 'attack', number: '10' }));

  console.log('\n== 2. Viewer: the remembered position is per team ==');
  await openViewer(page, defensePlay());
  s = await startScreen(page);
  check('a fresh defense link with the attack\'s 10 remembered: Defense listed, its 10 not picked', s.side === 'defense' && s.pressed.length === 0, JSON.stringify(s));
  await page.tap('#team-switch [data-team="attack"]');
  check('…switching to Attack shows the attack\'s 10 picked', eq((await startScreen(page)).pressed, ['a10']));
  await page.evaluate(k => localStorage.setItem(k, '10'), KEY);
  await openViewer(page, defensePlay());
  check('an older plain "10" is the attack\'s 10: the defense\'s 10 isn\'t picked', (await startScreen(page)).pressed.length === 0);
  await page.tap('#team-switch [data-team="attack"]');
  check('…the attack\'s 10 is', eq((await startScreen(page)).pressed, ['a10']));

  console.log('\n== 3. Viewer: an attack play as before ==');
  await page.evaluate(k => localStorage.setItem(k, JSON.stringify({ team: 'defense', number: '10' })), KEY);
  await openViewer(page, attackPlay());
  s = await startScreen(page);
  check('an attack play lists the attack\'s numbers, the switch on Attack', s.side === 'attack' && eq(s.positions, [['a10', '10'], ['a12', '12'], ['a13', '13']]), JSON.stringify(s));
  check('…the defense\'s remembered 10 doesn\'t pick the attack\'s 10', s.pressed.length === 0);
  await page.tap('#positions [data-id="a10"]');
  await sleep(150);
  st = await page.evaluate(() => window.rugbyViewer.state());
  check('…picking 10 follows the attack\'s 10 with his job, "Attack 10" in the header', st.focus === 'a10' && st.job === 'Run your line, then pass to 12' && (await page.$eval('#watch-who', w => w.textContent)) === 'Attack 10', JSON.stringify(st));
  const onlyAttack = animPlay();
  onlyAttack.players = onlyAttack.players.filter(p => p.team === 'attack');
  for (const ph of onlyAttack.phases) {
    for (const id of ['d10', 'd12']) delete ph.positions[id];
    ph.routes = ph.routes.filter(r => !r.from.startsWith('d'));
  }
  await openViewer(page, onlyAttack);
  s = await startScreen(page);
  check('only one team in the play: no switch', !s.switchShown && s.positions.length === 3, JSON.stringify(s));
  const defOnly = { ...animPlay(), category: 'defense' };
  defOnly.players = defOnly.players.filter(p => p.team === 'defense');
  for (const ph of defOnly.phases) {
    for (const id of ['a10', 'a12', 'a13']) delete ph.positions[id];
    ph.routes = ph.routes.filter(r => !r.from.startsWith('a'));
  }
  await openViewer(page, defOnly);
  s = await startScreen(page);
  check('…a defense play of defenders only lists them, no switch', !s.switchShown && eq(s.positions, [['d10', '10'], ['d12', '12']]), JSON.stringify(s));
  check('viewer: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  console.log('\n== 4. Present mode I play and Save animation Who: both teams, ours first ==');
  const { browser, page, errors } = await open();
  await page.evaluate(() => { window.rugbyPlayback.timeScale = 0; });
  const options = sel => page.$$eval(`${sel} option`, os => os.map(o => [o.value, o.textContent]));
  const BOTH_D = [['d10', 'Defense 10'], ['d12', 'Defense 12'], ['a10', 'Attack 10'], ['a12', 'Attack 12'], ['a13', 'Attack 13']];
  const BOTH_A = [['a10', 'Attack 10'], ['a12', 'Attack 12'], ['a13', 'Attack 13'], ['d10', 'Defense 10'], ['d12', 'Defense 12']];

  await paste(page, defensePlay());
  await click(page, '#present-button');
  await sleep(100);
  check('defense play: I play lists None, then the defense, then the attack', eq(await options('#i-play'), [['', 'None'], ...BOTH_D]), JSON.stringify(await options('#i-play')));
  await page.select('#i-play', 'd10');
  await sleep(50);
  check('…I play the defense\'s 10: his job line', (await page.$eval('#present-job', j => (j.hidden ? null : j.textContent))) === '10Drift across');
  await page.select('#i-play', '');
  await page.keyboard.press('Escape');
  await sleep(100);
  await click(page, '#file-menu summary');
  await click(page, '[data-file="animation"]');
  await page.waitForSelector('#animation-dialog[open]');
  check('defense play: Save animation\'s Who lists Whole team, then the defense, then the attack', eq(await options('#animation-who'), [['', 'Whole team'], ...BOTH_D]), JSON.stringify(await options('#animation-who')));
  await page.click('#animation-cancel');
  await sleep(100);

  await paste(page, attackPlay());
  await click(page, '#present-button');
  await sleep(100);
  check('attack play: I play lists the attack first', eq(await options('#i-play'), [['', 'None'], ...BOTH_A]), JSON.stringify(await options('#i-play')));
  await page.keyboard.press('Escape');
  await sleep(100);
  await click(page, '#file-menu summary');
  await click(page, '[data-file="animation"]');
  await page.waitForSelector('#animation-dialog[open]');
  check('attack play: Who lists the attack first', eq(await options('#animation-who'), [['', 'Whole team'], ...BOTH_A]), JSON.stringify(await options('#animation-who')));
  await page.click('#animation-cancel');
  check('editor: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(failed() ? `\n${failed()} FAILED` : '\nALL PASSED');
process.exit(failed() ? 1 : 0);
