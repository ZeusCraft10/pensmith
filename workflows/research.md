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
  - if no MCP library / Zotero MCP: read .paper/library.json directly (Phase 3+)
</capability_check>

## Overview

`pensmith research` is the second verb in the workflow (intake → **research** →
outline → ...). It consumes `.paper/INTAKE.md`, produces `.paper/LIBRARY.json`
and `.paper/CITATIONS.bib`, and is the only verb in Phase 3 that talks to
external HTTP APIs (through `bin/lib/http.ts`, with cassette-mocked
deterministic replay in CI per `bin/lib/http-mock.ts`).

The implementation lives in `bin/cli/research.ts` (created by Plan 07). The
workflow body below is the prompt that drives the verb under both Tier 1
(Task/MCP) and Tier 2 (shell).

## Steps

1. (see Body below)

## Outputs

- `.paper/LIBRARY.json` — deduped SourceCandidate[] with provenance + `retracted` flags
- `.paper/CITATIONS.bib` — canonical BibTeX, written through `bin/lib/bibtex-write.ts` (D-19 citation-js chokepoint, D-20 canonical BibTeX, D-07 atomic-write chokepoint)

## Body

1. **Read `.paper/INTAKE.md`** for topic + discipline + tone + citation style.

2. **Disambiguate topic + generate queries** (RSCH-02): invoke `templates/prompts/topic-disambiguator.md` (D-12 LOCKED slug per Plan 03 CONTEXT D-12) → `{scopes: [{label, queries}]}` JSON. In `--yolo` mode, pick scope #1; otherwise present to user for selection (via `AskUserQuestion` if available, else stdin via `@clack/prompts`).

3. **Run adapters in parallel** (RSCH-03 / RSCH-04):
   - `import { sources } from 'bin/lib/sources/index.ts'` (the Wave-3 7-adapter registry: `crossref`, `openalex`, `arxiv`, `pubmed`, `semanticscholar`, `unpaywall`, `retraction-watch`).
   - For each `query × each adapter`, call `sources[adapter].search(query)`.
   - Deduplicate by DOI; preserve provenance (which adapter found it first).
   - Emit a UNION `SourceCandidate[]` (D-14).

4. **Evaluate candidates** (RSCH-02 second half): invoke `templates/prompts/source-evaluator.md` (D-12 LOCKED slug) on the deduped `SourceCandidate[]` → keep/reject verdicts with rationale. Filter on `keep: true`.

5. **Cross-check via Retraction Watch** (D-15): for each surviving candidate with a DOI, call `sources['retraction-watch'].fetchById(doi)`. If the call returns a record, set `retracted: true` on the candidate — do **NOT** silently drop. (The verify verb will mark uses as MIS-CITED with `reason='cited a retracted work (per Retraction Watch cross-check at research time)'`.)

   **Retraction surfacing (Codex MEDIUM consensus #19 — locked)**: after the cross-check, if ANY candidate has `retracted: true`, the workflow emits a WARN line to stderr in the literal form:

   ```text
   WARN: ${count} retracted source(s) found in LIBRARY.json: ${citekeys.join(', ')}. These will FAIL Pass-1 if cited.
   ```

   This is also surfaced in the outline approval gate (see `workflows/outline.md` step 4).

6. **Persist `.paper/LIBRARY.json`** (atomic via `bin/lib/atomic-write.ts`, D-07 chokepoint) with the dedup'd + filtered candidates (including any `retracted: true` survivors).

7. **Write canonical BibTeX `.paper/CITATIONS.bib`** (RSCH-09, D-20):
   - `import { writeBibtex } from 'bin/lib/bibtex-write.ts'` (Plan 03-04 — Wave 3).
   - Call `writeBibtex(library.candidates, '.paper/CITATIONS.bib')`. This serializes via citation-js (D-19 chokepoint) and atomic-writes the file via `bin/lib/atomic-write.ts` (D-07 chokepoint).
   - **`.paper/CITATIONS.bib` is the canonical citation source-of-truth (D-20)**. The verify verb reads it via `bin/lib/citations.ts` (D-19 chokepoint) at Pass-1 time. `LIBRARY.json` is NOT consulted at verify time.

8. **Shell fallback** (TIER-06 equivalence path): `pensmith research [--queries <n>] [--yolo]`.
