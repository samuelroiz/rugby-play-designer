// The play library's backup file and restoring from it (library.js): never overwriting, "(restored)" copies,
// skipped duplicates and invalid plays. Run with: node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import { backupData, backupFileName, restoreRecords, restoreSummary, newRecord } from '../js/library.js';
import { blankPlay, parsePlay } from '../js/storage.js';

const play = name => parsePlay({ ...blankPlay(), name, players: [{ id: 'a1', team: 'attack', label: '1' }], phases: [{ note: '', positions: { a1: { x: 40, y: 30 } }, objects: [], routes: [] }] });
const rec = (id, name, extra = {}) => ({ ...newRecord(play(name)), id, ...extra });

test('backup: every play, recently deleted ones marked, in a dated file', () => {
  const data = backupData([rec('p1', 'One'), rec('p2', 'Two', { deletedAt: 5 })], new Date(2026, 9, 18, 12));
  assert.equal(backupFileName(new Date(2026, 0, 5)), 'rugby-plays-backup-2026-01-05.json');
  assert.equal(data.plays.length, 2);
  assert.deepEqual(data.plays.map(p => [p.id, p.deleted]), [['p1', false], ['p2', true]]);
  assert.equal(data.plays[0].play.name, 'One');
});

test('restore into an empty library adds everything, keeping ids, times and deleted marks', () => {
  const records = [rec('p1', 'One', { created: 10, updated: 20 }), rec('p2', 'Two', { deletedAt: 30 })];
  const result = restoreRecords(JSON.parse(JSON.stringify(backupData(records))), []);
  assert.deepEqual(result.add.map(r => [r.id, r.play.name, r.deletedAt]), [['p1', 'One', null], ['p2', 'Two', 30]]);
  assert.deepEqual([result.add[0].created, result.add[0].updated], [10, 20]);
  assert.equal(restoreSummary(result), 'Added 2 plays');
});

test('restore never overwrites: the same play is skipped, a changed one comes back as a "(restored)" copy', () => {
  const here = [rec('p1', 'One'), rec('p2', 'Two')];
  const backup = JSON.parse(JSON.stringify(backupData([here[0], { ...here[1], play: play('Two, older') }, rec('p3', 'Three')])));
  const result = restoreRecords(backup, here);
  assert.equal(result.skipped, 1);
  assert.equal(result.add.length, 2);
  const copy = result.add.find(r => r.play.name === 'Two, older (restored)');
  assert.ok(copy && copy.id !== 'p2', 'a new id');
  assert.ok(result.add.some(r => r.id === 'p3' && r.play.name === 'Three'));
  assert.equal(restoreSummary(result), 'Added 2 plays, 1 skipped (already here)');
});

test('restore: an invalid play is counted and left out; a long name stays within 60 characters', () => {
  const long = 'x'.repeat(60);
  const backup = {
    plays: [
      { id: 'p1', play: { name: 'broken' } },
      { id: 'p9', play: play(long) },
    ],
  };
  const result = restoreRecords(backup, [rec('p9', 'Something else')]);
  assert.equal(result.invalid, 1);
  assert.equal(result.add.length, 1);
  assert.equal(result.add[0].play.name.length, 60);
  assert.ok(result.add[0].play.name.endsWith(' (restored)'));
  assert.equal(restoreSummary(result), "Added 1 play, 1 play couldn't be read");
});

test('a file that is not a backup is a friendly error', () => {
  assert.throws(() => restoreRecords({ schemaVersion: 1 }, []), /isn't a plays backup/);
  assert.throws(() => restoreRecords(null, []), /isn't a plays backup/);
});
