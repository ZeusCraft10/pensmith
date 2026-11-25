// tests/compile-after-verify.test.ts — what the real `pensmith verify` blocks,
// the real `pensmith compile` refuses.
//
// compile decides from the verdict rows in VERIFICATION.md, one row per line.
// A row whose key is text from the draft (a raw or broken citation) used to
// carry the draft's line break with it, so a hard-wrapped `Engel and\nFleming
// (2007)` was written as a row split over two lines, no row parsed, and a
// section verify had failed compiled.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedCliEnv } from './lib/cli-env.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

const BIB =
  '@article{engel2007,\n  title = {Evidence for wavelike energy transfer through quantum coherence in photosynthetic systems},\n' +
  '  author = {Engel, Gregory S.},\n  doi = {10.1038/nature05678},\n  year = {2007}\n}\n';

/** A one-section paper whose DRAFT.md is `draft`, written but not yet verified. */
function seedPaper(draft: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-compile-after-verify-'));
  const sec = join(root, '.paper', 'sections', '01-intro');
  mkdirSync(sec, { recursive: true });
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    [
      '# Wrapped Citations',
      '',
      '| # | slug | title | depends_on | word target | assigned_sources |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | intro | Intro | | 300 | engel2007 |',
      '',
    ].join('\n'),
  );
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), BIB);
  writeFileSync(join(sec, 'PLAN.md'), '---\nsection: 1\nslug: intro\ntitle: Intro\nstatus: written\nassigned_sources: [engel2007]\n---\n# Intro\n');
  writeFileSync(join(sec, 'DRAFT.md'), draft);
  return root;
}

function cli(root: string, ...args: string[]): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: isolatedCliEnv({ PENSMITH_TEST_CASSETTES: '1', PENSMITH_NO_LLM: '1', PENSMITH_OFFLINE: undefined }),
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

const WRAPPED: Array<[string, string, string]> = [
  [
    'an author-year citation typed as text',
    '# Intro\n\nCoherence is long lived, as Engel and\nFleming (2007) argued in their study.\n',
    'Engel and Fleming (2007)',
  ],
  [
    'a bracketed citation with no key that parses',
    '# Intro\n\nCoherence is long lived [@ smith\n2020] in every system studied.\n',
    '[@ smith 2020]',
  ],
];

for (const [what, draft, named] of WRAPPED) {
  test(`verify then compile: ${what}, hard-wrapped over two lines, is refused by compile`, () => {
    const root = seedPaper(draft);
    const v = cli(root, 'verify', '1', '--slug', 'intro');
    assert.equal(v.status, 2, `verify blocks it\n${v.out}`);

    const c = cli(root, 'compile');
    assert.equal(c.status, 2, `compile must refuse what verify blocked\n${c.out}`);
    assert.match(c.out, /REFUSED/);
    assert.ok(c.out.includes(`text "${named}"`), `the refusal names the text on one line\n${c.out}`);
    assert.equal(existsSync(join(root, '.paper', 'DRAFT.md')), false, 'no manuscript is written');
  });
}
