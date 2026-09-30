---
phase: 19-sources
verified: 2026-09-29
verified_at_branch: v1/p19 (HEAD 4f47eff, after review round 3; the closer re-ran the gate and the user-path checks in §8); re-verified on the v1.0.0 branch at the Phase 18/19 merge (§9)
status: gaps_found
score: 19/20 requirements fully met (GRND-14 closed at the Phase 18/19 merge, §9); SRC-06 NOT fully met (built and tested; its acceptance's keyed live OpenAlex round trip is unobserved — no key here)
gaps: [SRC-06 (keyed OpenAlex / Semantic Scholar live round trip — maintainer runs it with keys)]
success_criteria: 7/8 met; criterion 1 (OpenAlex keyed live) open — §8.3; criterion 7 (the drafter's quote policy) met at the Phase 18/19 merge — §9
review_rounds: [round 1 (fixer, 2026-09-28): see §5, round 2 (fixer, 2026-09-29): see §6, round 3 (fixer, 2026-09-29): see §7, closer (2026-09-29): see §8, Phase 18/19 merge (2026-09-30): see §9]
open_items: [OpenAlex keyed live round trip (no key), Semantic Scholar keyed round trip (no key), CI-06 cross-OS run (inherited from Phase 17)]
---

# Phase 19: Sources and Library (SOURCES): Verification

**Goal (ROADMAP):** every source adapter works against today's live APIs and reports failures to the user; every ingest goes through the Phase 17 library writer; books, hashed bring-your-own PDFs and Zotero items are first-class sources; the drafter and `plan --research` can use this phase's full-text flags and evaluator.

**Result at the Phase 18/19 merge (§9):** 19 of 20 requirements are fully met. GRND-14 closed at the merge: the drafter request's `full_text` comes from `full-text.ts`, and `write`'s containment check corrects, then rejects, a direct quote from a source without it; both acceptance tests pass. SRC-06's keyed live round trip is the one open item. The paragraph below is the branch-time result (§1–§8).

**Result (on `v1/p19`):** 18 of 20 requirements are fully met on the real user path. Two are not: **GRND-14** — nothing in this branch's drafter path reads the full-text flag and no draft check enforces it; that half needs Phase 18's `source-context.ts` / `draft-containment.ts` and runs at the merge (19-PLAN §2, §9). Its library half (`full-text.ts`, based on the text Pass 3 can actually check, and `oa_url` populated at ingest only for an Unpaywall link that served a PDF) is built and tested. **SRC-06** — every part is built and tested (MockAgent, the synthetic budget-exhausted 429 through the built CLI, a fake key reaching both services, and — at the closer — OpenAlex's real keyless exhaustion reported through `research`), but its first acceptance bullet, a keyed OpenAlex live round trip returning results, needs a key this environment does not have; the closer moved it from Complete to Pending (§8.4). Since review round 1, Pass 1 resolves a DOI-less entry at its own registrar (arXiv id, PMID, ISBN), so ROADMAP criterion 7's "a History paper can cite a book with an ISBN" holds end to end (verify, compile, done — §5, re-run at the closer in §8.2).

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
| SRC-06 | **not fully met** (closer, §8.4): everything is built and tested, but the acceptance's keyed live round trip is unobserved — no key here; maintainer item | MockAgent: `api_key` sent, `REDACTED` in SESSION.log, one cache key for keyed and keyless, no key in any cache file (`tests/http-cache-keys.test.ts`, `tests/sources/openalex.test.ts`); `tests/cassette-no-leak.test.ts` scans paths and Locations; the synthetic `Insufficient budget` 429 through the built CLI: `openalex … failed (keyless daily budget exhausted — set OPENALEX_API_KEY (free))` and research completes (`tests/research-cli-lane.test.ts`); the TODO is gone. `live:sources` prints the visible SKIP. |
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
- ~~A live keyless OpenAlex 429 through research~~ — observed at the closer (§8.2 C4): `openalex 0 failed (keyless daily budget exhausted — set OPENALEX_API_KEY (free))`, one `rate limit exhausted (retry after ~45 min)` line, research completed from the other adapters.
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

## 7. Review round 3 (fixer, 2026-09-29)

The fixes, their tests, the superseded tests and the two rejected items (GRND-14's drafter half; the keyed round trips) are in 19-SUMMARY.md ("Review round 3"). User-path checks on the built CLI (scratch folders under `scratchpad/p19/fix-r3/`, `XDG_DATA_HOME` / `HOME` inside each, `PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org`, `PENSMITH_NO_LLM=1`, sources live):

| # | Check | Observed |
|---|---|---|
| R1 | live History paper (`discipline_preset = "history"`, the course-code assignment), `research --yolo --queries 5` | queries `causes french revolution drawing economic social intellectual history`, `french revolution causes history`, `french revolution drawing history`, `french revolution economic social history`, `french revolution intellectual history` (no lone keyword); SESSION.log: 48 `api.crossref.org` requests (5 search, 43 retraction lookups), all HTTP 200, none refused, no breaker line, no `retraction status unknown`; 109 kept; 0 of 109 abstracts / titles with an entity or tag left (LIBRARY.json, RESEARCH.md, CITATIONS.bib); `open access: 14 of 68 … (Unpaywall, checked); 9 link(s) Unpaywall lists did not answer with a PDF (… HTTP 404) …` — all 14 recorded `oa_url`s then fetched in full through http.ts as PDFs (14 ok, 0 bad). (Before: one Crossref 429 opened the breaker and 35–44 lookups ended `unknown`.) |
| R2 | `new --from assignment.txt --yolo --pdfs badpdfs` and `add badpdfs`, `badpdfs/` = `a.pdf` + `mem.pdf -> /proc/self/mem` | `a.pdf added as aspelmeyer2009`, `mem.pdf skipped — could not be read (EIO)`; `new` completes, the paper is in `pensmith list`; `add` exits 0 (was `pensmith: EIO: i/o error, read`, exit 1) |
| R3 | `add https://firstmonday.org/ojs/index.php/fm/article/view/2645`, `add https://ojs.aaai.org/index.php/ICWSM/article/view/14550` (OJS 3.3; `DC.Identifier` = the internal id first; the servers gzip the page without a Content-Encoding header) | `declares DOI 10.5210/fm.v14i11.2645` → `kushin2009`; `declares DOI 10.1609/icwsm.v8i1.14550` → `hutto2014` (was "the page declares no DOI") |
| R4 | `add https://zenodo.org/records/3242074`; `add 10.99999/not-a-work`; `add 10.1038/not-a-real-work-xyz` | `DOI 10.5281/zenodo.3242074: registered with DataCite, not Crossref — this version adds DOIs registered with Crossref only …`; `not found (no registration agency holds the DOI prefix 10.99999) — … check the identifier`; `not found (HTTP 404 (Crossref has no record of this DOI)) — … check the identifier` |
| R5 | the PLOS Medicine printable PDF of 10.1371/journal.pmed.0020124: `add plosmed.pdf --yolo`; in a fresh paper `add 10.1371/journal.pmed.0020124 --pdf plosmed.pdf` (no `--yolo`) | `plosmed.pdf identified by 10.1371/journal.pmed.0020124` → `ioannidis2005`; the attach succeeds with no gate, `byo.asserted: false` (was refused as "a work the PDF cites" / exit 3) |
| R6 | `add 10.1371/journal.pone.0000001`, `add PMID:31978945` | `almeida2006` `oa_url` = the PLOS PDF (it served `%PDF-`); `zhu2020` has no `oa_url` (Unpaywall's `url_for_pdf` is a repository landing page) |
| R7 | pandoc 3.9 + apa.csl on titles `Neural Substrate of Cold-Seeking Behavior …`, `Real-Time Object Detection …`, `Long-Term Outcomes of COVID-19 after mRNA-Based Vaccination` (`tests/bibtex-roundtrip.test.ts`) | `Neural substrate of cold-seeking behavior in endotoxin shock.`, `Real-time object detection with region proposal networks.`, `Long-term outcomes of COVID-19 after mRNA-based vaccination.` |
| R8 | an existing v1 `config.toml` read by the new build | `pensmith: .paper/config.toml: migrated from schema v1 to v2`, written back once; `new` writes `schema_version = 2` |

Gate after round 3 (Node 22, Linux, as root; pandoc 3.9 on PATH): `npm run build`, `lint`, `typecheck` exit 0 and the build leaves the tree clean; `npm test` 2067 tests: 2066 pass, 1 fail (the root-only `tests/atomic-write.test.ts` case, which passes in CI; no skips, no todos); `npm run test:tier-contract` 56/56; `npm run validate:manifests` exit 0; `node scripts/e2e-smoke.mjs` PASS=10 FAIL=0; `npm run live:sources` 19 pass, 0 fail, 2 skipped (no OpenAlex / Semantic Scholar key).

Still open (not verifiable here): the keyed OpenAlex / Semantic Scholar round trips (maintainer: `OPENALEX_API_KEY=… PENSMITH_S2_API_KEY=… PENSMITH_CONTACT_EMAIL=… npm run live:sources` and one keyed `pensmith research --yolo`, recorded here); GRND-14's drafter half (at the Phase 18/19 merge); CI-06 (cross-OS).

## 8. Closer (2026-09-29, HEAD 4f47eff)

The closer changed no code. It re-ran the whole gate, repeated the user-path checks that are cheap to repeat on the built CLI, assessed every ROADMAP success criterion, and set the final status of each requirement.

### 8.1 Gate (Node 22.22.2, Linux, as root; pandoc 3.9 on PATH)

| Step | Result |
|---|---|
| `npm run prebuild`, `npm run lint`, `npm run typecheck`, `npm run build` | exit 0 each |
| `git status --porcelain` after the build and after the tests | clean (only the worktree's untracked `node_modules` link) |
| `npm test` | 2067 tests: 2066 pass, 1 fail, 0 skipped, 0 todo, 0 cancelled (308 s). The one failure is `tests/atomic-write.test.ts` "preserves OLD content on rename/write failure". It is root-only: `chmod 0o500` does not stop root. CLAUDE.md documents it, and it passes in CI. |
| `npm run test:tier-contract` | exit 0: 56/56 pass |
| `npm run validate:manifests` | exit 0 (plugin.json, marketplace.json and .mcp.json valid) |
| `node scripts/e2e-smoke.mjs` | exit 0: PASS=10, FINDING=0, FAIL=0 |
| `npm run live:sources` (`PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org`, isolated `XDG_DATA_HOME`) | exit 0: 19 passed, 0 failed, 2 skipped (OpenAlex keyed and Semantic Scholar keyed: no keys) |
| `claude plugin validate .` (informational; isolated `CLAUDE_CONFIG_DIR`) | `plugins[0] plugin.json → skills: Invalid input`. This error predates Phase 17 and belongs to PLUG-01 (Phase 23). |

### 8.2 User-path checks (built `dist/bin/pensmith.js`)

Each check ran in its own scratch folder under `scratchpad/p19/closer/`, with `XDG_DATA_HOME` / `HOME` / `LOCALAPPDATA` inside it, no test context, `PENSMITH_NO_LLM=1` and `PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org`. Sources were live.

| # | Check | Observed |
|---|---|---|
| C1 | Created a paper with `new --from assignment.txt --yolo` (APA, from INTAKE.md). Ran `add PMID:31978945`, `add isbn:9780226458083`, `add arXiv:1706.03762` and `add 10.1371/journal.pone.0000001`. Wrote a one-section draft citing all four, including a 14-word quote from Vaswani's abstract. Then ran `verify 1 --yolo`, `compile --yolo` and `done --yolo`. | `add` created `zhu2020`, `kuhn1996`, `vaswani2017` and `almeida2006`. `verify` exited 0 with `Status: verified`. All four Pass 1 rows were **OK** (`kuhn1996 … ISBN 9780226458083 re-fetched from the books registries`, `vaswani2017 … arXiv:1706.03762 re-fetched from arXiv`), and the Pass 3 row was **OK** (`lev=1.000 … (arXiv PDF of 1706.03762)`). `compile` exited 0. `done` exited 0 and exported `DRAFT.docx`. `pandoc -t plain` of that file shows `(Zhu et al., 2020)`, `(Kuhn, 1996)`, `(Vaswani et al., 2017)` and `(Almeida et al., 2006)`, plus four APA references, including `Kuhn, T. S. (1996). The structure of scientific revolutions. University of Chicago Press.` The zero-trace checks hold: in `docProps/core.xml` the creator and title are empty and the dates are 1970, and `word/document.xml` contains 0 occurrences of `pensmith`. This is ROADMAP criterion 7's book citation and SRC-11/12/13, end to end. |
| C2 | Same paper: replaced the quote with a fabricated one attributed to `vaswani2017`. | `verify 1` exit 4 with `NOT_FOUND — lev=0.354 — quote not found in the arXiv PDF of 1706.03762`. `compile --yolo` exit 4 with `REFUSED — … [@vaswani2017] has a blocking verdict (NOT_FOUND)`. `done --yolo` exit 4 with `BLOCKED — export refused`. |
| C3 | A fresh paper (attention mechanisms in transformers) running `research --yolo` | Exit 0 after 2 min 42 s, with 8 queries, all anchored on "attention mechanisms transformers". The per-adapter table: openalex `0 failed (keyless daily budget exhausted — set OPENALEX_API_KEY (free))`, crossref 72, arxiv 80, semanticscholar `40 ok; failed (HTTP 429 — rate limited; set PENSMITH_S2_API_KEY) for 4 of 8 queries`, pubmed 71, zotero `skipped (not configured)`. Summary lines: `open access: 29 of 97 … (Unpaywall, checked); 18 link(s) … did not answer with a PDF (papers.ssrn.com: HTTP 403)` and `127 kept (peer-reviewed 79, preprint 41, book 3, other 4); 1 excluded by [sources] policy`. LIBRARY.json v3 holds 125 entries (2 duplicates merged), every one with a tier and a why-relevant note; 92 of them mention attention or transformer in the title or abstract. (SRC-07, SRC-08, SRC-09, SRC-10, SRC-17) |
| C4 | The same run: OpenAlex without a key | OpenAlex's real keyless budget was exhausted. Research printed one `api.openalex.org: rate limit exhausted (retry after ~45 min) — no further requests go to it in this run`, reported the row as the keyless-budget failure with the free-key hint, and completed from the other adapters. This is SRC-06's keyless acceptance observed live for the first time; §4 previously listed it as not verified. |
| C5 | A two-section paper: `plan 2 --research "efficient transformer sparse attention linear complexity"` with no terminal, then the same command with `--yolo` | Without a terminal it exits 3 with `Add these research hits to the section? (section 2: nothing was searched, sent or written) needs an answer`. With `--yolo` it exits 0: `added 47 source(s) to section 2's assigned_sources (47 new …)` and logs the run in `02-…/RESEARCH-LOG.md`. The `sha256sum -c` of every section file taken before the run fails only for `02-efficient-transformers/PLAN.md`, so §1 is untouched. (GRND-17) |
| C6 | `new --from … --pdfs pdfs --yolo` with `doi-footer.pdf` and `image-only.pdf`, then `status` | `doi-footer.pdf added as aspelmeyer2009 (identified by 10.1038/nphys1170)`, and `image-only.pdf added as byoimageonly: not identified (no extractable text …) — … check it before citing`. Both PDFs are stored under `.paper/sources/`. `status` shows `next: research`, so the router does not skip research after `new --pdfs` (round 1 fix). (SRC-15, SEC-02 worker path) |

Side observations, none of which is a Phase 19 acceptance item (listed as follow-ups in 19-SUMMARY "Closer"):
- **Lowercased place name in APA.** The APA reference for `zhu2020` prints "pneumonia in china, 2019". PubMed's esummary gives a Title Case title and no abstract, so `titleBibValue` has no evidence that "China" is a proper noun.
- **Wrong freshness probe for sources with no DOI.** The freshness table prints `DOI HEAD | ok` for `kuhn1996` and `vaswani2017`, which have no DOI. This is the known Phase 20 todo in STATE.md.
- **Raw citation tokens when INTAKE.md is missing.** A paper seeded without INTAKE.md exported raw `[@key]` tokens, because `done` reads the citation style only from INTAKE.md. That belongs to EXP-03 (Phase 21). The C1 paper, made with `new`, renders correctly.

### 8.3 ROADMAP success criteria (Phase 19)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Live lane: arXiv, Unpaywall, Crossref (including consortium works), OpenAlex (keyed) and Semantic Scholar return real results; `http.ts` follows redirects with a fresh SSRF check and IP pin on every hop | **not met (keyed OpenAlex unobserved)** | `live:sources` §8.1: arXiv, Unpaywall, Crossref ENCODE consortium and the OpenAlex keyless single-work lookup all PASS. Semantic Scholar returned 40 live results in C3. The redirect tests pass (`tests/http-redirect.test.ts`, `tests/ssrf-pinning.test.ts`, U1–U3, U13). The **keyed** OpenAlex round trip has not been run: there is no key here. A fake key does reach OpenAlex (`HTTP 401: API key not found`), which shows the key is sent, but not that results come back. |
| 2 | Research prints per-adapter counts or reasons, disambiguates, runs 5–10 focused queries in the preset's order, applies `[sources]`, tiers every source, writes RESEARCH.md; zero relevant exits non-zero | met | C3, U7 and R1 (live). The fixture lanes cover the rest: `tests/research-cli-lane.test.ts` (reject-all → exit 1), `tests/research-scope-cli.test.ts`, `tests/adapter-plan.test.ts`. |
| 3 | Wakefield flagged retracted; a 200 carrying an error body is "retraction status unknown", never "not retracted" | met | `live:sources` (Wakefield `retracted: true`, Retraction Watch notice), M4, `tests/sources/retraction-watch.test.ts` (inner-403 body is a failure and is not cached), `tests/verify-retraction-cli.test.ts` (verify, compile and done exit 4). |
| 4 | CITATIONS.bib round-trips Cyrillic, Greek, CJK, particle and "Given Family" names and carries abstracts; LIBRARY.json holds one entry per work across research, `add`, BYO and Zotero | met | `tests/bibtex-roundtrip.test.ts` (the five names, fast-check with ≥ 1000 runs, pandoc APA), `tests/verify-bib-regen.test.ts`, `tests/byo-new-cli.test.ts` (a research hit merges into the BYO entry, key kept), `tests/zotero-research.test.ts` (an existing DOI merges), C3 (`2 duplicate(s) merged`). |
| 5 | `add` accepts DOIs, arXiv ids, ISBNs, PDFs and URLs and identifies the correct work or refuses; updates LIBRARY.json and RESEARCH.md; remaps only relevant sections | met | C1, U1–U4, U10, U11, L3, L4, R3–R5; `tests/add-identifiers-cli.test.ts`, `tests/pdf-identify.test.ts`, `tests/add-pdf-attach-cli.test.ts`, `tests/add-remap-*.test.ts`. |
| 6 | `new --pdfs` ingests BYO PDFs tagged bring-your-own, hashed, extracted in a hard-abortable worker; editing local text never changes a verdict; only titles or identifiers leave the machine | met | C6, M6, `tests/byo-new-cli.test.ts`, `tests/byo-ingest.test.ts` (a forged `.txt` or an edited PDF is never used), `tests/pdf-worker.test.ts`, `tests/pass3-byo-cli.test.ts`. Pass 2 sends BYO passages only with `[verification] send_byo_passages = true`, which is off by default (round 2). |
| 7 | A History paper can cite a book with an ISBN; Zotero items flow into the library in both tiers with an authenticated doctor check; the drafter quotes directly only from sources with real full text; `plan N --research` adds real hits to that section only | **not met (drafter quote policy)** | ISBN book: C1 and L1 end to end. Zotero in both tiers: `tests/zotero-research.test.ts`, `tests/mcp-zotero-ingest.test.ts`, `tests/tier-contract/zotero-ingest.test.ts`, `tests/doctor-zotero.test.ts`. `plan N --research`: C5, U8, U9, `tests/plan-research-cli.test.ts`. The **drafter quote policy (GRND-14) is not implemented on this branch.** This branch's drafter sends no source records at all, and the check needs Phase 18's `source-context.ts` / `draft-containment.ts`. It is wired and accepted at the merge (19-SUMMARY merge notes, including the "Closer" row). |
| 8 | `http.ts` sends each service's polite contact form, honours `X-Rate-Limit`, stops retrying a host whose `Retry-After` exceeds the cap, trips a per-host breaker on 429/5xx storms, never caches an error body as a success | met | `tests/http-politeness.test.ts`, `tests/http-rate-limit.test.ts`, `tests/http-circuit.test.ts`, `tests/sources/three-way.ts`; U12 (live Crossref `polite-single`); R1 (48 Crossref requests, all 200, no breaker); C3 and C4 (the OpenAlex exhausted-host line, sent once). |

**6 of 8 criteria met**; criteria 1 and 7 are open, for the reasons in the table.

### 8.4 Final requirement status

| Req | Final | Reason |
|---|---|---|
| SRC-01..05, SRC-07..17, GRND-17, SEC-02 (18) | **Complete** | §3 evidence, confirmed at HEAD 4f47eff by the §8.1 gate and the §8.2 checks |
| SRC-06 | **Pending**, moved from Complete by the closer | The implementation is complete and tested: `api_key` / `x-api-key` are sent and redacted, with no key in cache keys, SESSION.log or cassettes. The keyless budget report works through the built CLI and, since C4, live. The requirement's first acceptance bullet asks for a *keyed* OpenAlex live round trip returning ≥ 1 result, and ROADMAP criterion 1 asks for the same. Neither can be observed without the maintainer's key. Like CI-06 in Phase 17, an unobserved acceptance item is left open rather than claimed. To close it: `OPENALEX_API_KEY=… PENSMITH_S2_API_KEY=… PENSMITH_CONTACT_EMAIL=… npm run live:sources` (the two SKIP lines become PASS) plus one keyed `pensmith research --yolo`, recorded here. |
| GRND-14 | **Pending** | The drafter half and the acceptance tests run at the Phase 18/19 merge. The library half is built: `full-text.ts`, `open-access.ts`, and `describeQuotesWithoutFullText` for the corrective text. The exact wiring against Phase 18's current `source-context.ts` / `draft-containment.ts` is in 19-SUMMARY "Closer". |

Phase 19 is **not complete**: 18 of 20 requirements are Complete, and the ROADMAP checkbox stays unticked.

## 9. Phase 18/19 merge (2026-09-30, v1.0.0 branch)

Phase 19 was merged into the v1.0.0 branch after Phase 18 closed (merge commit d0b9bb5). The first integrator was interrupted by a container restart after committing its in-progress work (01a815b); the resumed integrator reviewed that work, completed it, re-ran the GRND-14 acceptance and the gate, and then merged the cross-platform CI fixes (`v1/ci-fix-18`).

### 9.1 GRND-14 wiring (exactly the 19-SUMMARY "Closer" row)

| File | Change |
|---|---|
| `bin/lib/source-context.ts` | `fullTextAvailable(entry: Pick<SourceContextInput, 'byo' \| 'oa_url' \| 'doi' \| 'arxiv'>)` delegates to `full-text.ts fullTextAvailable`; `SourceContextInput` gains `arxiv`, and `byo` is `LibraryEntry['byo']`. The drafter record's `full_text` is therefore exactly what Pass 3 can check: a non-asserted hashed BYO PDF, an Unpaywall-confirmed `oa_url` with a (non-DataCite) DOI, or an arXiv id. |
| `bin/lib/draft-containment.ts` | `DraftViolationKind` adds `'quote-without-full-text'`; `checkDraft(draft, { assigned, section, fullText })` pushes one violation per `quotesWithoutFullText(draft, fullText)` result, with `describeQuotesWithoutFullText` as its message; `failureReason` / `containmentCorrection` carry that text. |
| `bin/cli/write.ts` | `withVerifiedByo` re-checks each assigned BYO PDF through `byoText(root, entry)` before the drafter request is built (a PDF missing, changed or attached at the user's word counts as no BYO text); `fullTextByCitekey` over the section's assigned LIBRARY entries builds the map `checkDraft` reads, so the request's `full_text` and the check agree. write's one corrective turn and failure path (`DRAFT.rejected.md`, `status: failed` + `failure_reason`, exit 4) apply unchanged. |
| `templates/prompts/section-drafter.md` | unchanged: Phase 18 already tells the drafter to quote only from `full_text: true` sources (no re-pin). |

### 9.2 GRND-14 acceptance

`tests/grnd14-quote-policy.test.ts` (built through the CLI with the RUN-21 mock LLM, offline):
- (1) The captured `section-drafter` request marks `full_text` true for a BYO PDF that still verifies, an Unpaywall OA PDF (`oa_url` + DOI) and an arXiv id, and false for an abstract-only source and for a BYO PDF deleted since ingest. **pass**
- (2) A draft quoting the abstract-only source gets exactly one corrective turn naming the quote ("paraphrase them, or quote only a source marked full_text: true"); the kept draft quotes only full-text sources and the section is `written`. **pass**
- (2) A second violation (the retry quotes the deleted BYO copy) is rejected: `DRAFT.rejected.md`, `status: failed` with the reason, exit 4, no VERIFICATION.md. **pass**

`tests/citekey-grammar-gates.test.ts` also runs a narrative-citation quote through `checkDraft` (`quote-without-full-text`). GRND-14 is **Complete**.

### 9.3 The e2e corpus re-record (18-PLAN §9.9, D-18-31)

Phase 19 changed the adapters' request URLs and research's shape (5–10 queries per scope, the evaluator's one batch with a verdict for every candidate, the `[sources]` policy), so the corpus was re-recorded with `npm run cassettes:refresh -- --corpus e2e` (`PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org`, recorded 2026-09-29T23:58:57Z). The recorder now drives research's own discovery and pass (`research-orchestrator.ts discoverCandidates` / `runResearchPass` over the computer-science adapter plan), refuses a candidate batch over the evaluator's 150, keeps only sources whose retraction check is clear and whose live Pass 1 is OK, and shares one cassette-entry writer (every email address redacted, non-text bodies base64) with the per-adapter recorder.

- Five scripted queries (`transformer self-attention mechanism`, `attention mechanism neural machine translation`, `multi-head attention transformer architecture`, `scaled dot-product attention transformer`, `transformer attention interpretability`); 28 cassettes under `tests/fixtures/cassettes/e2e/` (arxiv, crossref, pubmed, retraction-watch, semanticscholar); the evaluator script has 129 verdicts, 6 kept: cai2024, meng2023, catapang2022, sun2026, li2022, smaldone2025, each verified live at recording time; 3 sections; run bound 8.
- **What stayed unrecorded (expected misses in MANIFEST.json):** OpenAlex for all five queries (keyless search was rate-limited; re-probed at the merge, it still answered HTTP 429 "Anonymous search is temporarily rate-limited while the search cluster is under elevated load") and Semantic Scholar for four of the five (keyless shared-pool 429). Offline, those (adapter, query) pairs fail closed exactly as the manifest says, and the chain completes from the other adapters. Nothing in the corpus is synthetic.
- `tests/e2e-chain.test.ts` and `tests/e2e-corpus-manifest.test.ts` pass.

### 9.4 Post-merge fixes

- `bin/lib/full-text.ts`: a blank `oa_url` is not an open-access PDF.
- `tests/helpers/section-fixture.ts` writes a current-version LIBRARY.json (v2 entries through the library's own v2 → v3 migration), so a read never has to migrate — and rewrite — it.
- `tests/mock-llm.test.ts` (the stub's queries are the topic's deterministic expansion, SRC-08), `tests/research-request-shape.test.ts` (the evaluator record carries `type` and `tier_hint`, SRC-09; the CLI case uses a recorded research query), `tests/bare-chain.test.ts` (the D-18-43 case's quoted source now has an open-access PDF, which Pass 3 cannot fetch offline — a quote from an abstract-only source is corrected at write), `tests/dry-run-boundary.test.ts` (the dry-run export is the format this host makes — DOCX with Pandoc, else Markdown — and a .docx's XML parts are checked for markers), `tests/add-identifiers.test.ts` (drains the session log before reading its http records; the doi.org RA case was flaky under a loaded full run).

### 9.5 The cross-platform CI fixes (`v1/ci-fix-18`, merged after the Phase 19 merge)

Kept whole: Node 24's readline pause-after-close (`prompts/numbered.ts`), the pdf-parse byte-offset fix, a Windows piped stdin read from st_mode's FIFO bits (`stdin-source.ts`), the macOS data-dir leaks (installed-offline's `HOME`, ssrf-pinning), installed-bin's EBUSY cleanup, llm-sandbox's session-log drain, the Windows fake TTY, c8 `merge-async`, the CI-09 step that runs after a failed test step, and `scripts/run-tests.mjs`'s own fingerprint of the real data dir. Applied to Phase 19's code:
- **The PDF worker.** Phase 19 moved pdf-parse into `bin/lib/pdf-worker.ts`, which still retried a `Buffer.from` copy (a pooled Buffer at a non-zero byteOffset). The worker now parses a Uint8Array copy that owns its ArrayBuffer, and the retry is gone (19-CONTEXT D-19-22 amended). Before the fix, Node 24 failed `tests/pdf-identify.test.ts` with `bad XRef entry`; after it, `tests/pdf-text-bounds.test.ts` (views at offsets 1, 8, 1000, 4093 and pooled copies) and every PDF suite pass on Node 22 and 24.
- **Context-free children.** `tests/pdf-worker.test.ts`'s seam-refusal child drops the test context, so it now points `HOME`, `USERPROFILE`, `XDG_DATA_HOME` and `LOCALAPPDATA` at a temp dir. Phase 19's built-CLI suites keep the test context (`tests/helpers/built-cli.ts` → `sb.spawnEnv`), and no other Phase 19 test drops it.

### 9.6 Gate (after both merges; Linux, as root)

| Step | Node 22.22.2 (pandoc 3.9 on PATH) | Node 24.21.0 (pandoc 3.9 on PATH) |
|---|---|---|
| `npm run prebuild`, `lint`, `typecheck`, `build` | exit 0 each | exit 0 each |
| `git status --porcelain` after the build and after the tests | clean | clean |
| `npm test` | 2384 tests: 2383 pass, 1 fail, 0 skipped, 0 todo, 0 cancelled | 2384 tests: 2383 pass, 1 fail, 0 skipped, 0 todo, 0 cancelled |
| `npm run test:tier-contract` | 57/57 | 57/57 |
| `npm run validate:manifests` | exit 0 | exit 0 |
| `node scripts/e2e-smoke.mjs` | PASS=16, FINDING=0, FAIL=0 | PASS=16, FINDING=0, FAIL=0 |

The one failure in every run is `tests/atomic-write.test.ts` "preserves OLD content on rename/write failure", which is root-only (`chmod 0o500` does not stop root; CLAUDE.md) and passes in CI. The runner's real-data-dir fingerprint (CI-09) reported no change. `npm run test:coverage` (Node 22, no pandoc — CI's step) ran the same 2384 tests with the same single failure; coverage is 93.41 % lines / statements, 83.97 % branches and 90.08 % functions, over the 80 / 66 gate. A final `node scripts/run-tests.mjs` on Node 24 without pandoc (the CI shape: the dry-run export falls back to Markdown) gave the same 2383 / 2384. Before the CI fixes were merged, the suite on Node 22 without pandoc ran 2383 tests: 2381 pass and 2 fail — the root-only case and the doi.org RA case of `tests/add-identifiers.test.ts`, a session-log flush race that is fixed (§9.4).

### 9.7 Final status at the merge

| Req | Final |
|---|---|
| SRC-01..05, SRC-07..17, GRND-17, SEC-02 (18) | **Complete** (unchanged; re-run by the §9.6 gate) |
| GRND-14 | **Complete** (§9.1, §9.2) |
| SRC-06 | **Pending**: only the keyed OpenAlex / Semantic Scholar live round trip, a maintainer item (§8.4) |

Phase 19 is 19 of 20 Complete and 7 of 8 success criteria met; the ROADMAP checkbox stays unticked until SRC-06's keyed run is recorded. No CI run has been observed for this code yet (CI-06).

### 9.8 Merge review round 1 (fixer, 2026-09-30)

Thirteen findings (six major, seven minor). Confirmed and fixed:

| Finding | Fix |
|---|---|
| **D-18-37 `verifierBlindSpot` withheld sources Phase 19's Pass 1 verifies** (major, reported twice: ISBN books, arXiv-only preprints, PMID-only records, DataCite arXiv DOIs; SRC-15 / criterion 7 on the grounded path) | The route Pass 1 takes is one pure predicate, `bin/lib/verify/pass1-identifiers.ts` (`citationCheckRoute`, `doilessIdentifiers`, `uncheckableReason`), read by Pass 1 and by `source-context.ts verifierBlindSpot`. Withheld now: retracted, synthetic outside a dry run, no DOI / arXiv id / PMID / ISBN, and a Zenodo / figshare / Dryad DataCite DOI with none of those (VRFY-11). The WARN, gate text and `excludedRemedy` follow; README, PRD §7.3, CLAUDE.md, `workflows/outline.md`, `workflows/plan.md`, `skills/plan-section.md`, REQUIREMENTS (FEED-01, GRND-07 criterion, VRFY-11 note) and STATE.md updated. Tests: `tests/source-context-verifiable.test.ts` (rewritten for the new premise), `tests/outline-feed.test.ts` (an arXiv DataCite DOI and an ISBN book are offered; a Zenodo-only and an identifier-less source are named), new `tests/verifiable-sources-cli.test.ts` (built CLI: a History paper's ISBN book and a BYO PDF identified by its arXiv id are allocated by the outline, kept by the planner, cited, verified OK, and the second is compiled and exported). |
| **Pass 1 called a real work FABRICATED on a Crossref 404 for another agency's DOI** (major; ISTIC) | `pass1.ts crossrefNotFound`: doi.org names the prefix's agency (`sources/doi-ra.ts`); Crossref's own prefix or no agency → FABRICATED; another agency → the entry's arXiv id / PMID / ISBN at their registrars, else UNVERIFIABLE naming the agency; an unanswerable agency lookup → UNVERIFIABLE. New recordings (`npm run cassettes:refresh`): `generic/doi-ra-prefixes` gains 10.5555 and 10.3760, `crossref/works-istic-404`, `pubmed/esummary-42706103`. Test: `tests/pass1-lookup.test.ts` (OK through the PMID, UNVERIFIABLE without it, MIS-CITED with another work's PMID; the 10.5555 case stays FABRICATED). `workflows/verify.md`, PRIVACY.md and docs/SOURCES.md say so. |
| **arXiv hits paired the journal DOI with the preprint's metadata** (major) | `research-orchestrator.ts mergeFound`: two records of one DOI keep the registrar's (version-of-record) record, with the preprint's arXiv id and abstract. `migrations/library/shape.ts candidateToEntry`: an arXiv record whose DOI is not arXiv's own is stored as the preprint (arXiv id; the journal DOI an alternate, VRFY-14) until the version of record merges in and wins. Tests: `tests/research-discovery.test.ts`, `tests/library-writer.test.ts`, `tests/verify-identifiers-cli.test.ts` (`add arXiv:hep-th/9901001` verifies at arXiv). The corpus's live-Pass-1 filter is documented in `scripts/refresh-cassettes.mjs` as a limit of the GRND-18 acceptance (a live-lane unscripted chain stays VRFY-13 / Phase 20 work, STATE.md). |
| **`add --remap` replaced a section's assigned_sources** (major) | `frontmatter.ts updateFrontmatter`: reads return plain values (a YAML sequence was read as "not an array"). Test: `tests/add-remap-section.test.ts` (appends to a block list; a repeated remap is a no-op). |
| **`add --section N --slug S` skipped the identity check** (major) | `add.ts resolveOne` goes through `section-slug.ts resolveSectionArg` after add's own "no such section" check. Tests: a mismatched `--slug` exits 2, a STATE/OUTLINE disagreement exits 1, nothing written. |
| Retracted hits reached assigned_sources (minor) | `plan N --research` assigns only what `verifierBlindSpot` passes (the rest stays in LIBRARY.json, logged "not assigned", WARN); `add` never maps such a source (an explicit `--remap` / `--section` exits 1). Tests in `tests/section-research.test.ts` and `tests/add-remap-section.test.ts`. |
| `new --pdfs --dry-run` broke D-18-29 (minor) | `intake.ts`: under --dry-run the folder is recorded in the workspace config only. Test: `tests/dry-run-workspace.test.ts`. |
| Research gate texts said --yolo keeps every candidate (minor) | `gates.ts` yoloChoice and PRD §7.20 rows; test in `tests/gates-registry.test.ts`. |
| One-sided docs (minor) | `--help`'s GLOBAL FLAGS never-list is generated from the registry (it had dropped the estimate confirmation; drift test added); `skills/write-section.md` names the GRND-14 quote failure; PRIVACY.md says write re-hashes a BYO PDF; the refresh script names `discoverCandidates`. |
| `plan N --revise` repeated a no-op (minor) | `revise.ts` repairs the first flagged citation the draft still cites, and says "nothing to change" (no model call) when none is left; the router's attention line names the revise → verify loop. Test in `tests/revise-swap.test.ts`. |
| Cyrillic / Greek first authors keyed `anon` (minor) | `citekey.ts transliterate` (Cyrillic and Greek only; Latin-script keys are unchanged because the recorded e2e corpus names candidates by them — mapping ł / ı renamed two of its candidates). CJK still falls back to `anon`. Test in `tests/citekey.test.ts`. |

Not changed, with reasons:
- **SRC-06 / keyless OpenAlex (minor).** The keyed round trip remains the maintainer item (§8.4). Waiting out a 31–39 s Retry-After would change D-19-08's documented cap (`RETRY_AFTER_CAP_MS`, 30 s, pinned by the transport tests), and the evidence shows it would not help: runs whose first OpenAlex request succeeded were throttled on most of the rest (pii1: 2 × 200, 8 × 429).
- **"Research marks retraction `clear` from Crossref for a non-Crossref DOI" (part of the ISTIC finding).** Deciding it needs a doi.org agency lookup per DOI prefix at research time, which the recorded corpus and every offline research suite would then need recorded. The blocking gate no longer depends on it: Pass 1 checks such an entry at PubMed (whose record carries "Retracted Publication") or reports UNVERIFIABLE. Left to VRFY-11 / VRFY-15 (Phase 20).

Gate after the round (Linux, as root):

| Step | Node 22.22.2 (no pandoc on PATH) | Node 24.21.0 (pandoc 3.9 on PATH) |
|---|---|---|
| `prebuild`, `lint`, `typecheck`, `build` | exit 0 each | exit 0 each |
| `npm run test:tier-contract` | 57/57 | 57/57 |
| `npm test` | 2401 tests: 2400 pass, 1 fail, 0 skipped | 2401 tests: 2400 pass, 1 fail, 0 skipped |
| `npm run validate:manifests` | exit 0 | exit 0 |
| `git status --porcelain` after the run | clean | clean |

The one failure is the root-only `tests/atomic-write.test.ts` case (CLAUDE.md). The Node 24 run is the final `node scripts/run-tests.mjs` over Phase 19's new tests too.
