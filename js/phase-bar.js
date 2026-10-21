// The phase bar under the pitch: the phase tabs, Prev and Next, and adding, inserting, moving and deleting
// phases. Moving between phases also works while playing (it carries on from that phase).

import { appendPhase, insertPhaseAfter, movePhase } from './phases.js';
import { askConfirm } from './dialogs.js';

// step(delta) moves back or forward a phase, as the arrow keys do. note: the phase note's box, greyed out
// with the bar while a picture is being made.
export function createPhaseBar({ state, ui, busy, render, playback, step, note }) {
  const $ = id => document.getElementById(id);

  let shownPhase = -1;

  function updatePhaseBar() {
    const n = state.phases.length;
    const tabs = $('phase-tabs');
    if (tabs.children.length !== n) {
      tabs.replaceChildren(...state.phases.map((_, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.phase = 'goto';
        b.dataset.index = i;
        b.textContent = i + 1;
        b.setAttribute('aria-label', `Phase ${i + 1}`);
        return b;
      }));
    }
    [...tabs.children].forEach((b, i) => b.setAttribute('aria-current', i === ui.phase ? 'step' : 'false'));
    if (shownPhase !== ui.phase) {
      shownPhase = ui.phase;
      tabs.children[ui.phase]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    $('phase-count').textContent = `Phase ${ui.phase + 1} of ${n}`;
    const btn = name => document.querySelector(`[data-phase="${name}"]`);
    btn('prev').disabled = ui.phase === 0;
    btn('next').disabled = ui.phase === n - 1;
    btn('left').disabled = ui.phase === 0;
    btn('right').disabled = ui.phase === n - 1;
    btn('delete').disabled = n === 1;
    btn('add').disabled = false;
    btn('insert').disabled = false;
    // While playing (or exporting) only moving between phases works; the phases can't be changed.
    if (busy()) for (const name of ['add', 'left', 'right', 'insert', 'delete']) btn(name).disabled = true;
    // While playing the note can still be typed in: focusing it stops the play (see initTopbar).
    note.disabled = ui.exporting;
  }

  function goToPhase(i) {
    if (i < 0 || i >= state.phases.length || i === ui.phase) return;
    ui.phase = i;
    ui.tool = null;
  }

  // Phase bar actions. Each returns after changing state; the caller re-renders, which records one undo step.
  function phaseAction(action, index) {
    const i = ui.phase;
    const phases = state.phases;
    if (action === 'prev') goToPhase(i - 1);
    else if (action === 'next') goToPhase(i + 1);
    else if (action === 'goto') goToPhase(index);
    else if (action === 'add' || action === 'insert') {
      ui.phase = action === 'add' ? appendPhase(phases, state.players) : insertPhaseAfter(phases, i, state.players);
      ui.tool = null;
    } else if (action === 'left' || action === 'right') {
      ui.phase = movePhase(phases, i, action === 'left' ? i - 1 : i + 1);
    } else if (action === 'delete') {
      if (phases.length === 1) return;
      askConfirm(`Delete phase ${i + 1}? You can undo this.`, 'Delete phase').then(ok => {
        if (!ok || state.phases !== phases) return;
        phases.splice(i, 1);
        ui.phase = Math.min(i, phases.length - 1);
        render();
      });
    }
  }

  function initPhaseBar() {
    document.querySelector('.phasebar').addEventListener('click', e => {
      const b = e.target.closest('[data-phase]');
      // Nothing changes phase in the middle of a drag (a second finger, or a key).
      if (!b || b.disabled || ui.dragging) return;
      const action = b.dataset.phase;
      // Moving between phases also works while playing (it carries on from that phase).
      if (action === 'prev' || action === 'next') { step(action === 'prev' ? -1 : 1); return; }
      if (action === 'goto') { playback.jump(Number(b.dataset.index)); return; }
      if (busy()) return;
      phaseAction(action, Number(b.dataset.index));
      render();
    });
  }

  return { updatePhaseBar, initPhaseBar };
}
