// The Plays panel: every play in this browser's library, most recently edited first, each with a thumbnail of
// phase 1 (drawn like the template cards), its name, category, tags, phase count and when it was last edited.
// A search box (name and tags) and a category filter narrow the list. Each row has Open (or click the row),
// Duplicate, Rename (an in-row field: Enter or clicking away saves, Escape cancels) and Delete, which moves the
// play to "Recently deleted" at the bottom (collapsed), with Restore and Delete forever. The open play is
// marked. Back up all plays and Restore from backup… sit at the top.
//
// The panel only shows the library and asks the app to act: actions.open(id), duplicate(id), rename(id, name),
// trash(id), restore(id), purge(id), backup(), restoreFile(file) (resolves to a message to show).

import { thumbnail } from './templates.js';
import { NAME_MAX } from './storage.js';

const CATEGORY_LABELS = { attack: 'Attack', defense: 'Defense', lineout: 'Lineout', scrum: 'Scrum' };

// "just now", "5 min ago", "3 h ago", "yesterday", or the date.
function ago(time, now = Date.now()) {
  const min = Math.floor((now - time) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  if (h < 48) return 'yesterday';
  return new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function initPlaysPanel({ library, currentId, orientation, actions }) {
  const $ = id => document.getElementById(id);
  const dialog = $('plays-dialog');
  const list = $('plays-list');
  const search = $('plays-search');
  const category = $('plays-category');
  const deleted = $('plays-deleted');
  const deletedList = $('plays-deleted-list');
  const status = $('plays-status');
  let renaming = null; // { id, input, done }
  let swallowCancel = false; // the Escape that cancelled a rename mustn't close the panel too

  function setStatus(message, kind = 'ok') {
    status.textContent = message;
    status.className = `plays-status ${kind}`;
    status.hidden = !message;
  }

  function show() {
    setStatus('');
    dialog.returnValue = '';
    if (!dialog.open) dialog.showModal();
    refresh();
    search.focus();
  }

  const matches = r => {
    const q = search.value.trim().toLowerCase();
    if (category.value && r.play.category !== category.value) return false;
    return !q || r.play.name.toLowerCase().includes(q) || r.play.tags.some(t => t.toLowerCase().includes(q));
  };

  function button(text, act, cls = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.act = act;
    b.textContent = text;
    if (cls) b.className = cls;
    return b;
  }

  function row(r) {
    const li = document.createElement('li');
    li.className = 'play-row';
    li.dataset.id = r.id;
    const open = r.id === currentId();
    if (open) li.setAttribute('aria-current', 'true');
    const thumb = thumbnail(r.play, orientation());
    const info = document.createElement('div');
    info.className = 'play-info';
    const name = document.createElement('strong');
    name.className = 'play-name';
    name.textContent = r.play.name;
    const meta = document.createElement('span');
    meta.className = 'play-meta';
    const n = r.play.phases.length;
    meta.textContent = [CATEGORY_LABELS[r.play.category] ?? r.play.category, r.play.tags.join(', '), `${n} phase${n === 1 ? '' : 's'}`, `Edited ${ago(r.updated)}`]
      .filter(Boolean).join(' · ');
    info.append(name, meta);
    if (open) {
      const badge = document.createElement('span');
      badge.className = 'open-badge';
      badge.textContent = 'Open now';
      info.prepend(badge);
    }
    const buttons = document.createElement('div');
    buttons.className = 'play-actions';
    const openBtn = button('Open', 'open');
    openBtn.disabled = open;
    buttons.append(openBtn, button('Duplicate', 'duplicate'), button('Rename', 'rename'), button('Delete', 'trash', 'danger'));
    li.append(thumb, info, buttons);
    return li;
  }

  function deletedRow(r) {
    const li = document.createElement('li');
    li.className = 'play-row deleted';
    li.dataset.id = r.id;
    const info = document.createElement('div');
    info.className = 'play-info';
    const name = document.createElement('strong');
    name.className = 'play-name';
    name.textContent = r.play.name;
    const meta = document.createElement('span');
    meta.className = 'play-meta';
    meta.textContent = `Deleted ${ago(r.deletedAt)}`;
    info.append(name, meta);
    const buttons = document.createElement('div');
    buttons.className = 'play-actions';
    buttons.append(button('Restore', 'restore'), button('Delete forever', 'purge', 'danger'));
    li.append(info, buttons);
    return li;
  }

  // Redraws the list (when the panel is open), keeping a rename in progress.
  function refresh() {
    if (!dialog.open || renaming) return;
    const all = library.all();
    const live = all.filter(r => r.deletedAt == null);
    const shown = live.filter(matches);
    list.replaceChildren(...shown.map(row));
    $('plays-empty').hidden = shown.length > 0;
    $('plays-empty').textContent = live.length ? 'No plays match.' : 'No plays yet.';
    const gone = all.filter(r => r.deletedAt != null).sort((a, b) => b.deletedAt - a.deletedAt);
    deleted.hidden = !gone.length;
    $('plays-deleted-count').textContent = `Recently deleted (${gone.length})`;
    deletedList.replaceChildren(...gone.map(deletedRow));
  }

  function startRename(id) {
    const li = list.querySelector(`[data-id="${id}"]`);
    const r = library.get(id);
    if (!li || !r) return;
    const name = li.querySelector('.play-name');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'play-rename';
    input.maxLength = NAME_MAX;
    input.value = r.play.name;
    input.setAttribute('aria-label', 'Play name');
    name.replaceWith(input);
    input.focus();
    input.select();
    const done = save => {
      if (renaming?.input !== input) return;
      renaming = null;
      const value = input.value.trim();
      if (save && value && value !== r.play.name) actions.rename(id, value.slice(0, NAME_MAX));
      refresh();
    };
    renaming = { id, input, done };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
      else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        swallowCancel = true;
        setTimeout(() => { swallowCancel = false; });
        done(false);
      }
    });
    input.addEventListener('blur', () => done(true));
  }

  async function act(id, what) {
    if (what === 'open') { if (id !== currentId()) { dialog.close(); actions.open(id); } return; }
    if (what === 'rename') { startRename(id); return; }
    if (what === 'duplicate') actions.duplicate(id);
    else if (what === 'trash') actions.trash(id);
    else if (what === 'restore') actions.restore(id);
    else if (what === 'purge' && !(await actions.purge(id))) return;
    refresh();
  }

  for (const ul of [list, deletedList]) {
    ul.addEventListener('click', e => {
      const li = e.target.closest('.play-row');
      if (!li || e.target.closest('input')) return;
      const b = e.target.closest('[data-act]');
      if (b) { if (!b.disabled) act(li.dataset.id, b.dataset.act); return; }
      // A click anywhere else on a (not deleted) row opens it.
      if (!li.classList.contains('deleted') && !e.target.closest('.play-actions')) act(li.dataset.id, 'open');
    });
  }
  search.addEventListener('input', refresh);
  category.addEventListener('change', refresh);
  // Escape while renaming cancels the rename, not the panel.
  dialog.addEventListener('cancel', e => {
    if (renaming || swallowCancel) { e.preventDefault(); renaming?.done(false); }
  });
  dialog.addEventListener('click', e => {
    const r = dialog.getBoundingClientRect();
    if (e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dialog.close();
  });
  $('plays-backup').addEventListener('click', () => actions.backup());
  $('plays-restore').addEventListener('click', () => $('restore-input').click());
  $('restore-input').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const { message, ok } = await actions.restoreFile(file);
    setStatus(message, ok ? 'ok' : 'error');
    refresh();
  });

  return { show, refresh, setStatus, get open() { return dialog.open; } };
}
