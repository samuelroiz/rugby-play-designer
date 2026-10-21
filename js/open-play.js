// The open play and the play library (library.js): which play is open, autosaving it to its library entry,
// opening another (from the Plays panel, a template, a file, a paste), and another tab changing the same play.

import { blankPlay, readAutosave, parseAutosave, removeAutosave, autosaveText, backupAutosave, downloadBlob, NAME_MAX } from './storage.js';
import { openLibrary, newRecord, backupData, backupFileName, restoreRecords, restoreSummary } from './library.js';
import { initPlaysPanel } from './plays.js';
import { isEmptyPlay } from './templates.js';
import { askConfirm } from './dialogs.js';

const AUTOSAVE_MS = 400;

const OPEN_KEY = 'rugby-play-designer.open-play'; // sessionStorage: this tab's play
const LAST_KEY = 'rugby-play-designer.last-play'; // localStorage: the last play opened in any tab

const STORAGE_FULL = "Couldn't save: this browser's storage is full. Your play is still here: use Plays → Back up all plays to keep it.";
const STORAGE_BLOCKED = "Plays can't be saved in this browser (storage is blocked). Use Plays → Back up all plays to keep your work.";

// The play without its orientation (turning the pitch is a view choice, not an edit).
const playKey = play => JSON.stringify({ ...play, orientation: null });

// A new play nobody has touched: nothing on it and still "Untitled play". Not worth keeping in the library.
const isBlank = play => isEmptyPlay(play) && play.name === 'Untitled play';

// "<name> copy", kept within the name limit.
const copyName = name => `${name.slice(0, NAME_MAX - 5)} copy`;

// replacePlay(play, phase) puts a play in `state`; refreshInputs() makes the text boxes show the state again
// (a rename from the Plays panel). finishEdit(save) closes a box being typed in over the pitch.
export function createOpenPlay({ state, ui, history, replacePlay, render, playback, present, busy, finishEdit, showToast, refreshInputs }) {
  const $ = id => document.getElementById(id);

  // The play library (see library.js): every play in this browser. The open play is always one of its
  // entries (currentId), and the autosave writes to that entry. Each tab remembers which play it has open (so a
  // reload brings it back), and the last play opened in any tab is what a new tab opens.
  let library = null;
  let currentId = null;
  let playsPanel = null;

  // The open play's entry is written only when its text has changed. While another tab's change to the same
  // play is waiting for an answer (see initTabs), nothing is written, so theirs isn't overwritten before the
  // user chooses. A failed write keeps the play on screen and in memory, and says how to keep it safe.
  let autosaveTimer = null;
  let lastSaved = null;
  let theirs = null;

  function storageFailed(err) {
    const message = err?.name === 'QuotaExceededError' || /quota|full/i.test(err?.message ?? '') ? STORAGE_FULL : STORAGE_BLOCKED;
    if ($('toast').hidden || $('toast').textContent !== message) showToast(message);
  }
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(flushAutosave, AUTOSAVE_MS);
  }

  function flushAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    if (theirs != null || !library || !currentId) return;
    const text = autosaveText(state, ui.phase);
    if (text === lastSaved) return;
    lastSaved = text;
    const old = library.get(currentId);
    const now = Date.now();
    // "Last edited" moves only when the play itself changes, not the phase shown or the orientation.
    const edited = !old || playKey(old.play) !== playKey(state);
    // Editing a play that another tab moved to Recently deleted brings it back.
    library.save({
      id: currentId, created: old?.created ?? now, deletedAt: null,
      play: structuredClone(state), phase: ui.phase, updated: edited ? now : old.updated,
    }).catch(err => {
      if (lastSaved === text) lastSaved = null; // try again with the next change
      storageFailed(err);
    });
    playsPanel?.refresh();
  }

  function rememberOpen(id) {
    try { sessionStorage.setItem(OPEN_KEY, id); } catch { /* blocked */ }
    try { localStorage.setItem(LAST_KEY, id); } catch { /* blocked */ }
  }
  function rememberedOpen() {
    // The storage objects themselves throw when storage is blocked, so they're reached inside the try.
    const read = (storage, key) => { try { return storage().getItem(key); } catch { return null; } };
    return [read(() => sessionStorage, OPEN_KEY), read(() => localStorage, LAST_KEY)];
  }

  // Shows a library entry as the open play, with a fresh undo history. `keepOrientation` keeps the pitch the
  // way it's turned now (switching plays); at startup the entry's own orientation is used.
  function showRecord(rec, { keepOrientation = true } = {}) {
    finishEdit(false);
    // Only when something is playing: stopping redraws, and at startup nothing is set up to draw yet.
    if (playback.playing || playback.paused) playback.stop();
    if (ui.presenting) present.exit();
    ui.placing = null;
    currentId = rec.id;
    rememberOpen(rec.id);
    replacePlay(keepOrientation ? { ...rec.play, orientation: state.orientation } : rec.play, rec.phase);
    history.reset();
    lastSaved = autosaveText(state, ui.phase);
  }

  // Opens another play from the library (the open one is saved first).
  function switchTo(id) {
    const rec = library.get(id);
    if (!rec || id === currentId) return;
    flushAutosave();
    showRecord(rec);
    render();
  }

  // New play, a template, the example and Load file: each becomes a new library entry and opens, so nothing is
  // ever replaced. The open play is saved first and stays in the library; if it's empty (nothing on it at all),
  // it's dropped rather than left behind as an empty "Untitled play".
  function createAndOpen(play) {
    flushAutosave();
    const empty = currentId && isBlank(state);
    if (empty) library.remove(currentId).catch(() => {});
    const rec = newRecord({ ...play, orientation: state.orientation });
    library.save(rec).catch(storageFailed);
    showRecord(rec);
    render();
    playsPanel?.refresh();
    return rec;
  }

  // Paste play → Replace the open play: the pasted play takes the open play's place under the same library id,
  // as one undo step. The version it replaces goes to Recently deleted as its own entry, so it can be
  // restored (unless it's a blank, empty "Untitled play", which isn't worth keeping).
  function replaceOpenPlay(play) {
    flushAutosave();
    const old = library.get(currentId);
    if (old && !isBlank(old.play)) {
      Promise.all([library.save({ ...newRecord(old.play, old.phase), created: old.created, deletedAt: Date.now() }), library.prune()])
        .catch(storageFailed);
    }
    finishEdit(false);
    if (playback.playing || playback.paused) playback.stop();
    ui.placing = null;
    replacePlay({ ...play, orientation: state.orientation });
    render();
    playsPanel?.refresh();
  }

  // Another tab changed the library. The Plays list follows it. If the change is to the play open here and
  // differs from it, ask which to keep: "Use theirs" loads it (one undo step), "Keep mine" saves this one
  // again. Until then nothing is autosaved here. Moving between phases or turning the pitch there isn't a
  // change. Tabs with different plays open never ask.
  function remoteChange(msg) {
    playsPanel?.refresh();
    if (msg.type !== 'put' || msg.record.id !== currentId) return;
    if (theirs == null && playKey(msg.record.play) === playKey(state)) return;
    theirs = msg.record;
    clearTimeout(autosaveTimer);
    if (playback.playing) playback.pause();
    const dialog = $('tab-dialog');
    if (!dialog.open) {
      finishEdit(false);
      dialog.returnValue = '';
      dialog.showModal();
    }
  }

  function initTabs() {
    const dialog = $('tab-dialog');
    dialog.addEventListener('close', () => {
      const rec = theirs;
      theirs = null;
      if (dialog.returnValue === 'theirs' && rec) {
        replacePlay({ ...rec.play, orientation: state.orientation }, rec.phase);
        lastSaved = autosaveText(state, ui.phase);
        render();
        return;
      }
      lastSaved = null; // save again even if nothing changed here, so this play is the one kept
      flushAutosave();
    });
  }

  // --- Plays panel actions ---

  function openPlays() {
    if (busy()) return;
    flushAutosave(); // so the list shows the open play as it is
    playsPanel.show();
  }

  const playActions = {
    open: id => switchTo(id),
    duplicate(id) {
      if (id === currentId) flushAutosave();
      const rec = library.get(id);
      if (!rec) return;
      library.save(newRecord({ ...rec.play, name: copyName(rec.play.name) }, rec.phase)).catch(storageFailed);
    },
    rename(id, name) {
      if (id === currentId) {
        // The open play: an ordinary edit (one undo step), saved by the autosave.
        state.name = name;
        refreshInputs();
        render();
        return;
      }
      const rec = library.get(id);
      if (rec) library.save({ ...rec, play: { ...rec.play, name }, updated: Date.now() }).catch(storageFailed);
    },
    // Deleting the open play opens the most recently edited other one, or a new blank play if there is none.
    // A blank, empty "Untitled play" goes for good rather than to Recently deleted, so deleting the blank
    // that replaced a deleted play never fills Recently deleted with blanks.
    trash(id) {
      if (id === currentId) flushAutosave();
      const rec = library.get(id);
      if (!rec) return;
      const blank = isBlank(rec.play);
      // The limit applies in memory straight away (the writes follow), so the list is right at once.
      if (blank) library.remove(id).catch(storageFailed);
      else Promise.all([library.trash(id), library.prune()]).catch(storageFailed);
      if (id !== currentId) return;
      const next = library.all().find(r => r.id !== id && r.deletedAt == null);
      if (next) {
        switchTo(next.id);
        return;
      }
      const fresh = newRecord(blankPlay({ view: state.view, orientation: state.orientation }));
      library.save(fresh).catch(storageFailed);
      showRecord(fresh);
      render();
    },
    restore: id => { library.restore(id).catch(storageFailed); },
    async purge(id) {
      const rec = library.get(id);
      if (!rec) return false;
      if (!(await askConfirm(`Delete "${rec.play.name}" forever? This can't be undone.`, 'Delete forever'))) return false;
      library.remove(id).catch(storageFailed);
      return true;
    },
    backup() {
      flushAutosave();
      const blob = new Blob([JSON.stringify(backupData(library.all()), null, 2) + '\n'], { type: 'application/json' });
      const name = backupFileName();
      downloadBlob(blob, name);
      playsPanel.setStatus(`Saved ${name}`);
    },
    // Adds the backup's plays to the library, never changing those already here.
    async restoreFile(file) {
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        return { ok: false, message: `"${file.name}" isn't a plays backup: it isn't valid JSON.` };
      }
      let result;
      try {
        result = restoreRecords(data, library.all());
      } catch (err) {
        return { ok: false, message: err.message };
      }
      const writes = result.add.map(rec => library.save(rec));
      let failed = null;
      await Promise.all(writes.map(w => w.catch(err => { failed ??= err; })));
      await library.prune().catch(() => {});
      if (failed) storageFailed(failed);
      return { ok: !result.invalid, message: restoreSummary(result) };
    },
  };

  // Opens the library and picks the play to show: the old autosave on first run (moved into the library, so
  // nobody loses their play), else this tab's play (after a reload), else the last play opened in any tab, else
  // the most recently edited, else a new blank play. Returns { broken }: the old autosave couldn't be read (it's
  // kept under its backup key).
  async function openStartPlay() {
    library = await openLibrary({ onRemote: remoteChange });
    window.rugbyLibrary = library; // for tests, like window.playState
    library.openId = () => currentId;
    if (!library.persistent) showToast(STORAGE_BLOCKED);
    const raw = readAutosave();
    if (raw != null) {
      let saved = null;
      try {
        saved = parseAutosave(raw);
      } catch {
        backupAutosave(raw);
        removeAutosave();
      }
      if (saved) {
        const rec = newRecord(saved.play, saved.phase);
        showRecord(rec, { keepOrientation: false });
        // The old autosave goes only once its play is safely in the library.
        try {
          await library.save(rec);
          removeAutosave();
        } catch (err) {
          storageFailed(err);
        }
        return { broken: false };
      }
      return { broken: true };
    }
    const live = library.all().filter(r => r.deletedAt == null);
    const [mine, last] = rememberedOpen();
    const rec = live.find(r => r.id === mine) ?? live.find(r => r.id === last) ?? live[0];
    if (rec) {
      showRecord(rec, { keepOrientation: false });
      return { broken: false };
    }
    openBlank();
    return { broken: false };
  }

  // Opens a new blank play, in a new library entry.
  function openBlank() {
    const blank = newRecord(blankPlay({ orientation: state.orientation }));
    library.save(blank).catch(storageFailed);
    showRecord(blank, { keepOrientation: false });
  }

  // The Plays panel (plays.js), opened by the Plays button and File → Plays.
  function initPlays() {
    playsPanel = initPlaysPanel({ library, currentId: () => currentId, orientation: () => state.orientation, actions: playActions });
    $('plays-button').addEventListener('click', openPlays);
  }

  return { scheduleAutosave, flushAutosave, createAndOpen, replaceOpenPlay, openPlays, initTabs, initPlays, openStartPlay, openBlank };
}
