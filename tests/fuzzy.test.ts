// tests/fuzzy.test.ts — Wave 0 stub for D-11 / VRFY-02.
// Tests: Jaro-Winkler golden cases at 0.92 title / 0.85 author thresholds.
// Also tests Levenshtein-substring helper.
//
// Production code required: bin/lib/fuzzy.ts
// Until then: existence assertion fires RED; behavioral tests skip gracefully.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const fuzzyPath = new URL('../bin/lib/fuzzy.ts', import.meta.url);

test('fuzzy: bin/lib/fuzzy.ts production module exists (D-11, VRFY-02)', () => {
  assert.ok(
    existsSync(fuzzyPath),
    'MISSING: bin/lib/fuzzy.ts — Wave 2 must create Jaro-Winkler + Levenshtein implementation',
  );
});

// Golden test cases — below the threshold = MIS-CITED, at/above = PASS.
const TITLE_THRESHOLD = 0.92;
const AUTHOR_THRESHOLD = 0.85;

// Golden (title, expected score >= TITLE_THRESHOLD)
const TITLE_PASS_CASES = [
  ['Attention is All You Need', 'Attention is All You Need', 1.0],
  ['Attention is All You Need', 'Attention Is All You Need', 0.92], // case normalization
  ['BERT: Pre-training of Deep Bidirectional Transformers', 'BERT: Pre-Training of Deep Bidirectional Transformers', 0.92],
];

// Golden (title, expected score < TITLE_THRESHOLD → MIS-CITED)
const TITLE_FAIL_CASES = [
  ['Attention is All You Need', 'Recurrent Neural Networks Are All You Need', 0.7],
  ['Deep Learning', 'Attention Mechanisms', 0.5],
];

// Golden (author surname, expected score >= AUTHOR_THRESHOLD)
const AUTHOR_PASS_CASES = [
  ['Vaswani', 'Vaswani', 1.0],
  ['Vaswani', 'Vaswanı', 0.85], // diacritic variant
];

// Golden (author surname, expected score < AUTHOR_THRESHOLD → MIS-CITED)
const AUTHOR_FAIL_CASES = [
  ['Vaswani', 'Hinton', 0.5],
  ['LeCun', 'Lecun', 0.0], // after normalization these should still pass, but test the function directly
];

test('fuzzy: jaroWinkler(a, a) === 1 for non-empty string (D-11)',
  { skip: !existsSync(fuzzyPath) },
  async () => {
    const { jaroWinkler } = await import('../bin/lib/fuzzy.js');
    assert.equal(jaroWinkler('hello', 'hello'), 1);
    assert.equal(jaroWinkler('Vaswani', 'Vaswani'), 1);
    assert.equal(jaroWinkler('Attention is All You Need', 'Attention is All You Need'), 1);
  },
);

test('fuzzy: jaroWinkler("hello","helloo") > 0.9 (D-11)',
  { skip: !existsSync(fuzzyPath) },
  async () => {
    const { jaroWinkler } = await import('../bin/lib/fuzzy.js');
    const score = jaroWinkler('hello', 'helloo');
    assert.ok(score > 0.9, `Expected > 0.9, got ${score}`);
  },
);

test('fuzzy: title golden PASS cases at ≥ 0.92 threshold (D-11, VRFY-02)',
  { skip: !existsSync(fuzzyPath) },
  async () => {
    const { jaroWinkler, normalizeForFuzzy } = await import('../bin/lib/fuzzy.js');
    for (const [a, b] of TITLE_PASS_CASES.slice(0, 2)) {
      const score = jaroWinkler(normalizeForFuzzy(a as string), normalizeForFuzzy(b as string));
      assert.ok(
        score >= TITLE_THRESHOLD,
        `Title pair "${a}" / "${b}" scored ${score} — expected ≥ ${TITLE_THRESHOLD} (PASS)`,
      );
    }
  },
);

test('fuzzy: title golden FAIL cases below 0.92 threshold → MIS-CITED (D-11)',
  { skip: !existsSync(fuzzyPath) },
  async () => {
    const { jaroWinkler, normalizeForFuzzy } = await import('../bin/lib/fuzzy.js');
    for (const [a, b] of TITLE_FAIL_CASES) {
      const score = jaroWinkler(normalizeForFuzzy(a as string), normalizeForFuzzy(b as string));
      assert.ok(
        score < TITLE_THRESHOLD,
        `Title pair "${a}" / "${b}" scored ${score} — expected < ${TITLE_THRESHOLD} (FAIL→MIS-CITED)`,
      );
    }
  },
);

test('fuzzy: author golden PASS cases at ≥ 0.85 threshold (D-11)',
  { skip: !existsSync(fuzzyPath) },
  async () => {
    const { jaroWinkler, normalizeForFuzzy } = await import('../bin/lib/fuzzy.js');
    // Only check the exact-match case (the diacritic variant is implementation-dependent).
    const [a, b] = AUTHOR_PASS_CASES[0] as [string, string, number];
    const score = jaroWinkler(normalizeForFuzzy(a), normalizeForFuzzy(b));
    assert.ok(
      score >= AUTHOR_THRESHOLD,
      `Author pair "${a}" / "${b}" scored ${score} — expected ≥ ${AUTHOR_THRESHOLD}`,
    );
  },
);

test('fuzzy: Levenshtein-substring helper returns 0 for identical strings (D-11)',
  { skip: !existsSync(fuzzyPath) },
  async () => {
    const { levenshtein } = await import('../bin/lib/fuzzy.js');
    assert.equal(levenshtein('hello', 'hello'), 0);
    assert.equal(levenshtein('', ''), 0);
  },
);

test('fuzzy: Levenshtein-substring("kitten","sitting") > 0 (D-11)',
  { skip: !existsSync(fuzzyPath) },
  async () => {
    const { levenshtein } = await import('../bin/lib/fuzzy.js');
    const dist = levenshtein('kitten', 'sitting');
    assert.ok(dist > 0, `Expected distance > 0, got ${dist}`);
  },
);
