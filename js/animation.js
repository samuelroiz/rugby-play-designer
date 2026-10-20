// Saving the play as an animation: a GIF that loops forever (gifenc, vendor/gifenc.esm.js, loaded the first
// time a GIF is made) or a video (MediaRecorder on a canvas: MP4 where the browser can make it, else WebM).
// The frames are timed as Play runs the play (all phases, option A) and come from the app as pictures drawn
// like the PNG export; this module draws each onto a canvas and encodes it. It awaits between frames, so the
// page stays responsive, and stops as soon as `cancelled()` says so.

import { buildSchedule } from './animate.js';
import { withSvgImage } from './export.js';

export const GIF_FPS = 12;
export const VIDEO_FPS = 30;
// The last frame is held this long (ms) before the GIF starts again (or the video ends).
export const END_HOLD_MS = 1500;
// Picture width in px for each size.
export const ANIMATION_SIZES = { small: 640, medium: 960, large: 1280 };
// A position's animation (following one player) is upright, phone shaped, at this size for each format.
export const POSITION_SIZES = { gif: { width: 720, height: 1280 }, video: { width: 1080, height: 1920 } };
const GIFENC_URL = new URL('../vendor/gifenc.esm.js', import.meta.url).href;
// GIF: one palette for every frame, made from this many frames spread through the play. Index 255 is kept
// for "same as the frame before" (transparent), so a frame only stores the pixels that changed.
const PALETTE_SAMPLES = 8;
const SAME = 255;

// Every frame of the play at `fps` frames a second, played at `speed`: [{ phase, sched, t }], t in the
// schedule's ms (at 1x). The phases follow on without a gap, as when playing; the last phase ends when its
// routes do, on a frame of its own (the encoders then hold it for END_HOLD_MS).
export function animationFrames(play, { fps, speed = 1 }) {
  const frames = [];
  const step = (1000 / fps) * speed;
  let carry = 0;
  for (let i = 0; i < play.phases.length; i++) {
    const sched = buildSchedule(play, i);
    const last = i === play.phases.length - 1;
    const end = last ? sched.routesEnd : sched.total;
    let t = carry;
    for (; t < end; t += step) frames.push({ phase: i, sched, t });
    carry = t - end;
    if (last) frames.push({ phase: i, sched, t: end });
  }
  return frames;
}

// The video type this browser can record a canvas in, MP4 first; null if it can't record one at all.
export function videoType() {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) ?? null;
}
// Bits a second for a video `w` px wide: VIDEO_BPS up to 1080 px, in proportion to the width above that, so
// it stays as sharp as the app.
const VIDEO_BPS = 8e6;
export const videoBitrate = w => Math.round(VIDEO_BPS * Math.max(1, w / 1080));
export const videoExtension = type => (type.startsWith('video/mp4') ? '.mp4' : '.webm');

// Draws an SVG picture onto the canvas, sizing the canvas to the first one (even sides, as video encoders
// want; the spare row or column is white).
async function drawPicture(ctx, picture) {
  const w = Math.ceil(Number(picture.getAttribute('width')));
  const h = Math.ceil(Number(picture.getAttribute('height')));
  if (!ctx.canvas.dataset.sized) {
    ctx.canvas.width = Math.ceil(w / 2) * 2;
    ctx.canvas.height = Math.ceil(h / 2) * 2;
    ctx.canvas.dataset.sized = '1';
  }
  await withSvgImage(picture, "The animation couldn't be drawn.", img => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.drawImage(img, 0, 0, w, h);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Makes the animation. picture(frame) returns the SVG for one frame of animationFrames(), or of `frames`
// when given (a list made at the format's frame rate, e.g. follow.js focusFrames). progress(done) is called
// with a share from 0 to 1. Resolves to a Blob ('image/gif', or the video's type), or null if cancelled.
export async function makeAnimation({ play, format, speed, picture, frames = null, progress = () => {}, cancelled = () => false }) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: format === 'gif' });
  const fps = format === 'gif' ? GIF_FPS : VIDEO_FPS;
  frames ??= animationFrames(play, { fps, speed });
  const draw = frame => drawPicture(ctx, picture(frame));
  return format === 'gif'
    ? makeGif({ frames, draw, ctx, fps, progress, cancelled })
    : makeVideo({ frames, draw, ctx, fps, progress, cancelled });
}

async function makeGif({ frames, draw, ctx, fps, progress, cancelled }) {
  const { GIFEncoder, quantize, applyPalette } = await import(GIFENC_URL);
  const steps = PALETTE_SAMPLES + frames.length;

  // The shared palette, from frames spread through the play (the first and the last among them).
  const picks = [...new Set(Array.from({ length: PALETTE_SAMPLES }, (_, k) => Math.round((k * (frames.length - 1)) / (PALETTE_SAMPLES - 1))))];
  const samples = [];
  for (const [k, i] of picks.entries()) {
    await draw(frames[i]);
    if (cancelled()) return null;
    samples.push(ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data);
    progress((k + 1) / steps);
  }
  const all = new Uint8ClampedArray(samples.reduce((n, s) => n + s.length, 0));
  samples.reduce((at, s) => { all.set(s, at); return at + s.length; }, 0);
  const palette = quantize(all, SAME);
  const full = [...palette, ...Array.from({ length: 256 - palette.length }, () => [0, 0, 0])];

  // GIF delays are in hundredths of a second, so each frame's is rounded to keep the total right. The last
  // frame is the play's final moment, held for END_HOLD_MS.
  const frameMs = 1000 / fps;
  const at = k => Math.round((k * frameMs) / 10) * 10;
  const gif = GIFEncoder();
  const { width: w, height: h } = ctx.canvas;
  let prev = null;
  for (const [k, frame] of frames.entries()) {
    await draw(frame);
    if (cancelled()) return null;
    const index = applyPalette(ctx.getImageData(0, 0, w, h).data, palette);
    // After the first frame, a pixel that hasn't changed is left transparent (the frame before shows through).
    const out = prev ? index.slice() : index;
    if (prev) for (let p = 0; p < out.length; p++) if (out[p] === prev[p]) out[p] = SAME;
    const last = k === frames.length - 1;
    gif.writeFrame(out, w, h, {
      palette: prev ? undefined : full,
      delay: last ? END_HOLD_MS : at(k + 1) - at(k),
      repeat: 0,
      transparent: !!prev,
      transparentIndex: SAME,
      dispose: 1,
    });
    prev = index;
    progress((PALETTE_SAMPLES + k + 1) / steps);
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

// Video: the canvas is recorded as it's drawn. The recorder is paused while each frame is drawn and runs
// for one frame's time once it's ready, so the video keeps the play's timing however long drawing takes.
async function makeVideo({ frames, draw, ctx, fps, progress, cancelled }) {
  const type = videoType();
  if (!type) throw new Error("This browser can't make videos. Choose GIF instead.");
  await draw(frames[0]);
  const stream = ctx.canvas.captureStream(0);
  const [track] = stream.getVideoTracks();
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: videoBitrate(ctx.canvas.width) });
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise(resolve => { recorder.onstop = resolve; });
  const frameMs = 1000 / fps;
  recorder.start();
  try {
    for (const [k, frame] of frames.entries()) {
      if (k > 0) {
        recorder.pause();
        await draw(frame);
        if (cancelled()) return null;
        recorder.resume();
      }
      track.requestFrame();
      await sleep(frameMs);
      progress((k + 1) / frames.length);
    }
    // The last frame, held.
    for (let held = 0; held < END_HOLD_MS; held += 100) {
      if (cancelled()) return null;
      track.requestFrame();
      await sleep(100);
    }
  } finally {
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    track.stop();
  }
  return new Blob(chunks, { type: type.split(';')[0] });
}
