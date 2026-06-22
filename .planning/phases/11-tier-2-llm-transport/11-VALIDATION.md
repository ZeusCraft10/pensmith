---
phase: 11
slug: tier-2-llm-transport
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-22
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (`node --import tsx --test`) |
| **Config file** | none — `scripts/run-tests.mjs` discovers `tests/**/*.test.ts` |
| **Quick run command** | `node --import tsx --test tests/llm-transport.test.ts` |
| **Full suite command** | `npm test` (or `npm run check` for lint+typecheck+build+test) |
| **Estimated runtime** | quick ~3s; full suite ~60–120s |

---

## Sampling Rate

- **After every task commit:** Run the quick command for the file(s) touched.
- **After every plan wave:** Run `npm test`.
- **Before `/gsd:verify-work`:** `npm run check` must be green (offline; `PENSMITH_NO_LLM=1` for any transport-touching test).
- **Max feedback latency:** ~120 seconds.

---

## Per-Task Verification Map

> Starter map — the planner refines per task. All transport tests run offline via the `PENSMITH_NO_LLM` seam + MockAgent; no live LLM call in CI.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-01-xx | 01 | 0 | GEN-01 | T-11-01 | RED scaffold: llm-transport test asserts chokepoint + no-leak + fail-loud (skip-guarded) | unit | `node --import tsx --test tests/llm-transport.test.ts` | ❌ W0 | ⬜ pending |
| 11-0x-xx | 0x | 1 | GEN-01 | T-11-01 | All LLM I/O routes via `http.ts`; resolved key value never in session log / stdout | unit | `node --import tsx --test tests/llm-transport.test.ts` | ❌ W0 | ⬜ pending |
| 11-0x-xx | 0x | 1 | GEN-01 | — | `assertBudget` fires before every transport call (cost-fixture) | unit | `node --import tsx --test tests/llm-transport.test.ts` | ❌ W0 | ⬜ pending |
| 11-0x-xx | 0x | 1 | GEN-06 | T-11-02 | No key configured → `MissingApiKeyError` → banner + non-zero exit; never `ok:true` empty | unit | `node --import tsx --test tests/llm-transport.test.ts` | ❌ W0 | ⬜ pending |
| 11-0x-xx | 0x | 2 | GEN-02 | — | Each of the 6 verbs calls the transport (PENSMITH_NO_LLM mock) → real artifact, no `tier2-placeholder` | integration | `node --import tsx --test tests/<verb>.test.ts` | ❌ W0 | ⬜ pending |
| 11-0x-xx | 0x | 2 | GEN-02 | — | Tier-contract test stays green under `PENSMITH_NO_LLM=1` (no key) | contract | `npm run test:tier-contract` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/llm-transport.test.ts` — RED-by-skip scaffold for the transport (chokepoint, no-leak, fail-loud, offline seam), skip-guarded on `existsSync(bin/lib/anthropic.ts)` so the suite stays green until the module lands.
- [ ] Mirror the `http-mock.ts` cassette / `MockAgent` seam so transport calls are deterministic offline.

*Existing infrastructure (node:test + run-tests.mjs + http-mock + MockAgent) covers everything else — no framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A live LLM call against a real provider key produces a non-empty completion | GEN-02 | Costs money + needs a real `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`; never run in CI | Set the key, run a generative verb in Tier 2 on a fixture assignment, confirm a real (non-placeholder) artifact is written |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
