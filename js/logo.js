// Team logo: a per-browser setting, kept in localStorage under its own key and never in the play, its files,
// the autosave or the undo history. Until one is set in this browser, the club's logo in assets/ is used.
// Uploads are PNG, JPG or SVG up to 2 MB. Pictures are shrunk to at most 512 px on the long side and stored
// as a data URL; an SVG is cleaned (no scripts, event handlers or outside references) and then drawn to a
// PNG, so only PNG and JPEG data URLs are ever stored.

export const LOGO_KEY = 'rugby-play-designer.team-logo';
export const DEFAULT_LOGO_URL = new URL('../assets/sfv-logo.jpeg', import.meta.url).href;
const DEFAULT_TEAM_NAME = 'San Fernando Valley Rugby Club';
export const TEAM_NAME_MAX = 40;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_MAX_SIDE = 512;

const SVG_NS = 'http://www.w3.org/2000/svg';
const STORED_IMAGE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml' };

// { logo: 'default' | null | data URL, name, exports }. 'default' is the club's logo; null means removed.
const defaultLogoSettings = () => ({ logo: 'default', name: DEFAULT_TEAM_NAME, exports: true });

// The settings stored in this browser, or the default if there are none (or they can't be read). A stored
// value of the wrong shape is ignored field by field.
export function readLogoSettings() {
  const settings = defaultLogoSettings();
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(LOGO_KEY));
  } catch { /* blocked or broken: the default */ }
  if (!saved || typeof saved !== 'object') return settings;
  if (saved.logo === null || saved.logo === 'default' || (typeof saved.logo === 'string' && STORED_IMAGE.test(saved.logo))) settings.logo = saved.logo;
  if (typeof saved.name === 'string') settings.name = saved.name.slice(0, TEAM_NAME_MAX);
  if (typeof saved.exports === 'boolean') settings.exports = saved.exports;
  return settings;
}

// Returns false if storage is blocked or full.
export function saveLogoSettings(settings) {
  try {
    localStorage.setItem(LOGO_KEY, JSON.stringify({ logo: settings.logo, name: settings.name, exports: settings.exports }));
    return true;
  } catch {
    return false;
  }
}

// What an <img> shows for these settings, or null for no logo.
export const logoSrc = settings => (settings.logo === 'default' ? DEFAULT_LOGO_URL : settings.logo);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That image couldn't be read."));
    img.src = src;
  });
}

// The image redrawn at most LOGO_MAX_SIDE px on its long side (never enlarged), as a PNG or JPEG data URL.
function rasterise(img, type) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error("That image couldn't be read.");
  const k = Math.min(1, LOGO_MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png');
}

// An uploaded file -> the data URL to store. Throws an Error with a message to show.
export async function readLogoFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const type = TYPES[ext] ?? Object.values(TYPES).find(t => t === file.type);
  if (!type) throw new Error('Pick a PNG, JPG or SVG image.');
  if (file.size > LOGO_MAX_BYTES) throw new Error('That image is over 2 MB. Pick a smaller one.');
  if (type === 'image/svg+xml') {
    const clean = sanitizeSvg(await file.text());
    return rasterise(await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}`), 'image/png');
  }
  const url = URL.createObjectURL(file);
  try {
    return rasterise(await loadImage(url), type);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Elements that can run code, embed other documents or play media: removed with everything inside them.
const SVG_DROP = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'animate', 'animatemotion', 'animatetransform', 'set', 'handler', 'listener']);
// A url(…) that points anywhere but inside the SVG (#id).
const OUTSIDE_URL = /url\(\s*['"]?\s*(?!#)[^)]*\)/gi;

// SVG text -> SVG text without scripts, event handlers or outside references, sized LOGO_MAX_SIDE on its
// long side so it draws at a known size. Throws if it isn't an SVG.
export function sanitizeSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || root.namespaceURI !== SVG_NS || root.localName !== 'svg') {
    throw new Error("That SVG couldn't be read.");
  }
  for (const el of [...root.querySelectorAll('*')]) {
    if (!el.isConnected) continue;
    if (SVG_DROP.has(el.localName.toLowerCase()) || el.namespaceURI !== SVG_NS) { el.remove(); continue; }
    if (el.localName === 'style') el.textContent = el.textContent.replace(/@import[^;]*;?/gi, '').replace(OUTSIDE_URL, 'none');
  }
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      const name = attr.localName.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith('on')) el.removeAttributeNode(attr);
      else if (name === 'href' || name === 'src') {
        // Links inside the SVG and embedded pictures are fine; anything else (http:, javascript:, files) goes.
        if (!value.startsWith('#') && !/^data:image\/(png|jpeg|gif|webp);/i.test(value)) el.removeAttributeNode(attr);
      } else if (OUTSIDE_URL.test(value)) {
        el.setAttribute(attr.name, value.replace(OUTSIDE_URL, 'none'));
      }
      OUTSIDE_URL.lastIndex = 0;
    }
  }
  // Its size: width and height if they are plain numbers, else the viewBox, else a square.
  const num = v => (/^\s*[\d.]+\s*(px)?\s*$/.test(v ?? '') ? parseFloat(v) : 0);
  const vb = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  let w = num(root.getAttribute('width')) || (vb.length === 4 ? vb[2] : 0);
  let h = num(root.getAttribute('height')) || (vb.length === 4 ? vb[3] : 0);
  if (!(w > 0 && h > 0)) { w = 1; h = 1; }
  if (!root.hasAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const k = LOGO_MAX_SIDE / Math.max(w, h);
  root.setAttribute('width', Math.round(w * k));
  root.setAttribute('height', Math.round(h * k));
  return new XMLSerializer().serializeToString(root);
}

// The logo for a picture or PDF, as { href (PNG or JPEG data URL), w, h, format }, or null when there is no
// logo or "Show logo on exports" is off. The default logo is read from assets/ the first time.
let defaultData = null;
export async function exportLogo(settings) {
  if (!settings.exports || !settings.logo) return null;
  let href = settings.logo;
  if (href === 'default') {
    defaultData ??= loadImage(DEFAULT_LOGO_URL).then(img => rasterise(img, 'image/jpeg')).catch(err => { defaultData = null; throw err; });
    try {
      href = await defaultData;
    } catch {
      return null; // the file is missing: no logo, as in the top bar
    }
  }
  const img = await loadImage(href);
  return { href, w: img.naturalWidth, h: img.naturalHeight, format: href.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG' };
}
