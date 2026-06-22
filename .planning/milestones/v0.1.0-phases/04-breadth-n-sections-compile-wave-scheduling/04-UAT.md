---
status: complete
phase: 04-breadth-n-sections-compile-wave-scheduling
source: [04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md, 04-04-SUMMARY.md, 04-05-SUMMARY.md]
started: 2026-06-17T00:00:00Z
updated: 2026-06-17T00:00:00Z
verified_by: autonomous (machine-observable CLI/library phase — no UI surface)
---

## Current Test

[testing complete]

## Tests

### 1. Full Verification Gate (cold smoke)
expected: `npm run check` (lint → typecheck → build → tier-contract → full test suite → manifest validation) exits 0 with no failures.
result: pass
note: "Ran independently (not trusting executor self-report). `npm run check` exits 0: eslint clean, tsc --noEmit clean, build clean, tier-contract green, 632/632 tests pass, '✓ plugin.json + marketplace.json + .mcp.json valid'. Also resolved 5 pre-existing baseline failures (state-v2 test debt from Phase 3's D-08 pivot) in commit 2e1495c before/during the phase so the gate is genuinely green."

### 2. SC#1 — `pensmith compile` refuses on bad citations
expected: compile refuses on any section with FABRICATED / MIS-CITED / quote NOT_FOUND, naming the offending section + citation, and writes NO .paper/DRAFT.md.
result: pass
note: "compile.ts:276-279 collects refuse reasons (section + citekey) for all three verdicts; the refuse early-return (compile.ts:307-315) precedes concat/smoothing/write. The sole .paper/DRAFT.md write (compile.ts:416) is structurally unreachable when refuseReasons is non-empty. tests/compile-refuse.test.ts (4 tests) prove refuse + no-DRAFT-write. Verifier confirmed refuse-gate is structurally unbypassable — the load-bearing non-negotiable holds."

### 3. SC#2 — Cross-section smoothing is read-only on section files
expected: smoothing writes only to .paper/DRAFT.md and never modifies sections/<N>/DRAFT.md (verified by mtime + content-hash).
result: pass
note: "Only project-level atomicWriteFile writes occur (compile.ts:416,429 → .paper/DRAFT.md + COMPILE-REPORT.md via the D-07 sole-writer chokepoint). tests/compile-order.test.ts asserts each section DRAFT.md is unchanged by mtime AND content-hash after a full compile."

### 4. SC#3 — Wave scheduler topo-sorts and respects parallelism
expected: scheduler topologically sorts sections by depends_on, respects --max-parallel (default 5) in Tier 1; Tier 2 runs the same order serially.
result: pass
note: "Kahn topological sort in scheduler.ts (computeWaves/COMP-06); runWave is Semaphore-bounded. write-orchestrator.ts:105-109 forces maxParallel=1 for Tier 2 and emits exactly one 'max-parallel ignored' WARN. tests/wave-scheduler.test.ts (topo/diamond/cycle), tests/scheduler-stateless.test.ts (ARCH-20), and tier-contract 3-section b→a/c→a parity + Tier-2 serial-WARN all GREEN."

### 5. SC#4 — Letter-suffix numbering + compile-staleness flag
expected: letter-suffix section dirs (03b-...) parse and sort correctly; inserts never renumber; verified_against_draft_hash flags compile-staleness when a section draft changes after verification.
result: pass
note: "parseSectionDirName + optional letterSuffix on sectionDir (paths.ts), lexicographic ordering proven by tests/letter-suffix-paths.test.ts. computeDraftHash + verified_against_draft_hash staleness re-verify wired in compile.ts; tests/compile-staleness.test.ts proves stale → WARN + Pass 1+3 re-verify (re-verify failure blocks). Live section insertion correctly deferred to Phase 8 per D-15 (path tolerance is the Phase 4 scope)."

### 6. SC#5 — `plan <N> --revise` / `--research` are target-section-only
expected: pensmith plan <N> --revise and plan <N> --research <query> modify only the target section's PLAN.md / RESEARCH additions with no cross-section disturbance.
result: pass
note: "Both surfaces route to a single runRevise chokepoint (D-06); bin/cli/revise.ts and plan --revise delegate to it. tests/revise-swap.test.ts asserts sibling section content + mtime are unchanged. DEVIATION ACCEPTED: 'revise' is intentionally NOT a 17th verb — the dispatcher is locked at exactly 16 verbs (verbs.ts:15-32, tests/cli-verbs.test.ts) and workflows/*.md must stay 16-bijective (tests/workflows-keyequal.test.ts). SC#5's own wording is `pensmith plan <N> --revise`, which is exactly what ships. Locked invariants preserved; gate GREEN."

## Summary

total: 6
passed: 6
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none — all 5 ROADMAP success criteria PASS with file:line + passing-test evidence; see 04-VERIFICATION.md for the full goal-backward report]
