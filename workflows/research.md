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
  - if Zotero MCP present AND authenticated (ZOTERO_API_KEY set): wire the real MCP-backed Zotero client into the zotero-mcp adapter (setZoteroClientForTest) so its search() pulls + normalizes Zotero items into SourceCandidate[] — Zotero is USED AS A SOURCE alongside the other 7 adapters
  - if Zotero MCP absent OR configured-without-ZOTERO_API_KEY: SKIP the Zotero pull, note the skip in the research log, and continue on the other 7 adapters — research is NOT broken (RSCH-06 / ARCH-03 absence-non-breaking)
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
   - `import { sources } from 'bin/lib/sources/index.ts'` (the registry now has 8 entries: `crossref`, `openalex`, `arxiv`, `pubmed`, `semanticscholar`, `unpaywall`, `retraction-watch`, and `zotero-mcp`).
   - For each `query × each adapter`, call `sources[adapter].search(query)`.
   - **Zotero as a source (RSCH-06):** the `zotero-mcp` adapter's `search()` returns `[]` UNLESS Zotero MCP is present AND authenticated (`ZOTERO_API_KEY` set) AND a client is wired. When present + authenticated, the Tier-1 workflow body wires the real MCP-backed Zotero client INTO the adapter via `setZoteroClientForTest(client)`; the adapter's `search()` then PULLS from that client and NORMALIZES the results to `SourceCandidate[]` (`source: 'zotero-mcp'`). Those candidates flow through the SAME dedup + scoring + Retraction-Watch cross-check (Step 5) as every other adapter — i.e. Zotero is actually USED AS A SOURCE, not a documentation-only stub. In Tier 2 (no MCP transport) or when Zotero is absent / unauthenticated, `search()` returns `[]` and research proceeds on the other 7 adapters (the declared `capability_check` fallback above — research is never broken by Zotero's absence).
   - **Zotero is a SOURCE PROVIDER, not a verb.** It adds an 8th entry to the `sources` registry and a doctor presence probe; it does NOT add a 17th verb. The UX-02 locked-16 set is unchanged (`bin/lib/verbs.ts` UX02_VERBS stays at exactly 16).
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
