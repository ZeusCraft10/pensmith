// tests/llm-models.test.ts — RUN-06 / RUN-24 / RUN-26 (D-17-17, D-17-24): the
// one model + per-slug table.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODELS,
  MODELS,
  SLUGS,
  SLUG_NAMES,
  _resetModelWarningsForTest,
  defaultModelFor,
  effectiveEffort,
  isProviderName,
  modelCapabilities,
  resolveModelAlias,
  slugSpec,
} from '../bin/lib/llm-models.js';
import { MODEL_PRICES } from '../bin/lib/pricing.js';
import { EXPECTED_PROMPT_HASHES } from '../bin/lib/prompt-loader.js';

/** The retired v0.1 ids, built so no source file carries the bare literal. */
const retired = (family: string): string => ['claude', family, '4'].join('-');

test('RUN-06: default models are valid current ids (claude-opus-5 / claude-haiku-4-5; gpt-6-astra / gpt-6-luna)', () => {
  assert.equal(DEFAULT_MODELS.anthropic.generation, 'claude-opus-5');
  assert.equal(DEFAULT_MODELS.anthropic.judgment, 'claude-haiku-4-5');
  assert.equal(DEFAULT_MODELS.openai.generation, 'gpt-6-astra');
  assert.equal(DEFAULT_MODELS.openai.judgment, 'gpt-6-luna');
  for (const provider of ['anthropic', 'openai'] as const) {
    for (const tier of ['generation', 'judgment'] as const) {
      const id = DEFAULT_MODELS[provider][tier];
      assert.ok(MODELS[id], `${id} is in the capability table`);
      assert.ok(MODEL_PRICES[provider]?.[id], `${id} is priced`);
    }
  }
  assert.equal(defaultModelFor('ollama', 'generation'), null, 'local providers have no default model');
});

test('RUN-06: every retired id aliases to its successor with ONE warning per id', () => {
  _resetModelWarningsForTest();
  const lines: string[] = [];
  const warn = (l: string): void => { lines.push(l); };
  assert.equal(resolveModelAlias(retired('haiku'), warn), 'claude-haiku-4-5');
  assert.equal(resolveModelAlias(retired('haiku'), warn), 'claude-haiku-4-5');
  assert.equal(resolveModelAlias(retired('sonnet'), warn), 'claude-sonnet-5');
  assert.equal(resolveModelAlias(retired('opus'), warn), 'claude-opus-5');
  assert.equal(lines.length, 3, 'one warning per retired id, not per call');
  assert.match(lines[0]!, /not a valid model id; using its successor "claude-haiku-4-5"/);
  assert.equal(resolveModelAlias('claude-opus-4-8', warn), 'claude-opus-4-8', 'current ids pass through');
  assert.equal(resolveModelAlias('my-local-finetune', warn), 'my-local-finetune', 'unknown ids pass through');
  assert.equal(lines.length, 3);
});

test('RUN-24: capabilities — adaptive thinking except Haiku 4.5; no effort on Haiku 4.5', () => {
  for (const id of ['claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-fable-5-1', 'claude-fable-5']) {
    assert.equal(modelCapabilities('anthropic', id).thinking, 'adaptive', id);
    assert.ok(modelCapabilities('anthropic', id).efforts.length > 0, `${id} accepts effort`);
  }
  const haiku = modelCapabilities('anthropic', 'claude-haiku-4-5');
  assert.equal(haiku.thinking, 'none');
  assert.deepEqual(haiku.efforts, []);
  assert.equal(effectiveEffort(haiku, 'low'), null);
  assert.equal(haiku.maxOutputTokens, 64_000);
  // Native structured output on Opus 5, Opus 4.8, Sonnet 5, Haiku 4.5, Fable 5/5.1 only.
  for (const id of ['claude-opus-5', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-fable-5', 'claude-fable-5-1']) {
    assert.equal(modelCapabilities('anthropic', id).structuredOutput, true, id);
  }
  for (const id of ['claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6']) {
    assert.equal(modelCapabilities('anthropic', id).structuredOutput, false, `${id} uses the tolerant parser`);
  }
  // Refusal fallbacks: Opus 5 and Fable only.
  assert.equal(modelCapabilities('anthropic', 'claude-opus-5').refusalFallbacks, true);
  assert.equal(modelCapabilities('anthropic', 'claude-fable-5-1').refusalFallbacks, true);
  assert.equal(modelCapabilities('anthropic', 'claude-sonnet-5').refusalFallbacks, false);
  // xhigh falls back to high where the model lacks it (Opus 4.6).
  assert.equal(effectiveEffort(modelCapabilities('anthropic', 'claude-opus-4-6'), 'xhigh'), 'high');
});

test('RUN-24: unknown and local models get the conservative profile (never a crash)', () => {
  const unknown = modelCapabilities('anthropic', 'claude-some-future-model');
  assert.equal(unknown.known, false);
  assert.equal(unknown.thinking, 'none');
  assert.deepEqual(unknown.efforts, []);
  assert.equal(unknown.structuredOutput, false);
  const local = modelCapabilities('ollama', 'qwen2.5');
  assert.equal(local.structuredOutput, true, 'Ollama/vLLM honour response_format json_schema');
  assert.equal(local.thinking, 'none');
  assert.ok(isProviderName('openai-compatible'));
  assert.equal(isProviderName('bogus'), false);
});

test('RUN-26: every called prompt slug has a spec; generation vs judgment tiers match D-17-24', () => {
  const generation = ['intake-clarifier', 'outline-author', 'section-planner', 'section-drafter', 'smoother', 'revise-swap', 'tutorial-research-rationale', 'tutorial-section-provenance'];
  const judgment = ['topic-disambiguator', 'source-evaluator', 'claim-support', 'orphan-label'];
  for (const s of generation) assert.equal(slugSpec(s).tier, 'generation', s);
  for (const s of judgment) assert.equal(slugSpec(s).tier, 'judgment', s);
  assert.equal(slugSpec('section-drafter').effort, 'high', 'the drafter runs at high effort');
  for (const s of generation.filter((x) => x !== 'section-drafter')) assert.equal(slugSpec(s).effort, 'medium', s);
  for (const s of SLUG_NAMES) {
    const spec = SLUGS[s]!;
    assert.ok(EXPECTED_PROMPT_HASHES[s], `${s} is a hash-pinned prompt slug`);
    assert.ok(spec.p90Output <= spec.maxTokens, `${s}: shipped p90 fits under the max_tokens ceiling`);
    assert.equal(spec.retryMaxTokens, spec.maxTokens * 2, `${s}: the retry doubles max_tokens`);
  }
  assert.throws(() => slugSpec('no-such-slug'), /unknown prompt slug/);
});
