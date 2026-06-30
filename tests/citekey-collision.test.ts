// tests/citekey-collision.test.ts — audit #21/#31/#32 regression.
//
// The citekey is the primary key shared by LIBRARY.json, CITATIONS.bib, the RIS
// export, and the research keep-sets. Before the fix the collision suffix was
// computed locally inside writeBibtex (a per-base counter) and never written
// back to the candidate set, so:
//   #31 — LIBRARY.json kept the un-suffixed (duplicate) keys while the bib
//         suffixed them → the citekey↔source mapping diverged.
//   #32 — the evaluator/approval keep-sets filtered on a non-unique citekey →
//         pruned the wrong rows.
//   #21 — a per-base counter could re-emit a key equal to another candidate's
//         base (a literal 'wu2017a' alongside a second 'wu2017') → a DUPLICATE.
// assignUniqueCitekeys is now the single global-uniqueness authority.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeBibtex, assignUniqueCitekeys } from '../bin/lib/bibtex-write.js';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';

function cand(citekey: string, doi: string): SourceCandidate {
  return {
    source: 'crossref',
    id: doi,
    doi,
    title: `A Study (${doi})`,
    authors: ['Wu, Wei'],
    year: 2017,
    retracted: false,
    citekey,
    last_verified: '2024-01-01T00:00:00.000Z',
    raw: {},
  } as SourceCandidate;
}

test('assignUniqueCitekeys (#21): same-base collisions get distinct suffixes', () => {
  const out = assignUniqueCitekeys([cand('wu2017', '10.0/a'), cand('wu2017', '10.0/b')]);
  assert.deepEqual(out.map((c) => c.citekey), ['wu2017', 'wu2017a']);
});

test('assignUniqueCitekeys (#21): a base equal to another candidate\'s suffixed form is NOT duplicated', () => {
  // The naive per-base counter would produce ['wu2017','wu2017a','wu2017a'] —
  // the second collision and the literal 'wu2017a' clashing into a DUPLICATE.
  // Global uniqueness bumps the third candidate off 'wu2017a' (the loop appends
  // a further suffix to its base, e.g. 'wu2017aa'), so all three stay distinct.
  const out = assignUniqueCitekeys([
    cand('wu2017', '10.0/a'),
    cand('wu2017', '10.0/b'),
    cand('wu2017a', '10.0/c'),
  ]);
  const keys = out.map((c) => c.citekey);
  assert.equal(keys[0], 'wu2017');
  assert.equal(keys[1], 'wu2017a');
  assert.notEqual(keys[2], keys[1], 'the literal "wu2017a" base must be bumped off the suffixed key');
  assert.equal(new Set(keys).size, 3, `all citekeys must be unique; got ${keys.join(', ')}`);
});

test('assignUniqueCitekeys: already-unique keys pass through unchanged (by reference)', () => {
  const a = cand('smith2020', '10.0/x');
  const b = cand('jones2021', '10.0/y');
  const out = assignUniqueCitekeys([a, b]);
  assert.deepEqual(out.map((c) => c.citekey), ['smith2020', 'jones2021']);
  assert.equal(out[0], a, 'unchanged candidate returned by reference (no churn)');
});

test('writeBibtex (#21/#31): two same-base candidates emit TWO distinct bib citekeys (no duplicate)', async () => {
  const target = join(mkdtempSync(join(tmpdir(), 'pensmith-ckcoll-')), 'CITATIONS.bib');
  await writeBibtex([cand('wu2017', '10.0/a'), cand('wu2017', '10.0/b')], target);
  const bib = readFileSync(target, 'utf8');
  const keys = [...bib.matchAll(/^@\w+\{([^,]+),/gm)].map((m) => m[1]);
  assert.equal(keys.length, 2, `expected 2 bib entries; got ${keys.length}`);
  assert.equal(new Set(keys).size, 2, `bib must have NO duplicate citekey; got: ${keys.join(', ')}`);
});
