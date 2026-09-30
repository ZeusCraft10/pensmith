# pensmith compile

> Assemble all VERIFIED section drafts into a single manuscript. The phase
> keystone: it is the citation-integrity chokepoint on the compile path.
>
> **NON-NEGOTIABLE (CLAUDE.md / PRD §14): the verifier BLOCKS compile.** No
> FABRICATED / MIS-CITED / UNVERIFIABLE / quote-NOT_FOUND citation may escape
> into `.paper/DRAFT.md`. compile trusts no section record: it recomputes every
> section's verdicts with the one gate core over the exact draft bytes it
> concatenates (VRFY-25, D-20-23). Section drafts are READ-ONLY the entire run
> (ARCH-20); the only section files compile ever writes are a STALE section's
> VERIFICATION.md and PLAN.md, through its re-verify (step 4).

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
  Advisory Findings, then (Phase 20, additive) `## Accepted Quotes` (the quotes
  the user accepted without a source check, with their times) and
  `## Quotes Verified Against Your Files`.
- `.paper/COMPILE-INPUTS.json` — v2 (D-18-39, D-20-23): the compiled sections
  (ids and slugs, in order), the sha256 of each section's DRAFT.md and
  VERIFICATION.md as compile read them and each section's
  `verified_against_draft_hash`, plus `compiled_draft_sha256` — the sha256 of
  the DRAFT.md compile wrote. The router recompiles only when the paper's
  sections or those bytes change — never because a checkout or sync client
  reordered mtimes; `done` refuses a compiled draft edited since (VRFY-27). A v1
  record migrates with both new fields null, which `done` treats as stale
  ("recompile").
- `.paper/CITATIONS.bib` and `.paper/LIBRARY.json` are read, never written
  (BRDTH-01): compile records no `last_verified` either (VRFY-28).

## Body

> **LOCKED INVARIANT — verifier blocks compile.** Any blocking verdict the gate
> core recomputes over a section's draft — whatever its VERIFICATION.md says —
> HARD-REFUSES the compile before any `.paper/DRAFT.md` is written.
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

3. **The section's own record** (COMP-01, D-20-04 — it can only ADD refusals):
   a section is refused when it has no `PLAN.md`, `DRAFT.md` or
   `VERIFICATION.md`, its last write failed (FEED-04), its `VERIFICATION.md` has
   no `Status:` line (never verified — compile never verifies a section in the
   user's place) or says `Status: failed` (fail closed, even when no verdict row
   parses), its PLAN.md says `failed`, or — outside `--dry-run` — its
   `VERIFICATION.md` was written under `--dry-run` (it opens with
   `> OFFLINE MODE (--dry-run)`; synthetic sources only, RUN-27). A current
   section whose `VERIFICATION.md` judged another draft (its `Draft:` hash) is
   refused too.

3a. **The gate core over the exact bytes** (VRFY-25, D-20-23): every section
   — refused by its record or not — is recomputed by `bin/lib/verify/gate.ts
   recomputeGate` over the DRAFT.md bytes compile concatenates, with the
   section's `assigned_sources`, its quote acceptances (`QUOTE-ACCEPTANCES.json`,
   honoured only for a recomputed `UNVERIFIABLE-QUOTE` of the current draft) and
   the one bibliography (read entry by entry; an unreadable or missing file is a
   refusal naming why, never a stack). Every blocking row is a refuse reason
   naming the section, the citation and its remedy — FABRICATED, MIS-CITED,
   RETRACTED, UNASSIGNED, UNPARSEABLE, UNSUPPORTED-FORM, UNRESOLVABLE,
   NO-CITATIONS, NOT_FOUND, UNATTRIBUTED, UNVERIFIABLE-NETWORK ("re-run
   online"), UNVERIFIABLE (the reason names the agency and what would help),
   UNVERIFIABLE-QUOTE (add the source's PDF, paraphrase, or
   `pensmith verify N --accept-quote qN`) and PLACEHOLDER (re-draft with a
   model; under `--dry-run` it passes and compile removes the stub marker lines
   from the compiled dry-run draft). An unverifiable section does not stop the
   other sections' verification (S-13); it stops compile here, with its options.

4. **Staleness re-verify** (COMP-01 / D-08): recompute
   `computeDraftHash(DRAFT.md bytes, assigned_sources)` per section. On a
   mismatch (and a record step 3 did not refuse), emit
   `WARN: section <N> stale — re-verifying` and run the section verifier for
   that section ONLY with the advisory passes off (NEVER Pass 2/4): it rewrites
   that section's VERIFICATION.md (Pass 2 / Pass 4 marked `not run — compile
   staleness re-verify; run pensmith verify N`) and PLAN.md status and hash —
   never its DRAFT.md, never the bibliography or LIBRARY.json. A re-verify
   failure adds its rows as refuse reasons; an all-pass records a
   Compile-Staleness-Resolved event. Its verdict is not the last word either:
   step 3a recomputes the section whatever it answered. A section whose record
   says `unverifiable` (an earlier run could not reach a source or check a
   quote) is re-verified the same way (`WARN: section <N> is unverifiable —
   re-verifying`): when step 3a now passes it (online again, the PDF added,
   the quote accepted), its VERIFICATION.md and PLAN.md say `verified`; when
   it still cannot be checked, step 3a refuses it with its options.

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
   `[-@k]`, `@{k}`, narrative `@k` or a rewritten cluster counts, D-18-40), and
   to add nothing else the gate core checks — no unsupported or unparseable
   citation form, no direct quote and no identifier written in the prose that
   the section drafts did not hold (VRFY-25: the gate judged the drafts). Any
   drift REJECTS that boundary (keep the original prose) and records a
   Transitions-Changed rejection. Then run the deterministic
   cross-section consistency scan (COMP-04, flags only) and the citation-density
   computation vs. the discipline preset's per-paragraph band (COMP-05,
   warn-only). The discipline is the paper's own (config.toml
   `discipline_preset`, else the INTAKE.md brief; GRND-06); `--discipline`
   overrides it.

8. **Emit the outputs**: `atomicWriteFile` `.paper/DRAFT.md`,
   `.paper/COMPILE-REPORT.md` (schema v1, D-14) and `.paper/COMPILE-INPUTS.json` (v2, with the compiled draft's sha256). EVERY write routes through the
   D-07 atomic-write chokepoint; section drafts are never written (ARCH-20), and
   `.paper/CITATIONS.bib` is left exactly as the library writer rendered it
   (BRDTH-01 — compile once pruned it to the cited keys and even emptied it).

9. **Shell fallback** (TIER-06 equivalence path): `pensmith compile [--yolo]
   [--lintHeadings] [--discipline <preset>]`.
