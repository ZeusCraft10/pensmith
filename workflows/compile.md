# pensmith compile

> Assemble all verified section drafts into a single `.paper/DRAFT.md` document.
> Requires every section to pass the COMP-01 refuse-gate before any output is written.

<capability_check>
required:
  - Task
  - MCP outline.read

degrade_if_missing:
  - if no Task: run boundary smoothing sequentially in-process (slower, same result)
  - if no MCP outline.read: direct file read of .paper/OUTLINE.md
</capability_check>

## Overview

`pensmith compile` is the phase-wide keystone verb. It acquires a whole-pipeline lock on
`.paper/.compile.lock` (stale: 30 s — auto-clears after a crashed compile), then runs
the compile pipeline: refuse-gate → outline-order concat → cross-section smoothing →
consistency scan → citation density → CITATIONS.bib regen → atomic output writes.

**COMP-01 refuse-gate**: compile reads `sections/<N>/VERIFICATION.md` for **every** section
before writing a single byte to `.paper/DRAFT.md`. Any FABRICATED, MIS-CITED, or
quote-NOT_FOUND verdict causes an immediate refuse, naming the offending section and citekey.
A section whose PLAN.md `state` is not `verified` is also refused. Absent DRAFT.md refuses;
absent VERIFICATION.md (with present DRAFT.md) triggers an automatic Pass-1 + Pass-3
re-verify before the gate is applied. No leaky drafts escape.

**Tier-2 degrade rule**: when `Task` is unavailable, boundary smoothing runs sequentially
inside the current process — identical output, no parallelism. When `MCP outline.read`
is unavailable, `.paper/OUTLINE.md` is read directly from disk.

The implementation lives in `bin/lib/compile.ts` (Phase 4 Plan 05).

## Steps

(see Body below)

## Outputs

- `.paper/DRAFT.md` — assembled document in outline order; all writes atomic (D-07 chokepoint)
- `.paper/COMPILE-REPORT.md` — schema v1 report (D-14 body sections)
- `.paper/CITATIONS.bib` — regenerated from the union of compiled citekeys (D-19 chokepoint)

## Body

1. **Acquire lock**: lock `.paper/.compile.lock` with `proper-lockfile` (stale: 30 s, matches
   handoff.ts pattern). Any concurrent `pensmith compile` invocation waits or times out.

2. **Step 0 — ALWAYS-ON REFUSE GATE (REVIEW H-01/H-02, COMP-01)**:
   For **every** section in the OUTLINE.md (regardless of hash staleness):
   - If `sections/<N>/DRAFT.md` is absent → **REFUSE**, name the section. Stop — write nothing.
   - Require `state === 'verified'` in PLAN.md frontmatter. If `state` is `writing`, `failed`,
     or `unverifiable` → **REFUSE**. Do NOT silently auto-verify those states.
   - If `sections/<N>/VERIFICATION.md` is absent but DRAFT.md is present → run Pass-1 + Pass-3
     auto-verify (deterministic, no LLM), then evaluate its verdict here.
   - Read the VERIFICATION.md (existing or just produced) verdicts. On any FABRICATED,
     MIS-CITED, or NOT_FOUND → **REFUSE**, name section + citekey. Write nothing to `.paper/`.

3. **Step 1 — Staleness check (D-08)**:
   For each section in outline order (ascending `n`):
   - Recompute `computeDraftHash(currentDraftBytes, assigned_sources)`.
   - If `verified_against_draft_hash` in PLAN.md ≠ current hash → WARN and auto-verify with
     **Pass 1 + Pass 3 only** (NEVER Pass 2 or Pass 4 per D-08). On any FABRICATED/MIS-CITED/
     NOT_FOUND from re-verify → **REFUSE**, naming section + citekey. Write nothing.
   - Record staleness resolution events for the `## Compile-Staleness Resolved` report section.

4. **Step 2 — Outline-order concatenation (COMP-02)**:
   Concatenate drafts sorted by `n` ascending (outline order, never wave order). Each section
   draft is normalized to exactly one trailing `\n` before joining with `\n\n` separators.

5. **Step 2.5 — Global citekey collision resolution (REVIEW M-02)**:
   Collect all `[@citekey]` tokens from the concatenated draft. Apply the same base-26 suffix
   resolution as `bibtex-write.ts` across the whole draft (so DRAFT.md citekeys stay in sync
   with the regenerated CITATIONS.bib). Resolution happens BEFORE smoothing.

6. **Step 3 — N-1 boundary smoothing (COMP-03 / D-12 / D-13)**:
   For each adjacent section pair `(k, k+1)`:
   - Substitute `[@citekey]` → `{{cite_K_M}}` placeholder tokens using a run-nonce prefix
     (collision-resistant vs. literal `{{variable}}` in CS/math prose — REVIEW L-04).
   - Call `loadPrompt('smoother')` + `interpolate`. Send the boundary passage to the model.
   - **Post-call ORDERED token-sequence equality** (REVIEW M-01): compare input placeholder
     sequence to output sequence element-by-element (not a Set). Any added, dropped, or
     **reordered** placeholder → reject smoothing for that boundary, keep original prose,
     log a rejection entry in `## Transitions Changed`. Compile never refuses on a smoothing
     rejection.
   - On success: restore tokens → `[@citekey]`, stitch the rewritten paragraphs in.
   - Tier-2 degrade (no `Task`): run each boundary call sequentially in-process.

   After all boundaries:
   - Run `runConsistencyScan` → `## Cross-Section Consistency Flags` (COMP-04, flags only,
     never edits or blocks).
   - Run `computeCitationDensity` → `## Citation Density` (COMP-05, warn-only vs. discipline
     preset target read from `.paper/INTAKE.md`; never blocks).

7. **Step 4 — Output writes (COMP-07 / D-07 / D-19 / ARCH-20)**:
   - Regenerate `.paper/CITATIONS.bib` from the union of compiled citekeys (D-19 bibtex
     chokepoint, base-26 collision suffix, same resolution map as Step 2.5).
   - `atomicWriteFile('.paper/DRAFT.md', compiledText)` — COMP-07, D-07 sole-writer chokepoint.
   - `atomicWriteFile('.paper/COMPILE-REPORT.md', renderCompileReport(input))` — schema v1,
     D-14 body sections in fixed order.
   - Section files (`sections/<N>/DRAFT.md`) are **READ-ONLY throughout** — compile NEVER
     writes to section files (ARCH-20).

8. **Report (COMPILE-REPORT.md, D-14 fixed body section order)**:
   1. `## Transitions Changed` — per-boundary smoothing outcome (accepted / rejected + reason).
   2. `## Cross-Section Consistency Flags` — proper-noun / abbreviation divergences (COMP-04).
   3. `## Citation Density` — per-section cites/1000 words + paper-wide mean/stdev vs. target.
   4. `## Compile-Staleness Resolved` — sections that were stale and re-verified on this run.
   5. `## Advisory Findings` — retraction advisories from freshness probes (Phase 5 populates).

9. **Shell fallback (TIER-06)**: `pensmith compile [--yolo] [--lint-headings]`.
   `--yolo` skips any approval gate; `--lint-headings` enables the heading-tense-drift
   consistency heuristic (off by default).
