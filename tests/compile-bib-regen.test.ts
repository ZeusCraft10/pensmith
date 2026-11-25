// tests/compile-bib-regen.test.ts — compile leaves CITATIONS.bib alone.
//
// compile used to rewrite .paper/CITATIONS.bib from the works the manuscript
// cites, through a lossy converter: uncited works were deleted, journals,
// particles and entry types were lost, and DOI-less works had to be carried
// over field by field to survive. CITATIONS.bib is what verify checks every
// citation against, so compile now leaves it as it is; the export writes the
// cited subset into the export folder.
//
// Fixture: a CITATIONS.bib seeded with THREE entries; the compiled sections cite
// only TWO of them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCompile } from '../bin/lib/compile.js';
import { parseBibForPass1 } from '../bin/lib/verify/pass1.js';
import { bibEntryHashes } from '../bin/lib/verify/verification-record.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';
import { writeVerificationFixture } from './lib/verification-fixture.js';

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
    writeVerificationFixture(dir, { n, slug, draft, assignedSources: sources });
  };
  seedSec(1, 'intro', '# Intro\n\nA grounded claim [@smith2020].\n', ['smith2020']);
  seedSec(2, 'body', '# Body\n\nAnother grounded claim [@jones2019].\n', ['jones2019']);
  return root;
}

test('compile leaves CITATIONS.bib as it is: an uncited work is kept, no entry is rewritten', async () => {
  const root = seed();
  const result = await runCompile({ paperRoot: root, yolo: true });
  assert.equal(result.refused, false);
  assert.equal(readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8'), SEED_BIB);
});

test('a DOI-less source (book, ISBN only) is still in CITATIONS.bib after compile', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-compile-bookregen-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    [
      '# Book Regen Fixture',
      '',
      '| # | slug | title | depends_on | word target | assigned_sources |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | intro | Intro | | 300 | kuhn1962 |',
      '',
    ].join('\n'),
  );
  const bib = '@book{kuhn1962,\n  title = {The Structure of Scientific Revolutions},\n  author = {Kuhn, Thomas},\n  year = {1962},\n  isbn = {9780226458120}\n}\n';
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), bib);
  const dir = join(root, '.paper', 'sections', '01-intro');
  mkdirSync(dir, { recursive: true });
  const draft = '# Intro\n\nA paradigm shift [@kuhn1962].\n';
  writeFileSync(join(dir, 'DRAFT.md'), draft);
  const hash = computeDraftHash(Buffer.from(draft, 'utf8'), ['kuhn1962']);
  writeFileSync(
    join(dir, 'PLAN.md'),
    ['---', 'section: 1', 'slug: intro', 'title: intro', 'depends_on: []', "assigned_sources: ['kuhn1962']", `verified_against_draft_hash: '${hash}'`, 'status: verified', '---', '', '# intro', ''].join('\n'),
  );
  writeVerificationFixture(dir, { n: 1, slug: 'intro', draft, assignedSources: ['kuhn1962'] });

  const result = await runCompile({ paperRoot: root, yolo: true });
  assert.equal(result.refused, false);
  assert.equal(readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8'), bib);
});

test('the manifest binds the entry of each cited work, and no uncited one', async () => {
  const root = seed();
  await runCompile({ paperRoot: root, yolo: true });
  const manifest = JSON.parse(readFileSync(join(root, '.paper', 'COMPILE-MANIFEST.json'), 'utf8')) as { bib_entries: Record<string, string> };
  const hashes = bibEntryHashes(['smith2020', 'jones2019'], await parseBibForPass1(SEED_BIB));
  assert.deepEqual(manifest.bib_entries, hashes);
});
