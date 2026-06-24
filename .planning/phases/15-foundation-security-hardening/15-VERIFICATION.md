---
phase: 15-foundation-security-hardening
verified: 2026-06-24T00:00:00Z
status: human_needed
score: 6/6 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Live SSRF block via real DNS — HARD-02 M-1"
    expected: "pensmith add http://<host-resolving-to-127.x/10.x/169.254.x> produces an SSRF rejection error before any socket is opened"
    why_human: "CI uses an injected fake resolver; real DNS resolution against an attacker-controlled host requires a live network environment"
  - test: "GPTZero consent + size-cap with real API key + large paper — HARD-05 M-2"
    expected: "pensmith done on a paper > GPTZERO_MAX_BYTES with a valid GPTZERO_API_KEY: (a) disclosure shown, (b) consent prompt presented in TTY, (c) POST body truncated to GPTZERO_MAX_BYTES, (d) key never printed in any output"
    why_human: "Live API call requires a real GPTZERO_API_KEY; CI runs offline with cassette replay only"
---

# Phase 15: Foundation & Security Hardening — Verification Report

**Phase Goal:** Close six security/foundation gaps (HARD-01 through HARD-06) in lock.ts, http.ts, pii.ts, session-log.ts, pdf-text.ts, prompt templates, honesty.ts, and budget.ts.
**Verified:** 2026-06-24
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | HARD-01: `stubFor` canonicalizes (path.resolve + realpathSync.native + win32 case-fold) before hashing; two path conventions → identical stub; not-yet-created file handled; 'compile:' prefix dropped | VERIFIED | `lock.ts:89-95` implements exact canonicalization; `compile.ts:234` uses bare path (no prefix); lock.test.ts test 7 PASSES live (7/7 pass, 0 skip) |
| 2 | HARD-02: `checkSsrf` rejects private/loopback/link-local/ULA IPs (v4+v6 incl. IPv4-mapped) BEFORE connect, fail-closed on resolver error, for untrusted URLs; public API hosts pass; redirect hops re-checked; false add.ts comment gone | VERIFIED | `http.ts:82-154` ships full implementation; `isPrivateIp` covers all RFC1918/loopback/link-local/ULA/IPv4-mapped ranges; `checkSsrf` fail-closed on resolver error; injected-resolver tests 7/7 PASS; add.ts comment corrected to accurate description |
| 3 | HARD-03: `deepRedactPii` recurses every string leaf; session-log `buildRecord` uses it; nested PII string + nested secret key both redacted; spill-from-redacted-record invariant preserved | VERIFIED | `pii.ts:403-432` implements `deepRedactPii` with full recursion (string/Array/plainObject); `session-log.ts:181-183` calls `deepRedactPii` per key after `redactKeys`; session-log.test.ts HARD-03 rows PASS (11/11 pass, 0 skip) |
| 4 | HARD-04: (a) SECURITY.md enumerates 24 threats with PROVEN/UNPROVEN status citing real tests; (b) pdf-text.ts MAX_PDF_BYTES cap + PDF_TIMEOUT_MS timeout reject over-cap/hanging PDFs; (c) claim-support.md + orphan-label.md fence untrusted fields with the FENCE_MARKER; WN-3 re-pin in BOTH prompt-loader.ts AND repo-files.test.ts | VERIFIED | `.planning/SECURITY.md` present with 23 PROVEN + 1 PROVEN-in-CI rows; `pdf-text.ts:63,70` export both constants; `extractPdfText` rejects at byte-cap before parse; both prompt files contain `<<<PENSMITH_UNTRUSTED_DATA_7f3a9c2e-4b8d-4f1a-a0e2-1c5d7b9f3e6a>>>` marker; claim-support + orphan-label hashes match in both `prompt-loader.ts:131-132` and `repo-files.test.ts:332-333`; all pin tests PASS (50/50) |
| 5 | HARD-05: GPTZero POST is consent-gated (default = don't send), disclosed, size-capped; non-TTY silent-decline; key never logged; honesty-framing.md re-pinned | VERIFIED | `honesty.ts:267-373` implements full consent gate (key-absent guard → disclosure → consent ask/non-TTY-decline → size-cap → assertBudget → POST); `GPTZERO_MAX_BYTES=50_000` exported; `scoreHonestyWithOptions` accepts `consentGranted:false` injection; key checked only via `!!apiKey` presence; framing read VERBATIM from locked file; honesty.test.ts HARD-05 rows PASS (10/10) |
| 6 | HARD-06: TokenBucket has FIFO waiter queue (≤N concurrent, FIFO order); Semaphore documented (FIFO + bare-caller try/finally warning) + regression test | VERIFIED | `http.ts:356-407` implements FIFO TokenBucket with `waiters: Array<() => void>`, single `_scheduleGrant` timer, `waiters.shift()` for oldest-first; `budget.ts:167-191` Semaphore documents bare-caller try/finally requirement; budget.test.ts HARD-06 rows PASS (Semaphore FIFO + withLock-releases-permit-on-throw, 11/11); token-bucket-fairness.test.ts PASS (3/3) |

**Score:** 6/6 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `bin/lib/lock.ts` | `stubFor` exported + canonicalization | VERIFIED | Exports `stubFor`; resolve+realpathSync.native+win32-case-fold before hashing |
| `bin/lib/compile.ts` | No 'compile:' prefix in lockResource | VERIFIED | Line 234: bare `join(paperDir(opts.paperRoot), '.compile.lock')` |
| `bin/lib/http.ts` | `checkSsrf` + FIFO TokenBucket + `__TokenBucketForTest` | VERIFIED | All three present; `checkSsrf` exported; `__TokenBucketForTest` export seam for tests |
| `bin/cli/add.ts` | Accurate SSRF comment (not false) | VERIFIED | Lines 201-204: describes `checkSsrf` DNS-resolves and blocks RFC1918/loopback/link-local |
| `bin/lib/pii.ts` | `deepRedactPii` exported | VERIFIED | Lines 403-432; recursively applies `redactPii` to every string leaf |
| `bin/lib/session-log.ts` | `buildRecord` calls `deepRedactPii` after `redactKeys` | VERIFIED | Lines 181-183: per-key `deepRedactPii` loop; comment annotates T-15-03 |
| `bin/lib/pdf-text.ts` | `MAX_PDF_BYTES`, `PDF_TIMEOUT_MS` exported; cap + timeout active | VERIFIED | Lines 63, 70 export both; lines 149-154 byte-cap check before parse; lines 158-171 Promise.race timeout |
| `templates/prompts/claim-support.md` | FENCE_MARKER present for both untrusted fields | VERIFIED | Both `{{claim_sentence}}` and `{{source_abstract}}` fenced; 2 fence occurrences confirmed by test |
| `templates/prompts/orphan-label.md` | FENCE_MARKER present for `{{sentence}}` | VERIFIED | Fenced confirmed by test; pass2-injection.test.ts 8/8 PASS |
| `bin/lib/prompt-loader.ts` | claim-support + orphan-label re-pinned (WN-3) | VERIFIED | Lines 131-132: real SHA-256 values (no `__PENDING_HASH__` sentinels); loadPrompt resolves without bypass env |
| `bin/lib/honesty.ts` | Consent gate + disclosure + size cap + key-not-logged | VERIFIED | Full implementation; `GPTZERO_MAX_BYTES`, `__truncateForGptzeroTest`, `scoreHonestyWithOptions` exported |
| `.planning/SECURITY.md` | Enumerates threats with PROVEN/UNPROVEN status | VERIFIED | 24-row matrix; 23 PROVEN (CI), 1 PROVEN-in-CI/UNPROVEN-live, 0 UNPROVEN; each row cites enforcing test |
| `bin/lib/budget.ts` | Semaphore FIFO + bare-caller documentation | VERIFIED | `waiters.shift()` for FIFO; inline `BARE-CALLER WARNING` block documents try/finally requirement |
| `tests/lock.test.ts` | HARD-01 test (test 7) active and passing | VERIFIED | Test 7 not skipped (stubFor exported); PASS confirmed live |
| `tests/ssrf-guard.test.ts` | HARD-02 injected-resolver tests active and passing | VERIFIED | All 7 tests PASS (0 skip); injected resolver used for all behavioral assertions |
| `tests/session-log.test.ts` | HARD-03 deep-PII tests active and passing | VERIFIED | All 11 tests PASS (0 skip); deepRedactPii exported and wired |
| `tests/pdf-text-bounds.test.ts` | HARD-04b tests active and passing | VERIFIED | All 5 tests PASS (0 skip); byte-cap rejection asserted |
| `tests/pass2-injection.test.ts` | HARD-04c fence tests active and passing | VERIFIED | All 8 tests PASS (0 skip); both templates fenced |
| `tests/honesty.test.ts` | HARD-05 consent/cap tests active and passing | VERIFIED | All 10 tests PASS (0 skip); consent declined → null confirmed |
| `tests/token-bucket-fairness.test.ts` | HARD-06 FIFO test active and passing | VERIFIED | All 3 tests PASS (0 skip); FIFO order [1,2,3] asserted |
| `tests/budget.test.ts` | HARD-06 Semaphore FIFO + permit-release-on-throw | VERIFIED | HARD-06 rows PASS; Semaphore FIFO and withLock-release-on-throw both green |
| `tests/repo-files.test.ts` | WN-3 hash-pins for claim-support + orphan-label + honesty-framing | VERIFIED | 50/50 PASS; claim-support + orphan-label hash-pins pass; honesty-framing.md hash-pin passes |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `http.ts callOnce()` | `checkSsrf` | called at start of `callOnce` when `untrusted === true` | VERIFIED | Lines 634-639: `if (untrusted) { await checkSsrf(url); }` before `request()` |
| `http.ts fetch()` | `untrusted` flag | `source === 'generic' \|\| opts.untrusted === true` | VERIFIED | Line 634: exact condition wired correctly |
| `session-log.ts buildRecord` | `deepRedactPii` | per-key loop after `redactKeys` | VERIFIED | Lines 181-183: `for (const k of Object.keys(safe)) { safe[k] = deepRedactPii(safe[k]); }` |
| `honesty.ts scoreWithGptzero` | consent gate before POST | `if (!isYolo) { ... ask() ... }` pattern | VERIFIED | Lines 299-323: consent check before lines 343-356 (POST) |
| `honesty.ts scoreWithGptzero` | size cap before POST body | `__truncateForGptzeroTest` called on `postText` | VERIFIED | Lines 326-330: cap check + truncation before `JSON.stringify({ document: postText })` |
| `pdf-text.ts extractPdfText` | `MAX_PDF_BYTES` cap check | `if (input.length > MAX_PDF_BYTES) throw` | VERIFIED | Lines 149-154: cap check BEFORE `parseWithRetry(input)` |
| `lock.ts stubFor` | canonical hash | resolve → realpathSync.native → case-fold → sha256 | VERIFIED | Lines 89-97: exact three-step canonicalization |
| `compile.ts runCompile` | lock without prefix | `join(paperDir(opts.paperRoot), '.compile.lock')` | VERIFIED | Line 234: no 'compile:' prefix present |
| `prompt-loader.ts EXPECTED_PROMPT_HASHES` | claim-support + orphan-label real hashes | no `__PENDING_HASH__` sentinels | VERIFIED | Lines 131-132: real SHA-256 values; `loadPrompt` validates on every call |
| `repo-files.test.ts PENDING_HASH_PINS` | claim-support + orphan-label real hashes | single-source-of-truth (WN-3) | VERIFIED | Lines 332-333: same real SHA-256 values as prompt-loader.ts |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `session-log.ts buildRecord` | `safe` (redacted payload) | `redactKeys(merged)` + `deepRedactPii` per key | Yes — redacted from real payload | FLOWING |
| `honesty.ts scoreWithGptzero` | `postText` (size-capped) | `__truncateForGptzeroTest(text)` when over-cap | Yes — truncated slice of real text | FLOWING |
| `pdf-text.ts extractPdfText` | `input` (byte-capped) | Buffer passed by caller, rejected before parse | Yes — real error thrown on over-cap | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| HARD-01: two path conventions → identical lock stub | `node --import tsx --test tests/lock.test.ts` | 7/7 PASS, 0 skip | PASS |
| HARD-02: injected-resolver SSRF guard blocks private IPs | `node --import tsx --test tests/ssrf-guard.test.ts` | 7/7 PASS, 0 skip | PASS |
| HARD-03: nested PII redaction in session-log round-trip | `node --import tsx --test tests/session-log.test.ts` | 11/11 PASS, 0 skip | PASS |
| HARD-04b: over-cap PDF rejected before parse | `node --import tsx --test tests/pdf-text-bounds.test.ts` | 5/5 PASS, 0 skip | PASS |
| HARD-04c: fence marker present + structural injection defense | `node --import tsx --test tests/pass2-injection.test.ts` | 8/8 PASS, 0 skip | PASS |
| HARD-04 WN-3 dual re-pin consistent | `node --import tsx --test tests/repo-files.test.ts` | 50/50 PASS, 0 skip | PASS |
| HARD-05: consent declined → null (no POST) | `node --import tsx --test tests/honesty.test.ts` | 10/10 PASS, 0 skip | PASS |
| HARD-06: TokenBucket FIFO order [1,2,3] | `node --import tsx --test tests/token-bucket-fairness.test.ts` | 3/3 PASS, 0 skip | PASS |
| HARD-06: Semaphore FIFO + permit-release-on-throw | `node --import tsx --test tests/budget.test.ts` | 11/11 PASS, 0 skip | PASS |
| Full suite (954 tests) | `npm test` | 954 PASS, 0 fail, 0 skip | PASS |
| Lint (D-06/D-41 chokepoints) | `npm run lint` | Clean — no errors | PASS |
| Tier contract | `npm run test:tier-contract` | 48/48 PASS, 0 fail | PASS |
| 16-verb bijection unchanged | tier-contract test: "16-verb bijection re-asserted" | PASS | PASS |

---

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` files declared or referenced for Phase 15.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| HARD-01 | 15-03 | Lock key canonicalization (resolve + realpath + case-fold) | SATISFIED | `lock.ts:89-97`; test 7 in lock.test.ts PASSES live |
| HARD-02 | 15-02 | SSRF guard in http.ts chokepoint for untrusted URLs | SATISFIED | `http.ts:121-154`; ssrf-guard.test.ts 7/7 PASS |
| HARD-03 | 15-04 | deepRedactPii recurses into nested string leaves | SATISFIED | `pii.ts:403-432`; `session-log.ts:181-183`; session-log.test.ts 11/11 PASS |
| HARD-04a | 15-08 | SECURITY.md with PROVEN/UNPROVEN threat enumeration | SATISFIED | `.planning/SECURITY.md` 24-row matrix; all citations real green tests |
| HARD-04b | 15-05 | MAX_PDF_BYTES cap + PDF_TIMEOUT_MS timeout in pdf-text.ts | SATISFIED | `pdf-text.ts:63,70,149-171`; pdf-text-bounds.test.ts 5/5 PASS |
| HARD-04c | 15-06 | Prompt injection fence in claim-support.md + orphan-label.md; WN-3 re-pin | SATISFIED | Both templates fenced; prompt-loader.ts + repo-files.test.ts hashes match; pass2-injection.test.ts 8/8 PASS |
| HARD-05 | 15-07 | GPTZero consent gate + disclosure + size cap; key never logged; framing re-pinned | SATISFIED | `honesty.ts:267-373`; honesty.test.ts 10/10 PASS; honesty-framing.md hash-pin green |
| HARD-06 | 15-02, 15-08 | FIFO TokenBucket + Semaphore FIFO doc + permit-release-on-throw | SATISFIED | `http.ts:354-407`; `budget.ts:155-228`; both test files PASS |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|---------|--------|
| `bin/lib/pdf-text.ts` | 43-44 | `TODO(Phase 4): route WARN through bin/lib/logger.ts` | Info | Pre-existing deferred work; `console.warn` is intentional until Phase 4 logger lands; does not affect security behavior |
| `bin/lib/session-log.ts` | 258 | `chain` is module-scope | Info | Known design; documented; not a stub |

No TBD/FIXME/XXX markers found in Phase 15 files. No unreferenced debt markers. No empty stubs.

---

### Human Verification Required

#### 1. Live SSRF Block via Real DNS (HARD-02 M-1)

**Test:** With `PENSMITH_NETWORK_TESTS=1`, run `pensmith add http://<host-that-resolves-to-127.0.0.1>` (e.g., a hostname pointing to loopback via /etc/hosts or a controlled DNS entry).
**Expected:** The command produces an SSRF guard error mentioning "private/reserved IP" before any socket is opened. No data is sent.
**Why human:** CI uses an injected fake resolver that never issues real DNS queries. Validating that the live `node:dns/promises.lookup` code path correctly blocks a real attacker-controlled hostname requires a live network environment and a hostname configured to resolve to a private IP.

#### 2. GPTZero Consent + Size-Cap with Real API Key (HARD-05 M-2)

**Test:** Run `pensmith done` on a paper whose compiled text exceeds `GPTZERO_MAX_BYTES` (50,000 bytes) with a real `GPTZERO_API_KEY` set in the environment and a TTY terminal.
**Expected:** (a) Disclosure message shown: "Disclosure: the honesty check sends your full paper text to GPTZero..." (b) Interactive consent prompt shown before any POST. (c) If consent granted, POST body is truncated to ≤50,000 bytes (logged "truncated to 50000 bytes"). (d) The API key value never appears in stdout/stderr output.
**Why human:** Live GPTZero API call requires a real `GPTZERO_API_KEY`; CI runs entirely offline with cassette replay. The non-TTY consent path (silent decline) is proven by automated test, but the TTY interactive path and the live truncation path require a real terminal + real API key.

---

### Gaps Summary

No gaps. All six HARD requirements are verified with green automated tests:

- HARD-01: `stubFor` canonicalization + compile.ts prefix drop — proven by lock.test.ts test 7 (live, 0 skip)
- HARD-02: SSRF guard with injected resolver — proven by ssrf-guard.test.ts (7/7 live pass)
- HARD-03: deepRedactPii + buildRecord wiring — proven by session-log.test.ts HARD-03 rows (0 skip)
- HARD-04: SECURITY.md (24 threats) + PDF byte-cap/timeout + prompt fencing + WN-3 dual re-pin — proven by pdf-text-bounds.test.ts, pass2-injection.test.ts, repo-files.test.ts (all live pass)
- HARD-05: Consent gate + disclosure + size cap + key-not-logged — proven by honesty.test.ts HARD-05 rows (0 skip); non-TTY silent-decline confirmed
- HARD-06: FIFO TokenBucket + Semaphore bare-caller doc — proven by token-bucket-fairness.test.ts + budget.test.ts HARD-06 rows

The two human verification items (live DNS SSRF block; live GPTZero consent+cap) are advisory manual checks. Automated coverage is complete and the full suite (954 tests) is green.

---

_Verified: 2026-06-24_
_Verifier: Claude (gsd-verifier)_
