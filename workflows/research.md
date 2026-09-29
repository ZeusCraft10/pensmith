# pensmith research

> Build the paper's source library from its brief: disambiguate the topic into
> a scope, run 5–10 focused queries against the discipline's preferred
> adapters, tier and filter what they find, let the source evaluator judge it,
> ask the user which sources to keep, cross-check retractions, and write
> `.paper/LIBRARY.json`, `.paper/CITATIONS.bib` / `.ris` and a readable
> `.paper/RESEARCH.md`.

<capability_check>
required:
  - Task
  - MCP library.read
  - Zotero MCP

degrade_if_missing:
  - if no Task: run sequentially (slower)
  - if no MCP library: read .paper/library.json directly (Phase 3+)
  - if Zotero MCP is available (Tier 1, SRC-16): read the user's Zotero with their Zotero MCP server's own tools — when `[sources] zotero_collection` names a collection, FIRST ask the user with AskUserQuestion whether to add that collection of their Zotero library to this paper (the `zotero-collection` gate: a paper's config can name a collection, only the user can approve it; `--yolo` never answers it); on no, skip Zotero and note it in the research log; on yes read that collection (e.g. `zotero_get_collection_items`) and submit its items with `paper_ingest_zotero_items({paperRoot, items, collection, approveCollection: true})` (later runs pass `collection` alone — an unapproved collection is refused, exit 3, nothing added). With no collection configured, search for each query (e.g. `zotero_search_items`) and submit the hits without `collection`. Fetch each hit's full item (e.g. `zotero_get_item_metadata` with `format="json"`) and submit the items unchanged; pensmith validates them (a malformed item rejects the call with the field at fault — fix or drop it and resubmit) and adds them to LIBRARY.json tagged `zotero`, merging any whose DOI is already there
  - if no Zotero MCP: the `zotero` adapter reads Zotero itself when the user set `ZOTERO_API_KEY` (Zotero Web API), `PENSMITH_ZOTERO_LOCAL=1` (the Zotero 7 local API) or `ZOTERO_GROUP_ID`; with none of them, skip Zotero, note it in the research log, and continue on the scholarly sources — research is never broken by Zotero's absence (ARCH-03)
  - if no AskUserQuestion: ask the scope and source-pruning questions as numbered prompts (Tier 2), or pass --scope / --yolo
</capability_check>

## Overview

`pensmith research` is the second verb in the workflow (intake → **research** →
outline → ...). It reads the paper's brief, `.paper/INTAKE.md`, and the
`[sources]` table of `.paper/config.toml`, and produces `.paper/LIBRARY.json`,
the `.paper/CITATIONS.bib` / `.ris` rendered from it, and `.paper/RESEARCH.md`.
Sources are live by default; recorded fixtures are replayed (exact match, fail
closed) only under the test runner or `PENSMITH_OFFLINE=1`, and `--dry-run`
uses labelled synthetic sources (`bin/lib/http-mock.ts` decides the mode).

The implementation is `bin/cli/research.ts` over the research pass in
`bin/lib/research-orchestrator.ts`. The body below is the procedure both tiers
follow (Tier 1 with Task / AskUserQuestion, Tier 2 in the shell).

## Steps

1. (see Body below)

## Outputs

- `.paper/LIBRARY.json` — the paper's source library (schema v3, BRDTH-01): one entry per work, deduped across runs and ingest paths, with identifiers, work type, tier, relevance, the why-relevant note, provenance tags, `last_verified`, `retracted` and `retraction_status`
- `.paper/CITATIONS.bib` + `.paper/CITATIONS.ris` — rendered FROM LIBRARY.json by the one library writer (`bin/lib/library.ts` → `bin/lib/bibtex-write.ts` / `ris-write.ts`: D-19 citation-js chokepoint, D-20 canonical BibTeX, D-07 atomic-write chokepoint)
- `.paper/RESEARCH.md` — the research log (scope, queries, per-adapter and per-query outcomes, exclusions with their reason, retractions) around the sources block rendered from LIBRARY.json (every source with its formatted reference, tier, relevance, tags, why-relevant note and abstract excerpt); everything below its end line is the user's and is never touched

## Body

0. **Refusals up front** (RUN-28, RUN-12). Research asks up to two registry questions that `--yolo` answers: the scope (`research-scope`, step 3) and the sources to keep (`research-prune`, step 8) — in `PENSMITH_PROMPT_MODE=numbered` the prune question reads two lines, the selection and then the sources to add (a script that stops after the selection gets a blank second line: nothing added). Two more ask only when the paper's config names a source of the user's that this user has not approved for this paper (step 4b: `byo-folder`, `zotero-collection`); `--yolo` never answers them. A run that cannot ask (no terminal, no scripted `PENSMITH_PROMPT_MODE=numbered` answers) and has no `--yolo` refuses with exit 3 before any model call, search or write — whatever `--scope` answers, the pruning question still needs a terminal or `--yolo`. A `--queries` value outside 5–10 or an empty `--scope` is a usage error (exit 2). Both prompts are hash-checked, an LLM must be configured (RUN-07), and an existing `.paper/LIBRARY.json` that cannot be read is a one-line error naming the file.

1. **Read the brief.** `.paper/INTAKE.md` (read through `bin/lib/intake-brief.ts`; a pre-v1 INTAKE.md is migrated in memory) gives the topic, the discipline (overridden by `[project] discipline_preset`) and the assignment text. No INTAKE.md → exit 1: run `pensmith new` first. An empty topic is taken from the assignment's keywords.

2. **Disambiguate the topic** (`templates/prompts/topic-disambiguator.md`, D-12 locked slug, structured output `{ambiguous, scopes: [{label, description, queries}]}`, 1–3 scopes). The request is built by `bin/lib/prompt-request.ts` (fixed instructions as the system prompt; `topic`, `discipline` and the fenced `assignment` as data blocks). Each scope's queries are normalised (at most 8 words), de-duplicated and clamped to 5–10: the first 10 are kept, and a scope with fewer than 5 is padded from the deterministic expansion of the topic (`bin/lib/query-expansion.ts`). `--queries <n>` lowers the cap (5–10). Under `PENSMITH_NO_LLM` (and when the model's reply never matches the schema after its corrective retry) the queries ARE that deterministic expansion, and the run says so on stdout and in RESEARCH.md.

3. **Choose the scope** (`research-scope`). Asked when the topic is ambiguous or more than one scope came back: in Tier 1 with `AskUserQuestion`, in Tier 2 as a select. `--scope <n|text>` answers it (a 1-based number, or words from a scope's label or description; a value that names no scope — or more than one — is exit 2, listing the scopes). `--yolo` takes scope 1 and prints which. The chosen scope and its queries are printed.

4. **Plan the adapters** (`bin/lib/adapter-plan.ts`, PRD §8, §10). Without `[sources] allowed_databases`: the discipline preset's source preference first — `nber` is Crossref restricted to NBER's DOI prefix 10.3386, `jstor` is reached through OpenAlex + Crossref, `psycnet` through PubMed + OpenAlex, `philpapers` through OpenAlex, `books` is the books adapter — then the rest of the default five (openalex, semanticscholar, crossref, arxiv, pubmed). With it: exactly the listed databases, the preferred ones first. The user's Zotero library joins when configured. Every default adapter left out is still reported (`skipped (not in allowed_databases)`, `skipped (not configured)`).

4b. **Your own sources first.** `.paper/config.toml` travels with a shared or synced paper, so it can only NAME the user's own sources (`bin/lib/own-source-approvals.ts`): a `byo_pdf_dir` inside the project folder is the paper's own; a folder outside it, and any `zotero_collection`, is read only once this user approved it for this paper — `pensmith new --pdfs <dir>` (typed on the command line) or the `byo-folder` / `zotero-collection` question (never skipped by `--yolo`; the approval is recorded in the pensmith data dir, never in `.paper/`). Without a terminal an unapproved source is skipped with a WARN and its row says why; nothing of it is read or copied. A Zotero lookup that fails writes a generic reason to RESEARCH.md (never the library's collection names or id; stderr has them). New PDFs in `[sources] byo_pdf_dir` (the folder `pensmith new --pdfs` recorded) are ingested through `bin/lib/byo-ingest.ts` — hashed, identified from an identifier or the title only (never the text), tagged `bring-your-own`, a PDF no registrar matches kept as local-only — and, when Zotero is configured and `[sources] zotero_collection` names a collection, that whole collection is pulled into LIBRARY.json tagged `zotero` (`bin/lib/zotero-ingest.ts`; an item whose DOI is already there merges). Both go through the one library writer as they are read. They are the user's own choices: the evaluator annotates each one that carries a registrar identifier and has not been judged yet — tier, relevance and a why-relevant note, merged into its entry (an off-scope one says so in the note) — but nothing drops them, and the prune question does not list them. Each is a row of the per-adapter table (`bring-your-own`, `zotero`) with its count or failure reason. Nothing of the user's is read under `--dry-run`.

5. **Search** (RSCH-03 / RSCH-04). Every query goes to every planned adapter (`limit` 10 per query; `[sources] min_year` is passed down as `fromYear`):
   - **Zotero as a source (SRC-16, D-19-24):** the registry key is `zotero` (`bin/lib/sources/zotero.ts`). In Tier 2 it reads the user's library through `bin/lib/http.ts` — the Zotero Web API with `ZOTERO_API_KEY` (the key only in the `Zotero-API-Key` header; the user id from `GET /keys/current`), a group library with `ZOTERO_GROUP_ID`, or the Zotero 7 local API at `http://127.0.0.1:23119` with `PENSMITH_ZOTERO_LOCAL=1` — with `[sources] zotero_collection` set, research pulls that whole collection once (step 4b, `pullZoteroIntoLibrary` in `bin/lib/zotero-ingest.ts`) instead of searching it — only once the user approved that collection for this paper (the `zotero-collection` gate; the approval is enforced in the shared code, so `plan N --research`, `revise --research` and Tier 1's `paper_ingest_zotero_items` refuse an unapproved collection too); without one, the `zotero` adapter's `search(query)` — Zotero's quick search of the library — runs for every query like any other adapter, and its hits are tagged `zotero`. Not configured → skipped with no request. In Tier 1, Claude reads Zotero with the user's Zotero MCP server and submits the items to `paper_ingest_zotero_items` (the `capability_check` above); both tiers normalize with `bin/lib/sources/zotero-mcp.ts` (authors / editors, CSL type, DOI, ISBN, arXiv / PMID from `extra`, venue, volume, issue, pages, publisher, the `zotero` ref; a Zotero 7 `citationKey` or Better BibTeX `Citation Key:` is kept only when it is a D-14 key, else the key is generated), upsert with provenance `zotero`, and list the items in RESEARCH.md tagged `zotero`; a Zotero item whose DOI is already in the library merges into that entry.
   - **Zotero is a SOURCE PROVIDER, not a verb.** It is an entry of the `sources` registry (crossref, openalex, arxiv, pubmed, semanticscholar, unpaywall, retraction-watch, books, zotero), an MCP data tool and a doctor probe (`Zotero: authenticated` only after `/keys/current` answers 200); it does NOT add a 17th verb. The UX-02 locked-16 set is unchanged (`bin/lib/verbs.ts` UX02_VERBS stays at exactly 16).
   - Each adapter's outcome is recorded per query and per adapter: a result count, `failed (<the adapter's reason with its hint>)` (e.g. `HTTP 429 — rate limited; set PENSMITH_S2_API_KEY`), `offline: no recorded fixture`, or a skip. Research prints the per-adapter table on stdout and writes both tables to RESEARCH.md.
   - Results are schema-checked, reserved dry-run identifiers are dropped outside `--dry-run`, duplicates collapse (normalized DOI, then title similarity), and each work keeps the best preference rank among the adapters that found it.

6. **Tier and filter** (`bin/lib/source-tier.ts`, `bin/lib/source-policy.ts`). Each candidate gets its tier from the registrar's metadata where the metadata decides it (journal / conference article → peer-reviewed; preprint server or arXiv-only → preprint; book, chapter or ISBN → book; a report from a government publisher or domain → gov-report; news, web pages, theses, datasets → other). The `[sources]` policy is then enforced: `min_year`, `allow_preprints`, `allow_books`, `allow_gov_reports`, `allow_news` (newspaper and magazine articles; default false) and `peer_reviewed_only`, and `require_doi` (default true), which requires a registrar identifier — a DOI, an ISBN, an arXiv id or a PMID. Excluded candidates are listed with their rule in RESEARCH.md; the evaluator never judges them.

7. **Evaluate** (`templates/prompts/source-evaluator.md`, D-12 locked slug, structured output `{verdicts: [{citekey, keep, reason, relevance, tier}]}`). The candidates are sent once, fenced, at most 150 per call, each with its tier hint. A kept source's reason becomes its why-relevant note; the metadata tier wins over the model's; the policy runs again with the final tier. A rejected candidate stays rejected — there is no keep-all fallback. A candidate whose evaluator call failed (after its corrective retry) or that got no verdict is kept as "not evaluated", with a warning and a note in RESEARCH.md. Kept sources rank by relevance, ties by preference rank.

8. **Prune** (`research-prune`). The user sees the evaluator's picks preselected and its rejections unselected with the reason, each with its tier, year and an abstract excerpt, and chooses what the library keeps (`AskUserQuestion` in Tier 1, a multi-select in Tier 2; `--yolo` keeps the picks). A rejected candidate the user keeps records "Kept at your choice" in its why-relevant note. The same question then takes any sources the user knows — DOIs, arXiv ids, `PMID:` / `isbn:` identifiers or URLs, separated by spaces — each identified exactly as `pensmith add` identifies it (found / not found / lookup failed; a URL through the one transport, a PDF answer identified or refused) and written with the kept sources, tagged `added` ("Added at the approval gate"). A blank answer adds nothing; `--yolo` adds nothing.

9. **No usable source → exit 1.** No source found (the message names each adapter's outcome), every candidate excluded by the policy, every candidate rejected by the evaluator (`no relevant sources`, with guidance: refine the topic, choose another scope, add sources you know), or nothing kept at the question: RESEARCH.md is written, LIBRARY.json and the citation files are left as they were.

10. **Cross-check retractions** (D-15) for every kept source with a DOI, BEFORE the library write, through the `retraction-watch` adapter's `fetchById` (never `search`). A retracted work is kept, flagged `retracted: true` — never silently dropped — and the run prints, to stderr, in the literal form:

    ```text
    WARN: ${count} retracted source(s) found in LIBRARY.json: ${citekeys.join(', ')}. These will FAIL Pass-1 if cited.
    ```

    A work whose lookup failed is listed as `retraction status unknown` (verify re-checks it). Both lists are in RESEARCH.md; the outline approval gate surfaces retractions again (`workflows/outline.md` step 4).

10b. **Open-access copies** (GRND-14, `bin/lib/open-access.ts`): for every kept source with a DOI and no open-access URL yet (OpenAlex hits carry their open primary location already), Unpaywall's `oa_pdf_url` is recorded as the entry's `oa_url` — the copy Pass 3 checks quotes against, so the drafter may quote that source directly. One stdout line counts them (`open access: N of M source(s) with a DOI have an open-access PDF`). It is an enrichment, never a gate: without a contact email (Unpaywall requires one), offline or under `--dry-run` nothing is requested and the line says why; a failed lookup adds the source all the same. Only the DOI is sent.

11. **Merge into `.paper/LIBRARY.json`** (BRDTH-01 / D-17-43) through the one library writer, `upsertSources(root, candidates, { provenance: 'research' })` in `bin/lib/library.ts`, with each source's type, tier, relevance, why-relevant note and retraction status. Under one lock it dedups each candidate against the existing library — normalized DOI, then arXiv id / PMID / ISBN (an ISBN only between two book-level records: a chapter or proceedings paper carries its book's ISBN and stays its own entry), then the version rule (normalized titles with Jaro-Winkler ≥ 0.95, same first-author family name, years ≤ 1 apart, when one side is a preprint) — merges the richer metadata and the provenance tags (a version of record's DOI wins over an SSRN / Research Square / arXiv DOI, which is kept in `alternate_dois` as a candidate only), and gives each new work a library-unique citekey. A re-run never duplicates a source; a known work keeps its citekey. Nothing else writes LIBRARY.json.

12. **Render `.paper/CITATIONS.bib` and `.paper/CITATIONS.ris`** (RSCH-09, D-20, CITE-05) — done by the same `upsertSources` call, from the validated LIBRARY.json (citation-js D-19 chokepoint, atomic writes D-07):
    - **`.paper/CITATIONS.bib` is the canonical citation file the verifier reads (D-20)** via `bin/lib/citations.ts` (D-19 chokepoint) at Pass-1 time. The bib stays the metadata source of truth for Pass 1; `LIBRARY.json` is the source the bib is rendered from, and verify reads it only to repair a bib that does not parse (re-rendered from it), to find the hash-checked bring-your-own PDFs Pass 3 (and, when `[verification] send_byo_passages` is on, Pass 2) read, and to know which identifier-less entries are the user's own unidentified PDFs and which retractions were recorded at ingest.
    - A bib entry that exists only in CITATIONS.bib (an older paper, or a hand edit) is imported into LIBRARY.json (`bib-import`) before re-rendering, so no cited key is ever lost.

13. **Write `.paper/RESEARCH.md`**: the research log (the offline marker when offline; scope, topic, discipline, result; the queries with any disclosure; the per-adapter and per-query tables; the exclusions; the retractions) around the sources block rendered from the library just written, then the end line. Everything below the end line — the user's notes — is kept byte-for-byte. Stdout ends with the kept count by tier, the exclusion and rejection counts, and what was written.

14. **Shell fallback** (TIER-06 equivalence path): `pensmith research [--scope <n|text>] [--queries <n>] [--yolo]`.
