// bin/lib/schemas/runtime-config.ts — runtime config schema (D-61).
//
// Phase 1 scope (foundation):
//   - $schemaVersion envelope (D-37)
//   - providers: keyed by provider id (`'anthropic'`, `'openai'`) — z.record,
//     NOT z.array. Consumer plans W11/W13 do object lookup `cfg.providers?.[id]`
//     and overlay merge `{ ...base.providers, ...overlay.providers }`.
//   - openalexApiKeyEnv + openalexApiKeyOptional defaults (RESEARCH §Key
//     Finding #5): the OPENALEX_API_KEY slot SHIPS NOW even though the
//     research wave (Phase 3) is the consumer — this avoids a forward
//     migration just to add a single optional env-var slot.
//   - contactEmailEnv default (`PENSMITH_CONTACT_EMAIL`) — surfaces in
//     polite-pool User-Agent strings for OpenAlex/Crossref.
//
// `providers` has a `.refine` guard requiring at least one provider key —
// a runtime config with zero providers is non-functional, so reject early.

import { z } from 'zod';
import { EFFORTS, LLM_ROLES, type Effort, type LlmRole } from '../generator.js';

export const CURRENT_RUNTIME_CONFIG_VERSION = 1;

/** What one role (write, plan, verify, ...) uses instead of the provider's defaults. */
const RoleConfigSchema = z.object({
  model: z.string().min(1).optional(),
  effort: z.enum(EFFORTS as [Effort, ...Effort[]]).optional(),
  maxTokens: z.number().int().positive().optional(),
  expectedOutputTokens: z.number().int().positive().optional(),
});

// The fields after defaultModel are optional, so a v1 file without them still
// parses unchanged and no schema version bump is needed.
export const ProviderSchema = z.object({
  name: z.enum(['anthropic', 'openai']),
  apiKeyEnv: z.string().min(1),
  defaultModel: z.string().min(1).optional(),
  /** Another endpoint: an OpenAI-compatible server (Ollama, vLLM) or an Anthropic gateway. */
  baseUrl: z.string().url().optional(),
  /** Per-role overrides, keyed by role. */
  roles: z.record(z.enum(LLM_ROLES as [LlmRole, ...LlmRole[]]), RoleConfigSchema).optional(),
  /** The provider's own rates, in place of the price table's (0 for a local server). */
  pricePerMtok: z.object({ input: z.number().nonnegative(), output: z.number().nonnegative() }).optional(),
});

export const Schema = z.object({
  $schemaVersion: z.literal(CURRENT_RUNTIME_CONFIG_VERSION),
  providers: z.record(z.string(), ProviderSchema)
    .refine((p) => Object.keys(p).length >= 1, 'at least one provider required'),
  openalexApiKeyEnv: z.string().default('OPENALEX_API_KEY'),
  openalexApiKeyOptional: z.boolean().default(true),
  contactEmailEnv: z.string().default('PENSMITH_CONTACT_EMAIL'),
});

export type RuntimeConfig = z.infer<typeof Schema>;
export type Provider = z.infer<typeof ProviderSchema>;
