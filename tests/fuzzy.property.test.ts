// tests/fuzzy.property.test.ts — Wave 0 stub for D-11 property tests.
// fast-check properties: JW(a,a)=1, symmetric, ∈[0,1]; Levenshtein triangle inequality.
//
// Production code required: bin/lib/fuzzy.ts
// Until then: existence assertion fires RED; property tests skip gracefully.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as fc from 'fast-check';

const fuzzyPath = new URL('../bin/lib/fuzzy.ts', import.meta.url);

test('fuzzy.property: bin/lib/fuzzy.ts exists (D-11 property gate)', () => {
  assert.ok(
    existsSync(fuzzyPath),
    'MISSING: bin/lib/fuzzy.ts — property tests cannot run without the fuzzy module',
  );
});

const skip = !existsSync(fuzzyPath);
const nonEmptyString = fc.string({ minLength: 1, maxLength: 50 });

test('fuzzy.property: jaroWinkler(a, a) === 1 for all non-empty strings (D-11)',
  { skip },
  async () => {
    // @ts-expect-error — bin/lib/fuzzy.ts lands in Wave 2 (D-11)
    const { jaroWinkler } = await import('../bin/lib/fuzzy.js');
    fc.assert(
      fc.property(nonEmptyString, (a) => {
        const score = jaroWinkler(a, a);
        assert.equal(score, 1, `jaroWinkler("${a}", "${a}") must equal 1`);
      }),
      { numRuns: 100 },
    );
  },
);

test('fuzzy.property: jaroWinkler is symmetric — JW(a,b) === JW(b,a) (D-11)',
  { skip },
  async () => {
    // @ts-expect-error — bin/lib/fuzzy.ts lands in Wave 2 (D-11)
    const { jaroWinkler } = await import('../bin/lib/fuzzy.js');
    fc.assert(
      fc.property(nonEmptyString, nonEmptyString, (a, b) => {
        const ab = jaroWinkler(a, b);
        const ba = jaroWinkler(b, a);
        assert.ok(
          Math.abs(ab - ba) < 1e-10,
          `jaroWinkler not symmetric: JW("${a}","${b}")=${ab} vs JW("${b}","${a}")=${ba}`,
        );
      }),
      { numRuns: 200 },
    );
  },
);

test('fuzzy.property: jaroWinkler ∈ [0,1] for all string pairs (D-11)',
  { skip },
  async () => {
    // @ts-expect-error — bin/lib/fuzzy.ts lands in Wave 2 (D-11)
    const { jaroWinkler } = await import('../bin/lib/fuzzy.js');
    fc.assert(
      fc.property(nonEmptyString, nonEmptyString, (a, b) => {
        const score = jaroWinkler(a, b);
        assert.ok(score >= 0 && score <= 1, `jaroWinkler("${a}","${b}") = ${score} out of [0,1]`);
      }),
      { numRuns: 200 },
    );
  },
);

test('fuzzy.property: levenshtein(a,a) === 0 for all strings (D-11)',
  { skip },
  async () => {
    // @ts-expect-error — bin/lib/fuzzy.ts lands in Wave 2 (D-11)
    const { levenshtein } = await import('../bin/lib/fuzzy.js');
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 50 }), (a) => {
        assert.equal(levenshtein(a, a), 0, `levenshtein("${a}","${a}") must equal 0`);
      }),
      { numRuns: 100 },
    );
  },
);

test('fuzzy.property: levenshtein is symmetric (D-11)',
  { skip },
  async () => {
    // @ts-expect-error — bin/lib/fuzzy.ts lands in Wave 2 (D-11)
    const { levenshtein } = await import('../bin/lib/fuzzy.js');
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 30 }), fc.string({ minLength: 0, maxLength: 30 }), (a, b) => {
        assert.equal(
          levenshtein(a, b),
          levenshtein(b, a),
          `levenshtein not symmetric: d("${a}","${b}") != d("${b}","${a}")`,
        );
      }),
      { numRuns: 200 },
    );
  },
);

test('fuzzy.property: levenshtein satisfies triangle inequality (D-11)',
  { skip },
  async () => {
    // @ts-expect-error — bin/lib/fuzzy.ts lands in Wave 2 (D-11)
    const { levenshtein } = await import('../bin/lib/fuzzy.js');
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 20 }),
        fc.string({ minLength: 0, maxLength: 20 }),
        fc.string({ minLength: 0, maxLength: 20 }),
        (a, b, c) => {
          const ab = levenshtein(a, b);
          const bc = levenshtein(b, c);
          const ac = levenshtein(a, c);
          assert.ok(
            ac <= ab + bc,
            `Triangle inequality violated: d("${a}","${c}")=${ac} > d("${a}","${b}")=${ab} + d("${b}","${c}")=${bc}`,
          );
        },
      ),
      { numRuns: 100 },
    );
  },
);
