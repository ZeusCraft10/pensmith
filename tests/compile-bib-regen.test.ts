// tests/compile-bib-regen.test.ts — COMP-07 / D-19 CITATIONS.bib regeneration.
//
// RED-first: bin/lib/compile.ts does not exist yet.
//
// COMP-07 (compile output generation) anchored to the D-19 bibtex chokepoint:
// after a successful compile, .paper/CITATIONS.bib is re-rendered from the UNION
// of the compiled sections' citekeys via bin/lib/bibtex-write.ts (which rides the
// citation-js D-19 chokepoint and resolves collisions with a base-26 suffix).
// Bib regen is part of COMP-07 output generation — NOT canonical COMP-04/05.
//
// Fixture: a CITATIONS.bib seeded with THREE entries; the compiled sections cite
// only TWO of them. After compile the bib must contain the two cited keys and
// drop the uncited one (regenerated from the union of compiled citekeys).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCompile } from '../bin/lib/compile.js';
import { parseBib } from '../bin/lib/citations.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';

const SEED_BIB = `@article{smith2020,
  title = {A Real Title},
  author = {Smith, Jane},
  year = {2020},
  doi = {10.1000/smith2020}
}

@article{jones2019,
  title = {Another Real Title},
  author = {Jones, Bob},
  year = {2019},
  doi = {10.1000/jones2019}
}

@article{unused2018,
  title = {Uncited Work},
  author = {Nobody, A},
  year = {2018},
  doi = {10.1000/unused2018}
}
`;

function seed(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-compile-bibregen-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    [
      '# Bib Regen Fixture',
      '',
      '| # | slug | title | depends_on | word target | assigned_sources |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | intro | Intro | | 300 | smith2020 |',
      '| 2 | body | Body | | 300 | jones2019 |',
      '',
    ].join('\n'),
  );
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), SEED_BIB);
  const seedSec = (n: number, slug: string, draft: string, sources: string[]): void => {
    const dir = join(root, '.paper', 'sections', `${String(n).padStart(2, '0')}-${slug}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'DRAFT.md'), draft);
    const hash = computeDraftHash(Buffer.from(draft, 'utf8'), sources);
    writeFileSync(
      join(dir, 'PLAN.md'),
      ['---', `section: ${n}`, `slug: ${slug}`, `title: ${slug}`, 'depends_on: []', `assigned_sources: [${sources.map((k) => `'${k}'`).join(', ')}]`, `verified_against_draft_hash: '${hash}'`, 'status: verified', '---', '', `# ${slug}`, ''].join('\n'),
    );
    writeFileSync(
      join(dir, 'VERIFICATION.md'),
      [`# VERIFICATION (Section ${n}, ${slug})`, '', 'Status: verified', '', '## Pass-1 (citation integrity, deterministic — D-11 AND-gate)', '', `- ${sources[0]}: **OK** — titleJW=1.00, authorJW=1.00 — D-11 AND-gate passed`, '', ''].join('\n'),
    );
  };
  seedSec(1, 'intro', '# Intro\n\nA grounded claim [@smith2020].\n', ['smith2020']);
  seedSec(2, 'body', '# Body\n\nAnother grounded claim [@jones2019].\n', ['jones2019']);
  return root;
}

test('COMP-07/D-19: compile regenerates CITATIONS.bib from the union of compiled citekeys', async () => {
  const root = seed();
  const result = await runCompile({ paperRoot: root, yolo: true });
  assert.equal(result.refused, false);

  const bibText = readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8');
  const entries = await parseBib(bibText);
  const ids = new Set(entries.map((e) => String((e as { id?: string }).id ?? '')));

  assert.ok(ids.has('smith2020'), 'a cited key must survive bib regen');
  assert.ok(ids.has('jones2019'), 'a cited key must survive bib regen');
  assert.ok(!ids.has('unused2018'), 'an UNCITED key must be dropped (regenerated from the compiled union)');
});

test('COMP-07/D-19: regenerated bib is non-empty and parseable (rides the citation-js chokepoint)', async () => {
  const root = seed();
  await runCompile({ paperRoot: root, yolo: true });
  const bibText = readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8');
  assert.ok(bibText.includes('@'), 'regenerated bib must contain BibTeX entries');
  // Round-trips through the D-19 citation-js chokepoint without throwing.
  await assert.doesNotReject(async () => parseBib(bibText));
});
