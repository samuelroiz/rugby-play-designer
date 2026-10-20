// "Our team" (model.js): the side a play is drawn up for, and the player lists put it first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ourTeam, positionName, playersOurFirst, teamPlayers } from '../js/model.js';
import { animPlay } from './anim-play.mjs';

test('our team: the defense for a defense play, else the attack', () => {
  for (const [category, team] of [['defense', 'defense'], ['attack', 'attack'], ['lineout', 'attack'], ['scrum', 'attack'], [undefined, 'attack']]) {
    assert.equal(ourTeam({ category }), team, String(category));
  }
});

test('players are named with their team, and listed by number with our team first', () => {
  const p = animPlay();
  assert.equal(positionName(p.players.find(x => x.id === 'd10')), 'Defense 10');
  assert.deepEqual(teamPlayers(p, 'defense').map(x => x.id), ['d10', 'd12']);
  assert.deepEqual(playersOurFirst(p).map(x => x.id), ['a10', 'a12', 'a13', 'd10', 'd12']);
  assert.deepEqual(playersOurFirst({ ...p, category: 'defense' }).map(x => x.id), ['d10', 'd12', 'a10', 'a12', 'a13']);
});
