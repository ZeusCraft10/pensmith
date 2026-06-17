---
phase: 04-breadth-n-sections-compile-wave-scheduling
plan: 03
subsystem: infra
tags: [wave-scheduler, write-orchestration, semaphore, bounded-parallel, tier-contract, citty]

# Dependency graph
requires:
  - phase: 04-breadth-n-sections-compile-wave-scheduling (Plan 04-01)
    provides: "buildWaveGraph (Kahn topo-sort + override validation + cycle detect), runWave (Semaphore-bounded Promise.allSettled), parseOutline, Semaphore (budget.ts)"
  - phase: 03-vertical-slice-one-section
    provides: "bin/cli/write.ts single-section drafter + assertDrafterInput (WRTE-04 chokepoint), PlanFrontmatterSchema, section path helpers, tier-contract PHASE_3_CASES registry"
provides:
  - "runAllSections — drains the wave graph serially, runs each wave's sections in bounded parallel via the existing single-section writer, prunes blocked subtrees (D-03)"
  - "WaveResult / SectionResult types — per-wave settled outcomes (done | failed | blocked)"
  - "pensmith write (no <n>) wave-scheduling branch — single-section path preserved verbatim"
  - "workflows/write.md wave-mode capability_check + Tier-2 serial degrade rule"
  - "write-wave tier-contract registry entry + dual-tier parity test (CONTRIBUTING.md D-24)"
affects: [04-04-revise-swap, 04-05-compile-report, compile, revise, plan-phase-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave orchestrator is a thin read-only composition over Plan 01's scheduler: it reads OUTLINE.md + per-section PLAN.md frontmatter, builds the graph, and delegates ALL writes to an injectable writeSection callback (testable + ARCH-20 stateless by construction)"
    - "Blocked-subtree pruning by cascading a failedOrBlocked slug set across waves — a node whose depends_on includes any failed/blocked slug is marked blocked, skipped, and itself added to the set so its own dependents cascade"
    - "Tier divergence at the concurrency cap only — Semaphore(maxParallel) per wave; Tier 2 is just Semaphore(1) + one stderr WARN, no separate serial code path"
    - "Wave progress streamed as structured JSON lines to stdout; WARN/diagnostics to stderr — keeps the MCP stdio frame clean (T-04-13)"

key-files:
  created:
    - bin/lib/write-orchestrator.ts
    - tests/write-orchestrator.test.ts
    - tests/section-isolation-n.test.ts
  modified:
    - bin/cli/write.ts
    - workflows/write.md
    - tests/tier-contract.test.ts

key-decisions:
  - "runAllSections takes an injectable writeSection callback (not a hardcoded drafter call) so the orchestrator stays pure/testable and the CLI supplies the real single-section path that runs assertDrafterInput per node (WRTE-04 not bypassed)"
  - "Added an optional `only?: string[]` allow-list to runAllSections — models a section re-run (write section 3 only) by omitting non-named sections from the graph entirely, so the section-as-phase isolation invariant holds by construction (no other section's artifacts can be touched)"
  - "write-wave tier-contract case is CLI-only (mcpTool: null) at Plan 04-03 — the MCP pensmith_write tool only accepts a single-section `n`; wave invocation has no MCP surface yet, so the dual-tier parity test exercises both tiers via the CLI (Tier 1 default-parallel vs Tier 2 forced-serial). Plan 05 Task 4 extends with the full 3-section deps parity"
  - "Wave-mode parallel capability expressed purely as a degrade_if_missing rule (not a new `optional:` capability_check key) to satisfy the ARCH-03 W4 closed-vocabulary gate"

patterns-established:
  - "Re-run isolation via graph-scoping: the `only` allow-list keeps untouched sections out of the wave graph, the strongest form of section-as-phase isolation (the writer is never even invoked for them)"
  - "Tier-2 forced-serial signal = exactly one WARN containing 'max-parallel ignored' to stderr, emitted once at runAllSections entry when maxParallel === 1"

requirements-completed: [ARCH-19, ARCH-20]

# Metrics
duration: 22min
completed: 2026-06-17
---

# Phase 4 Plan 03: Wave-Mode Write Orchestration Summary

**`pensmith write` with no section number schedules all planned sections into dependency waves and writes them wave-by-wave through the existing single-section drafter — bounded-parallel in Tier 1, forced-serial in Tier 2 — with within-wave failures isolated to their own subtree and zero orchestrator state persisted.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-06-17T10:12Z
- **Completed:** 2026-06-17T10:34Z
- **Tasks:** 3
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments
- Shipped `runAllSections` — drains the Plan 01 wave graph serially, runs each wave's sections in bounded parallel under a fresh `Semaphore(maxParallel)` via `runWave`, and prunes blocked subtrees across waves (D-03). Persists nothing of its own (ARCH-20 / D-04) — it only reads OUTLINE.md + per-section PLAN.md frontmatter and delegates writes to an injectable `writeSection`.
- Wired the `pensmith write` wave branch: when no positional `<n>` is given, the verb takes the wave path with a `--max-parallel` arg (default 5); the single-section `pensmith write <n>` path is preserved verbatim. The per-node writer was factored out (`writeOneSection`) so BOTH paths run `assertDrafterInput` (WRTE-04 chokepoint not bypassed).
- Tier-2 forced-serial semantics: `maxParallel === 1` emits exactly one `max-parallel ignored` WARN to stderr; wave progress streams as structured JSON lines to stdout (no `console.*`, clean MCP frame).
- Extended `workflows/write.md` with a wave-mode `<capability_check>` degrade rule (serial `Semaphore(1)` fallback) and documented the Tier-2 WARN — 84 lines, under the `workflows/verify.md` 135-line high-water mark, no Pass 2/4 references.
- Registered the `write-wave` tier-contract entry in-plan (CONTRIBUTING.md D-24) with a dedicated dual-tier parity test: Tier 1 default-parallel vs Tier 2 forced-serial on a 2-section no-dep fixture, both reaching terminal state with identical last-wave DRAFT.md.
- Section-as-phase isolation extended to N: re-running section 3 only (via the `only` allow-list) leaves sections 1, 2, 4 with identical mtime AND content-hash.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wave 0 — RED orchestration + section-isolation-N tests** — `9bafedd` (test)
2. **Task 2: write-orchestrator — drain waves, bounded parallel, blocked-subtree pruning** — `782d13e` (feat, GREEN; TDD task — RED was Task 1)
3. **Task 3: write.ts wave branch + write.md capability check + write-wave tier-contract entry** — `fc6c826` (feat), with follow-up fix `7bcae65` (W4 closed-vocabulary)

**Plan metadata:** (this commit) `docs(04-03): complete wave-mode write orchestration plan`

## Files Created/Modified
- `bin/lib/write-orchestrator.ts` - `runAllSections(paperRoot, {maxParallel, writeSection, only?})`; loads outline + PLAN.md frontmatter map, builds the wave graph, drains waves serially with a fresh Semaphore per wave, prunes blocked subtrees, emits the Tier-2 WARN. Zero state persistence.
- `bin/cli/write.ts` - positional `<n>` now optional; no-`<n>` wave branch calls `runAllSections` with `--max-parallel` and JSON-line progress; `writeOneSection` factored so both paths run `assertDrafterInput`. Single-section path unchanged.
- `workflows/write.md` - wave-mode overview + capability_check serial degrade rule + Tier-2 forced-serial WARN documentation; wave-mode body step.
- `tests/write-orchestrator.test.ts` - diamond all-complete (order-independent settled state), blocked-subtree pruning (D-03), failed-sibling-no-cancel (D-03), Tier-2 serial-WARN (D-02).
- `tests/section-isolation-n.test.ts` - re-run section 3 only leaves sections 1,2,4 mtime + content-hash unchanged (section-as-phase invariant, N=4).
- `tests/tier-contract.test.ts` - write-wave registry entry (D-24) + dual-tier parity standalone test; `runCliCaptureBoth` helper (captures stderr on success, which `runCliInDir` discards).

## Decisions Made
- **Injectable `writeSection`**: keeps the orchestrator pure (tests stub it; the CLI supplies the real drafter that runs `assertDrafterInput` per node). This is how WRTE-04 is enforced for the wave path without the orchestrator knowing about the chokepoint.
- **`only?: string[]` allow-list for re-runs**: omitting non-named sections from the graph is a stronger isolation guarantee than mtime checks — the writer is never invoked for untouched sections.
- **write-wave is CLI-only at this plan**: the MCP `pensmith_write` tool only accepts a single-section `n`; there is no MCP wave-invocation surface yet, so the parity test exercises both tiers via the CLI. The registry entry still satisfies D-24 (workflows/write.md changed here).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Unused `@ts-expect-error` directive in the RED stderr-capture test**
- **Found during:** Task 2 (typecheck gate for the GREEN orchestrator)
- **Issue:** The Task-1 RED test monkeypatched `process.stderr.write` with a `@ts-expect-error` directive that became unused once the assignment typechecked cleanly — `tsc --noEmit` failed with TS2578.
- **Fix:** Replaced the directive with a typed cast (`patched as typeof process.stderr.write`).
- **Files modified:** tests/write-orchestrator.test.ts
- **Verification:** `tsc --noEmit` exit 0; orchestrator + isolation suites still GREEN.
- **Committed in:** `782d13e` (Task 2 commit)

**2. [Rule 1 - Bug] `optional:` capability_check key tripped the ARCH-03 W4 closed-vocabulary gate**
- **Found during:** Task 3 (full `npm test` regression after the workflow patch)
- **Issue:** `workflows-keyequal.test.ts` parses everything between `required:` and `degrade_if_missing:` as required tokens against a closed vocabulary; the interim `optional:` key (with an `MCP scheduler` token) was captured and rejected.
- **Fix:** Removed the `optional:` block; expressed the parallel-wave capability purely as a `degrade_if_missing` rule (serial `Semaphore(1)` fallback) where degrade behavior belongs. `required:` keeps only `MCP state.update`.
- **Files modified:** workflows/write.md
- **Verification:** `workflows-keyequal.test.ts` GREEN; full suite 584/584 GREEN.
- **Committed in:** `7bcae65` (Task 3 follow-up commit)

**3. [Rule 3 - Blocking] `runCliInDir` discards stderr on a successful (exit 0) run**
- **Found during:** Task 3 (write-wave parity test — Tier-2 WARN assertion failed with empty stderr)
- **Issue:** The shared `runCliInDir` helper hardcodes `stderr: ''` on exit 0 (execFileSync returns only stdout on success); the wave-mode Tier-2 WARN goes to stderr even on a successful run, so it was never captured.
- **Fix:** Added a local `runCliCaptureBoth` (spawnSync) that captures both streams regardless of exit code, used only by the write-wave parity test. The shared helper was left untouched to avoid regressing the 6 existing Phase-3 cases.
- **Files modified:** tests/tier-contract.test.ts
- **Verification:** write-wave parity test GREEN (WARN matched on stderr); full tier-contract suite GREEN.
- **Committed in:** `fc6c826` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 blocking)
**Impact on plan:** All three were self-inflicted, surfaced and fixed within their own tasks via the typecheck/lint/full-suite gates. No scope creep; the orchestrator + CLI surface match the plan's `must_haves` (`runAllSections`, `WaveResult`, wave branch, `--max-parallel`, capability_check, write-wave registry entry).

## Issues Encountered
- The MCP `pensmith_write` tool requires a single-section `n` (no wave surface), which the plan's tier-contract guidance ("mcpTool pensmith_write with no positional n") cannot literally satisfy at this plan. Resolved by making the write-wave case CLI-only (mcpTool: null) with both tiers exercised through the CLI — consistent with the existing interactive-verb pattern (documented architectural asymmetry). The D-24 obligation (registry entry where workflows/write.md changes) is fully satisfied.

## Known Stubs
None. `runAllSections` and the wave branch are fully implemented and exercised by passing tests. The per-node writer routes through the existing Tier-2 placeholder drafter (the Phase-3 Tier-2 fallback), which is intentional and unchanged by this plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `runAllSections` is the multi-section write entry point Plan 04-04 (revise) and the compile pipeline build on; the `WaveResult` shape is available for status surfacing.
- Plan 05 Task 4 will extend the write-wave tier-contract case from the 2-section stub to the full 3-section `b→a`, `c→a` parity + Tier-2 serial-WARN assertions (the `test:tier-contract` script and registry entry are in place and unchanged).
- No blockers. Full suite green at 584/584; `tsc --noEmit`, `eslint .`, and `npm run build` all clean.

## Self-Check: PASSED

All 3 created files and 3 modified files exist on disk; all 4 commits (`9bafedd`, `782d13e`, `fc6c826`, `7bcae65`) are present in git history. Full suite GREEN (584/584, +8 from the 576 baseline). `npm run lint`, `tsc --noEmit`, `npm run build`, and `npm run test:tier-contract` all clean. No new package.json dependency added.

---
*Phase: 04-breadth-n-sections-compile-wave-scheduling*
*Completed: 2026-06-17*
