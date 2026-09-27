// tests/cost-fixture.test.ts — determinism + arithmetic tests for
// bin/lib/cost-fixture.ts (TEST-08, D-47, D-48).
//
// The fixture is intentionally pinned to synthetic prices so these tests
// don't break when real provider pricing changes. The "determinism" test
// runs estimateCost twice with the same args 100 times — if any iteration
// produces a different result, the function has hidden state.

import test from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE_PRICES, estimateCost } from '../bin/lib/cost-fixture.js';

test('FIXTURE_PRICES contains all expected models', () => {
  for (const key of [
    'anthropic:claude-opus-5',
    'anthropic:claude-sonnet-5',
    'anthropic:claude-haiku-4-5',
    'openai:gpt-6-astra',
    'openai:gpt-6-luna',
  ]) {
    assert.ok(key in FIXTURE_PRICES, `missing ${key}`);
  }
});

test('estimateCost: opus-5 input 1M tok = $5.00', () => {
  assert.equal(estimateCost('anthropic', 'claude-opus-5', 1_000_000, 0), 5.00);
});

test('estimateCost: opus-5 output 1M tok = $25.00', () => {
  assert.equal(estimateCost('anthropic', 'claude-opus-5', 0, 1_000_000), 25.00);
});

test('estimateCost: opus-5 mixed 0.5M+0.5M = $15.00', () => {
  // 0.5M input @ $5/Mtok = $2.50; 0.5M output @ $25/Mtok = $12.50; total $15.00.
  assert.equal(estimateCost('anthropic', 'claude-opus-5', 500_000, 500_000), 15.00);
});

test('estimateCost: zero tokens = $0', () => {
  assert.equal(estimateCost('anthropic', 'claude-opus-5', 0, 0), 0);
});

test('estimateCost: unknown provider/model returns 0', () => {
  assert.equal(estimateCost('unknown', 'unknown', 1_000_000, 1_000_000), 0);
  assert.equal(estimateCost('anthropic', 'fictional-model-2099', 1_000_000, 0), 0);
});

test('estimateCost: deterministic across 100 iterations (same inputs → same output)', () => {
  const a = estimateCost('anthropic', 'claude-opus-5', 12345, 67890);
  for (let i = 0; i < 100; i++) {
    const b = estimateCost('anthropic', 'claude-opus-5', 12345, 67890);
    assert.equal(a, b, `iteration ${i}: drift ${a} vs ${b}`);
  }
});
