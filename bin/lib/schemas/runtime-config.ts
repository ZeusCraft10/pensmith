// bin/lib/schemas/runtime-config.ts — global runtime.json schema (RUN-07, RUN-08; D-17-19).
//
// The GLOBAL runtime config lives at pensmithDataDir()/runtime.json. It is the
// only place `endpoint` and `api_key_env` may come from (S-18): a paper's files
// (.paper/config.toml) cannot choose where prompts and keys are sent.
//
// v2 shape (flat, one provider):
//   { $schemaVersion: 2, provider, model, endpoint, api_key_env,
//     price_in_per_mtok, price_out_per_mtok, refusal_fallbacks,
//     slugs: { <slug>: { model?, effort? } },
//     openalexApiKeyEnv, openalexApiKeyOptional, contactEmailEnv }
//
// v1 (Phase 1) keyed a providers map by id; migrations/runtime-config/v1_to_v2.ts
// maps its first provider entry. RuntimeConfigV1Schema is kept for that
// migration only.

import { z } from 'zod';
import { PROVIDER_NAMES } from '../llm-models.js';

export const CURRENT_RUNTIME_CONFIG_VERSION = 2;

/** `api_key_env` accepts the known provider variables or any `*_API_KEY` name (S-18). */
const API_KEY_ENV_RE = /^[A-Z][A-Z0-9_]*_API_KEY$/;

export function isAllowedApiKeyEnv(name: string): boolean {
  return name === 'ANTHROPIC_API_KEY' || name === 'OPENAI_API_KEY' || API_KEY_ENV_RE.test(name);
}

export const API_KEY_ENV_RULE =
  'api_key_env must be ANTHROPIC_API_KEY, OPENAI_API_KEY or a name matching ^[A-Z][A-Z0-9_]*_API_KEY$';

export const PROVIDER_ENUM_MESSAGE = `unknown provider; valid values: ${PROVIDER_NAMES.join(', ')}`;

export const ProviderNameSchema = z.enum(PROVIDER_NAMES, {
  errorMap: () => ({ message: PROVIDER_ENUM_MESSAGE }),
});

export const EffortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max'], {
  errorMap: () => ({ message: 'effort must be one of: low, medium, high, xhigh, max' }),
});

/** URL syntax check only; the network policy (loopback-only http, no link-local) lives in http.ts. */
export const EndpointSchema = z.string().superRefine((value, ctx) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `endpoint "${value}" is not a valid URL` });
    return;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `endpoint must use http:// or https:// (got ${url.protocol})` });
  }
  if (url.username || url.password) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'endpoint must not embed credentials' });
  }
  if (url.search || url.hash) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'endpoint must be a base URL without a query string or fragment' });
  }
});

export const ApiKeyEnvSchema = z.string().refine(isAllowedApiKeyEnv, { message: API_KEY_ENV_RULE });

export const RefusalFallbacksSchema = z.enum(['off', 'default'], {
  errorMap: () => ({ message: 'refusal_fallbacks must be "off" or "default"' }),
});

export const SlugOverrideSchema = z.object({
  model: z.string().min(1).optional(),
  effort: EffortSchema.optional(),
}).strict();

const PriceSchema = z.number().nonnegative().finite();

export const Schema = z.object({
  $schemaVersion: z.literal(CURRENT_RUNTIME_CONFIG_VERSION),
  provider: ProviderNameSchema.optional(),
  model: z.string().min(1).optional(),
  endpoint: EndpointSchema.optional(),
  api_key_env: ApiKeyEnvSchema.optional(),
  price_in_per_mtok: PriceSchema.optional(),
  price_out_per_mtok: PriceSchema.optional(),
  refusal_fallbacks: RefusalFallbacksSchema.optional(),
  slugs: z.record(z.string(), SlugOverrideSchema).optional(),
  openalexApiKeyEnv: z.string().default('OPENALEX_API_KEY'),
  openalexApiKeyOptional: z.boolean().default(true),
  contactEmailEnv: z.string().default('PENSMITH_CONTACT_EMAIL'),
});

export type RuntimeConfig = z.infer<typeof Schema>;
export type SlugOverride = z.infer<typeof SlugOverrideSchema>;

// ---------------------------------------------------------------------------
// v1 (legacy) — read only by the v1 → v2 migration.
// ---------------------------------------------------------------------------

export const ProviderV1Schema = z.object({
  name: z.string().min(1),
  apiKeyEnv: z.string().min(1),
  defaultModel: z.string().min(1).optional(),
});

export const RuntimeConfigV1Schema = z.object({
  $schemaVersion: z.literal(1),
  providers: z.record(z.string(), ProviderV1Schema).default({}),
  openalexApiKeyEnv: z.string().default('OPENALEX_API_KEY'),
  openalexApiKeyOptional: z.boolean().default(true),
  contactEmailEnv: z.string().default('PENSMITH_CONTACT_EMAIL'),
});
