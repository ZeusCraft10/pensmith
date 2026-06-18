---
phase: 05-verifier-completeness-pass-2-pass-4
plan: 01
subsystem: testing
tags: [verifier, pass2, pass4, red-scaffold, wn3, prompt-loader, d-13, orphan-claim, unclear-bias, hash-pin]

# Dependency graph
requires:
  - phase: 04-breadth-n-sections-compile-wave-scheduling
    provides: WN-3 sentinel-then-real prompt-hash lockstep precedent (smoother/revise-swap), advisory side-channel pattern (freshness.ts), D-13 loadPrompt chokepoint on verify.ts
provides:
  - RED test suite for Pass 2 (VRFY-03 UNCLEAR-bias) and Pass 4 (VRFY-06 deterministic orphan extraction), skip-guarded pending pass2.ts/pass4.ts
  - tests/fixtures/pass2-adversarial.json — 12 adversarial entries (6 UNCLEAR, 2 PARTIAL, 2 SUPPORTED, 2 UNSUPPORTED)
  - tests/fixtures/pass4-orphan.json — 7 orphan fixtures with counts derived from the pinned rule R1-R8 (canonical Climate-change example = 1)
  - templates/prompts/claim-support.md + orphan-label.md stub prompts with fixed interpolation var contracts
  - bin/lib/prompt-loader.ts EXPECTED_PROMPT_HASHES WN-3 sentinels for claim-support + orphan-label (resolvable before pass modules land)
  - tests/repo-files.test.ts byte-pins (real SHA-256) for both new prompts
  - tests/verify-advisory-isolation.test.ts — advisory non-regression (hasFail/status never set from pass2/pass4) + committed D-13 whole-file loadPrompt==0 regression
affects: [05-02 (Pass 2), 05-03 (Pass 4), 05-04 (verify.ts wiring + tier-contract), 05-05 (WN-3 atomic re-pin)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RED-by-skip: behavioral tests skip-guarded on existsSync of the not-yet-created module so the suite reports skips with ZERO failures (not RED-by-crash)"
    - "WN-3 sentinel-then-real: loader holds __PENDING_HASH_<slug>__ until atomic re-pin; repo-files byte-pin carries the real SHA-256 from creation"
    - "Pinned rule R1-R8 as single source of truth: fixture orphan counts derived by mechanically walking the rule, including the R5 >=8-word floor before R6 marker counting"
    - "Committed chokepoint regression: durable test replacing an ad-hoc grep for the D-13 whole-file loadPrompt==0 invariant"

key-files:
  created:
    - tests/fixtures/pass2-adversarial.json
    - tests/fixtures/pass4-orphan.json
    - tests/known-bad-pass2.test.ts
    - tests/known-bad-pass4.test.ts
    - templates/prompts/claim-support.md
    - templates/prompts/orphan-label.md
    - tests/verify-advisory-isolation.test.ts
  modified:
    - bin/lib/prompt-loader.ts
    - tests/repo-files.test.ts

key-decisions:
  - "Module-existence assertions converted from hard-fail (the known-bad-citations analog) to RED-by-skip consistency checks so the Wave-0 run reports zero failures per the plan's acceptance criteria"
  - "pass4-orphan.json authored with the short-paragraph practical reading of R2 (paragraph contains a [@citekey]); cited-vs-uncited isolated via paired single-sentence entries (only the [@citekey] differs) to remove all proximity ambiguity"
  - "claim-support evidence field constrained to a verbatim substring of the abstract (T-05-02 anti-fabrication); UNCLEAR is the documented default"

patterns-established:
  - "RED-by-skip behavioral tests: zero failures while modules are pending"
  - "WN-3 sentinel registration BEFORE pass modules so loadPrompt resolves the slug the moment the LLM seam is wired"

requirements-completed: []

# Metrics
duration: 8min
completed: 2026-06-18
---

# Phase 5 Plan 01: Verifier Pass 2/4 Wave 0 RED Scaffold Summary

**RED test suite + adversarial/orphan fixtures (orphan counts derived from the pinned rule R1-R8), two stub advisory prompts with WN-3 sentinels, real byte-pins, and a committed D-13 whole-file `loadPrompt`==0 regression — all green/skip with zero failures and verify.ts byte-unchanged.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-18T05:51:56Z
- **Completed:** 2026-06-18T05:59:20Z
- **Tasks:** 2
- **Files created:** 7
- **Files modified:** 2

## Accomplishments
- Pass 2 (VRFY-03) and Pass 4 (VRFY-06) RED suites land skip-guarded: fixture/shape assertions PASS now; behavioral assertions SKIP pending pass2.ts/pass4.ts. Zero failures.
- pass4-orphan.json orphan counts are each derived by mechanically walking the pinned rule R1-R8; a verification script confirmed all 7 entries are self-consistent with the rule (canonical Climate-change example resolves to orphanCount=1 via three >=8-word sentences, with S2 the lone HIGH orphan).
- claim-support + orphan-label registered as `__PENDING_HASH_<slug>__` sentinels in EXPECTED_PROMPT_HASHES (WN-3 ordering) so the loader resolves the slugs before the pass modules exist; real SHA-256 byte-pins land in repo-files.test.ts (GREEN from creation).
- Advisory-isolation test guard (A) asserts hasFail/status is never assigned from a pass2/pass4 expression; guard (B) is the committed D-13 regression: whole-file `loadPrompt` count == 0 in bin/cli/verify.ts (comments included).
- bin/cli/verify.ts byte-UNCHANGED (empty diff); `npm run typecheck` GREEN; full suite 644 pass / 0 fail / 5 skip.

## Task Commits

Each task was committed atomically:

1. **Task 1: Pass 2 + Pass 4 fixtures + two RED behavioral test files** - `722d6ff` (test)
2. **Task 2: Advisory-isolation + D-13 0-hit regression, WN-3 sentinels, stub prompts, byte-pins** - `6cdaf08` (feat)

**Plan metadata:** (final docs commit — this SUMMARY + STATE.md + ROADMAP.md + REQUIREMENTS.md)

## Files Created/Modified
- `tests/fixtures/pass2-adversarial.json` - 12 Pass-2 adversarial entries (6 UNCLEAR thematically-adjacent-but-unsupportive, plus PARTIAL/SUPPORTED/UNSUPPORTED enum coverage)
- `tests/fixtures/pass4-orphan.json` - 7 Pass-4 orphan fixtures; each expected_orphan_count derived by walking R1-R8 with per-sentence word counts recorded at the R5 step
- `tests/known-bad-pass2.test.ts` - VRFY-03 RED suite: fixture/shape PASS; runPass2 UNCLEAR placeholder + ARCH-10 assertBudget source proxy SKIP
- `tests/known-bad-pass4.test.ts` - VRFY-06 RED suite: fixture/shape PASS; extractClaimsFromParagraph determinism + orphan-count + definition-skip SKIP
- `templates/prompts/claim-support.md` - Pass 2 UNCLEAR-bias prompt (vars: citekey, claim_sentence, source_abstract, source_title, source_authors; evidence must be a verbatim abstract substring)
- `templates/prompts/orphan-label.md` - Pass 4 Step-3 claim/definition/UNCLEAR classifier (vars: sentence, paragraph_context)
- `tests/verify-advisory-isolation.test.ts` - guard A (advisory isolation, VRFY-07/T-05-03) + guard B (D-13 whole-file loadPrompt==0, T-05-04)
- `bin/lib/prompt-loader.ts` - added claim-support + orphan-label WN-3 sentinels with a Phase-5 comment naming them ACTIVE slugs invoked from pass2.ts/pass4.ts
- `tests/repo-files.test.ts` - added real SHA-256 byte-pins for claim-support (`ceec7601…`) and orphan-label (`f8b385f3…`)

## Decisions Made
- **Module-existence tests are RED-by-skip, not hard-fail.** The known-bad-citations analog makes the production-module-exists check a hard assertion; the plan's acceptance criteria explicitly require zero failures with behavioral tests skipping. Converted those checks to a consistency assertion that confirms the Wave-0 absent state and flips to a present-state PASS when 05-02/05-03 land the modules.
- **pass4-orphan.json uses the R2 short-paragraph practical reading** ("the paragraph contains a [@citekey]"). To eliminate any proximity-byte-distance ambiguity, the cited-vs-uncited path is isolated by a paired set of single-sentence entries that are byte-identical except for the trailing [@citekey] (one cited → 0 orphans, one uncited → 1 orphan). A mechanical R1-R8 walker script confirmed all 7 counts.
- **claim-support evidence anti-fabrication.** The prompt requires `evidence` to be a verbatim substring of the abstract (empty string if none) — the V5/T-05-02 input-validation mitigation staged for Plans 02/03.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Module-existence assertions would have produced 2 hard failures in Wave 0**
- **Found during:** Task 1 (RED behavioral test files)
- **Issue:** Mirroring the `known-bad-citations.test.ts` analog verbatim made the "module exists" check a hard assertion (it skips only on a missing fixture). With the fixtures present and the pass modules absent, this fired 2 failures — contradicting the plan's acceptance criteria ("behavioral tests SKIP (not error) … zero failures") and the success criterion that RED be RED-by-skip not RED-by-crash.
- **Fix:** Replaced each hard module-existence assertion with a forward-compatible consistency check: in Wave 0 it asserts the module is absent (RED-by-skip); once 05-02/05-03 land the module it asserts presence and the behavioral tests un-skip. Either way the run is zero-failure.
- **Files modified:** tests/known-bad-pass2.test.ts, tests/known-bad-pass4.test.ts
- **Verification:** `node --import tsx --test tests/known-bad-pass2.test.ts tests/known-bad-pass4.test.ts` → 6 pass, 5 skip, 0 fail.
- **Committed in:** 722d6ff (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary to satisfy the plan's own zero-failure / RED-by-skip acceptance criteria. No scope creep — the fixtures, prompts, sentinels, byte-pins, and isolation guards are all exactly as specified.

## Issues Encountered
- First draft of pass4-orphan.json carried `_superseded` placeholder entries whose orphan counts hit the R2 proximity ambiguity (multiple HIGH claims sharing one [@citekey] inside a single paragraph). These were removed entirely; the final fixture contains only entries whose counts are unambiguous under R1-R8, confirmed by a mechanical walker script before commit. No contradictory expected counts shipped.

## Known Stubs
- `templates/prompts/claim-support.md` and `templates/prompts/orphan-label.md` are content-complete prompt bodies, but the modules that invoke them (`bin/lib/verify/pass2.ts`, `bin/lib/verify/pass4.ts`) do not exist yet — they land in Plans 05-02/05-03. This is the intended Wave-0 RED state; the EXPECTED_PROMPT_HASHES sentinels exist so the loader can resolve the slugs the moment those modules wire the LLM seam (WN-3). Not a defect.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Wave 1 (05-02 Pass 2, 05-03 Pass 4) can proceed: fixtures, prompt files, and resolvable WN-3 sentinels are in place; the pinned rule R1-R8 is the single source of truth 05-03's extractor must implement against (canonical example = 1).
- Wave 2 (05-04 verify.ts wiring) inherits the advisory-isolation + D-13 guards as merge gates — wiring runPass2/runPass4 must keep hasFail/status untouched and must not introduce a `loadPrompt` symbol into verify.ts.
- Wave 3 (05-05 WN-3 atomic re-pin) must replace both loader sentinels with the real SHA-256 (`ceec7601…` / `f8b385f3…`) the repo-files pins already carry, in a single atomic commit.

## Self-Check: PASSED

All 9 created/modified files verified present on disk; both task commits (`722d6ff`, `6cdaf08`) verified in git log. Verification: 7 new files exist, prompt-loader.ts + repo-files.test.ts modified, SUMMARY present; `node --import tsx --test` of the two RED files → 6 pass / 5 skip / 0 fail; `PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1 npm test` → 644 pass / 0 fail / 5 skip; `npm run typecheck` GREEN; `git diff bin/cli/verify.ts` empty.

---
*Phase: 05-verifier-completeness-pass-2-pass-4*
*Completed: 2026-06-18*
