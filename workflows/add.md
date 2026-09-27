# pensmith add

> Ingest ONE new source mid-paper — by DOI, a local PDF, or a URL — hydrate it
> via Crossref, write it to `.paper/CITATIONS.bib`, then (behind an approval
> gate) remap it onto sections by touching ONLY `assigned_sources[]`.
>
> **NON-NEGOTIABLE (CLAUDE.md / PRD §14): add cannot smuggle a source past the
> verifier.** `verifyDoi` runs at add-time, but a FABRICATED / MIS-CITED verdict
> at compile (Pass 1) STILL blocks. The remap NEVER touches `status` or
> `verified_against_draft_hash` — a verified section STAYS verified (ERGO-06).

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
`@clack/prompts` over stdin. There is no `pensmith_add` MCP tool (the Tier-1
surface is THIS workflow body delegating to the same code — the compile/done
asymmetry precedent, keeping the locked 16 verbs bijective with the 16 workflow
bodies).

## Outputs

- `.paper/LIBRARY.json` — the source merged in through `upsertSources`
  (`bin/lib/library.ts`, BRDTH-01 — the one library writer): deduped by
  normalized DOI, then arXiv id / PMID / ISBN, then the preprint ↔
  version-of-record rule; a work already in the library keeps its citekey.
- `.paper/CITATIONS.bib` + `.paper/CITATIONS.ris` — re-rendered from LIBRARY.json
  by the same writer (D-19 citation-js chokepoint, never a hand-rolled
  serializer).
- On remap: each targeted section `PLAN.md` gains the citekey in
  `assigned_sources[]` (via `updateFrontmatter` inside `withLock` +
  `atomicWriteFile`). `status` and `verified_against_draft_hash` are byte-
  untouched (Pitfall 3 / A6).
- stdout — `added <citekey>` (and the remap count when sections were remapped),
  or `already in library as <citekey>` for a known work (nothing is duplicated;
  the remap then runs only with `--remap`).

## Body

> **LOCKED INVARIANT — assigned_sources-only remap (Pitfall 3 / A6).** The remap
> appends the citekey to each section's `assigned_sources[]` ONLY. It NEVER
> mutates `status` or `verified_against_draft_hash`. To rebuild the claim→source
> mapping for a section, the user runs `plan <N> --revise` — add does not touch a
> verified section's verdict.

1. **Detect input type + hydrate** (ERGO-06 / RSCH-05b):
   - **DOI** → `crossrefFetchById(normalizeDoi(source))` (offline cassette-backed
     in CI).
   - **PDF** → `fs.readFile(path.resolve(source))` → bytes-only `extractPdfText`
     (pdf-parse → pymupdf fallback, 08-03; T-08-04-03 path-traversal mitigation)
     → title heuristic → `crossrefSearch(title, { limit: 1 })`.
   - **URL** → `httpFetch` (D-06 chokepoint, NEVER raw fetch; T-08-04-02 SSRF
     mitigation) → sniff `Content-Type`: PDF bytes → the PDF path; HTML → scrape
     a `<meta>` DOI → retry as a DOI.
   - No candidate hydrated → print `could not hydrate "<source>". Source NOT
     added.` and return `{ ok: false }`.

2. **verifyDoi at add-time** (T-08-04-04): when a DOI is present, run `verifyDoi`.
   A non-resolving DOI prints a WARNING but the source is STILL added — the Pass-1
   verifier re-checks at compile time and blocks on FABRICATED. A transport error
   never aborts the add.

3. **Merge into the library** (BRDTH-01): `upsertSources(root, [candidate],
   { provenance: 'add' })` updates `.paper/LIBRARY.json` under its lock and
   re-renders `.paper/CITATIONS.bib` / `.paper/CITATIONS.ris` from it. A known
   work (same DOI, arXiv id, PMID or ISBN, or the preprint of a work already
   present) is merged, keeps its citekey, and prints `already in library as
   <citekey>`; every later message and the remap use that real key.

4. **Remap approval gate** (ERGO-06, approval-gates-default-on): remap when
   `--remap` is set OR (not `--yolo` AND the user confirms via the gate). When
   `--section`/`--slug` are supplied, remap that one section; otherwise iterate
   every section in STATE.json. The remap is idempotent (a citekey already
   present is skipped) and touches ONLY `assigned_sources[]`.

5. **Shell fallback** (TIER-06 equivalence path): `pensmith add <doi|pdf|url>
   [--section <n> --slug <slug>] [--remap] [--yolo]`.
