---
phase: 9
cycle: 1
reviewers: [codex, claude, opencode]
reviewers_unavailable: [gemini]
date: 2026-06-20
quorum: 3/4 (gemini IneligibleTierError — unavailable this cycle)
current_high: 3
---

# Phase 9 Plan Review — Cycle 1

Audited: `09-00..09-03 PLAN.md` (educator/tutorial mode + PII polish) against the 3 success criteria and the CLAUDE.md non-negotiables.

Reviewers run: **codex**, **claude**, **opencode** (quorum reached). **gemini** failed with `IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals` — unavailable this cycle (consistent with prior cycles).

Raw HIGH counts as reported: codex=5, claude=3, opencode=3. After judging (dedup + severity correction), the converged count is **3 HIGH**.

---

## Synthesized Findings

### HIGH (genuine success-criterion failure or non-negotiable violation)

**[HIGH] H1 — `bin/lib/router.ts` reads `goal` and branches on it, violating "Foundation never reads `goal`" / SC-2; the plan then weakens the invariant test to permit it.**
*Agreement: ALL THREE reviewers (codex, claude, opencode) — strongest signal of the cycle.*
09-03 Task 2 adds `readGoalBestEffort(paperRoot)` (reads `[project] goal` from config.toml) plus a `goal === 'learning'` routing branch inside `bin/lib/router.ts`, then instructs updating `tests/lint-tutorial-no-branch.test.ts` to exclude `router.ts`. The CLAUDE.md non-negotiable is absolute: Foundation libs are `bin/lib/*` and "Foundation never reads `goal`"; SC-2 forbids `goal===` branches in `bin/lib/*`. `router.ts` is literally `bin/lib/router.ts`. The plan self-authorizes an exception to the exact invariant enforcing SC-2, and the proposed `const LEARNING = 'learning'` dodge is explicitly designed to evade the lint regex — making the bypass worse, not better. Once router.ts is excluded, the invariant can no longer catch future goal branches elsewhere in the router.
**Fix direction:** Keep the hard-stop decision in the goal-aware CLI/router *caller* (the verb entrypoint that already reads config), and have `resolveNextAction` accept the goal as an injected parameter (DI), so `router.ts` stays goal-unaware and the lint exclusion is unnecessary. If routing genuinely must own the decision, get explicit sign-off redefining "Foundation" to exclude the routing seam, and make the lint exclusion an *empty, named* mechanism present from 09-00 (see H-related M3) rather than a retroactive carve-out.

**[HIGH] H2 — The `goal=learning` hard-stop (09-03) prevents the per-claim provenance that 09-02 is built to emit → SC-1 unmet for learning mode.**
*Agreement: ALL THREE reviewers.*
SC-1 requires `goal=learning` to produce "annotated source provenance **per claim**." But 09-02's per-claim provenance is rendered by `_emitSectionProvenance`, which only fires on `section.written` events emitted from `write-orchestrator.ts` during `pensmith write`. 09-03 Task 2 hard-stops `goal=learning` after RESEARCH.md and before the OUTLINE.md check → no outline, no sections, so `section.written` never fires and the per-claim render never runs. The only reachable event is `research.done` (source-selection rationale), which is not "per-claim." Perverse result: `goal=both` (no hard-stop) is the *only* mode that generates section provenance, while `goal=learning` — the designated tutorial mode — produces none. The two plans are mutually inconsistent.
**Fix direction:** Resolve the contradiction explicitly. Either (a) specify that the learning end-state's "per-claim provenance" is rendered at the `research.done` stage from the curated sources + outline-intent (and define that payload/render + a test asserting per-claim granularity), or (b) revisit whether learning mode runs a lightweight claim-mapping pass before stopping. The plan must pin which event satisfies "per claim" for learning and test it.

**[HIGH] H3 — PII plan guarantees source *ordering* but never specifies the model receives the *redacted* text → SC-3 / T-09-PII-EGRESS not actually proven.**
*Agreement: codex + claude (HIGH); opencode (MEDIUM, "structural not execution-path") — upgraded to HIGH on the security-criterion mapping.*
SC-3 / threat T-09-PII-EGRESS requires redaction "BEFORE any LLM call." The plan's sole structural guarantee is `intake-pii-ordering.test.ts`'s grep `diffPiiIdx < loadPromptIdx`. But `loadPrompt('intake-clarifier')` only loads a pensmith-controlled template from disk; the actual model egress happens later when the user's answers are composed into the request. The plan computes `redacted`, writes it to INTAKE.md and raw to INTAKE.raw.local — but never states that the variable subsequently passed to the model is `redacted`. A downstream agent implementing verbatim could pass `rawAnswers` to the model and still satisfy the index grep, leaking PII while every test passes. The ordering grep is necessary-but-insufficient.
**Fix direction:** Add an explicit plan requirement that the LLM-bound payload is the redacted text (not the in-memory raw answers), plus an offline cassette/nock test asserting no raw PII string appears in any captured model/HTTP request — the project already mandates "all network via http.ts; offline cassette tests," so this is the right gate. Also confirm whether the intake clarifier is single-shot or multi-round (see M4).

---

### MEDIUM (real risk; not a direct success-criterion failure)

**[MEDIUM] M1 — Config persistence is best-effort/non-fatal; a malformed config.toml can silently fail to persist `goal=learning`, so the learning end-state never triggers later.** (codex, raised as HIGH — downgraded: requires a malformed-config edge case; happy path persists fine, but silent failure of a goal-bearing write is a real SC-1 robustness gap.) Fix: on persist failure, surface a visible warning AND ensure the selected goal still reaches routing this session (e.g., the verb passes the in-memory goal through rather than relying solely on a possibly-unwritten config).

**[MEDIUM] M2 — The teaching-wrapper prompts are created + SHA-pinned but never invoked.** (claude) 09-00/09-03 create and re-pin `tutorial-section-provenance.md` and `tutorial-research-rationale.md` as the "Tier-1 model-driven render," but 09-02 implements only the Tier-2 deterministic render and never `loadPrompt`s either slug. Combined with H2 (sections never run in learning mode), these are effectively dead artifacts and the LLM-driven "teaching wrapper" portion of the goal is unimplemented. Fix: either wire at least one `loadPrompt('tutorial-*')` call in the Tier-1 path, or document the prompts as intentionally-deferred Tier-1 scaffolding for a later phase.

**[MEDIUM] M3 — `lint-tutorial-no-branch.test.ts` is a non-skip test that "must keep passing," yet 09-03 necessarily breaks it until the router exclusion lands; and that test edit is missing from 09-03 `files_modified`.** (opencode raised the missing-file as HIGH; claude/opencode raised the break-window as MEDIUM — converged to one MEDIUM.) The frontmatter for 09-03 lists only intake.ts/router.ts/prompt-loader.ts/repo-files.test.ts/zero-trace-export.test.ts; the task body's required edit to `lint-tutorial-no-branch.test.ts` is omitted. Fix: add the test to 09-03 `files_modified`, AND pre-build the exclusion mechanism in 09-00 (empty named exclusion set) so router.ts can be added without a green→red→green window mid-phase. (Note: if H1 is fixed via DI, this concern largely dissolves.)

**[MEDIUM] M4 — Intake redaction covers only the first seed/thesis answers; a multi-round clarifier would egress later user-typed answers unredacted.** (claude) SC-3 says redaction runs "BEFORE any LLM call" — a single pre-first-call redaction does not cover an interactive clarifier's follow-up rounds. Fix: state whether the clarifier is single-shot; if multi-round, extend redaction to each round.

**[MEDIUM] M5 — The zero-branch lint regex is too narrow / inconsistently specified across plans, making the invariant bypassable.** (codex + claude.) 09-00 key_links uses `educator_mode|goal.*learning|TutorialSubscriber`; 09-00 Task 2 uses `/(educator_mode|goal\s*===\s*['"]learning|TutorialSubscriber)/`; the literal-quote form is defeated by `goal === LEARNING`, `goal !== 'draft'`, `switch(goal)`, `['learning'].includes(goal)`, or `isLearningGoal(...)`. Fix: pin one authoritative pattern that also catches the const-hoist and helper-extraction forms (or scan for any `goal` read in the forbidden files, not just `=== 'learning'`).

**[MEDIUM] M6 — Workflow-body scan described as `workflows/*.md` (non-recursive).** (claude) If any workflow bodies live in subdirectories, SC-2's "workflow bodies contain ZERO branches" is not enforced over them. Fix: recurse `workflows/**/*.md`.

**[MEDIUM] M7 — `diffPii(original, redacted)` ignores its `redacted` argument.** (codex + claude + opencode.) The reviewable diff (SC-3) is derived solely from `classifyPii(original)` and never validated against what `redactPii` actually produced; a divergence between classify-spans and redact-splice would go unnoticed. Fix: either drop the param, or assert consistency between the diff and the redacted output.

**[MEDIUM] M8 — Router hard-stop reuses `verb:'status', reason:'done'`, which carries paper-complete (export-ready) messaging.** (opencode.) For a learning-mode user who only finished research, "ready to export" is misleading. Fix: distinct `reason:'learning-done'` or suppress the export message in learning mode. (Note: PATTERNS/plan deliberately preferred reusing the terminal to avoid widening RouterDecision — acceptable tradeoff, but the message UX should be addressed.)

**[MEDIUM] M9 — `planPath` (a `.paper/sections/` path) is passed into the subscriber callback, creating latent exposure risk for the "no `.paper/sections/` in TUTORIAL.md" invariant.** (opencode.) The subscriber is told never to render it, but the data is in hand. Fix: omit `planPath` from `SectionWrittenCallback` (the subscriber doesn't need it), or keep the existing test that asserts no `.paper/sections/` content.

---

### LOW (nit / polish)

- **[LOW] L1** — `RE_IP` over-matches invalid octets (`999.999.999.999`) and dotted version strings (`1.2.3.4`). Over-redaction is documented-acceptable (D-49); add a corpus note. (claude)
- **[LOW] L2** — `RE_IBAN_LIKE` also matches non-IBAN uppercase-alnum identifiers (some DOIs/accession IDs/citekeys-with-digits). Acceptable over-redaction; pin a corpus example so it's intentional. (claude)
- **[LOW] L3** — 09-03 Task 3 hash re-pin assumes the two prompt files are byte-identical to their 09-00 form; add a one-line guard that nothing edited them since 09-00. (claude)
- **[LOW] L4** — NAME positive `In Smith` coexists with `In` in the suppression dict; document the "last-token-not-suppressed → kept" rule in the test name so a later cleanup doesn't break the pinned behavior. (codex)
- **[LOW] L5** — `readGoalFromConfig` (write.ts) and `readGoalBestEffort` (router.ts) duplicate identical logic; consider a shared util. (opencode) — Note: if H1 is fixed via DI, these may collapse to one CLI-tier helper.
- **[LOW] L6** — `--pii-redact` arg vs `[project] pii_redaction` config: precedence unspecified; document CLI-arg-wins. (opencode)
- **[LOW] L7** — `readGoalBestEffort` needs `existsSync`; ensure router.ts imports it (caught by typecheck). (opencode)
- **[LOW] L8** — "beyond regex-only" wording is misleading (IP/IBAN are still regex; NAME is a static dict) — fine per the resolved pure-Node decision, but avoid overclaiming in summaries. (codex)

---

### Judge notes (claims downgraded / not carried as HIGH)

- **codex HIGH "TutorialSubscriber in `bin/lib/tutorial.ts` violates 'only in bin/cli/*'"** — NOT a violation. The actual non-negotiable (09-02 truths, RESEARCH, PATTERNS) is that the class *lives in* `bin/lib/tutorial.ts` but is *imported only by* `bin/cli/*`, with `tutorial.ts` explicitly exempted from the lint scan. codex lacked the CLAUDE.md/RESEARCH context. Dropped.
- **codex HIGH "goal=both gets tutorial side effects, conflicts with 'goal=both unchanged'"** — NOT a violation. RESEARCH Pattern 3 (resolved design) states `goal=both` produces TUTORIAL.md *alongside* DRAFT.md; "unchanged" refers to the DRAFT.md/compile/export *bytes*, not suppression of the additive TUTORIAL.md sidecar. The plans are internally consistent with the resolved design. Dropped.
- **codex HIGH "loadPrompt is not necessarily the first LLM call"** — same substance as H3; folded in (not double-counted).
- **codex HIGH "config best-effort silently fails to persist goal"** — real, but downgraded to M1 (edge-case-triggered robustness gap, not wrong-by-construction).
- **opencode HIGH "lint test missing from files_modified"** — real plan bookkeeping bug, downgraded to M3 (trivially fixed at execution; not itself an SC failure or non-negotiable violation).

---

## Per-Reviewer Raw

### codex (HIGH_COUNT: 5)

```
[HIGH] 09-00 Task 2 and 09-02 Task 1 put `TutorialSubscriber` in `bin/lib/tutorial.ts`. This directly violates the non-negotiable that `TutorialSubscriber` lives ONLY in `bin/cli/*`. Excluding `tutorial.ts` from the lint scan does not fix the architectural violation; the plan creates tutorial-mode implementation inside Foundation libs.

[HIGH] 09-02 Task 2 explicitly constructs `TutorialSubscriber` for `goal === 'both'`. The success criteria say `goal=draft` and `goal=both` continue unchanged, while only `goal=learning` triggers tutorial-mode end-state. This plan gives `goal=both` tutorial side effects and even lists "goal=learning|both writes provenance" as acceptance, which conflicts with the stated goal.

[HIGH] 09-03 Task 2 adds `readGoalBestEffort` and a `goal=learning` routing branch in `bin/lib/router.ts`, then weakens `lint-tutorial-no-branch.test.ts` by excluding `router.ts`. The phase non-negotiable says Foundation libs contain zero `goal===` / educator-mode conditional branches, and specifically says Foundation never reads `goal`. `bin/lib/router.ts` is still under `bin/lib/*`, so this is a direct violation, regardless of the comment that router is a "goal-aware routing seam."

[HIGH] 09-03 Task 1 only source-orders `diffPii` before `loadPrompt('intake-clarifier')`, but `loadPrompt` is prompt loading, not necessarily the first LLM/network call. The success criterion is "runs BEFORE any LLM call." The plan needs a structural guarantee against all model/network invocations in intake, not just this one prompt load, otherwise PII could still reach another LLM path first.

[HIGH] 09-03 Task 1 says config persistence is best-effort/non-fatal and malformed `config.toml` "must not break intake." That can silently fail to persist `goal=learning`, causing the router later to default to `draft`; the learning end-state may never trigger. Goal persistence is required for SC-1, so silent failure should not be accepted without a visible hard failure or deterministic fallback that still carries the selected goal.

[MEDIUM] 09-01 Task 1 claims this is "beyond regex-only" but still implements IP/IBAN with regex and NAME handling with a static dictionary. That may satisfy the resolved "pure-Node deterministic dictionary + patterns" decision, but the wording is misleading and may invite overclaiming in summaries or docs.

[MEDIUM] 09-01 Task 2 defines `diffPii(original, redacted)` but ignores `redacted`. That is deterministic, but it does not actually verify the proposed redacted text corresponds to the diff. If intake ever passes a stale or partial redaction, the reviewable diff could misrepresent what will be written.

[MEDIUM] 09-00 Task 3 and 09-03 Task 1 rely on `src.indexOf('diffPii') < src.indexOf("loadPrompt('intake-clarifier')")`. This is brittle: imports, comments, helper names, or dead code can satisfy the test while the live execution order is wrong. For a PII-before-LLM guarantee, the plan should add a runtime/offline test that intercepts the model call boundary and asserts redaction has already occurred.

[MEDIUM] 09-02 Task 1 says `TUTORIAL.md` receives "per-claim annotated provenance," but the deterministic implementation only renders per assigned citekey, e.g. "Why <citekey> was assigned here." There is no plan to extract claims from the section or annotate each claim with source provenance, so the tutorial artifact may fail the "per claim" part of SC-1.

[MEDIUM] 09-00 Task 2's lint regex only catches `goal\s*===\s*['"]learning`, `educator_mode`, and `TutorialSubscriber`. It would miss equivalent branches such as `goal !== 'draft'`, `goal === LEARNING`, `['learning'].includes(goal)`, `switch(goal)`, or `if (isLearningGoal(...))`. The invariant is too narrow for the zero-branch architectural rule.

[MEDIUM] 09-03 Task 2 adds a zero-trace export test asserting exported markdown does not contain the string `pensmith`. That is broader than tutorial exclusion and could fail for legitimate paper content mentioning "pensmith," creating an unrelated false positive.

[LOW] 09-00 Task 1 includes NAME positive `In Smith`, while 09-01's suppression dictionary also includes `In`. The intended rule keeps it because the last token is not suppressed, but this is a counterintuitive fixture and should be documented in the test name to avoid later "cleanup" breaking the pinned behavior.

HIGH_COUNT: 5
```

### claude (HIGH_COUNT: 3)

```
I audited all four plans (09-00 … 09-03) against the three success criteria and the stated non-negotiables. I found 3 HIGH concerns, several MEDIUM, and a few LOW. The most serious is an internal contradiction between the learning hard-stop and the provenance-generation mechanism that threatens SC-1.

## HIGH

[HIGH] 09-03 Task 2 puts goal-reading + a `goal===learning` branch inside `bin/lib/router.ts` (Foundation) and then weakens the invariant test to hide it — violating two non-negotiables. The non-negotiables as written state Foundation libs are `bin/lib/*` and "Foundation never reads `goal`", and SC-2 forbids `goal===` branches in `bin/lib/*`. The plan adds `readGoalBestEffort(paperRoot)` to `bin/lib/router.ts` (which reads `[project] goal` from config.toml) and a `goal === 'learning'` routing branch, then explicitly instructs: "Choose the exclusion-list approach… Update `tests/lint-tutorial-no-branch.test.ts`'s exclusion set to include router.ts." The plan self-authorizes an exception to the exact invariant that enforces SC-2. `router.ts` is literally `bin/lib/router.ts` — by the given definition it IS Foundation, and it is now made to read `goal`. The hard-stop could instead be implemented in the router's CLI caller (the goal-aware tier), keeping `router.ts` goal-unaware and the invariant intact; the plan does not consider that option. The fallback suggestion to write `goal === LEARNING` (a const) specifically to dodge the regex `goal\s*===\s*['"]learning` makes the evasion worse, not better.

[HIGH] SC-1 is not delivered for `goal=learning`: the learning hard-stop (09-03) prevents the section-level provenance that 09-02 is built to emit. SC-1 requires `goal=learning` to produce "annotated source provenance per claim." In 09-02, per-claim provenance is rendered by `_emitSectionProvenance` and only fires on `section.written` events, which are emitted by `onSectionWritten` inside `write-orchestrator.ts` during `pensmith write`. But 09-03 Task 2 hard-stops `goal=learning` after RESEARCH.md and before the OUTLINE.md check → no outline, no sections, so `section.written` never fires and the `tutorial-section-provenance` render never runs. The only event reachable under the hard-stop is `research.done` (source-selection rationale), which is not "per-claim." Note the perverse result: `goal=both` (which does NOT hard-stop) is the only mode that actually generates the section provenance, while `goal=learning` — the designated tutorial mode — produces none. The two plans are mutually inconsistent; as written, the learning end-state lacks the per-claim provenance the success criterion demands.

[HIGH] 09-03 Task 1 guarantees PII *ordering* but not PII *content routing* — the redacted text is written to INTAKE.md, but the plan never specifies that the LLM call consumes the redacted value rather than the in-memory raw answers. SC-3 / threat T-09-PII-EGRESS requires redaction "BEFORE any LLM call." The plan's sole structural guarantee is `intake-pii-ordering.test.ts`'s grep `diffPiiIdx < loadPromptIdx`. But `loadPrompt('intake-clarifier')` only loads a pensmith-controlled template from disk; the actual model egress happens later when the user's answers are composed into the request. The plan computes `redacted`, prints the diff, and writes `redacted`→INTAKE.md / `rawAnswers`→INTAKE.raw.local — but does NOT state that the variable subsequently passed to the model is `redacted`. A downstream agent implementing this verbatim could pass `rawAnswers` to the model and still satisfy the index-ordering grep, leaking PII while every test passes. The ordering test is a necessary-but-insufficient proxy; the plan needs an explicit "the LLM input is the redacted text" requirement and a test asserting the model-bound payload contains no raw PII.

## MEDIUM

[MEDIUM] The teaching-wrapper prompts are created and hash-pinned but never invoked. 09-00/09-03 create and SHA-pin `tutorial-section-provenance.md` and `tutorial-research-rationale.md` as the "Tier-1 model-driven render," but 09-02 implements only the "Tier-2 deterministic render" in the subscriber and never calls `loadPrompt` for either tutorial slug. Combined with the HIGH above (sections never run in learning mode), these prompts are effectively dead artifacts, and the LLM-driven "teaching wrappers" portion of the phase goal is unimplemented.

[MEDIUM] The zero-branch regex is defined inconsistently across the plans, making the invariant bypassable by construction. 09-00 key_links uses `educator_mode|goal.*learning|TutorialSubscriber`; 09-00 Task 2 uses `/(educator_mode|goal\s*===\s*['"]learning|TutorialSubscriber)/`; 09-03 references `goal\s*===\s*['"]learning`. The looser `goal.*learning` would catch comments; the stricter literal-quote form is defeated by `goal === LEARNING` (the const dodge 09-03 itself proposes). The authoritative pattern must be fixed, and it should not be trivially evadable by hoisting the string to a constant.

[MEDIUM] The workflow-body scan appears non-recursive (`workflows/*.md`). 09-00 Task 2 scans `bin/lib/` recursively but describes the workflow scan as "over `workflows/*.md`." If any workflow bodies live in subdirectories, the SC-2 invariant ("workflow bodies contain ZERO `if (educator_mode)` branches") is not actually enforced over them. Recurse `workflows/**/*.md`.

[MEDIUM] Multi-turn clarifier answers are not covered by intake-time redaction. The PII block redacts the seed/thesis answers once before the first `loadPrompt('intake-clarifier')`. If the intake clarifier is interactive (asks follow-ups and sends subsequent user-typed answers to the model), those later answers egress unredacted. SC-3 says redaction runs "BEFORE any LLM call" — a single pre-first-call redaction does not cover a multi-round clarifier. The plans should state whether the clarifier is single-shot, or extend redaction to each round.

[MEDIUM] `diffPii(original, redacted)` ignores its `redacted` argument. 09-01 Task 2 derives the diff solely from `classifyPii(original)` and accepts `redacted` "for API symmetry." This means the "reviewable diff the user reviews" (SC-3) is never validated against what `redactPii` actually produced; a divergence between `classifyPii` spans and `redactPii` splicing would go unnoticed in the diff. Consider either dropping the param or asserting consistency.

## LOW

[LOW] `RE_IP = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g` over-matches invalid octets (`999.999.999.999`) and dotted version strings (`1.2.3.4`). Over-redaction is documented as acceptable (D-49), so this is a nit, but worth a corpus note so legitimate version strings in academic text aren't surprising.

[LOW] `RE_IBAN_LIKE = /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g` will also match non-IBAN uppercase-alnum identifiers (some DOIs, accession IDs, citekeys-with-digits). Again acceptable over-redaction, but the corpus should pin an example so the behavior is intentional, not incidental.

[LOW] 09-03 Task 3 hash re-pin assumes the prompt files are byte-identical to their 09-00 form. If any intervening task touches `tutorial-*.md`, the SHA drifts and the re-pin breaks. A one-line guard ("verify no edits to the two prompt files since 09-00") would harden the lockstep.

Bottom line: The PII-polish path (09-00/09-01) is largely sound on determinism/purity, but the educator-mode architecture has two genuine delivery/architecture failures — the learning hard-stop contradicts the section-only provenance mechanism (SC-1 gap), and router.ts is made to read `goal` with the invariant test weakened to permit it (SC-2 non-negotiable violation) — plus a security spec-gap where the PII ordering test does not actually prove the model receives redacted text (SC-3).

HIGH_COUNT: 3
```

### opencode (HIGH_COUNT: 3)

```
## HIGH Concerns

[HIGH] 09-03 §Task 2 / 09-00 §Task 2: Non-negotiable "Foundation never reads `goal`" is violated by router.ts in `bin/lib/`. The non-negotiable states as an absolute: "Foundation never reads `goal`." Router.ts resides in `bin/lib/` and acquires `readGoalBestEffort` + a `goal === 'learning'` check. The plan's resolution — exclude router.ts from the `lint-tutorial-no-branch` invariant — reclassifies router.ts as "not Foundation" rather than fixing the root cause. The alternative (using a `const LEARNING = 'learning'` module constant so the regex `goal\s*===\s*['"]learning` doesn't match) is raised in the plan but deliberately rejected. This means the invariant test loses its ability to catch future goal branches in ALL of `bin/lib/`, since the exclusion precedent is set. The plan needs explicit sign-off on redefining what "Foundation" means.

[HIGH] 09-03 §Task 2: `tests/lint-tutorial-no-branch.test.ts` is NOT listed in `files_modified` despite the task text saying to update its exclusion set. The plan says "Update tests/lint-tutorial-no-branch.test.ts's exclusion set to include router.ts" but the plan's YAML frontmatter `files_modified` only lists `bin/cli/intake.ts`, `bin/lib/router.ts`, `bin/lib/prompt-loader.ts`, `tests/repo-files.test.ts`, `tests/zero-trace-export.test.ts`. The lint-test exclusion update is a required change for 09-03 to keep the pipeline green. If this is a YAML omission, the file list is wrong. If the exclusion update is forgotten, the zero-branch invariant test will fail after router.ts acquires goal-awareness, blocking the phase.

[HIGH] 09-02 §Task 1 + 09-03 §Task 2: `goal=learning` router hard-stop and provenance completeness contradiction. `goal=learning` with RESEARCH.md routes to `verb:'status', reason:'done'` — no sections are written via the routed pipeline. The per-claim annotated provenance depends on `section.written` events (which render `## Section N` headers with citekeys per 09-02 §Task 1 acceptance criteria). The `research.done` handler is described as "may be thinner." If the research-only TUTORIAL.md contains only a thin source list without per-claim mapping, Success Criterion 1 ("annotated source provenance per claim") is unmet for `goal=learning`. The plan must specify what the `research.done` payload and rendering produce, and verify those satisfy "per-claim" granularity.

## MEDIUM Concerns

[MEDIUM] 09-03 §Task 2: Router hard-stop reuses `verb:'status', reason:'done'` which carries paper-complete messaging. The existing `status/done` terminal displays messages about export-readiness (e.g. "Your paper is ready to export!"). For a learning-mode user who only completed research, this message is misleading. Consider a distinct `reason: 'learning-done'` or suppress the terminal message for learning-mode.

[MEDIUM] 09-02 §Task 2: `planPath` in `onSectionWritten` callback payload creates latent data-exposure risk. The callback passes `planPath` (a `.paper/sections/` filesystem path) to the subscriber. The subscriber is instructed never to render it. If a future modification to tutorial.ts inadvertently includes `planPath` in TUTORIAL.md output, the ".paper/sections/ path string never appears in TUTORIAL.md" invariant (enforced by test) could break. Either omit `planPath` from `SectionWrittenCallback` (the subscriber doesn't use it), or add a comment + test explicitly asserting TUTORIAL.md has no `planPath` content.

[MEDIUM] 09-00 §Task 2: `lint-tutorial-no-branch.test.ts` is designed as non-skip (must pass now AND through Waves 1-2), but 09-03 necessarily breaks it by adding goal-awareness to router.ts. The plan says to modify this test in 09-03 to add the router exclusion. This means a non-skip test that "must keep passing" WILL fail between 09-02 (when it still passes) and 09-03's exclusion update (when it gets fixed). If the git commits for 09-03 are reordered or if only a subset of 09-03 lands, the pipeline breaks. Mitigation: design the 09-00 test with the router exclusion mechanism pre-built (an empty exclusion array in 09-00, router.ts added in 09-03).

[MEDIUM] 09-03 §Task 1: PII ordering source-grep is structural, not execution-path. The test checks `indexOf('diffPii') < indexOf("loadPrompt('intake-clarifier')")` in the source file. This passes even if `diffPii` and `loadPrompt` are in different branches (one unreachable in certain configs). A refactoring that extracts `loadPrompt` into a helper defined ABOVE the PII block but called BELOW it would pass the grep check while violating execution ordering. The plan accepts this as a "structural" invariant but should document it as a best-effort gate, not a provable guarantee.

[MEDIUM] 09-02 §Task 1 + 09-00 §Task 2: Stub imports `./paths.js` but 09-02 implementation uses `node:path`. The stub in 09-00 lists `./paths.js` as an import. The 09-02 full implementation replaces it with `node:path`. If the `paths.js` file is not present or the imports aren't updated atomically, the stub may fail to compile between 09-00 and 09-02. This should be fine since 09-02 replaces the entire file, but the stub won't actually compile until 09-02 lands.

## LOW Concerns

[LOW] 09-03 §Task 2: `readGoalBestEffort` needs `existsSync` from `node:fs`; router.ts may not currently import it. The plan says to use "the existing never-throw discipline (`existsSync` probe + try/catch)". If router.ts doesn't already import `existsSync`, the import must be added. Minor — easily caught by typecheck.

[LOW] 09-02 §Task 2 / 09-03 §Task 2: `readGoalFromConfig` (write.ts) and `readGoalBestEffort` (router.ts) are identical helper logic duplicated. Consider extracting to a shared utility.

[LOW] 09-03 §Task 1: `piiRedact` opt-in uses `--pii-redact` boolean arg AND/OR `[project] pii_redaction` config.toml field. The plan doesn't specify precedence if both are set. CLI arg should win (standard convention) but should be documented.

[LOW] 09-01 §Task 2: `diffPii` signature accepts `(original, redacted)` but only uses `original`. The `redacted` param is documented as "for API symmetry" but callers passing wrong arguments wouldn't get an error. Minor API smell.

HIGH_COUNT: 3
```

### gemini

unavailable this cycle — `IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals` (free-tier `UNSUPPORTED_CLIENT`). Empty output; not counted toward quorum.
