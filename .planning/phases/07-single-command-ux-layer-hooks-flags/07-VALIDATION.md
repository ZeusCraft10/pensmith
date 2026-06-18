---
phase: 7
slug: single-command-ux-layer-hooks-flags
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-17
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in) via `node --import tsx --test` |
| **Config file** | scripts/run-tests.mjs (discovers tests/**/*.test.ts) |
| **Quick run command** | `node --import tsx --test tests/<file>.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~13 seconds (685 tests at Phase 6 close) |

---

## Sampling Rate

- **After every task commit:** Run the task's targeted `node --import tsx --test tests/<file>.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** `npm run check` must be green (lint + typecheck + build + tier-contract + tests + manifests)
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

> Filled/refined by the planner per actual task breakdown. Phase 7 is mostly WIRING — most primitives already exist. Tests assert routing/wiring correctness + tier parity + hook offline behavior; HOOK-03 (PostToolUse throttle) is already implemented (verify coverage, do not reimplement).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-WAVE0 | 00 | 0 | UX-01..05, HOOK-01..04 | — | RED suite for router + flags + hooks | unit | `npm test` | ❌ W0 | ⬜ pending |
| 07-ROUTER | — | — | UX-01 | — | bare /pensmith pure-fn router over STATE.json → correct next action (intake/resume/next/compile/done) | unit | `node --import tsx --test tests/pensmith-router.test.ts` | ❌ W0 | ⬜ pending |
| 07-VERBS | — | — | UX-02, UX-03 | — | all verb shortcuts work BOTH tiers; plumbing namespace; no 17th verb / 16-bijection intact | contract | `npm run test:tier-contract` | ✅ extend | ⬜ pending |
| 07-NL | — | — | UX-04, ERGO-01..04 | trigger ambiguity | NL triggers route via skill descriptions; inline corrections map to revise/plan code paths | unit | `node --import tsx --test tests/nl-triggers.test.ts` | ❌ W0 | ⬜ pending |
| 07-FLAGS | — | — | UX-05 | yolo-cap bypass | --dry-run zero external calls (cassette); --estimate token+USD; --yolo refuse >50% cap + default off; --show-prompts mirrors every prompt | unit | `node --import tsx --test tests/flags.test.ts` | ❌ W0 | ⬜ pending |
| 07-HOOKS | — | — | HOOK-01..04 | timeout/bloat | PreCompact <5KB HANDOFF in 10s; SessionStart auto-resume; PostToolUse ≤1/min mtime gate; Stop release lock + flush log | unit | `node --import tsx --test tests/hooks.test.ts` | partial | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/pensmith-router.test.ts` — RED stub for UX-01 (state→action decision table)
- [ ] `tests/nl-triggers.test.ts`, `tests/flags.test.ts` — RED stubs (UX-04/05, ERGO)
- [ ] `tests/hooks.test.ts` — RED stub extending the existing hook coverage (PreCompact HANDOFF <5KB/10s, SessionStart resume, Stop release+flush); HOOK-03 already covered
- [ ] tier-contract extension stub for verb-shortcut + plumbing-namespace parity
- [ ] Any cassette fixtures needed for --dry-run / --estimate offline tests

*Existing node:test infra covers the framework; HOOK-03 (PostToolUse) is already implemented + locked. Wave 0 adds the new test files only.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Claude Code hook firing (PreCompact/SessionStart/Stop in a real session) | HOOK-01/02/04 | Real hook events only fire inside an actual Claude Code session; CI runs the hook scripts directly with synthetic input | In a real session: trigger compaction, restart, and stop; confirm HANDOFF.json written <5KB, resume auto-invoked, lock released |
| Live NL-trigger routing inside chat | UX-04 | Skill-description routing is a model behavior; CI asserts the descriptions/registry, not live model routing | In chat: type "redo section 3" / "where am I?" and confirm correct skill invoked |

*All deterministic contracts (router pure-fn, flag behavior, hook-script offline behavior, tier parity) have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (new test files + any cassettes)
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter (after planner fills the per-task map)

**Approval:** pending
