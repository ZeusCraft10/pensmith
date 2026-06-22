---
phase: 12-live-research-intake-bootstrap-humanizer-task
plan: 01
subsystem: testing
tags: [node:test, RED-by-skip, GEN-03, GEN-04, GEN-05, fileURLToPath, skip-guard, offline]

# Dependency graph
requires:
  - phase: 11-live-transport-anthropic-sdk
    provides: "research.ts swap-seam comment, intake.ts resolvePaperId/registerPaperNonFatal, exporter.ts runHumanizer skeleton"
provides:
  - "tests/research-discovery.test.ts — GEN-03 RED-by-skip scaffold (5 behavioral tests)"
  - "tests/intake-bootstrap.test.ts — GEN-04 RED-by-skip scaffold (3 behavioral tests)"
  - "tests/humanizer-task.test.ts — GEN-05 RED-by-skip scaffold (3 behavioral tests)"
affects:
  - "12-02 (research-orchestrator wave 1) — discoverySeamWired() activates when orchestrator ships"
  - "12-03 (intake initState wave 1) — intakeBootstrapWired() activates when initState( lands"
  - "12-04 (exporter TaskRunner wave 2) — taskSeamWired() activates when __setTaskRunnerForTest lands"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "fileURLToPath(new URL('../path', import.meta.url)) — spaced-path safe test resolution (T-12-W0-01)"
    - "source-grep skip-guard — existsSync is insufficient; grep for the wiring token (e.g., initState()"
    - "module-top PENSMITH_NO_LLM=1 before any dynamic import — offline gate pattern"
    - "always-pass path-sanity test in each file — confirms predicate resolves, not swallowed %20 error"

key-files:
  created:
    - tests/research-discovery.test.ts
    - tests/intake-bootstrap.test.ts
    - tests/humanizer-task.test.ts
  modified: []

key-decisions:
  - "All 3 scaffolds use fileURLToPath(new URL('../...', import.meta.url)) — never .pathname/regex-strip — to handle repo's spaced path (OneDrive - Roanoke College)"
  - "Skip-guards are source-grep predicates (not just existsSync) because intake.ts already exists; only the wiring token confirms the seam landed"
  - "Each file includes an always-pass path-sanity test to confirm the predicate resolves correctly on this machine — guards against swallowed %20 path errors"
  - "PENSMITH_NO_LLM=1 set at module top (before any import) + PENSMITH_NETWORK_TESTS not set → full offline: adapters use cassettes, LLM uses mock"
  - "humanizer-task honesty-framing test scans exporter.ts for 'undetectable' (locked-framing guard) — this test is skip-guarded so it only fires after the seam lands"

patterns-established:
  - "RED-by-skip scaffold: behavioral test bodies inside skip-guarded blocks; always-pass path-sanity test outside for predicate confidence"
  - "source-grep predicate: read the source file with readFileSync via fileURLToPath URL — if readFileSync throws due to %20, catch returns false (predicate = not wired)"

requirements-completed: [GEN-03, GEN-04, GEN-05]

# Metrics
duration: 18min
completed: 2026-06-22
---

# Phase 12 Plan 01: Wave-0 RED-by-skip Scaffolds (GEN-03/04/05) Summary

**Three offline skip-guarded test scaffolds locking executable behavioral contracts for live research fan-out (GEN-03), intake STATE.json bootstrap (GEN-04), and injectable TaskRunner humanizer (GEN-05) — all using fileURLToPath path resolution for the spaced-path repo.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-06-22T~T18:00Z
- **Completed:** 2026-06-22T~T18:18Z
- **Tasks:** 3
- **Files modified:** 3 (all created)

## Accomplishments
- tests/research-discovery.test.ts: 5 skip-guarded GEN-03 behavioral tests + 1 always-pass path-sanity test; skip-guard is dual: research-orchestrator.ts must exist AND swap-seam token must be replaced in research.ts
- tests/intake-bootstrap.test.ts: 3 skip-guarded GEN-04 behavioral tests + 1 always-pass path-sanity test; skip-guard is source-grep for `initState(` in intake.ts (existsSync insufficient — intake.ts pre-exists)
- tests/humanizer-task.test.ts: 3 skip-guarded GEN-05 behavioral tests + 1 always-pass path-sanity test; skip-guard is source-grep for `__setTaskRunnerForTest` in exporter.ts; includes locked-framing integrity guard (no "undetectable" in exporter.ts)
- Full suite stays GREEN: 889 tests, 878 pass, 11 skips, 0 failures
- Confirmed path predicates resolve correctly on this machine (OneDrive spaced path, no %20 in resolved paths)

## Task Commits

All three tasks committed in a single atomic commit:

1. **Task 1: research-discovery RED-by-skip scaffold** — `9f55937`
2. **Task 2: intake-bootstrap RED-by-skip scaffold** — `9f55937`
3. **Task 3: humanizer-task RED-by-skip scaffold** — `9f55937`

**Plan metadata:** (committed with SUMMARY)

## Files Created/Modified
- `tests/research-discovery.test.ts` — GEN-03 scaffold: fan-out ≥1 candidate, DOI dedup, defensive fallback, zero-candidate empty LIBRARY.json, D-15 crossCheckRetractions-before-writeBibtex ordering
- `tests/intake-bootstrap.test.ts` — GEN-04 scaffold: STATE.json v2 schema + paperId, idempotency (no paperId regeneration), WARN-skip-guard flip (registration proceeds after wiring)
- `tests/humanizer-task.test.ts` — GEN-05 scaffold: call-through TaskRunner → FINAL.md under paperDir, null-runner clean skip, honesty-framing integrity (no "undetectable")

## Decisions Made
- Used dual skip-guard for research-discovery (existsSync + source grep) to avoid premature activation between Plan 02 creating the module and Plan 02 wiring research.ts
- Each file includes an always-pass path-sanity test (no skip-guard) so "not yet wired" vs. "swallowed path error" are distinguishable in test output
- humanizer-task framing guard is skip-guarded (only fires when seam lands) to avoid false-positive assertions on comments in the current exporter.ts

## Deviations from Plan

None - plan executed exactly as written. All three scaffolds implement the specified behavioral contracts and pass with skips (0 failures).

## Issues Encountered
None.

## Known Stubs
None — these are test-only scaffolds. No stub data flows to UI rendering.

## Threat Flags
None — test-only files with no new network endpoints, auth paths, or schema changes.

## Self-Check: PASSED

Files exist:
- tests/research-discovery.test.ts: FOUND
- tests/intake-bootstrap.test.ts: FOUND
- tests/humanizer-task.test.ts: FOUND

Commits exist:
- 9f55937: FOUND (test(12-01): add Wave-0 RED-by-skip scaffolds for GEN-03/GEN-04/GEN-05)

Verification: 14 tests total (3 pass, 11 skips, 0 failures) — confirmed.

## Next Phase Readiness
- Wave 1 / Plan 02 (research-orchestrator): discoverySeamWired() will activate immediately once research-orchestrator.ts exists and the swap-seam block is replaced
- Wave 1 / Plan 03 (intake initState): intakeBootstrapWired() will activate immediately once initState( appears in intake.ts
- Wave 2 / Plan 04 (exporter TaskRunner): taskSeamWired() will activate once __setTaskRunnerForTest is exported from exporter.ts

---
*Phase: 12-live-research-intake-bootstrap-humanizer-task*
*Completed: 2026-06-22*
