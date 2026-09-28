// tests/section-id.test.ts — GRND-09 / D-18-16: section ids are a number with
// an optional letter (§1a), ordered (n, suffix), with `NN[a]-slug` folders that
// are found by slug and never renamed.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  compareSectionIds,
  formatSectionId,
  parseSectionId,
  sectionFolderName,
  sortBySectionId,
} from '../bin/lib/section-id.js';
import {
  findSectionFolder,
  newSectionFolder,
  parseSectionDirName,
  sectionArchiveDir,
  sectionDraft,
  sectionPlan,
  SECTION_ARCHIVE_DIRNAME,
} from '../bin/lib/paths.js';

test('GRND-09: parseSectionId accepts 1..99 with an optional lowercase letter and nothing else', () => {
  assert.deepEqual(parseSectionId('1'), { n: 1 });
  assert.deepEqual(parseSectionId('12'), { n: 12 });
  assert.deepEqual(parseSectionId('1a'), { n: 1, suffix: 'a' });
  assert.deepEqual(parseSectionId(' 3b '), { n: 3, suffix: 'b' });
  assert.deepEqual(parseSectionId(7), { n: 7 });
  for (const bad of ['0', '100', '1A', '1ab', 'a1', '', '1.5', '-1', 'abc', '1-a', null, undefined, 1.5]) {
    assert.equal(parseSectionId(bad), null, `refused: ${JSON.stringify(bad)}`);
  }
});

test('GRND-09: ids format back and order (n, suffix): 1 < 1a < 1b < 2 < 10', () => {
  const ids = ['10', '2', '1b', '1', '1a'].map((s) => parseSectionId(s)!);
  assert.deepEqual(sortBySectionId(ids).map(formatSectionId), ['1', '1a', '1b', '2', '10']);
  assert.ok(compareSectionIds({ n: 1, suffix: 'a' }, { n: 2 }) < 0);
  assert.equal(compareSectionIds({ n: 3 }, { n: 3 }), 0);
});

test('GRND-09: folder names are NN[a]-slug and parse back', () => {
  assert.equal(sectionFolderName({ n: 1 }, 'introduction'), '01-introduction');
  assert.equal(sectionFolderName({ n: 1, suffix: 'a' }, 'background'), '01a-background');
  assert.deepEqual(parseSectionDirName('01a-background'), { n: 1, letterSuffix: 'a', slug: 'background' });
  assert.equal(parseSectionDirName(SECTION_ARCHIVE_DIRNAME), null, 'the archive folder is never a section');
  assert.throws(() => sectionFolderName({ n: 0 }, 'x'), /1 to 99/);
  assert.throws(() => sectionFolderName({ n: 1, suffix: 'A' }, 'x'), /one lowercase letter/);
});

test('GRND-09: a section folder is found by its slug, so (n, slug) callers reach a lettered folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-sid-'));
  try {
    const lettered = newSectionFolder(1, 'background', root, 'a');
    fs.mkdirSync(lettered, { recursive: true });
    assert.equal(path.basename(lettered), '01a-background');
    assert.equal(findSectionFolder('background', root), lettered);
    assert.equal(path.dirname(sectionPlan(1, 'background', root)), lettered, 'sectionPlan(1, slug) finds 01a-');
    assert.equal(path.dirname(sectionDraft(1, 'background', root)), lettered);
    // A folder not created yet falls back to NN-slug.
    assert.equal(path.basename(path.dirname(sectionPlan(4, 'results', root))), '04-results');
    assert.equal(findSectionFolder('results', root), null);
    // The archive is under sections/ but never matches a slug.
    fs.mkdirSync(path.join(sectionArchiveDir(root), '02-background'), { recursive: true });
    assert.equal(findSectionFolder('background', root), lettered);
    assert.throws(() => findSectionFolder('../x', root), /Invalid slug/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
