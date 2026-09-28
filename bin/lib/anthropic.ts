// bin/lib/anthropic.ts — THE LLM transport module (GEN-01; RUN-06/07/08, RUN-15,
// RUN-17, RUN-18, RUN-24, RUN-25, RUN-26; D-17-17..D-17-30).
//
// Every completion API call in the repo is built here (chokepoint
// scripts/chokepoints/llm-transport-single-module.json): the Anthropic Messages
// API and the chat-completions shape used by OpenAI, Ollama, vLLM and any
// OpenAI-compatible server. All network I/O goes through bin/lib/http.ts; every
// call sets the V3 `llm: {endpoint}` marker and a `maxBytes` cap. The vendor
// SDKs are imported for TYPES ONLY (audit #7): `new Anthropic()` / `new
// OpenAI()` would bypass the http.ts chokepoint.
//
// complete({slug, …}) — order is load-bearing:
//   1. PENSMITH_NO_LLM → deterministic stub (schema-valid object for structured
//      slugs via llm-stubs.ts, the placeholder string for text slugs); no key,
//      no network, no log.
//   2. Resolve the runtime + the slug's model/effort (runtime.ts, RUN-26).
//   3. Build the provider request (thinking / effort / structured output /
//      cache_control / refusal fallbacks per the model capabilities, RUN-24).
//   4. Replay (RUN-17): under sources-offline with `resume --replay` active,
//      serve the logged response for (slug, sha256(request body)) and never dial.
//   5. Key resolution (runtime.ts; the value is registered for log scrubbing
//      and only ever placed in a request header).
//   6. Session cost cap (budget.ts, RUN-18): projected = input estimate +
//      min(p90, max_tokens) output at the model price; over the cap → the V2
//      cost-cap gate (asks once per session in a terminal, else EXIT_COST_CAP).
//   7. POST via http.ts; parse every content block (thinking / redacted_thinking
//      / fallback blocks ignored; thinking billed as output); branch on the
//      stop reason: refusal → ProviderRefusalError, max_tokens → one retry at
//      2x (streamed above 16k), still truncated → ProviderTruncatedError.
//   8. Every attempt appends its COSTS.jsonl entry and its kind:"llm"
//      SESSION.log record (same cost_usd).
//   9. Structured slugs: validate with the slug's zod schema; one corrective
//      retry after a structural failure; return `data`.
//
// No-leak (T-01-07): the key VALUE appears only in the outbound header object
// handed to http.ts. It is never logged, never in an error message, and every
// SESSION.log line is scrubbed of it (session-log.ts registerSecret).

import type Anthropic from '@anthropic-ai/sdk';                  // types only — no network
import type { ChatCompletion } from 'openai/resources/index.js'; // types only — no network
import { createHash } from 'node:crypto';
import { fetch, isRetryableStatus, type HttpResponse } from './http.js';
import { isOfflineMode } from './http-mock.js';
import {
  getProviderApiKey,
  MissingApiKeyError,
  RuntimeConfigError,
  globalRuntimeConfigPath,
  resolveRuntime,
  resolveSlug,
  type ResolvedRuntime,
  type SlugResolution,
} from './runtime.js';
import { appendCost, reserveSessionBudget, type BudgetReservation } from './budget.js';
import { costOf, resolvePrice } from './pricing.js';
import {
  LOCAL_PROVIDERS,
  NO_PROVIDER_CONFIGURED_HINT,
  effectiveEffort,
  modelCapabilities,
  resolveModelAlias,
  slugSpec,
  wireShapeOf,
  type Effort,
  type ModelCapabilities,
  type ProviderName,
  type SlugSpec,
} from './llm-models.js';
import {
  contractFor,
  correctiveInstruction,
  type ParseOutcome,
  jsonSchemaForSlug,
  parseStructured,
} from './llm-contracts.js';
import { hasStructuredStub, structuredStub, textPlaceholder, type StubHint } from './llm-stubs.js';
import {
  currentSessionId,
  logSessionArgvOnce,
  nextLlmSeq,
  openSessionLog,
  registerSecret,
  sessionLogPathFor,
} from './session-log.js';
import { EXIT_ERROR, PensmithError } from './exit-codes.js';
import { projectRoot } from './paths.js';
import { estimateTokens, p90OutputFor, projectCallUsd, recordOutputSample } from './estimator.js';
import { isReplayActive, replayLookup, type LoggedLlmRecord } from './replay.js';
import { ConfigError, tryReadPaperConfigSync } from './config.js';
import { GateRefusedError } from './gates.js';

export { MissingApiKeyError, RuntimeConfigError };

// ============================================================
//   Public types
// ============================================================

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * The conversation for the RUN-25 corrective retry: the original turns, the
 * model's reply as an assistant turn, then the correction. A reply with no text
 * (only thinking blocks, or empty text blocks) cannot be an assistant turn —
 * the Messages API rejects empty content in any message but a final assistant
 * one (HTTP 400) — so the correction then joins the last user turn instead.
 */
export function correctiveMessages(messages: readonly ChatMessage[], replyText: string, correction: string): ChatMessage[] {
  if (replyText.trim().length > 0) {
    return [...messages, { role: 'assistant', content: replyText }, { role: 'user', content: correction }];
  }
  const out = [...messages];
  const last = out[out.length - 1];
  if (last !== undefined && last.role === 'user') {
    out[out.length - 1] = { role: 'user', content: `${last.content}\n\n${correction}` };
    return out;
  }
  return [...out, { role: 'user', content: correction }];
}

export interface CompleteOptions {
  /** The prompt slug (llm-models.ts SLUGS): drives model, effort, max_tokens and structured output. */
  slug: string;
  /** The system prompt ('' for none). */
  system: string;
  /** Conversation turns; non-empty, and the last turn must be 'user' (no assistant prefill). */
  messages: ChatMessage[];
  /** Section number, for the COSTS/SESSION records and replay. */
  section?: number;
  /** Explicit model id (bypasses per-slug resolution; used by tools and tests). */
  model?: string;
  /** Lower the slug's max_tokens ceiling for this call. */
  maxTokens?: number;
  /** Deterministic-stub hint (e.g. the topic) used only under PENSMITH_NO_LLM. */
  stubHint?: StubHint;
  /** Request timeout (headers + body gaps). Default 600 000 ms. */
  timeoutMs?: number;
}

export interface CompleteResult<T = unknown> {
  /** The concatenated text blocks of the final reply (JSON text for structured slugs). */
  text: string;
  /** The schema-validated object (structured slugs only). */
  data?: T;
  /** Uncached input tokens of the final attempt. */
  inputTokens: number;
  /** Output tokens of the final attempt (thinking included). */
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  /** USD across every attempt of this call (equal to the COSTS.jsonl entries it appended). */
  costUsd: number;
  provider: string;
  model: string;
  servedModel: string;
  stopReason: string;
  /** SESSION.log record id of the final attempt (`<session>:<seq>`), when logged. */
  recordId?: string;
}

// ============================================================
//   Errors (all PensmithError: one line, documented exit code)
// ============================================================

export class ProviderRefusalError extends PensmithError {
  readonly category: string | null;
  constructor(provider: string, model: string, category: string | null, recommendedModel: string | null) {
    super(
      `provider refused (category: ${category ?? 'unspecified'}) — ${provider} model ${model} declined the request` +
        (recommendedModel ? `; the provider suggests retrying on ${recommendedModel} ([runtime] model)` : ''),
      EXIT_ERROR,
    );
    this.name = 'ProviderRefusalError';
    this.category = category;
  }
}

export class ProviderTruncatedError extends PensmithError {
  /**
   * `attempts` is 2 after the RUN-24 retry at a larger budget, or 1 when the
   * first budget already was the model's output ceiling (no larger retry
   * exists). `local` providers are never sent an effort, so lowering it is not
   * offered to them. The advice is what actually helps: less thinking (lower
   * effort) leaves more of the budget for the answer; a shorter input or a
   * model with a larger output limit does too.
   */
  constructor(provider: string, model: string, slug: string, maxTokens: number, opts: { attempts?: number; local?: boolean } = {}) {
    const attempts = opts.attempts ?? 2;
    const what = attempts >= 2
      ? `stopped at max_tokens (${maxTokens}) twice for ${slug}`
      : `stopped at max_tokens (${maxTokens}, its output limit — no larger retry is possible) for ${slug}`;
    const advice = opts.local === true
      ? `shorten the input, or choose a model with a larger output limit ([runtime.slugs.${slug}] model)`
      : `lower the effort ([runtime.slugs.${slug}] effort), shorten the input, or choose a model with a larger ` +
        `output limit ([runtime.slugs.${slug}] model)`;
    super(`${provider} model ${model} ${what}; the truncated reply was discarded and nothing was written — ${advice}`, EXIT_ERROR);
    this.name = 'ProviderTruncatedError';
  }
}

export class ProviderHttpError extends PensmithError {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message, EXIT_ERROR);
    this.name = 'ProviderHttpError';
    this.status = status;
  }
}

export class StructuredOutputError extends PensmithError {
  constructor(slug: string, model: string, detail: string) {
    super(
      `${slug}: the reply from ${model} did not match the required schema after one corrective retry (${detail}); nothing was written`,
      EXIT_ERROR,
    );
    this.name = 'StructuredOutputError';
  }
}

export class ReplayMissError extends PensmithError {
  constructor(slug: string) {
    super(
      `replay: no logged response matches this ${slug} request (its inputs changed since the log was written); ` +
        're-run online without --replay to regenerate it',
      EXIT_ERROR,
    );
    this.name = 'ReplayMissError';
  }
}

/**
 * Errors an ADVISORY caller (source evaluator, Pass 2, Pass 4) must never
 * swallow into its conservative fallback: the session cost cap (the gate's
 * refusal, EXIT_COST_CAP), a missing key or invalid configuration, and a
 * replay miss. Provider failures, refusals, truncation and schema misses stay
 * swallowable for advisory steps.
 */
export function isFatalLlmError(e: unknown): boolean {
  return e instanceof GateRefusedError
    || e instanceof MissingApiKeyError
    || e instanceof RuntimeConfigError
    || e instanceof ConfigError
    || e instanceof ReplayMissError;
}

// ============================================================
//   Mode predicates + provider id
// ============================================================

/** PENSMITH_NO_LLM=1 (also set by --dry-run): every model call returns a deterministic stub. */
export function isNoLlmMode(): boolean {
  return process.env['PENSMITH_NO_LLM'] === '1';
}

/** The resolved provider id (single source of truth shared with complete()). */
export async function resolveProviderId(): Promise<string> {
  return (await resolveRuntime()).provider;
}

function modelConfigKey(rt: ResolvedRuntime, sr: SlugResolution): string {
  switch (sr.modelSource) {
    case 'flag': return '--model';
    case 'slug-config': return `.paper/config.toml [runtime.slugs.${sr.slug}] model`;
    case 'slug-global': return `${globalRuntimeConfigPath()} slugs.${sr.slug}.model`;
    case 'config': return '.paper/config.toml [runtime] model';
    case 'global': return `${globalRuntimeConfigPath()} model`;
    default: return rt.provider === 'anthropic' || rt.provider === 'openai'
      ? '.paper/config.toml [runtime] model (or --model)'
      : '[runtime] model (or --model)';
  }
}

function missingModelError(provider: string): RuntimeConfigError {
  return new RuntimeConfigError(`provider ${provider} has no default model: set [runtime] model or pass --model`);
}

/**
 * Fail fast (before any prompt work) when no LLM can be called (RUN-07). Under
 * PENSMITH_NO_LLM nothing is required. Otherwise the runtime must resolve, a
 * local provider needs a model (and openai-compatible an endpoint), and a
 * hosted provider needs its key variable set. Throws a one-line PensmithError.
 */
export async function assertLlmConfigured(verb: string): Promise<void> {
  if (isNoLlmMode()) return;
  // An offline `resume --replay` serves logged responses and never needs a key.
  if (isReplayActive() && isOfflineMode()) return;
  const rt = await resolveRuntime();
  if (rt.endpoint === null) {
    throw new RuntimeConfigError(
      `pensmith ${verb}: provider ${rt.provider} needs an endpoint — set "endpoint" in ${globalRuntimeConfigPath()}`,
    );
  }
  if (LOCAL_PROVIDERS.has(rt.provider)) {
    if (rt.model === null) throw missingModelError(rt.provider);
    return;
  }
  const envName = rt.apiKeyEnv;
  const v = envName ? process.env[envName] : undefined;
  if (!v) {
    throw new MissingApiKeyError(
      `pensmith ${verb}: no LLM key configured (${envName ?? 'no key variable'} is not set for provider ${rt.provider}). ` +
        `${NO_PROVIDER_CONFIGURED_HINT}. Run inside Claude Code (Tier 1) for key-free operation.`,
    );
  }
}

// ============================================================
//   Wire shapes (anchored on the SDK types; the SDK clients are never constructed)
// ============================================================

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  iterations?: Array<{
    type?: string;
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  }> | null;
}

interface AnthropicBlock {
  type: string;
  text?: string;
  [k: string]: unknown;
}

interface AnthropicMessage {
  type?: string;
  model?: string;
  content?: AnthropicBlock[];
  /** Anthropic.StopReason plus any value a newer API adds (handled as end_turn-like). */
  stop_reason?: Anthropic.StopReason | (string & {}) | null;
  stop_details?: { type?: string; category?: string | null; explanation?: string | null; recommended_model?: string | null } | null;
  usage?: AnthropicUsage;
  error?: { type?: string; message?: string };
}

interface ChatCompletionShape {
  model?: string;
  choices?: Array<{
    message?: { content?: string | Array<{ type?: string; text?: string }> | null; refusal?: string | null };
    finish_reason?: ChatCompletion.Choice['finish_reason'] | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
  };
  error?: { message?: string; type?: string; code?: string | null };
}

/** The normalized result of one provider attempt. */
interface AttemptResult {
  text: string;
  stopReason: string;
  refusalCategory: string | null;
  recommendedModel: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  servedModel: string;
  fallbackUsed: boolean;
}

// ============================================================
//   Request building (RUN-24 policy)
// ============================================================

/** Above this max_tokens a request streams (the non-streaming timeout bound). */
export const STREAM_ABOVE_TOKENS = 16_000;
/** LLM responses are capped at 16 MiB (SEC-03, D-17-05). */
export const LLM_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 600_000;
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

interface CallPlan {
  rt: ResolvedRuntime;
  sr: SlugResolution;
  spec: SlugSpec;
  provider: ProviderName;
  model: string;
  caps: ModelCapabilities;
  effort: Effort | null;
  endpoint: string;
  structured: boolean;
  native: boolean;
  fallbacks: boolean;
  timeoutMs: number;
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

/** Anthropic base URL + path; tolerates a configured base that already ends in /v1. */
export function anthropicUrl(endpoint: string, p: string): string {
  return trimSlash(endpoint).replace(/\/v1$/, '') + '/v1' + p;
}

/** Chat-completions base (already includes /v1 by convention) + path. */
export function chatUrl(endpoint: string, p: string): string {
  return trimSlash(endpoint) + p;
}

function buildAnthropicBody(plan: CallPlan, system: string, messages: ChatMessage[], maxTokens: number, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = { model: plan.model, max_tokens: maxTokens };
  if (system.length > 0) {
    body['system'] = plan.spec.cacheSystem
      ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
      : system;
  }
  body['messages'] = messages.map((m) => ({ role: m.role, content: m.content }));
  if (plan.caps.thinking === 'adaptive') body['thinking'] = { type: 'adaptive' };
  const outputConfig: Record<string, unknown> = {};
  if (plan.effort) outputConfig['effort'] = plan.effort;
  if (plan.native) outputConfig['format'] = { type: 'json_schema', schema: jsonSchemaForSlug(plan.spec.slug, 'standard') };
  if (Object.keys(outputConfig).length > 0) body['output_config'] = outputConfig;
  if (plan.fallbacks) body['fallbacks'] = 'default';
  if (stream) body['stream'] = true;
  return body;
}

function buildChatBody(plan: CallPlan, system: string, messages: ChatMessage[], maxTokens: number, stream: boolean): Record<string, unknown> {
  const all: Array<{ role: string; content: string }> = [];
  if (system.length > 0) all.push({ role: 'system', content: system });
  for (const m of messages) all.push({ role: m.role, content: m.content });
  const body: Record<string, unknown> = { model: plan.model, messages: all };
  const hosted = plan.provider === 'openai';
  if (hosted) body['max_completion_tokens'] = maxTokens;
  else body['max_tokens'] = maxTokens;
  if (hosted && plan.effort) body['reasoning_effort'] = plan.effort;
  if (plan.native) {
    const strict = hosted;
    body['response_format'] = {
      type: 'json_schema',
      json_schema: strict
        ? { name: plan.spec.slug.replace(/[^a-zA-Z0-9_-]/g, '_'), schema: jsonSchemaForSlug(plan.spec.slug, 'openai-strict'), strict: true }
        : { name: plan.spec.slug.replace(/[^a-zA-Z0-9_-]/g, '_'), schema: jsonSchemaForSlug(plan.spec.slug, 'standard') },
    };
  }
  if (stream) {
    body['stream'] = true;
    body['stream_options'] = { include_usage: true };
  }
  return body;
}

function buildBody(plan: CallPlan, system: string, messages: ChatMessage[], maxTokens: number, stream: boolean): Record<string, unknown> {
  return wireShapeOf(plan.provider) === 'anthropic'
    ? buildAnthropicBody(plan, system, messages, maxTokens, stream)
    : buildChatBody(plan, system, messages, maxTokens, stream);
}

function requestUrl(plan: CallPlan): string {
  return wireShapeOf(plan.provider) === 'anthropic'
    ? anthropicUrl(plan.endpoint, '/messages')
    : chatUrl(plan.endpoint, '/chat/completions');
}

function requestHeaders(plan: CallPlan, key: string, stream: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: stream ? 'text/event-stream' : 'application/json',
    // The prompt slug, so the RUN-21 mock (and request captures) can key replies per slug.
    'x-pensmith-slug': plan.spec.slug,
  };
  if (wireShapeOf(plan.provider) === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    if (plan.fallbacks) headers['anthropic-beta'] = FALLBACK_BETA;
    if (key) headers['x-api-key'] = key; // the key reaches ONLY this header (T-01-07)
  } else if (key) {
    headers['authorization'] = `Bearer ${key}`; // only when a key variable is configured and set
  }
  return headers;
}

// ============================================================
//   Response parsing (RUN-24)
// ============================================================

function priceIteration(plan: CallPlan, model: string, u: { input: number; output: number; cw: number; cr: number }): number {
  const price = resolvePrice(plan.provider, model, plan.rt.priceOverride);
  return costOf(price, { inputTokens: u.input, outputTokens: u.output, cacheWriteTokens: u.cw, cacheReadTokens: u.cr });
}

function n(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * A reply with no stop reason is INCOMPLETE — a stream (or a proxy / an
 * OpenAI-compatible server) that ended before the model finished. It is never
 * accepted as a finished answer (RUN-24: always check the stop reason): a
 * partial draft must not be written as a success.
 */
function incompleteReply(plan: CallPlan, field: 'stop_reason' | 'finish_reason'): ProviderHttpError {
  return new ProviderHttpError(
    `${plan.provider} (model ${plan.model}) returned an incomplete reply (no ${field}: the response ended before the ` +
      'model finished); nothing was written — re-run',
    null,
  );
}

function normalizeAnthropic(plan: CallPlan, msg: AnthropicMessage): AttemptResult {
  if (!Array.isArray(msg.content)) {
    throw new ProviderHttpError(`${plan.provider} returned a reply without content blocks for model ${plan.model}`, null);
  }
  if (typeof msg.stop_reason !== 'string' || msg.stop_reason.length === 0) throw incompleteReply(plan, 'stop_reason');
  // Concatenate every text block; thinking, redacted_thinking and fallback blocks are ignored.
  const text = msg.content.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text as string).join('');
  const usage = msg.usage ?? {};
  const servedModel = typeof msg.model === 'string' && msg.model ? msg.model : plan.model;
  const iterations = Array.isArray(usage.iterations) ? usage.iterations : [];
  const fallbackUsed = iterations.some((it) => it.type === 'fallback_message');
  let costUsd = 0;
  if (iterations.length > 0) {
    for (const it of iterations) {
      const model = typeof it.model === 'string' && it.model ? it.model : it.type === 'fallback_message' ? servedModel : plan.model;
      costUsd += priceIteration(plan, model, {
        input: n(it.input_tokens), output: n(it.output_tokens), cw: n(it.cache_creation_input_tokens), cr: n(it.cache_read_input_tokens),
      });
    }
  } else {
    costUsd = priceIteration(plan, servedModel, {
      input: n(usage.input_tokens), output: n(usage.output_tokens), cw: n(usage.cache_creation_input_tokens), cr: n(usage.cache_read_input_tokens),
    });
  }
  return {
    text,
    stopReason: msg.stop_reason,
    refusalCategory: msg.stop_details?.category ?? null,
    recommendedModel: msg.stop_details?.recommended_model ?? null,
    inputTokens: n(usage.input_tokens),
    outputTokens: n(usage.output_tokens),
    cacheWriteTokens: n(usage.cache_creation_input_tokens),
    cacheReadTokens: n(usage.cache_read_input_tokens),
    costUsd,
    servedModel,
    fallbackUsed,
  };
}

function chatText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : '')).join('');
  }
  return '';
}

function normalizeChat(plan: CallPlan, resp: ChatCompletionShape): AttemptResult {
  const choice = resp.choices?.[0];
  if (!choice) throw new ProviderHttpError(`${plan.provider} returned a reply without choices for model ${plan.model}`, null);
  const finish = choice.finish_reason;
  if (typeof finish !== 'string' || finish.length === 0) throw incompleteReply(plan, 'finish_reason');
  const refusal = choice.message?.refusal;
  const prompt = n(resp.usage?.prompt_tokens);
  const cached = Math.min(prompt, n(resp.usage?.prompt_tokens_details?.cached_tokens));
  const output = n(resp.usage?.completion_tokens);
  const servedModel = typeof resp.model === 'string' && resp.model ? resp.model : plan.model;
  const costUsd = priceIteration(plan, servedModel, { input: prompt - cached, output, cw: 0, cr: cached });
  let stopReason: string = finish === 'length' ? 'max_tokens' : finish === 'content_filter' ? 'refusal' : 'end_turn';
  let refusalCategory: string | null = finish === 'content_filter' ? 'content_filter' : null;
  if (typeof refusal === 'string' && refusal.length > 0) {
    stopReason = 'refusal';
    refusalCategory = refusalCategory ?? 'refusal';
  }
  return {
    text: chatText(choice.message?.content),
    stopReason,
    refusalCategory,
    recommendedModel: null,
    inputTokens: prompt - cached,
    outputTokens: output,
    cacheWriteTokens: 0,
    cacheReadTokens: cached,
    costUsd,
    servedModel,
    fallbackUsed: false,
  };
}

/** Parse a buffered SSE body into its `data:` JSON payloads (event names kept). */
export function parseSse(body: string): Array<{ event: string | null; data: unknown }> {
  const out: Array<{ event: string | null; data: unknown }> = [];
  for (const chunk of body.split(/\r?\n\r?\n/)) {
    let event: string | null = null;
    const dataLines: string[] = [];
    for (const line of chunk.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (dataLines.length === 0) continue;
    const raw = dataLines.join('\n');
    if (raw === '[DONE]') {
      out.push({ event, data: '[DONE]' });
      continue;
    }
    try {
      out.push({ event, data: JSON.parse(raw) });
    } catch {
      /* skip a malformed event */
    }
  }
  return out;
}

/** Rebuild an Anthropic Message from a buffered stream (message_start … message_stop). */
export function anthropicFromSse(body: string): AnthropicMessage {
  const msg: AnthropicMessage = { content: [], usage: {} };
  const blocks: AnthropicBlock[] = [];
  for (const { data } of parseSse(body)) {
    if (!data || typeof data !== 'object') continue;
    const d = data as Record<string, unknown>;
    switch (d['type']) {
      case 'message_start': {
        const m = (d['message'] ?? {}) as AnthropicMessage;
        if (m.model) msg.model = m.model;
        msg.usage = { ...(m.usage ?? {}) };
        break;
      }
      case 'content_block_start': {
        const idx = Number(d['index']);
        const cb = (d['content_block'] ?? { type: 'text', text: '' }) as AnthropicBlock;
        blocks[idx] = { ...cb, ...(cb.type === 'text' ? { text: typeof cb.text === 'string' ? cb.text : '' } : {}) };
        break;
      }
      case 'content_block_delta': {
        const idx = Number(d['index']);
        const delta = (d['delta'] ?? {}) as Record<string, unknown>;
        const b = blocks[idx] ?? (blocks[idx] = { type: 'text', text: '' });
        if (delta['type'] === 'text_delta' && typeof delta['text'] === 'string') b.text = (b.text ?? '') + delta['text'];
        break;
      }
      case 'message_delta': {
        const delta = (d['delta'] ?? {}) as Record<string, unknown>;
        if (typeof delta['stop_reason'] === 'string') msg.stop_reason = delta['stop_reason'];
        if (delta['stop_details'] && typeof delta['stop_details'] === 'object') msg.stop_details = (delta['stop_details'] as AnthropicMessage['stop_details']) ?? null;
        msg.usage = { ...(msg.usage ?? {}), ...((d['usage'] ?? {}) as AnthropicUsage) };
        break;
      }
      case 'error': {
        const e = (d['error'] ?? {}) as { type?: string; message?: string };
        msg.type = 'error';
        msg.error = e;
        break;
      }
      default:
        break;
    }
  }
  msg.content = blocks.filter(Boolean);
  return msg;
}

/** Rebuild a chat completion from a buffered stream (`data:` chunks … `[DONE]`). */
export function chatFromSse(body: string): ChatCompletionShape {
  let text = '';
  let refusal = '';
  let finish: ChatCompletion.Choice['finish_reason'] | null = null;
  let model: string | undefined;
  let usage: ChatCompletionShape['usage'];
  for (const { data } of parseSse(body)) {
    if (!data || typeof data !== 'object') continue;
    const d = data as Record<string, unknown>;
    if (typeof d['model'] === 'string') model = d['model'];
    if (d['usage'] && typeof d['usage'] === 'object') usage = d['usage'] as ChatCompletionShape['usage'];
    const choices = Array.isArray(d['choices']) ? (d['choices'] as Array<Record<string, unknown>>) : [];
    for (const c of choices) {
      const delta = (c['delta'] ?? {}) as Record<string, unknown>;
      if (typeof delta['content'] === 'string') text += delta['content'];
      if (typeof delta['refusal'] === 'string') refusal += delta['refusal'];
      if (typeof c['finish_reason'] === 'string') finish = c['finish_reason'] as ChatCompletion.Choice['finish_reason'];
    }
  }
  return {
    ...(model !== undefined ? { model } : {}),
    choices: [{ message: { content: text, refusal: refusal || null }, finish_reason: finish }],
    ...(usage !== undefined ? { usage } : {}),
  };
}

// ============================================================
//   HTTP error mapping (RUN-12 provider errors, D-17-22)
// ============================================================

function errorDetail(body: string): { type: string | null; message: string } {
  try {
    const parsed = JSON.parse(body) as { error?: { type?: string; code?: string | null; message?: string } };
    const e = parsed.error ?? {};
    return { type: e.code ?? e.type ?? null, message: (e.message ?? '').replace(/[\r\n]+/g, ' ').slice(0, 160) };
  } catch {
    return { type: null, message: body.replace(/[\r\n]+/g, ' ').slice(0, 160) };
  }
}

function httpError(plan: CallPlan, status: number, body: string): ProviderHttpError {
  const { type, message } = errorDetail(body);
  const who = `${plan.provider} (model ${plan.model})`;
  const keyVar = plan.rt.apiKeyEnv ?? 'the key variable';
  if (status === 401 || status === 403) {
    return new ProviderHttpError(`${who} rejected the API key (HTTP ${status}${type ? ` ${type}` : ''}) — check ${keyVar}`, status);
  }
  const modelMissing = status === 404 && (type === 'model_not_found' || type === 'not_found_error' || /model/i.test(message));
  if (modelMissing) {
    return new ProviderHttpError(
      `${plan.provider} does not serve model "${plan.model}" (HTTP 404${type ? ` ${type}` : ''}) — change ${modelConfigKey(plan.rt, plan.sr)}`,
      status,
    );
  }
  // "after retries" only when fetch() really retried this status (http.ts isRetryableStatus).
  const retried = isRetryableStatus(status) ? ' after retries' : '';
  if (status === 429) {
    return new ProviderHttpError(`${who} rate-limited the request (HTTP 429)${retried} — wait and re-run`, status);
  }
  if (status === 529) {
    return new ProviderHttpError(`${who} is overloaded (HTTP 529${type ? ` ${type}` : ''})${retried} — re-run in a few minutes`, status);
  }
  if (status >= 500) {
    return new ProviderHttpError(`${who} failed with HTTP ${status}${type ? ` ${type}` : ''}${retried} — re-run later`, status);
  }
  return new ProviderHttpError(`${who} rejected the request (HTTP ${status}${type ? ` ${type}` : ''}: ${message})`, status);
}

/** `400 ms`, `54s`. */
function duration(ms: number): string {
  return ms < 1000 ? `${Math.max(0, Math.round(ms))} ms` : `${Math.round(ms / 1000)}s`;
}

function transportError(plan: CallPlan, err: unknown, elapsedMs: number): PensmithError {
  if (err instanceof PensmithError) return err;
  const e = err as { status?: number; response?: HttpResponse; code?: string; name?: string; message?: string };
  if (typeof e?.status === 'number' && e.response) return httpError(plan, e.status, e.response.body);
  const code = e?.code ?? e?.name ?? '';
  const where = plan.rt.endpointSource === 'global' ? `"endpoint" in ${globalRuntimeConfigPath()}` : `the ${plan.provider} endpoint`;
  // A CONNECT timeout means the endpoint never answered the TCP/TLS handshake
  // (an unreachable host or port): say that, with the time actually spent
  // across the retries — not the 600 s request timeout, which never started.
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') {
    return new ProviderHttpError(
      `could not connect to ${plan.provider} at ${plan.endpoint} (no answer after ${duration(elapsedMs)} of connection ` +
        `attempts) — start the server or fix ${where}`,
      null,
    );
  }
  if (/TIMEOUT/i.test(code)) {
    // Headers / body timeout: the server accepted the request and then went quiet.
    return new ProviderHttpError(
      `${plan.provider} (model ${plan.model}) timed out waiting for a reply (no data for ${duration(plan.timeoutMs)}) at ` +
        `${plan.endpoint} — re-run, or check the endpoint`,
      null,
    );
  }
  return new ProviderHttpError(
    `could not reach ${plan.provider} at ${plan.endpoint} (${code || (e?.message ?? 'network error').slice(0, 120)}) — start the server or fix ${where}`,
    null,
  );
}

// ============================================================
//   Logging + cost records (RUN-15, RUN-18)
// ============================================================

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

interface AttemptLog {
  attempt: 'initial' | 'max_tokens-retry' | 'corrective-retry';
  requestText: string;
  requestSha: string;
  body: Record<string, unknown>;
  result: AttemptResult;
  data?: unknown;
  replayOf?: string;
}

async function recordAttempt(plan: CallPlan, opts: CompleteOptions, log: AttemptLog): Promise<string> {
  const root = projectRoot();
  const r = log.result;
  if (!log.replayOf) {
    await appendCost({
      ts: new Date().toISOString(),
      scope: opts.section !== undefined ? 'section' : 'task',
      scopeId: opts.section !== undefined ? `${plan.spec.slug}-${opts.section}` : plan.spec.slug,
      provider: plan.provider,
      model: plan.model,
      served_model: r.servedModel,
      slug: plan.spec.slug,
      ...(opts.section !== undefined ? { section: opts.section } : {}),
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheWriteTokens: r.cacheWriteTokens,
      cacheReadTokens: r.cacheReadTokens,
      costUsd: r.costUsd,
    }, root);
    if (r.stopReason !== 'max_tokens') recordOutputSample(root, plan.spec.slug, r.outputTokens);
  }
  const bodies = tryReadPaperConfigSync(root)?.logging?.session_bodies ?? 'full';
  const id = `${currentSessionId()}:${nextLlmSeq()}`;
  const logger = openSessionLog({ scope: 'auto', runId: currentSessionId(), cwd: root });
  logSessionArgvOnce(logger, sessionLogPathFor(root));
  logger.llm({
    id,
    verb: plan.spec.verb,
    ...(opts.section !== undefined ? { section: opts.section } : {}),
    slug: plan.spec.slug,
    attempt: log.attempt,
    provider: plan.provider,
    model: plan.model,
    served_model: r.servedModel,
    effort: plan.effort,
    request: log.body,
    request_sha256: log.requestSha,
    response: { text: r.text, ...(log.data !== undefined ? { data: log.data } : {}) },
    stop_reason: r.stopReason,
    ...(r.refusalCategory ? { refusal_category: r.refusalCategory } : {}),
    input_tokens: r.inputTokens,
    output_tokens: r.outputTokens,
    cache_write_tokens: r.cacheWriteTokens,
    cache_read_tokens: r.cacheReadTokens,
    cost_usd: log.replayOf ? 0 : r.costUsd,
    offline: isOfflineMode(),
    fallbacks: plan.fallbacks ? 'default' : 'off',
    fallback_used: r.fallbackUsed,
    session_bodies: bodies,
    ...(log.replayOf ? { replay_of: log.replayOf } : {}),
  });
  await logger.close();
  return id;
}

function fromReplay(rec: LoggedLlmRecord, plan: CallPlan): AttemptResult {
  return {
    text: rec.response?.text ?? '',
    stopReason: rec.stop_reason ?? 'end_turn',
    refusalCategory: null,
    recommendedModel: null,
    inputTokens: rec.input_tokens ?? 0,
    outputTokens: rec.output_tokens ?? 0,
    cacheWriteTokens: rec.cache_write_tokens ?? 0,
    cacheReadTokens: rec.cache_read_tokens ?? 0,
    costUsd: 0,
    servedModel: rec.served_model ?? rec.model ?? plan.model,
    fallbackUsed: false,
  };
}

// ============================================================
//   One attempt
// ============================================================

async function sendAttempt(
  plan: CallPlan,
  key: string,
  body: Record<string, unknown>,
  requestText: string,
  stream: boolean,
): Promise<AttemptResult> {
  let resp: HttpResponse;
  const started = Date.now();
  try {
    // noCache: the key header must never reach a cache file (T-11-01).
    // untrusted:false skips only the generic source-host SSRF pre-flight: the
    // endpoint is the configured LLM endpoint, and `llm` hands http.ts the
    // origin its LLM egress policy (D-17-09) allowlists and pins.
    resp = await fetch(requestUrl(plan), {
      method: 'POST',
      headers: requestHeaders(plan, key, stream),
      body: requestText,
      source: 'generic',
      noCache: true,
      untrusted: false,
      llm: { endpoint: plan.endpoint },
      maxBytes: LLM_MAX_BYTES,
      timeoutMs: plan.timeoutMs,
    });
  } catch (e) {
    throw transportError(plan, e, Date.now() - started);
  }
  if (resp.status >= 400) throw httpError(plan, resp.status, resp.body);
  const isSse = stream || /text\/event-stream/i.test(resp.headers['content-type'] ?? '');
  if (wireShapeOf(plan.provider) === 'anthropic') {
    let msg: AnthropicMessage;
    try {
      msg = isSse ? anthropicFromSse(resp.body) : (JSON.parse(resp.body) as AnthropicMessage);
    } catch {
      throw new ProviderHttpError(`${plan.provider} (model ${plan.model}) returned a reply that is not JSON (${resp.body.length} bytes)`, resp.status);
    }
    if (msg.type === 'error') {
      throw new ProviderHttpError(
        `${plan.provider} (model ${plan.model}) returned an error: ${msg.error?.type ?? 'error'} ${(msg.error?.message ?? '').slice(0, 160)}`,
        resp.status,
      );
    }
    return normalizeAnthropic(plan, msg);
  }
  let cc: ChatCompletionShape;
  try {
    cc = isSse ? chatFromSse(resp.body) : (JSON.parse(resp.body) as ChatCompletionShape);
  } catch {
    throw new ProviderHttpError(`${plan.provider} (model ${plan.model}) returned a reply that is not JSON (${resp.body.length} bytes)`, resp.status);
  }
  if (cc.error) {
    throw new ProviderHttpError(`${plan.provider} (model ${plan.model}) returned an error: ${(cc.error.message ?? '').slice(0, 160)}`, resp.status);
  }
  return normalizeChat(plan, cc);
}

// ============================================================
//   complete()
// ============================================================

async function planCall(opts: CompleteOptions): Promise<CallPlan> {
  const spec = slugSpec(opts.slug);
  const rt = await resolveRuntime();
  const sr = resolveSlug(rt, opts.slug);
  const model = opts.model !== undefined ? resolveModelAlias(opts.model) : sr.model;
  if (model === null) throw missingModelError(rt.provider);
  if (rt.endpoint === null) {
    throw new RuntimeConfigError(`provider ${rt.provider} needs an endpoint — set "endpoint" in ${globalRuntimeConfigPath()}`);
  }
  const caps = modelCapabilities(rt.provider, model);
  const local = LOCAL_PROVIDERS.has(rt.provider);
  const structured = spec.structured && contractFor(spec.slug) !== null;
  return {
    rt,
    sr,
    spec,
    provider: rt.provider,
    model,
    caps,
    effort: local ? null : effectiveEffort(caps, sr.effort),
    endpoint: rt.endpoint,
    structured,
    native: structured && caps.structuredOutput,
    fallbacks: rt.refusalFallbacks === 'default' && caps.refusalFallbacks && rt.provider === 'anthropic',
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

function validateMessages(opts: CompleteOptions): void {
  if (opts.messages.length === 0) throw new Error('anthropic.ts: complete() requires at least one message');
  const last = opts.messages[opts.messages.length - 1];
  if (last?.role !== 'user') {
    // No assistant prefill, ever (400 on Opus 5 / Sonnet 5 / 4.6+).
    throw new Error(`anthropic.ts: the last message must have role 'user'; got '${last?.role}'`);
  }
}

/**
 * Run one logical call (with at most one max_tokens retry). Returns the final
 * attempt; throws on refusal / truncation / transport errors after recording
 * every billed attempt.
 */
async function runWithRetry(
  plan: CallPlan,
  opts: CompleteOptions,
  key: string | null,
  messages: ChatMessage[],
  attemptKind: 'initial' | 'corrective-retry',
): Promise<{ result: AttemptResult; parsed: ParseOutcome<unknown> | null; spentUsd: number; body: Record<string, unknown>; requestText: string; requestSha: string; replayOf?: string }> {
  const root = projectRoot();
  // Every billed attempt (a truncated first attempt included) counts toward the call's cost.
  let spentUsd = 0;
  const firstMax = Math.min(opts.maxTokens ?? plan.spec.maxTokens, plan.caps.maxOutputTokens);
  const retryMax = Math.min(Math.max(firstMax * 2, plan.spec.retryMaxTokens), plan.caps.maxOutputTokens);
  // RUN-24: one retry at a larger budget — unless the first budget already is
  // the model's output ceiling (local providers: 8192), where an identical
  // request would only truncate again; the error then says so.
  const maxes = retryMax > firstMax ? [firstMax, retryMax] : [firstMax];
  const inputEstimate = estimateTokens(opts.system.length + messages.reduce((a, m) => a + m.content.length, 0));
  const price = resolvePrice(plan.provider, plan.model, plan.rt.priceOverride);

  for (let i = 0; i < maxes.length; i += 1) {
    const maxTokens = maxes[i] as number;
    const stream = maxTokens > STREAM_ABOVE_TOKENS;
    const body = buildBody(plan, opts.system, messages, maxTokens, stream);
    const requestText = JSON.stringify(body);
    const requestSha = sha256(requestText);
    const kind = i === 0 ? attemptKind : 'max_tokens-retry';

    let result: AttemptResult;
    let replayOf: string | undefined;
    // RUN-18: the projection stays reserved (in-flight spend other calls of
    // this process see) until this attempt's cost is recorded or it fails.
    let reservation: BudgetReservation | null = null;
    try {
      const logged = isReplayActive() && isOfflineMode() ? replayLookup(plan.spec.slug, requestSha) : null;
      if (isReplayActive() && isOfflineMode()) {
        if (!logged) throw new ReplayMissError(plan.spec.slug);
        result = fromReplay(logged, plan);
        replayOf = logged.id;
      } else {
        // RUN-18: project this attempt and check the session cap BEFORE any byte is sent.
        const p90 = i === 0 ? p90OutputFor(root, plan.spec.slug).tokens : maxTokens;
        const projected = projectCallUsd(price, inputEstimate, p90, maxTokens).usd;
        reservation = await reserveSessionBudget({ projectedUsd: projected, slug: plan.spec.slug, model: plan.model, root });
        result = await sendAttempt(plan, key ?? '', body, requestText, stream);
      }

      if (replayOf === undefined) spentUsd += result.costUsd;
      const needsRetry = result.stopReason === 'max_tokens' && i + 1 < maxes.length;
      // Structured slugs: parse a complete reply here so the record carries the
      // parsed object (D-17-29) and complete() validates exactly what was logged.
      const parsed = plan.structured && result.stopReason !== 'max_tokens' && result.stopReason !== 'refusal'
        ? parseStructured(plan.spec.slug, result.text, { strictNulls: plan.native && plan.provider === 'openai' })
        : null;
      await recordAttempt(plan, opts, {
        attempt: kind,
        requestText,
        requestSha,
        body,
        result,
        ...(parsed?.ok ? { data: parsed.data } : {}),
        ...(replayOf !== undefined ? { replayOf } : {}),
      });
      if (result.stopReason === 'refusal') {
        throw new ProviderRefusalError(plan.provider, plan.model, result.refusalCategory, result.recommendedModel);
      }
      if (result.stopReason === 'max_tokens') {
        if (needsRetry) continue;
        throw new ProviderTruncatedError(plan.provider, plan.model, plan.spec.slug, maxTokens, {
          attempts: maxes.length,
          local: LOCAL_PROVIDERS.has(plan.provider),
        });
      }
      return { result, parsed, spentUsd, body, requestText, requestSha, ...(replayOf !== undefined ? { replayOf } : {}) };
    } finally {
      reservation?.release();
    }
  }
  // Unreachable: the loop either returns or throws.
  throw new ProviderTruncatedError(plan.provider, plan.model, plan.spec.slug, maxes[maxes.length - 1] as number);
}

/**
 * The single LLM completion entry point. Structured slugs return `data`
 * validated against their llm-contracts.ts schema.
 */
export async function complete<T = unknown>(opts: CompleteOptions): Promise<CompleteResult<T>> {
  validateMessages(opts);
  const spec = slugSpec(opts.slug);

  // 1. LLM-stubbed mode (PENSMITH_NO_LLM / --dry-run): no key, no network, no log.
  if (isNoLlmMode()) {
    const structured = spec.structured && hasStructuredStub(spec.slug);
    const data = structured ? structuredStub(spec.slug, opts.stubHint) : undefined;
    const text = structured ? JSON.stringify(data) : textPlaceholder(opts.messages.at(-1)?.content ?? '');
    return {
      text,
      ...(data !== undefined ? { data: data as T } : {}),
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0,
      provider: 'stub',
      model: 'stub',
      servedModel: 'stub',
      stopReason: 'end_turn',
    };
  }

  // 2-3. Runtime + request policy.
  const plan = await planCall(opts);

  // 5. Key (skipped when replay will serve every attempt from the log).
  let key: string | null = null;
  if (!(isReplayActive() && isOfflineMode())) {
    key = await getProviderApiKey(plan.provider);
    if (key) registerSecret(key);
  }

  let totalCost = 0;
  const first = await runWithRetry(plan, opts, key, opts.messages, 'initial');
  totalCost += first.spentUsd;
  let final = first;
  let data: unknown;

  if (plan.structured) {
    let parsed = first.parsed ?? { ok: false as const, error: 'no reply to parse' };
    if (!parsed.ok) {
      // One corrective retry after a structural failure (RUN-25).
      const retryMessages = correctiveMessages(opts.messages, first.result.text, correctiveInstruction(plan.spec.slug, parsed.error));
      const second = await runWithRetry(plan, opts, key, retryMessages, 'corrective-retry');
      totalCost += second.spentUsd;
      final = second;
      parsed = second.parsed ?? { ok: false as const, error: 'no reply to parse' };
      if (!parsed.ok) throw new StructuredOutputError(plan.spec.slug, plan.model, parsed.error);
    }
    data = parsed.data;
  }

  const r = final.result;
  return {
    text: r.text,
    ...(data !== undefined ? { data: data as T } : {}),
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cacheWriteTokens: r.cacheWriteTokens,
    cacheReadTokens: r.cacheReadTokens,
    costUsd: totalCost,
    provider: plan.provider,
    model: plan.model,
    servedModel: r.servedModel,
    stopReason: r.stopReason,
  };
}

// ============================================================
//   doctor: GET <endpoint>/models (RUN-08, D-17-20)
// ============================================================

export interface EndpointProbe {
  reachable: boolean;
  url: string;
  status: number | null;
  detail: string;
}

/**
 * Probe the configured endpoint's model list. Anthropic: `<base>/v1/models`;
 * chat providers: `<base>/models`. Sends the key header when one is set. Never
 * throws; never includes a key value in its result.
 */
export async function probeLlmEndpoint(rt: ResolvedRuntime, opts: { timeoutMs?: number } = {}): Promise<EndpointProbe> {
  const endpoint = rt.endpoint;
  if (endpoint === null) return { reachable: false, url: '', status: null, detail: 'no endpoint configured' };
  const anthropic = wireShapeOf(rt.provider) === 'anthropic';
  const url = anthropic ? anthropicUrl(endpoint, '/models') : chatUrl(endpoint, '/models');
  const headers: Record<string, string> = { accept: 'application/json' };
  const keyVar = rt.apiKeyEnv;
  const keyValue = keyVar ? process.env[keyVar] : undefined;
  if (anthropic) {
    headers['anthropic-version'] = '2023-06-01';
    if (keyValue) headers['x-api-key'] = keyValue;
  } else if (keyValue) {
    headers['authorization'] = `Bearer ${keyValue}`;
  }
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers,
      source: 'generic',
      noCache: true,
      noRetry: true,
      untrusted: false,
      llm: { endpoint },
      maxBytes: LLM_MAX_BYTES,
      timeoutMs: opts.timeoutMs ?? 5_000,
    });
    if (resp.status >= 200 && resp.status < 300) {
      return { reachable: true, url, status: resp.status, detail: `GET ${url} → ${resp.status}` };
    }
    return { reachable: false, url, status: resp.status, detail: `GET ${url} → HTTP ${resp.status}` };
  } catch (e) {
    const err = e as { code?: string; name?: string; message?: string };
    return { reachable: false, url, status: null, detail: `GET ${url} failed (${err.code ?? err.name ?? 'error'})` };
  }
}
