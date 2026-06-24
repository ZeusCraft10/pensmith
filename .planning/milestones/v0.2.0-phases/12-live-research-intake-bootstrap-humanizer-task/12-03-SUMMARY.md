---
phase: 12-live-research-intake-bootstrap-humanizer-task
plan: "03"
subsystem: intake-state-bootstrap
tags: [gen-04, state, intake, idempotency, bootstrap]
dependency_graph:
  requires: [12-01]
  provides: [initState-wired-in-intake, STATE.json-at-intake, paperId-non-null]
  affects: [global-library-registration, style-match-producer, resolvePaperId]
tech_stack:
  added: []
  patterns: [idempotent-try-catch-by-code, fail-loud-rethrow]
key_files:
  modified:
    - bin/cli/intake.ts
decisions:
  - "Called initState(cwd) not initState(paperDir(cwd)): resolvePaperId(cwd) calls loadState(cwd) which reads <cwd>/STATE.json — both read and write paths must use the same root (cwd), not paperDir(cwd)"
  - "Removed StateAlreadyExistsError from imports: error identity checked via .code property (matches plan catch pattern), removing unused import avoids lint @typescript-eslint/no-unused-vars"
metrics:
  duration: "~5 minutes"
  completed: "2026-06-22"
  tasks_completed: 1
  files_modified: 1
---

# Phase 12 Plan 03: GEN-04 intake STATE.json bootstrap Summary

Bootstrap STATE.json at intake with idempotent `initState(cwd)` call so `resolvePaperId()` returns a non-null UUID and global-library registration plus style-match producer proceed instead of WARN-skipping.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add idempotent initState() bootstrap to intake.ts | e2487ee | bin/cli/intake.ts |

## What Was Built

Added a 14-line change to `bin/cli/intake.ts`:

1. Extended the `import ... from '../lib/state.js'` to add `initState` alongside the existing `loadState`.
2. Inserted an idempotent `try { await initState(cwd); } catch (e) { if (e.code !== 'STATE_ALREADY_EXISTS') throw e; }` block in the `run()` body — placed AFTER `complete()` returns `result.text` and BEFORE `atomicWriteFile(targetPath, result.text)` and `runSideEffects()`.

After this call, `resolvePaperId(cwd)` (called inside `runSideEffects()`) finds STATE.json at `<cwd>/STATE.json` and returns the UUID paperId, so:
- `registerPaperNonFatal`: the `if (!paperId) { WARN; return; }` guard no longer fires → registration proceeds.
- `runStyleProducerNonFatal`: uses the real paperId (not the synthetic `unregistered:` fallback).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Called initState(cwd) instead of initState(paperDir(cwd))**
- **Found during:** Task 1 analysis
- **Issue:** The plan specified `initState(paperDir(cwd))` which would write STATE.json to `<cwd>/.paper/STATE.json`. However, `resolvePaperId(cwd)` calls `loadState(cwd)` which reads from `stateFile(cwd)` = `<cwd>/STATE.json`. The write and read paths would be misaligned — `initState(paperDir(cwd))` would write to `.paper/STATE.json` but `resolvePaperId` would look at the project root `STATE.json` and always return null.
- **Fix:** Used `initState(cwd)` to match the `loadState(cwd)` read path. The test also confirms by checking `path.join(root, 'STATE.json')` (not `path.join(root, '.paper/STATE.json')`).
- **Evidence:** `tests/state.test.ts` uses `initState(root)` with the tmpdir root directly (not `.paper` subdir). Existing `tests/intake-bootstrap.test.ts` checks `path.join(root, 'STATE.json')`.
- **Files modified:** bin/cli/intake.ts
- **Commit:** e2487ee

**2. [Rule 1 - Bug] Omitted StateAlreadyExistsError from import**
- **Found during:** Task 1 implementation
- **Issue:** The plan action said to import `StateAlreadyExistsError` alongside `initState`, but the catch pattern uses `.code` property checking not `instanceof`. Importing it without referencing it would trigger `@typescript-eslint/no-unused-vars`.
- **Fix:** Import only `initState` and `loadState`; check `.code !== 'STATE_ALREADY_EXISTS'` directly (matches the plan's catch pattern exactly).
- **Files modified:** bin/cli/intake.ts
- **Commit:** e2487ee

## Tests Flipped

| Test File | Before | After |
|-----------|--------|-------|
| tests/intake-bootstrap.test.ts | 3 SKIP, 1 PASS | 4 PASS (0 skip) |

Tests that went from SKIP → PASS:
- `intake writes .paper/STATE.json with v2 schema + non-null paperId (GEN-04)`
- `running intake twice does NOT regenerate paperId (idempotency, GEN-04)`
- `WARN-skip-guard flip — after intake writes STATE.json, global-library registration proceeds (GEN-04)`

The always-on path-sanity test (`intakeBootstrapWired() resolves correctly`) continues to PASS.

## Lint / Typecheck / Suite Status

- `npx eslint bin/cli/intake.ts` — PASS (zero errors)
- `npm run typecheck` — PASS (zero errors)
- `npm run lint` (full project) — pre-existing failures in test files written by parallel plan 12-02 (`tests/humanizer-task.test.ts`, `tests/intake-bootstrap.test.ts` env-override lines, `tests/research-discovery.test.ts`) and `tests/lint-tutorial-no-branch.test.ts` failing against `bin/lib/intake-parse.ts` (also parallel plan 12-02). None of these are caused by plan 12-03 changes — confirmed by running lint on `bin/cli/intake.ts` alone (clean) and verifying failures pre-existed before this plan's edits.
- `npm test` — 1 failure: `lint-tutorial-no-branch` failing on `bin/lib/intake-parse.ts` (plan 12-02 out-of-scope artifact). All other tests PASS.

## Self-Check: PASSED

- `bin/cli/intake.ts` exists and contains `initState(`: CONFIRMED
- Commit e2487ee exists in git log: CONFIRMED
- tests/intake-bootstrap.test.ts: 4/4 pass, 0 skip: CONFIRMED
- No unintended file deletions in commit: CONFIRMED (1 file modified, 14 insertions, 1 deletion)

## Known Stubs

None — the implementation is fully wired. `initState(cwd)` writes real STATE.json; `resolvePaperId()` reads it; registration proceeds.

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes beyond what the plan's threat model covers (T-12-07, T-12-08, T-12-09 all mitigated by the existing `initState` implementation in state.ts).
