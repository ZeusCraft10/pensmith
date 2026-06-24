---
phase: 16-ci-dx-parity-docs-packaging
plan: 01
subsystem: testing
tags: [c8, coverage, node-test, RED-by-skip, nock, workflow-bodies]

# Dependency graph
requires: []
provides:
  - ".c8rc.json: c8 ratchet gate (lines 85 / functions 72 / branches 82 / statements 85)"
  - "tests/http-mock.test.ts: DOCS-03 lazy-nock supply-chain fail-safe contract (RED-by-skip, opens in Plan 02)"
  - "tests/workflow-bodies.test.ts: DOCS-02 non-stub content guard for doctor/status/next/resume (RED-by-skip, opens in Plan 04)"
affects: [16-02, 16-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RED-by-skip guard on source-grep predicate (08-00 convention): skip while production file has a sentinel, open when Plan N removes it"
    - "fileURLToPath(import.meta.url) + join(__dirname) for all path resolution in test files (spaced-path safe, Phase-11 lesson)"
    - ".c8rc.json as coverage config (c8 auto-discovers; externalises CLI flags for auditability)"

key-files:
  created:
    - ".c8rc.json"
    - "tests/http-mock.test.ts"
    - "tests/workflow-bodies.test.ts"
  modified: []

key-decisions:
  - "Thresholds lines:85/functions:72/branches:82/statements:85 — measured baseline 90.3/77.26/87.28/90.3 minus ~5pp; ratchet not aspirational"
  - "dist/** excluded from .c8rc.json include so compiled output never double-counts coverage"
  - "Test B in http-mock.test.ts asserts isOfflineMode/loadCassetteFile/loadCassetteDir callable via dynamic import URL — source-level proxy for prod-install safety (nock uninstall not feasible in-suite)"
  - "workflow-bodies guard uses three separate tests (A/B/C) under one shared SKIP_REASON so each assertion class is independently reportable"

patterns-established:
  - "RED-by-skip: guard predicate reads source file, sets skip string if sentinel present; downstream plan's production change is the only unlock mechanism"
  - "Skip message includes the plan ID that will unlock it (Plan 02, Plan 04) so the connection is explicit in CI output"

requirements-completed: [CI-03, DOCS-02, DOCS-03]

# Metrics
duration: 15min
completed: 2026-06-24
---

# Phase 16 Plan 01: CI/DX Scaffold Summary

**c8 ratchet gate (.c8rc.json at 85/72/82/85) + two RED-by-skip contracts that lock DOCS-03 (lazy-nock supply-chain fail-safe) and DOCS-02 (four workflow body non-stub assertions) before any production code changes**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-24T00:00:00Z
- **Completed:** 2026-06-24
- **Tasks:** 3
- **Files modified:** 3 (all new)

## Accomplishments

- Created `.c8rc.json` with regression-ratchet thresholds (5pp below measured 2026-06-24 baseline); `check-coverage:true`; `dist/**` excluded so compiled output never inflates coverage.
- Created `tests/http-mock.test.ts` with two RED-by-skip tests encoding the DOCS-03 contract (T-16-DEP): Test A asserts no top-level `import nock` + dynamic import present; Test B asserts the three production-facing functions (isOfflineMode/loadCassetteFile/loadCassetteDir) are callable without nock. Both skip while `http-mock.ts` still has the top-level import; unlock when Plan 02 lands.
- Created `tests/workflow-bodies.test.ts` with three RED-by-skip tests encoding the DOCS-02 contract: Test A asserts Overview/Outputs/Body/Shell-fallback presence; Test B asserts no stub sentinels; Test C asserts capability_check preserved. All skip while any of doctor/status/next/resume.md has "Phase 2 stub" or lacks `## Body`; unlock when Plan 04 fills them.
- Full suite: 971 tests, 966 pass, 5 skip (2 http-mock + 3 workflow-bodies), 0 fail.

## Task Commits

1. **Tasks 1+2+3: .c8rc.json + http-mock.test.ts + workflow-bodies.test.ts** (atomic) - `ef1ebfd` (feat)

## Files Created/Modified

- `.c8rc.json` — c8 coverage config; ratchet thresholds 85/72/82/85; dist/** + tests/** + scripts/** excluded
- `tests/http-mock.test.ts` — DOCS-03 lazy-nock supply-chain fail-safe (RED-by-skip, unlocks Plan 02)
- `tests/workflow-bodies.test.ts` — DOCS-02 workflow body non-stub content guard (RED-by-skip, unlocks Plan 04)

## Decisions Made

- **Thresholds chosen as baseline-minus-5pp:** 85/72/82/85 from measured 90.3/77.26/87.28/90.3. This is the ratchet intent from CI-03 locked decision — gate fails if coverage drops, not set aspirationally above current reality.
- **`dist/**` exclude added to .c8rc.json:** Not in the original RESEARCH code example but required per plan spec. Prevents double-counting when `npm run test:coverage` runs against the built dist alongside the tsx source.
- **Three separate sub-tests in workflow-bodies.test.ts:** Rather than one monolithic test, split into A (structural sections), B (no stub sentinels), C (capability_check). Each reports independently in CI output — makes it clear which contract dimension failed when Plan 04 partially fills bodies.
- **Source-grep proxy for nock-free module load:** A true "production install without nock" test would require uninstalling nock from the dev environment, which is not feasible in-suite. Source-grep on `^import nock from 'nock'` at line-start is the load-bearing proxy, mirroring the 07-01 convention established in Phase 7.

## Deviations from Plan

None — plan executed exactly as written. The `dist/**` exclude in `.c8rc.json` was explicitly called out in the plan spec ("required so compiled output never double-counts") and was the final form in the RESEARCH.md code example.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `.c8rc.json` is in place and c8 will auto-discover it for any `c8 node ...` invocation; Plan 03 can add `test:coverage` script to `package.json` and the thresholds are already configured.
- `tests/http-mock.test.ts` RED-by-skip guard is locked; Plan 02 must remove the top-level `import nock from 'nock'` from `bin/lib/http-mock.ts` — that is the sole unlock condition.
- `tests/workflow-bodies.test.ts` RED-by-skip guard is locked; Plan 04 must fill all four workflow bodies (doctor/status/next/resume.md) with Overview/Outputs/Body sections and the Shell-fallback phrase — that is the sole unlock condition.
- No blocker for subsequent waves.

## Known Stubs

None — this plan creates test scaffolding only; no production data flows.

## Threat Flags

None — three new files added. `.c8rc.json` thresholds are pinned values validated by the `node -e` assertion. No new network endpoints, auth paths, or schema changes introduced.

## Self-Check: PASSED

- `.c8rc.json` exists and passes `node -e` threshold assertion
- `tests/http-mock.test.ts` exists and reports 2 skips, 0 failures
- `tests/workflow-bodies.test.ts` exists and reports 3 skips, 0 failures
- Full suite 971 tests, 0 failures
- Commit `ef1ebfd` verified: `git log --oneline -1` = `ef1ebfd feat(16-01): scaffold .c8rc.json + RED-by-skip guards (CI-03 / DOCS-02 / DOCS-03)`

---
*Phase: 16-ci-dx-parity-docs-packaging*
*Completed: 2026-06-24*
