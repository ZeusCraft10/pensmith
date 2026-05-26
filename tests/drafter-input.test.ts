// tests/drafter-input.test.ts — Wave 0 stub for WRTE-01 / WRTE-04 / T-3-10.
// Tests: assertDrafterInput throws on superset (extra field), throws on missing required.
//
// Production code required: bin/lib/drafter-input.ts
// Until then: existence assertion fires RED; behavioral tests skip gracefully.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as fc from 'fast-check';

const drafterInputPath = new URL('../bin/lib/drafter-input.ts', import.meta.url);

test('drafter-input: bin/lib/drafter-input.ts production module exists (WRTE-01, T-3-10)', () => {
  assert.ok(
    existsSync(drafterInputPath),
    'MISSING: bin/lib/drafter-input.ts — Wave 4 must create before this test passes (WRTE-01 input contract)',
  );
});

const skip = !existsSync(drafterInputPath);

// The exact allowed shape for the drafter input (WRTE-01).
// Section drafter receives ONLY: planPath, sources (array of citekeys), wordTarget, voiceHint.
const VALID_DRAFTER_INPUT = {
  planPath: 'sections/02-background/PLAN.md',
  sources: ['vaswani2017attention', 'devlin2018bert'],
  wordTarget: 300,
  voiceHint: 'Formal academic tone',
};

test('drafter-input: assertDrafterInput accepts exact allowed shape (WRTE-01)',
  { skip },
  async () => {
    // @ts-expect-error — bin/lib/drafter-input.ts lands in Wave 4 (WRTE-01)
    const { assertDrafterInput } = await import('../bin/lib/drafter-input.js');
    // Must NOT throw on a valid input.
    assert.doesNotThrow(
      () => assertDrafterInput(VALID_DRAFTER_INPUT),
      'assertDrafterInput must accept the exact allowed shape',
    );
  },
);

test('drafter-input: assertDrafterInput throws on superset (extra field "cwd") (WRTE-01, T-3-10)',
  { skip },
  async () => {
    // @ts-expect-error — bin/lib/drafter-input.ts lands in Wave 4 (WRTE-01)
    const { assertDrafterInput } = await import('../bin/lib/drafter-input.js');
    const supersetInput = { ...VALID_DRAFTER_INPUT, cwd: '/etc' };
    assert.throws(
      () => assertDrafterInput(supersetInput),
      /superset|extra.*field|unexpected.*key|cwd/i,
      'assertDrafterInput must throw when input has extra "cwd" field (information leak vector — WRTE-04)',
    );
  },
);

test('drafter-input: assertDrafterInput throws on missing required field "planPath" (WRTE-01)',
  { skip },
  async () => {
    // @ts-expect-error — bin/lib/drafter-input.ts lands in Wave 4 (WRTE-01)
    const { assertDrafterInput } = await import('../bin/lib/drafter-input.js');
    const missingPlanPath = { sources: [], wordTarget: 300, voiceHint: '' };
    assert.throws(
      () => assertDrafterInput(missingPlanPath),
      /required|missing|planPath/i,
      'assertDrafterInput must throw when planPath is missing',
    );
  },
);

test('drafter-input: property — forall input with extra key, assertDrafterInput throws (WRTE-01)',
  { skip },
  async () => {
    // @ts-expect-error — bin/lib/drafter-input.ts lands in Wave 4 (WRTE-01)
    const { assertDrafterInput } = await import('../bin/lib/drafter-input.js');
    // Known-bad extra keys that are NOT in the allowed list.
    const EXTRA_KEYS = ['cwd', 'env', 'fullSourcePool', 'paperDir', 'sessionId', 'allSections'];
    const extraKeyArb = fc.constantFrom(...EXTRA_KEYS);

    fc.assert(
      fc.property(extraKeyArb, (extraKey) => {
        const input = { ...VALID_DRAFTER_INPUT, [extraKey]: 'injected' };
        assert.throws(
          () => assertDrafterInput(input),
          `assertDrafterInput must throw on extra key "${extraKey}"`,
        );
      }),
      { numRuns: EXTRA_KEYS.length },
    );
  },
);
