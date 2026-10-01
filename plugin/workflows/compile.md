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
  - if no model is configured, or the run is LLM-stubbed (PENSMITH_NO_LLM), a --dry-run or offline with a non-loopback endpoint: skip boundary smoothing and the contradiction judge, keep the raw text and the heuristic contradiction floor, and name the reason in COMPILE-REPORT.md — smoothing is best-effort prose and never blocks compile
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
run the SAME `runCompile`; tier divergence is only the model transport. Tier 2
sends the smoother and the contradiction judge through `complete()` (the cost
cap is checked before every call); Tier 1 (Phase 23b, PLUG-07) submits the same
masked windows and the same candidate pairs through MCP and validates the
replies with the same `bin/lib/rewrite-guard.ts` and `bin/lib/claim-consistency.ts`.

**LOCKED INVARIANT — compile NEVER invokes Pass 2 (claim support) or Pass 4
(uncited-load).** Those are advisory and ship in Phase 5. The staleness
re-verify path uses the deterministic Pass 1 + Pass 3 ONLY (D-08). Boundary
smoothing operates only on placeholder-masked text — the model never sees raw
`[@citekey]` tokens (D-13).

## Outputs

- `.paper/DRAFT.md` — the compiled manuscript (EXP-05, D-21-13): `# <paper
  title>` (OUTLINE.md's H1, else the intake brief's title), then one
  `## <section title>` per section in OUTLINE order (COMP-02), citation tokens
  preserved for the export. A section draft's own leading heading that repeats
  its title is dropped. The headings are text no section gate judged, so a
  title that is empty, spans lines or holds a citation, a direct quote, an
  identifier or an unparseable or unsupported citation form is refused, naming
  the fix (retitle it in OUTLINE.md and run `pensmith outline`).
- `.paper/COMPILE-REPORT.md` — schema v1 (D-14), every section populated
  (EXP-13, D-21-17): Transitions Changed (each boundary's status, the reason and
  its before/after text, or the skip reason), Cross-Section Consistency Flags,
  Citation Density (the discipline and where it came from, the band and its
  source, per-section and out-of-band paragraphs), Compile-Staleness Resolved,
  Advisory Findings (each section's Pass-2 rows that are not SUPPORTED and its
  Pass-4 orphans, read from its VERIFICATION.md; a section whose Pass 2 did not
  judge its current draft says so), `## Accepted Quotes`, `## Quotes Verified
  Against Your Files` and (Phase 21, additive) `## Contradictions`
  (`Contradictions flagged: N (target 0)`, each pair with both sections and both
  sentences, the cleared pairs and the skip reason). The frontmatter `title`
  is the paper title. COMPILE-REPORT is never exported.
- `.paper/COMPILE-INPUTS.json` — v3 (D-18-39, D-20-23, D-21-13): the compiled sections
  (ids and slugs, in order), the sha256 of each section's DRAFT.md and
  VERIFICATION.md as compile read them and each section's
  `verified_against_draft_hash`, plus `compiled_draft_sha256` — the sha256 of
  the DRAFT.md compile wrote, and (v3) `headings_sha256` — the title and section
  titles compile wrote as headings. The router recompiles only when the paper's
  sections, those bytes or the headings change — never because a checkout or sync client
  reordered mtimes; `done` refuses a compiled draft edited since (VRFY-27). A v1
  or v2 record migrates with the new fields null, which `done` treats as stale
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
   UNVERIFIABLE-QUOTE (add the source's PDF, paraphrase — a re-draft with
   `pensmith write N`, or an edit of the section's DRAFT.md and
   `pensmith verify N` — or `pensmith verify N --accept-quote qN`) and PLACEHOLDER (re-draft with a
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
   re-verifying (Pass 1+3; its claim-support and orphan results for this
   unchanged draft are kept)`) — its draft did not change, so the Pass-2 and
   Pass-4 sections of its VERIFICATION.md are carried over, never replaced by
   `not run`: when step 3a now passes it (online again, the PDF added, the
   quote accepted), its VERIFICATION.md and PLAN.md say `verified`; when it
   still cannot be checked, step 3a refuses it with its options.

5. **Refuse if any reason was collected**: do NOT write `.paper/DRAFT.md`. Return
   the refusal naming every offending section + citekey (the verifier-blocks-
   compile invariant).

6. **Title and headings, then concatenate in OUTLINE order** (COMP-02, EXP-05):
   `# <title>`, then for each section `## <section title>` and its draft (each
   normalized to exactly one trailing newline), a blank line between. No title
   (an outline without an H1 and a brief without a title), or a title the
   heading check flags (see Outputs), is a refusal naming the fix.

7. **Boundary smoothing through the rewrite guard** (COMP-03, EXP-10, D-21-14):
   for each of the N-1 adjacent boundaries, `bin/lib/rewrite-guard.ts`
   `maskForRewrite` turns every citation cluster into `{{cite_K_M}}` and every
   direct quote Pass 3 would check into `{{quote_K_M}}`; only the last
   paragraph of section N and the first of N+1 go to the `smoother` prompt (one
   call per boundary through `complete()`, the cost cap checked before each).
   `validateRewrite` accepts the reply only when the placeholder multiset is
   unchanged, the headings are byte-identical, nothing outside the two
   paragraphs changed, the restored text cites exactly what the original cited
   (every citation as written, read with the one citation grammar, D-18-40) and
   it adds nothing the gate core checks — no unsupported or unparseable citation
   form, no direct quote and no identifier written in the prose (VRFY-25). A
   rejected boundary keeps the raw text and the report names why (`rejected
   (citation set changed)`). Smoothing is skipped, with the reason in the report
   and on stdout, by `--no-smooth`, `--raw`, `[compile] smooth_transitions =
   false` (`skipped (config)`), PENSMITH_NO_LLM (`skipped (no LLM)`),
   `--dry-run` (`skipped (dry-run)`), a sources-offline run whose model endpoint
   is not loopback (`skipped (offline)`) and a runtime with no usable model
   (`skipped (no model configured)`). `sections/*` are never written.

7a. **Contradictions** (EXP-11, D-21-15 — the D-12 amendment adding the
   `claim-consistency` prompt slug): `bin/lib/claim-consistency.ts` collects each
   section's claims (its PLAN.md `## Claims` and its draft's claim sentences, by
   Pass 4's marker lexicon), pairs them across sections, ranks the pairs by
   shared content terms and sends the top `[compile] contradiction_pairs`
   (default 20) to ONE `claim-consistency` call (judgment tier, structured,
   UNCLEAR-biased: CONTRADICTS only when both sentences cannot be true
   together). A deterministic negation / direction heuristic over pairs sharing
   a subject and predicate always runs and is the offline floor.
   `Contradictions flagged: N (target 0)` counts the model's CONTRADICTS plus the
   heuristic flags the model did not judge; a heuristic pair the model judged
   CONSISTENT is listed as cleared, with its rationale. Flags only — done's
   confirmation lists them.

7b. **Consistency scan and density** (COMP-04, COMP-05, EXP-12, D-21-16): the
   deterministic cross-section consistency scan (flags only) and the citation
   density against the band: the discipline preset's per-paragraph band,
   overridden by `[verification] citation_density_min/max`; `--discipline`
   overrides the paper's discipline (config.toml `discipline_preset`, else the
   INTAKE.md brief; GRND-06). The report names the discipline and its source
   and the band and its source (warn-only).

8. **Emit the outputs**: `atomicWriteFile` `.paper/DRAFT.md`,
   `.paper/COMPILE-REPORT.md` (schema v1, D-14) and `.paper/COMPILE-INPUTS.json` (v3, with the compiled draft's and the headings' sha256). EVERY write routes through the
   D-07 atomic-write chokepoint; section drafts are never written (ARCH-20), and
   `.paper/CITATIONS.bib` is left exactly as the library writer rendered it
   (BRDTH-01 — compile once pruned it to the cited keys and even emptied it).

9. **Shell fallback** (TIER-06 equivalence path): `pensmith compile [--yolo]
   [--no-smooth] [--raw] [--lint-headings] [--discipline <preset>]`
   (`--lint-headings`: the opt-in heading-tense consistency heuristic, COMP-04)
   (`--raw`: the raw concatenation — no smoothing; the contradiction heuristic
   and the density check still run).
