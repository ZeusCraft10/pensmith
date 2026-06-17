# pensmith write

> Draft one section. Per-section verb — touches ONLY
> `.paper/sections/<NN>-<slug>/` (TEST-09 section-isolation invariant).
> Drafter input is contract-validated by `assertDrafterInput` (T-3-10).

<capability_check>
required:
  - MCP state.update

optional:
  - MCP scheduler (parallel waves) — bounded-parallel section drafting (Tier 1)

degrade_if_missing:
  - if no MCP tools: direct file writes via atomicWriteFile
  - if no parallel capability (Task / MCP scheduler): invoke
    bin/lib/write-orchestrator.ts in-process and drain waves SERIALLY
    (Semaphore(1)) — same code path, just a concurrency cap of 1
</capability_check>

## Overview

`pensmith write <N>` is the second of the three per-section verbs (plan → **write** → verify).
It is the only verb that produces narrative prose for the paper. The drafter sees a
RESTRICTED VIEW of the library: only the `assigned_sources` citekeys from the section's
PLAN.md, never the full LIBRARY.json (PRD §7.6 — Pitfall 7 chinese-wall).

`pensmith write` with NO section number runs **wave mode** (Plan 04-03): it loads the
outline, builds the dependency wave graph (`bin/lib/scheduler.ts::buildWaveGraph`), and
drains the waves one at a time via `bin/lib/write-orchestrator.ts::runAllSections`, writing
each wave's sections in bounded parallel. Every node routes through the SAME single-section
drafter (so the `assertDrafterInput` WRTE-04 chokepoint runs per section — never bypassed).

The implementation lives in `bin/cli/write.ts` (created by Plan 07). The workflow body
below is the prompt that drives the verb under both Tier 1 and Tier 2.

## Steps

1. (see Body below)

## Outputs

- `.paper/sections/<NN>-<slug>/DRAFT.md` — Markdown body with Pandoc `[@citekey]` citation tokens (D-21)
- `.paper/sections/<NN>-<slug>/PLAN.md` — updated frontmatter (`status: 'writing'` → `status: 'written'`)

## Body

1. **Parse args**: `pensmith write <N>` — `N` is the 1-based section number. Read `.paper/OUTLINE.md` to resolve the slug.

2. **Read inputs**:
   - `<sectionPlan(n, slug)>` → resolves to `.paper/sections/<NN>-<slug>/PLAN.md`. Extract `assigned_sources` citekeys + the `## Brief` body. Returns the section frontmatter for in-place mutation.
   - `.paper/LIBRARY.json` → resolve `assigned_sources` citekeys → `SourceCandidate[]` **RESTRICTED VIEW** (PRD §7.6: drafter sees ONLY assigned sources, not the full library — this is the Chinese-wall isolation).
   - `templates/prompts/section-drafter.md` (D-12 LOCKED slug per Plan 03 CONTEXT D-12) — the drafter prompt template.

3. **Set status to `'writing'`** (D-08-AMENDED LOCKED enum value): update the section's PlanFrontmatter `status: 'writing'` via `bin/lib/frontmatter.ts updateFrontmatter()` (round-trip-safe per D-08 / Plan 03-03 Task 3.4). NOT the old `'drafting'` literal — the D-08-AMENDED locked enum is `'writing'`.

4. **Construct drafter input via `assertDrafterInput`** (`bin/lib/drafter-input.ts` from Plan 07 — T-3-10 / WRTE-04 / WRTE-01):
   - The contract takes EXACTLY `{section_brief, intake, assigned_sources_subset, tone, citation_style}` — nothing more, nothing less.
   - `assertDrafterInput(input)` THROWS on superset (any extra field) or missing fields. This is the trust-boundary check that prevents the drafter from leaking the un-assigned library or PII.

5. **Run drafter**: invoke `templates/prompts/section-drafter.md` (D-12 LOCKED slug) with the validated `assertDrafterInput` payload → returns Markdown body. The body MUST use Pandoc `[@citekey]` citation tokens (D-21 — citation tokens are the only way to reference sources; bare URLs / "according to Smith et al" without a token are not citations).

6. **Write `<sectionDraft(n, slug)>`** = `.paper/sections/<NN>-<slug>/DRAFT.md` via `bin/lib/atomic-write.ts` (D-07 chokepoint).

7. **Update PlanFrontmatter**: `status: 'written'` (D-08-AMENDED LOCKED enum value — NOT old `'drafted'`); `verified_against_draft_hash: sha256(DRAFT.md)`. The hash MUST be recomputed by the verify verb on every run; if the drafter is re-invoked (re-write), the hash will change, automatically invalidating the prior verification — this is the cycle-break for the verify ↔ write loop (D-08-AMENDED).

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
