---
phase: 08-style-match-sketch-add-library-byo-pdf-polish
plan: 01
subsystem: library
tags: [global-library, paper-registry, derive-at-display, lifecycle-status, list, open, lib-05, upsert]

# Dependency graph
requires:
  - phase: 08-style-match-sketch-add-library-byo-pdf-polish
    plan: 00
    provides: tests/global-library.test.ts RED-by-skip contract (LIB-01/02/03/05 + never-throw)
  - phase: 01-foundation
    provides: library.ts triple chokepoint shape, paths.ts (pensmithDataDir), state.ts (loadState/StateNotFoundError), atomic-write.ts (atomicWriteFile), lock.ts (withLock), migrations/loader.ts (loadAndMigrate)
  - phase: 07-single-command-ux-layer-hooks-flags
    provides: router.ts readSectionState never-throw helper; REAL_VERB_LOADERS promotion seam; status.ts thin-orchestrator template
provides:
  - Global PAPER registry at pensmithDataDir()/library/index.json (LIB-01) with its own zod schema, UPSERT-by-id, withLock+atomicWriteFile, RETAINING folderPath
  - loadGlobalLibrary auto-init on ENOENT (LIB-02); registerPaperInGlobalLibrary UPSERT (LIB-02)
  - deriveLibraryStatus DERIVE-AT-DISPLAY 7-state lifecycle resolver (LIB-05) — never-throw over N papers
  - `list` (LIB-02) + `open` (LIB-03) CLI verbs promoted via REAL_VERB_LOADERS (no 17th verb)
  - 3 new paths.ts exports (pensmithGlobalLibraryIndexPath / pensmithActivePointerPath / pensmithStyleFingerprintsPath)
affects: [08-02 style-match (consumes pensmithStyleFingerprintsPath), 08-05 intake (calls registerPaperInGlobalLibrary at intake, seeds entry.status)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "global-library.ts clones the library.ts triple chokepoint but with UPSERT-by-id (not reject-on-duplicate) + auto-init-on-ENOENT (not AlreadyExists-throw)"
    - "DERIVE-AT-DISPLAY: list computes each paper's lifecycle status from its authoritative STATE.json at display time, never from a stored entry.status (consulted only for the terminal archived flag) — resolves Open-Q4"
    - "deriveLibraryStatus is SYNC-by-contract: a guarded synchronous loadStateSync shim mirrors the async loadState absent-vs-corrupt classification (ENOENT→intake, any other failure→unknown) so the resolver can be called without await"

key-files:
  created:
    - bin/lib/schemas/global-library.ts
    - bin/lib/global-library.ts
    - bin/cli/list.ts
    - bin/cli/open.ts
  modified:
    - bin/lib/paths.ts
    - bin/lib/migrations/loader.ts
    - bin/pensmith.ts

key-decisions:
  - "[08-01] GlobalLibraryEntry.id is z.string().min(1), NOT z.string().uuid() — the global-library.test.ts contract registers bare ids ('paper-1', 'paper-fp'); the schema stays decoupled from the id GENERATOR (intake supplies the real UUID, but the registry does not enforce the format). PATTERNS.md suggested uuid(); the RED test is the source of truth"
  - "[08-01] deriveLibraryStatus is SYNCHRONOUS (the LIB-05 test calls it without await) — it uses a guarded synchronous loadStateSync shim (fs.readFileSync + StateSchema.parse) rather than the async loadState chokepoint, classifying ENOENT→absent→intake vs. any-other-failure→corrupt→unknown EXACTLY as loadState would. loadState/StateNotFoundError are imported to document the mirrored contract"
  - "[08-01] deriveLibraryStatus DISPLAY mapping reports the COMPLETED stage, not the next action: STATE.json present + no RESEARCH.md → 'intake' (intake-complete, research not yet run), +RESEARCH.md no OUTLINE.md → 'research', +OUTLINE.md sections empty → 'outline'. sectioning X/Y: Y=sections.length, X=count of sections whose readSectionState status is past-planned (written/verifying/verified/failed/unverifiable)"
  - "[08-01] 'global-library' added to loadAndMigrate's schemaName union (Rule 3 blocking-issue) — the loader's typed literal union ('state'|'library'|'checkpoint'|'session-log'|'runtime-config') would otherwise reject the new schemaName and break tsc"
  - "[08-01] never-throw is doubled: deriveLibraryStatus has an OUTER try/catch backstop (mirrors router.ts) AND list wraps each per-entry derivation in a belt-and-suspenders try/catch → 'unknown' so reading N papers' STATE.json can never abort the whole list"

requirements-completed: [LIB-01, LIB-02, LIB-03, LIB-05]

# Metrics
duration: ~22min
completed: 2026-06-20
---

# Phase 8 Plan 01: Global PAPER registry + list/open verbs + deriveLibraryStatus Summary

**Shipped the cross-project global PAPER registry (pensmithDataDir()/library/index.json, separate schema, UPSERT-by-id, RETAINS folderPath) plus the `list` and `open` verbs, with the LIB-05 7-state lifecycle DERIVED at display time from each paper's authoritative STATE.json + section PLAN.md frontmatter — turning tests/global-library.test.ts from 14 RED-by-skip to 14 GREEN with zero suite regression.**

## Performance

- **Duration:** ~22 min
- **Completed:** 2026-06-20
- **Tasks:** 2
- **Files created/modified:** 7 (4 created + 3 modified)

## Accomplishments

- **LIB-01 global PAPER registry** — `bin/lib/schemas/global-library.ts` + `bin/lib/global-library.ts` at `pensmithDataDir()/library/index.json`, strictly separate from the per-paper `.paper/LIBRARY.json` (D-59) AND the path-free fingerprint registry. Built on the library.ts triple chokepoint: `withLock` + `loadAndMigrate` (existence-check INSIDE the lock) + `atomicWriteFile`.
- **LIB-02 init/load/UPSERT** — `initGlobalLibrary` auto-creates (idempotent no-op when present); `loadGlobalLibrary` auto-inits on ENOENT instead of throwing; `registerPaperInGlobalLibrary` UPSERTs by id (insert new, merge + bump `updatedAt` when existing) — distinct from library.ts's reject-on-duplicate, because intake re-registers on every run.
- **LIB-03 folderPath retention** — the PAPER registry entry RETAINS `folderPath` (round-trips losslessly); load-bearing for `open` (switches active paper) and `deriveLibraryStatus` (loads each paper's STATE.json from it).
- **LIB-05 DERIVE-AT-DISPLAY status** — `deriveLibraryStatus(folderPath, storedStatus?)` mirrors `router.resolveNextAction`'s on-disk stage machine onto the 7-state vocabulary, computes a REAL `sectioning {done,total}`, honors stored `archived`, and NEVER throws (guards absent vs. corrupt STATE.json, reuses `readSectionState` per section, OUTER backstop → `unknown`). The cycle-2 HIGH "status stuck at intake / dead sectioning branch" fix.
- **`list` + `open` verbs** — `list` groups by class and DERIVES status per paper (renders `sectioning X/Y`), never-crash; `open` switches the active paper by name via the `active.json` pointer (atomicWriteFile D-07 chokepoint). Both promoted via `REAL_VERB_LOADERS` — no 17th verb (both already members of the locked-16 `UX02_VERBS`).

## Task Commits

1. **Task 1: schema + global-library.ts (init/load/UPSERT + deriveLibraryStatus) + 3 paths exports** — `7f8e316` (feat)
2. **Task 2: list + open CLI verbs + REAL_VERB_LOADERS promotion** — `16815f1` (feat)

## Files Created/Modified

- `bin/lib/schemas/global-library.ts` (created) — `GlobalLibrary` + `GlobalLibraryEntry` zod schemas; entry KEEPS folderPath; header documents the three-registry separation.
- `bin/lib/global-library.ts` (created) — init/load/register(UPSERT) under the triple chokepoint + the never-throw `deriveLibraryStatus` resolver + the guarded synchronous `loadStateSync` shim.
- `bin/cli/list.ts` (created) — `listCommand` thin orchestrator: group by class, status DERIVED per paper, stdout-only, never-crash.
- `bin/cli/open.ts` (created) — `openCommand` thin orchestrator: lookup by name, existsSync guard, active pointer via atomicWriteFile.
- `bin/lib/paths.ts` (modified) — added `pensmithGlobalLibraryIndexPath` / `pensmithActivePointerPath` / `pensmithStyleFingerprintsPath` (between `pensmithHttpCacheDir` and `projectRoot`).
- `bin/lib/migrations/loader.ts` (modified) — added `'global-library'` to the `schemaName` union.
- `bin/pensmith.ts` (modified) — promoted `list` + `open` in `REAL_VERB_LOADERS`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] loadAndMigrate schemaName union rejected 'global-library'**
- **Found during:** Task 1 (tsc).
- **Issue:** `loadAndMigrate`'s `schemaName` is a typed literal union (`'state'|'library'|'checkpoint'|'session-log'|'runtime-config'`). The PATTERNS.md and the plan both pass `schemaName: 'global-library'`, which would not typecheck.
- **Fix:** Added `'global-library'` to the union in `bin/lib/migrations/loader.ts`. Additive-only; no behavior change for existing callers.
- **Files modified:** bin/lib/migrations/loader.ts
- **Commit:** 7f8e316

**2. [Rule 1 - Bug] schema enforced uuid() id but the contract registers bare ids**
- **Found during:** Task 1 (first test run — UPSERT, folderPath round-trip tests failed with `Invalid uuid`).
- **Issue:** PATTERNS.md specified `id: z.string().uuid()`, but the authoritative RED test (`tests/global-library.test.ts`) registers bare ids like `'paper-1'` / `'paper-fp'`. The schema rejected them.
- **Fix:** Relaxed `id` to `z.string().min(1)` so the registry is decoupled from the id GENERATOR (intake supplies the real UUID, but the registry does not enforce the format). The RED test is the source of truth over the PATTERNS.md suggestion.
- **Files modified:** bin/lib/schemas/global-library.ts
- **Commit:** 7f8e316

### Design Note (not a deviation)

`deriveLibraryStatus` is **synchronous** because the LIB-05 test calls it without `await`. The plan's `<action>` describes its logic in terms of `loadState(folderPath)` (an async chokepoint). Rather than change the test contract, the resolver uses a guarded synchronous `loadStateSync` shim (`fs.readFileSync` + `StateSchema.parse`) that makes the IDENTICAL absent-vs-corrupt classification the async `loadState` makes (ENOENT → intake, any other failure → unknown). `loadState` / `StateNotFoundError` are imported to document the mirrored contract. This honors the plan's never-throw invariant and the test's sync call shape.

## Known Stubs

None. `pensmithStyleFingerprintsPath` is exported but unused in this plan — it is the path export 08-02 (style-match) consumes; the export is intentional forward-wiring per the plan's `<action>`, not a stub flowing empty data to a UI.

## Verification

- `node --import tsx --test tests/global-library.test.ts` → **14/14 GREEN** (was 14 RED-by-skip): LIB-01/02 init+UPSERT+index-location, LIB-03 folderPath round-trip, LIB-05 status-cycle (intake → research → outline → sectioning 2/3 → compile → done), archived terminal flag, never-throw (absent → intake, corrupt STATE.json → unknown, corrupt section PLAN.md absorbed).
- `node --import tsx -e "...paths exports..."` → all three exports are functions.
- `node --import tsx -e "...deriveLibraryStatus..."` → exported and a function.
- `node --import tsx -e "...REAL_VERB_LOADERS..."` → `list` + `open` promoted.
- `npx tsc --noEmit` → 0 errors.
- `npx eslint` on all 7 touched files → 0 errors (no raw fs.writeFile, no env reads outside paths.ts).
- 16-verb bijection guards GREEN: `tests/cli-verbs.test.ts` (2/2), `tests/tier-contract.test.ts` (32/32), `scripts/validate-plugin-manifest.cjs` (valid).
- **Full suite:** `npm test` → 780 tests, 765 pass, 0 fail, 15 skip. The 14 global-library tests flipped skip→GREEN; the remaining 15 skips are later-wave (08-02/03/04/05/06) RED-by-skip suites.

## Self-Check: PASSED

- FOUND: bin/lib/schemas/global-library.ts
- FOUND: bin/lib/global-library.ts
- FOUND: bin/cli/list.ts
- FOUND: bin/cli/open.ts
- FOUND: commit 7f8e316
- FOUND: commit 16815f1
