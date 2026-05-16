// tests/lib/assert-tier-equivalent.test.ts
//
// Unit tests for the TIER-07 ±20% prose-length tolerance helper.
// Six cases: success + 3 failure modes + custom tolerance + zero-length.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertEquivalent } from './assert-tier-equivalent.js';

test('assertEquivalent: agreement passes', () => {
  assertEquivalent({
    mcpText: 'a'.repeat(100),
    cliText: 'b'.repeat(95),
    mcpFacts: { x: true, y: false },
    cliFacts: { x: true, y: false },
  });
});

test('assertEquivalent: key-set mismatch fails', () => {
  assert.throws(() =>
    assertEquivalent({
      mcpText: 'a',
      cliText: 'b',
      mcpFacts: { x: true },
      cliFacts: { x: true, y: false },
    }),
    /key set mismatch/,
  );
});

test('assertEquivalent: per-key fact divergence fails', () => {
  assert.throws(() =>
    assertEquivalent({
      mcpText: 'a',
      cliText: 'b',
      mcpFacts: { x: true },
      cliFacts: { x: false },
    }),
    /fact divergence/,
  );
});

test('assertEquivalent: >20% length divergence fails', () => {
  assert.throws(() =>
    assertEquivalent({
      mcpText: 'a'.repeat(100),
      cliText: 'b'.repeat(50),  // 50% delta against max(100)
      mcpFacts: { x: true },
      cliFacts: { x: true },
    }),
    /tolerance exceeded/,
  );
});

test('assertEquivalent: custom tolerance is honored', () => {
  assertEquivalent(
    {
      mcpText: 'a'.repeat(100),
      cliText: 'b'.repeat(40),
      mcpFacts: { x: true },
      cliFacts: { x: true },
    },
    { tolerance: 0.65 },  // 60% delta within 65% tolerance
  );
});

test('assertEquivalent: zero-length inputs do not divide-by-zero', () => {
  assertEquivalent({
    mcpText: '',
    cliText: '',
    mcpFacts: { x: true },
    cliFacts: { x: true },
  });
});
