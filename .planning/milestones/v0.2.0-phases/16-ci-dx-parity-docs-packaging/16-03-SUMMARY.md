---
phase: 16-ci-dx-parity-docs-packaging
plan: "03"
subsystem: docs
tags: [docs, readme, disclaimer, intake, disclosure, DOCS-01]
dependency_graph:
  requires: [16-02]
  provides: [real-README, §3-disclaimer-at-intake, §18-GSD-credit]
  affects: [README.md, bin/cli/intake.ts, workflows/new.md, tests/repo-files.test.ts]
tech_stack:
  added: []
  patterns: [process.stdout.write, verbatim-PRD-copy, substring-assert]
key_files:
  created: []
  modified:
    - README.md
    - bin/cli/intake.ts
    - workflows/new.md
    - tests/repo-files.test.ts
decisions:
  - "DISCLAIMER constant split across two array elements was consolidated so 'not a guarantee against AI detectors' appears on a single source line — required by plan verification regex that greps source, not the runtime-joined string"
metrics:
  duration_seconds: 369
  completed: "2026-06-24T09:49:28Z"
  tasks_completed: 2
  files_changed: 4
---

# Phase 16 Plan 03: DOCS-01 Real README + §3 Intake Disclaimer — Summary

Real user-facing README with PRD §3 disclaimer (verbatim), §18 GSD credit (verbatim), `/pensmith`-only quickstart, 16-verb power-user table, preserved `## Style Match` section; PRD §3 disclaimer also printed at intake via `process.stdout.write` before any prompt.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Rewrite README.md + remove stale test assertions | `1d5eca3` | README.md, tests/repo-files.test.ts |
| 2 | Print §3 disclaimer at intake + document in new.md | `8ea7ec7` | bin/cli/intake.ts, workflows/new.md |

## What Was Built

### Task 1 — README rewrite (atomic with test update)

Replaced the 19-line stub README with the locked-order real README:

1. Title + one-paragraph what-it-is
2. Install — both tiers (Claude Code plugin + `npm install -g pensmith` / `npx pensmith`)
3. Quick start — `/pensmith` ONLY (single-command UX non-negotiable)
4. 16-verb power-user reference table (sourced from `bin/lib/verbs.ts` UX02_VERBS)
5. GSD credit — PRD §18 verbatim (opens "pensmith is heavily inspired by [Get Shit Done]...")
6. `## Style Match` — preserved byte-for-byte from the original stub (STYL-04 asserts presence)
7. Disclaimer — PRD §3 verbatim (both paragraphs, incl. "not a guarantee against AI detectors")

In the SAME commit (`1d5eca3`), `tests/repo-files.test.ts` was updated:
- Deleted stale assertions at lines 96-97 (`/v0\.1\.0 in development/` and `/Phase 6/`)
- Added real-content assertions: §3 opener, honest-framing sentence, GSD credit
- Renamed test from "stubs are correct" to "PRIVACY and README-DEV structure checks (README stubs removed — Phase 16 DOCS-01)"

### Task 2 — §3 disclaimer at intake

Inserted a static `DISCLAIMER` constant in `bin/cli/intake.ts` run() immediately after `const cwd = process.cwd()`, before any `ask()` or model call. Written via `process.stdout.write(DISCLAIMER + '\n\n')` per repo convention (never `console.log`).

Inserted new Body step 1 in `workflows/new.md` documenting the disclaimer print; renumbered subsequent steps 2–7. The `<capability_check>` block (required + degrade_if_missing) is preserved intact.

## Verification Results

- `node --import tsx --test tests/repo-files.test.ts` — 50/50 PASS (includes STYL-04 positive + negative asserts)
- `npx tsc --noEmit` — CLEAN (no errors)
- `node --import tsx --test tests/workflows-keyequal.test.ts` — 4/4 PASS (ARCH-01/ARCH-03 bijection)
- `npm run lint` — 0 errors (1 pre-existing warning in coverage/lcov-report, not in this plan's scope)
- `npm test` (full suite) — 968 pass, 0 fail, 3 skipped (all 971 tests)
- `git status --porcelain` — EMPTY (CI-02 gate passes)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] DISCLAIMER array literal split "not a guarantee against AI detectors" across two elements**
- **Found during:** Task 2 verification (plan's `node -e` script greps source file for the phrase)
- **Issue:** The array was split as `'...It is not a guarantee against AI'` / `'detectors and...'`, so the phrase `not a guarantee against AI detectors` did not appear on a single source line, causing the plan's verification regex to fail
- **Fix:** Consolidated into a single array element: `'This tool is for your own writing, research, and learning. It is not a guarantee against AI detectors'`
- **Files modified:** bin/cli/intake.ts
- **Commit:** `8ea7ec7` (same task commit)

## Known Stubs

None — all four DOCS-01 required surfaces are wired with real content.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced. The §3 disclaimer is a static stdout print.

## Self-Check

- [x] README.md exists and contains: §3 opener, honest-framing sentence, GSD credit, `## Style Match`, `/pensmith` quickstart
- [x] tests/repo-files.test.ts: stale assertions removed, real assertions added
- [x] bin/cli/intake.ts: DISCLAIMER constant with "not a guarantee against AI detectors" present, written via process.stdout.write
- [x] workflows/new.md: Body step 1 documents disclaimer print; capability_check preserved
- [x] Commits 1d5eca3 and 8ea7ec7 exist in git log

## Self-Check: PASSED
