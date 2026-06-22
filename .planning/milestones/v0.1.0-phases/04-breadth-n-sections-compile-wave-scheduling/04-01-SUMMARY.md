---
phase: 04-breadth-n-sections-compile-wave-scheduling
plan: 01
subsystem: infra
tags: [wave-scheduler, kahn-topological-sort, semaphore, zod, citation-tokens, outline-parser]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "Semaphore (budget.ts), atomic-write/state chokepoints, zod schema conventions, paths.ts validateSlug"
  - phase: 03-vertical-slice-one-section
    provides: "PlanFrontmatterSchema (depends_on slugs, verified_against_draft_hash), verify/pass1.ts citation regex, citekey.ts CITEKEY_RE"
provides:
  - "parseOutline(raw) — pure string→object parser for the on-disk .paper/OUTLINE.md GFM table"
  - "buildWaveGraph (canonical computeWaves/COMP-06) — Kahn topological sort by depends_on + wave-override validation"
  - "runWave — Semaphore-bounded Promise.allSettled wave executor (ARCH-19/D-03)"
  - "SectionNodeSchema + WaveGraphSchema — in-memory wave-graph zod guards"
  - "CITATION_TOKEN_RE + extractCitekeys + replaceCitekeys — shared Pandoc citation-token helpers for the compile smoother"
  - "Optional PLAN.md `wave:` frontmatter override field"
affects: [04-02-write-orchestration, 04-03-compile-pipeline, 04-05-compile-report, compile, smoother, revise]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-only scheduler: wave assignment recomputed in memory each run from outline + PLAN.md frontmatter (D-04/ARCH-20); zero fs I/O, zero persistence"
    - "Kahn topological sort with floor-validated per-section wave overrides (promote-or-throw, never silent-bump)"
    - "Pure string→object parsers separate from fs read side (outline-parse.ts vs outline.ts)"

key-files:
  created:
    - bin/lib/outline-parse.ts
    - bin/lib/citation-token.ts
    - bin/lib/scheduler.ts
    - bin/lib/schemas/wave-graph.ts
    - tests/outline-parse.test.ts
    - tests/citation-token.test.ts
    - tests/wave-scheduler.test.ts
    - tests/wave-override.test.ts
    - tests/scheduler-stateless.test.ts
  modified:
    - bin/lib/schemas/plan-frontmatter.ts

key-decisions:
  - "OUTLINE.md parse contract locked to the GFM table `| # | slug | title | depends_on | word target | assigned_sources |` from workflows/outline.md §4/§5 (the .paper/OUTLINE.md self-build file is a Tier-2 placeholder, not the canonical persisted format)"
  - "buildWaveGraph signature takes (outline, plans: Map<slug, PlanFrontmatter>) so the scheduler stays pure — the caller (04-02) owns PLAN.md disk reads"
  - "A dependency on a not-yet-planned section (absent from the plans map) is treated as already-satisfied for the current run (skip with INFO, not error) per Research §B open-risk"
  - "Wave-override floor == the node's Kahn computed_wave (which already equals max(deps.computed_wave)+1); valid override promotes, invalid throws naming slug + floor"

patterns-established:
  - "runWave normalizes thrown non-Error values to Error before Promise.allSettled records the reason (Research §P pitfall 5)"
  - "Wave-graph zod schemas are strict-by-default with NO schema_version envelope because they are never serialized (in-memory dev-typo guards only)"

requirements-completed: [ARCH-19, ARCH-20, PLAN-02, PLAN-03, COMP-06]

# Metrics
duration: 10min
completed: 2026-06-17
---

# Phase 4 Plan 01: Wave Scheduler Summary

**Read-only wave scheduler — Kahn topological sort over `depends_on` (COMP-06) with floor-validated per-section `wave:` overrides, Semaphore-bounded `runWave`, plus a pure OUTLINE.md table parser and the shared `[@citekey]` token helpers the compile smoother depends on.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-17T09:44Z
- **Completed:** 2026-06-17T09:54Z
- **Tasks:** 3
- **Files modified:** 10 (9 created, 1 patched)

## Accomplishments
- Locked the on-disk `.paper/OUTLINE.md` parse contract (GFM table) in a test header comment so parser and tests share one source of truth.
- Shipped `parseOutline` — a pure, fs-free parser that validates every slug via `paths.ts::validateSlug`, rejects duplicate slugs, and throws naming the 1-based source line on any malformed row.
- Shipped `buildWaveGraph` (the canonical `computeWaves()` of COMP-06): Kahn topological sort assigns `computed_wave = max(deps.computed_wave)+1` (roots = wave 1), validates wave overrides (PLAN-02 promote / PLAN-03 reject below floor), and detects cycles with the residual slug list.
- Shipped `runWave`: `Promise.allSettled` under a `Semaphore` cap (ARCH-19/D-02) where one rejection never cancels siblings (D-03) and non-Error throws are normalized.
- Extracted `CITATION_TOKEN_RE` + `extractCitekeys` + `replaceCitekeys` (Plan 05's smoother substitution dependency), with the `{{cite_K_M}}` placeholder family proven disjoint from the citation regex.
- Added the optional `wave` field to `PlanFrontmatterSchema` (positive int, no default — `undefined` means "compute via Kahn").
- Proved ARCH-20: scheduler writes nothing — STATE.json bytes AND mtime are unchanged across a run.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wave 0 RED tests + lock OUTLINE.md parse contract** — `ec6ae7c` (test)
2. **Task 2: parseOutline + citation-token helpers + plan-frontmatter wave field** — `aee6420` (feat, GREEN)
3. **Task 3: scheduler — Kahn sort, override validation, bounded-parallel runWave** — `0a94537` (feat, GREEN)

**Plan metadata:** (this commit) `docs(04-01): complete wave-scheduler plan`

_Note: This plan is a `type: tdd` style flow — Task 1 is the RED commit, Tasks 2 & 3 are the GREEN commits. No REFACTOR commit was needed._

## Files Created/Modified
- `bin/lib/outline-parse.ts` - Pure parser: locked OUTLINE.md GFM table → `ParsedOutline` (ordered, slug-validated, throws on malformed line)
- `bin/lib/citation-token.ts` - Shared `[@citekey]` helpers: `CITATION_TOKEN_RE`, `extractCitekeys` (dedup, first-appearance order), `replaceCitekeys`
- `bin/lib/scheduler.ts` - `buildWaveGraph` (Kahn/COMP-06 + override validation + cycle detect) and `runWave` (Semaphore-bounded, allSettled, D-03)
- `bin/lib/schemas/wave-graph.ts` - In-memory `SectionNodeSchema` + `WaveGraphSchema` (strict, no schema_version envelope)
- `bin/lib/schemas/plan-frontmatter.ts` - Added optional `wave: z.number().int().positive().optional()` (PLAN-02 / D-01)
- `tests/outline-parse.test.ts` - parseOutline contract + locked-format header comment
- `tests/citation-token.test.ts` - token extraction/replacement + placeholder disjointness
- `tests/wave-scheduler.test.ts` - ARCH-19 bounded-parallel + D-03 + COMP-06 `-t topo` Kahn cases
- `tests/wave-override.test.ts` - PLAN-02 honor + PLAN-03 `-t reject` cases
- `tests/scheduler-stateless.test.ts` - ARCH-20 STATE.json mtime+bytes invariant

## Decisions Made
- Locked OUTLINE.md format to the `workflows/outline.md` §4/§5 GFM table (`| # | slug | title | depends_on | word target | assigned_sources |`), not the Tier-2 placeholder `.paper/OUTLINE.md` present in the repo.
- Kept `buildWaveGraph` pure by taking a `Map<slug, PlanFrontmatter>` rather than reading PLAN.md from disk itself; the write-orchestrator (04-02) provides the map. This satisfies D-04/ARCH-20 by construction.
- Floor for override validation = the node's Kahn-computed wave (which already equals `max(deps.computed_wave)+1`), so `wave_override >= floor` is honored and `< floor` throws.
- A dependency on a not-yet-planned section is treated as already-satisfied for the current run (so partial planning never deadlocks the scheduler).

## Deviations from Plan

None - plan executed exactly as written. All three tasks landed with the artifacts, exports, and signatures specified in the plan's `must_haves`. No Rule 1-4 deviations were required.

## Issues Encountered

- **Pre-existing unrelated test failures discovered (out of scope).** `tests/schemas.test.ts` has 3 failing assertions because `CURRENT_STATE_VERSION` was bumped to `2` in an earlier phase but that test still expects `1` and uses a v1 `state` fixture. Confirmed present at commit `b1b2d48` (before Phase 04 execution) and entirely unrelated to this plan's files (state.ts schema is not touched here). Logged to `04-breadth-n-sections-compile-wave-scheduling/deferred-items.md` per the SCOPE BOUNDARY rule; NOT fixed in this plan.

## Known Stubs

None. All four production modules are fully implemented and exercised by passing tests. (The `citation-token.ts` comment referencing the smoother placeholder family is documentation, not a stub.)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `buildWaveGraph` + `runWave` are ready for Plan 04-02 (write orchestration): the orchestrator reads each section's PLAN.md, builds the `Map<slug, PlanFrontmatter>`, and drains `graph.waves` serially with siblings via `runWave`.
- `parseOutline` is ready for both 04-02 (graph construction) and 04-03 (compile concat in outline order).
- `citation-token.ts` helpers are ready for the 04-03/04-05 smoother placeholder substitution (D-13).
- Concern (carried, not blocking): `tests/schemas.test.ts` v1→v2 drift should be fixed in a standalone test-maintenance commit before the phase gate (`npm run check`) can be fully green.

## Self-Check: PASSED

All 10 created/modified files exist on disk; all 3 task commits (`ec6ae7c`, `aee6420`, `0a94537`) are present in git history. Full plan-01 test suite green (28/28); `tsc --noEmit` and `eslint` clean on all four production modules; no new package.json dependency added.

---
*Phase: 04-breadth-n-sections-compile-wave-scheduling*
*Completed: 2026-06-17*
