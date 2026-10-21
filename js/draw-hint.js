// The hint in the status line under the pitch while something is being drawn or placed: "Click where 12
// stands", "Drag from a player to draw a run …", "Click where 12's run ends …". It's never cut off (fitHint).

import { ROUTE_TYPES } from './pitch.js';
import { drawingFrom, continuation } from './editor.js';

// playerName(id) names a player in the hint ("12", or "defender 12"). A new hint hides a message in the status
// line, unless showToast.keepWhile() says it still applies.
export function createDrawHint({ state, ui, phase, playerName, touchScreen, showToast }) {
  const $ = id => document.getElementById(id);

  // Shown while a player or set piece waits to be placed ("Click where 12 stands", "Click where the mark
  // goes"), and whenever a route tool is on: how to draw with nothing selected, and "Click where 12's run ends"
  // while click-to-draw from a player is on.
  function updateDrawHint() {
    const hint = $('draw-hint');
    const wasHidden = hint.hidden;
    hint.hidden = !ui.tool && !ui.placing;
    if (hint.hidden) return;
    const touch = touchScreen.matches;
    const verb = touch ? 'Tap' : 'Click';
    const type = ROUTE_TYPES[ui.tool]?.label.toLowerCase() ?? 'route';
    const from = drawingFrom(ui, phase());
    // "Continues 8's run": a new run (decoy, drift, blitz) from a player who has one carries on from its end.
    const continues = id => {
      const prev = continuation(phase(), ui.tool, id);
      return prev ? `Continues ${playerName(id)}'s ${ROUTE_TYPES[prev.type].label.toLowerCase()}` : null;
    };
    // Each hint has a shorter form, used when even two lines can't hold the full one (see fitHint).
    let text;
    let short;
    if (ui.placing?.kind === 'player') {
      const { team, n } = ui.placing;
      // "12", or "defender 12" when the other team has a 12.
      const shared = state.players.some(p => p.team !== team && p.label === String(n));
      const who = shared ? `${team === 'attack' ? 'attacker' : 'defender'} ${n}` : n;
      short = `${verb} where ${who} stands.`;
      text = `${short}${touch ? '' : ' Esc puts them at the usual spot.'}`;
    } else if (ui.placing) {
      short = `${verb} where the mark goes.`;
      text = `${short}${touch ? '' : ' Esc cancels.'}`;
    } else if (!from) {
      const snapped = ui.snap && continues(ui.snap);
      text = snapped ? `${snapped}: drag to where it ends.` : `Drag from a player to draw a ${type}, or ${verb.toLowerCase()} a player first.`;
      short = snapped ? `${snapped}: drag to its end.` : `Drag from a player, or ${verb.toLowerCase()} one first.`;
    } else {
      const who = playerName(from);
      const stop = `${verb} again for another, ${touch ? 'tap the tool again' : 'Esc'} to stop.`;
      const more = continues(from);
      if (more) {
        short = `${more}: ${verb.toLowerCase()} where it ends.`;
      } else {
        short = `${verb} where ${ui.tool === 'pass' ? `${who}'s pass ends, or on a team-mate` : `${who}'s ${type} ends`}.`;
      }
      text = `${short} ${stop}`;
    }
    // A new hint is what the user needs now, so it replaces an older "Saved …" message in the status line.
    if (hint.dataset.text !== text || hint.dataset.short !== short || wasHidden) {
      Object.assign(hint.dataset, { text, short });
      if (!showToast.keepWhile?.()) { showToast.keepWhile = null; $('toast').hidden = true; }
    }
    fitHint();
  }

  // The hint is never cut off: on one line if it fits, else on two in smaller type (the status line keeps its
  // height), else its shorter form. The full text is its tooltip.
  let hintFit = '';
  function fitHint() {
    const hint = $('draw-hint');
    if (hint.hidden) return;
    const { text, short } = hint.dataset;
    const key = [text, short, hint.parentElement.clientWidth, ui.layers.legend].join('|');
    if (key === hintFit && hint.textContent) return;
    hintFit = key;
    hint.title = text;
    // Hidden behind a message in the status line: it's fitted when the message goes.
    if (!hint.offsetWidth) {
      hint.textContent = text;
      hintFit = '';
      return;
    }
    const cut = () => hint.scrollWidth > hint.clientWidth + 1 || hint.scrollHeight > hint.clientHeight + 1;
    for (const [value, wrap] of [[text, false], [text, true], [short, true]]) {
      hint.textContent = value;
      hint.classList.toggle('wrap', wrap);
      if (!cut()) return;
    }
  }

  return { updateDrawHint, fitHint };
}
