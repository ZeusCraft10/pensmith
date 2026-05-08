// bin/lib/runtime.ts — runtime SDK config loader (ARCH-14, D-61, D-65) +
// OPENALEX_API_KEY slot per RESEARCH §Key Finding #5.
//
// W11 sibling B — same architectural shape as bin/lib/state.ts (W10) and
// bin/lib/library.ts (W10), with two deliberate divergences:
//
//   1. Two-scope path resolution. Global config lives at
//      `pensmithDataDir()/runtime.json` (W1 platform-local data dir per
//      D-40 — NEVER inside .paper/, OneDrive non-negotiable). Paper config
//      overlay lives at `<paperRoot>/runtime.json` (paper-scope override).
//      `loadRuntimeConfig({scope:'auto', paperRoot?})` merges global ->
//      paper-overlay with paper winning on top-level keys (providers map
//      deep-merges by providerId).
//
//   2. ENOENT translation -> defaults, NOT NotFoundError. Runtime config is
//      OPTIONAL everywhere — first-run pensmith has no runtime.json and the
//      schema defaults are sufficient to operate. This differs from
//      state/library/checkpoint where the file is authoritative; for
//      runtime config, "absent" == "use defaults", not "error".
//
// W2 (atomic-write) + W3 (lock) chokepoint composition is unchanged — the
// write path validates via RuntimeConfigSchema.parse, takes withLock, and
// writes via atomicWriteFile. The read path uses W7 loadAndMigrate; missing
// files become schema defaults instead of throwing.
//
// Key Finding #5 / D-61 — OPENALEX_API_KEY slot semantics:
//   getOpenAlexApiKey() reads process.env[config.openalexApiKeyEnv ??
//   'OPENALEX_API_KEY']. When the env var is unset AND
//   config.openalexApiKeyOptional === true (default per W7 schema), returns
//   undefined — callers degrade gracefully. When openalexApiKeyOptional ===
//   false, throws MissingApiKeyError. This means the env-var slot SHIPS NOW
//   even though the OpenAlex client lands in a later phase, so post-Phase-1
//   callsites have one canonical accessor and don't need a schema migration
//   when they wire it to actual HTTP calls.
//
// Critical no-leak property (T-01-07):
//   - Resolved api-key VALUES never reach disk. Only env-var NAMES are
//     persisted (W7 schema enforces via z.string() on apiKeyEnv field, not
//     a discriminated union with the actual key — there's no field where a
//     key value could be stored).
//   - Resolved api-key VALUES never reach the session log. Every log()
//     event-kind call payload contains envName / providerId / present /
//     optional / scope / schemaVersion only — NEVER the resolved string.
//   - tests/runtime.test.ts has the load-bearing no-leak property test:
//     after saving a runtime.json that points at process.env.SECRET_VALUE,
//     reading the persisted file as a string asserts the env VALUE is
//     absent and the env NAME is present.
//
// Foundation-slice contract:
//   - The runtime config is read-only at start of pensmith — this means
//     concurrent loadRuntimeConfig calls don't need a lock. Concurrent
//     saveRuntimeConfig calls DO need a lock; we use withLock per the W10
//     pattern. There is no "load INSIDE the lock for updateConfig" pattern
//     here because Phase 1 ships no updateRuntimeConfig — saves are full
//     replacements (config edits go through `pensmith config <key>=<value>`
//     in Phase 7+, which is out-of-scope here).
//
// Forward-incompat contract (T-01-COMPAT-01 mitigation):
//   - ForwardIncompatError from loadAndMigrate propagates UNCHANGED — runtime
//     config is AUTHORITATIVE persistence (vs. checkpoint's append-only
//     audit-log carve-out from D-39). A newer-on-disk runtime.json from a
//     future pensmith version, opened by older code, MUST refuse-forward so
//     we don't silently drop fields.
//
// Imports limited to: node:fs, node:path, and the W2/W3/W7/W9 chokepoint
// modules. No third-party deps. No env var reads outside getProviderApiKey
// and getOpenAlexApiKey (those are the explicit, tested points where env ->
// runtime crosses the trust boundary).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { loadAndMigrate } from './migrations/loader.js';
import {
  Schema as RuntimeConfigSchema,
  CURRENT_RUNTIME_CONFIG_VERSION,
  type RuntimeConfig,
} from './schemas/runtime-config.js';
import { pensmithDataDir } from './paths.js';
import { openSessionLog, type SessionLogger } from './session-log.js';

// ---------------------------------------------------------------------------
// Types + Errors (per <interfaces> in 01-13-PLAN.md).
// ---------------------------------------------------------------------------

export type LoadScope = 'global' | 'paper' | 'auto';

export class MissingApiKeyError extends Error {
  code = 'MISSING_API_KEY' as const;
  constructor(message: string) {
    super(message);
    this.name = 'MissingApiKeyError';
  }
}

// Re-export the RuntimeConfig type so callers can import it from this module
// (consistent with state.ts / library.ts / checkpoint.ts).
export type { RuntimeConfig };

// ---------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to the GLOBAL runtime.json under pensmithDataDir().
 * Per D-40 / D-43 the global path lives in the platform-local data dir
 * (LOCALAPPDATA on Windows, ~/Library/Application Support on macOS,
 * XDG_DATA_HOME on Linux) — NEVER inside .paper/ (OneDrive non-negotiable).
 */
function globalConfigPath(): string {
  return path.join(pensmithDataDir(), 'runtime.json');
}

/**
 * Resolve the absolute path to the PAPER-SCOPE runtime.json overlay at
 * `<paperRoot>/runtime.json`. Paper-scope overlay is fine inside .paper/
 * since it's user-owned config (NOT lock state, NOT cache, NOT secrets) —
 * the overlay file at most contains env-var NAMES + boolean toggles, never
 * api-key VALUES.
 */
function paperConfigPath(paperRoot: string): string {
  return path.join(path.resolve(paperRoot), 'runtime.json');
}

/**
 * Module-level singleton SessionLogger child bound to `module: 'runtime'`.
 * Lazy-initialized so test files that mutate process.env (LOCALAPPDATA,
 * XDG_DATA_HOME, HOME) BEFORE dynamically importing this module observe the
 * mutated env. openSessionLog reads paths.ts at call-time, so this singleton
 * resolves the log destination at first use, not at import.
 *
 * IMPORTANT: every log call in this file emits ONLY safe fields (envName,
 * providerId, present, optional, scope, schemaVersion, event). NEVER the
 * resolved api-key VALUE. T-01-07 mitigation is partly load-bearing on this
 * invariant — see the no-leak test in tests/runtime.test.ts.
 */
let _log: SessionLogger | null = null;
function log(): SessionLogger {
  if (!_log) {
    _log = openSessionLog({ scope: 'auto' }).child({ module: 'runtime' });
  }
  return _log;
}

/**
 * Construct a default RuntimeConfig. The W7 RuntimeConfigSchema's `providers`
 * map has a `.refine` requiring at least one provider — a runtime config with
 * zero providers is non-functional, so the schema rejects empty maps. This
 * means we can't simply call `RuntimeConfigSchema.parse({})` to fill defaults
 * — we have to seed at least one provider entry.
 *
 * The default seed is `anthropic` with apiKeyEnv='ANTHROPIC_API_KEY'. This
 * is the production-typical first provider; pensmith without an Anthropic
 * key is operable but limited. Callers that prefer OpenAI as primary can
 * overwrite by saveRuntimeConfig with their own provider map.
 *
 * The other defaulted fields (openalexApiKeyEnv='OPENALEX_API_KEY',
 * openalexApiKeyOptional=true, contactEmailEnv='PENSMITH_CONTACT_EMAIL')
 * come from the schema's .default() calls.
 */
function defaults(): RuntimeConfig {
  return RuntimeConfigSchema.parse({
    $schemaVersion: CURRENT_RUNTIME_CONFIG_VERSION,
    providers: {
      anthropic: { name: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY' },
    },
  });
}

/**
 * Try to load a single runtime.json file via W7 loadAndMigrate. Returns
 * null on ENOENT (file absent), the parsed config on success. All other
 * errors (JSON parse, schema validation, ForwardIncompatError, permission)
 * bubble up unchanged.
 *
 * `writeBack: true` so a future v1->v2 migration persists the upgraded
 * shape on disk. Today the migration registry is empty (we're at v1) so
 * no actual write occurs.
 */
async function readOne(file: string): Promise<RuntimeConfig | null> {
  try {
    return (await loadAndMigrate({
      file,
      schema: RuntimeConfigSchema,
      schemaName: 'runtime-config',
      currentVersion: CURRENT_RUNTIME_CONFIG_VERSION,
      writeBack: true,
    })) as RuntimeConfig;
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
    if (err?.code === 'ENOENT' || err?.cause?.code === 'ENOENT') {
      return null;
    }
    throw e;
  }
}

/**
 * Merge `overlay` on top of `base`. Top-level keys are shallow-merged
 * (overlay wins). The `providers` map is deep-merged by providerId
 * (overlay's providerId entries win, but base's other providerId entries
 * survive).
 *
 * Returns the merged result re-validated through RuntimeConfigSchema.parse —
 * this guarantees defense-in-depth even if a hand-edited overlay is malformed
 * in a way the per-file load missed (e.g. overlay missing $schemaVersion gets
 * defaulted by readVersion -> 1, then revalidated here).
 */
function mergeOverlay(
  base: RuntimeConfig,
  overlay: RuntimeConfig | null,
): RuntimeConfig {
  if (!overlay) return base;
  const providers = { ...base.providers, ...overlay.providers };
  return RuntimeConfigSchema.parse({
    ...base,
    ...overlay,
    providers,
  });
}

// ---------------------------------------------------------------------------
// Public API (D-61 + D-65 + Key Finding #5 OpenAlex slot).
// ---------------------------------------------------------------------------

/**
 * Load runtime config according to `opts.scope`.
 *
 *   scope='global' (explicit)
 *     Read pensmithDataDir()/runtime.json. Missing file -> defaults().
 *
 *   scope='paper' (explicit)
 *     Read <paperRoot>/runtime.json. Missing file -> defaults().
 *     Throws if opts.paperRoot is not provided.
 *
 *   scope='auto' (default, no scope passed)
 *     Read global first; if opts.paperRoot is provided, also read paper and
 *     overlay it on top (paper wins on each top-level key; providers
 *     deep-merge by providerId). Missing files at either scope contribute
 *     defaults (no error).
 *
 * Per D-61, runtime config is OPTIONAL everywhere — first-run pensmith with
 * no runtime.json operates with schema defaults. This is why ENOENT is
 * translated to defaults instead of NotFoundError (cf. state.ts which throws
 * StateNotFoundError for the same condition).
 *
 * ForwardIncompatError propagates UNCHANGED (T-01-COMPAT-01 mitigation):
 * a newer-on-disk runtime.json from a future pensmith version, opened by
 * older code, MUST refuse-forward so we don't silently drop fields.
 *
 * Emits exactly one event-kind log record per call (event:'runtime.load',
 * scope, schemaVersion). NEVER logs api-key values.
 */
export async function loadRuntimeConfig(
  opts: { scope?: LoadScope; paperRoot?: string } = {},
): Promise<RuntimeConfig> {
  const scope = opts.scope ?? 'auto';
  let result: RuntimeConfig;

  if (scope === 'global') {
    result = (await readOne(globalConfigPath())) ?? defaults();
  } else if (scope === 'paper') {
    if (!opts.paperRoot) {
      throw new Error('loadRuntimeConfig: paperRoot is required when scope="paper"');
    }
    result = (await readOne(paperConfigPath(opts.paperRoot))) ?? defaults();
  } else {
    // auto: global first, then paper-overlay if paperRoot is provided.
    const global_ = (await readOne(globalConfigPath())) ?? defaults();
    if (opts.paperRoot) {
      const paper = await readOne(paperConfigPath(opts.paperRoot));
      result = mergeOverlay(global_, paper);
    } else {
      result = global_;
    }
  }

  log().event({
    event: 'runtime.load',
    scope,
    schemaVersion: result.$schemaVersion,
  });

  return result;
}

/**
 * Atomically write `config` to the global or paper-scope runtime.json.
 *
 * Refuses scope='auto' — the caller must explicitly pick a destination
 * because auto-merge has no inverse (we don't know which keys came from
 * global vs. paper). Throws if scope='paper' and opts.paperRoot is not
 * provided.
 *
 * RuntimeConfigSchema.parse runs BEFORE the lock — refuses to write
 * malformed config regardless of caller discipline (T-01-08 mitigation).
 * The schema's `providers` .refine guard ensures at least one provider is
 * present; bare `{...cfg, providers: {}}` will reject before disk is
 * touched.
 *
 * mkdir -p on the parent directory before atomicWriteFile so first-run
 * (no pensmithDataDir() yet) succeeds without requiring a separate init.
 *
 * Emits exactly one event-kind log record per call (event:'runtime.save',
 * scope, schemaVersion). NEVER logs api-key values.
 */
export async function saveRuntimeConfig(
  scope: 'global' | 'paper',
  config: RuntimeConfig,
  opts: { paperRoot?: string } = {},
): Promise<void> {
  let file: string;
  if (scope === 'global') {
    file = globalConfigPath();
  } else {
    if (!opts.paperRoot) {
      throw new Error('saveRuntimeConfig: paperRoot is required when scope="paper"');
    }
    file = paperConfigPath(opts.paperRoot);
  }

  // Defense-in-depth: parse BEFORE the lock so caller-side garbage fails
  // fast without contending the per-file critical section.
  const validated = RuntimeConfigSchema.parse(config);

  await withLock(file, async () => {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await atomicWriteFile(file, JSON.stringify(validated, null, 2) + '\n');
  });

  log().event({
    event: 'runtime.save',
    scope,
    schemaVersion: validated.$schemaVersion,
  });
}

/**
 * Resolve the api key for `providerId` by reading process.env at the env-var
 * NAME stored in the runtime config's providers map.
 *
 * The provider entry MUST exist in the loaded config — throws
 * MissingApiKeyError(`no provider config for "${providerId}"`) otherwise.
 * The env var MUST be set to a non-empty string — throws
 * MissingApiKeyError(`env var ${envName} is not set ...`) otherwise.
 *
 * Critical no-leak property (T-01-07): the resolved value is RETURNED to the
 * caller but NEVER logged. The session-log call carries envName + providerId
 * only. Callers that subsequently log the return value are responsible for
 * routing it through the W8 redactor (Authorization-header style ctx); that
 * is a downstream concern.
 *
 * Emits exactly one event-kind log record per call (event:'runtime.apiKey',
 * providerId, envName). NEVER logs the value.
 */
export async function getProviderApiKey(
  providerId: string,
  opts: { scope?: LoadScope; paperRoot?: string } = {},
): Promise<string> {
  const cfg = await loadRuntimeConfig(opts);
  const provider = cfg.providers?.[providerId];
  if (!provider) {
    throw new MissingApiKeyError(
      `no provider config for "${providerId}"`,
    );
  }
  const envName = provider.apiKeyEnv;
  const value = process.env[envName];
  if (!value || value.length === 0) {
    throw new MissingApiKeyError(
      `env var ${envName} is not set (required for provider "${providerId}")`,
    );
  }

  // NEVER log the value — only the env-var name + providerId. T-01-07.
  log().event({
    event: 'runtime.apiKey',
    providerId,
    envName,
  });

  return value;
}

/**
 * Resolve the OpenAlex api key per Key Finding #5 / D-61.
 *
 * Reads process.env[config.openalexApiKeyEnv ?? 'OPENALEX_API_KEY']. When the
 * env var is unset AND config.openalexApiKeyOptional === true (default per
 * W7 schema), returns undefined — callers degrade gracefully. When
 * openalexApiKeyOptional === false (caller has explicitly opted into hard-
 * required), throws MissingApiKeyError.
 *
 * The default optional=true semantics are deliberate:
 *   - OpenAlex's polite pool works with email-only authentication; no key
 *     is strictly required for Phase 1.
 *   - The slot SHIPS NOW so post-Phase-1 callsites have one canonical
 *     accessor and don't need a schema migration when wiring real HTTP.
 *   - Callers MUST handle undefined gracefully — see the carry-forward note
 *     in the SUMMARY.
 *
 * Critical no-leak property (T-01-07): if a value is found, it is RETURNED
 * to the caller but NEVER logged. The session-log call carries envName +
 * present:boolean + optional:boolean only. NEVER the resolved value.
 *
 * Emits exactly one event-kind log record per call (event:'runtime.openalex',
 * envName, optional, present). NEVER logs the value.
 */
export async function getOpenAlexApiKey(
  opts: { scope?: LoadScope; paperRoot?: string } = {},
): Promise<string | undefined> {
  const cfg = await loadRuntimeConfig(opts);
  const envName = cfg.openalexApiKeyEnv ?? 'OPENALEX_API_KEY';
  const optional = cfg.openalexApiKeyOptional ?? true;
  const resolved = process.env[envName];
  const present = !!(resolved && resolved.length > 0);

  // NEVER log the resolved string — only the env-var name + presence boolean.
  // T-01-07. The pre-computed `present` boolean is what's logged; the resolved
  // value lives only in the local variable until it's returned to the caller.
  log().event({
    event: 'runtime.openalex',
    envName,
    optional,
    present,
  });

  if (present) return resolved;
  if (optional) return undefined;
  throw new MissingApiKeyError(
    `env var ${envName} is not set (OpenAlex API key is required by current config)`,
  );
}
