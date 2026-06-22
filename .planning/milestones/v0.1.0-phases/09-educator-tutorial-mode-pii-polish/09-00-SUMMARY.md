---
phase: 09-educator-tutorial-mode-pii-polish
plan: 00
subsystem: tutorial-mode + pii-polish (Wave-0 RED scaffold)
tags: [red-by-skip, tdd-scaffold, pii, tutorial, zero-branch-invariant, wn-3]
requires:
  - "Phase 1 bin/lib/pii.ts (classifyPii/redactPii — extended by 09-01)"
  - "Phase 6 bin/lib/exporter.ts (exportDraft — export-exclusion structural test)"
  - "Phase 7 bin/lib/router.ts (resolveNextAction — goal-unaware; DI param lands 09-03)"
  - "Phase 3 bin/cli/intake.ts (interpolate egress seam — PII wiring lands 09-03)"
provides:
  - "tests/pii-polish.test.ts — RED-by-skip IP/IBAN + NAME-suppression + diffPii determinism/idempotence/purity"
  - "tests/tutorial-observer.test.ts — RED-by-skip subscriber + NON-SKIP router goal-unawareness (H1)"
  - "tests/goal-routing.test.ts — RED-by-skip stopAfterResearch DI routing"
  - "tests/tutorial-provenance.test.ts — RED-by-skip SECTION + RESEARCH-stage per-claim (H2) + export-exclusion"
  - "tests/intake-pii-ordering.test.ts — RED-by-skip diffPii<loadPrompt ordering + INTAKE.raw.local"
  - "tests/intake-pii-egress.test.ts — RED-by-skip egress-by-content (H3)"
  - "tests/lint-tutorial-no-branch.test.ts — STANDING zero-branch invariant (passes now)"
  - "bin/lib/tutorial.ts — TutorialSubscriber stub (sole goal-aware seam)"
  - "templates/prompts/tutorial-{section-provenance,research-rationale}.md — WN-3 sentinels"
  - "tests/fixtures/{pii-polish-corpus.ts, tutorial-paper/*}"
affects:
  - "09-01 (pii.ts IP/IBAN + diffPii), 09-02 (TutorialSubscriber render), 09-03 (intake PII wiring + router DI + prompt re-pin)"
tech-stack:
  added: []
  patterns:
    - "RED-by-skip via SOURCE-GREP predicate (existsSync can't detect not-yet-wired behavior) — [07-01]/[08-00] precedent"
    - "WN-3 lockstep sentinel across prompt-loader.ts EXPECTED_PROMPT_HASHES + repo-files.test.ts PENDING_HASH_PINS"
    - "Zero-branch filesystem-scan invariant (case-insensitive, comment-stripped) + anti-rot self-test"
key-files:
  created:
    - tests/pii-polish.test.ts
    - tests/fixtures/pii-polish-corpus.ts
    - tests/tutorial-observer.test.ts
    - tests/goal-routing.test.ts
    - tests/tutorial-provenance.test.ts
    - tests/intake-pii-ordering.test.ts
    - tests/intake-pii-egress.test.ts
    - tests/lint-tutorial-no-branch.test.ts
    - bin/lib/tutorial.ts
    - templates/prompts/tutorial-section-provenance.md
    - templates/prompts/tutorial-research-rationale.md
    - tests/fixtures/tutorial-paper/OUTLINE.md
    - tests/fixtures/tutorial-paper/sections/01-background/PLAN.md
    - tests/fixtures/tutorial-paper/RESEARCH.md
    - tests/fixtures/tutorial-paper/LIBRARY.json
  modified:
    - bin/lib/prompt-loader.ts
    - tests/repo-files.test.ts
    - .gitignore
decisions:
  - "Zero-branch pattern made CASE-INSENSITIVE (`/i`) to defeat camelCase helper-extraction (isLearningGoal) — bare `\\blearning\\b` would miss it; anti-rot self-test forced the fix"
  - "repo-files PENDING_HASH_PINS byte-pin loop now skips __PENDING_HASH_ sentinel entries — keeps suite GREEN until 09-03 real re-pin (mirrors loadPrompt sentinel bypass)"
  - "PII_EGRESS_SENTINELS live in pii-polish-corpus.ts as the single canonical set shared by the egress test (no duplication)"
metrics:
  duration_min: 11
  completed: 2026-06-20
---

# Phase 9 Plan 00: Wave-0 RED Scaffold (Tutorial Mode + PII Polish) Summary

RED-by-skip scaffold for educator/tutorial mode and PII polish: 7 new test files, 5 fixtures, the TutorialSubscriber stub, two WN-3 hash-pinned tutorial prompts, and defensive .gitignore entries — landed BEFORE any implementation so the full suite stays GREEN (816 tests, 0 fail) through Waves 1-2 while the standing zero-branch + router goal-unawareness invariants pass now.

## What was built

**Task 1 — PII-polish RED suite + corpus + WN-3 sentinels (commit 8ad1b3b):**
- `tests/pii-polish.test.ts` mirrors `tests/pii.test.ts`; RED-by-skip on `piiPolishReady()` (greps pii.ts for `diffPii` + `RE_IP`). Covers IP/IBAN classify, NAME suppression (negatives drop, two-token positives keep), diffPii determinism/idempotence/purity (`{span,kind,raw,tag}` with `tag === [REDACTED:KIND]`), and an IP no-leak fast-check property.
- `tests/fixtures/pii-polish-corpus.ts` exports IP/IBAN positives, NAME suppress negatives + two-token positives, DIFF_CASES, and the canonical `PII_EGRESS_SENTINELS` shared with Task 3.
- Two teaching-wrapper prompts (`tutorial-section-provenance.md`, `tutorial-research-rationale.md`) with no PII placeholders; both slugs registered as `__PENDING_HASH_<slug>__` in lockstep across `prompt-loader.ts` EXPECTED_PROMPT_HASHES and `repo-files.test.ts` PENDING_HASH_PINS (WN-3). The byte-pin loop now skips sentinel entries.

**Task 2 — tutorial/goal/provenance RED suites + zero-branch invariant + stub + fixtures (commit fd762c9):**
- `bin/lib/tutorial.ts` stub: `TutorialEventKind`, `TutorialEvent`, `TutorialSubscriber` (constructor `{tutorialPath, goal}`, never-throw `emit()`, `flush()`). Imports only node:events, node:path, ./atomic-write.js. Compiles under `tsc --noEmit`. The SOLE goal-aware seam.
- `tests/lint-tutorial-no-branch.test.ts` — standing zero-branch invariant; recursively scans ALL `bin/lib/**/*.ts` (router.ts INCLUDED, only tutorial.ts excluded) + `workflows/**/*.md`, strips comments, asserts zero matches of the case-insensitive authoritative pattern, plus an anti-rot self-test. PASSES now.
- `tests/tutorial-observer.test.ts` — RED-by-skip subscriber activation + the NON-SKIP router goal-unawareness assertion (H1) + forward-looking `stopAfterResearch` DI skip-guard.
- `tests/goal-routing.test.ts` — RED-by-skip goal enum + `stopAfterResearch` DI routing (true⇒terminal, false/default⇒outline).
- `tests/tutorial-provenance.test.ts` — RED-by-skip SECTION-stage (`## Section` + citekeys), RESEARCH-stage per-claim H2 (≥1 citekey+claim line from a research.done event WITHOUT any section.written), no `.paper/sections/` paths, and the export-exclusion structural test (passes now, exporter exists).
- `tests/fixtures/tutorial-paper/` — OUTLINE.md, sections/01-background/PLAN.md (`assigned_sources`), RESEARCH.md (per-source `supports:` claims), LIBRARY.json (valid SourceCandidate[]).

**Task 3 — intake PII gates + .gitignore (commit 8a8e243):**
- `tests/intake-pii-ordering.test.ts` — RED-by-skip structural ordering (`diffPii` before `loadPrompt('intake-clarifier')`) + INTAKE.raw.local write on opt-in + opt-out no-raw-local.
- `tests/intake-pii-egress.test.ts` — RED-by-skip egress-by-content (H3): spies `interpolate`, asserts no raw PII_EGRESS_SENTINELS in the model-bound payload AND a `[REDACTED:KIND]` tag is present (closes the ordering-only gap a verbatim implementer leaves).
- `.gitignore` — defensive `**/TUTORIAL.md` + `**/INTAKE.raw.local` (RESEARCH Pitfall 7).

## Convergence gates landed (per plan)

- ZERO-BRANCH INVARIANT — passes now; scans router.ts (no exclusion); case-insensitive + comment-stripped + anti-rot.
- ROUTER GOAL-UNAWARENESS (H1) — passes now (router.ts has zero goal tokens).
- PII EGRESS BY-CONTENT (H3) — RED-by-skip; captures the live interpolate payload, asserts sentinel absence + REDACTED-tag presence.
- PER-CLAIM PROVENANCE (H2) — RED-by-skip; research.done (no section.written) ⇒ ≥1 citekey+claim line.
- ORDERING grep — RED-by-skip (diffPii < loadPrompt).
- WN-3 sentinels — both tutorial prompts pinned in lockstep; resolve under PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1; real re-pin deferred to 09-03.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Zero-branch pattern missed camelCase helper-extraction**
- **Found during:** Task 2 (anti-rot self-test failed on `function isLearningGoal() {}`)
- **Issue:** the plan's `/\blearning\b/` token cannot match `learning` inside `isLearningGoal` (no word boundary, capital L). The plan's stated intent was to defeat helper-extraction.
- **Fix:** made the authoritative pattern case-insensitive (`/i`) and dropped the trailing `\b` on `learning`/`educator` so camelCase/UPPER variants are caught. Verified no real (non-comment) code in bin/lib or workflows trips it.
- **Files modified:** tests/lint-tutorial-no-branch.test.ts
- **Commit:** fd762c9

**2. [Rule 3 - Blocking] repo-files byte-pin loop would FAIL on the new sentinel entries**
- **Found during:** Task 1
- **Issue:** the existing `PENDING_HASH_PINS` byte-pin loop compares on-disk SHA-256 against `pin.hash`; the two new `__PENDING_HASH_<slug>__` sentinel entries would never match → hard fail, breaking the GREEN-suite invariant.
- **Fix:** guarded the byte-pin loop with `{ skip: pin.hash.startsWith('__PENDING_HASH_') }`; the file-exists loop still asserts presence. Mirrors the loadPrompt sentinel bypass. 09-03's atomic re-pin flips both surfaces to real SHA-256.
- **Files modified:** tests/repo-files.test.ts
- **Commit:** 8ad1b3b

**3. [Rule 3 - Blocking] fixture `.filter(c => c.raw !== '')` tripped tsc dead-comparison**
- **Found during:** Task 1
- **Issue:** unlike pii-corpus.ts (which has a literal `raw: ''` stub entry), my IP/IBAN array has no empty-raw entry, so the literal-union type excluded `''` and `tsc --noEmit` flagged the comparison as unintentional (TS2367). The fixture is imported by a type-checked test, so the exclude dir doesn't help.
- **Fix:** removed the vacuous filter (no stub entries exist here) and the stale doc comment.
- **Files modified:** tests/fixtures/pii-polish-corpus.ts
- **Commit:** 8ad1b3b

## Verification

- `npm test` GREEN: 816 tests, 792 pass, 0 fail, 24 skipped (exit 0).
- `tsc --noEmit` clean (tutorial.ts stub compiles; all new tests typecheck).
- Both tutorial prompt slugs resolve under PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1.
- lint-tutorial-no-branch scans router.ts and finds zero educator-mode tokens.
- `.gitignore` ignores TUTORIAL.md (via **/glob) and INTAKE.raw.local; committed fixtures are NOT ignored.

## Known Stubs

- **bin/lib/tutorial.ts** — `TutorialSubscriber.emit()` is a no-op chain enqueue; `flush()` awaits the resolved chain. This is the intended Wave-0 stub; the real per-claim provenance rendering lands in 09-02. The RED-by-skip subscriber tests (`tutorialRenderWired()` greps for a real `atomicWriteFile(` call + provenance render) stay skipped until then, so the stub cannot masquerade as complete. Documented and gated.

## Self-Check: PASSED
- All 15 created files verified present on disk.
- Commits 8ad1b3b, fd762c9, 8a8e243 verified in git log.
