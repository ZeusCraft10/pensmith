// tests/pricing.test.ts — the price table and cost arithmetic in
// bin/lib/pricing.ts.
//
// The table used to know only model IDs no API serves (claude-opus-4,
// claude-sonnet-4, claude-haiku-4), and it threw UnknownModelError for every
// other name, so no Anthropic configuration could both price and run. It now
// lists the current models by provider name, and a model it does not list is
// priced at the provider's highest listed rates with a warning: it never
// throws. When a vendor changes a rate, change the constants here with
// bin/lib/pricing.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_PRICES, estimateCost, isKnownModel, priceFor } from '../bin/lib/pricing.js';

const M = 1_000_000;
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

function captureStderr<T>(fn: () => T): { value: T; stderr: string } {
  const orig = process.stderr.write.bind(process.stderr);
  let stderr = '';
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stderr.write;
  try {
    return { value: fn(), stderr };
  } finally {
    process.stderr.write = orig;
  }
}

test('current Anthropic models are priced per million input/output tokens', () => {
  const cases: Array<[string, number, number]> = [
    ['claude-opus-5-5', 4, 20],
    ['claude-sonnet-5-5', 2, 10],
    ['claude-haiku-5-5', 0.1, 0.5],
    ['claude-fable-5-2', 8, 40],
  ];
  // 50K prompt tokens: under Claude Haiku 5.5's long-prompt threshold.
  for (const [model, input, output] of cases) {
    assert.ok(near(estimateCost({ provider: 'anthropic', modelId: model, inputTokens: 50_000, outputTokens: 0 }), input * 0.05), `${model} input rate`);
    assert.ok(near(estimateCost({ provider: 'anthropic', modelId: model, inputTokens: 0, outputTokens: M }), output), `${model} output rate`);
  }
});

test('Claude Haiku 5.5 is cheaper up to 100K prompt tokens and dearer past them', () => {
  assert.ok(near(estimateCost({ provider: 'anthropic', modelId: 'claude-haiku-5-5', inputTokens: 100_000, outputTokens: 10_000 }), 0.01 + 0.005));
  assert.ok(near(estimateCost({ provider: 'anthropic', modelId: 'claude-haiku-5-5', inputTokens: 200_000, outputTokens: 10_000 }), 0.1 + 0.025));
});

test('older model IDs that are still served are priced', () => {
  for (const model of ['claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-fable-5-1']) {
    assert.ok(isKnownModel('anthropic', model), `${model} is in the table`);
  }
  // Retired IDs are not.
  for (const model of ['claude-opus-4', 'claude-sonnet-4', 'claude-haiku-4']) {
    assert.equal(isKnownModel('anthropic', model), false, `${model} is not served and not listed`);
  }
});

test('cache reads and writes are priced', () => {
  const cost = estimateCost({ provider: 'anthropic', modelId: 'claude-opus-5-5', inputTokens: 0, outputTokens: 0, cacheReadTokens: M, cacheWriteTokens: M });
  assert.ok(near(cost, 0.2 + 5), `cache read $0.20 plus 5-minute write $5.00 per Mtok (got ${cost})`);
});

test('an unlisted model is priced at the provider\'s highest rates, with a warning, and never throws', () => {
  const { value, stderr } = captureStderr(() =>
    estimateCost({ provider: 'anthropic', modelId: 'claude-imaginary-9', inputTokens: M, outputTokens: M }));
  const highestIn = Math.max(...Object.values(MODEL_PRICES.anthropic!).map((p) => p.longContext?.inputPerMtok ?? p.inputPerMtok));
  const highestOut = Math.max(...Object.values(MODEL_PRICES.anthropic!).map((p) => p.longContext?.outputPerMtok ?? p.outputPerMtok));
  assert.ok(near(value, highestIn + highestOut), `priced at $${highestIn}/$${highestOut} (got ${value})`);
  assert.match(stderr, /no price is listed for anthropic\/claude-imaginary-9/);
  // Only once per model.
  const again = captureStderr(() => estimateCost({ provider: 'anthropic', modelId: 'claude-imaginary-9', inputTokens: 1, outputTokens: 1 }));
  assert.equal(again.stderr, '');
});

test('an unknown provider is priced at the highest rate listed anywhere', () => {
  const { value } = captureStderr(() => priceFor('mystery-vendor', 'x'));
  const all = Object.values(MODEL_PRICES).flatMap((m) => Object.values(m));
  assert.equal(value.outputPerMtok, Math.max(...all.map((p) => p.longContext?.outputPerMtok ?? p.outputPerMtok)));
});

test('rates set in runtime.json replace the table\'s', () => {
  assert.equal(estimateCost({ provider: 'openai', modelId: 'llama3.3', inputTokens: M, outputTokens: M, override: { inputPerMtok: 0, outputPerMtok: 0 } }), 0);
});

test('OpenAI models keep their rates; the gpt-5 placeholder (a copy of gpt-4o) is gone', () => {
  assert.ok(near(estimateCost({ provider: 'openai', modelId: 'gpt-4o-mini', inputTokens: M, outputTokens: M }), 0.75));
  assert.equal(isKnownModel('openai', 'gpt-5'), false);
});

test('estimateCost throws RangeError on negative token counts', () => {
  assert.throws(() => estimateCost({ provider: 'anthropic', modelId: 'claude-opus-5-5', inputTokens: -1, outputTokens: 0 }), RangeError);
  assert.throws(() => estimateCost({ provider: 'anthropic', modelId: 'claude-opus-5-5', inputTokens: 0, outputTokens: 0, cacheReadTokens: -5 }), RangeError);
});

test('MODEL_PRICES is deeply frozen', () => {
  assert.ok(Object.isFrozen(MODEL_PRICES));
  for (const [provider, models] of Object.entries(MODEL_PRICES)) {
    assert.ok(Object.isFrozen(models), `${provider} table frozen`);
    for (const [model, price] of Object.entries(models)) {
      assert.ok(Object.isFrozen(price), `${provider}/${model} frozen`);
    }
  }
  assert.throws(() => {
    (MODEL_PRICES.anthropic!['claude-opus-5-5'] as { inputPerMtok: number }).inputPerMtok = 99;
  }, TypeError);
});

test('every entry has non-negative rates and currency USD', () => {
  for (const [provider, models] of Object.entries(MODEL_PRICES)) {
    for (const [model, price] of Object.entries(models)) {
      assert.ok(price.inputPerMtok >= 0 && price.outputPerMtok >= 0, `${provider}/${model} rates`);
      assert.equal(price.currency, 'USD');
    }
  }
});
