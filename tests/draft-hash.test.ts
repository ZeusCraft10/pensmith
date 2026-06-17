// tests/draft-hash.test.ts — D-07 per-section verified_against_draft_hash input.
//
// RED-first: bin/lib/draft-hash.ts does not exist yet.
//
// D-07 (LOCKED) input shape:
//   SHA-256( DRAFT.md bytes + '\n' + JSON.stringify(assignedSources.slice().sort()) )
//   - single '\n' separator
//   - sources sorted via Array.prototype.sort (lexicographic), NOT a Set
//   - NO byte normalization on the draft (no BOM strip, no CRLF→LF)
//   - this is a PER-SECTION hash (the section's own DRAFT.md), not the compiled draft.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { computeDraftHash } from '../bin/lib/draft-hash.js';

/** Reference implementation of the LOCKED D-07 recipe, for cross-checking. */
function reference(bytes: Buffer, sources: string[]): string {
  const h = createHash('sha256');
  h.update(bytes);
  h.update('\n');
  h.update(JSON.stringify(sources.slice().sort()));
  return h.digest('hex');
}

test('D-07: empty sources hashes draft + "\\n" + "[]"', () => {
  const bytes = Buffer.from('# Section\n\nBody.\n', 'utf8');
  const got = computeDraftHash(bytes, []);
  assert.equal(got, reference(bytes, []));
  // Spot-check the exact recipe (no Set, single '\n').
  const manual = createHash('sha256').update(bytes).update('\n').update('[]').digest('hex');
  assert.equal(got, manual, 'empty sources must serialize as the literal "[]"');
});

test('D-07: single citekey', () => {
  const bytes = Buffer.from('draft', 'utf8');
  const got = computeDraftHash(bytes, ['smith2020']);
  assert.equal(got, reference(bytes, ['smith2020']));
  const manual = createHash('sha256').update(bytes).update('\n').update('["smith2020"]').digest('hex');
  assert.equal(got, manual);
});

test('D-07: multiple citekeys are sorted alphabetically before serialization', () => {
  const bytes = Buffer.from('draft', 'utf8');
  const unsorted = ['zeta2021', 'alpha2019', 'mid2020'];
  const got = computeDraftHash(bytes, unsorted);
  const manual = createHash('sha256')
    .update(bytes)
    .update('\n')
    .update('["alpha2019","mid2020","zeta2021"]')
    .digest('hex');
  assert.equal(got, manual, 'sources must be sorted lexicographically');
  // Order-independence: any permutation of the same set yields the same hash.
  const got2 = computeDraftHash(bytes, ['mid2020', 'zeta2021', 'alpha2019']);
  assert.equal(got, got2, 'hash must be invariant to input source order');
});

test('D-07: computeDraftHash does NOT mutate the input sources array', () => {
  const bytes = Buffer.from('draft', 'utf8');
  const input = ['c', 'a', 'b'];
  computeDraftHash(bytes, input);
  assert.deepEqual(input, ['c', 'a', 'b'], 'input array must be sliced, not sorted in place');
});

test('D-07: CRLF bytes are NOT normalized (CRLF and LF drafts hash differently)', () => {
  const crlf = Buffer.from('# Section\r\n\r\nBody.\r\n', 'utf8');
  const lf = Buffer.from('# Section\n\nBody.\n', 'utf8');
  const hCrlf = computeDraftHash(crlf, []);
  const hLf = computeDraftHash(lf, []);
  assert.notEqual(hCrlf, hLf, 'CRLF must not be normalized to LF — bytes-as-stored (D-07)');
  assert.equal(hCrlf, reference(crlf, []));
});

test('D-07: a UTF-8 BOM is preserved (NOT stripped)', () => {
  const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('draft', 'utf8')]);
  const without = Buffer.from('draft', 'utf8');
  assert.notEqual(
    computeDraftHash(withBom, []),
    computeDraftHash(without, []),
    'a UTF-8 BOM must be included in the hash input — no BOM strip (D-07)',
  );
  assert.equal(computeDraftHash(withBom, []), reference(withBom, []));
});
