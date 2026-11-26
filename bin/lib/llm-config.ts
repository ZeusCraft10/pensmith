// bin/lib/llm-config.ts — which provider, model, effort and token limits a
// model call uses.
//
// The provider is the first entry in runtime.json's `providers` (the default
// config has one, `anthropic`). Its model is, in order: the model the caller
// names, the provider's `roles.<role>.model`, its `defaultModel`, then the
// provider's default (claude-opus-5-5 for Anthropic). Effort and the token
// limits follow the same order, ending in the role's defaults below.
//
// The estimator reads the same choices, so --estimate and the --yolo pre-flight
// price the model that would really run.

import { loadRuntimeConfig, type RuntimeConfig } from './runtime.js';
import { estimateCost } from './pricing.js';
import type { Effort, LlmRole } from './generator.js';
import { OPENAI_DEFAULT_BASE_URL } from './generators/openai.js';

export type ProviderName = 'anthropic' | 'openai';

/** The model each provider uses when runtime.json names none. */
const DEFAULT_MODELS: Readonly<Record<ProviderName, string>> = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-4o',
};

interface RoleDefaults {
  effort: Effort;
  /** The output limit, thinking included. A call that reaches it fails as truncated. */
  maxTokens: number;
  /** What a call usually uses, thinking included: the cost-cap check's estimate. */
  expectedOutputTokens: number;
}

/**
 * Per-role defaults. Drafting and outlining get the most effort and room;
 * classifying a source or a claim needs little of either. The limits are
 * generous (Anthropic answers stream, so a long one does not time out) and
 * are lowered to a model's own limit where it is smaller (MODEL_OUTPUT_LIMITS).
 * The estimate, not the limit, is what the cost cap is checked against.
 */
const ROLE_DEFAULTS: Readonly<Record<LlmRole, RoleDefaults>> = {
  intake: { effort: 'low', maxTokens: 16_000, expectedOutputTokens: 2_000 },
  research: { effort: 'low', maxTokens: 16_000, expectedOutputTokens: 1_500 },
  evaluate: { effort: 'low', maxTokens: 16_000, expectedOutputTokens: 3_000 },
  outline: { effort: 'high', maxTokens: 32_000, expectedOutputTokens: 6_000 },
  plan: { effort: 'medium', maxTokens: 32_000, expectedOutputTokens: 5_000 },
  write: { effort: 'high', maxTokens: 64_000, expectedOutputTokens: 10_000 },
  revise: { effort: 'medium', maxTokens: 16_000, expectedOutputTokens: 3_000 },
  verify: { effort: 'low', maxTokens: 8_000, expectedOutputTokens: 800 },
  task: { effort: 'medium', maxTokens: 16_000, expectedOutputTokens: 2_000 },
};

/**
 * Models whose output limit is below a role default, by provider. Every
 * Anthropic model in the price table allows the role defaults. A dated
 * snapshot takes its alias's limit unless it is listed itself.
 */
const MODEL_OUTPUT_LIMITS: Readonly<Record<ProviderName, Readonly<Record<string, number>>>> = {
  anthropic: {},
  openai: {
    'gpt-4o': 16_384,
    'gpt-4o-2024-05-13': 4_096,
    'gpt-4o-mini': 16_384,
    'gpt-4.1': 32_768,
    'gpt-4.1-mini': 32_768,
    'gpt-4.1-nano': 32_768,
    'gpt-4-turbo': 4_096,
    'gpt-4-turbo-preview': 4_096,
    'gpt-4-0125-preview': 4_096,
    'gpt-4-1106-preview': 4_096,
    'gpt-3.5-turbo': 4_096,
    'gpt-3.5-turbo-16k': 4_096,
  },
};

/** The most output tokens `model` allows, when it is known to be below the role defaults. */
function modelOutputLimit(providerName: ProviderName, model: string): number | undefined {
  const limits = MODEL_OUTPUT_LIMITS[providerName];
  // A snapshot dated in full ("gpt-4.1-2025-04-14") or by month and day ("gpt-3.5-turbo-0125").
  return limits[model] ?? limits[model.replace(/-(?:\d{4}-\d{2}-\d{2}|\d{4})$/, '')];
}

export interface ResolvedCall {
  role: LlmRole;
  /** The provider's key in runtime.json. */
  providerId: string;
  providerName: ProviderName;
  model: string;
  effort: Effort;
  maxTokens: number;
  expectedOutputTokens: number;
  /** The endpoint runtime.json sets for the provider, if any. */
  baseUrl?: string;
  /** Rates runtime.json sets for the provider, in place of the price table's. */
  pricePerMtok?: { inputPerMtok: number; outputPerMtok: number };
  /** Where the call would go (for an offline refusal's message). */
  endpoint: string;
}

export interface CallChoice {
  role: LlmRole;
  model?: string;
  effort?: Effort;
  maxTokens?: number;
  expectedOutputTokens?: number;
}

/**
 * The runtime.json key of the provider pensmith uses: the first one listed, or
 * 'anthropic' (the default config's only entry).
 */
export function providerIdOf(cfg: RuntimeConfig): string {
  return Object.keys(cfg.providers ?? {})[0] ?? 'anthropic';
}

/**
 * The provider complete() will call (providerIdOf the loaded runtime.json).
 * Verbs check its API key before they start, with this same choice.
 */
export async function resolveProviderId(): Promise<string> {
  return providerIdOf(await loadRuntimeConfig());
}

/** The provider, model, effort and limits for a call (see the file header). */
export async function resolveCall(choice: CallChoice): Promise<ResolvedCall> {
  const cfg = await loadRuntimeConfig();
  const providerId = providerIdOf(cfg);
  const provider = cfg.providers?.[providerId];
  const providerName: ProviderName = provider?.name ?? 'anthropic';
  const roleCfg = provider?.roles?.[choice.role];
  const defaults = ROLE_DEFAULTS[choice.role];
  const baseUrl = provider?.baseUrl;
  const model = choice.model ?? roleCfg?.model ?? provider?.defaultModel ?? DEFAULT_MODELS[providerName];
  // A limit the caller or runtime.json sets is sent as set; only the role
  // default is lowered to what the model allows (gpt-4o refuses more than
  // 16,384 completion tokens with an HTTP 400).
  const modelLimit = modelOutputLimit(providerName, model);
  const maxTokens = choice.maxTokens ?? roleCfg?.maxTokens
    ?? (modelLimit !== undefined ? Math.min(defaults.maxTokens, modelLimit) : defaults.maxTokens);
  return {
    role: choice.role,
    providerId,
    providerName,
    model,
    effort: choice.effort ?? roleCfg?.effort ?? defaults.effort,
    maxTokens,
    expectedOutputTokens: choice.expectedOutputTokens ?? roleCfg?.expectedOutputTokens ?? Math.min(defaults.expectedOutputTokens, maxTokens),
    ...(baseUrl ? { baseUrl } : {}),
    ...(provider?.pricePerMtok
      ? { pricePerMtok: { inputPerMtok: provider.pricePerMtok.input, outputPerMtok: provider.pricePerMtok.output } }
      : {}),
    endpoint: baseUrl ?? (providerName === 'openai' ? OPENAI_DEFAULT_BASE_URL : 'https://api.anthropic.com'),
  };
}

/**
 * What `usage` costs on `call`'s provider, at the rates runtime.json sets for
 * it or the price table's. `usage.model` defaults to the call's model. complete()
 * prices its pre-call estimate and the ledger rows with it, and the estimator
 * its projection, so all three price a call the same way.
 */
export function callCost(call: ResolvedCall, usage: {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): number {
  return estimateCost({
    provider: call.providerName,
    modelId: usage.model ?? call.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    ...(call.pricePerMtok ? { override: call.pricePerMtok } : {}),
  });
}
