// tests/sources/retraction-cross-check.test.ts — research marks retracted
// candidates from the records it already fetched.
//
// crossCheckRetractions used to ask a Crossref Labs route that answers every
// DOI with an error envelope, so no candidate was ever marked and the bib never
// carried `note = {RETRACTED}`. It now reads the retraction from each
// candidate's own registry record (Crossref `updated-by`, OpenAlex
// `is_retracted`, PubMed's "Retracted Publication" type) and from a
// "RETRACTED:" title, without any request. The records here are the real
// recordings under tests/fixtures/cassettes, read through the adapters.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crossCheckRetractions } from '../../bin/lib/sources/retraction-cross-check.js';
import { fetchById as crossrefFetchById } from '../../bin/lib/sources/crossref.js';
import { fetchById as pubmedFetchById } from '../../bin/lib/sources/pubmed.js';
import { writeBibtex } from '../../bin/lib/bibtex-write.js';
import type { SourceCandidate } from '../../bin/lib/schemas/source-candidate.js';

function candidate(overrides: Partial<SourceCandidate> = {}): SourceCandidate {
  return {
    source: 'semanticscholar',
    id: 'abc',
    title: 'A Paper',
    authors: ['Doe, John'],
    year: 2010,
    retracted: false,
    last_verified: new Date().toISOString(),
    citekey: 'doe2010',
    raw: {},
    ...overrides,
  } as SourceCandidate;
}

/** `fn` with every request refused, so a check that asked the network would fail. */
async function offline<T>(fn: () => T): Promise<T> {
  const saved = process.env['PENSMITH_OFFLINE'];
  process.env['PENSMITH_OFFLINE'] = '1';
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env['PENSMITH_OFFLINE'];
    else process.env['PENSMITH_OFFLINE'] = saved;
  }
}

test('a Crossref candidate whose record lists a retraction is marked retracted, naming the notice, with no request', async () => {
  const c = await crossrefFetchById('10.1016/S0140-6736(97)11096-0');
  assert.ok(c, 'the recorded Wakefield 1998 Crossref record');
  await offline(() => crossCheckRetractions([c]));
  assert.equal(c.retracted, true);
  assert.match(c.retraction_details ?? '', /10\.1016\/s0140-6736\(10\)60175-4/i);
});

test('a PubMed candidate typed "Retracted Publication" is marked retracted', async () => {
  const c = await pubmedFetchById('9500320');
  assert.ok(c, 'the recorded Wakefield 1998 PubMed record');
  await offline(() => crossCheckRetractions([c]));
  assert.equal(c.retracted, true);
  assert.match(c.retraction_details ?? '', /Retracted Publication/);
});

test('an OpenAlex candidate with is_retracted is marked retracted', async () => {
  const c = candidate({ source: 'openalex', raw: { id: 'https://openalex.org/W2117847125', is_retracted: true } });
  await offline(() => crossCheckRetractions([c]));
  assert.equal(c.retracted, true);
  assert.match(c.retraction_details ?? '', /OpenAlex/);
});

test('a candidate from any source titled "RETRACTED: …" or "WITHDRAWN: …" is marked retracted', async () => {
  const cs = [
    candidate({ title: 'RETRACTED: A Paper' }),
    candidate({ title: 'Retracted Article: A Paper', source: 'arxiv' }),
    candidate({ title: 'WITHDRAWN: A Paper', source: 'zotero-mcp' }),
  ];
  await offline(() => crossCheckRetractions(cs));
  assert.deepEqual(cs.map((c) => c.retracted), [true, true, true]);
});

test('an expression of concern, a correction, a retraction notice and a plain record are not marked', async () => {
  const concern = await crossrefFetchById('10.1371/journal.pone.0061107');
  assert.ok(concern, 'the recorded PLOS ONE record under an expression of concern');
  const cs = [
    concern,
    candidate({ source: 'crossref', raw: { DOI: '10.5555/x', 'updated-by': [{ DOI: '10.5555/fix', type: 'correction', label: 'Correction' }] } }),
    candidate({
      source: 'crossref',
      title: 'Retraction: A Paper',
      raw: { DOI: '10.5555/notice', title: ['Retraction: A Paper'], 'update-to': [{ DOI: '10.5555/x', type: 'retraction', label: 'Retraction' }] },
    }),
    candidate({ source: 'openalex', raw: { is_retracted: false } }),
  ];
  await offline(() => crossCheckRetractions(cs));
  assert.deepEqual(cs.map((c) => c.retracted), [false, false, false, false]);
});

test('a marked candidate is written to CITATIONS.bib with note = {RETRACTED}, which Pass 1 reads back', async () => {
  const c = candidate({ source: 'crossref', doi: '10.5555/x', id: '10.5555/x', raw: { DOI: '10.5555/x', 'updated-by': [{ DOI: '10.5555/n', type: 'retraction', label: 'Retraction' }] } });
  crossCheckRetractions([c]);
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-retraction-cc-'));
  try {
    const bibPath = join(dir, 'CITATIONS.bib');
    await writeBibtex([c], bibPath);
    assert.match(readFileSync(bibPath, 'utf8'), /note\s*=\s*\{RETRACTED\}/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
