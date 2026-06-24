---
phase: 14-fail-closed-verifier-gate
plan: "03"
subsystem: verifier
tags: [gate, retraction-watch, pass1, citation-integrity, offline-cassette]
dependency_graph:
  requires: ["14-01"]
  provides: ["GATE-03"]
  affects: ["bin/lib/verify/pass1.ts", "bin/lib/sources/retraction-watch.ts"]
tech_stack:
  added: []
  patterns:
    - "cassette-dir scan (loadCassetteDir) instead of single-file load for DOI-specific offline matching"
    - "post-Crossref retraction re-query guard (Pitfall-1 placement)"
key_files:
  created: []
  modified:
    - bin/lib/verify/pass1.ts
    - bin/lib/sources/retraction-watch.ts
decisions:
  - "Rule 3 deviation: retraction-watch.ts offline cassette loading changed from loadCassetteFile('fetchById-fake') to loadCassetteDir to find gate03-blocking-doi.json; fallback to first-any-retractions entry removed — it caused false MIS-CITED for any DOI without a direct cassette match"
  - "GATE-03 block placed after Crossref null-guard (Pitfall 1): FABRICATED citations never reach the retraction re-query"
  - "No try/catch added in pass1.ts — fetchById already catches all transport errors and returns null (retraction-watch.ts:122-126)"
metrics:
  duration: "~12 minutes"
  completed: "2026-06-24"
  tasks_completed: 1
  files_changed: 2
---

# Phase 14 Plan 03: GATE-03 Live Retraction Re-Query Summary

**One-liner:** Live Retraction Watch re-query at verify time — non-null hit on confirmed DOI → MIS-CITED (blocking); transport/no-hit → silent skip; cassette adapter fixed to use dir-scan for per-DOI matching.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Add GATE-03 live retraction re-query to verdictForCitekey | c3b618c | bin/lib/verify/pass1.ts, bin/lib/sources/retraction-watch.ts |

## What Was Built

GATE-03 closes the post-research retraction gap: a paper retracted after research-time now blocks at verify time. The implementation:

1. **`bin/lib/verify/pass1.ts`**: Added `import { fetchById as retractionWatchFetchById } from '../sources/retraction-watch.js'` (mirroring freshness.ts:27). Inserted a GATE-03 block inside `verdictForCitekey` immediately after the Crossref null-guard and before the JW comparison. A non-null `liveRetraction` → MIS-CITED with reason `"cited work appears in Retraction Watch (live re-query at verify time)[: <details>]"`. A null result (transport error or no cassette hit) is a silent skip — verdict falls through to normal JW path.

2. **`bin/lib/sources/retraction-watch.ts`** (Rule 3 deviation): Changed offline cassette loading from `loadCassetteFile('retraction-watch', 'fetchById-fake')` to `loadCassetteDir('retraction-watch')`. The single-file load never found `gate03-blocking-doi.json`. Also removed the fallback to "first any-retractions entry" — that fallback returned non-null for any DOI without a direct cassette match, causing false MIS-CITED verdicts for DOIs like `10.0000/no-gate03-cassette`. Now: direct `filter=record:<doi>` path match only; null returned when no match.

## Tests Flipped

| Test | Before | After |
|------|--------|-------|
| GATE-03: live-retracted DOI (cassette hit) → MIS-CITED (blocking) | SKIP | PASS |
| GATE-03: no-cassette DOI (transport/no-hit → fetchById null) → NOT false MIS-CITED | SKIP | PASS |
| known-bad-citations: Pass-1 flags 10/10 fixtures as MIS-CITED (stored claimed.retracted) | PASS | PASS |
| Full suite | 907 pass / 10 skip | 917 pass / 0 skip |

## Transport Error → Silent Skip (Confirmed)

Verified: `10.0000/no-gate03-cassette` with no cassette entry → `retractionWatchFetchById` returns null → GATE-03 block skipped → verdict falls through to Crossref null-guard → FABRICATED (Crossref also returns fallback, but the key point is the retraction reason does NOT appear). The `reasonMentionsLiveRetraction` assertion in test 2 confirms no false MIS-CITED from the retraction path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking Issue] retraction-watch.ts offline fallback caused false MIS-CITED for any DOI**

- **Found during:** Task 1 — implementing GATE-03 and analyzing cassette behavior
- **Issue:** `retraction-watch.ts:fetchById` in offline mode loaded only `fetchById-fake.json` via `loadCassetteFile`. When called with `10.0000/gate03-retracted`, the direct DOI path match failed (cassette has `10.0000/test`), and the fallback returned the `10.0000/test` entry (non-null) for ANY DOI without a direct match — including `10.0000/no-gate03-cassette`. This made the transport-error-silent-skip test impossible to pass without fixing the adapter.
- **Fix:** Changed to `loadCassetteDir('retraction-watch')` to scan all cassette files; removed the fallback-to-any-retractions logic. Now only a direct `filter=record:<doi>` path match returns a hit.
- **Impact:** `10.0000/test` still resolves (direct match in fetchById-fake.json); `10.0000/gate03-retracted` now resolves via gate03-blocking-doi.json; uncasseted DOIs return null.
- **Existing tests:** `retraction-watch.test.ts` line 38 (fetchById('10.0000/test')) still passes — direct match still works.
- **Files modified:** bin/lib/sources/retraction-watch.ts
- **Commit:** c3b618c

## Success Criteria Verification

- [x] A live-retracted DOI at verify time → MIS-CITED (blocking) in Pass-1 — GATE-03 test 1 PASS
- [x] A transport error / no-hit → silent skip (never a false block) — GATE-03 test 2 PASS
- [x] Stored claimed.retracted offline-fast path unchanged and still blocking — known-bad-citations PASS
- [x] Re-query placed after Crossref resolution (Pitfall 1 honored) — code review confirmed
- [x] No new network path — http.ts adapter reused via retraction-watch.ts

## Self-Check: PASSED

- [x] bin/lib/verify/pass1.ts imports retractionWatchFetchById: confirmed via grep
- [x] bin/lib/sources/retraction-watch.ts uses loadCassetteDir: confirmed
- [x] Commit c3b618c exists: confirmed via git log
- [x] All 917 tests pass: confirmed
