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

export const CURRENT_RUNTIME_CONFIG_VERSION = 1;

export const ProviderSchema = z.object({
  name: z.enum(['anthropic', 'openai']),
  apiKeyEnv: z.string().min(1),
  defaultModel: z.string().min(1).optional(),
});

export const Schema = z.object({
  $schemaVersion: z.literal(CURRENT_RUNTIME_CONFIG_VERSION),
  providers: z
    .record(z.string(), ProviderSchema)
    .refine((p) => Object.keys(p).length >= 1, 'at least one provider required'),
  openalexApiKeyEnv: z.string().default('OPENALEX_API_KEY'),
  openalexApiKeyOptional: z.boolean().default(true),
  contactEmailEnv: z.string().default('PENSMITH_CONTACT_EMAIL'),
});

export type RuntimeConfig = z.infer<typeof Schema>;
export type Provider = z.infer<typeof ProviderSchema>;
