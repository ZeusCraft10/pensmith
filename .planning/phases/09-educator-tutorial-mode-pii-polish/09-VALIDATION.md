---
phase: 9
slug: educator-tutorial-mode-pii-polish
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-20
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in) via `node --import tsx --test` |
| **Config file** | scripts/run-tests.mjs (discovers tests/**/*.test.ts) |
| **Quick run command** | `node --import tsx --test tests/<file>.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~14 seconds (785 tests at Phase 8 close) |

---

## Sampling Rate

- **After every task commit:** Run the task's targeted `node --import tsx --test tests/<file>.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** `npm run check` must be green (lint + typecheck + build + tier-contract + tests + manifests)
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

> Filled/refined by the planner. The architectural non-negotiable (zero `if (educator_mode)` branches in Foundation/workflows; observer/DI pattern) is itself a TESTABLE invariant (grep-style assertion). PII polish is pure-Node deterministic.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-WAVE0 | 00 | 0 | ERGO-07 | — | RED suites for tutorial subscriber + goal routing + PII diff + zero-branch invariant | unit | `npm test` | ❌ W0 | ⬜ pending |
| 09-OBSERVER | — | — | ERGO-07 | branch leakage | TutorialSubscriber (observer) lives in bin/cli/* only; Foundation libs + workflow bodies contain ZERO `if (educator_mode)`/`goal===` branches (grep-assertion test) | unit | `node --import tsx --test tests/tutorial-observer.test.ts` | ❌ W0 | ⬜ pending |
| 09-GOAL | — | — | ERGO-07 | draft/both regression | goal=learning triggers tutorial end-state (annotated provenance per claim, hard-stop after research per PRD §7.13); goal=draft / goal=both BYTE-UNCHANGED | unit | `node --import tsx --test tests/goal-routing.test.ts` | ❌ W0 | ⬜ pending |
| 09-PROVENANCE | — | — | ERGO-07 | — | annotated source provenance per claim rendered from assigned_sources (TUTORIAL.md); excluded from all exports (DONE-07 zero-trace) | unit | `node --import tsx --test tests/tutorial-provenance.test.ts` | ❌ W0 | ⬜ pending |
| 09-PII | — | — | ERGO-07 | PII egress | PII redaction opt-in; runs BEFORE any LLM/network call; pure-Node deterministic (dictionary + patterns, no NLP); diffPii() deterministic reviewable diff | unit | `node --import tsx --test tests/pii-polish.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/tutorial-observer.test.ts` — RED: observer wiring + the zero-branch invariant (no `if (educator_mode)`/`goal===` in bin/lib/** or workflows/**)
- [ ] `tests/goal-routing.test.ts` — RED: goal enum (draft|learning|both); goal=learning end-state; draft/both unchanged
- [ ] `tests/tutorial-provenance.test.ts` — RED: per-claim provenance from assigned_sources; TUTORIAL.md excluded from exports
- [ ] `tests/pii-polish.test.ts` — RED: opt-in + pre-LLM ordering + deterministic diffPii
- [ ] Fixtures: a paper fixture with assigned_sources for provenance; PII sample text with names/IP/IBAN-like tokens + the suppression-dictionary false-positive cases

*No new external deps (per research — pure-Node patterns + dictionary; Presidio/NLP deferred to v2 per PII-V2-01). Wave 0 adds the new test files + fixtures only.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live goal=learning end-to-end tutorial render in a real session | ERGO-07 | Full intake→research→tutorial end-state needs a live LLM session; CI asserts the subscriber wiring + provenance rendering on fixtures | In a real session: `pensmith intake --goal learning`, run through research, confirm the tutorial end-state shows annotated provenance per claim and hard-stops after research |

*All deterministic contracts (zero-branch invariant, goal routing + draft/both no-regression, provenance render from assigned_sources, PII opt-in + pre-LLM + deterministic diff) have automated offline verification.*

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (new test files + fixtures)
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter (after planner fills the per-task map)

**Approval:** pending
