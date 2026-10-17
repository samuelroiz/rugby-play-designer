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

// A 9 to 10 pass from a set piece mustn't cross the pack: the 10 stands on the 9's side, and the line
// between them is clear of every forward in the set piece's group.
const segDist = (p, a, b) => {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
};
for (const file of ['scrum.json', 'lineout.json']) {
  test(`${file}: each 9 to 10 pass is clear of the pack`, () => {
    const play = parsePlay(JSON.parse(fs.readFileSync(new URL(file, dir))));
    const ph = play.phases[0];
    const set = ph.objects.find(o => o.pack);
    for (const t of ['a', 'd']) {
      const nine = ph.positions[`${t}9`];
      const ten = ph.positions[`${t}10`];
      if (set.type === 'scrum') assert.equal(Math.sign(ten.y - set.y), Math.sign(nine.y - set.y), `${t}10 on the 9's side of the scrum`);
      for (const id of set.pack.filter(id => id !== `${t}9` && id !== `${t}10`)) {
        assert.ok(segDist(ph.positions[id], nine, ten) > 2.4, `${t}9 to ${t}10 passes ${id}`);
      }
    }
  });
}
