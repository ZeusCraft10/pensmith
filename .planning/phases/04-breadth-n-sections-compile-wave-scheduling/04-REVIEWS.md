---
phase: 04
reviewers: [gemini, opencode]
reviewed_at: 2026-05-30T14:38:01Z
plans_reviewed: [04-01-PLAN.md, 04-02-PLAN.md, 04-03-PLAN.md, 04-04-PLAN.md, 04-05-PLAN.md]
self_cli_skipped: claude
failed_reviewers:
  - codex (401 Unauthorized — refresh token already used; run `codex login` to re-enable)
  - cursor (non-interactive `cursor agent -p` produced no review body; needs `cursor -` stdin form + auth)
unavailable_reviewers:
  - qwen (not installed)
  - coderabbit (not installed)
---

# Cross-AI Plan Review — Phase 04 (Breadth — N sections + compile + wave scheduling)

Reviewed by two independent external AI systems (Gemini, OpenCode), each given the
full project context (CLAUDE.md non-negotiables), the phase decisions (04-CONTEXT.md),
and all five PLAN.md files. The `claude` CLI was skipped for reviewer independence
(this review ran inside Claude Code). Codex failed on an expired auth token (401) and
Cursor produced no usable output non-interactively; both were skipped per the
continue-on-failure rule. Qwen/CodeRabbit are not installed.

This is a re-run of `/gsd:review --phase 04 --all`. Both substantive reviewers
independently rated the plan set MEDIUM risk and converged on the same load-bearing
concerns as the prior cycle (missing-dependency blocking + the compile refuse-gate),
with no new architectural HIGH surfaced. See the Cross-Cycle Note in the Consensus.

## Gemini Review

### Overall Summary
This is an exceptionally well-structured and detailed set of plans. The author
demonstrates a deep understanding of the project's core principles, particularly the
non-negotiable nature of citation integrity. The use of Test-Driven Development (RED
tests first), explicit dependency mapping (`depends_on`), and pre-computed wave
scheduling is excellent. The plans correctly identify and isolate the most dangerous
operations (e.g., LLM-based prose smoothing) and wrap them in robust, code-enforced
safety checks.

The primary risks identified are not architectural flaws but rather subtle logical
gaps that could undermine the project's strict integrity guarantees: potential
mismatches between citation keys and the regenerated bibliography, ambiguity in LLM
instructions for citation placement, and incomplete handling of dependency-graph edge
cases.

### Plan-by-Plan Analysis

**04-01 Section Scheduler** — solid foundation for parallel execution.
- Strengths: read-only/stateless scheduler (ARCH-20) is a powerful, testable choice;
  locking the OUTLINE.md parse format in a test comment prevents ambiguity; Semaphore
  reuse is efficient.
- **MEDIUM — Wave Override Cascade.** Override validation confirms an override is not
  *less than* its deps' wave, but doesn't re-validate the whole graph. If C (wave 2)
  depends on B (wave 1) and a user forces B to `wave: 5`, C should be pushed to ≥ wave 6;
  the current validation might let C run in wave 2, before its dependency.
- **LOW — Concurrency Test Brittleness.** The synchronous-live-counter semaphore-cap test
  is event-loop-sensitive; controllable manually-resolved promises would be more
  deterministic.

**04-02 Write Utilities** — good shared/reusable utilities.
- Strengths: strong reuse focus (extract-citekeys, assemble-sources) as pure functions;
  retraction-watch wired as non-blocking WARN.
- **LOW — Retraction Watch Visibility.** A retraction WARN during a parallel write can be
  lost in console output; aggregate into the final COMPILE-REPORT.md.

**04-03 Write Orchestration** — correctly assembles multi-section writing.
- Strengths: `Promise.allSettled` (one failed section doesn't halt others); clean
  scheduler/orchestrator separation.
- **HIGH — Dependency on Missing/Unplanned Sections.** The scheduler skips sections whose
  PLAN.md is absent. This plan must define what happens when a *planned* section depends
  on a *missing/unplanned* one — the dependent should be blocked, not run with an unmet
  dependency. Critical for integrity.
- **MEDIUM — Tier-2 Serial Warning.** The `--max-parallel ignored` warning must be
  emitted exactly once per run, not once per wave.

**04-04 Revise Loop** — well-designed surgical citation revision.
- Strengths: surgical invalidation of `verified_against_draft_hash` re-verifies only the
  modified section, preserving all other sections without costly re-runs.
- **HIGH — LLM Citation Placement Ambiguity.** The core risk is the reviser LLM attaching
  a citation to the wrong sentence, creating a MIS-CITED error and a costly re-loop. The
  `reviser.md` prompt needs strict, explicit instructions + few-shot examples that
  `[@citekey]` tokens stay attached to the specific claim they support.

**04-05 Compile** — appropriately complex, safety-focused capstone.
- Strengths: the multi-layered citation-integrity defense is the standout of the phase —
  placeholder substitution *before* the smoother call + post-call token-set match; the
  COMP-01 refuse-gate; atomic writes (`atomicWriteFile` + `.compile.lock`).
- **HIGH — Citation Key & Bibliography Mismatch.** `bib-regen` resolves citekey collisions
  with suffixes (`smith2020a`/`smith2020b`), but the plan doesn't specify updating the
  in-text `[@smith2020]` tokens in section drafts to match — the compiled document would
  have in-text citations pointing to keys absent from the final `.bib`, breaking every
  citation involved in a collision.
- **MEDIUM — Smoother Placeholder Collision.** If an author legitimately uses a
  `{{cite_K_M}}`-shaped string in prose it could collide with the placeholder mechanism; a
  more unique sentinel would mitigate.

### Cross-Cutting Suggestions
1. Prioritize fixing `bib-regen` key synchronization and hardening `reviser.md`.
2. Explicitly define and test behavior for dependencies on missing/unplanned/failed
   sections — a dependent must always be blocked if deps are unmet.
3. Consolidate critical WARNs (retractions, stale, ignored flags) into COMPILE-REPORT.md.

### Risk Assessment
**MEDIUM.** Architecture is sound and safety-focused; rated MEDIUM (not LOW) because the
HIGH-severity concerns, while subtle, strike at the heart of citation integrity. A
bibliography mismatch or a misplaced citation would violate core principles. All are
fixable logical gaps that should be addressed before implementation.

---

## OpenCode Review

### 1. Summary
A strong, well-decomposed plan set with deep alignment to the project's non-negotiables.
The five plans form a clean dependency chain (04-01 scheduler → 04-02 utilities → 04-03
orchestration → 04-04 revise → 04-05 compile), each leading with RED tests and carrying
its own threat model. Citation integrity is treated with appropriate paranoia
(placeholder substitution, token-set equality, COMP-01 refuse gate). Reuse discipline
(Semaphore, atomicWriteFile, existing chokepoints) is exemplary and keeps the dependency
surface flat. Residual risk is concentrated in the completeness of the COMP-01 refuse
gate and a handful of under-specified graph/citation edge cases — none architectural.

### 2. Strengths
- **TDD-first throughout** — every plan opens with a Wave-0 RED test task and pins
  acceptance criteria to named test files.
- **Citation-token protection (D-13)** — `[@key]` → `{{cite_K_M}}` before the smoother
  sees the text, then token equality afterward — a code-enforced invariant, not a
  prompt-engineering hope.
- **Read-only / stateless scheduler (ARCH-20)** — STATE.json-mtime-unchanged is a
  falsifiable guarantee.
- **Serialization of 04-04 after 04-03** to avoid the shared `tier-contract.test.ts`
  write conflict is honest and correct.
- **Per-section state isolation** — `.paper/sections/<N>/` respected end-to-end; compile
  is read-only against section drafts.
- **Threat model per plan** — STRIDE registers with explicit dispositions.

### 3. Concerns by Severity

#### HIGH
- **H-1 — COMP-01 gate may trust the hash instead of re-reading VERIFICATION.md.** Plan
  04-05 step 1 is "recompute hash; mismatch → WARN + re-verify; any
  FABRICATED/MIS-CITED/NOT_FOUND → refuse." Gap: for a non-stale section (hash matches),
  does compile actually open VERIFICATION.md and inspect the verdict, or trust that a
  matching hash implies a clean verdict? If the latter, a section marked `verified` by a
  buggy/older state transition but whose VERIFICATION.md records a FABRICATED finding would
  slip through. **Fix:** compile must ALWAYS read each section's VERIFICATION.md and refuse
  on any blocking verdict, independent of staleness. This is the #1 invariant; it should
  not depend on hash freshness.
- **H-2 — Missing/unplanned dependency is not blocked.** The scheduler skips sections whose
  PLAN.md is absent as INFO, but a *planned* section declaring `depends_on:
  [absent-section]` is not explicitly blocked — it could be scheduled and written against
  an unsatisfied dependency, compiling a draft with an unauthorized hole. **Fix:** any node
  whose dependency is missing/unplanned/failed must transition to `blocked` and never be
  scheduled.

#### MEDIUM
- **M-1 — Token-"set" vs token-"sequence".** A pure set comparison cannot detect
  reordering — if the smoother swaps two adjacent citations, the set is identical but the
  prose now mis-attributes claims. Compare an ordered token sequence (or multiset with
  positions); reconcile the D-13 wording and `smoother-token-protect.test.ts`.
- **M-2 — Bib-collision citekey sync.** When `bib-regen` disambiguates duplicate citekeys
  with base-26 suffixes, the in-text `[@smith2020]` tokens in DRAFT.md must be rewritten to
  match, or the manuscript references keys absent from CITATIONS.bib. Resolution must be
  global and happen before/at concatenation.
- **M-3 — Compile-lock stale timeout unspecified.** `.paper/.compile.lock` needs an
  explicit `stale` value (e.g. 30000ms, matching handoff.ts) so a crashed compile doesn't
  wedge subsequent runs.
- **M-4 — Tier-2 "exactly one WARN" needs a guard.** If the serial-mode warning is emitted
  from a per-wave path it repeats; a `warnedOnce` singleton (or emit-at-start) is needed.
- **M-5 — Absent VERIFICATION.md / missing DRAFT.md at compile is undefined.** A section
  with a non-null hash but a deleted VERIFICATION.md, or a planned-but-never-written
  section reaching compile, has no defined behavior — define refuse-or-auto-verify
  explicitly.

#### LOW
- **L-1 — `parseSectionDirName` has no Phase-4 caller** (Phase-8 insurance; bit-rot risk).
- **L-2 — Consistency-scan heuristics under-specified** (acceptable; flags-only, never
  blocks).
- **L-3 — `remove`-action bracket-delete edge cases** (compound `[@a; @b]`, running-text
  citekeys).
- **L-4 — Smoother placeholder vs literal `{{...}}` prose** (fallback safe but may
  over-reject).

### 4. Suggestions
1. Make the COMP-01 gate unconditionally read VERIFICATION.md per section and refuse on any
   FABRICATED/MIS-CITED/NOT_FOUND — independent of hash staleness (closes H-1).
2. Add an explicit `blocked` state for nodes with missing/unplanned/failed dependencies
   (closes H-2).
3. Change the smoother check from a set to an ordered sequence; reconcile D-13 wording and
   the test name (closes M-1).
4. Rewrite in-text citekeys during bib-collision resolution, globally, pre-smoothing
   (closes M-2).
5. Pin the compile-lock `stale` timeout to match handoff.ts (closes M-3).
6. Add a `warnedOnce` guard for the Tier-2 serial warning (closes M-4).
7. Define absent-VERIFICATION.md / missing-DRAFT.md behavior at compile (closes M-5).

### 5. Risk Assessment
**Overall: MEDIUM.** Architecture is sound, safety mechanisms well-conceived, requirement
traceability excellent. The MEDIUM rating is driven almost entirely by H-1 (the refuse
gate possibly trusting hash freshness rather than re-reading the verdict) and H-2
(missing-dependency not blocked) — both sit directly on the project's core "verifier
blocks compile / no unauthorized holes" invariant. Each is a small, well-scoped code
change with high importance. Everything else is MEDIUM/LOW polish.

---

## Codex Review

**FAILED — not run.** `codex exec --skip-git-repo-check` returned `401 Unauthorized`
("Your refresh token has already been used … Please log out and sign in again"). Skipped
per the continue-on-failure rule. To re-enable: `codex login`, then re-run
`/gsd:review --phase 04 --codex`.

---

## Cursor Review

**FAILED — not run.** `cursor agent -p --mode ask --trust` exited 0 but emitted only
"Run with 'cursor -' to read output from another program" plus Electron warnings — no
review body via the non-interactive `-p` path. Skipped per the continue-on-failure rule.
To re-enable, authenticate the Cursor CLI and re-run with the `cursor -` stdin form.

---

## Consensus Summary

Both substantive reviewers (Gemini, OpenCode) independently judged the five plans strong,
well-decomposed, and faithful to the project's non-negotiables, and **both rated overall
risk MEDIUM.** The wave dependency chain is correct, the 04-03 → 04-04 serialization (to
dodge the shared `tier-contract.test.ts` write conflict) is explicitly praised, and the
D-13 citation-token protection is called the backbone of the design. Residual risk is
concentrated in the **compile refuse-gate completeness** and **dependency-graph /
citation edge-cases** — not the architecture.

### Agreed Strengths (both reviewers)
- TDD-first / Wave-0 RED-first discipline with measurable, test-pinned acceptance criteria.
- D-13 citation-token protection (placeholder substitution before the LLM call + post-call
  token equality) as a code-enforced, not prompt-engineered, invariant.
- Read-only / stateless scheduler (ARCH-20) with a falsifiable STATE.json-mtime test.
- Reuse of existing chokepoints (Semaphore, atomicWriteFile, `.compile.lock`) — flat
  dependency surface.
- Per-section state isolation (`.paper/sections/<N>/`), respected end-to-end.

### Agreed Concerns — highest priority
- **[HIGH] Missing/unplanned-dependency must be blocked (04-01 / 04-03).** Both reviewers
  independently raised this (Gemini 04-03 HIGH; OpenCode H-2): a planned section depending
  on an absent/unplanned/failed section is silently schedulable, risking out-of-order
  execution or a compiled draft with an unauthorized hole. Fix: a node whose dependency is
  missing/unplanned/failed must be `blocked`, never scheduled → reflect in 04-01 and 04-03.
- **[HIGH] COMP-01 refuse-gate completeness (04-05) — OpenCode H-1.** Compile may trust a
  matching `verified_against_draft_hash` and skip re-reading VERIFICATION.md on non-stale
  sections; a bad upstream `verified` despite a FABRICATED/MIS-CITED verdict would slip
  into DRAFT.md. Fix: ALWAYS read `sections/<N>/VERIFICATION.md` per section and refuse on
  any blocking verdict, independent of staleness. OpenCode M-5 adds the adjacent gap:
  absent VERIFICATION.md / missing DRAFT.md at compile is undefined and must be
  refuse-or-auto-verify. This is the project's single most load-bearing non-negotiable.

### Other notable concerns
- **[HIGH (Gemini) / MEDIUM (OpenCode M-2)] Bib-collision citekey sync (04-05).** Base-26
  suffix resolution must rewrite the in-text `[@key]` tokens (global, pre-smoothing) so
  DRAFT.md and the regenerated CITATIONS.bib stay in sync. The two reviewers split on
  severity; both agree it is a correctness bug on any collision — treat as a
  strongly-recommended fix.
- **[HIGH (Gemini)] Reviser citation-placement precision (04-04).** Give `reviser.md`
  strict few-shot instructions so `[@citekey]` stays attached to the claim it supports,
  avoiding MIS-CITED re-loops.
- **[MEDIUM, both] Smoother token-SET vs token-SEQUENCE.** "Set" wording can't detect
  reordering; implement ordered/index-tracked comparison and reconcile the wording.
- **[MEDIUM, Gemini] Wave-override cascade re-validation (04-01).** After applying
  overrides, re-validate the whole graph so all `depends_on` constraints still hold.
- **[MEDIUM, both] Tier-2 "exactly one WARN" once-per-run guard (04-03).** Add `warnedOnce`.
- **[MEDIUM, OpenCode M-3] Compile-lock stale timeout (04-05).** Pin `stale: 30000`.
- **[LOW] Retraction-watch → COMPILE-REPORT aggregation; consistency-scan heuristics;
  remove-action bracket edge cases; placeholder/`{{var}}` collision; `parseSectionDirName`
  bit-rot.**

### Divergent Views
- **Bib-collision severity** — Gemini HIGH vs OpenCode MEDIUM (same fix, different weight);
  adopt the conservative reading (strongly-recommended must-fix for 04-05).
- **Reviser-placement framing** — Gemini calls out reviser citation placement (04-04) as a
  standalone HIGH; OpenCode folds the broader citation-integrity surface into H-1/M-1.
- **Otherwise convergent** — both rate the set MEDIUM and locate residual risk in the
  compile refuse-gate and the missing-dependency graph semantics, not the architecture.

### Cross-Cycle Note
This `--all` re-run reproduced the prior cycle's two load-bearing HIGH findings (compile
refuse-gate completeness + missing/unplanned-dependency blocking) from two independent
models, with no *new* architectural HIGH introduced. The HIGH set is stable across cycles
and remains **unresolved in the plans** (04-05 still describes re-verify-on-staleness
only; 04-01/04-03 still treat a missing PLAN.md as INFO without blocking dependents).
Gemini additionally elevated bib-collision citekey sync (04-05) and reviser
citation-placement (04-04) to HIGH this cycle. Codex (401) and Cursor (no non-interactive
output) again did not produce usable reviews.

### Recommended Action
Plans 04-01 through 04-04 are execution-ready as graph/orchestration scaffolding, but the
load-bearing HIGH items should be folded back via `/gsd:plan-phase 04 --reviews` before
executing the compile capstone:
1. **04-01 / 04-03 (must-fix):** a node whose dependency is missing/unplanned/failed is
   `blocked`, not silently skipped.
2. **04-05 (must-fix):** compile reads `sections/<N>/VERIFICATION.md` for EVERY section
   regardless of staleness and refuses on any blocking verdict before any `.paper/DRAFT.md`
   write; define absent-VERIFICATION.md / missing-DRAFT.md behavior.
3. **04-05 (strongly recommended):** make bib-collision resolution global/pre-smoothing
   (rewrite in-text citekeys); change the smoother check to an ordered token sequence; pin
   the compile-lock `stale` timeout.
4. **04-04:** harden `reviser.md` with strict citation-placement few-shot examples.
5. **04-01:** re-validate the full graph after applying wave overrides.
6. **04-03:** guard the Tier-2 serial WARN to fire exactly once per run.

To incorporate this feedback into planning:
  /gsd:plan-phase 04 --reviews
