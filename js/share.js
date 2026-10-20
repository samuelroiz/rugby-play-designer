// Share links: the play, and the team name and logo if the user includes them, as JSON compressed with
// deflate-raw and base64url-encoded into the address hash of the viewer: view.html#p=<data>. Browsers never
// send the hash to the server, so the play isn't stored anywhere. No DOM here: the Node tests use it as it is.

import { parsePlay } from './storage.js';

export const SHARE_URL = 'https://playbook.samuelroiz.com/view.html';
// Links longer than this may be cut by some messaging apps.
export const LONG_LINK = 16000;
const TEAM_NAME_MAX = 40;
// A stored team logo: the club's default, or a PNG or JPEG data URL (as logo.js keeps them).
const LOGO = /^(default|data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+)$/;
const BROKEN = "This link doesn't open a play. It may have been cut short when it was sent: ask for it again.";

// Bytes <-> base64url (no padding), in chunks so a long play doesn't overflow the argument list.
function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(text) {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

const pipe = (bytes, stream) => new Response(new Blob([bytes]).stream().pipeThrough(stream));

// team: { name, logo } (logo: 'default', a data URL, or null) or null to leave the team out.
export async function encodeShare(play, team = null) {
  const data = { play };
  if (team) data.team = { name: team.name ?? '', logo: team.logo ?? null };
  const json = new TextEncoder().encode(JSON.stringify(data));
  return toBase64Url(new Uint8Array(await pipe(json, new CompressionStream('deflate-raw')).arrayBuffer()));
}

// The link's data -> { play, team } with the play checked like a loaded file and team { name, logo } or null.
// Throws an Error with a message the user can read if the link is broken.
export async function decodeShare(text) {
  let data;
  try {
    if (!text || !/^[A-Za-z0-9_-]+$/.test(text)) throw new Error();
    data = JSON.parse(await pipe(fromBase64Url(text), new DecompressionStream('deflate-raw')).text());
  } catch {
    throw new Error(BROKEN);
  }
  let play;
  try {
    play = parsePlay(data?.play);
  } catch {
    throw new Error(BROKEN);
  }
  const t = data.team;
  const team = t && typeof t === 'object'
    ? { name: typeof t.name === 'string' ? t.name.slice(0, TEAM_NAME_MAX) : '', logo: typeof t.logo === 'string' && LOGO.test(t.logo) ? t.logo : null }
    : null;
  return { play, team: team && (team.name || team.logo) ? team : null };
}

export const shareUrl = (data, base = SHARE_URL) => `${base}#p=${data}`;

// The data in an address hash ("#p=…"), or '' if there is none.
export const hashData = hash => new URLSearchParams(String(hash).replace(/^#/, '')).get('p') ?? '';
