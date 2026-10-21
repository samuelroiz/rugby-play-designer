// The side panel's cues for the selected player in the shown phase: the list (each its text, "step n", Edit
// and Delete, sorted by step) and the form that adds or edits one. A cue pops up next to the player as its
// step starts, in the phone viewer, Present mode and a position's animation (cues.js).

import { CUE_MAX, defaultCueStep } from './cues.js';

export function createCuePanel({ state, ui, phase, locked, render }) {
  const $ = id => document.getElementById(id);

  // The selected player's cues for this phase: each its text, "step n", Edit and Delete, sorted by step. The
  // list is only rebuilt when it changes, so a focused button keeps the focus.
  let cueEdit = null; // the cue form: { player, phase, index } (index null for a new cue)
  let cueListKey = null;
  const playerCues = id => (phase().cues ?? []).map((c, index) => ({ ...c, index })).filter(c => c.player === id).sort((a, b) => a.step - b.step);
  function syncCues(sel) {
    if (cueEdit && (!sel || cueEdit.player !== sel.id || cueEdit.phase !== ui.phase)) closeCueForm();
    if (!sel) { cueListKey = null; return; }
    const cues = playerCues(sel.id);
    const key = JSON.stringify([sel.id, sel.label, ui.phase, cues, cueEdit?.index]);
    if (key === cueListKey) return;
    cueListKey = key;
    $('cues-title').textContent = 'Cues';
    $('cue-list').setAttribute('aria-label', `${sel.label}'s cues in this phase`);
    $('cue-list').replaceChildren(...cues.filter(c => c.index !== cueEdit?.index).map(c => {
      const li = document.createElement('li');
      const text = document.createElement('span');
      text.className = 'cue-text';
      text.textContent = c.text.toUpperCase();
      const at = document.createElement('span');
      at.className = 'cue-at';
      at.textContent = `step ${c.step}`;
      const button = (label, action, aria) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.dataset.cueAction = action;
        b.dataset.index = c.index;
        b.setAttribute('aria-label', aria);
        return b;
      };
      li.append(text, at, button('Edit', 'edit', `Edit cue ${c.text}`), button('Delete', 'delete', `Delete cue ${c.text}`));
      return li;
    }));
    $('cue-add').hidden = !!cueEdit;
  }

  // The steps a cue can pop up at: the order numbers of the phase's routes (1 if it has none), and `keep`.
  function cueSteps(keep) {
    const steps = new Set(phase().routes.map(r => r.order).filter(Number.isInteger));
    if (!steps.size) steps.add(1);
    if (keep != null) steps.add(keep);
    return [...steps].sort((a, b) => a - b);
  }

  // Opens the cue form for a new cue (index null) or cue `index` of this phase.
  function openCueForm(index = null) {
    const id = ui.selected?.kind === 'player' ? ui.selected.id : null;
    if (!id || locked()) return;
    const cue = index == null ? null : phase().cues?.[index];
    const step = cue?.step ?? defaultCueStep(phase().routes, id);
    cueEdit = { player: id, phase: ui.phase, index: cue ? index : null };
    $('cue-step').replaceChildren(...cueSteps(step).map(n => new Option(String(n), String(n), false, n === step)));
    $('cue-text').value = cue?.text ?? '';
    $('cue-form').hidden = false;
    cueListKey = null;
    syncCues(state.players.find(p => p.id === id));
    $('cue-text').focus();
  }
  function closeCueForm() {
    cueEdit = null;
    cueListKey = null;
    $('cue-form').hidden = true;
    $('cue-add').hidden = false;
  }
  // Saving or deleting a cue is one undo step. A phase keeps `cues` only while it has some.
  function saveCue() {
    const edit = cueEdit;
    const text = $('cue-text').value.trim().slice(0, CUE_MAX);
    if (!edit || !text) { $('cue-text').focus(); return; }
    const cue = { player: edit.player, step: Number($('cue-step').value) || 1, text };
    const ph = state.phases[edit.phase];
    if (edit.index != null && ph.cues?.[edit.index]) ph.cues[edit.index] = cue;
    else (ph.cues ??= []).push(cue);
    closeCueForm();
    render();
  }
  function deleteCue(index) {
    const ph = phase();
    if (!ph.cues?.[index]) return;
    ph.cues.splice(index, 1);
    if (!ph.cues.length) delete ph.cues;
    if (cueEdit) closeCueForm();
    render();
  }
  function initCues() {
    $('cue-add').addEventListener('click', () => openCueForm());
    $('cue-form').addEventListener('submit', e => { e.preventDefault(); saveCue(); });
    $('cue-cancel').addEventListener('click', () => { closeCueForm(); render(null, { record: false }); });
    $('cue-form').addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      closeCueForm();
      render(null, { record: false });
    });
    $('cue-list').addEventListener('click', e => {
      const b = e.target.closest('[data-cue-action]');
      if (!b || locked()) return;
      if (b.dataset.cueAction === 'edit') openCueForm(Number(b.dataset.index));
      else deleteCue(Number(b.dataset.index));
    });
  }

  return { syncCues, initCues };
}
