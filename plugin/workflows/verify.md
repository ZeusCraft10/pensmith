# pensmith verify

> Verify citations + claims in one section. Per-section verb — writes ONLY
> inside `.paper/sections/<NN>-<slug>/` (TEST-09 section-isolation invariant),
> with two paper-level writes, both through the one library writer: an
> unparseable `.paper/CITATIONS.bib` is re-rendered from `LIBRARY.json` (step 3;
> SRC-12), and each citation a registrar confirmed gets its `LIBRARY.json`
> `last_verified` (step 10; VRFY-28).
>
> **D-13 LOCKED INVARIANT — the blocking verdict is 100% deterministic.**
> No model call decides a Pass-1 or Pass-3 verdict or the section status; the
> advisory Pass-2 / Pass-4 sections are added after the status is frozen.

<capability_check>
required:
  - Task
  - MCP library.read

degrade_if_missing:
  - if no Task: run sequentially (slower)
  - if no MCP library: direct read of .paper/library.json
</capability_check>

## Overview

`pensmith verify <N>` is the third of the three per-section verbs (plan → write → **verify**).
It is the most safety-critical verb in the workflow: a single FABRICATED / MIS-CITED /
NOT_FOUND verdict escaping verify means a fabricated citation lands in the exported paper.

**Phase 3 stance (D-13 LOCKED)**: the verify path is 100% deterministic. The verdict is
produced by `jaroWinkler` (Pass-1 title/author AND-gate) and the edit-distance quote match
(`fuzzy.ts matchQuote`, Pass-3 quote integrity) alone. The dormant fuzzy-judge and quote-checker prompts
(Plan 05 hash-pins them) are calibrated for Phase 8 ambiguous-case tie-break only;
they MUST NOT be referenced, loaded, or executed from this body in Phase 3.

The implementation lives in `bin/cli/verify.ts` (`verifySection`). `pensmith write <N>` runs the
same `verifySection` right after it keeps a draft (GRND-15), so a normal run reaches this verb
without a separate command; `pensmith verify <N>` re-runs it on its own (after `write --no-verify`,
or after editing DRAFT.md by hand).

## Steps

1. (see Body below)

## Outputs

- `.paper/sections/<NN>-<slug>/VERIFICATION.md` — Status, draft hash, the Summary table, then the Pass-1, Pass-3 and draft-check rows, the accepted quotes and the advisory sections
- `.paper/sections/<NN>-<slug>/QUOTE-ACCEPTANCES.json` — only when the user accepts a quote (step 7a)
- `.paper/LIBRARY.json` — `last_verified` of the citations a registrar confirmed (step 10, through the library writer)
- `.paper/sections/<NN>-<slug>/PLAN.md` — frontmatter status updated to `'verifying'` → `'verified'` | `'failed'` | `'unverifiable'` (D-08-AMENDED)
- Only when `.paper/CITATIONS.bib` does not parse and `.paper/LIBRARY.json` exists: `.paper/CITATIONS.bib` and `.paper/CITATIONS.ris` re-rendered from the library, the unreadable file kept as `.paper/CITATIONS.bib.unparsed-<time>.bak`, one stderr notice (SRC-12). This is the one write verify makes outside the section folder.

## Body

> **D-13 LOCKED INVARIANT — the blocking verdict is 100% deterministic.**
> NO model call SHALL decide a Pass-1 / Pass-3 verdict or the section status (steps 4–8).
> The advisory claim-support (Pass 2) and orphan-claim (Pass 4) sections are computed
> after the status is frozen and never change it (VRFY-07).
> The dormant fuzzy-judge and quote-checker prompts exist (Plan 05 hash-pins them) but are
> DORMANT — calibrated for Phase 8 ambiguous-case tie-break only.
> Narration in VERIFICATION.md is built from template literals embedded in this body, NOT
> from any model call.
> Audit gate (BL-2): a CI-side regex grep on this file matches zero LLM-invocation patterns inside the `## Body` section. The exact regex lives in `.planning/phases/03-vertical-slice-one-section/03-06-PLAN.md` (verification block) and is enforced by the merge gate, not duplicated here (to keep this file inert under its own grep).

1. **Parse args**: `pensmith verify <N>` — `N` is the section id (`3`, or `1a` for a section a re-outline inserted). Resolve the slug from the section's STATE.json registration (OUTLINE.md's rows only while nothing is registered; a registered section whose OUTLINE.md row disagrees is refused naming `pensmith outline`, D-18-38); the section's folder is found by slug. An `N` that is not a section id from 1 to 99 (optionally with one letter), a section the outline does not have, or a `--slug` that is not the outline's slug for `N` is a usage error (exit 2) before anything is read or written — never a `NN-placeholder` folder for a paper with an outline (RUN-09).

2. **Set status to `'verifying'`** (D-08-AMENDED LOCKED enum value): update the section's PlanFrontmatter `status: 'verifying'` and remove `verified_against_draft_hash` via `bin/lib/plan-status.ts updatePlanFrontmatter()` (round-trip-safe per D-08) BEFORE any pass runs — a verify that crashes or is killed leaves a section the router verifies again, never an earlier `verified` (VRFY-16). Every exit below persists a final status.

3. **Read inputs**:
   - `<sectionDraft(n, slug)>` = `.paper/sections/<NN>-<slug>/DRAFT.md` — Markdown body with Pandoc `[@citekey]` tokens (D-21).
   - `<sectionPlan(n, slug)>` = `.paper/sections/<NN>-<slug>/PLAN.md` — for `assigned_sources` and the `verified_against_draft_hash` invalidation check.
   - **`.paper/CITATIONS.bib`** — canonical BibTeX (D-20), parsed ENTRY BY ENTRY through `bin/lib/citations.ts parseBibEntries` (D-19 citation-js chokepoint; VRFY-16): every `@type{key, …}` block is parsed on its own, so the entries that parse are checked and a cited key whose entry does not parse is its own `UNPARSEABLE` row naming the key and the entry's line — no parse error ever reaches the user as a stack. This file is the **single source of truth** for citation METADATA at verify time (title, authors, identifiers). An empty bib is zero entries (BRDTH-01).
   - **Bib repair (SRC-12)**: when CITATIONS.bib does not parse and `.paper/LIBRARY.json` exists, verify first re-renders CITATIONS.bib and CITATIONS.ris from the library through the one library writer (`bin/lib/library.ts rerenderCitations`), keeps the unreadable file as `CITATIONS.bib.unparsed-<time>.bak`, and prints one stderr notice. Without a LIBRARY.json nothing is rewritten and the parse error fails closed.
   - **`.paper/LIBRARY.json`** is read for one more thing: which cited sources have a bring-your-own PDF (`byo`). Its text is read ONLY through `bin/lib/byo-text.ts`, which re-hashes `.paper/sources/<citekey>.pdf` against the recorded sha256 first (S-17): Pass 3 checks quotes against it (step 6), and — only when the user turned on `[verification] send_byo_passages` (off by default: PRD §9 keeps a bring-your-own PDF's contents on the machine) — the advisory Pass 2 sends its passages nearest each claim to the model provider. LIBRARY.json also says which identifier-less entries are the user's own unidentified PDFs (step 4) and which retraction notices were recorded at ingest. An edited PDF, a loose `.paper/sources/<citekey>.txt`, a poisoned cache or a PDF the user attached although it does not show the work (`byo.asserted`) is never used.
   - **Refusal after a failed write** (FEED-04, D-18-25): when PLAN.md carries a `failure_reason` (the section's last `write` was refused and kept no new draft), the DRAFT.md on disk is an older one that the failed write was never retried for. `verify` does not verify it: it prints `pensmith verify: section N not verified — its last write failed (<reason>); the DRAFT.md on disk is older — run \`pensmith write N\`` and exits 4 (EXIT_BLOCKED); nothing is written and PLAN.md keeps the failure. Compile and the export gate refuse the section the same way.
   - **Early exits** (each keeps the router moving and persists a status): no DRAFT.md → an unverifiable VERIFICATION.md naming `pensmith write N`, PLAN.md `status: 'writing'` (the router re-drafts), exit 1. No CITATIONS.bib — or an empty one — while the draft cites sources (any citation shape, `bin/lib/citation-token.ts`) is no early exit: every cited key is a `FABRICATED` row saying the bibliography is missing or empty, `Status: failed`, exit 4 (fail closed, D-20-20). A draft that cites nothing needs no bib: it takes the normal path, Pass 1 and Pass 3 have nothing to check, and the section is `verified` (with a note line) when it has no assigned sources — so an empty library never loops the router on verify; with assigned sources it is `NO-CITATIONS` (step 4b).
   - **The quote acceptances** the user recorded for this section (`QUOTE-ACCEPTANCES.json` next to PLAN.md, schema v1, read and written only by `bin/lib/quote-acceptance.ts`; VRFY-20). A record that does not parse accepts nothing (a stderr WARN says why).

4. **PASS 1 — Citation Integrity (DETERMINISTIC, VRFY-01)** — run by the one gate core (`bin/lib/verify/gate.ts recomputeGate`, D-20-05), the same code compile and done run over the text they process:
   - Extract every cited key from DRAFT.md with the one citation grammar (`bin/lib/citation-token.ts`): bare `[@k]`, clusters `[@a; @b]`, locators `[@k, p. 5]`, author-suppressed `[-@k]`, braced `@{k}` and narrative `@k` — every form Pandoc renders as a citation gets a row, so none can look absent (D-18-40).
   - **Membership (VRFY-17)**: a cited key that is not in the section's PLAN.md `assigned_sources` gets its own `UNASSIGNED` row right after its registrar row (`not in section N's assigned_sources — re-plan the section's sources with pensmith plan N --revise, or assign it to the section with pensmith add --remap <key> --section N`). It fails the section.
   - **Re-check past the cache (VRFY-28)**: the cited keys whose `LIBRARY.json` `last_verified` is null or older than `[verification] recheck_after_days` (default 30) are looked up past the HTTP cache; the others may be answered from it.
   - **Text the grammar cannot check (VRFY-09, VRFY-10)**: citation-shaped text that does not parse (`[@]`, `[@k` never closed in its paragraph, `@{k` never closed, a nested bracket `[@k [see note]]` — `citation-token.ts findUnparseableCitations`) is `UNPARSEABLE`, and every other attribution — author-date prose ("(Nguyen & Patel, 2019)", "Smith et al. (2019)"), a footnote or inline note, a heading or bold line opening a reference list and its entries, a raw TeX `\cite`, HTML `<cite>` / `<sup>` markers, numbered markers (`bin/lib/verify/unsupported-forms.ts findUnsupportedForms`) — is `UNSUPPORTED-FORM`. Each is a failing row keyed `L<line>` naming the text; only text the grammar proves Pandoc reads as code is skipped.
   - **Bare identifiers (VRFY-10)**: every DOI, arXiv id or PMID written in the prose (`doi:10.…`, a doi.org / arXiv / PubMed link, `PMID: …`; `bin/lib/doi.ts findBareIdentifiers`) is looked up at its registrar and gets its own row keyed `doi:<doi>`, `arXiv:<id>` or `PMID:<id>`: found → `OK` naming the record's title; a definitive not-found → `FABRICATED`; no answer → `UNVERIFIABLE-NETWORK`.
   - For each citekey, look up the parsed `.paper/CITATIONS.bib` entry → `claimed = {title, authors, year, identifiers}`. A citekey absent from `.paper/CITATIONS.bib` → `FABRICATED` (`citekey not in .paper/CITATIONS.bib (drafter invented)`).
   - **Re-fetch at the registrar that holds the identifier (VRFY-11, D-20-10; `bin/lib/verify/pass1.ts`, the route in `verify/pass1-identifiers.ts`)**: a DOI at Crossref (three-way lookup, D-19-05; DOIs compare case-insensitively). When Crossref has no record, doi.org names the agency of the prefix (`bin/lib/sources/doi-ra.ts`; only the prefix is sent): DataCite (Zenodo, figshare, Dryad, …) → DataCite's record (`sources/datacite.ts`); mEDRA, JaLC, KISTI → doi.org content negotiation (`sources/doi-cn.ts`); an agency that serves no record → the entry's arXiv id, PMID or ISBN, else `UNVERIFIABLE` naming the agency; Crossref's own prefix, or one no agency holds → `FABRICATED`. A DataCite arXiv DOI (`10.48550/arXiv.<id>`) is checked at arXiv. An entry with no DOI: its arXiv id at arXiv, its PMID at PubMed, its ISBN at the books registries — `FABRICATED` only when every one of them says not-found. An entry with no identifier at all: a strict metadata search (`verify/metadata-search.ts` — Crossref's bibliographic search; a book at the books registries first): title ≥ 0.95 with or without the subtitle, first author, year ± 1 → `OK` naming the identifier it found; no match → `UNRESOLVABLE` (fails).
   - **No answer is never "not found" (VRFY-12, D-20-03)**: offline with no recording, `--dry-run`, a 429 or 5xx after retries, an exhausted host, an open circuit breaker, a transport error, an error document inside a 200 → `UNVERIFIABLE-NETWORK` (`… — re-run verify once the lookup answers`, or `offline: no recorded fixture — re-run online`), which BLOCKS compile and done. An answer that cannot be compared (an incomplete registrar record, an agency with no record) is `UNVERIFIABLE` (blocking), with a reason that says what would help.
   - **The match (VRFY-13, `verify/name-match.ts`)**: names are normalized (Unicode dashes and diacritics, particles such as `van der` compared with and without, PubMed's "Family INITIALS", "et al.", a braced corporate name compared whole, a non-Latin name in its own script, a compound surname by each of its words); the title is compared whole and without its subtitle; `titleJW >= TITLE_JW_THRESHOLD (0.92)` AND first-author `authorJW >= AUTHOR_JW_THRESHOLD (0.85)` (`bin/lib/fuzzy.ts jaroWinkler`, D-11), and when both sides carry a year it must be within ± 1 (online-first versus issue year). An edited volume is matched on its first editor. A mismatch is `MIS-CITED`, naming each failing field (`mismatch: title (…), first author (…), year (claimed 1999, record 2015)`). Missing claimed metadata (no title, no author) is `MIS-CITED` too.
   - **Aliases and the user's own PDF (VRFY-14, D-20-12)**: an answer carrying another DOI than the one cited passes only when the registrar asserts the relation at verification time (Crossref's `is-identical-to` / `is-version-of` / `has-version` / `is-preprint-of` / `has-preprint`, or doi.org's handle of the cited DOI redirecting — HEAD, not followed — to it) and the match holds; `alternate_dois` in LIBRARY.json are never evidence. An entry with no registrar identifier, or whose lookup got no answer, whose bring-your-own PDF still re-hashes to its recorded sha256 (`bin/lib/byo-text.ts`, not `asserted`) is `OK-BYO`, naming `sources/<file>` and the hash. A definitive not-found stays `FABRICATED` whatever local text exists.
   - **Retractions (VRFY-15, D-20-13)**: a work retracted at verification time (Crossref's `updated-by`, the Retraction Watch data it serves — re-queried at verify time — or PubMed's "Retracted Publication"), or recorded as retracted when it entered the library, is `RETRACTED` (fails), also printed on stderr as `pensmith verify: RETRACTED — <key>: <notice>`. Retraction data exists only for Crossref DOIs: a passing DOI another agency registered says `retraction status unknown (no retraction data for <agency> DOIs)` in its row and the summary — reported, never shown as clean. A retraction re-query that got no answer is `UNVERIFIABLE-NETWORK`.
   - **When it was checked (VRFY-28)**: every row a registrar answered carries when that answer was obtained (a cached answer's own time), which becomes `last_verified` (step 10).

4b. **Draft checks (DETERMINISTIC, VRFY-24)**: a draft that cites nothing while its section has assigned sources is `NO-CITATIONS` (`no citations; N sources assigned` — fails the section; an introduction with no assigned sources and no citations verifies). A draft that carries the stub marker `<!-- stub draft (no model configured) — not real prose -->` — which `pensmith write` puts on a draft produced with no model (`PENSMITH_NO_LLM=1` or `--dry-run`) — is `PLACEHOLDER` outside `--dry-run` (unverifiable, blocking: re-draft it with a model, `pensmith write N`); under `--dry-run` it passes, and the dry-run compile removes the marker so no dry-run export carries it.

5. **Narrate Pass-1 results into VERIFICATION.md** via TEMPLATE LITERAL (no LLM): for each Pass-1 row, one list row (`bin/lib/verify/verification-md.ts renderGateRow`; `bin/lib/verify/verdict-rows.ts` parses it back — a round-trip property test covers every key the citation grammar accepts):
   ```text
   - ${citekey}: **${verdict}** — titleJW=${titleJW.toFixed(2)}, authorJW=${authorJW.toFixed(2)} — ${reason}
   ```
   A finding about the citation text itself (a form the grammar cannot read) takes `L<line>` in the key slot. The narration is mechanical string interpolation — no model call is issued. The rows go under `## Pass-1 (citation integrity, deterministic — D-11 AND-gate)`; the draft checks of step 4b go under `## Draft checks` as `- draft: **${verdict}** — ${reason}`.

6. **PASS 3 — Quote Integrity (DETERMINISTIC, VRFY-04 / VRFY-05)**:

   Quote extraction uses `bin/lib/quote-extractor.ts extractQuotes(draftMd, { minWords })` (VRFY-18, D-20-17), on the one citation grammar:
   - A direct quote has at least `[verification] quote_min_words` words (default 5; a paper may only lower it) in straight or typographic double quotes, typographic single quotes, or a block quote (one quote per `>` run, lazy continuation lines included). Shorter quotes (scare quotes), quoted titles (after `titled` / `entitled` / `called` / `named` / `the article` / `the book` / `the paper`, or Title Case of at most 12 words with no sentence end inside), Markdown link titles, quotes nested inside another quote and quotes inside code the grammar proves are not direct quotes.
   - It is attributed by a citation right after it (any Pandoc form; a cluster checks the quote against each key, locators kept), else a citation before it in the same sentence (`[@k] writes, "…"`, `@k notes that "…"`); a block quote also by a citation that ends the block or opens the next paragraph. Each quote gets an id in document order (`q1`, `q2`, …). A direct quote with no attributable citation is one `UNATTRIBUTED` row keyed `(unattributed)` — it fails the section.

   For each attributed quote, the source's text is looked for in this order (`bin/lib/verify/source-text.ts`, VRFY-19, D-20-18):
   - **(0)** The source's own bring-your-own PDF (SRC-15, S-17 — local, no network): its text through `bin/lib/byo-text.ts`, re-hashed against LIBRARY.json first. Found → `PASS`, `verified against your local file sources/<citekey>.pdf (sha256 …)`. A recorded copy that is missing or changed since ingest makes the quote `NOT_FOUND` with the way back (`restore that PDF, or attach the right copy with pensmith add <identifier> --pdf <file> --replace-pdf`) — editing or removing a local file never turns a verdict into a pass.
   - **(a)** Every PDF Unpaywall lists for the DOI (`sources/unpaywall.ts lookupOaPdfUrls`, best location first, de-duplicated). Unpaywall requires a contact email: without `PENSMITH_CONTACT_EMAIL` (or the variable `[network] contact_email_env` names) no request is made.
   - **(b)** The Europe PMC open-access full text of the work's PMCID (`sources/europepmc.ts`), used only when the article names the DOI or PMID the citation carries.
   - **(c)** The arXiv PDF of its arXiv id (derived from the id, never from a stored URL); beside a DOI that is not arXiv's, only when the PDF shows the entry's title.
   Every fetch goes through `http.ts` with redirects followed (every hop SSRF-checked; the PDF host never receives the contact email), each PDF is checked with `bin/lib/pdf-response.ts checkPdfResponse` on the byte-faithful body and extracted in the terminable worker (`bin/lib/pdf-text.ts`, SEC-02) with every error caught. The extracted text is cached in the user data folder (`source-text/<sha256(url)>.json`, checked against its hashes, the fetching source's TTL; never read or written offline), so a second verify, compile or done on an unchanged paper fetches no PDF; a citation due for a re-check (step 4) is fetched again.

   The verdict (`bin/lib/fuzzy.ts matchQuote` — normalization of ligatures, soft hyphens, dashes, quotes, ellipses and hyphenated line breaks; an elided quote `…` is matched segment by segment):
   - `PASS` — found verbatim after normalization; `FUZZY` — found at or above `QUOTE_LEV_THRESHOLD (0.95)` (both pass);
   - `NOT_FOUND` — text of the work was read and the quote is not in it (fails);
   - `UNVERIFIABLE-QUOTE` — a definitive answer with no text to check, with its reason: `no open-access copy`, `Unpaywall needs a contact email — set PENSMITH_CONTACT_EMAIL`, `paywalled (abstract only)`, `fetch failed: …`, `image-only PDF` (blocking; the one verdict step 7a can accept);
   - `UNVERIFIABLE-NETWORK` — no copy gave a usable answer (offline with no recording, a timeout, a 429 or 5xx after retries): re-run online (blocking, never acceptable).

7. **Narrate Pass-3 results into VERIFICATION.md** via TEMPLATE LITERAL (no LLM): for each quote, one list row naming its id in the draft (`q1`, `q2`, … in document order):
   ```text
   - ${citekey} [${id}] ("${quoteSnippet}…"): **${verdict}** — lev=${levRatio.toFixed(3)} — ${reason}
   ```
   The rows go under `## Pass-3 (quote integrity, deterministic — levenshtein-substring)`.

7a. **Accepting a quote no source text can check (VRFY-20)**: an `UNVERIFIABLE-QUOTE` row (no bring-your-own PDF and no open-access copy has the text) can be accepted by the user — `pensmith verify N --accept-quote q2` (repeatable), or, in a terminal, the `quote-accept` gate (a multi-select of those quotes plus "accept all"; `--yolo` never answers it; without a terminal it is skipped). Only an `UNVERIFIABLE-QUOTE` id is accepted: any other id exits 2 naming its verdict and records nothing. An acceptance is recorded in the section's `QUOTE-ACCEPTANCES.json` (bound to the quote's text and the draft's hash — one changed byte of the draft voids it) and lifts the row only while the gate's recomputation still yields `UNVERIFIABLE-QUOTE` for that quote; the row then reads `… — accepted by you <time> (--accept-quote | at the prompt)` and the quote is listed under `## Accepted quotes`. A hand-written acceptance line in VERIFICATION.md means nothing. There is no blanket flag (`--accept-unverifiable-quotes` is an unknown flag, exit 2).

8. **Compute overall verdict** (DETERMINISTIC, no LLM; `bin/lib/verify/verdicts.ts sectionOutcome`, the one status rule every reader shares):
   - **FAIL** (`status: failed`) iff any failing row: `FABRICATED`, `MIS-CITED`, `RETRACTED`, `UNASSIGNED`, `UNPARSEABLE`, `UNSUPPORTED-FORM`, `UNRESOLVABLE`, `NO-CITATIONS`, a quote `NOT_FOUND` or `UNATTRIBUTED` (an unknown label fails too — fail closed).
   - **UNVERIFIABLE, blocking** (`status: unverifiable`) iff no FAIL and a check could not run: `UNVERIFIABLE-NETWORK` (no answer — re-run online), `UNVERIFIABLE` (an answer that cannot be compared), a quote `UNVERIFIABLE-QUOTE` that is not accepted (step 7a), or `PLACEHOLDER` (step 4b). An unverifiable section does NOT stop the others (S-13): the router goes on to the next section and never re-runs verify on the same draft; compile refuses the section naming its options (re-run online, add the source's PDF, paraphrase, accept the quote, re-draft with a model), and `pensmith status` shows them.
   - **PASS** (`status: verified`) otherwise: every row `OK`, `OK-BYO`, `PASS`, `FUZZY`, or an accepted `UNVERIFIABLE-QUOTE`. (`PDF_UNAVAILABLE` / `TEXT_UNAVAILABLE` rows appear only in files an older pensmith wrote; nothing writes them now.)

9. **Write `<sectionVerification(n, slug)>`** = `.paper/sections/<NN>-<slug>/VERIFICATION.md` via `bin/lib/atomic-write.ts` (D-07 chokepoint), in this order:
   - **Offline marker** (RUN-02): when sources were offline, the FIRST line is `> OFFLINE MODE (<reason>) — recorded fixtures, not live results.` (or the `--dry-run` synthetic-sources form). A VERIFICATION.md written under `--dry-run` never lets a real compile or export through (RUN-27): re-verify without `--dry-run`.
   - `# VERIFICATION (Section N, slug)`, the `Status: verified | failed | unverifiable` line (compile and done refuse a missing Status line and a `Status: failed` even when no row parses — fail closed) and `Draft: sha256 <hash>` (the draft hash the rows judged).
   - `## Summary` FIRST: a table `| Pass | Verdict | Count |` of every Pass-1, Pass-3 and draft-check label with a non-zero count, the Pass-2 verdict counts, the Pass-4 orphan total and the freshness counts (WARN, `not probed`, and `retraction status unknown`). A parser proves the counts equal the rows (VRFY-24).
   - The Pass-1 rows (step 5), the Pass-3 rows (step 7), `## Draft checks` (step 4b) and `## Accepted quotes` (when any, step 7a).
   - compile and done never trust this file's rows: they recompute them with the same gate core over the text they process (D-20-04, D-20-23); the record can only add refusals (no Status line, `Status: failed`, a draft hash of another draft, a `--dry-run` record outside `--dry-run`).
   - The source-freshness table and the ADVISORY claim-support (Pass 2) and orphan-claim (Pass 4) sections. They are computed after the status above is frozen and never change it (VRFY-07). They use the model provider configured for pensmith in either tier (the plugin's `pensmith_verify` calls it exactly as the CLI does). With no model configured (either tier — e.g. a user checking a hand-written draft, D-V1-04) they record `skipped (no LLM configured)` rows and verify still exits by the frozen status. When the session cost cap (or an invalid runtime config) stops them, their rows say `not run (…)`, VERIFICATION.md and step 10 are still written, and verify then exits with that failure's code (5 for the cost cap). A failed Retraction Watch probe is an `unavailable` freshness row, never silence. The DOI HEAD probe asks only whether doi.org resolves the handle: its redirect is the answer (never followed), and only a 4xx/5xx from doi.org is a WARN row.

10. **Update PlanFrontmatter** per D-08-AMENDED LOCKED enum:
    - **PASS** → `status: 'verified'`.
    - **UNVERIFIABLE** → `status: 'unverifiable'`.
    - **FAIL** → `status: 'failed'`.

    Set `verified_against_draft_hash` (the per-section hash compile recomputes from DRAFT.md bytes + sorted `assigned_sources`). If the drafter is re-run, the hash changes, automatically invalidating this verification — the cycle-break between write and verify (D-08-AMENDED).

    Record `last_verified` (VRFY-28): each citation whose Pass-1 row passed on a registrar's answer gets that answer's time as its `LIBRARY.json` `last_verified`, through the one library writer (`library.ts recordLastVerified`, under the library lock). compile never records it.

    **Exit code** (RUN-09): 0 for `verified`; **4** (EXIT_BLOCKED) for `failed` and `unverifiable`; **2** (EXIT_USAGE) for an `--accept-quote` id that cannot be accepted (after the verification is written; nothing is recorded).

11. **Section-isolation invariant** (TEST-09): this verb MUST NOT touch any file outside `.paper/sections/<NN>-<slug>/` — except the bib repair of step 3 and the `last_verified` record of step 10 (paper-level files written by the library writer; no other section's files are ever touched).

12. **Shell fallback** (TIER-06 equivalence path): `pensmith verify <N> [--accept-quote <id>] [--yolo]` (`--accept-quote` repeats, one quote id each).
