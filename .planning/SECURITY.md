# Pensmith v0.1.0 — Milestone Security Audit

**Phase:** 15-foundation-security-hardening  
**Authored:** 2026-06-24  
**Wave:** 4 (Plans 15-02 through 15-07 have landed; this audit is authoritative as of Wave 4 completion)  
**Status legend:** PROVEN — enforcing test is currently green; UNPROVEN-in-CI — behavior is correct but cannot be validated in CI without live network access (manual-only verification instructions provided); UNPROVEN — no enforcing test yet (follow-up required).

---

## Purpose

This document is the deferred secure-phase audit required by HARD-04a. It enumerates every significant threat surface identified across the Phase 15 hardening work, cross-references the per-phase `<threat_model>` blocks (Plans 15-02 through 15-08), and maps each threat to its enforcing test. Every row marked PROVEN cites a test that was confirmed green before this document was committed.

This is a planning artifact — it lives in `.planning/` and is NOT a public-facing security disclosure. Phase 16 covers README/docs.

---

## Threat Matrix

| # | Threat | Chokepoint | Enforcing Test | Status |
|---|--------|------------|----------------|--------|
| 1 | SSRF — private-IP / loopback reach via user-supplied URL | `bin/lib/http.ts` → `checkSsrf()` | `tests/ssrf-guard.test.ts` | **PROVEN** |
| 2 | SSRF — live DNS resolution to RFC1918/loopback/link-local | `bin/lib/http.ts` → `checkSsrf()` DNS pre-flight | `tests/ssrf-guard.test.ts` (injected resolver) | **PROVEN-in-CI** / UNPROVEN-live (see §Manual) |
| 3 | API key / secret leaks to SESSION.log | `bin/lib/pii.ts` → `redactKeys()` + `deepRedactPii()` | `tests/pii.test.ts` + `tests/session-log.test.ts` | **PROVEN** |
| 4 | PII (email, phone, SSN, credit card) leaks to SESSION.log via nested object | `bin/lib/pii.ts` → `deepRedactPii()` + `bin/lib/session-log.ts` → `buildRecord()` | `tests/session-log.test.ts` (HARD-03 rows) | **PROVEN** |
| 5 | Lock-race / clobber — two callers target same file via different path conventions, get different stubs, never contend | `bin/lib/lock.ts` → `stubFor()` canonicalization (resolve + realpathSync) | `tests/lock.test.ts` (HARD-01 row: "two path conventions for one file → identical stub") | **PROVEN** |
| 6 | Lock-race — cross-process concurrent write (BLOCKER-01/02) | `bin/lib/lock.ts` → `withLock()` / `proper-lockfile` | `tests/lock.test.ts` (TEST-07 cross-process spawn) | **PROVEN** |
| 7 | Prompt injection — untrusted source abstract / claim sentence in Pass-2/Pass-4 prompt | `templates/prompts/claim-support.md` + `orphan-label.md` — PENSMITH_UNTRUSTED_DATA fence marker | `tests/pass2-injection.test.ts` | **PROVEN** |
| 8 | PDF supply-chain — pdf-parse version drift (malicious or breaking update) | `package.json` exact pin `pdf-parse@1.1.1` + dual-surface pin guard | `tests/repo-files.test.ts` ("pdf-parse stays pinned exact at 1.1.1") | **PROVEN** |
| 9 | PDF OOM / hang — unbounded input causes memory exhaustion or infinite parse loop | `bin/lib/pdf-text.ts` → `MAX_PDF_BYTES` cap + `PDF_TIMEOUT_MS` Promise.race | `tests/pdf-text-bounds.test.ts` | **PROVEN** |
| 10 | GPTZero API-key never logged | `bin/lib/honesty.ts` → presence-only check; value reaches only the `x-api-key` header | `tests/honesty.test.ts` (key-never-logged assertion) | **PROVEN** |
| 11 | GPTZero full-body egress without consent — raw essay text sent to third-party service | `bin/lib/honesty.ts` → consent gate (ask() before POST, default-off in non-TTY) | `tests/honesty.test.ts` (HARD-05: "consent declined → scoreHonesty returns null without POST") | **PROVEN** |
| 12 | GPTZero over-sized POST — excessive bandwidth / API cost on large papers | `bin/lib/honesty.ts` → `GPTZERO_MAX_BYTES` truncation before POST | `tests/honesty.test.ts` (HARD-05: "over-cap input → POST body truncated") | **PROVEN** |
| 13 | GPTZero live-egress consent with real API key | `bin/lib/honesty.ts` → same consent gate | manual only (see §Manual) | **UNPROVEN-in-CI** |
| 14 | Zero-trace in exported .docx — pensmith metadata stamp in Word XML | `bin/lib/exporter.ts` → `zeroTracePatch()` + deterministic ZIP generator | `tests/zero-trace-export.test.ts` (Tests A–B) + `tests/repo-files.test.ts` (fixture hash-pins) | **PROVEN** |
| 15 | Zero-trace in exported .pdf — pensmith / XMP metadata in PDF /Info dict | `bin/lib/exporter.ts` → `zeroTracePdf()` | `tests/zero-trace-export.test.ts` (Tests C–D) | **PROVEN** |
| 16 | Zero-trace in exported .md / .tex — generator comment or pensmith string | `bin/lib/exporter.ts` → pandoc pipeline + md/tex codepath | `tests/zero-trace-export.test.ts` (Tests E–F) | **PROVEN** |
| 17 | Verifier gate fail-closed — compile runs despite unverified / fabricated section | `bin/cli/compile.ts` → `runCompile()` → GATE-01 guard | `tests/compile-refuse.test.ts` (GATE-01 rows) | **PROVEN** |
| 18 | Verifier gate retraction — MIS-CITED / retracted DOI escapes export | `bin/lib/verifier/pass1.ts` → `fetchById()` retraction check | `tests/gate-retraction.test.ts` (GATE-03 rows) | **PROVEN** |
| 19 | Verifier gate done-recheck — citekey drift after verification | `bin/cli/compile.ts` → `reCheckFinalMd()` (GATE-04, no --yolo escape) | `tests/done-recheck.test.ts` (GATE-04 rows) | **PROVEN** |
| 20 | Prompt drift / supply-chain — prompt template silently modified | `bin/lib/prompt-loader.ts` → `EXPECTED_PROMPT_HASHES` (WN-3) | `tests/repo-files.test.ts` (hash-pin tests for all locked templates) | **PROVEN** |
| 21 | Concurrency over-parallelization — HTTP rate-limit bypass via non-FIFO TokenBucket | `bin/lib/http.ts` → `TokenBucket` FIFO waiter queue | `tests/token-bucket-fairness.test.ts` | **PROVEN** |
| 22 | Concurrency over-parallelization — Semaphore slot leak on bare-caller exception | `bin/lib/budget.ts` → `Semaphore.withLock()` try/finally; bare-caller doc warning | `tests/budget.test.ts` (HARD-06: withLock-releases-permit-on-throw; FIFO regression) | **PROVEN** |
| 23 | HTTP cache header leak — cached responses include auth/session headers from original request | `bin/lib/http.ts` → cache layer | `tests/http-cache-no-header-leak.test.ts` | **PROVEN** |
| 24 | Honesty framing drift — "evade detection" wording sneaks into honesty report | `references/honesty-framing.md` → SHA-256 hash-pin (WN-3) | `tests/repo-files.test.ts` ("references/honesty-framing.md hash-pin") | **PROVEN** |

---

## Manual-Only Verifications

The following threats are architecturally mitigated but cannot be exercised in CI without live network/API access:

| # | Behavior | Requirement | Why Manual | Test Instructions |
|---|----------|-------------|------------|-------------------|
| M-1 | A real `add <url>` to a host that resolves to 127.x/10.x/169.254.x is blocked via live DNS | HARD-02 | CI uses an injected resolver; real DNS unavailable | `PENSMITH_NETWORK_TESTS=1 pensmith add http://<host-resolving-to-private-IP>` — expect rejection with SSRF error |
| M-2 | GPTZero consent + size cap with a real API key on a large paper | HARD-05 | Live API + real GPTZERO_API_KEY required | Run `pensmith done` on a paper > GPTZERO_MAX_BYTES with a valid key; confirm: (a) consent prompt shown, (b) POST body truncated to cap, (c) key not printed anywhere in output |

---

## Cross-Reference: Per-Phase Threat Model Blocks

| Plan | Threat IDs | Coverage in This Audit |
|------|-----------|------------------------|
| 15-02 (lock.ts) | T-15-01 (BLOCKER-01/02, D-26/D-40) | Rows 5, 6 |
| 15-03 (http.ts) | T-15-02 (ARCH-12/13, D-06 SSRF), T-15-06a (TokenBucket FIFO) | Rows 1, 2, 21, 23 |
| 15-04 (pii.ts + session-log.ts) | T-15-03 (T-01-06/07/08 PII/key leak) | Rows 3, 4 |
| 15-05 (pdf-text.ts) | T-15-04b (OOM/hang), T-15-04b-SC (supply-chain pin) | Rows 8, 9 |
| 15-06 (pass2/pass4 fencing) | T-15-04c (prompt injection) | Row 7 |
| 15-07 (honesty.ts) | T-15-05 (GPTZero consent/cap/key-no-log), T-15-05-framing (framing drift) | Rows 10, 11, 12, 13, 24 |
| 15-08 (SECURITY.md + Semaphore doc) | T-15-06b (Semaphore bare-caller permit leak), T-15-04a (audit) | Rows 22, (this document) |
| Phase 6 (zero-trace export) | DONE-07 / HIGH-1 | Rows 14, 15, 16 |
| Phase 14 (verifier gate) | GATE-01/03/04 | Rows 17, 18, 19 |
| Phase 8/9 (prompt-loader WN-3) | WN-3 prompt drift | Rows 20, 24 |

---

## Prior-Milestone Chokepoint Threats

These were identified before Phase 15 and are included for completeness:

| Chokepoint | Threat Ref | Current Status |
|------------|-----------|----------------|
| `bin/lib/pii.ts` | T-01-06 (key leak), T-01-07 (PII egress), T-01-08 (__proto__ pollution) | PROVEN — rows 3, 4 + `tests/pii.test.ts` |
| `bin/lib/lock.ts` | D-26 (cross-process lock), D-40 (lock dir not in .paper/) | PROVEN — rows 5, 6 + `tests/lock.test.ts` |
| `bin/lib/http.ts` | ARCH-12 (SSRF), ARCH-13 (redirect re-check), D-06 (sole network chokepoint) | PROVEN — rows 1, 2 + `tests/ssrf-guard.test.ts` |
| `bin/lib/budget.ts` | T-01-RACE-03 (TOCTOU budget window — accepted; per-section caps bound overrun to one estimate) | Accepted risk, documented in `assertBudget()` source comment |

---

## Counts

- **Total threats enumerated:** 24 rows (+ 2 manual-only)
- **PROVEN (CI-verified):** 23
- **PROVEN-in-CI / UNPROVEN-live:** 1 (row 2 — live DNS SSRF)
- **UNPROVEN-in-CI (manual-only):** 2 (rows 13, M-2 — live GPTZero)
- **UNPROVEN (no test, follow-up required):** 0

All enforcing tests confirmed green at time of authoring (Wave 4, 2026-06-24).
