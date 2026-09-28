# pensmith plan

> Plan one section's content + sources. Per-section verb — touches ONLY
> `.paper/sections/<NN>-<slug>/` (TEST-09 section-isolation invariant).

<capability_check>
required:
  - MCP state.read
  - MCP library.read
  - AskUserQuestion

degrade_if_missing:
  - if no MCP tools: direct file reads from .paper/
  - if no AskUserQuestion: render the --revise citation-swap diff via @clack/prompts in a TTY; in a non-TTY without --yolo, exit code 3 with "use --yolo to auto-accept" (PRD §19 approval gate stays default-on)
</capability_check>

## Overview

`pensmith plan <N>` is the first of the three per-section verbs (plan → write → verify).
It reads the global OUTLINE.md + LIBRARY.json, runs the section-planner prompt, and
writes a single `PLAN.md` inside the target section directory.

**Section-isolation invariant (TEST-09 / ARCH-02 / SC-4 — locked)**: this verb MUST NOT
mutate any file outside `.paper/sections/<NN>-<slug>/`. The `tests/section-isolation.test.ts`
mtime invariant gate enforces this — any cross-section write is a CI-blocking failure.

The implementation lives in `bin/cli/plan.ts` (created by Plan 07).

## Steps

1. (see Body below)

## Outputs

- `.paper/sections/<NN>-<slug>/PLAN.md` — frontmatter (D-08-AMENDED status enum, validated by `PlanFrontmatterSchema`) + `## Brief` body

## Body

1. **Parse args**: `pensmith plan <N>` — `N` is the 1-based section number. Read `.paper/OUTLINE.md` to resolve the slug for `N`. A `N` that is not a number from 1 to 99, a section the outline does not have, or a `--slug` that is not the outline's slug for `N` is a usage error (exit 2) before any model call or write — a paper with an outline never gets a `NN-placeholder` section folder (RUN-09).

2. **Read inputs** (read-only file accesses, no mutation):
   - `.paper/OUTLINE.md` → resolve section `{n, slug, title, depends_on, estimated_word_count, assigned_sources}` for the target N.
   - `.paper/LIBRARY.json` → the deduped `SourceCandidate[]` (full library — the planner has read access to the whole library; the drafter does NOT per PRD §7.6).
   - `templates/prompts/section-planner.md` (D-12 LOCKED slug per Plan 03 CONTEXT D-12) — the planner prompt template.

3. **Run planner**: invoke the section-planner prompt with `{section, library_subset, intake}` interpolation → returns `PlanFrontmatter` YAML + a `## Brief` narrative section.

4. **Validate PlanFrontmatter**: `PlanFrontmatterSchema.parse(yaml)`. The schema refuses self-ref via `depends_on` (D-04) and validates the D-08-AMENDED `status` enum. The initial status MUST be `'planned'` (D-08-AMENDED enum default for a newly-planned section).

5. **Write `<sectionPlan(n, slug)>`** = `.paper/sections/<NN>-<slug>/PLAN.md` via `bin/lib/atomic-write.ts` (D-07 chokepoint):
   - YAML frontmatter (validated) with `status: 'planned'` (D-08-AMENDED LOCKED enum default).
   - `## Brief` section with the planner-authored narrative.
   - Set `verified_against_draft_hash: null` (no draft yet → hash invalidated by definition).

6. **Section-isolation invariant** (TEST-09): this verb MUST NOT touch any file outside `.paper/sections/<NN>-<slug>/`. Use `bin/lib/paths.ts sectionDir(n, slug)` (Plan 03 Wave 2) as the only filesystem-write target. The `tests/section-isolation.test.ts` mtime gate enforces this in CI.

7. **Shell fallback** (TIER-06 equivalence path): `pensmith plan <N> [--revise] [--research <query>] [--yolo]`.

## Revise body (PLAN-02 / D-05 / D-06 — citation repair behind the approval gate)

> **Surface note**: `revise` is NOT a separate UX-02 verb (the locked 16 are
> bijective with `workflows/*.md`). The canonical revise surface is
> `pensmith plan <N> --revise`; both it and the thin `bin/cli/revise.ts`
> CommandDef delegate to the SAME `bin/lib/revise.ts::runRevise` chokepoint
> (D-06 — no divergent Tier-1/Tier-2 path). WRTE-02 is satisfied here.

When invoked with `--revise`, `pensmith plan <N>` repairs ONE
verifier-flagged citation rather than authoring a fresh PLAN.md:

1. **Parse the verdict** — read `<sectionVerification(n, slug)>` and take the
   FIRST `FABRICATED` / `MIS-CITED` / `NOT_FOUND` citation in order of
   appearance (one-at-a-time; re-run until clean).
2. **Load `assigned_sources` + voice hint** from `<sectionPlan(n, slug)>`
   frontmatter and `## Brief` (WRTE-02 per-section voice consume point — the
   voice line is threaded into the swap prompt vars).
3. **Propose a swap** — invoke the hash-pinned `revise-swap` prompt (D-05).
   Parse the strict-JSON response and REJECT it if `action ∉ {swap, remove}`
   or `replacement_citekey ∉ assigned_sources` (T-04-14 — no new citekeys ever
   reach DRAFT.md).
4. **Approval gate (default-on, PRD §19)** — render the before/after citation
   diff and ask via `AskUserQuestion`; degrade to `@clack/prompts` in a TTY.
   `--yolo` skips the gate and auto-loops the SAME path up to 2 retries, then
   writes a `RETRY_EXHAUSTED` verdict to VERIFICATION.md (D-06). A non-TTY
   without `--yolo` exits code 3.
5. **On accept** — `swap` substitutes the flagged `[@k]` (via the Plan 01
   `replaceCitekeys` token locator); `remove` mechanically deletes the bracketed
   citation clause (NO LLM prose rewrite). The patched DRAFT.md is written via
   `bin/lib/atomic-write.ts` and `verified_against_draft_hash` is reset to
   `null` (D-05), so the next `pensmith verify <N>` re-runs from scratch.
6. **`--research <query>`** is not a revise step: it is the section research
   pass below (a `--revise --research` run does the research first, then the
   repair).

## Research body (GRND-17 — `plan <N> --research <query>`)

`pensmith plan <N> --research <query>` (and `revise <N> --research <query>`,
the same function, `bin/lib/section-research.ts`) searches for more sources
for section N and adds the ones the user approves to that section only:

1. **Refuse up front** (registry gate `plan-research`, RUN-28): a run that
   cannot ask (no terminal, no scripted numbered answers) and has no `--yolo`
   exits 3 before any model call, search or write. Section N must have a
   PLAN.md (a stub from the outline, or a planned one); otherwise exit 1.
2. **Queries**: the user's query, and the query joined to the section's title.
   With PII redaction on (the brief's or `[project] pii_redaction`), the query
   is redacted before any search or model request.
3. **The research pass** of `pensmith research` (`workflows/research.md` steps
   4–7): the discipline's adapter plan, dedup, deterministic tiers, the
   `[sources]` policy and the source evaluator (topic = the brief's topic and
   the section title, scope = the query). The per-adapter outcomes are printed.
   Zero hits → the per-adapter reasons, exit 1, nothing written.
4. **Approve** (`plan-research`): the hits are listed with tier, year and the
   evaluator's reason — a work the library already has is marked "already in
   library as <key>", the evaluator's rejections are listed unselected — via
   `AskUserQuestion` in Tier 1 or a multi-select in Tier 2. `--yolo` adds every
   hit the evaluator kept; choosing none exits 3 with nothing changed.
5. **Write**: the retraction cross-check (D-15), then the one library writer
   (`upsertSources`, provenance `plan-research:§<N>`: `.paper/LIBRARY.json`,
   deduped by DOI / identifiers / the version rule, with `.paper/CITATIONS.bib`
   / `.ris` re-rendered). Then ONLY section N's PLAN.md `assigned_sources` gains
   the real library citekeys (under its lock; its `status` and
   `verified_against_draft_hash` are untouched), an entry is appended to
   `sections/<NN>-<slug>/RESEARCH-LOG.md` (queries, per-adapter outcomes,
   added keys, what was not added and why), and the sources block of
   `.paper/RESEARCH.md` is refreshed from LIBRARY.json — the research log and
   the user's notes are kept byte-for-byte. Besides those paper-level library
   files, no file outside section N's folder is touched; no other section's
   files are read for writing (section-as-phase isolation, TEST-09).
