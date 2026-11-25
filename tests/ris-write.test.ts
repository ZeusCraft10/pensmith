// tests/ris-write.test.ts — CITATIONS.ris as research writes it, through the
// library (tests/lib/library-views.ts): RIS2001 records (the spec Mendeley and
// EndNote read), an empty file for no candidates, and no record for a
// candidate with no identifier.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';
import { throughLibrary } from './lib/library-views.js';

/** CITATIONS.ris after research merges `candidates` into a new project's library. */
async function risOf(candidates: SourceCandidate[]): Promise<string> {
  return readFileSync((await throughLibrary(candidates)).risPath, 'utf8');
}

// The fixtures of tests/bibtex-write.test.ts, each with a DOI.
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

test('CITATIONS.ris: one RIS2001 record per work (TY  - JOUR ... ER  -)', async () => {
  const body = await risOf(fixtures);
  assert.match(body, /TY\s+-\s+JOUR/, 'RIS2001 TY  - JOUR tag present');
  assert.match(body, /ER\s+-/, 'RIS2001 ER  - terminator present');
  assert.equal(
    (body.match(/^TY\s+-/gm) ?? []).length,
    fixtures.length,
    'exactly fixtures.length TY  - records emitted',
  );
});

test('CITATIONS.ris: no candidates still writes the file, empty', async () => {
  const body = await risOf([]);
  assert.equal(body.trim(), '', 'an empty file (but the file exists)');
});

test('CITATIONS.ris: a candidate with no identifier gets no record, without throwing', async () => {
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
  const body = await risOf([...fixtures, noIdCandidate]);
  assert.equal(
    (body.match(/^TY\s+-/gm) ?? []).length,
    3,
    'only the 3 with DOIs remain',
  );
});
