// tests/draft-hash.test.ts
// D-07 computeDraftHash — SHA-256(draftBytes + '\n' + JSON.stringify(sources.slice().sort()))
// No normalization: CRLF preserved, BOM preserved.
// Sources sorted alphabetically (deterministic array, NOT Set).
//
// RED — bin/lib/draft-hash.ts does not exist yet.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Helper: compute expected hash per D-07 spec
function expectedHash(draftBytes: Buffer, sources: string[]): string {
  const sorted = sources.slice().sort();
  const hashInput = Buffer.concat([
    draftBytes,
    Buffer.from('\n', 'utf8'),
    Buffer.from(JSON.stringify(sorted), 'utf8'),
  ]);
  return createHash('sha256').update(hashInput).digest('hex');
}

test('draft-hash: empty sources → hash(draft + "\\n" + "[]") (D-07)', async () => {
  const { computeDraftHash } = await import('../bin/lib/draft-hash.js').catch(() => {
    throw new Error('bin/lib/draft-hash.ts not implemented yet (RED)');
  });

  const draft = Buffer.from('# Section\n\nSome content.\n', 'utf8');
  const result = computeDraftHash(draft, []);
  const expected = expectedHash(draft, []);
  assert.equal(result, expected, 'empty sources must produce hash(draft + "\\n" + "[]")');
  assert.equal(result.length, 64, 'must be 64-char hex SHA-256');
});

test('draft-hash: single citekey source (D-07)', async () => {
  const { computeDraftHash } = await import('../bin/lib/draft-hash.js').catch(() => {
    throw new Error('bin/lib/draft-hash.ts not implemented yet (RED)');
  });

  const draft = Buffer.from('Text with [@vaswani2017].\n', 'utf8');
  const sources = ['vaswani2017'];
  const result = computeDraftHash(draft, sources);
  const expected = expectedHash(draft, sources);
  assert.equal(result, expected);
});

test('draft-hash: multiple sources sorted alphabetically (D-07 — sorted array, NOT Set)', async () => {
  const { computeDraftHash } = await import('../bin/lib/draft-hash.js').catch(() => {
    throw new Error('bin/lib/draft-hash.ts not implemented yet (RED)');
  });

  const draft = Buffer.from('Text with multiple citations.\n', 'utf8');
  // Provide in non-alphabetical order; the function must sort them
  const sourcesUnsorted = ['zhang2021', 'aaronson2010', 'brown2020'];
  const sourcesSorted = ['aaronson2010', 'brown2020', 'zhang2021'];  // what JSON.stringify will see

  const result = computeDraftHash(draft, sourcesUnsorted);
  const expected = expectedHash(draft, sourcesSorted);
  assert.equal(result, expected, 'sources must be sorted before hashing');

  // Verify that passing already-sorted sources gives the same result
  const result2 = computeDraftHash(draft, sourcesSorted);
  assert.equal(result, result2, 'sort must be stable — same result regardless of input order');
});

test('draft-hash: CRLF draft NOT normalized (D-07 — no CRLF→LF normalization)', async () => {
  const { computeDraftHash } = await import('../bin/lib/draft-hash.js').catch(() => {
    throw new Error('bin/lib/draft-hash.ts not implemented yet (RED)');
  });

  const draftLF = Buffer.from('# Section\n\nContent.\n', 'utf8');
  const draftCRLF = Buffer.from('# Section\r\n\r\nContent.\r\n', 'utf8');

  const hashLF = computeDraftHash(draftLF, []);
  const hashCRLF = computeDraftHash(draftCRLF, []);

  // CRLF and LF must produce DIFFERENT hashes (no normalization)
  assert.notEqual(hashLF, hashCRLF, 'CRLF draft must NOT be normalized to LF (D-07)');

  // Each must match the expected hash for its exact bytes
  assert.equal(hashLF, expectedHash(draftLF, []));
  assert.equal(hashCRLF, expectedHash(draftCRLF, []));
});

test('draft-hash: BOM preserved (D-07 — no BOM strip)', async () => {
  const { computeDraftHash } = await import('../bin/lib/draft-hash.js').catch(() => {
    throw new Error('bin/lib/draft-hash.ts not implemented yet (RED)');
  });

  // UTF-8 BOM = 0xEF 0xBB 0xBF
  const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
  const content = Buffer.from('# Section\n\nContent.\n', 'utf8');
  const draftWithBOM = Buffer.concat([bom, content]);
  const draftNoBOM = content;

  const hashWithBOM = computeDraftHash(draftWithBOM, []);
  const hashNoBOM = computeDraftHash(draftNoBOM, []);

  // BOM and non-BOM must produce DIFFERENT hashes (no BOM strip)
  assert.notEqual(hashWithBOM, hashNoBOM, 'BOM must NOT be stripped (D-07)');

  // Each must match the expected hash for its exact bytes
  assert.equal(hashWithBOM, expectedHash(draftWithBOM, []));
  assert.equal(hashNoBOM, expectedHash(draftNoBOM, []));
});

test('draft-hash: deterministic — same inputs always same output (D-07 pure function)', async () => {
  const { computeDraftHash } = await import('../bin/lib/draft-hash.js').catch(() => {
    throw new Error('bin/lib/draft-hash.ts not implemented yet (RED)');
  });

  const draft = Buffer.from('# Section\n\nRepeatable content.\n', 'utf8');
  const sources = ['cite1', 'cite2'];

  const h1 = computeDraftHash(draft, sources);
  const h2 = computeDraftHash(draft, sources);
  const h3 = computeDraftHash(draft, sources);
  assert.equal(h1, h2, 'hash must be deterministic (run 1 vs run 2)');
  assert.equal(h2, h3, 'hash must be deterministic (run 2 vs run 3)');
});

test('draft-hash: function is pure (no I/O, no network)', async () => {
  // Structural assertion: draft-hash.ts must not import node:fs or any network module
  const { readFileSync, existsSync } = await import('node:fs');
  const hashPath = new URL('../bin/lib/draft-hash.ts', import.meta.url);
  if (!existsSync(hashPath)) {
    throw new Error('bin/lib/draft-hash.ts not implemented yet (RED)');
  }
  const src = readFileSync(hashPath, 'utf8');
  assert.ok(!src.includes("from 'node:fs'") && !src.includes('from "node:fs"'),
    'draft-hash.ts must not import node:fs (pure function)');
  assert.ok(!src.includes("from 'node:net'") && !src.includes("from 'node:http'"),
    'draft-hash.ts must not import network modules');
});
