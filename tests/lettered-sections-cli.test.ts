// tests/lettered-sections-cli.test.ts — GRND-09: an inserted section (§1a) is
// addressed and reported as itself everywhere the CLI names a section:
// `add --remap <key> --section 1a` remaps it (as `plan 1a` does), and compile's
// refusals name `section 1a`, never its neighbour §1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_OK } from '../bin/lib/exit-codes.js';
import { sandbox, runCli, writeState, writePlan, sectionDirOf } from './helpers/paper-cli-harness.js';
import { writeLibrary } from './helpers/section-fixture.js';

function letteredPaper(root: string): { intro: string; background: string } {
  writeState(root, [{ n: 1, slug: 'intro' }, { n: 1, suffix: 'a', slug: 'background' }]);
  writeFileSync(join(root, '.paper', 'OUTLINE.md'), [
    '# Outline', '',
    '| # | slug | title | depends_on | word target | assigned_sources |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 1 | intro | Intro |  | 300 |  |',
    '| 1a | background | Background | intro | 300 |  |', '',
  ].join('\n'));
  const intro = writePlan(root, 1, 'intro');
  const dir = join(root, '.paper', 'sections', '01a-background');
  mkdirSync(dir, { recursive: true });
  const background = join(dir, 'PLAN.md');
  writeFileSync(background, [
    '---', 'section: 1', 'suffix: a', 'slug: background', 'title: Background', 'depends_on: []',
    'assigned_sources: []', 'verified_against_draft_hash: null', 'status: planned', '---', '', '## Brief', '', 'Background.', '',
  ].join('\n'));
  writeLibrary(root, [{ citekey: 'castellan2023', title: 'A Study', author: 'Castellan, Ana', year: 2023 }]);
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '@article{castellan2023,\n  title = {A Study},\n  author = {Castellan, Ana},\n  year = {2023},\n  doi = {10.5555/fixture.castellan2023}\n}\n');
  return { intro, background };
}

test('GRND-09: `add --remap <key> --section 1a` remaps the lettered section, not §1', () => {
  const sb = sandbox('lettered-remap');
  const root = sb.project('p');
  const { intro, background } = letteredPaper(root);
  const introBefore = readFileSync(intro, 'utf8');
  const r = runCli(sb, root, ['add', '--remap', 'castellan2023', '--section', '1a']);
  assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /remapped 1 section\(s\)/);
  assert.match(readFileSync(background, 'utf8'), /^ {2}- castellan2023$/m, '§1a gains the source');
  assert.equal(readFileSync(intro, 'utf8'), introBefore, '§1 is untouched');
  // An unknown lettered section is still a usage error naming the argument.
  const bad = runCli(sb, root, ['add', '--remap', 'castellan2023', '--section', '1b']);
  assert.equal(bad.status, 2, `${bad.stdout}\n${bad.stderr}`);
  assert.match(bad.stdout, /--section 1b could not be resolved/);
});

test('GRND-09: compile names a lettered section as §1a in its refusals', () => {
  const sb = sandbox('lettered-compile');
  const root = sb.project('p');
  letteredPaper(root);
  writeFileSync(join(sectionDirOf(root, 1, 'intro'), 'DRAFT.md'), 'Intro.\n');
  writeFileSync(join(sectionDirOf(root, 1, 'intro'), 'VERIFICATION.md'), '# VERIFICATION\n\nStatus: verified\n');
  const r = runCli(sb, root, ['compile', '--yolo']);
  assert.equal(r.status, 4, `${r.stdout}\n${r.stderr}`);
  assert.match(`${r.stdout}${r.stderr}`, /section 1a \(background\): missing PLAN\.md or DRAFT\.md/);
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /section 1 \(background\)/);
});
