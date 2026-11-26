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

import { loadRuntimeConfig } from './runtime.js';
import type { Effort, LlmRole } from './generator.js';
import { OPENAI_DEFAULT_BASE_URL } from './generators/openai.js';

export type ProviderName = 'anthropic' | 'openai';

/** The model each provider uses when runtime.json names none. */
export const DEFAULT_MODELS: Readonly<Record<ProviderName, string>> = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-4o',
};

export interface RoleDefaults {
  effort: Effort;
  /** The output limit, thinking included. A call that reaches it fails as truncated. */
  maxTokens: number;
  /** What a call usually uses, thinking included: the cost-cap check's estimate. */
  expectedOutputTokens: number;
}

/**
 * Per-role defaults. Drafting and outlining get the most effort and room;
 * classifying a source or a claim needs little of either. The limits are
 * generous (answers stream, so a long one does not time out); the estimate,
 * not the limit, is what the cost cap is checked against.
 */
export const ROLE_DEFAULTS: Readonly<Record<LlmRole, RoleDefaults>> = {
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

/** The provider, model, effort and limits for a call (see the file header). */
export async function resolveCall(choice: CallChoice): Promise<ResolvedCall> {
  const cfg = await loadRuntimeConfig();
  const providerId = Object.keys(cfg.providers ?? {})[0] ?? 'anthropic';
  const provider = cfg.providers?.[providerId];
  const providerName: ProviderName = provider?.name ?? 'anthropic';
  const roleCfg = provider?.roles?.[choice.role];
  const defaults = ROLE_DEFAULTS[choice.role];
  const baseUrl = provider?.baseUrl;
  return {
    role: choice.role,
    providerId,
    providerName,
    model: choice.model ?? roleCfg?.model ?? provider?.defaultModel ?? DEFAULT_MODELS[providerName],
    effort: choice.effort ?? roleCfg?.effort ?? defaults.effort,
    maxTokens: choice.maxTokens ?? roleCfg?.maxTokens ?? defaults.maxTokens,
    expectedOutputTokens: choice.expectedOutputTokens ?? roleCfg?.expectedOutputTokens ?? defaults.expectedOutputTokens,
    ...(baseUrl ? { baseUrl } : {}),
    ...(provider?.pricePerMtok
      ? { pricePerMtok: { inputPerMtok: provider.pricePerMtok.input, outputPerMtok: provider.pricePerMtok.output } }
      : {}),
    endpoint: baseUrl ?? (providerName === 'openai' ? OPENAI_DEFAULT_BASE_URL : 'https://api.anthropic.com'),
  };
}
