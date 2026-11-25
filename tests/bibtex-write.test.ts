// tests/bibtex-write.test.ts — CITATIONS.bib as research writes it, through
// the library (tests/lib/library-views.ts):
//   1. entries round-trip through citation-js;
//   2. a candidate with no identifier is left out, without throwing;
//   3. no candidates still writes the file, empty (verify reads it as an empty library);
//   4. entries are sorted by citekey, so the file diffs stably;
//   5. a retracted work carries `note = {RETRACTED}`.
// Plus the collision suffixes, a..z then aa.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { suffixForCollision } from '../bin/lib/bibtex-write.js';
import { Cite } from '../bin/lib/citations.js';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';
import { throughLibrary } from './lib/library-views.js';

/** CITATIONS.bib after research merges `candidates` into a new project's library. */
async function bibOf(candidates: SourceCandidate[]): Promise<string> {
  return readFileSync((await throughLibrary(candidates)).bibPath, 'utf8');
}

const fixtures: SourceCandidate[] = [
  {
    source: 'crossref',
    id: '10.0000/aaa',
    doi: '10.0000/aaa',
    title: 'Attention Is All You Need',
    authors: ['Vaswani, Ashish'],
    year: 2017,
    retracted: false,
    citekey: 'vaswani2017',
    last_verified: '2024-01-01T00:00:00.000Z',
    raw: {},
  },
  {
    source: 'openalex',
    id: '10.0000/bbb',
    doi: '10.0000/bbb',
    title: 'Deep Residual Learning',
    authors: ['He, Kaiming'],
    year: 2016,
    retracted: false,
    citekey: 'he2016',
    last_verified: '2024-01-01T00:00:00.000Z',
    raw: {},
  },
  {
    // A title with a BibTeX accent escape, which citation-js must read back.
    source: 'arxiv',
    id: '2401.00001',
    doi: '10.48550/arXiv.2401.00001',
    title: 'Naive Bayes Revisited (na\\"ive)',
    authors: ['Doe, Jane'],
    year: 2024,
    retracted: false,
    citekey: 'doe2024',
    last_verified: '2024-01-01T00:00:00.000Z',
    raw: { arxivId: '2401.00001' },
  } as SourceCandidate,
];

test('CITATIONS.bib: entries round-trip through citation-js without loss', async () => {
  const body = await bibOf(fixtures);
  const parsed = new Cite(body);
  const out = (parsed as { format: (...args: unknown[]) => unknown }).format(
    'data',
    { format: 'object' },
  ) as Array<{ title: string }>;
  assert.equal(out.length, fixtures.length, 'all 3 entries survive round-trip');
  const titles = out.map((o) => o.title).sort();
  assert.ok(titles.some((t) => t.includes('Attention')), 'Vaswani title round-trips');
  assert.ok(titles.some((t) => t.includes('Residual')), 'He title round-trips');
  assert.ok(
    titles.some((t) => /na.?ive/i.test(t)),
    'backslash-accent title survives',
  );
});

test('CITATIONS.bib: a candidate with no DOI, ISBN or arXiv ID is left out, without throwing', async () => {
  const noIdCandidate = {
    source: 'crossref',
    id: 'tmp-noid',
    title: 'No id',
    authors: ['Nobody'],
    year: 2020,
    retracted: false,
    citekey: 'noid2020',
    last_verified: '2024-01-01T00:00:00.000Z',
    raw: {},
  } as unknown as SourceCandidate;
  const mixed: SourceCandidate[] = [...fixtures, noIdCandidate];
  const body = await bibOf(mixed);
  assert.equal(
    (body.match(/^@/gm) ?? []).length,
    3,
    'only the 3 with DOIs remain',
  );
});

test('CITATIONS.bib: no candidates still writes the file, empty', async () => {
  const body = await bibOf([]);
  assert.equal(body.trim(), '', 'an empty file, which verify reads as an empty library');
});

test('CITATIONS.bib: entries are sorted by citekey, so the file diffs stably', async () => {
  const body = await bibOf(fixtures);
  const keys = [...body.matchAll(/^@\w+\{([^,]+),/gm)].map((m) => m[1] ?? '');
  const sorted = [...keys].sort();
  assert.deepEqual(keys, sorted, 'citekeys are ascending');
});

test('CITATIONS.bib: a retracted work carries note = {RETRACTED}', async () => {
  const retractedFixture: SourceCandidate[] = [
    {
      source: 'crossref',
      id: '10.0000/retracted-001',
      doi: '10.0000/retracted-001',
      title: 'A Famously Retracted Paper',
      authors: ['Wakefield, A.'],
      year: 1998,
      retracted: true,
      citekey: 'wakefield1998',
      last_verified: '2024-01-01T00:00:00.000Z',
      raw: {},
    },
  ];
  const body = await bibOf(retractedFixture);
  assert.match(body, /note\s*=\s*\{RETRACTED\}/, 'retracted flag round-trips via CSL note field');
});

// ====================================================================
//   Collision suffixes
// ====================================================================

test('suffixForCollision: 1..26 maps to a..z (boundary at z)', () => {
  assert.equal(suffixForCollision(1), 'a');
  assert.equal(suffixForCollision(2), 'b');
  assert.equal(suffixForCollision(26), 'z');
});

test('suffixForCollision: 27 overflows to aa, 52 -> az, 53 -> ba (digit-carry)', () => {
  assert.equal(suffixForCollision(27), 'aa');
  assert.equal(suffixForCollision(28), 'ab');
  assert.equal(suffixForCollision(52), 'az');
  assert.equal(suffixForCollision(53), 'ba');
  assert.equal(suffixForCollision(702), 'zz');
});

test('CITATIONS.bib: 3 wu2017 collisions emit wu2017, wu2017a, wu2017b in order', async () => {
  const colliding: SourceCandidate[] = [1, 2, 3].map((i) => ({
    source: 'crossref' as const,
    id: `10.0000/wu-${i}`,
    doi: `10.0000/wu-${i}`,
    title: `Wu Paper ${i}`,
    authors: ['Wu, Yong'],
    year: 2017,
    retracted: false,
    citekey: 'wu2017',
    last_verified: '2024-01-01T00:00:00.000Z',
    raw: {},
  }));
  const body = await bibOf(colliding);
  const keys = [...body.matchAll(/^@\w+\{([^,]+),/gm)].map((m) => m[1]);
  assert.deepEqual(
    keys,
    ['wu2017', 'wu2017a', 'wu2017b'],
    'first wu2017 keeps the base key; subsequent get a, b suffixes',
  );
});
