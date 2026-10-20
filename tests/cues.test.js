// Position cues (cues.js) and the checks on instructions and cues when a play is loaded (storage.js), and a
// position's frames for the animation export (follow.js). Run with: node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlay } from '../js/storage.js';
import { buildSchedule, TIMING } from '../js/animate.js';
import { cueTime, phaseCues, slowFactor, cueSpeed, ageBubbles, placeBubble, defaultCueStep, CUE } from '../js/cues.js';
import { focusFrames } from '../js/follow.js';
import { animPlay } from './anim-play.mjs';

// The animation play with `cues` (and `instructions`) in phase 1.
const withPhase1 = fields => { const p = animPlay(); Object.assign(p.phases[0], fields); return parsePlay(p); };
const cuesOf = cues => withPhase1({ cues }).phases[0].cues;

test('instructions: text for players in the play, trimmed, cut to 120; empty and unknown ids dropped', () => {
  const p = withPhase1({ instructions: { a10: '  Flat.  ', a12: 'x'.repeat(200), a13: '   ', zz: 'nobody', d10: 7 } });
  assert.deepEqual(Object.keys(p.phases[0].instructions), ['a10', 'a12']);
  assert.equal(p.phases[0].instructions.a10, 'Flat.');
  assert.equal(p.phases[0].instructions.a12.length, 120);
  for (const bad of [null, 'text', [], 3]) assert.equal('instructions' in withPhase1({ instructions: bad }).phases[0], false, JSON.stringify(bad));
  assert.equal('instructions' in withPhase1({ instructions: { a10: '' } }).phases[0], false, 'none left: no field');
});

test('cues: a valid list is kept as it is', () => {
  assert.deepEqual(cuesOf([{ player: 'a10', step: 1, text: 'Hold' }, { player: 'a12', step: 2, text: 'JUMP!' }, { player: 'a12', step: 1, text: 'Wait' }]),
    [{ player: 'a10', step: 1, text: 'Hold' }, { player: 'a12', step: 2, text: 'JUMP!' }, { player: 'a12', step: 1, text: 'Wait' }]);
});

test('cues: text trimmed and cut to 30 characters; empty, wrong type and unknown players dropped', () => {
  const cues = cuesOf([
    { player: 'a10', step: 1, text: '  Go  ' }, { player: 'a10', step: 1, text: 'y'.repeat(50) }, { player: 'a10', step: 1, text: '   ' },
    { player: 'a10', step: 1, text: 5 }, { player: 'zz', step: 1, text: 'nobody' }, { step: 1, text: 'no player' }, null, 'JUMP', [],
  ]);
  assert.deepEqual(cues.map(c => c.text), ['Go', 'y'.repeat(30)]);
  for (const bad of [null, 'JUMP', {}, 7]) assert.equal('cues' in withPhase1({ cues: bad }).phases[0], false, JSON.stringify(bad));
  assert.equal('cues' in withPhase1({ cues: [{ player: 'a10', text: '' }] }).phases[0], false, 'none left: no field');
});

test('cues: step a whole number 1 to 99, else the step of the player\'s first route there, else 1', () => {
  // In phase 1 a10's routes are all order 1, d10's drift is order 2, and a13 has none.
  const steps = cuesOf([
    { player: 'a10', step: 3, text: 'a' }, { player: 'd10', text: 'b' }, { player: 'd10', step: 0, text: 'c' }, { player: 'd10', step: 1.5, text: 'd' },
    { player: 'd10', step: '2', text: 'e' }, { player: 'a13', step: 100, text: 'f' }, { player: 'a13', text: 'g' },
  ]).map(c => c.step);
  assert.deepEqual(steps, [3, 2, 2, 2, 2, 1, 1]);
  assert.equal(defaultCueStep(animPlay().phases[0].routes, 'd10'), 2);
});

test('old plays without cues load without them', () => {
  const p = parsePlay(animPlay());
  assert.ok(p.phases.every(ph => !('cues' in ph) && !('instructions' in ph)));
});

test('a cue pops up when its step starts', () => {
  const p = parsePlay(animPlay());
  const s = buildSchedule(p, 0);
  assert.equal(cueTime(s, 1), TIMING.lead, 'step 1: when the first routes move');
  const drift = s.moves.find(m => m.route.id === 'r5');
  assert.equal(cueTime(s, 2), drift.start, 'step 2: when the drift starts');
  assert.ok(cueTime(s, 2) > cueTime(s, 1));
  assert.equal(cueTime(s, 9), s.routesEnd, 'past the last step: when the routes end');
  assert.equal(cueTime(buildSchedule(p, 2), 1), TIMING.lead, 'a phase with no routes: after its lead');
  const q = withPhase1({ cues: [{ player: 'd10', step: 2, text: 'Up' }, { player: 'd10', step: 1, text: 'Set' }, { player: 'a10', step: 1, text: 'Not mine' }] });
  assert.deepEqual(phaseCues(q, 0, 'd10', s).map(c => [c.text, c.time]), [['Set', TIMING.lead], ['Up', drift.start]]);
});

test('playback eases to half speed for about a second after a cue', () => {
  assert.equal(slowFactor(-1), 1);
  assert.equal(slowFactor(0), 1);
  assert.equal(slowFactor(CUE.easeMs), CUE.slowSpeed);
  assert.equal(slowFactor(600), 0.5);
  assert.equal(slowFactor(CUE.slowMs), 0.5);
  assert.ok(slowFactor(CUE.slowMs + CUE.easeMs / 2) > 0.5 && slowFactor(CUE.slowMs + CUE.easeMs / 2) < 1);
  assert.equal(slowFactor(CUE.slowMs + CUE.easeMs), 1);
  assert.equal(cueSpeed([]), 1);
  assert.equal(cueSpeed([{ age: 1300 }, { age: 500 }]), 0.5, 'the slowest wins');
  assert.deepEqual(ageBubbles([{ text: 'a', age: 1000 }, { text: 'b', age: 100 }], 600), [{ text: 'b', age: 700 }], 'up for 1.5 s');
});

test('a bubble goes next to the player, inside the view and never over their disc', () => {
  const view = { w: 120, h: 40, width: 390, height: 600, r: 20 };
  const clear = (b, x, y) => b.left + view.w <= x - view.r || b.left >= x + view.r || b.top + view.h <= y - view.r || b.top >= y + view.r;
  const inside = b => b.left >= 8 && b.top >= 8 && b.left + view.w <= view.width - 8 && b.top + view.h <= view.height - 8;
  for (const [x, y] of [[195, 300], [10, 300], [380, 300], [195, 15], [195, 590], [5, 5], [385, 595]]) {
    const b = placeBubble({ x, y, ...view });
    assert.ok(inside(b), `inside at ${x},${y}: ${JSON.stringify(b)}`);
    assert.ok(clear(b, x, y), `clear of the player at ${x},${y}: ${JSON.stringify(b)}`);
  }
  const above = placeBubble({ x: 195, y: 300, ...view });
  assert.ok(above.top + view.h <= 300 - view.r, 'above them when it fits');
});

test("a position's frames: its cues pop up at their step, and playback slows while they're new", () => {
  const p = withPhase1({ cues: [{ player: 'a10', step: 1, text: 'Go' }] });
  const plain = focusFrames(parsePlay(animPlay()), 'a10', { fps: 12, aspect: 0.6 });
  const frames = focusFrames(p, 'a10', { fps: 12, aspect: 0.6 });
  const first = frames.findIndex(f => f.bubbles.length);
  assert.ok(first > 0 && frames[first].phase === 0 && frames[first - 1].t < TIMING.lead && frames[first].t >= TIMING.lead, 'right after step 1 starts');
  assert.deepEqual(frames[first].bubbles.map(b => b.text), ['Go']);
  const up = frames.filter(f => f.bubbles.length);
  assert.ok(Math.abs(up.length - (CUE.holdMs / 1000) * 12) <= 1, `up for 1.5 s (${up.length} frames)`);
  const steps = frames.slice(first, first + 10).map((f, k, a) => (k ? f.t - a[k - 1].t : null)).slice(1);
  assert.ok(steps.slice(3).every(d => Math.abs(d - 1000 / 24) < 0.01), `half speed: ${steps.map(Math.round)}`);
  assert.ok(frames.length > plain.length + 4, `so it takes longer (${frames.length} vs ${plain.length} frames)`);
  assert.ok(frames.every(f => f.cam && f.cam.w > 0 && Math.abs(f.cam.w / f.cam.h - 0.6) < 1e-9), 'every frame has a view of the shape asked for');
  const last = frames.at(-1);
  assert.equal(last.phase, 2);
  assert.equal(last.t, buildSchedule(p, 2).routesEnd, 'ends on the last phase\'s final moment');
});
