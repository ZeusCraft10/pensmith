# Phase 20: Verifier Completeness (VERIFY) — Plan

**Base:** `c8f28e3` (`akhil/pensive-faraday-qx3o58`, Phases 17–19 merged) · **Decisions:** [20-CONTEXT.md](20-CONTEXT.md) (D-20-01..D-20-33) · **Seam patch:** [seams/20-seam-S-C.patch](seams/) (applied first by every stream) · **Concurrent:** Phase 23a on `v1/p23a` (20-CONTEXT "Concurrency with Phase 23a")

## 1. Goal

Every citation and quote form is seen, every legitimate source can pass, a lookup failure is never called fabrication, and compile and done recompute the gate from the exact text they process, trusting no local file, so forged or edited artifacts cannot get through (ROADMAP Phase 20; D-V1-03, S-17). The seven ROADMAP success criteria are the definition of done; §9 turns each requirement into user-path checks.

## 2. Requirements and owning streams

| Req | Stream | Integration-pass share (§7) |
|---|---|---|
| VRFY-09 grammar, UNPARSEABLE, chokepoint row | `grammar` | UNPARSEABLE rows through the gate core; compile / done refusal acceptance |
| VRFY-10 bare identifiers; unsupported forms | `registrar` (bare identifiers in Pass 1); `grammar` (forms) | UNSUPPORTED-FORM rows through the gate core in section drafts, DRAFT.md, FINAL.md |
| VRFY-11 every identifier at its registrar | `registrar` | live lane through the gate |
| VRFY-12 UNVERIFIABLE-NETWORK; metadata search | `registrar` | compile retry message |
| VRFY-13 name / title / year match | `registrar` | live PRD §15 run |
| VRFY-14 aliases, OK-BYO | `registrar` | — |
| VRFY-15 RETRACTED | `registrar` | compile / done naming it |
| VRFY-16 malformed bib, status persistence | `gate` | — |
| VRFY-17 UNASSIGNED | `gate` | — |
| VRFY-18 quote extraction, UNATTRIBUTED | `quotes` | — |
| VRFY-19 Pass 3 on real text, caches | `quotes` | compile / done cache recomputation with the network denied |
| VRFY-20 UNVERIFIABLE-QUOTE, per-quote acceptance | `quotes` (the verdict, ids); `gate` (record, flag, gate, honouring, reports) | end-to-end acceptance flow |
| VRFY-21 Pass 2 on real source text | `grammar` | the `fullText` provider from `quotes` |
| VRFY-22 evidence, recorded decisions | `grammar` (Evidence column); `gate` (done gate, decisions table) | — |
| VRFY-23 Pass 4 floor, per paragraph, whole paper | `grammar` (Pass 4); `gate` (done over the exported text) | — |
| VRFY-24 summary table; "verified" means verified | `gate` | — |
| VRFY-25 compile recomputes | `gate` | forged-artifact suite with every stream's verdicts |
| VRFY-26 done recomputes over the exported bytes | `gate` | forged-artifact suite |
| VRFY-27 stale inputs refused | `gate` | — |
| VRFY-28 last_verified, one writer, re-checks | `registrar` (refresh, checkedAt, bib render, export strip, freshness); `gate` (recheck selection, recording) | end-to-end clock test |
| VRFY-29 acceptance tests on the production path | `registrar` (citations); `quotes` (quotes) | — |
| HARDEN-03 differential property test (Pandoc oracle) | `grammar` | Property C through the gate core |

Carry-overs: (1) freshness rows without a DOI → `registrar` (D-20-15); (2) research retraction status for non-Crossref DOIs → `registrar` (D-20-13); (3) PubMed abstracts → `registrar` (D-20-16); (4) remaining DataCite DOIs and identifier-less metadata search → `registrar` (D-20-10, D-20-11).

## 3. Design

### 3.1 The load-bearing decisions

- **One vocabulary, one status rule** (D-20-01..03): `bin/lib/verify/verdicts.ts` (seam) holds every verdict label, the passing / failing / unverifiable sets, `sectionOutcome`, `blocksCompile`, `quoteTextSha256`, `quoteId`, `TextFinding` and the Pass-2 table headers. Every reader (verify's aggregation, the verdict-row parser, compile, done, the router) goes through it from the seam commit on, so a label any stream adds blocks everywhere at once.
- **One gate core** (D-20-05): `bin/lib/verify/gate.ts` computes all blocking rows for one text; verify, compile and done call it; local files can only add refusals (D-20-04).
- **"No answer" is UNVERIFIABLE-NETWORK; "an answer with no text" is UNVERIFIABLE-QUOTE** (D-20-03); only the latter can be accepted, per quote, bound to the quote and draft hashes (D-20-22).
- **Caches make recomputation cheap and honest**: the HTTP cache (Pass 1) and the new extracted-text cache (Pass 3), both skipped when sources are offline, both refreshed for citations past `recheck_after_days` (D-20-15, D-20-18).

### 3.2 Seam S-C (D-20-01)

`seams/20-seam-S-C.patch` (see `seams/README.md` for the hash, the verification and the apply commands):

| Status | File | What |
|---|---|---|
| A | `bin/lib/verify/verdicts.ts` | `PASS1_VERDICTS`, `PASS3_VERDICTS`, `DRAFT_VERDICTS` (+ types), `PASSING_VERDICTS`, `FAILING_VERDICTS`, `UNVERIFIABLE_VERDICTS`, `BLOCKING_VERDICTS`, `ACCEPTABLE_QUOTE_VERDICT`, `RETRY_ONLINE_VERDICTS`, `LEGACY_UNAVAILABLE_VERDICTS`, `UNATTRIBUTED_CITEKEY`, `VerdictRowLike`, `SectionStatus`, `SectionOutcome`, `blocksCompile(verdict, accepted?)`, `sectionOutcome(rows)`, `quoteTextSha256(text)`, `quoteId(index)`, `QUOTE_ID_RE`, `TextFinding`, `PASS2_TABLE_HEADER` (5 columns), `PASS2_TABLE_HEADER_V1` |
| M | `bin/lib/verify/verdict-rows.ts` | `BLOCKING_VERDICTS` re-exported from verdicts.ts; `blockingRowReason` words UNVERIFIABLE-NETWORK (re-run online) and UNVERIFIABLE-QUOTE (the three remedies) |
| M | `bin/cli/verify.ts` | the status through `sectionOutcome([...pass1, ...pass3])` |
| M | `bin/lib/verify/pass1.ts` | `Pass1Verdict = Pass1RowVerdict`; `Pass1Result.checkedAt?`; `Pass1Options.bibEntries?` (used when given) and `.refresh?` (declared — stream `registrar` implements it) |
| M | `bin/lib/verify/pass3.ts` | `Pass3Result.id`, `.quoteSha256` (filled), `.localFile?` (filled for a BYO match) |
| M | `bin/cli/compile.ts` | `productionReVerify` blocks through `blocksCompile` |
| M | `bin/cli/done.ts` | GATE-04 blocks through `blocksCompile`; the Pass-2 table reader accepts both headers and reads the Evidence cell |
| M | `bin/lib/router.ts` | the retry-online one-liner counts UNVERIFIABLE-NETWORK rows |
| A | `tests/verdicts.test.ts` | the seam's contract test (the classes, the old-label equivalence, the new labels, the acceptance lift, the hash, the wording, both Pass-2 headers, `bibEntries`, the Pass-3 ids) |

With base labels every reader behaves exactly as before (the full suite passes at the base plus the seam, `seams/README.md`). Every stream keeps the APIs `tests/verdicts.test.ts` imports (`readSectionUnsupported` from `bin/cli/done.ts` included) and the behaviour it asserts.

### 3.3 Cross-stream interfaces (what each stream exports; who calls it)

A stream calls only base APIs, seam APIs and APIs it creates (§4.1). The calls below are wired in the integration pass (§7) unless the caller is the creator.

| Created by | API | Called by |
|---|---|---|
| grammar | `citation-token.ts` `findUnparseableCitations(md): TextFinding[]`; `citationItems(c)` items gain `locator?: string`, `label?: string` | gate (`gate.ts`), exporter (grammar) |
| grammar | `verify/unsupported-forms.ts` `findUnsupportedForms(md): TextFinding[]` | gate |
| grammar | `runPass2(draftMd, bib, { n, root?, shareByoPassages?, fullText?: (citekey: string, claim: string) => Promise<string \| null> })`; `renderPass2Section(results)` with the Evidence column | gate (verify passes `fullText` from quotes' `sourceTextPassage`) |
| grammar | `runPass4(draftMd, { n })` (unchanged signature; `Pass4Result` gains `orphans: string[]`); `renderPass4Section(results)` per paragraph | gate (done over the exported text) |
| registrar | `runPass1(draftMd, bibPath, { root?, bibEntries?, refresh? })` → rows with the seam vocabulary, bare-identifier rows (`doi:…`, `arXiv:…`, `PMID:…`), `checkedAt`; `runFreshnessForDraft(draftMd, bibPath, { bibEntries?, root? })` | gate |
| registrar | `library.ts` `recordLastVerified(root, stamps)` (base), `exportCitedCitations` (strips non-standard fields) | gate (verify, done) |
| quotes | `extractQuotes(md, { minWords? })` → `{ id, text, citekey: string \| null, kind, line, locator? }` | quotes, full-text.ts, gate (UNATTRIBUTED count only through Pass 3) |
| quotes | `runPass3(draftMd, bibByCitekey, { root? })` → `Pass3Result` with the seam vocabulary (`PASS`, `FUZZY`, `NOT_FOUND`, `UNVERIFIABLE-QUOTE`, `UNVERIFIABLE-NETWORK`, `UNATTRIBUTED`), `id`, `quoteSha256`, `localFile` | gate |
| quotes | `verify/source-text.ts` `sourceTextPassage(root, citekey, claim): Promise<string \| null>` (the cached OA / Europe PMC / arXiv text's passage nearest the claim; never BYO text) | gate → Pass 2 |
| gate | `verify/gate.ts` `recomputeGate({ root, text, allowedKeys, draftHash, mode, dryRun, refresh? })` → `{ rows, outcome, accepted, byoQuotes, checkedAt }`; `quote-acceptance.ts` `acceptQuotes(root, section, ids, via)`, `readQuoteAcceptances(sectionDir)` | verify, compile, done; Phase 23 PLUG-07 / PLUG-10 |

### 3.4 File formats

**VERIFICATION.md (section)** — D-20-20:
```
> OFFLINE MODE …                                   (only offline / --dry-run)
# VERIFICATION (Section 2, background)
Status: verified | failed | unverifiable
Draft: sha256 <computeDraftHash>
## Summary
| Pass | Verdict | Count |                          (every non-zero label; Pass-2 verdicts; Pass-4 orphans; freshness WARN / unknown)
## Pass-1 (citation integrity, deterministic)
- smith2020: **OK** — titleJW=1.00, authorJW=1.00 — D-11 AND-gate passed (year 2020 = 2020)
- doi:10.9999/x: **FABRICATED** — titleJW=n/a, authorJW=n/a — bare identifier: …
- L14: **UNSUPPORTED-FORM** — titleJW=n/a, authorJW=n/a — `\cite{fake2019}`: raw TeX citation …
## Pass-3 (quote integrity, deterministic)
- vaswani2017 [q1] ("The dominant sequence transduction mod…"): **PASS** — lev=1.000 — arXiv PDF of 1706.03762
- (unattributed) [q2] ("…"): **UNATTRIBUTED** — lev=0.000 — a direct quote with no citation …
## Draft checks
- draft: **NO-CITATIONS** — no citations; 2 sources assigned
## Accepted quotes                                  (only when any)
| Quote | Citekey | Accepted | Via |
## Source Freshness (RSCH-10)
## Pass-2 (claim support, advisory — LLM-judged)
| Citekey | Claim Sentence | Verdict | Rationale | Evidence |
## Pass-4 (orphan claims, advisory)
```
**QUOTE-ACCEPTANCES.json** (section folder, D-20-22): `{"$schemaVersion":1,"acceptances":[{"quote_id":"q1","citekey":"aggarwal2022","quote_sha256":"…","excerpt":"attention mechanisms are nothing more…","draft_sha256":"…","accepted_at":"2026-…Z","via":"flag"}]}`.
**COMPILE-INPUTS.json v2** (D-20-23): v1 plus `compiled_draft_sha256` and per section `verified_against_draft_hash`; `migrations/compile-inputs/v1_to_v2.ts` sets both `null`.
**Source-text cache entry** (D-20-18): `pensmithDataDir()/source-text/<sha256(url)>.json` = `{url, final_url, content_sha256, text_sha256, text, saved_at, source}`.
**`.paper/VERIFICATION.md` (paper, done)** (D-20-24): the offline marker, `# Paper Verification (done)`, `## Gate` (the recomputed summary over the exported text), `## Decisions` (`| Section | Row | Claim | Decision |`), `## Accepted quotes`, `## Quotes verified against your files`, the honesty and plagiarism sections, `## Pass-4` per paragraph.
**`.paper/CITATIONS.bib`**: each entry gains `last_verified = {<ISO>}` when LIBRARY.json has it; `export/CITATIONS.bib` never carries it (D-20-15).

## 4. Parallel execution protocol

### 4.1 Rules

- Four streams run in parallel in separate worktrees created from this plan's commit (suggested branches `v1/p20-grammar`, `v1/p20-registrar`, `v1/p20-quotes`, `v1/p20-gate`; worktrees `/home/user/pensmith-p20-<stream>` with `node_modules` linked). Never modify `/home/user/pensmith` or `/home/user/pensmith-p23a`.
- **First commit of every stream:** apply seam S-C exactly as `seams/README.md` says (`chore(20): apply seam S-C`). Never edit a seam file or seam hunk afterwards. A seam defect stops the stream; the orchestrator issues one corrective patch that every stream applies identically.
- A stream edits only its **owned paths** (§5) and its **regions of the hot files** (§6). It calls only base APIs, seam APIs and APIs it creates — never a new API another stream creates; §7 wires those. **Test files:** each existing test file has one owner (§5, §6). When a stream's own change breaks a test file another stream owns, it makes the minimal assertion change in a separate commit `test(20-<stream>): <file> — <reason>` and lists it in its summary; the integration pass keeps both streams' edits.
- Each stream ends green in its own worktree: `npm run prebuild && npm run lint && npm run typecheck && npm run build && npm test` and `npm run test:tier-contract` (the root-only `tests/atomic-write.test.ts` case is the only allowed failure). `npm run build` before any test that spawns `dist/`.
- Commits: `feat(20-<stream>): …`, `fix(20-<stream>): …`, `test(20-<stream>): …`, `docs(20-<stream>): …`, small and frequent (a `wip(20-<stream>):` commit is fine for unfinished work; the container can restart), each ending with the two trailer lines. Nothing is pushed; no PR, tag, release or npm publish.
- No `test.skip` / `todo`, no loosened assertion, no `eslint-disable`, no chokepoint removed, no test-only bypass of a verdict. A test that encodes behaviour this phase supersedes is updated to assert the new behaviour and named in the summary (§8).
- Hash-pinned files: a `templates/prompts/*.md` edit re-pins `EXPECTED_PROMPT_HASHES` and `tests/repo-files.test.ts` in the same commit; a pinned fixture (`known-bad-citations.json`, `known-bad-quotes.json`) re-pins its line in `tests/repo-files.test.ts`. A persisted-schema field ships its migration and version bump (S-20).
- Cross-platform: `path.join` / `path.resolve`, every new parser gets an LF and a CRLF test, no POSIX-only assumptions in shipped code, cache files through `atomicWriteFile`.
- Experiments run in `/tmp/claude-0/-home-user-pensmith/424821c3-06dc-5dce-b0e5-b1cac8e53a7e/scratchpad/p20/<stream>/` with `XDG_DATA_HOME` and `HOME` inside, never with cwd = a checkout. Live requests and recordings use `PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org`; no personal data in any request, fixture or log; recordings are scrubbed and ≤ 51200 bytes. Pandoc: `/tmp/claude-0/-home-user-pensmith/424821c3-06dc-5dce-b0e5-b1cac8e53a7e/scratchpad/tools/pandoc`.
- The RUN-21 mock LLM (`npm run mock-llm -- --port N`, configured through the isolated global runtime.json) is the model for every LLM-path check; there is no API key.
- 23a coexistence: edits under `workflows/`, `templates/`, `references/`, `skills/`, `agents/` only as listed in §6.1, in place, small hunks; new terminal output in the edited file's existing style (PLUG-13 converts it).

### 4.2 Stream summaries

Each stream writes `.planning/phases/20-verify/20-<stream>-SUMMARY.md`: requirements closed, files, tests added or updated (with the reason for each update), deviations with D-ids, files it touched under the 23a-moving folders, test files of other streams it edited, and the items handed to the integration pass.

## 5. Streams

### 5.1 Stream `grammar` — VRFY-09, VRFY-10 (forms), VRFY-21, VRFY-22 (Pass-2 side), VRFY-23 (Pass-4 side), HARDEN-03

**Owned paths:** `bin/lib/citation-token.ts`; `bin/lib/verify/unsupported-forms.ts` (new); `bin/lib/verify/pass2.ts`; `bin/lib/verify/pass4.ts`; `bin/lib/citation-density.ts`; `bin/lib/llm-text-stubs.ts` (the regex only); `bin/lib/exporter.ts` (the locator table moves out); `bin/lib/source-context.ts` (an abstract accessor for Pass 2 only; `verifierBlindSpot` stays as is); `bin/lib/llm-contracts.ts`, `bin/lib/llm-stubs.ts` (the `claim-support` and `orphan-label` regions); `bin/lib/prompt-request.ts` (`PROMPT_INPUTS`); `bin/lib/prompt-loader.ts` (`EXPECTED_PROMPT_HASHES`); `templates/prompts/claim-support.md`, `templates/prompts/orphan-label.md`; `scripts/eslint-rules/chokepoint.mjs`; `scripts/chokepoints/citation-grammar.json` (new); `tests/fixtures/chokepoints/citation-grammar.violation.ts.txt` (new); `.github/workflows/ci.yml` (the pandoc step); tests: `citation-integrity.property.test.ts` (new), `unsupported-forms.test.ts` (new), `citation-unparseable.test.ts` (new), `pass2-pairs.test.ts` (new), `pass4-floor.test.ts` (new), `citation-token.test.ts`, `citation-grammar-pandoc.test.ts`, `tests/fixtures/citation-grammar/**`, `citation-render.test.ts`, `citation-density.test.ts`, `verify-citekey-extraction.test.ts`, `citekey-grammar-gates.test.ts`, `chokepoints.test.ts`, `known-bad-pass2.test.ts`, `known-bad-pass4.test.ts`, `pass2-byo.test.ts`, `pass2-injection.test.ts`, `tests/fixtures/pass4-orphan.json`, `tests/fixtures/pass2-adversarial.json`, `llm-contracts.test.ts`, `mock-llm.test.ts`, `prompt-request.test.ts`, `prompt-layout.test.ts`, `prompt-cache.test.ts`, `prompts-shape.test.ts`, `citation-clusters.test.ts` (all but its `extractQuotes` cases).

**Tasks:**
1. Apply seam S-C.
2. **VRFY-09 grammar.** `citationItems` returns `locator` / `label` (the `LOCATOR_TERMS` table and value grammar move from `exporter.ts`; the exporter imports them — no behaviour change in exports). `findUnparseableCitations` per D-20-07, line numbers CRLF-safe; each rule checked against pandoc 3.9 in `citation-grammar-pandoc.test.ts` (a form Pandoc renders as a citation that the grammar cannot read is UNPARSEABLE, never absent). Replace the private regexes in `pass2.ts:81`, `pass4.ts:104`, `llm-text-stubs.ts:195`, `citation-density.ts:147` with grammar calls.
3. **Chokepoint row `citation-grammar`** (D-20-06): the `regex-literal` matcher kind in `chokepoint.mjs` (and its `MATCH_KINDS`, the harness in `tests/chokepoints.test.ts`), the row JSON, the failing fixture (a `/\[@(\w+)\]/` literal and a `new RegExp('@\\{')`), the CLAUDE.md chokepoint-table row (region, §6). `npm run lint` must pass on the whole tree with the row active.
4. **VRFY-10 forms.** `findUnsupportedForms` per D-20-08 with a CRLF twin for every case; the negative corpus (a draft with none of the forms, "the Treaty of Versailles (1919)", `(n = 2019)`, `(COVID-19)`, an email, a math `$[1]$`, a fenced code block holding `\cite{}`) yields nothing.
5. **VRFY-21 / VRFY-22 Pass 2** (D-20-28): pairs from every citing sentence × `citationItems` key; LIBRARY.json abstract first (`root`), bib abstract second; the optional `fullText` provider for the full-text passage when `[verification] fetch_full_text` is not false; no text → UNCLEAR `no source text (no abstract or full text)` with no request; Semaphore(5); evidence kept only as a verbatim substring of the text sent; `renderPass2Section` with `PASS2_TABLE_HEADER`, Evidence clamped to 160 chars and table-safe. `claim-support.md`: "source text" wording, re-pinned.
6. **VRFY-23 Pass 4** (D-20-29): the strong-marker floor, sentence-level citation check (any Pandoc form), `orphans: string[]` per paragraph; the rewritten `orphan-label.md` (input `paragraph`; output `{claims:[{sentence, needs_citation, supported_by}]}`), `PROMPT_INPUTS['orphan-label'] = [paragraph]`, contract + structured stub + tests; the LLM only adds orphans; `renderPass4Section` lists each paragraph's orphan sentences. Recompute `pass4-orphan.json` expectations from the new rule (the fixture's header says how) and add the two register sentences.
7. **HARDEN-03** (D-20-09): the property test (A and B in-stream; C through `findUnparseableCitations` + `findUnsupportedForms` + `extractCitedKeysForVerification`; its gate-level half at integration), pandoc presence rule, `ci.yml` step installing pandoc 3.x on ubuntu, macOS and Windows.
8. Docs regions: PRD §7.7 Pass 2 and Pass 4 bullets; CLAUDE.md chokepoint row and the one-line citation-grammar note in "Verify".

**Verification:** the stream gate (§4.1); `npx eslint .` with the new row and its fixture failing in `tests/chokepoints.test.ts`; `node scripts/run-tests.mjs tests/citation-integrity.property.test.ts` with pandoc on PATH (≥ 1000 runs, < 90 s) and without it (skip line; with `CI=true` a failure); a mock-LLM `verify 1` in a scratch paper showing the Evidence column and a per-paragraph Pass-4 table.

### 5.2 Stream `registrar` — VRFY-10 (bare identifiers), VRFY-11, VRFY-12, VRFY-13, VRFY-14, VRFY-15, VRFY-28 (data side), VRFY-29 (citations); carry-overs 1–4

**Owned paths:** `bin/lib/verify/pass1.ts` (outside seam hunks); `bin/lib/verify/pass1-identifiers.ts`; `bin/lib/verify/freshness.ts`; `bin/lib/verify/name-match.ts` (new); `bin/lib/verify/metadata-search.ts` (new); `bin/lib/author-normalize.ts`; `bin/lib/person-name.ts`; `bin/lib/doi.ts`; `bin/lib/sources/**` except `unpaywall.ts` and `europepmc.ts` (new adapter `datacite.ts`; a content-negotiation module if needed); `bin/lib/library.ts`; `bin/lib/bibtex-write.ts`; `bin/lib/schemas/library.ts`, `bin/lib/schemas/source-candidate.ts`, `bin/lib/schemas/source-types.ts`, `bin/lib/migrations/library/**`; `bin/lib/research-orchestrator.ts`, `bin/lib/research-md.ts`, `bin/cli/research.ts` (retraction reporting only); `bin/lib/http.ts` (main owner, §6); `scripts/refresh-cassettes.mjs` (main owner), `scripts/live-sources.mjs`, `scripts/live-verify.mjs` (new), `package.json` (`live:verify`); `docs/SOURCES.md` (main owner), `PRIVACY.md` (main owner); `tests/fixtures/cassettes/**` except `unpaywall/`, `europepmc/`, `oa-pdf/`; `tests/fixtures/e2e-corpus/**`; `tests/fixtures/known-bad-citations.json`; `tests/fixtures/known-mis-cited.json` (new); tests: `known-bad-citations.test.ts`, `known-mis-cited.test.ts` (new), `pass1-*.test.ts` (existing and new), `name-match.test.ts` (new), `metadata-search.test.ts` (new), `bare-identifiers.test.ts` (new), `verify-datacite-cli.test.ts` (new), `verify-identifiers-cli.test.ts`, `verify-retraction-cli.test.ts`, `gate-retraction.test.ts`, `freshness-probe.test.ts`, `offline-fail-closed.test.ts`, `tests/sources/**` except `unpaywall.test.ts`, `source-context-verifiable.test.ts`, `library-writer.test.ts`, `library-v3.test.ts`, `bibtex-roundtrip.test.ts`, `zero-trace-export.test.ts`, `research-*.test.ts` (retraction parts), `e2e-corpus-manifest.test.ts`, `add-identifiers.test.ts`, `http*.test.ts` (the `refresh` option).

**Tasks:**
1. Apply seam S-C.
2. **VRFY-11** (D-20-10): `sources/datacite.ts` (`lookupById` three-way, `validate` shape, `HttpSource` `datacite` with TTL 7 d and a documented rate, docs/SOURCES.md and PRIVACY.md rows); the Crossref-404 path through `doi-ra.ts` → DataCite / content negotiation / FABRICATED / UNVERIFIABLE; editor-only works; case-insensitive DOIs everywhere in Pass 1; `pass1-identifiers.ts` routes (DataCite prefixes checkable), so `verifierBlindSpot` widens with no edit to `source-context.ts`. Record live: every VRFY-11 identifier (Crossref, DataCite, arXiv, PubMed, books, doi-ra prefixes) with `npm run cassettes:refresh`.
3. **VRFY-12** (D-20-03, D-20-11): every no-answer path → `UNVERIFIABLE-NETWORK` with the reason; the metadata search for identifier-less, non-BYO entries (strict match → OK naming the identifier; definitive none → `UNRESOLVABLE`; failure → `UNVERIFIABLE-NETWORK`); `UNVERIFIABLE` stays for definitive-but-uncomparable answers.
4. **VRFY-13** (D-20-11): `name-match.ts` — normalization, particles, PubMed initials, U+2010, diacritics, non-Latin, et al., corporate, editors; title with and without subtitle; year ±1; reasons name the field. A unit table covering every register example and a live self-consistency script (the CS and medicine topics of the audit, cite-all, verify) in `scripts/live-verify.mjs` reporting 0 false blocks.
5. **VRFY-14** (D-20-12): the relation-asserted alias rule (Crossref `relation` parsed in `crossref.ts`; the doi.org handle HEAD), `alternate_dois` never evidence, `OK-BYO` through `byo-text.ts byoText` (base API) with file and hash, `runPass1Unit` removed.
6. **VRFY-15 + carry-over 2** (D-20-13): the `RETRACTED` label and stderr warning; `retraction status unknown` rows for non-Crossref agencies; `crossCheckRetractions` → `clear` only for Crossref-registered DOIs (doi-ra per prefix); research's report lines.
7. **VRFY-10 bare identifiers** (D-20-14): `doi.ts findBareIdentifiers`; `runPass1` rows keyed `doi:` / `arXiv:` / `PMID:`.
8. **VRFY-28 data side + carry-over 1** (D-20-15): `FetchOptions.refresh` in `http.ts` (skip the cache read, write the answer); adapters' `lookupById(id, { refresh })` and `last_verified` from `cachedAt`; `runPass1` honours `opts.refresh` and fills `checkedAt`; `bibtex-write.ts` renders `last_verified` (with the library read-back `expect` kept exact); `exportCitedCitations` writes standard fields only; the freshness table rows (no invented `ok`); `runFreshnessForDraft` takes `{ bibEntries?, root? }` and re-checks `unknown` retraction statuses.
9. **Carry-over 3** (D-20-16): PubMed `efetch` abstracts and PMCID; recordings for the recorded e2e corpus's PubMed ids (per-adapter cassettes) or a `--corpus e2e` re-record — whichever keeps `tests/e2e-chain.test.ts` replaying; the new doi.org RA prefix recordings for the corpus's DOIs likewise.
10. **VRFY-29 (citations)**: `known-bad-citations.json` rows expect `FABRICATED` (re-pinned) and run through `runPass1` on recorded 404s (deleting one cassette entry fails the test); `known-mis-cited.json` (real DOIs with a wrong title, a wrong first author, a wrong year, a title below threshold) all `MIS-CITED` through `runPass1`.
11. `scripts/live-verify.mjs` + `npm run live:verify` (D-20-33) for VRFY-11 / 13 / 15; `scripts/live-sources.mjs` gains DataCite and efetch checks.
12. Docs regions: PRD §7.7 Pass 1 bullets and §7.12's `last_verified` sentence (split per §6), docs/SOURCES.md, PRIVACY.md (DataCite, doi.org content negotiation, efetch, what each receives), CLAUDE.md "Sources" / "Verify" Pass-1 sentences.

**Keep for the other streams:** the exports `source-context.ts` re-exports from `pass1-identifiers.ts` (`DATACITE_DOI_PREFIXES`, `NO_IDENTIFIER_REASON`; the first may become empty but stays exported) and `citationCheckRoute` / `uncheckableReason`; `library.ts` `recordLastVerified`, `tryLoadLibrary` and `exportCitedCitations` signatures.

**Verification:** the stream gate; `npm run live:sources` and `npm run live:verify` (live, contact email set) with every VRFY-11 identifier OK and `10.99999/fake.001` FABRICATED; the offline lane reproduces the same verdicts from the new recordings; `verify 1` on a scratch paper citing the Wakefield DOI prints `RETRACTED` on stderr and in VERIFICATION.md.

### 5.3 Stream `quotes` — VRFY-18, VRFY-19, VRFY-20 (Pass-3 side), VRFY-29 (quotes)

**Owned paths:** `bin/lib/quote-extractor.ts`; `bin/lib/verify/pass3.ts` (outside seam hunks); `bin/lib/verify/source-text.ts` (new); `bin/lib/sources/unpaywall.ts`; `bin/lib/sources/europepmc.ts` (new); `bin/lib/full-text.ts`; `bin/lib/byo-text.ts`; `bin/lib/normalize.ts`; `bin/lib/fuzzy.ts`; `bin/lib/pdf-text.ts`, `bin/lib/pdf-worker.ts`, `bin/lib/pdf-response.ts`; `bin/lib/paths.ts` (the source-text cache dir); `bin/lib/schemas/config.ts`, `bin/lib/config.ts` (`quote_min_words`), `bin/lib/migrations/config/v2_to_v3.ts` (new); `tests/fixtures/known-bad-quotes.json`; `tests/fixtures/cassettes/unpaywall/**`, `europepmc/**` (new), `oa-pdf/**` (new); `scripts/live-verify-quotes.mjs` (new); tests: `known-bad-quotes.test.ts`, `quote-extractor.test.ts` (new), `pass3-sources.test.ts` (new), `pass3-cache.test.ts` (new), `pass3-oa-pdf.test.ts`, `pass3-byo-cli.test.ts`, `grnd14-quote-policy.test.ts`, `full-text.test.ts`, `byo-text.test.ts`, `pdf-worker.test.ts`, `normalize*.test.ts`, `tests/sources/unpaywall.test.ts`, `tests/sources/europepmc.test.ts` (new), `config.test.ts`, `migrations.test.ts` (the config chain), the `extractQuotes` cases of `citation-clusters.test.ts`.

**Tasks:**
1. Apply seam S-C.
2. **VRFY-18** (D-20-17): the extractor rewrite on the base grammar (`findCitations`, `citationItems`, `firstCitation`, the code spans the grammar exposes); ids in document order; `quote_min_words` (config v3 + migration + PRD §10 line); scare-quote and title exclusion; cite-before-quote; UNATTRIBUTED; one entry per key; CRLF twins; the 30,000-draft ground-truth fuzz of review round 2 kept (every cited quote extracted, no spurious text).
3. **VRFY-19** (D-20-18): `source-text.ts` (fetch through `http.ts` with redirects, `bodyBytes` only, `checkPdfResponse`, the SEC-02 worker with every error caught, the cache with the fetching source's TTL (`http.ts` exports its TTL lookup, §6), offline never reading it); the order BYO → Unpaywall `oa_locations` → Europe PMC → arXiv; `PASS` / `FUZZY` / `NOT_FOUND`; the D-20-03 split and its reasons; `localFile` for BYO matches; `full-text.ts` basis ⊆ Pass 3's (`tests/pass3-oa-pdf.test.ts` asserts flag ⇒ Pass 3 fetched text); `sourceTextPassage` for Pass 2 (never BYO text). Recordings: an Unpaywall lookup → redirecting PDF URL → tiny real PDF chain, a Europe PMC OA full text, an arXiv PDF redirect (≤ 51200 bytes each; binary bodies base64, D-19-07).
4. **VRFY-20 Pass-3 side**: `UNVERIFIABLE-QUOTE` rows carry `id` / `quoteSha256` (seam) and the reason; no `PDF_UNAVAILABLE` / `TEXT_UNAVAILABLE` written any more.
5. **VRFY-29 (quotes)** (D-20-19): `known-bad-quotes.json` as drafts + source texts with every artifact class on both sides and a genuine quote per class; 10/10 NOT_FOUND and every genuine one PASS through `extractQuotes` + `runPass3`; `runPass3Unit` removed; hash re-pinned.
6. `scripts/live-verify-quotes.mjs` (NumPy genuine sentence PASS and the penguin sentence NOT_FOUND; PLOS 10.1371/journal.pone.0000001 > 10k chars; arXiv 1706.03762 through its redirect).
7. Docs regions: PRD §7.7 Pass 3 bullets (UNVERIFIABLE-QUOTE outcome with VRFY-20's reason) and §10 `quote_min_words`; docs/SOURCES.md (Europe PMC) and PRIVACY.md (the source-text cache: public OA text only, where it lives, how to clear it).

**Keep for the other streams:** `full-text.ts` `isDataCiteArxivDoi`, `arxivIdOfEntry`, `fullTextAvailable`, `fullTextByCitekey`, `quotesWithoutFullText`; `byo-text.ts` `byoText`, `byoPassages`, `byoCopyAltered`; `fuzzy.ts` `jaroWinkler`, `TITLE_JW_THRESHOLD`, `AUTHOR_JW_THRESHOLD` (unchanged); `extractQuotes(md)` callable with one argument.

**Verification:** the stream gate; against a local mock (Unpaywall → redirect → PDF) a fabricated 17-word quote cited `[@k, p. 3]` is NOT_FOUND and a verbatim one PASS; a BYO-backed quote verifies with the dial recorder showing zero connects; a corrupt PDF yields a `fetch failed` UNVERIFIABLE-QUOTE and no `unhandledRejection`; a second `runPass3` over the same draft (live mode, MockAgent) makes 0 PDF requests; `node scripts/live-verify-quotes.mjs` live.

### 5.4 Stream `gate` — VRFY-16, VRFY-17, VRFY-20 (acceptance), VRFY-22 (done side), VRFY-23 (done side), VRFY-24, VRFY-25, VRFY-26, VRFY-27, VRFY-28 (recheck + recording)

**Owned paths:** `bin/lib/verify/gate.ts` (new); `bin/lib/verify/clock.ts` (new); `bin/lib/verify/verification-md.ts` (new); `bin/lib/verify/verdict-rows.ts` (outside seam hunks); `bin/cli/verify.ts`, `bin/cli/compile.ts`, `bin/cli/done.ts` (outside seam hunks); `bin/cli/write.ts` (the stub marker); `bin/lib/compile.ts`; `bin/lib/compile-report.ts`, `bin/lib/schemas/compile-report.ts`; `bin/lib/compile-inputs.ts`, `bin/lib/schemas/compile-inputs.ts`, `bin/lib/migrations/compile-inputs/v1_to_v2.ts` (new); `bin/lib/quote-acceptance.ts` (new), `bin/lib/schemas/quote-acceptances.ts` (new); `bin/lib/citations.ts` (`parseBibEntries`); `bin/lib/gates.ts`; `bin/lib/router.ts` (outside the seam hunk); `bin/lib/revise.ts` (its flagged-verdict list only: `RETRACTED`, `UNASSIGNED` and the other citekey-bearing failing verdicts become revisable — REV-03 keeps the rest for Phase 22); `bin/lib/plan-status.ts`; `bin/lib/status-view.ts`; `bin/lib/section-registry.ts`; `workflows/verify.md`, `workflows/compile.md`, `workflows/done.md`, `skills/verify-section.md` (§6.1); `README.md` (main owner), `CONTRIBUTING.md`; `scripts/e2e-smoke.mjs`; tests: `gate-core.test.ts` (new), `verify-summary.test.ts` (new), `verify-malformed-bib.test.ts` (new), `verify-unassigned.test.ts` (new), `verify-placeholder.test.ts` (new), `quote-acceptance.test.ts` (new), `quote-acceptance-cli.test.ts` (new), `compile-recompute.test.ts` (new), `done-recompute.test.ts` (new), `forged-artifacts.test.ts` (new), `stale-inputs.test.ts` (new), `last-verified-recheck.test.ts` (new), `verdict-rows-roundtrip.property.test.ts` (new), `compile-*.test.ts`, `done-*.test.ts`, `export-*gate*.test.ts`, `verdict-rows.test.ts`, `verify-no-llm.test.ts`, `verify-advisory-isolation.test.ts`, `verify-bib-regen.test.ts`, `empty-bib.test.ts`, `bare-chain.test.ts`, `e2e-chain.test.ts`, `tier-contract.test.ts`, `tests/tier-contract/**`, `section-isolation*.test.ts`, `dry-run-*.test.ts`, `pensmith-router.test.ts`, `revise*.test.ts`, `section-registry.test.ts`, `gates-registry.test.ts`, `verifiable-sources-cli.test.ts`, `wave-write-cli.test.ts`, `write-containment.test.ts`, `section-status-transitions.test.ts`, `status.test.ts`, and every other existing test whose `PENSMITH_NO_LLM` write feeds verify / compile / done (D-20-21).

**Tasks:**
1. Apply seam S-C.
2. **Gate core** (D-20-05): `gate.ts` over one text — Pass 1 via `runPass1` with `bibEntries` and `refresh`, Pass 3 via `runPass3`, UNASSIGNED against `allowedKeys`, NO-CITATIONS, PLACEHOLDER (outside `--dry-run`), the acceptance lift, `checkedAt` collection; row rendering in `verification-md.ts` (D-20-20) with the summary and its parser.
3. **VRFY-16** (D-20-20): `citations.ts parseBibEntries`; `verifying` before the passes; every early return persists status; UNPARSEABLE bib-entry rows; the router's handling of `verifying` (a crashed verify re-verifies) and of a missing draft (→ write); three bare runs never repeat an identical verify.
4. **VRFY-17, VRFY-24** (D-20-21): UNASSIGNED rows; NO-CITATIONS; the stub marker in `write.ts` (LLM-stubbed mode only), PLACEHOLDER outside `--dry-run`, the dry-run compile removing marker lines; the `PENSMITH_NO_LLM` test fallout moved to the mock LLM / `--dry-run` / `--no-verify` / seeded drafts (each named in the summary).
5. **VRFY-20 acceptance** (D-20-22, D-20-26): schema + module (the record's path is derived from the section folder `sectionPlan` names — no `paths.ts` edit), `verify N --accept-quote <id>` (repeatable; unknown or non-acceptable id → exit 2 naming its verdict), the `quote-accept` gate (multi-select + "accept all"; `--yolo` never; non-TTY skip), honouring in the gate core, `## Accepted quotes` in VERIFICATION.md, COMPILE-REPORT.md sections (D-14 additive), done's list. `verify 1 --accept-unverifiable-quotes` stays an unknown flag (EXIT_USAGE).
6. **VRFY-25, VRFY-27 compile** (D-20-23): the per-section recomputation over the exact draft bytes; the refusals; the stale-section re-verify through `verifySection` with advisory passes off (writes only that section's VERIFICATION.md and PLAN.md); an unreadable bib → REFUSED reason; COMPILE-INPUTS v2 + migration; compile never writes LIBRARY.json, CITATIONS.bib or `last_verified` (byte-identical assertions).
7. **VRFY-26, VRFY-27 done** (D-20-24, D-20-25): sections from the registry; stale checks; the gate core over DRAFT.md before any paid / third-party step and again over FINAL.md's bytes (the GATE-04 key diff removed); every reason listed; the `unsupported-claims` gate with evidence; the paper-level `.paper/VERIFICATION.md` (decisions, per-paragraph Pass 4 over the exported text, quote lists); `last_verified` recorded; never a write under `sections/`.
8. **VRFY-28 recheck + recording** (D-20-15, D-20-27): `clock.ts`; `refresh` = keys with `last_verified` null or older than `recheck_after_days`; `recordLastVerified` after verify and done from `checkedAt` of passing rows (it records nothing until `registrar`'s `checkedAt` lands — the end-to-end test is §7).
9. **Gates, router, docs**: `quote-accept`, `unsupported-claims` in `gates.ts` + PRD §7.20 (the planned rows replaced); the router's attention for UNVERIFIABLE-QUOTE / PLACEHOLDER naming the remedies (S-13: other sections go on, compile refuses with the options); `workflows/verify.md` (S-13 correction of "unverifiable does not block", the flag, the summary), `workflows/compile.md`, `workflows/done.md`, `skills/verify-section.md`; README verifier section; PRD §7.7 intro / output / status paragraph, §7.8, §7.9, §7.12 (the recheck paragraph), §7.20; CLAUDE.md workspace list (`QUOTE-ACCEPTANCES.json`, COMPILE-INPUTS v2) and the Verify / Compile paragraphs.

**Verification:** the stream gate plus `npm run test:tier-contract` and `node scripts/e2e-smoke.mjs`; in a scratch paper (built CLI, mock LLM): a forged VERIFICATION.md + PLAN.md over a fabricated key → compile REFUSED with the recomputed FABRICATED row, exit 4; the acceptance record, flag and lift exercised on gate-core rows carrying `UNVERIFIABLE-QUOTE` (the base Pass 3 still writes the legacy label; the CLI flow on a real UNVERIFIABLE-QUOTE is §7); `done` after a hand edit to `.paper/DRAFT.md` → BLOCKED listing staleness and the recomputed rows, nothing under `export/`; every file under `sections/` mtime-unchanged by done.

## 6. Hot files and regions

| File | Main owner | Other stream regions |
|---|---|---|
| seam S-C files (§3.2) | seam (nobody edits the seam hunks) | outside the hunks: `pass1.ts` registrar, `pass3.ts` quotes, `verify.ts` / `compile.ts` / `done.ts` / `verdict-rows.ts` / `router.ts` gate |
| `bin/lib/http.ts` | registrar (`HttpSource` `datacite` after `'crossref'`, its TTL / rate rows next to crossref's, `FetchOptions.refresh`) | quotes: `europepmc` after `'unpaywall'` in the union and the tables, and one exported TTL lookup placed right after `NEGATIVE_RESPONSE_TTL_MS` |
| `bin/lib/sources/index.ts` | registrar (`datacite`) | quotes: the `europepmc` import and registry line |
| `tests/repo-files.test.ts` | — | grammar: the `claim-support` / `orphan-label` pins; registrar: the `known-bad-citations.json` pin; quotes: the `known-bad-quotes.json` pin |
| `PRD.md` | — | grammar §7.7 Pass 2 + Pass 4 bullets; registrar §7.7 Pass 1 bullets, §7.12 `last_verified` sentence; quotes §7.7 Pass 3 bullets, §10 `quote_min_words`; gate §7.7 intro / output paragraph, §7.8, §7.9, §7.12 recheck sentence, §7.20 rows |
| `CLAUDE.md` | gate (workspace list, Verify / Compile / done text) | grammar: the citation-grammar chokepoint row; registrar: the Sources and Pass-1 sentences; quotes: the Pass-3 sentence |
| `docs/SOURCES.md`, `PRIVACY.md` | registrar | quotes: the Europe PMC row / section and the source-text cache paragraph |
| `scripts/refresh-cassettes.mjs` | registrar | quotes: its recorder block for `unpaywall` / `europepmc` / `oa-pdf` |
| `package.json` | registrar (`live:verify`) | none |
| `tests/citation-clusters.test.ts` | grammar | quotes: the `extractQuotes` cases |
| `tests/fixtures/cassettes/**` | registrar | quotes: `unpaywall/`, `europepmc/`, `oa-pdf/` |
| `README.md` | gate | none during the streams (registrar and quotes hand README lines to §7) |

A merge conflict inside a hot file is resolved by keeping every stream's region; the integration pass re-runs the full gate after each merge.

### 6.1 Files under the folders Phase 23a moves (re-apply after PLUG-02)

Only these may change, in place: `templates/prompts/claim-support.md`, `templates/prompts/orphan-label.md` (grammar; re-pinned); `workflows/verify.md`, `workflows/compile.md`, `workflows/done.md`, `skills/verify-section.md` (gate). Every stream lists what it changed there in its summary, and 20-SUMMARY.md collects them for the 23a merge.

## 7. Integration pass (after the four streams merge)

1. Merge `grammar`, `registrar`, `quotes`, `gate` (any order) into the phase integration branch, resolving §6 regions; `npm run check` after each merge.
2. **Cross-stream wiring.**
   - gate ← grammar: `findUnparseableCitations` + `findUnsupportedForms` rows in `gate.ts` (section drafts, the compiled DRAFT.md, FINAL.md; key slot `L<line>`).
   - gate ← grammar/quotes: verify passes `fullText: (key, claim) => sourceTextPassage(root, key, claim)` to `runPass2`.
   - gate ← registrar: `runFreshnessForDraft(…, { bibEntries, root })`; `blockingRowReason` wording for the post-Phase-20 `UNVERIFIABLE` ("cannot be checked: <agency> …") and `RETRACTED` (the notice).
   - Delete any transitional mapping left for `PDF_UNAVAILABLE` / `TEXT_UNAVAILABLE` in writers (the seam's legacy set stays for reading older files).
3. **Cross-stream acceptance tests** (built CLI, isolated data dir, recorded fixtures, mock LLM): VRFY-09 (FABRICATED for `[@ghost.2099]`, `[@_ghost2099]`, `[@ghost+2099, p. 3]`, `[-@ghost2099]`, narrative `@ghost2099`; UNPARSEABLE for `[@]`, `[@k`, `@{unterminated`; compile and done refuse, no DRAFT.md); VRFY-10 (V4 / V6 / V7 and `<cite>` / `^[…]` refused at verify, compile and done; a clean draft has no UNSUPPORTED-FORM row); VRFY-12 compile retry message; VRFY-15 compile / done naming RETRACTED; VRFY-19 + VRFY-20 end to end (the Unpaywall-redirect-PDF mock; the `aggarwal2022` acceptance flow; `add` of a PDF with / without the quote; any byte change voiding the acceptance; hand-written acceptances ignored); VRFY-25 / VRFY-26 forged-artifact suite with every new verdict; VRFY-26's second-done 0-request check with MockAgent counting; VRFY-28 with the test clock (31-day entry → a request during done; 1-day → none; `recheck_after_days = 7`; wave verify of 3 sections loses no timestamp; compile byte-identical); HARDEN-03 Property C through `recomputeGate`.
4. **Recordings.** `npm run cassettes:refresh` for anything the merged code requests that no stream recorded; re-record the e2e corpus (`--corpus e2e`, D-18-31) if the merged adapters' requests changed and the streams did not already; scrub and size checks.
5. **Docs sweep.** README (verifier: the verdicts, UNVERIFIABLE-QUOTE and `--accept-quote`, `last_verified`, `live:verify`, `quote_min_words`), CONTRIBUTING (recording DataCite / Europe PMC / PDFs, the property test and pandoc), CLAUDE.md (Verify / Compile / done paragraphs, workspace list, chokepoint row), PRD cross-read of every amendment in D-20-31.
6. **Full gate** on Node 22 and 24: `npm run check`; `node scripts/e2e-smoke.mjs`; `npm run test:coverage` (80 / 66); `git status --porcelain` clean after build; the data-dir fingerprint unchanged; `npm run live:sources`; `npm run live:verify` (live).
7. **User-path acceptance** (§9) in `scratchpad/p20/integration/`, built CLI, live where marked, including the PRD §15 assignment reaching done unaided with the mock LLM and live sources (VRFY-13's todo).
8. **Close-out.** `20-VERIFICATION.md` (every §9 check with evidence; open items), `20-SUMMARY.md` (streams, deviations, the §6.1 file list for the 23a merge, hand-offs to Phases 21–23: PLUG-07 / PLUG-10 call `gate.ts` / `quote-acceptance.ts`; EXP-03's style and EXP-04 note footnotes after the gate), REQUIREMENTS.md checkboxes and traceability, ROADMAP Phase 20 status, STATE.md (remove the resolved todos).

## 8. Tests that encode superseded behaviour (updated, not skipped)

- Seam S-C: none (base labels behave identically).
- grammar: `known-bad-pass4` / `pass4-orphan.json` expectations derived from the old R6-only rule and the 500-character proximity (→ the D-20-29 floor, recomputed); Pass-2 tests expecting one row per key and the 4-column table (→ one row per (sentence, key), Evidence column); `prompt-layout` / `prompt-request` / `llm-contracts` expectations of `orphan-label`'s `[paragraph, sentence]` inputs and `{label}` output.
- registrar: `known-bad-citations` via `runPass1Unit` and `expected_verdict: "MIS-CITED"` (→ `runPass1`, FABRICATED); Pass-1 tests expecting `MIS-CITED` + retraction for a retracted work (→ `RETRACTED`), `UNVERIFIABLE` for a failed lookup (→ `UNVERIFIABLE-NETWORK`), `UNVERIFIABLE` for a DataCite DOI (→ OK or the DataCite verdict), a strict-match redirect pass without a relation (→ MIS-CITED); freshness `DOI HEAD | ok` rows for DOI-less sources; research `clear` for non-Crossref DOIs.
- quotes: `known-bad-quotes` via `runPass3Unit` (→ the production path); every `PDF_UNAVAILABLE` / `TEXT_UNAVAILABLE` expectation (→ UNVERIFIABLE-QUOTE / UNVERIFIABLE-NETWORK with the D-20-03 reason); extractor tests assuming the 10-word / 60-character floor; Pass 3 "offline never looks" (→ exact fixture replay or UNVERIFIABLE-NETWORK).
- gate: compile / done tests expecting `Status: unverifiable` quotes to compile; done tests relying on directory listing and the GATE-04 key diff; tests where a `PENSMITH_NO_LLM` draft verifies, compiles or exports outside `--dry-run` (→ PLACEHOLDER; moved to the mock LLM, `--dry-run`, `--no-verify` or seeded drafts); the missing-bib `EXIT_ERROR` (→ FABRICATED rows, EXIT_BLOCKED); a stale compile re-verify that left VERIFICATION.md untouched (→ it rewrites that section's file); a hand-edited DRAFT.md exporting (→ stale refusal).

## 9. Acceptance checks (user path)

Built CLI (`node dist/bin/pensmith.js`), a fresh scratch folder per check with `XDG_DATA_HOME` / `HOME` / `LOCALAPPDATA` inside, `PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org`; "fixture" = offline replay of recorded answers; "live" = real services; "mock" = RUN-21 mock LLM.

| Req | Check |
|---|---|
| VRFY-09 | fixture: sections citing `[@ghost.2099]`, `[@_ghost2099]`, `[@ghost+2099, p. 3]`, `[-@ghost2099]`, narrative `@ghost2099` → each a FABRICATED row; `compile --yolo` exit 4, no `.paper/DRAFT.md`. Drafts with `[@]`, `[@k`, `@{unterminated` → UNPARSEABLE row naming text and line, Status failed; compile and done exit 4. `npx eslint` fails on the chokepoint fixture; the verdict-row round-trip property test passes |
| VRFY-10 | fixture: a bare `doi:10.9999/x` → FABRICATED; a bare real DOI → OK. "(Nguyen & Patel, 2019)" + `### References` with a DOI-less fake entry, `\cite{fake2019}`, a `[^1]` footnote with a DOI-less fake reference, `<cite>Nguyen 2019</cite>`, `^[Nguyen & Patel 2019]` → UNSUPPORTED-FORM rows, compile exit 4; a clean draft → no UNSUPPORTED-FORM row |
| VRFY-11 | live (`npm run live:verify`): `verify 1` on a seeded section with 10.1038/nature14539, 10.1017/CBO9780511804441, 10.48550/arXiv.1706.03762, arXiv:1810.04805, ISBN 9780226458083, 10.5281/zenodo.1212303, PMID 31535829, 10.1007/978-3-319-24574-4, 10.1038/nature11247 → all OK; 10.99999/fake.001 → FABRICATED; 10.1038/NATURE14539 with the right title → OK; fixture lane → the same verdicts |
| VRFY-12 | fixture/MockAgent: Crossref 429, 500, timeout → UNVERIFIABLE-NETWORK, Status unverifiable, never FABRICATED; `compile --yolo` exit 4 with the retry message; an identifier-less entry of a real work → OK naming the matched DOI; one matching nothing → UNRESOLVABLE, blocks; known-bad-citations ≥ 10 FABRICATED |
| VRFY-13 | fixture + live: "van der Maaten, Ernst", "Smith JA" / "Wu JY", "van der Aart‐van der Beek" (U+2010) → OK; 10.1007/978-0-387-84858-7 cited with its subtitle → OK; lecun2015 with year 1999 → MIS-CITED (year); right DOI + wrong title / wrong first author → MIS-CITED; live self-consistency (CS, medicine) → 0 false blocks; PRD §15 assignment reaches done unaided (mock + live sources) |
| VRFY-14 | fixture: a fabricated DOI copying a real paper's title and authors → FABRICATED; a forged `alternate_dois` entry does not pass a fabricated primary DOI; a Crossref-asserted preprint / version-of-record pair → OK; an identifier-less BYO entry with a hash-matching PDF → OK-BYO naming file and hash; a BYO tag on a DOI Crossref and DataCite do not know → FABRICATED |
| VRFY-15 | fixture + live: a section citing the Wakefield DOI → RETRACTED row + stderr warning, Status failed; compile and done exit 4 naming it; a non-Crossref DOI's `retraction status unknown` appears in VERIFICATION.md and never as clean; research on such a DOI records `unknown` with the reason |
| VRFY-16 | a bib with one broken and one good entry, draft citing both → `verify 1` exit 4, broken key UNPARSEABLE (key + line), good key OK, no stack; a 0-byte bib with `[@a]` → FABRICATED, failed; `compile --yolo` exit 4, no parseBib stack; DRAFT.md deleted → bare `pensmith --yolo` routes to write, three bare runs never repeat an identical verify; an injected Pass-3 throw after a verified run leaves status not `verified` |
| VRFY-17 | `[@lecun2015]` in §1 (in the bib, not assigned) → `lecun2015: UNASSIGNED`, Status failed, exit 4, compile refuses; a hand edit adding an unassigned key after a clean verify → compile's recomputation refuses |
| VRFY-18 | `extractQuotes` returns an entry for a 6-word quote, `"…" [@k, p. 3]`, `[@k p. 3]`, `[@Vaswani2017]`, `[@a; @b]` (two), `[see @k]`, curly quotes + locator, cite-before-quote, a block quote with a locator; a long uncited quote → UNATTRIBUTED, Status failed |
| VRFY-19 | mock server (Unpaywall → redirect → tiny PDF): a fabricated 17-word quote `[@k, p. 3]` → NOT_FOUND, failed, compile exit 4; a verbatim quote → PASS; live: NumPy genuine sentence PASS, the penguin sentence NOT_FOUND, PLOS PDF > 10k chars, arXiv 1706.03762 via redirect; BYO quote with zero network calls, reported `verified against your local file <name>` in VERIFICATION.md, COMPILE-REPORT.md and done; a forged `.paper/sources/<key>.txt` does not pass a fabricated quote; a corrupt PDF → `fetch failed`, no unhandledRejection; a paper verified live recomputes Pass 3 at compile and done with the network denied and 0 PDF requests |
| VRFY-20 | "attention mechanisms are nothing more than lookup tables for bananas" `[@aggarwal2022]` with no OA text → UNVERIFIABLE-QUOTE q1, unverifiable, `compile --yolo` exit 4 naming the quote; `add ./aggarwal2022.pdf` without the quote → NOT_FOUND, with it → PASS; `verify 1 --accept-quote q1` → compile succeeds, COMPILE-REPORT lists the quote + timestamp; one changed draft byte → compile refuses again; a hand-written acceptance line in VERIFICATION.md and a hand-written QUOTE-ACCEPTANCES.json entry for a NOT_FOUND quote → compile refuses; `verify 1 --accept-unverifiable-quotes` → exit 2; PRD §7.7 describes the outcome |
| VRFY-21 | mock: 3 sentences citing A + 1 citing B → 4 judgments, each request carrying the LIBRARY abstract in fences; a delayed mock sees ≤ 5 concurrent and > 1 with ≥ 5 pairs; no abstract → UNCLEAR `no source text`, all rows present; `[@smith2020, p. 5]` → a smith2020 row |
| VRFY-22 | mock UNSUPPORTED with evidence → non-empty Evidence cell that is a substring of the abstract; pty `pensmith done` lists each UNSUPPORTED claim with evidence, yes → `Confirmed by user <ts>` in `.paper/VERIFICATION.md`; `--yolo` → `Auto-accepted under --yolo <ts>`; no file under `sections/` changes; known-bad-pass2 mock cases assert evidence |
| VRFY-23 | offline: the two register sentences uncited → orphan count 2, cited → 0; a mock labelling an uncited claim adds it; a mock answering zero orphans does not lower the floor; the "Studies show that 73% … 40 percent." paragraph appended to a section draft, re-verified and recompiled → done reports ≥ 2 orphans in `.paper/VERIFICATION.md` and in the confirmation (D-20-25) |
| VRFY-24 | `verify` writes the summary table first; a parser proves counts = rows; repeated `PENSMITH_NO_LLM=1 pensmith next --yolo` (no `--dry-run`) never exports — compile or done refuses with the placeholder reason; with `--dry-run` the chain completes, outputs marked dry-run and marker-free; assigned [a, b] + citation-free draft → failed, exit 4; an introduction with no assigned sources and no citations → verified |
| VRFY-25 | a §2 draft with `[@doe.2021]` (and `Doe.2021`, `_doe2021`, `doe/2021`, `doe+2021`, `doe#1`) → compile REFUSED, exit 4, no DRAFT.md; forged VERIFICATION.md (verified, all OK) + PLAN verified with a matching hash over a fabricated DOI → REFUSED with the recomputed FABRICATED; `Status: failed` with no rows → refuses; empty bib + stale section → REFUSED reason, no stack; warm cache + network denied → compile recomputes (Pass 3 included) with 0 PDF requests; LIBRARY.json and CITATIONS.bib byte-identical after compile |
| VRFY-26 | after a clean verify + compile, appending `Smith showed … [@smith2099fake].` + a bib entry with DOI 10.9999/totally-fake-2099 to `.paper/DRAFT.md` → `done --raw --yolo --format md` prints BLOCKED naming smith2099fake (and the stale compile), exit 4, no `.paper/export/`; FINAL.md adding `[@Fake2021]`, `[@fake2021, p. 4]`, `@fake2019`, `[-@fake2019]`, "(Nguyen & Patel, 2019)", a `[^1]` footnote, a `### References` list → exit 4, nothing exported; a section in OUTLINE/STATE without VERIFICATION.md blocks; a second done → 0 citation requests; `sections/*` mtimes unchanged |
| VRFY-27 | editing a section DRAFT.md after verify + compile → `done` refuses `stale: §1 changed since verification — re-verify and recompile` (exit 4); editing `.paper/DRAFT.md` after compile (no citation added) → stale-compile refusal |
| VRFY-28 | after `verify 1` every cited key has `last_verified` in LIBRARY.json and `.paper/CITATIONS.bib`; a wave verify of 3 sections loses none; test clock: 31-day-old → a request during done, 1-day-old → none, `recheck_after_days = 7` moves the threshold; compile leaves both files byte-identical; `export/CITATIONS.bib` has no `last_verified` and no "pensmith"; the freshness table has no `DOI HEAD | ok` row for a DOI-less source |
| VRFY-29 | known-bad-citations 12/12 FABRICATED via `runPass1` on recorded 404s (a deleted cassette entry fails the test); known-mis-cited all MIS-CITED via `runPass1`; known-bad-quotes 10/10 NOT_FOUND via `extractQuotes` + `runPass3` with local text, every artifact class's genuine quote PASS; fixture hashes re-pinned |
| HARDEN-03 | `node scripts/run-tests.mjs tests/citation-integrity.property.test.ts` with pandoc: ≥ 1000 runs, Properties A, B, C hold, `Claim A [@smith2020 [see note]].` fixed; with `CI=true` and no pandoc → fails; CI installs pandoc on all three OSes |

## 10. Risks

- **Seam defects.** The seam was built and run green on the base; a defect gets one corrective patch every stream applies (§4.1).
- **The placeholder rule ripples through the suite** (D-20-21). Many existing tests drive `PENSMITH_NO_LLM` writes into verify, compile or done. Gate budgets for it: each such test moves to the mock LLM (`tests/helpers/e2e-chain.ts` / `llm-sandbox.ts` patterns), `--dry-run`, `--no-verify` or seeded drafts — never a test-only switch that lets a stub draft verify.
- **Blocking unverifiable quotes** change every chain with a quote (e.g. the D-18-43 bare-chain case, GRND-14): record the OA answers or assert the new block; do not accept quotes in tests except where the test is about acceptance.
- **Live services** (keyless OpenAlex / Semantic Scholar budgets, arXiv's 3 s floor, DataCite and Europe PMC limits) can block recordings and live lanes; record when available, retry later, report any unobserved live check as open rather than claimed (19-VERIFICATION precedent).
- **Metadata-search false positives** (D-20-11) would pass a wrong work: strict thresholds, year required when both sides have one, and the matched identifier named in the row.
- **Pandoc oracle cost / portability** (D-20-09): batching keeps the run short; the CI install must work on Windows and macOS runners.
- **Hot-file conflicts** (§6) and **Phase 23a's moves and output sink**: small regions, one owner per test file, the §6.1 list; the integration pass keeps every region.
- **Cache semantics**: offline never reads either cache, so "warm cache, network denied" checks run in live mode with MockAgent / the dial recorder, never offline.
- **Scope**: 22 requirements across four streams. A stream that cannot finish a task commits what works, names the gap in its summary and hands it to the integration pass; nothing is marked Complete without its §9 check observed.
