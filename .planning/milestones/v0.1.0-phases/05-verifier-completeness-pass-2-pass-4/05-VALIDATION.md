---
phase: 5
slug: verifier-completeness-pass-2-pass-4
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-17
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in) via `node --import tsx --test` |
| **Config file** | scripts/run-tests.mjs (discovers tests/**/*.test.ts) |
| **Quick run command** | `node --import tsx --test tests/<file>.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~13 seconds (full suite, 632 tests at Phase 4 close) |

---

## Sampling Rate

- **After every task commit:** Run the task's targeted `node --import tsx --test tests/<file>.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** `npm run check` must be green (lint + typecheck + build + tier-contract + tests + manifests)
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

> Filled by the planner per actual task breakdown. Pass 2/4 are advisory — their tests assert verdict shape + advisory isolation (never block), determinism for Pass 4 extraction, and tier parity.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-WAVE0 | 00 | 0 | VRFY-03, VRFY-06 | — | RED suite + 2 prompt-hash sentinels (claim-support, orphan-label) registered before prompt files land (WN-3) | unit | `npm test` | ❌ W0 | ⬜ pending |
| 05-PASS2 | — | — | VRFY-03 | — | Pass 2 verdicts ∈ {SUPPORTED,PARTIAL,UNSUPPORTED,UNCLEAR}; advisory side-channel never sets hasFail | unit (cassette) | `node --import tsx --test tests/pass2-claim-support.test.ts` | ❌ W0 | ⬜ pending |
| 05-PASS4 | — | — | VRFY-06 | — | Pass 4 extraction pure-Node deterministic (same input → same orphans, no LLM in extraction/orphan steps); LLM only advisory edge-labeling | unit | `node --import tsx --test tests/pass4-orphan-claim.test.ts` | ❌ W0 | ⬜ pending |
| 05-ADVISORY-ISOLATION | — | — | VRFY-03, VRFY-06 | — | Neither Pass 2 nor Pass 4 auto-blocks compile/export (blocking gate = Pass 1+3 only) | unit | `node --import tsx --test tests/verify-advisory-isolation.test.ts` | ❌ W0 | ⬜ pending |
| 05-TIER | — | — | VRFY-03, VRFY-06 | — | tier-contract: Pass 2 + Pass 4 verdicts equivalent (modulo prose) across both tiers | contract | `npm run test:tier-contract` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/pass2-claim-support.test.ts` — RED stubs for VRFY-03 (verdict enum + UNCLEAR-bias adversarial fixtures)
- [ ] `tests/pass4-orphan-claim.test.ts` — RED stubs for VRFY-06 (deterministic extraction + orphan detection)
- [ ] `tests/verify-advisory-isolation.test.ts` — RED stub proving advisory passes never block
- [ ] Offline cassettes for Pass 2 LLM judging + Pass 4 edge-label calls (≤51200 B each per D-25)
- [ ] `claim-support` + `orphan-label` prompt-hash sentinels registered in EXPECTED_PROMPT_HASHES (WN-3) before prompt files land
- [ ] D-13 chokepoint comment/lint in bin/cli/verify.ts updated to permit the two new slugs

*Existing node:test infrastructure covers the framework; Wave 0 only adds the new test files, cassettes, and hash sentinels.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pass 2 prompt calibration quality (UNCLEAR-bias on truly ambiguous claims) | VRFY-03 | Prompt-quality judgment is partly subjective | Inspect Pass 2 verdicts on the adversarial fixture set; confirm ambiguous claims trend UNCLEAR not UNSUPPORTED |

*All hard contracts (verdict enum, determinism, advisory isolation, tier parity) have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (new test files + cassettes + hash sentinels)
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter (after planner fills the per-task map)

**Approval:** pending
