---
phase: 04-breadth-n-sections-compile-wave-scheduling
plan: "05"
subsystem: compile-pipeline
tags: [compile, verifier-gate, smoother, citation-density, consistency-scan, tier-contract, d40]
dependency_graph:
  requires: ["04-01", "04-02", "04-03", "04-04"]
  provides: ["bin/lib/compile.ts", "bin/lib/draft-hash.ts", "bin/lib/consistency-scan.ts", "bin/lib/citation-density.ts", "bin/cli/compile.ts", "workflows/compile.md", "templates/prompts/smoother.md"]
  affects: [".paper/DRAFT.md", ".paper/COMPILE-REPORT.md", ".paper/CITATIONS.bib"]
tech_stack:
  added: []
  patterns: ["withLock(pensmith:compile:<paperRoot>) per-root lock (D-40 compliant)", "ORDERED token-sequence equality for smoother (REVIEW M-01)", "global base-26 citekey-collision resolution pre-smoothing (REVIEW M-02)"]
key_files:
  created:
    - bin/lib/compile.ts
    - bin/lib/draft-hash.ts
    - bin/lib/consistency-scan.ts
    - bin/lib/citation-density.ts
    - bin/cli/compile.ts
    - workflows/compile.md
    - templates/prompts/smoother.md
    - tests/compile-refuse.test.ts
    - tests/compile-staleness.test.ts
    - tests/compile-order.test.ts
    - tests/draft-hash.test.ts
    - tests/compile-smoother.test.ts
    - tests/smoother-token-protect.test.ts
    - tests/compile-bib-regen.test.ts
    - tests/consistency-scan.test.ts
    - tests/citation-density.test.ts
    - tests/cassettes/smoother-clean.json
    - tests/cassettes/smoother-token-drift.json
    - tests/cassettes/smoother-multi-paragraph.json
  modified:
    - bin/lib/prompt-loader.ts
    - bin/pensmith.ts
    - tests/repo-files.test.ts
    - tests/tier-contract.test.ts
    - tests/compile-staleness.test.ts
decisions:
  - "withLock('pensmith:compile:<paperRoot>') uses per-paperRoot resource key so concurrent test fixtures do not contend on the same stub (D-40 + REVIEW M-03)"
  - "compile.ts uses withLock from lock.ts (not raw proper-lockfile) to respect D-40 lock-in-tree prohibition"
  - "smoother prompt registered with real SHA-256 hash in EXPECTED_PROMPT_HASHES + repo-files pin (WN-3 lockstep)"
  - "tier-contract compile case satisfies D-24 obligation for workflows/compile.md (created Task 4)"
metrics:
  duration: ~90min
  completed_date: "2026-05-31"
  tasks_completed: 5
  files_changed: 30
---

# Phase 04 Plan 05: Compile Pipeline Summary

**One-liner:** Full `runCompile` pipeline with always-on COMP-01 refuse-gate, outline-order concat, ordered-token-safe N-1 smoothing, COMP-04 consistency flags, COMP-05 citation density, global bib collision sync, and D-07/D-19/D-40-compliant writes.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1a | Safety-critical RED tests + smoother prompt + cassettes | c0dc585 | compile-refuse/staleness/order tests, smoother.md, 3 cassettes |
| 1b | Remaining 6 RED tests | 52779f6 | draft-hash, compile-smoother, smoother-token-protect, compile-bib-regen, consistency-scan, citation-density tests |
| 2 | draft-hash + consistency-scan + citation-density pure helpers | f9a6b61 | bin/lib/draft-hash.ts, consistency-scan.ts, citation-density.ts |
| 3 | compile.ts pipeline | e60568f | bin/lib/compile.ts (all COMP-01..07, ARCH-20) |
| 4 | compile verb + workflow + re-pin + tier-contract parity + D-40 fix | 32a4da7 | bin/cli/compile.ts, workflows/compile.md, prompt-loader, tier-contract.test.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] D-40 violation: compile.ts placed lock stub inside .paper/**
- **Found during:** Task 4, revealed by lock.test.ts D-40 assertion
- **Issue:** compile.ts used `.paper/.compile-stub` as the proper-lockfile stub, causing `proper-lockfile` to create `.paper/.compile-stub.lock` — violating D-40 (locks must live in `pensmithLockDir()`, never in the project tree)
- **Fix:** Replaced direct `proper-lockfile.lock()` call with `withLock('pensmith:compile:<paperRoot>', ..., { staleMs: 30_000 })`. The per-paperRoot resource key (`pensmith:compile:<abs-path>`) means each test fixture gets its own lock stub hash (via `sha256(resource).slice(0,12)`) in `pensmithLockDir()` — concurrent tests never contend. `staleMs: 30_000` preserved (REVIEW M-03).
- **Files modified:** `bin/lib/compile.ts`, `tests/compile-staleness.test.ts`
- **Commit:** 32a4da7

## Known Stubs

None. All pipeline steps fully implemented.

## Threat Surface Scan

No new threat surface beyond what the plan's threat model covers. All T-04-19 through T-04-SC mitigations implemented:
- T-04-19 (refuse-gate bypass): ALWAYS-ON gate reads VERIFICATION.md for EVERY section regardless of hash match
- T-04-20 (smoother citation mutation): ORDERED token-sequence equality rejects reordering
- T-04-21 (smoothing writes to section files): compile read-only on sections/<N>/DRAFT.md; compile-order test asserts mtime+hash unchanged
- T-04-23 (concurrent-compile corruption): withLock per paperRoot + staleMs:30000 + atomicWriteFile

## Self-Check: PASSED

- bin/lib/compile.ts exists: FOUND
- bin/lib/draft-hash.ts exists: FOUND
- bin/lib/consistency-scan.ts exists: FOUND
- bin/lib/citation-density.ts exists: FOUND
- bin/cli/compile.ts exists: FOUND
- workflows/compile.md exists: FOUND
- templates/prompts/smoother.md exists: FOUND
- All task commits exist in git log: FOUND (c0dc585, 52779f6, f9a6b61, e60568f, 32a4da7)
- npm run check: PASSED (exit 0)
