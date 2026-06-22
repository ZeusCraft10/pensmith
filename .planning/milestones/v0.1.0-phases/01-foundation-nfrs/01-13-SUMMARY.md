---
phase: 01-foundation-nfrs
plan: 13
subsystem: runtime
wave: 11
tags: [runtime, pricing, sdk-config, openalex-slot, api-key-chokepoint, no-leak, foundation-slice, two-scope-overlay, forward-compat]
requires:
  - bin/lib/atomic-write.ts (W2 — atomicWriteFile)
  - bin/lib/lock.ts (W3 — withLock)
  - bin/lib/migrations/loader.ts (W7 — loadAndMigrate, ForwardIncompatError)
  - bin/lib/schemas/runtime-config.ts (W7 — Schema, CURRENT_RUNTIME_CONFIG_VERSION, type RuntimeConfig)
  - bin/lib/paths.ts (W1 — pensmithDataDir)
  - bin/lib/session-log.ts (W9 — openSessionLog)
provides:
  - bin/lib/pricing.ts (MODEL_PRICES, estimateCost, UnknownModelError, type ModelPrice)
  - bin/lib/runtime.ts (loadRuntimeConfig, saveRuntimeConfig, getProviderApiKey, getOpenAlexApiKey, MissingApiKeyError, type LoadScope, type RuntimeConfig)
affects:
  - W6 budget.ts — Phase 5+ wires `import { estimateCost } from './pricing.js'` into assertBudget/appendCost callsites; pricing.ts public surface matches the W6 plan-time signature so no W6 changes are required
  - Future OpenAlex client (post-Phase-1) — every callsite that consumes OpenAlex MUST call getOpenAlexApiKey() and degrade gracefully if undefined; this plan reserves the env-var slot per Key Finding #5
  - Phase 2 doctor — will surface a WARN when ANTHROPIC_API_KEY (or whichever providerId is configured) is unset; runtime.ts is the canonical accessor doctor calls
  - Phase 7 `pensmith config <key>=<value>` — loads via loadRuntimeConfig(scope), mutates, writes via saveRuntimeConfig(scope); this plan ships read+full-replace; Phase 7 will compose them into update semantics if needed
tech-stack:
  added: []
  patterns:
    - "Foundation slice (D-61) + Source-of-truth split — pricing.ts is a standalone deeply-frozen constant table + a pure function (no I/O, no imports); runtime.ts is the config-loader chokepoint (composes W2+W3+W7+W9). The two have different semantic surfaces and live in separate files."
    - "Two-scope path resolution — global at pensmithDataDir()/runtime.json (D-40 platform-local data dir; LOCALAPPDATA / Library / XDG_DATA_HOME — NEVER inside .paper/, OneDrive non-negotiable); paper overlay at <paperRoot>/runtime.json (paper-scope override; allowed inside .paper/ since it's user-owned config, not lock state)."
    - "Auto-merge overlay — scope='auto' reads global then paper-overlay; paper wins on each top-level key; providers map deep-merges by providerId; the merged result is re-validated through RuntimeConfigSchema.parse for defense-in-depth."
    - "ENOENT translation -> defaults() (NOT NotFoundError) — runtime config is OPTIONAL everywhere; first-run pensmith with no runtime.json operates with schema defaults. This differs from state/library/checkpoint where the file is authoritative."
    - "ForwardIncompatError pass-through — runtime.json is AUTHORITATIVE persistence (no D-60 audit-log carve-out); newer-on-disk runtime.json from a future pensmith version, opened by older code, MUST refuse-forward so we don't silently drop fields."
    - "T-01-07 no-leak property — resolved api-key VALUES never reach disk (W7 schema persists env-var NAMES only) AND never reach the session log (every log call payload contains envName / providerId / present:boolean / optional / scope / schemaVersion only). Test 8 in tests/runtime.test.ts is the load-bearing assertion."
    - "Pre-computed `present` boolean — getOpenAlexApiKey computes `const present = !!(resolved && resolved.length > 0)` BEFORE the log call so the resolved string never even reaches the log payload object. This is a defense-in-depth idiom that prevents a future refactor from accidentally landing the resolved value into a log record."
    - "Defense-in-depth schema validation — RuntimeConfigSchema.parse runs on saveRuntimeConfig input, on the merged auto-overlay result, AND on the loader's read path. Three save-side guards + one load-side guard."
    - "Lock + mkdir + atomicWriteFile composition — saveRuntimeConfig parses BEFORE the lock (fail-fast on caller-side garbage), takes withLock, runs `mkdir -p path.dirname(file)` then atomicWriteFile inside the critical section. mkdir-inside-lock is necessary for first-run where pensmithDataDir() doesn't exist yet."
    - "Module-level lazy SessionLogger singleton bound via `.child({ module: 'runtime' })` — initialized at first use so test files mutating env vars BEFORE dynamic-importing runtime.ts observe the redirected paths. Same idiom as W10 (state) / W11 (library) / W12 (checkpoint)."
    - "All 4 public functions emit exactly one D-49 event-kind log record per call (runtime.load / runtime.save / runtime.apiKey / runtime.openalex). NEVER an api-key VALUE in the payload."
    - "Pure pricing module — no imports, no I/O, no async. estimateCost is callable from inside hot loops or budget assertions. Deep-freeze guarantees no caller can mutate the table at runtime (TypeError under strict mode)."
key-files:
  created:
    - bin/lib/pricing.ts
    - bin/lib/runtime.ts
    - tests/pricing.test.ts
    - tests/runtime.test.ts
  modified:
    - eslint.config.js (extended W9/W10 path-chokepoint exemption to also cover tests/runtime.test.ts — same env-override pattern, same scope)
key-decisions:
  - "pricing.ts and runtime.ts are SEPARATE files — pricing.ts is a standalone constant table + pure function (no imports); runtime.ts is the config-loader chokepoint. They have different semantic surfaces and separate test files."
  - "defaults() seeds an anthropic provider entry — W7 RuntimeConfigSchema's `providers` has a `.refine` requiring >=1 provider, so `RuntimeConfigSchema.parse({})` would FAIL (no schema-level default for the providers map). Seeding anthropic with apiKeyEnv='ANTHROPIC_API_KEY' is the production-typical first provider; callers can overwrite by saveRuntimeConfig with their own provider map."
  - "Test fixtures adapted per Plan-vs-Schema reconciliation — W7 ProviderSchema requires `name: z.enum(['anthropic','openai'])` in addition to `apiKeyEnv`. Test fixtures here include the `name` field. Same Plan-vs-Schema reconciliation pattern as 01-12 (refs / Record<string, string>)."
  - "Pre-computed `present` boolean before log call — defense-in-depth against a future refactor accidentally landing the resolved value into a log record. The resolved string never even reaches the payload object."
  - "ENOENT -> defaults() (NOT NotFoundError) — runtime config is OPTIONAL; this is the FIRST W10/W11 sibling that doesn't translate ENOENT to a typed error class. The semantic difference is load-bearing: missing state.json is 'paper not initialized' (error); missing runtime.json is 'use defaults' (not an error)."
  - "MODEL_PRICES deeply frozen via Object.freeze on outer + each inner provider — strict mode (tsconfig 'strict':true) makes mutation attempts throw TypeError. Tests 7 + 8 are the regression gates."
  - "gpt-5 set equal to gpt-4o per RESEARCH §pricing-pending — placeholder so budget assertions don't accidentally rely on a divergent value while the official rate is still unannounced. When OpenAI publishes the rate, bump the entry and reference the vendor page in the commit message."
patterns-established:
  - "Two-scope config-loader chokepoint composition (W2+W3+W7+W9 with paths.pensmithDataDir for the global side) — fourth Wave-10/11 sibling shape; demonstrates the chokepoint pattern with a global+paper overlay rather than a single paperRoot file."
  - "ENOENT-to-defaults translation pattern — for OPTIONAL config files, missing file is not an error; readOne returns null and the caller substitutes schema defaults. Use this idiom for any future config-style file (vs. state-style files where ENOENT -> typed NotFoundError)."
  - "Pre-computed presence boolean — for any function that reads a sensitive value but emits a log record, compute the presence/length boolean BEFORE the log call so the resolved string never reaches the payload object. Future audit reviewers can grep for the value name and confirm it's only in local-variable scope."
  - "MODEL_PRICES + estimateCost = pure functional pricing — separate from runtime.ts so future provider-routing code can import estimateCost without pulling in the W2/W3/W7/W9 chokepoint stack."
requirements-completed: [ARCH-14, TEST-05, TEST-11]
metrics:
  duration: "~30 minutes wall (single-session)"
  completed: 2026-05-08
  tasks: 3
  files_changed: 5 (2 new code + 2 new tests + 1 modified eslint config)
  tests_added: 19
  tests_total_passing: 222
  commits: 3 (plus 1 pending for this SUMMARY)
---

# Phase 1 Plan 13: Runtime Config + Pricing Summary

**ARCH-14 SDK provider chokepoint (runtime config loader) + Key Finding #5 OPENALEX_API_KEY slot reservation + W6 budget.ts pricing-table dependency satisfied. Final Phase 1 plan; Phase 1 execution complete (14/14) and ready for verification.**

## Performance

- **Duration:** ~30 min wall (single-session)
- **Started:** 2026-05-08T (after 01-12-SUMMARY commit `44bec0f`)
- **Completed:** 2026-05-08
- **Tasks:** 3 (pricing.ts, runtime.ts, tests for both)
- **Files modified:** 5 (2 new code + 2 new tests + 1 modified eslint config)

## Accomplishments

- `bin/lib/pricing.ts` shipped with the 4-export public API (MODEL_PRICES, estimateCost, UnknownModelError, type ModelPrice). Pure constant + pure function; no imports, no I/O. Deeply frozen at module load.
- `bin/lib/runtime.ts` shipped with the 5-export public API (loadRuntimeConfig, saveRuntimeConfig, getProviderApiKey, getOpenAlexApiKey, MissingApiKeyError) plus the LoadScope and RuntimeConfig type re-exports. Composes W2 (atomic-write) + W3 (lock) + W7 (loadAndMigrate, RuntimeConfigSchema) + W1 (pensmithDataDir) + W9 (openSessionLog).
- `tests/pricing.test.ts` (9 tests): cost math, deep-freeze, table integrity, error coverage. All passing.
- `tests/runtime.test.ts` (10 tests): defaults, api-key resolution, round-trip, paper overlay, scope-paper-without-paperRoot, AND the load-bearing **T-01-07 no-leak property test**. All passing.
- T-01-07 (api-key VALUE on disk) regression gate established: the no-leak test writes a runtime.json that points at process.env.SECRET_VALUE_DO_NOT_LEAK, then reads the persisted file as a string and asserts the env VALUE is absent and the env NAME is present.
- 222 tests pass on Windows (was 203 before; +19 from this plan).
- Phase 1 execution complete (14/14 plans). All Foundation libs are green and ready for `/gsd-verify-phase 1`.

## Task Commits

Each task was committed atomically on `main`:

1. **Task 1: Implement bin/lib/pricing.ts** — `43a1835` (feat)
2. **Task 2: Implement bin/lib/runtime.ts** — `adfcbc2` (feat)
3. **Task 3: Write tests + eslint exemption** — `b00ed17` (test, includes the eslint.config.js exemption update)

**Plan metadata:** _pending_ (this SUMMARY commit, plus STATE.md / ROADMAP.md / HANDOFF.json reconciliation)

## Files Created / Modified

- `bin/lib/pricing.ts` — new — MODEL_PRICES table + estimateCost (pure module)
- `bin/lib/runtime.ts` — new — runtime config loader + OpenAlex slot (W2+W3+W7+W9 chokepoint composition)
- `tests/pricing.test.ts` — new — 9 tests for table integrity + cost math + error coverage
- `tests/runtime.test.ts` — new — 10 tests including T-01-07 no-leak property
- `eslint.config.js` — modified — W9/W10 path-chokepoint exemption block extended to also cover `tests/runtime.test.ts` (same env-override pattern, same scope)

## Public API final form (bin/lib/runtime.ts)

```typescript
import type { RuntimeConfig } from './schemas/runtime-config.js';

// Re-exported for caller convenience (consistent with state.ts / library.ts /
// checkpoint.ts — domain types live in schemas/, surface modules re-export):
export type { RuntimeConfig };

export type LoadScope = 'global' | 'paper' | 'auto';

export class MissingApiKeyError extends Error {
  code = 'MISSING_API_KEY' as const;
}

export function loadRuntimeConfig(
  opts?: { scope?: LoadScope; paperRoot?: string },
): Promise<RuntimeConfig>;

export function saveRuntimeConfig(
  scope: 'global' | 'paper',
  config: RuntimeConfig,
  opts?: { paperRoot?: string },
): Promise<void>;

export function getProviderApiKey(
  providerId: string,
  opts?: { scope?: LoadScope; paperRoot?: string },
): Promise<string>;

export function getOpenAlexApiKey(
  opts?: { scope?: LoadScope; paperRoot?: string },
): Promise<string | undefined>;
```

## Public API final form (bin/lib/pricing.ts)

```typescript
export interface ModelPrice {
  inputPerMtok: number;
  outputPerMtok: number;
  currency: 'USD';
}

export class UnknownModelError extends Error {
  code = 'UNKNOWN_MODEL' as const;
}

export const MODEL_PRICES: Readonly<Record<string, Readonly<Record<string, ModelPrice>>>>;

export function estimateCost(args: {
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
}): number;
```

## MODEL_PRICES table contents at time of writing

| Provider | Model | $/Mtok in | $/Mtok out | Vendor reference |
| -------- | ----- | --------- | ---------- | ---------------- |
| anthropic | claude-opus-4   | 15.00 | 75.00 | https://www.anthropic.com/pricing |
| anthropic | claude-sonnet-4 |  3.00 | 15.00 | https://www.anthropic.com/pricing |
| anthropic | claude-haiku-4  |  0.80 |  4.00 | https://www.anthropic.com/pricing |
| openai    | gpt-5           |  2.50 | 10.00 | RESEARCH §pricing-pending placeholder (= gpt-4o until OpenAI publishes rate) |
| openai    | gpt-4o          |  2.50 | 10.00 | https://openai.com/api/pricing |
| openai    | gpt-4o-mini     |  0.15 |  0.60 | https://openai.com/api/pricing |

**Currency: USD throughout** (z.literal in ModelPrice; tests assert).

**Update procedure:** bump entry value in bin/lib/pricing.ts + reference the vendor pricing page in the commit message + re-run tests/pricing.test.ts (cost-math assertions are vendor-derived and will fail on rate change).

## OPENALEX_API_KEY slot semantics (Key Finding #5 / D-61)

```typescript
// runtime.json (the persisted shape)
{
  "$schemaVersion": 1,
  "providers": { "anthropic": { "name": "anthropic", "apiKeyEnv": "ANTHROPIC_API_KEY" } },
  "openalexApiKeyEnv":      "OPENALEX_API_KEY",   // configurable env-var name
  "openalexApiKeyOptional": true,                  // default — getOpenAlexApiKey returns undefined when env unset
  "contactEmailEnv":        "PENSMITH_CONTACT_EMAIL"
}
```

Three-state semantics:

| `openalexApiKeyOptional` | env `OPENALEX_API_KEY` | `getOpenAlexApiKey()` returns |
| ------------------------ | ---------------------- | ------------------------------ |
| `true`  (default)        | unset                  | `undefined` (caller degrades gracefully) |
| `true`  (default)        | set                    | the env value (string)         |
| `false` (caller opted)   | unset                  | throws `MissingApiKeyError`    |
| `false` (caller opted)   | set                    | the env value (string)         |

The slot SHIPS NOW even though the OpenAlex client lands in a later phase, so post-Phase-1 callsites have one canonical accessor and don't need a schema migration when wiring real HTTP calls. Tests 1-4 in tests/runtime.test.ts cover all four states above.

## T-01-07 no-leak property statement

**Resolved api-key VALUES never reach disk. Resolved api-key VALUES never reach the session log. Env-var NAMES are persisted on disk and emitted in log records. The resolved string lives only in the local function scope until it's RETURNED to the caller.**

How this is enforced:

- **W7 RuntimeConfigSchema** persists `apiKeyEnv: z.string()` (env-var NAME) — there's no field where a resolved value could be stored. The schema enforces by construction.
- **runtime.ts log calls** carry only `envName / providerId / present:boolean / optional / scope / schemaVersion`. The `present` boolean is **pre-computed BEFORE the log call** — see `getOpenAlexApiKey` which sets `const present = !!(resolved && resolved.length > 0)` before the log emit. The resolved string never even reaches the payload object.
- **Test 8** (`CRITICAL: persisted runtime.json never contains the resolved api-key VALUE`) is the load-bearing regression gate. It writes a runtime.json that points at process.env.SECRET_VALUE_DO_NOT_LEAK (set to a sentinel string), then reads the persisted file as a string and asserts the env VALUE is absent and the env NAME is present.
- **Manual grep verification at commit time** — `node -e "const src=require('fs').readFileSync('bin/lib/runtime.ts','utf8'); const bad=src.match(/log\(\)\.[a-z]+\([^)]*?(value|apiKey:[^E])/); ..."` returns clean (no log call references a resolved value variable in its argument list).

## Chokepoint composition (the actual point of this plan)

This is the **fourth sibling shape** in Wave 10/11. W10 (state) demonstrated read-mutate-write under contention; W11 (library) demonstrated read-check-mutate-write with unbounded entries[]; W12 (checkpoint) demonstrated pure-append with a tolerant read path; W13 (this plan) demonstrates **two-scope read-with-overlay + full-replace write**.

```
                    ┌──────────────────────────────────────────────────────────┐
   loadRuntimeConfig│  scope='auto':                                            │
                    │    global  = readOne(pensmithDataDir()/runtime.json)      │  ← W7 (loadAndMigrate)
                    │              ?? defaults()                                 │
                    │    paper   = readOne(<paperRoot>/runtime.json)            │  ← W7
                    │              ?? null                                       │
                    │    return mergeOverlay(global, paper)                     │  ← W7 schema re-parse
                    │                                                            │
                    │  scope='global': global ?? defaults() (no paper read)     │
                    │  scope='paper':  paper  ?? defaults() (no global read)    │
                    │                                                            │
                    │  log().event({ event:'runtime.load', scope, ... })        │  ← W9
                    └──────────────────────────────────────────────────────────┘

                    ┌──────────────────────────────────────────────────────────┐
   saveRuntimeConfig│  validated = RuntimeConfigSchema.parse(config)           │  ← W7 pre-lock fail-fast
                    │  await withLock(file, async () => {                       │  ← W3
                    │    await fs.promises.mkdir(dirname, {recursive:true})     │  ← node:fs (first-run)
                    │    await atomicWriteFile(file, JSON.stringify(validated)) │  ← W2
                    │  })                                                        │
                    │  log().event({ event:'runtime.save', scope, ... })        │  ← W9
                    └──────────────────────────────────────────────────────────┘

                    ┌──────────────────────────────────────────────────────────┐
   getProviderApiKey│  cfg = await loadRuntimeConfig(opts)                      │
                    │  envName = cfg.providers[providerId]?.apiKeyEnv           │
                    │  value   = process.env[envName]                            │  ← env-var read
                    │  if !value: throw MissingApiKeyError                      │
                    │  log().event({ event:'runtime.apiKey', envName, ... })    │  ← W9 (no value!)
                    │  return value                                              │
                    └──────────────────────────────────────────────────────────┘

                    ┌──────────────────────────────────────────────────────────┐
   getOpenAlexApiKey│  cfg = await loadRuntimeConfig(opts)                      │
                    │  envName  = cfg.openalexApiKeyEnv ?? 'OPENALEX_API_KEY'   │
                    │  optional = cfg.openalexApiKeyOptional ?? true            │
                    │  resolved = process.env[envName]                          │
                    │  present  = !!(resolved && resolved.length > 0)           │  ← pre-compute (no leak!)
                    │  log().event({ event:'runtime.openalex', envName,        │  ← W9
                    │                optional, present })                       │
                    │  if present: return resolved                              │
                    │  if optional: return undefined                            │
                    │  throw MissingApiKeyError                                  │
                    └──────────────────────────────────────────────────────────┘
```

The **critical correctness properties:**

1. **defaults() seeds anthropic** — W7 schema's `.refine` requires >=1 provider; `RuntimeConfigSchema.parse({})` would FAIL. Seeding anthropic is the production-typical first provider.
2. **mergeOverlay is re-parsed** — defense-in-depth: even if both global and paper are individually valid, the merged shape is re-validated. Catches malformed deep-merge results from hand-edited overlays.
3. **Schema parse BEFORE the lock on saveRuntimeConfig** — fail-fast on caller-side garbage without contending the per-file critical section.
4. **mkdir-inside-lock** — first-run pensmith has no pensmithDataDir() yet; mkdir-p inside the lock is necessary so atomicWriteFile doesn't fail with ENOENT on the parent.
5. **Pre-computed `present` boolean** — getOpenAlexApiKey computes presence before the log call so the resolved string never reaches the payload object.

## Tests added (19 total)

### tests/pricing.test.ts (9 tests)

| # | Test | Property |
| - | ---- | -------- |
| 1 | claude-opus-4 1M+1M = $90 | Cost-math correctness for headline rate |
| 2 | claude-sonnet-4 100k+50k = $1.05 | Cost-math correctness with fractional Mtok |
| 3 | gpt-4o-mini 1M+1M = $0.75 | Cost-math correctness for cheap-rate model |
| 4 | UnknownModelError on unknown provider | Error coverage |
| 5 | UnknownModelError on unknown model (known provider) | Error coverage |
| 6 | RangeError on negative input tokens | Fail-fast on caller bug |
| 7 | MODEL_PRICES outer + each inner record frozen | Mutation guard |
| 8 | every entry: rates >= 0 + currency=USD | Table integrity |
| 9 | required Phase-1 entries present | Spec completeness |

### tests/runtime.test.ts (10 tests)

| # | Test | Property |
| - | ---- | -------- |
| 1 | defaults include OpenAlex slot | SC-4 (slot exists even if unused) + W7 schema defaults |
| 2 | getOpenAlexApiKey returns undefined when env unset + optional=true | Key Finding #5 graceful degradation |
| 3 | getOpenAlexApiKey returns env value when set | Key Finding #5 happy path |
| 4 | getOpenAlexApiKey throws when env unset + optional=false | Key Finding #5 hard-required path |
| 5 | getProviderApiKey resolves from process.env via configured slot | ARCH-14 SDK provider chokepoint |
| 6 | getProviderApiKey throws MissingApiKeyError when env unset | Error coverage |
| 7 | saveRuntimeConfig + loadRuntimeConfig round-trips | Schema-validated round-trip |
| 8 | **CRITICAL: persisted runtime.json never contains api-key VALUE** | **T-01-07 load-bearing no-leak property** |
| 9 | paper scope overlays global | Two-scope auto-merge correctness |
| 10 | saveRuntimeConfig scope=paper without paperRoot throws | API guard |

## Schema validation defense-in-depth

| Path | Pre-write parse | Post-load parse |
| ---- | --------------- | --------------- |
| `saveRuntimeConfig` | input → `RuntimeConfigSchema.parse` (THROWS) | n/a |
| `loadRuntimeConfig` | n/a | loader → `RuntimeConfigSchema.parse` per scope |
| `mergeOverlay`      | merged → `RuntimeConfigSchema.parse` (THROWS) | n/a |

Three save-side parse points + one load-side parse point per scope. No malformed runtime config survives a write/read cycle, even if a hand-edited overlay attempts to inject a malformed deep-merge result.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug / Schema reconciliation] `defaults()` seeds an anthropic provider entry rather than calling `RuntimeConfigSchema.parse({})`**

- **Found during:** Task 2 first compile.
- **Issue:** The plan's snippet had `function defaults(): RuntimeConfig { return RuntimeConfigSchema.parse({}); }`. The W7 schema (`bin/lib/schemas/runtime-config.ts` lines 28-35) declares `providers: z.record(z.string(), ProviderSchema).refine((p) => Object.keys(p).length >= 1, 'at least one provider required')`. There's no schema-level default for the providers map AND there's a `.refine` that rejects empty maps. So `RuntimeConfigSchema.parse({})` would fail with `at least one provider required` — the plan's defaults snippet would have crashed at first call.
- **Fix:** Honored the W7 schema. `defaults()` constructs an explicit object with `$schemaVersion: CURRENT_RUNTIME_CONFIG_VERSION` AND `providers: { anthropic: { name: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY' } }`, then calls `RuntimeConfigSchema.parse(...)` on the explicit object so the schema's `.default()` calls fill openalexApiKeyEnv / openalexApiKeyOptional / contactEmailEnv. Anthropic is the production-typical first provider; callers can overwrite with their own provider map via saveRuntimeConfig.
- **Files modified:** `bin/lib/runtime.ts` (defaults() body).
- **Schema NOT modified:** `bin/lib/schemas/runtime-config.ts` is W7 chokepoint and was not touched.
- **Verification:** Test 1 (`loadRuntimeConfig with no file returns schema defaults including OpenAlex slot`) confirms the seed: `Object.keys(cfg.providers).length >= 1` AND `cfg.openalexApiKeyEnv === 'OPENALEX_API_KEY'` AND `cfg.openalexApiKeyOptional === true` AND `cfg.contactEmailEnv === 'PENSMITH_CONTACT_EMAIL'`.
- **Committed in:** `adfcbc2` (Task 2).

**2. [Rule 1 - Bug / Schema reconciliation] Test fixtures include `name` field on provider entries**

- **Found during:** Task 3 first test run (would have rejected on RuntimeConfigSchema.parse).
- **Issue:** The plan's test fixtures used `{ apiKeyEnv: 'MY_ANTHROPIC' }` and `{ apiKeyEnv: 'MY_PROVIDER_X' }` for provider entries. The W7 ProviderSchema (`bin/lib/schemas/runtime-config.ts` lines 22-26) requires `name: z.enum(['anthropic', 'openai'])` AND `apiKeyEnv: z.string().min(1)`. Tests 5 and 6 (and 8, the no-leak test) all save runtime configs with provider entries — the saveRuntimeConfig schema parse would have rejected the plan's `{ apiKeyEnv: ... }` shape with a missing-`name` validation error.
- **Fix:** Honored the W7 schema. All test fixtures include the `name` field. Test 6 uses `name: 'openai'` for `providerX` since the enum is restricted to `'anthropic' | 'openai'`; this is a test-fixture-only concern (the test asserts the env-var resolution path, not the name). Test 8 (no-leak) similarly uses `name: 'openai'` for the `leaktest` entry. Test 5 uses `name: 'anthropic'` for the anthropic entry (the natural pairing).
- **Files modified:** `tests/runtime.test.ts` (all provider fixture objects).
- **Schema NOT modified:** `bin/lib/schemas/runtime-config.ts` is W7 chokepoint and was not touched.
- **Forward-compat note:** Phase 5+ may want to broaden the `name` enum to include 'bedrock' or other providers. Path: add to the enum, register a v1→v2 migration if any field shape changes. Today's anthropic|openai constraint is the foundation slice.
- **Verification:** All 10 runtime tests pass.
- **Committed in:** `b00ed17` (Task 3).

**3. [Rule 3 - Blocking] Added `tests/runtime.test.ts` to the W9/W10 path-chokepoint ESLint exemption**

- **Found during:** Task 3 lint check (would have failed on lines 47-49 of tests/runtime.test.ts where the test overrides LOCALAPPDATA / XDG_DATA_HOME / HOME).
- **Issue:** D-41 chokepoint forbids `process.env.LOCALAPPDATA` / `XDG_DATA_HOME` outside `bin/lib/paths.ts`. Every runtime test uses `mkPaperRoot()` to override these env vars (matching the W9/W10/W11/W12 precedent) so:
  1. The session-log singleton inside runtime.ts (lazy-init at first .event() call) resolves into the per-test tmpdir.
  2. pensmithDataDir() — used by globalConfigPath() inside runtime.ts — resolves into the per-test tmpdir, so tests don't clobber the user's real `~/Library/Application Support/pensmith/runtime.json` (or worse, fail with EACCES on a sealed sysdir).
- **Fix:** Extended the existing `tests/session-log.test.ts` / `tests/state.test.ts` / `tests/library.test.ts` / `tests/checkpoint.test.ts` exemption block in `eslint.config.js` to include `tests/runtime.test.ts`. No new exemption block — just expanded the file list; same `no-restricted-syntax: 'off'` rule, same justification. Header comment updated to reflect the runtime.ts-specific reason (clobber prevention).
- **Files modified:** `eslint.config.js`.
- **Committed in:** `b00ed17` (folded into the test commit since the exemption is part of the same Task 3 deliverable, matching the W10/W11/W12 precedent).

### Auth gates

None. The plan's getProviderApiKey / getOpenAlexApiKey contracts deliberately raise typed errors when env vars are missing — those are *application* errors, not auth gates that require human intervention during execution. Tests cover both branches.

---

**Total deviations:** 3 auto-fixed (2 Rule 1 schema reconciliations + 1 Rule 3 lint exemption). All three preserve the plan's correctness invariants. Deviation 1 prevents a runtime contract crash (Plan vs Schema). Deviation 2 prevents test-fixture rejection at runtime (Plan vs Schema). Deviation 3 is the same pattern that lands every Wave-10/11 plan in this phase. No scope creep.

## Issues Encountered

- The `defaults()` snippet in the plan would have crashed at first call due to the W7 `.refine` on providers. Caught at compile time, fixed via Deviation 1.
- The plan's test fixtures would have rejected at saveRuntimeConfig due to ProviderSchema's `name` field. Caught at first test run, fixed via Deviation 2.
- The pre-execution `no-leak grep` regex flagged a false positive on `present: !!(value && value.length > 0)` because the regex matched the bare `value` identifier. Refactored to `const present = !!(resolved && resolved.length > 0)` + `log({...present})` — the resolved string is now in a separate local before the log call, which both clears the false-positive grep AND strengthens the no-leak invariant (the resolved value never even reaches the log payload object). This is a strictly stronger property than the plan asked for.

## Carry-forward note for downstream phases

**OpenAlex client wiring (post-Phase-1):**

```typescript
// Phase 3+ research wave — every OpenAlex callsite MUST go through this:
import { getOpenAlexApiKey } from '../bin/lib/runtime.js';

async function fetchOpenAlex(query: string, paperRoot?: string) {
  const apiKey = await getOpenAlexApiKey({ scope: 'auto', paperRoot });
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;  // polite-pool with key
  }
  // ... call OpenAlex; if apiKey is undefined, fall back to email-only
  // (polite pool works without a key per Key Finding #5)
}
```

The `apiKey` MAY be undefined — callers MUST handle that branch and degrade gracefully (e.g. fall back to PENSMITH_CONTACT_EMAIL polite-pool authentication). The runtime contract requires no `PENSMITH_OPENALEX_REQUIRED` env override at this phase; callers that need a hard-required key flip the runtime config's `openalexApiKeyOptional: false` and pensmith will then throw on the first getOpenAlexApiKey call.

**budget.ts pricing-table integration (likely Phase 5+):**

```typescript
// Phase 5+ verifier wave or Phase 3+ research wave:
import { estimateCost } from './pricing.js';

const estUsd = estimateCost({
  providerId: 'anthropic',
  modelId: 'claude-opus-4',
  inputTokens: estInputTokens,
  outputTokens: estOutputTokens,
});
await assertBudget({ scope: 'section', scopeId, cap }, estUsd);
const result = await llm.call(...);
await appendCost({ ...result.usage, scope, scopeId, costUsd: estUsd });
```

The W6 budget.ts plan-time signature (`estimateCost({providerId, modelId, inputTokens, outputTokens})`) matches the W11 pricing.ts shipped surface exactly — no W6 changes are required.

**MODEL_PRICES update procedure:**

When a vendor changes pricing:

1. Update the entry value in `bin/lib/pricing.ts`.
2. Reference the vendor pricing page in the commit message (so `git blame` is auditable for cost-correctness reviews).
3. Re-run `node --test tests/pricing.test.ts` — the cost-math assertions for $90 / $1.05 / $0.75 are vendor-derived and will fail on rate change. Update the assertion constants to match.
4. If the vendor introduces a new model, ALSO add an entry; the "table contains required Phase-1 entries" test will catch missing core entries.

**Schema migration carry-forward:**

Adding ANY new field to RuntimeConfig MUST come with a migration in `bin/lib/migrations/runtime-config/`. The current schema is at version 1 with `{$schemaVersion, providers, openalexApiKeyEnv, openalexApiKeyOptional, contactEmailEnv}`. Possible Phase 2+ additions:

1. **Bedrock provider** — broaden `ProviderSchema.name` enum to include `'bedrock'`. Migration: identity for v1 entries (no shape change at the value level, just an enum extension). Bump CURRENT_RUNTIME_CONFIG_VERSION to 2.
2. **Per-section budget caps** — new top-level field. Migration: identity for v1 (new field is optional or defaulted).
3. **PENSMITH_OPENALEX_REQUIRED env override** — new top-level field. Migration: identity for v1 (defaulted to undefined / "use openalexApiKeyOptional from config").

**API stability:** All 4 public functions plus the MissingApiKeyError class are stable across schema versions — only the underlying `RuntimeConfig` type changes. Downstream callers (Phase 2 doctor, Phase 3+ research wave, Phase 7 config CLI) won't need to touch their imports.

**T-01-07 no-leak property MUST be preserved across migrations.** Future schema changes that add provider-related fields MUST keep the "env-var NAMES on disk only, VALUES strictly in process.env" property. If a future field would store a resolved value (e.g. an OAuth refresh token), the schema MUST gate it behind a separate keystore mechanism (e.g. OS keychain integration in a later phase) — never persist secrets in runtime.json.

## Pattern handed to future config-loader plans

W13 (this plan) is the **fourth Wave-10/11 sibling shape** — two-scope read-with-overlay + full-replace write. Combined with W10 (state — read-mutate-write, single scope), W11 (library — read-check-mutate-write, single scope, unbounded entries[]), and W12 (checkpoint — pure-append, tolerant reader), the chokepoint composition idiom is now demonstrated under FOUR semantic shapes:

| Sibling | Schema shape | Scope | Read-path semantic | Write-path semantic |
| ------- | ------------ | ----- | ------------------ | ------------------- |
| W10 state | 3-fixed-fields | single (paper) | refuse-forward; ENOENT -> NotFoundError | load-INSIDE-lock -> mutate -> atomicWrite |
| W11 library | unbounded entries[] | single (paper) | refuse-forward; ENOENT -> NotFoundError | load-INSIDE-lock -> dup-check -> atomicWrite |
| W12 checkpoint | append-only JSONL | single (paper) | tolerant-skip (D-60 carve-out from D-39) | atomicAppendFile inside lock |
| **W13 runtime** | **single-record + providers map** | **two-scope (global + paper overlay)** | **refuse-forward; ENOENT -> defaults()** | **schema-parse pre-lock; full-replace atomicWrite** |

The four-line composition idiom from W10 still generalizes:

```typescript
// 1. Module-level lazy logger child (so tests can override env before first use)
let _log: SessionLogger | null = null;
function log(): SessionLogger {
  if (!_log) _log = openSessionLog({ scope: 'auto' }).child({ module: 'XXX' });
  return _log;
}

// 2A. read-mutate-write (state) / read-check-mutate-write (library) — refuse-forward, ENOENT -> NotFoundError
// 2B. append-only audit log (checkpoint) — tolerant-skip
// 2C. config loader (runtime) — refuse-forward, ENOENT -> defaults() (NOT NotFoundError)
//     Use ENOENT -> defaults() ONLY when the file is genuinely OPTIONAL.
//     Use ENOENT -> NotFoundError when the file is REQUIRED for the operation.
```

The key invariant downstream plans should preserve:

- **OPTIONAL config files use ENOENT -> defaults().** Authoritative state files use ENOENT -> NotFoundError. The semantic difference is load-bearing — "missing runtime.json" is a valid first-run state; "missing STATE.json" is "paper not initialized" which IS an error.
- **Pre-compute presence booleans before log calls** when the function reads sensitive values. Future audit reviewers can grep for the value identifier and confirm it's only in local-variable scope.
- **Schema-parse on auto-merge results.** When merging multiple sources of config, re-parse the merged result for defense-in-depth. Catches malformed deep-merge results from hand-edited overlays.
- **mkdir-inside-lock for first-run-tolerant writes.** When the parent directory might not exist yet (e.g. first-run pensmithDataDir()), `fs.promises.mkdir(dirname, {recursive:true})` inside the withLock callback is necessary so atomicWriteFile doesn't fail with ENOENT on the parent.

## Threat Flags

None. All security-relevant surfaces (T-01-07 / T-01-COMPAT-01 / T-01-OPENALEX-01 / T-01-08) were in the plan's `<threat_model>` and are mitigated by the implementation. No new boundaries introduced.

## Self-Check: PASSED

Verified before final SUMMARY commit:

- `bin/lib/pricing.ts` exists and exports the 3 expected names + 1 type (MODEL_PRICES, estimateCost, UnknownModelError, type ModelPrice) — confirmed by reading the file (134 lines).
- `bin/lib/runtime.ts` exists and exports the 4 expected functions + MissingApiKeyError + LoadScope + RuntimeConfig (re-export) — confirmed by reading the file (434 lines).
- runtime.ts imports limited to node:fs / node:path + ./atomic-write.js / ./lock.js / ./migrations/loader.js / ./schemas/runtime-config.js / ./paths.js / ./session-log.js — confirmed by inspecting the import block (lines 70-79).
- pricing.ts has zero imports (pure module) — confirmed by inspecting the file (no `import` line outside the type/class/const declarations).
- saveRuntimeConfig parses BEFORE the lock; mkdir-p inside the lock; atomicWriteFile inside the lock — confirmed by reading the function body (runtime.ts ~lines 285-300).
- All log calls in runtime.ts emit only safe payload fields — confirmed by manual grep:
  - `runtime.load`: `{event, scope, schemaVersion}` ✓
  - `runtime.save`: `{event, scope, schemaVersion}` ✓
  - `runtime.apiKey`: `{event, providerId, envName}` ✓ (no value)
  - `runtime.openalex`: `{event, envName, optional, present}` ✓ (no resolved string)
- Pre-computed `present` boolean before log call in getOpenAlexApiKey — confirmed (runtime.ts ~lines 415-425). The resolved string is in `const resolved` and never reaches the log payload object.
- 9 tests in tests/pricing.test.ts — confirmed.
- 10 tests in tests/runtime.test.ts — confirmed.
- Test 8 (T-01-07 no-leak) reads runtime.json from disk as a string and asserts the env VALUE 'sk-very-secret-1234567890' is absent + the env NAME 'SECRET_VALUE_DO_NOT_LEAK' is present — confirmed by reading the test body.
- Commits exist on main:
  - `43a1835` feat(01-13): add bin/lib/pricing.ts
  - `adfcbc2` feat(01-13): add bin/lib/runtime.ts
  - `b00ed17` test(01-13): add tests/pricing.test.ts + tests/runtime.test.ts (+ eslint exemption)
- `npx tsc --noEmit` exit 0; `npx eslint .` exit 0; `node scripts/run-tests.mjs` reports tests=222 pass=222 fail=0.
- bin/lib/schemas/runtime-config.ts NOT modified (W7 chokepoint stays locked).
- No new package.json deps.
- No --no-verify on any commit.

## Next Phase Readiness

- **Phase 1 execution complete (14/14 plans).** All Foundation libs (paths, atomic-write, lock, doi, http, budget, migrations, pii, session-log, state, library, checkpoint, runtime) are green and unit-tested on linux-x64 / macos-arm64 / windows-x64 (CI matrix).
- **Run `/gsd-verify-phase 1` next.** This is the gate to Phase 2 (tier shells + doctor + tier-contract gate). The verifier will check Phase 1 SC-1 through SC-5 against the 14 SUMMARY files and the 222-test suite.
- **No carry-forward blockers. No deferred items.**

---

*Phase: 01-foundation-nfrs*
*Completed: 2026-05-08*
