#!/usr/bin/env node
// Rebuilds every phase after the first with the app's own next-phase rules, so positions and the
// ball can never drift from what the routes do. Author phase 1 fully (positions, objects, routes)
// and later phases with just note/instructions/cues/routes (positions {} and objects [] are fine);
// this script fills in each later phase's positions and markers exactly as the app's "+" button
// would build them, then applies that phase's own marker adds/removals.
//
// Usage: node build_phases.mjs <in.json> [out.json]   (no out: overwrites in place)
//
// How markers are reconciled per phase: start from the markers built from the previous phase
// (same ids and spots, the ball moved by the passes/kicks) - the app copies markers unchanged, so
// same-id markers always keep the BUILT values. An authored marker with a new id is added (it
// appears when the phase starts); a built marker whose id is missing from the authored phase's
// objects is removed (it fades out) - except when the authored objects list is empty, which means
// "just build it for me". The ball is never removed. To move a ruck to a new tackle, remove the
// old id and add one with a new id: a new ruck is a new marker.

import fs from 'node:fs';
import { nextPhase, round1 } from './play-model.mjs';

const [inFile, outFile] = process.argv.slice(2);
if (!inFile) { console.error('Usage: node build_phases.mjs <in.json> [out.json]'); process.exit(2); }
const play = JSON.parse(fs.readFileSync(inFile, 'utf8'));

for (let i = 1; i < play.phases.length; i++) {
  const authored = play.phases[i];
  const built = nextPhase(play.phases[i - 1], play.players);
  const authoredObjects = authored.objects ?? [];
  let objects = built.objects;
  if (authoredObjects.length) {
    objects = objects.filter(o => o.type === 'ball' || authoredObjects.some(a => a.id === o.id));
    for (const a of authoredObjects) if (!objects.some(o => o.id === a.id)) objects.push({ ...a });
  }
  play.phases[i] = {
    ...authored,
    positions: Object.fromEntries(Object.entries(built.positions).map(([id, p]) => [id, { x: round1(p.x), y: round1(p.y) }])),
    objects,
    routes: authored.routes ?? [],
  };
}

const out = outFile ?? inFile;
fs.writeFileSync(out, JSON.stringify(play, null, 1).replace(/\n +/g, m => m) + '\n');
console.log(`Built ${play.phases.length - 1} phase(s) after phase 1 -> ${out}. Now run validate_play.mjs.`);
