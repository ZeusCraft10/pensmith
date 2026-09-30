# Phase 20 — stream `quotes` summary

**Branch:** `v1/p20-quotes` (from the plan commit `1e43b9e`; the first commit `ba48770` applies seam S-C byte-identically) · **Requirements:** VRFY-18, VRFY-19, VRFY-20 (Pass-3 side), VRFY-29 (quotes) · **Decisions:** D-20-01..04, D-20-17, D-20-18, D-20-19, D-20-31 (Pass 3 / §10 paragraphs)

## What was built

**The quote extractor** (`bin/lib/quote-extractor.ts`, rewritten; VRFY-18, D-20-17). `extractQuotes(md, { minWords? })` returns every direct quote in document order as `{ id, text, citekey: string | null, kind: 'block' | 'inline', line, locator? }`:
- ids `q1`, `q2`, … come from `verdicts.ts` `quoteId`, and every key of a cluster shares its quote's id. Lines are 1-based. The locator is taken from the citation (`citationItems` suffix).
- Inline quotes count at `[verification] quote_min_words` words or more (default 5). They can be in straight `"…"` or typographic `“…”` double quotes, which pair the way Pandoc pairs them (an escaped `\"` is not a mark, a straight `"` after a letter or digit does not open, a new `“` restarts the quote), or in typographic single quotes `‘…’` (a `’` followed by a letter is an apostrophe).
- A block quote is one quote per `>` run, lazy continuation lines included.
- Attribution:
  - a citation right after the quote, in any Pandoc form from the grammar in `citation-token.ts` (clusters give one entry per key; `[see @k, p. 3]`, `[-@k]`, `@{k}`);
  - a citation before it in the same sentence (within 240 characters, with no sentence end in between; abbreviations and initials are not sentence ends), e.g. `[@k] writes, "…"` or `@k notes that "…"`;
  - for a block quote, in priority order: a citation inside the block, a following paragraph that holds only a citation (a leading dash is allowed), a same-sentence lead-in citation, then a citation that opens the next paragraph.
- Excluded:
  - quotes under the word floor (scare quotes);
  - titles: a quote after `titled` / `entitled` / `called` / `named` / `the article` / `the book` / `the paper`, or Title Case of at most 12 words with no sentence end inside;
  - Markdown link titles;
  - quotes nested inside another quote;
  - quotes inside provable code.
- A direct quote with no attributable citation is one entry with `citekey: null`, which Pass 3 renders as `(unattributed)` / `UNATTRIBUTED`.
- The quote text drops citations, link syntax, escapes and emphasis markers, and collapses whitespace.
- CRLF input gives exactly what its LF twin gives.
- `extractQuotes(md)` still works with one argument, and `full-text.ts` `quotesWithoutFullText` reads the same extractor. It skips unattributed quotes and leaves them to Pass 3.

**Config** (S-20):
- `bin/lib/schemas/config.ts` is at `CURRENT_CONFIG_VERSION = 3` and adds `[verification] quote_min_words`, an integer from 1 to 5 with default 5 (exported as `DEFAULT_QUOTE_MIN_WORDS`).
- The version-only migration is `bin/lib/migrations/config/v2_to_v3.ts`.
- `config.ts` adds the migration and the default.
- The PRD §10 line documents the key.

**Pass 3's sources** (`bin/lib/verify/source-text.ts`, new; VRFY-19, D-20-18). `sourceTextAttempts(identity, { refresh })` yields text attempts in this order, each `text | no-text (reason) | no-answer (reason)`:
1. Every PDF Unpaywall lists for the DOI, best location first and de-duplicated. The list comes from the new `unpaywall.ts` `lookupOaPdfUrls` / `oaPdfUrls`, which make the same request as `lookupById`; a missing contact email returns `noEmail`.
2. The Europe PMC full text of the PMCID from LIBRARY.json, fetched through the new adapter `sources/europepmc.ts` (`lookupFullText`, JATS to text). It is used only when the article's front matter names the DOI or PMID the citation carries, and those ids are cached with the text and checked again on every read.
3. The arXiv PDF of the arXiv id, derived from the id and never from a stored URL. Beside a DOI that is not an arXiv DOI, it counts only when its first 6,000 characters show the entry's title (matchQuote ratio ≥ 0.9).

How each copy is fetched and read:
- Every fetch goes through `http.ts` with redirects followed.
- A PDF is checked with `checkPdfResponse` on `bodyBytes` and extracted in the SEC-02 worker. Every error is caught, and a timeout is a `fetch failed` reason.
- The user's own PDF stays in `pass3.ts` step 1, through `byo-text.ts`, with no network.

**The extracted-text cache:**
- Location: `pensmithDataDir()/source-text/<sha256(url)>.json` (`paths.ts` `pensmithSourceTextCacheDir()`).
- Fields: `{url, final_url, content_sha256, text_sha256, text, saved_at, source}`, plus the article `ids` for Europe PMC.
- Writes: through `atomicWriteFile`, only after a successful extraction, and only for text of at most 4 MiB.
- Freshness: an entry is fresh for the TTL of the source that fetched it (`http.ts` `sourceTtlMs`). A stale entry whose re-fetched bytes still hash the same keeps its text with no re-extraction.
- Reads: an entry whose text no longer matches `text_sha256`, or whose url or source differs, is ignored.
- Offline: never read or written.
- Within one process, attempts are also remembered for 60 s by mode and URL, and extractions by content hash (16 entries).

**Pass 3** (`bin/lib/verify/pass3.ts`, rewritten outside the seam's field declarations; VRFY-19, VRFY-20). `runPass3(draftMd, bibByCitekey, { root?, refresh?, minWords? })` returns one row per (quote, key) with `id`, `quoteSha256` (`quoteTextSha256`), `line`, `locator`, and `localFile` when the quote was verified against the user's own PDF. `minWords` defaults to the paper's config when `root` is given. Matching is `fuzzy.ts` `matchQuote`:
- a Sellers semi-global edit distance with an Ukkonen cutoff;
- `normalizeForQuote`: NFKC, soft hyphens and zero-width characters, dashes, quotes, ellipses, line-break hyphenation, case and whitespace;
- elisions (`…`) are matched segment by segment.

The verdicts are `verdicts.ts` labels:

| Verdict | When |
|---|---|
| `PASS` | verbatim after normalization — `verbatim in <label>`, or `verified against your local file <name> (sha256 <12hex>…)` |
| `FUZZY` | ratio ≥ `QUOTE_LEV_THRESHOLD` (0.95) — `found in <label> at lev=x (not verbatim)` |
| `NOT_FOUND` | text of the work was read and the quote is not in it — `quote not found in <labels> (best lev=x < 0.95)`, with any no-answer copies appended; the user's recorded PDF missing or changed (unchanged Phase 19 behaviour, with the way back); a reserved dry-run DOI outside `--dry-run` |
| `UNVERIFIABLE-QUOTE` | a definitive answer with no text (D-20-03): `Unpaywall needs a contact email — set PENSMITH_CONTACT_EMAIL (…)`, `paywalled (abstract only): Unpaywall lists no open-access copy of DOI x`, `no open-access copy: …` (no record, only landing pages, no PDF), `fetch failed: … (<label>)` (403/404, not a PDF, an unreadable or timed-out PDF, an SSRF / redirect / size refusal), `image-only PDF: no extractable text (<label>)`, a source missing from CITATIONS.bib; under `--dry-run` a synthetic source (`text unavailable (dry-run)`) |
| `UNVERIFIABLE-NETWORK` | no text read and at least one copy had no usable answer (offline fixture miss, transport error, timeout, 429/5xx after retries, exhausted host, open breaker) — `… — retry verification when online` |
| `UNATTRIBUTED` | a direct quote with no citation — keyed `(unattributed)` |

Nothing writes `PDF_UNAVAILABLE` or `TEXT_UNAVAILABLE`. `runPass3Unit` has been removed.

**Pass 2 hand-off.** `sourceTextPassage(root, citekey, claim)` returns the passage of the cached or fetched open-access, Europe PMC or arXiv text nearest the claim. It uses `byo-text.ts`'s new exported `passagesNearClaim`, never returns the user's own PDF text, and never throws.

**The drafter's full-text flag** (`full-text.ts`, GRND-14 per D-20-18). The flag never marks a source Pass 3 cannot check. An arXiv id counts only when the entry has no DOI or has a DataCite arXiv DOI, because beside another DOI Pass 3 needs the PDF to show the title. A PMCID alone still does not count.

**`http.ts`** (the quotes rows only): `'europepmc'` after `'unpaywall'` in `HttpSource`, its TTL (7 days) and rate (5/s), and `export function sourceTtlMs(source)` right after `NEGATIVE_RESPONSE_TTL_MS`. **`sources/index.ts`**: the `europepmc` import and registry line. The adapter is full-text only: `search` returns nothing and it has no metadata lookup.

## Recordings (all live, `PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org`, 2026-09-30; scrubbed, each ≤ 51,200 bytes)

- `unpaywall/doi-s0218301312920012.json`: an Unpaywall answer that lists only `https://arxiv.org/pdf/1205.6430`.
- `oa-pdf/arxiv-1205-6430.json` (39,908 bytes): `https://arxiv.org/pdf/1205.6430.pdf` answers 301 to `/pdf/1205.6430`, which answers 200 with the 29 KB PDF of an erratum (base64). Its text includes "we neglected the curvature of the earth". The file carries arXiv's real `.pdf` redirect.
- `europepmc/pmc13598034.json` (16,746 bytes): the JATS full text of a BMC letter (DOI 10.1186/s43044-026-00785-w, PMID 42771069).
- `unpaywall/doi-s43044-026-00785-w.json`: the same letter's Unpaywall answer. The Springer PDF it lists is deliberately not recorded, so the offline chain falls through to Europe PMC.

`scripts/refresh-cassettes.mjs` re-records all of these: two new Unpaywall files, a `europepmc` group (`lookupFullText`) and an `oa-pdf` group (the generic fetch).

## Tests

**Added:**
- `tests/quote-extractor.test.ts`, 10 tests:
  - the VRFY-18 acceptance forms, UNATTRIBUTED entries, ids and lines;
  - the word floor, titles, code, Pandoc pairing, block quotes and text cleanup;
  - a ground-truth fuzz over 30,000 generated drafts (about 13 s) in which every quote comes out with exactly its keys.
- `tests/pass3-sources.test.ts`, 9 tests on MockAgent plus the recorded chains:
  - Unpaywall → a 302 → a real PDF: a fabricated 17-word quote `[@k, p. 3]` is NOT_FOUND, a verbatim one PASS and a one-letter change FUZZY;
  - the `oa_locations` order;
  - the Europe PMC and arXiv binding checks;
  - a refused connection is UNVERIFIABLE-NETWORK;
  - a BYO quote with the dial recorder showing zero connects;
  - the recorded offline chains;
  - UNATTRIBUTED rows with id, hash, line and locator;
  - `sourceTextPassage`.
- `tests/pass3-cache.test.ts`, 5 tests:
  - a second run with the network denied makes 0 PDF requests;
  - the TTL of the fetching source applies, and the same bytes are not re-extracted;
  - tampered entries are ignored;
  - `refresh` (the VRFY-28 Pass-3 side) fetches again;
  - offline, the cache is never read or written;
  - text over 4 MiB is not kept.
- `tests/sources/europepmc.test.ts`, 4 tests: the recorded parse, JATS to text, the three-way outcome, and the offline miss.
- `tests/helpers/text-pdf.ts`: `textPdf(text)`, a real PDF (pdf-lib, WinAnsi plus `/Differences` for fi/fl ligatures and the soft hyphen).
- `scripts/live-verify-quotes.mjs`, the live lane. It runs one child process with a fresh data dir and the project email, and makes 5 checks:
  - NumPy: a genuine abstract sentence PASS, the penguin sentence NOT_FOUND;
  - the PLOS ONE PDF Unpaywall lists for 10.1371/journal.pone.0000001 gives more than 10,000 characters;
  - arXiv 1706.03762's `.pdf` URL is fetched through the redirect to `/pdf/1706.03762` and its abstract is PASS;
  - a second NumPy run from the caches makes 0 connections (dial recorder).

  **Run live on 2026-09-30, all 5 checks passed:** NumPy PASS from www.nature.com, penguins NOT_FOUND, the PLOS PDF 49,906 characters, arXiv 39,490 characters.

**Rewritten or extended (stream-owned):**
- `tests/known-bad-quotes.test.ts` and `tests/fixtures/known-bad-quotes.json` (VRFY-29, D-20-19). The corpus is now a source text plus 22 drafts: 14 NOT_FOUND and 8 genuine PASS.
  - Every artifact class (ligature, soft hyphen, smart quotes, ellipsis, diacritic, em dash) appears in the source text, in a claimed quote, and in a genuine quote.
  - Each row runs through `extractQuotes` + `runPass3` twice: against a hash-verified BYO PDF built from the source text, and against the same text as a Europe PMC full text answered by a local mock.
  - The fixture is re-pinned in `tests/repo-files.test.ts` (`b1cfe9b2…`).
- `tests/pass3-oa-pdf.test.ts`: every `PDF_UNAVAILABLE` / `TEXT_UNAVAILABLE` expectation now expects `UNVERIFIABLE-QUOTE` or `UNVERIFIABLE-NETWORK` with the D-20-03 reason, and `OK` became `PASS`. GRND-14 now checks that the flag marks exactly what Pass 3 fetches.
- `tests/full-text.test.ts`, 2 new tests: the arXiv id beside another DOI, and the extractor and word floor.
- `tests/sources/unpaywall.test.ts`, 2 new tests: `lookupOaPdfUrls` and `oaPdfUrls`.
- `tests/config.test.ts` (versions → 3; `quote_min_words` bounds and default) and `tests/migrations.test.ts` (the config chain v1 → v2 → v3).
- `tests/citation-clusters.test.ts`, the `extractQuotes` case (quotes' region): a quote whose only citation sits in an earlier sentence is now one UNATTRIBUTED entry (`['inline:null']`).
- `tests/pass3-byo-cli.test.ts`: `**OK**` became `**PASS**`, and an edited-PDF quote shows no passing label.

**Test files of other streams edited** (each a separate `test(20-quotes): …` commit):
- `tests/citekey-grammar-gates.test.ts` (grammar): Pass 3's passing labels are PASS / FUZZY, no longer OK.
- `tests/dry-run-sources.test.ts` (gate): a synthetic source's quote under `--dry-run` is UNVERIFIABLE-QUOTE, not PDF_UNAVAILABLE.
- `tests/bare-chain.test.ts` (gate): the D-18-43 quote case now asserts the new block, per 20-PLAN §10. UNVERIFIABLE-QUOTE (no contact email offline) exits 4 once, and `next` / `resume` report attention with no re-billed verify.
- `tests/flags.test.ts` (unowned): the two H3 zero-socket chains assert the new block, with compile and done exiting 4 and no socket. The dry-run export and offline done's GPTZero and plagiarism paths remain covered by `dry-run-workspace.test.ts`, `offline-fail-closed.test.ts` and `honesty.test.ts`.
- `tests/response-size-cap.test.ts` (unowned): the SEC-03 `MAX_PDF_BYTES` check now reads `verify/source-text.ts`, where Pass 3's PDF fetches moved.

## Deviations and decisions

- **Recordings.** 20-PLAN §5.3 asked for a recorded chain of Unpaywall → a redirecting PDF URL → a tiny real PDF. No real chain of that shape turned up:
  - arXiv's canonical `/pdf/<id>` does not redirect;
  - publishers answered either with a bot wall (Cloudflare challenges carrying opaque tokens, deliberately not recorded) or with a PDF over 50 KB, which is too big for a 51,200-byte base64 recording;
  - RFC links answered 404.

  The recorded chain is therefore a real Unpaywall answer that lists an arXiv PDF, plus arXiv's real `.pdf` 301 redirect to that PDF in the same file (exercised through `openAccessPdfText`). The full Unpaywall → 302 → PDF chain is covered by the MockAgent test in `pass3-sources.test.ts`, and live by `live-verify-quotes.mjs` (arXiv 1706.03762 and the PLOS and NumPy publisher PDFs).
- **Code detection.** The grammar stream's `provableCodeSpans` is not on this branch, so quotes inside code are found by a probe over the grammar the branch has:
  1. Each quote-opening mark is replaced by `@`.
  2. `findNarrativeCitations` is run on the draft and on a copy whose backticks and tildes became `'`.
  3. A probe that disappears only in the draft is provably in code.

  It fails closed: code the grammar cannot prove is treated as text. The integrator may swap in `provableCodeSpans`.
- **`quote_min_words` range is 1..5.** D-20-04 and PRD §14 say a paper may only make the gate stricter, and a higher floor would leave longer quotes unchecked, so the maximum is 5. This is recorded in the schema message.
- **NOT_FOUND beats no-answer.** When real text of the work was read and the quote is not in it, the verdict is NOT_FOUND even if another copy gave no answer; the no-answer reasons are appended. A quote that is not in the text of the version that was read is blocking either way, and NOT_FOUND names the text that was checked.
- **Binding checks (S-17 extended to OA text):**
  - A Europe PMC text is used only when the article names the cited DOI or PMID, so a PMCID edited in LIBRARY.json cannot lend another article's text.
  - An arXiv PDF beside a non-arXiv DOI must show the entry's title.
  - A DataCite arXiv DOI (`10.48550/arXiv.<id>`), or an entry with no DOI, counts as an arXiv identity.
- **Europe PMC is full-text only.** The adapter has no `SourceCandidate` or search: research never queries it, and a citation's record comes from its registrar.
- **Seam hunks in `pass3.ts`.** The file is rewritten, but the seam's `Pass3Result` declarations (`id`, `quoteSha256`, `localFile`, with their comments) are kept verbatim. The seam's placeholder `Pass3Verdict` union and its `quoteId(index)` loop are replaced by `verdicts.ts` `Pass3RowVerdict` and the extractor's ids. No other stream edits `pass3.ts`.
- **`fuzzy.ts` `levenshteinSubstring`** is kept (same signature and results), now computed as an exact semi-global alignment. `jaroWinkler` and the title and author thresholds are unchanged.
- **Unpaywall with no contact email** is UNVERIFIABLE-QUOTE, not UNVERIFIABLE-NETWORK, per D-20-03's explicit list. In tests with no project address, a quote therefore blocks with that reason.

## Files under the 23a-moving folders

None. No file under `workflows/`, `templates/`, `references/`, `skills/` or `agents/` was changed.

## Other streams' shared files (20-PLAN §6 regions only)

- `bin/lib/http.ts`: `europepmc` in `HttpSource` and in the TTL and rate tables, and `sourceTtlMs` after `NEGATIVE_RESPONSE_TTL_MS`.
- `bin/lib/sources/index.ts`: the `europepmc` import and registry line.
- `tests/repo-files.test.ts`: the `known-bad-quotes.json` pin.
- `scripts/refresh-cassettes.mjs`: the `unpaywall` / `europepmc` / `oa-pdf` recorder block.
- `tests/fixtures/cassettes/`: `unpaywall/`, `europepmc/`, `oa-pdf/`.
- `PRD.md`: the §7.7 Pass 3 bullets and the §10 `quote_min_words` line (with `schema_version = 3`).
- `docs/SOURCES.md`: the Europe PMC row and the source-text cache paragraph after "Caching".
- `PRIVACY.md`: the Europe PMC bullet and the source-text cache bullet.
- `CLAUDE.md`: the Pass-3 sentence.

## Hand-offs to the integration pass

1. **gate → Pass 2:** `verify` passes `fullText: (key, claim) => sourceTextPassage(root, key, claim)` to `runPass2`.
2. **gate / registrar → `refresh`:** pass the citekeys due for a re-check as `Pass3Options.refresh`. The Unpaywall lookup inside `source-text.ts` does not yet pass `FetchOptions.refresh` (registrar's field): wire it in `lookupOaPdfUrls` so a re-check refreshes Unpaywall's answer as well as the text.
3. **gate → containment:** `draft-containment.ts` / `full-text.ts` `quotesWithoutFullText(draft, fullText, { minWords })` should get the paper's `quote_min_words`, as `runPass3` already reads it with `root`.
4. **gate → rows:** `verification-md.ts` renders Pass-3 rows with `[qN]`, the line and the locator from `Pass3Result`. The acceptance record binds `id` + `quoteSha256` and the draft hash; only `UNVERIFIABLE-QUOTE` is acceptable. `pass3-byo-cli.test.ts`'s row regexes will need an optional ` [qN]`.
5. **gate → reports:** COMPILE-REPORT.md and done list the quotes verified against local files (`localFile`, VRFY-19 / VRFY-26).
6. **grammar (optional):** replace the extractor's code probe with `provableCodeSpans` once it has merged. `tests/quote-extractor.test.ts` pins the behaviour.
7. **registrar:** `registrar-response.ts` `article()` gives "an Europe PMC answer". `europepmc.test.ts` accepts `an?` so either wording passes; fix the article if you like.
8. **CLAUDE.md "Library" sentence (registrar/gate):** `full-text.ts` now marks an arXiv id only without a DOI or with a DataCite arXiv DOI.
9. **README / CONTRIBUTING (gate, §7 docs sweep):** `quote_min_words`, UNVERIFIABLE-QUOTE, `npm run live:verify`, and recording Europe PMC / PDFs (`oa-pdf` group, base64 bodies, ≤ 51,200 bytes). `package.json` is not this stream's file: registrar owns `live:verify` (`scripts/live-verify.mjs`), so `scripts/live-verify-quotes.mjs` runs as `PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org node scripts/live-verify-quotes.mjs`. The integrator may chain it into `live:verify` or add a `live:verify-quotes` script.
10. **End-to-end VRFY-20 flow** (§9): bananas → UNVERIFIABLE-QUOTE q1 → `add` the PDF → PASS / NOT_FOUND → `--accept-quote q1`. The Pass-3 side is here; the flow runs after the merge.

## Stream gate

Green on the branch head, as root in the cloud container, Node 22:
- `npm run prebuild`, `lint`, `typecheck`, `build`: all pass, and the working tree is clean after the build.
- `npm test`: 2457 tests, 2455 pass. Two failed:
  - the root-only `atomic-write` case "preserves OLD content on rename/write failure" (known; `chmod 0o500` does not block root);
  - one timing flake, `http-rate-limit.test.ts` "Crossref declaring 3 / 1s …". It passed in the previous full run and in 3 of 3 isolated re-runs. It measures the Crossref bucket, which this stream does not touch.
- `npm run test:tier-contract`: 57 of 57 pass.
- `npm run validate:manifests`: pass.
- `node scripts/live-verify-quotes.mjs`: live, all 5 checks pass.
