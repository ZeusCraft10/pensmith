---
phase: 19-sources
status: integrated on v1/p19 (merges into the main branch after Phase 18 closes)
requirements: [SRC-01, SRC-02, SRC-03, SRC-04, SRC-05, SRC-06, SRC-07, SRC-08, SRC-09, SRC-10, SRC-11, SRC-12, SRC-13, SRC-14, SRC-15, SRC-16, SRC-17, GRND-14, GRND-17, SEC-02]
met: 19 of 20 (GRND-14 is implemented; its end-to-end acceptance needs Phase 18's drafter and runs at the Phase 18/19 merge)
streams: [net (v1/p19-net 83bb6d6), adapters (v1/p19-adapters 97a2c08), library (v1/p19-library c721207), research (v1/p19-research 2936816)]
verification: 19-VERIFICATION.md
---

# Phase 19: Sources and Library (SOURCES) — Summary

Four streams built Phase 19 in parallel on seams S-A and S-B (identical trees in every stream), then an integration pass merged them into `v1/p19`, wired the cross-stream paths, recorded the fixture-lane scenarios, added the cross-stream acceptance suites and swept the docs. The stream write-ups are [19-net-SUMMARY.md](19-net-SUMMARY.md), [19-adapters-SUMMARY.md](19-adapters-SUMMARY.md), [19-library-SUMMARY.md](19-library-SUMMARY.md) and [19-research-SUMMARY.md](19-research-SUMMARY.md); evidence per requirement is in [19-VERIFICATION.md](19-VERIFICATION.md).

## What the phase delivers

- **Transport (net).** http.ts follows redirects itself with the full gate check and a fresh pin per hop; per-host politeness (the `(mailto:)` User-Agent through `contact-email.ts`, rate buckets lowered by `X-Rate-Limit-*`, a long `Retry-After` stops the host, a circuit breaker after three consecutive 429/5xx); only validated answers are cached, under keys without secrets; exactly the enabled local services (Zotero 7 local API, a loopback GROBID). Zotero in both tiers (Web / local API client, the `paper_ingest_zotero_items` MCP tool, an authenticated doctor check).
- **Adapters.** Every registrar adapter answers `found | not-found | failed` with complete reasons; Crossref keeps consortium authors, venue, volume, pages, abstract and retraction status; OpenAlex takes `OPENALEX_API_KEY`; arXiv, PubMed, Semantic Scholar and Unpaywall return complete records from today's APIs; the Open Library / Google Books `books` adapter; retraction statuses retracted / clear / unknown; Pass 1 / Pass 3 / freshness never read a failure as "not found"; real recordings and `npm run live:sources`.
- **Library.** A BibTeX writer that round-trips every name and keeps abstracts, eprints and journals; `add` classifies every input, identifies the right work or refuses; hashed bring-your-own PDFs whose text is read only through a re-hash; pdf-parse in a terminable worker (SEC-02); `full-text.ts` for the drafter's quote policy.
- **Research.** Seeded from the brief; 1–3 scopes and 5–10 queries; the preset's adapter plan; per-adapter and per-query outcomes on stdout and in RESEARCH.md; deterministic tiers and the `[sources]` policy; an evaluator whose rejections stand; the prune question; RESEARCH.md as a run log around a view of LIBRARY.json; `plan N --research` for one section.

## Integration pass (this commit range: 1241dd5..HEAD)

**Merges.** `net`, `adapters`, `library`, `research` with `--no-ff`. Conflicts: `bin/lib/http.ts` (the seam hunk re-applied by each stream; net's version kept — the other streams changed nothing else in it), `bin/lib/sources/index.ts` (books and zotero both registered, in §3.2 order), `tests/cassette-no-leak.test.ts` (both new checks kept), `tests/gates-registry.test.ts` (research's `EXIT_ERROR` import), `workflows/research.md` (net's Zotero lines inside research's rewritten steps).

**Cross-stream wiring (19-PLAN §7.2).**
- research ← library: `[sources] byo_pdf_dir` is re-read before discovery (`ingestByoPdfs`, idempotent by hash); the user's own entries (bring-your-own, Zotero) that carry an identifier and have no evaluation yet join the evaluator's batch and get a tier, a relevance and a why-relevant note merged into their entry — never a removal (`ownSourcesToEvaluate`, `OwnEvaluation`); a search hit that is the same work merges into the own entry through the library writer; the prune question takes DOIs / arXiv ids / PMIDs / ISBNs / URLs and identifies each exactly like `add` (`bin/cli/add.ts` `identifySource`, the hydration steps now take an injectable output sink) before the library is written, tagged `added`.
- research ← net: a configured `[sources] zotero_collection` is pulled whole (`pullZoteroIntoLibrary`) as the `zotero` row; without one, Zotero is searched per query; `zoteroConfigured` counts a group id like the client does.
- library ← net: `identifyPdf` asks the user's loopback GROBID first when the bytes are available (`add <file.pdf>`, a PDF `add` fetched, bring-your-own) — its DOI / arXiv id first, its title and authors for the title search; a GROBID failure is a failure line.
- library ← adapters: `add isbn:` and the arXiv / PMID forms go through `lookupById` by registry name (verified on the built CLI).
- The `contact-email` chokepoint row (`scripts/chokepoints/contact-email.json`, its failing fixture, the CLAUDE.md row); the pdf-parse row names the worker.

**Found and fixed during integration.**
- Research's "research done" sentinel: a failed research run writes RESEARCH.md and leaves LIBRARY.json untouched (D-19-16), and the router then moved on to an empty outline. `bin/lib/research-sentinel.ts` (router, list/status, estimate): when RESEARCH.md is a failed run's log, research is done only if LIBRARY.json holds an entry or the paper is outlined; the Phase 17 rule stands otherwise.
- A failed retraction lookup's reason now reaches RESEARCH.md and stderr (`retractionCheckReason`), in research and in `plan --research`.
- Corporate authors keyed by their first significant word (`{The ENCODE Project Consortium}` → `encode2012`, not `consortium2012`).
- Query expansion: a leading course code is boilerplate, and the discipline term is never doubled ("history history"); found on a live History run with a Phase 17 brief.
- The recorder copies `bodyEncoding`, records plain URL fetches (`generic`), takes `--files`, and leaves a request another file already answers to that file (the store stays unambiguous).

**Recordings (D-19-26, §7.3).** The http→https 301 to the W3C `dummy.pdf` (base64 hop), an HTML page served at a `.pdf` URL, research's attention query from 2015 (Crossref, PubMed), the `plan 2 --research` queries (Crossref, PubMed), the title searches of the attention and no-match PDFs (Crossref, OpenAlex), and a Crossref search whose hits include a bring-your-own PDF's work. Not recordable: OpenAlex's 10-result research queries (they exceed the 51200-byte cap with abstracts — the fixture lane reports `offline: no recorded fixture`, the live lane covers them) and Semantic Scholar keyless (HTTP 429 at recording time; the file stays in the query set).

**Cross-stream acceptance suites (§7.4).** `tests/research-cli-lane.test.ts`, `tests/add-identifiers-cli.test.ts`, `tests/plan-research-cli.test.ts`, `tests/byo-new-cli.test.ts` (new --pdfs → research merge → outline → write → verify), `tests/zotero-research.test.ts`, plus `tests/pdf-identify-grobid.test.ts` and a real-listener SSRF case in `tests/pass3-oa-pdf.test.ts`. They spawn the built CLI against recorded sources and the in-process mock LLM.

**Docs sweep.** README (research / plan --research / add rows, a Sources section, the Zotero, GROBID and contact-email variables), CONTRIBUTING (recorder flags, per-hop and base64 recordings, scenario recordings), README-DEV (source adapters and the live lane), CLAUDE.md (sources, research, library v3, transport paragraphs; the chokepoint rows), PRD §7.2 / §10 / §11, `workflows/research.md`, `docs/SOURCES.md`.

## Tests updated because the merged behaviour supersedes them

In addition to each stream's list (see the stream summaries):
- `tests/research-verb.test.ts`: the fake registries inject a retraction lookup that finds no notice — the real lookup leaves the fakes' `10.5555/…` DOIs `unknown` offline now (SRC-04: a failed lookup is never "clear"); the retraction case makes its "unknown" by a failing lookup (an adapter-preset `unknown` is looked up again, per adapters' cross-check).
- `tests/byo-ingest.test.ts`: the no-match PDF's title searches are recorded now, so offline it is added unhydrated with a warning (the SRC-15 behaviour); the offline-skip case uses a generated PDF whose title has no recording.
- `tests/research-prune-gate.test.ts`, `tests/gates-registry.test.ts`: the prune question has a second line (the sources to add), answered blank.
- `tests/tier-contract/zotero-ingest.test.ts`: both tiers key the ENCODE consortium `encode2012`.
- `tests/research-sentinel.test.ts`: new failed-run cases; the Phase 17 cases are unchanged and still pass.

## Merge notes for Phase 18

Every stream's list stands (19-net, 19-adapters, 19-library, 19-research SUMMARY files, "Merge notes for Phase 18"); in short: take Phase 19's `bin/cli/research.ts`, `research-orchestrator.ts`, the two research templates (re-pin both hash maps; Phase 18's `tests/prompt-layout.test.ts` must pass on them) and their contract / stub entries; re-apply the `new --pdfs` hunk onto Phase 18's `new`; keep `verify.ts`'s bib re-render beside Phase 18's hunk; adapt `section-research.ts`, `section-relevance.ts` and `add.ts` `resolveOne` to Phase 18's section identity (`1a` ids, slug-found folders, stub PLAN.md, `claims`); make `source-context.ts` `fullTextAvailable` delegate to `full-text.ts` and add the `quote-without-full-text` violation to `draft-containment.ts`, then run GRND-14's acceptance; re-apply `--corpus e2e` onto the rewritten recorder and re-record the e2e corpus; add Phase 18's MCP tools beside `paper_ingest_zotero_items` (counts). The integration pass adds:

| File | Phase 19 integration change | At the merge |
|---|---|---|
| `bin/lib/router.ts`, `bin/lib/global-library.ts`, `bin/lib/estimator.ts` | the research-done check calls `research-sentinel.ts` `isResearchDone(pDir)` | keep the call if Phase 18 edits these files (the estimator's research row sits apart from its section-ordering region) |
| `bin/cli/research.ts` | own sources first (`ingestOwnSources`), the prune question's add line (`identifySource`), `retractionCheckReason` | Phase 19's file is taken whole; Phase 18's `research --yolo --show-prompts` topic check must still pass (the brief is read through `readIntakeBrief`) |
| `bin/cli/add.ts` | the hydration steps take an `AddIo` sink; `identifySource` exported | Phase 18 does not touch `add.ts` |
| `bin/lib/query-expansion.ts` | a leading course code is boilerplate; no doubled discipline term | with Phase 18's structured brief the topic is already clean — the change is harmless there |
| `bin/lib/citekey.ts` | braced corporate authors key by their first significant word | re-run Phase 18's e2e chain; a corpus work with a consortium author changes key (`encode2012`) |
| `tests/helpers/built-cli.ts` (new), the Phase 19 CLI suites | seed a Phase 17-format INTAKE.md or STATE.json / PLAN.md through the S-A helpers or the paper-cli harness | if Phase 18 changes the PLAN.md frontmatter or `new`'s flow, update the seeds of `byo-new-cli`, `plan-research-cli` and `research-cli-lane` (the outline-author / section-drafter replies scripted in `byo-new-cli` follow Phase 18's contracts) |
| `PRD.md` §7.2, §10, §11; `README.md`; `CLAUDE.md`; `CONTRIBUTING.md`; `README-DEV.md`; `workflows/research.md` | integration docs sweep | merge by paragraph / section |

## Hand-offs

- **Phase 20.** Pass 1 asks only Crossref (VRFY-11): works Phase 19 now adds without a DOI — arXiv-only preprints (`vaswani2017`), ISBN books (`kuhn1996`) — are FABRICATED ("no DOI in citation entry") until Pass 1 resolves arXiv ids, PMIDs and ISBNs at their own registrars (the adapters' `lookupById` and `books` are ready for it). Also: `lookupById` for VRFY-12, `byoText` for VRFY-19, Unpaywall `oa_locations` and `checkPdfResponse` for Pass 3, `retraction_status` and the RETRACTED label (VRFY-15). Pass 3 treats an unlooked-up OA copy as `PDF_UNAVAILABLE` (not blocking) — Phase 20's call.
- **Phase 23.** PLUG-07 exposes `applySourceEvaluations` and the research contracts; PLUG-02 adds the PDF worker's bundle layout to the SEC-02 layout test; PLUG-01 owns `claude plugin validate` (`skills: Invalid input`, unchanged since before Phase 17).
- **Phase 26.** HARDEN-02 runs `npm run live:sources` in `live.yml` (with `OPENALEX_API_KEY` / `PENSMITH_S2_API_KEY` secrets the keyed checks run instead of skipping).

## Open items

- **GRND-14** end-to-end acceptance at the Phase 18/19 merge (the drafter request marks `full_text`; a quote from a source without full text is corrected on the retry). The library half (`full-text.ts`) is unit-tested.
- **Keyed live round trips** (OpenAlex with `OPENALEX_API_KEY`, Semantic Scholar with `PENSMITH_S2_API_KEY`): no key here; `live:sources` prints visible SKIP lines (D-19-10 maintainer item). Keyless Semantic Scholar answers 429 almost always; its research-lane recording is open.
- **OpenAlex keyless budget**: exhausted from curl's egress for most of the session (Retry-After ≈ 16 h); node's egress still had budget. The exhausted-host path is proven with MockAgent and was observed live once (`rate limit exhausted (retry after ~37 s)` during a title search).
- **CI-06** (from Phase 17): the cross-OS run (Windows worker threads, CRLF parsers) is not observed; the branch is not pushed.
- **Upstream data**: OpenAlex dates W2626778328 ("Attention Is All You Need") 2025, so the title-only attention PDF identified through the OpenAlex recording keys `vaswani2025`; Open Library lists a second author for Kuhn's book; PubMed initials give keys such as `dm2023`. Returned as the services send them.
