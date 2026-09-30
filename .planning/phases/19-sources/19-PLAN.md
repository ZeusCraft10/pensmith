# Phase 19: Sources and Library (SOURCES) — Plan

**Milestone:** v1.0.0 Open Source Release · **Base commit:** `20f2641c346a23cd8a6b1d01946b436b5d7e9167` (Phase 18's plan commit) · **Branch:** `v1/p19` (worktree `/home/user/pensmith-p19`)
**Decisions:** [19-CONTEXT.md](19-CONTEXT.md) (D-19-01..D-19-30) · **Seams:** Phase 18's `18-seam-S-A.patch`, then [seams/19-seam-S-B.patch](seams/) (applied first by every stream)

## 1. Goal

Every source adapter works against today's live APIs and reports failures to the user; every ingest path goes through the Phase 17 library writer; books, hashed bring-your-own PDFs and Zotero items are first-class sources; the drafter and `plan --research` can use this phase's full-text flags and evaluator (ROADMAP Phase 19, success criteria 1–8). The Phase 17 carry-overs close here: Unpaywall's current schema (SRC-03), fail-closed retraction data (SRC-04), keyless 429 handling (SRC-17) and the OpenAlex key (SRC-06).

Phase 18 (GROUND) is built concurrently; this phase merges after it closes. §9 lists every Phase 18 file this phase touches and the adaptation each needs at merge time.

## 2. Requirements and owning streams

| Stream | Requirements it closes |
|---|---|
| **net** | SRC-01, SRC-16, SRC-17 |
| **adapters** | SRC-02, SRC-03, SRC-04, SRC-05, SRC-06, SRC-11 |
| **research** | SRC-07, SRC-08, SRC-09, SRC-10, GRND-17 |
| **library** | SRC-12, SRC-13, SRC-14, SRC-15, GRND-14, SEC-02 |

20 requirements, each with one owning stream. Checks that need two streams' code run in the integration pass (§7) and count toward the owning stream's requirement. GRND-14's end-to-end check needs Phase 18's drafter and runs at the Phase 18/19 merge (§9); until then GRND-14 is reported as implemented with its merge-time acceptance pending, not as met.

## 3. Design

All decisions and reasons are in 19-CONTEXT.md. This section fixes the contracts and formats the streams share.

### 3.1 The load-bearing decisions

1. **Seam S-B (D-19-01)** carries every cross-stream contract: LIBRARY.json v3, the source vocabularies, the SourceCandidate fields, the three-way lookup, the transport's error classes and `validate`, `SearchOptions.fromYear`/`doiPrefix`, the contact-email resolver, the PDF-response check, the RESEARCH.md sources block and the `plan-research` gate. Streams build on it and never edit it.
2. **Three-way lookups (D-19-05).** `lookupById → found | not-found | failed`; `fetchById` unwraps (failed throws `SourceLookupError`). A failed lookup is never "not found" anywhere.
3. **The transport (D-19-06..10).** Redirects in http.ts's own loop with a fresh SSRF check and pin per hop; polite `(mailto:…)` User-Agent; per-host buckets lowered by `X-Rate-Limit-*`; exhausted hosts; a per-host circuit breaker; nothing but a validated answer is cached; secrets never in cache keys.
4. **Research (D-19-15..18).** Seeded from the Phase 18 brief; 5–10 queries per scope; preset-ordered adapter plan; deterministic tiers and policy; an evaluator whose rejection is respected; RESEARCH.md = run log + a sources view of LIBRARY.json; `plan N --research` touches only section N.
5. **Library side (D-19-19..23).** A BibTeX writer that round-trips every name; `add` that identifies the right work or refuses; hashed BYO PDFs whose text is only ever read through a re-hash; pdf-parse in a worker that is terminated on timeout; a full-text flag for the drafter.

### 3.2 Adapter contract (stream `adapters`; `net` for Zotero)

Every adapter module in `bin/lib/sources/` exports:

```ts
search(query: string, opts?: SearchOptions): Promise<SourceCandidate[]>   // [] + opts.onFailure(reason) on failure; OfflineEgressError thrown
lookupById(id: string): Promise<LookupResult>                             // found | not-found | failed (reason with hint)
fetchById(id: string): Promise<SourceCandidate | null>                    // unwrapLookup(await lookupById(id), '<adapter>', id)
```

(`retraction-watch` keeps fetchById-only, D-15, and keeps `RetractionLookupError`; `unpaywall.search` stays inert.) Every request passes a `validate` that checks the service's response shape (Crossref `status: "ok"` + `message-type`, OpenAlex `results[]` / work `id`, arXiv Atom `<feed`, PubMed `esearchresult` / `result`, S2 `data[]` / `paperId`, Unpaywall `doi`, Open Library `docs[]`, Zotero arrays), so an error body is never cached and is reported as `failed (response is not a <service> answer)`. Failure reasons are complete user-facing lines with hints, e.g. `HTTP 429 — rate limited; set PENSMITH_S2_API_KEY`, `keyless daily budget exhausted — set OPENALEX_API_KEY (free)`, `Unpaywall skipped: set PENSMITH_CONTACT_EMAIL`, `rate limit exhausted (retry after ~6 h)`, `skipped after 3 consecutive HTTP 503 responses`. Research prints them verbatim.

Registry (`sources/index.ts`): `crossref, openalex, arxiv, pubmed, semanticscholar, unpaywall, retraction-watch, books, zotero` (the Zotero key was `zotero-mcp`). Research names adapters by these keys.

`crossCheckRetractions(candidates, lookup?)` keeps its signature and mutates each DOI-bearing candidate: `retracted` + `retraction_details` + `retraction_status` (`retracted | clear | unknown`); candidates whose Crossref record already set a status are not looked up again; DOIs are de-duplicated; nothing is swallowed.

### 3.3 LIBRARY.json v3 entry (seam S-B)

```json
{
  "citekey": "lecun2015", "doi": "10.1038/nature14539", "arxiv": null, "pmid": "26017442", "pmcid": null, "isbn": null,
  "title": "Deep learning", "authors": ["LeCun, Yann", "Bengio, Yoshua", "Hinton, Geoffrey"], "year": 2015,
  "venue": "Nature", "abstract": "Deep learning allows …", "oa_url": null, "alternate_dois": [],
  "provenance": ["research:crossref"], "retracted": false, "retraction_details": null, "synthetic": false,
  "last_verified": "2026-09-28T00:00:00.000Z", "byo": null,
  "type": "article-journal", "publisher": "Springer Science and Business Media LLC", "volume": "521", "issue": "7553",
  "pages": "436-444", "editors": [], "tier": "peer-reviewed", "relevance": 0.92,
  "why_relevant": "The review the background section summarizes.", "hydrated": true,
  "retraction_status": "clear", "zotero": null,
  "addedAt": "2026-09-28T00:00:00.000Z", "updatedAt": "2026-09-28T00:00:00.000Z"
}
```

A BYO entry: `"byo": {"file": "sources/<citekey>.pdf", "sha256": "<64 hex>", "text_sha256": "<64 hex>|null"}`, provenance `byo`, `hydrated: false` when no registrar record matched. A Zotero entry: `"zotero": {"library": "users/123", "key": "ABCD2345"}`, provenance `zotero`. Corporate authors are stored braced: `"{ENCODE Project Consortium}"`.

### 3.4 RESEARCH.md

```
> OFFLINE MODE (…)                     ← only when offline (existing marker)
# Research log
Scope, Topic, Discipline, Generated
## Queries                             ← numbered; "(deterministic expansion of the intake topic — LLM stubbed)" when stubbed
## Adapters                            ← | Adapter | Results | Status |   (aggregated over queries, plan order)
## Per query                           ← | Query | Adapter | Results | Status |
## Excluded                            ← policy exclusions (rule) and evaluator rejections (reason)
## Retractions                         ← retracted and "retraction status unknown" lists (only when non-empty)
<!-- pensmith:sources:start (rendered from LIBRARY.json) -->
## Sources (N)                         ← research-md.ts renderSourcesBlock: one list item per LIBRARY entry
- [@lecun2015] LeCun, Yann; Bengio, Yoshua; Hinton, Geoffrey (2015). Deep learning. Nature, 521(7553), 436-444. https://doi.org/10.1038/nature14539
  - Tier: peer-reviewed · Relevance: 0.92 · Tags: search
  - Why relevant: …
  - Abstract: …
<!-- pensmith:sources:end -->
<!-- end of the research log: … notes below it are kept -->
…the user's notes (never touched)…
```

`research` rewrites everything above the end line; `add`, BYO ingest, Zotero ingest and `plan --research` call `refreshResearchSources(root)`, which replaces only the sources block. `plan --research` also appends to `sections/<NN>-<slug>/RESEARCH-LOG.md`.

### 3.5 Research stdout

```
pensmith research: scope "transformer-architecture" — 7 queries
pensmith research: sources by adapter
  arxiv             23  ok
  semanticscholar    0  failed (HTTP 429 — rate limited; set PENSMITH_S2_API_KEY)
  openalex           0  failed (keyless daily budget exhausted — set OPENALEX_API_KEY (free))
  crossref          41  ok
  pubmed             3  ok
pensmith research: 38 kept (peer-reviewed 21, preprint 12, book 3, other 2); 6 excluded by [sources] policy; 12 rejected by the evaluator
WARN: 1 retracted source(s) found in LIBRARY.json: wakefield1998. These will FAIL Pass-1 if cited.
pensmith research: wrote LIBRARY.json (38 source(s); 36 new, 2 already in library), RESEARCH.md, CITATIONS.bib and CITATIONS.ris
```

### 3.6 Cassettes (stream `net` for the format, `adapters` for recordings)

```json
{ "scope": "http://www.w3.org", "method": "GET", "path": "/WAI/…/dummy.pdf", "status": 301, "response": "", "responseHeaders": { "location": "https://www.w3.org/WAI/…/dummy.pdf" } }
{ "scope": "https://www.w3.org", "method": "GET", "path": "/WAI/…/dummy.pdf", "status": 200, "response": "<base64>", "bodyEncoding": "base64", "responseHeaders": { "content-type": "application/pdf" } }
```

`location` joins the recorded header allowlist; a non-text body is stored base64 with `bodyEncoding`; every file stays ≤ 51200 bytes; offline replay follows recorded hops through the exact-match store; secret query parameters and headers are never stored (existing scrub; `tests/cassette-no-leak` also checks recorded paths for `api_key`, `key`, `token`).

## 4. Parallel execution protocol

### 4.1 Rules

- Four streams run in parallel in separate worktrees created from the plan commit on `v1/p19`.
- **First two commits of every stream:** apply seam S-A, then seam S-B, exactly as `seams/README.md` says. Never edit a seam file or seam hunk afterwards. A seam defect stops the stream; the orchestrator issues one corrective patch every stream applies identically.
- A stream edits only its **owned paths** (§5), its **regions of the hot files** (§6), and nothing else. It calls only APIs that exist at the base, seam APIs and APIs it creates — never a new API another stream creates. Checks that need another stream's code go to the integration pass (§7).
- Never modify `/home/user/pensmith` (Phase 18's checkout) or any `v1/p18-*` worktree.
- Each stream ends green in its own worktree: `npm run prebuild && npm run lint && npm run typecheck && npm run build && npm test` (the root-only atomic-write case is the only allowed failure). `npm run build` before any test that spawns `dist/`.
- Commits: `feat(19-<stream>): …`, `fix(19-<stream>): …`, `test(19-<stream>): …`, `docs(19-<stream>): …`, each ending with the two trailer lines. Nothing is pushed; no PR, tag, release or npm publish.
- No `test.skip`/`todo`, no loosened assertion, no `eslint-disable`, no chokepoint removed. A test that encodes behaviour this phase supersedes is updated to assert the new behaviour and named in the stream summary (§8 lists the known ones).
- Cross-platform: `path.join`/`path.resolve`, CRLF-tolerant parsers (every new parser gets an LF and a CRLF test), no POSIX-only assumptions in shipped code (worker entry resolution, temp files, the PyMuPDF result file and the `.paper/sources/` copies use `path` and `os.tmpdir()` / the data dir).
- CLI experiments run in `/tmp/claude-0/-home-user-pensmith/424821c3-06dc-5dce-b0e5-b1cac8e53a7e/scratchpad/p19/<stream>/` with `XDG_DATA_HOME` and `HOME` inside it, never with cwd = a checkout. Live requests and recordings use `PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org`; no personal data goes into any request, fixture or log. Pandoc: `/tmp/claude-0/-home-user-pensmith/424821c3-06dc-5dce-b0e5-b1cac8e53a7e/scratchpad/tools/pandoc`.
- The RUN-21 mock LLM (`npm run mock-llm -- --port N`, configured through the isolated global runtime.json) is the model for every LLM-path check; there is no API key. Tests script replies per slug; they never edit `tests/helpers/local-servers/mock-llm.ts` (Phase 18 rewrites it).
- The default `npm test` stays offline; live checks are `npm run live:sources` (D-19-25) and the user-path commands of §10.

### 4.2 Stream summaries

Each stream writes `.planning/phases/19-sources/19-<stream>-SUMMARY.md` at the end: requirements closed, files, tests added or updated (with the reason for each update), deviations with D-ids, items handed to the integration pass, and any Phase 18 merge note it discovered.

## 5. Streams

### 5.1 Stream `net` — SRC-01, SRC-16, SRC-17

**Goal.** The one egress gate follows redirects safely, is polite in the form each service asks for, stops hammering hosts that said stop, never caches a non-answer or a secret, allows exactly the configured local services, and carries Zotero in both tiers with a real authentication check.

**Owned paths.**
- `bin/lib/http.ts` (everything outside the seam S-B hunks), `bin/lib/retry.ts`, `bin/lib/http-mock.ts`
- `bin/lib/sources/zotero.ts` (new), `bin/lib/sources/zotero-mcp.ts` (the item normalizer), `bin/lib/zotero-ingest.ts` (new), `bin/lib/grobid.ts` (new)
- `bin/lib/ecosystem-presence.ts`, `bin/lib/capabilities.ts` (Zotero facts only), `bin/lib/doctor/probes/zotero-mcp-presence.ts`, `bin/lib/doctor/probes/contact-email-presence.ts`
- `mcp/tools.ts`
- `docs/SOURCES.md` (new), `workflows/doctor.md`
- tests: `tests/http-redirect*.test.ts`, `tests/http-politeness*.test.ts`, `tests/http-rate-limit*.test.ts`, `tests/http-circuit*.test.ts`, `tests/http-cache-keys*.test.ts`, `tests/http-local-services*.test.ts`, `tests/ssrf-redirect*.test.ts`, `tests/cassette-binary*.test.ts`, `tests/http.test.ts`, `tests/http-mock.test.ts`, `tests/retry.test.ts`, `tests/egress-gate.test.ts`, `tests/ssrf-pinning.test.ts`, `tests/http-cache.test.ts`, `tests/zotero*.test.ts`, `tests/sources/zotero-mcp.test.ts`, `tests/doctor-zotero*.test.ts`, `tests/doctor-probes.test.ts` (Zotero and contact cases), `tests/mcp-zotero-ingest.test.ts`, `tests/tier-contract/zotero-ingest.test.ts`, `tests/grobid*.test.ts`, `tests/helpers/local-servers/grobid-server.ts` (new, V6 directory), `tests/fixtures/cassettes/synthetic/net/**`, `tests/fixtures/cassettes/synthetic/zotero/**`
- `PRD.md` §11, §12; `PRIVACY.md` (the contact-email and Zotero sections); `workflows/research.md` (the capability_check Zotero lines and the step-3 Zotero bullets only)

**Tasks.**
1. Apply seams S-A and S-B.
2. **Redirect loop (SRC-01, D-19-06).** Follow 301/302/303/307/308 for GET/HEAD up to 5 hops inside the retry's attempt: per hop parse + scheme allowlist, resolve + SSRF validate (no source-label bypass), new pinned dispatcher, mirror line, `kind:"http"` record; strip sensitive headers on a cross-origin hop; `RedirectError` for too-many / loop / downgrade / no-location; `opts.llm` and POST never follow; the final response is cached under the original URL. `maxRedirections` stays 0 and `tests/ssrf-pinning.test.ts` gains the per-hop re-pin assertion. MockAgent tests: 301 → 302 → 200 application/pdf returns the final bytes; a redirect to 127.0.0.1 and to 169.254.169.254 is refused with the target receiving 0 requests; a 6-hop chain errors `too many redirects`; Authorization / x-api-key absent on the cross-origin hop; https → http refused; a loop is refused.
3. **Cassette format (D-19-07).** `bodyEncoding: "base64"` for non-text bodies (recorder and replay), `location` in the recorded header allowlist, fixture replay follows hops; `tests/cassette-size`, `cassette-provenance`, `cassette-no-leak` accept the format (no-leak also scans recorded paths for secret parameters). Synthetic mechanics fixtures only under `cassettes/synthetic/net/`.
4. **Politeness and limits (SRC-17, D-19-08).** `(mailto:<email>)` User-Agent via `contactEmail()`; per-host buckets seeded from the source table (arXiv 1 per 3 s; Crossref 3/s; the rest per D-19-08); `X-Rate-Limit-Limit`/`-Interval` lower a host's rate; `Retry-After` > 30 s → `RateLimitExhaustedError`, the host exhausted until then (0 further sockets); 3 consecutive 429/5xx responses → `CircuitOpenError`, one stderr line per host, 10-minute half-open probe; fixture answers never count; `_resetHostStateForTest`. Tests assert timestamps (a `1`/`1s` header holds the next requests ≥ 1 s apart), the single attempt and single line for `Retry-After: 22400`, and ≤ 3 requests to a failing host over a 3-query loop.
5. **Cache keys (SRC-06 transport half, D-19-10).** Cache keys drop secret query parameters (`api_key`, `apikey`, `key`, `token`, `access_token`) and `SENSITIVE_HEADERS` (+ `zotero-api-key`); a keyed and a keyless request share one entry; no cache file contains a key (test greps the cache dir).
6. **Local services.** `FetchOptions.localService` allows exactly `http://127.0.0.1:23119` when `PENSMITH_ZOTERO_LOCAL=1`, and exactly the origin of a loopback `PENSMITH_GROBID_URL`; nothing from a paper file can enable either; link-local and metadata addresses stay refused. `bin/lib/grobid.ts` `grobidHeader(pdfBytes) → {title, authors, doi} | null` (multipart POST to `/api/processHeaderDocument`, TEI parse), tested against a loopback server in `tests/helpers/local-servers/`.
7. **Zotero (SRC-16, D-19-24).** `sources/zotero.ts` (`GET /keys/current` → user id; `ZOTERO_GROUP_ID`; collection by `[sources] zotero_collection`; paginated `items/top`; `search()` for query pulls; `Zotero-API-Key` header; `noCache`), the normalizer returning `source: 'zotero'` candidates (creators → authors / editors, `itemType` → type, DOI, ISBN, `extra` arXiv/PMID lines, abstract, publication title, volume, issue, pages, publisher, the `zotero` ref); `zotero-ingest.ts` (zod item validation → normalize → `upsertSources(…, {provenance: 'zotero'})` → `refreshResearchSources`); the registry line `zotero` in `sources/index.ts`; MCP tool `paper_ingest_zotero_items({paperRoot, items})` (≤ 30 statements, session lock, no fs); `setZoteroClientForTest` deleted. doctor: authenticated check through http.ts (`authenticated` / `key rejected` / `not detected`; offline = fixture or `not checked (offline)`), MCP detection in `$CLAUDE_CONFIG_DIR`/`~/.claude.json` (user and project scope), `.mcp.json`, legacy paths; real fix links. `references/doctor-output.md` stays byte-identical (probe id unchanged).
8. **Contact email.** http.ts and the contact-email doctor probe read `contactEmail()`.
9. **Docs.** `docs/SOURCES.md` (per-service floors, polite identification, keys, what each service receives), PRD §11 (Zotero Web / local API and the MCP tool), §12 (floors amended; rows for Open Library, Google Books, Zotero; Unpaywall's email requirement), PRIVACY.md (Zotero data flow; the contact-email variable rule), `workflows/doctor.md`, the Zotero lines of `workflows/research.md`.

**Verification.** New and updated tests; the full gate. User path (built CLI, scratch dir): `pensmith doctor` with no Zotero → `Zotero: not detected`; with `ZOTERO_API_KEY=bogus` live → `Zotero: key rejected`; an isolated `CLAUDE_CONFIG_DIR` after `claude mcp add zotero …` → the server detected, not authenticated; `add`-free live probes through `node -e` on the built `dist/bin/lib/http.js`: a Crossref request's User-Agent contains `(mailto:pensmith-dev@example.org)` and the response carries `x-api-pool: polite-*`; `http://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf` is followed through its 301 to a 13 KB `%PDF`; when keyless OpenAlex answers 429 with a `Retry-After` beyond 30 s (as it did during planning), one request and the exhausted-host reason. Research-level runs are the integration pass's.

### 5.2 Stream `adapters` — SRC-02, SRC-03, SRC-04, SRC-05, SRC-06, SRC-11

**Goal.** Every registrar adapter returns complete, correct records from today's APIs, says exactly why when it cannot, and never lets a failure read as "not found" or "not retracted"; books are a source; the recordings are real.

**Owned paths.**
- `bin/lib/sources/{crossref,openalex,arxiv,pubmed,semanticscholar,unpaywall,retraction-watch,retraction-cross-check,books,dry-run,index}.ts` (`books.ts` new; in `index.ts` the `zotero` lines are stream `net`'s)
- `bin/lib/runtime.ts` (the OpenAlex / S2 key accessors only)
- `bin/lib/verify/pass1.ts` (the `SourceLookupError` → UNVERIFIABLE branch), `bin/lib/verify/pass3.ts` (the Unpaywall lookup, `checkPdfResponse` + `bodyBytes`, caught extraction errors), `bin/lib/verify/freshness.ts` (host-unavailable → unavailable row)
- `scripts/refresh-cassettes.mjs`, `scripts/live-sources.mjs` (new), `package.json` (the `live:sources` script line)
- `tests/fixtures/cassettes/**` except `synthetic/net/**` and `synthetic/zotero/**`
- tests: `tests/sources/**` (except `zotero-mcp.test.ts`), `tests/books*.test.ts`, `tests/retraction*.test.ts`, `tests/gate-retraction.test.ts`, `tests/unpaywall*.test.ts`, `tests/pass1-lookup*.test.ts`, `tests/pass3-*.test.ts`, `tests/freshness-probe.test.ts`, `tests/verify-retraction-cli.test.ts` (new), `tests/cassette-*.test.ts` (content assertions; the format checks are `net`'s), `tests/known-bad-citations.test.ts`
- `PRD.md` §8 (the note below the table)

**Tasks.**
1. Apply seams S-A and S-B.
2. **Three-way contract (SRC-05, D-19-05)** for every adapter per §3.2, with `validate` shape checks and complete failure reasons; unit tests per adapter: found, 404 → not-found, 503 after retries → failed, schema-invalid 200 → failed and not cached, host exhausted → failed, offline miss → OfflineEgressError.
3. **Crossref (SRC-05, SRC-04, D-19-11, D-19-13).** Consortium `name` authors (`{Name}`), editor-only works, container-title / volume / issue / page / publisher / ISBN / type / abstract, `updated-by` + `RETRACTED:` retraction status, search `select` extended, `fromYear` (`filter=from-pub-date:`), `doiPrefix` (`filter=prefix:`).
4. **OpenAlex (SRC-06).** `api_key` from `getOpenAlexApiKey()`, `mailto` via `contactEmail()`, venue / type / biblio / abstract (from the inverted index) / DOI, `fromYear`; keyless 429 or exhausted host → `keyless daily budget exhausted — set OPENALEX_API_KEY (free)`; the overdue TODO removed.
5. **arXiv (SRC-02).** `arxiv` bare id, DOI, `journal_ref` → venue, abstract, `type: 'preprint'`; `fetchById` accepts old-style ids and strips versions.
6. **PubMed, Semantic Scholar.** PMID / PMCID / journal / volume / issue / pages (`mindate` for `fromYear`); S2 venue, externalIds, publicationTypes, `year=` filter, the `x-api-key` header, the corrected keyless notice and 429 hint.
7. **Unpaywall (SRC-03, D-19-12).** `raw_author_name` and legacy shapes, every `oa_location`, the best PDF, email via `contactEmail()` or `failed: Unpaywall skipped: set PENSMITH_CONTACT_EMAIL` (+ one stderr warning), 4xx body messages.
8. **Retractions (SRC-04, D-19-11).** `crossCheckRetractions` statuses per §3.2; the retraction-watch adapter uses `contactEmail()` and maps host-unavailable errors to `RetractionLookupError`; a 200 with an inner 400/403 body is a failure, not cached (MockAgent), and reads `retraction status unknown` in the research output (asserted through the returned statuses) and in VERIFICATION.md (Pass 1's existing path).
9. **Books (SRC-11, D-19-14).** `sources/books.ts` (Open Library search + ISBN lookup with `editions.*`, Google Books fallback, `type: 'book'`, publisher, year, ISBN-13, `lookupById('isbn:…')`), registry entry `books`.
10. **Pass 1 / Pass 3 / freshness (D-19-05).** Pass 1: `SourceLookupError` from the Crossref re-fetch → UNVERIFIABLE with the reason (blocking); Pass 3: Unpaywall `lookupById` reasons (`Unpaywall skipped: set PENSMITH_CONTACT_EMAIL` instead of `No OA PDF available`), the OA PDF fetched with `source: 'generic'` (the PDF host is not a polite pool and never receives the contact email; today it is labelled `unpaywall`), its bytes checked with `checkPdfResponse` and read from `bodyBytes`, extraction errors caught (no unhandled rejection); freshness: host-unavailable → `unavailable`.
11. **Recordings (D-19-26).** Re-record every adapter whose URL shape changed; add query sets: Crossref `10.1038/nature14539`, `10.1038/nature11247` (ENCODE), `10.1016/S0140-6736(97)11096-0` (Wakefield works + updates), `10.1016/j.foreco.2013.06.030`; Unpaywall `10.1038/s41586-020-2649-2` and `10.1371/journal.pone.0000001`; Open Library ISBN `9780226458083` and search "The Economic Consequences of the Peace"; PubMed `31978945`; arXiv `1706.03762` and an old-style id. Synthetic (hand-written, `cassettes/synthetic/`): OpenAlex 429 `Insufficient budget`, Unpaywall legacy `family`/`given`, a Crossref 200 with an inner 403. A live 429 during recording keeps the committed recording and is listed as open (OpenAlex keyed, S2 keyless). Offline unit tests assert real field values.
12. **Live lane (D-19-25).** `scripts/live-sources.mjs` + `npm run live:sources`: arXiv search and `1706.03762`; Unpaywall both DOIs (authors, OA PDF); Crossref ENCODE, nature14539 (journal/volume/issue/pages), Wakefield `retracted: true`; OpenAlex keyed round trip (visible skip without a key); S2 (keyed or the keyless reason); books ISBN and search; exits non-zero on any failed assertion.
13. **Retraction CLI (SRC-04).** `tests/verify-retraction-cli.test.ts`: a seeded paper whose section cites the Wakefield DOI → `verify 1` records a blocking verdict naming the retraction, section status failed; `compile --yolo` and `done --yolo` exit 4 (the verdict label becomes RETRACTED in Phase 20, VRFY-15).
14. **Docs.** PRD §8 note (JSTOR / PsycNET / PhilPapers reached through OpenAlex / Crossref / PubMed coverage, with the reason; `nber` = Crossref prefix 10.3386).

**Verification.** New and updated tests; the full gate; `npm run live:sources` passes (keyed checks print their skip notices); `node -e` probes through the built `dist/bin/lib/sources/*` for the ENCODE and nature14539 records.

### 5.3 Stream `research` — SRC-07, SRC-08, SRC-09, SRC-10, GRND-17

**Goal.** Research is seeded from the brief, asks the right scope question, runs 5–10 focused queries against the preset's adapters, tiers and filters what it finds, respects the evaluator, reports every adapter's outcome, and writes a RESEARCH.md a student can read; `plan N --research` adds real hits to section N only.

**Owned paths.**
- `bin/cli/research.ts`, `bin/lib/research-orchestrator.ts`
- `bin/lib/adapter-plan.ts`, `bin/lib/source-tier.ts`, `bin/lib/source-policy.ts`, `bin/lib/query-expansion.ts`, `bin/lib/section-research.ts` (all new)
- `bin/lib/revise.ts` (the research branch), `bin/cli/plan.ts` (the `--research` branch), `bin/cli/revise.ts` (the `--research` branch)
- `bin/lib/llm-contracts.ts` (`TopicDisambiguatorSchema`, `SourceEvaluatorSchema` and their coercers), `bin/lib/llm-stubs.ts` (the `topic-disambiguator` and `source-evaluator` entries), `bin/lib/llm-models.ts` (those two slug rows, if budgets change), `bin/lib/estimator.ts` (the research row only)
- `templates/prompts/topic-disambiguator.md`, `templates/prompts/source-evaluator.md` and their lines in `bin/lib/prompt-loader.ts` `EXPECTED_PROMPT_HASHES` and `tests/repo-files.test.ts`
- `bin/lib/schemas/config.ts` (`SOURCE_DATABASES` only)
- `workflows/research.md` (all but the Zotero lines), `workflows/plan.md` (the `--research` paragraph)
- tests: `tests/research*.test.ts`, `tests/adapter-plan*.test.ts`, `tests/source-tier*.test.ts`, `tests/source-policy*.test.ts`, `tests/query-expansion*.test.ts`, `tests/section-research*.test.ts`, `tests/plan-research*.test.ts`, `tests/revise*.test.ts` (research cases), `tests/gates-plan-research.test.ts`, `tests/prompt-research-contracts.test.ts`, `tests/estimator.test.ts` (research row)
- `PRD.md` §7.2, §7.5 (the `--research` sentence), §10 `[sources]`

**Tasks.**
1. Apply seams S-A and S-B.
2. **Contracts and templates (SRC-08, SRC-09, D-19-02).** `TopicDisambiguatorSchema` `{ambiguous, scopes[1..3]{label, description, queries[1..20]}}`; `SourceEvaluatorSchema` `{verdicts[{citekey, keep, reason, relevance, tier}]}`; stubs built from `requestHints` (the disambiguator stub = `query-expansion.ts` of `hints.topic`/`hints.discipline`; the evaluator stub keeps every `hints.candidates` citekey with a deterministic relevance and the `tier_hint`); both templates rewritten as fixed instructions in Phase 18's layout (`inputs:` = the S-A `PROMPT_INPUTS` tags, `## Inputs`, the verbatim fence paragraph, a JSON Output Format example, candidates sent once), re-pinned in both hash maps; `tests/prompt-research-contracts.test.ts` parses each template's example through its schema and checks the layout rules for these two slugs.
3. **Query expansion (SRC-08).** `query-expansion.ts`: deterministic 5–10 queries from topic keywords (stop words dropped, ≤ 8 words, discipline term added), property-tested (deterministic, bounded, non-empty, no duplicate).
4. **research.ts (SRC-07, SRC-08, SRC-09, D-19-15, D-19-16).** Brief from `readIntakeBrief`; the disambiguator via `buildPromptRequest`; clamp/pad; `--scope`, `--queries`; the up-front refusals; adapter plan; discovery; tiers; evaluator; policy; the prune gate (kept preselected, rejected deselected with reasons, tier and abstract excerpt in each option); `crossCheckRetractions` statuses; `upsertSources` carrying type / tier / relevance / why_relevant / retraction_status; RESEARCH.md per §3.4 (the log around `renderSourcesBlock`); stdout per §3.5; exit codes (D-19-27). An in-process registry test seam (`__setResearchRegistryForTest`, active only under `isTestContext`) lets tests run the real verb against fake adapters.
5. **Adapter plan, tiers, policy (SRC-09, SRC-10).** `adapter-plan.ts` (preference → adapters incl. `nber` / substitutes, allowed_databases, zotero, rank), `source-tier.ts`, `source-policy.ts` (PRD §10 defaults; `require_doi` = a registrar identifier); `SOURCE_DATABASES` += `books`, `nber`.
6. **Orchestrator.** Evaluator through `buildPromptRequest` (payload per D-19-16, sent once), aggregated per-adapter outcomes, preference ranking, `fromYear`, no keep-all fallback, `RESEARCH_LOG_END` re-exported from `research-md.ts`; `applySourceEvaluations(candidates, verdicts, tierHints)` exported (pure) for PLUG-07.
7. **`plan N --research` (GRND-17, D-19-18).** `section-research.ts`; `plan.ts` and `revise.ts` `--research` branches call it; `applyResearch` and the `researchAdapter` default deleted; `plan-research` gate; PII redaction when `pii_redaction` is on; only section N's PLAN.md `assigned_sources` changes (under its lock), RESEARCH-LOG.md appended, RESEARCH.md sources refreshed. Tests: in-process with the registry seam and the mock LLM (hits added to §2 only; §1/§3 sha256 and mtime unchanged; RESEARCH.md prior content preserved; non-TTY without `--yolo` exits 3 before any file changes; zero hits → per-adapter reasons, exit 1).
8. **Estimator.** The research row reflects the real call pattern (one disambiguator call; evaluator calls = ⌈candidates / 150⌉ with a bounded payload).
9. **Docs.** `workflows/research.md` (steps: brief, scope question and `--scope`, 5–10 queries, adapter plan, per-adapter report, tiers and policy, evaluator, prune gate with add, RESEARCH.md), `workflows/plan.md`, PRD §7.2 (per-adapter reporting; tiers; RESEARCH.md content), §7.5, §10 `[sources]` (`require_doi` meaning; `allowed_databases` values incl. books, nber).

**Verification.** New and updated tests; the full gate. User path (built CLI, mock LLM, scratch paper seeded with a v1 INTAKE.md via S-A `renderIntakeDocument`): `research --yolo` with a scripted ambiguous disambiguator → non-TTY without `--yolo`/`--scope` exits 3 with 0 captured model requests; `--scope 2 --yolo --show-prompts` shows scope 2's queries; a scripted 12-query scope issues 10; `PENSMITH_NO_LLM=1 research --yolo` prints the disclosed expansion; a reject-all evaluator exits 1 with `no relevant sources` and LIBRARY.json unchanged; RESEARCH.md shape per §3.4. (Fixture-lane runs with recorded cassettes are in §7.)

### 5.4 Stream `library` — SRC-12, SRC-13, SRC-14, SRC-15, GRND-14, SEC-02

**Goal.** CITATIONS.bib always parses and carries what a reference needs; `add` identifies the right work or refuses; bring-your-own PDFs are ingested with hashes and read only through a re-hash; PDF parsing can be killed; the drafter can know which sources have full text.

**Owned paths.**
- `bin/lib/bibtex-write.ts`, `bin/lib/ris-write.ts`, `bin/lib/person-name.ts` (new), `bin/lib/citations.ts` (the parse side: `parseBib*` eprint preservation; never `resolveStyleName`), `bin/lib/library.ts` (outside the seam hunks: `rerenderCitations`)
- `bin/cli/add.ts`, `bin/lib/source-input.ts` (new), `bin/lib/doi.ts`, `bin/lib/pdf-identify.ts` (new), `bin/lib/section-relevance.ts` (new)
- `bin/lib/byo-ingest.ts`, `bin/lib/byo-text.ts`, `bin/lib/full-text.ts` (all new)
- `bin/lib/pdf-text.ts`, `bin/lib/pdf-worker.ts` (new), `bin/lib/pymupdf-shellout.ts`, `bin/lib/pdf-text-shim.d.ts`
- `bin/cli/intake.ts` (the `--pdfs` argument and its one ingest call), `bin/cli/verify.ts` (the bib re-render before Pass 1)
- `eslint.config.js` (the pdf-parse exemption names `bin/lib/pdf-worker.ts`)
- `scripts/gen-byo-pdf.mjs`, `tests/fixtures/byo/**` (new), `tests/fixtures/pdf/**`
- `.planning/SECURITY.md` (row 9)
- tests: `tests/bibtex-*.test.ts`, `tests/person-name*.test.ts`, `tests/citation-render*.test.ts` (the APA cases), `tests/library-writer.test.ts` (bib rendering assertions), `tests/add-*.test.ts`, `tests/source-input*.test.ts`, `tests/doi*.test.ts`, `tests/pdf-*.test.ts`, `tests/pymupdf-*.test.ts`, `tests/byo-*.test.ts`, `tests/full-text*.test.ts`, `tests/section-relevance*.test.ts`, `tests/verify-bib-regen*.test.ts`, `tests/compile-bib-regen.test.ts`
- `workflows/add.md`, `workflows/new.md` (the `--pdfs` paragraph), `PRIVACY.md` (the BYO section), `PRD.md` §7.15, §9

**Tasks.**
1. Apply seams S-A and S-B.
2. **BibTeX (SRC-12, D-19-19).** `person-name.ts`; the writer's fields, types, raw UTF-8 names, eprint fields; `parseBib` preserving eprint/archivePrefix; the names test (`Эсенаманов, Байэл`, `Ashish Vaswani`, `van der Maaten, Ernst`, `王小明`, `Παπαδόπουλος, Γιώργος`); fast-check ≥ 1000 runs; APA `(Vaswani & Shazeer, 2017)` from the offline renderer, and from pandoc citeproc when pandoc is on PATH; `abstract = {…}` whenever the entry has one; `rerenderCitations(root)` and verify's re-render of a non-parsing bib (the E2E-12 Cyrillic bib regenerated, verify proceeds).
3. **Identifier input (SRC-13).** `source-input.ts` + doi.ts normalizers (`DOI: ` prefix with space, `%2F` doi.org URLs, old-style arXiv with upper-case archive and version, trailing period), idempotence property kept.
4. **PDF worker (SEC-02, D-19-22).** `pdf-worker.ts`, `extractPdf` / `extractPdfText`, settled guard, awaited terminate, captured worker output, entry resolution in both layouts (tested: from source under tsx and from `dist/` via the built module), the PyMuPDF changes (`import pymupdf` / `fitz`, result file, image-only), race tests (a worker finishing 1 ms before the timeout returns its result; a hanging worker is terminated, the live worker count returns to 0 and the process exits), the ESLint exemption, SECURITY.md row 9 → PROVEN.
5. **PDF identification (SRC-13, SRC-15).** `pdf-identify.ts` per D-19-20; fixtures from `scripts/gen-byo-pdf.mjs`: an arXiv-layout PDF (permission notice line 1, title line 3, author line, arXiv stamp), a DOI-in-footer PDF, a no-match PDF, an image-only PDF, a second real-metadata PDF for folder ingest. Hydration requests carry only the title or identifier (MockAgent asserts one lookup request per PDF and no body/text in any URL).
6. **`add` (SRC-13, SRC-14, D-19-20).** Classification; arXiv / PMID / DOI hydration through the adapters' `fetchById` (handling `SourceLookupError` as `lookup failed (<reason>)`, exit 1); arXiv URLs as identifiers; PDFs through identification (refusal message, exit 1, nothing changed); `--pdf <file>`; URLs through the transport with `checkPdfResponse` (`not a PDF (got text/html)`, no pdf-parse output); SSRF reason printed, exit 1; LIBRARY + RESEARCH.md refresh; remap relevance and the multi-select; the real (suffixed) key in every message and PLAN.md; `--remap <key> --section N` touches only §N.
7. **BYO (SRC-15, D-19-21).** `byo-ingest.ts` (dir or files; idempotent by sha256; `.paper/sources/<citekey>.pdf`; LIBRARY `byo` + provenance `byo`; unhydrated with a warning), `byo-text.ts` (re-hash, data-dir text cache, loose `.txt` ignored), `new --pdfs <dir>` (records `[sources] byo_pdf_dir` through `updatePaperConfig`), `add <dir>`. Tests: two PDFs → two entries tagged bring-your-own and listed in RESEARCH.md; a later upsert of a search hit with the same DOI merges into one entry with both tags; edited PDF and a forged `.paper/sources/<citekey>.txt` → `byoText` unavailable.
8. **Full text (GRND-14, D-19-23).** `full-text.ts` `fullTextAvailable`, `quotesWithoutFullText` (reusing the quote extractor), unit-tested; the merge adaptation is in §9.
9. **Docs.** `workflows/add.md` (inputs, identification and refusal, `--pdf`, remap), `workflows/new.md` (`--pdfs`), PRIVACY.md (BYO: text and PDFs stay local; only a title or identifier leaves; hashes; the cache), PRD §7.15, §9.

**Verification.** New and updated tests; the full gate. User path (built CLI, scratch paper): `add` of the arXiv-layout fixture under the test runner → the arXiv id stamped on its first page resolves it to "Attention Is All You Need" through the committed arXiv recording (the title-search path is covered in-process with MockAgent; its recorded CLI run is the integration pass's); the no-match PDF refuses with exit 1 and CITATIONS.bib unchanged; `new --from a.txt --pdfs <dir> --yolo` with `PENSMITH_NO_LLM=1` ingests both PDFs (hydration requests recorded in SESSION.log carry only titles/identifiers); a bib with the E2E-12 name re-renders on `verify 1`. (ISBN and live identifier checks are in §7/§10.)

## 6. Hot files and regions

| File | Main owner | Other stream regions |
|---|---|---|
| `bin/lib/http.ts` | net | seam S-B hunks frozen for everyone |
| `bin/lib/library.ts` | library (`rerenderCitations`) | seam S-B hunks frozen |
| `bin/lib/sources/index.ts` | adapters | net → the `zotero` import and registry line |
| `workflows/research.md` | research | net → the capability_check Zotero lines and the step-3 Zotero bullets |
| `PRIVACY.md` | library (BYO section) | net → the contact-email and Zotero sections |
| `PRD.md` | — | section-local per D-19-28 (net §11 §12; adapters §8 note; research §7.2 §7.5 §10 `[sources]`; library §7.15 §9; seam §7.20) |
| `bin/lib/prompt-loader.ts` `EXPECTED_PROMPT_HASHES`, `tests/repo-files.test.ts` | research (its two slugs' lines) | none |
| `bin/lib/llm-contracts.ts`, `bin/lib/llm-stubs.ts` | research (the two slugs' regions) | none |
| `package.json` | adapters (`live:sources`) | none |
| `eslint.config.js` | library (pdf-parse exemption) | none |
| `bin/lib/verify/pass3.ts` | adapters | none (library keeps `extractPdfText`'s contract, so Pass 3 needs no library edit) |
| `mcp/tools.ts` | net | none |
| `tests/fixtures/cassettes/**` | adapters | net → `synthetic/net/**`, `synthetic/zotero/**` |
| `README.md`, `CONTRIBUTING.md`, `README-DEV.md`, `CLAUDE.md` | integration pass | none during the streams |

A merge conflict inside a hot file is resolved by keeping every stream's region; the integration pass re-runs the full gate after each merge.

## 7. Integration pass (after the four streams merge into `v1/p19`)

1. Merge `net`, `adapters`, `library`, `research` (any order), resolving §6 regions; `npm run check` after each merge.
2. **Cross-stream wiring.**
   - research ← library: ingest new PDFs in `[sources] byo_pdf_dir` before discovery; LIBRARY BYO entries without an evaluation join the tier/evaluator pass; the `research-prune` gate's "add a source (DOI, arXiv id or URL)" input goes through `add`'s identification and the library writer before the list is written.
   - library ← adapters: `add isbn:<ISBN>` through `books.lookupById`; arXiv / PMID through `lookupById` where the stream used `fetchById`.
   - library ← net: BYO identification calls `grobidHeader` first when `PENSMITH_GROBID_URL` is set.
   - research ← net: the adapter plan's `zotero` entry reaches the Zotero client with `zotero_collection`.
   - The `contact-email` chokepoint row (`scripts/chokepoints/contact-email.json`: reading `PENSMITH_CONTACT_EMAIL` or `contact_email_env` only in `bin/lib/contact-email.ts`), its failing fixture, and the CLAUDE.md row.
3. **Recordings.** `npm run cassettes:refresh` for every adapter (`PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org`); the redirect-to-PDF recording (w3 `dummy.pdf`, D-19-07); the fixture-lane scenarios the §7.4 tests replay (the attention topic with scripted queries, a History/Keynes book scenario, the Wakefield section, `plan 2 --research "instagram adolescent depression longitudinal"`, the identification lookups of every `tests/fixtures/byo/` PDF and of the `add` identifier forms), with scrub and size checks.
4. **Cross-stream acceptance tests** (spawned built CLI, mock LLM, recorded fixtures, isolated data dir): `tests/research-cli-lane.test.ts` (SRC-07 table on stdout and in RESEARCH.md; SRC-09 per-source tier, abstract and why-relevant = evaluator reason; SRC-10 `min_year = 2015` + `allow_preprints = false` → no pre-2015 item and no arXiv-only preprint; the prune gate in numbered mode shows tiers, excerpts, rejected-with-reason and accepts an added DOI), `tests/byo-new-cli.test.ts` (SRC-15 `new --from a.txt --pdfs fixtures/byo/`, the DOI merge with a search hit, the outline assigning a BYO source and the draft citing it), `tests/add-identifiers-cli.test.ts` (SRC-11 `add isbn:9780226458083` → `@book` with publisher and year; SRC-13 every identifier form; SRC-01 `add https://arxiv.org/pdf/1706.03762.pdf --yolo` → vaswani2017; the recorded redirect-to-PDF URL refused as unidentifiable), `tests/plan-research-cli.test.ts` (GRND-17 fixture lane), `tests/zotero-research.test.ts` (SRC-16: `zotero_collection = "Thesis"` pulls only that collection into LIBRARY.json tagged zotero; an item whose DOI exists merges).
5. **Docs sweep.** README (environment variables: `OPENALEX_API_KEY` now used, `PENSMITH_S2_API_KEY`, `ZOTERO_API_KEY`, `ZOTERO_GROUP_ID`, `PENSMITH_ZOTERO_LOCAL`, `PENSMITH_GROBID_URL`, `[network] contact_email_env`; `research --scope/--queries`; `add` inputs and `--pdf`; `new --pdfs`; `plan --research`), CONTRIBUTING (recording redirects and binary bodies; `npm run live:sources`; the fixture rules), README-DEV, CLAUDE.md (the source-layer paragraph: three-way lookups, per-host politeness, LIBRARY v3, RESEARCH.md as a view; the chokepoint table: `contact-email` new, pdf-parse row names the worker).
6. **Full gate.** `npm run check`; `node scripts/e2e-smoke.mjs`; `git status --porcelain` clean after build; the data-dir fingerprint unchanged.
7. **User-path acceptance** (§10) in `scratchpad/p19/integration/`, built CLI and installed tarball where stated, live where marked; `npm run live:sources`; `claude plugin validate .` (informational; PLUG-01 owns the manifest).
8. **Close-out on `v1/p19` only.** `19-VERIFICATION.md` (every §10 check with evidence; open items: the OpenAlex keyed recording and round trip without a key, GRND-14's merge-time acceptance, anything a live 429 blocked); `19-SUMMARY.md` with "Merge notes for Phase 18" (§9, updated with what the streams found) and the Phase 20/23 hand-offs; REQUIREMENTS.md checkboxes and traceability for met requirements; ROADMAP Phase 19 status; STATE.md. Conflicts with Phase 18's close-out edits are resolved at merge time.

## 8. Tests that encode superseded behaviour (updated, not skipped)

- Seam S-B (already updated): the LIBRARY.json version assertions in `library-writer`, `library` and `schemas` (v2 → v3, and the v1 → v2 → v3 chain); the planned-gate list in `gates-registry`.
- net: tests expecting the `(<email>)` User-Agent form (→ `(mailto:<email>)`); tests expecting five attempts against a failing host (the breaker now stops at three consecutive failures; `retry.test.ts` keeps testing `retry()` itself unchanged); `http.test.ts` cases that expected a 3xx returned as-is (→ followed or refused); `tests/sources/zotero-mcp.test.ts` and doctor tests built on `setZoteroClientForTest` and presence-only "authenticated" (→ the real client with MockAgent; the authenticated check).
- adapters: offline tests that asserted fixture-only shapes (Unpaywall legacy-only, arXiv without `arxiv`), `retraction-cross-check` "failures are swallowed" (→ `unknown` status), the Semantic Scholar keyless notice text, any Pass-1 expectation of FABRICATED for a 5xx (→ UNVERIFIABLE).
- research: `research-discovery` / `research-sentinel` (reject-all keep-all → `no relevant sources`; evaluator failure → kept with a disclosure; the old interpolated request text), revise tests injecting `researchAdapter` (→ `section-research`), gate tests for research's refusal message with `--scope`.
- library: `add-source` / `add-url-pdf` / `add-remap-section` (the offline URL refusal, `hits[0]` hydration and remap-every-section are gone), `bibtex-write` name expectations, `pdf-text-bounds` (Promise.race → worker), `pymupdf-shellout` / `pymupdf-python-interp` (`fitz` on stdout → `pymupdf` and a result file).

## 9. Merge notes for Phase 18 (rebase targets) and hand-offs

Phase 19 merges after Phase 18 closes. The merge base is `20f2641`; both branches apply seam S-A identically. For each file both phases touch:

| File | Phase 18 change | Phase 19 change | Resolution |
|---|---|---|---|
| `bin/lib/gates.ts`, `PRD.md` §7.20 | S-A gates/rows | S-B `plan-research` gate and row | adjacent hunks: keep both |
| `bin/cli/research.ts` | disambiguator request assembly (~113–139) in the new layout | whole verb rewritten, already on the S-A layout | take Phase 19's; confirm Phase 18's `research --yolo --show-prompts` topic check still passes (both read the brief) |
| `bin/lib/research-orchestrator.ts` | evaluator request assembly (~165–185) | evaluator rewritten on the S-A layout with the extended contract | take Phase 19's |
| `templates/prompts/topic-disambiguator.md`, `source-evaluator.md` + their hash lines | layout rewrite, same semantics | layout + extended contract | take Phase 19's text; re-pin `EXPECTED_PROMPT_HASHES` and `PENDING_HASH_PINS`; Phase 18's `tests/prompt-layout.test.ts` must pass on them (it will: same layout rules) |
| `bin/lib/llm-contracts.ts`, `llm-stubs.ts` (the two slugs) | stubs read `hints.topic` / `hints.candidates` | extended contracts and stubs reading the same hints | take Phase 19's two entries; keep Phase 18's framework and other slugs |
| `bin/lib/source-context.ts` (Phase 18, new) | `fullTextAvailable(entry)`: `byo === true` or an `oa_url` | — | make it delegate to `bin/lib/full-text.ts` `fullTextAvailable` (GRND-14) |
| `bin/lib/draft-containment.ts` (Phase 18, new) | `checkDraft` violation kinds | — | add `quote-without-full-text` using `quotesWithoutFullText`; then run GRND-14's acceptance: the captured drafter request marks each source's `full_text`; a mock drafter quoting a source without full text is corrected on the one retry into a paraphrase or an OA quote |
| `bin/cli/intake.ts` | rewritten `new` (D-18-09 order) | `--pdfs <dir>` argument + one `ingestByoPdfs` call after STATE/INTAKE are written | re-apply the Phase 19 hunk onto Phase 18's file after the brief is written; add `--pdfs` to Phase 18's flag list and `workflows/new.md` |
| `bin/cli/plan.ts` | normal path rewritten; `--revise`/`--research` branch byte-identical to the base | `--research` branch → `section-research.ts` | applies cleanly; adapt `section-research.ts` to Phase 18's section identity (`1a` ids, slug-found folders, stub PLAN.md) — PLAN.md `assigned_sources` is still the planner's allowed set (D-18-23) |
| `bin/cli/verify.ts` | export of the one-section verification | bib re-render before Pass 1 | keep both hunks |
| `bin/lib/estimator.ts` | section ordering | research row | separate regions |
| `tests/schemas.test.ts` | `CURRENT_STATE_VERSION` 3 | `CURRENT_LIBRARY_VERSION` 3 | adjacent lines: keep both |
| `workflows/research.md` | template/data description | steps and Zotero | merge by paragraph |
| `workflows/new.md`, `README.md`, `CONTRIBUTING.md`, `CLAUDE.md` | intake / quick start / prompt layout / chokepoints | `--pdfs`, env vars, sources, chokepoints | merge by section |
| `PRD.md` §7.2, §8, §10 | intake (§7.2 brief, §8 values, §10 `[project]`) | §7.2 research paragraph, §8 note, §10 `[sources]` | merge by paragraph |
| e2e corpus (`tests/fixtures/cassettes/e2e/**`, D-18-31) | recorded with Phase 17 adapter URLs | adapter URLs changed | re-record: `npm run cassettes:refresh -- --corpus e2e`; keep `tests/e2e-chain.test.ts` green |

Hand-offs: Phase 20 builds on `lookupById` (VRFY-12 names and the identifier-less search), `byoText` (VRFY-19 Pass 3/Pass 2 BYO text), the Unpaywall `oa_locations` and `checkPdfResponse` (VRFY-19), `retraction_status` and the RETRACTED label (VRFY-15), and ISBN / arXiv / PMID lookups for Pass 1 (NFR-45). Phase 23 (PLUG-07) exposes the research contracts through `paper_get_research_context` / `paper_submit_research_queries` / `paper_submit_source_evaluations` using the exported schemas and `applySourceEvaluations`, and PLUG-02 adds the PDF worker's bundle layout to the SEC-02 layout test. Phase 26 (HARDEN-02) runs `npm run live:sources` in `live.yml`.

## 10. Acceptance checks (user path)

Run with the built CLI (`dist/bin/pensmith.js`, or the installed tarball where stated) in scratch folders under `scratchpad/p19/`, with `XDG_DATA_HOME`/`HOME` inside the folder, the RUN-21 mock as the model, fixtures under the test runner or live where marked (`PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org`).

| Req | Check |
|---|---|
| SRC-01 | MockAgent: 301 → 302 → 200 application/pdf returns the final bytes; redirects to 127.0.0.1 and 169.254.169.254 refused, target receives 0 requests; a 6-hop chain errors `too many redirects`; Authorization absent on the cross-origin hop. `add https://arxiv.org/pdf/1706.03762.pdf --yolo` adds vaswani2017 (fixture and live). A `.pdf` URL answering text/html prints `not a PDF (got text/html)` with no pdf-parse output and exits 1. A mocked Unpaywall answer pointing Pass 3 at `http://127.0.0.1:<port>/x.pdf` is refused and the listener gets 0 requests; `add http://127.0.0.1:<port>/x.pdf` prints the SSRF reason and exits 1. |
| SRC-02 | Live: `arxiv.search('attention mechanisms in transformers')` ≥ 1 result; `fetchById('1706.03762')` → "Attention Is All You Need" with `arxiv = 1706.03762`. The re-recorded cassette's offline test asserts the real id, DOI, abstract and type. |
| SRC-03 | Live: Unpaywall `10.1038/s41586-020-2649-2` and `10.1371/journal.pone.0000001` → non-empty authors and an OA PDF URL. Offline tests for the `raw_author_name` recording and the legacy `family`/`given` shape. With the email unset, `verify 1` on a quoting section prints `Unpaywall skipped: set PENSMITH_CONTACT_EMAIL` and the Pass-3 reason says so. |
| SRC-04 | The re-recorded Wakefield cassette makes `crossref.fetchById('10.1016/S0140-6736(97)11096-0')` return `retracted: true` (and live). MockAgent: a 200 with an inner 400/403 body is a failure, not cached, and shows `retraction status unknown` in research's output, RESEARCH.md and VERIFICATION.md. Spawned CLI: `verify 1` citing Wakefield → a blocking verdict naming the retraction; `compile --yolo` and `done --yolo` exit 4. |
| SRC-05 | Live: `crossref.fetchById('10.1038/nature11247')` returns the ENCODE consortium record; `('10.1038/nature14539')` has Nature, 521, 7553, 436-444, and its APA rendering includes the journal and volume. MockAgent: Crossref 503 after retries → failed; 404 → not-found; the three-way contract unit-tested for OpenAlex, PubMed, arXiv, Semantic Scholar, Unpaywall and books. |
| SRC-06 | MockAgent: with `OPENALEX_API_KEY`, requests carry `api_key`, SESSION.log shows `REDACTED`, the cache key equals the keyless one and no cache file contains the key; `tests/cassette-no-leak` scans query parameters. The 429 `Insufficient budget` fixture → `openalex: 0 (keyless daily budget exhausted — set OPENALEX_API_KEY (free))` and research completes from the other adapters. Live keyed round trip when a key is present (else a visible skip, recorded as open); the `openalex.ts` TODO is gone. |
| SRC-07 | Fixture lane: research stdout and RESEARCH.md carry the per-adapter table listing crossref, openalex, pubmed, arxiv and semanticscholar with counts or reasons. A mock evaluator rejecting every candidate → `no relevant sources`, exit 1, LIBRARY.json unchanged. Live: a French Revolution assignment → LIBRARY.json with no fixture DOIs and ≥ 3 entries whose title or abstract contains a topic keyword. |
| SRC-08 | Mock `ambiguous: true` with 2 scopes: non-TTY without `--yolo`/`--scope` exits 3 before any request; `--scope 2 --yolo` issues scope 2's queries (captured URLs). A 7-query scope → 7 queries per selected adapter (request log); 3 → padded to 5, 12 → clamped to 10. `PENSMITH_NO_LLM=1` → the disclosed deterministic expansion. Live: `research --yolo` for "social media use and adolescent depression" → ≥ 5 LIBRARY entries whose titles contain a topic term and none of the fixture papers. |
| SRC-09 | Mock LLM, fixtures: RESEARCH.md lists every kept source with its tier, abstract and why-relevant text equal to the evaluator reason; LIBRARY entries carry tier, why_relevant and relevance and validate against v3; a v2 LIBRARY.json fixture migrates on load. `peer_reviewed_only = true` drops preprints; `min_year = 2015` drops older works (unit and CLI). Non-TTY without `--yolo` exits 3. The prune gate shows tiers and excerpts, lists rejected candidates with reasons as deselected but selectable, and accepts a DOI to add before the list is written. The captured evaluator request contains each candidate once. |
| SRC-10 | Unit (MockAgent): a computer-science paper queries arXiv, Semantic Scholar and OpenAlex first, in that order, and ranks ties by preference; `allowed_databases = ["openalex"]` → only OpenAlex requests. Fixture lane: `min_year = 2015`, `allow_preprints = false` → no pre-2015 item and no arXiv-only preprint in LIBRARY.json. |
| SRC-11 | Live: a History paper's research returns ≥ 1 `@book` entry with an ISBN (e.g. "The Economic Consequences of the Peace"). `add isbn:9780226458083` adds Kuhn's *The Structure of Scientific Revolutions* as `@book` with publisher and year (fixture and live). The PRD §8 diff documents the JSTOR / PsycNET / PhilPapers substitution with its reason. |
| SRC-12 | `writeBibtex` with the five SRC-12 names parses and round-trips family/given exactly; fast-check ≥ 1000 runs lossless; `(Vaswani & Shazeer, 2017)` from the offline renderer and from pandoc citeproc (pandoc on PATH); `abstract = {…}` present whenever the entry has one; a legacy broken bib is regenerated from LIBRARY.json on `verify`. Live: research fetches `10.1016/j.foreco.2013.06.030`, then `verify` gives Pass-1 OK. |
| SRC-13 | `add arXiv:1706.03762`, `add 1706.03762`, `add https://arxiv.org/abs/1706.03762` → Vaswani 2017 with `eprint = {1706.03762}` and `archivePrefix = {arXiv}`. The attention-paper PDF fixture resolves to Vaswani 2017, never mineault2025 / oohora2023 / engel2009 (fixtures and live). A no-match PDF exits 1 with the refusal message and CITATIONS.bib unchanged. `add PMID:31978945`, `add pmid:31978945`, `DOI: 10.1038/nature14539`, a `%2F` doi.org URL, `hep-th/9901001v2`, `math.GT/0309136`, an upper-case archive and a trailing period all normalize. |
| SRC-14 | After `add`, LIBRARY.json and RESEARCH.md contain the key; a colliding work's message and PLAN.md use the suffixed key; under a pty the remap preselects only relevant sections; `add --remap <key> --section 2` changes only §2 (other sections' mtimes unchanged). |
| SRC-15 | `new --from a.txt --pdfs fixtures/byo/` with 2 generated PDFs → 2 entries tagged bring-your-own, listed under that tag in RESEARCH.md; a search hit with the same DOI merges into one entry with both tags. The arXiv-layout PDF hydrates to "Attention Is All You Need"; a no-match PDF is added unhydrated with a warning, never as a search hit; a DOI-in-footer PDF hydrates by DOI. MockAgent: one title or identifier lookup per PDF, no full-text egress. The outline assigns a BYO source and the draft cites it. An edited PDF or a forged `.paper/sources/<key>.txt` never makes BYO text available. PyMuPDF runs when pdf-parse throws; warnings on stdout/stderr are never text; an image-only PDF yields `no extractable text` (add refuses, BYO keeps it unhydrated). |
| SRC-16 | MockAgent: `ZOTERO_API_KEY` + `zotero_collection = "Thesis"` → only that collection's items in LIBRARY.json, tagged zotero; an item whose DOI exists merges. doctor → `Zotero: authenticated` on 200, `Zotero: key rejected` on 403, no placeholder URL; a server added with `claude mcp add` (isolated config dir) and a project `.mcp.json` are detected; `authenticated` never from key presence. MCP (built server): `paper_ingest_zotero_items` adds two items through bin/lib and rejects a malformed item with a schema error; the tier-contract case shows the same LIBRARY entries from both tiers. |
| SRC-17 | MockAgent: a Crossref request's User-Agent contains `(mailto:pensmith-dev@example.org)`; `x-rate-limit-limit: 1` / `x-rate-limit-interval: 1s` holds the host to ≤ 1 request/s (timestamps). `Retry-After: 22400` → one attempt, one `rate limit exhausted (retry after ~6 h)` line, no further requests to that host; 3 consecutive 503s open the breaker and a 3-query research run makes ≤ 3 requests to that host. A 200 failing the adapter's schema leaves the cache directory unchanged. `docs/SOURCES.md` lists the floors; PRD §12 is amended where they differ. Live: `x-api-pool: polite-*` on a Crossref response. |
| GRND-14 | Unit: `fullTextAvailable` and `quotesWithoutFullText`. At the Phase 18/19 merge (§9): the captured drafter request marks each source's full-text availability; a mock drafter quoting a source without full text is corrected on the one retry. |
| GRND-17 | Fixture lane and live: `plan 2 --research "instagram adolescent depression longitudinal" --yolo` reports > 0 hits, LIBRARY.json gains them with no duplicate DOI, and `sections/02-*/PLAN.md` `assigned_sources` includes them; sha256 of every file in `sections/01-*` and `sections/03-*` unchanged; RESEARCH.md's prior content preserved; non-TTY without `--yolo` exits 3 before any file changes. |
| SEC-02 | Race tests: a worker finishing 1 ms before the timeout returns its result; a hanging worker is terminated, the live worker count returns to 0 and the process exits cleanly; the worker entry resolves from source (tsx) and from `dist/`; `.planning/SECURITY.md` row 9 PROVEN. |

## 11. Risks

- **Live APIs rate-limit** (keyless OpenAlex and Semantic Scholar answered 429 during planning; Google Books' shared keyless quota was exhausted). Recordings keep the committed file on a 429; the live lane prints skip notices for missing keys; open items are listed, never faked.
- **No OpenAlex key.** The keyed round trip cannot be recorded or run here; D-19-10 makes it a maintainer item.
- **Cassette cap for binary bodies.** Only small real PDFs (≤ ~37 KB before base64) can be recorded; everything else uses MockAgent or generated fixtures.
- **Worker threads under tsx and on Windows.** Entry resolution is tested in both layouts; the CI matrix (CI-06, still unobserved) is the cross-OS evidence.
- **The breaker changes retry expectations.** A failing host now gets three attempts, not five; tests that assumed five are updated (§8).
- **Merge with Phase 18.** Many rebase targets (§9), all listed with a resolution; the two research templates and call sites are the largest.
- **PDF title heuristics.** A missed title is a refusal (single `add`) or an unhydrated entry (BYO) — never a wrong work — so failure is safe; fixtures cover the arXiv layout, a DOI footer and a no-match case.
- **Evaluator payload size.** Candidates are capped per call (150) with bounded abstracts; the estimator reflects the call count.
- **Zotero and GROBID are untestable live without accounts here.** MockAgent and loopback servers cover the protocol; the live lane checks Zotero only with a key.
