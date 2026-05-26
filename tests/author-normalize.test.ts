// tests/author-normalize.test.ts — D-11 Pass-1 first-author surname extractor.
//
// Plan 03-01 (Wave 1) Task 1.3. The Wave 0 SUMMARY lists this test as
// expected-to-exist but the actual scaffold did not include it; this file
// is created alongside the production module per the plan's acceptance
// criteria ("tests/author-normalize.test.ts GREEN with ≥10 cases covering
// all 7 categories above").
//
// Categories exercised (per Plan 03-01 Task 1.3 <behavior>):
//   1. Comma-separated: "Vaswani, A." → "vaswani"
//   2. Initials-prefix: "A. Vaswani" → "vaswani"
//   3. Multi-given-name: "Aidan N. Gomez" → "gomez"
//   4. Dutch particle, surname-first: "van den Berg, R." → "van den berg"
//   5. Particle in middle: "R. van den Berg" → "van den berg"
//   6. Hyphenated + diacritic: "Müller-Schmidt" → "muller-schmidt"
//   7. Cross-form consistency: "Wu, Y." vs "Yuxin Wu" both → "wu"
// Plus empty-input safety + batch normalizeAuthorList.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const authorNormPath = new URL('../bin/lib/author-normalize.ts', import.meta.url);

test('author-normalize: bin/lib/author-normalize.ts production module exists (D-11)', () => {
  assert.ok(
    existsSync(authorNormPath),
    'MISSING: bin/lib/author-normalize.ts — Plan 03-01 Task 1.3 creates this module',
  );
});

const skip = !existsSync(authorNormPath);

// Category 1: Comma-separated, surname-first
test('author-normalize: "Vaswani, A." → "vaswani" (comma surname-first, D-11)',
  { skip },
  async () => {
    const { firstAuthorSurname } = await import('../bin/lib/author-normalize.js');
    assert.equal(firstAuthorSurname('Vaswani, A.'), 'vaswani');
  },
);

// Category 2: Initials-prefix, given-name first
test('author-normalize: "A. Vaswani" → "vaswani" (initials-prefix, D-11)',
  { skip },
  async () => {
    const { firstAuthorSurname } = await import('../bin/lib/author-normalize.js');
    assert.equal(firstAuthorSurname('A. Vaswani'), 'vaswani');
  },
);

// Category 3: Multi-given-name with middle initial
test('author-normalize: "Aidan N. Gomez" → "gomez" (multi-given-name, D-11)',
  { skip },
  async () => {
    const { firstAuthorSurname } = await import('../bin/lib/author-normalize.js');
    assert.equal(firstAuthorSurname('Aidan N. Gomez'), 'gomez');
  },
);

// Category 4: Dutch particle, surname-first form
test('author-normalize: "van den Berg, R." → "van den berg" (Dutch particle, surname-first, D-11)',
  { skip },
  async () => {
    const { firstAuthorSurname } = await import('../bin/lib/author-normalize.js');
    assert.equal(firstAuthorSurname('van den Berg, R.'), 'van den berg');
  },
);

// Category 5: Particle in middle, given-name-first form
test('author-normalize: "R. van den Berg" → "van den berg" (particle in middle, D-11)',
  { skip },
  async () => {
    const { firstAuthorSurname } = await import('../bin/lib/author-normalize.js');
    assert.equal(firstAuthorSurname('R. van den Berg'), 'van den berg');
  },
);

// Category 6: Hyphenated surname with diacritic
test('author-normalize: "Müller-Schmidt" → "muller-schmidt" (hyphenated + diacritic, D-11)',
  { skip },
  async () => {
    const { firstAuthorSurname } = await import('../bin/lib/author-normalize.js');
    assert.equal(firstAuthorSurname('Müller-Schmidt'), 'muller-schmidt');
  },
);

// Category 7a: Cross-form consistency — comma form
test('author-normalize: "Wu, Y." → "wu" (cross-form, comma side, D-11)',
  { skip },
  async () => {
    const { firstAuthorSurname } = await import('../bin/lib/author-normalize.js');
    assert.equal(firstAuthorSurname('Wu, Y.'), 'wu');
  },
);

// Category 7b: Cross-form consistency — given-first form. MUST produce
// IDENTICAL output to 7a (this is the AND-gate-correctness invariant).
test('author-normalize: "Yuxin Wu" → "wu" (cross-form, given-first side, D-11)',
  { skip },
  async () => {
    const { firstAuthorSurname } = await import('../bin/lib/author-normalize.js');
    assert.equal(firstAuthorSurname('Yuxin Wu'), 'wu');
  },
);

// Category 7c: Cross-form CONSISTENCY (direct equality assertion)
test('author-normalize: cross-form invariant — "Wu, Y." === "Yuxin Wu" (D-11 AND-gate)',
  { skip },
  async () => {
    const { firstAuthorSurname } = await import('../bin/lib/author-normalize.js');
    assert.equal(
      firstAuthorSurname('Wu, Y.'),
      firstAuthorSurname('Yuxin Wu'),
      'Surname extractor MUST converge on the same canonical form regardless of comma- or given-first input shape',
    );
  },
);

// Empty-input safety
test('author-normalize: "" → "" (empty-input safety, D-11)',
  { skip },
  async () => {
    const { firstAuthorSurname } = await import('../bin/lib/author-normalize.js');
    assert.equal(firstAuthorSurname(''), '');
  },
);

// Whitespace-only safety (empty after trim)
test('author-normalize: "   " → "" (whitespace-only safety, D-11)',
  { skip },
  async () => {
    const { firstAuthorSurname } = await import('../bin/lib/author-normalize.js');
    assert.equal(firstAuthorSurname('   '), '');
  },
);

// Batch surface — normalizeAuthorList
test('author-normalize: normalizeAuthorList maps each author to its surname (D-11)',
  { skip },
  async () => {
    const { normalizeAuthorList } = await import('../bin/lib/author-normalize.js');
    const authors = ['Vaswani, A.', 'Shazeer, N.', 'Parmar, N.', 'Müller-Schmidt'];
    const surnames = normalizeAuthorList(authors);
    assert.deepEqual(surnames, ['vaswani', 'shazeer', 'parmar', 'muller-schmidt']);
  },
);

// Additional defense-in-depth: a complex particled surname with multiple particles
test('author-normalize: "Garcia de la Cruz" → "de la cruz" (multi-particle, D-11)',
  { skip },
  async () => {
    const { firstAuthorSurname } = await import('../bin/lib/author-normalize.js');
    // Note: this is "de la cruz" (full multi-particle surname), not "garcia"
    // (which would be the surname for "Maria Garcia"). The particle-extension
    // step absorbs BOTH "de" and "la" leftward from "cruz".
    assert.equal(firstAuthorSurname('Garcia de la Cruz'), 'de la cruz');
  },
);
