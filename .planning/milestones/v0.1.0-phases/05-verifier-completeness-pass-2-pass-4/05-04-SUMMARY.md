---
phase: 05-verifier-completeness-pass-2-pass-4
plan: 04
subsystem: verifier
tags: [verifier, pass2, pass4, advisory, orchestrator-wiring, tier-contract, d-13, vrfy-07, no-llm-parity, locked-16]

# Dependency graph
requires:
  - phase: 05-verifier-completeness-pass-2-pass-4
    provides: "runPass2 + renderPass2Section (Plan 05-02); runPass4 + renderPass4Section (Plan 05-03); advisory-isolation Guard A/B regression test + EXPECTED_PROMPT_HASHES sentinels (Plan 05-01)"
  - phase: 04-breadth-n-sections-compile-wave-scheduling
    provides: "runFreshnessForDraft advisory call-site position (the freshness mirror); verify.ts thin-orchestrator shape; tier-contract verify-section case + seedPaperFixture"
provides:
  - "bin/cli/verify.ts — advisory Pass-2 + Pass-4 wiring below the frozen status line; ## Pass-2 / ## Pass-4 rendered into VERIFICATION.md; widened bibByCitekey carrying title/author/abstract; pass2/pass4 added to the return for DONE-09 (Phase 6)"
  - "tier-contract verify-section parity: ## Pass-2 + ## Pass-4 asserted in BOTH tiers (modulo prose) on the no-LLM CI path + an **UNCLEAR** verdict row"
affects: [06 (DONE-09 consumes verify return pass2/pass4), 05-05 (WN-3 atomic re-pin — verify.ts byte-stable after this wiring)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Advisory call-site position (freshness.ts mirror): runPass2/runPass4 invoked AFTER hasFail/hasUnverifiable/status are frozen; status never references pass2/pass4 (VRFY-07)"
    - "D-13 by import, not by abstention-comment: importing runPass2/runPass4 from their modules carries no `loadPrompt` literal — Pass 2/4 load their own prompts internally, so the whole-file `loadPrompt`-count in verify.ts stays 0 (comments included)"
    - "Tier parity scoped to the offline path: under PENSMITH_NO_LLM=1 both tiers emit deterministic all-UNCLEAR Pass-2 + identical Pass-4 orphan counts → presence + all-UNCLEAR row + ±20% length pins SC3; live verdict parity out of CI scope (documented)"
    - "Scoped fixture seed: verify-section gets its own seedVerifySectionDraft (DRAFT.md with a real [@citekey]); shared seedPaperFixture left untouched so other PHASE_3_CASES keep their clean no-draft state"

key-files:
  created: []
  modified:
    - bin/cli/verify.ts
    - tests/tier-contract.test.ts

key-decisions:
  - "Widened bibByCitekey value type declared as a local `BibValue` alias in verify.ts (DOI? + title? + author? + abstract?) cast over each parsed entry — additive, backward-compatible with runPass3 (reads only DOI), and structurally identical to pass2.ts's Pass2BibEntry so runPass2 type-checks without an import."
  - "Advisory call-site comment paraphrases the prompt-load path as 'Pass 2/4 load their own prompts inside their modules (the prompt-loader path lives there, not here)' — deliberately avoids the literal symbol `loadPrompt` to keep the D-13 whole-file count at 0 (comments included), matching the existing D-13 comment's paraphrase style."
  - "Picked vaswani2017attention as the seeded DRAFT.md citekey — it is the sole real entry in tests/fixtures/known-good-fixture/CITATIONS.bib, so Pass 1 does not flag it FABRICATED and verify reaches the advisory passes."
  - "seedVerifySectionDraft is a dedicated helper called for BOTH the CLI root and the fresh MCP root inside the verify-section branch — the shared seedPaperFixture is NOT mutated (other PHASE_3_CASES rely on its no-DRAFT.md → unverifiable clean state)."

patterns-established:
  - "Wiring an advisory pass into a frozen-verdict orchestrator: import the run/render pair, call run() strictly below the status freeze, append render() to the lines[] array, add the result to the return — never touch hasFail/status. Template for any future advisory verifier pass."

requirements-completed: [VRFY-03, VRFY-06]

# Metrics
duration: 4min
completed: 2026-06-18
---

# Phase 5 Plan 04: Wire runPass2/runPass4 into verify.ts + Tier-Contract Parity Summary

**`bin/cli/verify.ts` now invokes the two advisory passes (Pass 2 claim-support + Pass 4 orphan-claim audit) AFTER the blocking `hasFail`/`hasUnverifiable`/`status` block is frozen — mirroring the existing freshness call site — renders `## Pass-2` + `## Pass-4` into VERIFICATION.md, widens `bibByCitekey` to carry title/author/abstract for Pass 2, and returns `pass2`/`pass4` for Phase 6 DONE-09. The wiring is pure import-and-call: verify.ts still loads no prompt itself, so the live D-13 chokepoint (`grep -c "loadPrompt" bin/cli/verify.ts == 0`, comments included) holds, re-asserted by the committed Guard B regression. The tier-contract `verify-section` case now seeds a `[@vaswani2017attention]` DRAFT.md and asserts `## Pass-2` + `## Pass-4` appear in BOTH tiers (modulo prose) with an `**UNCLEAR**` row on the no-LLM CI path.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-18T06:28:11Z
- **Completed:** 2026-06-18T06:32:40Z
- **Tasks:** 2
- **Files created:** 0
- **Files modified:** 2 (`bin/cli/verify.ts`, `tests/tier-contract.test.ts`)

## Accomplishments

- **VRFY-03 + VRFY-06 observable end-to-end.** `pensmith verify <N>` now writes a `## Pass-2` and a `## Pass-4` advisory section into `sections/<N>/VERIFICATION.md`, both written AFTER the blocking verdict is frozen. The advisory data is also returned (`pass2`, `pass4`) so Phase 6 DONE-09 can consume it.
- **Advisory isolation preserved (VRFY-07, T-05-04-01).** `runPass2`/`runPass4` are placed strictly below the `const status = …` freeze; `status` never references `pass2`/`pass4`. The committed `tests/verify-advisory-isolation.test.ts` Guard A (no `hasFail =`/`status =` on a `runPass2`/`runPass4` line) stays GREEN.
- **Live D-13 chokepoint intact (T-05-04-02).** `grep -c "loadPrompt" bin/cli/verify.ts` returns 0 (whole-file, comments included). The two new imports carry no `loadPrompt` literal; Pass 2/4 load their own prompts from their own modules; the call-site comment paraphrases the prompt-load path. Guard B (`(src.match(/loadPrompt/g) ?? []).length === 0`) PASSES post-wiring.
- **Tier parity proven on the no-LLM path (SC3, T-05-04-03).** The `verify-section` tier-contract case asserts `## Pass-2` + `## Pass-4` in both `cliArtifactBytes` and `mcpArtifactBytes`, plus an `**UNCLEAR**` verdict row in the CLI artifact (the `PENSMITH_NO_LLM=1` placeholder path). The pre-existing ±20% length equivalence (TIER-07) is retained unweakened. The no-LLM scope of SC3 is documented in inline comments (live verdict parity is out of CI scope by design).
- **Scoped fixture seed (planner CRITICAL FINDING resolved).** Added `seedVerifySectionDraft` — a verify-section-only DRAFT.md seed carrying `[@vaswani2017attention]` (a real entry in the seeded known-good CITATIONS.bib) so verify reaches the advisory passes instead of short-circuiting on a missing draft. The shared `seedPaperFixture` is untouched; the other PHASE_3_CASES keep their clean no-draft state and unchanged expected status.
- **Locked invariants untouched.** No 17th verb, no new `PHASE_3_CASES` entry. The full suite's `workflows/ contains exactly 16 markdown bodies` + `workflow filenames are bijective with dispatcher verbs` assertions stay GREEN. The D-24 obligation is satisfied by extending the existing verify-section case.
- **Full gate green.** `npm run lint`, `npm run typecheck`, `npm run build` (16 verbs locked), `npm run test:tier-contract` (31 pass / 0 fail), `npm test` (649 pass / 0 fail / 0 skip), and `npm run validate:manifests` all GREEN.

## Task Commits

Each task was committed atomically:

1. **Task 1: wire runPass2/runPass4 into verify.ts below the frozen status line + render ## Pass-2/## Pass-4 + widen bibByCitekey + return pass2/pass4** — `8f39697` (feat)
2. **Task 2: extend the verify-section tier-contract case to assert ## Pass-2 + ## Pass-4 parity across both tiers (+ verify-section-scoped DRAFT.md seed)** — `7bcc021` (test)

**Plan metadata:** (final docs commit — this SUMMARY + STATE.md + ROADMAP.md + REQUIREMENTS.md)

## Files Created/Modified

- `bin/cli/verify.ts` (modified, +29/−3) — added `runPass2`/`renderPass2Section` + `runPass4`/`renderPass4Section` imports; widened `bibByCitekey` to a local `BibValue` alias (DOI?/title?/author?/abstract?); added the two advisory calls below the frozen status block; appended `renderPass2Section(pass2)` + `renderPass4Section(pass4)` to the VERIFICATION.md `lines[]` array; added `pass2`/`pass4` to the return value.
- `tests/tier-contract.test.ts` (modified, +75) — added `seedVerifySectionDraft` helper; called it for both the CLI root and the fresh MCP root inside the verify-section branch; added CLI-side `## Pass-2` + `## Pass-4` + `**UNCLEAR**` assertions; added MCP-side `## Pass-2` + `## Pass-4` parity assertions; documented the no-LLM scope of SC3 in comments.

## Decisions Made

- **Local `BibValue` type alias** in verify.ts rather than importing `Pass2BibEntry` from pass2.ts — keeps verify.ts free of any pass2-internal symbol while remaining structurally identical (additive, backward-compatible with runPass3 which reads only DOI).
- **`vaswani2017attention`** chosen as the seeded citekey (sole real entry in the known-good CITATIONS.bib) so Pass 1 passes it and verify reaches Pass 2/4.
- **Call-site comment paraphrase** ("Pass 2/4 load their own prompts inside their modules … not here") deliberately avoids the literal `loadPrompt` symbol to hold the D-13 whole-file count at 0 (comments included).
- **SC3 scoped to PENSMITH_NO_LLM=1** — both tiers run offline in CI, emitting deterministic all-UNCLEAR Pass-2 + identical Pass-4 orphan counts; section presence + the all-UNCLEAR row + ±20% length equivalence pin the scoped parity. Live-path verdict parity is the documented MEDIUM in REVIEWS, out of CI scope by design.

## Deviations from Plan

None — plan executed exactly as written. Both tasks landed in the two specified files; the advisory calls sit below the frozen status line, the bib map was widened additively, the `## Pass-2`/`## Pass-4` sections render after the freshness table, the return carries pass2/pass4, and the tier-contract verify-section case asserts both sections in both tiers with an `**UNCLEAR**` row on the no-LLM path via a scoped DRAFT.md seed (shared fixture untouched). The D-13 whole-file `loadPrompt`-count==0 invariant and the locked-16 verb-bijection invariant both held with no adjustment.

## Authentication Gates

None — the offline path (`PENSMITH_NO_LLM=1` / no key) is the CI path; verify.ts only orchestrates, and the live LLM seams live inside pass2.ts/pass4.ts behind their own noLlm short-circuits.

## Threat Surface

All four `mitigate`-disposition threats from the plan's `<threat_model>` are satisfied:
- T-05-04-01 (advisory → block escalation): `runPass2`/`runPass4` are below the frozen status block; `status` never references pass2/pass4; Guard A GREEN.
- T-05-04-02 (literal `loadPrompt` slipping into verify.ts): whole-file count is 0 (comments included); the imports carry no literal; the call-site comment paraphrases; Guard B GREEN.
- T-05-04-03 (tier divergence): `## Pass-2` + `## Pass-4` asserted in BOTH cliArtifactBytes and mcpArtifactBytes; ±20% length equivalence retained; no-LLM scope documented.
- T-05-04-04 (LLM text breaking Markdown tables): rendering is delegated entirely to `renderPass2Section`/`renderPass4Section` (Plans 02/03, table-cell-safe); verify.ts concatenates pre-rendered sections and adds no raw model text.

No new security surface beyond the plan's threat model.

## Known Stubs

None. verify.ts is a pure orchestrator over the already-complete pass2.ts/pass4.ts modules. The offline `**UNCLEAR**` Pass-2 rows and deterministic Pass-4 orphan counts under `PENSMITH_NO_LLM=1` are the documented, intended CI behavior, not stubs.

## Self-Check: PASSED

- `bin/cli/verify.ts` and `tests/tier-contract.test.ts` exist on disk with the wiring + assertions.
- Task commits verified in git log: `8f39697` (Task 1), `7bcc021` (Task 2).
- `grep -c "loadPrompt" bin/cli/verify.ts` → 0 (D-13 live chokepoint).
- `tests/verify-advisory-isolation.test.ts` → 2 pass / 0 fail (Guard A + Guard B).
- `npm run test:tier-contract` → 31 pass / 0 fail (verify-section GREEN, both tiers assert ## Pass-2 + ## Pass-4).
- Full suite `npm test` → 649 pass / 0 fail / 0 skip; `npm run lint` + `npm run typecheck` + `npm run build` (16 verbs locked) + `npm run validate:manifests` GREEN.

---
*Phase: 05-verifier-completeness-pass-2-pass-4*
*Completed: 2026-06-18*
