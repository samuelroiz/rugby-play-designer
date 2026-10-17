// Building the next phase from the current one: players finish their runs, the ball follows the last pass
// (or kick). Only option A of a player's pass/kick options counts. Also adding, inserting and moving
// phases. None of these change the contents of any existing phase. Which ball moves and who catches it are
// decided by the rules in model.js, which the animation uses too, so the two always agree.

import { nextId, round1, ballFlights, positionsAfter, movingBall, receiverOf, BALL_OFFSET } from './model.js';

// "+": a new phase at the end, built from the last one. Returns its index.
export function appendPhase(phases, players) {
  phases.push(nextPhase(phases[phases.length - 1], players));
  return phases.length - 1;
}

// "Insert after": a new phase straight after phase i, built from it. Later phases only shift along.
export function insertPhaseAfter(phases, i, players) {
  phases.splice(i + 1, 0, nextPhase(phases[i], players));
  return i + 1;
}

// Swaps phase i with its neighbour j. Returns the new index of phase i, or i if j is off the end.
export function movePhase(phases, i, j) {
  if (j < 0 || j >= phases.length) return i;
  [phases[i], phases[j]] = [phases[j], phases[i]];
  return j;
}

export function nextPhase(phase, players) {
  const objects = structuredClone(phase.objects);
  // Each player ends where their last moving route (in play order) ends.
  const positions = structuredClone(positionsAfter(phase.routes, phase.positions));

  // The ball (the one nearest the first pass or kick) follows the passes and kicks, options other than A
  // left out, and ends with the last one: in the receiver's hands, where they stand at the end, or where it lands.
  const flights = ballFlights(phase.routes);
  const last = flights.at(-1);
  if (last) {
    const catcher = receiverOf(last, players, positionsAfter(phase.routes, phase.positions, last.order ?? 0));
    const end = last.points[last.points.length - 1];
    const at = catcher ? [positions[catcher].x + BALL_OFFSET.x, positions[catcher].y + BALL_OFFSET.y] : end;
    let ball = movingBall(objects, flights[0]);
    if (!ball) {
      ball = { id: nextId('o', objects), type: 'ball' };
      objects.push(ball);
    }
    ball.x = round1(at[0]);
    ball.y = round1(at[1]);
  }
  return { note: '', positions, objects, routes: [] };
}
