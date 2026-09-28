// bin/lib/runtime.ts — LLM runtime resolution (RUN-07, RUN-08, RUN-26; D-17-19).
//
// Resolution precedence, per field:
//   provider:   --runtime flag > .paper/config.toml [runtime] > global runtime.json
//               > provider detected from env (only OPENAI_API_KEY set → openai)
//               > default (anthropic)
//   model:      --model flag > [runtime] model > global model > provider default
//               (claude-opus-5 / gpt-6-astra; local providers have none)
//   endpoint,
//   api_key_env: the GLOBAL runtime.json only (S-18) > provider default
//   effort, price overrides, refusal_fallbacks, per-slug overrides:
//               [runtime] > global runtime.json > default
// A layer's model / price / endpoint applies only when that layer names no
// provider or the same provider that won, so `--runtime ollama` never sends a
// Claude model id to Ollama.
//
// The global runtime.json lives at pensmithDataDir()/runtime.json (never inside
// .paper/, which may sit in a sync folder or a cloned repo). Its v1 → v2
// migration is written back under the per-file lock. The paper-level
// `<root>/runtime.json` overlay of v0.1 is retired: finding one prints a
// one-time warning naming the config.toml section to use instead.
//
// No-leak (T-01-07): only env-var NAMES are persisted or logged. The key VALUE
// is returned by getProviderApiKey() to the transport and nowhere else.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { loadAndMigrate, SchemaValidationError, ForwardIncompatError } from './migrations/loader.js';
import {
  Schema as RuntimeConfigSchema,
  CURRENT_RUNTIME_CONFIG_VERSION,
  PROVIDER_ENUM_MESSAGE,
  type RuntimeConfig,
} from './schemas/runtime-config.js';
import { migrate as runtimeV1ToV2 } from './migrations/runtime-config/v1_to_v2.js';
import { paperDir, pensmithDataDir, projectRoot } from './paths.js';
import { openSessionLog, type SessionLogger } from './session-log.js';
import { EXIT_ERROR, PensmithError } from './exit-codes.js';
import {
  DEFAULT_ENDPOINTS,
  DEFAULT_KEY_ENV,
  LOCAL_PROVIDERS,
  PROVIDER_NAMES,
  defaultModelFor,
  isProviderName,
  resolveModelAlias,
  slugSpec,
  type Effort,
  type ProviderName,
} from './llm-models.js';
import { loadPaperConfig } from './config.js';
import type { PriceOverride } from './pricing.js';

export type { RuntimeConfig };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** No usable key for the resolved hosted provider (exit EXIT_ERROR, one line). */
export class MissingApiKeyError extends PensmithError {
  code = 'MISSING_API_KEY' as const;
  constructor(message: string) {
    super(message, EXIT_ERROR);
    this.name = 'MissingApiKeyError';
  }
}

/** An invalid runtime configuration (unknown provider, bad runtime.json, missing local model). */
export class RuntimeConfigError extends PensmithError {
  constructor(message: string) {
    super(message, EXIT_ERROR);
    this.name = 'RuntimeConfigError';
  }
}

// ---------------------------------------------------------------------------
// Session logger (event records only — never a key value)
// ---------------------------------------------------------------------------

let _log: SessionLogger | null = null;
function log(): SessionLogger {
  if (!_log) _log = openSessionLog({ scope: 'auto' }).child({ module: 'runtime' });
  return _log;
}

// ---------------------------------------------------------------------------
// Global runtime.json
// ---------------------------------------------------------------------------

export function globalRuntimeConfigPath(): string {
  return path.join(pensmithDataDir(), 'runtime.json');
}

function defaults(): RuntimeConfig {
  return RuntimeConfigSchema.parse({ $schemaVersion: CURRENT_RUNTIME_CONFIG_VERSION });
}

function friendlyIssues(e: SchemaValidationError): string {
  return e.zodIssue
    .slice(0, 3)
    .map((i) => {
      const where = i.path.length ? i.path.join('.') : '(root)';
      if (where === 'provider' && i.message === PROVIDER_ENUM_MESSAGE) {
        const received = (i as { received?: unknown }).received;
        return `unknown provider ${JSON.stringify(received)} (valid values: ${PROVIDER_NAMES.join(', ')})`;
      }
      return `${where}: ${i.message}`;
    })
    .join('; ');
}

async function readGlobal(file: string): Promise<RuntimeConfig | null> {
  try {
    return await withLock(file, async () =>
      (await loadAndMigrate({
        file,
        schema: RuntimeConfigSchema,
        schemaName: 'runtime-config',
        currentVersion: CURRENT_RUNTIME_CONFIG_VERSION,
        migrations: { 1: runtimeV1ToV2 },
        writeBack: true,
      })) as RuntimeConfig,
    );
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
    if (err?.code === 'ENOENT' || err?.cause?.code === 'ENOENT') return null;
    if (e instanceof SchemaValidationError) throw new RuntimeConfigError(`${file}: ${friendlyIssues(e)}`);
    if (e instanceof ForwardIncompatError) throw new RuntimeConfigError(e.message.replace(/^pensmith: /, ''));
    if (e instanceof SyntaxError) throw new RuntimeConfigError(`${file} is not valid JSON: ${e.message}`);
    throw e;
  }
}

/**
 * Load the GLOBAL runtime config (missing file → schema defaults). Throws
 * RuntimeConfigError (one line, no zod dump) on an invalid or newer file.
 * `paperRoot` only drives the retired-overlay warning.
 */
export async function loadRuntimeConfig(opts: { paperRoot?: string } = {}): Promise<RuntimeConfig> {
  const result = (await readGlobal(globalRuntimeConfigPath())) ?? defaults();
  if (opts.paperRoot) warnRetiredPaperOverlay(opts.paperRoot);
  log().event({ event: 'runtime.load', scope: 'global', schemaVersion: result.$schemaVersion });
  return result;
}

/** Atomically write the global runtime.json (validated before the lock). */
export async function saveRuntimeConfig(config: RuntimeConfig): Promise<void> {
  const file = globalRuntimeConfigPath();
  const validated = RuntimeConfigSchema.parse(config);
  await withLock(file, async () => {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await atomicWriteFile(file, JSON.stringify(validated, null, 2) + '\n');
  });
  log().event({ event: 'runtime.save', scope: 'global', schemaVersion: validated.$schemaVersion });
}

const warnedOverlay = new Set<string>();

function warnRetiredPaperOverlay(root: string): void {
  for (const candidate of [path.join(root, 'runtime.json'), path.join(paperDir(root), 'runtime.json')]) {
    if (warnedOverlay.has(candidate) || !fs.existsSync(candidate)) continue;
    warnedOverlay.add(candidate);
    process.stderr.write(
      `pensmith: ${candidate} is no longer read (the paper-level runtime.json overlay is retired). ` +
        `Move provider, model, effort and price overrides to .paper/config.toml [runtime] ` +
        `(per-slug overrides under [runtime.slugs.<slug>]); endpoint and api_key_env belong in ` +
        `${globalRuntimeConfigPath()}.\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// --runtime / --model flags (pre-parsed by the dispatcher's (b2) block)
// ---------------------------------------------------------------------------

export interface RuntimeOverride {
  provider?: string;
  model?: string;
}

let override: RuntimeOverride = {};

export function setRuntimeOverride(o: RuntimeOverride): void {
  const next: RuntimeOverride = {};
  if (typeof o.provider === 'string' && o.provider.length > 0) next.provider = o.provider;
  if (typeof o.model === 'string' && o.model.length > 0) next.model = o.model;
  override = next;
}

export function getRuntimeOverride(): RuntimeOverride {
  return { ...override };
}

/** The value of `--<name> <v>` or `--<name>=<v>` in argv (first occurrence), else undefined. */
export function argvFlagValue(argv: readonly string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i] ?? '';
    if (tok === `--${name}`) {
      const next = argv[i + 1];
      return next !== undefined && !next.startsWith('--') ? next : undefined;
    }
    if (tok.startsWith(`--${name}=`)) return tok.slice(name.length + 3);
  }
  return undefined;
}

/** `--runtime <provider>` / `--model <id>` from argv (the dispatcher's (b2) pre-parse). */
export function runtimeFlagsFromArgv(argv: readonly string[]): RuntimeOverride {
  const out: RuntimeOverride = {};
  const provider = argvFlagValue(argv, 'runtime');
  const model = argvFlagValue(argv, 'model');
  if (provider !== undefined) out.provider = provider;
  if (model !== undefined) out.model = model;
  return out;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type RuntimeSource = 'flag' | 'config' | 'global' | 'env' | 'default';

export interface SlugResolution {
  slug: string;
  model: string | null;
  modelSource: RuntimeSource | 'slug-config' | 'slug-global' | 'tier-default';
  effort: Effort;
  effortSource: RuntimeSource | 'slug-config' | 'slug-global' | 'slug-default';
}

export interface ResolvedRuntime {
  provider: ProviderName;
  providerSource: RuntimeSource;
  /** The generation model (null for a local provider with no configured model). */
  model: string | null;
  modelSource: RuntimeSource;
  /** Paper-level generation effort override (null → per-slug defaults). */
  effort: Effort | null;
  effortSource: RuntimeSource;
  endpoint: string | null;
  endpointSource: RuntimeSource;
  apiKeyEnv: string | null;
  apiKeyEnvSource: RuntimeSource;
  priceOverride: PriceOverride;
  priceSource: RuntimeSource | null;
  refusalFallbacks: 'off' | 'default';
  refusalFallbacksSource: RuntimeSource;
  slugOverrides: Readonly<Record<string, { model?: string; effort?: Effort; source: 'slug-config' | 'slug-global' }>>;
  /** The loaded global runtime.json (OpenAlex / contact-email slots). */
  global: RuntimeConfig;
}

function envPresent(env: NodeJS.ProcessEnv, name: string): boolean {
  const v = env[name];
  return typeof v === 'string' && v.length > 0;
}

/**
 * Resolve the effective runtime for `paperRoot` (default: the project root).
 * Throws RuntimeConfigError for an unknown provider (listing the valid values),
 * an invalid global runtime.json, or an invalid paper config.
 */
export async function resolveRuntime(
  opts: { paperRoot?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<ResolvedRuntime> {
  const root = opts.paperRoot ?? projectRoot();
  const env = opts.env ?? process.env;
  const global = await loadRuntimeConfig({ paperRoot: root });
  // Read-only: an older config.toml is migrated in memory here; the file is
  // written back only by a mutating session under its lock
  // (config.ts migratePaperConfigFile) — never by `status --config`.
  const paper = (await loadPaperConfig(root, { writeBack: false })).runtime ?? {};

  // provider
  let provider: string;
  let providerSource: RuntimeSource;
  if (override.provider !== undefined) {
    provider = override.provider;
    providerSource = 'flag';
  } else if (paper.provider !== undefined) {
    provider = paper.provider;
    providerSource = 'config';
  } else if (global.provider !== undefined) {
    provider = global.provider;
    providerSource = 'global';
  } else if (envPresent(env, 'OPENAI_API_KEY') && !envPresent(env, 'ANTHROPIC_API_KEY')) {
    provider = 'openai';
    providerSource = 'env';
  } else {
    provider = 'anthropic';
    providerSource = 'default';
  }
  if (!isProviderName(provider)) {
    const where = providerSource === 'flag' ? '--runtime' : providerSource === 'config' ? '.paper/config.toml [runtime] provider' : 'provider';
    throw new RuntimeConfigError(
      `unknown provider ${JSON.stringify(provider)} (${where}); valid values: ${PROVIDER_NAMES.join(', ')}`,
    );
  }
  const p: ProviderName = provider;
  const paperMatches = paper.provider === undefined || paper.provider === p;
  const globalMatches = global.provider === undefined || global.provider === p;

  // generation model
  let model: string | null;
  let modelSource: RuntimeSource;
  if (override.model !== undefined) {
    model = override.model;
    modelSource = 'flag';
  } else if (paperMatches && paper.model !== undefined) {
    model = paper.model;
    modelSource = 'config';
  } else if (globalMatches && global.model !== undefined) {
    model = global.model;
    modelSource = 'global';
  } else {
    model = defaultModelFor(p, 'generation');
    modelSource = 'default';
  }
  if (model !== null) model = resolveModelAlias(model);

  // endpoint + key variable: global file only
  const endpoint = globalMatches && global.endpoint !== undefined ? global.endpoint : DEFAULT_ENDPOINTS[p];
  const endpointSource: RuntimeSource = globalMatches && global.endpoint !== undefined ? 'global' : 'default';
  const apiKeyEnv = globalMatches && global.api_key_env !== undefined ? global.api_key_env : DEFAULT_KEY_ENV[p];
  const apiKeyEnvSource: RuntimeSource = globalMatches && global.api_key_env !== undefined ? 'global' : 'default';

  // price override
  let priceOverride: PriceOverride = {};
  let priceSource: RuntimeSource | null = null;
  if (paperMatches && (paper.price_in_per_mtok !== undefined || paper.price_out_per_mtok !== undefined)) {
    priceOverride = { inputPerMtok: paper.price_in_per_mtok, outputPerMtok: paper.price_out_per_mtok };
    priceSource = 'config';
  } else if (globalMatches && (global.price_in_per_mtok !== undefined || global.price_out_per_mtok !== undefined)) {
    priceOverride = { inputPerMtok: global.price_in_per_mtok, outputPerMtok: global.price_out_per_mtok };
    priceSource = 'global';
  }

  // refusal fallbacks
  let refusalFallbacks: 'off' | 'default' = 'off';
  let refusalFallbacksSource: RuntimeSource = 'default';
  if (paper.refusal_fallbacks !== undefined) {
    refusalFallbacks = paper.refusal_fallbacks;
    refusalFallbacksSource = 'config';
  } else if (global.refusal_fallbacks !== undefined) {
    refusalFallbacks = global.refusal_fallbacks;
    refusalFallbacksSource = 'global';
  }

  // per-slug overrides (paper wins per field)
  const slugOverrides: Record<string, { model?: string; effort?: Effort; source: 'slug-config' | 'slug-global' }> = {};
  for (const [slug, o] of Object.entries(global.slugs ?? {})) {
    if (!globalMatches) break;
    slugOverrides[slug] = { ...(o.model ? { model: resolveModelAlias(o.model) } : {}), ...(o.effort ? { effort: o.effort } : {}), source: 'slug-global' };
  }
  for (const [slug, o] of Object.entries(paper.slugs ?? {})) {
    if (!paperMatches) break;
    const prev = slugOverrides[slug];
    slugOverrides[slug] = {
      ...(prev ?? {}),
      ...(o.model ? { model: resolveModelAlias(o.model) } : {}),
      ...(o.effort ? { effort: o.effort } : {}),
      source: 'slug-config',
    };
  }

  return {
    provider: p,
    providerSource,
    model,
    modelSource,
    effort: paper.effort ?? null,
    effortSource: paper.effort !== undefined ? 'config' : 'default',
    endpoint,
    endpointSource,
    apiKeyEnv,
    apiKeyEnvSource,
    priceOverride,
    priceSource,
    refusalFallbacks,
    refusalFallbacksSource,
    slugOverrides,
    global,
  };
}

/**
 * The model and effort one prompt slug uses (RUN-26):
 *   generation slugs: --model > [runtime.slugs.<slug>] > [runtime] model > global > default;
 *   judgment slugs:   [runtime.slugs.<slug>] > the provider's small model
 *                     (claude-haiku-4-5 / gpt-6-luna); local providers use the
 *                     configured model for every slug.
 *   effort: [runtime.slugs.<slug>] effort > [runtime] effort (generation only) > the slug default.
 */
export function resolveSlug(rt: ResolvedRuntime, slug: string): SlugResolution {
  const spec = slugSpec(slug);
  const o = rt.slugOverrides[slug];
  let model: string | null;
  let modelSource: SlugResolution['modelSource'];
  if (spec.tier === 'generation' && rt.modelSource === 'flag') {
    model = rt.model;
    modelSource = 'flag';
  } else if (o?.model) {
    model = o.model;
    modelSource = o.source;
  } else if (spec.tier === 'generation' || LOCAL_PROVIDERS.has(rt.provider)) {
    model = rt.model;
    modelSource = rt.modelSource;
  } else {
    model = defaultModelFor(rt.provider, 'judgment');
    modelSource = 'tier-default';
  }
  let effort: Effort = spec.effort;
  let effortSource: SlugResolution['effortSource'] = 'slug-default';
  if (o?.effort) {
    effort = o.effort;
    effortSource = o.source;
  } else if (spec.tier === 'generation' && rt.effort) {
    effort = rt.effort;
    effortSource = rt.effortSource;
  }
  return { slug, model, modelSource, effort, effortSource };
}

// ---------------------------------------------------------------------------
// Key resolution (the ONLY place a key VALUE is read)
// ---------------------------------------------------------------------------

/** The key variable a provider id reads under the resolved runtime. */
export function apiKeyEnvFor(rt: ResolvedRuntime, providerId: string): string | null {
  if (providerId === rt.provider) return rt.apiKeyEnv;
  return isProviderName(providerId) ? DEFAULT_KEY_ENV[providerId] : null;
}

/**
 * Resolve the API key VALUE for `providerId`. Local providers without a
 * configured key variable return '' (no Authorization header). A hosted
 * provider with no key throws MissingApiKeyError naming the variable and the
 * `Set one of:` hint. The value is returned to the transport and never logged.
 */
export async function getProviderApiKey(
  providerId: string,
  opts: { paperRoot?: string } = {},
): Promise<string> {
  const rt = await resolveRuntime(opts.paperRoot !== undefined ? { paperRoot: opts.paperRoot } : {});
  if (!isProviderName(providerId)) {
    throw new RuntimeConfigError(`unknown provider ${JSON.stringify(providerId)}; valid values: ${PROVIDER_NAMES.join(', ')}`);
  }
  const envName = apiKeyEnvFor(rt, providerId);
  const local = LOCAL_PROVIDERS.has(providerId);
  if (envName === null) {
    if (local) return '';
    throw new MissingApiKeyError(`no API key variable configured for provider "${providerId}"`);
  }
  const value = process.env[envName];
  if (!value || value.length === 0) {
    if (local) return '';
    throw new MissingApiKeyError(
      `${envName} is not set (provider "${providerId}"). ` +
        'Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY (or configure a local endpoint)',
    );
  }
  log().event({ event: 'runtime.apiKey', providerId, envName });
  return value;
}

/** Presence of a provider's key variable (boolean only; no value escapes). */
export function isApiKeyPresent(envName: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  return envName !== null && envPresent(env, envName);
}

// ---------------------------------------------------------------------------
// OpenAlex / Semantic Scholar key slots (unchanged contracts)
// ---------------------------------------------------------------------------

export async function getOpenAlexApiKey(): Promise<string | undefined> {
  const cfg = await loadRuntimeConfig();
  const envName = cfg.openalexApiKeyEnv ?? 'OPENALEX_API_KEY';
  const optional = cfg.openalexApiKeyOptional ?? true;
  const resolved = process.env[envName];
  const present = !!(resolved && resolved.length > 0);
  log().event({ event: 'runtime.openalex', envName, optional, present });
  if (present) return resolved;
  if (optional) return undefined;
  throw new MissingApiKeyError(`env var ${envName} is not set (OpenAlex API key is required by current config)`);
}

let _s2WarnedOnce = false;

/** Presence-only accessor for PENSMITH_S2_API_KEY (D-16): the value never leaves here. */
export function getS2ApiKey(): { present: boolean; name: 'PENSMITH_S2_API_KEY' } {
  const raw = process.env['PENSMITH_S2_API_KEY'];
  const present = !!(raw && raw.length > 0);
  if (!present && !_s2WarnedOnce) {
    _s2WarnedOnce = true;
    log().warn({ event: 'runtime.s2.keyless', envName: 'PENSMITH_S2_API_KEY' });
  }
  return { present, name: 'PENSMITH_S2_API_KEY' };
}

/** The provider key variables worth reporting (names only) for capability facts and doctor. */
export async function providerKeyVariables(): Promise<Array<{ name: string; api_key_env: string }>> {
  const out: Array<{ name: string; api_key_env: string }> = [
    { name: 'anthropic', api_key_env: 'ANTHROPIC_API_KEY' },
    { name: 'openai', api_key_env: 'OPENAI_API_KEY' },
  ];
  let rt: ResolvedRuntime | null = null;
  try {
    rt = await resolveRuntime();
  } catch {
    rt = null;
  }
  if (rt && rt.apiKeyEnv && !out.some((e) => e.name === rt!.provider && e.api_key_env === rt!.apiKeyEnv)) {
    const idx = out.findIndex((e) => e.name === rt!.provider);
    if (idx >= 0) out[idx] = { name: rt.provider, api_key_env: rt.apiKeyEnv };
    else out.push({ name: rt.provider, api_key_env: rt.apiKeyEnv });
  }
  return out;
}

/** The slug spec lookup is re-exported for callers that only import runtime.ts. */
export { slugSpec };
