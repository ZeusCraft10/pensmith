// bin/lib/anthropic.ts — LLM completion chokepoint (GEN-01).
//
// SOLE call site for LLM REST completions in the repo. All LLM network I/O
// routes through bin/lib/http.ts (D-06 chokepoint) — this module MUST NOT
// import undici, http, node:http, https, node:https, or any vendor SDK
// networking layer. @anthropic-ai/sdk and openai are imported for TypeScript
// TYPES ONLY (never call new Anthropic(...) or new OpenAI(...) — those bypass
// the D-06 chokepoint and violate the ESLint ban on undici outside http.ts).
//
// Critical no-leak property (T-01-07): the resolved API key VALUE is never
// logged, never written to disk, never interpolated into any log call.
// Passed ONLY as the Authorization/x-api-key header VALUE to http.ts::fetch().
// noCache:true on every LLM POST prevents the Authorization header from
// reaching any cache file (defense-in-depth alongside http.ts's filterHeaders).
//
// Call order inside complete() (load-bearing — do NOT reorder):
//   1. isNoLlmMode() offline short-circuit FIRST (before key resolution)
//   2. loadRuntimeConfig() + provider/model resolution
//   3. getProviderApiKey() — propagates MissingApiKeyError on missing env var
//   4. estimateCost() + assertBudget() BEFORE any fetch (budget gate)
//   5. fetch() via http.ts with method:'POST', noCache:true, source:'generic'
//   6. appendCost() with ACTUAL usage tokens from the provider response

import type Anthropic from '@anthropic-ai/sdk';                  // types only — no network
import type { ChatCompletion } from 'openai/resources/index.js'; // types only — no network

/** Alias for the Anthropic Messages API response type (type import only). */
type AnthropicMessage = Anthropic.Message;
import { fetch } from './http.js';
import {
  loadRuntimeConfig,
  getProviderApiKey,
  MissingApiKeyError,
} from './runtime.js';
import {
  assertBudget,
  appendCost,
  type BudgetSpec,
} from './budget.js';
import { estimateCost } from './pricing.js';

// Re-export MissingApiKeyError so callers only need one import for the common
// error case (fail-loud verb handlers).
export { MissingApiKeyError };

// ============================================================
//   Public types
// ============================================================

export interface CompleteOptions {
  /** The system prompt passed to the provider. */
  system: string;
  /** Conversation turns. Must be non-empty; the last turn must be 'user'. */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Override the runtime-config defaultModel (e.g. 'claude-haiku-4', 'gpt-4o'). */
  model?: string;
  /** Max tokens for the completion. Defaults to DEFAULT_MAX_TOKENS. */
  maxTokens?: number;
  /** Per-call budget cap in USD (passed to assertBudget). Defaults to DEFAULT_CAP_USD. */
  scopeCapUsd?: number;
  /** Budget scope. Defaults to 'task'. */
  scope?: BudgetSpec['scope'];
  /** Budget scope ID. Defaults to 'llm-call'. */
  scopeId?: string;
}

export interface CompleteResult {
  /** The assistant's response text. */
  text: string;
  /** Actual input tokens charged by the provider. */
  inputTokens: number;
  /** Actual output tokens charged by the provider. */
  outputTokens: number;
}

// ============================================================
//   Module constants
// ============================================================

/** Default max_tokens for completions (matches PASS2/PASS4 section cap precedent). */
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Default per-call budget cap in USD.
 * Matches the PASS2/PASS4 section cap precedent from decisions [05-02]/[05-03].
 */
const DEFAULT_CAP_USD = 0.50;

/** Default model per provider when runtime config has no defaultModel. */
const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-haiku-4',
  openai: 'gpt-4o',
};

// ============================================================
//   Offline-mode predicate (GEN-03 seam)
// ============================================================

/**
 * Returns true when PENSMITH_NO_LLM=1 is set.
 *
 * This is the offline-mode seam for Tier-2 LLM transport. The tier-contract
 * test suite sets PENSMITH_NO_LLM=1 to exercise all six verbs without a
 * real API key. complete() checks this BEFORE any key resolution so
 * MissingApiKeyError is never thrown in offline mode.
 *
 * Mirror of http-mock.ts::isOfflineMode() shape (per PATTERNS.md).
 */
export function isNoLlmMode(): boolean {
  return process.env['PENSMITH_NO_LLM'] === '1';
}

// ============================================================
//   Provider-ID resolution (GEN-06 probe helper)
// ============================================================

/**
 * Resolve the active provider ID from runtime config.
 *
 * This is the SINGLE source of truth for provider-ID resolution.
 * Both the verb-level GEN-06 fail-loud probes and complete() use this
 * function so that switching from 'anthropic' to 'openai' in runtime.json
 * updates the probe and the completion call site simultaneously.
 *
 * Returns the first configured provider ID, or 'anthropic' as default
 * (matching the runtime.ts schema defaults that seed 'anthropic' on first run).
 */
export async function resolveProviderId(): Promise<string> {
  const cfg = await loadRuntimeConfig();
  const providerIds = Object.keys(cfg.providers ?? {});
  return providerIds[0] ?? 'anthropic';
}

// ============================================================
//   Provider request/response shapes
// ============================================================

/**
 * Build the Anthropic Messages API request payload.
 * POST https://api.anthropic.com/v1/messages
 * Body: { model, max_tokens, system, messages }
 */
function buildAnthropicRequest(opts: {
  model: string;
  maxTokens: number;
  system: string;
  messages: CompleteOptions['messages'];
}): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      // key value goes here — ONLY here (T-01-07)
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: opts.messages,
    },
  };
}

/**
 * Build the OpenAI Chat Completions API request payload.
 * POST https://api.openai.com/v1/chat/completions
 * Body: { model, max_tokens, messages: [{role:'system',content}, ...messages] }
 */
function buildOpenAiRequest(opts: {
  model: string;
  maxTokens: number;
  system: string;
  messages: CompleteOptions['messages'];
}): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  return {
    url: 'https://api.openai.com/v1/chat/completions',
    headers: {
      // key value goes here — ONLY here via Authorization: Bearer (T-01-07)
      'content-type': 'application/json',
    },
    body: {
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [
        { role: 'system', content: opts.system },
        ...opts.messages,
      ],
    },
  };
}

/**
 * Parse an Anthropic Messages API response body into text + actual usage tokens.
 * Throws a descriptive Error on malformed / unexpected shapes.
 */
function parseAnthropicResponse(rawBody: string): { text: string; inputTokens: number; outputTokens: number } {
  let parsed: AnthropicMessage & { type?: string; error?: unknown };
  try {
    parsed = JSON.parse(rawBody) as AnthropicMessage & { type?: string; error?: unknown };
  } catch {
    throw new Error(
      `anthropic.ts: failed to parse Anthropic response body as JSON (length=${rawBody.length})`,
    );
  }

  // WR-01: handle HTTP-200 Anthropic error-type responses
  // (e.g. {"type":"error","error":{"type":"overloaded_error","message":"..."}}).
  // These have status 200 but signal failure — content[] is absent, so
  // proceeding to contentBlock extraction would produce a misleading error.
  // Cast through unknown to satisfy TS: AnthropicMessage does not have an index
  // signature, so we widen to unknown first before narrowing to Record<string, unknown>.
  const parsedAsRecord = parsed as unknown as Record<string, unknown>;
  if (parsedAsRecord['type'] === 'error') {
    const errDetail = parsedAsRecord['error'];
    const detail = typeof errDetail === 'object' && errDetail !== null
      ? JSON.stringify(errDetail)
      : String(errDetail);
    throw new Error(`anthropic.ts: Anthropic returned an API error response: ${detail}`);
  }

  const contentBlock = parsed.content?.[0];
  if (!contentBlock || contentBlock.type !== 'text' || typeof contentBlock.text !== 'string') {
    throw new Error(
      `anthropic.ts: Anthropic response missing content[0].text — got: ${JSON.stringify(parsed.content?.slice(0, 2))}`,
    );
  }

  const usage = parsed.usage;
  if (
    !usage ||
    typeof usage.input_tokens !== 'number' ||
    typeof usage.output_tokens !== 'number'
  ) {
    throw new Error(
      `anthropic.ts: Anthropic response missing usage.input_tokens / usage.output_tokens — got: ${JSON.stringify(usage)}`,
    );
  }

  return {
    text: contentBlock.text,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
  };
}

/**
 * Parse an OpenAI Chat Completions response body into text + actual usage tokens.
 * Throws a descriptive Error on malformed / unexpected shapes.
 */
function parseOpenAiResponse(rawBody: string): { text: string; inputTokens: number; outputTokens: number } {
  let parsed: ChatCompletion;
  try {
    parsed = JSON.parse(rawBody) as ChatCompletion;
  } catch {
    throw new Error(
      `anthropic.ts: failed to parse OpenAI response body as JSON (length=${rawBody.length})`,
    );
  }

  const choice = parsed.choices?.[0];
  const content = choice?.message?.content;
  // WR-05: treat whitespace-only content as unusable (same as empty/null).
  // OpenAI types content as string|null; typeof null !== 'string' handles null.
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error(
      content === null
        ? `anthropic.ts: OpenAI response has null choices[0].message.content (finish_reason: ${JSON.stringify(choice?.finish_reason)})`
        : `anthropic.ts: OpenAI response missing choices[0].message.content — got: ${JSON.stringify(parsed.choices?.slice(0, 1))}`,
    );
  }

  const usage = parsed.usage;
  if (
    !usage ||
    typeof usage.prompt_tokens !== 'number' ||
    typeof usage.completion_tokens !== 'number'
  ) {
    throw new Error(
      `anthropic.ts: OpenAI response missing usage.prompt_tokens / usage.completion_tokens — got: ${JSON.stringify(usage)}`,
    );
  }

  return {
    text: content,
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
  };
}

// ============================================================
//   complete() — LLM completion entry point (GEN-01)
// ============================================================

/**
 * Single LLM completion call site (GEN-01).
 *
 * ORDERING CONTRACT (load-bearing — the plan's must_haves.truths depend on this):
 *   1. isNoLlmMode() offline seam — returns deterministic mock BEFORE key resolution
 *   2. loadRuntimeConfig + provider/model resolution
 *   3. getProviderApiKey — propagates MissingApiKeyError; key value never logged
 *   4. estimateCost + assertBudget — BEFORE any network call (budget gate)
 *   5. http.ts::fetch with noCache:true — sole network path (D-06)
 *   6. appendCost with ACTUAL usage tokens from provider response
 *
 * @param opts - Completion options (see CompleteOptions).
 * @returns { text, inputTokens, outputTokens }
 * @throws MissingApiKeyError — when no API key is configured for the resolved provider
 * @throws BudgetExceededError — when pre-call estimate would exceed scope cap
 * @throws Error — on HTTP 4xx/5xx or unparseable response body
 */
export async function complete(opts: CompleteOptions): Promise<CompleteResult> {
  // ── Pre-flight: validate message-list invariants (WR-03) ──
  // Enforce the CompleteOptions.messages invariants documented in the JSDoc
  // so callers get a comprehensible programmer error instead of an opaque HTTP 400.
  if (opts.messages.length === 0) {
    throw new Error('anthropic.ts: complete() requires at least one message');
  }
  const lastMsg = opts.messages[opts.messages.length - 1];
  if (lastMsg?.role !== 'user') {
    throw new Error(
      `anthropic.ts: the last message must have role 'user'; got '${lastMsg?.role}'`,
    );
  }

  // ── Step 1: offline short-circuit (MUST be first — before key resolution) ──
  // The tier-contract suite runs with PENSMITH_NO_LLM=1 and NO API key set.
  // Checking here (not at the call site) keeps MissingApiKeyError out of
  // offline paths (Pitfall 6 / decision [05-02..05-03] noLlm-before-key ordering).
  if (isNoLlmMode()) {
    const lastContent = opts.messages.at(-1)?.content ?? '';
    return {
      text: `[PENSMITH_NO_LLM placeholder — ${lastContent.slice(0, 80)}]`,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  // ── Step 2: provider + model resolution via runtime config ──
  // Load config once; resolveProviderId() also calls loadRuntimeConfig() but
  // the verb-level probes (CR-01) call it in isolation. Inside complete() we
  // load directly to avoid two round-trips.
  const cfg = await loadRuntimeConfig();
  const providerIds = Object.keys(cfg.providers ?? {});
  const providerId = providerIds[0] ?? 'anthropic';
  const providerCfg = cfg.providers?.[providerId];

  const providerName = providerCfg?.name ?? 'anthropic';
  const defaultModel =
    providerCfg?.defaultModel ??
    PROVIDER_DEFAULT_MODELS[providerName] ??
    'claude-haiku-4';
  const modelId = opts.model ?? defaultModel;

  // ── Step 3: key resolution (propagates MissingApiKeyError) ──
  // key value is NEVER logged anywhere in this function — T-01-07.
  const key = await getProviderApiKey(providerId);

  // ── Step 4: pre-call budget gate ──
  const scope = opts.scope ?? 'task';
  const scopeId = opts.scopeId ?? 'llm-call';
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

  // Token estimate: char-count / 4 heuristic for budget gate only (acknowledged
  // TOCTOU per CONTEXT.md — actual usage recorded post-call via appendCost).
  const systemChars = opts.system.length;
  const messagesChars = opts.messages.reduce((acc, m) => acc + m.content.length, 0);
  const estimatedInputTokens = Math.ceil((systemChars + messagesChars) / 4);
  const estimateUsd = estimateCost({
    providerId,
    modelId,
    inputTokens: estimatedInputTokens,
    outputTokens: maxTokens,
  });

  const budgetSpec: BudgetSpec = {
    scope,
    scopeId,
    cap: opts.scopeCapUsd ?? DEFAULT_CAP_USD,
  };

  await assertBudget(budgetSpec, estimateUsd); // throws BudgetExceededError if over cap

  // ── Step 5: build provider-specific request + POST via http.ts (D-06) ──
  let url: string;
  let headers: Record<string, string>;
  let requestBody: Record<string, unknown>;

  switch (providerName) {
    case 'anthropic': {
      const req = buildAnthropicRequest({
        model: modelId,
        maxTokens,
        system: opts.system,
        messages: opts.messages,
      });
      url = req.url;
      // Key value injected here ONLY — never interpolated elsewhere (T-01-07).
      headers = { ...req.headers, 'x-api-key': key };
      requestBody = req.body;
      break;
    }
    case 'openai': {
      const req = buildOpenAiRequest({
        model: modelId,
        maxTokens,
        system: opts.system,
        messages: opts.messages,
      });
      url = req.url;
      // Key value injected here ONLY — never interpolated elsewhere (T-01-07).
      headers = { ...req.headers, 'authorization': `Bearer ${key}` };
      requestBody = req.body;
      break;
    }
    default: {
      throw new Error(
        `anthropic.ts: unsupported provider name "${providerName as string}" — expected 'anthropic' or 'openai'`,
      );
    }
  }

  // noCache:true is MANDATORY — prevents the Authorization/x-api-key header
  // from ever reaching a cache file (defense-in-depth; T-11-01 security).
  const httpResponse = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    source: 'generic',
    noCache: true,
  });

  // Non-OK HTTP status → throw a sanitized error (key value must NOT appear
  // in the message; provider error bodies may echo request details but
  // we never interpolate the key itself into the throw message — T-11-01).
  if (httpResponse.status >= 400) {
    // Trim the body to a safe excerpt so logs don't balloon; never include `key`.
    const bodyExcerpt = httpResponse.body.slice(0, 256).replace(/[\r\n]+/g, ' ');
    throw new Error(
      `anthropic.ts: ${providerName} API returned HTTP ${httpResponse.status}: ${bodyExcerpt}`,
    );
  }

  // ── Step 6: parse response + record ACTUAL cost ──
  let text: string;
  let actualIn: number;
  let actualOut: number;

  switch (providerName) {
    case 'anthropic': {
      const parsed = parseAnthropicResponse(httpResponse.body);
      text = parsed.text;
      actualIn = parsed.inputTokens;
      actualOut = parsed.outputTokens;
      break;
    }
    case 'openai': {
      const parsed = parseOpenAiResponse(httpResponse.body);
      text = parsed.text;
      actualIn = parsed.inputTokens;
      actualOut = parsed.outputTokens;
      break;
    }
    default: {
      // TypeScript exhaustive check — unreachable at runtime.
      throw new Error(`anthropic.ts: unreachable provider "${providerName as string}"`);
    }
  }

  // appendCost uses ACTUAL tokens — never the pre-call estimate (Pitfall 5).
  await appendCost({
    ts: new Date().toISOString(),
    scope,
    scopeId,
    provider: providerId as 'anthropic' | 'openai',
    model: modelId,
    inputTokens: actualIn,
    outputTokens: actualOut,
    costUsd: estimateCost({
      providerId,
      modelId,
      inputTokens: actualIn,
      outputTokens: actualOut,
    }),
  });

  return { text, inputTokens: actualIn, outputTokens: actualOut };
}
