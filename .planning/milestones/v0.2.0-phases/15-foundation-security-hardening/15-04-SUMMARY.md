---
phase: 15-foundation-security-hardening
plan: "04"
subsystem: pii-redaction
tags: [security, pii, session-log, hard-03]
requirements: [HARD-03]

dependency_graph:
  requires: ["15-01"]
  provides: ["deepRedactPii export from pii.ts", "recursive nested-PII redaction in buildRecord"]
  affects: ["bin/lib/pii.ts", "bin/lib/session-log.ts"]

tech_stack:
  added: []
  patterns:
    - "deepRedactPii mirrors walkAndRedact recursion model with combined PII + sensitive-key handling"
    - "Object.create(null) output containers for proto-pollution defense (T-15-03c)"
    - "Two-stage redaction in buildRecord: redactKeys then deepRedactPii"

key_files:
  created: []
  modified:
    - bin/lib/pii.ts
    - bin/lib/session-log.ts

decisions:
  - "deepRedactPii handles SENSITIVE keys inline (not deferred to redactKeys) so it is correct when called standalone — the test calls it directly without redactKeys in the chain"
  - "redactPii import removed from session-log.ts (unused after deepRedactPii subsumes the top-level loop)"
  - "spill-invariant preserved: writeLineOrTruncate receives the record returned by buildRecord, which has already been through both redactKeys and deepRedactPii"

metrics:
  duration: "~6 minutes"
  completed: "2026-06-24"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 15 Plan 04: HARD-03 Recursive PII Redaction Before SESSION.log — Summary

Closed HARD-03: PII strings nested at any depth under non-sensitive keys are now redacted before any SESSION.log write.

## What Was Built

**pii.ts — `deepRedactPii` export:** A new exported function that recursively walks any JSON-serializable node and applies `redactPii` to every string leaf. When recursing into a plain object it checks each key against the `SENSITIVE` set (same set `walkAndRedact` uses) so sensitive-key values are also redacted in-place — making the function correct when called standalone, not just as a post-`redactKeys` step. Output containers use `Object.create(null)` (matches `deepClone`'s proto-pollution defense). Opaque values (class instances, Map, Set, Date, Buffer, null, numbers, booleans) are returned unchanged.

**session-log.ts — `buildRecord` swap:** Replaced the top-level-only `if (typeof v === 'string') redactPii(v)` loop with `deepRedactPii(safe[k])` per key, applied after `redactKeys`. The docblock and inline comments updated to document the two-stage redaction contract. `redactPii` import removed (unused). The spill payload in `writeLineOrTruncate` is built from the `record` returned by `buildRecord`, which already incorporates both stages — T-01-LOG-03 invariant preserved with no separate spill edit needed.

## Tests Flipped

| Test | Before | After |
|------|--------|-------|
| deep PII: deepRedactPii is exported from pii.ts (HARD-03) | skip | PASS |
| deep PII: nested string leaf + nested secret key both redacted in written line (HARD-03) | skip | PASS |
| deep PII: session-log round-trip redacts nested PII in written line (HARD-03) | skip | PASS |

Full suite: **952 tests, 949 pass, 0 fail, 3 skipped** (3 skips are pre-existing, unrelated to this plan).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] deepRedactPii must handle SENSITIVE keys to pass standalone test**
- **Found during:** Task 1 — first test run after implementing the pure string-leaf version
- **Issue:** The test `deep PII: nested string leaf + nested secret key both redacted` calls `deepRedactPiiFn!(payload)` directly (not through `redactKeys`). The key `apiKey` (lowercased: `apikey`) is in `SENSITIVE`. A pure string-leaf walker passes `'sk-secret'` through `redactPii` unchanged (no PII regex matches it), so `result.nested.apiKey` remained `'sk-secret'` and the assertion failed.
- **Fix:** Added `SENSITIVE.has(lower)` check when iterating plain-object keys inside `deepRedactPii`, mirroring `walkAndRedact`'s contract exactly. This makes `deepRedactPii` a fully self-contained redactor usable standalone or after `redactKeys`.
- **Files modified:** `bin/lib/pii.ts`
- **Commit:** 9e56192

**2. [Rule 2 - Lint] Remove unused `redactPii` import from session-log.ts**
- **Found during:** Task 2 — `npm run lint` flagged `@typescript-eslint/no-unused-vars`
- **Fix:** Removed `redactPii` from the import line; `deepRedactPii` now covers all redaction needs in `buildRecord`.
- **Files modified:** `bin/lib/session-log.ts`
- **Commit:** 9e56192 (same atomic commit)

## Invariant Verification

| Invariant | Status |
|-----------|--------|
| Nested PII string at any depth redacted before write | CONFIRMED — deepRedactPii recurses all string leaves |
| Sensitive key at any depth redacted (redactKeys recursion preserved) | CONFIRMED — redactKeys unchanged; deepRedactPii also checks SENSITIVE inline |
| Oversize-spill payload built FROM the deep-redacted record | CONFIRMED — writeLineOrTruncate receives `record` from buildRecord which is already fully redacted |
| Determinism and proto-pollution safety | CONFIRMED — Object.create(null) containers; isPlainObject rejects class instances/Maps/Sets |

## Commits

| Hash | Message |
|------|---------|
| 9e56192 | feat(15-04): HARD-03 — deepRedactPii for recursive nested-PII redaction before SESSION.log |

## Threat Flags

None — all surfaces introduced are internal redaction helpers with no new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries.

## Self-Check: PASSED

- `bin/lib/pii.ts` exists and exports `deepRedactPii`: FOUND
- `bin/lib/session-log.ts` uses `deepRedactPii`: FOUND (pattern `deepRedactPii(safe[k])`)
- Commit 9e56192 exists: FOUND
- Tests: 23/23 PASS in targeted run; 949/952 PASS in full suite
- Lint: clean (1 pre-existing error in tests/lock.test.ts — out of scope)
- Typecheck: clean
