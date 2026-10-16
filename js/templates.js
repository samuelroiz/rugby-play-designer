// Templates: ordinary play files in templates/, listed in templates/index.json as [{ name, file }].
// They're fetched from the site (so they work on GitHub Pages and any local server) and checked like a
// loaded file. Thumbnails are drawn from each template's own data with the normal pitch drawing.

import { drawPitch, setView, svgEl, PLAYER_R } from './pitch.js';
import { parsePlay } from './storage.js';

const TEMPLATES_URL = new URL('../templates/', import.meta.url);

// Fetched once per page load; a failed load can be tried again.
let loading = null;
export function loadTemplates() {
  loading ??= (async () => {
    const index = await getJson(new URL('index.json', TEMPLATES_URL));
    if (!Array.isArray(index)) throw new Error('templates/index.json should be a list.');
    return Promise.all(index.map(async ({ name, file }) => {
      const play = parsePlay(await getJson(new URL(file, TEMPLATES_URL)));
      return { name: String(name ?? play.name), file, play };
    }));
  })().catch(err => {
    loading = null;
    throw new Error(`The templates couldn't be loaded. ${err.message}`);
  });
  return loading;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.pathname.split('/').pop()}: ${res.status} ${res.statusText}`.trim());
  return res.json();
}

// Small picture of a play's first phase: the pitch, players as plain discs and the markers, in the
// given orientation. Too small for numbers, so they're left off.
export function thumbnail(play, orientation) {
  const svg = svgEl('svg', { class: 'thumb', 'aria-hidden': 'true', preserveAspectRatio: 'xMidYMid meet' });
  const world = svgEl('g', {}, svg);
  setView(svg, world, play.view, orientation);
  drawPitch(svgEl('g', {}, world), { view: play.view, orientation, distances: false, grid: false });
  const ph = play.phases[0];
  for (const o of ph.objects) {
    const g = svgEl('g', { class: `marker ${o.type}`, transform: `translate(${o.x} ${o.y})` }, world);
    if (o.type === 'ball') svgEl('ellipse', { rx: 0.9, ry: 0.6, class: 'ball', transform: 'rotate(-25)' }, g);
    else if (o.type === 'ruck') svgEl('circle', { r: 2, class: 'outline' }, g);
    else if (o.type === 'lineout') svgEl('line', { x1: 0, y1: -2, x2: 0, y2: 2, class: 'outline' }, g);
    else if (o.type === 'scrum') svgEl('line', { x1: 0, y1: -3.8, x2: 0, y2: 3.8, class: 'scrum-mark' }, g);
  }
  for (const p of play.players) {
    const pos = ph.positions[p.id];
    if (pos) svgEl('circle', { cx: pos.x, cy: pos.y, r: PLAYER_R, class: `thumb-player ${p.team}`, 'data-id': p.id }, world);
  }
  return svg;
}

// Nothing worth keeping: no players and a single phase with no markers, routes or note.
export function isEmptyPlay(play) {
  return !play.players.length && play.phases.length === 1
    && !play.phases[0].objects.length && !play.phases[0].routes.length && !play.phases[0].note.trim();
}
