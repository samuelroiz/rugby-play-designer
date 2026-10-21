#!/usr/bin/env node
// Validates a Rugby Play Designer play file against the app's rules and the AI play guide.
// Usage: node validate_play.mjs <play.json> [--repo <path-to-rugby-play-designer>]
//
// No npm packages. Exit code 0 = no errors (warnings allowed), 1 = errors, 2 = can't read file.
// With --repo (or when run inside the repo), it also loads the play with the app's own
// parsePlay (js/storage.js), so what the app would silently drop or default is reported too.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BALL_ROUTES, MOVING_ROUTES, ROUTE_TYPES, BALL_OFFSET, HOLD_RADIUS,
  dist, byOrder, playedRoutes, ballFlights, positionsAfter, movingBall, receiverOf,
  schedulePhase, nextPhase, curvePoint, posAt,
} from './play-model.mjs';

const MIN_GAP = 2.5; // metres between player centres (the guide's spacing rule)
const OVERLAP = 2.4; // discs are 2.4 m wide: closer than this and they visibly overlap
const LINEOUT_GAP = 2.35; // the lineout preset's two lines stand 2.4 m apart
const NAME_MAX = 60, LABEL_MAX = 3, INSTRUCTION_MAX = 120, CUE_MAX = 30, OPTION_LABEL_MAX = 25;
const CATEGORIES = ['attack', 'defense', 'lineout', 'scrum'];
// Kick vocabulary from the app (js/jobs.js KICK): grubber < 15 m, long >= 35 m. A kick much past
// 55 m in the air, or under 3 m, is a mistake, not a kick.
const KICK_MIN = 3, KICK_MAX = 55;

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const repoFlag = args.indexOf('--repo');
let repo = repoFlag >= 0 ? args[repoFlag + 1] : null;
if (!file) { console.error('Usage: node validate_play.mjs <play.json> [--repo <path>]'); process.exit(2); }

let play;
try {
  play = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`Can't read ${file}: ${e.message}`);
  process.exit(2);
}

const errors = [];
const warnings = [];
const err = m => errors.push(m);
const warn = m => warnings.push(m);
const fmt = p => `(${p.x ?? p[0]}, ${p.y ?? p[1]})`;

// --- Top level (what parsePlay requires or quietly fixes) ---
if (play.schemaVersion !== 1) err(`schemaVersion must be 1 (got ${JSON.stringify(play.schemaVersion)})`);
if (!Array.isArray(play.players)) err('players must be a list');
if (!Array.isArray(play.phases) || !play.phases.length) err('phases must be a non-empty list');
if (errors.length) { report(); process.exit(1); }

if (typeof play.name !== 'string' || !play.name.trim()) warn('no name: the app will call it "Untitled play"');
else if (play.name.length > NAME_MAX) warn(`name longer than ${NAME_MAX} characters: the app cuts it`);
if (play.category && !CATEGORIES.includes(play.category)) warn(`category "${play.category}" unknown: the app will use "attack"`);

// --- Players ---
const ids = new Set();
for (const p of play.players) {
  if (!p || typeof p.id !== 'string' || !['attack', 'defense'].includes(p.team)) { err(`player ${JSON.stringify(p?.id)} is missing id or team`); continue; }
  if (ids.has(p.id)) err(`player id ${p.id} appears twice`);
  ids.add(p.id);
  const m = /^([ad])(\d{1,2})$/.exec(p.id);
  if (!m || +m[2] < 1 || +m[2] > 15) err(`player id ${p.id} isn't a1-a15 or d1-d15`);
  else if ((m[1] === 'a') !== (p.team === 'attack')) err(`player ${p.id}: id letter doesn't match team "${p.team}"`);
  if (p.label != null && String(p.label).length > LABEL_MAX) warn(`player ${p.id}: label longer than ${LABEL_MAX} characters is cut`);
}
const team = id => (id?.[0] === 'd' ? 'defense' : 'attack');
const fwd = id => (team(id) === 'defense' ? -1 : 1); // the way this player's team attacks

// --- Each phase ---
play.phases.forEach((ph, i) => {
  const n = i + 1;
  const P = ph.positions ?? {};
  const routes = ph.routes ?? [];
  const objects = ph.objects ?? [];

  // Every player positioned, on the pitch.
  for (const id of ids) {
    const p = P[id];
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') { err(`phase ${n}: ${id} has no position (the app fills it from another phase, which is rarely right)`); continue; }
    if (p.x < -10 || p.x > 110 || p.y < 1 || p.y > 69) err(`phase ${n}: ${id} at ${fmt(p)} is off the pitch (x -10..110, y 1..69)`);
  }
  for (const id of Object.keys(P)) if (!ids.has(id)) warn(`phase ${n}: position for unknown player ${id} (the app drops it)`);

  // Markers.
  const lineoutPacks = new Set();
  for (const o of objects) {
    if (!o || typeof o.id !== 'string' || typeof o.type !== 'string' || typeof o.x !== 'number' || typeof o.y !== 'number') { err(`phase ${n}: a marker is missing id, type, x or y`); continue; }
    if (o.type === 'scrum' && ![15, 35, 55].includes(o.y)) warn(`phase ${n}: scrum ${o.id} at y=${o.y}; the guide uses y 15, 35 or 55`);
    if (o.type === 'lineout') {
      if (![5, 65].includes(o.y)) warn(`phase ${n}: lineout ${o.id} at y=${o.y}; the guide uses y 5 or 65`);
      for (const id of o.pack ?? []) lineoutPacks.add(id);
    }
  }
  const idsOnce = new Set();
  for (const o of objects) { if (idsOnce.has(o.id)) err(`phase ${n}: marker id ${o.id} appears twice`); idsOnce.add(o.id); }

  // Spacing at the start of the phase, and at the ends of moving routes.
  const checkGaps = (entries, where) => {
    for (let a = 0; a < entries.length; a++) for (let b = a + 1; b < entries.length; b++) {
      const [idA, pA] = entries[a], [idB, pB] = entries[b];
      const d = dist(pA, pB);
      const lineoutPair = lineoutPacks.has(idA) && lineoutPacks.has(idB);
      if (d < (lineoutPair ? LINEOUT_GAP : OVERLAP)) err(`phase ${n} ${where}: ${idA} and ${idB} only ${d.toFixed(1)} m apart - their discs overlap (need 2.5)`);
      else if (!lineoutPair && d < MIN_GAP - 1e-9) warn(`phase ${n} ${where}: ${idA} and ${idB} are ${d.toFixed(2)} m apart; the guide asks for 2.5`);
    }
  };
  checkGaps(Object.entries(P).filter(([id]) => ids.has(id)), 'start');
  checkGaps(Object.entries(positionsAfter(playedRoutes(routes), P)).filter(([id]) => ids.has(id)), 'route ends');

  // Routes.
  const routeIds = new Set();
  const lastMoveEnd = {}; // player -> [x, y] end of their last checked moving route
  for (const r of byOrder(routes)) {
    if (!r || typeof r.id !== 'string') { err(`phase ${n}: a route has no id`); continue; }
    if (routeIds.has(r.id)) err(`phase ${n}: route id ${r.id} appears twice`);
    routeIds.add(r.id);
    const at = `phase ${n} ${r.id} (${r.type})`;
    if (!ROUTE_TYPES.has(r.type)) err(`${at}: unknown type`);
    if (!Array.isArray(r.points) || r.points.length < 2 || !r.points.every(p => Array.isArray(p) && p.length === 2 && p.every(v => typeof v === 'number'))) { err(`${at}: points must be at least two [x, y] pairs`); continue; }
    if (r.points.length > 2) warn(`${at}: ${r.points.length} points; the guide uses exactly two`);
    if (!Number.isInteger(r.order) || r.order < 1 || r.order > 99) err(`${at}: order must be a whole number 1-99 (the app drops a bad one, which changes the timing)`);
    if (r.from != null && !ids.has(r.from)) err(`${at}: from "${r.from}" isn't in the play (the app makes the route loose)`);
    if (r.to != null && r.type !== 'pass') warn(`${at}: "to" belongs on passes only`);
    if (r.option != null && !/^[A-Z]$/.test(r.option)) err(`${at}: option must be a single capital letter or null`);
    if (r.option && !BALL_ROUTES.has(r.type)) err(`${at}: only passes and kicks can be options`);
    if (r.optionLabel && !r.option) warn(`${at}: optionLabel without option is dropped`);
    if (r.optionLabel && r.optionLabel.length > OPTION_LABEL_MAX) warn(`${at}: optionLabel longer than ${OPTION_LABEL_MAX} characters is cut`);
    if (typeof r.curve === 'number' && Math.abs(r.curve) > 0.25 * dist({ x: r.points[0][0], y: r.points[0][1] }, { x: r.points.at(-1)[0], y: r.points.at(-1)[1] })) warn(`${at}: curve ${r.curve} is over a quarter of the route's length; keep it smaller`);

    // First point on the player (or on the end of their previous moving route).
    if (r.from && ids.has(r.from) && P[r.from]) {
      const expect = MOVING_ROUTES.has(r.type) && lastMoveEnd[r.from] ? lastMoveEnd[r.from] : [P[r.from].x, P[r.from].y];
      const d = Math.hypot(r.points[0][0] - expect[0], r.points[0][1] - expect[1]);
      if (d > 0.05) err(`${at}: first point ${fmt(r.points[0])} isn't on ${r.from}${lastMoveEnd[r.from] ? "'s previous route end" : ''} at ${fmt({ x: expect[0], y: expect[1] })}`);
      if (MOVING_ROUTES.has(r.type)) lastMoveEnd[r.from] = r.points.at(-1);
    }
    // A pass's second point on the receiver's start-of-phase spot.
    if (r.type === 'pass') {
      if (!r.to) warn(`${at}: no "to"; the app gives it to the nearest team-mate within 5 m of its end, or nobody`);
      else if (!ids.has(r.to)) err(`${at}: to "${r.to}" isn't in the play`);
      else if (team(r.to) !== team(r.from)) err(`${at}: pass to an opponent`);
      else if (P[r.to]) {
        const d = Math.hypot(r.points.at(-1)[0] - P[r.to].x, r.points.at(-1)[1] - P[r.to].y);
        if (d > 0.05) err(`${at}: second point ${fmt(r.points.at(-1))} isn't on ${r.to}'s start ${fmt(P[r.to])} (the guide stores a pass to the receiver's start, even for a catch on the run)`);
      }
    }
  }

  // Option groups: letters share one order; two unlettered passes/kicks from one player both play.
  const byFrom = {};
  for (const r of routes) if (BALL_ROUTES.has(r.type) && r.from) (byFrom[r.from] ??= []).push(r);
  for (const [from, group] of Object.entries(byFrom)) {
    const lettered = group.filter(r => r.option);
    const plain = group.filter(r => !r.option);
    if (group.length > 1 && plain.length > 1) err(`phase ${n}: ${from} has ${plain.length} passes/kicks with option null; they'd play one after another. Letter them A, B...`);
    if (lettered.length) {
      const letters = lettered.map(r => r.option).sort();
      if (letters[0] !== 'A') err(`phase ${n}: ${from}'s options are ${letters.join(', ')}; they must start at A (A is the plan)`);
      if (new Set(letters).size !== letters.length) err(`phase ${n}: ${from} has two options with the same letter`);
      if (new Set(lettered.map(r => r.order ?? 0)).size > 1) err(`phase ${n}: ${from}'s options must share one order number`);
      if (plain.length) err(`phase ${n}: ${from} mixes lettered options with an unlettered pass/kick`);
    }
  }

  // The ball: near the first passer/kicker at the start of the phase.
  const flights = ballFlights(routes);
  const balls = objects.filter(o => o.type === 'ball');
  if (balls.length > 1) warn(`phase ${n}: ${balls.length} balls; one per phase is normal`);
  if (flights.length) {
    const first = flights[0];
    const ball = movingBall(objects, first);
    if (!ball) err(`phase ${n}: there's a pass/kick but no ball marker`);
    else if (first.from && P[first.from] && dist(ball, P[first.from]) > HOLD_RADIUS) {
      err(`phase ${n}: the ball ${fmt(ball)} is ${dist(ball, P[first.from]).toFixed(1)} m from the first passer ${first.from} ${fmt(P[first.from])}; put it at their x+${BALL_OFFSET.x}, y+${BALL_OFFSET.y}`);
    }
  }

  // Flights as the app animates them: forward passes (at release AND at the catch point), kick
  // lengths, and chasers/offside. Checked for the A plan and for each lettered alternative.
  const options = [...new Set(routes.filter(r => r.option).map(r => r.option))];
  for (const opt of options.length ? options : ['A']) {
    const sched = schedulePhase(ph, opt);
    for (const f of sched.flights) {
      const r = f.route;
      const tag = `phase ${n} ${r.id} (${r.type}${r.option ? ' option ' + r.option : ''})`;
      if (r.type === 'pass' && r.from && f.to) {
        const ahead = fwd(r.from) * (f.catchAt.x - f.release.x);
        if (ahead > 0.05) err(`${tag}: FORWARD PASS as the app plays it: released at x ${f.release.x.toFixed(1)}, caught at x ${f.catchAt.x.toFixed(1)} (${ahead.toFixed(1)} m forward). Move the receiver deeper or shorten the runs before the pass.`);
      }
      if (r.type === 'kick') {
        const len = dist(f.release, { x: r.points.at(-1)[0], y: r.points.at(-1)[1] });
        if (len < KICK_MIN) warn(`${tag}: a ${len.toFixed(1)} m kick is too short to mean anything`);
        if (len > KICK_MAX) err(`${tag}: ${len.toFixed(1)} m in the air isn't a realistic kick (keep under ~${KICK_MAX} m)`);
        // Chasers in front of the kicker are offside; team-mates who move this phase should start level or behind.
        if (r.from) {
          for (const m of sched.moves) {
            if (team(m.player) !== team(r.from) || m.player === r.from) continue;
            const aheadAtKick = fwd(r.from) * (P[m.player].x - f.release.x);
            if (aheadAtKick > 0.5) warn(`${tag}: ${m.player} starts ${aheadAtKick.toFixed(1)} m in front of the kick and moves this phase - an offside chaser. Let them hold, and advance them next phase.`);
          }
          // Someone should get to a chaseable kick (within 10 m of where it lands).
          const end = { x: r.points.at(-1)[0], y: r.points.at(-1)[1] };
          const kickTeamRuns = sched.moves.filter(m => team(m.player) === team(r.from) && m.route.type === 'run');
          const nextRoutes = play.phases[i + 1]?.routes ?? [];
          const chasedNow = kickTeamRuns.some(m => dist({ x: m.route.points.at(-1)[0], y: m.route.points.at(-1)[1] }, end) <= 10);
          const chasedNext = nextRoutes.some(r2 => r2.type === 'run' && r2.from && team(r2.from) === team(r.from) && dist({ x: r2.points.at(-1)[0], y: r2.points.at(-1)[1] }, end) <= 10);
          if (!chasedNow && !chasedNext && (!r.option || r.option === 'A')) warn(`${tag}: no team-mate's run ends within 10 m of the kick (this phase or the next); nobody chases it`);
        }
      }
    }
  }

  // Pop passes: a pass at the same order as its receiver's run is meant to be caught on the run.
  // If the ball arrives after the run ends, he catches it standing, which is rarely what was meant.
  {
    const sched = schedulePhase(ph);
    for (const f of sched.flights) {
      const r = f.route;
      if (r.type !== 'pass' || !f.to) continue;
      const run = sched.moves.filter(m => m.player === f.to && (m.route.order ?? 0) === (r.order ?? 0)).at(-1);
      if (run && f.end >= run.end - 1) {
        const endP = { x: run.route.points.at(-1)[0], y: run.route.points.at(-1)[1] };
        if (dist(f.catchAt, endP) < 0.1) warn(`phase ${n} ${r.id} (pass): ${f.to} finishes their run before the ball arrives, so they catch it standing still. For a catch on the run, start them deeper or lengthen their run.`);
      }
    }
    // Players brushing each other mid-run: sample the animation. The spacing rules only cover
    // phase starts and route ends, but two crossing runs can still overlap in between.
    if (sched.moves.length) {
      const packIds = new Set(objects.filter(o => o.pack).flatMap(o => o.pack));
      const total = Math.max(...sched.moves.map(m => m.end), ...sched.flights.map(f => f.end), 0);
      const movers = [...new Set(sched.moves.map(m => m.player))];
      const others = [...ids].filter(id => P[id]);
      const worst = {};
      for (let t = 800; t <= total; t += 150) {
        const at = {};
        for (const id of others) at[id] = movers.includes(id) ? posAt(sched, id, t) : P[id];
        for (let a = 0; a < movers.length; a++) {
          const idA = movers[a];
          for (const idB of others) {
            if (idB === idA || (movers.includes(idB) && idB < idA)) continue;
            if (packIds.has(idA) && packIds.has(idB)) continue; // packs stand close by design
            // Under 1.5 m the discs visibly merge. A chase, race or tackle legitimately brushes
            // past 2 m, so that's not reported; crossing a 4.5 m-spaced line leaves ~2 m at best.
            const d = dist(at[idA], at[idB]);
            const key = [idA, idB].sort().join('-');
            if (d < (worst[key]?.d ?? 1.5)) worst[key] = { d, idA, idB };
          }
        }
      }
      for (const { d, idA, idB } of Object.values(worst)) {
        warn(`phase ${n}: ${idA} and ${idB} come within ${d.toFixed(1)} m of each other mid-run (discs are 2.4 m wide); re-angle or curve one of the routes`);
      }
    }
  }

  // Instructions and cues.
  for (const [id, text] of Object.entries(ph.instructions ?? {})) {
    if (!ids.has(id)) warn(`phase ${n}: instruction for unknown player ${id} (dropped)`);
    if (typeof text !== 'string' || !text.trim()) warn(`phase ${n}: empty instruction for ${id} (dropped)`);
    else if (text.length > INSTRUCTION_MAX) err(`phase ${n}: ${id}'s instruction is ${text.length} characters; the app cuts at ${INSTRUCTION_MAX}`);
  }
  const orders = new Set(routes.map(r => r.order).filter(Number.isInteger));
  for (const c of ph.cues ?? []) {
    if (!ids.has(c?.player)) { warn(`phase ${n}: cue for unknown player ${c?.player} (dropped)`); continue; }
    if (typeof c.text !== 'string' || !c.text.trim()) warn(`phase ${n}: empty cue for ${c.player} (dropped)`);
    else if (c.text.length > CUE_MAX) err(`phase ${n}: ${c.player}'s cue "${c.text}" is ${c.text.length} characters; the app cuts at ${CUE_MAX}`);
    if (c.step != null && !orders.has(c.step)) warn(`phase ${n}: ${c.player}'s cue step ${c.step} isn't one of the phase's route orders ${[...orders].join(', ') || '(none)'}`);
  }
});

// --- Each phase matches what the app builds from the one before ---
for (let i = 0; i + 1 < play.phases.length; i++) {
  const built = nextPhase(play.phases[i], play.players);
  const actual = play.phases[i + 1];
  for (const id of ids) {
    const b = built.positions[id], a = actual.positions?.[id];
    if (b && a && dist(b, a) > 0.05) err(`phase ${i + 2}: ${id} at ${fmt(a)} but phase ${i + 1}'s routes put them at ${fmt(b)}. Give them a route in phase ${i + 1}, or fix phase ${i + 2}'s position (scripts/build_phases.mjs recomputes all of this).`);
  }
  const bBall = built.objects.find(o => o.type === 'ball');
  const aBall = (actual.objects ?? []).find(o => o.type === 'ball');
  if (bBall && aBall && dist(bBall, aBall) > 0.05) err(`phase ${i + 2}: the ball is at ${fmt(aBall)} but phase ${i + 1}'s passes/kicks (option A) leave it at ${fmt(bBall)}`);
  if (bBall && !aBall) err(`phase ${i + 2}: the ball marker disappeared`);
  for (const o of built.objects) {
    if (!(actual.objects ?? []).some(a => a.id === o.id)) warn(`phase ${i + 2}: marker ${o.id} (${o.type}) from phase ${i + 1} was removed (fine if meant: it fades out)`);
  }
}

// --- The app's own parser, when the repo is at hand ---
if (!repo) {
  for (const c of [path.resolve('.'), path.resolve('..'), path.resolve('../rugby-play-designer')]) {
    if (fs.existsSync(path.join(c, 'js/storage.js'))) { repo = c; break; }
  }
}
if (repo && fs.existsSync(path.join(repo, 'js/storage.js'))) {
  try {
    const { parsePlay } = await import(pathToFileURL(path.join(repo, 'js/storage.js')).href);
    const parsed = parsePlay(structuredClone(play));
    console.log(`parsePlay (the app's own parser, from ${repo}): loaded OK as "${parsed.name}" with ${parsed.players.length} players, ${parsed.phases.length} phases.`);
    const before = JSON.stringify(play.phases.map(p => p.routes));
    const after = JSON.stringify(parsed.phases.map(p => p.routes));
    if (before !== after) warn('parsePlay changed the routes while loading (something was dropped or defaulted); diff the file against what it returns');
  } catch (e) {
    err(`parsePlay (the app's own parser) refused the play: ${e.message}`);
  }
}

report();
process.exit(errors.length ? 1 : 0);

function report() {
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const e of errors) console.log(`ERROR: ${e}`);
  console.log(errors.length || warnings.length
    ? `\n${errors.length} error(s), ${warnings.length} warning(s).`
    : 'No problems found.');
}
