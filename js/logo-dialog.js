// File → Team logo…: the team logo setting (logo.js) and its box, and everywhere the logo and team name show.

import { readLogoSettings, saveLogoSettings, logoSrc, readLogoFile, sanitizeSvg, LOGO_KEY, TEAM_NAME_MAX } from './logo.js';
import { closeOnClickOutside } from './dialogs.js';

// fitTopbar() refits the top bar when the logo beside the name changes.
export function createLogoDialog({ showToast, fitTopbar }) {
  const $ = id => document.getElementById(id);

  // The team logo: a setting of this browser, not of the play (see logo.js), so it never goes in the play,
  // its files, the autosave or the undo history.
  let teamLogo = readLogoSettings();

  // Team logo: shown left of the play name, in a corner in Present mode, on exports (if "Show logo on exports"
  // is on) and, through the team name, in the About box. Every change in the box is kept straight away.
  function updateLogo() {
    const src = logoSrc(teamLogo);
    const name = teamLogo.name.trim();
    for (const img of [$('topbar-logo'), $('present-logo'), $('welcome-logo')]) {
      if (!src) { img.hidden = true; img.removeAttribute('src'); continue; }
      img.alt = name ? `${name} logo` : 'Team logo';
      if (img.getAttribute('src') !== src) { img.hidden = false; img.src = src; }
    }
    for (const line of [$('about-team'), $('welcome-team')]) {
      line.textContent = name ? `Made for ${name}` : '';
      line.hidden = !name;
    }
    fitTopbar();
  }

  function openLogoDialog() {
    const dialog = $('logo-dialog');
    $('logo-name').value = teamLogo.name;
    $('logo-exports').checked = teamLogo.exports;
    logoStatus('');
    updateLogoPreview();
    dialog.returnValue = '';
    dialog.showModal();
  }

  function updateLogoPreview() {
    const src = logoSrc(teamLogo);
    const preview = $('logo-preview');
    preview.hidden = !src;
    if (src) preview.src = src; else preview.removeAttribute('src');
    $('logo-empty').hidden = !!src;
    $('logo-remove').disabled = !src;
  }

  function logoStatus(message, error = false) {
    const status = $('logo-status');
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  // Keeps the setting; if storage is blocked or full it still applies until the page is closed.
  const LOGO_NOT_SAVED = "Couldn't save the logo setting in this browser. It's used until you close this page.";
  function keepLogo(done) {
    updateLogo();
    updateLogoPreview();
    if (saveLogoSettings(teamLogo)) {
      if (done) logoStatus(done);
      return;
    }
    logoStatus(LOGO_NOT_SAVED, true);
    showToast(LOGO_NOT_SAVED);
  }

  function initLogoDialog() {
    const dialog = $('logo-dialog');
    const input = $('logo-input');
    const name = $('logo-name');
    name.maxLength = TEAM_NAME_MAX;
    $('logo-upload').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = ''; // so picking the same file again still fires "change"
      if (!file) return;
      logoStatus('Reading the image…');
      try {
        teamLogo.logo = await readLogoFile(file);
      } catch (err) {
        logoStatus(err.message, true);
        return;
      }
      keepLogo('Logo saved.');
    });
    $('logo-remove').addEventListener('click', () => {
      teamLogo.logo = null;
      keepLogo('Logo removed.');
    });
    $('logo-exports').addEventListener('change', e => {
      teamLogo.exports = e.target.checked;
      keepLogo('');
    });
    // The name shows in the About box as it's typed, and is kept when it's done (on change, or on closing).
    let nameChanged = false;
    name.addEventListener('input', () => {
      teamLogo.name = name.value.slice(0, TEAM_NAME_MAX);
      nameChanged = true;
      updateLogo();
    });
    const keepName = () => { if (nameChanged) { nameChanged = false; keepLogo(''); } };
    name.addEventListener('change', keepName);
    dialog.addEventListener('close', keepName);
    closeOnClickOutside(dialog);
    // A logo that can't be shown (the default file missing, say) is hidden rather than drawn broken.
    for (const img of [$('topbar-logo'), $('present-logo'), $('welcome-logo'), $('logo-preview')]) {
      img.addEventListener('error', () => { img.hidden = true; });
    }
    // Another tab changed it.
    addEventListener('storage', e => {
      if (e.key !== LOGO_KEY) return;
      teamLogo = readLogoSettings();
      updateLogo();
    });
    updateLogo();
  }
  // For tests: the SVG cleaner, so a check can look at what it keeps.
  window.rugbyLogo = { sanitizeSvg, settings: () => ({ ...teamLogo }) };

  return { teamLogo: () => teamLogo, openLogoDialog, initLogoDialog };
}
