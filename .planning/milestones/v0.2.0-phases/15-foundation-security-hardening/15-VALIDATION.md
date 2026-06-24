---
phase: 15
slug: foundation-security-hardening
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-22
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (`node --import tsx --test`) |
| **Config file** | none — `scripts/run-tests.mjs` discovers `tests/**/*.test.ts` |
| **Quick run command** | `node --import tsx --test tests/lock.test.ts tests/ssrf-guard.test.ts tests/session-log.test.ts tests/token-bucket-fairness.test.ts` |
| **Full suite command** | `npm test` (or `npm run check`) |
| **Estimated runtime** | quick ~5s; full suite ~60–120s |

---

## Sampling Rate

- **After every task commit:** quick command for the file(s) touched.
- **After every plan wave:** `npm test`.
- **Before `/gsd:verify-work`:** `npm run check` green. SSRF guard tested with an INJECTED resolver (no real DNS in CI); GPTZero/PDF/Pass-2/4 offline via cassettes + PENSMITH_NO_LLM.
- **Max feedback latency:** ~120s.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 15-01-xx | 01 | 0 | HARD-01..06 | T-15-* | RED-by-skip scaffolds (lock canon, ssrf, deep-pii, token-bucket fairness, pdf-bounds, gptzero-consent, pass2/4 fence) | unit | quick command | ❌ W0 | ⬜ pending |
| 15-0x-xx | 0x | 1 | HARD-01 | T-15-01 | two path conventions for one file → identical lock stub (resolve+realpath) | unit | `tests/lock.test.ts` | ❌ W0 | ⬜ pending |
| 15-0x-xx | 0x | 1 | HARD-02 | T-15-02 | URL resolving to RFC1918/loopback/link-local (injected resolver) rejected before connect; public https passes; redirect hops re-checked | unit | `tests/ssrf-guard.test.ts` | ❌ W0 | ⬜ pending |
| 15-0x-xx | 0x | 1 | HARD-03 | T-15-03 | nested PII string + nested secret key both redacted in the written SESSION.log line | unit | `tests/session-log.test.ts` | ❌ W0 | ⬜ pending |
| 15-0x-xx | 0x | 1 | HARD-06 | T-15-06 | ≤N concurrent for N slots; FIFO queue; permit released on holder exception | unit | `tests/token-bucket-fairness.test.ts` | ❌ W0 | ⬜ pending |
| 15-0x-xx | 0x | 1 | HARD-04b | T-15-04b | over-cap / timeout PDF rejected with a clear error (no crash/hang) | unit | `tests/pdf-text.test.ts` | ❌ W0 | ⬜ pending |
| 15-0x-xx | 0x | 1 | HARD-04c | T-15-04c | Pass-2/Pass-4 built prompt fences untrusted draft/abstract text; WN-3 re-pin (both pin sites updated, suite green) | unit | `tests/verify/pass2.test.ts tests/repo-files.test.ts` | ❌ W0 | ⬜ pending |
| 15-0x-xx | 0x | 1 | HARD-05 | T-15-05 | GPTZero POST consent-gated + disclosed + size-capped; key still never logged; WN-3 framing re-pin | unit | `tests/honesty.test.ts` | ❌ W0 | ⬜ pending |
| 15-0x-xx | 0x | 1 | HARD-04a | T-15-04a | SECURITY.md enumerates each threat PROVEN (cites test) / UNPROVEN | doc | review + `tests/repo-files.test.ts` (presence) | ❌ W0 | ⬜ pending |
| 15-0x-xx | 0x | 1 | HARD-01..06 | — | tier-contract green; full suite green | contract | `npm run test:tier-contract` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] RED-by-skip scaffolds: `tests/lock.test.ts` (canon), `tests/ssrf-guard.test.ts` (injected resolver), `tests/session-log.test.ts` (deep redaction), `tests/token-bucket-fairness.test.ts`, `tests/pdf-text.test.ts` (bounds), `tests/verify/pass2.test.ts`+`pass4.test.ts` (fence), `tests/honesty.test.ts` (consent/cap).
- [ ] All scaffolds skip-guarded; path resolution via fileURLToPath (spaced-path safe, Phase-11 lesson). SSRF + concurrency use injected resolver / deterministic timers.

*Existing infra (node:test + MockAgent + cassettes + PENSMITH_NO_LLM) covers the rest. WN-3 re-pin (HARD-04c/05) updates BOTH repo-files.test.ts AND prompt-loader.ts in the same commit.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A real `add <url>` to an attacker-controlled host that resolves to a private IP is blocked against live DNS | HARD-02 | Live DNS; CI uses an injected resolver | Run `pensmith add http://<host-resolving-to-127.0.0.1>` with `PENSMITH_NETWORK_TESTS=1`; confirm rejection |
| GPTZero rejects/handles an over-cap real submission | HARD-05 | Live API + key | Run `pensmith done` on a large paper with a real GPTZero key; confirm consent + cap |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
