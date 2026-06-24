---
phase: 12
slug: live-research-intake-bootstrap-humanizer-task
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-22
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (`node --import tsx --test`) |
| **Config file** | none — `scripts/run-tests.mjs` discovers `tests/**/*.test.ts` |
| **Quick run command** | `node --import tsx --test tests/research-discovery.test.ts tests/intake-bootstrap.test.ts tests/humanizer-task.test.ts` |
| **Full suite command** | `npm test` (or `npm run check`) |
| **Estimated runtime** | quick ~5s; full suite ~60–120s |

---

## Sampling Rate

- **After every task commit:** quick command for the file(s) touched.
- **After every plan wave:** `npm test`.
- **Before `/gsd:verify-work`:** `npm run check` green (offline: source cassettes + `PENSMITH_NO_LLM=1` + injected TaskRunner; ZERO live calls).
- **Max feedback latency:** ~120s.

---

## Per-Task Verification Map

> Starter map — planner refines per task. All paths offline: adapter cassettes (network) + `PENSMITH_NO_LLM` (LLM) + injected `TaskRunner` (humanizer).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-01-xx | 01 | 0 | GEN-03/04/05 | T-12-* | RED-by-skip scaffolds (research-discovery, intake-bootstrap, humanizer-task) | unit | quick command | ❌ W0 | ⬜ pending |
| 12-0x-xx | 0x | 1 | GEN-03 | T-12-01 | research returns ≥1 real deduped candidate (offline cassettes + PENSMITH_NO_LLM); no PLACEHOLDER_LIBRARY/tier2-placeholder marker | integration | `node --import tsx --test tests/research-discovery.test.ts` | ❌ W0 | ⬜ pending |
| 12-0x-xx | 0x | 1 | GEN-03 | T-12-02 | crossCheckRetractions runs BEFORE writeBibtex (D-15); all adapter network via http.ts cassettes | unit | research-discovery test | ❌ W0 | ⬜ pending |
| 12-0x-xx | 0x | 1 | GEN-04 | T-12-03 | intake writes .paper/STATE.json with non-null paperId ($schemaVersion 2); idempotent on re-run | integration | `node --import tsx --test tests/intake-bootstrap.test.ts` | ❌ W0 | ⬜ pending |
| 12-0x-xx | 0x | 1 | GEN-04 | T-12-04 | with STATE.json present, global-library registration + style-match proceed (no WARN-skip) | integration | intake-bootstrap test | ❌ W0 | ⬜ pending |
| 12-0x-xx | 0x | 2 | GEN-05 | T-12-05 | Tier-1 humanizer wrap calls injected TaskRunner + records before/after score; locked honest framing (no "undetectable") | unit | `node --import tsx --test tests/humanizer-task.test.ts` | ❌ W0 | ⬜ pending |
| 12-0x-xx | 0x | 2 | GEN-05 | T-12-06 | absent skill/Task (null runner) → clean skip banner, export continues (no failure) | unit | humanizer-task test | ❌ W0 | ⬜ pending |
| 12-0x-xx | 0x | 2 | GEN-03/04/05 | — | tier-contract stays green; full suite green | contract | `npm run test:tier-contract` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/research-discovery.test.ts` — RED-by-skip scaffold (live discovery, dedup, retraction-before-bibtex, no-placeholder) guarded on the discovery seam existing.
- [ ] `tests/intake-bootstrap.test.ts` — RED-by-skip scaffold (STATE.json + paperId, idempotency, WARN-skip-guards-flip).
- [ ] `tests/humanizer-task.test.ts` — RED-by-skip scaffold using the injectable `__setTaskRunnerForTest` seam (call-through + clean-skip-on-null).
- [ ] (Optional) `bin/lib/intake-parse.ts` if the planner extracts a shared INTAKE.md parser.

*Existing infra (node:test + cassettes + PENSMITH_NO_LLM + GPTZero cassette) covers the rest — no framework install.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A live research run against real adapter APIs returns real candidates | GEN-03 | Network + rate limits; CI is cassette-only | Set `PENSMITH_CONTACT_EMAIL`, run `pensmith research` on a fixture with `PENSMITH_NETWORK_TESTS=1` |
| A real Tier-1 Task invocation of the humanizer skill rewrites the draft | GEN-05 | Requires Claude Code Task runtime + the installed humanizer skill | In Claude Code (Tier 1), run `pensmith done` on a compiled draft, confirm humanize + before/after score |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
