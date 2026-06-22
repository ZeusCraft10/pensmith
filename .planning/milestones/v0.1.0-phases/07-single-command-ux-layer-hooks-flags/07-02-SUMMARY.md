---
phase: 07-single-command-ux-layer-hooks-flags
plan: 02
subsystem: cli-ux
tags: [router, estimator, global-flags, dispatch-seam, yolo-cap, dry-run, handoff-lifecycle, never-throw]

# Dependency graph
requires:
  - phase: 07-single-command-ux-layer-hooks-flags
    provides: "07-01 RED-by-skip contracts for router/estimator/flags + the 12 cross-AI HIGH regression gates + the tsx-loader subprocess driver idiom"
  - phase: 01-foundation
    provides: "loadState/StateNotFoundError, SectionStateSchema, HandoffSchema, parseFrontmatter, estimateCost/pricing, isOfflineMode, setMirrorPromptsToStderr, UX02_VERBS, sectionPlan/paperDir"
  - phase: 05-verifier-completeness-pass-2-pass-4
    provides: "the PENSMITH_NO_LLM guard in verify/pass2.ts + pass4.ts that --dry-run rides (no Phase-5 edits)"
provides:
  - "resolveNextAction — pure, TOTAL, never-throws state-aware next-WORK-verb resolver (UX-01) + the shared guarded readSectionState helper (the single per-section PLAN.md read path)"
  - "projectEstimate — pure token+USD projection + 50%-cap predicate (ERGO-02/03), guarded against all STATE.json load failures"
  - "next/status/resume real verbs (UX-02) via the shared REAL_VERB_LOADERS + dispatchVerb path"
  - "the four global flags (--dry-run/--estimate/--yolo/--show-prompts) wired in a pre-dispatch argv seam (ERGO-01..04) with the yolo cap pre-flight + dispatchVerb flag-forwarding backstop"
affects: [07-03-hooks, 07-04-skills-plugin-namespace]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pre-dispatch argv seam (NOT a citty root run()) — global flags + yolo cap pre-flight + bare routing run BEFORE runMain so explicit verbs honor the flags and run exactly once (H2)"
    - "Shared dispatchVerb(verb,{args,globalFlags}) helper — merges forwarded global flags (≥ yolo) into the manually-dispatched verb's args (C3-HIGH-2) inside an outer try/catch backstop so the bare/next/resume umbrella never crashes (C6-HIGH)"
    - "Single guarded readSectionState(planPath) helper reused by BOTH the router walk AND status.ts — no raw parseFrontmatter(readFileSync(planPath)) survives (C5/C6-HIGH)"
    - "Catch-all loadState reclassification (ENOENT→new/empty; any other load error→status/attention or empty projection) makes router + estimator TOTAL over the full on-disk STATE.json failure surface (C4-HIGH)"
    - "Section-scoped verb with no positional number (plan/verify) resolves the next pending section via the router (UX-01 single-command UX); write keeps its no-n write-all semantics"

key-files:
  created:
    - bin/lib/router.ts
    - bin/lib/estimator.ts
    - bin/cli/next.ts
    - bin/cli/status.ts
    - bin/cli/resume.ts
  modified:
    - bin/pensmith.ts
    - tests/flags.test.ts
    - tests/cli-stubs.test.ts

key-decisions:
  - "[07-02] estimator uses a module-constant default provider/model (anthropic/claude-sonnet-4 — present in MODEL_PRICES) rather than reading runtime.ts loadRuntimeConfig: keeps projectEstimate a pure IO-light projection that never touches the platform data dir, and honors the plan's 'import ONLY pricing.ts + state.ts' acceptance criterion"
  - "[07-02] estimator catch-all (no instanceof StateNotFoundError branch) — the plan widened C2-H1 to the full C4-HIGH load-failure surface, so paper-less AND corrupt/schema-invalid STATE.json both return the empty projection via a single catch"
  - "[07-02] section-scoped router fallback set is plan+verify ONLY (write EXCLUDED) — write's n is optional (write-all wave surface, tier-contract write-wave parity), so a bare `pensmith write` must reach runMain, not the single-section router path"
  - "[07-02] --version/--help/-h delegate to runMain even with no subcommand — citty owns root meta flags; without this branch `pensmith --version` fell into the bare router path and ran intake (preflight semver regression)"
  - "[07-02] dispatchVerb invokes cmd.run({args,rawArgs:[],cmd}) directly (bypassing citty's arg parser) — manual dispatch must FORWARD global flags into args; explicit verbs still go through runMain so citty parses their positionals/--slug (H3 verify path)"

patterns-established:
  - "Manual-dispatch flag forwarding through ONE shared helper (dispatchVerb) for bare/next/resume — never cmd.run() with a bare args object"
  - "Never-throw resolver + guarded single-read-path + dispatch backstop = an end-to-end never-crash guarantee for a corrupt PLAN.md, proven through two independent guards"

requirements-completed: [UX-01, UX-02, ERGO-01, ERGO-02, ERGO-03, ERGO-04]

# Metrics
duration: 35min
completed: 2026-06-19
---

# Phase 7 Plan 02: Router + Estimator + Flags Summary

**The bare `/pensmith` state-aware router (UX-01), the `--estimate` cost projector (ERGO-02/03), real `next`/`status`/`resume` verbs, and the four global flags wired into a pre-dispatch argv seam (ERGO-01..04) — turning all 37 router/estimator/flags RED-by-skip cases GREEN, including every one of the 7 cross-AI HIGH gates carried into this wave (H1/H2/H3/H4/C3-HIGH-1/C3-HIGH-2/C4-HIGH/C5-HIGH/C6-HIGH).**

## Performance

- **Duration:** ~35 min
- **Tasks:** 4 (Task 4 is a confirmation/wiring-verification step — no code of its own)
- **Files created:** 5 — **Files modified:** 3

## Accomplishments

- **Router (UX-01) — Task 1.** `resolveNextAction` is a PURE next-WORK-verb resolver that IGNORES HANDOFF (H4) and is TOTAL + NEVER-THROWS over its ENTIRE input surface: catch-all loadState reclassification (ENOENT→new; any other load error→status/attention; C4-HIGH), `state.sections ?? []` guard, an exhaustive `switch` over SectionStateSchema with `failed`/`unverifiable`→verify (C3-HIGH-1), the guarded per-section read, and an outer try/catch backstop. Exports the SINGLE guarded `readSectionState(planPath)` helper (C5/C6-HIGH).
- **Estimator (ERGO-02/03) — Task 2.** `projectEstimate` is a pure token+USD projection over the STATE.json section count (plan/write/verify per-section + research/outline/compile/done whole-paper), priced via `estimateCost()`. Imports ONLY pricing.ts + state.ts; zero LLM/network/COSTS.jsonl (Pitfall 8). A catch-all loadState guard returns the empty projection for a paper-less dir AND a corrupt/schema-invalid STATE.json (C2-H1/C4-HIGH).
- **Verbs + flags + dispatch (UX-02, ERGO-01..04) — Task 3.** `bin/pensmith.ts` gained a PRE-DISPATCH argv seam (NOT a root run(), H2): `--show-prompts`→`setMirrorPromptsToStderr`, `--dry-run`→env gates, the `--yolo` cap pre-flight (ANY verb incl. non-gate + bare, hard exit(1) over 50% cap, paper-less/corrupt → empty projection no crash — H1/C2-H1/C4-HIGH), and `--estimate`→projection table. Exported `REAL_VERB_LOADERS` + the shared `dispatchVerb` helper (forwards global flags ≥ yolo into the dispatched verb's args, C3-HIGH-2; outer try/catch backstop so the bare/next/resume umbrella never crashes, C6-HIGH). `next`/`status`/`resume` promoted to real verbs; `resume` computes the next WORK verb via the HANDOFF-blind resolver then clears HANDOFF (H4); `status` walks PLAN.md via the shared `readSectionState` (C6-HIGH).
- **dry-run LLM gate (ERGO-01) — Task 4.** Confirmed (no edits): `--dry-run` sets `PENSMITH_NO_LLM='1'` and the EXISTING pass2.ts:215 + pass4.ts:392 guards short-circuit to the offline placeholder, so `verify <N> --dry-run` with a fake key makes zero egress + no COSTS.jsonl append (H3/C2-H3, non-vacuous). No Phase-5 / runtime.ts edits.

## Task Commits

1. **Task 1: router.ts** — `38a63b0` (feat) — 18/18 router cases GREEN
2. **Task 2: estimator.ts** — `13cd8dd` (feat) — 8/8 estimator cases GREEN
3. **Task 3 + Task 4: next/status/resume + flag seam + dispatchVerb + dry-run wiring** — `79bc613` (feat) — flags + cli-verbs + router 35/35 GREEN

## Files Created/Modified

- `bin/lib/router.ts` — resolveNextAction (TOTAL, never-throws, HANDOFF-blind) + RouterDecision + the shared guarded readSectionState/SectionStateRead (C3/C4/C5/C6-HIGH, H4)
- `bin/lib/estimator.ts` — projectEstimate + EstimateRow/EstimateResult + STEP_HEURISTICS; pure, guarded, zero-billing (ERGO-02/03, C2-H1/C4-HIGH)
- `bin/cli/next.ts` — thin orchestrator: resolveNextAction → dispatchVerb (flag-forwarding)
- `bin/cli/status.ts` — state display; walks PLAN.md via readSectionState; survives corrupt STATE.json + corrupt PLAN.md (C4/C6-HIGH)
- `bin/cli/resume.ts` — HANDOFF summary → HANDOFF-blind resolver → dispatchVerb → clear HANDOFF (H4 lifecycle, C3-HIGH-2)
- `bin/pensmith.ts` — exported REAL_VERB_LOADERS + dispatchVerb; pre-dispatch argv seam; 4 global flags; yolo cap pre-flight; --version/--help delegation; section-scoped router fallback (plan/verify)
- `tests/flags.test.ts` — pinned the tsx loader in the execFileSync driver (deviation Rule 3)
- `tests/cli-stubs.test.ts` — dropped graduated next/status/resume from the STUBS list (deviation Rule 1)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] flags.test.ts execFileSync driver could not resolve `tsx` from a tmpdir cwd**
- **Found during:** Task 3
- **Issue:** The 07-01 flags driver used `['--import', 'tsx', PENSMITH_TS, ...]` with `cwd` set to a fresh tmpdir. Node resolves a bare `--import tsx` specifier relative to the CHILD's cwd (no node_modules), so every CLI subprocess crashed `ERR_MODULE_NOT_FOUND` — the flags cases were RED-by-skip in 07-01 so the bug only surfaced when the flag wiring un-skipped them this plan.
- **Fix:** Resolved tsx's loader to an absolute file URL once via `import.meta.resolve('tsx')` and passed it to `--import` — the identical fix 07-01 applied to the three hook execFileSync drivers (07-01-SUMMARY Deviation 2). No assertion was weakened.
- **Files modified:** tests/flags.test.ts
- **Commit:** `79bc613`

**2. [Rule 1 - Bug] cli-stubs.test.ts still expected next/status/resume to print the stub message**
- **Found during:** full `npm test` run (Task 3 verification)
- **Issue:** `tests/cli-stubs.test.ts` asserted `pensmith next|status|resume` exits 0 with "not implemented yet". This plan promotes those three to real verbs (REAL_VERB_LOADERS), so they now print real output — the stub assertion failed (3 failures). This is the EXACT precedent the test header already documents for compile (04-05) and done (06-05) graduating from stub→real.
- **Fix:** Removed next/status/resume from the STUBS list (now `list`/`open`/`sketch`/`add`) and updated the header comment; the TIER-04 stub invariant still holds for the 4 genuinely-unimplemented verbs.
- **Files modified:** tests/cli-stubs.test.ts
- **Commit:** `79bc613`

**3. [Rule 1 - Bug] `pensmith --version` regressed (fell into the bare router path) + `pensmith write` (no n) broke the write-wave surface**
- **Found during:** `npm run test:tier-contract` (Task 3 verification)
- **Issue:** (a) `--version`/`--help` are `-`-prefixed, so `firstVerb` returned null and the bare router path ran intake instead of citty printing the semver (preflight regression). (b) The initial section-scoped fallback set included `write`; but `write`'s `n` is OPTIONAL (omit → write ALL sections wave-by-wave), so a bare `pensmith write --max-parallel 1` was wrongly routed to a single-section action, failing the tier-contract write-wave parity (DRAFT.md files not produced).
- **Fix:** (a) Added an early `runMain(command)` delegation when argv contains `--version`/`--help`/`-h`. (b) Removed `write` from `SECTION_SCOPED_VERBS` (now `plan`/`verify` only) with a documented rationale; bare `write` reaches citty/runMain and its own write-all logic.
- **Files modified:** bin/pensmith.ts
- **Commit:** `79bc613`

---

**Total deviations:** 3 auto-fixed (2 bug, 1 blocking). All three are correctness-essential and stay within the locked contracts (the cli-stubs reconciliation follows the compile/done graduation precedent; the tsx-loader fix mirrors 07-01; the --version/write fixes restore pre-existing behavior the new dispatch seam had shadowed). No assertion in any locked RED test was weakened.

## Authentication Gates

None — no external service auth required.

## Known Stubs

None introduced. `list`/`open`/`sketch`/`add` remain Phase-2 stubs (out of scope for Phase 7; future-phase work) and are still covered by the TIER-04 stub invariant in cli-stubs.test.ts.

## Issues Encountered

- The three deviations above; no others.

## Verification

- `node --import tsx --test tests/pensmith-router.test.ts` → 18/18 PASS (0 skip)
- `node --import tsx --test tests/estimator.test.ts` → 8/8 PASS (0 skip)
- `node --import tsx --test tests/flags.test.ts tests/cli-verbs.test.ts` → all PASS (0 skip)
- `npm run check` (lint + typecheck + build + tier-contract + tests + manifests) → GREEN: tier-contract 34/34; full suite 747 tests, 0 fail, 736 pass, 11 skip; plugin manifests valid
- The 11 remaining skips are exclusively 07-03 hook tests (HOOK-01/02/04) and 07-04 skill/plugin-namespace tests (UX-03/04/05) — RED-by-skip until those plans land. Zero router/estimator/flags skips.
- 16-verb bijection intact (cli-verbs.test.ts: "dispatcher registers exactly 16 verbs" GREEN; no 17th verb).

## Next Phase Readiness

- **07-03 (hooks):** session-start emission (systemMessage frame), stop release + Promise.allSettled flush, pre-compact PRECOMPACT_TIMEOUT_MS 10s race. The HANDOFF lifecycle (write by pre-compact, surface by session-start, consume by resume) is now closed on the consume side (resume clears HANDOFF after dispatch); 07-03 owns the write + surface sides.
- **07-04 (skills):** the four plumbing skill files + plugin.json skills array (UX-03/04/05 still RED-by-skip).

---
*Phase: 07-single-command-ux-layer-hooks-flags*
*Completed: 2026-06-19*

## Self-Check: PASSED

- All 5 created files + 3 modified files verified on disk (FOUND).
- All 3 task commits verified in git log: 38a63b0, 13cd8dd, 79bc613.
- Targeted suites: router 18/18, estimator 8/8, flags+cli-verbs+router 35/35 — 0 failures, 0 skips.
- Full suite via `npm run check`: 747 tests, 0 fail, 736 pass, 11 skip (RED-by-skip GREEN for 07-03/07-04 only).
- `npm run lint` + `npm run typecheck` + `npm run build` exit 0; manifests valid.
