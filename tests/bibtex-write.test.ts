// tests/bibtex-write.test.ts — Plan 04 Task 4.4 (D-19/D-07/D-20/D-15 round-trip suite).
//
// Asserts the SourceCandidate -> .bib serializer produces stable, parseable,
// retraction-preserving output. The 5 base cases mirror the plan:
//   1. 3-fixture round-trip via citation-js (D-19 chokepoint)
//   2. no-id candidate drop (silent, does not throw)
//   3. empty input writes zero-length file (Plan 06 verify.md never ENOENTs)
//   4. citekey-sorted output (git-diff-stability)
//   5. retracted: true surfaces as `note = {RETRACTED}` (D-15)
//
// Plus 3 CYCLE-2 collision-overflow cases that exercise suffixForCollision().

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeBibtex, suffixForCollision } from '../bin/lib/bibtex-write.js';
import { Cite } from '../bin/lib/citations.js';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';

function tmpFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-bibtex-'));
  return join(dir, 'CITATIONS.bib');
}

// D-14 LOCKED required fields populated on every fixture: id, last_verified,
// citekey, raw. authors is string[] ("Family, Given"). The CSL {family,given}
// parse happens INSIDE toCsl (the serializer-boundary parse).
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
    // CYCLE-3 REVIEWS — arXiv variant has a DOI (so it passes the hasId
    // gate in toCsl) AND an arxivId surfaced via the `number` field.
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

test('writeBibtex: round-trips 3 fixtures via citation-js without loss (D-19, D-20)', async () => {
  const target = tmpFile();
  await writeBibtex(fixtures, target);
  const body = readFileSync(target, 'utf8');
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
    'backslash-accent title survives (RESEARCH pitfall)',
  );
  rmSync(target, { force: true });
});

test('writeBibtex: drops candidates with no DOI/ISBN/arXiv id, does NOT throw', async () => {
  const target = tmpFile();
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
  await writeBibtex(mixed, target);
  const body = readFileSync(target, 'utf8');
  assert.equal(
    (body.match(/^@/gm) ?? []).length,
    3,
    'no-id candidate dropped silently — only the 3 with DOIs remain',
  );
  rmSync(target, { force: true });
});

test('writeBibtex: empty array still writes an empty file (verify.md must NOT ENOENT)', async () => {
  const target = tmpFile();
  await writeBibtex([], target);
  const body = readFileSync(target, 'utf8');
  assert.equal(body.trim(), '', 'empty array -> zero-length file (but the file exists)');
  rmSync(target, { force: true });
});

test('writeBibtex: emitted entries are sorted by citekey (git-diff-stable)', async () => {
  const target = tmpFile();
  await writeBibtex(fixtures, target);
  const body = readFileSync(target, 'utf8');
  const keys = [...body.matchAll(/^@\w+\{([^,]+),/gm)].map((m) => m[1] ?? '');
  const sorted = [...keys].sort();
  assert.deepEqual(keys, sorted, 'citekeys are ascending');
  rmSync(target, { force: true });
});

test('writeBibtex: retracted flag surfaces as note = {RETRACTED} in .bib (D-15)', async () => {
  const target = tmpFile();
  const retractedFixture: SourceCandidate[] = [
    {
      source: 'retraction-watch',
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
  await writeBibtex(retractedFixture, target);
  const body = readFileSync(target, 'utf8');
  assert.match(body, /note\s*=\s*\{RETRACTED\}/, 'retracted flag round-trips via CSL note field');
  rmSync(target, { force: true });
});

// ====================================================================
//   CYCLE-2 MEDIUM — base-26 collision-suffix overflow cases
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

test('writeBibtex: 3 wu2017 collisions emit wu2017, wu2017a, wu2017b in order', async () => {
  const target = tmpFile();
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
  await writeBibtex(colliding, target);
  const body = readFileSync(target, 'utf8');
  const keys = [...body.matchAll(/^@\w+\{([^,]+),/gm)].map((m) => m[1]);
  assert.deepEqual(
    keys,
    ['wu2017', 'wu2017a', 'wu2017b'],
    'first wu2017 keeps the base key; subsequent get a, b suffixes',
  );
  rmSync(target, { force: true });
});
