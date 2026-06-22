---
phase: 02-tier-shells-doctor-tier-contract-gate
plan: "00"
subsystem: retry-helpers, http-client, doctor-reference, wave0-scaffolding
tags: [retry, http, parseRetryAfter, citty, doctor-output, wave0, D-01, D-14, D-18, ARCH-13]
dependency_graph:
  requires: []
  provides:
    - bin/lib/retry.ts::parseRetryAfter
    - references/doctor-output.md (locked D-18 copy, sha256-pinned)
    - hooks/.gitkeep (wave0 placeholder)
    - citty@^0.2.2 in dependencies
  affects:
    - bin/lib/http.ts (429/503 Retry-After honored)
    - tests/repo-files.test.ts (4 new Wave-0 artifact assertions)
tech_stack:
  added:
    - citty@^0.2.2 (CLI dispatcher — wave 2 bin/cli/pensmith.ts)
    - "@clack/prompts@^0.7 (already present — confirmed)"
  patterns:
    - RFC 7231 §7.1.3 Retry-After parsing (delta-seconds + HTTP-date)
    - SHA-256 hash-pin sentinel pattern for locked-copy reference files
    - serverRetryDelay closure pattern for Retry-After inside retry()
key_files:
  created:
    - references/doctor-output.md
    - hooks/.gitkeep
  modified:
    - bin/lib/retry.ts (parseRetryAfter added)
    - tests/retry.test.ts (9 parseRetryAfter test cases)
    - bin/lib/http.ts (parseRetryAfter wired to 429/503 retry path)
    - tests/http.test.ts (3 Retry-After cassette tests)
    - package.json (citty@^0.2.2 added)
    - tests/repo-files.test.ts (existence loop + citty dep + hash-pin + content sentinel)
decisions:
  - "parseRetryAfter is a pure export in retry.ts (not inlined in http.ts) — matches fullJitterDelayMs shape; independently testable"
  - "serverRetryDelay closure inside wrapped fn — cleanest pattern given retry() fixed-base signature; no change to maxAttempts/baseMs/capMs (T-02-00-02)"
  - "SHA-256 hash-pin (not substring match) for doctor-output.md — substring match silently allows inserted lines per plan rationale"
  - "DOCT-05/wiring-smoke absent from doctor-output.md per D-04 — Phase 3 deferral enforced by anti-drift test"
  - "@clack/prompts was already in dependencies before this plan — citty was the missing dep"
metrics:
  duration: ~12 minutes
  completed: "2026-05-16T09:38:00Z"
  tasks_completed: 3
  files_modified: 8
---

# Phase 2 Plan 00: Review Cleanup Summary

**One-liner:** parseRetryAfter RFC 7231 pure helper in retry.ts wired to http.ts 429/503 retry path via serverRetryDelay closure; citty@^0.2.2 dep installed; references/doctor-output.md locked DOCT copy SHA-256 pinned; hooks/.gitkeep Wave-0 placeholder created.

## What Was Built

### Task 1: parseRetryAfter() — pure helper (D-01, TDD)

Added `parseRetryAfter(headerValue: string | undefined, now: number): number` to `bin/lib/retry.ts` immediately after `fullJitterDelayMs`. The function:
- Handles RFC 7231 §7.1.3 delta-seconds form (e.g. "120" → 120_000ms)
- Handles HTTP-date form (e.g. "Wed, 21 Oct 2026 07:28:00 GMT")
- Never throws — invalid/undefined/empty/past/negative input collapses to 0
- 9 unit tests cover all edge cases in tests/retry.test.ts

Commit: `8d5ac8e`

### Task 2: Wire parseRetryAfter to http.ts (ARCH-13, TDD)

Modified the retry block in `bin/lib/http.ts` to use a `wrapped` function with a `serverRetryDelay` closure variable. On a retryable response (429/503), `parseRetryAfter` is called with the `retry-after` header. Before the next dispatch attempt, if `serverRetryDelay > 0`, the wrapped function sleeps for that duration.

3 new tests in tests/http.test.ts:
- 429 + retry-after:1 → elapsed >= 900ms (timing assertion)
- 429 without retry-after → normal jitter behavior (regression guard)
- 503 + retry-after:0 → fires immediately (no extra wait)

Commit: `deff862`

### Task 3: citty dep + doctor-output.md + hooks/.gitkeep + repo-files assertions

- `package.json`: added `"citty": "^0.2.2"` to dependencies; `npm install` populated `node_modules/citty/`
- `references/doctor-output.md`: created locked TTY copy per D-18 (DOCT-01..04, DOCT-07, DOCT-02 ecosystem probes); DOCT-05/wiring-smoke absent per D-04 deferral
- `hooks/.gitkeep`: empty placeholder created; Wave-0 directory tracked for 02-06 hook scaffolding
- `tests/repo-files.test.ts`: extended with:
  - doctor-output.md + hooks/.gitkeep in file existence loop
  - citty dep assertion in package.json contract test
  - SHA-256 hash-pin test for doctor-output.md (PINNED = `e1a00959050c56b18cc97804ab226577cbb26af9582b22717b21cb9a48386060`)
  - Content sentinel: 7 probe section anchors + DOCT-05/wiring-smoke anti-drift assertion

Commit: `e651435`

## Deviations from Plan

### Auto-noted

**1. [Observation] @clack/prompts already in dependencies**
- **Found during:** Task 3 read of package.json
- **Issue:** The plan mentions adding `@clack/prompts@^0.7` but it was already present in package.json dependencies before this plan ran
- **Action:** No change needed — confirmed already present; only citty was added
- **Impact:** Zero — package.json contract test passes

No other deviations — plan executed exactly as written.

## Verification Results

All acceptance criteria met:
- `grep -c "export function parseRetryAfter" bin/lib/retry.ts` → 1
- `grep -c "parseRetryAfter" tests/retry.test.ts` → 13 (9 test cases + imports + descriptions)
- `node scripts/run-tests.mjs tests/retry.test.ts` → 235 pass, 0 fail
- `grep -c "parseRetryAfter" bin/lib/http.ts` → 2 (import + call site)
- `node scripts/run-tests.mjs tests/http.test.ts` → all pass
- `grep -c "\"citty\":" package.json` → 1
- `grep -c "\"@clack/prompts\":" package.json` → 1
- `node_modules/citty/package.json` → exists
- `node_modules/@clack/prompts/package.json` → exists
- `references/doctor-output.md` → exists, DOCT-01..04,07 + ecosystem present
- `grep -c "DOCT-05\|wiring-smoke" references/doctor-output.md` → 0
- `hooks/.gitkeep` → exists
- `grep -c "references/doctor-output.md" tests/repo-files.test.ts` → 8
- `grep -c "createHash\|sha256" tests/repo-files.test.ts` → 3
- `npm run lint && npm run typecheck` → both exit 0
- Full suite: 240 tests, 0 failures

## Threat Flags

No new threat surface beyond what was identified in the plan's threat model. All STRIDE dispositions applied:
- T-02-00-01 (parseRetryAfter input tampering): mitigated — never throws, invalid collapses to 0
- T-02-00-02 (malicious Retry-After: large value): mitigated — retry() maxAttempts=5 + capMs=30_000 unchanged
- T-02-00-03 (doctor-output.md secrets): accepted — no env-var values, hash-pinned
- T-02-00-04 (citty supply chain): accepted — package-lock.json reproducibility
- T-02-00-05 (clock skew past HTTP-date): mitigated — clamps to 0 (Test 8 in retry.test.ts)

## Self-Check: PASSED

All files present:
- bin/lib/retry.ts: FOUND
- bin/lib/http.ts: FOUND
- references/doctor-output.md: FOUND
- hooks/.gitkeep: FOUND
- tests/repo-files.test.ts: FOUND
- 02-00-review-cleanup-SUMMARY.md: FOUND

All task commits present:
- 8d5ac8e: feat(02-00): add parseRetryAfter() pure helper to retry.ts (D-01)
- deff862: feat(02-00): wire parseRetryAfter to http.ts 429/503 retry path (ARCH-13)
- e651435: feat(02-00): add citty dep + doctor-output.md + hooks placeholder + repo-files tests

Full test suite: 240 tests, 0 failures.
