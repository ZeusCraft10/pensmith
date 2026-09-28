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

test('GRND-09 / D-18-16 (review round 2): a registered §1a with no folder is planned into `01a-<slug>/` and named §1a by write', async () => {
  const { withLlmSandbox } = await import('./helpers/llm-sandbox.js');
  const { seedBriefPaper } = await import('./helpers/section-fixture.js');
  const { registerSections } = await import('../bin/lib/section-stubs.js');
  const { readdirSync, rmSync } = await import('node:fs');
  const KEY = 'sk-test-lettered-0001';
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await seedBriefPaper(sb.root);
    const row = (n: number, suffix: string | undefined, slug: string) => ({
      n, ...(suffix !== undefined ? { suffix } : {}), slug, title: slug, purpose: `Cover ${slug}.`, depends_on: [], estimated_word_count: 500,
      assigned_sources: ['vaswani2017'], role: 'body',
    });
    await registerSections(sb.root, [row(1, undefined, 'introduction')]);
    // §1a is registered (a Tier-1 paper_init_section, or a folder the user deleted) but has no folder.
    const { initSection } = await import('../bin/lib/state.js');
    await initSection(sb.root, 1, 'extra', 'a');
    writeFileSync(join(sb.paper, 'OUTLINE.md'), [
      '# Outline', '',
      '| # | slug | title | depends_on | word target | assigned_sources |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | introduction | Introduction |  | 500 | vaswani2017 |',
      '| 1a | extra | Extra |  | 500 | vaswani2017 |', '',
    ].join('\n'));
    const env = { env: { ANTHROPIC_API_KEY: KEY } };

    // write §1a before it is planned: the refusal names §1a, never §1 (which would re-plan a different section).
    const early = await sb.runTsx(null, ['write', '1a'], env);
    assert.equal(early.status, 2, `${early.stdout}\n${early.stderr}`);
    assert.match(early.stderr, /section 1a is not planned yet — run `pensmith plan 1a` first/);
    assert.doesNotMatch(early.stderr, /pensmith plan 1`/);

    const planned = await sb.runTsx(null, ['plan', '1a'], env);
    assert.equal(planned.status, 0, `${planned.stdout}\n${planned.stderr}`);
    const dirs = readdirSync(join(sb.paper, 'sections')).sort();
    assert.deepEqual(dirs, ['01-introduction', '01a-extra'], 'the folder carries its letter; no second §1 folder');
    assert.match(planned.stdout, /01a-extra[\\/]PLAN\.md/);

    // The same after the user deletes the folder: re-planning recreates it with its letter.
    rmSync(join(sb.paper, 'sections', '01a-extra'), { recursive: true });
    const again = await sb.runTsx(null, ['plan', '1a'], env);
    assert.equal(again.status, 0, `${again.stdout}\n${again.stderr}`);
    assert.deepEqual(readdirSync(join(sb.paper, 'sections')).sort(), ['01-introduction', '01a-extra']);
  });
});
