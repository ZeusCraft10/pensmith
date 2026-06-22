---
phase: 11-tier-2-llm-transport
plan: 01
subsystem: testing
tags: [node-test, MockAgent, undici, skip-guard, feature-detect, llm-transport, red-by-skip]

# Dependency graph
requires:
  - phase: 10-style-match
    provides: RED-by-skip scaffold convention (10-00 pattern this plan mirrors)
  - phase: 08-add-source
    provides: dynamic URL.href import pattern (08-00 precedent)
provides:
  - Wave-0 RED-by-skip test scaffold for bin/lib/anthropic.ts transport module
  - T-11-01..T-11-08 behavioral contracts as skip-guarded node:test cases
  - Per-verb integration contracts (T-11-05/T-11-06) for all six generative verbs
affects:
  - 11-tier-2-llm-transport/11-02 (Wave 1 transport implementation targets these tests)
  - 11-tier-2-llm-transport/11-03 (Wave 2 verb wiring targets T-11-05/T-11-06)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "transportReady() feature-detect: dynamic URL.href import + typeof export checks, skip on throw"
    - "withFreshState: merged chdir+env+MockAgent isolation helper for transport tests"
    - "walkAndReadAll: recursive disk sweep for no-leak sentinel assertion (T-11-03)"
    - "VERB_WIRED_PREDICATES: source-grep predicates that skip integration tests until each verb is wired"

key-files:
  created:
    - tests/llm-transport.test.ts
  modified: []

key-decisions:
  - "All 19 tests skip via transportReady() feature-detect until bin/lib/anthropic.ts exists (mirrors 08-00/10-00)"
  - "Per-verb integration tests doubly-guarded: transportReady() AND source-grep predicate (TIER2_* constant absent)"
  - "withFreshState merges chdir+env+MockAgent so budget.ts COSTS.jsonl writes into tmpdir"
  - "MockScope.on() not available in undici typed API — T-11-03 no-leak asserted via disk sweep only"
  - "MockAgent.disableNetConnect() installed in every behavioral test; any unregistered HTTP call would throw"

patterns-established:
  - "T-11-03 no-leak pattern: stdout/stderr capture + walkAndReadAll disk sweep for sentinel substring"
  - "URL.href dynamic import: await import(new URL('../bin/lib/anthropic.js', import.meta.url).href)"
  - "Per-verb source-grep predicate: read .ts source, check TIER2_* constant absent before running integration test"

requirements-completed: [GEN-01, GEN-02, GEN-06]

# Metrics
duration: 25min
completed: 2026-06-22
---

# Phase 11 Plan 01: LLM Transport Wave-0 RED-by-skip Scaffold Summary

**19-test RED-by-skip scaffold enumerating all Phase-11 behavioral contracts via dynamic URL.href feature-detect guard; full suite stays GREEN (19 skips, 0 failures) before bin/lib/anthropic.ts exists**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-06-22T00:00:00Z
- **Completed:** 2026-06-22T00:25:00Z
- **Tasks:** 2 (merged into one commit — both tasks created tests/llm-transport.test.ts)
- **Files modified:** 1

## Accomplishments

- Created `tests/llm-transport.test.ts` (906 lines) with all 8 transport contracts + 12 per-verb integration tests
- All 19 tests skip cleanly via `transportReady()` feature-detect; 0 failures on the unbuilt module
- Full suite: 875 tests, 856 pass, 19 skip, 0 fail (no regressions)
- `npm run typecheck` clean — URL.href dynamic import pattern keeps tsc happy while the module is absent

## Task Commits

1. **Tasks 1+2: RED-by-skip scaffold (T-11-01..T-11-08 + six per-verb integration tests)** - `7edd482` (test)

## Files Created/Modified

- `tests/llm-transport.test.ts` — RED-by-skip scaffold: transportReady() guard, withFreshState helper, T-11-01..T-11-08 + T-11-05/T-11-06 per-verb loops for intake/research/outline/plan/write/revise

## Decisions Made

- `MockScope.on()` is not typed in the undici public API, so T-11-03 (no-leak) asserts the sentinel is absent from disk files, stdout, and stderr rather than intercepting the request object directly. This is equivalent behavior — the disk sweep is the load-bearing assertion.
- Tasks 1 and 2 were combined into a single commit since they both write to the same file (`tests/llm-transport.test.ts`) and the file was written atomically.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed `.on()` call on MockScope (type error)**
- **Found during:** Task 1 (scaffolding T-11-03)
- **Issue:** `tsc --noEmit` reported `Property 'on' does not exist on type 'MockScope<object>'` — undici's MockScope does not expose `.on()` in its TypeScript types
- **Fix:** Removed the `.on()` chain; T-11-03 no-leak assertion uses the disk-sweep loop (walkAndReadAll) + stdout/stderr capture instead — equivalent behavior, better type safety
- **Files modified:** tests/llm-transport.test.ts
- **Verification:** `npm run typecheck` passes; `node --import tsx --test tests/llm-transport.test.ts` → 19 skips, 0 fail
- **Committed in:** 7edd482

**2. [Rule 1 - Bug] Fixed `err as Record<string, unknown>` cast requiring double-cast through `unknown`**
- **Found during:** Task 2 (T-11-04 type check)
- **Issue:** `tsc --noEmit` reported "Conversion of type 'Error' to type 'Record<string, unknown>' may be a mistake"
- **Fix:** Added intermediate `as unknown as Record<string, unknown>` cast
- **Files modified:** tests/llm-transport.test.ts
- **Verification:** `npm run typecheck` passes
- **Committed in:** 7edd482

---

**Total deviations:** 2 auto-fixed (both Rule 1 — type errors in test scaffold)
**Impact on plan:** Both fixes were type-only. No behavioral change. The no-leak assertion remains equivalent.

## Issues Encountered

None — the test scaffold approach (dynamic import + skip guard) worked exactly as designed from the 08-00/10-00 precedent.

## Known Stubs

None — this plan creates test scaffolding only. No implementation stubs were introduced.

## Threat Flags

None — this plan creates test-only files with no new runtime network surface, no new auth paths, and no new schema changes. The test file uses MockAgent.disableNetConnect() which reduces rather than increases network surface.

## Self-Check: PASSED

- `tests/llm-transport.test.ts` exists: FOUND
- Commit `7edd482` exists: FOUND
- `transportReady` present in file: FOUND (grep confirmed)
- `await import(` present in file: FOUND (grep confirmed)
- `isNoLlmMode` reference present: FOUND
- No static `import { complete } from '../bin/lib/anthropic.js'` at top-level: CONFIRMED (only dynamic URL.href import)
- `api.anthropic.com` referenced: FOUND (T-11-07)
- `api.openai.com` referenced: FOUND (T-11-08)
- Six verb names in integration tests: FOUND (intake, research, outline, plan, write, revise)

## Next Phase Readiness

- Wave 1 (11-02) can now implement `bin/lib/anthropic.ts` against the fixed test contracts in T-11-01..T-11-04 and T-11-07/T-11-08
- Wave 2 (11-03/11-04) can wire the six verbs against T-11-05/T-11-06 per-verb contracts
- As each module/verb lands, the corresponding skip transforms into a real assertion automatically

---
*Phase: 11-tier-2-llm-transport*
*Completed: 2026-06-22*
