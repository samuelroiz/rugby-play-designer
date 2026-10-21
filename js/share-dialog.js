// File → Share link…: a link to the phone viewer (view.html) with the play inside its hash, and the team
// name and logo if "Include team logo" is ticked. The box shows the link and its length; nothing is copied
// until Copy is pressed. Share… hands it to the native share sheet (hidden where there's none) and Open opens
// it in a new tab. A link over LONG_LINK characters gets a warning, and a way to drop the logo when that
// would shorten it.

import { encodeShare, shareUrl, SHARE_URL, LONG_LINK } from './share.js';

// teamLogo() is the logo setting now. Returns open(), and init() to call once at startup.
export function createShareDialog({ state, teamLogo }) {
  const $ = id => document.getElementById(id);
  let shareJob = 0;
  const shareBase = () => (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:'
    ? new URL('view.html', location.href).href
    : SHARE_URL);
  const linkSize = url => `${url.length.toLocaleString('en')} characters`;

  async function makeShareLink() {
    const job = ++shareJob;
    const withLogo = $('share-logo').checked;
    const logo = teamLogo();
    const team = withLogo && (logo.logo || logo.name.trim()) ? { name: logo.name.trim(), logo: logo.logo } : null;
    $('share-status').textContent = 'Making the link…';
    $('share-copy').disabled = $('share-native').disabled = true;
    const url = shareUrl(await encodeShare(structuredClone(state), team), shareBase());
    if (job !== shareJob) return null;
    $('share-url').value = url;
    $('share-open').href = url;
    $('share-copy').disabled = $('share-native').disabled = false;
    $('share-status').textContent = `Link ready (${linkSize(url)})`;
    const long = url.length > LONG_LINK;
    $('share-warning').hidden = !long;
    $('share-drop-logo').hidden = !(withLogo && team?.logo);
    $('share-warning-text').textContent = long
      ? `This link is ${url.length.toLocaleString('en')} characters long. Some apps may cut it, and then it won't open.${withLogo && team?.logo ? ' Dropping the logo makes it shorter.' : ''}`
      : '';
    return url;
  }

  async function copyShareLink() {
    const url = $('share-url').value;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      $('share-status').textContent = `Link copied (${linkSize(url)})`;
    } catch {
      $('share-url').select();
      $('share-status').textContent = `Couldn't copy it: select the link and copy it yourself (${linkSize(url)}).`;
    }
  }

  async function nativeShareLink() {
    const url = $('share-url').value;
    if (!url) return;
    try {
      await navigator.share({ title: state.name || 'Rugby play', url });
    } catch (err) {
      if (err.name !== 'AbortError') $('share-status').textContent = `Couldn't share it: use Copy instead (${linkSize(url)}).`;
    }
  }

  function open() {
    $('share-url').value = '';
    $('share-open').removeAttribute('href');
    $('share-warning').hidden = true;
    $('share-native').hidden = typeof navigator.share !== 'function';
    $('share-dialog').showModal();
    makeShareLink();
  }

  function init() {
    $('share-logo').addEventListener('change', makeShareLink);
    $('share-drop-logo').addEventListener('click', () => { $('share-logo').checked = false; makeShareLink(); });
    $('share-copy').addEventListener('click', copyShareLink);
    $('share-native').addEventListener('click', nativeShareLink);
    $('share-url').addEventListener('focus', e => e.target.select());
  }

  return { open, init };
}
