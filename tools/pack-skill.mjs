// `npm run pack-skill`: zips skills/rugby-play-writer/ into skills/rugby-play-writer.zip, the file the app's
// "Claude skill" links download (Claude's Skills settings take a .zip with the skill's folder inside). The zip
// leaves out CLAUDE.md (notes for working on the skill in this repo) and always holds the blank
// references/our-team.md from tools/skill-our-team.md, so a copy filled in with a real squad never ships. It
// is committed like the stamped pages: files are stored uncompressed, in name order, with a fixed date, so the
// same folder always gives the same bytes, and tests/skill.test.js fails if the zip doesn't match the folder.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SKILL = 'rugby-play-writer';
export const ZIP = `skills/${SKILL}.zip`;
// Left out of the zip, and the files whose zipped content comes from elsewhere instead of the folder.
const LEFT_OUT = new Set([`${SKILL}/CLAUDE.md`]);
export const TEAM = `${SKILL}/references/our-team.md`;
export const TEAM_TEMPLATE = 'tools/skill-our-team.md';
const SOURCES = { [TEAM]: TEAM_TEMPLATE };

// Where a zipped file's bytes come from, relative to the repo.
export const sourceOf = name => SOURCES[name] ?? `skills/${name}`;

// Every file of the zip, as paths inside it (rugby-play-writer/SKILL.md, …), sorted.
export function skillFiles() {
  const out = [];
  const walk = dir => {
    for (const e of fs.readdirSync(path.join(ROOT, 'skills', dir), { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (!LEFT_OUT.has(rel)) out.push(rel);
    }
  };
  walk(SKILL);
  return out.sort();
}

// 1 Jan 2026, 00:00 in DOS time and date.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export function packSkill() {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const name of skillFiles()) {
    const data = fs.readFileSync(path.join(ROOT, sourceOf(name)));
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);          // version needed
    local.writeUInt16LE(0x0800, 6);      // UTF-8 names
    local.writeUInt16LE(0, 8);           // stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);    // made by Unix, 3.0
    local.copy(central, 6, 4, 26);       // version needed … sizes
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const zip = packSkill();
  fs.writeFileSync(path.join(ROOT, ZIP), zip);
  console.log(`${ZIP}: ${skillFiles().length} files, ${zip.length} bytes`);
}
