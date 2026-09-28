// tests/sources/retraction-cross-check.test.ts — CR-02 regression.
//
// REVIEW.md Phase 3 / CR-02: primary discovery adapters hard-code
// `retracted: false` at SourceCandidate construction. Without an explicit
// cross-check pass that mutates the candidate, bibtex-write.ts never
// emits `note = {RETRACTED}` and a retracted DOI silently flows through.
//
// This test asserts the cross-check helper:
//   1. Calls the retraction-watch lookup's fetchById once per undecided DOI.
//   2. Mutates `retracted` to true when the lookup confirms retraction.
//   3. Threads `retraction_details` from the lookup result.
//   4. Causes writeBibtex to emit `note = {RETRACTED}` for the marked entry.
//   5. (SRC-04, D-19-11) Sets `retraction_status` retracted | clear | unknown,
//      skips candidates their own Crossref record decided, and swallows nothing.
//
// Uses dependency injection (a fake RetractionLookup) so the test does
// not depend on a specific cassette being present.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crossCheckRetractions, retractionCheckReason } from '../../bin/lib/sources/retraction-cross-check.js';
import { liveLane, cacheMentions } from './three-way.js';
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

test('SRC-04: a failed lookup is status "unknown" with its reason — never swallowed, never "clear"', async () => {
  const fake = {
    fetchById: async (): Promise<SourceCandidate | null> => {
      throw new Error('retraction status unknown for 10.0000/test: the Crossref lookup failed (HTTP 503 after retries)');
    },
  };
  const candidates = [makeCandidate()];
  // Must not throw: the batch survives, the candidate says why it is undecided.
  await crossCheckRetractions(candidates, fake);
  assert.equal(candidates[0]!.retracted, false);
  assert.equal(candidates[0]!.retraction_status, 'unknown');
  assert.equal(
    retractionCheckReason(candidates[0]!),
    'retraction status unknown for 10.0000/test: the Crossref lookup failed (HTTP 503 after retries)',
  );
});

test('SRC-04: a live "no notice" answer is status "clear"; a hit is "retracted"', async () => {
  const clear = [makeCandidate({ doi: '10.1/clear', id: '10.1/clear', source: 'openalex' })];
  await crossCheckRetractions(clear, { fetchById: async () => null });
  assert.equal(clear[0]!.retraction_status, 'clear');
  assert.equal(retractionCheckReason(clear[0]!), undefined);
});

test('D-19-11: candidates their own Crossref record decided are not looked up again; each DOI is looked up once', async () => {
  const seen: string[] = [];
  const fake = {
    fetchById: async (doi: string): Promise<SourceCandidate | null> => {
      seen.push(doi);
      return null;
    },
  };
  const candidates = [
    // Decided by the Crossref record (clear) — and an OpenAlex copy of the same DOI inherits it.
    makeCandidate({ doi: '10.5555/decided', id: '10.5555/decided', citekey: 'a2010', retraction_status: 'clear' }),
    makeCandidate({ doi: '10.5555/DECIDED', id: 'W1', source: 'openalex', citekey: 'a2010b' }),
    // Retracted by its own record — a copy without the flag becomes retracted too (sticky).
    makeCandidate({ doi: '10.5555/ret', id: '10.5555/ret', citekey: 'r2010', retracted: true, retraction_status: 'retracted', retraction_details: '2019-01-01: Retraction' }),
    makeCandidate({ doi: 'https://doi.org/10.5555/ret', id: 'S2', source: 'semanticscholar', citekey: 'r2010b' }),
    // Undecided, three copies of one DOI (case and prefix differ) → ONE lookup.
    makeCandidate({ doi: '10.5555/open', id: '10.5555/open', source: 'pubmed', citekey: 'o2010' }),
    makeCandidate({ doi: '10.5555/OPEN', id: 'W2', source: 'openalex', citekey: 'o2010b' }),
    makeCandidate({ doi: 'doi:10.5555/open', id: 'x', source: 'semanticscholar', citekey: 'o2010c' }),
    // A synthetic --dry-run source is never looked up.
    makeCandidate({ doi: '10.0000/pensmith-dryrun.0a1b2c3d', id: 'syn', source: 'dry-run', citekey: 's2010', synthetic: true }),
  ];
  await crossCheckRetractions(candidates, fake);
  assert.deepEqual(seen, ['10.5555/open']);
  assert.deepEqual(candidates.map((c) => c.retraction_status), [
    'clear', 'clear', 'retracted', 'retracted', 'clear', 'clear', 'clear', undefined,
  ]);
  assert.equal(candidates[3]!.retracted, true);
  assert.equal(candidates[3]!.retraction_details, '2019-01-01: Retraction');
});

test('SRC-04: the recorded Wakefield notice marks a candidate from any adapter retracted (real cassette)', async () => {
  const candidates = [makeCandidate({ doi: '10.1016/S0140-6736(97)11096-0', id: '9500898', source: 'pubmed', citekey: 'wakefield1998' })];
  await crossCheckRetractions(candidates);
  assert.equal(candidates[0]!.retracted, true);
  assert.equal(candidates[0]!.retraction_status, 'retracted');
  assert.match(candidates[0]!.retraction_details ?? '', /^2010-02-06: Retraction \(notice 10\.1016\/s0140-6736\(10\)60175-4; Retraction Watch record 4036\)$/);
});

test('SRC-04: offline with no recorded retraction fixture → "unknown" (offline), never "clear"', async () => {
  const candidates = [makeCandidate({ doi: '10.9999/no-retraction-fixture', id: '10.9999/no-retraction-fixture' })];
  await crossCheckRetractions(candidates);
  assert.equal(candidates[0]!.retraction_status, 'unknown');
  assert.match(retractionCheckReason(candidates[0]!) ?? '', /^offline: no recorded fixture for the retraction lookup/);
});

test('SRC-04: a 200 carrying an inner 403 (recorded shape, synthetic) → "unknown", with the reason', async () => {
  const candidates = [makeCandidate({ doi: '10.5555/inner-403', id: '10.5555/inner-403' })];
  await crossCheckRetractions(candidates);
  assert.equal(candidates[0]!.retraction_status, 'unknown');
  assert.match(retractionCheckReason(candidates[0]!) ?? '', /response is not a Crossref answer \(an error document: an inner statusCode 403\)/);
});

test('SRC-04 (MockAgent): a 200 with an inner 400 body is a failure, not cached, and reads "unknown"', async () => {
  await liveLane(async (agent) => {
    const marker = `marker-cc-${process.pid}-${Date.now()}`;
    agent
      .get('https://api.crossref.org')
      .intercept({ path: /^\/works\?filter=updates%3A10\.5555%2Finner-400/, method: 'GET' })
      .reply(200, JSON.stringify({ statusCode: 400, 'message-type': 'exception', message: `bad filter ${marker}` }), { headers: { 'content-type': 'application/json' } });
    const candidates = [makeCandidate({ doi: '10.5555/inner-400', id: '10.5555/inner-400' })];
    await crossCheckRetractions(candidates);
    assert.equal(candidates[0]!.retraction_status, 'unknown');
    assert.equal(candidates[0]!.retracted, false);
    assert.match(retractionCheckReason(candidates[0]!) ?? '', /an inner statusCode 400/);
    assert.deepEqual(cacheMentions(marker), [], 'the error body was not cached');
  });
});
