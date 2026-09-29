# pensmith add

> Add ONE work mid-paper — by DOI, arXiv id, PMID, ISBN, URL or local PDF — or a
> folder of your own PDFs. The work is identified correctly or not at all: a PDF
> that cannot be matched confidently is refused and nothing changes. The source
> goes into `.paper/LIBRARY.json` through the one library writer, RESEARCH.md's
> source list is refreshed, and (behind an approval gate) the source is mapped
> onto the sections it is relevant to by touching ONLY `assigned_sources[]`.
>
> **NON-NEGOTIABLE (CLAUDE.md / PRD §14): add cannot smuggle a source past the
> verifier.** Pass 1 re-fetches every cited identifier at verify time; a
> FABRICATED / MIS-CITED / UNVERIFIABLE verdict still blocks compile and export.
> The remap NEVER touches `status` or `verified_against_draft_hash` — a verified
> section STAYS verified (ERGO-06).

<capability_check>
required:
  - AskUserQuestion

degrade_if_missing:
  - if no AskUserQuestion: run the remap question through the gate registry (bin/lib/gates.ts `add-remap`) — @clack/prompts in a terminal, numbered prompts over stdin otherwise; `--remap` / `--section N` answer it up front, `--yolo` and a run without a terminal skip it and print the command
  - the `pdf-attach-unmatched` question (`add <id> --pdf <file>` with a PDF whose first page does not show the work) is never answered by `--yolo` and, without a terminal, refuses (exit 3, nothing written): in Tier 1 ask the user with AskUserQuestion whether to attach the PDF anyway, and only on yes run the command in a terminal the user can answer (`pensmith add <id> --pdf <file>`); on no, add the work without the PDF, or pass the right PDF
</capability_check>

## Overview

`pensmith add <source>` is the mid-paper ingestion verb (SRC-13, SRC-14, SRC-15,
PRD §7.15). The implementation lives in `bin/cli/add.ts` (`addCommand`). Both
Tier 1 (plugin) and Tier 2 (CLI) run the SAME code: Tier 1 asks the remap
question with `AskUserQuestion` (multi-select), Tier 2 through the gate
registry. There is no `pensmith_add` MCP tool (the 16 verbs stay bijective with
the 16 workflow bodies).

## Inputs

`bin/lib/source-input.ts` classifies the argument before any request:

| Input | Examples | Resolved through |
|---|---|---|
| DOI | `10.1038/nature14539`, `DOI: 10.1038/nature14539`, `https://doi.org/10.1038%2Fnature14539` | Crossref |
| arXiv id | `arXiv:1706.03762`, `1706.03762v7`, `hep-th/9901001v2`, `math.GT/0309136`, `https://arxiv.org/abs/1706.03762`, `https://arxiv.org/pdf/1706.03762` (the PDF is not downloaded), `10.48550/arXiv.1706.03762` | arXiv |
| PMID | `PMID:31978945`, `pmid: 31978945`, `https://pubmed.ncbi.nlm.nih.gov/31978945/` (bare digits are ambiguous and refused) | PubMed |
| ISBN | `isbn:9780226458083`, a checksum-valid ISBN-10/13 | the books adapter (Open Library / Google Books) |
| URL | any other `http(s)` link | fetched through `bin/lib/http.ts` |
| local PDF | `paper.pdf` (or any file starting with `%PDF-`) | identified from the PDF |
| folder | `~/papers/` | every PDF in it, as bring-your-own sources |

Anything else is a usage error (exit 2) before any request. `--pdf <file>` goes
with an identifier and attaches that PDF as the work's bring-your-own copy
(step 4b); `--replace-pdf` replaces a copy the work already has.

## Outputs

- `.paper/LIBRARY.json` — the source merged in through `upsertSources`
  (`bin/lib/library.ts`, BRDTH-01): deduped by normalized DOI, then arXiv id /
  PMID / ISBN, then the preprint ↔ version-of-record rule; a work already in
  the library keeps its citekey.
- `.paper/CITATIONS.bib` + `.paper/CITATIONS.ris` — re-rendered from
  LIBRARY.json by the same writer (SRC-12: raw UTF-8 names, abstract, journal,
  volume, pages, publisher, eprint + archivePrefix for arXiv works).
- `.paper/sources/<citekey>.pdf` — the PDF, for a local PDF, `--pdf <file>` or a
  folder; LIBRARY.json records its sha256 and the sha256 of its extracted text.
- `.paper/RESEARCH.md` — the sources block is re-rendered from LIBRARY.json
  (the new source appears with its tags: added, bring-your-own); notes below the
  end marker are never touched.
- On remap: each chosen section's `PLAN.md` gains the citekey in
  `assigned_sources[]` only.
- stdout — `added <citekey>.` or `already in library as <citekey>.`, then
  `<citekey> — <title> (<year>)`; every message uses the REAL key (with its
  collision suffix).

## Body

> **LOCKED INVARIANT — assigned_sources-only remap (Pitfall 3 / A6).** The remap
> appends the citekey to each chosen section's `assigned_sources[]` ONLY. It
> NEVER mutates `status` or `verified_against_draft_hash`. To rebuild the
> claim→source mapping for a section, the user runs `plan <N> --revise`.

1. **Classify** the argument (table above). An unusable one — or `--pdf` without
   an identifier, or `--section N` naming no section — is exit 2 before any
   request or write.

2. **Resolve an identifier** at its registrar. There are three outcomes, never
   two (D-19-05): found → the record is added; not found → `not found (<why>) —
   nothing added`, exit 1; the lookup failed (HTTP 503, rate limit, network) →
   `lookup failed (<reason>) — nothing added`, exit 1. A failed lookup is never
   read as "no such work". Offline with no recorded answer it is `DOI
   verification unavailable (offline) — <id> NOT added; re-run online to verify
   and add it` (arXiv / PMID / ISBN likewise), exit 1; under `--dry-run` the
   line reads `(dry-run)` and exits 0. A reserved `--dry-run` identifier is
   refused.

3. **A URL** is fetched through the one egress gate (redirects followed and
   re-checked hop by hop, size-capped). An SSRF target (loopback, private,
   link-local, metadata addresses) is refused with the reason, exit 1. A PDF
   answer is checked first (`checkPdfResponse`: a `.pdf` link answering
   `text/html` is `not a PDF (got text/html)`, exit 1 — the page never reaches
   the PDF parser) and then identified like a local PDF; an HTML page must
   declare its own DOI / arXiv id / PMID in its `<meta>` tags (a DOI merely
   mentioned in the page is never taken). Offline, only an exact recorded answer
   is used; otherwise the named offline refusal.

4. **A PDF** is read in the SEC-02 worker (pdf-parse, PyMuPDF fallback) and
   identified (`bin/lib/pdf-identify.ts`), in order: identifiers in its embedded
   metadata; the arXiv stamp and DOIs on its first pages; its title and first
   author — from real metadata or a layout heuristic that skips licence /
   permission notices, arXiv stamps, affiliations and e-mail lines — searched
   at Crossref, then OpenAlex, and accepted only when the title AND the first
   author's family name reach the Pass-1 thresholds and the record's year is
   plausible for the PDF (a record dated more than two years after the year
   the PDF shows — or a preprint dated after it — is a later re-post; when only
   such a re-post matched, or the OpenAlex search failed, the title is
   searched at arXiv under the same rules). A record found by an identifier printed in the PDF must be the PDF's
   OWN work: its title and first author match the PDF's own title and first
   author, or its title is printed as a title (whole lines at the top of page
   1) with its first author in the byline just below — a DOI in a footnote or
   reference list names a work the PDF cites and is refused (the refusal names
   it). Only the identifier or the title leaves the machine. Otherwise `add`
   refuses:
   `could not confidently identify this PDF — pass its DOI: pensmith add <doi> --pdf <file>`
   (exit 1, nothing changed). An image-only PDF is refused with `no extractable
   text`. An identified PDF is kept as the work's bring-your-own copy.

4b. **`add <identifier> --pdf <file>`** resolves the identifier (step 2) and
   checks that the PDF IS that work (`checkPdfForRecord`): its metadata or arXiv
   stamp carries the record's DOI / arXiv id, or its first page shows the
   record's title and first author (the rule of step 4). A PDF that does not
   show the work is attached only after the `pdf-attach-unmatched` gate: the
   user confirms it in a terminal; `--yolo` never answers it, and without a
   terminal the command exits 3 and writes nothing. A confirmed attachment is
   recorded `byo.asserted` in LIBRARY.json: its text is never evidence — Pass 3
   does not check quotes against it, Pass 2 never reads it, and it does not
   make the source count as having full text (`bin/lib/full-text.ts`). A work
   that already has a different PDF keeps it — the copy is not stored, with a
   warning — unless `--replace-pdf` is given. A PDF file name is unique per
   citekey, and a copy never overwrites the PDF another entry references.

5. **A folder** is bring-your-own ingest (`bin/lib/byo-ingest.ts`, SRC-15): each
   PDF is hashed (re-ingest is idempotent), extracted, identified as in step 4,
   and added tagged bring-your-own; a PDF with no confident match is kept with
   its own metadata, flagged unhydrated, with a warning — never as a search hit.
   Citing such an unidentified PDF verifies as UNVERIFIABLE (blocking) with the
   command that identifies it (`pensmith add <DOI or arXiv id> --pdf
   .paper/sources/<file>`), never FABRICATED. Folder ingest does not remap;
   map a source later with `add --remap <key>`.

6. **Merge into the library** (BRDTH-01): `upsertSources(root, [record],
   { provenance: 'add' })` under the library lock — the entry gets the tier its
   metadata decides (SRC-09: a journal article is peer-reviewed, a book a book)
   and, for a DOI, the open-access PDF Unpaywall lists (`oa_url`, with a contact
   email) — then CITATIONS.bib / .ris are re-rendered and RESEARCH.md's sources
   block refreshed.

7. **Remap** (SRC-14, gate `add-remap`): the paper's sections are scored against
   the source (`bin/lib/section-relevance.ts`: shared words with each section's
   title, purpose and plan). The question is a multi-select of every section
   with ONLY the relevant ones preselected, each option naming the shared words.
   - `--section N` maps to §N only (answered up front, nothing else changes);
   - `--remap` without `--section` maps to the relevant sections it lists;
   - `--yolo` and a run without a terminal skip the remap and print
     `remap skipped (non-interactive); run pensmith add --remap <key> --section N`
     (or `(--yolo)`), then the relevant sections, which `pensmith add --remap
     <key>` alone maps it to.
   `add --remap <key> [--section N]` does the same for a source already in the
   library (nothing is fetched).

8. **A retracted work** (the registrar's record carries its retraction notice)
   is added and a WARN names the notice: it fails Pass 1 (blocking) if cited.

9. **Shell fallback** (TIER-06 equivalence path): `pensmith add <source>
   [--pdf <file> [--replace-pdf]] [--section <n> [--slug <slug>]] [--remap] [--yolo]`.
