---
phase: 05-verifier-completeness-pass-2-pass-4
plan: 03
subsystem: verifier
tags: [verifier, pass4, orphan-claim, deterministic, pinned-rule, r1-r8, advisory, llm-seam, assertbudget, arch-10, no-leak, anthropic-sdk]

# Dependency graph
requires:
  - phase: 05-verifier-completeness-pass-2-pass-4
    provides: "Wave 0 RED tests (tests/known-bad-pass4.test.ts) + pass4-orphan.json fixtures (counts derived from pinned rule R1-R8) + orphan-label prompt + WN-3 sentinel (Plan 05-01)"
  - phase: 05-verifier-completeness-pass-2-pass-4
    provides: "Pass 2 sibling (Plan 05-02) — the first live LLM-seam template: assertBudget/appendCost/getProviderApiKey composition + noLlm short-circuit"
  - phase: 04-breadth-n-sections-compile-wave-scheduling
    provides: "quote-extractor.ts deterministic-extraction precedent; freshness.ts advisory side-channel; budget.ts assertBudget/appendCost; runtime.ts getProviderApiKey no-leak; prompt-loader.ts loadPrompt/interpolate; pricing.ts estimateCost; pass1.ts [@citekey] dedup regex"
provides:
  - "bin/lib/verify/pass4.ts — extractClaimsFromParagraph (pure-Node deterministic, R1-R8) + runPass4 advisory orphan audit + renderPass4Section"
  - "ExtractedClaim / Pass4ClaimResult / Pass4Result interfaces"
  - "deterministic LLM-independent orphanCount (HIGH-only, R8) + advisory Step-3 orphan-label LLM seam for AMBIGUOUS edge cases"
affects: [05-04 (verify.ts wiring reads runPass4/renderPass4Section below the frozen status line), 05-05 (WN-3 atomic re-pin of orphan-label hash)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pinned-rule R1-R8 deterministic extraction: pure-Node regex (sentence split, skip stage R3/R4/R5 BEFORE R6 marker counting, R7 confidence, R8 HIGH-only orphanCount) — same input yields assert.deepEqual-identical output; NO NLP library, NO Date/Math.random"
    - "R5 8-word floor enforced BEFORE R6 marker counting (skip stage ordering is load-bearing — sub-8-word sentences are dropped before they can be classified HIGH/orphan)"
    - "orphanCount is computed in Step 2 from HIGH-confidence claims ONLY and is byte-identical with or without the LLM (R8 invariant — the non-negotiable)"
    - "Advisory side-channel (freshness.ts analog): runPass4 returns Pass4Result[] only, never touches hasFail/status (VRFY-07)"
    - "noLlm short-circuit (pass2.ts / revise.ts analog): PENSMITH_NO_LLM=1 or absent ANTHROPIC_API_KEY labels every AMBIGUOUS claim 'UNCLEAR' with zero network calls — CI path"
    - "assertBudget BEFORE the orphan-label call, appendCost AFTER (ARCH-09/10 per-step cap, scopeId=`${n}-pass4`); no-leak key via getProviderApiKey('anthropic')"

key-files:
  created:
    - bin/lib/verify/pass4.ts
  modified: []

key-decisions:
  - "PASS4_SECTION_CAP_DEFAULT = 0.50 USD/section (ARCH-10 per-step cap), matching the Pass-2 sibling. 05-RESEARCH Open Question 1 left this a config knob with no CONTEXT.md lock; overridable via opts.scopeCapUsd."
  - "Step-3 token estimates EST_INPUT_TOKENS=1200 / EST_OUTPUT_TOKENS=60 — the orphan-label classifier emits a single tiny JSON object, so the output estimate is far smaller than Pass-2's; well under the cap on claude-haiku-4."
  - "findCitekeys (pass1.ts dedup pattern) wired as the genuine Step-2 no-citation fast path inside isOrphan (empty set -> uncited -> orphan), not a dead reference."
  - "renderPass4Section table carries integer counts only (no LLM-generated sentence text), removing the Markdown-injection surface from the table body entirely (T-05-03-01/02) — a per-paragraph orphan-count table rather than per-sentence rows."
  - "Step-3 isOrphan reuse for confirmed 'claim' labels passes a forced HIGH copy ONLY to satisfy the proximity test — it is audit-only on the per-claim record and never promotes the AMBIGUOUS sentence into orphanCount (R8 invariant structurally preserved)."

patterns-established:
  - "Composite deterministic-core + advisory-LLM-edge module: pure-Node Step 1/2 owns the asserted summary number; the LLM Step-3 is structurally barred from changing it (template for any future deterministic-with-advisory-refinement verifier pass)"

requirements-completed: [VRFY-06]

# Metrics
duration: 5min
completed: 2026-06-18
---

# Phase 5 Plan 03: Pass 4 Orphan-Claim Audit Summary

**`bin/lib/verify/pass4.ts` — the Pass 4 advisory orphan-claim audit: a pure-Node deterministic core (`extractClaimsFromParagraph` + orphan detection implementing the PINNED rule R1-R8, the single source of truth from which every `pass4-orphan.json` count was derived) wrapped by an advisory Step-3 `orphan-label` LLM seam (AMBIGUOUS sentences only, behind `assertBudget` + the `PENSMITH_NO_LLM` guard). `orphanCount` is HIGH-only and byte-identical with or without the LLM (R8). Turns the Plan 05-01 RED Pass-4 tests GREEN — full suite 649 pass / 0 fail / 0 skip.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-18T06:16:56Z
- **Completed:** 2026-06-18T06:22:36Z
- **Tasks:** 2
- **Files created:** 1 (`bin/lib/verify/pass4.ts`, 517 lines)
- **Files modified:** 0

## Accomplishments

- **VRFY-06 GREEN.** The three RED Pass-4 behavioral tests from Plan 05-01 (determinism, orphan-count-matches-fixtures, definition-skip) un-skipped the moment `pass4.ts` landed and now PASS. `tests/known-bad-pass4.test.ts` → 6 pass / 0 fail / 0 skip (run twice — identical, no flakiness).
- **Every orphan-count fixture GREEN, including the canonical =1.** The extractor reproduces all seven `pass4-orphan.json` counts exactly: shape (a) two-orphan, the cited/uncited paired controls (0 and 1), the all-cited control (0), the definition-skip (0), the canonical Climate-change paragraph (three ≥8-word sentences → S1 AMBIGUOUS, S2 HIGH orphan, S3 AMBIGUOUS → **orphanCount=1**), and the mixed R3/R5-skip entry (1). The R5 8-word floor is enforced BEFORE R6 marker counting — no re-walk or threshold adjustment was needed; a faithful R1-R8 implementation passed all fixtures on the first run.
- **Determinism proven.** `extractClaimsFromParagraph` called twice on the same paragraph returns `assert.deepEqual`-identical arrays. Pure-Node: no NLP library, no `Date`, no `Math.random`, no locale-sensitive collation. The whole Pass-4 suite was run twice with byte-identical results.
- **orphanCount is LLM-independent (R8 — the non-negotiable).** It is computed in Step 2 from HIGH-confidence claims only; Step 3 only writes AMBIGUOUS claims' `label` (and, for confirmed `claim` labels, their audit-only per-claim `isOrphan`). Step 3 never reclassifies a HIGH claim and never promotes an AMBIGUOUS sentence into the count.
- **Advisory by construction (VRFY-07).** `runPass4` returns `Pass4Result[]` only; `hasFail`/`status` appear nowhere outside documentation comments. The advisory-isolation guard (Guard A) and the D-13 whole-file `loadPrompt`==0 guard on verify.ts (Guard B) both stay GREEN — verify.ts is byte-untouched by this plan.
- **Budget gate + cost ledger (ARCH-09/10).** The live Step-3 branch calls `assertBudget({ scope:'section', scopeId:`${n}-pass4`, cap })` BEFORE `client.messages.create` (line 442 vs 444), then `appendCost` with the SDK-reported token usage. PASS4_SECTION_CAP_DEFAULT = $0.50.
- **No-leak key resolution (T-05-03-03).** The api key is resolved exclusively through `getProviderApiKey('anthropic')`; `process.env['ANTHROPIC_API_KEY']` appears only in the `noLlm` presence guard, never as the resolved key value; `appendCost` carries provider/model/token-counts/costUsd only.
- **`renderPass4Section`** emits the `## Pass-4` advisory section with a per-paragraph orphan-count table (integer cells only — no LLM text in the table body, removing the injection surface); empty results yield the `_(no paragraphs to audit)_` section.
- **Full suite clean.** `PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1 npm test` → 649 tests, 649 pass / 0 fail / **0 skip** (the 3 prior Pass-4 RED skips are now GREEN; the Pass-2 skips were already resolved in 05-02). `npm run lint && npm run typecheck` GREEN.

## Task Commits

Each task was committed atomically:

1. **Task 1: deterministic `extractClaimsFromParagraph` + orphan detection (pure-Node, no LLM) — PINNED rule R1-R8** — `6a7fe3c` (feat)
2. **Task 2: advisory Step-3 `orphan-label` LLM seam (AMBIGUOUS only, assertBudget gate + appendCost + getProviderApiKey) + `findCitekeys` Step-2 + `renderPass4Section`** — `595b1c7` (feat)

**Plan metadata:** (final docs commit — this SUMMARY + STATE.md + ROADMAP.md + REQUIREMENTS.md)

## Files Created/Modified

- `bin/lib/verify/pass4.ts` (created, 517 lines) — exports `extractClaimsFromParagraph`, `runPass4`, `renderPass4Section`, `ExtractedClaim`, `Pass4ClaimResult`, `Pass4Result`. Imports `@anthropic-ai/sdk`, `assertBudget`/`appendCost` (budget), `estimateCost` (pricing), `loadPrompt`/`interpolate` (prompt-loader), `getProviderApiKey`/`loadRuntimeConfig` (runtime) — all confined to the Step-3 live branch, which CI never reaches via the noLlm short-circuit.

## Decisions Made

- **PASS4_SECTION_CAP_DEFAULT = $0.50/section** (ARCH-10), matching the Pass-2 sibling. Overridable per call via `opts.scopeCapUsd`.
- **Step-3 token estimates 1200/60** — the orphan-label classifier returns one tiny JSON object, so the output estimate is much smaller than Pass-2's 300.
- **`findCitekeys` wired as the genuine Step-2 no-citation fast path** in `isOrphan` (empty set → uncited → orphan), satisfying the plan's "private findCitekeys" requirement with a real use rather than a dead reference.
- **`renderPass4Section` is an integer-only orphan-count table** (per-paragraph), eliminating any Markdown/HTML injection surface from LLM-generated text in the table body.

## Deviations from Plan

None — plan executed exactly as written. Both tasks landed in the single specified file; the deterministic R1-R8 core, the R5-before-R6 ordering, the R8 HIGH-only orphanCount, the noLlm short-circuit, the assertBudget pre-call gate, the no-leak key resolution, the per-claim try/catch → UNCLEAR, and the advisory render section are all exactly as the `<action>` blocks and threat register specify. Every orphan-count fixture (including the canonical =1) passed on the first run with no re-walk of R1-R8 required.

## Authentication Gates

None — the offline path (`PENSMITH_NO_LLM=1` / no key) is the CI path; the live Step-3 branch is never reached without a real `ANTHROPIC_API_KEY` and at least one AMBIGUOUS sentence.

## Threat Surface

All five `mitigate`-disposition threats from the plan's `<threat_model>` are implemented:
- T-05-03-01 (prompt injection via AMBIGUOUS sentence / paragraph_context): sentence + context extracted programmatically (regex), inserted only through `interpolate()` (throws on missing var); the orphan-label prompt classifies, never executes.
- T-05-03-02 (LLM label mutating the deterministic count): orphanCount is computed in Step 2 from HIGH claims only (R8); Step 3 is structurally barred from changing it or reclassifying HIGH claims.
- T-05-03-03 (api key leak): `getProviderApiKey()` resolution; `appendCost` carries no key; the presence guard reads the env name only.
- T-05-03-04 (budget DoS on paragraph-dense papers): `assertBudget` per-section cap BEFORE every Step-3 call; deterministic Steps 1-2 cost nothing.
- T-05-03-05 (advisory verdict escalating to a block): `runPass4` returns `Pass4Result[]` only; no `hasFail`/`status` reference (Guard A GREEN).

No new security surface beyond the plan's threat model.

## Known Stubs

None. The live Step-3 branch is a complete `@anthropic-ai/sdk` seam (not a placeholder); it is intentionally gated behind the `noLlm` short-circuit so CI runs the offline path. The offline `UNCLEAR` label under `PENSMITH_NO_LLM=1` is the documented, intended behavior, not a stub. The deterministic orphanCount — the asserted output — is fully wired and LLM-independent.

## Self-Check: PASSED

- `bin/lib/verify/pass4.ts` exists on disk (517 lines, all six required exports present).
- Task commits verified in git log: `6a7fe3c` (Task 1), `595b1c7` (Task 2).
- `tests/known-bad-pass4.test.ts` → 6 pass / 0 fail / 0 skip (run twice, identical); full suite 649 pass / 0 fail / 0 skip; `npm run lint && npm run typecheck` GREEN; advisory-isolation (Guard A) + D-13 (Guard B) GREEN; `assertBudget` precedes `messages.create` in source order; `ANTHROPIC_API_KEY` appears only in the noLlm guard; `hasFail`/`status` appear only in comments.

---
*Phase: 05-verifier-completeness-pass-2-pass-4*
*Completed: 2026-06-18*
