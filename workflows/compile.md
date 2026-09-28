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
`.paper/DRAFT.md` + `.paper/COMPILE-REPORT.md`. It never rewrites
`.paper/CITATIONS.bib`: that file is the full research library, rendered from
`.paper/LIBRARY.json` by the one library writer (`bin/lib/library.ts`,
BRDTH-01), and citeproc renders only the keys the draft cites.

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
- `.paper/COMPILE-INPUTS.json` — v1 (D-18-39): the compiled sections (ids and
  slugs, in order) and the sha256 of each section's DRAFT.md and VERIFICATION.md
  as compile read them. The router recompiles only when the paper's sections or
  those bytes change — never because a checkout or sync client reordered mtimes.
- `.paper/CITATIONS.bib` is read (staleness re-verify), never written (BRDTH-01).

## Body

> **LOCKED INVARIANT — verifier blocks compile.** A FABRICATED / MIS-CITED /
> quote-NOT_FOUND verdict (fresh in VERIFICATION.md OR surfaced by the staleness
> re-verify) HARD-REFUSES the compile before any `.paper/DRAFT.md` is written.
> Pass 2/4 are NEVER loaded or executed from this body (audit grep enforces).

1. **Acquire the compile lock**: the WHOLE pipeline holds `.paper/.compile.lock`
   (proper-lockfile) so two concurrent compiles never corrupt the outputs.

2. **Load sections in OUTLINE order** (COMP-02 / D-11): parse `.paper/OUTLINE.md`,
   sort by section number ascending. OUTLINE.md's rows must list exactly the
   sections STATE.json registers (the identity authority, D-18-38); when they
   disagree (a hand-edited row), refuse naming the divergence and
   `pensmith outline`, which applies the edited outline. For each section read its `PLAN.md`
   frontmatter (`assigned_sources`, `verified_against_draft_hash`), its
   `DRAFT.md` bytes, and its `VERIFICATION.md`.

3. **Refuse-gate** (COMP-01): the one per-section gate `done` shares
   (`bin/lib/verify/verdict-rows.ts sectionVerificationReasons`). A section is
   refused when its `VERIFICATION.md` has no `Status:` line, says
   `Status: failed` (fail closed, even when no verdict row parses), or carries a
   FABRICATED / MIS-CITED / quote-NOT_FOUND verdict or a Pass-1 UNVERIFIABLE
   verdict (the re-fetch was unavailable offline or under `--dry-run`; refused
   with "re-run online", D-17-07) — for any citekey shape (dotted, colon or
   Unicode keys included; a blocking row whose key cannot be read still
   blocks). Each hit is a refuse reason naming the section + citekey. Outside
   `--dry-run`, a `VERIFICATION.md` written under `--dry-run` (it opens with
   `> OFFLINE MODE (--dry-run)`) verified synthetic sources only, so the section
   is refused until it is re-verified (RUN-27).

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
   set to equal the input set, and the restored text to cite exactly the sources
   the original boundary cited (read with the one citation grammar, so a new
   `[-@k]`, `@{k}`, narrative `@k` or a rewritten cluster counts, D-18-40). Any
   drift REJECTS that boundary (keep the original prose) and records a
   Transitions-Changed rejection. Then run the deterministic
   cross-section consistency scan (COMP-04, flags only) and the citation-density
   computation vs. the discipline preset's per-paragraph band (COMP-05,
   warn-only). The discipline is the paper's own (config.toml
   `discipline_preset`, else the INTAKE.md brief; GRND-06); `--discipline`
   overrides it.

8. **Emit the outputs**: `atomicWriteFile` `.paper/DRAFT.md`,
   `.paper/COMPILE-REPORT.md` (schema v1, D-14) and `.paper/COMPILE-INPUTS.json`. EVERY write routes through the
   D-07 atomic-write chokepoint; section files are never written (ARCH-20), and
   `.paper/CITATIONS.bib` is left exactly as the library writer rendered it
   (BRDTH-01 — compile once pruned it to the cited keys and even emptied it).

9. **Shell fallback** (TIER-06 equivalence path): `pensmith compile [--yolo]
   [--lintHeadings] [--discipline <preset>]`.
