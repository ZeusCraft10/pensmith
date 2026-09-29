---
phase: 19-sources
verified: 2026-09-28
verified_at_branch: v1/p19 (after the integration pass; see 19-SUMMARY.md)
status: gaps_found
score: 19/20 requirements met; GRND-14 NOT met on this branch (its library half is built; the drafter half and the acceptance need Phase 18's drafter and run at the Phase 18/19 merge)
gaps: [GRND-14 (drafter wiring + acceptance at the Phase 18/19 merge; the flag's basis now equals Pass 3's — round 2)]
review_rounds: [round 1 (fixer, 2026-09-28): see §5, round 2 (fixer, 2026-09-29): see §6]
open_items: [OpenAlex keyed live round trip (no key), Semantic Scholar keyed round trip (no key), CI-06 cross-OS run (inherited from Phase 17)]
---

# Phase 19: Sources and Library (SOURCES): Verification

**Goal (ROADMAP):** every source adapter works against today's live APIs and reports failures to the user; every ingest goes through the Phase 17 library writer; books, hashed bring-your-own PDFs and Zotero items are first-class sources; the drafter and `plan --research` can use this phase's full-text flags and evaluator.

**Result:** met on the real user path for 19 of 20 requirements. GRND-14 is **not met** on this branch: nothing in this branch's drafter path reads the full-text flag, and no draft check enforces it — that half needs Phase 18's `source-context.ts` / `draft-containment.ts` and runs at the merge (19-PLAN §2, §9). Its library half (`full-text.ts`, now based on the text Pass 3 can actually check, and `oa_url` populated at ingest) is built and tested. Since review round 1, Pass 1 resolves a DOI-less entry at its own registrar (arXiv id, PMID, ISBN), so ROADMAP criterion 7's "a History paper can cite a book with an ISBN" holds end to end (verify, compile, done — §5).

## 1. Gate (integration HEAD, 2026-09-28, Node 22, Linux, as root)

| Step | Result |
|---|---|
| `npm run prebuild`, `npm run lint`, `npm run typecheck`, `npm run build` | exit 0 |
| `git status --porcelain` after the build | clean (only the worktree's untracked `node_modules` link) |
| `npm test` | 1973 tests: 1972 pass, 1 fail. The failure is `tests/atomic-write.test.ts` "preserves OLD content on rename/write failure", which is root-only (`chmod 0o500` does not stop root; documented in CLAUDE.md, passes in CI). No skips, no todos. |
| `npm run test:tier-contract` | exit 0: 55/55 pass |
| `npm run validate:manifests` | exit 0 (plugin.json, marketplace.json and .mcp.json valid) |
| `node scripts/e2e-smoke.mjs` | exit 0: PASS=10, FINDING=0, FAIL=0 |
| `npm run live:sources` (`PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org`) | exit 0: 17 passed, 0 failed, 2 skipped (OpenAlex keyed, Semantic Scholar keyed: no keys) |
| `claude plugin validate .` (informational; PLUG-01 owns the manifest) | `plugins[0] plugin.json → skills: Invalid input` — unchanged since before Phase 17 |

## 2. User-path checks (built CLI, scratch folders under `scratchpad/p19/integrate/`, `XDG_DATA_HOME` inside each, `PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org`, sources live unless marked "fixture")

| # | Check | Observed |
|---|---|---|
| U1 | `add https://arxiv.org/pdf/1706.03762.pdf --yolo` (live) | `added vaswani2017.`, `vaswani2017 — Attention Is All You Need (2017)` — the arXiv PDF URL is an identifier; nothing downloaded |
| U2 | `add https://duckduckgo.com/paper.pdf --yolo` (live; a 200 HTML page at a `.pdf` URL) | `not a PDF (got text/html) — nothing added.`, exit 1, no PDF-parser output |
| U3 | `add http://127.0.0.1:9/x.pdf --yolo` (live) | `refused — SSRF guard: "127.0.0.1" resolves to private/reserved IP 127.0.0.1 — blocked (RFC1918/loopback/link-local)`, exit 1 |
| U4 | `add isbn:9780226458083 --yolo` (live) | `added kuhn1996.` — `@book{kuhn1996` with publisher University of Chicago Press, year 1996, ISBN |
| U5 | `add 10.1016/j.foreco.2013.06.030`, then `verify 1` on a draft citing it (live) | `vandermaaten2013: **OK** — titleJW=1.00, authorJW=1.00`; `author = {{van der Maaten}, Ernst}` round-trips |
| U6 | the same section, contact email unset, a 10-word quote (live) | stderr `pensmith: Unpaywall skipped: set PENSMITH_CONTACT_EMAIL — …`; the Pass-3 row: `PDF_UNAVAILABLE — Unpaywall skipped: set PENSMITH_CONTACT_EMAIL — the open-access copy of DOI … was not looked up` |
| U7 | `new --from a.txt` + `[project] discipline_preset = "history"`, `PENSMITH_NO_LLM=1 research --yolo` for the causes of the French Revolution (live) | exit 0. Adapter table: openalex 93, crossref 47, books 76, semanticscholar `failed (HTTP 429 — rate limited; set PENSMITH_S2_API_KEY)`, arxiv 100, pubmed 70, zotero `skipped (not configured)`; one breaker line for api.semanticscholar.org. LIBRARY.json v3: 247 entries, 37 with "French", "Revolution" or "1789" in the title or abstract (Censer 2018, Skocpol 1979, Sewell 1980 …), no fixture DOI; 45 books with an ISBN, 54 `@book` entries (SRC-07, SRC-11) |
| U8 | `plan 2 --research "instagram adolescent depression longitudinal"` without a terminal (live paper, 3 sections) | exit 3, `Add these research hits to the section? … needs an answer`, nothing written |
| U9 | the same with `--yolo` (live, `PENSMITH_NO_LLM=1`) | exit 0: pubmed 14, openalex 20, crossref 19, arxiv 20, semanticscholar 429; 55 sources added to §2's `assigned_sources` (55 new, no duplicate DOI); `sha256sum -c` of every §1 / §3 file: all OK; RESEARCH.md's earlier notes kept below the end line; RESEARCH-LOG.md entry |
| U10 | `add arXiv:1706.03762` under a real pty (three sections, only §2 about attention) | the multi-select shows `[+] §2 Attention-based sequence models` preselected, §1 and §3 not; Enter → `vaswani2017 mapped to §2 … (assigned_sources only)`; only §2's PLAN.md changed (SRC-14) |
| U11 | `add` of every `tests/fixtures/byo/` PDF (live) | arXiv layout → `identified by arXiv:1706.03762`, `added vaswani2017`; metadata DOI → `lecun2015`; DOI footer → `aspelmeyer2009`; no-match → refused (`could not confidently identify this PDF — pass its DOI …`, the Crossref/OpenAlex reason); image-only → `no extractable text`; title-only → refused this run (OpenAlex answered `Retry-After` 37 s → `rate limit exhausted (retry after ~37 s)`, Crossref has no confident match) — never a wrong work |
| U12 | Crossref through the built `http.js` (live) | with the email: `x-api-pool: polite-single`; without: `public-single` and the one no-contact line (SRC-17) |
| U13 | `http://www.w3.org/…/dummy.pdf` through the built `http.js` (live) | status 200, `finalUrl` https, 13264 bytes starting `%PDF-` (SRC-01) |
| U14 | pandoc 3.9 `--citeproc` with `apa.csl` on the library writer's bib | `LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521(7553), 436–444.`; `(Vaswani et al., 2017)`, `https://arxiv.org/abs/1706.03762` (SRC-05, SRC-12) |
| U15 | `npm run live:sources` | arXiv search and 1706.03762; old-style id; Unpaywall both DOIs with authors and an OA PDF; Crossref ENCODE, nature14539, Wakefield retracted; PubMed 31978945; OpenAlex keyless lookup; S2 keyless reason; books ISBN and "The Economic Consequences of the Peace" — all PASS; OpenAlex keyed and S2 keyed SKIP (no key) |

The stream write-ups record further live checks: doctor's Zotero states and the `claude mcp add` detection with an isolated `CLAUDE_CONFIG_DIR` (net), the Wakefield `verify` / `compile` / `done` exit 4 (adapters), the ambiguous-scope refusal and `--scope 2` (research), the E2E-12 Cyrillic bib re-render on `verify` (library).

## 3. Requirements

| Req | Status | Evidence |
|---|---|---|
| SRC-01 | met | MockAgent: `tests/http-redirect.test.ts` (301→302→200 PDF bytes; 127.0.0.1 and 169.254.169.254 refused with 0 target requests; 6 hops `too many redirects`; Authorization absent cross-origin; https→http and loops refused), `tests/ssrf-pinning.test.ts` (per-hop re-pin). Built CLI: `tests/add-identifiers-cli.test.ts` (arXiv pdf URL → vaswani2017; the recorded 301 chain to a real PDF followed and refused; a `.pdf` URL answering HTML → `not a PDF (got text/html)`, no parser output; a loopback listener never asked). `tests/pass3-oa-pdf.test.ts`: an Unpaywall answer pointing Pass 3 at a real loopback listener → SSRF reason, 0 listener requests. Live U1–U3, U13. |
| SRC-02 | met | U15; `tests/sources/arxiv.test.ts` on the re-recorded https cassette (id, DOI, abstract, type). |
| SRC-03 | met | U15; offline tests for the `raw_author_name` recording and the legacy `family`/`given` synthetic fixture (`tests/sources/unpaywall.test.ts`); U6 and `tests/pass3-oa-pdf.test.ts` (`Unpaywall skipped: set PENSMITH_CONTACT_EMAIL`, not "No OA PDF available"). |
| SRC-04 | met | Recorded and live Wakefield `retracted: true`; MockAgent inner-403 body → failure, not cached (`tests/sources/retraction-watch.test.ts`, `tests/sources/three-way.ts`); `retraction status unknown` with the lookup's reason on stderr and in RESEARCH.md (`tests/research-verb.test.ts`) and through Pass 1; `tests/verify-retraction-cli.test.ts`: `verify 1` blocking verdict naming the notice, `compile --yolo` / `done --yolo` exit 4. |
| SRC-05 | met | U15 (ENCODE, nature14539 Nature 521(7553) 436-444), U14 (APA with journal and volume); MockAgent 503 → failed, 404 → not-found; the three-way contract harness for OpenAlex, PubMed, arXiv, Semantic Scholar, Unpaywall and books. |
| SRC-06 | met (keyed live round trip open: no key) | MockAgent: `api_key` sent, `REDACTED` in SESSION.log, one cache key for keyed and keyless, no key in any cache file (`tests/http-cache-keys.test.ts`, `tests/sources/openalex.test.ts`); `tests/cassette-no-leak.test.ts` scans paths and Locations; the synthetic `Insufficient budget` 429 through the built CLI: `openalex … failed (keyless daily budget exhausted — set OPENALEX_API_KEY (free))` and research completes (`tests/research-cli-lane.test.ts`); the TODO is gone. `live:sources` prints the visible SKIP. |
| SRC-07 | met | Fixture lane (`tests/research-cli-lane.test.ts`): the per-adapter table on stdout and in RESEARCH.md for crossref, openalex, pubmed, arxiv and semanticscholar; a reject-all evaluator → `no relevant sources`, exit 1, no LIBRARY.json; the paper stays at the research stage (`research-sentinel.ts`). Live U7. |
| SRC-08 | met | `tests/research-scope-cli.test.ts`, `tests/research-verb.test.ts` (non-TTY without `--yolo`/`--scope` exits 3 before any request; `--scope 2 --yolo` issues scope 2's queries; 7 queries → 7 per adapter; 3 → 5; 12 → 10; `PENSMITH_NO_LLM` disclosed expansion); live runs U7 and the research stream's "social media use and adolescent depression" run (211 entries, 168 with a topic term, no fixture papers). |
| SRC-09 | met | Fixture lane: every kept source in RESEARCH.md with tier, abstract and why-relevant = the evaluator's reason; LIBRARY entries with tier / relevance / why_relevant at schema v3; v2 → v3 migration (`tests/library-v3.test.ts`); `peer_reviewed_only` / `min_year` (unit and CLI); the numbered prune question shows tiers and excerpts, lists rejections with reasons, and accepts a DOI to add before the list is written (`tests/research-cli-lane.test.ts`, `tests/research-prune-gate.test.ts`); each candidate sent once. |
| SRC-10 | met | `tests/adapter-plan.test.ts`, `tests/research-verb.test.ts` (computer science: arXiv, Semantic Scholar, OpenAlex first; `allowed_databases = ["openalex"]` → only OpenAlex); fixture lane `min_year = 2015` + `allow_preprints = false` → no pre-2015 work, no arXiv-only preprint, the exclusions listed with `allow_preprints`, the date-filtered requests made. |
| SRC-11 | met | U4, U7; `tests/add-identifiers-cli.test.ts` (fixture `@book` with publisher and year); PRD §8 note (JSTOR / PsycNET / PhilPapers through OpenAlex / Crossref / PubMed, with the reason). |
| SRC-12 | met | `tests/bibtex-roundtrip.test.ts` (the five names, fast-check ≥ 1000 runs, APA offline and through pandoc; PubMed's compact names), abstracts; `tests/verify-bib-regen.test.ts`; live U5. Round 1: PubMed's "Zhu N" is stored "Zhu, N." (and migrated v2 → v3), so a PMID-added source passes Pass 1 (`tests/verify-identifiers-cli.test.ts`, live L1). |
| SRC-13 | met | `tests/add-identifiers-cli.test.ts` (every arXiv / DOI / PMID spelling; eprint and archivePrefix); `tests/pdf-identify.test.ts` (the UX-19 wrong works refused; round 1: a DOI in a footnote / reference list is a cited work, never the PDF); `tests/add-pdf-attach-cli.test.ts` (round 1: `add <id> --pdf` refuses a PDF that is not the work without the user's word, never replaces an identified copy without `--replace-pdf`); `tests/doi-normalizers-src13.test.ts`; live U11. |
| SRC-14 | met | `tests/add-identifiers.test.ts`, `tests/add-remap-relevance.test.ts`, `tests/add-remap-section.test.ts`; U10 under a real pty. |
| SRC-15 | met | Round 1: Pass 3 checks quotes against the hash-verified BYO PDF first (verify, and the compile / done recomputation, `tests/pass3-byo-cli.test.ts`), Pass 2 reads its passages nearest each claim (`tests/pass2-byo.test.ts`), a config.toml folder outside the project is read only with the user's approval (`tests/own-source-approvals.test.ts`), and `new --pdfs` routes to research (`tests/byo-new-pdfs.test.ts`). `tests/byo-new-cli.test.ts` (built CLI: `new --pdfs` → 2 entries tagged bring-your-own; research merges a Crossref hit into the bring-your-own entry, both tags, key kept, and the evaluator annotates the other one — tier, relevance, why-relevant — without dropping it; outline assigns it; the draft cites it; Pass 1 OK), `tests/byo-ingest.test.ts` (no-match unhydrated with a warning; one lookup per PDF; forged `.txt` / edited PDF never used), `tests/byo-text.test.ts`, `tests/pdf-worker.test.ts`, `tests/pymupdf-result-file.test.ts`, `tests/pdf-identify-grobid.test.ts`. |
| SRC-16 | met | `tests/zotero-research.test.ts` (research pulls only the Thesis collection, tagged zotero; an existing DOI merges; a 403 is the row's reason), `tests/zotero-client.test.ts`, `tests/doctor-zotero.test.ts`, `tests/mcp-zotero-ingest.test.ts` (built MCP server; a malformed item → schema error), `tests/tier-contract/zotero-ingest.test.ts`; `setZoteroClientForTest` is gone; the net stream's live doctor checks. |
| SRC-17 | met | `tests/http-politeness.test.ts`, `tests/http-rate-limit.test.ts` (timestamps; `Retry-After: 22400` → one attempt, one `~6 h` line; round 1: only scholarly APIs' rate headers count, a declared rate slower than 1 / 30 s marks the host exhausted, the token wait is bounded by the request timeout), `tests/http-circuit.test.ts` (≤ 3 requests to a failing host over a 3-query run), the not-cached shape check (`tests/sources/three-way.ts`); `docs/SOURCES.md`, PRD §12; U12. |
| GRND-14 | **not met on this branch** (drafter half at the Phase 18/19 merge) | Library half: `tests/full-text.test.ts` (round 2: the flag is exactly what Pass 3 can check — a non-asserted hashed BYO PDF, an Unpaywall-confirmed `oa_url` of a DOI, or an arXiv id whose arXiv PDF Pass 3 fetches; a PMCID alone or an adapter's own link is not), `oa_url` written only from Unpaywall at ingest (`bin/lib/open-access.ts`; `tests/open-access.test.ts`), and `tests/pass3-oa-pdf.test.ts` asserting flag = "Pass 3 fetched text" for four entry kinds. Nothing on this branch's drafter path reads it: the drafter-side check needs Phase 18's `source-context.ts` and `draft-containment.ts` (19-SUMMARY merge notes list the wiring and both acceptance tests). |
| GRND-17 | met | `tests/plan-research-cli.test.ts` (built CLI, recorded Crossref / PubMed: hits added to §2 only, no duplicate DOI, §1 / §3 sha256 and mtimes unchanged, RESEARCH.md kept, exit 3 without a terminal); `tests/section-research.test.ts`; live U8, U9. |
| SEC-02 | met (cross-OS run open with CI-06) | `tests/pdf-worker.test.ts` (a result 1 ms before the timeout returned; a hanging parse terminated, live workers back to 0, the process exits; entry from source and from `dist/`); `.planning/SECURITY.md` row 9 PROVEN. |

## 4. Not verified here

- The OpenAlex keyed and Semantic Scholar keyed live round trips (no keys in this environment; `live:sources` SKIP lines).
- A live keyless OpenAlex 429 through research: node's egress still had keyless budget; the path is proven with MockAgent and the synthetic recording, and an OpenAlex `Retry-After` of 37 s was handled live (U11).
- Windows / macOS (CI-06).

## 5. Review round 1 (fixer, 2026-09-28)

Every finding of the round-1 review was reproduced first; the fixes, their tests and the rejected items are listed in 19-SUMMARY.md ("Review round 1"). User-path checks on the built CLI (scratch folders under `scratchpad/p19/fixer-r1/`, `XDG_DATA_HOME` / `HOME` inside each, `PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org`, `PENSMITH_NO_LLM=1`):

| # | Check | Observed |
|---|---|---|
| L1 | live: `add PMID:31978945`, `add isbn:9780226458083`, `add arXiv:1706.03762`, `add 10.1371/journal.pone.0000001`, then `verify 1` on a section citing all four, `compile --yolo`, `done --yolo` (pandoc 3.9) | `zhu2020` (bib `author = {Zhu, N. and Zhang, D. …}`, `pmid = {31978945}`), `kuhn1996` (authors `Thomas S. Kuhn` only), `vaswani2017`, `almeida2006` (`oa_url` = the PLOS PDF); Pass 1: all four **OK** (`ISBN 9780226458083 re-fetched from the books registries`, `arXiv:1706.03762 re-fetched from arXiv`); freshness `DOI HEAD ok` for every DOI (no 405 WARN); compile exit 0; done exported `DRAFT.docx` — ROADMAP criterion 7 end to end |
| L2 | offline: a `config.toml` with `byo_pdf_dir` pointing outside the paper, `research --yolo` | `WARN — [sources] byo_pdf_dir points outside the paper folder and you have not approved it …`, row `skipped (…not approved)`, no `.paper/sources/`; with `y` at the `byo-folder` question (numbered mode): `secret.pdf added as aspelmeyer2009` and the approval recorded in the data dir; the next run reads it without asking |
| L3 | offline: `add mypdfs` (doi-footer → aspelmeyer2009), then `add 10.1038/nphys1170 --pdf no-match.pdf --yolo` | `WARN — no-match.pdf: its first page does not show "Measured measurement" by Aspelmeyer, Markus …`, the `pdf-attach-unmatched` refusal, exit 3, the stored PDF's sha256 unchanged; `--pdf mypdfs/doi-footer.pdf` attaches (exit 0) |
| L4 | live: `add cites-in-footnote.pdf` (an essay whose footnote cites 10.1038/nature14539) | refused, exit 1: `… 10.1038/nature14539 ("Deep learning") is a work the PDF cites, not the PDF itself`; the OpenAlex search's failure (`rate limited (retry after ~60 s) …`) named in the reason, not "no match" |
| L5 | `plan 1 --research "…" --estimate` | one row `plan §1 --research`, the source-evaluator call(s) only (no planner call); `plan 1 --estimate` stays the planner row |
| L6 | a real pty (python `pty`): the clack text prompt, Enter on a blank line | answer `""` (was the string `"undefined"`) |
| L7 | `npm run live:sources` | 19 passed, 0 failed, 2 skipped (keyed OpenAlex / Semantic Scholar: no key); new live checks: PubMed first author `Zhu, N.`, Kuhn's ISBN has one author, DOI HEAD of two Crossref DOIs raises no WARN |

Gate after round 1 (Node 22, Linux, as root): build, lint, typecheck exit 0; `npm test` 2019 tests: 2018 pass, 1 fail (the root-only atomic-write case above); `npm run test:tier-contract` 55/55; `npm run validate:manifests` exit 0; `node scripts/e2e-smoke.mjs` PASS=10 FAIL=0; `npm run live:sources` 19 pass, 2 skipped (no keys). Details in 19-SUMMARY.md "Review round 1 — gate".

## 6. Review round 2 (fixer, 2026-09-29)

The fixes, their tests, the superseded tests and the two rejected items are in 19-SUMMARY.md ("Review round 2"). User-path checks on the built CLI (scratch folders under `scratchpad/p19/fixer-r2/`, `XDG_DATA_HOME` / `HOME` inside each, `PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org`, `PENSMITH_NO_LLM=1`, sources live; pandoc 3.9 on PATH for the export):

| # | Check | Observed |
|---|---|---|
| M1 | live: `add 10.1073/pnas.74.11.5041` (Crossref title with two `<i>` runs) and `add 10.1016/j.jaac.2010.05.017` (journal `Child &amp; Adolescent`), a section citing both, `verify 1`, `compile --yolo`, `done --yolo --raw` | bib `title = {Translation of {Drosophila} melanogaster sequences in {Escherichia} coli}`, `journal = {… Child \& Adolescent Psychiatry}`; verify exit 0; the exported DOCX (`pandoc -t plain`): `(Rambach & Hogness, 1977)`, `Rambach, A., & Hogness, D. S. (1977). Translation of Drosophila melanogaster sequences in Escherichia coli. Proceedings of the National Academy of Sciences, 74(11), 5041–5045.` and `… Journal of the American Academy of Child & Adolescent Psychiatry, 49(10), 980–989.` — no `<i>`, no `&Amp;` |
| M2 | live: a research-shaped entry (Semantic Scholar's DataCite DOI `10.48550/arXiv.1706.03762` + eprint), a 10-word quote from its abstract, `verify 1` | `vaswani2017: **OK** — titleJW=1.00, authorJW=1.00 — arXiv:1706.03762 re-fetched from arXiv`; Pass 3 `**OK** — lev=1.000 — levenshtein-substring above threshold (arXiv PDF of 1706.03762)`; exit 0 (was FABRICATED) |
| M3 | live: `add attention-title-only.pdf` while keyless OpenAlex answered "exhausted (retry after ~3 h)" | `identified by its title "Attention Is All You Need" and first author`, `added vaswani2017` (arXiv title search; year 2017, arXiv 1706.03762, tier preprint) — the fixture lane replays OpenAlex's 2025 re-post and resolves to the same arXiv record (`tests/pdf-identify.test.ts`) |
| M4 | live: `add '10.1016/S0140-6736(97)11096-0'` | `WARN — wakefield1998 is RETRACTED (2010-02-06: Retraction (notice 10.1016/s0140-6736(10)60175-4; Retraction Watch record 4036)): it fails Pass 1 (blocking) if cited.`; the built-CLI test shows the verify row `titleJW=1.00, authorJW=1.00 — cited work is retracted (Crossref's record of … at verify time: …)` and compile's `has a blocking verdict (MIS-CITED: the cited work is retracted)` |
| M5 | live: `add` of the PNAS and JAACAP DOIs, arXiv 1706.03762 and the Wakefield DOI (M1, M4) | LIBRARY tiers `peer-reviewed`, `peer-reviewed`, `preprint`, `peer-reviewed` — the metadata tier at upsert (was `not evaluated`) |
| M6 | fixture lane, built CLI (`tests/pass3-byo-cli.test.ts`): a NOT_FOUND quote against the user's PDF, then the PDF edited; a verified quote, then the PDF moved away | verify exit 4 both times (`quote cannot be checked against your local file: PDF changed since ingest …` / `… the PDF sources/lecun2015.pdf is missing … restore that PDF`); compile exit 4; done exit 4, nothing exported; restoring the PDF verifies again (exit 0) |
| M7 | fixture lane, built CLI (`tests/own-source-approvals.test.ts`): `byo_pdf_dir = "pdfs"` holding a symlink to a file outside the paper | `bring-your-own: shared.pdf skipped: it links to a file outside the paper folder …`; nothing copied, nothing in LIBRARY.json or RESEARCH.md |
| M8 | `npm run live:sources` | 19 passed, 0 failed, 2 skipped (keyed OpenAlex / Semantic Scholar: no keys) |

Gate after round 2 (Node 22, Linux, as root; pandoc 3.9 on PATH): build, lint, typecheck exit 0; `npm test` 2048 tests: 2047 pass, 1 fail (the root-only atomic-write case); `npm run test:tier-contract` 56/56; `npm run validate:manifests` exit 0; `node scripts/e2e-smoke.mjs` PASS=10 FAIL=0; `npm run live:sources` 19 pass, 2 skipped.

Still open (not verifiable here): the keyed OpenAlex / Semantic Scholar round trips (the maintainer runs `OPENALEX_API_KEY=… PENSMITH_S2_API_KEY=… PENSMITH_CONTACT_EMAIL=… npm run live:sources` and one keyed `pensmith research --yolo`, and records the output here); GRND-14's drafter half (at the Phase 18/19 merge); CI-06 (cross-OS).

