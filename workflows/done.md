# pensmith done

> Finalize the paper — whole-paper audit, optional humanize, and a trace-free
> export (DOCX / PDF / LaTeX / MD).
>
> **NON-NEGOTIABLE (CLAUDE.md / PRD §3, §14): no exported document carries a
> pensmith metadata trace, in ANY format** — not the .docx ZIP entries
> (`docProps/core.xml` + `app.xml` + every non-binary part), not the .pdf
> `/Info` dictionary or its XMP stream, not the .tex preamble, not the .md body.
> Exports are written to a DISTINCT export dir (default `.paper/export/`),
> separate from the source artifacts — the source `.paper/DRAFT.md` is never
> overwritten and is never the file a downstream reader receives.

<capability_check>
required:
  - Pandoc
  - humanizer skill

degrade_if_missing:
  - if no Pandoc: markdown-only export (latex is still produced via the offline md→tex writer; docx/pdf fall back to a markdown deliverable in the export dir). The offline path renders every citation form the gates accept in the paper's style — locators and prefixes kept, `-@key` as the year only, a narrative `@key` as "Author (Year)" ("Author [n]" in a numeric style, numbered in first-citation order like the References list)
  - if no PDF engine: markdown-only fallback for the pdf format (never an ENOENT crash)
  - if no humanizer skill: skip the humanize step (banner + null) and skip the 'after' honesty score — the export proceeds on DRAFT.md, never fails
  - if no GPTZERO_API_KEY: skip the honesty score (the report emits the skip banner, never a fabricated percent)
</capability_check>

## Overview

`pensmith done` is the milestone-completion verb (intake → research → outline →
for each section { plan → write → verify } → compile → **done**). It assembles
the Wave-1 export modules into one pipeline over the compiled `.paper/DRAFT.md`,
runs the DONE-09 export-confirmation gate, and emits a trace-free deliverable.

The implementation lives in `bin/lib/*` (`runPass4`, `runPlagiarism`,
`scoreHonesty` / `renderHonestyReport`, `runHumanizer`, `exportDraft`); the verb
is `bin/cli/done.ts` — a thin delegate. Both Tier 1 (plugin) and Tier 2 (CLI)
run the SAME `bin/cli/done.ts` → `bin/lib` path; there is no `pensmith_done` MCP
tool (the Tier-1 surface is THIS workflow body delegating to the same code, the
compile precedent — a documented asymmetry that keeps the locked 16 verbs
bijective with the 16 workflow bodies).

**LOCKED INVARIANT — done trusts no local file (VRFY-26).** Before any paid or
third-party step it recomputes the gate with the one gate core over the exact
text it exports — `.paper/DRAFT.md`, and again over a humanized FINAL.md — and
refuses (EXIT_BLOCKED, whatever `--yolo` / `--raw`) on any blocking row, a
section record that refuses, a section changed since its verification, or a
compiled draft changed since compile (VRFY-27). Pass 2 (claim support) and
Pass 4 (orphan claims) are advisory and NEVER auto-block (VRFY-07); the Core
Value ("every citation supports its claim") is honored by REQUIRING an explicit
decision before export: the `unsupported-claims` gate when any UNSUPPORTED claim
is present (each listed with its evidence; `--yolo` records it as
auto-accepted), else the generic export confirmation — only `--yolo` skips it.
The Pass-2 UNSUPPORTED feed is read from each section `VERIFICATION.md` and FAILS
SAFE: a present-but-unparseable `## Pass-2` table is treated as issues-present,
never a silent clean.

## Outputs

- The exported deliverable in the DISTINCT export dir (default `.paper/export/`):
  `DRAFT.docx` / `DRAFT.pdf` / `DRAFT.tex` / `DRAFT.md` per `--format` (with the
  Pandoc-absent markdown fallback) — carrying ZERO pensmith trace.
- `.paper/export/CITATIONS.bib` and `.paper/export/CITATIONS.ris` — the bundled
  bibliography (DONE-08): ONLY the sources the exported document cites, each
  entry exactly as in `.paper/CITATIONS.bib` / `.ris` (never the whole research
  library). A document that cites nothing gets neither file.
- `.paper/VERIFICATION.md` — a SOURCE artifact (not in the export dir) carrying
  `## Gate` (the exported text's file and sha256 and the summary of the
  recomputed rows), `## Decisions` (`| Section | Row | Claim | Decision |` —
  each UNSUPPORTED claim `Confirmed by user <time>` or
  `Auto-accepted under --yolo <time>`, VRFY-22), the accepted quotes and the
  quotes verified against the user's own files, the honesty report (DONE-04,
  framed verbatim), the plagiarism section (DONE-02), and the whole-paper Pass-4
  table over the exported text (DONE-01, VRFY-23).
- `.paper/LIBRARY.json` — `last_verified` of the citations a registrar
  confirmed during done's gate, through the one library writer (VRFY-28).
- done never writes under `.paper/sections/`.
- stdout: `pensmith done: exported <path>` — the deliverable's path.
- **Under `--dry-run`** (GRND-19, D-18-29) the paper is the dry-run workspace
  `./.paper-dry-run/` (seeded from `.paper/`, which is never written): the
  deliverable is `.paper-dry-run/export/DRAFT.dry-run.<ext>` (`.dry-run` before
  the extension), its bibliography sits beside it as `CITATIONS.dry-run.bib` /
  `CITATIONS.dry-run.ris` (every exported file is named `.dry-run`), FINAL.md and VERIFICATION.md
  are written in the workspace, and done prints the path plus one line saying it
  is a dry-run export (synthetic sources, stub text) and the real paper was not
  touched. The document itself stays zero-trace: the name and place disclose it.

## Body

> **LOCKED INVARIANT — zero exported trace + always-confirm gate.** Every
> per-format export ends with the MANDATORY scrub (`zeroTracePatch` for docx,
> `zeroTracePdf` for pdf). The export-confirmation gate ALWAYS prompts (generic
> confirm even on a clean paper); only `--yolo` skips it.

0. **Export blocking gate** (audit #3/#14, VRFY-26, VRFY-27 — unconditional,
   `--yolo` and `--raw` never skip it; D-20-24): every reason is collected, then
   the export is refused with EXIT_BLOCKED (4) before any paid or third-party
   step, writing nothing:
   - the sections are the ones STATE.json registers (OUTLINE.md must list the
     same; a paper whose STATE.json registers none uses OUTLINE.md's rows, as
     compile does) — never a directory listing; a paper with no section refuses;
   - each section's record can only add refusals (D-20-04): a missing PLAN.md,
     DRAFT.md or VERIFICATION.md, a failed write, a Status-less or
     `Status: failed` VERIFICATION.md, a failed PLAN.md, or — outside
     `--dry-run` — a verification written under `--dry-run` (RUN-27); a section
     whose DRAFT.md changed since its verification is `stale: §N changed since
     verification — re-verify and recompile`;
   - the compiled `.paper/DRAFT.md` must be the one compile wrote from those
     verifications (`COMPILE-INPUTS.json` v2: `compiled_draft_sha256` and each
     section's verified hash): a hand edit is `stale: .paper/DRAFT.md changed
     since compile` (VRFY-27) — the edit belongs in the section drafts; a v1
     record is stale ("recompile");
   - the gate core recomputes every row over `.paper/DRAFT.md`'s exact bytes
     (`bin/lib/verify/gate.ts`): a cited key outside the union of the sections'
     `assigned_sources` is UNASSIGNED, and every blocking row (FABRICATED,
     MIS-CITED, RETRACTED, UNVERIFIABLE-NETWORK, UNVERIFIABLE, UNPARSEABLE,
     UNSUPPORTED-FORM, NOT_FOUND, an UNVERIFIABLE-QUOTE the user did not accept
     for the current draft, …) is listed with the
     staleness reasons — so a hand-appended fake citation is named as both.
   Citations whose `last_verified` is older than `[verification]
   recheck_after_days` are re-checked past the HTTP cache (VRFY-28). With no
   `.paper/DRAFT.md` at all, the section records are checked first: when a
   section's verification blocks (compile refused, so there is no draft), done
   prints those reasons and exits EXIT_BLOCKED (4); only a paper that has not
   reached compile yet is "run `pensmith compile` first" (exit 1). Without a
   terminal and without `--yolo`, done then refuses at once (EXIT_APPROVAL, 3)
   because the export decision (step 6) needs an answer — before the paid steps.

1. **Whole-paper Pass 4** (DONE-01, VRFY-23): run `runPass4` over the exact text
   to be exported (FINAL.md when the humanizer wrote one, after step 5's
   re-check; else `.paper/DRAFT.md`). The per-paragraph orphan counts
   (HIGH-confidence, R8) feed the DONE-09 gate and the per-paragraph table of
   `.paper/VERIFICATION.md`.

2. **Plagiarism check** (DONE-02, advisory): run `runPlagiarism` over the draft
   (distinctive 5+-word phrases via the DuckDuckGo HTML endpoint, offline
   cassette in CI). Any phrase with web matches feeds the gate; it never blocks.

3. **Honesty score — before** (DONE-04, framed VERBATIM from
   `references/honesty-framing.md`): `scoreHonesty(draft)`. Skip cleanly (banner,
   no fabricated percent) when `GPTZERO_API_KEY` is absent.

4. **Humanize** (DONE-03, skip-clean if absent): `runHumanizer(draft)`. When the
   `~/.claude/skills/humanizer/` skill is absent (or no Task transport in this
   tier) → print a banner, return null, and proceed on `DRAFT.md` — NEVER fail
   the export. When present (Tier 1) → write `.paper/FINAL.md`. `--raw` skips
   this step entirely.

5. **Honesty score — after**: `scoreHonesty(FINAL.md)` when a humanized artifact
   was produced; otherwise the 'after' score is N/A in the report. A humanized
   FINAL.md is then gated on its OWN exact bytes (GATE-04, VRFY-26): its cited
   keys must equal the compiled draft's (the humanizer never adds, drops or
   swaps a citation) and the gate core recomputes every row over it; any
   refusal blocks the export (EXIT_BLOCKED).

6. **DONE-09 export decision** (`runDoneGate`): collect the gate issue
   set — UNSUPPORTED Pass-2 rows (read from each section `VERIFICATION.md`, FAIL
   SAFE on an unparseable table), Pass-4 orphans, and plagiarism hits. Print
   each UNSUPPORTED claim with its evidence, the orphans, the plagiarism hits,
   the quotes accepted without a source check and the quotes verified against
   the user's own files FIRST; then ALWAYS require an explicit answer: the
   `unsupported-claims` gate ("Export the paper with these UNSUPPORTED
   claims?") when an UNSUPPORTED claim is present, else the generic confirm
   (even when clean — PRD §7.9). `--yolo` skips it and records each UNSUPPORTED
   claim as `Auto-accepted under --yolo <time>`; a confirmation records
   `Confirmed by user <time>`. A declined gate cancels the export (exit 3) and
   writes no deliverable.

7. **Export + mandatory scrub** (DONE-06/07/08): `exportDraft` into the DISTINCT
   export dir (`outputDir` LEFT UNSET so the md-fallback never overwrites the
   source `DRAFT.md`). docx → `zeroTracePatch`; pdf → `zeroTracePdf`; latex →
   the offline md→tex writer (no generator comment); md → the trace-free body.
   Bundle the cited-only `.paper/export/CITATIONS.bib` / `.ris` (library.ts
   `exportCitedCitations`, written before any Pandoc run). Then record
   `last_verified` (VRFY-28), write the source `.paper/VERIFICATION.md` (gate,
   decisions, quote lists, honesty, plagiarism, Pass-4 sections), and — when
   no humanizer wrote FINAL.md — write `.paper/FINAL.md` from the exported
   `DRAFT.md` whenever FINAL.md is absent or older than it (a humanized FINAL.md
   of this compile is kept). The router's terminus is a FINAL.md not older than
   the compiled draft, so after a recompile the next `done` refreshes it and the
   bare loop settles at `status (done)` instead of re-running `done`.

8. **Shell fallback** (TIER-06 equivalence path): `pensmith done [--yolo]
   [--format docx|pdf|latex|md] [--raw]`.
