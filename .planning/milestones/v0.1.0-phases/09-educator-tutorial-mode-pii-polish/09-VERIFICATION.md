---
phase: 09-educator-tutorial-mode-pii-polish
verified: 2026-06-20T00:00:00Z
status: passed
score: 3/3 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: null
  previous_score: null
  note: "Initial verification — no prior VERIFICATION.md existed."
---

# Phase 9: Educator/tutorial mode + PII polish Verification Report

**Phase Goal:** Educator/tutorial-mode end-state for `goal=learning` (annotated provenance, teaching wrappers) WITHOUT leaking `if (educator_mode)` blocks into Foundation or workflow bodies; PII redaction polished beyond regex-only.
**Verified:** 2026-06-20
**Status:** passed
**Re-verification:** No — initial verification
**Requirement:** ERGO-07

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | Intake `goal=learning` triggers tutorial-mode end-state with annotated per-claim provenance; `goal=draft`/`both` unchanged | ✓ VERIFIED | `bin/cli/goal.ts:154 renderLearningEndState` + `bin/lib/router.ts:175` hard-stop. Tests: `goal-learning-endstate.test.ts` "renderLearningEndState (H2): writes TUTORIAL.md with ≥1 per-claim line, no section written"; `tutorial-provenance.test.ts` "RESEARCH-stage per-claim (H2): research.done yields ≥1 citekey+claim line WITHOUT any section.written"; `goal-routing.test.ts` "DI: stopAfterResearch=false ... routes to OUTLINE (no draft/both regression)" + back-compat default test. |
| 2 | Educator-mode = observer/wrapper architecture; workflow bodies + Foundation libs contain ZERO `if (educator_mode)` branches | ✓ VERIFIED | `bin/lib/tutorial.ts` `TutorialSubscriber extends EventEmitter` is sole goal-aware lib; `router.ts` uses goal-agnostic `stopAfterResearch?` (line 121-127); `write-orchestrator.ts:88` optional `onSectionWritten?` callback (only guard: `if (opts.onSectionWritten)` at :190). Tests: `lint-tutorial-no-branch.test.ts` (3 tests incl. anti-rot self-test); `tutorial-observer.test.ts` "router goal-unawareness (H1): ... ZERO goal/learning/educator_mode tokens". My own grep of `bin/lib/**/*.ts` + `workflows/**/*.md` for the FORBIDDEN tokens: all matches are `//`/`*` comment lines (stripped by the gate) except `tutorial.ts`; workflows = ZERO matches. |
| 3 | PII redaction honors opt-in flag, runs BEFORE any LLM call, produces a deterministic reviewable diff | ✓ VERIFIED | `bin/cli/intake.ts:362 resolvePiiRedact` (opt-in, arg wins), PII block at :380-391 runs before `loadPrompt('intake-clarifier')` at :434; `egressSeed = redacted` (:390) is the value passed to `_interpolate(prompt, { assignment: egressSeed })` (:438). `bin/lib/pii.ts:271 diffPii` pure/deterministic/idempotent. Tests: `intake-pii-egress.test.ts` "EGRESS-BY-CONTENT: no raw PII sentinel survives in the model-bound interpolate payload"; `intake-pii-ordering.test.ts`; `pii-polish.test.ts` (diffPii deterministic + idempotent + pure, IP/IBAN, NAME suppression). |

**Score:** 3/3 truths verified

### Structural Confirmations (A–E)

**A. ZERO-BRANCH (SC-2 non-negotiable) — CONFIRMED.**
`bin/lib/**/*.ts` (router.ts INCLUDED; only `tutorial.ts` excluded) and `workflows/**/*.md` contain ZERO `educator_mode`/`goal`/`learning`/`TutorialSubscriber` tokens in CODE. Verified three ways: (1) the standing grep invariant `tests/lint-tutorial-no-branch.test.ts` passes (case-insensitive FORBIDDEN regex, comment-stripped, with an anti-rot self-test asserting the pattern fires on `if (goal === 'learning')`, `switch (goal)`, `educator_mode`, `isLearningGoal`, `new TutorialSubscriber`); it explicitly asserts `router.ts` is in scope (no exclusion). (2) Read `router.ts` — the ONLY seam is the FEATURE-AGNOSTIC `ResolveOptions { stopAfterResearch? }` (line 121-127); the hard-stop at :175 reads the plain boolean, never `goal`. (3) Read `write-orchestrator.ts` — the only seam is the additive optional `onSectionWritten?` callback (:88), guarded solely by `if (opts.onSectionWritten)` (:190) — a callback-invocation, not a mode branch. My independent grep: every non-tutorial match is a `//`/`*` comment (`router.ts:119`, `write-orchestrator.ts:58/85/86`, `prompt-loader.ts:133-134`, `drafter-input.ts:30` "word-count goal"); workflows = zero.

**B. OBSERVER / DI (SC-2) — CONFIRMED.**
`TutorialSubscriber` lives ONLY in `bin/lib/tutorial.ts` (`class TutorialSubscriber extends`-style EventEmitter wrapper, :126) and is imported ONLY by `bin/cli/goal.ts:28` (CLI tier). Foundation (`write-orchestrator.ts`) accepts the optional `SectionWrittenCallback` and never imports `tutorial.ts`. The zero-branch mechanism is the asymmetric construction: `draft` never constructs a subscriber (TutorialGoal = `'learning' | 'both'`, :47), so the rest of Foundation stays goal-unaware. `emit()` is never-throw (:187-193, swallows malformed payloads — verified by "never-throw: a malformed payload to emit() does not throw").

**C. goal=learning PROVENANCE (SC-1) — CONFIRMED.**
`goal=learning` hard-stops AFTER research (`router.ts:169` research-gate, then :175 stop-if-stopAfterResearch) AND produces per-claim provenance from research-stage data (`goal.ts:101 buildResearchDonePayload` reads LIBRARY.json + RESEARCH.md; :81 `parseResearchClaims` parses real `supports:` blocks) with NO section written (`renderLearningEndState` emits `research.done` only, never `section.written`). The `tutorial-provenance.test.ts` RESEARCH-stage test asserts ≥1 citekey+claim line WITHOUT any section.written. `goal=draft/both` DRAFT.md path is byte-unchanged: router default `{}` is byte-identical to the prior no-arg behavior (`goal-routing.test.ts` back-compat default test + the stopAfterResearch=false → OUTLINE test both pass).

**D. PII EGRESS (SC-3) — CONFIRMED.**
The REDACTED text (not raw answers) is the value interpolated into the LLM payload: `intake.ts:390 egressSeed = redacted` → `:438 _interpolate(prompt, { assignment: egressSeed })`. The PII block (`:380-391`) is STRUCTURALLY before `loadPrompt('intake-clarifier')` (`:434`) and the interpolate (`:438`). `diffPii` produces a deterministic reviewable diff printed per span (`:384-386`). `redactPii` idempotent (already-redacted text → empty diff). Tests confirm by CONTENT: `intake-pii-egress.test.ts` asserts no raw sentinel in the captured payload + `[REDACTED:KIND]` present (intercepted via the `__setInterpolateForTest` in-module seam, forced by sealed ESM namespaces under Node 24); `intake-pii-ordering.test.ts` asserts diffPii precedes loadPrompt + raw→INTAKE.raw.local; `pii-polish.test.ts` asserts diffPii determinism/idempotence/purity + no-leak property.

**E. PII polish pure-Node + TUTORIAL.md export-exclusion + no 17th verb + WN-3 re-pin — CONFIRMED.**
PII polish is pure-Node deterministic: `pii.ts` adds `RE_IP` (:67) + `RE_IBAN_LIKE` (:74) BEFORE NAME, and a ~500-token `NAME_SUPPRESSION` set from a statically-imported `name-suppression.json` (:34, :89) — NO NLP dependency, no runtime I/O. TUTORIAL.md is EXCLUDED from exports (DONE-07): `exporter.ts:450 exportDraft` reads ONLY `inputPath` (:456, :479/483/492/512) and never enumerates `.paper/`, so a sibling TUTORIAL.md cannot leak — `zero-trace Test G` passes. NO 17th verb: `goal` is a `--goal` arg on `new` (`intake.ts:313`), `--pii-redact` an arg (:323); `tier-contract.test.ts` "16-verb bijection re-asserted" + "no 17th verb" both pass. WN-3 re-pinned: `prompt-loader.ts:142-143` and `repo-files.test.ts:342-343` carry the SAME real SHA-256 (`de2ef689...`, `c39d74a3...`) — not `__PENDING_HASH_*` sentinels; the byte-pin drift check is active; `npm run check` is green WITHOUT `PENSMITH_ALLOW_PENDING_PROMPT_HASHES`.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `bin/lib/tutorial.ts` | TutorialSubscriber observer | ✓ VERIFIED | EventEmitter wrapper, idempotent overwrite render, never-throw, confinement to tutorialPath; sole goal-aware module |
| `bin/lib/router.ts` | goal-agnostic DI hard-stop | ✓ VERIFIED | `ResolveOptions { stopAfterResearch? }`; zero goal tokens; default `{}` byte-unchanged |
| `bin/cli/goal.ts` | goal→behavior mapping + end-state | ✓ VERIFIED | readGoalFromConfig + stopAfterResearchFor + parseResearchClaims + buildResearchDonePayload + renderLearningEndState |
| `bin/lib/pii.ts` | IP/IBAN + NAME suppression + diffPii | ✓ VERIFIED | pure-Node, no NLP; diffPii deterministic/idempotent/pure |
| `bin/cli/intake.ts` | `--goal`/`--pii-redact` args + PII-before-LLM egress | ✓ VERIFIED | egressSeed=redacted is the interpolate payload; PII block before loadPrompt |
| `bin/lib/write-orchestrator.ts` | additive onSectionWritten? seam | ✓ VERIFIED | optional callback, single `if (opts.onSectionWritten)` guard; no goal awareness |
| `bin/lib/exporter.ts` | TUTORIAL.md export-exclusion | ✓ VERIFIED | reads only inputPath; zero-trace Test G passes |
| `bin/lib/prompt-loader.ts` | WN-3 real hash re-pin | ✓ VERIFIED | 2 tutorial slugs carry real SHA-256, lockstep with repo-files.test.ts |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| pensmith.ts / next.ts / resume.ts / status.ts | router.resolveNextAction | stopAfterResearchFor(readGoalFromConfig(...)) → { stopAfterResearch } | ✓ WIRED | 4 callers (pensmith.ts:311-312, next.ts:35-36, resume.ts:60-61, status.ts:71-72) |
| pensmith.ts / next.ts / resume.ts | renderLearningEndState | called at the hard-stop terminal | ✓ WIRED | 3 action-takers (pensmith.ts:317, next.ts:42, resume.ts:67); status.ts read-only |
| intake.ts | pii.ts | redactPii + diffPii before loadPrompt; egressSeed=redacted into interpolate | ✓ WIRED | intake.ts:381-390 → :438 |
| goal.ts | tutorial.ts | new TutorialSubscriber + emit('research.done') | ✓ WIRED | goal.ts:157-162 |
| write-orchestrator.ts | onSectionWritten callback | invoked once per fulfilled section | ✓ WIRED | write-orchestrator.ts:190-197 |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Phase-9 tutorial/goal suites | `node --import tsx --test tests/{lint-tutorial-no-branch,tutorial-observer,tutorial-provenance,goal-routing,goal-learning-endstate}.test.ts` | 21 pass, 0 fail, 0 skip | ✓ PASS |
| PII suites | `node --import tsx --test tests/{pii-polish,intake-pii-ordering,intake-pii-egress}.test.ts` | 11 pass, 0 fail, 0 skip | ✓ PASS |
| WN-3 + export + tier-contract | `node --import tsx --test tests/{repo-files,zero-trace-export,tier-contract}.test.ts` | 98 pass, 0 fail, 0 skip | ✓ PASS |
| Full gate | `npm run check` | 822 tests pass, 0 fail, 0 skip; lint+tsc+build+manifests OK; exit 0 (no PENSMITH_ALLOW_PENDING_PROMPT_HASHES) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| ERGO-07 | 09-00..09-03 | Educator/tutorial mode — `goal ∈ {draft,learning,both}`; `learning` triggers tutorial-mode end-state with annotated provenance | ✓ SATISFIED | SC-1/2/3 all VERIFIED; A–E confirmed; 822-test gate green |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | No `TBD`/`FIXME`/`XXX` debt markers in phase-modified files; the `goal`/`learning` tokens flagged by raw grep are all in `//`/`*` comments and stripped by the standing gate | ℹ️ Info | None — zero blockers |

### Human Verification Required

None. All success criteria are verifiable programmatically (structural invariants, content-level egress assertions, deterministic PII behavior, byte-stable artifacts). No visual/real-time/external-service behavior is in scope for this phase.

### Accepted MEDIUMs (informational)

- **renderLearningEndState idempotence:** the render is OVERWRITE (keyed in-memory block Map rewritten via atomicWriteFile, `tutorial.ts:316-344`), so re-running produces byte-stable TUTORIAL.md — confirmed by the "idempotence: re-emitting the same events produces byte-stable TUTORIAL.md" test. Accepted as designed.
- **RESEARCH.md parse glue:** `parseResearchClaims`/`buildResearchDonePayload` (`goal.ts:81/101`) build the research.done payload from REAL research-stage data (LIBRARY.json + RESEARCH.md `supports:` lines), not a stub — confirmed by the execution-level "parseResearchClaims parses a REAL RESEARCH.md supports: block" + "buildResearchDonePayload merges LIBRARY.json sources + RESEARCH.md claims" tests. Accepted as designed.

### Gaps Summary

No gaps. All 3 success criteria are VERIFIED with file:line + passing-test evidence; structural invariants A–E independently confirmed (own grep + reading router/write-orchestrator/exporter source + running the suites); the full `npm run check` gate exits 0 with 822/822 tests and no pending-hash bypass. The architecture holds the non-negotiables: router/Foundation/workflows stay goal-unaware, the TutorialSubscriber observer is the sole goal-aware seam, PII redaction is opt-in/before-LLM/by-content/deterministic, TUTORIAL.md is export-excluded, and the 16-verb bijection is intact (goal is an arg).

---

_Verified: 2026-06-20_
_Verifier: Claude (gsd-verifier)_
