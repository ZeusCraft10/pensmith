# pensmith add

> Ingest ONE new source mid-paper — by DOI, arXiv ID, a local PDF, a URL, or a
> .bib / CSL-JSON file — find its own registry record, merge it into
> `.paper/LIBRARY.json` (which writes `.paper/CITATIONS.bib` from it), then
> (behind an approval gate) remap it onto sections by touching ONLY
> `assigned_sources[]`.
>
> **NON-NEGOTIABLE (CLAUDE.md / PRD §14): add cannot smuggle a source past the
> verifier.** add only ever stores a work's own record (a record for another
> DOI, or a PDF whose identity cannot be confirmed, is refused with exit 2),
> and Pass 1 still checks the source when a section that cites it is verified:
> a FABRICATED / MIS-CITED verdict STILL blocks compile and export. The remap
> NEVER touches `status` or `verified_against_draft_hash` — a verified section
> STAYS verified (ERGO-06).

<capability_check>
required:
  - AskUserQuestion

degrade_if_missing:
  - if no AskUserQuestion: run the remap approval gate via @clack/prompts over stdin (the bin/cli/add.ts CLI path); --remap / --yolo bypass the prompt entirely
</capability_check>

## Overview

`pensmith add <doi|pdf|url>` is the third library/ergonomics verb (list / open /
sketch / **add**). It is the mid-paper ingestion path: detect the input type,
hydrate a `SourceCandidate`, append it to the canonical bibliography, and
optionally remap it onto the existing sections.

The implementation lives in `bin/cli/add.ts` (`addCommand`) composing existing
chokepoints only — no business logic in the verb beyond input-type detection.
Both Tier 1 (plugin) and Tier 2 (CLI) run the SAME `bin/cli/add.ts` path: Tier 1
surfaces the remap gate via `AskUserQuestion`; Tier 2 degrades to
`@clack/prompts` at a terminal. With no terminal nothing is asked: the
source is not remapped, and add says to run it again with `--remap` (the
source is not added twice). There is no `pensmith_add` MCP tool (the Tier-1
surface is THIS workflow body delegating to the same code — the compile/done
asymmetry precedent, keeping one workflow body per verb).

## Outputs

- `.paper/LIBRARY.json` — the new work merged by identifier (a work already
  held is not added again; a new work whose key is taken gets the next free
  one). `.paper/CITATIONS.bib` and `.ris` are written from it in the same
  update, with every other entry kept as it was.
- `.paper/sources/<key>.txt` — a PDF's text, kept for the quotation check.
- On remap: each targeted section `PLAN.md` gains the citekey in
  `assigned_sources[]` (via `updateFrontmatter` inside `withLock` +
  `atomicWriteFile`). `status` and `verified_against_draft_hash` are byte-
  untouched (Pitfall 3 / A6).
- stdout — `added <citekey>` (and the remap count when sections were remapped).

## Body

> **LOCKED INVARIANT — assigned_sources-only remap (Pitfall 3 / A6).** The remap
> appends the citekey to each section's `assigned_sources[]` ONLY. It NEVER
> mutates `status` or `verified_against_draft_hash`. To rebuild the claim→source
> mapping for a section, the user runs `plan <N> --revise` — add does not touch a
> verified section's verdict.

1. **Detect input type + find the work's own record** (`bin/lib/source-hydrate.ts`):
   - **DOI** → the registry record for exactly that DOI (arXiv's own DOIs from
     arXiv); a record for another DOI is refused (exit 2).
   - **arXiv ID** → the arXiv record.
   - **PDF** → bytes-only `extractPdfText`, then a DOI or arXiv ID printed in
     its opening (before any reference list) whose work's title and byline
     head the PDF, else a Crossref title search whose hit has the PDF's whole
     title and an author the opening names. A PDF whose identity cannot be
     confirmed is refused (exit 2): add it by its DOI or arXiv ID instead.
   - **URL** → `httpFetch` (the http.ts chokepoint, with its SSRF guard) →
     PDF bytes go the PDF path; an HTML page's citation `<meta>` DOI goes the
     DOI path.
   - **.bib / .json** → each entry, by identifier, as it is written in the file.
   - Nothing found → the source is NOT added, and add exits 2.

2. **Merge into the library** (`bin/lib/library.ts`): by identifier (DOI,
   arXiv ID, PMID or ISBN), with the retraction cross-check on the work's own
   record; CITATIONS.bib and .ris are written from LIBRARY.json in the same
   update.

3. **Remap approval gate** (ERGO-06, approval-gates-default-on): remap when
   `--remap` is set OR (not `--yolo` AND the user confirms via the gate). When
   `--section`/`--slug` are supplied, remap that one section; otherwise iterate
   every section of the outline (`.paper/OUTLINE.json`). The remap is idempotent (a citekey already
   present is skipped) and touches ONLY `assigned_sources[]`.

4. **Shell fallback** (TIER-06 equivalence path): `pensmith add <doi|pdf|url>
   [--section <n> --slug <slug>] [--remap] [--yolo]`.
