---
phase: 5
cycle: 1
reviewers:
  - codex
  - gemini
  - claude
  - opencode
date: 2026-06-17
---

# Phase 5 Plan Review — Cycle 1

Four external AI reviewers (codex, gemini, claude, opencode) independently audited the
five Phase-5 PLAN.md files (05-01 … 05-05) against the phase goal, the three success
criteria, and the project non-negotiables. All four produced output this cycle.

The synthesized findings below are the judge's adjudicated view. Reviewer-raw HIGH counts
were: codex=3, gemini=1, claude=1, opencode=0. After adjudication against the live
codebase (`bin/cli/verify.ts` D-13 comment, `tests/repo-files.test.ts` pin loop,
`bin/lib/runtime.ts`, the 05-PATTERNS `pass4-orphan.json` example), the judge keeps
**2 genuine HIGH** concerns. Adjudication notes are inline.

---

## Synthesized Findings

### HIGH

- **[HIGH] 05-01 Task 3 + 05-04 Task 1 — D-13 0-hit invariant is enforced by a LITERAL-string grep that INCLUDES comments, but the plans add the literal `loadPrompt` / `prompt-loader` tokens to the verify.ts comment and then only gate on NON-comment lines.**
  Raised by: codex (HIGH). Adjudicated against live code.
  The actual D-13 comment in `bin/cli/verify.ts` (lines 10-13) states the chokepoint is
  "a literal-string search for the prompt-loader symbol against this file MUST return 0
  hits (**including this comment — hence the paraphrase above**)." The existing comment
  deliberately PARAPHRASES (never writes the literal `prompt-loader` / `loadPrompt`
  tokens). Plans 05-01 Task 3 and 05-04 Task 1 instruct the executor to add a paragraph
  naming `claim-support`, `orphan-label`, and that "their `loadPrompt` calls live in
  pass2.ts/pass4.ts" — i.e. to write the literal `loadPrompt` token into the comment.
  Both plans' acceptance gates filter to NON-comment lines (`grep -v '^//'`), which is
  WEAKER than the live invariant. Result: the plan's own gate would pass while the real
  D-13 literal-string chokepoint (which includes comments) fires.
  Fix direction: keep the verify.ts comment PARAPHRASED (do not write the literal
  `loadPrompt`/`prompt-loader` tokens — say "the advisory prompt-load symbol" or similar,
  matching the existing paraphrase convention). Confirm the real Plan 03-07 chokepoint
  form (whole-file literal search, comments included) and make the plan acceptance match
  it, not a `grep -v '^//'` proxy. (NOTE: the in-loader D-13 comment in prompt-loader.ts
  is a different file and is not bound by the verify.ts-file 0-hit rule.)

- **[HIGH] 05-01 Task 1 (pass4-orphan fixtures) ↔ 05-03 Tasks 1-2 (extractor algorithm) — the canonical orphan-count fixture contradicts the deterministic algorithm, forcing the 05-03 executor toward a fix that breaks the Pass-4 determinism non-negotiable.**
  Raised by: claude (HIGH). Independently re-walked and confirmed by the judge.
  The 05-PATTERNS `pass4-orphan.json` example (which 05-01 Task 1 is told to mirror) is
  `"Climate change demonstrates accelerating ice loss. This proves the feedback loop is
  intensifying. Ice sheets are retreating globally."` → `expected_orphan_count: 2`.
  Walking 05-03's fixed rule (HIGH = 2+ distinct CLAIM_MARKERS; AMBIGUOUS = exactly 1;
  orphanCount counts HIGH-confidence orphans ONLY): S1 `demonstrates` = 1 → AMBIGUOUS →
  not counted; S2 `proves`+`is` = 2 → HIGH → orphan; S3 `are` = 1 → AMBIGUOUS → not
  counted. Deterministic count = **1, not 2**. Because the fixture (RED spec, Plan 05-01,
  Wave 0) and the extractor (GREEN impl, Plan 05-03, Wave 1) are authored in different
  plans/waves, the 05-03 executor meets a failing fixture and is pushed to reconcile by
  either (a) counting AMBIGUOUS sentences as orphans or (b) lowering the HIGH threshold to
  1 marker — both of which violate the non-negotiable that AMBIGUOUS edge-labeling must
  never change the deterministic orphan count, threatening SC2.
  Fix direction: pin ONE exact marker-counting + sentence-split semantics, then author
  EVERY `expected_orphan_count` by EXECUTING that pinned rule (not by prose description).
  Either correct the canonical fixture's expected count to 1, or redefine HIGH so the
  example legitimately yields 2 — and keep orphanCount strictly HIGH-only and LLM-
  independent. Add this as an explicit calibration step in 05-01 before 05-03 runs.

### MEDIUM

- **[MEDIUM] 05-02 Task 2 + 05-03 Task 2 — live LLM calls construct a local `@anthropic-ai/sdk` client directly rather than through a shared model-transport wrapper; the live branch is never CI-exercised.**
  Raised by: codex (as HIGH), opencode (as part of robustness gaps). DOWNGRADED to
  MEDIUM by the judge. Adjudication: there is currently NO model-transport chokepoint in
  `bin/` (grep for `@anthropic-ai/sdk` / `new Anthropic(` / `messages.create` returns
  nothing; `runtime.ts` exposes only `getProviderApiKey`). 05-RESEARCH explicitly states
  "bin/lib has NO model-transport client yet; the live LLM seam is NEW in this plan." The
  budget gate (`assertBudget`) and key resolution (`getProviderApiKey`) chokepoints ARE
  used, so no EXISTING non-negotiable is violated — there is no transport chokepoint to
  bypass. It remains a real quality gap (first live seam, never reached in CI, two
  divergent local clients), so MEDIUM not HIGH. Fix direction: factor a single minimal
  model-call helper both passes share, and gate a `PENSMITH_NETWORK_TESTS=1` smoke test.

- **[MEDIUM] 05-04 Task 2 — tier-contract extension asserts only `## Pass-2`/`## Pass-4` section PRESENCE (+ one `**UNCLEAR**` row on the CLI side) and the pre-existing ±20% length equivalence; it does not assert verdict/orphan-count EQUIVALENCE across tiers.**
  Raised by: codex (as HIGH), claude (MEDIUM). DOWNGRADED to MEDIUM by the judge.
  Adjudication: in the only CI-exercised path (PENSMITH_NO_LLM=1) BOTH tiers deterministi-
  cally emit all-UNCLEAR placeholders and identical deterministic orphan counts, so
  presence + all-UNCLEAR + ±20% length effectively pins equivalence for the scoped
  (no-LLM) SC3. The gap is live-path verdict parity, which CI never runs anyway. Real but
  not goal-failing for the tested scope. Fix direction: add an explicit per-citekey
  verdict-set equality assertion between cliArtifactBytes and mcpArtifactBytes for the
  verify-section case; state the no-LLM scoping of SC3 explicitly.

- **[MEDIUM] 05-04 Task 2 — extending the SHARED `seedPaperFixture()` to always write a section DRAFT.md risks flipping the expected status of other PHASE_3_CASES that rely on the current "no DRAFT.md → unverifiable" short-circuit.**
  Raised by: claude (MEDIUM), opencode (LOW). The plan offers "seedPaperFixture (or a
  verify-section-scoped seed step)" as optional. Fix direction: MANDATE the verify-section-
  scoped seed (do not mutate the shared fixture) so other cases keep their clean state.

- **[MEDIUM] 05-02 + 05-03 — the `noLlm` guard tests `process.env['ANTHROPIC_API_KEY']` directly for presence, but the live key is resolved via `getProviderApiKey` which may source keys from config/scoped storage; a config-only key makes the live path unreachable.**
  Raised by: codex (MEDIUM), opencode (MEDIUM). Real correctness gap for non-env-var key
  setups (advisory-only, so not phase-failing). Fix direction: base the presence check on
  `getProviderApiKey` (or a `hasProviderKey` helper) rather than a raw env read.

- **[MEDIUM] 05-02 Task 2 + 05-03 Task 2 — no `Semaphore`-bounded concurrency on the per-citation / per-AMBIGUOUS-sentence LLM fan-out.**
  Raised by: opencode (MEDIUM). The freshness analog uses `new Semaphore(5)`; the plans
  cite it in interfaces but never apply it to the LLM loop. A many-citation paper could
  launch dozens of simultaneous calls (429s swallowed to UNCLEAR; concurrent debits vs the
  same cap). Advisory + per-section cap limits blast radius, so MEDIUM. Fix direction:
  wrap the LLM loop in `Semaphore(3-5)` mirroring `probeFreshnessAll`.

- **[MEDIUM] 05-03 Task 1 + 05-02 Task 1 — naive `./!/?`-boundary sentence splitting + slightly DIFFERENT regexes in the two passes; abbreviations (et al., e.g., i.e., Fig., U.S.A.) fragment sentences and the two passes can disagree on a draft-final citation with no trailing whitespace.**
  Raised by: opencode (MEDIUM, accuracy) + gemini (MEDIUM, cross-pass inconsistency).
  Determinism is preserved (pure regex) so not a non-negotiable break, but precision and
  cross-pass agreement suffer. Fix direction: share one `splitSentences` helper across
  both passes (use Pass-4's "...whitespace or end" boundary), optionally with a minimal
  abbreviation exception list; document residual false positives in the advisory output.

- **[MEDIUM] 05-03 — `isOrphan` is computed only for HIGH-confidence claims; after Step-3 confirms an AMBIGUOUS sentence is a "claim", its `isOrphan` stays false, so a confirmed uncited claim is not surfaced as an orphan in the per-claim data.**
  Raised by: gemini (MEDIUM). The deterministic `orphanCount` summary must stay HIGH-only
  (correct), but the per-claim `Pass4ClaimResult.isOrphan` field is left incomplete for
  LLM-confirmed AMBIGUOUS claims. Fix direction: populate `isOrphan` for LLM-confirmed
  claims in the per-claim record while keeping the summary `orphanCount` strictly
  deterministic/HIGH-only and LLM-independent.

### LOW

- **[LOW] 05-01 Task 1/2 + 05-02 Task 2 — the only `assertBudget`-before-LLM check is a presence-only `indexOf('assertBudget') >= 0` source proxy (no ORDER check), and 05-01's Pass-4 tests include NO budget-gate check at all for the orphan-label seam.**
  Raised by: claude (MEDIUM), opencode (LOW), codex (touches). Judge keeps LOW: the live
  branch is never CI-reached, the execution prose explicitly places the gate first, and
  the budget non-negotiable is structurally satisfied; still, an order-aware source
  assertion (`indexOf('assertBudget') < indexOf(<client-call>)`) for BOTH pass2.ts and
  pass4.ts would harden it.

- **[LOW] 05-01 Task 1 + 05-02 — SC1's substantive "UNCLEAR-biased on adversarial fixtures" property is asserted trivially: the no-LLM placeholder returns UNCLEAR for everything, and no test feeds the SUPPORTED/PARTIAL/UNSUPPORTED fixtures through a real judging path.**
  Raised by: claude (MEDIUM), codex (MEDIUM). Judge keeps LOW: this is the documented
  no-live-LLM-in-CI design; the UNCLEAR-bias ships as a prompt-constraint + manual fixture
  artifact. Plans should SAY this explicitly so SC1 isn't read as behaviorally tested; an
  optional `PENSMITH_NETWORK_TESTS=1` calibration test would close it.

- **[LOW] 05-01 Task 1 — RED-suite framing is internally inconsistent: must_haves say the suite "fails for the right reason (missing pass2.ts/pass4.ts)", but tasks/acceptance require skip-guards and "zero failures, behavioral tests SKIP".**
  Raised by: codex (MEDIUM). Judge keeps LOW: skip-guarded RED is the established repo
  convention (mirrors known-bad-citations); reword the must_haves to "SKIP pending module"
  rather than "fails".

- **[LOW] 05-02/05-03 — no retry/backoff on transient (429/503) LLM failures; a burst collapses the whole advisory section to UNCLEAR.**
  Raised by: opencode (LOW). Advisory-tolerable. Optional single retry with backoff.

- **[LOW] 05-02 Task 2 — `source_abstract` is bib-only ("missing abstract → ''"); standard CITATIONS.bib (incl. known-good-fixture) often lacks abstracts, so even live Pass 2 collapses to UNCLEAR/UNSUPPORTED.**
  Raised by: claude (LOW). Matches 05-RESEARCH Open Question 2 (defer Unpaywall fetch).
  Record as a known limitation for the Phase-6 DONE-09 gate.

- **[LOW] 05-01 Task 3 vs 05-01 Task 2 — D-13 comment line numbers disagree (Task 2 says lines 21-26, Task 3 says lines 1-13).**
  Raised by: opencode (LOW). Executor resolves against the real file (the block is lines
  1-13 in verify.ts). Cosmetic.

- **[LOW] 05-01 Task 2 advisory-isolation guard — the regex only catches same-line `hasFail = ... pass[24]`; it would miss indirect influence (`const x = pass2.some(...)` then `status = x ? ...`).**
  Raised by: codex (LOW). The written impl avoids this; the guard is weaker than the
  invariant. Consider a structural check or code-review note.

- **[LOW] 05-03 Task 1 — `CLAIM_MARKERS` includes ultra-common copulas (`\bis\b`, `\bare\b`) that match nearly every sentence, inflating HIGH counts and reducing discriminative power.**
  Raised by: opencode (LOW). Advisory-tolerable; tune markers if precision is poor.

- **[LOW] 05-01 Task 3 / 05-04 Task 1 — the D-13 0-hit invariant on verify.ts is enforced only by ad-hoc `node -e` in the plan verify blocks, not by a committed regression test.**
  Raised by: claude (LOW). Pre-existing (05-RESEARCH Pitfall 8 / OQ3: no automated grep
  chokepoint exists). A committed assertion would be cheap durable insurance — and is
  directly relevant given the HIGH D-13 finding above.

### Adjudicated DOWN (raised as HIGH, judged NOT HIGH)

- **gemini [HIGH] "05-01 Task 2: WN-3 hash desync will fail repo-files.test.ts in Waves 0-2"** — REJECTED.
  Gemini asserts `repo-files.test.ts` contains a cross-check loop comparing the loader's
  `EXPECTED_PROMPT_HASHES` against `PENDING_HASH_PINS`. The live file (lines 258-275) has
  NO such cross-check: the per-pin loop only recomputes the on-disk SHA-256 and compares
  it to `PENDING_HASH_PINS` (the real hash, GREEN from creation since the prompt body is
  byte-stable). The Phase-4 `revise-swap`/`smoother` precedent (lines 247-256) is exactly
  this pattern — repo-files carries the real hash while the loader holds a sentinel — and
  was historically GREEN. The Phase-5 plans replicate it faithfully (loader sentinel until
  05-05 atomic re-pin; repo-files real-from-creation). No desync, no CI break. Claude's
  read ("WN-3 sentinel→real ordering is internally consistent") is correct. Downgraded out
  of HIGH entirely (the underlying claim is factually wrong against the live test).

- **codex [HIGH] "direct @anthropic-ai/sdk bypasses the runtime chokepoint"** — DOWNGRADED to MEDIUM (see MEDIUM section). No model-transport chokepoint exists to bypass.

- **codex [HIGH] "tier-contract insufficient for SC3"** — DOWNGRADED to MEDIUM (see MEDIUM section). The no-LLM scope of SC3 is effectively pinned by presence + all-UNCLEAR + length-equivalence.

---

## Per-Reviewer Raw

### codex

```
- [HIGH] 05-01 Task 3 and 05-04 Task 1: the plan explicitly adds `loadPrompt` / prompt-loader wording to the `bin/cli/verify.ts` D-13 comment, then only checks non-comment code. The non-negotiable says `bin/cli/verify.ts` must contain ZERO references to `loadPrompt` / `prompt-loader`; it does not exempt comments. This would intentionally violate D-13.

- [HIGH] 05-02 Task 2 and 05-03 Task 2: both plans instruct executors to issue live model calls directly through `@anthropic-ai/sdk`, with local client construction. The non-negotiable requires all LLM calls to go through the runtime chokepoint, with `assertBudget` before and `appendCost` after. Budgeting is planned, but the runtime chokepoint requirement is bypassed.

- [HIGH] 05-04 Task 2: the tier-contract extension only asserts `## Pass-2` and `## Pass-4` are present in both artifacts, and only asserts `**UNCLEAR**` for the CLI artifact. It does not compare Pass 2 verdicts or Pass 4 orphan/verdict outputs across CLI and MCP. That is insufficient for SC3, which requires equivalent Pass 2/Pass 4 verdicts across both tiers.

- [MEDIUM] 05-01 Task 1 and 05-02 verification: the Pass 2 adversarial fixture includes expected `SUPPORTED`, `PARTIAL`, and `UNSUPPORTED` cases, but the planned tests only exercise `PENSMITH_NO_LLM=1` and assert every result is `UNCLEAR`. This proves the placeholder path, not that the Pass 2 judge handles the full verdict enum or adversarial calibration beyond defaulting everything to `UNCLEAR`.

- [MEDIUM] 05-01 Task 1: the stated "RED suite" behavior is internally inconsistent. The `must_haves` say the suite "fails for the right reason (missing pass2.ts/pass4.ts modules)," but the task requires skip guards and acceptance says zero failures with skipped behavioral tests. That weakens the RED signal and could let missing implementation remain less visible than intended.

- [MEDIUM] 05-02 Task 1/2 and 05-03 Task 2: the "missing key" guard checks `process.env['ANTHROPIC_API_KEY']` directly to decide whether LLM is available. If Pensmith's runtime supports provider keys from config or scoped storage via `getProviderApiKey`, these passes will incorrectly fall back to no-LLM mode even when a valid runtime key exists. Conservative, but it may make production LLM judging unreachable outside env-var setups.

- [LOW] 05-01 Task 2 / advisory-isolation test: the regex guards only catch direct same-line assignments like `hasFail = ... pass2`. They would not catch indirect influence such as `const advisoryFailed = pass2.some(...)` followed by `status = advisoryFailed ? ...`. The written implementation plan avoids this, but the guard is weaker than the invariant it claims to enforce.

HIGH_COUNT: 3
```

### gemini

```
I have completed my review of the Phase 5 implementation plans (05-01 through 05-05) for project "pensmith". These plans provide a solid roadmap for implementing the advisory verifier passes while strictly maintaining the "verifier-blocks-via-Pass-1+3-only" and "determinism-where-it-counts" invariants.

I have identified one HIGH severity concern regarding the WN-3 hash lockstep protocol and several medium/low concerns regarding implementation consistency and completeness.

### [HIGH] Plan 05-01 Task 2: WN-3 Hash Desync and CI Failure
The plan for Wave 0 introduces an intentional hash desync that violates the project's WN-3 lockstep invariant.
- Problem: Task 2 registers `__PENDING_HASH_<slug>__` sentinels in `bin/lib/prompt-loader.ts` but registers real SHA-256 byte-pins in `tests/repo-files.test.ts`.
- Impact: The `tests/repo-files.test.ts` file contains a cross-check loop (referenced in the `prompt-loader.ts` and `05-05` task descriptions) that ensures the loader's map and the test pins are in lockstep. This desync will cause the `repo-files.test.ts` suite to fail throughout Waves 0, 1, and 2, blocking CI and merging.
- Resolution: To follow the WN-3 protocol correctly, both the loader map and the `repo-files` test pins should carry the `__PENDING_HASH_` sentinels until the atomic re-pin in Plan 05-05.

### [MEDIUM] Plan 05-02 vs 05-03: Inconsistent Sentence Splitting Regexes
Pass 2 and Pass 4 implement sentence splitting independently with slightly different regexes.
- Problem: Plan 05-02 Task 1 uses a boundary of `(period/exclamation/question followed by whitespace)`, while Plan 05-03 Task 1 uses `(. / ! / ? followed by whitespace or end)`.
- Impact: A citation at the very end of a draft (with no trailing whitespace) will be correctly captured as a claim sentence by Pass 4 but may be missed or truncated by Pass 2. This inconsistency breaks the "determinism where it counts" expectation for how citations map to claims across different passes.
- Resolution: Both passes should utilize the more robust regex from Pass 4 or, preferably, share a common `splitSentences` utility in `bin/lib/verify/utils.ts`.

### [MEDIUM] Plan 05-03: Incomplete Audit for AMBIGUOUS Orphan Claims
The Pass 4 implementation satisfies the deterministic count requirement but fails to provide a complete audit for ambiguous edge cases.
- Problem: Plan 05-03 Task 1 states that `isOrphan` is only calculated for HIGH-confidence claims and that AMBIGUOUS claims "defer to Step-3 labeling". However, Task 2 only populates the `label` field from Step 3 and does not update `isOrphan`.
- Impact: If the LLM confirms an AMBIGUOUS sentence is a "claim", and that sentence has no citations, it will still have `isOrphan: false` in the `Pass4ClaimResult` object. The user will see a confirmed claim with no citation that isn't explicitly flagged as an orphan in the data structure, making the advisory audit incomplete.
- Resolution: Step 2 or Step 3 should ensure `isOrphan` is computed/updated for all confirmed claims, even if they were originally AMBIGUOUS, while keeping the `orphanCount` summary strictly deterministic (HIGH-only).

### [LOW] Plans 05-02 & 05-03: Missing LLM Client Initialization Detail
- Problem: Both plans state they will "Issue the model call through the @anthropic-ai/sdk client" but omit the specific task of importing the SDK and instantiating the client.
- Impact: As these are the first live model seams in `bin/lib`, the absence of explicit "import" and "constructor" steps in the plan increases the risk of the executor producing incomplete or non-functional code (e.g., missing imports or redundant client instantiation logic).

HIGH_COUNT: 1
```

Note: gemini's stderr showed an HTTP 429 (rate-limit) at the tail, but the model still
returned a complete review before/around it; output is usable.

### claude

```
# Cross-AI Plan Review — Pensmith GSD Phase 5 (Plans 05-01 … 05-05)

I read all five plans plus the phase context (PROJECT/ROADMAP/STATE, 05-RESEARCH, 05-PATTERNS) and the live analog code (`freshness.ts`, `verify.ts`, `pass1.ts`, `quote-extractor.ts`, `prompt-loader.ts`, `revise.ts`). Findings below.

- [HIGH] 05-01 Task 1 + 05-03 Tasks 1–2 — the orphan-count fixtures and the deterministic algorithm spec contradict each other, and the only safe reconciliation is under-specified. 05-03 fixes the rule as: claimConfidence = HIGH only when 2+ distinct CLAIM_MARKERS match, AMBIGUOUS when exactly 1, and orphanCount counts HIGH-confidence orphans only (AMBIGUOUS sentences are explicitly NOT orphan-flagged). But the canonical fixture the 05-01 author is told to mirror (05-PATTERNS pass4-orphan.json example) is:
  "Climate change demonstrates accelerating ice loss. This proves the feedback loop is intensifying. Ice sheets are retreating globally." → expected_orphan_count: 2, description "Two HIGH-confidence claim sentences."
  Walking the 05-03 algorithm: sentence 1 has one marker (demonstrates) → AMBIGUOUS → not an orphan; sentence 2 has two (proves, is) → HIGH → orphan; sentence 3 has one (are) → AMBIGUOUS → not an orphan. The deterministic count is 1, not 2. Because the fixture (the RED spec, Plan 05-01) and the extractor (the GREEN impl, Plan 05-03) are authored in different plans/waves, the 05-03 executor will hit a failing fixture and is pushed to reconcile by either (a) counting AMBIGUOUS sentences as orphans or (b) lowering the HIGH threshold to 1 marker — both of which violate the non-negotiable that AMBIGUOUS labeling must never change the deterministic orphan count. The plans must pin the exact marker-counting/sentence-split semantics AND author every expected_orphan_count by executing that pinned rule, not by prose description, before 05-03 runs. As written this directly threatens SC2 and the Pass-4 determinism invariant.

- [MEDIUM] 05-01 Task 1 (test 5) + 05-02 Task 2 — the only check that assertBudget precedes the live LLM call is a presence-only indexOf('assertBudget') >= 0 proxy, and 05-03/Pass-4 has no such check at all. The non-negotiable is "assertBudget MUST be called BEFORE every live LLM call." 05-01's pass2 test asserts the token exists somewhere in the source — it does not verify it appears before the model-call site (the must_haves claim "appearing before the LLM call site" but the described assertion can't establish ordering). The live branch is never executed in CI (no key + PENSMITH_NO_LLM=1), so nothing catches an appendCost/call-before-assertBudget regression. Worse, 05-01 Task 1's pass4 tests (1–4) include no budget-gate check of any kind for Pass-4's Step-3 orphan-label call — that live LLM seam's ARCH-09/10 gate is entirely unverified. Recommend an order-aware source assertion (indexOf('assertBudget') < indexOf('messages.create')/client call) for both pass2.ts and pass4.ts.

- [MEDIUM] 05-01 Task 1 (test 4) + 05-02 — SC1's substantive claim ("UNCLEAR-biased on adversarial fixtures") is never actually exercised. In the no-LLM path the placeholder returns UNCLEAR for every citation unconditionally, and the test asserts all results are UNCLEAR. The adversarial fixtures carry expected_verdict values of SUPPORTED/PARTIAL/UNSUPPORTED "for enum coverage," but no test ever feeds them through the real judging path, and there is no PENSMITH_NETWORK_TESTS=1-gated live calibration test. A miscalibrated claim-support.md prompt (e.g., one that readily emits SUPPORTED on thematic adjacency) would pass the entire suite. The phase ships the UNCLEAR-bias as a prompt-constraint artifact only; SC1's calibration property is asserted trivially. Acceptable only if the reviewers consciously accept "prompt constraints + manual fixtures" as the deliverable — the plans should say so explicitly rather than imply SC1 is tested.

- [MEDIUM] 05-04 Task 2 — the plan asserts ## Pass-2/## Pass-4 parity on the MCP tier (mcpArtifactBytes) but modifies only bin/cli/verify.ts; it never confirms the pensmith_verify MCP handler routes through the same runPass2/runPass4 wiring. If the MCP verify path does not share the CLI orchestrator, the MCP-side assertions fail and SC3 (tier parity) is not met. Precedent (the Phase-4 freshness section appears in both tiers having been wired only in pass1.ts/verify.ts) strongly suggests a shared path exists — but the plan should state and verify this dependency rather than assume it, since a CLI-only orchestrator is exactly the asymmetry already documented for compile/write in STATE.

- [MEDIUM] 05-04 Task 2 — extending the shared seedPaperFixture() to always write a section DRAFT.md risks perturbing other PHASE_3_CASES that depend on the current "no DRAFT.md" behavior. The interface note states seedPaperFixture is shared and currently does not seed a draft; verify.ts has a "DRAFT.md missing → unverifiable" short-circuit that some cases may rely on. The plan offers a "verify-section-scoped seed step" as the safe alternative — that alternative should be mandated, not optional, to avoid silently flipping another case's expected status.

- [LOW] 05-01 Task 2 / 05-RESEARCH Wave-0 gap — the research listed "set PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1 in CI for Waves 0-N" as a required Wave-0 task, and no plan does it. This turns out to be benign (the noLlm short-circuit returns the placeholder before any loadPrompt('claim-support') call, and repo-files.test.ts recomputes hashes directly rather than via loadPrompt), so the sentinel never actually triggers the runtime bypass in CI. Worth a one-line note in 05-01 explaining why the research-flagged env var is intentionally omitted, so a future executor doesn't "fix" it or panic when the suite is green without it.

- [LOW] 05-01 Task 3 / 05-04 Task 1 — the D-13 "0-hit" invariant on verify.ts is enforced only by ad-hoc node -e commands inside the plan's verify blocks, not by any committed regression test. 05-RESEARCH (Pitfall 8 / Open Question 3) confirms no automated grep chokepoint exists — only the comment. This is a pre-existing condition, not introduced here, but Phase 5 is the first phase to make verify.ts adjacent to live loadPrompt calls (via the pass modules), so a committed assertion that verify.ts non-comment source contains zero loadPrompt/prompt-loader hits would be cheap insurance and would make the advisory-isolation guard fully durable.

- [LOW] 05-02 Task 2 — source_abstract is pulled only from the abstract field of the parsed BibTeX entry, with "missing abstract → ''". Standard CITATIONS.bib entries (including the known-good-fixture) frequently have no abstract, so even on a live run Pass 2 would judge against an empty abstract and collapse to UNCLEAR/UNSUPPORTED. This is advisory-only and doesn't fail the phase, but 05-RESEARCH Open Question 2 flagged it and the plan silently takes the "bib-only, may be empty" branch without noting the quality consequence. Fine to ship; should be recorded as a known limitation for the Phase-6 DONE-09 gate that consumes these verdicts.

- [LOW] 05-03 Task 1 vs Task 2 — minor spec ambiguity between positional orphan detection (isOrphan = "no [@citekey] within 500 chars of the claim span") and the findCitekeys(para): Set<string> membership helper. Because paragraphs are split on /\n{2,}/ and are usually shorter than ORPHAN_PROXIMITY_CHARS=500, the two collapse to the same answer in practice, but the plan should state which one is authoritative so the fixture counts are computed against the real predicate.

No other HIGH concerns: advisory isolation is structurally enforced (calls below the frozen status line + the verify-advisory-isolation regex guard), Pass-4's deterministic core takes no LLM/NLP dependency, the WN-3 sentinel→real ordering is internally consistent (repo-files real-from-creation, loader sentinel until 05-05, and the cross-check loop tolerates sentinels per the Phase-4 precedent), the D-13 0-hit invariant for verify.ts is preserved, and no 17th verb / new PHASE_3_CASES entry is introduced.

HIGH_COUNT: 1
```

### opencode

```
# Cross-AI Review: Phase 5 Plans 05-01 through 05-05

I've read all five plans plus the existing freshness.ts analog. Below are my concerns.

[MEDIUM] 05-02 Task 2, 05-03 Task 2: No rate-limiting / Semaphore on concurrent LLM calls
freshness.ts uses new Semaphore(5) (line 159) for its HTTP fan-out, imported from bin/lib/budget.ts. Both Pass 2 (per-citation LLM) and Pass 4 (per-AMBIGUOUS-sentence LLM) fire concurrent unbounded model calls — a 50-citation paper or a paragraph-heavy section with many AMBIGUOUS sentences would launch 50+ simultaneous Anthropic requests. This risks 429 rate-limit errors (which the catch→UNCLEAR swallows silently, degrading advisory quality) and budget spikes (multiple calls debiting against the same cap simultaneously). The plans reference Semaphore in the interfaces block and the freshness "shape to copy" but never use it. Add Semaphore(n) around the LLM call loop, matching the probeFreshnessAll pattern, at least at concurrency 3-5.

[MEDIUM] 05-02 Task 2, 05-03 Task 2: noLlm guard uses process.env['ANTHROPIC_API_KEY'] instead of delegating to getProviderApiKey
The noLlm check reads !process.env['ANTHROPIC_API_KEY'] directly. getProviderApiKey('anthropic') (referenced for the live branch) likely supports multiple key sources (config files, .env, other env var names). If the user provides their key through a non-ANTHROPIC_API_KEY mechanism that getProviderApiKey resolves, noLlm incorrectly evaluates to true and the live LLM path never activates. The presence check should use getProviderApiKey (or a dedicated hasProviderKey helper) to stay consistent with the key-resolution chokepoint.

[MEDIUM] 05-03 Task 1: Sentence-split regex too naive for academic prose
The plan specifies splitting on ./!/? followed by whitespace. Real academic text contains abundant false boundaries: "et al.", "Dr.", "U.S.A.", "i.e.", "e.g.", "Fig.", "Vol.", "No.", "pp.", equation numbers ("Eq. (1)"), and other common abbreviations. This will produce fragmented claim sentences, causing incorrect marker-match counts and spurious orphan classifications. The determinism non-negotiable is preserved, but the accuracy of the advisory pass will be low enough to undermine user trust. Either: (a) include a minimal abbreviation exception list (mirroring the stripCites helper pattern in quote-extractor.ts), or (b) document this limitation prominently in the Pass 4 advisory output.

[MEDIUM] 05-02 Task 2: Bib metadata normalization error handling unspecified
The plan says "normalize title string|string[] → string, authors {family,given}[]|string[] → comma-joined string, missing abstract → ''". No error handling is specified when the bib entry has an unexpected shape (e.g., title is a number, author is undefined, or the entry lacks both family/given and is a raw string). A thrown exception inside the normalization loop would hit the per-citation try/catch and produce a silent UNCLEAR, but a structural type error (e.g., calling .join(',') on undefined) would crash the runPass2 function. Clarify whether this is guarded by the existing interpolate() V5 validation or needs explicit try/catch around map access.

[LOW] 05-01 Task 2: assertBudget source-order check is only indexOf >= 0, not order
The RED test asserts indexOf('assertBudget') >= 0 in the pass2 source text. This checks presence, not ordering — the LLM call could precede assertBudget and the test would still pass. (Acknowledged in the plan as "a source-level proxy".) Worth tightening to a position comparison or accepting as-is since the execution plans explicitly state the ordering; no change required.

[LOW] 05-02 Task 2, 05-03 Task 2: No retry logic on transient LLM failures
Errors are caught→UNCLEAR with no retry. Advisory passes can tolerate this, but a burst of transient failures (e.g., Anthropic API overload) would render the entire Pass 2/4 output uniformly UNCLEAR, making the advisory section useless for the user. Consider a single retry with backoff for 429/503.

[LOW] 05-04 Task 2: DRAFT.md seeding location underspecified
The plan leaves "seedPaperFixture (or a verify-section-scoped seed step)" ambiguous. If the executor modifies seedPaperFixture (shared by all tier-contract cases), a DRAFT.md left on disk could interfere with other cases that expect a clean fixture state. If it's a verify-section-specific seed inside the generic loop, the path and timing must be correct. Minor — the executor will resolve this, but the plan should lock the approach.

[LOW] 05-01 Task 3 vs Task 2: D-13 comment line numbers disagree
Task 2 references "lines 21-26" while Task 3 references "lines 1-13" for the D-13 comment block in verify.ts. The executor reading the actual file will resolve this, but the inconsistency could cause confusion in automated execution.

[LOW] 05-03 Task 1: CLAIM_MARKERS includes ultra-common words
The regex includes \bis\b and \bare\b, which match in nearly every English sentence. This inflates the HIGH-confidence claim count and reduces the heuristic's discriminative power. Since Pass 4 is advisory, this is acceptable but could be tuned to exclude copular verbs or require more specific epistemic markers.

## Summary
HIGH_COUNT: 0
No plan violates a non-negotiable or would cause the phase to deliver incorrectly, unsafely, or incompletely. The four MEDIUM concerns (missing Semaphore, noLlm check not using getProviderApiKey, naive sentence splitter, unspecified bib-normalization error handling) are real quality/robustness gaps that should be addressed before or during execution — the Semaphore gap is the most impactful since concurrent unbounded LLM calls will hit rate limits on real papers. All non-negotiables (advisory isolation, Pass 4 determinism, budget gates, CI offline path, locked-16 bijection, WN-3 hash lockstep, D-13 invariant) are correctly preserved across all five plans.
```


---

# Phase 5 Plan Review — Cycle 2

**Cycle:** 2
**Reviewers run:** codex (OK), claude (OK), opencode (OK), gemini (TIMED OUT — exit 124, 0 bytes; unavailable this cycle)
**Date:** 2026-06-18

Re-review after the two cycle-1 HIGH concerns were addressed. Three of four external
reviewers produced output (gemini hit the 360s hard timeout). Reviewer-raw HIGH counts:
codex=1, claude=1, opencode=0. After adjudication against the live codebase
(`bin/cli/verify.ts` confirmed `grep -c loadPrompt == 0`) and an independent word-count
re-walk of the pinned R1-R8 rule, the judge keeps **1 genuine HIGH**.

## Cycle-1 HIGH status

- **HIGH-1 (D-13 0-hit invariant): RESOLVED.** Independently confirmed: `bin/cli/verify.ts`
  currently contains 0 occurrences of the literal `loadPrompt` (the comment paraphrases as
  "prompt-loader symbol"). 05-01 removed `bin/cli/verify.ts` from `files_modified` and the
  old verify.ts-editing task; 05-01 Task 2 guard (B) adds a committed whole-file regression
  `(text.match(/loadPrompt/g) ?? []).length === 0` (comments included); 05-04 Task 1
  forbids writing the literal `loadPrompt` anywhere in verify.ts and re-asserts the
  whole-file count post-wiring; the `runPass2`/`runPass4` import strings carry no
  `loadPrompt` literal. All three reviewers independently confirm RESOLVED.

- **HIGH-2 (Pass-4 fixture vs deterministic algorithm): NOT FULLY RESOLVED.** The R1-R8
  rule is now pinned verbatim and substantively identical across 05-01 Task 1 and 05-03
  Task 1 (05-03 adds only a clarifying "dedupe case-insensitively" note to R6, consistent
  with 05-01), `orphanCount` is HIGH-only and LLM-independent, and the canonical example
  was changed 2->1 in both plans. codex and opencode read this as resolved. HOWEVER, claude
  caught — and the judge independently verified by word count — that the *corrected*
  canonical example still contradicts the rule via a DIFFERENT clause (R5 length floor),
  reintroducing the same fixture-vs-algorithm divergence class. Kept as the one remaining
  HIGH below. The fix changed the value (2->1) but did not make the canonical walk
  rule-faithful end-to-end.

---

## Synthesized Findings (cycle 2)

### HIGH

- **[HIGH] 05-01 Task 1 (fixture entry (e)) + 05-03 Task 1 (canonical worked example) — the
  "corrected" canonical Climate-change example violates R5 (CLAIM_MIN_WORDS=8); a faithful
  R1-R8 extractor yields orphanCount = 0, not 1, so the mandated fixture is unsatisfiable
  by a correct implementation.**
  Raised by: claude (HIGH). Independently verified by the judge via word count.
  R5 ("a sentence with word count < 8 is NOT a claim") is a pre-filter applied before R6
  marker counting (R3/R4 are explicitly "discarded before marker counting"; R5 sits in the
  same skip stage). Word counts of the canonical paragraph:
  - S1 "Climate change demonstrates accelerating ice loss" = **6 words** -> dropped by R5.
  - S2 "This proves the feedback loop is intensifying" = **7 words** -> dropped by R5 (so it
    can never become the HIGH orphan the example asserts).
  - S3 "Ice sheets are retreating globally" = **5 words** -> dropped by R5.
  A faithful R1-R8 extractor drops all three sentences -> **orphanCount = 0**. Yet both
  plans hard-code the walk as S1->AMBIGUOUS / S2->HIGH->orphan / S3->AMBIGUOUS ->
  `expected_orphan_count: 1`, and BOTH per-sentence walks silently skip the R5 check. This
  re-creates exactly the fixture-vs-algorithm divergence HIGH-2 was meant to eliminate. It
  is acute because 05-03 Task 1 instructs the executor: "if a fixture appears to fail, the
  bug is in this extractor — re-walk R1-R8 ... do NOT lower the HIGH threshold." Here the
  extractor would be CORRECT and the FIXTURE is wrong, steering the executor into either
  hacking the deterministic core (breaking VRFY-06 / SC2 determinism) or leaving
  `tests/known-bad-pass4.test.ts` permanently RED — blocking the phase GREEN gate.
  Fix direction: rewrite the canonical paragraph so the intended HIGH sentence clears BOTH
  the >=8-word floor AND 2+ distinct markers — e.g. S2 -> "This clearly proves that the
  climate feedback loop is intensifying over time" ("proves"+"is" = 2 markers, >=8 words ->
  legitimately HIGH and uncited -> orphan), re-derive the full walk THROUGH R5 (showing the
  word count of each sentence), and update the value identically in BOTH 05-01 (entry (e))
  and 05-03 (worked example). Additionally, instruct the fixture author of shapes (a)/(b)
  that EVERY intended claim sentence must clear R5's 8-word floor (state the word count in
  each `description` walk), so no other authored fixture repeats this defect.

### MEDIUM

- **[MEDIUM] 05-02 Task 1 — Pass 2 returns "one Pass2Result per UNIQUE [@citekey]", but
  SC1/VRFY-03 specifies a verdict "per in-text citation"; a citekey reused across multiple
  distinct claim sentences collapses to a single verdict, losing advisory coverage.**
  Raised by: codex (as HIGH). DOWNGRADED to MEDIUM by the judge. This is advisory output,
  not a blocking gate; SC1's load-bearing property is the UNCLEAR-bias calibration and the
  four-value enum, both preserved. Collapsing multiple occurrences of the same citekey is a
  real coverage/precision gap but does not violate a non-negotiable or fail the success
  criterion's core property. (05-RESEARCH frames Pass 2 as "a pure LLM call per in-text
  citation ... regex over [@citekey] occurrences," so per-occurrence granularity is the
  intended model.) Fix direction: extract one (claim-sentence, citekey) pair per in-text
  occurrence and return one Pass2Result per occurrence, not per unique citekey; or
  explicitly document the per-unique-citekey scoping as a deliberate Phase-5 simplification.

- **[MEDIUM] 05-01/05-03 R6 "distinct marker LEMMAS" is ambiguous (surface form vs.
  grammatical lemma); the human-authored fixtures (05-01) and the independently-implemented
  extractor (05-03) can desync.** Raised by: claude (MEDIUM). The examples use clearly
  distinct words (proves/is) and never resolve whether `is`/`are` (both "be") collapse to
  one lemma or count as two. A different reading flips HIGH/AMBIGUOUS classification and
  thus orphan counts across the two plans. Fix direction: pin the operational definition
  concretely — "distinct = number of unique case-insensitively-matched marker STRINGS
  (surface-form dedup)" — in BOTH plans, and avoid is/are co-occurrence in HIGH fixtures.

- **[MEDIUM] 05-01/05-03 R5 word-count basis is unspecified relative to [@citekey] tokens.**
  Raised by: claude (MEDIUM). R5 says "word count" with no `stripCites` step, while the
  cited analog quote-extractor.ts counts words AFTER stripping cites. For fixture shape (b)
  (sentence containing a [@citekey]), whether the citation token counts as a word can flip
  a borderline 8-word sentence across the R5 threshold. Fix direction: pin in R5 whether
  word count is computed on the raw sentence or after stripping [@citekey] tokens, applied
  identically in fixtures and extractor. (Directly compounds the HIGH above — fixing the
  HIGH should also nail down this basis.)

- **[MEDIUM] 05-04 Task 2 — tier-contract explicitly asserts the `**UNCLEAR**` row only on
  the CLI artifact, not the MCP artifact, despite the must-have implying both tiers show the
  no-LLM UNCLEAR row.** Raised by: codex (MEDIUM). Because MCP and CLI likely share the
  verifier path it may pass in practice, but the test does not pin the full SC3 observable.
  Fix direction: assert `assert.match(mcpArtifactBytes, /\*\*UNCLEAR\*\*/)` as well.

- **[MEDIUM] 05-02/05-03 — the `noLlm` guard checks `process.env['ANTHROPIC_API_KEY']`
  directly, but the live key is resolved via `getProviderApiKey` which may source keys from
  config/scoped storage; a config-only key makes the live LLM path unreachable.**
  Raised by: codex (MEDIUM). CARRIED OVER from cycle 1 (still unaddressed). Fix direction:
  use `PENSMITH_NO_LLM` as the hard offline switch, then let `getProviderApiKey` (or a
  `hasProviderKey` helper) determine availability in the live branch.

### LOW

- **[LOW] 05-04 — verify.ts return value widened with `pass2`/`pass4`; if the MCP tool
  response serializer is strict-schema it could reject the new keys.** Raised by: opencode.
  Standard practice is schema-permissive; confirm or add the properties to the MCP schema.

- **[LOW] 05-02 — `@anthropic-ai/sdk` must already be in package.json (first live model seam);
  "no new packages" forbids adding it.** Raised by: opencode. 05-RESEARCH Package Legitimacy
  Audit asserts it is already declared+installed (0.104.2). Executor should confirm before
  05-02; harmless if present.

- **[LOW] 05-03 R1/R3 — splitting "on terminator" can drop the `?`, defeating the
  rhetorical-skip rule unless the terminator is retained/recorded.** Raised by: codex.
  Fix direction: state that sentence spans must retain (or separately record) the terminator
  so R3 can test for a trailing `?`.

- **[LOW] 05-01 — the `assertBudget`-before-LLM source proxy checks presence
  (`indexOf('assertBudget') >= 0`), not ORDER.** Raised by: opencode, codex (touches).
  CARRIED OVER from cycle 1. Acceptable (ordering is architecturally enforced) but the test
  description overstates what it verifies; an order-aware assertion would harden it.

- **[LOW] 05-02/05-03 — LLM `rationale` text is not sanitized for pipe `|`/newline chars
  that could break the VERIFICATION.md Markdown table.** Raised by: opencode. Cosmetic;
  advisory output only.

- **[LOW] 05-01/05-05 — WN-3 cross-check loop sentinel-awareness is assumed but not stated.**
  Raised by: claude. During waves 0-2 the loader holds sentinels while repo-files holds real
  hashes; if a cross-check asserts strict equality without sentinel-tolerance it would fail.
  Adjudicated in cycle 1 as benign (live repo-files.test.ts has NO such strict cross-check —
  per-pin loop only recomputes on-disk SHA-256 vs PENDING_HASH_PINS; mirrors GREEN Phase-4
  precedent). Kept LOW: a one-line confirmation in 05-01 would remove the ambiguity.

### Adjudicated DOWN (raised as HIGH, judged NOT HIGH)

- **codex [HIGH] "05-02 returns one result per unique citekey, violating SC1 per-citation"**
  — DOWNGRADED to MEDIUM (see MEDIUM section). Advisory coverage/precision gap, not a
  non-negotiable break or a failure of SC1's load-bearing UNCLEAR-bias property.

---

## Per-Reviewer Raw (cycle 2)

### codex

```
[RESOLVED] HIGH-1 D-13 0-hit invariant is genuinely resolved. 05-01 no longer modifies bin/cli/verify.ts, adds a whole-file regression test counting loadPrompt, and 05-04 explicitly forbids adding that literal in code or comments. The plans mention the token in plan prose, but do not instruct writing it into verify.ts.

[RESOLVED] HIGH-2 Pass-4 fixture/algorithm mismatch is genuinely resolved. The R1-R8 rule is substantively identical in 05-01 and 05-03, orphanCount is HIGH-only and LLM-independent, and the canonical climate-change example correctly computes to 1: S1 ambiguous, S2 HIGH orphan, S3 ambiguous.

[HIGH] 05-02 Task 1: Pass 2 is specified as "one result per unique [@citekey]", which violates SC1's "per in-text citation" requirement. If the same citekey appears in multiple claim sentences, this plan would collapse distinct claims into one verdict, losing advisory coverage. Fix direction: extract citation occurrences or citekey-plus-claim-sentence pairs, and return one Pass2Result per in-text citation occurrence, not per unique citekey.

[MEDIUM] 05-04 Task 2: tier-contract only explicitly asserts **UNCLEAR** in the CLI artifact, not the MCP artifact, despite the must-have saying both tiers should show the no-LLM UNCLEAR row. Because MCP and CLI likely share the same verifier path this may pass in practice, but the test does not pin the full SC3 observable. Fix direction: assert **UNCLEAR** for mcpArtifactBytes too.

[MEDIUM] 05-02/05-03 live-path gating checks process.env['ANTHROPIC_API_KEY'] before using getProviderApiKey('anthropic'). If the project supports API keys from non-env runtime sources, the advisory LLM path will incorrectly fall back to offline placeholders. Fix direction: use PENSMITH_NO_LLM as the hard offline switch, then let getProviderApiKey determine availability in the live branch.

[LOW] 05-03 R1/R3 implementation guidance is slightly underspecified: splitting "on terminator" can accidentally remove ?, making the rhetorical-skip rule ineffective unless the implementation preserves terminators or tracks them separately. Fix direction: state that sentence spans must retain the terminator or otherwise record it before trimming.

HIGH_COUNT: 1
```

### claude

```
HIGH-1 (D-13 0-hit invariant) — GENUINELY RESOLVED.
- 05-01 files_modified no longer lists bin/cli/verify.ts; the old verify.ts-editing task is gone.
- 05-01 Task 2 guard (B): (text.match(/loadPrompt/g) ?? []).length === 0 against the FULL verify.ts source, comments included.
- 05-04 Task 1 adds only runPass2/renderPass2Section/runPass4/renderPass4Section imports (no loadPrompt literal), explicitly forbids writing loadPrompt anywhere in verify.ts, leaves the D-13 comment block untouched, re-asserts guard (B) post-wiring.
- No plan instructs writing the literal loadPrompt token into verify.ts. The hyphenated prompt-loader token is correctly left ungated.

HIGH-2 (Pass-4 fixture vs algorithm) — NOT FULLY RESOLVED. R1-R8 is now identical verbatim across 05-01 and 05-03, but the "corrected" canonical example contradicts the rule it is supposed to validate (see HIGH).

[HIGH] 05-01 Task 1 + 05-03 Task 1 — the "corrected" canonical Climate-change example violates R5 (CLAIM_MIN_WORDS=8); its true orphanCount is 0, not 1, making the mandated fixture (e) unsatisfiable by a correct R1-R8 implementation.
  S1 "Climate change demonstrates accelerating ice loss" = 6 words -> dropped by R5.
  S2 "This proves the feedback loop is intensifying" = 7 words -> dropped by R5 (cannot be the HIGH orphan the example claims).
  S3 "Ice sheets are retreating globally" = 5 words -> dropped by R5.
  All three under 8 words -> faithful extractor yields orphanCount = 0. Both plans hard-code (e) / the worked walk as expected_orphan_count 1 and silently skip the R5 check, reintroducing the fixture-vs-algorithm divergence HIGH-2 was meant to eliminate. 05-03 Task 1 tells the executor "if a fixture fails, the bug is in this extractor — re-walk R1-R8 ... do NOT lower the HIGH threshold," steering them into hacking the deterministic core (breaking VRFY-06/SC2) or leaving the suite RED. Fix: rewrite the paragraph so the intended HIGH sentence has >=8 words AND 2+ markers (e.g. S2 -> "This clearly proves that the climate feedback loop is intensifying over time"), re-derive the walk through R5, update both plans identically; remind the fixture author that every intended claim sentence must clear R5's 8-word floor.

[MEDIUM] 05-01/05-03 R6 "distinct marker LEMMAS" is ambiguous (surface form vs. grammatical lemma) and could desync the human-authored fixtures from the implemented extractor. Fix: define "distinct = number of unique case-insensitively-matched marker strings" in both plans; avoid is/are co-occurrence in HIGH fixtures.

[MEDIUM] R5 word-count basis is unspecified relative to [@citekey] tokens. quote-extractor.ts counts words after stripCites; R5 says "word count" with no strip step. For shape (b) the citation token can flip a borderline 8-word sentence. Fix: pin whether word count is raw or post-strip, identically in fixtures and extractor.

[LOW] WN-3 cross-check loop timing (05-01 vs 05-05). 05-05 references a loader/PIN cross-check loop; during waves 0-2 the loader holds sentinels while repo-files holds real hashes. Presumably sentinel-tolerant (Phase-4 precedent) but the plans never state the cross-check skips sentinel-valued slugs. Worth a one-line confirmation in 05-01.

HIGH_COUNT: 1
```

### opencode

```
HIGH-1 (D-13 0-hit invariant): RESOLVED. 05-01 removes bin/cli/verify.ts from files_modified (byte-untouched) + committed regression guard B asserts (text.match(/loadPrompt/g) ?? []).length === 0 over the full source, comments included. 05-02/05-03 call loadPrompt only from their own modules. 05-04 forbids writing loadPrompt anywhere in verify.ts (code OR comments), imports carry no loadPrompt literal, D-13 comment block unchanged, acceptance re-checks grep -c "loadPrompt" bin/cli/verify.ts == 0. 05-05 touches only prompt-loader.ts.

HIGH-2 (Pass-4 fixture vs deterministic algorithm): RESOLVED. R1-R8 verbatim the same (05-03 adds a clarifying "dedupe case-insensitively" to R6, consistent). Canonical example = 1 in both (S1 {demonstrates}=1 AMBIGUOUS; S2 {proves,is}=2 HIGH orphan; S3 {are}=1 AMBIGUOUS). R8 HIGH-only in both. Every expected_orphan_count derived by mechanically walking R1-R8 with a per-sentence walk in description.

[MEDIUM] 05-02/05-03 depend on @anthropic-ai/sdk pre-installed (first live model seam); "no new packages" prohibits adding it if missing. Executor must verify package.json contains it before 05-02.

[MEDIUM] 05-04 widens verify.ts return value with pass2/pass4 for Phase 6 DONE-09. The MCP tool response schema must accept the new keys; if strict it could break the MCP tier. Verify schema-permissive or add properties.

[LOW] 05-01 Task 1 assertBudget source-order proxy checks only presence (indexOf >= 0), not order. Acceptable but the description overstates it.

[LOW] Neither 05-02 nor 05-03 sanitizes LLM rationale for pipe/newline chars that could break the Markdown table. Advisory/cosmetic.

HIGH_COUNT: 0
```

### gemini

```
UNAVAILABLE — timed out at the 360s hard limit (exit 124), produced 0 bytes. stderr tail
showed only environment warnings (no true-color, ripgrep fallback). No usable review this cycle.
```

---

# Phase 5 Plan Review — Cycle 3

**Cycle:** 3
**Reviewers run:** codex (OK), gemini (OK), opencode (OK), claude (TIMED OUT — exit 124, 0 bytes; unavailable this cycle)
**Date:** 2026-06-18

Re-review to confirm the two prior HIGH concerns are genuinely resolved and to surface any
remaining/NEW HIGH. Gemini was given 480s (it returned this cycle, ~1.8 KB); claude hit the
360s hard timeout (exit 124, 0 bytes). Three of four reviewers produced usable output.
Reviewer-raw HIGH counts: codex=2, gemini=0, opencode=0. After adjudication against the live
codebase (`grep -c "loadPrompt" bin/cli/verify.ts == 0` confirmed; D-13 comment paraphrases as
"prompt-loader symbol") and an INDEPENDENT Node re-walk of the canonical Pass-4 fixture through
R1–R8, the judge keeps **0 genuine HIGH**.

## Cycle-1/2 HIGH status — both now FULLY RESOLVED

- **HIGH-1 (D-13 0-hit invariant): RESOLVED (re-confirmed).** Live `grep -c "loadPrompt"
  bin/cli/verify.ts` returns **0** (verified this cycle); the only `prompt-loader` hits are the
  hyphenated token in the paraphrased comment (lines 8, 12), which is explicitly NOT gated.
  05-01 does not list `bin/cli/verify.ts` in `files_modified`; 05-01 Task 2 guard (B) commits a
  whole-file regression `(text.match(/loadPrompt/g) ?? []).length === 0` (comments included);
  05-04 Task 1 adds only `runPass2`/`renderPass2Section`/`runPass4`/`renderPass4Section` imports
  (no `loadPrompt` literal), forbids writing the literal anywhere in verify.ts, leaves the D-13
  comment block untouched, and re-asserts the count post-wiring. All three usable reviewers
  (codex, gemini, opencode) independently confirm RESOLVED.

- **HIGH-2 (Pass-4 fixture/algorithm agreement incl. R5 word-floor): RESOLVED.** The R1–R8 rule
  is pinned byte-identical in 05-01 Task 1 and 05-03 Task 1. The judge INDEPENDENTLY re-walked
  the canonical Climate-change paragraph in Node (full R1→R8, counting words at R5 with NO
  stripCites): S1 = 10 words → survives R5 → {demonstrates} = 1 distinct → AMBIGUOUS → not
  counted; S2 = 11 words → survives R5 → {proves, is} = 2 distinct → HIGH → uncited → orphan;
  S3 = 10 words → survives R5 → {are} = 1 distinct → AMBIGUOUS → not counted. **Computed
  orphanCount = 1, matching the asserted `expected_orphan_count: 1`.** All three sentences clear
  the >=8-word floor, so none is dropped at R5 — the exact defect cycle 2 flagged (6/7/5-word
  sentences yielding a true count of 0) is gone. R8 counts HIGH-confidence orphans ONLY and is
  LLM-independent in both plans. The fixture-authoring task now requires every claim sentence to
  clear the 8-word floor and to record word counts in the `description` walk. codex, gemini, and
  opencode all read HIGH-2 as RESOLVED this cycle.

---

## Synthesized Findings (cycle 3)

### HIGH

None. No usable reviewer's HIGH survives adjudication; the two prior HIGHs are confirmed
resolved and no NEW non-negotiable violation or success-criterion failure was found.

### MEDIUM

- **[MEDIUM] 05-04 Task 2 — tier-contract SC3 proof asserts `## Pass-2`/`## Pass-4` presence in
  both tiers + the `**UNCLEAR**` row on the CLI artifact only + ±20% length equivalence; it does
  NOT parse-and-compare Pass-2 verdict rows / Pass-4 orphan counts across CLI and MCP, nor assert
  `**UNCLEAR**` on the MCP artifact.** Raised by: codex (as HIGH this cycle). DOWNGRADED to
  MEDIUM by the judge — CARRIED OVER from cycles 1 and 2 (adjudicated MEDIUM both times). In the
  only CI-exercised path both tiers run under `PENSMITH_NO_LLM=1`, so both deterministically emit
  all-UNCLEAR Pass-2 placeholders and identical deterministic Pass-4 orphan counts; presence +
  the all-UNCLEAR row + ±20% length pins the scoped (no-LLM) SC3, and the plan documents that
  live-path verdict parity is out of CI scope by design. Real coverage gap, not an SC failure for
  the tested scope. Fix direction: also assert `assert.match(mcpArtifactBytes, /\*\*UNCLEAR\*\*/)`
  and compare the Pass-2 verdict tokens + Pass-4 orphan-count rows between the two artifacts
  (allowing prose-only differences in rationale).

- **[MEDIUM] 05-02 Task 1 — Pass 2 returns one `Pass2Result` per UNIQUE `[@citekey]`, but
  SC1/VRFY-03 phrases the verdict as "per in-text citation"; a citekey reused across distinct
  claim sentences collapses to one verdict, losing advisory coverage.** Raised by: codex (as HIGH
  this cycle). DOWNGRADED to MEDIUM — CARRIED OVER from cycle 2 (adjudicated MEDIUM). This is
  advisory output, not a blocking gate; SC1's load-bearing properties (UNCLEAR-bias calibration +
  the four-value enum) are preserved, and 05-RESEARCH frames Pass 2 as "a pure LLM call per
  in-text citation … regex over `[@citekey]` occurrences," so per-occurrence granularity is the
  intended model. Coverage/precision gap, not a non-negotiable break or SC1 core-property failure.
  Fix direction: return one result per (claim-sentence, citekey) occurrence, or explicitly
  document per-unique-citekey scoping as a deliberate Phase-5 simplification.

- **[MEDIUM] 05-02/05-03 — the `noLlm` guard tests `process.env['ANTHROPIC_API_KEY']` directly
  for presence, but the live key is resolved via `getProviderApiKey` which may source keys from
  config/scoped storage; a config-only key makes the live LLM path unreachable.** Raised by:
  codex. CARRIED OVER from cycles 1 and 2 (still unaddressed; advisory-only, not phase-failing).
  Fix direction: use `PENSMITH_NO_LLM` as the hard offline switch, then let `getProviderApiKey`
  (or a `hasProviderKey` helper) determine availability in the live branch.

- **[MEDIUM] 05-02/05-03 — bib-metadata normalization may pass `undefined` to `interpolate()`
  (which throws on missing vars) for entries lacking title/author; the per-citation try/catch
  converts the throw to a silent UNCLEAR rather than surfacing the root cause.** Raised by:
  opencode. Real robustness gap (metadata-poor citations silently collapse to UNCLEAR), but
  advisory-only and self-contained behind the try/catch. Fix direction: normalize every prompt
  var to a guaranteed string (`${field ?? ''}`) BEFORE the `interpolate()` call in both modules.

- **[MEDIUM] 05-03 Task 1 — R5 mandates "NO stripCites" (so `[@citekey]` tokens count as words),
  but the plan also says "reuse a wordCount helper modeled on quote-extractor.ts," whose helper
  DOES call stripCites; a copy-paste of that helper would change R5 word counts and desync the
  extractor from the fixtures.** Raised by: gemini. Real implementation-trap, but the plan text
  explicitly states the NO-stripCites requirement, so a careful executor avoids it. Fix
  direction: state in 05-03 that the Pass-4 `wordCount` must be a raw trimmed-whitespace split
  WITHOUT the `stripCites` step (a distinct helper, not a verbatim copy of quote-extractor.ts).

### LOW

- **[LOW] 05-04 — `renderPass2Section`/`renderPass4Section` render aggregate/summary tables only;
  per-claim `isOrphan`/`label` detail is in the typed return (for Phase-6 DONE-09) but not in the
  rendered VERIFICATION.md, so a reader cannot see which specific sentences are orphans from the
  Markdown alone.** Raised by: opencode. Acceptable for an advisory pass.

- **[LOW] 05-02 — `extractClaimSentences` returns ALL sentences containing a `[@citekey]`,
  including non-claim/methods sentences; the no-LLM path labels them all UNCLEAR without
  differentiating.** Raised by: opencode. Expected advisory behavior, not a correctness issue.

- **[LOW] 05-02/05-03 — the live per-call try/catch wraps the whole body, so an `appendCost`
  failure AFTER a successful model call is swallowed as UNCLEAR, risking unrecorded spend.**
  Raised by: codex. Live branch never runs in CI; advisory-only. Fix direction: structure
  try/finally so cost-recording failures are not silently merged with model-call errors.

- **[LOW] 05-04 — the SC3 success-criterion wording still says "proves Pass 2/4 parity" broadly
  while the test only pins no-LLM parity.** Raised by: codex. Fix direction: tighten the wording
  to "proves no-LLM tier parity" (the plan already documents the scoping in a comment).

- **[LOW] 05-04 Task 1 — IDE auto-import could suggest the `loadPrompt` symbol while wiring the
  pass imports.** Raised by: gemini. The plan explicitly warns against it; cosmetic reminder.

### Adjudicated DOWN (raised as HIGH, judged NOT HIGH)

- **codex [HIGH] "05-04 Task 2 tier-contract too weak for SC3"** — DOWNGRADED to MEDIUM (see
  MEDIUM section). Scoped (no-LLM) SC3 is pinned by presence + all-UNCLEAR + ±20% length; live
  parity is out of CI scope by design and documented. Consistent with cycles 1–2 adjudication.

- **codex [HIGH] "05-02 returns one result per unique citekey, violating SC1 per-citation"** —
  DOWNGRADED to MEDIUM (see MEDIUM section). Advisory coverage/precision gap, not a non-negotiable
  break or a failure of SC1's load-bearing UNCLEAR-bias + enum property. Consistent with cycle 2.

---

## Per-Reviewer Raw (cycle 3)

### codex

```
HIGH-1 is genuinely resolved in the plans: bin/cli/verify.ts is explicitly left untouched until 05-04, 05-04 forbids the literal loadPrompt anywhere in that file, and 05-01 adds a whole-file regression asserting (text.match(/loadPrompt/g) ?? []).length === 0, comments included.

HIGH-2 is genuinely resolved in the plans: 05-01 and 05-03 pin the same R1-R8 rule, keep R5 before marker counting, and the canonical fixture sentences now clear the 8-word floor with expected orphan count mechanically derived as 1.

- [HIGH] 05-04 Task 2: the tier-contract proof is too weak for SC3. It asserts ## Pass-2/## Pass-4 in both artifacts, but only checks **UNCLEAR** on the CLI artifact and does not compare Pass-4 orphan counts or Pass-2 verdict rows across CLI and MCP. Faithful execution could let MCP emit different advisory verdicts/counts while still passing presence and length checks. Fix direction: assert **UNCLEAR** in both artifacts and parse/compare the Pass-2 verdict tokens plus Pass-4 orphan count table rows, allowing prose differences only in rationale text.

- [HIGH] 05-02 Task 1: Pass 2 is specified as "for each in-text citation," but the implementation instruction extracts unique citekeys and returns one result per unique [@citekey]. That drops repeated citations where the same source supports different claims, making Pass 2 incomplete. Fix direction: build one result per citation occurrence or per citekey-claim-sentence pair, not per unique citekey; dedupe only exact duplicate pairs if desired.

- [MEDIUM] 05-01 Task 2: the advisory-isolation regex guard is narrow. It only catches direct same-line assignments like hasFail = ...pass2, and could miss indirect flows such as const advisoryFail = pass2...; status = advisoryFail ? .... Fix direction: strengthen the test to assert the frozen hasFail/hasUnverifiable/status block appears textually before any runPass2/runPass4 call and that no identifier derived from pass2/pass4 is referenced in that block.

- [MEDIUM] 05-02 Task 1/2 and 05-03 Task 2: the no-LLM gate checks !process.env['ANTHROPIC_API_KEY'] before using getProviderApiKey('anthropic'). If the project supports configured credentials outside env, the live branch will never run in that valid setup. Fix direction: determine availability through the same runtime key accessor, or attempt getProviderApiKey in the live path and fall back to placeholders only when it cannot resolve a key.

- [MEDIUM] 05-02 Task 2 and 05-03 Task 2: the live LLM branches catch "any error" around the per-call body, which can mask appendCost failures after a successful model call. That risks unrecorded spend despite the ARCH-09/10 cost-ledger intent. Fix direction: keep model-call errors advisory, but make cost-recording failures explicit, or structure the try/finally so successful calls cannot silently skip cost accounting.

- [LOW] 05-04 Task 2: the plan says to document the no-LLM scope of SC3 in a comment, but the success criterion wording still says "proves Pass 2/4 parity" broadly. Fix direction: tighten the wording to "proves no-LLM tier parity" unless live-path parity tests are added.

HIGH_COUNT: 2
```

### gemini

```
Explicit confirmation:
- HIGH-1 (D-13 0-hit invariant): Resolved. Plan 05-01 Task 2 adds a committed regression test tests/verify-advisory-isolation.test.ts asserting the whole-file loadPrompt literal count is 0. Plan 05-04 Task 1 wires the imports and call sites while explicitly forbidding the literal symbol in code or comments.
- HIGH-2 (Pass-4 fixture/algorithm agreement): Resolved. Plan 05-01 Task 1 derives all fixture expected_orphan_count values by mechanically executing the pinned R1–R8 rules, including the R5 8-word floor (where citation tokens count as words). Plan 05-03 Task 1 implements exactly those rules and references the same canonical Climate-change example (3 sentences, all >=8 words, orphanCount=1).

New and remaining concerns:

- [MEDIUM] 05-03 Task 1: Word count implementation. The plan correctly mandates "NO stripCites" for the R5 word-count floor (so [@citekey] tokens are counted as words, ensuring fixture agreement), but then suggests "reuse a wordCount helper modeled on quote-extractor.ts". Since the quote-extractor.ts version *does* call stripCites, there is a risk of a copy-paste regression. Fix: Ensure the executor understands that for Pass 4, the wordCount helper must be a raw whitespace split *without* the stripCites call.
- [LOW] 05-04 Task 1: Import strings. The plan specifies importing from ../lib/verify/pass2.js and ../lib/verify/pass4.js. While correct, ensure the executor does not accidentally auto-import the loadPrompt symbol itself if their IDE suggests it during wiring (though the plan warns against it).
- [LOW] 05-01 Task 1: Fixture derivation audit. The canonical example (e) in pass4-orphan.json is correctly derived (S1=10, S2=11, S3=10 words; only S2 is HIGH and uncited; total=1). This is a strong anchor for the phase.

HIGH_COUNT: 0
```

### opencode

```
## Cross-AI Plan Review — Phase 5 (Cycle 3)

### HIGH-1 and HIGH-2 confirmation

HIGH-1 (D-13 0-hit invariant): Resolved. Every plan respects the invariant. Plan 05-01 adds a committed whole-file loadPrompt-count==0 regression test. Plan 05-04's verify.ts wiring (imports from pass2.js/pass4.js, call-site comments) contains zero loadPrompt literals. Plan 05-05 touches only prompt-loader.ts. The living invariant (grep -c "loadPrompt" bin/cli/verify.ts == 0 comments included) is preserved at every step.

HIGH-2 (Pass-4 fixture/algorithm R5 floor agreement): Resolved. The pinned R1–R8 rule is byte-identical across Plans 05-01 and 05-03. The canonical example uses sentences >=8 words (10/11/10). R5 is applied BEFORE R6 marker counting in both plans. Fixture expected_orphan_count values are mechanically derived from R1->R8. The canonical walk (S1 AMBIGUOUS -> 0, S2 HIGH+uncited -> 1, S3 AMBIGUOUS -> 0) is identical in both plans.

### NEW/MEDIUM concerns

- [MEDIUM] Plans 05-02/05-03: Bib metadata normalization to interpolate() doesn't handle undefined fields. When parseBibtex returns entries without title or author, the normalization described (string|string[] -> string, {family,given}[]|string[] -> comma-joined) would pass undefined to interpolate(), which throws on missing vars. The per-citation try/catch converts this to UNCLEAR (so the pass doesn't crash), but every metadata-poor citation silently produces UNCLEAR instead of surfacing the root cause. Fix: normalize all prompt vars to guaranteed strings (${field ?? ''}) before the interpolate() call in both pass2.ts and pass4.ts, and add a one-line comment noting the defensive fallback.

- [MEDIUM] Plan 05-01 Task 2: orphan-label prompt output contract uses a different enum than the constraint in Plan 05-03. Plan 05-01 specifies the orphan-label prompt returns {'claim', 'definition', 'UNCLEAR'}. Plan 05-03 Step 3 parses into {'claim','definition','UNCLEAR'} — correct alignment here. But Plan 05-03's Pass4ClaimResult interface includes label: 'claim' | 'definition' | 'UNCLEAR', while the equivalent Step-3 expectation in Plan 05-02 (for Pass 2) has no such ambiguity since it's direct verdict parsing. No actual misalignment, but the plan cross-references should be more explicit that these enums are the same across plans.

- [LOW] Plan 05-04: renderPass2Section/renderPass4Section render aggregate counts only, losing per-claim orphan detail. Pass4ClaimResult.isOrphan and label are available in the typed return for Phase 6 DONE-09 consumers, but the VERIFICATION.md markdown shows only summary tables (paragraph-level orphan counts). Users cannot see which specific sentences are flagged orphans from the rendered output alone — they'd need to inspect the typed return or re-run with debug. This is acceptable for an advisory pass.

- [LOW] Plan 05-02: extractClaimSentences returns ALL sentences containing [@citekey], including non-claim sentences (e.g., a methods section sentence like "We used the apparatus from Smith [@smith2020]"). The advisory pass tolerates this — the LLM (when available) would judge it as PARTIAL/UNCLEAR — but the no-LLM path produces UNCLEAR for all such entries without differentiating. Expected behavior for an advisory pass, not a correctness issue.

### HIGH concerns count

H_COUNT: 0
```

### claude

```
UNAVAILABLE — timed out at the 360s hard limit (exit 124), produced 0 bytes (stdout and
stderr both empty). No usable review this cycle. (codex, gemini, and opencode all produced
usable output; >=1 usable reviewer requirement satisfied with three.)
```

### Judge's independent Pass-4 re-walk (cycle 3)

```
Re-walked the canonical Climate-change paragraph through R1->R8 in Node
(/tmp/walk-pass4.mjs), counting words at R5 with NO stripCites:
  R1 split -> 3 sentences.
  S1 "Climate change demonstrates accelerating ice loss across both polar regions."
     = 10 words -> survives R5; markers {demonstrates} = 1 distinct -> AMBIGUOUS -> not counted.
  S2 "This clearly proves that the climate feedback loop is intensifying rapidly."
     = 11 words -> survives R5; markers {proves, is} = 2 distinct -> HIGH; no [@citekey] -> uncited -> ORPHAN.
  S3 "Ice sheets are retreating globally according to recent satellite measurements."
     = 10 words -> survives R5; markers {are} = 1 distinct -> AMBIGUOUS -> not counted.
  COMPUTED orphanCount = 1  ==  asserted expected_orphan_count = 1  (MATCH).
Confirms HIGH-2 fully resolved: all three sentences clear the R5 8-word floor; only S2 is HIGH.
```
