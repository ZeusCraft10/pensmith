// tests/compile-bib-regen.test.ts — BRDTH-01 / D-17-43 (supersedes COMP-07's
// bib regeneration): compile NEVER rewrites .paper/CITATIONS.bib.
//
// History: COMP-07 made compile re-render .paper/CITATIONS.bib from the union of
// the compiled citekeys, dropping every uncited entry. That pruned the research
// library (a later redo of a section came back FABRICATED because its source was
// gone), lost locator/multi-cite keys, and once wrote the file to 0 bytes
// (EXP-01). BRDTH-01 made LIBRARY.json the source of truth with ONE writer
// (bin/lib/library.ts), which renders CITATIONS.bib; citeproc renders only the
// keys a draft cites, so compile has no reason to touch the file. This suite
// used to assert the pruning; it now asserts the replacement contract:
//   - after a successful compile, CITATIONS.bib is byte-identical (mtime too);
//   - the uncited key and a DOI-less book (ISBN only) are still there;
//   - the bib still parses through the D-19 citation-js chokepoint.
// The old assertions ("an UNCITED key must be dropped", "regen must preserve
// the year (#5)", "a DOI-less book survives regen (#17)") are superseded: with
// no regeneration there is nothing to drop and nothing to lose.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCompile } from '../bin/lib/compile.js';
import { parseBib } from '../bin/lib/citations.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';
import { LECUN_BIB, ASPELMEYER_BIB } from './helpers/gate-paper.js';

// Recorded works (Crossref + Retraction Watch replay offline): compile
// recomputes every section's gate (VRFY-25), so the cited sources must really
// verify. The uncited entry stays a plain library record.
const SEED_BIB = `${LECUN_BIB}
${ASPELMEYER_BIB}
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
      '# Bib Fixture',
      '',
      '| # | slug | title | depends_on | word target | assigned_sources |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | intro | Intro | | 300 | lecun2015 |',
      '| 2 | body | Body | | 300 | aspelmeyer2009 |',
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
  seedSec(1, 'intro', '# Intro\n\nA grounded claim [@lecun2015].\n', ['lecun2015']);
  seedSec(2, 'body', '# Body\n\nAnother grounded claim [@aspelmeyer2009].\n', ['aspelmeyer2009']);
  return root;
}

test('BRDTH-01: compile leaves CITATIONS.bib byte-identical — the uncited key stays in the library', async () => {
  const root = seed();
  const bibPath = join(root, '.paper', 'CITATIONS.bib');
  const before = readFileSync(bibPath);
  const mtimeBefore = statSync(bibPath).mtimeMs;
  const result = await runCompile({ paperRoot: root, yolo: true });
  assert.equal(result.refused, false);

  const after = readFileSync(bibPath);
  assert.ok(after.equals(before), 'compile must not rewrite .paper/CITATIONS.bib');
  assert.equal(statSync(bibPath).mtimeMs, mtimeBefore, 'not even an identical rewrite (mtime unchanged)');
  const ids = new Set((await parseBib(after.toString('utf8'))).map((e) => String((e as { id?: string }).id ?? '')));
  assert.deepEqual([...ids].sort(), ['aspelmeyer2009', 'lecun2015', 'unused2018'], 'the uncited key is still in the library');
  // The compiled draft is written as before.
  assert.ok(existsSync(join(root, '.paper', 'DRAFT.md')));
});

test('BRDTH-01 (was audit #17): a DOI-less source (book, ISBN only) is untouched by compile', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-compile-book-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    [
      '# Book Fixture',
      '',
      '| # | slug | title | depends_on | word target | assigned_sources |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | intro | Intro | | 300 | kuhn1962 |',
      '',
    ].join('\n'),
  );
  // The recorded ISBN (books registries replay offline): Pass 1 checks the book at its own registrar.
  const bib = '@book{kuhn1962,\n  title = {The Structure of Scientific Revolutions},\n  author = {Kuhn, Thomas S.},\n  year = {1996},\n  isbn = {9780226458083}\n}\n';
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
  writeFileSync(
    join(dir, 'VERIFICATION.md'),
    ['# VERIFICATION (Section 1, intro)', '', 'Status: verified', '', '## Pass-1', '', '- kuhn1962: **OK** — titleJW=1.00, authorJW=1.00 — D-11 AND-gate passed', '', ''].join('\n'),
  );

  const result = await runCompile({ paperRoot: root, yolo: true });
  assert.equal(result.refused, false, (result.refuseReasons ?? []).join(' | '));
  assert.equal(readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8'), bib, 'the book entry is untouched');
});

test('BRDTH-01: after compile the bibliography still parses through the D-19 citation-js chokepoint', async () => {
  const root = seed();
  await runCompile({ paperRoot: root, yolo: true });
  const bibText = readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8');
  assert.ok(bibText.includes('@'), 'the bib keeps its BibTeX entries');
  await assert.doesNotReject(async () => parseBib(bibText));
});
