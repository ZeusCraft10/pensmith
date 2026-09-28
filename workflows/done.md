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
  - if no Pandoc: markdown-only export (latex is still produced via the offline md→tex writer; docx/pdf fall back to a markdown deliverable in the export dir)
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

**LOCKED INVARIANT — the DONE-09 gate is the SOLE escape valve.** Pass 2 (claim
support) and Pass 4 (orphan claims) are advisory and NEVER auto-block (VRFY-07);
the Core Value ("every citation supports its claim") is honored by REQUIRING an
explicit confirmation before export when any UNSUPPORTED claim, orphan claim, or
plagiarism hit is present — only `--yolo` skips the gate. The Pass-2 UNSUPPORTED
feed is read from each section `VERIFICATION.md` and FAILS SAFE: a present-but-
unparseable `## Pass-2` table is treated as issues-present, never a silent clean.

## Outputs

- The exported deliverable in the DISTINCT export dir (default `.paper/export/`):
  `DRAFT.docx` / `DRAFT.pdf` / `DRAFT.tex` / `DRAFT.md` per `--format` (with the
  Pandoc-absent markdown fallback) — carrying ZERO pensmith trace.
- `.paper/export/CITATIONS.bib` and `.paper/export/CITATIONS.ris` — the bundled
  bibliography (DONE-08): ONLY the sources the exported document cites, each
  entry exactly as in `.paper/CITATIONS.bib` / `.ris` (never the whole research
  library). A document that cites nothing gets neither file.
- `.paper/VERIFICATION.md` — a SOURCE artifact (not in the export dir) carrying
  the honesty report (DONE-04, framed verbatim), the plagiarism section
  (DONE-02), and the whole-paper Pass-4 orphan summary (DONE-01).
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

0. **Export blocking gate** (audit #3/#14, unconditional — `--yolo` never
   skips it): re-check every section `VERIFICATION.md` the way compile's
   refuse-gate does. A missing or Status-less file, `Status: failed`, a blocking
   verdict (FABRICATED / MIS-CITED / NOT_FOUND, or UNVERIFIABLE — "re-run
   online"), or, outside `--dry-run`, a verification written under `--dry-run`
   (synthetic sources, RUN-27) refuses the export with EXIT_BLOCKED (4) and
   writes nothing. With no `.paper/DRAFT.md` at all, the same check runs
   first: when a section's verification blocks (compile refused, so there is no
   draft), done prints those reasons and exits EXIT_BLOCKED (4); only a paper
   that has not reached compile yet is "run `pensmith compile` first" (exit 1).

1. **Whole-paper Pass 4** (DONE-01): run `runPass4` over `.paper/DRAFT.md`. The
   per-paragraph orphan counts (HIGH-confidence, R8) feed the DONE-09 gate. A
   missing draft → error out and stop (run `pensmith compile` first).

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
   was produced; otherwise the 'after' score is N/A in the report.

6. **DONE-09 export-confirmation gate** (`runDoneGate`): collect the gate issue
   set — UNSUPPORTED Pass-2 rows (read from each section `VERIFICATION.md`, FAIL
   SAFE on an unparseable table), Pass-4 orphans, and plagiarism hits. When any
   exist, print a PER-ISSUE summary FIRST; then ALWAYS require an explicit
   confirm (generic confirm even when clean — PRD §7.9). `--yolo` skips the gate.
   A declined gate cancels the export and writes no deliverable.

7. **Export + mandatory scrub** (DONE-06/07/08): `exportDraft` into the DISTINCT
   export dir (`outputDir` LEFT UNSET so the md-fallback never overwrites the
   source `DRAFT.md`). docx → `zeroTracePatch`; pdf → `zeroTracePdf`; latex →
   the offline md→tex writer (no generator comment); md → the trace-free body.
   Bundle the cited-only `.paper/export/CITATIONS.bib` / `.ris` (library.ts
   `exportCitedCitations`, written before any Pandoc run). Then write the source
   `.paper/VERIFICATION.md` (honesty + plagiarism + Pass-4 sections), and — when
   no humanizer wrote FINAL.md — write `.paper/FINAL.md` from the exported
   `DRAFT.md` whenever FINAL.md is absent or older than it (a humanized FINAL.md
   of this compile is kept). The router's terminus is a FINAL.md not older than
   the compiled draft, so after a recompile the next `done` refreshes it and the
   bare loop settles at `status (done)` instead of re-running `done`.

8. **Shell fallback** (TIER-06 equivalence path): `pensmith done [--yolo]
   [--format docx|pdf|latex|md] [--raw]`.
