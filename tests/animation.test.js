// Save animation's frame timing: every phase in turn, at the play's own pace, a frame every 1/fps second.
import test from 'node:test';
import assert from 'node:assert/strict';
import { animationFrames, GIF_FPS, VIDEO_FPS, END_HOLD_MS, videoExtension } from '../js/animation.js';
import { buildSchedule } from '../js/animate.js';
import { animPlay } from './anim-play.mjs';

// The play's length in ms at 1x: every phase to its end, the last one until its routes end.
const length = play => play.phases.reduce((ms, _, i) => {
  const s = buildSchedule(play, i);
  return ms + (i === play.phases.length - 1 ? s.routesEnd : s.total);
}, 0);

test('a frame every 1/fps second of the play, at each speed, ending on the last phase\'s final frame', () => {
  const play = animPlay();
  for (const [fps, speed] of [[GIF_FPS, 1], [GIF_FPS, 2], [GIF_FPS, 0.5], [VIDEO_FPS, 1]]) {
    const frames = animationFrames(play, { fps, speed });
    const expected = (length(play) / speed / 1000) * fps;
    assert.ok(Math.abs(frames.length - expected) <= 2, `${fps} fps at ${speed}x: ${frames.length} frames, expected about ${expected}`);
    const last = frames.at(-1);
    assert.equal(last.phase, play.phases.length - 1);
    assert.equal(last.t, last.sched.routesEnd);
  }
});

test('phases follow on: each phase\'s frames are in order and every phase is in it, option A', () => {
  const play = animPlay();
  const frames = animationFrames(play, { fps: GIF_FPS, speed: 1 });
  assert.deepEqual([...new Set(frames.map(f => f.phase))], [0, 1, 2]);
  for (let k = 1; k < frames.length; k++) {
    const [a, b] = [frames[k - 1], frames[k]];
    assert.ok(b.phase > a.phase || (b.phase === a.phase && b.t > a.t), `frame ${k} goes back in time`);
    if (b.phase > a.phase) assert.ok(b.t < (1000 / GIF_FPS) + 1e-9, 'the next phase starts where the last left off');
  }
  assert.ok(frames.every(f => f.sched.option === 'A'));
});

test('the last frame is held 1.5 s; videos are .mp4 or .webm by type', () => {
  assert.equal(END_HOLD_MS, 1500);
  assert.equal(videoExtension('video/mp4'), '.mp4');
  assert.equal(videoExtension('video/mp4;codecs=avc1'), '.mp4');
  assert.equal(videoExtension('video/webm'), '.webm');
});
