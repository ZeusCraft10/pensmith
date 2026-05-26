// tests/normalize.test.ts — Wave 0 stub for VRFY-04.
// Tests: NFKC + ligature/soft-hyphen/smart-quote/em-dash/diacritic stripping.
//
// Production code required: bin/lib/normalize.ts
// Until then: existence assertion fires RED; behavioral tests skip gracefully.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const normalizePath = new URL('../bin/lib/normalize.ts', import.meta.url);

test('normalize: bin/lib/normalize.ts production module exists (VRFY-04)', () => {
  assert.ok(
    existsSync(normalizePath),
    'MISSING: bin/lib/normalize.ts — Wave 2 must create Unicode normalization module (VRFY-04)',
  );
});

const skip = !existsSync(normalizePath);

test('normalize: ligature fi (U+FB01) → "fi" via NFKC (VRFY-04)',
  { skip },
  async () => {
    const { normalizeText } = await import('../bin/lib/normalize.js');
    // U+FB01 LATIN SMALL LIGATURE FI
    const input = 'ﬁnal';
    const result = normalizeText(input);
    assert.equal(result, 'final', `Expected "final" from NFKC ligature decomposition, got "${result}"`);
  },
);

test('normalize: soft hyphen (U+00AD) is stripped (VRFY-04)',
  { skip },
  async () => {
    const { normalizeText } = await import('../bin/lib/normalize.js');
    // U+00AD SOFT HYPHEN — should be stripped in quote matching context
    const input = 'trans­former';
    const result = normalizeText(input);
    assert.ok(
      !result.includes('­'),
      `Soft hyphen U+00AD must be stripped, got "${result}"`,
    );
    assert.equal(result, 'transformer', `Expected "transformer" after soft-hyphen strip, got "${result}"`);
  },
);

test('normalize: smart quotes (“”) → straight quotes (VRFY-04)',
  { skip },
  async () => {
    const { normalizeText } = await import('../bin/lib/normalize.js');
    // U+201C LEFT DOUBLE QUOTATION MARK, U+201D RIGHT DOUBLE QUOTATION MARK
    const input = '“attention”';
    const result = normalizeText(input);
    assert.ok(
      !result.includes('“') && !result.includes('”'),
      `Smart quotes must be replaced, got "${result}"`,
    );
  },
);

test('normalize: em-dash (U+2014) → hyphen-minus (VRFY-04)',
  { skip },
  async () => {
    const { normalizeText } = await import('../bin/lib/normalize.js');
    // U+2014 EM DASH
    const input = 'end—to—end';
    const result = normalizeText(input);
    assert.ok(
      !result.includes('—'),
      `Em-dash U+2014 must be normalized, got "${result}"`,
    );
    assert.match(result, /end.to.end/, 'Em-dash normalized form must contain end...to...end pattern');
  },
);

test('normalize: diacritic é (U+00E9) → e via NFD + combining-mark strip (VRFY-04)',
  { skip },
  async () => {
    const { normalizeText } = await import('../bin/lib/normalize.js');
    // U+00E9 LATIN SMALL LETTER E WITH ACUTE
    const input = 'naïve';
    const result = normalizeText(input);
    assert.ok(
      !result.includes('ï') && !result.includes('̀') && !result.includes('̈'),
      `Diacritics must be stripped, got "${result}"`,
    );
    assert.equal(result, 'naive', `Expected "naive" after diacritic strip, got "${result}"`);
  },
);
