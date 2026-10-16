// Every template listed in templates/index.json is a valid play file. Run with: node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parsePlay } from '../js/storage.js';

const dir = new URL('../templates/', import.meta.url);
const index = JSON.parse(fs.readFileSync(new URL('index.json', dir)));

test('index.json lists names and files that exist', () => {
  assert.ok(Array.isArray(index) && index.length > 0);
  for (const t of index) {
    assert.equal(typeof t.name, 'string');
    assert.ok(fs.existsSync(new URL(t.file, dir)), t.file);
  }
});

for (const t of index) {
  test(`${t.name}: loads like a saved play, players numbered 1-15 per team`, () => {
    const play = parsePlay(JSON.parse(fs.readFileSync(new URL(t.file, dir))));
    const ids = play.players.map(p => p.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const p of play.players) {
      assert.equal(p.id, (p.team === 'attack' ? 'a' : 'd') + p.label);
      assert.ok(Number(p.label) >= 1 && Number(p.label) <= 15);
      for (const ph of play.phases) assert.ok(ph.positions[p.id], `${p.id} has a position`);
    }
  });
}
