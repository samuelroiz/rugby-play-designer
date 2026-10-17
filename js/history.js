// Undo/redo by snapshots of the whole play. The app calls commit() after every real edit; if the play's
// JSON differs from the last snapshot, that snapshot goes on the undo stack. The editor doesn't
// commit while a drag is in progress, so a whole drag is one step.

const MAX_STEPS = 200;
// Snapshots are kept to about this many bytes in all (undo and redo together); the oldest go first.
const MAX_BYTES = 20e6;
const COALESCE_MS = 1500; // typing in the same box within this time is one step

// JS strings are UTF-16: two bytes a character.
const bytes = snap => snap.play.length * 2;

// read() -> { play: JSON string, phase: index being shown }; write(playJson, phase) restores one.
export function createHistory({ read, write, maxSteps = MAX_STEPS, maxBytes = MAX_BYTES }) {
  let current = read();
  let lastKey = null;
  let lastTime = 0;
  const undoStack = [];
  const redoStack = [];
  let size = 0; // bytes held in both stacks

  const push = (stack, snap) => { stack.push(snap); size += bytes(snap); };
  const pop = stack => { const snap = stack.pop(); size -= bytes(snap); return snap; };
  function trim() {
    while (undoStack.length > maxSteps) size -= bytes(undoStack.shift());
    while (size > maxBytes && undoStack.length) size -= bytes(undoStack.shift());
  }

  return {
    // `key` groups bursts of typing in one field (e.g. 'name') into a single step.
    commit(key = null) {
      const next = read();
      if (next.play === current.play) return false;
      const now = performance.now();
      if (!(key && key === lastKey && now - lastTime < COALESCE_MS)) push(undoStack, current);
      while (redoStack.length) pop(redoStack);
      trim();
      current = next;
      lastKey = key;
      lastTime = now;
      return true;
    },
    // Undo shows the phase the undone change was made in; redo the phase it was redone in.
    undo() {
      if (!undoStack.length) return false;
      const undone = current;
      push(redoStack, undone);
      current = pop(undoStack);
      write(current.play, undone.phase);
      lastKey = null;
      return true;
    },
    redo() {
      if (!redoStack.length) return false;
      push(undoStack, current);
      current = pop(redoStack);
      write(current.play, current.phase);
      lastKey = null;
      return true;
    },
    // Rewrites every snapshot (and the current one) with fn(playJson) -> playJson, for a change that isn't an
    // edit but must hold whatever is undone, such as turning the pitch. No step is added and redo is kept.
    rebase(fn) {
      for (const snap of [current, ...undoStack, ...redoStack]) {
        size -= snap === current ? 0 : bytes(snap);
        snap.play = fn(snap.play);
        size += snap === current ? 0 : bytes(snap);
      }
      trim();
    },
    // Forget all history and take the play as it is now as the starting point (after restoring an autosave).
    reset() {
      current = read();
      undoStack.length = 0;
      redoStack.length = 0;
      size = 0;
      lastKey = null;
    },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    get steps() { return undoStack.length; },
    get bytes() { return size; },
  };
}
