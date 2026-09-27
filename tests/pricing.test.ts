// tests/pricing.test.ts — RUN-06 / D-17-18: the pricing table and cost math.
//
// Superseded behaviour (Phase 17): the v0.1 table priced only the invalid
// claude-{opus,sonnet,haiku}-4 ids and threw UnknownModelError for every real
// model id. The table now prices the current Claude and OpenAI models; an
// unknown model gets the config override or the provider's most expensive price
// with ONE warning; local providers price at $0; nothing throws on a user path.
//
// Vendor numbers are asserted on purpose: when a vendor changes its pricing the
// assertion fails and forces a deliberate update of bin/lib/pricing.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_PRICES,
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  _resetPriceWarningsForTest,
  costOf,
  estimateCost,
  resolvePrice,
} from '../bin/lib/pricing.js';
import { MODELS } from '../bin/lib/llm-models.js';

const M = 1_000_000;

test('RUN-06: current Claude prices per MTok (claude-api table, 2026-06-24)', () => {
  const expect: Record<string, [number, number]> = {
    'claude-fable-5-1': [10, 50],
    'claude-fable-5': [10, 50],
    'claude-opus-5-5': [4, 20],
    'claude-opus-5': [5, 25],
    'claude-opus-4-8': [5, 25],
    'claude-opus-4-7': [5, 25],
    'claude-opus-4-6': [5, 25],
    'claude-sonnet-5': [2, 10],
    'claude-sonnet-4-6': [3, 15],
    'claude-haiku-4-5': [1, 5],
  };
  for (const [id, [i, o]] of Object.entries(expect)) {
    assert.equal(estimateCost({ providerId: 'anthropic', modelId: id, inputTokens: M, outputTokens: 0 }), i, `${id} input`);
    assert.equal(estimateCost({ providerId: 'anthropic', modelId: id, inputTokens: 0, outputTokens: M }), o, `${id} output`);
  }
});

test('RUN-06: the default OpenAI models are priced (developers.openai.com pricing, 2026-09-27)', () => {
  assert.equal(estimateCost({ providerId: 'openai', modelId: 'gpt-6-astra', inputTokens: M, outputTokens: M }), 60);
  assert.equal(estimateCost({ providerId: 'openai', modelId: 'gpt-6-luna', inputTokens: M, outputTokens: M }), 0.6);
  assert.equal(estimateCost({ providerId: 'openai', modelId: 'gpt-5', inputTokens: M, outputTokens: M }), 11.25);
});

test('RUN-06: every model in the capability table prices finitely', () => {
  for (const [id, caps] of Object.entries(MODELS)) {
    const usd = estimateCost({ providerId: caps.provider, modelId: id, inputTokens: 12_345, outputTokens: 6_789 });
    assert.ok(Number.isFinite(usd) && usd > 0, `${id} → ${usd}`);
  }
});

test('D-17-18: cache writes cost 1.25x input and cache reads 0.1x (Anthropic)', () => {
  assert.equal(CACHE_WRITE_MULTIPLIER, 1.25);
  assert.equal(CACHE_READ_MULTIPLIER, 0.1);
  const p = resolvePrice('anthropic', 'claude-opus-5');
  assert.equal(p.cacheWritePerMtok, 6.25);
  assert.equal(p.cacheReadPerMtok, 0.5);
  const usd = costOf(p, { inputTokens: M, outputTokens: 0, cacheWriteTokens: M, cacheReadTokens: M });
  assert.equal(usd, 5 + 6.25 + 0.5);
  // A published read price wins over the 0.1x rule.
  assert.equal(resolvePrice('anthropic', 'claude-fable-5-1').cacheReadPerMtok, 0.25);
  // OpenAI caching has no write premium.
  assert.equal(resolvePrice('openai', 'gpt-6-astra').cacheWritePerMtok, 10);
});

test('RUN-06: an unknown model uses the provider-max price with exactly one warning', () => {
  _resetPriceWarningsForTest();
  const lines: string[] = [];
  const warn = (l: string): void => { lines.push(l); };
  const a = resolvePrice('anthropic', 'my-local-finetune', {}, warn);
  const b = resolvePrice('anthropic', 'my-local-finetune', {}, warn);
  assert.equal(a.source, 'fallback');
  assert.equal(a.inputPerMtok, 10);
  assert.equal(a.outputPerMtok, 50);
  assert.deepEqual(b, a);
  assert.equal(lines.length, 1, 'exactly one warning per (provider, model)');
  assert.match(lines[0]!, /no price is known for anthropic\/my-local-finetune/);
  assert.match(lines[0]!, /price_in_per_mtok/);
  // An unknown provider never throws either.
  assert.ok(Number.isFinite(resolvePrice('someprovider', 'x', {}, warn).inputPerMtok));
});

test('RUN-06: the config price override prices unknown and local models, never a known one', () => {
  _resetPriceWarningsForTest();
  const override = { inputPerMtok: 0.7, outputPerMtok: 2.1 };
  const unknown = resolvePrice('openai', 'gpt-private-7', override, () => assert.fail('no warning with an override'));
  assert.equal(unknown.source, 'config');
  assert.equal(unknown.inputPerMtok, 0.7);
  assert.equal(resolvePrice('anthropic', 'claude-haiku-4-5', override).inputPerMtok, 1, 'a known model keeps its table price');
  const local = resolvePrice('ollama', 'qwen2.5', override);
  assert.equal(local.source, 'config');
  assert.equal(local.outputPerMtok, 2.1);
});

test('D-17-18: local providers price at $0 unless configured', () => {
  for (const p of ['ollama', 'vllm', 'openai-compatible']) {
    const price = resolvePrice(p, 'anything');
    assert.equal(price.source, 'local');
    assert.equal(costOf(price, { inputTokens: M, outputTokens: M }), 0);
  }
});

test('estimateCost throws RangeError on negative token counts', () => {
  assert.throws(() => estimateCost({ providerId: 'anthropic', modelId: 'claude-opus-5', inputTokens: -1, outputTokens: 0 }), RangeError);
  assert.throws(() => estimateCost({ providerId: 'anthropic', modelId: 'claude-opus-5', inputTokens: 0, outputTokens: -1 }), RangeError);
});

test('MODEL_PRICES is deeply frozen (outer + provider records + each leaf — FLAG-03)', () => {
  assert.ok(Object.isFrozen(MODEL_PRICES));
  assert.ok(Object.isFrozen(MODEL_PRICES.anthropic));
  assert.ok(Object.isFrozen(MODEL_PRICES.anthropic?.['claude-opus-5']));
  assert.throws(() => {
    (MODEL_PRICES.anthropic!['claude-opus-5'] as { inputPerMtok: number }).inputPerMtok = 99;
  }, TypeError);
});

test('every entry has non-negative rates and currency=USD', () => {
  for (const [provider, table] of Object.entries(MODEL_PRICES)) {
    for (const [model, price] of Object.entries(table)) {
      assert.ok(price.inputPerMtok >= 0 && price.outputPerMtok >= 0, `${provider}/${model}`);
      assert.equal(price.currency, 'USD');
    }
  }
});
