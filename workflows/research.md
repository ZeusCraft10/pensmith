# pensmith research

> Survey existing literature for the paper topic — disambiguate the scope,
> generate queries, run all 7 source adapters in parallel, dedupe by DOI,
> cross-check Retraction Watch, persist LIBRARY.json, and write the canonical
> `.paper/CITATIONS.bib` (D-20) that the verify verb reads at Pass-1 time.

<capability_check>
required:
  - Task
  - MCP library.read
  - Zotero MCP

degrade_if_missing:
  - if no Task: run sequentially (slower)
  - if no MCP library: read .paper/library.json directly (Phase 3+)
  - if Zotero MCP is available (Tier 1, SRC-16): read the user's Zotero with their Zotero MCP server's own tools — the collection named by `[sources] zotero_collection` (e.g. `zotero_get_collection_items`), else a search for each query (e.g. `zotero_search_items`) — fetch each hit's full item (e.g. `zotero_get_item_metadata` with `format="json"`), and submit the items unchanged to pensmith's `paper_ingest_zotero_items({paperRoot, items})`; pensmith validates them (a malformed item rejects the call with the field at fault — fix or drop it and resubmit) and adds them to LIBRARY.json tagged `zotero`, merging any whose DOI is already there
  - if no Zotero MCP: the `zotero` adapter reads Zotero itself when the user set `ZOTERO_API_KEY` (Zotero Web API), `PENSMITH_ZOTERO_LOCAL=1` (the Zotero 7 local API) or `ZOTERO_GROUP_ID`; with none of them, skip Zotero, note it in the research log, and continue on the scholarly sources — research is never broken by Zotero's absence (ARCH-03)
</capability_check>

## Overview

`pensmith research` is the second verb in the workflow (intake → **research** →
outline → ...). It consumes `.paper/INTAKE.md`, produces `.paper/LIBRARY.json`
and `.paper/CITATIONS.bib`, and is the only verb in Phase 3 that talks to
external HTTP APIs (through `bin/lib/http.ts`). Sources are live by default;
recorded fixtures are replayed (exact match, fail closed) only under the test
runner or `PENSMITH_OFFLINE=1`, and `--dry-run` uses labelled synthetic sources
(`bin/lib/http-mock.ts` decides the mode). The run also writes
`.paper/RESEARCH.md`, the research log, marked when it ran offline.

The implementation lives in `bin/cli/research.ts` (created by Plan 07). The
workflow body below is the prompt that drives the verb under both Tier 1
(Task/MCP) and Tier 2 (shell).

## Steps

1. (see Body below)

## Outputs

- `.paper/LIBRARY.json` — the paper's source library (schema v2, BRDTH-01): one entry per work, deduped across runs and ingest paths, with identifiers, provenance tags, `last_verified` and `retracted` flags
- `.paper/CITATIONS.bib` + `.paper/CITATIONS.ris` — rendered FROM LIBRARY.json by the one library writer (`bin/lib/library.ts` → `bin/lib/bibtex-write.ts` / `ris-write.ts`: D-19 citation-js chokepoint, D-20 canonical BibTeX, D-07 atomic-write chokepoint)

## Body

0. **Gates up front** (RUN-28): research asks two registry questions — the scope (`research-scope`, step 2) and the sources to keep (`research-prune`, before step 6). A Tier-2 run that cannot ask (no terminal, no scripted `PENSMITH_PROMPT_MODE=numbered` answers) and has no `--yolo` can answer neither, so it refuses with exit 3 before any model call, search or write. An existing `.paper/LIBRARY.json` that cannot be read is a one-line error naming the file, also before any work (RUN-12).

1. **Read `.paper/INTAKE.md`** for topic + discipline + tone + citation style.

2. **Disambiguate topic + generate queries** (RSCH-02): invoke `templates/prompts/topic-disambiguator.md` (D-12 LOCKED slug per Plan 03 CONTEXT D-12) → `{scopes: [{label, queries}]}` JSON. In `--yolo` mode, pick scope #1; otherwise present to user for selection (via `AskUserQuestion` if available, else stdin via `@clack/prompts`).

3. **Run adapters in parallel** (RSCH-03 / RSCH-04):
   - `import { sources } from 'bin/lib/sources/index.ts'` (the registry now has 8 entries: `crossref`, `openalex`, `arxiv`, `pubmed`, `semanticscholar`, `unpaywall`, `retraction-watch`, and `zotero`).
   - For each `query × each adapter`, call `sources[adapter].search(query)`.
   - **Zotero as a source (SRC-16, D-19-24):** the registry key is `zotero` (`bin/lib/sources/zotero.ts`). In Tier 2 it reads the user's library through `bin/lib/http.ts` — the Zotero Web API with `ZOTERO_API_KEY` (the key only in the `Zotero-API-Key` header; the user id from `GET /keys/current`), a group library with `ZOTERO_GROUP_ID`, or the Zotero 7 local API at `http://127.0.0.1:23119` with `PENSMITH_ZOTERO_LOCAL=1` — limited to `[sources] zotero_collection` when set; its `search(query)` is Zotero's quick search, and `pullZoteroIntoLibrary` (`bin/lib/zotero-ingest.ts`) pulls the whole collection. Not configured → `[]` with no request. In Tier 1, Claude reads Zotero with the user's Zotero MCP server and submits the items to `paper_ingest_zotero_items` (the `capability_check` above); both tiers normalize with `bin/lib/sources/zotero-mcp.ts` (authors / editors, CSL type, DOI, ISBN, arXiv / PMID from `extra`, venue, volume, issue, pages, publisher, the `zotero` ref), upsert with provenance `zotero`, and list the items in RESEARCH.md tagged `zotero`; a Zotero item whose DOI is already in the library merges into that entry.
   - **Zotero is a SOURCE PROVIDER, not a verb.** It is an entry of the `sources` registry, an MCP data tool and a doctor probe (`Zotero: authenticated` only after `/keys/current` answers 200); it does NOT add a 17th verb. The UX-02 locked-16 set is unchanged (`bin/lib/verbs.ts` UX02_VERBS stays at exactly 16).
   - Deduplicate by DOI; preserve provenance (which adapter found it first).
   - Emit a UNION `SourceCandidate[]` (D-14).

4. **Evaluate candidates** (RSCH-02 second half): invoke `templates/prompts/source-evaluator.md` (D-12 LOCKED slug) on the deduped `SourceCandidate[]` → keep/reject verdicts with rationale. Filter on `keep: true`. Then the `research-prune` question lets the user keep a subset (`--yolo` keeps every candidate); `.paper/RESEARCH.md` (the research log: scope, queries, per-adapter counts, candidates) is written only after it is answered, so an aborted research leaves no log.

5. **Cross-check via Retraction Watch** (D-15): for each surviving candidate with a DOI, call `sources['retraction-watch'].fetchById(doi)`. If the call returns a record, set `retracted: true` on the candidate — do **NOT** silently drop. (The verify verb will mark uses as MIS-CITED with `reason='cited a retracted work (per Retraction Watch cross-check at research time)'`.)

   **Retraction surfacing (Codex MEDIUM consensus #19 — locked)**: after the cross-check, if ANY candidate has `retracted: true`, the workflow emits a WARN line to stderr in the literal form:

   ```text
   WARN: ${count} retracted source(s) found in LIBRARY.json: ${citekeys.join(', ')}. These will FAIL Pass-1 if cited.
   ```

   This is also surfaced in the outline approval gate (see `workflows/outline.md` step 4).

6. **Merge into `.paper/LIBRARY.json`** (BRDTH-01 / D-17-43) through the one library writer, `upsertSources(root, candidates, { provenance: 'research' })` in `bin/lib/library.ts`, AFTER the retraction cross-check (D-15). Under one lock it dedups each candidate against the existing library — normalized DOI, then arXiv id / PMID / ISBN, then the version rule (normalized titles with Jaro-Winkler ≥ 0.95, same first-author family name, years ≤ 1 apart, when one side is a preprint) — merges the richer metadata and the provenance tags (a version of record's DOI wins over an SSRN / Research Square / arXiv DOI, which is kept in `alternate_dois` as a candidate only), and gives each new work a library-unique citekey. A re-run never duplicates a source; a known work keeps its citekey. Nothing else writes LIBRARY.json.

7. **Render `.paper/CITATIONS.bib` and `.paper/CITATIONS.ris`** (RSCH-09, D-20, CITE-05) — done by the same `upsertSources` call, from the validated LIBRARY.json (citation-js D-19 chokepoint, atomic writes D-07):
   - **`.paper/CITATIONS.bib` is the canonical citation file the verifier reads (D-20)** via `bin/lib/citations.ts` (D-19 chokepoint) at Pass-1 time. `LIBRARY.json` is NOT consulted at verify time; it is the source the bib is rendered from.
   - A bib entry that exists only in CITATIONS.bib (an older paper, or a hand edit) is imported into LIBRARY.json (`bib-import`) before re-rendering, so no cited key is ever lost.

8. **Shell fallback** (TIER-06 equivalence path): `pensmith research [--queries <n>] [--yolo]`.
