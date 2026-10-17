// Pass and kick options. When a player has two or more passes and/or kicks in one phase, they are
// alternatives, not a sequence: each gets a letter (route.option "A", "B", "C" …) and they share one
// order number. "A" is the main plan, the one the next phase is built from. A lone pass or kick has
// option null. route.optionLabel is an optional short note for an option, e.g. "if 13 bites".

import { BALL_ROUTES, isOtherOption } from './model.js';

export const OPTION_TYPES = BALL_ROUTES;
export const OPTION_LABEL_MAX = 25;
export { isOtherOption };

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const letterIndex = r => (r.option ? LETTERS.indexOf(r.option) : Infinity);

// The passes and kicks from player `from` in a phase's routes, A first, then routes without a letter
// in drawing order (so a newly drawn one comes last).
export function optionGroup(routes, from) {
  if (!from) return [];
  return routes
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.from === from && OPTION_TYPES.has(r.type))
    .sort((a, b) => letterIndex(a.r) - letterIndex(b.r) || a.i - b.i)
    .map(({ r }) => r);
}

// Re-letters the option groups of the given players: two or more passes/kicks become A, B, C … in their
// current order (gaps closed up), all with the order number of the first; a single one has its letter
// cleared. Players not listed are left alone, so plays from before options load unchanged.
export function syncOptions(routes, fromIds) {
  for (const from of new Set(fromIds)) {
    const group = optionGroup(routes, from);
    if (group.length < 2) {
      if (group[0]?.option) group[0].option = null;
      continue;
    }
    const order = group[0].order;
    group.forEach((r, i) => {
      r.option = LETTERS[i] ?? null;
      if (Number.isFinite(order)) r.order = order;
    });
  }
}

// Makes `route` option A and re-letters the others in their old order after it.
export function makeMainOption(routes, route) {
  const group = optionGroup(routes, route.from);
  if (group.length < 2 || !group.includes(route)) return;
  const rest = group.filter(r => r !== route);
  [route, ...rest].forEach((r, i) => { r.option = LETTERS[i]; });
}

// The option letters used in a phase, in order: [] when nobody has options, else e.g. ['A', 'B'].
export function optionLetters(routes) {
  return [...new Set(routes.filter(r => r.option && OPTION_TYPES.has(r.type)).map(r => r.option))].sort();
}
