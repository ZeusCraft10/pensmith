---
phase: 09-educator-tutorial-mode-pii-polish
plan: 03
subsystem: educator-mode end-to-end wiring (goal + PII egress + router DI + export-exclusion + WN-3 re-pin)
tags: [educator-mode, goal, pii, redaction, egress, router-di, dependency-injection, tutorial, export-exclusion, wn-3, ergo-07]

# Dependency graph
requires:
  - phase: 09-00
    provides: "RED-by-skip goal-routing/intake-pii-ordering/intake-pii-egress/tutorial-provenance suites + zero-branch invariant + WN-3 __PENDING_HASH_* sentinels + tutorial-paper fixtures"
  - phase: 09-01
    provides: "bin/lib/pii.ts redactPii + diffPii (PiiDiff {span,kind,raw,tag})"
  - phase: 09-02
    provides: "Full TutorialSubscriber (research.done per-claim render) + onSectionWritten? DI seam + write.ts local readGoalFromConfig"
  - phase: 07-02
    provides: "resolveNextAction never-throw router + the four goal-aware callers (pensmith/next/resume/status)"
  - phase: 03-07
    provides: "bin/cli/intake.ts interpolate egress seam + config.toml read pattern"
provides:
  - "intake --goal (draft|learning|both) persisted to config.toml [project] goal via atomicWriteFile (non-fatal, in-memory fallback on persist failure)"
  - "intake opt-in PII: redactPii+diffPii BEFORE loadPrompt('intake-clarifier'); redacted egressSeed is the interpolate payload (H3 egress-by-content); raw -> INTAKE.raw.local, redacted -> INTAKE.md"
  - "bin/lib/router.ts goal-AGNOSTIC ResolveOptions { stopAfterResearch? } DI param (router stays goal-unaware — zero-branch invariant scans it clean)"
  - "bin/cli/goal.ts: readGoalFromConfig (single shared helper) + stopAfterResearchFor (the ONLY goal->behavior mapping) + parseResearchClaims/buildResearchDonePayload + renderLearningEndState (H2 end-state)"
  - "4-caller wiring: next/resume/pensmith.ts render the learning end-state at the hard-stop; status reflects it read-only; write.ts deduped onto the shared goal helper"
  - "TUTORIAL.md export-exclusion test (zero-trace Test G, DONE-07)"
  - "WN-3 atomic re-pin: both tutorial prompt slugs carry real SHA-256 across prompt-loader.ts + repo-files.test.ts — no PENSMITH_ALLOW_PENDING_PROMPT_HASHES needed"
affects: ["09 phase close (ERGO-07 complete)", "future educator-mode Tier-1 workflow wiring"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Goal-agnostic DI: the router takes a plain stopAfterResearch flag; the goal->behavior mapping lives ONLY in the CLI tier (bin/cli/goal.ts), keeping Foundation goal-unaware (H1 zero-branch)"
    - "Egress-by-content via an in-module replaceable seam (__setInterpolateForTest): native ESM module namespaces are sealed under Node 24, so the spy must intercept inside intake, not on the prompt-loader namespace"
    - "Single shared goal-read helper consumed by 5 CLI call sites (write + 4 router callers) — L5 dedup"
    - "RESEARCH.md->payload parse glue (parseResearchClaims/buildResearchDonePayload) builds the research.done payload from real research-stage data (LIBRARY.json + RESEARCH.md supports: lines)"

key-files:
  created:
    - bin/cli/goal.ts
    - tests/goal-learning-endstate.test.ts
  modified:
    - bin/cli/intake.ts
    - bin/lib/router.ts
    - bin/pensmith.ts
    - bin/cli/next.ts
    - bin/cli/resume.ts
    - bin/cli/status.ts
    - bin/cli/write.ts
    - bin/lib/prompt-loader.ts
    - tests/intake-pii-egress.test.ts
    - tests/goal-routing.test.ts
    - tests/zero-trace-export.test.ts
    - tests/repo-files.test.ts
    - tests/lint-tutorial-no-branch.test.ts
    - eslint.config.js

key-decisions:
  - "router param is goal-AGNOSTIC stopAfterResearch (ResolveOptions); the goal->stop mapping (stopAfterResearchFor: learning => true) lives ONLY in bin/cli/goal.ts — router.ts has zero goal/learning/educator tokens (H1)"
  - "egress is proven BY CONTENT via an in-module __setInterpolateForTest seam — native ESM namespaces are sealed under Node 24 so the 09-00 namespace-patch spy could not work; the seam intercepts the exact model-bound payload"
  - "intake-clarifier template interpolates {{assignment}} (not {{seed}}) — fixed the pre-existing var-name bug the first live egress test exposed"
  - "config.toml is the canonical goal store (no STATE.json field, A2/PRD §10); persist is best-effort with a visible WARN + in-memory fallback (M1)"
  - "the learning hard-stop reuses the existing status/done terminal (no RouterDecision widening); the action-taking callers print the learning end-state INSTEAD OF the generic export-ready message; status stays read-only"
  - "renderLearningEndState builds the research.done payload from LIBRARY.json + RESEARCH.md and is non-fatal (mirrors runStyleProducerNonFatal)"

patterns-established:
  - "Goal-agnostic router DI keeps the zero-branch invariant green while still driving the learning hard-stop from the CLI tier"
  - "In-module test seam for egress interception when the upstream module namespace is a sealed ESM exotic object"

requirements-completed: [ERGO-07]

# Metrics
duration: 42min
completed: 2026-06-20
---

# Phase 9 Plan 03: Educator-mode End-to-End Wiring Summary

**Wired `goal` end-to-end (intake `--goal` -> config.toml -> a goal-AGNOSTIC `stopAfterResearch` router DI -> the learning hard-stop that renders per-claim provenance to TUTORIAL.md), added opt-in PII redaction whose REDACTED text is the model-bound egress payload (H3), pinned TUTORIAL.md export-exclusion, and atomically re-pinned both tutorial prompt slugs to real SHA-256 — all with `npm run check` fully green and the router still goal-unaware.**

## Performance

- **Duration:** ~42 min
- **Started:** 2026-06-20
- **Completed:** 2026-06-20
- **Tasks:** 3 (+ 1 follow-up lint fix)
- **Files modified:** 16 (2 created, 14 modified)

## Accomplishments
- intake `--goal` (draft|learning|both, default draft) persisted to config.toml `[project] goal` via atomicWriteFile; non-fatal with a visible WARN + in-memory fallback (M1).
- Opt-in PII: `redactPii`+`diffPii` run STRUCTURALLY before `loadPrompt('intake-clarifier')`; the value interpolated into the model payload is the REDACTED `egressSeed` (H3 — proven by content); raw answers -> `.paper/INTAKE.raw.local` (gitignored), redacted -> `.paper/INTAKE.md`.
- `bin/lib/router.ts` gained a goal-AGNOSTIC `ResolveOptions { stopAfterResearch? }` DI param (default `{}` byte-unchanged); router stays goal-unaware (lint-tutorial-no-branch scans it clean).
- `bin/cli/goal.ts` (NEW, CLI tier): the single goal-read helper + the only goal->behavior mapping + the RESEARCH.md->payload parse glue + `renderLearningEndState` (H2 end-state: per-claim provenance to TUTORIAL.md, no section written).
- next/resume/bare render the learning end-state at the hard-stop INSTEAD OF the generic export-ready line; status reflects the hard-stop read-only; write.ts deduped onto the shared goal helper (L5).
- TUTORIAL.md export-exclusion pinned (zero-trace Test G, DONE-07); WN-3 atomic re-pin to real SHA-256 across loader + repo-files — no pending bypass remains.

## Task Commits

Each task was committed atomically:

1. **Task 1: intake --goal + config.toml persist + PII opt-in redact/diff before LLM + redacted egress (H3)** - `870d676` (feat)
2. **Task 2: goal-agnostic stopAfterResearch DI + goal.ts helper + learning end-state + 4-caller wiring + write.ts dedup** - `0468067` (feat)
3. **Task 3: TUTORIAL.md export-exclusion test + WN-3 atomic re-pin to real SHA-256** - `2ea608d` (feat)

**Follow-up:** `91a2ead` (fix) — cleared two pre-existing 09-00 lint errors blocking `npm run check`.

## Files Created/Modified
- `bin/cli/intake.ts` - `--goal` + `--pii-redact` args; coerceGoal + persistProjectConfig (config.toml) + resolvePiiRedact (arg WINS); PII block before loadPrompt; `egressSeed = piiRedact ? redacted : rawAnswers` into interpolate; fixed `{{assignment}}` var; `__setInterpolateForTest` egress seam.
- `bin/cli/goal.ts` - readGoalFromConfig + stopAfterResearchFor + parseResearchClaims + buildResearchDonePayload + renderLearningEndState.
- `bin/lib/router.ts` - `ResolveOptions { stopAfterResearch? }`; hard-stop AFTER RESEARCH.md / BEFORE OUTLINE.md reusing status/done; zero goal tokens.
- `bin/pensmith.ts`, `bin/cli/next.ts`, `bin/cli/resume.ts`, `bin/cli/status.ts` - read goal, pass stopAfterResearch; action callers render the learning end-state at the hard-stop.
- `bin/cli/write.ts` - import shared readGoalFromConfig from goal.ts (removed local copy + unused parseToml import).
- `bin/lib/prompt-loader.ts` + `tests/repo-files.test.ts` - WN-3 lockstep re-pin to real SHA-256 (de2ef68.../c39d74a3...).
- `tests/intake-pii-egress.test.ts` - spy via `__setInterpolateForTest` (sealed-namespace fix).
- `tests/goal-routing.test.ts` - fixture fix (STATE.json at <root>/STATE.json + createdAt).
- `tests/goal-learning-endstate.test.ts` - cycle-2 MEDIUM execution-level parse-glue + H2 render test.
- `tests/zero-trace-export.test.ts` - Test G (TUTORIAL.md export-exclusion).
- `tests/lint-tutorial-no-branch.test.ts` - drop unused statSync import.
- `eslint.config.js` - Phase-9 D-41 path-chokepoint exemption for the 5 env-override test suites.

## Decisions Made
See key-decisions frontmatter. The load-bearing ones: router stays goal-agnostic (H1); egress proven by content through an in-module seam (forced by sealed ESM namespaces under Node 24); config.toml is the canonical goal store; the learning hard-stop reuses status/done and the callers swap the end-state message.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] intake-clarifier template interpolates {{assignment}}, not {{seed}}**
- **Found during:** Task 1 (first live egress test)
- **Issue:** The pre-existing Tier-1 path called `interpolate(prompt, { seed })`, but `templates/prompts/intake-clarifier.md` references `{{assignment}}`. No prior test exercised the live interpolate path, so the mismatch was latent; the egress test surfaced it as "missing var assignment".
- **Fix:** Pass `{ assignment: egressSeed }`.
- **Files modified:** bin/cli/intake.ts
- **Verification:** intake-pii-egress green.
- **Committed in:** 870d676

**2. [Rule 3 - Blocking] Egress spy cannot patch a sealed ESM module namespace under Node 24**
- **Found during:** Task 1 (intake-pii-egress)
- **Issue:** The 09-00 egress test patched `prompt-loader.interpolate` via `Object.defineProperty` — but native ESM module namespaces are SEALED exotic objects under Node 24 (`Cannot redefine property`; assignment is a spec no-op). The test could not run its assertions.
- **Fix:** Added an in-module replaceable seam `__setInterpolateForTest` in intake.ts (defaults to the real interpolate; production behavior unchanged) and switched the test to intercept through it. Preserves the test's exact assertions (no raw sentinel; a [REDACTED:KIND] tag present).
- **Files modified:** bin/cli/intake.ts, tests/intake-pii-egress.test.ts
- **Verification:** intake-pii-egress green (live payload captured by content).
- **Committed in:** 870d676

**3. [Rule 3 - Blocking] Phase-9 test files failed the D-41 path chokepoint (blocking npm run check)**
- **Found during:** Task 1 (lint)
- **Issue:** The 09-00 RED test files set `process.env.LOCALAPPDATA/XDG_DATA_HOME` for tmp isolation but were never added to the D-41 chokepoint exemption — `eslint .` failed, so `npm run check` had been red since 09-00.
- **Fix:** Added a Phase-9 exemption block (mirrors the Phase-8 group) covering the 5 env-override suites.
- **Files modified:** eslint.config.js
- **Verification:** lint-chokepoint green; `eslint .` green.
- **Committed in:** 870d676 (+ 91a2ead added tutorial-observer.test.ts)

**4. [Rule 1 - Bug] goal-routing fixture mis-placed STATE.json and omitted createdAt**
- **Found during:** Task 2 (goal-routing DI tests)
- **Issue:** The 09-00 fixture wrote STATE.json to `<root>/.paper/STATE.json`, but `loadState` resolves `<root>/STATE.json` (stateFile contract) — so the router returned `{verb:'new'}` and the DI never engaged. It also omitted the required `createdAt`, classifying the state as corrupt (status/attention). The stopAfterResearch=true case only passed vacuously (status/attention also satisfies "not outline").
- **Fix:** Place STATE.json at `<root>/STATE.json` and add `createdAt`.
- **Files modified:** tests/goal-routing.test.ts
- **Verification:** all 4 goal-routing tests green (true => terminal; false/default => outline).
- **Committed in:** 0468067

**5. [Rule 3 - Blocking] Pre-existing lint errors in 09-00 test files blocking npm run check**
- **Found during:** full `npm run check`
- **Issue:** `tests/lint-tutorial-no-branch.test.ts` imported an unused `statSync`; `tests/tutorial-observer.test.ts` was not in the D-41 exemption.
- **Fix:** removed the unused import; extended the Phase-9 exemption.
- **Files modified:** tests/lint-tutorial-no-branch.test.ts, eslint.config.js
- **Verification:** `npm run check` fully green.
- **Committed in:** 91a2ead

---

**Total deviations:** 5 auto-fixed (2 bugs, 3 blocking). All were 09-00 RED-scaffold defects (mis-placed fixture, sealed-namespace spy, missing lint exemptions, a latent template-var bug) — necessary to turn the locked RED contracts green and satisfy "`npm run check` FULLY green." No scope creep; the architecture (router goal-unaware, goal logic confined to the CLI tier) is unchanged.

## Issues Encountered
- The sealed-ESM-namespace discovery (Node 24) required rethinking the egress interception; resolved with an in-module seam that keeps production behavior identical and the egress assertion by-content.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ERGO-07 fully satisfied: goal persisted + drives the learning hard-stop via a goal-agnostic router param; per-claim provenance rendered at the hard-stop; opt-in PII with redacted-by-content egress; draft/both unchanged; TUTORIAL.md export-excluded; tutorial prompts carry real hashes.
- Zero RED-by-skip remaining for Phase 9; `npm run check` green WITHOUT PENSMITH_ALLOW_PENDING_PROMPT_HASHES; 16-verb bijection intact (goal is an arg, not a verb).

## Self-Check: PASSED
- Created files verified present: bin/cli/goal.ts, tests/goal-learning-endstate.test.ts, 09-03-SUMMARY.md.
- Commits verified in git log: 870d676 (Task 1), 0468067 (Task 2), 2ea608d (Task 3), 91a2ead (lint fix).
- `npm run check` exits 0: lint + typecheck + build + tier-contract + 822 tests (0 fail, 0 skipped) + manifests — WITHOUT PENSMITH_ALLOW_PENDING_PROMPT_HASHES.

---
*Phase: 09-educator-tutorial-mode-pii-polish*
*Completed: 2026-06-20*
