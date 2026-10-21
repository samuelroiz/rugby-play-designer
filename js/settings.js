// Settings of this browser (kept in localStorage), not of the play. When storage is blocked they last until
// the page closes.

import { PLAYER_SIZES } from './scene.js';

// Layers → Player size (scene.js PLAYER_SIZES): a setting of this browser, not of the play; pictures and PDFs
// use the size on screen.
const PLAYER_SIZE_KEY = 'rugby-play-designer.player-size';
// Layers → Step numbers: whether route order badges are shown, on screen and in every export. Also a
// setting of this browser, not of the play.
const STEP_NUMBERS_KEY = 'rugby-play-designer.step-numbers';

export function readPlayerSize() {
  try {
    const saved = localStorage.getItem(PLAYER_SIZE_KEY);
    return saved in PLAYER_SIZES ? saved : 'medium';
  } catch {
    return 'medium';
  }
}
export function readStepNumbers() {
  try { return localStorage.getItem(STEP_NUMBERS_KEY) !== 'off'; } catch { return true; }
}
export function saveStepNumbers(on) {
  try { localStorage.setItem(STEP_NUMBERS_KEY, on ? 'on' : 'off'); } catch { /* storage blocked: it lasts until the page closes */ }
}
export function savePlayerSize(size) {
  try { localStorage.setItem(PLAYER_SIZE_KEY, size); } catch { /* storage blocked: it lasts until the page closes */ }
}
