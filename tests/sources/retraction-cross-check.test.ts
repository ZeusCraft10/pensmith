// tests/sources/retraction-cross-check.test.ts — CR-02 regression.
//
// REVIEW.md Phase 3 / CR-02: primary discovery adapters hard-code
// `retracted: false` at SourceCandidate construction. Without an explicit
// cross-check pass that mutates the candidate, bibtex-write.ts never
// emits `note = {RETRACTED}` and a retracted DOI silently flows through.
//
// This test asserts the cross-check helper:
//   1. Calls the retraction-watch lookup's fetchById for each DOI.
//   2. Mutates `retracted` to true when the lookup confirms retraction.
//   3. Threads `retraction_details` from the lookup result.
//   4. Causes writeBibtex to emit `note = {RETRACTED}` for the marked entry.
//
// Uses dependency injection (a fake RetractionLookup) so the test does
// not depend on a specific cassette being present.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crossCheckRetractions } from '../../bin/lib/sources/retraction-cross-check.js';
import { writeBibtex } from '../../bin/lib/bibtex-write.js';
import type { SourceCandidate } from '../../bin/lib/schemas/source-candidate.js';

function makeCandidate(
  overrides: Partial<SourceCandidate> = {},
): SourceCandidate {
  return {
    source: 'crossref',
    id: '10.0000/test',
    doi: '10.0000/test',
    title: 'A Paper Subsequently Retracted',
    authors: ['Doe, John'],
    year: 2010,
    retracted: false,
    last_verified: new Date().toISOString(),
    citekey: 'doe2010',
    raw: {},
    ...overrides,
  } as SourceCandidate;
}

test('crossCheckRetractions calls fetchById for every DOI', async () => {
  const seen: string[] = [];
  const fake = {
    fetchById: async (doi: string): Promise<SourceCandidate | null> => {
      seen.push(doi);
      return null;
    },
  };
  const candidates = [
    makeCandidate({ doi: '10.1/aaa', id: '10.1/aaa', citekey: 'a2010' }),
    makeCandidate({ doi: '10.2/bbb', id: '10.2/bbb', citekey: 'b2010' }),
    // Candidate without DOI must be skipped.
    makeCandidate({ doi: undefined, id: 'no-doi-id', citekey: 'c2010' }),
  ];
  await crossCheckRetractions(candidates, fake);
  assert.deepEqual(seen, ['10.1/aaa', '10.2/bbb']);
});

test('crossCheckRetractions mutates retracted=true when lookup returns retracted hit', async () => {
  const retractionHit: SourceCandidate = {
    source: 'retraction-watch',
    id: '10.0000/test',
    doi: '10.0000/test',
    title: 'A Paper Subsequently Retracted',
    authors: ['Doe, John'],
    year: 2010,
    retracted: true,
    retraction_details: '2015-03-15: fabricated data',
    last_verified: new Date().toISOString(),
    citekey: 'doe2010',
    raw: {},
  };
  const fake = {
    fetchById: async (): Promise<SourceCandidate | null> => retractionHit,
  };
  const candidates = [makeCandidate()];
  await crossCheckRetractions(candidates, fake);
  assert.equal(candidates[0]!.retracted, true);
  assert.equal(candidates[0]!.retraction_details, '2015-03-15: fabricated data');
});

test('crossCheckRetractions + writeBibtex emits note = {RETRACTED} in .bib', async () => {
  const retractionHit: SourceCandidate = {
    source: 'retraction-watch',
    id: '10.0000/test',
    doi: '10.0000/test',
    title: 'A Paper Subsequently Retracted',
    authors: ['Doe, John'],
    year: 2010,
    retracted: true,
    retraction_details: '2015-03-15: fabricated data',
    last_verified: new Date().toISOString(),
    citekey: 'doe2010',
    raw: {},
  };
  const fake = {
    fetchById: async (): Promise<SourceCandidate | null> => retractionHit,
  };
  const candidates = [makeCandidate()];
  await crossCheckRetractions(candidates, fake);

  const dir = mkdtempSync(join(tmpdir(), 'pensmith-retraction-cc-'));
  try {
    const bibPath = join(dir, 'CITATIONS.bib');
    await writeBibtex(candidates, bibPath);
    const bib = readFileSync(bibPath, 'utf8');
    assert.ok(
      /note\s*=\s*\{RETRACTED\}/.test(bib),
      `expected RETRACTED note in emitted .bib, got:\n${bib}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('crossCheckRetractions leaves retracted=false when lookup returns null', async () => {
  const fake = {
    fetchById: async (): Promise<SourceCandidate | null> => null,
  };
  const candidates = [makeCandidate()];
  await crossCheckRetractions(candidates, fake);
  assert.equal(candidates[0]!.retracted, false);
});

test('crossCheckRetractions swallows lookup errors per-candidate', async () => {
  const fake = {
    fetchById: async (): Promise<SourceCandidate | null> => {
      throw new Error('boom');
    },
  };
  const candidates = [makeCandidate()];
  // Must not throw.
  await crossCheckRetractions(candidates, fake);
  assert.equal(candidates[0]!.retracted, false);
});
