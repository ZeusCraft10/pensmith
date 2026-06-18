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
