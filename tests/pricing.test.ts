// tests/pricing.test.ts — table integrity + cost-math + error coverage for
// bin/lib/pricing.ts (W11 sibling A).
//
// Pure tests — no I/O, no env-override, no tmpdir. The pricing module is a
// frozen constant + a pure function so every test runs synchronously against
// in-memory values. Cost-math assertions use the vendor-derived rates
// (anthropic claude-opus-4 $15/$75 per Mtok, claude-sonnet-4 $3/$15,
// gpt-4o-mini $0.15/$0.60); when a vendor changes its pricing the assertion
// constants here MUST be bumped together with bin/lib/pricing.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_PRICES,
  estimateCost,
  UnknownModelError,
} from '../bin/lib/pricing.js';

test('estimateCost: claude-opus-4 1M-in / 1M-out = $15 + $75 = $90', () => {
  const cost = estimateCost({
    providerId: 'anthropic',
    modelId: 'claude-opus-4',
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  assert.equal(cost, 90);
});

test('estimateCost: claude-sonnet-4 100k-in / 50k-out = $0.30 + $0.75 = $1.05', () => {
  const cost = estimateCost({
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4',
    inputTokens: 100_000,
    outputTokens: 50_000,
  });
  // 0.1 * 3 + 0.05 * 15 = 0.3 + 0.75 = 1.05
  assert.ok(
    Math.abs(cost - 1.05) < 1e-9,
    `expected ~1.05, got ${cost}`,
  );
});

test('estimateCost: gpt-4o-mini 1M-in / 1M-out = $0.15 + $0.60 = $0.75', () => {
  const cost = estimateCost({
    providerId: 'openai',
    modelId: 'gpt-4o-mini',
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  // 0.15 + 0.60 = 0.75
  assert.ok(
    Math.abs(cost - 0.75) < 1e-9,
    `expected ~0.75, got ${cost}`,
  );
});

test('estimateCost throws UnknownModelError for unknown provider', () => {
  assert.throws(
    () => estimateCost({
      providerId: 'mystery-vendor',
      modelId: 'x',
      inputTokens: 0,
      outputTokens: 0,
    }),
    (e: unknown) => e instanceof UnknownModelError,
  );
});

test('estimateCost throws UnknownModelError for unknown model on known provider', () => {
  assert.throws(
    () => estimateCost({
      providerId: 'anthropic',
      modelId: 'imaginary-model-9000',
      inputTokens: 0,
      outputTokens: 0,
    }),
    (e: unknown) => e instanceof UnknownModelError,
  );
});

test('estimateCost throws RangeError on negative input tokens', () => {
  assert.throws(
    () => estimateCost({
      providerId: 'anthropic',
      modelId: 'claude-opus-4',
      inputTokens: -1,
      outputTokens: 0,
    }),
    (e: unknown) => e instanceof RangeError,
  );
});

test('MODEL_PRICES is deeply frozen (outer + each inner provider record + each leaf ModelPrice — FLAG-03)', () => {
  assert.ok(Object.isFrozen(MODEL_PRICES), 'MODEL_PRICES outer must be frozen');
  assert.ok(
    Object.isFrozen(MODEL_PRICES.anthropic),
    'MODEL_PRICES.anthropic must be frozen',
  );
  assert.ok(
    Object.isFrozen(MODEL_PRICES.openai),
    'MODEL_PRICES.openai must be frozen',
  );
  // FLAG-03 regression: every leaf ModelPrice value object must ALSO be
  // frozen. The pre-fix code froze only the outer record and each provider
  // record but left the leaves writable. Verify at least one well-known
  // leaf — exhaustive coverage follows in the loop below.
  assert.ok(
    Object.isFrozen(MODEL_PRICES.anthropic?.['claude-opus-4']),
    'MODEL_PRICES.anthropic[claude-opus-4] leaf must be frozen (FLAG-03)',
  );
  // Exhaustive: every leaf across every provider must be frozen.
  for (const [providerKey, models] of Object.entries(MODEL_PRICES)) {
    for (const [modelKey, price] of Object.entries(models)) {
      assert.ok(
        Object.isFrozen(price),
        `MODEL_PRICES.${providerKey}[${modelKey}] leaf must be frozen`,
      );
    }
  }
  // Behavioral assertion: under strict mode, an assignment to a frozen
  // leaf field must THROW (this file is an ES module, which is strict by
  // default). Verifies the freeze is enforced, not just declared.
  assert.throws(
    () => {
      (MODEL_PRICES.anthropic!['claude-opus-4'] as { inputPerMtok: number }).inputPerMtok = 99;
    },
    TypeError,
    'mutation of a frozen leaf must throw TypeError under strict mode',
  );
});

test('every entry has non-negative rates and currency=USD', () => {
  for (const [provider, models] of Object.entries(MODEL_PRICES)) {
    for (const [model, price] of Object.entries(models)) {
      assert.ok(
        price.inputPerMtok >= 0,
        `${provider}/${model} inputPerMtok must be >= 0 (got ${price.inputPerMtok})`,
      );
      assert.ok(
        price.outputPerMtok >= 0,
        `${provider}/${model} outputPerMtok must be >= 0 (got ${price.outputPerMtok})`,
      );
      assert.equal(
        price.currency,
        'USD',
        `${provider}/${model} currency must be USD (got ${price.currency})`,
      );
    }
  }
});

test('table contains required Phase-1 entries (claude-opus-4, claude-sonnet-4, gpt-4o-mini)', () => {
  assert.ok(
    MODEL_PRICES.anthropic?.['claude-opus-4'],
    'anthropic/claude-opus-4 must be in MODEL_PRICES',
  );
  assert.ok(
    MODEL_PRICES.anthropic?.['claude-sonnet-4'],
    'anthropic/claude-sonnet-4 must be in MODEL_PRICES',
  );
  assert.ok(
    MODEL_PRICES.openai?.['gpt-4o-mini'],
    'openai/gpt-4o-mini must be in MODEL_PRICES',
  );
});
