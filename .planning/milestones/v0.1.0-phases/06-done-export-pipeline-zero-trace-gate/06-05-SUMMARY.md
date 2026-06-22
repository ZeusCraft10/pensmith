---
phase: 06-done-export-pipeline-zero-trace-gate
plan: 05
subsystem: cli
tags: [done, export-pipeline, DONE-09-gate, humanizer-wrap, pass2-feed, fail-safe, tier-contract, zero-trace, thin-orchestrator]

# Dependency graph
requires:
  - phase: 06-done-export-pipeline-zero-trace-gate
    provides: "Wave-0 RED export-gate + humanizer-wrap tests + section-pass2-unsupported VERIFICATION.md fixture + pinned symbols (runDoneGate/runHumanizer); Wave-1 runPlagiarism (06-02), scoreHonesty/renderHonestyReport (06-03), exportDraft/zeroTracePatch/zeroTracePdf (06-04)"
  - phase: 05-verifier-completeness-pass-2-pass-4
    provides: "renderPass2Section ## Pass-2 table shape + Pass2Result/Pass4Result types; runPass4 (whole-paper Pass 4); renderPass4Section; runPass2"
  - phase: 04-compile-pipeline
    provides: "bin/cli/compile.ts thin-orchestrator template; tier-contract CLI-only bespoke-parity precedent; cli-stubs graduation precedent"
provides:
  - "bin/cli/done.ts — the done verb thin orchestrator (DONE-01/03/09): Pass4 → plagiarism → honesty(before) → humanize → honesty(after) → DONE-09 gate → exportDraft into the distinct export dir + .paper/VERIFICATION.md emission"
  - "runDoneGate (always-confirm, per-issue summary, --yolo-only skip, injectable approver) + collectGateIssues (UNSUPPORTED/orphan/plagiarism buckets)"
  - "readSectionUnsupported — FAIL-SAFE section Pass-2 UNSUPPORTED reader pinned to the renderPass2Section contract (synthetic <unparseable> sentinel on desync; absent = clean; I/O errors skipped)"
  - "runHumanizer (DONE-03) in bin/lib/exporter.ts — absent-skill / no-transport banner + null skip, never throws"
  - "done promoted to a real REAL_VERB_LOADERS loader (locked 16 verbs preserved); workflows/done.md filled; tier-contract done parity case"
affects: [phase-07 (next/resume/status verbs build on the now-real done surface), milestone-close (DONE-* requirements complete)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thin-orchestrator over bin/lib (compile.ts precedent): the CLI verb only resolves args + wires the runX libs + emits stdout; zero business logic inline"
    - "Injectable approver in runDoneGate so tests pass a deterministic approve() and assert it is/isn't called per branch; the real CLI approver wraps ask({ kind:'confirm' })"
    - "FAIL-SAFE on-disk parser pinned to a single-writer contract: present-but-unparseable Pass-2 table → synthetic UNSUPPORTED sentinel (never a silent clean); missing/absent = clean; I/O defensive only"
    - "CLI-only tier-contract parity (no MCP tool): the SAME workflow body + bin/lib path drives both tiers; bespoke offline parity test asserts a trace-free deliverable in the distinct export dir"

key-files:
  created:
    - bin/cli/done.ts
  modified:
    - bin/lib/exporter.ts
    - bin/pensmith.ts
    - workflows/done.md
    - tests/export-gate.test.ts
    - tests/tier-contract.test.ts
    - tests/cli-stubs.test.ts

key-decisions:
  - "runDoneGate accepts the FLAT input shape { pass2Results, pass4Results, plagiarismResults, yolo, approve } (the locked Wave-0 export-gate test contract), not the plan's { issues, yolo, approve } — collectGateIssues runs INTERNALLY. Rule-1 reconciliation honoring the locked test, mirroring 06-02's PlagiarismResult reconciliation"
  - "runHumanizer lives in bin/lib/exporter.ts (NOT bin/cli/done.ts): the locked Wave-0 humanizer-wrap test imports it from exporter.js AND its skip-guard greps exporter.ts source for the runHumanizer export (06-04 SUMMARY confirms this). done.ts imports it. Rule-1 reconciliation honoring the locked test"
  - "readSectionUnsupported pins the renderPass2Section contract via module-level constants (PASS2_HEADING / PASS2_TABLE_HEADER / PASS2_EMPTY_MARKER / VALID_VERDICTS) so a future writer desync is caught and fails safe"
  - "done.ts leaves exportDraft outputDir UNSET so exports land in the exporter's distinct .paper/export/ dir — the md-fallback never overwrites the source DRAFT.md and the verb-level zero-trace scan targets a real distinct deliverable"
  - "honesty report explicitly guards the null score: a missing GPTZERO_API_KEY emits the skip banner, never dereferences before.aiProbability (T-06-05-05)"
  - "the bespoke tier-contract done test runs `done --yolo --format md` so the produced .paper/export/DRAFT.md is deterministic on any machine (Pandoc-present or not), unlike the docx default"
  - "the done present-path humanize (Tier-1 Task transport writing FINAL.md) is a documented best-effort: no Task transport in Tier 2 / the current era → treated as skip-clean with a distinct banner so the export always proceeds (06-RESEARCH A7)"

requirements-completed: [DONE-01, DONE-03, DONE-09]

# Metrics
duration: 20min
completed: 2026-06-18
---

# Phase 6 Plan 05: Done / Export Pipeline Orchestrator + DONE-09 Gate Summary

**Assembled the Wave-1 export modules into `bin/cli/done.ts` — the thin `done`-verb orchestrator wiring whole-paper Pass 4 (DONE-01) → plagiarism → honesty(before) → humanizer wrap (DONE-03, skip-clean) → honesty(after) → the always-confirm DONE-09 export-confirmation gate → `exportDraft` into the distinct `.paper/export/` dir, with a FAIL-SAFE section Pass-2 UNSUPPORTED reader pinned to the renderPass2Section contract; promoted `done` to a real verb loader, filled `workflows/done.md`, and added the HIGH-3 disk→gate feed tests + the done tier-contract parity case. `npm run check` is FULLY green (685 tests, 0 fail, 0 skip).**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-06-18
- **Tasks:** 3 (+ 1 Rule-3 auto-fix)
- **Files modified:** 7 (1 created, 6 modified)

## Accomplishments

- **DONE-09 gate (`runDoneGate`)** — ALWAYS prompts (generic confirm even on a clean paper, PRD §7.9); prints a PER-ISSUE summary FIRST when any UNSUPPORTED claim, orphan claim, or plagiarism hit is present; only `--yolo` skips it (returns `{ gateSkipped: true }` and never calls the approver). Injectable approver so tests assert it is/isn't called per branch. The SOLE escape valve reconciling the Core Value with VRFY-07.
- **`collectGateIssues`** — buckets the three advisory inputs (UNSUPPORTED Pass-2, orphanCount>0 Pass-4, plagiarism-hit results); `hasIssues` is the OR.
- **`readSectionUnsupported` (HIGH-3, FAIL-SAFE)** — scans `.paper/sections/<dir>/VERIFICATION.md` for the pinned `## Pass-2` table, filters to the bolded `**UNSUPPORTED**` verdict rows. A present-but-unparseable table (wrong header / malformed separator / wrong cell count / unknown verdict) yields a synthetic `<unparseable>` UNSUPPORTED sentinel so the gate requires confirmation — NEVER a silent clean. A genuinely absent `## Pass-2` heading or a missing file returns `[]` (clean). I/O errors are skipped, never thrown.
- **DONE-03 humanizer wrap (`runHumanizer` in exporter.ts)** — absent skill → banner + null; present-but-no-transport (Tier-2 era) → distinct banner + null; never throws; the export always proceeds on `DRAFT.md`.
- **DONE-01 whole-paper Pass 4 (`runWholePaperPass4`)** — runs `runPass4` over `.paper/DRAFT.md`, feeding orphan paragraphs to the gate.
- **`doneCommand` orchestrator** — args `{ yolo, format, raw }`; reads `DRAFT.md` (missing → clean error, no throw); runs the full pipeline; `exportDraft` called WITHOUT `outputDir` so exports land in the distinct `.paper/export/` dir; writes the source `.paper/VERIFICATION.md` (honesty + plagiarism + Pass-4). stdout-only.
- **Verb loader + workflow body + tier-contract** — `done` promoted in `REAL_VERB_LOADERS` (locked 16 verbs intact; `done --help` resolves the real command); `workflows/done.md` filled (capability_check + 7 numbered steps + shell fallback, W4 closed-vocabulary tokens); `tests/tier-contract.test.ts` extended with the CLI-only `done` ContractCase + a bespoke offline parity test (trace-free `.paper/export/DRAFT.md`, source DRAFT.md untouched).

## Task Commits

1. **Task 1: DONE-09 gate + DONE-03 humanizer wrap + DONE-01 whole-paper Pass 4** — `55b7c88` (feat)
2. **Task 2: doneCommand orchestrator + fail-safe Pass-2 reader + verb loader + HIGH-3 tests** — `b51b3f8` (feat)
3. **Task 3: workflows/done.md + done tier-contract parity case** — `ebe7725` (feat)
4. **Rule-3 auto-fix: graduate done from the cli-stubs list** — `c194de8` (fix)

## Files Created/Modified

- `bin/cli/done.ts` (created) — the done thin orchestrator + `runDoneGate` / `collectGateIssues` / `runWholePaperPass4` / `readSectionUnsupported` / `doneCommand`.
- `bin/lib/exporter.ts` — added `runHumanizer` (DONE-03) + the `isHumanizerSkillPresent` import.
- `bin/pensmith.ts` — `done` promoted to a real loader in `REAL_VERB_LOADERS`.
- `workflows/done.md` — filled the Phase-2 stub with the full body.
- `tests/export-gate.test.ts` — 3 new HIGH-3 tests (parse + fail-safe + non-yolo on-disk integration); existing injected-data + --yolo cases retained.
- `tests/tier-contract.test.ts` — done CLI-only ContractCase + generic-loop skip + bespoke offline parity test.
- `tests/cli-stubs.test.ts` — removed `done` from the STUBS list (now a real verb).

## Decisions Made

- **`runDoneGate` flat input shape** — honored the locked Wave-0 export-gate test contract `{ pass2Results, pass4Results, plagiarismResults, yolo, approve }` (collectGateIssues runs internally) over the plan's `{ issues, ... }` draft. Rule-1 reconciliation, same stance as 06-02's PlagiarismResult.
- **`runHumanizer` in exporter.ts, not done.ts** — the locked humanizer-wrap test imports it from `exporter.js` and greps `exporter.ts` source for the export (06-04 explicitly tightened that skip-guard for this). done.ts imports it. Rule-1 reconciliation.
- **`outputDir` left UNSET** — exports land in the exporter's distinct `.paper/export/` dir; the source `DRAFT.md` is never overwritten (cycle-2 MEDIUM).
- **null-guarded honesty report** — a missing GPTZero key emits the skip banner, never a fabricated percent (T-06-05-05).
- **`--format md` in the bespoke tier-contract test** — deterministic export artifact on any machine regardless of Pandoc presence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Graduated `done` from the cli-stubs TIER-04 list**
- **Found during:** Task 2 (after promoting `done` to a real `REAL_VERB_LOADERS` entry).
- **Issue:** `tests/cli-stubs.test.ts` asserts each stub verb (incl. `done`) exits 0 with 'not implemented yet'. Once `done` is a real loader, `pensmith done` runs the real pipeline (and, on a TTY-less spawn with no input, the gate's confirm prompt aborts) — the stub assertion no longer holds.
- **Fix:** Removed `done` from the STUBS list (now 7 stubs), updated the comment. Exactly the Plan 04-05 precedent for `compile`. `done` is exercised by tier-contract.test.ts instead.
- **Files modified:** `tests/cli-stubs.test.ts`
- **Commit:** `c194de8`

### Reconciliations (honoring locked contracts — not behavioral deviations)

- **`runDoneGate` flat shape** and **`runHumanizer` placement in exporter.ts** were reconciled to the locked Wave-0 tests (see Decisions Made). These were anticipated by the plan's own interface notes and the 06-01/06-04 SUMMARYs; they do not change the plan's behavior, only the symbol's home/signature.

### Bug fixed while authoring

- **JSDoc `*/` comment-end token inside a glob path** — an early draft of `readSectionUnsupported`'s doc comment contained `` `.paper/sections/*/VERIFICATION.md` ``; the `*/` in `sections/*/` prematurely closed the block comment, leaving a lone backtick that tsc parsed as an unterminated template literal (cascading "Invalid character" + "Unterminated template literal" errors). Caught by the typecheck gate before commit; rephrased to `<dir>`. Not a runtime defect.

## Authentication Gates

None — the pipeline runs fully offline under PENSMITH_NO_LLM=1 (Pass 4 deterministic, plagiarism via cassette, honesty skips without GPTZERO_API_KEY, humanizer skip-clean).

## Known Stubs

- **`runHumanizer` present-path (Tier-1 Task transport → FINAL.md)** — intentionally not implemented in this tier: there is no Task transport wired in Tier 2 / the current era (06-RESEARCH A7), so a present-but-no-transport skill is treated as skip-clean (banner + null) and the export proceeds on DRAFT.md. This is a documented, intentional degrade path (never fails the export), not an accidental empty-data stub; a later phase wires the Tier-1 Task invocation. The skip path (the path exercised on this machine and in CI) is fully implemented and tested.

## Verification Results

- `node --import tsx --test tests/export-gate.test.ts tests/humanizer-wrap.test.ts` — 14/14 pass (gate branches + humanizer skip-clean + the 3 HIGH-3 readSectionUnsupported parse/fail-safe/non-yolo-integration tests).
- `node --import tsx --test tests/cli-verbs.test.ts` — 2/2 pass (16 verbs intact; done is a real loader, no 17th).
- `node --import tsx --test tests/workflows-keyequal.test.ts` + `scripts/validate-plugin-manifest.cjs` — pass (done.md has a valid capability_check; W4 closed vocabulary holds; 16-workflow bijection intact).
- `npm run test:tier-contract` — 34/34 pass (done CLI-only case + bespoke offline parity test; produced `.paper/export/DRAFT.md` trace-free, distinct from the source DRAFT.md).
- `npm run lint` + `tsc --noEmit` — clean (thin orchestrator, stdout-only, no console.*).
- **`npm run check` — FULLY green: lint + typecheck + build + tier-contract + 685 tests (0 fail, 0 skip) + manifests valid.** Zero RED-by-skip remaining for this phase.

## Threat Surface

All threat-register dispositions for this plan are mitigated:
- **T-06-05-01** (gate bypass): runDoneGate ALWAYS calls approve() in the non-yolo path; per-issue summary precedes confirm; only --yolo skips — asserted incl. the non-yolo on-disk integration test (HIGH-3).
- **T-06-05-02** (desynced Pass-2 silently dropping UNSUPPORTED): readSectionUnsupported pinned to the renderPass2Section contract + FAILS SAFE (synthetic sentinel); unit tests cover parse, fail-safe, and the non-yolo feed.
- **T-06-05-03** (humanizer-absent hard-exit): runHumanizer gates on isHumanizerSkillPresent() + treats no-transport as skip-clean; banner + null + never throws.
- **T-06-05-04** (export carrying a pensmith trace): exportDraft runs the mandatory per-format scrub + writes to the distinct export dir; the bespoke tier-contract test scans the produced export-dir artifact for 'pensmith' → 0.
- **T-06-05-05** (misframed honesty score): renderHonestyReport renders the note verbatim from the locked file; done.ts only passes percentages with an explicit null-guard.

No new security surface beyond the plan's threat model was introduced.

---
*Phase: 06-done-export-pipeline-zero-trace-gate*
*Completed: 2026-06-18*

## Self-Check: PASSED

- Created file verified on disk: `bin/cli/done.ts`, `.planning/phases/06-done-export-pipeline-zero-trace-gate/06-05-SUMMARY.md`.
- All task commits verified in git log: `55b7c88` (Task 1), `b51b3f8` (Task 2), `ebe7725` (Task 3), `c194de8` (Rule-3 auto-fix).
- `npm run check` FULLY green: 685 tests, 0 fail, 0 skip; manifests valid.
