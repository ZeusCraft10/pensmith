---
phase: 05-verifier-completeness-pass-2-pass-4
plan: 02
subsystem: verifier
tags: [verifier, pass2, claim-support, advisory, llm-seam, unclear-bias, assertbudget, arch-10, no-leak, anthropic-sdk]

# Dependency graph
requires:
  - phase: 05-verifier-completeness-pass-2-pass-4
    provides: "Wave 0 RED tests + pass2-adversarial.json fixture + claim-support prompt + WN-3 sentinel (Plan 05-01)"
  - phase: 04-breadth-n-sections-compile-wave-scheduling
    provides: "freshness.ts advisory side-channel pattern; budget.ts assertBudget/appendCost; runtime.ts getProviderApiKey no-leak chokepoint; prompt-loader.ts loadPrompt/interpolate; pricing.ts estimateCost"
provides:
  - "bin/lib/verify/pass2.ts — runPass2 advisory claim-support pass (VRFY-03)"
  - "Pass2Result / Pass2Verdict types + Pass2BibEntry widened bib shape"
  - "renderPass2Section — the ## Pass-2 advisory VERIFICATION.md section"
  - "deterministic extractClaimSentences + conservative UNCLEAR placeholder (offline path)"
  - "live claim-support LLM seam: assertBudget pre-call gate + appendCost ledger + getProviderApiKey no-leak resolution + UNCLEAR-bias response parsing"
affects: [05-04 (verify.ts wiring reads runPass2/renderPass2Section below the frozen status line), 05-05 (WN-3 atomic re-pin of claim-support hash)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Advisory side-channel (freshness.ts analog): runPass2 returns Pass2Result[] only, never touches hasFail/status — advisory by construction (VRFY-07)"
    - "noLlm short-circuit (revise.ts analog): PENSMITH_NO_LLM=1 or absent ANTHROPIC_API_KEY returns deterministic UNCLEAR placeholder with zero network calls — CI path"
    - "assertBudget BEFORE the model call, appendCost AFTER (ARCH-09/10 per-step cap, scopeId=`${n}-pass2`)"
    - "no-leak key resolution: getProviderApiKey('anthropic') returns the value; process.env['ANTHROPIC_API_KEY'] appears ONLY in the presence guard, never as the resolved key"
    - "UNCLEAR-bias parsing: invalid/unparseable verdict -> UNCLEAR; evidence validated as verbatim abstract substring else '' (anti-fabrication); per-citation try/catch surfaces failures as UNCLEAR, never throws"

key-files:
  created:
    - bin/lib/verify/pass2.ts
  modified: []

key-decisions:
  - "PASS2_SECTION_CAP_DEFAULT = 0.50 USD/section (ARCH-10 per-step cap). 05-RESEARCH Open Question 1 left this a config knob with no CONTEXT.md lock; defaulted at Claude's discretion to $0.50, ample headroom under the $5 session cap even for many-citation sections on claude-haiku-4 (~$0.007/call). Overridable via opts.scopeCapUsd."
  - "DEFAULT_MODEL = 'claude-haiku-4' resolved from runtime config provider.defaultModel, falling back to the cheapest priced model. Matches the RESEARCH §Pitfall-5 cost-budget assumption."
  - "Live branch issues @anthropic-ai/sdk client.messages.create directly (FIRST live model seam in bin/lib); client construction kept local and minimal, gated entirely behind the noLlm short-circuit so CI never reaches it."
  - "extractClaimSentences uses a lookbehind sentence-boundary split (/(?<=[.!?])\\s+/) keeping terminal punctuation attached — pure regex, deterministic, no NLP (PRD §14)."
  - "collectClaimPairs dedups by unique citekey (one Pass2Result per unique [@citekey]); a citekey with no resolvable sentence still yields a pair with empty claimSentence so the offline placeholder path is total over the draft's citations."

patterns-established:
  - "First live LLM seam in bin/lib — assertBudget/appendCost/getProviderApiKey composition is the template for pass4.ts Step-3 and any future advisory model call"

requirements-completed: [VRFY-03]

# Metrics
duration: 4min
completed: 2026-06-18
---

# Phase 5 Plan 02: Pass 2 Claim-Support Advisory Module Summary

**`bin/lib/verify/pass2.ts` — the Pass 2 advisory claim-support side-channel: deterministic claim-sentence extraction, a conservative UNCLEAR offline placeholder, and a live `claim-support` LLM seam gated by an `assertBudget` pre-call cap + no-leak key resolution, returning `Pass2Result[]` only (never touching `hasFail`/`status`). Turns the Plan 05-01 RED Pass-2 tests GREEN with zero suite regressions.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-18T06:06:15Z
- **Completed:** 2026-06-18
- **Tasks:** 2
- **Files created:** 1 (`bin/lib/verify/pass2.ts`, 315 lines)
- **Files modified:** 0

## Accomplishments

- **VRFY-03 GREEN.** The two RED behavioral tests from Plan 05-01 (`runPass2 returns UNCLEAR for all adversarial fixtures under PENSMITH_NO_LLM=1`, and the `assertBudget`-before-LLM ARCH-10 source proxy) un-skipped the moment `pass2.ts` landed and now PASS. `tests/known-bad-pass2.test.ts` → 5 pass / 0 fail / 0 skip.
- **Advisory by construction.** `runPass2` returns `Pass2Result[]` only; there is no `hasFail`/`status` assignment anywhere in the file (the only occurrences are documentation comments naming the prohibition). The advisory-isolation test (Guard A, VRFY-07) and the D-13 whole-file `loadPrompt`==0 guard on verify.ts (Guard B) both stay GREEN — verify.ts is byte-untouched by this plan.
- **Budget gate + cost ledger (ARCH-09/10).** The live branch calls `assertBudget({ scope:'section', scopeId:`${n}-pass2`, cap })` BEFORE `client.messages.create`, then `appendCost` with the SDK-reported token usage. `assertBudget` precedes the model call in source order (line 253 vs 255).
- **No-leak key resolution (T-05-02-02).** The api key is resolved exclusively through `getProviderApiKey('anthropic')`. `process.env['ANTHROPIC_API_KEY']` appears only in the `noLlm` presence guard, never as the resolved key value; the key never reaches `appendCost` (which carries provider/model/token-counts/costUsd only).
- **UNCLEAR-bias preserved end-to-end.** Offline placeholder defaults UNCLEAR; the response parser defaults UNCLEAR on any non-enum / unparseable verdict; evidence is validated as a verbatim substring of the abstract (else dropped to `''`, anti-fabrication T-05-02-01); a per-citation try/catch surfaces budget/transport/parse failures as a conservative UNCLEAR rather than throwing out of `runPass2`.
- **`renderPass2Section`** emits the `## Pass-2` advisory section with a verdict table (cells wrapped `**VERDICT**`, claim sentence truncated to ~60 chars for LLM-output-injection safety, T-05-02-03); empty results yield the `_(no citations to judge)_` section.
- **Full suite clean.** `PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1 npm test` → 649 tests, 646 pass / 0 fail / 3 skip. The 3 remaining skips are exactly the 05-03 Pass-4 behavioral tests (RED-by-skip pending `pass4.ts` in the next plan). `npm run lint && npm run typecheck` GREEN.

## Task Commits

Each task was committed atomically:

1. **Task 1: Pass2Result/Pass2Verdict types + deterministic extractClaimSentences + UNCLEAR placeholder + noLlm runPass2** — `2f92c26` (feat)
2. **Task 2: live claim-support LLM seam (assertBudget gate + appendCost + getProviderApiKey + UNCLEAR-bias parsing) + renderPass2Section** — `713681f` (feat)

**Plan metadata:** (final docs commit — this SUMMARY + STATE.md + ROADMAP.md + REQUIREMENTS.md)

## Files Created/Modified

- `bin/lib/verify/pass2.ts` (created, 315 lines) — exports `runPass2`, `renderPass2Section`, `Pass2Result`, `Pass2Verdict` (+ helper `Pass2BibEntry`). Imports `@anthropic-ai/sdk` (first live model seam in `bin/lib`), `assertBudget`/`appendCost` (budget), `estimateCost` (pricing), `loadPrompt`/`interpolate` (prompt-loader), `getProviderApiKey`/`loadRuntimeConfig` (runtime).

## Decisions Made

- **PASS2_SECTION_CAP_DEFAULT = $0.50/section** (ARCH-10). 05-RESEARCH Open Question 1 left the cap a config knob with no CONTEXT.md lock; defaulted at Claude's discretion. Overridable per call via `opts.scopeCapUsd`.
- **Model id resolved from runtime config**, defaulting to `claude-haiku-4` (cheapest priced model, matches RESEARCH §Pitfall-5 budget math).
- **Unique-citekey granularity** (one `Pass2Result` per unique `[@citekey]`). The documented MEDIUM in REVIEWS (per-citation-occurrence vs per-citekey) is satisfied for the offline/test path: SC1's UNCLEAR-bias and the 4-value enum are intact; the dedup-by-unique-citekey choice mirrors the canonical pass1.ts extraction pattern and the Plan 05-01 test, which builds one-citation drafts per fixture.

## Deviations from Plan

None — plan executed exactly as written. Both tasks landed in the single specified file; the noLlm short-circuit, budget gate, no-leak key resolution, UNCLEAR-bias parsing, and render section are all exactly as the `<action>` blocks and threat register specify.

## Authentication Gates

None — the offline path (`PENSMITH_NO_LLM=1` / no key) is the CI path; the live branch is never reached without a real `ANTHROPIC_API_KEY` and is exercised only behind `PENSMITH_NETWORK_TESTS=1`.

## Threat Surface

All four `mitigate`-disposition threats from the plan's `<threat_model>` are implemented:
- T-05-02-01 (prompt injection): claim sentence + abstract inserted only through `interpolate()` (throws on missing var); evidence validated as abstract substring.
- T-05-02-02 (key leak): `getProviderApiKey()` resolution; `appendCost` payload carries no key; presence guard reads the env name only.
- T-05-02-03 (LLM output → Markdown escape): rationale clamped <=200 and newline/pipe-stripped; claim sentence truncated to ~60; table-cell text only, no HTML.
- T-05-02-04 (budget DoS): `assertBudget` per-section cap BEFORE every live call.
- T-05-02-05 (advisory → block escalation): no `hasFail`/`status` reference in this module.

No new security surface beyond the plan's threat model.

## Known Stubs

None. The live branch is a complete `@anthropic-ai/sdk` seam (not a placeholder); it is intentionally gated behind the `noLlm` short-circuit so CI runs the offline path. The offline UNCLEAR placeholder is the documented, intended behavior under `PENSMITH_NO_LLM=1`, not a stub.

## Self-Check: PASSED

- `bin/lib/verify/pass2.ts` exists on disk (315 lines, all required exports present).
- Task commits verified in git log: `2f92c26` (Task 1), `713681f` (Task 2).
- `tests/known-bad-pass2.test.ts` → 5 pass / 0 fail / 0 skip; full suite 646 pass / 0 fail / 3 skip (the 3 skips are the 05-03 Pass-4 RED tests); `npm run lint && npm run typecheck` GREEN; advisory-isolation + D-13 guards GREEN.

---
*Phase: 05-verifier-completeness-pass-2-pass-4*
*Completed: 2026-06-18*
