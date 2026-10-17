// A small three-phase play for the animation tests (Node and browser).

// Phase 1: 10 runs and passes (option A) to 12, who runs at the same time; option B, to 13, never plays.
// Then the defense's 10 drifts. Phase 2: everyone somewhere new (12 with no route there too), 12 kicks.
export function animPlay() {
  return {
    schemaVersion: 1, name: 'Anim', category: 'attack', tags: [], view: 'full', orientation: 'horizontal',
    players: [
      { id: 'a10', team: 'attack', label: '10' }, { id: 'a12', team: 'attack', label: '12' },
      { id: 'a13', team: 'attack', label: '13' }, { id: 'd10', team: 'defense', label: '10' },
      { id: 'd12', team: 'defense', label: '12' },
    ],
    phases: [
      {
        note: 'Ten runs, then the pass',
        positions: { a10: { x: 40, y: 30 }, a12: { x: 45, y: 40 }, a13: { x: 45, y: 20 }, d10: { x: 60, y: 30 }, d12: { x: 60, y: 40 } },
        objects: [{ id: 'o1', type: 'ball', x: 41.1, y: 30.9 }, { id: 'o2', type: 'ruck', x: 35, y: 30 }],
        routes: [
          { id: 'r1', type: 'run', from: 'a10', points: [[40, 30], [44, 32]], curve: 0, order: 1, option: null },
          { id: 'r2', type: 'run', from: 'a12', points: [[45, 40], [50, 44]], curve: 1, order: 1, option: null },
          { id: 'r3', type: 'pass', from: 'a10', to: 'a12', points: [[40, 30], [45, 40]], curve: 0, order: 1, option: 'A' },
          { id: 'r4', type: 'pass', from: 'a10', to: 'a13', points: [[40, 30], [45, 20]], curve: 0, order: 1, option: 'B' },
          { id: 'r5', type: 'drift', from: 'd10', points: [[60, 30], [58, 36]], curve: 0, order: 2, option: null },
        ],
      },
      {
        note: 'Twelve kicks',
        positions: { a10: { x: 44, y: 32 }, a12: { x: 50, y: 44 }, a13: { x: 47, y: 21 }, d10: { x: 58, y: 36 }, d12: { x: 57.3, y: 41.7 } },
        objects: [{ id: 'o1', type: 'ball', x: 51.1, y: 44.9 }, { id: 'o2', type: 'ruck', x: 35, y: 30 }],
        routes: [{ id: 'r1', type: 'kick', from: 'a12', points: [[50, 44], [80, 50]], curve: 0, order: 1, option: null }],
      },
      {
        note: '',
        positions: { a10: { x: 50, y: 32 }, a12: { x: 52, y: 44 }, a13: { x: 52, y: 21 }, d10: { x: 70, y: 36 }, d12: { x: 70, y: 41 } },
        objects: [{ id: 'o1', type: 'ball', x: 80, y: 50 }],
        routes: [],
      },
    ],
  };
}
