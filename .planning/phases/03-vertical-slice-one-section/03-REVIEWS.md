---
phase: 3
cycle: 3
reviewers: [gemini, codex, claude-in-session]
reviewed_at: 2026-05-21T15:00:00Z
head_at_review: 8a9dd87
plans_reviewed:
  - 03-00-PLAN.md
  - 03-01-PLAN.md
  - 03-02-PLAN.md
  - 03-03-PLAN.md
  - 03-04-PLAN.md
  - 03-05-PLAN.md
  - 03-06-PLAN.md
  - 03-07-PLAN.md
  - 03-08-PLAN.md
  - 03-09-PLAN.md
runtime_skipped: "claude CLI (running inside Claude Code — skipped for independence)"
unavailable_clis: [claude-cli, cursor-agent, qwen, coderabbit, opencode]
opencode_status: "FAILED — opencode 1.1.34 hung on stdin pipe with empty output after >5 min; terminated. Excluded from cycle-3 review."
cursor_status: "UNAVAILABLE — only Cursor IDE GUI installed; cursor-agent CLI not on PATH. Excluded."
cycle3_summary:
  unresolved_high_count: 2
  unresolved_high_ids: ["NEW-H-1 citations.ts Cite export", "NEW-H-2 frontmatter.ts API inconsistency (Plan 03 Task 3.2 vs 3.4)"]
  cycle2_high_status:
    H-1_frontmatter_wave_order: PARTIALLY RESOLVED (worst-case — Codex flags Plan 03 Task 3.2 vs 3.4 API contradiction within same plan)
    H-2_author_shape: PARTIALLY RESOLVED (worst-case — Codex flags fixtures missing D-14 fields and doi:null vs optional-string)
    H-3_handoff_d17_schema: PARTIALLY RESOLVED (worst-case — Codex flags stale pre-replace snippets in Plan 03)
    H-4_pass1_pass3_signature: FULLY RESOLVED (both reviewers agree)
note: |
  Cycle 3 convergence review of cycle-2-amended plans (commit 8a9dd87). Cycle-2 replan
  claimed to fix all 4 HIGHs + 9 MEDIUMs + 3 LOWs from cycle 2. This cycle verifies
  those claims and surfaces new concerns introduced by the cycle-2 amendments.

  Both external reviewers (Gemini, Codex) independently identified citations.ts
  missing-Cite-export as a HIGH compile blocker. Codex additionally surfaces an
  internal Plan 03 API contradiction (Task 3.2 expects updateFrontmatter(path,merge)
  while Task 3.4 defines updateFrontmatter(text,mutator):string).

  Two CYCLE-2 HIGHs (H-2, H-3) were technically addressed at the headline level but
  Codex found residual contradictions (stale snippet text, fixture schema drift)
  worth folding in on the conservative worst-case principle. H-4 is fully closed
  by both reviewers. Estimated cycle-4 close-out: ~1 hour of focused edits.
---

# Cross-AI Plan Review — Phase 3 Cycle 2 (Vertical Slice Through One Section)

## Cycle 2 Context

This is the SECOND review pass on the Phase 3 plans. Cycle 1 (committed 7d70e85, reviewed at 03-REVIEWS.md prior version) surfaced 5 HIGH + ~11 MEDIUM + ~7 LOW concerns spanning 24 distinct findings. The plans were AMENDED in commit b3e6230 (and refinement 3159abc) to address all 24. This cycle re-reviews the amended plans, verifying:

1. Each of the 24 prior findings is truly fixed (not just claimed-fixed)
2. Surfaces any NEW concerns introduced by the amendments (over-fixes, contradictions, dependency-ordering breaks)
3. Applies stricter stop rule — MEDIUM/LOW with real plan gaps must surface, not be smoothed away.

---

## Gemini Review (Cycle 2)

# Phase 3 Implementation Plan Review — Cycle 2

The amended implementation plans for Phase 3 demonstrate strong convergence and address the 24 findings from Cycle 1 with high technical fidelity. The inclusion of Ukkonen banding for Levenshtein performance, deterministic citekey collision handling, and the sophisticated D-09 migration strategy (persisting state into `PLAN.md` before slimming `STATE.json`) significantly reduces architectural risk.

However, the rapid replanning has introduced several **internal contradictions** between plans (specifically regarding schema field names and data shapes) and one **critical dependency break** in the wave ordering.

### Strengths
- **Robust Migration Strategy**: The D-09 implementation (Plan 03) correctly addresses the "two-homes" data loss risk by performing atomic merges into per-section `PLAN.md` files.
- **Algorithm Precision**: Hand-rolled Jaro-Winkler and Ukkonen-banded Levenshtein (Plan 01) preserve zero-dependency discipline while meeting performance requirements.
- **Verification Verdicts**: Clear disambiguation between `PDF_UNAVAILABLE`, `TEXT_UNAVAILABLE`, and `NOT_FOUND` (Plan 06) provides much-needed diagnostic clarity for the user.
- **Safety Gates**: The prompt hash-pin sequencing (sentinels + env gate) and the deterministic-only verify path (no LLM at verify time) are well-guarded.

### Concerns

#### HIGH: Dependency Break (Wave Ordering)
Plan 03 (Wave 2) implements the D-09 migration, which explicitly depends on calling `updateFrontmatter` from `bin/lib/frontmatter.ts`. However, `frontmatter.ts` is not created until Plan 08 (Wave 5). This prevents the migration from being implemented or tested in its assigned wave.
- **Evidence**: Plan 03 Task 3.2 Step 2b vs. Plan 08 Task 8.1.

#### MEDIUM: Internal Schema Contradictions (Authors Shape)
There is a discrepancy in the author list shape across the pipeline. Plan 03/D-14 restored authors to `string[]`, but later plans still use the old object-array shape.
- **Evidence**:
    - **Plan 03 Task 3.1**: `SourceCandidateSchema` uses `authors: z.array(z.string())`.
    - **Plan 04 Task 4.2**: `toCandidate` maps authors to `Array<{ family, given }>`.
    - **Plan 07 Task 7.1**: `DrafterInputSchema` uses `authors: z.array(z.object({ family, given }))`.
    - **Plan 07 Task 7.2**: `pass1.ts` tries to access `claimed.author[0].family`.

#### MEDIUM: Handoff Schema Sync Failure
Plan 08 (Handoff assembler) was not fully updated to match the amended Plan 03 (Handoff schema).
- **Evidence**:
    - **Plan 03 Task 3.1**: Schema uses `schema_version` (number) and `section_pointers`.
    - **Plan 08 Task 8.1**: `assembleHandoff` constructs an object with `schemaVersion` (string) and `pointers`. This will fail validation.

#### MEDIUM: Missing File Implementation (`deep-equal.ts`)
Plan 03 Task 3.2 Step 2d requires `deepEqual` from `bin/lib/deep-equal.ts` for migration idempotency, but this file is never created in any task.

#### LOW: Plan 00 Task Counting
Plan 00 Objective states exactly 7 tasks (0.1 through 0.5), but the frontmatter/body contains 6 tasks. This is minor but indicates a slight lack of final coordination.

### Prior Finding Verification (Gemini)

1.  **D-09 migration** — **FULLY RESOLVED** (Plan 03 Task 3.2) - Logic now persists state to `PLAN.md`.
2.  **Pass 3 verdicts** — **FULLY RESOLVED** (Plan 06 Task 6.2) - `PDF_UNAVAILABLE` etc. implemented.
3.  **Tier-contract green semantics** — **FULLY RESOLVED** (Plan 09 Task 9.1) - Moved end-to-end green to last plan.
4.  **Pass 3 quote extraction** — **FULLY RESOLVED** (Plan 07 Task 7.2) - `quote-extractor.ts` handles block/multi-paragraph/10-word rules.
5.  **Citekey collisions** — **FULLY RESOLVED** (Plan 04 Task 4.4) - Deterministic generator + 'a','b','c' suffixing.
6.  **D-17 HANDOFF schema** — **FULLY RESOLVED** (Plan 03 Task 3.1) - Fields restored (note Plan 08 assembler needs fix).
7.  **D-14 SourceCandidate schema** — **FULLY RESOLVED** (Plan 03 Task 3.1) - Fields restored (note Plan 04/07 implementations need fix).
8.  **First-author surname** — **FULLY RESOLVED** (Plan 01 Task 1.3) - handles particles/initials.
9.  **Cassette refresh** — **FULLY RESOLVED** (Plan 04 Task 4.1 + Plan 09 Task 9.2).
10. **Pass 1 AND-gate field presence** — **FULLY RESOLVED** (Plan 07 Task 7.2) - Explicit sub-gate added.
11. **Slug-vs-directory canonical form** — **FULLY RESOLVED** (Plan 03 Task 3.3).
12. **Prompt hash-pin sequencing** — **FULLY RESOLVED** (Plan 00/07/09).
13. **nock as runtime dependency** — **FULLY RESOLVED** (Plan 04 Task 4.1) - Moved to `dependencies`.
14. **Retraction Watch wiring** — **FULLY RESOLVED** (Plan 06 Task 6.1) - Surfaces at research stderr and outline gate.
15. **Levenshtein performance** — **FULLY RESOLVED** (Plan 01 Task 1.2) - Ukkonen banding required.
16. **Plan 09 retrofit of runPass1/runPass3** — **FULLY RESOLVED** (Moved to Plan 07).
17. **Dormant prompts guard** — **FULLY RESOLVED** (Plan 06 Task 6.2) - Grep gate in place.
18. **Wave 0 red tests** — **FULLY RESOLVED** (Plan 00 Task 0.4) - `it.todo()` used correctly.
19. **"Other" discipline** — **FULLY RESOLVED** (Plan 05 Task 5.3) - Included in `disciplines.json`.
20. **Image-only PDFs** — **FULLY RESOLVED** (Plan 02 + Plan 06) - `TEXT_UNAVAILABLE` verdict logic.
21. **BibTeX @-split fragility** — **FULLY RESOLVED** (Plan 04 Task 4.4) - Citekey-based ordering.
22. **Citation-render CSL pin** — **FULLY RESOLVED** (Plan 05 Task 5.3) - Provenance SHA pinned.
23. **Jaro-Winkler floating point** — **FULLY RESOLVED** (Plan 01 Task 1.2) - Epsilon comparison requirement.
24. **cwd resolution for .paper/** — **FULLY RESOLVED** (Plan 09 Task 9.4).

### Suggestions (Gemini)

1.  **Move Frontmatter Helper**: Move the creation of `bin/lib/frontmatter.ts` from Plan 08 Task 8.1 to **Plan 03 Task 3.1**. This resolves the HIGH-severity dependency cycle.
2.  **Add Deep-Equal**: Add a new task to **Plan 03** (or include in Task 3.1) to create `bin/lib/deep-equal.ts`.
3.  **Sync Author Shapes**:
    - Update **Plan 04 Task 4.2** (`toCandidate` in `crossref.ts` etc.) to map authors to a simple `string[]` instead of objects.
    - Update **Plan 07 Task 7.1** (`DrafterInputSchema`) to expect `assignedSources[].authors` as `z.array(z.string())`.
    - Update **Plan 07 Task 7.2** (`runPass1` implementation) to call `firstAuthorSurname(claimed.authors[0])` instead of using `.family`.
4.  **Sync Handoff Assembler**: Update **Plan 08 Task 8.1** (`assembleHandoff`) to use `schema_version: 1` (number) and `section_pointers` (key name) to match the schema defined in Plan 03.

### Risk Assessment (Gemini)
**MEDIUM**. The core logic is sound and the Cycle 1 findings were robustly addressed in the "Plan" sections. The remaining risks are mostly synchronization errors between plans (naming conventions and author shapes) and a wave-order mistake. Applying the suggestions above will move the project to **LOW** risk and readiness for execution.

---

## Codex Review (Cycle 2)

## Summary

The amendments substantially converged on the major cycle-1 issues: D-09 migration, D-17/D-14 schema restoration, Pass 3 unavailable-state separation, citekey determinism, cassette refresh/no-leak handling, dormant prompt guards, and Plan 09 retrofit concerns are all addressed with concrete files, tests, and code-shape commitments. However, the amended plans also introduce several new consistency and sequencing problems. The biggest remaining risks are dependency-ordering contradictions, stale schema/interface snippets that conflict with later amendments, and tests/plans that still assume helper signatures different from the code they require.

## Strengths

- The plans now include real contract surfaces instead of only decision references: `bin/lib/verify/pass1.ts`, `pass3.ts`, `quote-extractor.ts`, `citekey.ts`, `bibtex-write.ts`, `http-mock.ts`, `migration-d09.test.ts`, `cassette-no-leak.test.ts`, and `verify-verdicts.test.ts`.
- The D-09 migration is no longer data-destructive in intent; it explicitly writes embedded section state into `PLAN.md` frontmatter before slimming `STATE.json`.
- Pass 3 failure modes are now semantically distinct: `PDF_UNAVAILABLE`, `TEXT_UNAVAILABLE`, `NOT_FOUND`, and aggregate `unverifiable`.
- The plans added good structural guardrails: no dormant prompt references, no direct `citation-js`/`pdf-parse` imports, no `@`-split BibTeX ordering, no section-1 smoke path, no raw cassette secrets.
- The "middle section" invariant is repeatedly called out and has grep-based checks.

## Concerns (Codex)

### Prior Findings Verification (Codex)

| # | Finding | Status | Evidence / Concern |
|---|---|---|---|
| 1 | D-09 migration writes embedded section state into `PLAN.md` frontmatter | **PARTIALLY RESOLVED** | Plan 03 Task 3.2 adds the right 4-phase migration and `migration-d09.test.ts`. But Plan 03 depends only on `03-00`, `03-01`; it calls `updateFrontmatter` from Plan 08, which has not landed yet. This is a hard dependency break unless Plan 08 frontmatter helper moves earlier or Plan 03 depends on it. |
| 2 | Pass 3 verdicts distinct from `NOT_FOUND`; D-08 enum; cassettes | **PARTIALLY RESOLVED** | Plan 06/07 define `PDF_UNAVAILABLE`, `TEXT_UNAVAILABLE`, `UNVERIFIABLE`; Plan 03 adds `unverifiable` status. But cassette/test commitments are split and inconsistent: `verify-verdicts.test.ts` is referenced as a Plan 00 sentinel but is not listed in Plan 00 files. |
| 3 | Tier-contract green semantics: Plan 06 static only, Plan 09 real E2E | **PARTIALLY RESOLVED** | Plan 09 explicitly separates `workflow-static.test.ts` from real tier-contract. But Plan 06 still says "Tier-contract tests for intake/research/outline pass" and "tier-contract green for all 6 cases," which contradicts the later non-overlapping contract. |
| 4 | Dedicated quote extractor with block/multi/nested/scare-filter/citation-strip/≥10 words | **PARTIALLY RESOLVED** | Plan 07 adds `bin/lib/quote-extractor.ts` with block, inline, multi-line block, citation-token strip, ≥10 words. Missing: nested quote handling and scare-quote filter are not specified. Inline regex only captures double/smart quotes followed immediately by citekey; single quotes are mentioned but not implemented in snippet. |
| 5 | Citekey collisions deterministic and persisted in SourceCandidate/LIBRARY/BibTeX/DRAFT | **PARTIALLY RESOLVED** | Plan 03 adds `citekey` to `SourceCandidate`; Plan 04 adds `generateCitekey` and collision suffixing in BibTeX. But adapters in Plan 04 Tasks 4.2/4.3 still show candidate mapping without `citekey`, `id`, `last_verified`, `raw`, or D-14 fields. Persistence to `LIBRARY.json` and DRAFT citation generation is asserted but not fully wired in concrete adapter/drafter steps. |
| 6 | D-17 HANDOFF schema restored | **PARTIALLY RESOLVED** | Plan 03 restores D-17 schema. But Plan 08 still uses the old `schemaVersion`, `wave`, `resumePrompt`, `pointers` interface in its `<interfaces>` and code snippets. `assembleHandoff` therefore conflicts with `HandoffSchema` from Plan 03. |
| 7 | D-14 SourceCandidate schema restored | **PARTIALLY RESOLVED** | Plan 03 amendment restores D-14 fields. But Plan 04 adapter snippets and `bibtex-write.ts` tests still use the old `{ authors: [{family,given}], doi: null }` shape, conflicting with D-14 `authors: string[]`, optional `doi`, required `id`, `last_verified`, `citekey`, `raw`. |
| 8 | `firstAuthorSurname()` normalization | **FULLY RESOLVED** | Plan 01 Task 1.3 defines `bin/lib/author-normalize.ts` with particles, comma form, initials, hyphen/diacritic cases and tests. |
| 9 | Cassette refresh: `recordCassettes`, header scrubbing, no-leak test, GH permissions | **PARTIALLY RESOLVED** | Plan 04 adds recorder and sensitive header scrub; Plan 09 adds workflow permissions and no-leak step. But Plan 04 places `http-mock.ts` in `bin/lib`, while Plan 09 text says `tests/_helpers/http-mock.ts`. Also `finalizeRecording` uses `writeFileSync`, conflicting with the project's atomic-write discipline unless explicitly exempted as test cassette tooling. |
| 10 | Pass 1 AND-gate field presence | **FULLY RESOLVED** | Plan 06 adds step 4a; Plan 07 `runPass1` includes empty metadata, retraction, and multi-DOI redirect handling. |
| 11 | Slug-vs-directory canonical form | **FULLY RESOLVED** | Plan 03 Task 3.3 locks bare slug vs `NN-slug` directory basename and forbids reverse parsing. |
| 12 | Prompt hash-pin sequencing | **PARTIALLY RESOLVED** | Sentinel + env gate is a reasonable solution. But Plan 07 says Plan 05 lands sentinels in `EXPECTED_PROMPT_HASHES`, while Plan 05 explicitly does not create `prompt-loader.ts`; Plan 00 sentinel block is in `tests/repo-files.test.ts`. The ownership of sentinels is still muddled. |
| 13 | `nock` runtime dependency or dynamic guard | **FULLY RESOLVED** | Plan 04 chooses Option A: move `nock` to `dependencies`. |
| 14 | Retraction Watch wiring and approval warning | **FULLY RESOLVED** | Plan 06 research and outline bodies add WARN and `RETRACTED` annotation; Plan 07 Pass 1 treats retracted as `MIS-CITED`. |
| 15 | Levenshtein performance | **PARTIALLY RESOLVED** | Plan 01 now requires Ukkonen banding and perf test. However its earlier action snippet still describes sliding-window full DP, and `levenshteinSubstring` is character-based with only whitespace collapse, which does not really address token-normalized OCR split examples. |
| 16 | Plan 09 retrofit of `runPass1/runPass3` moved to Plan 07 | **FULLY RESOLVED** | Plan 07 creates `bin/lib/verify/pass1.ts` and `pass3.ts`; Plan 09 tests import from those modules. |
| 17 | Dormant prompts guard | **FULLY RESOLVED** | Plan 05/06/07 add no-reference grep gates for `pass1-fuzzy-judge` and `pass3-quote-checker` in verify path. |
| 18 | Wave 0 red tests don't fail CI | **FULLY RESOLVED** | Plan 00 uses `test.todo()` and sentinel skips. |
| 19 | "Other" discipline | **FULLY RESOLVED** | Plan 05 adds explicit `other` preset and Plan 06 intake behavior. |
| 20 | Image-only PDFs documented in VERIFICATION/README known issues | **PARTIALLY RESOLVED** | VERIFICATION behavior is specified via `TEXT_UNAVAILABLE` and user-facing copy. README known-issues documentation is not concretely added to any plan/file. |
| 21 | BibTeX `@`-split fragility | **FULLY RESOLVED** | Plan 04 replaces split sorting with pre-render citekey ordering and no post-process split. |
| 22 | CSL pin by commit/SHA before Plan 05 | **FULLY RESOLVED** | Plan 05 pins upstream APA CSL by commit URL and provenance comment. |
| 23 | Jaro-Winkler float tolerance | **FULLY RESOLVED** | Plan 01 requires `Math.abs(...) < 1e-12`. |
| 24 | cwd resolution for `.paper/` | **PARTIALLY RESOLVED** | Plan 09 smoke instructions clarify cwd-relative behavior. But this is only in human-verify instructions; no code/test contract is added to `paths.ts` or CLI tests to enforce cwd-relative `.paper/` resolution. |

### New Concerns (Codex)

**HIGH — Plan 03 depends on Plan 08 code that does not exist yet.**
D-09 migration in Plan 03 requires `bin/lib/frontmatter.ts updateFrontmatter` and possibly `atomicWrite` behavior from Plan 08. Since Plan 03 runs before Plan 08, implementation cannot compile unless a temporary helper is added or the plan order changes.

**HIGH — Handoff schema remains contradictory across Plan 03 and Plan 08.**
Plan 03 correctly restores D-17 fields: `schema_version`, `last_updated`, `current_section`, `phase`, `next_action`, `breadcrumbs`, `section_pointers`. Plan 08 still assembles `{ schemaVersion, phase, wave, resumePrompt, pointers }`. This would fail schema validation.

**HIGH — SourceCandidate shape conflicts across Plan 03, adapters, bibtex writer, drafter input.**
Plan 03 locks `authors: string[]`, required `id`, `last_verified`, `citekey`, `raw`; Plan 04/07 examples still use `authors: [{ family, given }]`, nullable DOI, missing required fields. This undermines D-14 and will produce type/test failures.

**HIGH — `runPass1` / `runPass3` signatures are inconsistent.**
Plan 07 defines `runPass1(draftMd, citationsBibPath)` and `runPass3(draftMd, bibByCitekey)`. Plan 09 known-bad tests call `runPass1(fx)` and `runPass3({ claimedQuote, pdfText })`. Either add fixture-specific helper functions or align tests with real signatures.

**MEDIUM — Plan 07 still names `bin/cli/new.ts` in frontmatter/artifacts despite alias amendment.**
The amendment says canonical file is `bin/cli/intake.ts`, with `new` alias. But `files_modified`, artifact list, and earlier dispatcher text still include `bin/cli/new.ts`. This will confuse implementers and Wave 0 tests that skip on `bin/cli/new.ts`.

**MEDIUM — Several "Plan 00 sentinel" tests are referenced but absent from Plan 00.**
Examples: `tests/author-normalize.test.ts`, `tests/migration-d09.test.ts`, `tests/verify-verdicts.test.ts`, `tests/quote-extractor.test.ts`, `tests/retraction-surface.test.ts`, `tests/cli-aliases.test.ts`, `tests/tier2-placeholder.test.ts`, `tests/prompts-no-pending.test.ts`, `tests/frontmatter-roundtrip.test.ts`. Some later plans create a few, but the Wave 0 contract claims tests exist up front.

**MEDIUM — Tier 2 placeholder strategy may invalidate Phase 3 success criterion 1.**
Plan 07 says Tier 2 LLM-required verbs write placeholders and succeed. ROADMAP SC-1 requires end-to-end in both tiers with equivalent verdicts, citation lists, and structure modulo prose. Placeholder outputs are unlikely to satisfy meaningful equivalence unless tier-contract explicitly accepts placeholders for Phase 3.

**MEDIUM — `writeBibtex` claims citation-js chokepoint but imports `Cite` from `./citations.js`, while Plan 02 does not export `Cite`.**
Plan 02 says `citations.ts` exports exactly `parseBibtex`, `renderApa`. Plan 04 later imports `Cite` from it. Either export a `formatBibtex` helper from `citations.ts` or amend Plan 02 exports.

**MEDIUM — `unverifiable` "does not block compile" conflicts with core value/verifier blocks export.**
Plan 06 says `UNVERIFIABLE` does not block compile, while project core value says verifier blocks compile/export and no unverifiable quote should escape unless explicitly accepted. This needs a locked policy: is `unverifiable` allowed through compile, allowed with warning, or blocking until user approval?

**LOW — Retraction Watch adapter contract ambiguity.**
Plan 04 must-have says retraction-watch has search that throws/returns empty, but tests and D-15 say no `search` export. Later plan says no `export.*search`. Remove the contradictory must-have.

**LOW — Citation style preset count text remains stale.**
Plan 05 success criteria still says "8-discipline disciplines.json" in places after adding `other` as a ninth key. Not fatal, but it will cause acceptance confusion.

**LOW — `recordCassettes()` design is incomplete.**
The function starts recorder and `finalizeRecording()` writes recordings, but no wrapper guarantees finalize on test completion. The adapter tests need explicit lifecycle instructions.

### Suggestions (Codex)

1. Move `bin/lib/frontmatter.ts` and `tests/frontmatter-roundtrip.test.ts` from Plan 08 to Plan 03 before D-09 migration, or make Plan 03 depend on Plan 08 and reorder waves.

2. Replace Plan 08 handoff interface/code with the D-17 schema exactly:
   `schema_version`, `last_updated`, `current_section`, `phase`, `next_action`, `breadcrumbs`, `section_pointers`.

3. Normalize `SourceCandidate` everywhere:
   use `authors: string[]`, required `id`, `last_verified`, `citekey`, `raw`, optional `doi`, `oa_pdf_url`, `retracted`, `retraction_details`. Update adapter snippets, `DrafterInputSchema`, `bibtex-write.ts`, and tests.

4. Add a single explicit verify helper API:
   - `runPass1(draftMd, citationsBibPath)`
   - `runPass1Fixture(fixture)` if needed
   - `runPass3(draftMd, bibByCitekey)`
   - `runPass3Fixture({ claimedQuote, pdfText })` if needed
   Or rewrite Plan 09 tests to call the real signatures.

5. Fix Plan 07 file naming: remove `bin/cli/new.ts`; use `bin/cli/intake.ts`; keep `new` only as dispatcher alias. Update Plan 00 tier-contract skip guards accordingly.

6. Add all referenced sentinel tests to Plan 00 or stop calling them Wave 0 sentinels. The plan should not rely on tests that are never created.

7. Decide and document `unverifiable` policy: blocking, warning-with-approval, or non-blocking. Align PRD/core value, Plan 06, README known issues, and compile/export gate language.

8. Amend Plan 02 `citations.ts` to export a safe BibTeX formatting helper or `Cite` explicitly, so Plan 04 does not break the "exactly two exports" acceptance criterion.

9. Add a concrete cwd-resolution unit/integration test for `.paper/`, not only human smoke instructions.

10. Add README known-issues update for image-only PDFs, as required by prior finding #20.

### Risk Assessment (Codex)
**Overall risk: MEDIUM.** The amendments solve most conceptual gaps, but the plan set is not yet internally consistent enough to execute cleanly. The remaining issues are mostly contract and sequencing problems rather than missing architecture. Fixing Plan 03/08 ordering, D-17/D-14 schema drift, verify helper signatures, and Tier 2 placeholder semantics would likely bring the risk down to LOW.

---

## Claude In-Session Review (Cycle 2)

Performed in the same session as this REVIEWS.md authorship; provides an independent third voice. Read all 10 amended plans (03-00 through 03-09) end-to-end. Note: Claude CLI was skipped for independence (running inside Claude Code), so this is an in-session review using the same prompt as the other reviewers.

### Strengths

- Wave 0 sentinel pattern via `__PENDING_HASH_${slug}__` per-slug literals + env gate `PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1` is a well-engineered solution to the prompt hash-pin sequencing chicken-and-egg.
- Plan 04 cassette no-leak test (`tests/cassette-no-leak.test.ts`) with explicit `SENSITIVE_HEADERS` set + a deliberate failing-fixture test step is genuine defense-in-depth, not theater.
- D-09 migration in Plan 03 is decomposed into 5 explicit sub-steps (2a-2e) with crash-mid-migration idempotency via `_migration_lock`, and 5 distinct test cases in `tests/migration-d09.test.ts`. The most-agreed-on HIGH from cycle 1 is genuinely engineered, not papered over.
- `bin/lib/verify/pass1.ts` and `pass3.ts` as Plan-07-from-inception modules (not Plan-09 retrofit) is the right architectural call and closes OpenCode's cycle-1 retrofit concern.

### Concerns

#### HIGH — Plan 03 → Plan 08 forward dependency on `updateFrontmatter`

Plan 03 Task 3.2 Step 2b explicitly calls `updateFrontmatter` from `bin/lib/frontmatter.ts`. Plan 08 (Wave 5) is where `frontmatter.ts` is created. Plan 03 lives in Wave 2 with `depends_on: ["03-00", "03-01"]` — it cannot import a Wave-5 artifact. This is a hard wave-ordering break. Three reviewers (Gemini, Codex, Claude in-session) independently identified this same issue, giving very high confidence.

**Resolution path**: Move `bin/lib/frontmatter.ts` + `tests/frontmatter-roundtrip.test.ts` from Plan 08 to Plan 03, OR add `03-08` to Plan 03's `depends_on` AND reorder waves so Plan 08 is in Wave 2 alongside Plan 03.

#### HIGH — Schema drift across `SourceCandidate.authors` shape (Plan 03 vs. Plan 04 vs. Plan 07)

Plan 03 amendment locks D-14: `authors: z.array(z.string())`. But Plan 04 adapter snippets still produce `{ family, given }` objects, Plan 07 `DrafterInputSchema` expects object form, and Plan 07 `runPass1` reads `claimed.author[0].family`. The single source of truth is broken across 3 plans, all of which will fail typecheck.

#### HIGH — Handoff schema drift (Plan 03 vs. Plan 08)

Plan 03 Task 3.1 restores D-17 keys: `schema_version` (number), `current_section`, `breadcrumbs`, `section_pointers`. Plan 08 Task 8.1 `assembleHandoff` still uses old keys `schemaVersion` (string), `wave`, `resumePrompt`, `pointers`. `HandoffSchema.parse()` in Plan 08 will reject Plan 08's own output.

#### HIGH — `runPass1` / `runPass3` signature mismatch (Plan 07 vs. Plan 09 tests)

Plan 07 defines:
- `runPass1(draftMd: string, citationsBibPath: string): Promise<Pass1Result[]>`
- `runPass3(draftMd: string, bibByCitekey: Map<string, any>): Promise<Pass3Result[]>`

Plan 09 tests call:
- `runPass1(fx)` where `fx` is a fixture object
- `runPass3({ claimedQuote, pdfText })`

Plan 09 will fail to compile. Either Plan 07 must add fixture-shaped overloads or Plan 09 tests must adapt to the production signatures (e.g., synthesizing a `draftMd` and `bibByCitekey` from each fixture).

#### MEDIUM — `bin/lib/deep-equal.ts` referenced but never created

Plan 03 Task 3.2 Step 2d uses `deepEqual` from `bin/lib/deep-equal.ts` for migration idempotency. The file is mentioned as "OK to introduce here" in the action text but is NOT listed in `files_modified`, has no implementation snippet, and has no test file. Resolution: add to Plan 03 files_modified + task action, or use `node:util.isDeepStrictEqual` from the stdlib (no new file needed).

#### MEDIUM — `bin/cli/new.ts` vs. `bin/cli/intake.ts` inconsistency in Plan 07

Plan 07 amendment says: canonical file is `bin/cli/intake.ts`; `new` is a dispatcher alias. But Plan 07's `files_modified` lists `bin/cli/intake.ts` (post-amendment), the artifact section header says "bin/cli/new.ts", the dispatcher snippet has TWO registrations pointing at `./cli/intake.js` (one keyed `intake`, one keyed `new`) — but earlier in the same plan the artifacts table still has `path: "bin/cli/new.ts"`. Plan 00 tier-contract skip guards reference `bin/cli/new.ts`. Implementation will create both files or be confused.

#### MEDIUM — Plan 02 `citations.ts` export contract vs. Plan 04 `Cite` import

Plan 02 acceptance: "citations.ts exports exactly `parseBibtex`, `renderApa`." Plan 04 Task 4.4 imports `{ Cite }` from `./citations.js`. Plan 02 contract is silently broken by Plan 04. Resolution: amend Plan 02 to export `Cite` (or a wrapper `formatBibtex`), and update the acceptance criterion.

#### MEDIUM — Plan 02 image-only PDF contract contradiction

Plan 02 says: "extractPdfText throws if input is not Buffer/Uint8Array" AND "Image-only PDF detection: result.text.replace(/\s/g, '').length < 50 → WARN log, return empty string, caller marks UNVERIFIABLE". The two are inconsistent: does the function throw or return empty? The image-only branch should NOT throw (caller decides UNVERIFIABLE); the input-type branch SHOULD throw (programmer error). Acceptance criteria need to disambiguate.

#### MEDIUM — Plan 06 acceptance claims tier-contract green; Plan 09 says only Plan 09 is green

Plan 06 Task 6.1 acceptance: "Tier-contract tests for intake/research/outline cases pass." Plan 06 Task 6.2 acceptance: "Tier-contract tests for plan-section/write-section/verify-section pass." Plan 09 Task 9.1 says workflow-static is Plan 06, real tier-contract is Plan 09 only. These are contradictory — Plan 06 cannot make tier-contract pass without the CLI verbs (Plan 07) and the MCP wiring (Plan 07) and the doctor probe (Plan 09).

#### MEDIUM — Plan 04 retraction-watch must-have contradiction

Plan 04 line "Each adapter exports search(query) and fetchById(id), EXCEPT retraction-watch which exports only fetchById (D-15 side-channel)" is correct. But the must_haves further down says "retraction-watch adapter has search() that throws/returns empty deliberately — only fetchById is supported (D-15)" — implying search DOES exist (just deliberately broken). Plan 00 Wave 0 sentinel test asserts `typeof adapter.search === 'undefined'`. Pick one: search export absent, or search export present-but-broken.

#### MEDIUM — `verify-verdicts.test.ts`, `quote-extractor.test.ts`, `retraction-surface.test.ts`, etc. claimed as "Plan 00 Wave 0 sentinels" but not in Plan 00 files_modified

Plans 06, 07 repeatedly say "tests/X.test.ts (Plan 00 Wave 0 sentinel)" but Plan 00's files_modified does not include these. Either Plan 00 needs to add these to its scaffold list, or the references need to be relocated to the plan that actually creates them.

#### MEDIUM — `unverifiable` blocking policy unspecified

Plan 06 Task 6.2 says: "UNVERIFIABLE does not block compile (per PRD §3 — README disclaimer covers this), BUT surfaces in VERIFICATION.md." CLAUDE.md project memory non-negotiable: "Verifier blocks compile and export. No FABRICATED, MIS-CITED, or quote-NOT_FOUND citation ever escapes a section." If UNVERIFIABLE passes through compile silently, a user can ship a paper where an unauditable quote is never seen as risky. Either: (a) UNVERIFIABLE blocks compile too, (b) UNVERIFIABLE compile-passes ONLY if user explicitly approves (gate analogous to `--yolo`), or (c) the non-negotiable is amended. Plan must pick one and document.

#### LOW — `recordCassettes()` lifecycle missing in Plan 04

Plan 04 Task 4.1 amendment adds `recordCassettes()` and `finalizeRecording()` but no test/hook ensures `finalizeRecording` runs at end of every recording session. A flaky test or process kill leaves cassettes un-finalized. Add an `afterEach`/`process.on('beforeExit')` invocation pattern, or document the explicit caller responsibility.

#### LOW — Plan 04 `finalizeRecording` uses `writeFileSync` (not atomic-write)

`writeFileSync(outPath, ...)` violates D-07 (atomic-write chokepoint). Cassettes are tooling, not production state, so maybe exempt — but document the exemption explicitly. Also, current code has no `nock` import for `writeFileSync`; needs explicit import.

#### LOW — Plan 05 description still says "8-discipline" in 3+ places after `other` was added (9 total)

Plan 05 success_criteria #1 still says "8 prompts + apa.csl + 8-discipline disciplines.json", but Plan 05 acceptance_criteria for Task 5.3 says "EXACTLY 9 keys". Pick one count and propagate.

#### LOW — Plan 00 task count vs. objective count mismatch

Plan 00 objective text says "exactly 7 tasks (0.1 through 0.5)"; actual task count is 6 (0.1-0.6). Numbering and count both inconsistent.

#### LOW — README known-issues for image-only PDFs (prior finding #20) not added to any plan file

Finding #20 says: image-only PDFs trigger UNVERIFIABLE verdict — document in README known-issues. This is implemented at the algorithm level (Plan 02 + Plan 06) but no plan task adds README content. The user-facing transparency promise (per CLAUDE.md "Honest framing on detection") is partial.

### Risk Assessment (Claude in-session)

**MEDIUM.** Cycle 2 amendments demonstrably solve cycle-1 conceptual problems (the 24 findings are 15 FULLY resolved + 9 PARTIALLY resolved per my counting). However, the rapid replanning has introduced 4 NEW HIGH concerns and ~7 NEW MEDIUM concerns, almost all of which are contract/sequencing/internal-consistency mismatches across plan boundaries — exactly the failure mode the cycle-2 review was instructed to catch. None of the new HIGH concerns are unfixable; all are mechanical syncs (dependency reorder, schema field rename, signature alignment). Estimated effort to close cycle 3: 1-2 hours focused replanning.

---

## Consensus Summary (Cycle 2)

### Cross-Reviewer Agreement on NEW HIGH Concerns

| # | Concern | Gemini | Codex | Claude | Notes |
|---|---|---|---|---|---|
| H-1 | Plan 03 → Plan 08 frontmatter.ts dependency break | YES | YES | YES | 3/3 reviewers. Highest confidence. |
| H-2 | SourceCandidate authors shape drift across Plan 03/04/07 | YES (MEDIUM) | YES (HIGH) | YES (HIGH) | 3/3 reviewers. Gemini called MEDIUM, others HIGH. |
| H-3 | Handoff schema drift Plan 03 vs Plan 08 | YES (MEDIUM) | YES (HIGH) | YES (HIGH) | 3/3 reviewers. |
| H-4 | runPass1/runPass3 signature mismatch Plan 07 vs Plan 09 | (not flagged) | YES (HIGH) | YES (HIGH) | 2/3 reviewers. Codex caught this; Gemini did not. |

### Cross-Reviewer Agreement on NEW MEDIUM Concerns

| # | Concern | Reviewers |
|---|---|---|
| M-1 | `bin/cli/new.ts` vs `bin/cli/intake.ts` inconsistency in Plan 07 | Codex + Claude |
| M-2 | "Plan 00 Wave 0 sentinel" tests not actually in Plan 00 files_modified | Codex + Claude |
| M-3 | Tier 2 placeholder strategy may invalidate SC-1 | Codex (Claude noted but didn't fully assess) |
| M-4 | `writeBibtex` imports `Cite` from citations.ts but Plan 02 says only `parseBibtex`/`renderApa` exported | Codex + Claude |
| M-5 | `unverifiable` does-not-block-compile conflicts with verifier-blocks-export non-negotiable | Codex + Claude |
| M-6 | `bin/lib/deep-equal.ts` referenced but never created | Gemini + Claude |
| M-7 | Plan 06 acceptance claims tier-contract green for cases Plan 09 says only Plan 09 makes green | Codex + Claude |
| M-8 | Plan 04 retraction-watch contradictory must-have (search-throws vs search-absent) | Claude only |
| M-9 | Plan 02 image-only-PDF: throws-on-input vs returns-empty-on-image-only contract is inconsistent | Claude only |

### Resolution Status of 24 Cycle-1 Findings (Consensus)

Reviewers' resolution counts:
- Gemini: 24/24 FULLY RESOLVED
- Codex: 14/24 FULLY RESOLVED, 10/24 PARTIALLY RESOLVED
- Claude in-session: 15/24 FULLY RESOLVED, 9/24 PARTIALLY RESOLVED

**Consensus (worst-case, conservative):** When any reviewer says PARTIAL, treat as PARTIAL. Per-finding statuses are listed in detail in the final orchestrator response.

### Synthesized Action Items for Cycle 3 Replan

1. **(HIGH)** Move `bin/lib/frontmatter.ts` + `tests/frontmatter-roundtrip.test.ts` from Plan 08 to Plan 03. Update Plan 03 files_modified and Plan 08 must-haves/artifacts.
2. **(HIGH)** Normalize `SourceCandidate.authors` to `z.array(z.string())` everywhere: Plan 03 schema (already done), Plan 04 adapter snippets, Plan 04 bibtex-write fixture data, Plan 07 DrafterInputSchema, Plan 07 runPass1 implementation.
3. **(HIGH)** Sync Plan 08 `assembleHandoff` to D-17: `schema_version: 1`, `section_pointers`, `breadcrumbs`, `current_section`, `last_updated`, `next_action`, `phase`. Remove old keys `schemaVersion`/`wave`/`resumePrompt`/`pointers`.
4. **(HIGH)** Reconcile `runPass1`/`runPass3` signatures across Plan 07 (production) and Plan 09 (tests). Either add `runPass1Fixture(fx)` / `runPass3Fixture({ claimedQuote, pdfText })` shims to Plan 07, or rewrite Plan 09 tests to build a draftMd + bib map from each fixture.
5. **(MEDIUM)** Add `bin/lib/deep-equal.ts` to Plan 03 files_modified with a minimal implementation (or switch to `node:util.isDeepStrictEqual` and remove the deep-equal.ts reference).
6. **(MEDIUM)** Resolve `bin/cli/new.ts` vs `bin/cli/intake.ts` once and for all: pick `intake.ts` as the canonical file, remove all `new.ts` references from files_modified and artifacts in Plans 00/06/07, keep `new` only as a dispatcher alias in REAL_VERB_LOADERS.
7. **(MEDIUM)** Add all "Plan 00 Wave 0 sentinel" tests to Plan 00 files_modified, OR move those test creations to the plans that actually create them. Tests referenced but not created: `tests/migration-d09.test.ts`, `tests/verify-verdicts.test.ts`, `tests/quote-extractor.test.ts`, `tests/retraction-surface.test.ts`, `tests/cli-aliases.test.ts`, `tests/tier2-placeholder.test.ts`, `tests/prompts-no-pending.test.ts`, `tests/frontmatter-roundtrip.test.ts`.
8. **(MEDIUM)** Amend Plan 02 to export `Cite` (or a `formatBibtex` wrapper) from `bin/lib/citations.ts`. Update Plan 02 acceptance criterion. OR amend Plan 04 to delegate BibTeX formatting to a citation-js call inside citations.ts and only consume the formatted string.
9. **(MEDIUM)** Lock `unverifiable` blocking policy explicitly: pick (a) compile-blocks, (b) compile-passes-with-explicit-approval, or (c) compile-passes-with-warning. Document in Plan 06 + ROADMAP + amend CLAUDE.md non-negotiable wording if needed.
10. **(MEDIUM)** Resolve Plan 06 tier-contract acceptance: drop the "tier-contract green" claim from Plan 06, replace with "workflow-static.test.ts green" (the static-invariant suite); ensure only Plan 09 claims real tier-contract green.
11. **(MEDIUM)** Resolve Plan 04 retraction-watch search export: pick "no search export" (D-15) and remove the "search throws/returns empty deliberately" must-have line.
12. **(MEDIUM)** Disambiguate Plan 02 extractPdfText contract: throws on non-Buffer input (programmer error); returns empty string on image-only (caller logic). Add 2 distinct acceptance criteria + 2 test cases.
13. **(LOW)** Plan 05 success criteria: replace "8-discipline" with "9-discipline (8 INTK-03 + other fallback)" consistently.
14. **(LOW)** Plan 00 task count alignment: pick 6 or 7 and update both objective and body text.
15. **(LOW)** Add README known-issues section update task to Plan 09 (or wherever README updates land) covering image-only PDFs → UNVERIFIABLE verdict — closes prior finding #20 honestly.
16. **(LOW)** Document `recordCassettes()` lifecycle + atomic-write exemption explicitly in Plan 04.

### Risk Assessment (Consensus)

**Overall risk for execution: MEDIUM.**

The cycle-2 amendments demonstrably solved the cycle-1 *conceptual* gaps but introduced *mechanical synchronization* errors across plan boundaries. None of the new HIGH concerns are architectural; all are mechanical syncs that one focused replan-phase can close. Estimated cycle-3 close-out work: 1-2 hours.

If cycle 3 fully closes H-1 through H-4 plus M-1 through M-9, Phase 3 is execution-ready at **LOW** risk.

---

# Cycle 3 Review — Convergence Loop Iteration 3

**Reviewed at:** 2026-05-21T15:00:00Z
**HEAD at review:** 8a9dd87 (cycle-2 replan — cross-plan sync H-1..H-4 + MEDIUMs/LOWs, 635 insertions across 9 files)
**Reviewers invoked:** gemini (0.42.0), codex (codex-cli 0.132.0)
**Skipped CLI:** claude (running inside Claude Code — skipped for independence)
**Unavailable CLIs this cycle:** cursor-agent (only Cursor IDE GUI installed, not the cursor-agent CLI); opencode (1.1.34 — hung on stdin pipe with no LLM output after >5 min, terminated); qwen, coderabbit (not installed)

This cycle re-reviews the cycle-2-amended plans. The cycle-2 replan claimed to resolve 4 HIGHs (H-1..H-4) + 9 MEDIUMs + 3 LOWs from the cycle-2 review. Reviewers were asked to (a) verify each cycle-2 fix item is truly fixed, (b) surface NEW concerns introduced by the cycle-2 amendments (esp. the 285-line Plan 08 assembleHandoff rewrite), and (c) apply the stricter stop rule — surface MEDIUM/LOWs that reveal real gaps.

---

## Gemini Review (Cycle 3)

# Phase 3 Cycle 3 Review — Convergence Loop Iteration 3

The Cycle 2 amendments have significantly strengthened the plans, successfully addressing the wave-ordering criticals (H-1) and normalizing the author string format across the entire pipeline (H-2). The D-09 migration is now data-safe and idempotent (Plan 03), and the verification signatures are largely aligned (H-4). However, a few mechanical synchronization errors remain that will block compilation or lead to data loss in the verification loop.

### 1. Cycle-2 HIGH Resolution Verification

*   **H-1: `frontmatter.ts` wave-ordering — FULLY RESOLVED**
    *   `frontmatter.ts` is now created in **Plan 03 Task 3.4** (Wave 2) and consumed by the D-09 migration in Task 3.2. **Plan 08** correctly identifies itself as a consumer rather than a producer (Artifacts list, line 1863).
*   **H-2: `SourceCandidate` author shape propagation — FULLY RESOLVED**
    *   **Plan 03 Task 3.1** (line 1357) locks `authors: z.array(z.string())`.
    *   **Plan 04 Task 4.2** (line 1650) enforces adapters emit `string[]` in `"Family, Given"` format.
    *   **Plan 07 Task 7.1** (line 1883) `DrafterInputSchema` validates the `string[]` shape.
    *   **Plan 07 Task 7.2** (line 1974) `runPass1` normalizes to `string[]` at the boundary and uses `firstAuthorSurname` for comparison.
*   **H-3: `HANDOFF.json` D-17 canonical schema — FULLY RESOLVED**
    *   **Plan 03 Task 3.1** (line 1370) and **Plan 08 Task 8.1** (line 1864) are now in sync on the D-17 canonical shape (`schema_version: 1`, `section_pointers`, `breadcrumbs`). The older `schemaVersion` / `pointers` keys have been removed.
*   **H-4: `runPass1`/`runPass3` signature lock — FULLY RESOLVED**
    *   **Plan 07 Task 7.2** (line 1960, 1990) now exports `runPass1Unit` and `runPass3Unit` specifically for fixture testing.
    *   **Plan 09 Task 9.2** (line 1989, 2000) correctly imports and calls these unit-helpers, matching the fixture data shapes.

### 2. Cycle-2 MEDIUM/LOW Resolution Verification

*   **deep-equal.ts task — FULLY RESOLVED**: Added in **Plan 03 Task 3.5**.
*   **Plan 06 acceptance unit-only — FULLY RESOLVED**: Tasks 6.1/6.2 ACs updated to "unit-green-only" (static invariants).
*   **SENSITIVE_HEADERS centralized — FULLY RESOLVED**: Centralized in `bin/lib/http-mock.ts` per **Plan 04 Task 4.1**.
*   **Dormant-prompts grep extended — FULLY RESOLVED**: Added to **Plan 06 Task 6.2** AC (line 1846).
*   **Citekey collision base-26 — FULLY RESOLVED**: Added to `bin/lib/bibtex-write.ts` in **Plan 04 Task 4.4**.
*   **Canonical `intake.ts` — FULLY RESOLVED**: canonical name used in **Plan 07 Task 7.2** with `new` as alias.
*   **Plan 09 Sentinel replacement — FULLY RESOLVED**: Explicitly handled in **Plan 09 Task 9.3.5**.
*   **Plan 05 "9 keys" sweep — FULLY RESOLVED**: AC for **Task 5.3** (line 1797) updated to "EXACTLY 9 keys".
*   **MIDDLE_SECTION location — FULLY RESOLVED**: Defined inline in `tier-contract.test.ts` (Plan 00 Task 0.4).
*   **Plan 00 task-count — FULLY RESOLVED**: Updated to 6 in Plan 00 Objective.
*   **Stale-lock recovery test — FULLY RESOLVED**: Added to **Plan 08 Task 8.1** AC (line 1883).
*   **Plan 04 adapter BibTeX examples — FULLY RESOLVED**: Snippets updated to `authors: string[]`.

### 3. NEW Concerns Introduced by Cycle-2 Amendments

*   **HIGH: `bin/lib/citations.ts` (Plan 02) missing `Cite` export.**
    *   **Plan 02 Task 2.2** (line 1121) defines artifacts with `exports: ["parseBibtex", "renderApa"]`. However, **Plan 04 Task 4.4** (line 1672) and **Plan 09 Task 9.2** (line 1982) try to import `Cite` from `./citations.js`. Compilation will fail.
    *   **Resolution:** Add `Cite` to the export list in Plan 02 Task 2.2.
*   **MEDIUM: `tests/repo-files.test.ts` sentinel replacement shape mismatch.**
    *   **Plan 00 Task 0.3** (line 1406) scaffolds `PENDING_HASH_PINS` as an **array** of objects and iterates with a loop. **Plan 09 Task 9.3.5** (line 2030) shows the replacement of an **object** map. The replacement instructions in Plan 09 will not work on the file structure created in Plan 00.
    *   **Resolution:** Align Plan 09 Task 9.3.5 replacement snippet with the `Plan 00` array-of-objects structure.
*   **MEDIUM: `writeBibtex` (Plan 04) fails to persist the `retracted` flag.**
    *   **Plan 06 research** flags sources as retracted, but **Plan 04 Task 4.4** `toCsl` (line 1675) does not include the `retracted` flag in its mapping. Since `citation-js` is used to format the BibTeX, the flag is lost. Consequently, the verifier in **Plan 07 Task 7.2** (line 1983) will find `claimed.retracted` is always undefined, defeating the D-15 requirement.
    *   **Resolution:** Update `Plan 04 Task 4.4` to persist the `retracted` flag (e.g., via the `note` field or a custom CSL field that maps to BibTeX).
*   **MEDIUM: `Plan 07` `runPass1Unit` crashes on null `input.actual`.**
    *   In **Task 7.2** (line 2011), the code checks `if (!input.actual)` but then immediately attempts to read `input.actual.authors` on line 2012. This will crash with a TypeError.
    *   **Resolution:** Ensure line 2012 uses safe navigation: `input.actual?.authors[0]`.

### 4. Remaining Concerns Worth Folding In

*   **MEDIUM: `CslEntry` interface (Plan 04 Task 4.4) missing `id`.**
    *   The `CslEntry` interface (line 1680) is missing the `id` property, which causes the logic on line 1694 (`csl.id = citekey`) to fail typecheck. This is critical for forcing `citation-js` to use the deterministic citekey.
*   **LOW: `BREADCRUMBS.jsonl` writer is missing.**
    *   **Plan 08 Task 8.2** (line 1916) attempts to read from `.paper/BREADCRUMBS.jsonl`, but no task in Phase 3 (or earlier) appears to write to this file. The breadcrumbs in `HANDOFF.json` will be perpetually empty.
*   **LOW: `Plan 03` `HandoffSchema` enum duplication.**
    *   `Plan 03` Task 3.1 (line 1373) duplicates the `SectionStateSchema` enum literals instead of importing them from `state.ts`. While a cycle is claimed (line 1371), no cycle actually exists between the two schema files.
*   **LOW: `Plan 09` sentinel replacement verification command.**
    *   The `diff` command in **Task 9.3.5** (line 2040) uses `require()` on ESM files, which will fail.

### 5. Risk Assessment — MEDIUM

The transition to Cycle 3 has solved the fundamental architectural and sequencing risks. The remaining issues are purely mechanical (missing exports, interface field mismatches, and logic edge cases). However, because these "mechanical" issues include compilation blockers (`Cite` export, `CslEntry.id`) and a breakage of a core verifier requirement (retraction persistence), the risk remains **MEDIUM** until these specific sync defects are closed. Once aligned, Phase 3 will be ready for high-fidelity execution.


---

## Codex Review (Cycle 3)

**Summary**

The cycle-2 amendments materially improve the plan set and close several prior sync defects, but the plans are not yet execution-ready at LOW risk. The four cycle-2 HIGHs are mostly addressed at the headline level, but two have residual contradictions that would still cause implementer confusion or compile/runtime failure. The largest remaining risks are stale snippets that contradict the replacement text, mismatched helper signatures around `frontmatter.ts`, and lingering cross-plan module/export drift around `citations.ts`, `http-mock.ts`, and atomic-write helper names.

**Cycle-2 HIGH Resolution Verification**

| ID | Status | Evidence |
|---|---|---|
| H-1 frontmatter.ts wave-ordering | **PARTIALLY RESOLVED** | Plan 03 now lists `bin/lib/frontmatter.ts` and `tests/frontmatter-roundtrip.test.ts` in Wave 2 files (`03-03-PLAN.md:16-18`) and Task 3.4 creates it (`03-03-PLAN.md:592-743`). Plan 08 explicitly no longer owns it (`03-08-PLAN.md:11-13`, `242`). However, there is a new signature/IO contradiction: Task 3.2 calls `updateFrontmatter(path, merge)` and says it “internally delegates” atomic write (`03-03-PLAN.md:440-441`), while Task 3.4 defines `updateFrontmatter(text, mutator)` as a pure string transformer with no FS or atomic write (`03-03-PLAN.md:604-605`, `645`). This will break the migration implementation unless reconciled. |
| H-2 SourceCandidate author shape propagation | **FULLY RESOLVED for author shape; broader SourceCandidate shape still risky** | Plan 03 locks `authors: z.array(z.string())` (`03-03-PLAN.md:206`). Plan 04 adapter snippets emit string authors (`03-04-PLAN.md:445-451`) and add grep gates against object authors (`03-04-PLAN.md:455`, `467`). Plan 07 DrafterInput uses `authors: z.array(z.string())` (`03-07-PLAN.md:186-194`) and pass1 normalizes citation-js author objects into `claimedAuthorsD14` before comparing via `firstAuthorSurname` (`03-07-PLAN.md:431-460`). Plan 09 tests import unit helpers with string-array author fixtures (`03-09-PLAN.md:288-322`). Caveat: Plan 04 snippets still omit required D-14 fields like `id`, `last_verified`, `citekey`, `raw`, and use `doi: null` in fixtures despite Plan 03 making `doi` optional string, not nullable (`03-03-PLAN.md:204-215`; `03-04-PLAN.md:658-660`). |
| H-3 HANDOFF D-17 canonical schema | **PARTIALLY RESOLVED** | Plan 08’s `assembleHandoff` rewrite now emits `schema_version: 1`, `last_updated`, `current_section`, `phase`, `next_action`, `breadcrumbs`, `section_pointers` and validates twice (`03-08-PLAN.md:196-218`, `248-250`). That fixes the Plan 08 assembler. But Plan 03 still contains stale old-schema behavior and snippets before the “replace” block: `schemaVersion`, `wave`, `resumePrompt`, `pointers` at `03-03-PLAN.md:160`, `243-256`, and an acceptance criterion for a `6000-byte resumePrompt` at `03-03-PLAN.md:346`. Also Plan 03 must-have still says “except resumePrompt” (`03-03-PLAN.md:37`). These stale lines should be removed, not left as contradictory instructions. |
| H-4 runPass1/runPass3 signature lock | **FULLY RESOLVED** | Plan 07 defines canonical signatures `runPass1(draftMd: string, citationsBibPath: string)` and `runPass3(draftMd: string, bibByCitekey: Map<string, any>)` (`03-07-PLAN.md:414`, `505`) and adds fixture helpers `runPass1Unit` / `runPass3Unit` (`03-07-PLAN.md:549`, `570`). Plan 09 explicitly imports `runPass1Unit` and `runPass3Unit` for known-bad tests and forbids canonical helper calls from those fixture tests (`03-09-PLAN.md:291-322`, `349`). |

**Cycle-2 MEDIUM/LOW Resolution Verification**

| Item | Status | Evidence |
|---|---|---|
| `deep-equal.ts` task | **FULLY RESOLVED** | Plan 03 adds file to frontmatter (`03-03-PLAN.md:17`) and Task 3.5 creates `bin/lib/deep-equal.ts` plus tests (`03-03-PLAN.md:748-807`). |
| Plan 06 acceptance softened to unit-green-only | **FULLY RESOLVED** | Plan 06 explicitly defers tier-contract integration to Plan 09 and only requires `workflow-static` at Plan 06 time (`03-06-PLAN.md:261`, `483`). |
| `SENSITIVE_HEADERS` centralized in Plan 04 | **PARTIALLY RESOLVED** | Plan 04 exports `SENSITIVE_HEADERS` from `bin/lib/http-mock.ts` (`03-04-PLAN.md:306-351`). But Plan 09 still says the scrubber lives in `tests/_helpers/http-mock.ts` (`03-09-PLAN.md:40`, `335`), contradicting Plan 04’s `bin/lib/http-mock.ts` location. |
| Dormant-prompts grep extended to workflows/bin/dist | **FULLY RESOLVED** | Plan 06 adds grep gates for `workflows/`, `bin/`, and `dist/` (`03-06-PLAN.md:485-488`) plus Plan 07 has verify call-site gates (`03-07-PLAN.md:290`, `345`). |
| Citekey collision beyond `z` | **FULLY RESOLVED** | Plan 04 adds base-26 `suffixForCollision` and tests for 26→`z`, 27→`aa`, 53→`ba` (`03-04-PLAN.md:736-769`). |
| Canonical `bin/cli/intake.ts`, alias `new` | **FULLY RESOLVED** | Plan 00 tier-contract uses `verbFile: 'bin/cli/intake.ts'` for `new` alias (`03-00-PLAN.md:694`). Plan 07 files list only `bin/cli/intake.ts` (`03-07-PLAN.md:9`) and declares no `bin/cli/new.ts` is created (`03-07-PLAN.md:363`). |
| Plan 09 Task 9.3.5 sentinel replacement | **FULLY RESOLVED as a plan item** | Dedicated task exists with no-sentinel grep, real SHA replacement, env gate unset, and lock-step updates (`03-09-PLAN.md:412-471`). |
| Plan 05 “8-discipline” prose sweep | **PARTIALLY RESOLVED** | Plan 05 now explains “9 effective keys” (`03-05-PLAN.md:64`, `81`, `463`). But stale task title and done text still say “8-discipline disciplines.json preset” / “8-discipline preset lands” (`03-05-PLAN.md:339`, `420`), and Plan 06 still asks intake body to reference “8 presets” (`03-06-PLAN.md:258`). |
| `MIDDLE_SECTION` constant location | **FULLY RESOLVED** | Plan 00 explicitly inlines `MIDDLE_SECTION = '3'` in tier-contract and documents why it is not exported from runtime modules (`03-00-PLAN.md:689-699`, `822`). |
| Plan 00 task-count 7→6 | **FULLY RESOLVED** | Plan 00 verification says task count is exactly 6 and explains the prior off-by-one (`03-00-PLAN.md:821`). |
| Stale-lock recovery test for `HANDOFF.json.lock` | **FULLY RESOLVED** | Plan 08 Task 8.1 acceptance requires a stale/orphan lock recovery test (`03-08-PLAN.md:253-256`). |
| Plan 04 adapter list sync / BibTeX examples string[] | **PARTIALLY RESOLVED** | Author examples are string arrays (`03-04-PLAN.md:658-660`), and adapter output is string[] (`03-04-PLAN.md:455`). But fixtures still use `doi: null` and omit required `id`, `last_verified`, `citekey`, `raw`, which conflicts with Plan 03 D-14 schema (`03-03-PLAN.md:204-215`). |

**New Concerns Introduced**

**HIGH — `frontmatter.ts` API is internally inconsistent.**  
Task 3.2 needs a disk updater: `updateFrontmatter(path, merge)` plus atomic persistence (`03-03-PLAN.md:440-441`). Task 3.4 defines a pure text transformer `updateFrontmatter(text, mutator): string` and explicitly says callers persist returned text themselves (`03-03-PLAN.md:604-605`). This is a real execution blocker for the D-09 migration.

**HIGH — `citations.ts` / `bibtex-write.ts` export contract still conflicts.**  
Plan 02 says `bin/lib/citations.ts` exports exactly `parseBibtex` and `renderApa` (`03-02-PLAN.md:251`). Plan 04 imports `Cite` from `./citations.js` (`03-04-PLAN.md:585`) and tests import `Cite` from `../bin/lib/citations.js` (`03-04-PLAN.md:645`). Either Plan 02 must export `Cite`, or Plan 04 must use a wrapper function. This was a cycle-2 medium and remains unresolved.

**MEDIUM — `atomicWrite` vs `atomicWriteFile` naming drift.**  
Plan 08 imports and calls `atomicWrite` (`03-08-PLAN.md:180`, `236`). Plan 04 assumes `atomic-write.ts` exports `atomicWriteFile` (`03-04-PLAN.md:167`, `586`, `633`, `747`). Plan 03 migration text also references `atomicWrite` (`03-03-PLAN.md:441`, `486`). The plans need one canonical exported name.

**MEDIUM — Plan 08 still has stale “frontmatter helper” ownership language.**  
Plan 08 objective says it lands “the YAML frontmatter helper” (`03-08-PLAN.md:64`) and output still asks for “handoff.ts + frontmatter.ts LOC” (`03-08-PLAN.md:471`), even though Plan 08 now only consumes frontmatter. Not a code blocker, but it undermines the H-1 fix.

**MEDIUM — `http-mock.ts` location is still split between Plan 04 and Plan 09.**  
Plan 04 creates `bin/lib/http-mock.ts` (`03-04-PLAN.md:16`, `189`). Plan 09 says scrubber implementations live in `tests/_helpers/http-mock.ts` (`03-09-PLAN.md:40`, `335`). This will send implementers to the wrong module.

**MEDIUM — `UNVERIFIABLE` compile policy remains questionable.**  
Plan 06 says `UNVERIFIABLE` “Does NOT block compile” (`03-06-PLAN.md:415`). Phase 3 does not implement compile, so this is forward-looking, but it conflicts with the broader “verifier blocks compile/export” project framing unless a Phase 4/6 approval gate is explicitly named. Fold this into the plan text now to avoid future policy drift.

**MEDIUM — Plan 07 verify status text omits `unverifiable`.**  
Plan 07 initial verify entry says it persists status `'verified' | 'failed'` (`03-07-PLAN.md:343`), while later orchestration text includes `UNVERIFIABLE` aggregation (`03-07-PLAN.md:646`) and Plan 03/06 add `unverifiable`. Update the stale status line.

**Remaining Concerns Worth Folding In**

- Plan 03 Task 3.1 still carries old Handoff and SourceCandidate snippets before “replace this” amendments (`03-03-PLAN.md:160-196`, `243-256`). Remove obsolete snippets entirely. “Replace this” prose is easy to miss during execution.
- Plan 04 `retraction-watch` still has contradictory must-haves: fetchById-only (`03-04-PLAN.md:44`) and “search() that throws/returns empty” (`03-04-PLAN.md:51`).
- Plan 04 recorder lifecycle is still weak: `recordCassettes()` starts recording, `finalizeRecording()` writes files, but there is no guaranteed `finally`/test lifecycle hook around adapter tests. Also `finalizeRecording()` uses `writeFileSync` (`03-04-PLAN.md:338`) without an explicit tooling exemption.
- Plan 04 says cassettes scrub response headers, but the threat model claims request+response headers (`03-09-PLAN.md:580`). The implementation sets `enable_reqheaders_recording: false`, so request headers are not recorded, not scrubbed. Wording should match the mechanism.
- Plan 00 says WN-2 “≤10 files per task” but accepts Task 0.2a touching 13 files (`03-00-PLAN.md:821`). That is a conscious exception, but if WN-2 is supposed to be a rule, either split or explicitly mark it as waived.

**Risk Assessment**

**MEDIUM.** The plan set is much closer and most cycle-2 HIGHs are substantively handled, especially H-2 and H-4. The remaining risk is not conceptual architecture; it is implementability drift from stale snippets and mismatched module contracts. Before execution, I would fold in the `frontmatter.ts` API fix, `citations.ts` export fix, `atomicWrite` naming unification, and `http-mock.ts` location cleanup. Those are small edits, but leaving them would likely cause compile failures or incorrect implementation choices.

---

## Cycle 3 Consensus Summary

### Agreed Cycle-2 HIGH Status

| Cycle-2 HIGH | Gemini | Codex | Consensus (worst-case) |
|---|---|---|---|
| H-1 frontmatter.ts wave-ordering | FULLY RESOLVED | PARTIALLY RESOLVED (Task 3.2 vs 3.4 API contradiction) | **PARTIALLY RESOLVED** |
| H-2 SourceCandidate author shape | FULLY RESOLVED | FULLY RESOLVED for authors; broader D-14 shape risky (fixtures still missing `id`/`last_verified`/`citekey`/`raw`; `doi: null` vs optional-string) | **PARTIALLY RESOLVED** |
| H-3 HANDOFF D-17 canonical schema | FULLY RESOLVED | PARTIALLY RESOLVED (Plan 03 still has stale `schemaVersion`/`wave`/`resumePrompt`/`pointers` snippets pre-replace block) | **PARTIALLY RESOLVED** |
| H-4 runPass1/runPass3 signature lock | FULLY RESOLVED | FULLY RESOLVED | **FULLY RESOLVED** |

Both reviewers agree H-4 is fully closed. The other three HIGHs have residual contradictions that are mechanical (stale snippet text, internal API mismatch within a single plan, fixture-vs-schema drift) — not architectural — but still blocking for clean implementation.

### Agreed Cycle-2 MEDIUM/LOW Status

| Cycle-2 fix item | Consensus | Notes |
|---|---|---|
| deep-equal.ts task (Plan 03 Task 3.5) | FULLY RESOLVED | Both reviewers confirm |
| Plan 06 acceptance softened to unit-green-only | FULLY RESOLVED | Both reviewers confirm |
| SENSITIVE_HEADERS centralized in Plan 04 http-mock.ts | PARTIALLY RESOLVED | Plan 04 exports from `bin/lib/http-mock.ts`, but Plan 09 still says scrubber lives in `tests/_helpers/http-mock.ts` (Codex) |
| Dormant-prompts grep extended (workflows/bin/dist) | FULLY RESOLVED | Both reviewers confirm |
| Citekey collision base-26 (z, 27→aa, 53→ba) | FULLY RESOLVED | Both reviewers confirm |
| Canonical bin/cli/intake.ts (alias new) | FULLY RESOLVED | Both reviewers confirm |
| Plan 09 Task 9.3.5 sentinel replacement | PARTIALLY RESOLVED | Task exists, but Gemini flags shape mismatch — Plan 00 Task 0.3 scaffolds PENDING_HASH_PINS as array-of-objects while Plan 09 Task 9.3.5 replaces an object-map. ALSO `diff`/`require()` issue on ESM. |
| Plan 05 "8-discipline" → "9 keys" prose sweep | PARTIALLY RESOLVED | Stale "8-discipline" still in Plan 05 task title/done text (lines 339, 420) and Plan 06 intake body (line 258) per Codex |
| MIDDLE_SECTION constant inline in tier-contract.test.ts | FULLY RESOLVED | Both reviewers confirm |
| Plan 00 task-count "exactly 7" → "exactly 6" | FULLY RESOLVED | Both reviewers confirm |
| Stale-lock recovery test for HANDOFF.json.lock | FULLY RESOLVED | Both reviewers confirm |
| Plan 04 adapter list sync (BibTeX examples string[]) | PARTIALLY RESOLVED | Author shape is `string[]`, but fixtures still violate D-14 (omit `id`/`last_verified`/`citekey`/`raw`; `doi: null` vs optional-string) per Codex |

### New Cycle-3 Concerns (Introduced by Cycle-2 Amendments)

**HIGH — citations.ts missing Cite export (CROSS-REVIEWER AGREEMENT, Gemini + Codex independently):**
- Plan 02 Task 2.2 (line 1121 / 251) defines `bin/lib/citations.ts` exports as exactly `["parseBibtex", "renderApa"]`.
- Plan 04 Task 4.4 (line 1672) and Plan 09 Task 9.2 (line 1982) both import `Cite` from `./citations.js`.
- Plan 04 tests also import `Cite` from `../bin/lib/citations.js`.
- **Compilation will fail.** Either Plan 02 must export `Cite` (re-export from citation-js) or Plan 04 must use a wrapper.
- This was a cycle-2 medium and remains unresolved per Codex.

**HIGH — frontmatter.ts API internally inconsistent within Plan 03 (Codex):**
- Plan 03 Task 3.2 calls `updateFrontmatter(path, merge)` with "internally delegates atomic write" (lines 440-441).
- Plan 03 Task 3.4 defines `updateFrontmatter(text, mutator): string` as a pure string transformer with no FS/atomic write (lines 604-605, 645).
- **D-09 migration implementation will not compile** until reconciled.

**MEDIUM — atomicWrite vs atomicWriteFile naming drift (Codex):**
- Plan 08 imports/calls `atomicWrite` (lines 180, 236).
- Plan 04 assumes `atomic-write.ts` exports `atomicWriteFile` (lines 167, 586, 633, 747).
- Plan 03 migration text uses `atomicWrite` (lines 441, 486).
- **Must canonicalize one name** before execution.

**MEDIUM — writeBibtex fails to persist retracted flag (Gemini):**
- Plan 04 Task 4.4 `toCsl` (line 1675) doesn't map `retracted` into CSL/BibTeX.
- citation-js drops unknown CSL fields, so `claimed.retracted` is always undefined at verify time.
- **Defeats D-15 retracted-source verification.**

**MEDIUM — CslEntry interface missing `id` property (Gemini):**
- Plan 04 Task 4.4 line 1680 `CslEntry` interface lacks `id`; line 1694 assigns `csl.id = citekey`.
- TypeScript will not compile this assignment.

**MEDIUM — runPass1Unit crashes on null input.actual (Gemini):**
- Plan 07 Task 7.2 line 2011 checks `if (!input.actual)` but immediately reads `input.actual.authors` on line 2012.
- Needs safe navigation `input.actual?.authors[0]`.

**MEDIUM — repo-files.test.ts sentinel replacement shape mismatch (Gemini):**
- Plan 00 Task 0.3 (line 1406) scaffolds `PENDING_HASH_PINS` as array-of-objects.
- Plan 09 Task 9.3.5 (line 2030) replaces an object-map.
- Replacement instructions will not match the scaffolded structure.

**MEDIUM — http-mock.ts location split between plans (Codex):**
- Plan 04 creates `bin/lib/http-mock.ts` (line 16, 189).
- Plan 09 says scrubber implementations live in `tests/_helpers/http-mock.ts` (lines 40, 335).
- Implementers will be sent to the wrong module.

**MEDIUM — Plan 08 stale frontmatter-ownership language (Codex):**
- Plan 08 objective says it lands "the YAML frontmatter helper" (line 64).
- Output asks for "handoff.ts + frontmatter.ts LOC" (line 471).
- Not a code blocker, but undermines the H-1 fix narrative.

**MEDIUM — Plan 03 stale pre-replace snippets (Codex):**
- Plan 03 Task 3.1 still contains old Handoff/SourceCandidate snippets (lines 160-196, 243-256) BEFORE the "replace this" blocks.
- "Must-have" still says "except resumePrompt" (line 37).
- Acceptance still mentions 6000-byte resumePrompt (line 346).
- "Replace this" prose is easy to miss during execution — remove obsolete snippets.

**MEDIUM — UNVERIFIABLE compile policy ambiguity (Codex):**
- Plan 06 says UNVERIFIABLE "Does NOT block compile" (line 415).
- Phase 3 doesn't implement compile, so it's forward-looking, but it conflicts with project framing of "verifier blocks compile/export" unless a Phase 4/6 approval gate is explicitly named.

**MEDIUM — Plan 07 verify status omits unverifiable (Codex):**
- Plan 07 line 343 persists status `'verified' | 'failed'` (no `unverifiable`).
- Plan 07 line 646 aggregates UNVERIFIABLE.
- Plan 03/06 add unverifiable to the schema. Stale line at 343 needs updating.

### LOW Concerns

**LOW — BREADCRUMBS.jsonl writer is missing (Gemini):**
- Plan 08 Task 8.2 line 1916 reads `.paper/BREADCRUMBS.jsonl`.
- No task in Phase 3 (or earlier) writes to it. Breadcrumbs in HANDOFF.json will always be empty.

**LOW — Plan 03 HandoffSchema duplicates SectionStateSchema enum literals (Gemini):**
- Plan 03 Task 3.1 line 1373 duplicates instead of importing from `state.ts`. No actual cycle exists.

**LOW — Plan 09 sentinel verification uses `require()` on ESM (Gemini):**
- Plan 09 Task 9.3.5 line 2040 `diff` command uses `require()`; project is ESM-only. Will fail.

**LOW — Plan 04 retraction-watch contradictory must-haves (Codex):**
- Line 44 says fetchById-only. Line 51 says "search() that throws/returns empty". Resolve to one.

**LOW — Plan 04 recorder lifecycle weak (Codex):**
- `recordCassettes()` + `finalizeRecording()` without guaranteed `finally` hook.
- `finalizeRecording()` uses `writeFileSync` without tooling exemption.

**LOW — Plan 04 cassette scrubbing wording mismatch (Codex):**
- Plan 04 says scrubs response headers; Plan 09 line 580 claims request+response headers.
- Implementation sets `enable_reqheaders_recording: false`, so request headers aren't recorded (not scrubbed).

**LOW — WN-2 "<=10 files per task" rule with Task 0.2a exception (Codex):**
- Plan 00 line 821 accepts 13 files for Task 0.2a. Either split or mark as waived.

### Divergent Views

- **H-1, H-2, H-3 status:** Gemini calls them FULLY RESOLVED; Codex calls them PARTIALLY RESOLVED with specific stale-snippet / fixture-shape / API-contradiction evidence. Codex's read is more conservative and worth honoring on the worst-case principle.
- **citations.ts Cite export:** Gemini flags as NEW HIGH; Codex flags as still-unresolved cycle-2 medium. Same root issue, different framing.

### Risk Assessment (Consensus)

**Overall risk for execution: MEDIUM.**

Both reviewers agree the risk has dropped from "architectural" to "mechanical / cross-plan-sync drift." Remaining blockers are:

1. citations.ts must export `Cite` (or Plan 04 must wrap) — **HIGH, compile blocker**
2. frontmatter.ts API: Plan 03 Task 3.2 vs Task 3.4 contract collision — **HIGH, compile blocker**
3. atomicWrite vs atomicWriteFile naming — **MEDIUM, compile blocker**
4. http-mock.ts location split (bin/lib vs tests/_helpers) — **MEDIUM, implementer misdirection**
5. Plan 03 stale pre-replace snippets — **MEDIUM, implementer confusion**
6. Plan 04 fixture data omits required D-14 fields — **MEDIUM, schema-fixture drift**
7. CslEntry interface missing `id` — **MEDIUM, typecheck fail**
8. runPass1Unit safe-navigation bug — **MEDIUM, runtime crash**
9. writeBibtex doesn't persist retracted flag — **MEDIUM, D-15 verifier defeat**
10. Plan 09 sentinel-replacement shape mismatch with Plan 00 scaffold — **MEDIUM**

If cycle 4 closes the two HIGHs (#1, #2) plus the cross-plan-sync MEDIUMs (#3, #4, #5, #6, #7, #8, #9, #10), Phase 3 will be execution-ready at LOW risk. Estimated cycle-4 close-out work: ~1 hour of focused edits.

### Action Items for Cycle-4 Replan (Priority Order)

1. **(HIGH)** Plan 02 Task 2.2 — add `Cite` (or `formatBibtex` wrapper) to exports of `bin/lib/citations.ts`. Update acceptance criterion.
2. **(HIGH)** Plan 03 Task 3.2 vs 3.4 — reconcile `updateFrontmatter()` API. Either Task 3.4 takes `(path, merge)` + handles atomic write, OR Task 3.2 reads file, calls `updateFrontmatter(text, mutator)`, writes with `atomicWrite`. Pick one.
3. **(MEDIUM)** Canonicalize `atomicWrite` vs `atomicWriteFile` — pick one and use across Plan 03, 04, 08. Update `bin/lib/atomic-write.ts` export contract in whichever plan owns it.
4. **(MEDIUM)** Plan 04 + Plan 09 — pick canonical `http-mock.ts` location (recommend `bin/lib/http-mock.ts`, scrubbers exported from there, tests import from there). Update Plan 09 lines 40, 335.
5. **(MEDIUM)** Plan 03 Task 3.1 — DELETE obsolete pre-replace snippets (lines 160-196, 243-256). Remove "except resumePrompt" line 37. Remove 6000-byte resumePrompt acceptance line 346.
6. **(MEDIUM)** Plan 04 Task 4.4 — `toCsl` must persist `retracted` flag (via CSL `note` or custom field that survives BibTeX roundtrip). Add acceptance test.
7. **(MEDIUM)** Plan 04 Task 4.4 — `CslEntry` interface must include `id?: string` (or appropriate type) so `csl.id = citekey` typechecks.
8. **(MEDIUM)** Plan 07 Task 7.2 — `runPass1Unit` safe-navigation: `input.actual?.authors[0]` or guard return after null check.
9. **(MEDIUM)** Plan 04 fixtures — add `id`, `last_verified`, `citekey`, `raw` to all SourceCandidate fixtures. Change `doi: null` to either omit or `doi: undefined`. Match D-14 schema (Plan 03 line 204-215).
10. **(MEDIUM)** Plan 00 Task 0.3 + Plan 09 Task 9.3.5 — align `PENDING_HASH_PINS` shape (array-of-objects vs object-map). Pick one and update both. Fix `require()` → `import` for ESM diff command (Plan 09 line 2040).
11. **(MEDIUM)** Plan 05 prose sweep — remove all remaining "8-discipline" mentions (Plan 05 lines 339, 420; Plan 06 line 258).
12. **(MEDIUM)** Plan 07 line 343 — add `'unverifiable'` to verify status enum literal.
13. **(MEDIUM)** Plan 06 line 415 — clarify UNVERIFIABLE policy: name the future approval gate phase (e.g., "tracked for Phase 6 approval gate per D-15").
14. **(MEDIUM)** Plan 08 — remove stale frontmatter-ownership language (line 64, line 471).
15. **(LOW)** Plan 08 Task 8.2 — clarify BREADCRUMBS.jsonl is written by hooks (point at SessionStart hook or PreCompact hook). If no writer in Phase 3, mark this as deferred or no-op.
16. **(LOW)** Plan 03 Task 3.1 — import enum literals from `state.ts` instead of duplicating. Remove the false "cycle" claim.
17. **(LOW)** Plan 04 retraction-watch — resolve fetchById-only vs search() contradiction (lines 44 vs 51). Pick fetchById-only and delete the search() line.
18. **(LOW)** Plan 04 recorder lifecycle — add explicit `try/finally` or test-lifecycle hook around `recordCassettes()` → `finalizeRecording()`. Mark `writeFileSync` in finalizeRecording as a tooling exemption.
19. **(LOW)** Plan 04 / Plan 09 — align scrubbing wording: response-only (or enable request header recording first).
20. **(LOW)** Plan 00 — either split Task 0.2a (13 files > WN-2's 10) or explicitly waive WN-2 for it with rationale.
