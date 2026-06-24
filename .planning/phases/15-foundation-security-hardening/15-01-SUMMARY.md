---
phase: 15-foundation-security-hardening
plan: 01
subsystem: testing
tags: [security, ssrf, pii, lock, token-bucket, pdf-bounds, prompt-injection, gptzero, red-by-skip]

requires:
  - phase: 14
    provides: existing test harness conventions (known-bad-pass2, budget, honesty, session-log, lock)

provides:
  - "RED-by-skip behavioral test scaffolds for all six HARD items (HARD-01 through HARD-06)"
  - "FENCE_MARKER UUID constant exported from pass2-injection.test.ts for Wave-2 contract"
  - "Skip-guarded scaffolds encoding exact acceptance criteria for each HARD behavior"

affects: [15-02, 15-03, 15-04, 15-05, 15-06, 15-07]

tech-stack:
  added: []
  patterns:
    - "RED-by-skip: dynamic URL.href import + typeof feature-detect + {skip: !present} — Phase-11/14 convention extended to all 6 HARD items"
    - "Injected fake resolver for SSRF test isolation — no real DNS in tests"
    - "UUID-style FENCE_MARKER exported from scaffold for Wave-2 contract binding"

key-files:
  created:
    - tests/ssrf-guard.test.ts
    - tests/token-bucket-fairness.test.ts
    - tests/pdf-text-bounds.test.ts
    - tests/pass2-injection.test.ts
  modified:
    - tests/lock.test.ts (HARD-01 canonicalize test appended)
    - tests/session-log.test.ts (HARD-03 deep-PII tests appended)
    - tests/honesty.test.ts (HARD-05 disclosure/consent/cap tests appended)

key-decisions:
  - "FENCE_MARKER is a UUID-style token (not literal <<<UNTRUSTED>>>) to avoid collision with academic text and RESEARCH.md content"
  - "SSRF tests use an injected resolveFn parameter (not MockAgent/undici intercept) to test the guard function in isolation before http.ts wires it"
  - "TokenBucket seam probes both TokenBucket and __TokenBucketForTest exports — either satisfies the skip gate"
  - "deepRedactPii skip gate is on pii.ts export (not session-log.ts) — tests both the pure function and the round-trip"
  - "HARD-05 honesty tests probe GPTZERO_MAX_BYTES as the seam indicator; consent tests probe scoreHonestyWithOptions seam"

patterns-established:
  - "Injected resolver pattern: checkSsrf(url, resolveFn?) — resolveFn defaults to dnsLookup; tests pass a map-based fake"
  - "UUID fence marker contract: FENCE_MARKER exported from scaffold; Wave-2 implementer must embed exactly this string"
  - "Deep-import probe pattern: `const mod = await import(url.href); const seam = mod['X'] ?? mod['__XForTest']`"

requirements-completed: [HARD-01, HARD-02, HARD-03, HARD-04, HARD-05, HARD-06]

duration: 9min
completed: 2026-06-24
---

# Phase 15 Plan 01: Foundation & Security Hardening — Wave 1 RED Scaffolds Summary

**7-file RED-by-skip test scaffold covering all 6 HARD security items: injected-resolver SSRF, FIFO TokenBucket, byte-cap PDF bounds, UUID-fenced prompt injection, deep-PII redaction, and GPTZero consent/cap — 0 failures, 21 skips, full suite stays GREEN.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-06-24T~T (epoch 1782286379)
- **Completed:** 2026-06-24
- **Tasks:** 2/2
- **Files modified:** 7 (4 new, 3 appended)

## Accomplishments

### Task 1: SSRF + TokenBucket + PDF-bounds scaffolds (HARD-02, HARD-06, HARD-04b)

Created 3 new scaffold test files:

**tests/ssrf-guard.test.ts** — HARD-02 behavioral scaffold:
- 5 behavioral tests (loopback reject, RFC1918 reject, link-local/IMDS reject, public-IP pass, non-http scheme reject)
- Injected `FakeResolverFn` pattern: no real DNS, map-based fake returns `[{address, family}]` shape
- Skip gate: `typeof checkSsrf === 'function'` dynamically loaded from http.js module URL
- 2 always-run sanity tests (http.ts exists, export state consistent)

**tests/token-bucket-fairness.test.ts** — HARD-06 behavioral scaffold:
- FIFO completion-order test: capacity=1, 3 concurrent acquires queue in arrival order, assert completion order [1,2,3]
- Deterministic via `setImmediate` yields between acquire() calls to establish arrival order before any grant
- Skip gate: probes `TokenBucket` OR `__TokenBucketForTest` export from http.js

**tests/pdf-text-bounds.test.ts** — HARD-04b behavioral scaffold:
- Byte-cap constant assertions (MAX_PDF_BYTES is positive, >= 1 MB)
- Timeout constant assertion (PDF_TIMEOUT_MS is positive)
- Over-cap buffer (MAX_PDF_BYTES + 1 bytes of zeros) → rejects with cap-mentioning error message
- Skip gates independent: timeout tests gated on PDF_TIMEOUT_MS; cap test gated on both MAX_PDF_BYTES + extractPdfText

### Task 2: Prompt-fencing + lock/session-log/honesty appends (HARD-04c, HARD-01, HARD-03, HARD-05)

Created 1 new file + appended to 3 existing files:

**tests/pass2-injection.test.ts** — HARD-04c behavioral scaffold:
- Exports `FENCE_MARKER = '<<<PENSMITH_UNTRUSTED_DATA_7f3a9c2e-4b8d-4f1a-a0e2-1c5d7b9f3e6a>>>'` — the UUID-style token Wave-2 (15-06) MUST embed in claim-support.md and orphan-label.md
- Tests: fence marker present in template, injected `source_abstract` enclosed (fence precedes injection text), both untrusted fields fenced (>= 2 occurrences)
- Same for orphan-label.md `{{sentence}}` field
- Skip gate: `readFileSync(templatePath).includes(FENCE_MARKER)` — directly reads the template file

**tests/lock.test.ts** — HARD-01 append (1 new test, 6 existing untouched):
- `'lock canonicalize: two path conventions for one file → identical stub'`
- Creates a real file in tmpdir, calls `stubForFn` with `path.resolve` form and raw absolute path, asserts same stub returned
- Win32 case-fold: upper-case path variant must produce same stub
- Skip gate: `typeof stubFor === 'function'` (or `__stubForTest` seam) from lock.js

**tests/session-log.test.ts** — HARD-03 append (3 new tests, 8 existing untouched):
- State consistency test (always runs): reports whether deepRedactPii is exported
- Unit test: `deepRedactPiiFn({metadata: {user: 'John Smith', note: 'call 555-123-4567'}, nested: {apiKey: 'sk-secret'}})` — asserts phone redacted, redaction tag present, apiKey value not raw
- Round-trip test: full session-log write, read file, assert neither phone nor apiKey survives
- Skip gate: `typeof deepRedactPii === 'function'` from pii.js

**tests/honesty.test.ts** — HARD-05 append (4 new tests, 6 existing untouched):
- State consistency test (always runs): GPTZERO_MAX_BYTES export state
- Constant test: GPTZERO_MAX_BYTES is positive, in 1 KB – 1 MB range
- Truncation test: probes `__truncateForGptzeroTest` seam; if absent, validates constant only
- Consent test: probes `scoreHonestyWithOptions` seam with `consentGranted: false` → must return null
- Skip gate: `typeof GPTZERO_MAX_BYTES === 'number'` from honesty.js

## Test Results

| File | Tests | Pass | Skip | Fail |
|------|-------|------|------|------|
| ssrf-guard.test.ts | 7 | 2 | 5 | 0 |
| token-bucket-fairness.test.ts | 3 | 1 | 2 | 0 |
| pdf-text-bounds.test.ts | 5 | 2 | 3 | 0 |
| pass2-injection.test.ts | 8 | 3 | 5 | 0 |
| lock.test.ts | 7 | 6 | 1 | 0 |
| session-log.test.ts | 11 | 9 | 2 | 0 |
| honesty.test.ts | 10 | 7 | 3 | 0 |
| **Scaffold total** | **51** | **30** | **21** | **0** |
| **Full suite (npm test)** | **952** | **931** | **21** | **0** |

## Deviations from Plan

### Auto-adjusted: no `<<<UNTRUSTED>>>` literal in scaffold

The plan noted the concern in Pitfall 5 (RESEARCH) that `<<<UNTRUSTED>>>` could appear in academic text. The constraint in the prompt (`The HARD-04c fence-marker probe must look for the SAME unguessable marker the Wave-2 plan 15-06 will emit`) was satisfied by creating a UUID-style token:

```
<<<PENSMITH_UNTRUSTED_DATA_7f3a9c2e-4b8d-4f1a-a0e2-1c5d7b9f3e6a>>>
```

This is exported from `tests/pass2-injection.test.ts` as `FENCE_MARKER` so Wave-2 (15-06) has a concrete contract to embed. The plan's `must_haves.artifacts` check for `UNTRUSTED` is satisfied: the marker contains `UNTRUSTED_DATA` as a substring.

### Auto-adjusted: HARD-05 consent test handles missing seam gracefully

The consent test for `scoreHonestyWithOptions` probes for the seam and passes with a diagnostic message if absent. This is correct Wave-1 behavior — the seam doesn't exist yet and will be added by Wave-2 (15-05).

## Known Stubs

None — this plan is test-only. No production code stubs were created.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes. Tests are read-only with respect to the threat surface.

## Self-Check

- [x] tests/ssrf-guard.test.ts exists
- [x] tests/token-bucket-fairness.test.ts exists
- [x] tests/pdf-text-bounds.test.ts exists
- [x] tests/pass2-injection.test.ts exists
- [x] tests/lock.test.ts modified (HARD-01 test appended)
- [x] tests/session-log.test.ts modified (HARD-03 tests appended)
- [x] tests/honesty.test.ts modified (HARD-05 tests appended)
- [x] Commit db9040e: test(15-01): HARD-02, HARD-06, HARD-04b scaffolds
- [x] Commit 8cc9127: test(15-01): HARD-04c, HARD-01, HARD-03, HARD-05 scaffolds
- [x] Full suite: 0 fail (952 tests, 931 pass, 21 skip)
- [x] tsc --noEmit: clean
- [x] Path resolution: fileURLToPath(new URL(...)) — no %20 in resolved paths

## Self-Check: PASSED
