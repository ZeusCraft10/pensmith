---
phase: 01-foundation-nfrs
plan: 11
subsystem: library
wave: 10
tags: [library, persistence, locking, atomic-write, schema-migration, foundation-slice, concurrency]
requires:
  - bin/lib/atomic-write.ts (W2 — atomicWriteFile)
  - bin/lib/lock.ts (W3 — withLock)
  - bin/lib/migrations/loader.ts (W7 — loadAndMigrate, ForwardIncompatError)
  - bin/lib/schemas/library.ts (W7 — Schema, LibraryEntrySchema, CURRENT_LIBRARY_VERSION, type Library, type LibraryEntry)
  - bin/lib/session-log.ts (W9 — openSessionLog)
provides:
  - bin/lib/library.ts (loadLibrary, saveLibrary, addEntry, findEntry, initLibrary, LibraryNotFoundError, LibraryAlreadyExistsError, DuplicateLibraryEntryError)
affects:
  - W12 checkpoint.ts — uses the same composition pattern (next sibling in Wave 10)
  - W13 runtime.ts — uses the same composition pattern
  - Phase 3 research wave — extends LibraryEntry schema via v1→v2 forward migration; existing public API unchanged
tech-stack:
  added: []
  patterns:
    - "Foundation slice (D-59) — schema is intentionally minimal: {$schemaVersion, entries: LibraryEntry[]} with LibraryEntry={id, addedAt, optional:doi/arxiv/pmid/pmcid/title}. Citation metadata, sources[], cite-keys, fingerprints land in Phase 3 via forward migration."
    - "Lock-key = absolute file path; W3 withLock applies its sha256-truncated keying internally so OneDrive paths with `:` and `\\\\` are safe (D-40). Identical idiom to W10 state.ts."
    - "load-INSIDE-the-lock for addEntry — read AND duplicate-check AND write share ONE withLock acquisition. Two concurrent addEntry calls cannot both observe the same pre-write entries[]; the second writer cannot silently clobber the first (T-01-01 mitigation). Test 6 (10 concurrent disjoint ids) is the regression gate."
    - "Duplicate-id refusal — DuplicateLibraryEntryError thrown when entry.id already in library; check runs INSIDE the lock; library state untouched on rejection (no atomicWriteFile call). Test 5 is the regression gate."
    - "ForwardIncompatError pass-through — older pensmith readers refuse to load LIBRARY.json with $schemaVersion > codeVersion (T-01-COMPAT-01 mitigation; W7 throws, W11 propagates unchanged). Test 8 verifies."
    - "Defense-in-depth schema validation — LibrarySchema.parse runs on initLibrary seed, on saveLibrary input, on addEntry mutator output. LibraryEntrySchema.parse runs on addEntry's argument BEFORE the lock is taken (fail-fast on caller-side garbage). Plus the loader validates on every read. Three save-side guards + one load-side guard."
    - "ENOENT-only translation — only ENOENT (or `cause.code === 'ENOENT'`) becomes LibraryNotFoundError. JSON parse errors, schema validation errors, permission errors, and ForwardIncompatError all bubble up unchanged so callers can distinguish 'not initialized' from 'corrupt' from 'too new'."
    - "writeBack:true on loadLibrary (so future v1→v2 reads persist the upgrade) but writeBack:false on the inner load inside addEntry (because the outer atomicWriteFile is about to write a fresh copy moments later — no point persisting twice in one critical section)."
    - "Module-level lazy SessionLogger singleton bound via `.child({ module: 'library' })` — initialized at first use so test files mutating env vars BEFORE dynamic-importing library.ts observe the redirected paths."
    - "findEntry intentionally lock-free — pure read against the loaded snapshot; predicate runs in-memory and cannot tear under concurrent writers. Callers needing add-then-find atomicity should use addEntry's return value directly."
    - "All five public functions emit exactly one D-49 event-kind log record per call (library.init, library.load, library.save, library.addEntry, library.load via findEntry) with payload {event, schemaVersion, ...identifying fields}."
key-files:
  created:
    - bin/lib/library.ts
    - tests/library.test.ts
  modified:
    - eslint.config.js (extended W9 path-chokepoint exemption to also cover tests/library.test.ts — same env-override pattern, same scope)
decisions:
  - "Lock-key = the absolute file path itself. W3's withLock(file, fn) applies its default sha256-truncated keying internally per stubFor() in lock.ts. Library.ts therefore does NOT compute a sha256 of its own — passing the file path directly is the canonical W3 idiom and matches W10 state.ts exactly."
  - "load INSIDE the lock for addEntry — the PLAN's <action> snippet placed the loadAndMigrate call inside the withLock callback, and the implementation honors that. The duplicate-id check runs after the load, before the write, all in ONE critical section. Two concurrent addEntry calls thus serialize at the proper-lockfile boundary (not just the file-write boundary). Test 6 (10 concurrent addEntry) is the regression gate; it would fail with a final entries[].length < 10 if the load were outside the lock."
  - "Duplicate-id check uses Array.prototype.some(e => e.id === ...) on the loaded snapshot. O(n) per add, but the foundation slice has no real corpus yet and Phase 3 has freedom to upgrade to a Set-keyed lookup if the n grows. Premature optimization avoided per the user's repo-wide preference (CLAUDE.md: 'three similar lines is better than a premature abstraction')."
  - "Single-entry validation via LibraryEntrySchema.parse(entry) BEFORE acquiring the lock. The W7 schema exports LibraryEntrySchema directly so we don't need the PLAN's fallback (LibrarySchema.parse({entries:[entry]}).entries[0]). Cleaner, faster, fail-fast for caller-side garbage."
  - "writeBack:true on loadLibrary, writeBack:false on the inner load in addEntry. Same rationale as state.ts: top-level loadLibrary triggering a v1→v2 migration SHOULD persist the upgrade so the next reader has zero-cost loading; an inner load inside addEntry is going to be overwritten by the outer atomicWriteFile moments later, so an additional write would be redundant disk I/O inside the same lock window."
  - "ENOENT translation handles both shapes (`e?.code === 'ENOENT' || e?.cause?.code === 'ENOENT'`) — Node's fs.readFile throws an Error with `code: 'ENOENT'` directly; some wrappers (and Node future versions) use the `cause` chain. Forward-compatible."
  - "findEntry intentionally lock-free (PLAN <behavior>: 'pure read; no lock needed'). Predicate runs against an already-loaded snapshot in memory, so concurrent writers cannot tear it. Callers that need add-then-find atomicity must use addEntry's return value (which IS computed inside the lock)."
  - "Module-level logger singleton via openSessionLog({scope:'auto'}).child({module:'library'}) — lazy-init so tests/library.test.ts can override LOCALAPPDATA/XDG_DATA_HOME/HOME BEFORE the dynamic await import('../bin/lib/library.js'). Identical pattern to bin/lib/state.ts."
  - "eslint.config.js: extended the W9 D-41 exemption block from ['tests/session-log.test.ts', 'tests/state.test.ts'] to also include 'tests/library.test.ts'. Same 'no-restricted-syntax: off' rule, same justification (env-override is the only way to redirect pensmithDataDir() into a per-test tmpdir). Documented as a Rule 3 deviation."
metrics:
  duration: "~20 minutes wall (single-session reconciliation pass)"
  completed: 2026-05-08
  tasks: 2
  files_changed: 3 (1 new code + 1 new test + 1 modified eslint config)
  tests_added: 8
  tests_total_passing: 194
  commits: 2 (plus 1 pending for this SUMMARY)
---

# Phase 1 Plan 11: Paper Library Glue Summary

D-59 foundation slice for paper-library load/save/add/find — single one-import API that composes W2 (atomicWriteFile) + W3 (withLock) + W7 (loadAndMigrate / LibrarySchema) + W9 (openSessionLog) so Phase 3's research-wave fanout can append citations atomically without re-implementing lock/atomic/migration plumbing. Schema is intentionally minimal (id + addedAt + optional doi/arxiv/pmid/pmcid/title); the value of this plan is proving the chokepoint composition correct under contention before downstream phases pile citation-metadata semantics on top.

## What was built

**bin/lib/library.ts (~328 lines incl. doc comments)** — eight exports.

| Export | Purpose |
| ------ | ------- |
| `loadLibrary(paperRoot)` | Reads LIBRARY.json via `loadAndMigrate(writeBack:true)`. Translates ENOENT → LibraryNotFoundError. Forward-incompat propagates unchanged. |
| `saveLibrary(paperRoot, library)` | LibrarySchema.parse → withLock → atomicWriteFile. Refuses to write malformed input. |
| `addEntry(paperRoot, entry)` | LibraryEntrySchema.parse(entry) → withLock → loadAndMigrate(writeBack:false) → duplicate-check → LibrarySchema.parse → atomicWriteFile, all in ONE critical section. |
| `findEntry(paperRoot, predicate)` | Lock-free: loadLibrary then `.find(predicate)` on the snapshot. |
| `initLibrary(paperRoot)` | fs.access guard → LibraryAlreadyExistsError if file exists; else LibrarySchema.parse seed → withLock → atomicWriteFile. |
| `LibraryNotFoundError` | `code: 'LIBRARY_NOT_FOUND'` — only thrown when LIBRARY.json is absent. |
| `LibraryAlreadyExistsError` | `code: 'LIBRARY_ALREADY_EXISTS'` — only thrown by initLibrary when file already exists. |
| `DuplicateLibraryEntryError` | `code: 'LIBRARY_DUP_ID'` — thrown by addEntry when entry.id already present. |

**tests/library.test.ts (~175 lines)** — 8 tests, all passing.

**eslint.config.js (~6 line edit)** — extended W9's per-file path-chokepoint exemption from `['tests/session-log.test.ts', 'tests/state.test.ts']` to `['tests/session-log.test.ts', 'tests/state.test.ts', 'tests/library.test.ts']` (same `no-restricted-syntax: 'off'` rule, same justification).

## Public API final form

```typescript
import type { Library, LibraryEntry } from './schemas/library.js';

export class LibraryNotFoundError extends Error { code = 'LIBRARY_NOT_FOUND' as const; }
export class LibraryAlreadyExistsError extends Error { code = 'LIBRARY_ALREADY_EXISTS' as const; }
export class DuplicateLibraryEntryError extends Error { code = 'LIBRARY_DUP_ID' as const; }

export function initLibrary(paperRoot: string): Promise<Library>;
export function loadLibrary(paperRoot: string): Promise<Library>;
export function saveLibrary(paperRoot: string, library: Library): Promise<void>;
export function addEntry(paperRoot: string, entry: LibraryEntry): Promise<Library>;
export function findEntry(
  paperRoot: string,
  predicate: (e: LibraryEntry) => boolean,
): Promise<LibraryEntry | undefined>;
```

## Chokepoint composition (the actual point of this plan)

```
                 ┌─────────────────────────────────────────────────┐
   addEntry()    │  LibraryEntrySchema.parse(entry)                │  ← W7 (single-entry, fail-fast)
                 │  await withLock(LIBRARY.json, async () => {     │
                 │    const cur = await loadAndMigrate({...,       │  ← W7
                 │      writeBack:false })                         │
                 │    if (cur.entries.some(e => e.id===entry.id))  │
                 │      throw DuplicateLibraryEntryError           │  ← T-01-DUP-01
                 │    next = LibrarySchema.parse({                 │  ← W7
                 │      ...cur, entries: [...cur.entries, entry]   │
                 │    })                                           │
                 │    await atomicWriteFile(LIBRARY.json, next)    │  ← W2
                 │  })                                             │  ← W3 wraps load+check+write
                 │  log().event({ event: 'library.addEntry', id }) │  ← W9
                 └─────────────────────────────────────────────────┘
```

The critical correctness property: load AND duplicate-check AND write share ONE lock acquisition. If the load were outside the lock, two concurrent addEntry callers could each see the same pre-write entries[] and the second writer would silently clobber the first — Test 6 (10 disjoint ids) would yield fewer than 10 entries.

## Concurrency test outcome (Test 6)

- 10 simultaneous `addEntry(root, { id: 'eN', addedAt })` calls fired without intermediate awaits.
- All 10 promises resolved cleanly (no deadlock, no rejection).
- `loadLibrary` after the race showed entries[] of length exactly 10 with ids `['e0', 'e1', ..., 'e9']` (sorted) — proving every writer's mutation survived.
- Test wall time on Windows: well under the suite's 8.4s total (Test 6 is one row of the 194-test run; per-test stamps in `node scripts/run-tests.mjs` show it lands in the low-hundred ms range like the W10 concurrent test).
- No p-retry retries observed (proper-lockfile's polled re-acquisition is deterministic and the race resolved within the default retry budget).

This is a strictly stronger assertion than the W10 state.ts concurrency test, which had to weaken to "final value is one of the two stamps" because the D-58 schema only has 3 fields. D-59 has an unbounded entries[] — every concurrent writer's mutation can and must survive. **Phase 1's concurrency contract is now end-to-end demonstrated** at the highest fidelity the foundation slices allow.

## Forward-incompat regression gate (Test 8)

Manually `fs.writeFileSync` a LIBRARY.json with `$schemaVersion: 999`, then `loadLibrary`. Asserts the rejection is `instanceof ForwardIncompatError` (the W7 loader's exact error class, imported via `await import('../bin/lib/migrations/loader.js')` to verify identity, not just name). T-01-COMPAT-01 is now end-to-end validated for the library code path.

## Schema validation defense-in-depth (Tests 4, 5, 7)

| Path | Pre-write parse | Post-load parse |
| ---- | --------------- | --------------- |
| `initLibrary` | seed → LibrarySchema.parse | n/a |
| `saveLibrary` | input → LibrarySchema.parse | n/a |
| `addEntry`    | argument → LibraryEntrySchema.parse (pre-lock); next → LibrarySchema.parse (in-lock) | loadAndMigrate validates current |
| `loadLibrary` | n/a | loadAndMigrate validates |
| `findEntry`   | n/a | loadAndMigrate validates (via loadLibrary) |

Test 5 verifies `addEntry` with a duplicate id rejects via `DuplicateLibraryEntryError` AND leaves library state unchanged (the rejected entry's `addedAt` does NOT bleed into the loaded result — proves no atomicWriteFile call was made on rejection).

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Added `tests/library.test.ts` to the W9 path-chokepoint ESLint exemption.**
- **Found during:** Task 2 (first lint after writing the test file).
- **Issue:** D-41 chokepoint forbids `process.env.LOCALAPPDATA` / `XDG_DATA_HOME` / `HOME` outside `bin/lib/paths.ts`. Tests 4-8 all needed the env-override pattern (mkdtempSync + override + dynamic-import) so the W9 logger singleton inside `bin/lib/library.ts` resolves into a per-test tmpdir.
- **Fix:** Extended the existing W9 exemption block in `eslint.config.js` from `['tests/session-log.test.ts', 'tests/state.test.ts']` to include `'tests/library.test.ts'`. No new exemption block — just expanded the file list.
- **Files modified:** `eslint.config.js`.
- **Commit:** folded into the test commit (`fe430e3`) since both files are part of the same Task 2 deliverable, matching the W10 precedent.

**2. [Plan deviation - Acceptable] Used `LibraryEntrySchema.parse` directly instead of the PLAN's `LibrarySchema.shape.entries.element` accessor.**
- **Found during:** Task 1 implementation.
- **Issue:** The PLAN's <action> snippet showed `LibrarySchema.shape.entries.element.parse(entry)` for single-entry validation, with a fallback note for if W7 didn't expose it conveniently.
- **Fix:** W7's `bin/lib/schemas/library.ts` exports `LibraryEntrySchema` directly. Cleaner, faster, no introspection of zod's internal shape. Matches the W10 idiom of importing the schema you need.
- **Equivalence:** `LibraryEntrySchema.parse(e)` is the exact validator for `LibrarySchema.shape.entries.element` — the schema author exported it specifically so consumers don't have to introspect.

**3. [Test typing - Acceptable] Used optional-chained access `lib.entries[0]?.id` to satisfy `noUncheckedIndexedAccess`.**
- **Found during:** Task 2 typecheck (`npx tsc --noEmit`).
- **Issue:** TS2532 — `Object is possibly 'undefined'` when reading `lib.entries[0].id` because `noUncheckedIndexedAccess` adds `| undefined` to all index reads.
- **Fix:** Optional chaining (`?.`). Tests still meaningful — `assert.equal(undefined, 'cite-1')` would fail if entries[0] were missing. Same effective coverage; correct typing.

### Auth gates

None.

## Carry-forward note for downstream phases

**Adding ANY new field to LibraryEntry MUST come with a migration in `bin/lib/migrations/library/`.** The current entry schema is `{id, addedAt, optional:doi/arxiv/pmid/pmcid/title}` at version 1. Phase 3's research wave will extend it with authors, year, abstract, sources[], cite-key, fingerprint, etc. The path is:

1. Bump `CURRENT_LIBRARY_VERSION` to 2 in `bin/lib/schemas/library.ts`.
2. Update `LibraryEntrySchema` and `Schema` to the new shape.
3. Register a v1→v2 migration in `bin/lib/migrations/library/v1-to-v2.ts` (per the W7 loader idiom) and pass it via `loadLibrary`'s `migrations:` option (currently omitted; the contract is "migrations:{} == no migrations needed for current version, throws if disk is older").
4. Existing test 8 (forward-incompat) will then need its hardcoded `999` to remain larger than the new `CURRENT_LIBRARY_VERSION` (still safe at `999`).

**API stability:** All five public functions (`loadLibrary`, `saveLibrary`, `addEntry`, `findEntry`, `initLibrary`) plus all three error classes are stable across schema versions — only the underlying `Library` and `LibraryEntry` types change. Downstream callers (Phase 3 research-fetch, Phase 4 outline citations, Phase 5+ section-time citation lookups) won't need to touch their imports.

**Duplicate-id contract is a hard semantics guarantee, not a soft one.** Phase 3 callers MUST handle `DuplicateLibraryEntryError` explicitly (probably by catching, logging, and treating as a no-op since the entry is already present). Don't silently swallow it without checking the error code, and don't retry in a loop — concurrent addEntry calls are already serialized by withLock, so a duplicate-id error means a real semantic conflict, not a contention retry.

**Lock-free findEntry callers needing transactional semantics MUST use addEntry's return value.** Don't pattern-match `await addEntry(...); await findEntry(...)` — that's two lock acquisitions and a TOCTOU window. addEntry returns the post-write Library so the read-after-write is free.

## Pattern handed to W12 / W13 (and confirmed for the Wave 10 trio)

W11 (this plan) is the second of the three Wave-10 sibling chokepoints. The four-line composition idiom from W10 has now been demonstrated under TWO different schema shapes (state's 3-fixed-field shape and library's unbounded-entries shape) — proving the pattern generalizes:

```typescript
// 1. Module-level lazy logger child (so tests can override env before first use)
let _log: SessionLogger | null = null;
function log(): SessionLogger {
  if (!_log) _log = openSessionLog({ scope: 'auto' }).child({ module: 'XXX' });
  return _log;
}

// 2. updateXxx / addXxx: read+(check)+mutate+write inside ONE withLock critical section
export async function addXxx(root: string, item: XxxItem): Promise<XxxState> {
  const file = path.join(path.resolve(root), 'XXX.json');
  // (Optional fail-fast pre-lock validation if you have a single-item schema.)
  const validated = XxxItemSchema.parse(item);
  let next!: XxxState;
  await withLock(file, async () => {
    const cur = await loadAndMigrate({ file, schema: XxxSchema, ..., writeBack: false });
    // (Optional duplicate / conflict check goes HERE, inside the lock, after the load.)
    next = XxxSchema.parse({ ...cur, items: [...cur.items, validated] });
    await atomicWriteFile(file, JSON.stringify(next, null, 2) + '\n');
  });
  log().event({ event: 'xxx.add', ...identifyingFields });
  return next;
}
```

The key invariants W12 (checkpoint) and W13 (runtime) should preserve verbatim:
- `loadAndMigrate({ ..., writeBack: false })` inside any in-lock load that's about to be overwritten
- `loadAndMigrate({ ..., writeBack: true })` inside top-level standalone reads (loadXxx)
- ENOENT (and `cause.code === 'ENOENT'`) translated to `XxxNotFoundError`; everything else bubbles up
- `XxxSchema.parse` runs on init seed, save input, AND mutator/append output (defense-in-depth, 3x)
- Single-item schema (if available) parses BEFORE the lock for fail-fast caller-side validation
- One `.event(...)` per public function call; payload includes `{ event, ...identifying fields, schemaVersion }`
- Lock key = the absolute file path itself; do NOT compute a sha256 — W3 does it internally
- findXxx-style pure reads stay lock-free; document this as the contract so callers don't expect transactional semantics from them

## Self-Check: PASSED

Verified before final SUMMARY commit:
- `bin/lib/library.ts` exists and exports the 8 expected names (loadLibrary, saveLibrary, addEntry, findEntry, initLibrary, LibraryNotFoundError, LibraryAlreadyExistsError, DuplicateLibraryEntryError) — confirmed by reading the file.
- Imports limited to node:fs / node:path + ./atomic-write.js / ./lock.js / ./migrations/loader.js / ./schemas/library.js / ./session-log.js — confirmed by inspecting the import block (lines 56-68 of library.ts).
- addEntry's loadAndMigrate AND atomicWriteFile both inside `withLock(file, async () => { ... })` AND duplicate-check happens after load, before write — confirmed by reading the function body (library.ts lines 281-302).
- 4 distinct event names in 5 public functions — confirmed: library.init, library.load (used by both loadLibrary AND findEntry-via-loadLibrary), library.save, library.addEntry.
- ENOENT translation includes the `cause.code === 'ENOENT'` branch — confirmed (library.ts line 209).
- initLibrary fs.access guard + LibraryAlreadyExistsError — confirmed (library.ts lines 147-159).
- 8 tests in tests/library.test.ts — confirmed.
- Commits exist on main:
  - `3a2e83c` feat(01-11): add bin/lib/library.ts
  - `fe430e3` test(01-11): add tests/library.test.ts
- `npx tsc --noEmit` exit 0; `npm run lint` exit 0; `node scripts/run-tests.mjs` reports tests=194 pass=194 fail=0.
- STATE.md and HANDOFF.json reconciliation deferred to the post-SUMMARY step (will be a separate commit alongside the next executor handoff).
