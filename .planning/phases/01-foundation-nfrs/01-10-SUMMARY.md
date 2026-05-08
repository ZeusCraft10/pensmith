---
phase: 01-foundation-nfrs
plan: 10
subsystem: state
wave: 10
tags: [state, persistence, locking, atomic-write, schema-migration, foundation-slice]
requires:
  - bin/lib/atomic-write.ts (W2 — atomicWriteFile)
  - bin/lib/lock.ts (W3 — withLock)
  - bin/lib/migrations/loader.ts (W7 — loadAndMigrate, ForwardIncompatError)
  - bin/lib/schemas/state.ts (W7 — Schema, CURRENT_STATE_VERSION, type State)
  - bin/lib/session-log.ts (W9 — openSessionLog)
provides:
  - bin/lib/state.ts (loadState, saveState, updateState, initState, StateNotFoundError, StateAlreadyExistsError)
affects:
  - W11 library.ts — uses the same chokepoint composition pattern (atomicWriteFile + withLock + loadAndMigrate + openSessionLog.child)
  - W12 checkpoint.ts — uses the same composition pattern
  - W13 runtime.ts — uses the same composition pattern
  - Phase 2 section state-machine — extends State schema via v1→v2 forward migration; readers/writers continue to call this same API
tech-stack:
  added: []
  patterns:
    - "Foundation slice (D-58) — schema is intentionally locked to {$schemaVersion, paperId, createdAt} for Phase 1; no business state machine yet. Adding ANY field MUST come with a migration in bin/lib/migrations/state/."
    - "Lock-key = absolute file path; W3 withLock applies its default sha256-truncated keying internally so OneDrive paths with `:` and `\\\\` are safe (D-40)."
    - "load-INSIDE-the-lock for updateState — read happens inside the same withLock critical section as the mutation and write, so two concurrent updateState calls cannot read the same pre-write value and clobber each other (T-01-01 mitigation)."
    - "ForwardIncompatError pass-through — older pensmith readers refuse to load a STATE.json with $schemaVersion > codeVersion (T-01-COMPAT-01 mitigation; W7 throws, W10 propagates unchanged)."
    - "Defense-in-depth schema validation — StateSchema.parse runs on initState seed, on saveState input, AND on updateState mutator output, PLUS the loader validates on every read. Three save-side guards + one load-side guard."
    - "ENOENT-only translation — only ENOENT (or `cause.code === 'ENOENT'`) becomes StateNotFoundError. JSON parse errors, schema validation errors, permission errors, and ForwardIncompatError all bubble up unchanged so callers can distinguish 'not initialized' from 'corrupt' from 'too new'."
    - "writeBack:true on loadState (so future v1→v2 reads persist the upgrade) but writeBack:false on the inner load inside updateState (because the outer atomicWriteFile is about to write a fresh copy moments later — no point persisting twice in one critical section)."
    - "Module-level lazy SessionLogger singleton bound via `.child({ module: 'state' })` — initialized at first use so test files mutating env vars BEFORE dynamic-importing state.ts observe the redirected paths."
    - "All four public functions emit exactly one D-49 event-kind log record per call (state.init, state.load, state.save, state.update) with payload {event, paperId, schemaVersion}."
key-files:
  created:
    - bin/lib/state.ts
    - tests/state.test.ts
  modified:
    - eslint.config.js (extended W9 path-chokepoint exemption to also cover tests/state.test.ts — same env-override pattern, same scope)
decisions:
  - "Lock-key = the absolute file path itself. W3's withLock(file, fn) applies its default sha256-truncated keying internally per stubFor() in lock.ts (the resource is hashed before becoming a lock-stub filename). State.ts therefore does NOT compute a sha256 of its own — passing the file path directly is the canonical W3 idiom and matches what W11/W12/W13 will do."
  - "load INSIDE the lock for updateState — the PLAN's <action> snippet placed the loadAndMigrate call inside the withLock callback, and the implementation honors that. Two concurrent updateState calls thus serialize at the proper-lockfile boundary (not just the file-write boundary), so neither can read a stale pre-write value. Test 5 (concurrent updateState) is the regression gate. The weaker assertion 'final stamp is one of the two' was used per the PLAN's discussion at line 290 — D-58 schema has only 3 fields so we cannot assert 'both mutations visible'; the lock-correctness invariant we CAN assert is 'no torn write + final value matches one writer's input'."
  - "writeBack:true on loadState, writeBack:false on the inner load in updateState. Rationale: a top-level loadState that triggers a v1→v2 migration SHOULD persist the upgrade so the next reader has zero-cost loading; an inner load inside updateState is going to be overwritten by the outer atomicWriteFile moments later, so an additional write would be redundant disk I/O inside the same lock window."
  - "ENOENT translation handles both shapes. Node's fs.readFile throws an Error with `code: 'ENOENT'` directly; some wrappers (and Node future versions) use the `cause` chain. We check `e?.code === 'ENOENT' || e?.cause?.code === 'ENOENT'` for forward compatibility. Anything else (EACCES, EPERM, JSON parse errors, SchemaValidationError, ForwardIncompatError) bubbles up unchanged."
  - "initState seed is StateSchema.parse'd before write. Catches caller errors like seed.paperId='' early, BEFORE we touch the disk or acquire the lock. Permission/access errors during the existence check (anything other than ENOENT) are NOT translated — bubble up so the caller sees the real failure."
  - "Module-level logger singleton via openSessionLog({scope:'auto'}).child({module:'state'}) — lazy-init so the W9 logger picks up env-var overrides applied between module load and first call. tests/state.test.ts relies on this: each test mkdtempSyncs a new tmpdir and overrides LOCALAPPDATA/XDG_DATA_HOME/HOME BEFORE the dynamic `await import('../bin/lib/state.js')`. Dynamic import is the test pattern; production callers do a normal top-level static import."
  - "eslint.config.js: extended the existing tests/session-log.test.ts D-41 exemption to also cover tests/state.test.ts. Same justification (env-var override is the only way to redirect pensmithDataDir() into a per-test tmpdir for isolation), same scope (one `no-restricted-syntax: 'off'` per file). Documented as a Rule 3 deviation in this SUMMARY."
metrics:
  duration: "~25 minutes wall (single-session)"
  completed: 2026-05-08
  tasks: 2
  files_changed: 3 (1 new code + 1 new test + 1 modified eslint config)
  tests_added: 7
  tests_total_passing: 186
  commits: 2 (plus 1 pending for this SUMMARY)
---

# Phase 1 Plan 10: Paper State Glue Summary

D-58 foundation slice for paper-state load/save/update — single one-import API that composes W2 (atomicWriteFile) + W3 (withLock) + W7 (loadAndMigrate / StateSchema) + W9 (openSessionLog) so Phase 2's section state machine and beyond do not have to re-wire the chokepoint stack. Schema is intentionally minimal (3 fields); the value of this plan is proving the chokepoint composition correct under contention before downstream phases pile state-machine semantics on top.

## What was built

**bin/lib/state.ts (~225 lines, 264 incl. doc comment)** — six exports.

| Export | Purpose |
| ------ | ------- |
| `loadState(paperRoot)` | Reads STATE.json via `loadAndMigrate(writeBack:true)`. Translates ENOENT → StateNotFoundError. Forward-incompat propagates unchanged. |
| `saveState(paperRoot, state)` | StateSchema.parse → withLock → atomicWriteFile. Refuses to write malformed input. |
| `updateState(paperRoot, mutator)` | withLock → loadAndMigrate(writeBack:false) → mutator → StateSchema.parse → atomicWriteFile, all in ONE critical section. |
| `initState(paperRoot, seed?)` | fs.access guard → StateAlreadyExistsError if file exists; else StateSchema.parse seed → withLock → atomicWriteFile. |
| `StateNotFoundError` | `code: 'STATE_NOT_FOUND'` — only thrown when STATE.json is absent. |
| `StateAlreadyExistsError` | `code: 'STATE_ALREADY_EXISTS'` — only thrown by initState when STATE.json already exists. |

**tests/state.test.ts (~140 lines)** — 7 tests, all passing.

**eslint.config.js (~6 line edit)** — extended W9's per-file path-chokepoint exemption from `['tests/session-log.test.ts']` to `['tests/session-log.test.ts', 'tests/state.test.ts']` (same `no-restricted-syntax: 'off'` rule, same justification).

## Public API final form

```typescript
import type { State } from './schemas/state.js';

export class StateNotFoundError extends Error { code = 'STATE_NOT_FOUND' as const; }
export class StateAlreadyExistsError extends Error { code = 'STATE_ALREADY_EXISTS' as const; }

export function initState(paperRoot: string, seed?: { paperId?: string }): Promise<State>;
export function loadState(paperRoot: string): Promise<State>;
export function saveState(paperRoot: string, state: State): Promise<void>;
export function updateState(
  paperRoot: string,
  mutator: (s: State) => State | Promise<State>,
): Promise<State>;
```

## Chokepoint composition (the actual point of this plan)

```
                    ┌────────────────────────────────────────────┐
   updateState()    │  await withLock(STATE.json, async () => {  │
                    │    const cur = await loadAndMigrate({...}) │  ← W7
                    │    const next = StateSchema.parse(         │  ← W7
                    │      await mutator(cur)                    │
                    │    )                                       │
                    │    await atomicWriteFile(STATE.json, ...)  │  ← W2
                    │  })                                        │  ← W3 wraps the whole thing
                    └────────────────────────────────────────────┘
                    log().event({                                   ← W9
                      event: 'state.update',
                      paperId, schemaVersion
                    })
```

The critical correctness property: the load AND the write share ONE lock acquisition. If the load were outside the lock, two concurrent updateState calls would each see the same pre-write value and the second writer would silently clobber the first.

## Concurrency test outcome (Test 5)

- Two simultaneous `updateState(root, s => ({...s, createdAt: stampN}))` calls fired without intermediate awaits.
- Both promises resolved cleanly (no deadlock).
- `loadState` after the race showed `createdAt` exactly equal to one of the two stamps (no torn / mixed write).
- Test wall time on Windows: **~132 ms** (lock acquisition + atomicWriteFile twice, serialized).

The weaker assertion (`createdAt ∈ {stamp1, stamp2}` rather than "both stamps visible") is forced by the D-58 schema lock to 3 fields — there's no second mutable field to write to. The lock-correctness invariant we DO capture: serialization, no torn write, no schema validation failure during the race. Phase 2 plans that extend the State schema can upgrade this test to assert "mutation A's field plus mutation B's field BOTH visible".

## Forward-incompat regression gate (Test 6)

Manually `fs.writeFileSync` a STATE.json with `$schemaVersion: 999`, then `loadState`. Asserts the rejection is `instanceof ForwardIncompatError` (the W7 loader's exact error class, imported via `await import('../bin/lib/migrations/loader.js')` to verify identity, not just name). T-01-COMPAT-01 is now end-to-end validated.

## Schema validation defense-in-depth (Tests 4 & 7)

| Path | Pre-write parse | Post-load parse |
| ---- | --------------- | --------------- |
| `initState`  | seed → StateSchema.parse | n/a |
| `saveState`  | input → StateSchema.parse | n/a |
| `updateState`| mutator output → StateSchema.parse | loadAndMigrate validates current |
| `loadState`  | n/a | loadAndMigrate validates |

Test 7 verifies `updateState(root, () => ({}))` rejects with a zod-issue mentioning at least one of `paperId` / `createdAt` / `schemaVersion`.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Added `tests/state.test.ts` to the W9 path-chokepoint ESLint exemption.**
- **Found during:** Task 2 (first lint after writing the test file).
- **Issue:** D-41 chokepoint forbids `process.env.LOCALAPPDATA` / `XDG_DATA_HOME` / `HOME` outside `bin/lib/paths.ts`. Test 5+ all needed the env-override pattern (mkdtempSync + override + dynamic-import) so the W9 logger singleton inside `bin/lib/state.ts` resolves into a per-test tmpdir. Without the exemption, lint failed with 2 errors at lines 35-36 of `tests/state.test.ts`.
- **Fix:** Extended the existing W9 exemption block in `eslint.config.js` from `['tests/session-log.test.ts']` to `['tests/session-log.test.ts', 'tests/state.test.ts']`. No new exemption block — just expanded the file list.
- **Files modified:** `eslint.config.js`.
- **Commit:** `e475b0b` (folded into the test commit since both files are part of the same Task 2 deliverable).

### Auth gates

None.

## Carry-forward note for downstream phases

**Adding ANY new field to State schema MUST come with a migration.** The current schema is `{$schemaVersion, paperId, createdAt}` at version 1. Phase 2's section state machine will introduce sections, scheduler bookkeeping, and per-section status fields. The path is:

1. Bump `CURRENT_STATE_VERSION` to 2 in `bin/lib/schemas/state.ts`.
2. Update `Schema` to the new shape.
3. Register a v1→v2 migration in `bin/lib/migrations/state/v1-to-v2.ts` (per `bin/lib/migrations/loader.ts` idiom) and pass it via `loadState`'s `migrations:` option (which currently is omitted; the contract is "migrations:{} == no migrations needed for current version, throws if disk is older").

Existing test 6 (forward-incompat) will then need its hardcoded `999` to remain larger than the new `CURRENT_STATE_VERSION` (still safe at `999`).

**API stability:** All four public functions (`loadState`, `saveState`, `updateState`, `initState`) plus both error classes are stable across schema versions — only the underlying `State` type changes. Downstream callers won't need to touch their imports.

## Pattern handed to W11 / W12 / W13

The four-line composition idiom that worked here will be copy-pasted (with adapted imports) into Wave 11 (library), Wave 12 (checkpoint), and Wave 13 (runtime config):

```typescript
// 1. Module-level lazy logger child (so tests can override env before first use)
let _log: SessionLogger | null = null;
function log(): SessionLogger {
  if (!_log) _log = openSessionLog({ scope: 'auto' }).child({ module: 'XXX' });
  return _log;
}

// 2. updateXxx: read+mutate+write inside ONE withLock critical section
export async function updateXxx(root: string, mutator: ...): Promise<XxxState> {
  const file = path.join(path.resolve(root), 'XXX.json');
  let next!: XxxState;
  await withLock(file, async () => {
    const cur = await loadAndMigrate({ file, schema: XxxSchema, ... , writeBack: false });
    next = XxxSchema.parse(await mutator(cur));
    await atomicWriteFile(file, JSON.stringify(next, null, 2) + '\n');
  });
  log().event({ event: 'xxx.update', ... });
  return next;
}
```

The key invariants W11/W12/W13 should preserve verbatim:
- `loadAndMigrate({ ..., writeBack: false })` inside updateXxx
- `loadAndMigrate({ ..., writeBack: true })` inside loadXxx
- ENOENT (and `cause.code === 'ENOENT'`) translated to `XxxNotFoundError`; everything else bubbles up
- `XxxSchema.parse` runs on init seed, save input, AND mutator output (defense-in-depth, 3x)
- One `.event(...)` per public function call; payload includes `{ event, ...identifying fields, schemaVersion }`
- Lock key = the absolute file path itself; do NOT compute a sha256 — W3 does it internally

## Self-Check: PASSED

Verified before final SUMMARY commit:
- `bin/lib/state.ts` exists and exports the 6 expected names (loadState, saveState, updateState, initState, StateNotFoundError, StateAlreadyExistsError) — confirmed by Grep on the file.
- Imports limited to node:fs / node:path / node:crypto + ./atomic-write.js / ./lock.js / ./migrations/loader.js / ./schemas/state.js / ./session-log.js — confirmed by inspecting the import block (lines 41-48 of state.ts).
- updateState's loadAndMigrate AND atomicWriteFile both inside `withLock(file, async () => { ... })` — confirmed by reading the function body (state.ts lines 196-216).
- 4 distinct event names in 4 public functions — confirmed: state.init / state.load / state.save / state.update.
- ENOENT translation includes the `cause.code === 'ENOENT'` branch — confirmed (state.ts line 159).
- initState fs.access guard + StateAlreadyExistsError — confirmed (state.ts lines 90-104).
- 7 tests in tests/state.test.ts — confirmed.
- Commits exist on main:
  - `8617c63` feat(01-10): add bin/lib/state.ts
  - `e475b0b` test(01-10): add tests/state.test.ts
- `npx tsc --noEmit` exit 0; `npm run lint` exit 0; `node scripts/run-tests.mjs` reports tests=186 pass=186 fail=0.
- STATE.md and ROADMAP.md untouched.
