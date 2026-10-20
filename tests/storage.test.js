// Loading damaged or hand-edited plays: every optional field of the wrong type is dropped or given its
// default, so nothing broken reaches the app. Run with: node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlay, parseAutosave } from '../js/storage.js';

// A small valid play; `edit` changes it before it is parsed.
function play(edit = () => {}) {
  const p = {
    schemaVersion: 1, name: 'Test', category: 'attack', tags: ['backs'], view: 'full', orientation: 'horizontal',
    players: [{ id: 'a1', team: 'attack', label: '1' }, { id: 'a2', team: 'attack', label: '2' }, { id: 'd1', team: 'defense', label: '1' }],
    phases: [{
      note: 'n',
      positions: { a1: { x: 40, y: 10 }, a2: { x: 40, y: 20 }, d1: { x: 60, y: 10 } },
      objects: [
        { id: 'o1', type: 'ball', x: 41, y: 11 },
        { id: 'o2', type: 'scrum', x: 50, y: 35, putIn: 'attack', pack: ['a1', 'd1'] },
        { id: 'o3', type: 'lineout', x: 40, y: 5, throwIn: 'defense', pack: ['a2'] },
      ],
      routes: [
        { id: 'r1', type: 'pass', from: 'a1', to: 'a2', points: [[40, 10], [40, 20]], curve: 1, order: 1, option: 'A', optionLabel: 'if 13 bites' },
        { id: 'r2', type: 'kick', from: 'a1', points: [[40, 10], [70, 30]], curve: 0, order: 1, option: 'B' },
        { id: 'r3', type: 'run', from: 'a2', points: [[40, 20], [45, 25]], curve: 0, order: 2 },
      ],
    }],
  };
  edit(p);
  return parsePlay(JSON.parse(JSON.stringify(p)));
}
const route = (p, id) => p.phases[0].routes.find(r => r.id === id);
const object = (p, id) => p.phases[0].objects.find(o => o.id === id);
const WRONG = [null, true, 7, -1, 1.5, NaN, Infinity, 'x', '', [], {}, ['a'], { x: 1 }];

test('a valid play keeps every field', () => {
  const p = play();
  assert.deepEqual(route(p, 'r1'), { id: 'r1', type: 'pass', from: 'a1', points: [[40, 10], [40, 20]], curve: 1, to: 'a2', order: 1, option: 'A', optionLabel: 'if 13 bites' });
  assert.deepEqual(object(p, 'o2'), { id: 'o2', type: 'scrum', x: 50, y: 35, pack: ['a1', 'd1'], putIn: 'attack' });
  assert.deepEqual(object(p, 'o3'), { id: 'o3', type: 'lineout', x: 40, y: 5, pack: ['a2'], throwIn: 'defense' });
  assert.deepEqual(p.tags, ['backs']);
  assert.equal(p.name, 'Test');
});

test('option: only a single capital letter, else null', () => {
  for (const v of WRONG) {
    const r = route(play(p => { p.phases[0].routes[0].option = v; }), 'r1');
    assert.equal(r.option, null, JSON.stringify(v));
    assert.equal('optionLabel' in r, false, 'no label without an option');
  }
  assert.equal(route(play(p => { p.phases[0].routes[0].option = 'AB'; }), 'r1').option, null);
  assert.equal(route(play(p => { p.phases[0].routes[2].option = 'B'; }), 'r3').option, null, 'a run is never an option');
  assert.equal(route(play(p => { delete p.phases[0].routes[2].option; }), 'r3').option, undefined, 'older plays without option stay so');
});

test('optionLabel: a string cut to 25 characters, else dropped', () => {
  for (const v of WRONG.filter(v => typeof v !== 'string')) assert.equal('optionLabel' in route(play(p => { p.phases[0].routes[0].optionLabel = v; }), 'r1'), false, JSON.stringify(v));
  assert.equal(route(play(p => { p.phases[0].routes[0].optionLabel = 'x'.repeat(80); }), 'r1').optionLabel.length, 25);
});

test('order: a positive whole number, else dropped', () => {
  for (const v of [...WRONG.filter(v => v !== 7), 0, -3, 2.5, '2']) assert.equal('order' in route(play(p => { p.phases[0].routes[2].order = v; }), 'r3'), false, JSON.stringify(v));
  assert.equal(route(play(p => { p.phases[0].routes[2].order = 12; }), 'r3').order, 12);
});

test('curve: a finite number, else 0', () => {
  for (const v of [null, true, 'x', '3', [], {}, NaN, Infinity]) assert.equal(route(play(p => { p.phases[0].routes[0].curve = v; }), 'r1').curve, 0, JSON.stringify(v));
});

test('pack: a list of players in the play, each once; anything else makes a plain marker', () => {
  for (const v of [null, true, 7, 'a1', {}]) assert.equal('pack' in object(play(p => { p.phases[0].objects[1].pack = v; }), 'o2'), false, JSON.stringify(v));
  assert.deepEqual(object(play(p => { p.phases[0].objects[1].pack = ['a1', 'a9', 3, null, 'a1', { id: 'd1' }, 'd1']; }), 'o2').pack, ['a1', 'd1']);
});

test('putIn and throwIn: attack or defense, else dropped', () => {
  for (const v of [...WRONG, 'Attack']) {
    const p = play(q => { q.phases[0].objects[1].putIn = v; q.phases[0].objects[2].throwIn = v; });
    assert.equal('putIn' in object(p, 'o2'), false, JSON.stringify(v));
    assert.equal('throwIn' in object(p, 'o3'), false, JSON.stringify(v));
  }
});

test('tags: strings only; a comma string is split; anything else is no tags', () => {
  assert.deepEqual(play(p => { p.tags = ['a', 3, null, { t: 1 }, ' b ', '', ['c']]; }).tags, ['a', 'b']);
  assert.deepEqual(play(p => { p.tags = 'x, y'; }).tags, ['x', 'y']);
  for (const v of [null, 7, true, {}]) assert.deepEqual(play(p => { p.tags = v; }).tags, [], JSON.stringify(v));
});

test('name: a string cut to 60 characters, else "Untitled play"; note: a string, else empty', () => {
  assert.equal(play(p => { p.name = 'n'.repeat(200); }).name.length, 60);
  for (const v of [null, 7, [], {}, true]) {
    const p = play(q => { q.name = v; q.phases[0].note = v; });
    assert.equal(p.name, 'Untitled play', JSON.stringify(v));
    assert.equal(p.phases[0].note, '', JSON.stringify(v));
  }
});

test('player labels: text or a number, at most 3 characters, else from the id', () => {
  const p = play(q => { q.players[0].label = { a: 1 }; q.players[1].label = 12; q.players[2].label = 'ABCDEF'; });
  assert.deepEqual(p.players.map(x => x.label), ['1', '12', 'ABC']);
});

test('positions for players not in the play are dropped; broken or missing ones are filled in', () => {
  const p = play(q => {
    q.phases[0].positions.a9 = { x: 1, y: 1 };
    q.phases[0].positions.a2 = { x: 'x', y: 2 };
    delete q.phases[0].positions.d1;
    q.phases.push({ note: '', positions: { a1: { x: 50, y: 10 }, a2: null, d1: [] }, objects: [], routes: [] });
  });
  assert.deepEqual(Object.keys(p.phases[0].positions).sort(), ['a1', 'a2', 'd1']);
  assert.ok(p.phases.every(ph => ['a1', 'a2', 'd1'].every(id => Number.isFinite(ph.positions[id].x))));
  assert.deepEqual(p.phases[1].positions.a2, p.phases[0].positions.a2, 'copied from the nearest phase that has it');
});

test('from and to that name nobody become loose ends; unknown fields are dropped', () => {
  const p = play(q => { Object.assign(q.phases[0].routes[0], { from: 'a9', to: 7, extra: { big: true } }); q.phases[0].extra = 1; });
  const r = route(p, 'r1');
  assert.equal(r.from, null);
  assert.equal(r.to, null);
  assert.equal('extra' in r, false);
  assert.equal('extra' in p.phases[0], false);
});

test('what can\'t be repaired is a friendly error, never a crash', () => {
  const bad = [null, 7, 'x', [], {}, { schemaVersion: 1 }, { schemaVersion: 1, players: [], phases: [] },
    { schemaVersion: 1, players: [{ id: 3 }], phases: [{}] }, { schemaVersion: 1, players: [], phases: [7] },
    { schemaVersion: 1, players: [], phases: [{ routes: [{ id: 'r1', type: 'run', points: [[1, 2]] }] }] },
    { schemaVersion: 1, players: [], phases: [{ objects: [{ id: 'o1', type: 'ball', x: 'a', y: 1 }] }] }];
  for (const b of bad) assert.throws(() => parsePlay(b), err => err instanceof Error && /rugby play/.test(err.message), JSON.stringify(b));
});

test('an autosave that isn\'t JSON or has no play throws (the app keeps it as a backup)', () => {
  for (const raw of ['{not json', 'null', '{"phase":0}', '{"play":{"schemaVersion":1}}']) assert.throws(() => parseAutosave(raw), raw);
  assert.equal(parseAutosave(JSON.stringify({ play: play(), phase: 'x' })).phase, 0);
});

test('instructions: kept per player and phase, checked like the rest', () => {
  const p = play(q => {
    q.phases[0].instructions = { a1: '  Flat, call for it early.  ', a2: '', d1: 7, zz: 'nobody', a9: 'gone' };
  });
  assert.deepEqual(p.phases[0].instructions, { a1: 'Flat, call for it early.' });
  const long = play(q => { q.phases[0].instructions = { a1: 'x'.repeat(300) }; });
  assert.equal(long.phases[0].instructions.a1.length, 120);
  for (const bad of [null, 'text', ['a1'], { a2: ' ' }]) {
    assert.ok(!('instructions' in play(q => { q.phases[0].instructions = bad; }).phases[0]), JSON.stringify(bad));
  }
});

test('instructions: old plays load without them, and a play with them saves and loads the same', () => {
  assert.ok(!('instructions' in play().phases[0]));
  const p = play(q => { q.phases[0].instructions = { a2: 'Hit the line hard.' }; });
  assert.deepEqual(parsePlay(JSON.parse(JSON.stringify(p))), p);
});
