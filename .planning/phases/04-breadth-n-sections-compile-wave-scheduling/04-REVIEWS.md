---
phase: 04
reviewers: [gemini, opencode]
reviewed_at: 2026-05-30T19:40:00+05:30
plans_reviewed: [04-01-PLAN.md, 04-02-PLAN.md, 04-03-PLAN.md, 04-04-PLAN.md, 04-05-PLAN.md]
self_cli_skipped: claude
failed_reviewers:
  - codex (auth: refresh token already used — 401; log out / sign in again to re-enable)
unavailable_reviewers:
  - cursor (not authenticated)
  - qwen (not installed)
  - coderabbit (not installed)
---

# Cross-AI Plan Review — Phase 04 (Breadth — N sections + compile + wave scheduling)

Reviewed by two independent external AI systems (Gemini, OpenCode), each given the
full project context, the phase requirements/decisions, and all five plan
summaries; OpenCode additionally read all five PLAN.md files plus the
CONTEXT/RESEARCH/VALIDATION/PATTERNS artifacts directly off disk. The `claude` CLI
was skipped for reviewer independence (this review ran inside Claude Code). Codex
was invoked but failed on an expired auth token (401) and was skipped per the
continue-on-failure rule. Cursor/Qwen/CodeRabbit were unavailable.

## Gemini Review

### 1. Summary
The Phase 04 plan is exceptionally rigorous and exhibits a deep understanding of
the project's core invariants, particularly the "non-negotiable" citation
integrity. The decomposition into four waves with clear dependency gates (e.g., the
CAPSTONE compile pipeline waiting for all orchestration and utility logic) is
logically sound. The use of a Kahn-based topological sort for wave scheduling,
combined with a stateless, recovery-first design, ensures the system remains robust
across crashes. The "citation-token protection" mechanism in the smoother pass is a
standout safety feature that effectively mitigates LLM-induced regressions.

### 2. Strengths
- **Citation Protection (D-13):** The strategy of replacing citekeys with unique
  placeholders (`{{cite_K_M}}`) and enforcing set-equality after the LLM smoothing
  pass is an excellent defense against "hallucination" or accidental deletion of
  academic credit.
- **Stateless Recovery (ARCH-20):** Relying on `PLAN.md` frontmatter as the source
  of truth for wave progress, rather than a volatile `STATE.json`, ensures the
  system can resume seamlessly after a crash without state corruption.
- **Tier Parity Enforcement:** Explicitly forcing `maxParallel: 1` and issuing a
  warning for Tier 2 (CLI) users maintains the Tier 1 distinction while keeping the
  shared core compatible with serial environments.
- **Surgical Revision Workflow:** `--revise` correctly targets
  `verified_against_draft_hash` for invalidation, ensuring a fix in one section
  triggers the minimal necessary work without cascading into unrelated sections.
- **Logical Serialization:** Serializing Plan 04-04 (Revise) after 04-03
  (Orchestration) to avoid `tier-contract.test.ts` write-conflicts is a subtle but
  high-value tactical choice for CI stability.

### 3. Concerns
- **HIGH: Missing vs. Failed Dependency (Plan 04-01/04-03).** The plan states that
  sections with an absent `PLAN.md` are skipped as `INFO`. However, if Section B
  `depends_on` Section A, and Section A is missing its `PLAN.md`, Section B should
  be `blocked`, not allowed to proceed. Treating "missing" as non-blocking could
  produce wave execution that violates topological order or a compiled draft with
  "holes" the user didn't authorize.
- **MEDIUM: Citekey Sync during Bib Collision Resolution (D-19 / Plan 04-05).**
  `bib-regen.ts` resolves collisions via base-26 suffixes (`vaswani2017a`,
  `vaswani2017b`). If resolution happens *after* the draft is concatenated, the
  citekeys in `.paper/DRAFT.md` (still `[@vaswani2017]`) won't match
  `.paper/CITATIONS.bib`. Resolution must be global across the draft, or the draft
  updated to match the final bib keys.
- **MEDIUM: Outline Validation Gaps (Plan 04-01).** `parseOutline` validates slugs
  but must also reject duplicate slugs / duplicate section numbers — a duplicate
  would make two sections fight over the same `NN-slug` directory, breaking
  isolation.
- **LOW: Concurrency Test Pollution (Plan 04-01).** A "synchronous live counter"
  for the Semaphore-cap test is prone to pollution if files run in parallel; scope
  the counter to the test instance.
- **LOW: Retraction Watch Warning Visibility (Plan 04-02).** Retraction-watch hits
  wired as WARN-only into Pass 1 are safe, but should be aggregated into
  `COMPILE-REPORT.md` (D-14) so they aren't lost in scrollback.

### 4. Suggestions
- **Strict Blocking Logic:** In `buildWaveGraph`, any node whose `depends_on`
  parents are `failed` OR `missing/not-started` should be marked `blocked`;
  `runWave` should only execute nodes where all parents are `completed`.
- **Global Citekey Resolution:** Perform citekey collision resolution *before* the
  smoothing pass so the smoother sees the final unique citekeys and DRAFT.md +
  CITATIONS.bib stay synchronized.
- **Refusal Pass-through:** Explicitly confirm compile's COMP-01 refusal on
  FABRICATED also blocks creation of `.paper/DRAFT.md` — no leaky drafts.
- **Tier-2 UI Polish:** Emit the `max-parallel ignored` WARN once at command start,
  not per-wave, while staying D-02 compliant.

### 5. Risk Assessment
**Overall Risk: LOW.** The plan is well-grounded in safety-first engineering;
reusing the existing `Semaphore` and `atomicWriteFile` chokepoints minimizes race /
corruption risk. The primary risks are logical (dependency blocking) rather than
architectural, and the TDD-first approach should catch these edge cases early.

---

## OpenCode Review

### 1. Summary
This is a well-structured, thoroughly researched set of five plans. The wave DAG is
correct (04-01+02 → 04-03 → 04-04 → 04-05), the safety split of 04-05's capstone
into RED-tests-first is sound, and the scope boundary (no Pass 2/4, no export, no
style-match, no insertion) is cleanly held. Every requirement ID maps to a named
test file with explicit acceptance criteria. The plans demonstrate deep
understanding of the load-bearing invariants (state isolation by directory,
read-only scheduler, atomic writes, hash-pinned prompts, token-set equality for
smoother protection). However, several gaps emerge under close scrutiny, mostly
around the completeness of the COMP-01 refuse gate and edge cases in crash
recovery.

### 2. Strengths
- **DAG correctness and serialization rationale.** 04-04 serialized after 04-03 due
  to shared `tests/tier-contract.test.ts` edits is explicitly documented and
  architecturally honest. Wave 4 gating on all four predecessors is correctly
  computed.
- **D-24 tier-contract obligations discharged in-plan.** Each of 04-03/04-04/04-05
  registers its workflow-body change in `tests/tier-contract.test.ts` in the same
  plan that makes the change. The stub-first/full-later pattern is a pragmatic risk
  tradeoff.
- **Scheduler read-only guarantee is testable and tested.** `scheduler-stateless.test.ts`
  asserts STATE.json mtime unchanged; the design resists writing a wave-progress
  file. Crash recovery via frontmatter re-read is the correct pattern.
- **D-13 citation-token protection is the strongest part of the design.**
  Placeholder substitution BEFORE the LLM call + post-call token equality is a
  code-enforceable invariant, not a prompt-engineering hope. Smoothing rejection →
  safe raw-concat fallback (not compile-block) is correct.
- **TDD rigor.** Every plan leads with RED tests (Wave 0). Acceptance criteria are
  specific, measurable, and include lint/typecheck gates.
- **Scope boundary discipline.** Pass 2/4, export, style-match, `/pensmith add`
  explicitly deferred; "reservation only" stance on letter-suffix paths is clean.

### 3. Concerns

#### HIGH
- **H-01: COMP-01 refuse gate does not explicitly read VERIFICATION.md for
  non-stale sections.** Step 1 is "recompute hash; mismatch → WARN + re-verify; any
  FABRICATED/MIS-CITED/NOT_FOUND → refuse." If a section's
  `verified_against_draft_hash` matches, the re-verify is skipped — so where does
  compile check for blocking verdicts on a non-stale section? If the Phase 3 state
  machine ever set `state: verified` despite a FABRICATED verdict, compile would
  trust the hash match and proceed. Compile must ALWAYS read VERIFICATION.md and
  check for blocking verdicts regardless of staleness. One-line I/O addition;
  unspecified in the plan. (*Plan 05, Task 3*)
- **H-02: Undefined behavior when VERIFICATION.md is absent at compile time.** A
  section written but never verified (or whose VERIFICATION.md was deleted) has no
  defined compile behavior. If `verified_against_draft_hash` is non-null and
  VERIFICATION.md is absent, compile would either crash on read or proceed without
  checking verdicts. Needs explicit handling: auto-verify or refuse with a clear
  error. (*Plan 05, Task 3*)

#### MEDIUM
- **M-01: Token-set vs. token-sequence in smoother post-check.** D-13 says "output
  token-set equals input token-set" but lists "reordered" as a mismatch. Sets don't
  track order — `{{cite_1_2}} {{cite_1_1}}` swapped would compare equal as a `Set`.
  The implementation must use an ordered token sequence / index-tracking, not a
  `Set`. The terminology inconsistency could cause a real bug. (*Plan 05, D-13 /
  smoother-token-protect.test.ts*)
- **M-02: `--research` adapter fan-out unspecified.** D-09 gives "live access to
  research adapters." A single flagged citation polling all 5 adapters is wasteful;
  whether it scopes to discipline-relevant adapters is deferred. Cost/efficiency,
  not correctness. (*04-04, Task 2*)
- **M-03: Compile lock stale-clear behavior unspecified.** The pipeline holds
  `.paper/.compile.lock` via proper-lockfile but no `stale` timeout is stated. Too
  long blocks re-runs; too short races a slow smoother LLM call. (*Plan 05, Task 3,
  P-6*)
- **M-04: Tier-2 "exactly one WARN" mechanism unclear.** If the WARN fires every
  time `runAllSections` is constructed, multiple calls produce multiple WARNs. No
  once-per-run guard is specified, yet "exactly one" is an acceptance criterion.
  (*04-03, Task 2*)

#### LOW
- **L-01: `parseSectionDirName` has zero production callers in Phase 4** (pure
  insurance for Phase 8 — risks bit-rot).
- **L-02: Consistency-scan heuristics underspecified** (thresholds / case-sensitivity
  deferred; acceptable since flags-only, never blocks).
- **L-03: `remove` action's mechanical bracket-clause delete edge cases** — compound
  `[@a; @b]`, citekey in running text, and whether the code locates the token by
  regex or by matching the LLM `before/after_excerpt` need more precision.
  (*04-04, D-05, RESEARCH §I*)
- **L-04: Smoother placeholders could collide with literal `{{variable}}` prose**
  (common in CS/math papers); fallback is safe but could cause needless smoothing
  rejection.

### 4. Suggestions
1. **Fix the COMP-01 gate (H-01):** Add to compile Task 3: "For every section,
   regardless of staleness, read `sections/<N>/VERIFICATION.md` and refuse on any
   FABRICATED/MIS-CITED/NOT_FOUND." Makes the gate defense-in-depth instead of
   trusting the Phase 3 state machine.
2. **Specify ordered token comparison for smoother (M-01):** Change "token-set" to
   "ordered token sequence" in D-13 and `smoother-token-protect.test.ts`.
3. **Define absent VERIFICATION.md / missing DRAFT.md behavior:** "if a section has
   no DRAFT.md, refuse naming the section; if DRAFT.md exists but VERIFICATION.md is
   absent, auto-verify before proceeding."
4. **Check `state === verified` before proceeding** (beyond the hash check); a
   section at `writing`/`failed` should be flagged/refused, not silently
   auto-verified.
5. **Make the Tier-2 serial WARN a once-per-run singleton** (`warnedOnce` guard) to
   match the acceptance criterion.
6. **Specify the compile lock stale timeout** (`stale: 30000`, matching
   handoff.ts).

### 5. Risk Assessment
**Overall: MEDIUM.** Core architecture is sound and the plans are thorough. The
MEDIUM rating is driven by two HIGH concerns: (1) the COMP-01 refuse gate may not be
as un-bypassable as claimed because it relies on hash-matching as a proxy for "no
FABRICATED verdicts" rather than explicitly re-reading VERIFICATION.md for non-stale
sections — fixable with one extra read, but significant given "verifier blocks
compile" is the project's core value; (2) absent VERIFICATION.md / DRAFT.md at
compile time is undefined behavior. Beyond these the set is well-constructed: DAG
correct, tier-contract obligations in the right plans, scope held, 21+ new test
files. The main execution risk is that 04-05 is a large capstone (5 tasks, 21+
files) with many convergent integration points; the Task 1a/1b safety-first split
mitigates this.

---

## Codex Review

**FAILED — not run.** Codex CLI returned `401 Unauthorized` ("refresh token already
used; log out and sign in again"). Per the review workflow's continue-on-failure
rule the reviewer was skipped. To re-enable: `codex login` (or log out / sign in),
then re-run `/gsd:review --phase 04 --codex`.

---

## Consensus Summary

Both reviewers independently judged the phase plan strong, well-decomposed, and
faithful to the project's non-negotiables, with the wave DAG correct and the
04-03 → 04-04 serialization (to avoid the shared `tier-contract.test.ts`
write-conflict) explicitly praised. They diverged on the headline risk rating
(Gemini LOW, OpenCode MEDIUM), but the substance converges: the residual risk is
concentrated in the **COMP-01 compile refuse-gate** and a few **graph
edge-cases** — not in the architecture.

### Agreed Strengths (both reviewers)
- Correct 4-wave dependency DAG; the deliberate 04-03 → 04-04 serialization is a
  thoughtful, correct call for CI stability.
- D-13 citation-token protection (placeholder substitution + post-call token
  equality + raw-concat fallback) is the strongest, most code-enforceable safety
  mechanism in the design.
- ARCH-20 read-only / stateless scheduler with crash recovery via PLAN.md
  frontmatter re-read; statelessness is given a falsifiable test (STATE.json mtime).
- Disciplined Wave-0 RED-first TDD with specific, measurable acceptance criteria.
- Surgical `--revise` invalidation via `verified_against_draft_hash` preserves
  section isolation.

### Agreed Concerns — highest priority
- **[HIGH] COMP-01 refuse-gate completeness / "missing" handling.** The two
  reviewers hit the same load-bearing surface from two angles:
  - OpenCode H-01: compile only checks blocking verdicts on *stale* sections (hash
    mismatch → re-verify). A non-stale section is trusted on the hash alone; compile
    never re-reads VERIFICATION.md, so a bad Phase-3 `state: verified` would slip
    through. Fix: ALWAYS read VERIFICATION.md per section and refuse on any
    FABRICATED/MIS-CITED/NOT_FOUND, independent of staleness.
  - OpenCode H-02: absent VERIFICATION.md (or missing DRAFT.md) at compile time is
    undefined behavior — must refuse-or-auto-verify explicitly.
  - Gemini HIGH: a section whose dependency is *missing its PLAN.md* is skipped as
    INFO rather than blocking the dependent — risking a compiled draft with
    unauthorized "holes."
  Net: the COMP-01 gate and the buildWaveGraph "missing/blocked" semantics must be
  tightened so nothing un-verified or un-planned can reach a written DRAFT.md. This
  is the project's single most load-bearing non-negotiable, so it is the must-fix
  before executing 04-05 (gate) and should be reflected in 04-01/04-03 (missing →
  blocked).

### Other notable concerns
- **[MEDIUM] D-19 bib-collision citekey sync (Gemini).** Base-26 suffix resolution
  must be global / pre-smoothing so `.paper/DRAFT.md` `[@key]` tokens match the
  regenerated `.paper/CITATIONS.bib`; otherwise the manuscript references keys that
  don't exist in the bib.
- **[MEDIUM] Smoother token-SET vs token-SEQUENCE (OpenCode M-01).** D-13's "set"
  wording cannot detect reordering; implement ordered/index-tracked comparison so a
  swapped citation pair is caught.
- **[MEDIUM] parseOutline duplicate slug / number rejection (Gemini).** Duplicates
  collide on the `NN-slug` directory and break isolation; add explicit rejection.
- **[MEDIUM] Compile-lock stale timeout unspecified (OpenCode M-03).** Pin
  `stale: 30000` (matching handoff.ts) so a crashed compile auto-clears.
- **[MEDIUM] Tier-2 "exactly one WARN" needs a once-per-run guard (OpenCode M-04).**
  Gemini independently suggested emitting it once at command start, not per wave.
- **[LOW] Retraction-watch WARN should aggregate into COMPILE-REPORT (Gemini);
  consistency-scan heuristics + `remove`-action edge cases + placeholder/`{{var}}`
  collision underspecified (OpenCode L-02/L-03/L-04).**

### Divergent Views
- **Overall risk rating.** Gemini rated LOW (risks are "logical, not
  architectural," caught by TDD); OpenCode rated MEDIUM (the COMP-01 gate "might not
  be as un-bypassable as claimed"). Given that the divergence is entirely about how
  to weight the same COMP-01 finding — and that finding sits on the project's core
  value — this review adopts the more conservative MEDIUM and treats the COMP-01
  gate tightening as a must-fix.
- **Missing-dependency framing.** Gemini frames "missing PLAN.md → dependent must
  block" as a scheduler (04-01/04-03) HIGH; OpenCode frames the adjacent
  "missing VERIFICATION.md" as a compile (04-05) HIGH. They are two faces of the
  same "never let un-verified/un-planned work reach DRAFT.md" invariant.

### Recommended Action
Plans 04-01 through 04-04 are execution-ready. Before executing — and ideally
folded back via `/gsd:plan-phase 04 --reviews` — tighten the citation-integrity
surface:
1. **04-05 (must-fix):** compile reads `sections/<N>/VERIFICATION.md` for EVERY
   section regardless of staleness and refuses on any blocking verdict before any
   `.paper/DRAFT.md` write; define absent-VERIFICATION.md / missing-DRAFT.md
   behavior (refuse or auto-verify); also require `state === verified`.
2. **04-01 / 04-03:** a node whose dependency is missing/unplanned/failed is
   `blocked`, not silently skipped (Gemini HIGH).
3. **04-05:** make bib-collision resolution global/pre-smoothing (citekey sync) and
   change the smoother check to an ordered token sequence (not a Set); pin the
   compile-lock `stale` timeout.
4. **04-01:** reject duplicate slugs / section numbers in `parseOutline`.
5. **04-03:** guard the Tier-2 serial WARN to fire exactly once per run.

To incorporate this feedback into planning:
  /gsd:plan-phase 04 --reviews

---

## Re-run Addendum — 2026-05-30 (cycle 2)

A second `/gsd:review --phase 04 --all` was requested. This addendum records the
outcome honestly: **no NEW external review was obtained this cycle.** Every available
external CLI failed in this Windows / Git-Bash environment, so the genuine cycle-1
findings above (Gemini + OpenCode) remain the substantive review of record. No
fabricated review content has been added.

Reviewer attempts this cycle (`claude` self-skipped for independence, as before):

- **gemini** — installed and authenticated. Passing the ~150 KB prompt as an argv
  string hit `E2BIG` ("Argument list too long"); the `--skip-trust -p -` stdin path
  (with `GEMINI_CLI_TRUST_WORKSPACE=true`) cleared the trusted-folder error but the
  CLI then entered an agentic loop and errored on `run_shell_command: Tool not
  found`, emitting 0 bytes of review.
- **opencode** — installed (1 credential, OpenCode Zen). Does not read the prompt
  from stdin (requires a message arg → `E2BIG` on the large prompt). Via `--file`
  (`--format json`) it exited 0 but returned only the file-attachment stub with no
  model completion. 0 usable bytes.
- **codex** — `401 Unauthorized` (refresh token already used), same as cycle 1.
  Needs `codex login`.
- **cursor** — `cursor agent -p` exited 0 but emitted only "Run with 'cursor -' …"
  plus Electron warnings; no review body non-interactively.
- **qwen, coderabbit** — not installed.

**Net:** the cross-AI peer-review mechanism could not run a second independent pass
in this environment. The cycle-1 review above stands unmodified. The two load-bearing
HIGH findings it raised remain **unresolved in the plans**:
1. COMP-01 compile refuse-gate completeness — always read `sections/<N>/VERIFICATION.md`
   per section regardless of staleness, and define absent-VERIFICATION / missing-DRAFT
   behavior (04-05).
2. Missing/unplanned/failed dependency must be `blocked`, not silently skipped
   (04-01 / 04-03).

To re-attempt external review: fix CLI auth/invocation (`codex login`; a Gemini
invocation that does not trigger agentic tool-use on a large stdin prompt; an
OpenCode provider that returns completions) and re-run `/gsd:review --phase 04 --all`.
To fold the existing findings into planning now: `/gsd:plan-phase 04 --reviews`.
