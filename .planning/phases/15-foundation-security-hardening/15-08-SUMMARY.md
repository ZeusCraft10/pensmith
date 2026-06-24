---
phase: 15-foundation-security-hardening
plan: "08"
subsystem: security-audit + concurrency-doc
tags: [security, documentation, semaphore, concurrency, hard-04a, hard-06]
dependency_graph:
  requires: [15-02, 15-03, 15-04, 15-05, 15-06, 15-07]
  provides: [security-audit, semaphore-bare-caller-doc]
  affects: [bin/lib/budget.ts, tests/budget.test.ts, .planning/SECURITY.md]
tech_stack:
  added: []
  patterns: [PROVEN/UNPROVEN threat audit, try/finally permit-leak doc guard, FIFO regression testing]
key_files:
  created: [.planning/SECURITY.md]
  modified: [bin/lib/budget.ts, tests/budget.test.ts]
decisions:
  - "SECURITY.md lives in .planning/ only — not repo root and not Phase 16 README/docs (out of scope)"
  - "24 threat rows: 23 PROVEN, 1 PROVEN-in-CI/UNPROVEN-live (row 2 live-DNS SSRF), 0 UNPROVEN (no test gap)"
  - "Live-DNS SSRF + live-GPTZero egress documented as manual-only with PENSMITH_NETWORK_TESTS instructions"
  - "Added two Semaphore regression tests (FIFO grant order + withLock-releases-on-throw) as the authoritative permit-leak regression — no behavior change"
metrics:
  duration: "~15 min"
  completed: "2026-06-24"
  tasks: 2
  files: 3
---

# Phase 15 Plan 08: Security Audit + Semaphore Documentation Summary

**One-liner:** 24-row PROVEN/UNPROVEN threat audit in `.planning/SECURITY.md` + Semaphore bare-caller try/finally doc + FIFO/permit-leak regression tests in `budget.test.ts`.

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Document Semaphore bare-caller try/finally + regression (HARD-06) | 42c8ea9 | `bin/lib/budget.ts`, `tests/budget.test.ts` |
| 2 | Author .planning/SECURITY.md milestone audit (HARD-04a) | e316914 | `.planning/SECURITY.md` |

---

## What Was Built

### Task 1 — HARD-06: Semaphore Documentation + Regression Tests

Extended the `Semaphore` class doc comment in `bin/lib/budget.ts` with:
- Explicit statement that `waiters.shift()` gives FIFO order (already correct, now documented)
- A clearly marked `BARE-CALLER WARNING (T-15-06b)` block showing the required `try/finally` pattern for any caller using raw `acquire()`/`release()` outside `withLock`
- Clarification that `withLock` already wraps in `try/finally` and is the recommended seam

No behavior was changed — the Semaphore was already FIFO-correct and leak-safe under `withLock`.

Added two regression tests to `tests/budget.test.ts`:
1. **FIFO grant order**: 1-slot semaphore, 3 waiters scheduled in order — asserts they complete in `[1, 2, 3]` order (HARD-06 FIFO invariant)
2. **Permit-released-on-throw**: `withLock` with a throwing `fn` — subsequent `acquire` succeeds without deadlock, proving no permit leak

All 11 budget tests pass (9 pre-existing + 2 new).

### Task 2 — HARD-04a: .planning/SECURITY.md Milestone Audit

Created `.planning/SECURITY.md` with:
- **24 threat rows** covering every significant surface identified in Phase 15
- **23 PROVEN** (enforcing test confirmed green before authoring)
- **1 PROVEN-in-CI / UNPROVEN-live** (row 2: live-DNS SSRF — injected resolver in CI, live DNS is manual)
- **2 manual-only** entries (live-DNS SSRF + live-GPTZero egress)
- **0 UNPROVEN** (no test gap remains)

Threat categories covered: SSRF, PII/key leak (nested), lock race/clobber (cross-process), prompt injection (Pass-2/4 fencing), pdf supply-chain + OOM/hang, GPTZero consent/cap/key-no-log + framing drift, zero-trace export (docx/pdf/md/tex), verifier gate fail-closed (GATE-01/03/04), prompt drift (WN-3 hash-pins), HTTP cache header leak, concurrency (TokenBucket FIFO + Semaphore permit).

Cross-references: all per-phase `<threat_model>` blocks (Plans 15-02 to 15-08) + prior-milestone chokepoint threats (T-01-06/07/08, D-26/D-40, ARCH-12/13/D-06).

---

## Deviations from Plan

None — plan executed exactly as written.

---

## Threat Summary (SECURITY.md counts)

| Category | Count |
|----------|-------|
| Total threats enumerated | 24 rows + 2 manual |
| PROVEN (CI-verified) | 23 |
| PROVEN-in-CI / UNPROVEN-live | 1 |
| UNPROVEN (no test, follow-up) | 0 |

---

## Verification Results

| Check | Result |
|-------|--------|
| `node --import tsx --test tests/budget.test.ts` | 11/11 pass |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm test` (full suite) | 954/954 pass, 0 fail |
| Task 2 grep gate (SECURITY.md + all test refs) | OK |

---

## Self-Check

### Created files exist

- `.planning/SECURITY.md`: FOUND
- `bin/lib/budget.ts`: FOUND (modified)
- `tests/budget.test.ts`: FOUND (modified)

### Commits exist

- `42c8ea9`: FOUND (Task 1 — Semaphore doc + regression)
- `e316914`: FOUND (Task 2 — SECURITY.md)

## Self-Check: PASSED
