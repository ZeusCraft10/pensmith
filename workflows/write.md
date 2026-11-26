# pensmith write

> Draft one section. Per-section verb — touches ONLY
> `.paper/sections/<NN>-<slug>/` (TEST-09 section-isolation invariant).
> The drafter's input is checked as it is sent (`renderDrafterPrompt` / `assertDrafterInput`).

<capability_check>
required:
  - MCP state.update

degrade_if_missing:
  - if no MCP tools: direct file writes via atomicWriteFile
  - wave mode — if no parallel capability (Task / MCP scheduler): invoke
    bin/lib/write-orchestrator.ts in-process and drain waves SERIALLY
    (Semaphore(1) === Tier-2 forced --max-parallel 1) — same code path,
    just a concurrency cap of 1
</capability_check>

## Overview

`pensmith write <N>` is the second of the three per-section verbs (plan → **write** → verify).
It is the only verb that produces narrative prose for the paper. The drafter sees a
RESTRICTED VIEW of the library: only the works the section's PLAN.md assigns, from
LIBRARY.json, never the rest of it (PRD §7.6).

`pensmith write` with NO section number runs **wave mode** (Plan 04-03): it loads the
outline, builds the dependency wave graph (`bin/lib/scheduler.ts::buildWaveGraph`), and
drains the waves one at a time via `bin/lib/write-orchestrator.ts::runAllSections`, writing
each wave's sections in bounded parallel. Every node routes through the SAME single-section
drafter (so the drafter-input check runs per section — never bypassed).

The implementation lives in `bin/cli/write.ts` (created by Plan 07). The workflow body
below is the prompt that drives the verb under both Tier 1 and Tier 2.

## Steps

1. (see Body below)

## Outputs

- `.paper/sections/<NN>-<slug>/DRAFT.md` — Markdown body with Pandoc `[@citekey]` citations of the section's own sources only
- `.paper/sections/<NN>-<slug>/PLAN.md` — updated frontmatter (`status: 'writing'` → `status: 'written'`)

## Body

1. **Parse args**: `pensmith write <N>` — `N` is the 1-based section number. Read `.paper/OUTLINE.md` to resolve the slug.

2. **Read inputs**:
   - `<sectionPlan(n, slug)>` → `.paper/sections/<NN>-<slug>/PLAN.md`: its `assigned_sources` and its body (the brief, the voice line, the claims), without the frontmatter.
   - `.paper/OUTLINE.json` → the section's title, purpose, `depends_on` and word target, and the paper's title and thesis.
   - `.paper/LIBRARY.json` → the works `assigned_sources` names: citekey, title, authors, year, venue, abstract (`bin/lib/source-context.ts`). The drafter sees ONLY these, never the rest of the library (PRD §7.6). An assigned key the library lacks is left out with a WARN; when the plan assigns sources and the library holds none of them, the section is not drafted (exit 2, no model call). A section that assigns none is drafted to cite none.

3. **Set status to `'writing'`** in PLAN.md (`updatePlanFrontmatter`), so a draft that fails leaves the section to be written again.

4. **Build the drafter input** (`bin/lib/drafter-input.ts`): `{section, paper, brief, voice, sources}`. `renderDrafterPrompt` checks that exact object (`assertDrafterInput`: no field beyond the schema's, no source the PLAN.md does not assign) and renders `templates/prompts/section-drafter.md` from it alone. The sources go in as JSON inside the untrusted-data fence, stripped of anything that could close it.

5. **Run the drafter** with `SectionDraftSchema` as the answer's JSON Schema: `{draft, gaps}`. `draftProblems` refuses an empty draft, a citation of any key outside the section's sources, a citation typed as text (author-year, DOI, URL) and a bracket that is no citation. A failing answer is sent back once with the problems; if the second fails too, nothing is saved and the verb exits 2. `gaps` (claims the plan asks for that no source supports) stay out of the draft and are printed to stderr for the author.

6. **Write `<sectionDraft(n, slug)>`** = `.paper/sections/<NN>-<slug>/DRAFT.md` via `bin/lib/atomic-write.ts` (D-07 chokepoint).

7. **Update PlanFrontmatter**: `status: 'written'`. verify owns `verified_against_draft_hash`; write leaves it as it is, so after a new draft it no longer matches and compile re-verifies the section.

8. **Section-isolation invariant** (TEST-09): this verb MUST NOT touch any file outside `.paper/sections/<NN>-<slug>/`. The mtime gate enforces.

9. **Wave mode** (`pensmith write` with NO `<N>`): load the outline, build the wave graph,
   and drain `graph.waves` serially — each wave's sections run in bounded parallel under
   `--max-parallel` (default 5). The orchestrator persists NO wave state (ARCH-20 / D-04);
   it only invokes the per-section writer, which performs the existing atomic writes.
   - **Tier 1**: honors `--max-parallel` as given.
   - **Tier 2** (portable CLI): forces `--max-parallel 1` and emits exactly ONE WARN to
     stderr ("Tier 2 runs sections serially; --max-parallel ignored", D-02). The flag is
     parsed, never error'd, so the same invocation works in both tiers.
   - Within-wave failures do NOT cancel siblings; a section whose dependency failed is marked
     `blocked` and skipped, while orthogonal subtrees still complete (D-03).
   - Progress streams as structured JSON lines to stdout (`section_start` / `section_done` /
     `wave_complete`); the WARN and diagnostics go to stderr to keep the MCP stdio frame clean.
   - Approval gates are NOT prompted per section here — wave runs are batched; section-level
     citation approval lives in `--revise` (Plan 04).

10. **Shell fallback** (TIER-06 equivalence path): `pensmith write [<N>] [--max-parallel K] [--yolo]`.
