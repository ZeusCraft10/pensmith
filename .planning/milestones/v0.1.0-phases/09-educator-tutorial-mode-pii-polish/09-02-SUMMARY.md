---
phase: 09-educator-tutorial-mode-pii-polish
plan: 02
subsystem: tutorial-mode (observer/DI architecture + per-claim provenance render)
tags: [tutorial, educator-mode, observer, dependency-injection, zero-branch, provenance, idempotence, ergo-07]

# Dependency graph
requires:
  - phase: 09-00
    provides: "TutorialSubscriber stub + RED-by-skip tutorial-observer/provenance tests + tutorial-paper fixtures + zero-branch invariant test"
  - phase: 04-03
    provides: "runAllSections wave orchestrator + RunAllSectionsOpts (the seam host)"
  - phase: 01-09
    provides: "session-log.ts enqueue-chain never-throw pattern + atomic-write.ts (atomicWriteFile D-07 chokepoint)"
provides:
  - "Full TutorialSubscriber: research.done (learning end-state, per-claim provenance from sources+claims, no section needed — H2 fix) + section.written (goal=both per-section source provenance) renders, ordered idempotent overwrite via atomicWriteFile, never-throw emit, flush() drain"
  - "Additive GOAL-UNAWARE onSectionWritten? seam in write-orchestrator.ts (one callback-invocation guard, zero goal tokens)"
  - "CLI-tier goal-aware wiring in write.ts: readGoalFromConfig + makeSubscriberNonFatal + subscriber.emit + flush (wave + single-section paths)"
  - "Idempotence test: re-emitting the same events yields byte-stable TUTORIAL.md"
affects: ["09-03 (router DI stopAfterResearch + research.done emit at the learning hard-stop + intake PII wiring + prompt re-pin + export-exclusion)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Observer/DI seam: Foundation gains ONE additive goal-UNAWARE callback (onSectionWritten?); the optional-chain/conditional-spread in the CLI tier is the entire zero-branch mechanism (goal=draft ⇒ key omitted ⇒ no-op)"
    - "Idempotent render: ordered in-memory block Map (key→markdown) + full-document atomicWriteFile rewrite per emit ⇒ re-emission overwrites by key, distinct events accumulate in emission order, re-running is byte-stable"
    - "Never-throw observer: EventEmitter dispatch + render both swallow so the observed verb is never disrupted (session-log makeLogger.emit contract)"

key-files:
  created:
    - .planning/phases/09-educator-tutorial-mode-pii-polish/09-02-SUMMARY.md
  modified:
    - bin/lib/tutorial.ts
    - bin/lib/write-orchestrator.ts
    - bin/cli/write.ts
    - tests/tutorial-provenance.test.ts

key-decisions:
  - "research.done render reads BOTH payload shapes: sources[].supportedClaim (plan shape) AND a sibling claims[] array keyed by citekey (the 09-00 fixture shape) — merged so the H2 test's separate-claims fixture and the plan's inline-claim shape both produce per-claim lines"
  - "Idempotence via ordered block Map + full-document rewrite (overwrite), NOT blind append — re-running write produces identical TUTORIAL.md; added a dedicated idempotence test"
  - "Single-section write also constructs the subscriber + emits + flushes (so a learning/both re-do re-annotates), reading assigned_sources best-effort from the section PLAN.md; DRAFT.md stays byte-unchanged because the writer never sees the subscriber"
  - "exactOptionalPropertyTypes: passed onSectionWritten via conditional spread (key omitted when no subscriber) instead of an explicit `undefined`"

patterns-established:
  - "Defense-in-depth path-leak strip: every rendered block runs `.replace(/\\.paper[\\\\/]sections[\\\\/]\\S*/g, '[section]')` before storage so TUTORIAL.md can never name a section path even if a payload carried one"
  - "Goal-read lives ONLY in the CLI tier (readGoalFromConfig); identical logic earmarked for the 09-03 router-DI goal-read so a future shared util collapses cleanly"

requirements-completed: [ERGO-07]

# Metrics
duration: 18min
completed: 2026-06-20
---

# Phase 9 Plan 02: TutorialSubscriber Observer + onSectionWritten? DI Seam + Per-Claim Provenance Summary

**Full TutorialSubscriber rendering per-claim source provenance to TUTORIAL.md at BOTH the research hard-stop (learning end-state, no section needed) and per section (goal=both), behind an additive goal-UNAWARE onSectionWritten? seam in Foundation and a CLI-tier goal-aware subscriber.emit — idempotent overwrite, never-throw, zero-branch invariant intact.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-06-20T09:38Z
- **Completed:** 2026-06-20T09:56Z
- **Tasks:** 2
- **Files modified:** 4 (3 source + 1 test)

## Accomplishments
- Implemented the full `TutorialSubscriber`: EventEmitter-wired handlers for `research.done`, `section.written`, `outline.done`, `section.verified`, `compile.done`; the research.done handler renders per-claim provenance from RESEARCH-stage data (closing the H2 contradiction — learning mode produces annotated provenance at its hard-stop, before any section exists).
- Render is IDEMPOTENT (ordered block Map + full-document `atomicWriteFile` rewrite) — re-running produces byte-stable TUTORIAL.md; added a dedicated idempotence test.
- Added the additive GOAL-UNAWARE `onSectionWritten?` callback seam to `write-orchestrator.ts` — exactly ONE callback-invocation guard, ZERO `goal`/`learning`/`educator_mode`/`TutorialSubscriber` tokens; the zero-branch invariant (scanning all `bin/lib/**` incl router.ts) stays green.
- Wired the CLI-tier goal awareness in `write.ts` (`readGoalFromConfig` + `makeSubscriberNonFatal` + `subscriber.emit`/`flush`) for both wave and single-section paths; goal=draft yields no subscriber (zero-activation) and DRAFT.md is byte-unchanged across all goals.

## Task Commits

Each task was committed atomically:

1. **Task 1: Full TutorialSubscriber (SECTION + RESEARCH per-claim provenance, enqueue chain, never-throw, flush, idempotent)** - `41c2956` (feat)
2. **Task 2: Additive onSectionWritten? seam in write-orchestrator + goal-aware emit in write.ts** - `b021d45` (feat)

**Plan metadata:** _(this docs commit)_

## Files Created/Modified
- `bin/lib/tutorial.ts` - Full TutorialSubscriber: per-kind EventEmitter handlers, research.done + section.written per-claim provenance renders, ordered idempotent overwrite via atomicWriteFile, never-throw emit, flush() drain, path-leak strip.
- `bin/lib/write-orchestrator.ts` - Added `SectionWrittenCallback` type + optional `onSectionWritten?` field to `RunAllSectionsOpts`; one callback-invocation guard in the fulfilled branch passing assigned_sources from the plans map (goal-unaware).
- `bin/cli/write.ts` - `readGoalFromConfig` (config.toml `[project] goal`, default draft), `makeSubscriberNonFatal`, `readAssignedSources`; subscriber construction + `onSectionWritten` (conditional spread) + post-loop flush in wave mode; emit + flush in single-section mode.
- `tests/tutorial-provenance.test.ts` - Added the idempotence test (re-emit ⇒ byte-stable TUTORIAL.md, no occurrence-count growth).

## Decisions Made
- **Dual research.done payload shape.** The plan describes `sources[].supportedClaim`; the 09-00 fixture (read by the H2 test) supplies `{ sources: SourceCandidate[], claims: [{citekey, claim}] }` with claim text in a sibling array. The render merges both: each source's claim is taken from its own `supportedClaim` field OR the matching `claims` entry by citekey. This makes the committed fixture's H2 test pass while honoring the plan's inline-claim contract for 09-03's CLI caller.
- **Idempotence via overwrite, not append.** Per the convergence MEDIUM, blocks live in an insertion-ordered Map keyed by event identity (`research.done`, `section.written:<n>`, etc.); every emit rewrites the whole document. Re-emission overwrites by key (no duplication); distinct events accumulate in emission order.
- **Single-section subscriber wiring.** `pensmith write <n>` in learning/both mode now re-annotates TUTORIAL.md (emit + flush), reading `assigned_sources` best-effort from the section PLAN.md. The DRAFT.md writer (`writeOneSection`) is untouched and never sees the subscriber, so DRAFT.md bytes are identical for every goal.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] research.done render must consume the fixture's sibling `claims[]` array, not only `sources[].supportedClaim`**
- **Found during:** Task 1 (RESEARCH-stage per-claim H2 test)
- **Issue:** The plan's action text describes the payload as `sources: Array<{ citekey, supportedClaim, ... }>`, but the committed 09-00 fixture/test (`researchDonePayload()` in tutorial-provenance.test.ts) builds `{ sources: LIBRARY.json[], claims: [{citekey, claim}] }` — the claim text lives in a separate `claims` array keyed by citekey, and the LIBRARY.json sources carry NO `supportedClaim` field. A verbatim implementation reading only `sources[].supportedClaim` would render zero claim text and fail the H2 assertion.
- **Fix:** The render builds a `citekey → claim` map from `payload.claims` and falls back to it when a source lacks its own `supportedClaim`, so both the plan's inline shape and the fixture's sibling-array shape produce per-claim lines.
- **Files modified:** bin/lib/tutorial.ts
- **Verification:** RESEARCH-stage per-claim test green (≥1 citekey+claim line from research.done with NO section.written).
- **Committed in:** 41c2956 (Task 1 commit)

**2. [Rule 3 - Blocking] exactOptionalPropertyTypes rejected `onSectionWritten: undefined`**
- **Found during:** Task 2 (write.ts wiring)
- **Issue:** With `exactOptionalPropertyTypes: true`, passing `onSectionWritten: subscriber ? fn : undefined` is a type error — `undefined` is not assignable to the optional `SectionWrittenCallback` property.
- **Fix:** Used a conditional spread (`...(subscriber ? { onSectionWritten: fn } : {})`) so the key is OMITTED entirely when there is no subscriber — the same pattern already used for `styleProfile`/`styleProfilePath` in this file. This is also semantically cleaner (the zero-branch no-op is "key absent", not "key undefined").
- **Files modified:** bin/cli/write.ts
- **Verification:** `tsc --noEmit` clean.
- **Committed in:** b021d45 (Task 2 commit)

**3. [Rule 2 - Missing Critical] Added a defense-in-depth path-leak strip + idempotence test**
- **Found during:** Task 1
- **Issue:** (a) The confinement contract requires TUTORIAL.md never contain a `.paper/sections/` path; relying solely on "we never render one" is fragile if a future payload carries one. (b) The convergence context mandates an idempotence test, which 09-00 did not ship.
- **Fix:** (a) Every block runs `.replace(/\.paper[\\/]sections[\\/]\S*/g, '[section]')` before storage. (b) Added an idempotence test (render twice ⇒ identical bytes, occurrence count stable).
- **Files modified:** bin/lib/tutorial.ts, tests/tutorial-provenance.test.ts
- **Verification:** `.paper/sections/` test green; idempotence test green.
- **Committed in:** 41c2956 (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (1 bug, 1 blocking, 1 missing-critical/hardening)
**Impact on plan:** All necessary for correctness (H2 fix), compilation (exactOptionalPropertyTypes), and the convergence-mandated idempotence + confinement guarantees. No scope creep — the learning-mode research.done EMIT site (router hard-stop) remains 09-03 as planned; write.ts owns only the section-stage path.

## Issues Encountered
None beyond the deviations above. The zero-branch invariant constrained the design (no goal awareness in write-orchestrator.ts) — satisfied by keeping the seam a pure callback-invocation guard and confining all goal logic to write.ts (CLI tier).

## User Setup Required
None - no external service configuration required.

## Threat Flags
None — no new security surface beyond the threat_model already enumerated. The subscriber writes ONLY to TUTORIAL.md (confined, path-leak stripped), emit never throws (DoS mitigation), and goal=draft constructs no subscriber.

## Next Phase Readiness
- 09-03 can now emit `research.done` into a TutorialSubscriber at the router hard-stop (the render is complete and tested for the no-section learning path).
- 09-03 owns: router `stopAfterResearch` DI param (still RED-by-skip), the research.done emit at the learning hard-stop, intake PII wiring, the two tutorial prompt hash re-pins (still `__PENDING_HASH_*` sentinels), and the export-exclusion test for TUTORIAL.md.
- Zero-branch invariant + router goal-unawareness (H1) remain green; full suite 806 pass / 0 fail / 11 skipped (all 11 = 09-03 RED-by-skip).

## Self-Check: PASSED
- All modified/created files verified present on disk (09-02-SUMMARY.md, bin/lib/tutorial.ts, bin/lib/write-orchestrator.ts, bin/cli/write.ts).
- Commits 41c2956, b021d45 verified in git log.

---
*Phase: 09-educator-tutorial-mode-pii-polish*
*Completed: 2026-06-20*
