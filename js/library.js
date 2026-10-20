// The play library: every play kept in this browser, one record per play:
// { id, play, phase, created, updated, deletedAt }. `phase` is the phase last shown, `created` and `updated`
// are times in ms (updated changes only when the play itself changes), and `deletedAt` is set while a play
// is in "Recently deleted" (null otherwise).
//
// Plays are stored in IndexedDB, or in localStorage where IndexedDB isn't available, or only in memory when
// storage is blocked (then they last until the page closes, and Back up is the way to keep them). The
// library keeps every record in memory too, so the app always reads from that copy and a failed write never
// loses a play on screen. Writes go one at a time, in order. Other tabs are told about every change through
// a BroadcastChannel, so their lists stay up to date and they can tell when the play they have open was
// changed elsewhere.
//
// The backup format and restoring from it are plain functions of data (no DOM), so the Node tests use them.

import { parsePlay, NAME_MAX } from './storage.js';

const DB_NAME = 'rugby-play-designer';
const STORE = 'plays';
const LS_PREFIX = 'rugby-play-designer.play.';
const CHANNEL = 'rugby-play-designer.library';
const OPEN_TIMEOUT_MS = 4000;
// "Recently deleted" keeps this many plays; older ones go for good.
const DELETED_KEEP = 20;

const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// A new record for `play`, not yet saved.
export function newRecord(play, phase = 0) {
  const now = Date.now();
  return { id: newId(), play: structuredClone(play), phase, created: now, updated: now, deletedAt: null };
}

// --- Backends: getAll(), get(id), put(record), remove(id), each a Promise that rejects if storage fails ---

function openIndexedDb() {
  return new Promise(resolve => {
    let req;
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) { resolve(null); return; }
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => resolve(null), OPEN_TIMEOUT_MS);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      // Another page deleting or upgrading the database (the tests clear it): let it.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => { clearTimeout(timer); resolve(null); };
    req.onblocked = () => { clearTimeout(timer); resolve(null); };
  });
}

function indexedDbBackend(db) {
  const run = (mode, fn) => new Promise((resolve, reject) => {
    let result;
    try {
      const tx = db.transaction(STORE, mode);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new DOMException('The write failed.', 'UnknownError'));
      tx.onabort = () => reject(tx.error ?? new DOMException('The write was aborted.', 'AbortError'));
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => { result = req.result; };
    } catch (err) {
      reject(err);
    }
  });
  return {
    kind: 'indexeddb',
    persistent: true,
    getAll: () => run('readonly', s => s.getAll()),
    get: id => run('readonly', s => s.get(id)),
    put: record => run('readwrite', s => s.put(record)),
    remove: id => run('readwrite', s => s.delete(id)),
  };
}

function localStorageBackend() {
  let ls;
  try {
    ls = window.localStorage;
    ls.getItem(LS_PREFIX); // throws when storage is blocked
  } catch {
    return null;
  }
  const read = key => { try { return JSON.parse(ls.getItem(key)); } catch { return null; } };
  const attempt = fn => new Promise((resolve, reject) => { try { resolve(fn()); } catch (err) { reject(err); } });
  return {
    kind: 'localstorage',
    persistent: true,
    getAll: () => attempt(() => Object.keys(ls).filter(k => k.startsWith(LS_PREFIX)).map(read).filter(Boolean)),
    get: id => attempt(() => read(LS_PREFIX + id)),
    put: record => attempt(() => ls.setItem(LS_PREFIX + record.id, JSON.stringify(record))),
    remove: id => attempt(() => ls.removeItem(LS_PREFIX + id)),
  };
}

// Storage blocked: nothing lasts beyond the page, and every write "fails" so the app can say so.
const BLOCKED = () => Promise.reject(new DOMException('Storage is blocked in this browser.', 'SecurityError'));
const memoryBackend = () => ({ kind: 'memory', persistent: false, getAll: async () => [], get: async () => null, put: BLOCKED, remove: BLOCKED });

// A stored record the app can use: its play passes parsePlay. Anything else is left in storage, unlisted.
function cleanRecord(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) return null;
  let play;
  try {
    play = parsePlay(r.play);
  } catch {
    return null;
  }
  const time = v => (Number.isFinite(v) ? v : Date.now());
  return {
    id: r.id,
    play,
    phase: Number.isInteger(r.phase) && r.phase >= 0 ? Math.min(r.phase, play.phases.length - 1) : 0,
    created: time(r.created),
    updated: time(r.updated),
    deletedAt: Number.isFinite(r.deletedAt) ? r.deletedAt : null,
  };
}

// Opens the library. onRemote(message) is called when another tab changes it: { type: 'put', record } or
// { type: 'remove', id }, after the in-memory copy has been updated.
export async function openLibrary({ onRemote = () => {} } = {}) {
  const db = await openIndexedDb();
  const backend = (db && indexedDbBackend(db)) ?? localStorageBackend() ?? memoryBackend();
  const records = new Map();
  try {
    for (const raw of await backend.getAll()) {
      const r = cleanRecord(raw);
      if (r) records.set(r.id, r);
    }
  } catch {
    // Unreadable storage: start with what's in memory (nothing) and let writes report the trouble.
  }

  let channel = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = e => {
      const msg = e.data;
      if (msg?.type === 'put') {
        const r = cleanRecord(msg.record);
        if (!r) return;
        records.set(r.id, r);
        onRemote({ type: 'put', record: r });
      } else if (msg?.type === 'remove' && typeof msg.id === 'string') {
        records.delete(msg.id);
        onRemote(msg);
      }
    };
  } catch {
    // No BroadcastChannel: other tabs just won't hear about changes until they reload.
  }
  const tell = msg => { try { channel?.postMessage(msg); } catch { /* the other tabs will see it on reload */ } };

  // One write at a time, in the order asked.
  let queue = Promise.resolve();
  const persist = op => {
    const p = queue.then(op);
    queue = p.catch(() => {});
    return p;
  };

  const lib = {
    kind: backend.kind,
    persistent: backend.persistent,
    // Every record (a copy), most recently edited first.
    all: () => [...records.values()].map(r => structuredClone(r)).sort((a, b) => b.updated - a.updated),
    get: id => (records.has(id) ? structuredClone(records.get(id)) : null),
    // Saves a record: in memory straight away, then to storage. The promise rejects if storage fails (the
    // record stays in memory).
    save(record) {
      const r = structuredClone(record);
      records.set(r.id, r);
      tell({ type: 'put', record: r });
      return persist(() => backend.put(r));
    },
    // Deletes a record for good.
    remove(id) {
      records.delete(id);
      tell({ type: 'remove', id });
      return persist(() => backend.remove(id));
    },
    // Moves a play to "Recently deleted", or back.
    trash(id) { return lib.update(id, { deletedAt: Date.now() }); },
    restore(id) { return lib.update(id, { deletedAt: null }); },
    update(id, changes) {
      const r = records.get(id);
      return r ? lib.save({ ...r, ...changes }) : Promise.resolve();
    },
    // Keeps the DELETED_KEEP most recently deleted plays; the rest go for good.
    prune() {
      const old = [...records.values()].filter(r => r.deletedAt != null).sort((a, b) => b.deletedAt - a.deletedAt).slice(DELETED_KEEP);
      return Promise.all(old.map(r => lib.remove(r.id)));
    },
    // Reads a record from storage itself, not the in-memory copy (for tests).
    read: id => backend.get(id),
    // Resolves once every write asked for so far has finished (or failed).
    settled: () => queue,
  };
  return lib;
}

// --- Backup and restore ---

const pad = n => String(n).padStart(2, '0');
export const backupFileName = (date = new Date()) => `rugby-plays-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;

// Every record, recently deleted ones marked `deleted: true`.
export function backupData(records, date = new Date()) {
  return {
    app: 'rugby-play-designer',
    kind: 'plays-backup',
    version: 1,
    saved: date.toISOString(),
    plays: records.map(r => ({
      id: r.id,
      created: r.created,
      updated: r.updated,
      deleted: r.deletedAt != null,
      deletedAt: r.deletedAt,
      phase: r.phase,
      play: r.play,
    })),
  };
}

const canonical = play => JSON.stringify(parsePlay(structuredClone(play)));
const RESTORED = ' (restored)';

// Works out what a backup adds to the library, never changing what's there: each play is checked with
// parsePlay (one that fails is counted as invalid); one whose id is already here with the same play is
// skipped; one whose id is here with a different play is kept as it is here when the library's copy was
// updated as recently or more recently (counted as keptNewer), and otherwise (the backup's is newer, or there's
// no update time to compare) gets a new id and " (restored)" after its name.
// Returns { add: [records], skipped, keptNewer, invalid }. Throws a friendly Error if `data` isn't a backup.
export function restoreRecords(data, existing) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.plays)) {
    throw new Error("That file isn't a plays backup (from Back up all plays).");
  }
  const byId = new Map(existing.map(r => [r.id, r]));
  const add = [];
  let skipped = 0;
  let keptNewer = 0;
  let invalid = 0;
  for (const item of data.plays) {
    let play;
    try {
      play = parsePlay(item?.play);
    } catch {
      invalid++;
      continue;
    }
    let id = typeof item.id === 'string' && /^[\w-]{1,64}$/.test(item.id) ? item.id : newId();
    const here = byId.get(id);
    if (here) {
      if (canonical(here.play) === JSON.stringify(play)) { skipped++; continue; }
      if (Number.isFinite(item.updated) && Number.isFinite(here.updated) && here.updated >= item.updated) { keptNewer++; continue; }
      id = newId();
      play.name = play.name.slice(0, NAME_MAX - RESTORED.length) + RESTORED;
    }
    const now = Date.now();
    const time = v => (Number.isFinite(v) ? v : now);
    const record = {
      id,
      play,
      phase: Number.isInteger(item.phase) && item.phase >= 0 ? Math.min(item.phase, play.phases.length - 1) : 0,
      created: time(item.created),
      updated: time(item.updated),
      deletedAt: item.deleted ? time(item.deletedAt) : null,
    };
    byId.set(id, record);
    add.push(record);
  }
  return { add, skipped, keptNewer, invalid };
}

// "Added 12 plays, 2 skipped (already here), 1 kept newer (the copy here is newer)", and how many couldn't be
// read, if any.
export function restoreSummary({ add, skipped, keptNewer = 0, invalid }) {
  const plays = n => `${n} play${n === 1 ? '' : 's'}`;
  return [
    `Added ${plays(add.length)}`,
    skipped && `${skipped} skipped (already here)`,
    keptNewer && `${keptNewer} kept newer (the copy here is newer)`,
    invalid && `${plays(invalid)} couldn't be read`,
  ].filter(Boolean).join(', ');
}
