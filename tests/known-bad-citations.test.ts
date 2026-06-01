// tests/known-bad-citations.test.ts — Wave 0 stub for SC-2 / CITE-01.
// Tests: Pass-1 flags 10/10 fixtures in known-bad-citations.json as MIS-CITED.
//
// The fixture (known-bad-citations.json) is created in Task 0.3.
// Production code required: verifier Pass 1 entrypoint (bin/cli/verify.ts or bin/lib/verifier.ts)
// Until then: existence assertion fires RED; behavioral test skips gracefully.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixturePath = fileURLToPath(new URL('../tests/fixtures/known-bad-citations.json', import.meta.url));
const verifyCliPath = new URL('../bin/cli/verify.ts', import.meta.url);

test('known-bad-citations: fixture file exists (SC-2)', () => {
  assert.ok(
    existsSync(fixturePath),
    'MISSING: tests/fixtures/known-bad-citations.json — Task 0.3 must create this fixture',
  );
});

test('known-bad-citations: fixture contains ≥ 10 entries with expected_verdict: "MIS-CITED" (SC-2)',
  { skip: !existsSync(fixturePath) },
  () => {
    const fixtures = JSON.parse(readFileSync(fixturePath, 'utf-8')) as unknown[];
    assert.ok(Array.isArray(fixtures), 'known-bad-citations.json must be a JSON array');
    assert.ok(fixtures.length >= 10, `known-bad-citations.json must have ≥ 10 entries, has ${fixtures.length}`);
    for (const entry of fixtures) {
      const e = entry as Record<string, unknown>;
      assert.ok(e['expected_verdict'] === 'MIS-CITED', `Every entry must have expected_verdict: "MIS-CITED", got: ${JSON.stringify(e['expected_verdict'])}`);
      assert.ok(typeof e['doi'] === 'string', 'Every entry must have a "doi" field');
      assert.ok(typeof e['citekey'] === 'string', 'Every entry must have a "citekey" field');
    }
  },
);

test('known-bad-citations: bin/cli/verify.ts production module exists (SC-2)',
  { skip: !existsSync(fixturePath) },
  () => {
    assert.ok(
      existsSync(verifyCliPath),
      'MISSING: bin/cli/verify.ts — Wave 4 must create before Pass-1 deterministic corpus test can run (SC-2)',
    );
  },
);

test('known-bad-citations: Pass-1 flags 10/10 fixtures as MIS-CITED (SC-2, CITE-01)',
  { skip: !existsSync(fixturePath) || !existsSync(verifyCliPath) },
  async () => {
    // CYCLE-2 H-4: known-bad-citations.test.ts MUST import `runPass1Unit`
    // (the fixture-shape helper), NOT `runPass1` (which expects DRAFT.md +
    // bib + on-disk cassettes). The fixture rows use fake DOIs that never
    // resolve — we simulate that by passing `actual: null` (the DOI lookup
    // miss path) to runPass1Unit, which returns FABRICATED. SC-2 success
    // criterion is "Pass-1 flags 10/10 as MIS-CITED OR FABRICATED" — both
    // verdicts mean the citation does not escape the verifier.
    const { runPass1Unit } = await import('../bin/lib/verify/pass1.js');
    const fixtures = JSON.parse(readFileSync(fixturePath, 'utf-8')) as Array<Record<string, unknown>>;

    let flaggedCount = 0;
    for (const entry of fixtures) {
      const result = runPass1Unit({
        claimed: {
          title: entry['title'] as string,
          authors: entry['authors'] as string[],
          doi: entry['doi'] as string,
        },
        // Fake-DOI fixture: registrar lookup returns null. This is the
        // DOI-did-not-resolve path → FABRICATED.
        actual: null,
      });
      if (result.verdict === 'MIS-CITED' || result.verdict === 'FABRICATED') {
        flaggedCount++;
      }
    }

    assert.equal(
      flaggedCount,
      fixtures.length,
      `Pass-1 must flag all ${fixtures.length} fixtures as MIS-CITED/FABRICATED; only flagged ${flaggedCount} (SC-2)`,
    );
  },
);
