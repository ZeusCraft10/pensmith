# pensmith plan

> Plan one section's content + sources. Per-section verb — touches ONLY
> `.paper/sections/<NN>-<slug>/` (TEST-09 section-isolation invariant).

<capability_check>
required:
  - MCP state.read
  - MCP library.read

degrade_if_missing:
  - if no MCP tools: direct file reads from .paper/
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

1. **Parse args**: `pensmith plan <N>` — `N` is the 1-based section number. Read `.paper/OUTLINE.md` to resolve the slug for `N`.

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

7. **Shell fallback** (TIER-06 equivalence path): `pensmith plan <N> [--revise] [--yolo]`.
