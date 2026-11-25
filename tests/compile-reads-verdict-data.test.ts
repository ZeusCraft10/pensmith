// tests/compile-reads-verdict-data.test.ts — compile gates on the verdicts
// verify recorded, not on how VERIFICATION.md reads.
//
// compile used to decide from the Markdown report: a `Status:` line and the
// verdict rows a regex could find in it. A report reworded, reformatted or
// rewritten by hand (or by an agent asked to make a check pass) compiled a
// section verify had failed. verify now records its verdicts as data in
// VERIFICATION.json; the Markdown is only rendered from it. Every case drives
// the real verify and compile on recorded registry answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './lib/export-fixture.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';

// A key holding Pandoc key characters the old row regex could not read.
const KEY = 'ghost.2024/a+b';
const GHOST =
  `@article{${KEY},\n  title = {Room-temperature superconductivity in a ternary hydride at ambient pressure},\n` +
  '  author = {Ghost, Casper},\n  year = {2024},\n  journal = {Nature},\n  doi = {10.1038/s41586-024-99999-x}\n}\n';

interface Run { status: number | null; out: string }

function cli(root: string, args: string[]): Run {
  const r = runCli(args, root, { PENSMITH_OFFLINE: '0', PENSMITH_TEST_CASSETTES: '1' });
  return { status: r.status, out: r.stdout + r.stderr };
}

function seedPaper(): { root: string; sec: string } {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-compile-verdict-data-'));
  const sec = join(root, '.paper', 'sections', '01-intro');
  mkdirSync(sec, { recursive: true });
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    ['# Verdict Data', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |',
      `| 1 | intro | Intro | | 300 | ${KEY} |`, ''].join('\n'),
  );
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), GHOST);
  writeFileSync(join(sec, 'PLAN.md'), `---\nsection: 1\nslug: intro\ntitle: Intro\nstatus: written\nassigned_sources: ['${KEY}']\n---\n# Intro\n`);
  writeFileSync(join(sec, 'DRAFT.md'), `Room-temperature superconductivity was reported [@${KEY}].\n`);
  return { root, sec };
}

test('a FABRICATED citation verify recorded blocks compile even after VERIFICATION.md is rewritten to read verified', () => {
  const { root, sec } = seedPaper();
  const v = cli(root, ['verify', '1', '--slug', 'intro']);
  assert.equal(v.status, 2, v.out);
  assert.match(readFileSync(join(sec, 'VERIFICATION.md'), 'utf8'), /FABRICATED/);

  // The report is rewritten: no failed status, no verdict row.
  writeFileSync(join(sec, 'VERIFICATION.md'), '# VERIFICATION (Section 1, intro)\n\nStatus: verified\n\n## Pass-1\n\n## Pass-3\n');
  const c = cli(root, ['compile']);
  assert.equal(c.status, 2, c.out);
  assert.ok(c.out.includes(`[@${KEY}]`), `the refusal names the citation\n${c.out}`);
  assert.match(c.out, /FABRICATED/);
  assert.equal(existsSync(join(root, '.paper', 'DRAFT.md')), false, 'no manuscript is written');
});

test('a section with a hand-written VERIFICATION.md and no recorded verdicts never compiles', () => {
  const { root, sec } = seedPaper();
  // PLAN.md reads as verified against the current draft, as verify would leave it.
  const draft = readFileSync(join(sec, 'DRAFT.md'));
  writeFileSync(
    join(sec, 'PLAN.md'),
    `---\nsection: 1\nslug: intro\ntitle: Intro\nstatus: verified\nassigned_sources: ['${KEY}']\n` +
      `verified_against_draft_hash: ${computeDraftHash(draft, [KEY])}\n---\n# Intro\n`,
  );
  writeFileSync(
    join(sec, 'VERIFICATION.md'),
    `# VERIFICATION (Section 1, intro)\n\nStatus: verified\n\n## Pass-1\n\n- ${KEY}: **OK** — titleJW=1.00, authorJW=1.00 — ok\n\n## Pass-3\n`,
  );
  const c = cli(root, ['compile']);
  assert.equal(c.status, 2, c.out);
  assert.match(c.out, /never verified|not verified/);
  assert.equal(existsSync(join(root, '.paper', 'DRAFT.md')), false, 'no manuscript is written');
});

const ATTENTION =
  '@misc{vaswani2017,\n  title = {Attention Is All You Need},\n' +
  '  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N. and Kaiser, Lukasz and Polosukhin, Illia},\n' +
  '  year = {2017},\n  doi = {10.48550/arXiv.1706.03762}\n}\n';

test('a cited CITATIONS.bib entry changed after verify: compile re-checks the section and refuses what no longer matches', () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-compile-bib-changed-'));
  const sec = join(root, '.paper', 'sections', '01-intro');
  mkdirSync(sec, { recursive: true });
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    ['# Verdict Data', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |',
      '| 1 | intro | Intro | | 300 | vaswani2017 |', ''].join('\n'),
  );
  const bibPath = join(root, '.paper', 'CITATIONS.bib');
  writeFileSync(bibPath, ATTENTION);
  writeFileSync(join(sec, 'PLAN.md'), '---\nsection: 1\nslug: intro\ntitle: Intro\nstatus: written\nassigned_sources: [vaswani2017]\n---\n# Intro\n');
  writeFileSync(join(sec, 'DRAFT.md'), 'Attention suffices for translation [@vaswani2017].\n');
  const v = cli(root, ['verify', '1', '--slug', 'intro']);
  assert.equal(v.status, 0, v.out);

  // The draft is unchanged; the entry behind its citation now names another work.
  writeFileSync(bibPath, ATTENTION.replace('Attention Is All You Need', 'Recurrent Networks Are All You Need'));
  const c = cli(root, ['compile']);
  assert.equal(c.status, 2, c.out);
  assert.match(c.out, /stale \(the CITATIONS\.bib entry for \[@vaswani2017\] changed since verify\)/);
  assert.match(c.out, /\[@vaswani2017\] is MIS-CITED/);
  assert.equal(existsSync(join(root, '.paper', 'DRAFT.md')), false, 'no manuscript is written');
});
