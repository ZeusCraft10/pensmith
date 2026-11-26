// bin/lib/anthropic.ts — complete(), the one entry point for model calls.
//
// Every model call in pensmith goes through complete(). It applies the rules
// every call follows, in this order, and hands the request itself to a
// Generator (bin/lib/generator.ts):
//   1. PENSMITH_NO_LLM=1 returns a flagged placeholder, before any key or
//      network is touched (the test stub; verify, compile and done refuse it);
//   2. offline (--offline, --dry-run) refuses, since a model call is egress;
//   3. the provider, model, effort and token limits come from runtime.json
//      (bin/lib/llm-config.ts) and the role's defaults;
//   4. the API key is read from the provider's environment variable;
//   5. the budget is checked against what was spent plus this call's
//      estimate, before anything is sent (bin/lib/budget.ts);
//   6. the generator runs: generators/anthropic.ts on the official SDK, or
//      generators/openai.ts for OpenAI-compatible servers, both through
//      bin/lib/http.ts;
//   7. the tokens the provider reports are priced and written to
//      .paper/COSTS.jsonl, also when the call failed after using some;
//   8. only then is the answer checked: cut off at the token limit
//      (TruncatedError), declined (RefusalError), empty, or not the JSON a
//      schema asked for are typed errors, so nothing truncated or refused is
//      ever saved as a section.
//
// The API key is never logged or written anywhere; it reaches only the
// request header.

import { loadRuntimeConfig, getProviderApiKey, MissingApiKeyError } from './runtime.js';
import { appendCost, assertBudget } from './budget.js';
import type { BudgetSpec } from './budget.js';
import { estimateCost } from './pricing.js';
import { noLlmPlaceholderText } from './placeholder.js';
import { isOfflineMode, OfflineEgressError } from './network-mode.js';
import { resolveCall, type ResolvedCall } from './llm-config.js';
import {
  GenerationError,
  RefusalError,
  TruncatedError,
  type Effort,
  type Generator,
  type LlmRole,
  type UsageRow,
} from './generator.js';
import { anthropicGenerator } from './generators/anthropic.js';
import { openAiGenerator } from './generators/openai.js';

export { MissingApiKeyError };
export {
  GenerationError,
  ProviderError,
  RefusalError,
  TruncatedError,
  type Generator,
  type LlmRole,
} from './generator.js';

// ============================================================
//   Public types
// ============================================================

export interface CompleteOptions {
  /** The system prompt; empty for none. */
  system: string;
  /** Conversation turns. Must be non-empty; the last turn must be 'user' (no prefill). */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** The step the call is for; it picks the default effort and token limits. Defaults to 'task'. */
  role?: LlmRole;
  /** Use this model, whatever runtime.json says. */
  model?: string;
  /** The output limit, thinking included. Defaults to the role's. */
  maxTokens?: number;
  /** How many output tokens the call is expected to use, for the cost-cap check. Defaults to the role's. */
  expectedOutputTokens?: number;
  /** Defaults to the role's effort in runtime.json, then the role's default. */
  effort?: Effort;
  /** A JSON Schema the answer must follow; the parsed answer is returned as `json`. */
  jsonSchema?: Record<string, unknown>;
  /** Per-scope budget cap in USD. Defaults to DEFAULT_CAP_USD. */
  scopeCapUsd?: number;
  /** Labels for the cost ledger row. */
  scope?: BudgetSpec['scope'];
  scopeId?: string;
}

/** Default per-scope budget cap in USD. */
const DEFAULT_CAP_USD = 0.50;

export interface CompleteResult {
  /** The answer's text (thinking left out). */
  text: string;
  /** Input tokens the provider reported, over every model that ran. */
  inputTokens: number;
  /** Output tokens the provider reported, thinking included. */
  outputTokens: number;
  /** The model that produced the answer. */
  model?: string;
  /** What the call cost, as written to COSTS.jsonl. */
  costUsd?: number;
  /** The parsed answer, when a jsonSchema was given. */
  json?: unknown;
  /** True when no model ran (PENSMITH_NO_LLM): `text` is a placeholder, not content. */
  placeholder?: boolean;
}

// ============================================================
//   Offline-mode predicate
// ============================================================

/** True when PENSMITH_NO_LLM=1: every model call returns a placeholder. */
export function isNoLlmMode(): boolean {
  return process.env['PENSMITH_NO_LLM'] === '1';
}

/**
 * The runtime.json key of the provider pensmith uses: the first one listed, or
 * 'anthropic' (the default config's only entry). Verbs check its API key
 * before they start, with this same choice.
 */
export async function resolveProviderId(): Promise<string> {
  const cfg = await loadRuntimeConfig();
  return Object.keys(cfg.providers ?? {})[0] ?? 'anthropic';
}

// ============================================================
//   Generator selection
// ============================================================

let generatorOverride: Generator | null = null;

/**
 * Tests only: make every complete() call use `gen` (null restores the real
 * providers). No API key is needed while it is set; every other rule applies.
 */
export function _setGeneratorForTest(gen: Generator | null): void {
  generatorOverride = gen;
}

async function generatorFor(call: ResolvedCall): Promise<Generator> {
  if (generatorOverride) return generatorOverride;
  // The key value goes only to the generator, which puts it in a request header.
  const apiKey = await getProviderApiKey(call.providerId);
  return call.providerName === 'openai'
    ? openAiGenerator({ apiKey, ...(call.baseUrl ? { baseUrl: call.baseUrl } : {}) })
    : anthropicGenerator({ apiKey, ...(call.baseUrl ? { baseUrl: call.baseUrl } : {}) });
}

// ============================================================
//   Cost
// ============================================================

/** Characters per token for the pre-call estimate; current tokenizers give a little under 4. */
const CHARS_PER_TOKEN = 3.5;

function costOf(call: ResolvedCall, rows: readonly UsageRow[]): number {
  return rows.reduce((sum, r) => sum + estimateCost({
    provider: call.providerName,
    modelId: r.model,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cacheReadTokens: r.cacheReadTokens,
    cacheWriteTokens: r.cacheWriteTokens,
    ...(call.pricePerMtok ? { override: call.pricePerMtok } : {}),
  }), 0);
}

/** Write one COSTS.jsonl row per model the call used; returns the total. */
async function recordCost(call: ResolvedCall, rows: readonly UsageRow[], scope: BudgetSpec['scope'], scopeId: string): Promise<number> {
  let total = 0;
  for (const r of rows) {
    const costUsd = costOf(call, [r]);
    total += costUsd;
    await appendCost({
      ts: new Date().toISOString(),
      scope,
      scopeId,
      provider: call.providerName,
      model: r.model,
      inputTokens: r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens,
      outputTokens: r.outputTokens,
      costUsd,
    });
  }
  return total;
}

// ============================================================
//   complete()
// ============================================================

function assertMessages(messages: CompleteOptions['messages']): void {
  if (messages.length === 0) throw new Error('anthropic.ts: complete() requires at least one message');
  const last = messages[messages.length - 1];
  if (last?.role !== 'user') {
    throw new Error(`anthropic.ts: the last message must have role 'user'; got '${last?.role}'`);
  }
}

/**
 * Make one model call, under the rules in the file header.
 *
 * @throws MissingApiKeyError — the provider's key variable is not set
 * @throws BudgetExceededError — the call could take its scope past its cap
 * @throws OfflineEgressError — offline, and the call would need the network
 * @throws TruncatedError / RefusalError / ProviderError / GenerationError —
 *   the call did not give a usable answer (its cost is still recorded)
 */
export async function complete(opts: CompleteOptions): Promise<CompleteResult> {
  assertMessages(opts.messages);

  if (isNoLlmMode()) {
    return {
      text: noLlmPlaceholderText(opts.messages.at(-1)?.content ?? ''),
      inputTokens: 0,
      outputTokens: 0,
      placeholder: true,
    };
  }

  const call = await resolveCall({
    role: opts.role ?? 'task',
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.effort ? { effort: opts.effort } : {}),
    ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
    ...(opts.expectedOutputTokens ? { expectedOutputTokens: opts.expectedOutputTokens } : {}),
  });
  if (isOfflineMode() && !generatorOverride) throw new OfflineEgressError(call.endpoint);
  const generator = await generatorFor(call);

  const chars = opts.system.length + opts.messages.reduce((n, m) => n + m.content.length, 0);
  const estimateUsd = costOf(call, [{
    model: call.model,
    inputTokens: Math.ceil(chars / CHARS_PER_TOKEN),
    outputTokens: call.expectedOutputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }]);
  const scope = opts.scope ?? 'task';
  const scopeId = opts.scopeId ?? call.role;
  await assertBudget({ scope, scopeId, cap: opts.scopeCapUsd ?? DEFAULT_CAP_USD }, estimateUsd);

  let result;
  try {
    result = await generator.generate({
      model: call.model,
      system: opts.system,
      messages: opts.messages,
      maxTokens: call.maxTokens,
      ...(call.effort ? { effort: call.effort } : {}),
      ...(opts.jsonSchema ? { jsonSchema: opts.jsonSchema } : {}),
    });
  } catch (err) {
    const used = err instanceof GenerationError ? err.usage : [];
    if (used.length > 0) await recordCost(call, used, scope, scopeId);
    throw err;
  }
  const costUsd = await recordCost(call, result.usage, scope, scopeId);

  if (result.stop === 'truncated') throw new TruncatedError(result.model, call.maxTokens);
  if (result.stop === 'refused') {
    throw new RefusalError(result.model, result.refusal?.category ?? null, result.refusal?.explanation ?? null);
  }
  if (result.stop !== 'complete') {
    throw new GenerationError('LLM_INCOMPLETE', `${result.model} stopped without finishing its answer (${result.stopReason ?? 'no stop reason'}); nothing was saved.`);
  }
  if (result.text.trim() === '') {
    throw new GenerationError('LLM_EMPTY', `${result.model} returned no text; nothing was saved.`);
  }
  let json: unknown;
  if (opts.jsonSchema) {
    try {
      json = JSON.parse(result.text);
    } catch {
      throw new GenerationError('LLM_BAD_JSON', `${result.model} did not return the JSON the step asked for; nothing was saved.`);
    }
  }

  return {
    text: result.text,
    inputTokens: result.usage.reduce((n, r) => n + r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens, 0),
    outputTokens: result.usage.reduce((n, r) => n + r.outputTokens, 0),
    model: result.model,
    costUsd,
    ...(opts.jsonSchema ? { json } : {}),
  };
}
