# pensmith compile

> Assemble all VERIFIED section drafts into a single manuscript. The phase
> keystone: it is the citation-integrity chokepoint on the compile path.
>
> **NON-NEGOTIABLE (CLAUDE.md / PRD §14): the verifier BLOCKS compile.** No
> FABRICATED / MIS-CITED / quote-NOT_FOUND citation may escape into
> `.paper/DRAFT.md`. Section files are READ-ONLY the entire run (ARCH-20).

<capability_check>
required:
  - MCP state.read

degrade_if_missing:
  - if no MCP tools: direct file reads from .paper/
  - if no Task (parallel smoothing unavailable): smooth boundaries sequentially in-process
  - if no model transport (Tier 2): skip boundary smoothing entirely (raw concat) — smoothing is best-effort prose and never blocks compile
</capability_check>

## Overview

`pensmith compile` is the milestone-completion verb (intake → research → outline →
for each section { plan → write → verify } → **compile** → done). It composes the
Phase 1-3 chokepoints into one lock-guarded pipeline and produces
`.paper/DRAFT.md` + `.paper/COMPILE-REPORT.md`, regenerating `.paper/CITATIONS.bib`.

The implementation lives in `bin/lib/compile.ts` (`runCompile`); the verb is
`bin/cli/compile.ts` — a thin delegate. Both Tier 1 (plugin) and Tier 2 (CLI)
run the SAME `runCompile`; tier divergence is only the smoother transport.

**LOCKED INVARIANT — compile NEVER invokes Pass 2 (claim support) or Pass 4
(uncited-load).** Those are advisory and ship in Phase 5. The staleness
re-verify path uses the deterministic Pass 1 + Pass 3 ONLY (D-08). Boundary
smoothing operates only on placeholder-masked text — the model never sees raw
`[@citekey]` tokens (D-13).

## Outputs

- `.paper/DRAFT.md` — the compiled manuscript, sections concatenated in OUTLINE
  order (COMP-02), citation tokens preserved for Phase-6 export.
- `.paper/COMPILE-REPORT.md` — schema v1 (D-14): Transitions Changed,
  Cross-Section Consistency Flags, Citation Density, Compile-Staleness Resolved,
  Advisory Findings (empty marker reserved for Phase 5).
- `.paper/CITATIONS.bib` — regenerated from the union of compiled citekeys (D-19).

## Body

> **LOCKED INVARIANT — verifier blocks compile.** A FABRICATED / MIS-CITED /
> quote-NOT_FOUND verdict (fresh in VERIFICATION.md OR surfaced by the staleness
> re-verify) HARD-REFUSES the compile before any `.paper/DRAFT.md` is written.
> Pass 2/4 are NEVER loaded or executed from this body (audit grep enforces).

1. **Acquire the compile lock**: the WHOLE pipeline holds `.paper/.compile.lock`
   (proper-lockfile) so two concurrent compiles never corrupt the outputs.

2. **Load sections in OUTLINE order** (COMP-02 / D-11): parse `.paper/OUTLINE.md`,
   sort by section number ascending. For each section read its `PLAN.md`
   frontmatter (`assigned_sources`, `verified_against_draft_hash`), its
   `DRAFT.md` bytes, and its `VERIFICATION.md`.

3. **Refuse-gate** (COMP-01): scan each `VERIFICATION.md` for a FABRICATED /
   MIS-CITED / quote-NOT_FOUND verdict. Any hit is collected as a refuse reason
   naming the section + citekey.

4. **Staleness re-verify** (COMP-01 / D-08): recompute
   `computeDraftHash(DRAFT.md bytes, assigned_sources)` per section. On a
   mismatch, emit `WARN: section <N> stale — re-verifying` and run the
   deterministic Pass 1 + Pass 3 for that section ONLY (NEVER Pass 2/4). A
   re-verify failure adds a refuse reason; an all-pass records a
   Compile-Staleness-Resolved event.

5. **Refuse if any reason was collected**: do NOT write `.paper/DRAFT.md`. Return
   the refusal naming every offending section + citekey (the verifier-blocks-
   compile invariant).

6. **Concatenate in OUTLINE order** (COMP-02): join the section drafts (each
   normalized to exactly one trailing newline) with a blank line between.

7. **Boundary smoothing** (COMP-03 / D-12 / D-13): for each of the N-1 adjacent
   boundaries, mask `[@key]` → `{{cite_K_M}}` placeholders, hand only the
   `[tail, head]` window to the smoother (Task-parallel in Tier 1; sequential in
   Tier 2; skipped when no model transport), then require the output placeholder
   set to equal the input set. Any drift REJECTS that boundary (keep the original
   prose) and records a Transitions-Changed rejection. Then run the deterministic
   cross-section consistency scan (COMP-04, flags only) and the citation-density
   computation vs. the discipline preset target (COMP-05, warn-only).

8. **Regenerate `.paper/CITATIONS.bib`** (D-19) from the union of compiled
   citekeys via the citation-js chokepoint, then `atomicWriteFile`
   `.paper/DRAFT.md` and `.paper/COMPILE-REPORT.md` (schema v1, D-14). EVERY
   write routes through the D-07 atomic-write chokepoint; section files are never
   written (ARCH-20).

9. **Shell fallback** (TIER-06 equivalence path): `pensmith compile [--yolo]
   [--lintHeadings] [--discipline <preset>]`.
