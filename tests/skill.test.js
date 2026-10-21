// The Claude skill's zip (tools/pack-skill.mjs, `npm run pack-skill`): skills/rugby-play-writer.zip holds
// the files of skills/rugby-play-writer/ under a rugby-play-writer/ folder with SKILL.md in it, without
// CLAUDE.md, and with the blank our-team.md template (never a filled-in copy). A change to the skill without
// `npm run pack-skill` fails here. Run with: node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SKILL, ZIP, TEAM, TEAM_TEMPLATE, skillFiles, sourceOf, packSkill } from '../tools/pack-skill.mjs';

test('the skill zip matches the skill folder (run `npm run pack-skill` after changing the skill)', () => {
  assert.ok(packSkill().equals(fs.readFileSync(path.join(ROOT, ZIP))), `${ZIP} is out of date`);
});

test('the zip has the skill folder with SKILL.md and its name in the front matter', () => {
  assert.ok(skillFiles().includes(`${SKILL}/SKILL.md`));
  assert.ok(skillFiles().every(f => f.startsWith(`${SKILL}/`)));
  const skill = fs.readFileSync(path.join(ROOT, 'skills', SKILL, 'SKILL.md'), 'utf8');
  assert.match(skill, new RegExp(`^---\\nname: ${SKILL}\\n`));
});

test('the zip lists every file once, stored, with the right sizes', () => {
  const zip = packSkill();
  const names = [];
  for (let at = 0; zip.readUInt32LE(at) === 0x04034b50;) {
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    const name = zip.toString('utf8', at + 30, at + 30 + nameLength);
    assert.equal(zip.readUInt16LE(at + 8), 0, name);
    assert.equal(size, fs.statSync(path.join(ROOT, sourceOf(name))).size, name);
    names.push(name);
    at += 30 + nameLength + size;
  }
  assert.deepEqual(names, skillFiles());
});

// The zip as committed, file by file.
function zipEntries() {
  const zip = fs.readFileSync(path.join(ROOT, ZIP));
  const entries = new Map();
  for (let at = 0; zip.readUInt32LE(at) === 0x04034b50;) {
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    entries.set(zip.toString('utf8', at + 30, at + 30 + nameLength), zip.toString('utf8', at + 30 + nameLength, at + 30 + nameLength + size));
    at += 30 + nameLength + size;
  }
  return entries;
}

test('the zip leaves out CLAUDE.md', () => {
  assert.ok(!zipEntries().has(`${SKILL}/CLAUDE.md`));
  assert.ok(!skillFiles().includes(`${SKILL}/CLAUDE.md`));
});

test('the zip\'s our-team.md is the blank template, every item still "..."', () => {
  const team = zipEntries().get(TEAM);
  assert.equal(team, fs.readFileSync(path.join(ROOT, TEAM_TEMPLATE), 'utf8'));
  const items = team.split('\n').filter(l => /^\s*- /.test(l));
  assert.ok(items.length > 0);
  for (const item of items) assert.match(item, /^\s*- (?:[^:]+: )?\.\.\.$/, `filled in: ${item}`);
});
