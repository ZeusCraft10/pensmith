---
phase: 07-single-command-ux-layer-hooks-flags
plan: 01
subsystem: testing
tags: [red-by-skip, router, estimator, cli-flags, hooks, skills, nl-triggers, node-test, execfilesync]

# Dependency graph
requires:
  - phase: 05-verifier-completeness-pass-2-pass-4
    provides: "RED-by-skip Wave-0 precedent (existsSync skip-guard, full suite stays GREEN)"
  - phase: 06-export-pipeline
    provides: "RED-by-skip Wave-0 precedent + the locked Wave-0 contract idiom"
  - phase: 01-foundation
    provides: "loadState/StateNotFoundError, SectionStateSchema, HandoffSchema (5120-byte cap), parseFrontmatter, lock.ts release/isLocked/tryAcquire, budget COSTS.jsonl, isOfflineMode, UX02_VERBS"
  - phase: 03-vertical-slice-one-section
    provides: "hooks/pre-compact.ts (onPreCompact), hooks/post-tool-use.ts (HOOK-03 complete), bin/cli/verify.ts pass2/pass4 noLlm gate"
provides:
  - "9 RED-by-skip test files freezing the Phase 7 contracts (router, estimator, flags, 4 hooks, skills, nl-triggers) for Waves 1-2 to implement against"
  - "Regression gates for all 12 cross-AI HIGH concerns: H1, H2, H3, H4, C3-HIGH-1, C3-HIGH-2, C4-HIGH, C5-HIGH, C6-HIGH"
  - "tests/hooks/ subdirectory with the hook-subprocess execFileSync driver pattern (tsx pinned via import.meta.resolve)"
affects: [07-02-router-estimator-flags, 07-03-hooks, 07-04-skills-plugin-namespace]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RED-by-skip on existsSync(module source) — full suite stays GREEN (0 failures) until the module lands (05-01/06-01 precedent)"
    - "Source-grep skip predicate (flagsWired / emissionWired / stopWired / timeoutWired) for files that ALREADY exist as stubs — existsSync alone cannot detect the not-yet-wired behavior"
    - "Hook subprocess execFileSync driver pins tsx via import.meta.resolve('tsx') so a tmpdir cwd does not break bare --import tsx resolution"

key-files:
  created:
    - tests/pensmith-router.test.ts
    - tests/estimator.test.ts
    - tests/flags.test.ts
    - tests/hooks/session-start.test.ts
    - tests/hooks/stop.test.ts
    - tests/hooks/pre-compact.test.ts
    - tests/hooks/post-tool-use.test.ts
    - tests/skill-descriptions.test.ts
    - tests/nl-triggers.test.ts
  modified: []

key-decisions:
  - "Corrupt-PLAN.md fixture uses `status: *missing_anchor` (alias to a non-existent anchor) instead of the plan's duplicate-key example — yaml@^2 parseDocument().toJSON() TOLERATES duplicate keys / broken structure and never throws on them, so the plan's example would make the C5/C6 RED gate vacuous; the alias fixture genuinely throws a ReferenceError through parseFrontmatter, exercising the real unguarded-read throw path"
  - "Source-grep skip predicates (not existsSync alone) gate the cases for files that already exist as stubs: bin/pensmith.ts (flagsWired=/dry-run/), hooks/session-start.ts (emissionWired=/HANDOFF|systemMessage/), hooks/stop.ts (stopWired=/release|allSettled|flush/), hooks/pre-compact.ts (timeoutWired=/PRECOMPACT_TIMEOUT_MS/)"
  - "Hook subprocesses pin the tsx loader via import.meta.resolve('tsx') absolute file URL — a bare `--import tsx` resolves relative to the child's tmpdir cwd (no node_modules) and crashes with ERR_MODULE_NOT_FOUND"

patterns-established:
  - "RED-by-skip Wave-0 scaffold continues into the wiring phase (Phase 7), one test file per behavior cluster"
  - "execFileSync(process.execPath, ['--import', TSX_LOADER, target], {cwd, env}) is the canonical real-dispatch driver for CLI + hook subprocess tests"

requirements-completed: [UX-01, UX-02, UX-03, UX-04, UX-05, ERGO-01, ERGO-02, ERGO-03, ERGO-04, HOOK-01, HOOK-02, HOOK-03, HOOK-04]

# Metrics
duration: 28min
completed: 2026-06-18
---

# Phase 7 Plan 01: Wave-0 RED Scaffold Summary

**9 RED-by-skip test files that freeze the exact Phase 7 contracts (resolveNextAction decision table, projectEstimate cap math, the four global flags, four hooks, plumbing skills, NL triggers) and carry a dedicated regression gate for every one of the 12 cross-AI HIGH concerns — the full suite stays GREEN at 0 failures (750 tests, 48 skip).**

## Performance

- **Duration:** 28 min
- **Started:** 2026-06-18T12:48:52Z
- **Completed:** 2026-06-18T13:05:03Z
- **Tasks:** 3
- **Files modified:** 9 (all created)

## Accomplishments
- **Router RED suite (UX-01):** the full decision table (a-f) PLUS C3-HIGH-1 totality over EVERY SectionStateSchema state incl. the mixed `[verified,failed,verified]`-no-DRAFT stuck case (→ verify, never undefined/compile), C4-HIGH corrupt + schema-invalid STATE.json (→ status/attention, no throw), C5-HIGH corrupt + absent per-section PLAN.md (corrupt → status/attention+section; absent → plan), and H4 non-done-HANDOFF (→ next WORK verb, never resume).
- **Estimator RED suite (ERGO-02/03):** projectEstimate shape + `totalUsd === sum(row.usd)` + exceedsHalfCap predicate (over/under 50% cap) + T-07-03 no-COSTS.jsonl + C2-H1 fresh-dir + C4-HIGH corrupt/schema-invalid STATE.json (all → empty projection, no throw).
- **Flags RED suite (ERGO-01/04 + H1/H2/H3/C3-HIGH-2/C4-HIGH/C6-HIGH):** execFileSync-driven real-dispatch cases — H1 yolo cap refusal for NON-GATE verbs (`write --yolo`/`plan --yolo`) + paper-less + corrupt-STATE no-crash, H2 single dispatch + flags-for-explicit-verb, H3 `verify --dry-run` zero-egress with a fake key (NON-vacuous), C3-HIGH-2 --yolo forwarded through bare+resume manual dispatch, C6-HIGH end-to-end corrupt-PLAN bare-`pensmith` no-crash.
- **Hooks RED suite (HOOK-01..04):** HOOK-03 throttle PASSES now (already complete, no reimplementation); HOOK-01 HANDOFF ≤5120 bytes + HandoffSchema parse PASS now; HOOK-02 emission + HOOK-04 release + M1 flush-survives-release-rejection RED-by-skip on stub upgrade.
- **Skills + NL-triggers RED suite (UX-02..05):** PRD §5.4 trigger-phrase presence + plugin.json colon-prefix namespace RED-by-skip; the no-17th-verb / `UX02_VERBS.length===16` invariant un-skipped (standing guard, T-07-02).

## Task Commits

Each task was committed atomically:

1. **Task 1: RED suite for router + estimator + flags** - `f3ff466` (test) — 41 tests, 0 fail, 37 skip
2. **Task 2: RED suite for hooks** - `10901d5` (test) — 14 tests, 0 fail, 9 pass, 5 skip
3. **Task 3: RED suite for skills + NL triggers** - `cd4d320` (test) — 10 tests, 0 fail, 4 pass, 6 skip

**Plan metadata:** (this commit) — `docs(07-01): complete Wave-0 RED scaffold plan`

## Files Created/Modified
- `tests/pensmith-router.test.ts` - resolveNextAction decision table + C3-HIGH-1/C4-HIGH/C5-HIGH/H4 regression gates (RED-by-skip on bin/lib/router.ts)
- `tests/estimator.test.ts` - projectEstimate shape + 50%-cap predicate + C2-H1/C4-HIGH + T-07-03 no-billing (RED-by-skip on bin/lib/estimator.ts)
- `tests/flags.test.ts` - execFileSync dispatch for H1/H2/H3/C3-HIGH-2/C4-HIGH/C6-HIGH + flag declaration (RED-by-skip on a flagsWired grep predicate); one un-skipped isOfflineMode() gate
- `tests/hooks/session-start.test.ts` - HOOK-02 resume-context emission (no-handoff empty un-skipped; valid/done JSON-frame RED-by-skip)
- `tests/hooks/stop.test.ts` - HOOK-04 exit-0/empty-stdout un-skipped; release + M1 flush-survives-rejection RED-by-skip
- `tests/hooks/pre-compact.test.ts` - HOOK-01 HANDOFF ≤5120 + HandoffSchema parse PASS; 10s-timeout race RED-by-skip on PRECOMPACT_TIMEOUT_MS
- `tests/hooks/post-tool-use.test.ts` - HOOK-03 coverage check (throttle PASSES; THROTTLE_MS + proper-lockfile source sentinels)
- `tests/skill-descriptions.test.ts` - UX-03/04 PRD §5.4 trigger phrases + plugin.json colon-prefix namespace (RED-by-skip)
- `tests/nl-triggers.test.ts` - UX-05 corrections → existing plan/write verbs + UX02_VERBS.length===16 invariant (un-skipped)

## Decisions Made
- **Corrupt-PLAN fixture substitution (see Deviations Rule 1).** The C5/C6 corrupt-PLAN.md cases use `status: *missing_anchor` rather than the plan's duplicate-key block because yaml@^2 silently tolerates the latter; the alias fixture is the genuine throw path.
- **Source-grep skip predicates for already-existing stubs.** bin/pensmith.ts and the three upgradable hooks already exist, so existsSync would never skip; each uses a token-grep predicate keyed to the not-yet-landed behavior.
- **tsx loader pinned via import.meta.resolve.** Hook/CLI subprocesses run with a tmpdir cwd where a bare `--import tsx` cannot resolve; the absolute loader URL fixes it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrupt-YAML fixture would not actually throw (vacuous C5/C6 RED gate)**
- **Found during:** Task 1 (router + flags RED suites)
- **Issue:** The plan's suggested corrupt-PLAN.md frontmatter (`status: planned` / `  : : bad` / duplicate `status:` keys) does NOT make `parseFrontmatter` throw — yaml@^2 `parseDocument().toJSON()` collects errors but recovers and returns a best-effort object for duplicate keys, broken mappings, unterminated strings, etc. The C5-HIGH (router unit) and C6-HIGH (end-to-end dispatch) regression gates are meaningful only if the corrupt PLAN.md genuinely throws through the unguarded section-walk read.
- **Fix:** Substituted a fixture that genuinely throws — `status: *missing_anchor` (an alias to a non-existent YAML anchor) makes `doc.toJSON()` throw a `ReferenceError: Unresolved alias`, which propagates through `parseFrontmatter`. Verified directly against the live module before authoring the fixtures. The plan's example bytes were prefixed "e.g." (a suggestion), so this stays within the plan's intent while making the gate non-vacuous.
- **Files modified:** tests/pensmith-router.test.ts (case (o), `writeCorruptSectionPlan`), tests/flags.test.ts (C6-HIGH, `writeCorruptSectionPlan`)
- **Verification:** Confirmed `parseFrontmatter('---\nstatus: *missing_anchor\n---\nbody')` throws ReferenceError; the plan's duplicate-key fixture returns `{status:'written',...}` with no throw.
- **Committed in:** `f3ff466` (Task 1 commit)

**2. [Rule 3 - Blocking] Hook subprocesses crashed with ERR_MODULE_NOT_FOUND from a tmpdir cwd**
- **Found during:** Task 2 (hook RED suites)
- **Issue:** The execFileSync hook driver (`['--import','tsx', HOOK]`) ran with `cwd` set to a fresh tmpdir. Node resolves a bare `--import` specifier relative to the CHILD's cwd, which has no node_modules, so `tsx` could not be found and every hook subprocess exited 1 — failing the exit-0/empty-stdout invariants (which hooks-noop.test.ts passes only because it uses the repo-root cwd).
- **Fix:** Resolve tsx's loader to an absolute file URL once per test via `import.meta.resolve('tsx')` (resolved relative to the test module in the repo) and pass that URL to `--import`. Applied to the three execFileSync hook drivers (session-start, stop, post-tool-use); pre-compact imports the module directly so it was unaffected.
- **Files modified:** tests/hooks/session-start.test.ts, tests/hooks/stop.test.ts, tests/hooks/post-tool-use.test.ts
- **Verification:** All 14 hook tests pass/skip with 0 failures after the fix.
- **Committed in:** `10901d5` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes are correctness-essential for the RED gates to be real (Rule 1) and runnable (Rule 3). No scope creep — all 9 files and every named HIGH gate match the plan's artifact contract.

## Issues Encountered
- None beyond the two deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- **07-02 (router + estimator + flags):** the contracts are frozen — implement `bin/lib/router.ts` (resolveNextAction TOTAL over SectionStateSchema, never undefined/throws, status route through a shared guarded readSectionState helper) and `bin/lib/estimator.ts` (projectEstimate empty-projection on missing/corrupt STATE.json), plus the bin/pensmith.ts argv pre-parse (4 global flags, yolo cap pre-flight for ANY verb, dispatchVerb yolo forwarding + backstop). The flags cases un-skip the moment `dry-run` appears in bin/pensmith.ts.
- **07-03 (hooks):** session-start emission (systemMessage frame), stop release + Promise.allSettled flush, pre-compact PRECOMPACT_TIMEOUT_MS 10s race.
- **07-04 (skills):** the four plumbing skill files with PRD §5.4 trigger phrases + plugin.json skills array.
- **Standing guard:** `UX02_VERBS.length===16` is asserted un-skipped now — any 17th verb fails CI immediately.

---
*Phase: 07-single-command-ux-layer-hooks-flags*
*Completed: 2026-06-18*

## Self-Check: PASSED

- All 9 test files + SUMMARY.md verified on disk (FOUND).
- All 3 task commits verified in git log: f3ff466, 10901d5, cd4d320.
- Targeted suite: 65 tests across the 9 files, 0 failures (17 pass, 48 skip).
- Full suite: 750 tests, 0 failures, 702 pass, 48 skip (RED-by-skip GREEN).
- `npm run lint` exit 0; `npm run typecheck` exit 0.
