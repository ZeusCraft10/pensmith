---
phase: 01-foundation-nfrs
plan: 07
subsystem: persistence
tags: [zod, schema, migration, loader, ARCH-07, D-37, D-38, D-39, D-49, D-58, D-59, D-60, D-61]
requires:
  - 01-00 (zod ^3.23 dep, bin/lib/schemas/ + bin/lib/migrations/ scaffolds)
  - 01-02 (atomic-write.ts → atomicWriteFile)
provides:
  - "bin/lib/migrations/loader.ts: loadAndMigrate({file, schema, schemaName, currentVersion, migrations?, writeBack?}) + ForwardIncompatError + SchemaValidationError + Migration + LoadOptions"
  - "bin/lib/schemas/state.ts: State + Schema + CURRENT_STATE_VERSION (foundation slice — paperId+createdAt envelope)"
  - "bin/lib/schemas/library.ts: Library + LibraryEntry + Schema + LibraryEntrySchema + CURRENT_LIBRARY_VERSION (LIB-01 empty entries skeleton)"
  - "bin/lib/schemas/checkpoint.ts: Checkpoint + Schema + CURRENT_CHECKPOINT_VERSION (envelope-only — label+tookAt+refs)"
  - "bin/lib/schemas/session-log.ts: SessionLogEntry + Schema + CURRENT_SESSION_LOG_VERSION (per-line JSONL: at+kind+run_id+passthrough; 8-value kind enum per D-49)"
  - "bin/lib/schemas/runtime-config.ts: RuntimeConfig + Provider + Schema + ProviderSchema + CURRENT_RUNTIME_CONFIG_VERSION (providers as z.record + OPENALEX_API_KEY/contactEmailEnv defaults per Key Finding #5)"
  - "bin/lib/migrations/state/v1_to_v2.ts: sample no-op forward migration proving the registry mechanism"
affects:
  - "W9 (session-log persistence) — read-side replay tools (Phase 7) wire loadAndMigrate({schemaName:'session-log',...}) per record"
  - "W10 (state.ts, library.ts, checkpoint.ts) — load helpers wrap loadAndMigrate({schemaName:'state'|'library'|'checkpoint',...,writeBack:true})"
  - "W11 (runtime.ts) — runtime-config load wraps loadAndMigrate({schemaName:'runtime-config',...,writeBack:true}); merge pattern uses { ...base.providers, ...overlay.providers }"
  - "W13 (sdk-provider) — looks up providers via cfg.providers?.[providerId] (object key, not array index)"
tech-stack:
  added: []  # zod ^3.23 already shipped in 01-00; nothing new this wave
  patterns:
    - "single-options-object loader API (D-37 divergence): loadAndMigrate({file, schema, schemaName, currentVersion, migrations?, writeBack?}) — loader OWNS the read so call sites in W10/W11 stay one-liners"
    - "schema-specific version constants (CURRENT_STATE_VERSION, CURRENT_LIBRARY_VERSION, ...) — avoids name collisions when consumers import constants from multiple schema modules"
    - "$schemaVersion peek with v1 default (D-37 day-one tolerance) — missing/non-int $schemaVersion is treated as v1, not as corruption"
    - "refuse-forward-incompat (D-39) — disk-version > code-version throws ForwardIncompatError; protects against running older pensmith over newer state files"
    - "writeBack:false default — read path is read-only by default; consumers opt in to disk update via writeBack:true"
    - "atomic-write through W2 chokepoint — write-back routes through atomicWriteFile (D-04) so the chokepoint stays sole writer; tests seed via the same chokepoint, no eslint per-file exemption needed"
    - "providers as z.record(z.string(), ProviderSchema) — enables overlay merge { ...base.providers, ...overlay.providers } and object lookup cfg.providers?.[id] in W11/W13"
key-files:
  created:
    - bin/lib/migrations/loader.ts
    - bin/lib/migrations/state/v1_to_v2.ts
    - bin/lib/schemas/state.ts
    - bin/lib/schemas/library.ts
    - bin/lib/schemas/checkpoint.ts
    - bin/lib/schemas/session-log.ts
    - bin/lib/schemas/runtime-config.ts
    - tests/migrations.test.ts
    - tests/schemas.test.ts
  modified: []
  deleted:
    - bin/lib/schemas/.gitkeep  # superseded by 5 real schema modules
decisions:
  - "loadAndMigrate diverges from D-37's draft `(raw: unknown, ...)` signature — adopts a single-options-object {file, schema, schemaName, currentVersion, migrations?, writeBack?} so consumer plans 10–13 wire one-liners and the file→version→migrate→validate→writeBack cycle is encapsulated in one function. Trade-off: loader hardcodes utf8+JSON.parse (no streaming JSON, no alternate parser) — fine for v0.1 because every persisted file is small."
  - "Each schema exports SCHEMA-SPECIFIC `CURRENT_<NAME>_VERSION` (not bare `CURRENT_VERSION`) so a consumer file can `import { CURRENT_STATE_VERSION } from '../schemas/state.js'; import { CURRENT_LIBRARY_VERSION } from '../schemas/library.js';` without re-aliasing every import."
  - "session-log.ts validates per-line wire shape WITHOUT $schemaVersion — log records are append-only JSONL written by W9's atomicAppendFile path; the loader is NOT involved on the read path. CURRENT_SESSION_LOG_VERSION exists for symmetry with the other 4 schemas (replay tools key on it for forward-incompat protection)."
  - "writeBack default is false — consumers must opt in to disk updates. W10/W11 plans pass writeBack:true on load; the session-log replay path (Phase 7) will pass writeBack:false. Default-false makes dry-run validators safe by construction."
  - "runtime-config.providers is z.record(z.string(), ProviderSchema) (object), NOT z.array. .refine guard requires ≥1 key. The overlay-merge test (`{ ...base.providers, ...overlay.providers }`) is the regression gate that proves the record-not-array contract."
  - "Test seeding routes through atomicWriteFile rather than fs.writeFile — keeps the D-07 atomic-write chokepoint's surface area tight (no per-file eslint exemption needed for tests/migrations.test.ts). The chokepoint exists for a reason; tests should exercise it, not bypass it."
metrics:
  duration: ~30min
  completed: 2026-05-08
  tests_added: 18      # 8 migrations + 10 schemas
  tests_total: 160     # 142 baseline + 18 new
  files_created: 9     # 7 source + 2 test
  files_modified: 0
  files_deleted: 1     # bin/lib/schemas/.gitkeep (replaced by real modules)
  loc_added: ~131 (loader.ts) + ~25 (v1_to_v2.ts) + ~22 + ~31 + ~21 + ~46 + ~33 (5 schemas) + ~250 (2 test files) ≈ 560
  commits: 4           # feat (schemas) + feat (loader) + test + chore (grep-friendliness)
---

# Phase 1 Plan 07: Versioned Schema Loader + 5 Schemas Summary

Implemented the versioned-JSON load+migrate chokepoint (ARCH-07 / D-37 / D-38 / D-39): a single `loadAndMigrate({file, schema, schemaName, currentVersion, migrations?, writeBack?})` entry point that reads from disk, migrates forward through a registered chain, validates with zod, and (optionally) writes back through W2's atomic-write chokepoint. Plus 5 zod schemas covering every persisted file in v0.1 — state, library, checkpoint, session-log, runtime-config — each exporting its own `CURRENT_<NAME>_VERSION` constant so multi-schema consumers don't trip on import-name collisions. Plus a sample state v1→v2 no-op migration that proves the registry mechanism without committing to a Phase 2 schema change yet.

## Public API

### `bin/lib/migrations/loader.ts`

```ts
export type Migration = (input: unknown) => unknown;

export interface LoadOptions<TSchema extends z.ZodTypeAny> {
  file: string;
  schema: TSchema;
  schemaName: 'state' | 'library' | 'checkpoint' | 'session-log' | 'runtime-config';
  currentVersion: number;
  migrations?: Record<number, Migration>;
  writeBack?: boolean;          // default false
}

export class ForwardIncompatError extends Error {
  diskVersion: number;
  codeVersion: number;
}

export class SchemaValidationError extends Error {
  zodIssue: z.ZodIssue[];
}

export async function loadAndMigrate<TSchema extends z.ZodTypeAny>(
  opts: LoadOptions<TSchema>,
): Promise<z.infer<TSchema>>;
```

`loadAndMigrate.length === 1` — single-options-object signature. Smoke-tested.

### Schemas

Each schema module follows the same shape:

```ts
export const CURRENT_<NAME>_VERSION = 1;
export const Schema = z.object({ $schemaVersion: z.literal(1), ... });
export type <Name> = z.infer<typeof Schema>;
```

| Module                  | Foundation slice                                          | Notable fields                                         |
| ----------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| `state.ts`              | PROJECT.md scope marker only                              | `paperId`, `createdAt`                                 |
| `library.ts`            | LIB-01 empty entries skeleton                             | `entries: LibraryEntry[]` (default `[]`)               |
| `checkpoint.ts`         | envelope only                                             | `label`, `tookAt`, `refs: Record<string,string>`       |
| `session-log.ts`        | per-line JSONL wire shape (no `$schemaVersion`)           | `at`, `kind` (8-enum per D-49), `run_id`, passthrough  |
| `runtime-config.ts`     | providers + OPENALEX env slot (Key Finding #5)            | `providers: z.record(...)`, `openalexApiKeyEnv`, etc.  |

### Sample migration

```ts
// bin/lib/migrations/state/v1_to_v2.ts
export default function v1_to_v2(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) {
    throw new Error('v1_to_v2: input is not an object');
  }
  return { ...input, $schemaVersion: 2 };
}
```

Pure pass-through that bumps the version field. Proves the migration registry mechanism without committing to a real Phase 2 schema change.

## Why the API diverges from D-37's draft

D-37's example signature took `(raw: unknown, ...)` — caller reads from disk, loader migrates a value in-memory. **We changed it** to a single options object `{file, schema, schemaName, currentVersion, migrations?, writeBack?}` because:

1. Consumer plans W10/W11/W12/W13 will wire one-liners against this exact contract. A plain `(raw, ...)` signature forces every consumer to repeat the `fs.readFile + JSON.parse` boilerplate, and to remember to write back through `atomicWriteFile` after a migration. The single-options-object form encapsulates the whole `read → peek-version → migrate → validate → write-back` cycle.
2. The loader is the natural owner of the disk read: it knows whether a write-back is needed (only after a migration runs), and it owns the W2 chokepoint route. Pushing that responsibility to consumers risks `fs.writeFile` calls outside the chokepoint.
3. The trade-off is that the loader hardcodes UTF-8 + `JSON.parse` (no streaming, no alternate parser). This is acceptable for v0.1 — every persisted file in pensmith is small (state ~1KB, library entries ~2KB each, checkpoint envelope ~500B, runtime-config ~1KB). Streaming JSON is a Phase 5+ concern if/when it surfaces.

`loadAndMigrate.length === 1` is asserted by the loader smoke check and by every consumer test that uses it.

## Why schema-specific version constants

A consumer file like W11's `runtime.ts` will need to call:

```ts
const cfg     = await loadAndMigrate({ file: cfgPath,    schema: RuntimeConfigSchema, schemaName: 'runtime-config', currentVersion: CURRENT_RUNTIME_CONFIG_VERSION });
const state   = await loadAndMigrate({ file: statePath,  schema: StateSchema,         schemaName: 'state',          currentVersion: CURRENT_STATE_VERSION });
```

If both modules exported a bare `CURRENT_VERSION`, the second `import` would shadow the first — leading to subtle bugs where the wrong constant flows into the wrong loader call. The schema-specific names (`CURRENT_STATE_VERSION`, `CURRENT_RUNTIME_CONFIG_VERSION`, etc.) make the intent self-documenting at the call site and let consumers freely import constants from multiple schemas without re-aliasing every time.

## Refuse-forward-incompat (D-39)

If the file on disk reports a `$schemaVersion` greater than the build's `currentVersion`, the loader throws `ForwardIncompatError` carrying both `diskVersion` and `codeVersion`. The error message is human-readable:

```
pensmith: refusing to load state v5 (this build supports v1).
Upgrade pensmith, or restore from a v1-or-older snapshot.
```

This protects against the "older pensmith silently downgrades a newer state file and loses fields" failure mode. It is the single most important integrity guarantee in this wave — without it, a user who runs an older pensmith over a newer state file would lose data in a way that no checksum or test could recover from.

The `forward-incompat throws` test seeds a v5 file and asserts both `diskVersion === 5` and `codeVersion === 1` on the thrown error.

## Why providers is z.record (not z.array)

Consumer plans W11/W13 access providers two ways:

1. **Object lookup:** `cfg.providers?.[providerId]` — given a provider id like `'anthropic'`, fetch the config without iteration.
2. **Overlay merge:** `{ ...base.providers, ...overlay.providers }` — per-paper overlays merge by key.

Both patterns require `providers` to be an object (record), not an array. The `runtime-config: providers overlay-merges by key` test is the regression gate that proves the contract. The `.refine((p) => Object.keys(p).length >= 1)` guard rejects an empty `{}` because a runtime config with zero providers is non-functional.

## Default writeBack:false

Consumers must opt in to disk updates by passing `writeBack: true`. Two reasons:

1. **Replay safety.** Phase 7 replay tools should be able to load a session log file without rewriting it. A surprising `writeBack:true` default would be a foot-gun.
2. **Dry-run validators.** Future `pensmith doctor`-style tools want to validate every persisted file without modifying any of them.

The `writeBack omitted (default false) leaves disk untouched after migration` and `writeBack:false leaves disk untouched after migration` tests are both regression gates for this contract.

## Test seeding through atomicWriteFile

The atomic-write chokepoint (D-07) bans direct `fs.writeFile` everywhere outside `bin/lib/atomic-write.ts`. The natural test pattern — `await fsp.writeFile(file, JSON.stringify({...}))` — would be flagged by `no-restricted-syntax`.

Two options were available:

1. Add `tests/migrations.test.ts` to the eslint per-file exemption list (alongside `http.test.ts`, `http-cache.test.ts`, `retry.test.ts`).
2. Route test seeding through `atomicWriteFile` from W2.

**Chose option 2.** The chokepoint exists to keep the surface area tight; growing the exemption list every time a new test needs to write a file would erode that guarantee. The tests have a one-line `seed()` helper that wraps `atomicWriteFile`. Side benefit: tests now exercise the same code path that production uses, so any regression in `atomicWriteFile` would surface here too.

## Test coverage matrix

### `tests/migrations.test.ts` (8 tests)

| Test | Asserts |
|------|---------|
| `forward-incompat: throws when diskVersion > currentVersion` | ForwardIncompatError + diskVersion + codeVersion + human-readable message |
| `missing $schemaVersion is treated as v1` | readVersion default-to-1 branch with permissive schema |
| `v1 -> v2 migration runs and writes back when writeBack:true` | migration runs + on-disk file is v2 after the call |
| `writeBack omitted (default false) leaves disk untouched after migration` | default-writeBack branch |
| `writeBack:false leaves disk untouched after migration` | explicit-false branch |
| `missing migration in chain throws` | descriptive error mentioning v1 -> v2 |
| `invalid JSON throws (caller-handled SyntaxError)` | JSON.parse error surfaces |
| `schema validation failure throws SchemaValidationError with rich issues` | error class + zodIssue array populated |

### `tests/schemas.test.ts` (10 tests)

| Test | Asserts |
|------|---------|
| `CURRENT_*_VERSION constants are all 1` | all 5 constants |
| `state: valid example parses` | happy path |
| `state: rejects empty paperId / wrong $schemaVersion / bad createdAt` | 3 sad paths |
| `library: valid empty + valid with entry` | 2 happy paths (default+populated) |
| `library: rejects entry with empty id` | sad path on nested entry |
| `checkpoint: valid + rejects empty label` | happy + sad |
| `session-log: valid kind=event/tool_call + rejects bad kind + rejects missing run_id` | 4 cases (D-49) |
| `runtime-config: valid record form + defaults` | happy + OPENALEX/contactEmail defaults + record lookup |
| `runtime-config: rejects empty providers record (.refine min-1 guard)` | sad path on empty `{}` |
| `runtime-config: providers overlay-merges by key (record form, not array)` | record-not-array regression gate |

## Deviations from Plan

### Auto-fixed issues (Rule 3 — blocking deviation)

**1. [Rule 3 — Build] Test seeding required atomic-write routing**
- **Found during:** Task 3 (initial lint pass after writing tests/migrations.test.ts).
- **Issue:** Test seeded fixtures via `await fsp.writeFile(file, JSON.stringify(...))`. The D-07 atomic-write chokepoint flagged 7 violations across the file.
- **Fix:** Added a one-line `async function seed(file, content)` helper that delegates to `atomicWriteFile` from W2, then replaced all 7 seed call sites with `seed(file, ...)`. No eslint per-file exemption needed.
- **Files modified:** `tests/migrations.test.ts` (one helper added + 7 callsites swapped).
- **Commit:** included in `ed35099 test(01-07): add loader + schema validation suites`.
- **Why this is the correct fix (not an exemption):** the chokepoint exists to keep the surface tight; growing the exemption list every time a new test wants to write a file erodes that. Tests SHOULD exercise the same write path as production code.

**2. [Rule 3 — Verification] z.record() multi-line wrap defeated grep**
- **Found during:** Pre-SUMMARY success-criteria check.
- **Issue:** The plan's success criterion required the literal substring `z.record(z.string(), ProviderSchema)` to be greppable in `bin/lib/schemas/runtime-config.ts`. Initial formatting (Prettier-style chained-method wrap with leading dot) split it across two lines: `z\n    .record(z.string(), ProviderSchema)\n    .refine(...)`. The literal substring grep returned 0 matches.
- **Fix:** Collapsed `z\n  .record(z.string(), ProviderSchema)` to a single line `z.record(z.string(), ProviderSchema)\n  .refine(...)`. Semantics unchanged; all 160 tests still pass.
- **Files modified:** `bin/lib/schemas/runtime-config.ts` (one line collapsed).
- **Commit:** `d0d955b chore(01-07): single-line z.record() in runtime-config for grep-friendliness`.

### Auth gates

None — this wave is pure-stdlib + zod; no network, no auth.

## Carry-forward to W9 / W10 / W11 / W12 / W13

Every persisted-JSON consumer in foundation should now wrap a one-liner:

```ts
// W10 state.ts (example)
import { atomicWriteFile } from '../atomic-write.js';
import { loadAndMigrate } from '../migrations/loader.js';
import { Schema as StateSchema, CURRENT_STATE_VERSION, type State } from '../schemas/state.js';

export async function loadState(file: string): Promise<State> {
  return loadAndMigrate({
    file,
    schema:         StateSchema,
    schemaName:     'state',
    currentVersion: CURRENT_STATE_VERSION,
    writeBack:      true,
  });
}

export async function saveState(file: string, value: State): Promise<void> {
  // Validate before write — production-grade defense.
  const parsed = StateSchema.parse(value);
  await atomicWriteFile(file, JSON.stringify(parsed, null, 2));
}
```

Same pattern applies to library.ts, checkpoint.ts, runtime.ts (with `RuntimeConfigSchema` + `CURRENT_RUNTIME_CONFIG_VERSION`).

W11 runtime overlay merge:

```ts
const base    = await loadAndMigrate({ file: defaultsPath, schema: RuntimeConfigSchema, schemaName: 'runtime-config', currentVersion: CURRENT_RUNTIME_CONFIG_VERSION });
const overlay = await loadAndMigrate({ file: paperPath,    schema: RuntimeConfigSchema, schemaName: 'runtime-config', currentVersion: CURRENT_RUNTIME_CONFIG_VERSION, writeBack: true });
const merged  = { ...overlay, providers: { ...base.providers, ...overlay.providers } };
```

W13 sdk-provider lookup: `cfg.providers?.[providerId]`.

W9 session-log replay (Phase 7+) parses JSONL records and validates each line against `SessionLogSchema` directly (loader is NOT involved on session-log read because there is no `$schemaVersion` per record; the schema-version check is at file-level for the other 4 schemas only).

## Self-Check: PASSED

Verified after the SUMMARY commit prep:

- `bin/lib/migrations/loader.ts` exists and exports `loadAndMigrate`, `ForwardIncompatError`, `SchemaValidationError`, `Migration`, `LoadOptions`. `loadAndMigrate.length === 1`.
- All 5 schema modules exist with the documented `Schema` + `CURRENT_<NAME>_VERSION` + `type` exports.
- `bin/lib/migrations/state/v1_to_v2.ts` exists, default export bumps `$schemaVersion: 2`.
- `tests/migrations.test.ts` has 8 tests; `tests/schemas.test.ts` has 10 tests.
- `npx tsc --noEmit` exits 0.
- `npm run lint` exits 0 (7 → 0 violations after the seed-helper fix).
- `node scripts/run-tests.mjs` exits 0 with **160/160 pass** (was 142 baseline; +18 new).
- `bin/lib/migrations/loader.ts` contains zero direct `fs.writeFile` references; uses `atomicWriteFile` from W2.
- `bin/lib/schemas/runtime-config.ts` contains the literal greppable substring `z.record(z.string(), ProviderSchema)` on a single line.
- All 4 commits land on `main` with `feat(01-07)` / `test(01-07)` / `chore(01-07)` prefixes.
- STATE.md and ROADMAP.md UNTOUCHED.

## Threat Flags

None. The threat model entries from the plan (T-01-08 prototype pollution, T-01-COMPAT-01 forward-incompat, T-01-INTEGRITY-02 partial-write) are all mitigated as designed:

- Prototype pollution: `JSON.parse` does not polyfill `__proto__` on modern Node; the v1_to_v2 migration uses `{ ...input, ... }` spread (own-property iteration) rather than mutation; zod `safeParse` iterates own properties only.
- Forward-incompat: `ForwardIncompatError` is the gate, exercised by the `forward-incompat throws` test.
- Partial-write: write-back routes through `atomicWriteFile` (W2's `tmp + rename` chokepoint); a crashed write leaves the old file intact.
