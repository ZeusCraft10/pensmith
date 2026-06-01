---
phase: "04-breadth-n-sections-compile-wave-scheduling"
plan: "03"
subsystem: "write-orchestrator"
tags: ["wave-scheduler", "orchestration", "parallel", "tier-contract", "tdd"]
dependency_graph:
  requires: ["04-01"]
  provides: ["runAllSections", "write-wave-mode"]
  affects: ["04-05"]
tech_stack:
  added: []
  patterns: ["wave-drain", "semaphore-bounded-parallel", "blocked-subtree-pruning", "tier-2-serial-warn"]
key_files:
  created:
    - bin/lib/write-orchestrator.ts
    - tests/write-orchestrator.test.ts
    - tests/section-isolation-n.test.ts
  modified:
    - bin/cli/write.ts
    - mcp/tools.ts
    - workflows/write.md
    - tests/tier-contract.test.ts
decisions:
  - "warnedOnce guard placed at runAllSections entry (not per-wave) so Tier-2 WARN fires exactly once per invocation regardless of wave count (REVIEW M-04)"
  - "loadSectionPlans scans sections directory for slug matches rather than requiring callers to know the NN-prefix — slug-first lookup decoupled from directory numbering"
  - "Tier-2 WARN to stderr only (not stdout) to keep MCP frame integrity (T-04-13)"
  - "n is optional in pensmith_write MCP tool — no-arg invocation triggers wave-mode (Tier 1)"
  - "write-wave PHASE_3_CASES entry uses seedPaperFixture (extended with OUTLINE.md + 2-section PLAN.md) so the for-loop tier-contract test works without per-case fixture override"
metrics:
  duration: "~25 min"
  completed: "2026-05-31"
  tasks: 3
  files: 7
---

# Phase 04 Plan 03: Multi-Section Write Orchestration Summary

Wire Plan 01 wave scheduler into the pensmith write flow: when invoked without a section number, `write` loads the outline, builds the wave graph via `buildWaveGraph`, and drains waves serially — running each wave's sections in bounded parallel (Tier 1, `--max-parallel 5`) or serially (Tier 2, forced `--max-parallel 1` with a single WARN).

## Key Changes

### Source Code

- `bin/lib/write-orchestrator.ts`: `runAllSections(paperRoot, opts)` — drains the wave graph wave-by-wave. Each wave uses `new Semaphore(maxParallel)` + `runWave`. After each wave settles, nodes whose deps FAILED or are MISSING/UNPLANNED are marked `blocked` (REVIEW HIGH). Tier-2 `warnedOnce` guard fires exactly once at run start (REVIEW M-04). Orchestrator persists nothing (ARCH-20 / D-04).
- `bin/cli/write.ts`: `n` positional is now optional. When absent, wave-mode branch calls `runAllSections`. When present, single-section path is fully preserved including `assertDrafterInput` chokepoint (WRTE-04 / T-04-11). `--max-parallel` arg added (default 5). Wave progress streamed as JSON lines to stdout (no `console.*` — T-04-13).
- `mcp/tools.ts`: `pensmith_write` MCP tool `n` input made optional to support no-arg (wave-mode) invocations from Tier 1.
- `workflows/write.md`: Added `<capability_check name="wave-mode">` block documenting Tier-2 serial fallback (D-02) and JSON-line progress (T-04-13). Updated Overview to describe wave-mode. No Pass 2/4 references.

### Tests

- `tests/write-orchestrator.test.ts`: 6 tests — happy path, wave structure, within-wave failure + orthogonal root (D-03), MISSING dep → blocked (REVIEW HIGH), Tier-2 once-per-run serial-WARN (REVIEW M-04), deterministic serial order. All assert on final settled state, never event order (04-RESEARCH §O).
- `tests/section-isolation-n.test.ts`: N=4 section isolation test asserting mtime + content-hash unchanged for non-target sections after re-running section 3 (extends Phase 3 SC-4).
- `tests/tier-contract.test.ts`: `write-wave` PHASE_3_CASES entry added (D-24 obligation). `seedPaperFixture` extended with OUTLINE.md + 2-section PLAN.md files. Both CLI and MCP paths exercise wave-mode.

## Requirements Covered

- **ARCH-19**: Multi-section write schedules into waves with bounded parallelism (Tier 1) / serial (Tier 2).
- **ARCH-20**: Orchestrator persists no wave state; re-running one section leaves others untouched (section-isolation-n green).
- **D-02**: Tier-2 forced-serial WARN emitted exactly once per run via `warnedOnce` guard.
- **D-03**: Within-wave failure + blocked-subtree pruning; orthogonal subtrees proceed.
- **CONTRIBUTING.md D-24**: `workflows/write.md` wave-mode tier-contract entry registered in this plan.

## Commits

- `233f46f`: test(04-03): add failing orchestration + section-isolation-N tests (RED)
- `5efc931`: feat(04-03): write-orchestrator — drain waves, bounded parallel, blocked-subtree pruning
- `49eda8e`: feat(04-03): wire write.ts wave-mode branch + workflow body + write-wave tier-contract

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] exactOptionalPropertyTypes compliance in write-orchestrator.ts**
- **Found during:** Task 2 typecheck
- **Issue:** `plans.set(slug, { wave, status })` where `wave: number | undefined` is not assignable to `{ wave?: number }` under `exactOptionalPropertyTypes: true`
- **Fix:** Conditionally set `wave` and `status` only when defined using a typed `planEntry` object
- **Files modified:** bin/lib/write-orchestrator.ts
- **Commit:** 5efc931

**2. [Rule 1 - Bug] Unused variables in RED test files flagged by lint**
- **Found during:** Task 1 lint check
- **Issue:** Imported `statSync`, `createHash` (unused), stray `waveLog` variable, `_node` parameter not suppressed by ESLint config
- **Fix:** Removed unused imports/variables; used `()` for arrow functions that don't need the parameter
- **Files modified:** tests/write-orchestrator.test.ts, tests/section-isolation-n.test.ts
- **Commit:** 5efc931 (included in GREEN commit since cleanup was pre-GREEN)

## Verification Results

- `node --import tsx --test tests/write-orchestrator.test.ts tests/section-isolation-n.test.ts`: 7/7 PASS
- `npm run test:tier-contract`: 23/23 PASS (including write-wave case)
- `node scripts/run-tests.mjs`: 577/577 PASS
- `npm run lint`: PASS (no errors)
- `npx tsc --noEmit`: PASS (no type errors)
- `npm run build`: PASS

## Self-Check: PASSED

Files exist:
- bin/lib/write-orchestrator.ts: FOUND
- tests/write-orchestrator.test.ts: FOUND
- tests/section-isolation-n.test.ts: FOUND

Commits exist:
- 233f46f: FOUND (test RED)
- 5efc931: FOUND (feat GREEN)
- 49eda8e: FOUND (feat wire+tier-contract)
