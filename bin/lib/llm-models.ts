// bin/lib/llm-models.ts — the ONE model table (RUN-06, RUN-24, RUN-26; D-17-17, D-17-24).
//
// Three tables live here and nowhere else:
//   1. Providers: the valid provider names, their default endpoints and the key
//      variable each hosted provider reads.
//   2. Models: per-model capabilities (thinking mode, effort levels, native
//      structured output, max output tokens, refusal-fallback support) and the
//      retired-id aliases (with a one-time warning).
//   3. Prompt slugs: the per-slug request policy (generation vs judgment tier,
//      effort, max_tokens ceiling, retry ceiling, shipped p90 output, input
//      estimate, system-prompt caching, structured or text output, owning verb).
//
// Source of the Anthropic capabilities: the claude-api model table (cached
// 2026-06-24) — adaptive thinking on Opus 5 / Opus 5.5 / Sonnet 5 / Opus 4.x /
// Sonnet 4.6 / Fable, no thinking parameter and no effort on Haiku 4.5, native
// structured output on Fable 5/5.1, Opus 5, Opus 4.8, Sonnet 5 and Haiku 4.5.
// OpenAI: developers.openai.com/api/docs/models (fetched 2026-09-27) — the
// flagship gpt-6-astra and the small gpt-6-luna both support chat completions,
// structured outputs and reasoning effort.
//
// Pure data + pure functions. The only side effect is the one-time stderr
// warning for a retired model id.

import type { Ux02Verb } from './verbs.js';

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export const PROVIDER_NAMES = ['anthropic', 'openai', 'ollama', 'vllm', 'openai-compatible'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

/** Providers that run on a user-configured (usually local) endpoint. Priced at $0 unless configured. */
export const LOCAL_PROVIDERS: ReadonlySet<ProviderName> = new Set(['ollama', 'vllm', 'openai-compatible']);

export function isProviderName(x: unknown): x is ProviderName {
  return typeof x === 'string' && (PROVIDER_NAMES as readonly string[]).includes(x);
}

/** The wire shape a provider speaks. Every non-Anthropic provider uses chat completions. */
export function wireShapeOf(provider: ProviderName): 'anthropic' | 'chat' {
  return provider === 'anthropic' ? 'anthropic' : 'chat';
}

/**
 * Default base URL per provider. The Anthropic base has no `/v1` (the transport
 * appends `/v1/messages`); chat-completions bases include `/v1` (the transport
 * appends `/chat/completions`). `openai-compatible` has no default: an endpoint
 * must be configured in the global runtime.json.
 */
export const DEFAULT_ENDPOINTS: Readonly<Record<ProviderName, string | null>> = Object.freeze({
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  ollama: 'http://127.0.0.1:11434/v1',
  vllm: 'http://127.0.0.1:8000/v1',
  'openai-compatible': null,
});

/** The key variable each hosted provider reads by default. Local providers need no key. */
export const DEFAULT_KEY_ENV: Readonly<Record<ProviderName, string | null>> = Object.freeze({
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  ollama: null,
  vllm: null,
  'openai-compatible': null,
});

/** The variables `Set one of:` names (RUN-07). */
export const KNOWN_PROVIDER_KEY_VARS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'] as const;

export const NO_PROVIDER_CONFIGURED_HINT =
  'Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY (or configure a local endpoint)';

/**
 * Default models per hosted provider and tier (D-17-17, D-17-24). Local
 * providers have no default: the user must set `[runtime] model` or `--model`.
 */
export const DEFAULT_MODELS: Readonly<Record<'anthropic' | 'openai', { generation: string; judgment: string }>> =
  Object.freeze({
    anthropic: Object.freeze({ generation: 'claude-opus-5', judgment: 'claude-haiku-4-5' }),
    // developers.openai.com/api/docs/pricing (2026-09-27): the flagship is
    // gpt-6-astra and the small model is gpt-6-luna; they replace gpt-5 /
    // gpt-5-mini as the defaults (D-17-17 "successors replace them").
    openai: Object.freeze({ generation: 'gpt-6-astra', judgment: 'gpt-6-luna' }),
  });

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelCapabilities {
  readonly id: string;
  readonly provider: 'anthropic' | 'openai';
  /** 'adaptive' → send thinking:{type:'adaptive'}; 'none' → send no thinking parameter. */
  readonly thinking: 'adaptive' | 'none';
  /** Effort levels the model accepts (empty → never send effort). */
  readonly efforts: readonly Effort[];
  /** Native structured output (Anthropic output_config.format / OpenAI response_format json_schema). */
  readonly structuredOutput: boolean;
  /** Maximum output tokens (max_tokens ceiling, thinking included). */
  readonly maxOutputTokens: number;
  /** Server-side refusal fallbacks (`fallbacks: "default"`) are supported. */
  readonly refusalFallbacks: boolean;
  /** False when the id is not in the table (conservative defaults apply). */
  readonly known: boolean;
}

const ALL_EFFORTS: readonly Effort[] = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
const NO_XHIGH: readonly Effort[] = Object.freeze(['low', 'medium', 'high', 'max']);
const OPENAI_GPT5_EFFORTS: readonly Effort[] = Object.freeze(['low', 'medium', 'high']);

function m(
  id: string,
  provider: 'anthropic' | 'openai',
  thinking: 'adaptive' | 'none',
  efforts: readonly Effort[],
  structuredOutput: boolean,
  maxOutputTokens: number,
  refusalFallbacks: boolean,
): ModelCapabilities {
  return Object.freeze({ id, provider, thinking, efforts, structuredOutput, maxOutputTokens, refusalFallbacks, known: true });
}

const MODEL_LIST: readonly ModelCapabilities[] = [
  // Anthropic (claude-api model table, cached 2026-06-24).
  m('claude-fable-5-1', 'anthropic', 'adaptive', ALL_EFFORTS, true, 128_000, true),
  m('claude-fable-5', 'anthropic', 'adaptive', ALL_EFFORTS, true, 128_000, true),
  m('claude-opus-5-5', 'anthropic', 'adaptive', ALL_EFFORTS, true, 128_000, false),
  m('claude-opus-5', 'anthropic', 'adaptive', ALL_EFFORTS, true, 128_000, true),
  m('claude-opus-4-8', 'anthropic', 'adaptive', ALL_EFFORTS, true, 128_000, false),
  m('claude-opus-4-7', 'anthropic', 'adaptive', ALL_EFFORTS, false, 128_000, false),
  m('claude-opus-4-6', 'anthropic', 'adaptive', NO_XHIGH, false, 128_000, false),
  m('claude-sonnet-5', 'anthropic', 'adaptive', ALL_EFFORTS, true, 128_000, false),
  m('claude-sonnet-4-6', 'anthropic', 'adaptive', NO_XHIGH, false, 128_000, false),
  m('claude-haiku-4-5', 'anthropic', 'none', [], true, 64_000, false),
  // OpenAI (developers.openai.com/api/docs/models, fetched 2026-09-27).
  m('gpt-6-astra', 'openai', 'none', ALL_EFFORTS, true, 128_000, false),
  m('gpt-6-luna', 'openai', 'none', ALL_EFFORTS, true, 128_000, false),
  m('gpt-6-sol', 'openai', 'none', ALL_EFFORTS, true, 128_000, false),
  m('gpt-5', 'openai', 'none', OPENAI_GPT5_EFFORTS, true, 128_000, false),
  m('gpt-5-mini', 'openai', 'none', OPENAI_GPT5_EFFORTS, true, 128_000, false),
  m('gpt-5-nano', 'openai', 'none', OPENAI_GPT5_EFFORTS, true, 128_000, false),
];

export const MODELS: Readonly<Record<string, ModelCapabilities>> = Object.freeze(
  Object.fromEntries(MODEL_LIST.map((c) => [c.id, c])),
);

/**
 * Retired ids map to their successor with a one-time warning (RUN-06). The
 * bare `claude-<family>-4` ids were never valid API ids; persisted configs that
 * name them keep working through this map.
 */
const RETIRED_ALIAS_RE = /^claude-(haiku|sonnet|opus)-4$/;
const RETIRED_SUCCESSOR: Readonly<Record<string, string>> = Object.freeze({
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-5',
  opus: 'claude-opus-5',
});

const warnedAliases = new Set<string>();

/**
 * Resolve a configured model id. Retired ids resolve to their successor and
 * print one warning per id per process. Any other id is returned unchanged
 * (unknown ids are allowed: they get the fallback price and conservative
 * capabilities, never a crash).
 */
export function resolveModelAlias(model: string, warn: (line: string) => void = defaultWarn): string {
  const hit = RETIRED_ALIAS_RE.exec(model);
  if (!hit) return model;
  const successor = RETIRED_SUCCESSOR[hit[1] ?? ''] ?? model;
  if (!warnedAliases.has(model)) {
    warnedAliases.add(model);
    warn(
      `pensmith: model "${model}" is not a valid model id; using its successor "${successor}" ` +
        `(update the model in your runtime config).`,
    );
  }
  return successor;
}

/** Test-only: forget which aliases already warned. */
export function _resetModelWarningsForTest(): void {
  warnedAliases.clear();
}

function defaultWarn(line: string): void {
  process.stderr.write(line + '\n');
}

/**
 * Capabilities for (provider, model). Local providers and unknown ids get the
 * conservative profile: no thinking parameter, no effort, no native structured
 * output (the tolerant parser applies), and an 8k-token output ceiling for
 * local servers (most local models cap well below the hosted 128k) or 32k for
 * an unknown hosted id.
 */
export function modelCapabilities(provider: ProviderName, model: string): ModelCapabilities {
  if (!LOCAL_PROVIDERS.has(provider)) {
    const known = MODELS[model];
    if (known && known.provider === provider) return known;
  }
  const local = LOCAL_PROVIDERS.has(provider);
  return Object.freeze({
    id: model,
    provider: provider === 'anthropic' ? 'anthropic' : 'openai',
    thinking: 'none',
    efforts: [],
    // Ollama >= 0.5 and vLLM honour response_format json_schema on their
    // OpenAI-compatible endpoints (non-strict), so local providers send it.
    structuredOutput: local,
    maxOutputTokens: local ? 8_192 : 32_000,
    refusalFallbacks: false,
    known: false,
  });
}

/** Pick the effort to send: the slug's effort when supported, else the nearest lower supported level. */
export function effectiveEffort(caps: ModelCapabilities, wanted: Effort): Effort | null {
  if (caps.efforts.length === 0) return null;
  if (caps.efforts.includes(wanted)) return wanted;
  const order: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
  for (let i = order.indexOf(wanted); i >= 0; i -= 1) {
    const e = order[i];
    if (e && caps.efforts.includes(e)) return e;
  }
  return caps.efforts[0] ?? null;
}

// ---------------------------------------------------------------------------
// Prompt slugs (RUN-26, D-17-24)
// ---------------------------------------------------------------------------

export type SlugTier = 'generation' | 'judgment';

export interface SlugSpec {
  readonly slug: string;
  /** The verb that issues this call (replay re-dispatches it, RUN-17). */
  readonly verb: Ux02Verb;
  readonly tier: SlugTier;
  readonly effort: Effort;
  /** Hard per-call max_tokens ceiling (thinking included). */
  readonly maxTokens: number;
  /** The single max_tokens retry budget (2x, capped at the model maximum). */
  readonly retryMaxTokens: number;
  /** Shipped p90 of output tokens (thinking included), used until SESSION.log has 5 samples. */
  readonly p90Output: number;
  /** Typical input tokens for one call (used by --estimate before any prompt exists). */
  readonly inputEstimate: number;
  /** Send cache_control:{type:'ephemeral'} on the stable system block. */
  readonly cacheSystem: boolean;
  /** Structured slugs return schema-validated data (llm-contracts.ts). */
  readonly structured: boolean;
}

function s(
  slug: string,
  verb: Ux02Verb,
  tier: SlugTier,
  effort: Effort,
  maxTokens: number,
  p90Output: number,
  inputEstimate: number,
  cacheSystem: boolean,
  structured: boolean,
): SlugSpec {
  return Object.freeze({
    slug, verb, tier, effort, maxTokens, retryMaxTokens: maxTokens * 2, p90Output, inputEstimate, cacheSystem, structured,
  });
}

const SLUG_LIST: readonly SlugSpec[] = [
  // Generation slugs: the configured model (default claude-opus-5), effort medium; the drafter runs at high.
  s('intake-clarifier', 'new', 'generation', 'medium', 8_000, 2_500, 2_000, false, true),
  s('outline-author', 'outline', 'generation', 'medium', 16_000, 6_000, 6_000, false, true),
  s('section-planner', 'plan', 'generation', 'medium', 16_000, 4_500, 7_000, true, true),
  s('section-drafter', 'write', 'generation', 'high', 16_000, 9_000, 5_000, false, false),
  s('smoother', 'compile', 'generation', 'medium', 16_000, 8_000, 10_000, true, false),
  s('revise-swap', 'plan', 'generation', 'medium', 4_000, 1_500, 3_000, true, false),
  s('tutorial-research-rationale', 'research', 'generation', 'medium', 8_000, 2_500, 4_000, false, false),
  s('tutorial-section-provenance', 'write', 'generation', 'medium', 8_000, 2_500, 4_000, false, false),
  // Judgment slugs: claude-haiku-4-5 / the small OpenAI model / the configured local model.
  s('topic-disambiguator', 'research', 'judgment', 'low', 4_000, 900, 1_500, false, true),
  s('source-evaluator', 'research', 'judgment', 'low', 16_000, 3_500, 15_000, false, true),
  s('claim-support', 'verify', 'judgment', 'low', 2_000, 350, 1_200, false, true),
  s('orphan-label', 'verify', 'judgment', 'low', 1_000, 120, 700, false, true),
];

export const SLUGS: Readonly<Record<string, SlugSpec>> = Object.freeze(
  Object.fromEntries(SLUG_LIST.map((x) => [x.slug, x])),
);

export const SLUG_NAMES: readonly string[] = Object.freeze(SLUG_LIST.map((x) => x.slug));

/**
 * Step names accepted for a per-slug override (`[runtime.slugs.<name>]`) as
 * aliases of the prompt slug that step calls: the verifier passes and the
 * research judges are better known by these names (RUN-26).
 */
export const SLUG_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  pass2: 'claim-support',
  pass4: 'orphan-label',
  evaluator: 'source-evaluator',
  queries: 'topic-disambiguator',
});

/** The prompt slug an override key names (an alias resolved), or null when it names none. */
export function canonicalSlug(name: string): string | null {
  if (name in SLUGS) return name;
  const alias = SLUG_ALIASES[name];
  return alias !== undefined && alias in SLUGS ? alias : null;
}

export class UnknownSlugError extends Error {
  constructor(slug: string) {
    super(`llm-models: unknown prompt slug "${slug}" — add it to the slug table in bin/lib/llm-models.ts`);
    this.name = 'UnknownSlugError';
  }
}

export function slugSpec(slug: string): SlugSpec {
  const spec = SLUGS[slug];
  if (!spec) throw new UnknownSlugError(slug);
  return spec;
}

/** The default model for a slug's tier on a hosted provider (null for local providers). */
export function defaultModelFor(provider: ProviderName, tier: SlugTier): string | null {
  if (provider === 'anthropic' || provider === 'openai') return DEFAULT_MODELS[provider][tier];
  return null;
}
