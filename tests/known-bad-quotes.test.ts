// tests/known-bad-quotes.test.ts — Wave 0 stub for SC-3 / VRFY-04.
// Tests: Pass-3 flags 10/10 fixtures in known-bad-quotes.json as NOT_FOUND.
//
// The fixture (known-bad-quotes.json) is created in Task 0.3.
// Production code required: verifier Pass 3 entrypoint (bin/lib/verifier.ts)
// Until then: existence assertion fires RED; behavioral test skips gracefully.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixturePath = fileURLToPath(new URL('../tests/fixtures/known-bad-quotes.json', import.meta.url));
const verifyCliPath = new URL('../bin/cli/verify.ts', import.meta.url);

// Distortion artifact codepoints from D-06 / known-bad-quotes spec.
// At least 5 entries must carry one of these in their claimed_quote.
const DISTORTION_CODEPOINTS = [
  'ﬁ',  // U+FB01 LATIN SMALL LIGATURE FI
  '­',  // U+00AD SOFT HYPHEN
  '“',  // U+201C LEFT DOUBLE QUOTATION MARK
  '”',  // U+201D RIGHT DOUBLE QUOTATION MARK
  '—',  // U+2014 EM DASH
  '̀',  // U+0300 COMBINING GRAVE ACCENT (diacritic)
  '́',  // U+0301 COMBINING ACUTE ACCENT
  '̈',  // U+0308 COMBINING DIAERESIS (ï, ë, etc.)
  'é',  // U+00E9 LATIN SMALL LETTER E WITH ACUTE (é)
  'ï',  // U+00EF LATIN SMALL LETTER I WITH DIAERESIS (ï)
];

test('known-bad-quotes: fixture file exists (SC-3)', () => {
  assert.ok(
    existsSync(fixturePath),
    'MISSING: tests/fixtures/known-bad-quotes.json — Task 0.3 must create this fixture',
  );
});

test('known-bad-quotes: fixture contains ≥ 10 entries with expected_verdict: "NOT_FOUND" (SC-3)',
  { skip: !existsSync(fixturePath) },
  () => {
    const fixtures = JSON.parse(readFileSync(fixturePath, 'utf-8')) as unknown[];
    assert.ok(Array.isArray(fixtures), 'known-bad-quotes.json must be a JSON array');
    assert.ok(fixtures.length >= 10, `known-bad-quotes.json must have ≥ 10 entries, has ${fixtures.length}`);
    for (const entry of fixtures) {
      const e = entry as Record<string, unknown>;
      assert.equal(
        e['expected_verdict'],
        'NOT_FOUND',
        `Every entry must have expected_verdict: "NOT_FOUND", got: ${JSON.stringify(e['expected_verdict'])}`,
      );
    }
  },
);

test('known-bad-quotes: ≥ 5 entries carry distortion-artifact codepoints in claimed_quote (SC-3)',
  { skip: !existsSync(fixturePath) },
  () => {
    const fixtures = JSON.parse(readFileSync(fixturePath, 'utf-8')) as Array<Record<string, unknown>>;
    let distortionCount = 0;
    for (const entry of fixtures) {
      const claimed = entry['claimed_quote'] as string;
      if (DISTORTION_CODEPOINTS.some(cp => claimed.includes(cp))) {
        distortionCount++;
      }
    }
    assert.ok(
      distortionCount >= 5,
      `known-bad-quotes.json must have ≥ 5 entries with distortion-artifact codepoints, has ${distortionCount}`,
    );
  },
);

test('known-bad-quotes: bin/cli/verify.ts production module exists (SC-3)',
  { skip: !existsSync(fixturePath) },
  () => {
    assert.ok(
      existsSync(verifyCliPath),
      'MISSING: bin/cli/verify.ts — Wave 4 must create before Pass-3 deterministic corpus test can run (SC-3)',
    );
  },
);

test('known-bad-quotes: Pass-3 flags 10/10 fixtures as NOT_FOUND (SC-3, VRFY-04)',
  { skip: !existsSync(fixturePath) || !existsSync(verifyCliPath) },
  async () => {
    // @ts-expect-error — bin/lib/verifier.ts lands in Wave 4 (SC-3, VRFY-04)
    const { verifyPass3 } = await import('../bin/lib/verifier.js');
    const fixtures = JSON.parse(readFileSync(fixturePath, 'utf-8')) as Array<Record<string, unknown>>;

    let notFoundCount = 0;
    for (const entry of fixtures) {
      const verdict = await verifyPass3({
        doi: entry['doi'] as string,
        claimedQuote: entry['claimed_quote'] as string,
      });
      if (verdict === 'NOT_FOUND') {
        notFoundCount++;
      }
    }

    assert.equal(
      notFoundCount,
      fixtures.length,
      `Pass-3 must flag all ${fixtures.length} fixtures as NOT_FOUND, only flagged ${notFoundCount} (SC-3)`,
    );
  },
);
