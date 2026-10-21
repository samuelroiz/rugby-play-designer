// The ways in: the Templates picker, About, the Welcome box on a first visit, "Try an example", the AI play
// guide (linked and copied from About and the File menu) and File → Paste play. A play picked or pasted here
// opens as a new play in the library (createAndOpen), or replaces the open one (replaceOpenPlay).

import { parsePlay } from './storage.js';
import { loadTemplates, loadExample, thumbnail } from './templates.js';
import { closeOnClickOutside } from './dialogs.js';

export function createStart({ state, ui, busy, playback, showToast, createAndOpen, replaceOpenPlay }) {
  const $ = id => document.getElementById(id);

  // File → Paste play…: a play's JSON pasted as text (e.g. written by an AI assistant from the AI play guide),
  // checked like Load file. A good play opens as a new play in the library, or, with "Replace the open play",
  // takes the open play's place; a bad one leaves the box open with the error and the text, so it can be fixed.
  function openPasteDialog() {
    $('paste-play-text').value = '';
    document.querySelector('[name="paste-mode"][value="new"]').checked = true;
    $('paste-play-error').hidden = true;
    $('paste-dialog').showModal();
    $('paste-play-text').focus();
  }

  function initPasteDialog() {
    const dialog = $('paste-dialog');
    const text = $('paste-play-text');
    const error = $('paste-play-error');
    const fail = message => {
      error.textContent = message;
      error.hidden = false;
      text.focus();
    };
    const importPlay = () => {
      if (busy()) return;
      let data;
      try {
        data = JSON.parse(text.value);
      } catch {
        fail(text.value.trim() ? "That isn't a play: it isn't valid JSON." : 'Paste a play first.');
        return;
      }
      let play;
      try {
        play = parsePlay(data);
      } catch (err) {
        fail(err.message.replace(/^That file/, 'That text'));
        return;
      }
      dialog.close();
      if (document.querySelector('[name="paste-mode"]:checked')?.value === 'replace') replaceOpenPlay(play);
      else createAndOpen(play);
      showToast(`Imported ${play.name}`, 'ok');
    };
    $('paste-play-import').addEventListener('click', importPlay);
    // Ctrl/Cmd+Enter in the box imports too.
    text.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); importPlay(); }
    });
    text.addEventListener('input', () => { error.hidden = true; });
  }

  // The AI play guide (docs/AI_PLAY_GUIDE.md): linked from About and the File menu, and "Copy guide" puts its
  // text on the clipboard. The text is fetched when About or the File menu opens, so the copy can happen
  // straight away in the click (some browsers only allow the clipboard during the click itself).
  const GUIDE_URL = new URL('../docs/AI_PLAY_GUIDE.md', import.meta.url);
  let guideText = null;
  function fetchGuide() {
    guideText ??= fetch(GUIDE_URL).then(res => {
      if (!res.ok) throw new Error(res.statusText);
      return res.text();
    }).catch(err => {
      guideText = null;
      throw err;
    });
    return guideText;
  }

  async function copyGuide(button) {
    try {
      await navigator.clipboard.writeText(await fetchGuide());
    } catch {
      showToast("Couldn't copy the guide. Open it with AI play guide instead.");
      return;
    }
    showToast('Copied the AI play guide', 'ok');
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.textContent = 'Copied';
    clearTimeout(button.copiedTimer);
    button.copiedTimer = setTimeout(() => { button.textContent = button.dataset.label; }, 2000);
  }

  function initGuideLinks() {
    for (const b of document.querySelectorAll('[data-copy-guide]')) {
      b.addEventListener('click', () => {
        if (b.closest('#file-menu')) $('file-menu').open = false;
        copyGuide(b);
      });
    }
    $('menu-guide').addEventListener('click', () => { $('file-menu').open = false; });
    $('file-menu').addEventListener('toggle', () => { if ($('file-menu').open) fetchGuide().catch(() => {}); });
  }

  // Templates picker: a card per template with a thumbnail drawn from its data. Picking one starts a new play
  // from it (asking first unless the current play is empty), as one undo step. The template's view is kept,
  // but it takes the current orientation, which is a choice about the screen rather than the play.
  function initTemplatesDialog() {
    const dialog = $('templates-dialog');
    const grid = $('template-grid');
    const status = $('templates-status');
    let templates = [];

    $('templates-button').addEventListener('click', openTemplates);
    async function openTemplates() {
      grid.replaceChildren();
      status.hidden = false;
      status.textContent = 'Loading templates…';
      dialog.showModal();
      try {
        templates = await loadTemplates();
      } catch (err) {
        status.textContent = err.message;
        return;
      }
      status.hidden = true;
      grid.replaceChildren(...templates.map((t, i) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'template-card';
        card.dataset.template = i;
        const name = document.createElement('span');
        name.textContent = t.name;
        card.append(thumbnail(t.play, state.orientation), name);
        return card;
      }));
    }

    grid.addEventListener('click', e => {
      const card = e.target.closest('[data-template]');
      if (!card) return;
      const t = templates[Number(card.dataset.template)];
      dialog.close();
      if (busy()) return;
      createAndOpen(t.play);
    });
    return openTemplates;
  }

  // About: what the app is, with a finished example to try. It never opens by itself, and opening or closing
  // it changes nothing in the play, so there's no undo step or autosave. Escape, Close or a click outside
  // closes it. "Try an example" loads templates/example.json like a template (asking first unless the
  // current play is empty, one undo step) and plays it once from phase 1 at 1x.
  function openAbout() {
    const dialog = $('about-dialog');
    $('about-example').disabled = busy();
    dialog.returnValue = '';
    dialog.showModal();
    fetchGuide().catch(() => {});
  }

  function initAboutDialog() {
    const dialog = $('about-dialog');
    $('about-button').addEventListener('click', openAbout);
    closeOnClickOutside(dialog);
    $('about-example').addEventListener('click', () => tryExample(dialog));
  }

  // "Try an example", from About or Welcome: closes that box first.
  async function tryExample(dialog) {
    let play;
    try {
      play = await loadExample();
    } catch (err) {
      dialog.close();
      showToast(err.message);
      return;
    }
    dialog.close();
    if (busy()) return;
    createAndOpen(play);
    playback.speed = 1;
    playback.setLoop(false);
    playback.play();
  }

  // Welcome: opens by itself once, on a first visit to this browser (nothing stored under its key yet), but not
  // on a link to a phase (#phase=), in Present mode, or when storage can't be read. Closing it any way stores
  // that it was seen; if that can't be stored it quietly opens again next time. Like About, it changes nothing
  // in the play. Its buttons do what About's "Try an example" does, open the Templates picker, or just close.
  const WELCOME_KEY = 'rugby-play-designer.welcome-seen';

  // linked: the page was opened with #phase= in its address (read before the first render writes one).
  function initWelcomeDialog(openTemplates, linked) {
    const dialog = $('welcome-dialog');
    dialog.addEventListener('close', () => {
      try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* storage blocked: nothing to do */ }
    });
    closeOnClickOutside(dialog);
    $('welcome-example').addEventListener('click', () => tryExample(dialog));
    $('welcome-template').addEventListener('click', () => { dialog.close(); openTemplates(); });
    $('welcome-about').addEventListener('click', () => { dialog.close(); openAbout(); });

    function maybeOpen() {
      let firstVisit = false;
      try { firstVisit = localStorage.getItem(WELCOME_KEY) === null; } catch { /* storage blocked: don't open */ }
      if (!firstVisit || linked || ui.presenting || dialog.open) return;
      $('welcome-example').disabled = busy();
      dialog.returnValue = '';
      dialog.showModal();
    }
    // For tests: the same check the page load runs, e.g. while presenting.
    window.rugbyWelcome = { maybeOpen };
    maybeOpen();
  }

  return { openPasteDialog, initPasteDialog, initGuideLinks, initTemplatesDialog, openAbout, initAboutDialog, initWelcomeDialog };
}
