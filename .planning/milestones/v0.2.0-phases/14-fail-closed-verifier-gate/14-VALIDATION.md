---
phase: 14
slug: fail-closed-verifier-gate
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-22
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (`node --import tsx --test`) |
| **Config file** | none — `scripts/run-tests.mjs` discovers `tests/**/*.test.ts` |
| **Quick run command** | `node --import tsx --test tests/verdict-rows.test.ts tests/compile-refuse.test.ts tests/gate-retraction.test.ts tests/done-recheck.test.ts` |
| **Full suite command** | `npm test` (or `npm run check`) |
| **Estimated runtime** | quick ~5s; full suite ~60–120s |

---

## Sampling Rate

- **After every task commit:** quick command for the file(s) touched.
- **After every plan wave:** `npm test`.
- **Before `/gsd:verify-work`:** `npm run check` green. All four gates are offline-testable (fixtures + the `fetchById-fake.json` retraction cassette + `PENSMITH_NO_LLM`).
- **Max feedback latency:** ~120s.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 14-01-xx | 01 | 0 | GATE-01/02/03/04 | T-14-* | RED-by-skip scaffolds for all four gates | unit | quick command | ❌ W0 | ⬜ pending |
| 14-0x-xx | 0x | 1 | GATE-02 | T-14-02 | writer→parser round-trip: render blocking citekey set → parse → identical set (drift breaks test) | unit | `node --import tsx --test tests/verdict-rows.test.ts` | ❌ W0 | ⬜ pending |
| 14-0x-xx | 0x | 1 | GATE-01 | T-14-01 | compile REFUSES on absent/empty/no-Status VERIFICATION.md (never "clean") | unit | `node --import tsx --test tests/compile-refuse.test.ts` | ❌ W0 | ⬜ pending |
| 14-0x-xx | 0x | 1 | GATE-03 | T-14-03 | live-retracted DOI (cassette) → MIS-CITED blocking; transport error → silent skip (no false block) | unit | `node --import tsx --test tests/gate-retraction.test.ts` | ❌ W0 | ⬜ pending |
| 14-0x-xx | 0x | 1 | GATE-04 | T-14-04 | humanized FINAL.md with added/dropped/swapped citekey OR broken quote → export blocked; clean → passes; no FINAL.md → skip | unit | `node --import tsx --test tests/done-recheck.test.ts` | ❌ W0 | ⬜ pending |
| 14-0x-xx | 0x | 1 | GATE-01..04 | — | tier-contract green; full suite green | contract | `npm run test:tier-contract` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/verdict-rows.test.ts` — round-trip render↔parse scaffold (GATE-02).
- [ ] `tests/compile-refuse.test.ts` extension OR new — absent/empty/no-Status VERIFICATION refuses (GATE-01).
- [ ] `tests/gate-retraction.test.ts` — live-retraction-blocks + transport-error-skips (GATE-03), driven by the `fetchById-fake.json` cassette (10.0000/test → retracted).
- [ ] `tests/done-recheck.test.ts` — FINAL.md citekey-diff + Pass-3 re-check (GATE-04).
- [ ] (If chosen) a no-VERIFICATION section fixture + a tampered-FINAL.md fixture.

*Existing infra (node:test + cassettes + fixtures + PENSMITH_NO_LLM) covers the rest — no framework install. Wave-0 scaffold path resolution uses fileURLToPath (spaced-path safe, Phase-11 lesson).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A real DOI retracted after research is caught at verify time against live Retraction Watch | GATE-03 | Live network; CI is cassette-only | Run `pensmith verify <N>` with `PENSMITH_NETWORK_TESTS=1` on a real retracted DOI |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
