// Share links (share.js): a play and its team survive the round trip through the link, and a broken or cut
// link gives a message rather than a play. Run with: node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeShare, decodeShare, shareUrl, hashData, SHARE_URL } from '../js/share.js';
import { parsePlay } from '../js/storage.js';
import { animPlay } from './anim-play.mjs';

const play = () => {
  const p = parsePlay(animPlay());
  p.phases[0].instructions = { a10: 'Flat, call for it early.' };
  return p;
};
const LOGO = 'data:image/png;base64,iVBORw0KGgo=';

test('a play survives the round trip, instructions and all', async () => {
  const data = await encodeShare(play());
  assert.match(data, /^[A-Za-z0-9_-]+$/, 'base64url, no padding');
  const back = await decodeShare(data);
  assert.deepEqual(back.play, play());
  assert.equal(back.team, null);
});

test('the team name and logo come along when included', async () => {
  const back = await decodeShare(await encodeShare(play(), { name: 'SFV', logo: LOGO }));
  assert.deepEqual(back.team, { name: 'SFV', logo: LOGO });
  const dflt = await decodeShare(await encodeShare(play(), { name: '', logo: 'default' }));
  assert.deepEqual(dflt.team, { name: '', logo: 'default' });
});

test('a bad logo in a link is dropped, not used', async () => {
  const back = await decodeShare(await encodeShare(play(), { name: 'X', logo: 'javascript:alert(1)' }));
  assert.deepEqual(back.team, { name: 'X', logo: null });
});

test('the link is the viewer with the data in its hash', async () => {
  const data = await encodeShare(play());
  const url = shareUrl(data);
  assert.equal(url, `${SHARE_URL}#p=${data}`);
  assert.equal(SHARE_URL, 'https://playbook.samuelroiz.com/view.html');
  assert.equal(hashData(new URL(url).hash), data);
  assert.equal(hashData(''), '');
});

test('compression keeps a long play well under the long-link warning', async () => {
  const big = play();
  for (let i = 0; i < 6; i++) big.phases.push(structuredClone(big.phases[0]));
  const data = await encodeShare(big);
  assert.ok(data.length < JSON.stringify(big).length / 2, `${data.length} vs ${JSON.stringify(big).length}`);
});

test('a broken or cut link is refused with a message', async () => {
  const data = await encodeShare(play());
  for (const bad of ['', 'not a link!', data.slice(0, data.length / 2), 'AAAA', data.replace(/^./, c => (c === 'A' ? 'B' : 'A'))]) {
    await assert.rejects(decodeShare(bad), /doesn't open a play/, JSON.stringify(bad.slice(0, 20)));
  }
});

test('a link to something that isn\'t a play is refused', async () => {
  const notPlay = await encodeShare({ hello: 'world' });
  await assert.rejects(decodeShare(notPlay), /doesn't open a play/);
});
