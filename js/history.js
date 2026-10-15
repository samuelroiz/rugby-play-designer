// Undo/redo by snapshots of the whole play. The app calls commit() after every redraw; if the play's
// JSON differs from the last snapshot, that snapshot goes on the undo stack. The editor doesn't
// commit while a drag is in progress, so a whole drag is one step.

const LIMIT = 200;
const COALESCE_MS = 1500; // typing in the same box within this time is one step

// read() -> { play: JSON string, phase: index being shown }; write(playJson, phase) restores one.
export function createHistory({ read, write }) {
  let current = read();
  let lastKey = null;
  let lastTime = 0;
  const undoStack = [];
  const redoStack = [];

  return {
    // `key` groups bursts of typing in one field (e.g. 'name') into a single step.
    commit(key = null) {
      const next = read();
      if (next.play === current.play) return false;
      const now = performance.now();
      if (!(key && key === lastKey && now - lastTime < COALESCE_MS)) {
        undoStack.push(current);
        if (undoStack.length > LIMIT) undoStack.shift();
      }
      redoStack.length = 0;
      current = next;
      lastKey = key;
      lastTime = now;
      return true;
    },
    // Undo shows the phase the undone change was made in; redo the phase it was redone in.
    undo() {
      if (!undoStack.length) return false;
      const undone = current;
      redoStack.push(undone);
      current = undoStack.pop();
      write(current.play, undone.phase);
      lastKey = null;
      return true;
    },
    redo() {
      if (!redoStack.length) return false;
      undoStack.push(current);
      current = redoStack.pop();
      write(current.play, current.phase);
      lastKey = null;
      return true;
    },
    // Forget all history and take the play as it is now as the starting point (after restoring an autosave).
    reset() {
      current = read();
      undoStack.length = 0;
      redoStack.length = 0;
      lastKey = null;
    },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
  };
}
