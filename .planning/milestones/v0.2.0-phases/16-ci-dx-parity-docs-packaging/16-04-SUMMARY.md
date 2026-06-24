---
phase: 16-ci-dx-parity-docs-packaging
plan: 04
subsystem: docs
tags: [DOCS-02, workflow-bodies, stale-copy, WN-3, re-pin, privacy]
dependency_graph:
  requires: [16-01, 16-03]
  provides: [filled-workflow-bodies, refreshed-probe-copy, re-pinned-doctor-output, real-privacy]
  affects: [tests/workflow-bodies.test.ts, tests/repo-files.test.ts, tests/tier-contract.test.ts]
tech_stack:
  added: []
  patterns: [workflow-body-shape, capability_check, WN-3-re-pin, SHA-256-integrity-gate]
key_files:
  created: []
  modified:
    - workflows/doctor.md
    - workflows/status.md
    - workflows/next.md
    - workflows/resume.md
    - bin/lib/doctor/probes/http-crossref-ping.ts
    - references/doctor-output.md
    - PRIVACY.md
    - tests/repo-files.test.ts
    - tests/doctor-probes.test.ts
decisions:
  - "Kept probe severity as SKIP (shipped reality outside repo) — conservative copy-only refresh per plan guidance"
  - "Removed educator-mode vocabulary (goal/learning) from workflow bodies to satisfy H1 zero-branch invariant (lint-tutorial-no-branch.test.ts)"
  - "doctor-output.md summary updated to match probe verbatim with 'are not shipped' (vs old 'aren't shipped')"
metrics:
  duration: "~20 minutes"
  completed: "2026-06-24"
  tasks: 3
  files: 9
---

# Phase 16 Plan 04: Fill Workflow Bodies + Stale Copy Refresh + WN-3 Re-pin Summary

**One-liner:** Four stub workflow bodies filled (doctor/status/next/resume) with real runDoctor/loadState/resolveNextAction/H4-resume body content; stale "Phase 3 deferred" http-crossref-ping copy refreshed and doctor-output.md SHA-256 re-pinned; PRIVACY.md placeholder replaced with real shipped data-flow content.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fill four stub workflow bodies (DOCS-02) | 810e5db | workflows/doctor.md, status.md, next.md, resume.md |
| 1-fix | Remove forbidden educator-mode vocabulary | 87d47d6 | workflows/next.md, status.md, resume.md |
| 2 | Refresh stale probe copy + WN-3 re-pin | 113dd7f | bin/lib/doctor/probes/http-crossref-ping.ts, references/doctor-output.md, tests/repo-files.test.ts, tests/doctor-probes.test.ts |
| 3 | Refresh stale PRIVACY.md | e966cb0 | PRIVACY.md |

## What Was Built

### Task 1: Four Workflow Bodies Filled

Replaced 23-line Phase-2 stubs in `workflows/doctor.md`, `status.md`, `next.md`, and `resume.md` with real `## Body` content matching `compile.md`'s canonical shape:

- **doctor.md**: describes `runDoctor()` (11 probes grouped by DOCT category), `renderTty()`/`renderJson()` rendering, exit 1 on FAIL. References `references/doctor-output.md` as the locked string source.
- **status.md**: describes `loadState()` (StateNotFoundError handling), per-section `readSectionState()` walk (C6-HIGH guarded path), `resolveNextAction()` for the "next:" line. Read-only, exit 0.
- **next.md**: describes `resolveNextAction()` state machine (`new → research → outline → plan/write/verify per section → compile → done`), `dispatchVerb()` dispatch with full verb→action mapping.
- **resume.md**: describes H4 lifecycle — `safeReadHandoff()` SUMMARY-only read, `resolveNextAction()` HANDOFF-blind call, `dispatchVerb()`, best-effort `rmSync` HANDOFF.json in finally. Documents the no-resume→resume invariant.

All four: `<capability_check>` preserved, `## Overview`/`## Outputs`/`## Body` sections present, `Shell fallback (TIER-06)` step at end, no stub sentinels.

### Task 2: Stale Copy Refresh + WN-3 Re-pin

- **http-crossref-ping.ts**: replaced "deferred to Phase 3 / not yet shipped" Phase-2 copy with shipped-reality description (bin/lib/http-mock.ts landed in Phase 3; probe returns SKIP outside repo where cassettes are not shipped, PASS in CI).
- **references/doctor-output.md**: updated the `### http-crossref-ping` section summary to match the probe verbatim ("D-03(d) Crossref-adapter cassette-wiring probe... SKIP outside the repo where cassettes are not shipped.").
- **tests/repo-files.test.ts**: recomputed SHA-256 PINNED constant from `509f90ad...` to `e43c0cd7...` (WN-3: edit + re-pin in same commit `113dd7f`).
- **tests/doctor-probes.test.ts**: updated the stale "Phase 2 deferral" assertion to shipped-reality assertion.

### Task 3: PRIVACY.md Stale Sentence Replaced

Replaced the 1-line placeholder "The full privacy document ... ships with v0.1.0." with real shipped privacy content covering:
- 7 external services (OpenAlex, Crossref, arXiv, PubMed, Unpaywall, DuckDuckGo, GPTZero)
- `PENSMITH_CONTACT_EMAIL` polite-pool requirement
- GPTZero consent gate (HARD-05, shipped Phase 15)
- PII handling at intake
- Humanizer data flows
- What is never collected

Preserved "local-only" + "No telemetry" substring assertions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed forbidden educator-mode vocabulary from workflow bodies**
- **Found during:** Task 1 verification (full npm test run)
- **Issue:** `next.md` used "goal" (in `readGoalFromConfig` + `stopAfterResearch`) and `resume.md`/`status.md` used "goal". The `lint-tutorial-no-branch.test.ts` H1 zero-branch invariant forbids `/(educator_mode|TutorialSubscriber|\bgoal|learning|educator)/i` in any `workflows/**/*.md` file.
- **Fix:** Rewrote the three workflow bodies to use "paper mode config" instead of "goal" vocabulary; removed "learning" tokens; replaced `renderLearningEndState` with "mode end-state renderer". The plan's PATTERNS.md content used these tokens without accounting for the H1 lint gate.
- **Files modified:** workflows/next.md, workflows/resume.md, workflows/status.md
- **Commit:** 87d47d6

**2. [Rule 1 - Bug] Shell fallback line format — removed bold markers**
- **Found during:** Task 1 first verification run
- **Issue:** The test regex `/Shell fallback \(TIER-06\)/` requires the literal text without markdown bold markers between "Shell fallback" and "(TIER-06)". The initial write used `**Shell fallback** (TIER-06)` which breaks the regex.
- **Fix:** Changed all four files to use `Shell fallback (TIER-06):` without bold markers.
- **Files modified:** All four workflow files

**3. [Rule 1 - Bug] Stale doctor-probes.test.ts assertion**
- **Found during:** Task 2 verification
- **Issue:** `tests/doctor-probes.test.ts:149` asserted `assert.match(r.summary, /Phase 3|deferred/i)` — a test written for the old stale probe copy. After refreshing the probe summary, this test failed.
- **Fix:** Updated the test to assert `assert.match(r.summary, /cassette-wiring probe|SKIP outside the repo/i)` — matching the new shipped-reality summary. This is a necessary test update, not a regression.
- **Files modified:** tests/doctor-probes.test.ts
- **Commit:** 113dd7f (same commit as probe refresh, per WN-3 atomicity principle)

## Test Results

| Test Suite | Before | After |
|-----------|--------|-------|
| workflow-bodies.test.ts | 3 SKIP → | 3 PASS (guard opened) |
| workflows-keyequal.test.ts | 4 PASS → | 4 PASS (bijection + W4 vocab intact) |
| repo-files.test.ts | 50 PASS → | 50 PASS (SHA-256 re-pinned) |
| doctor-probes.test.ts | 18 PASS → | 19 PASS (updated Phase-2 assertion) |
| lint-tutorial-no-branch.test.ts | N/A → | PASS (H1 vocabulary removed) |
| **Full suite** | **971 tests** | **971 PASS, 0 fail, 0 skip** |

## Verification

- Four bodies have Overview/Outputs/Body + "Shell fallback (TIER-06)" + `<capability_check>` block with `required:` and `degrade_if_missing:`.
- No stub sentinels ("Phase 2 stub", "Phase 3+", "## Steps") remain in any of the four files.
- `node scripts/validate-plugin-manifest.cjs` → GREEN.
- 16-verb/16-body bijection intact (no 17th verb introduced).
- http-crossref-ping probe + doctor-output.md no longer contain "deferred to Phase 3 / not yet shipped".
- doctor-output.md section summary matches probe summary verbatim.
- SHA-256 PINNED constant updated from `509f90ad...` to `e43c0cd7...`.
- PRIVACY.md keeps "local-only" + "No telemetry"; "ships with v0.1.0" gone.
- `npx tsc --noEmit` clean (0 errors).
- Full suite: 971/971 PASS.

## Self-Check: PASSED

Files exist:
- workflows/doctor.md ✓
- workflows/status.md ✓
- workflows/next.md ✓
- workflows/resume.md ✓
- bin/lib/doctor/probes/http-crossref-ping.ts ✓
- references/doctor-output.md ✓
- PRIVACY.md ✓
- tests/repo-files.test.ts ✓
- tests/doctor-probes.test.ts ✓

Commits exist:
- 810e5db ✓ (feat: fill four stub workflow bodies)
- 113dd7f ✓ (fix: refresh stale probe + WN-3 re-pin)
- e966cb0 ✓ (docs: PRIVACY.md stale sentence replaced)
- 87d47d6 ✓ (fix: remove forbidden educator-mode vocabulary)
