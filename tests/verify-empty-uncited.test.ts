// tests/verify-empty-uncited.test.ts — a draft with nothing checked in it is
// not verified.
//
// verify used to mark a section verified whenever Pass 1 and Pass 3 found
// nothing to object to. An empty DRAFT.md, or one that cites none of the
// sources its PLAN.md assigns (a refused or truncated model answer, or a
// drafter that wrote its claims uncited), has nothing to object to, so it
// passed the gate compile and done trust. Each case runs the real verify.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './lib/export-fixture.js';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';

const BIB =
  '@misc{vaswani2017,\n  title = {Attention Is All You Need},\n' +
  '  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N. and Kaiser, Lukasz and Polosukhin, Illia},\n' +
  '  year = {2017},\n  doi = {10.48550/arXiv.1706.03762}\n}\n';

interface Verified { status: number | null; out: string; verification: string; planStatus: unknown; root: string }

function verify(draft: string, assigned: string[]): Verified {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-verify-empty-'));
  const sec = join(root, '.paper', 'sections', '01-intro');
  mkdirSync(sec, { recursive: true });
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    ['# Empty', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |',
      `| 1 | intro | Intro | | 300 | ${assigned.join(', ')} |`, ''].join('\n'),
  );
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), BIB);
  writeFileSync(join(sec, 'PLAN.md'), `---\nsection: 1\nslug: intro\ntitle: Intro\nstatus: written\nassigned_sources: [${assigned.join(', ')}]\n---\n# Intro\n`);
  writeFileSync(join(sec, 'DRAFT.md'), draft);
  const r = runCli(['verify', '1', '--slug', 'intro'], root, { PENSMITH_OFFLINE: '0', PENSMITH_TEST_CASSETTES: '1' });
  return {
    status: r.status,
    out: r.stdout + r.stderr,
    root,
    verification: readFileSync(join(sec, 'VERIFICATION.md'), 'utf8'),
    planStatus: parseFrontmatter(readFileSync(join(sec, 'PLAN.md'), 'utf8')).frontmatter['status'],
  };
}

for (const [what, draft] of [
  ['an empty DRAFT.md', ''],
  ['a DRAFT.md of blank lines', '\n\n  \n'],
] as const) {
  test(`${what} is not verified: verify fails it with exit 2 and says why`, () => {
    const v = verify(draft, ['vaswani2017']);
    assert.equal(v.status, 2, v.out);
    assert.match(v.verification, /^Status: failed$/m);
    assert.match(v.verification, /empty/i);
    assert.equal(v.planStatus, 'failed');
  });
}

test('a draft that cites none of its assigned sources is not verified, and compile refuses it', () => {
  const v = verify('Attention mechanisms changed machine translation for good.\n', ['vaswani2017']);
  assert.equal(v.status, 2, v.out);
  assert.match(v.verification, /^Status: failed$/m);
  assert.match(v.verification, /vaswani2017/);
  assert.match(v.verification, /cites none/i);
  assert.equal(v.planStatus, 'failed');

  const c = runCli(['compile'], v.root, { PENSMITH_OFFLINE: '0', PENSMITH_TEST_CASSETTES: '1' });
  assert.equal(c.status, 2, c.stdout + c.stderr);
  assert.equal(existsSync(join(v.root, '.paper', 'DRAFT.md')), false, 'no manuscript is written');
});

test('a draft with no citations and no assigned sources (a section that needs none) is verified', () => {
  const v = verify('This closing section restates the argument in plain words.\n', []);
  assert.equal(v.status, 0, v.out);
  assert.match(v.verification, /^Status: verified$/m);
  assert.equal(v.planStatus, 'verified');
});

test('a draft citing one of its two assigned sources is verified', () => {
  const v = verify('Attention suffices for translation [@vaswani2017].\n', ['vaswani2017', 'other2020']);
  assert.equal(v.status, 0, v.out);
  assert.match(v.verification, /^Status: verified$/m);
});
