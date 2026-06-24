---
phase: 15-foundation-security-hardening
plan: "05"
subsystem: pdf-text
tags: [security, hardening, dos-mitigation, pdf-parse, HARD-04b]
dependency_graph:
  requires: ["15-01"]
  provides: ["HARD-04b"]
  affects: ["bin/lib/pdf-text.ts"]
tech_stack:
  added: []
  patterns: ["Promise.race + clearTimeout timeout guard", "pre-parse byte-cap guard"]
key_files:
  created: []
  modified:
    - bin/lib/pdf-text.ts
decisions:
  - "50 MB byte cap (MAX_PDF_BYTES) rejects attacker-supplied oversize PDF before pdf-parse runs — eliminates OOM vector"
  - "30 s wall-clock timeout (PDF_TIMEOUT_MS) via Promise.race with clearTimeout in finally — eliminates hang vector"
  - "Both constants exported so test scaffold can probe without hard-coding values"
  - "parseWithRetry retry loop left unchanged — bounds are additive, not structural"
metrics:
  duration: "~5 minutes"
  completed: "2026-06-24"
  tasks_completed: 1
  files_modified: 1
---

# Phase 15 Plan 05: HARD-04b pdf-parse Input Bounds Summary

Closed HARD-04b: `extractPdfText` now enforces a 50 MB byte cap (rejects before parse) and a 30 s wall-clock timeout (Promise.race with timer cleared on success) so attacker-controlled or pathological PDFs cannot OOM or hang the process.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Byte cap + wall-clock timeout in extractPdfText (HARD-04b) | 28646bd | bin/lib/pdf-text.ts |

## What Was Built

Added two named exports to `bin/lib/pdf-text.ts`:

- `MAX_PDF_BYTES = 50 * 1024 * 1024` — pre-parse guard: `if (input.length > MAX_PDF_BYTES) throw new Error(...)` with a message naming cap and actual byte count (test checks for cap/limit/exceed/max/bytes/MB keyword)
- `PDF_TIMEOUT_MS = 30_000` — Promise.race wrapper around `parseWithRetry(input)` with `clearTimeout(handle)` in a `finally` block (no dangling timer on success)

The existing `parseWithRetry` retry loop (3 attempts, setImmediate between attempts) is unchanged. The happy path is identical — bounds are additive at the `extractPdfText` entry point only.

## Test Results

`tests/pdf-text-bounds.test.ts`: **5 pass, 0 fail, 0 skipped** (was 4 skipped before this plan).

Full suite: **948 pass, 0 fail, 4 skipped** (the 4 skips are RED scaffolds from parallel Wave-2 plans, not regressions).

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The implementation uses only `node:timers` built-ins (no new deps). T-15-04b (DoS via unbounded pdf-parse) is now mitigated. T-15-SC (supply-chain) remains accepted (pin enforced, bounds make malicious-input exploit non-fatal).

## Self-Check: PASSED

- `bin/lib/pdf-text.ts` exists and exports `MAX_PDF_BYTES` and `PDF_TIMEOUT_MS`
- Commit 28646bd verified: `git log --oneline -1` shows feat(15-05)
- `tests/pdf-text-bounds.test.ts`: 5 pass, 0 skipped
- Full suite: 948 pass, 0 fail
