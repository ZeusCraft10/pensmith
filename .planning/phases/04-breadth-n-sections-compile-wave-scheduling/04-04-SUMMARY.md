---
phase: 04-breadth-n-sections-compile-wave-scheduling
plan: "04"
subsystem: revise-mutation
tags: [revise, citation-swap, approval-gate, research-log, wrte-02, d-06, d-09, tier-contract]
dependency_graph:
  requires: ["04-01", "04-02", "04-03"]
  provides: ["bin/lib/revise.ts::runRevise", "bin/cli/revise.ts::reviseCommand", "workflows/revise.md", "templates/prompts/revise-swap.md"]
  affects: ["bin/pensmith.ts", "bin/lib/prompt-loader.ts", "bin/lib/verbs.ts", "tests/tier-contract.test.ts"]
tech_stack:
  added: []
  patterns: ["sentinel-then-real prompt hash (WN-3)", "excerpt-based disambiguation for remove/swap actions", "approval-gate default-on (PRD §19)", "yolo retry cap (D-06)", "cross-section isolation for --research (D-09)"]
key_files:
  created:
    - bin/lib/revise.ts
    - bin/cli/revise.ts
    - workflows/revise.md
    - templates/prompts/revise-swap.md
    - tests/revise-swap.test.ts
    - tests/cassettes/revise-swap-suggest.json
    - tests/cassettes/revise-swap-remove.json
    - tests/cassettes/revise-swap-rejected.json
  modified:
    - bin/lib/prompt-loader.ts
    - bin/lib/verbs.ts
    - bin/pensmith.ts
    - scripts/validate-plugin-manifest.cjs
    - tests/repo-files.test.ts
    - tests/tier-contract.test.ts
    - tests/cli-verbs.test.ts
    - tests/workflows-keyequal.test.ts
decisions:
  - "revise added to UX02_VERBS (17 total) — plan stated it was in locked 16 but it was absent; Rule 1 auto-fix to add it"
  - "normalizeExcerpt() strips leading/trailing ... from LLM-produced excerpts for reliable before_excerpt matching"
  - "applyRemoveAction handles compound/sole/duplicate cases using excerpt-based disambiguation"
  - "tier-contract revise case uses --research path (no LLM) for CI-safe stub; full yolo parity deferred to Plan 05 Task 4"
  - "PENDING_HASH_PINS sentinel loop updated to skip hash comparison for __PENDING_HASH_<slug>__ entries during Task 1"
metrics:
  duration: "~35 minutes"
  completed_date: "2026-05-31"
  tasks_completed: 3
  files_created: 8
  files_modified: 8
---

# Phase 4 Plan 4: Revise — Citation Swap + Research Log Summary

Single revise chokepoint (WRTE-02, D-06): `pensmith revise --section N` swaps a FABRICATED/MIS-CITED/NOT_FOUND citation via a hash-pinned LLM prompt, behind a default-on approval gate, and resets `verified_against_draft_hash` to null. `--research` appends section-scoped provenance without cross-section disturbance.

## What Was Built

### Task 1: Wave 0 — Prompt + RED Tests + Cassettes (commit d8effb1)

- `templates/prompts/revise-swap.md`: 4 hard constraints + strict-JSON schema with `action`, `flagged_citekey`, `replacement_citekey`, `rationale`, `patch` (before/after excerpts for disambiguation).
- `bin/lib/prompt-loader.ts`: `revise-swap` entry added with `__PENDING_HASH_revise-swap__` sentinel. Header comment updated noting Phase-4 D-05/D-12 authorize `revise-swap` + `smoother` slugs.
- `tests/repo-files.test.ts`: matching sentinel pin in `PENDING_HASH_PINS`; test loop updated to skip hash comparison for sentinel entries during Task 1 period (WN-3 lockstep).
- Three cassettes (`revise-swap-suggest.json`, `revise-swap-remove.json`, `revise-swap-rejected.json`) in `tests/cassettes/`.
- `tests/revise-swap.test.ts` (RED): 8 cases covering accept+reset, reject no-op, RETRY_EXHAUSTED, --research cross-section isolation, REMOVE-ACTION edge cases (compound/sole/duplicate), injection mitigation.

### Task 2: `bin/lib/revise.ts` Chokepoint — GREEN (commit 3c117f6)

- `runRevise(opts: ReviseOptions): Promise<ReviseResult>` — single chokepoint for both tiers (D-06).
- Flow: parse VERIFICATION.md first failure → load PLAN.md (assigned_sources + voice hint) → call LLM → zod validation + membership check (T-04-14) → approval gate (T-04-15) → patch DRAFT.md atomically → reset hash via `updateFrontmatter/withLock`.
- `applySwapAction`: uses `replaceCitekeys` from `bin/lib/citation-token.ts` (Plan 01) as fallback after excerpt-based disambiguation; strips leading/trailing `...` from LLM excerpts.
- `applyRemoveAction`: mechanically deletes bracket clause — compound (`[@a; @b]` → `[@b]`), sole (`[@a]` → stripped), duplicate (disambiguated by `patch.before_excerpt`). No second LLM call for remove.
- `runResearch`: appends only to `.paper/RESEARCH.md` and `sections/<N>/RESEARCH-LOG.md` (T-04-17 / D-09 cross-section isolation).
- `--yolo` retry cap = 2, then RETRY_EXHAUSTED to VERIFICATION.md (T-04-16 / D-06).
- Test-only injection points: `_llmResponseOverride`, `_forceReject`, `_maxRetries`, `_skipLlmRevise`, `_throwOnInvalidResponse`.
- All 8 tests GREEN.

### Task 3: verb + workflow + re-pin + tier-contract (commit 271f12f)

- `bin/cli/revise.ts`: thin citty orchestrator; delegates 100% to `runRevise`; no business logic.
- `workflows/revise.md`: `<capability_check>` with AskUserQuestion → clack degrade + exit-3 for non-TTY; 9-step body covering D-06 chokepoint, REMOVE precision, --research D-09 isolation.
- `revise` added to `UX02_VERBS` (17 verbs total — deviation from plan's "locked 16" claim; `revise` was absent from the actual list).
- `bin/pensmith.ts` `REAL_VERB_LOADERS`: `revise` loader registered.
- `templates/prompts/revise-swap.md` real SHA-256 pinned in both `bin/lib/prompt-loader.ts` and `tests/repo-files.test.ts` (WN-3 lockstep). Hash: `4ff0104f8e84f88c23c9560391f21d69e5d3f67588c14a9a3dffe8b80313df22`.
- `tests/tier-contract.test.ts`: `revise` entry in `PHASE_3_CASES` (D-24 obligation satisfied in this plan). Stub case uses `--research` path (CI-safe, no LLM) with `RESEARCH-LOG.md` as expectedArtifact.
- `scripts/validate-plugin-manifest.cjs`: updated hardcoded 16→17 + fallback list.
- `tests/cli-verbs.test.ts` + `tests/workflows-keyequal.test.ts`: verb count updated.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `revise` not in UX02_VERBS despite plan claim**
- **Found during:** Task 3 (build error: `revise` not in `Ux02Verb` type)
- **Issue:** Plan stated "`revise` is in the locked 16" but the actual `bin/lib/verbs.ts` array had only 16 verbs without `revise`. Adding to REAL_VERB_LOADERS alone would cause a TypeScript type error.
- **Fix:** Added `revise` to `UX02_VERBS` (now 17), updated all derivative assertions (cli-verbs test count, workflows-keyequal test name, validate-plugin-manifest.cjs hardcoded count + fallback list).
- **Files modified:** `bin/lib/verbs.ts`, `tests/cli-verbs.test.ts`, `tests/workflows-keyequal.test.ts`, `scripts/validate-plugin-manifest.cjs`
- **Commit:** 271f12f

**2. [Rule 1 - Bug] `normalizeExcerpt()` needed to strip `...` from LLM excerpts**
- **Found during:** Task 2 test run (Test 1: swap accept case failed)
- **Issue:** The cassette `revise-swap-suggest.json` uses `...` prefix/suffix (`...supporting evidence [@jones2020] in the context...`) which is standard LLM convention but didn't match the literal draft content.
- **Fix:** Added `normalizeExcerpt()` helper to strip leading/trailing `...` before matching in both `applySwapAction` and `applyRemoveAction`.
- **Files modified:** `bin/lib/revise.ts`
- **Commit:** 3c117f6

**3. [Rule 2 - Missing critical functionality] PENDING_HASH_PINS sentinel skip logic**
- **Found during:** Task 1 (testing repo-files.test.ts with sentinel in PENDING_HASH_PINS)
- **Issue:** The existing hash-pin loop would fail for the sentinel entry since `__PENDING_HASH_revise-swap__` is not a valid SHA-256.
- **Fix:** Added sentinel-skip logic in the PENDING_HASH_PINS test loop (mirrors the existing sentinel bypass in `loadPrompt`).
- **Files modified:** `tests/repo-files.test.ts`
- **Commit:** d8effb1

## Threat Flags

All threat mitigations from `<threat_model>` are implemented:
- T-04-14: zod strict schema + `assigned_sources` membership check on `replacement_citekey` → injection test in tests/revise-swap.test.ts.
- T-04-15: approval gate default-on; `_forceReject` test case + non-TTY exit-3 documented in workflow.
- T-04-16: retry cap = 2 in `runRevise`; RETRY_EXHAUSTED test case.
- T-04-17: `runResearch` writes only to `.paper/RESEARCH.md` + `sections/<N>/RESEARCH-LOG.md`; sibling mtime test.
- T-04-18: `revise-swap.md` hash-pinned; sentinel → real re-pin in Task 3 (WN-3).
- T-04-SC: cassettes git-committed, scrubbed (no auth headers), ≤3KB each.

## Self-Check

- [x] `bin/lib/revise.ts` exists
- [x] `bin/cli/revise.ts` exists
- [x] `workflows/revise.md` exists
- [x] `templates/prompts/revise-swap.md` exists
- [x] `tests/revise-swap.test.ts` exists (8 tests green)
- [x] `tests/cassettes/revise-swap-suggest.json` exists
- [x] `tests/cassettes/revise-swap-remove.json` exists
- [x] `tests/cassettes/revise-swap-rejected.json` exists
- [x] Task 1 commit: d8effb1
- [x] Task 2 commit: 3c117f6
- [x] Task 3 commit: 271f12f
- [x] 589/589 tests pass; build + lint + typecheck clean

## Self-Check: PASSED
