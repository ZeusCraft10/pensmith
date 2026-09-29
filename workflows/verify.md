# pensmith verify

> Verify citations + claims in one section. Per-section verb — writes ONLY
> inside `.paper/sections/<NN>-<slug>/` (TEST-09 section-isolation invariant),
> with one paper-level repair: an unparseable `.paper/CITATIONS.bib` is
> re-rendered from `LIBRARY.json` (step 3; SRC-12).
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
produced by `jaroWinkler` (Pass-1 title/author AND-gate) and `levenshteinSubstring`
(Pass-3 quote integrity) alone. The dormant fuzzy-judge and quote-checker prompts
(Plan 05 hash-pins them) are calibrated for Phase 8 ambiguous-case tie-break only;
they MUST NOT be referenced, loaded, or executed from this body in Phase 3.

The implementation lives in `bin/cli/verify.ts` (created by Plan 07).

## Steps

1. (see Body below)

## Outputs

- `.paper/sections/<NN>-<slug>/VERIFICATION.md` — Pass-1 + Pass-3 narratives + overall verdict
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

1. **Parse args**: `pensmith verify <N>` — `N` is the 1-based section number. Read `.paper/OUTLINE.md` to resolve the slug. A `N` that is not a number from 1 to 99, a section the outline does not have, or a `--slug` that is not the outline's slug for `N` is a usage error (exit 2) before anything is read or written — never a `NN-placeholder` folder for a paper with an outline (RUN-09).

2. **Set status to `'verifying'`** (D-08-AMENDED LOCKED enum value): update the section's PlanFrontmatter `status: 'verifying'` via `bin/lib/frontmatter.ts updateFrontmatter()` (round-trip-safe per D-08).

3. **Read inputs**:
   - `<sectionDraft(n, slug)>` = `.paper/sections/<NN>-<slug>/DRAFT.md` — Markdown body with Pandoc `[@citekey]` tokens (D-21).
   - `<sectionPlan(n, slug)>` = `.paper/sections/<NN>-<slug>/PLAN.md` — for `assigned_sources` and the `verified_against_draft_hash` invalidation check.
   - **`.paper/CITATIONS.bib`** — canonical BibTeX (D-20), parsed through `bin/lib/citations.ts parseBibtex` (D-19 citation-js chokepoint). This file is the **single source of truth** for citation METADATA at verify time (title, authors, identifiers). An empty bib is zero entries (BRDTH-01).
   - **Bib repair (SRC-12)**: when CITATIONS.bib does not parse and `.paper/LIBRARY.json` exists, verify first re-renders CITATIONS.bib and CITATIONS.ris from the library through the one library writer (`bin/lib/library.ts rerenderCitations`), keeps the unreadable file as `CITATIONS.bib.unparsed-<time>.bak`, and prints one stderr notice. Without a LIBRARY.json nothing is rewritten and the parse error fails closed.
   - **`.paper/LIBRARY.json`** is read for one more thing: which cited sources have a bring-your-own PDF (`byo`). Its text is read ONLY through `bin/lib/byo-text.ts`, which re-hashes `.paper/sources/<citekey>.pdf` against the recorded sha256 first (S-17): Pass 3 checks quotes against it (step 6), and — only when the user turned on `[verification] send_byo_passages` (off by default: PRD §9 keeps a bring-your-own PDF's contents on the machine) — the advisory Pass 2 sends its passages nearest each claim to the model provider. LIBRARY.json also says which identifier-less entries are the user's own unidentified PDFs (step 4) and which retraction notices were recorded at ingest. An edited PDF, a loose `.paper/sources/<citekey>.txt`, a poisoned cache or a PDF the user attached although it does not show the work (`byo.asserted`) is never used.
   - **Early exits** (each keeps the router moving): no DRAFT.md → an unverifiable VERIFICATION.md naming `pensmith write N`, PLAN.md `status: 'writing'` (the router re-drafts), exit 1. No CITATIONS.bib while the draft cites sources (any citation shape, `bin/lib/citation-token.ts`) → `Status: failed` naming `pensmith research` (fail closed; PLAN.md untouched), exit 1. A draft that cites nothing needs no bib: it takes the normal path, Pass 1 and Pass 3 have nothing to check, and the section is `verified` (with a note line) — so an empty library never loops the router on verify.

4. **PASS 1 — Citation Integrity (DETERMINISTIC, VRFY-01)**:
   - Extract every `[@citekey]` token from DRAFT.md (Pandoc citation regex).
   - For each citekey, look up the parsed `.paper/CITATIONS.bib` entry → `claimed = {title, authors, doi, retracted}`.
   - If the citekey is absent from `.paper/CITATIONS.bib` → `verdict = 'FABRICATED'`, `reason = 'citekey ${citekey} not present in .paper/CITATIONS.bib (citation invented by drafter)'`. Skip the rest of step 4 for this citekey.
   - For each DOI present in claimed: call `sources.crossref.fetchById(doi)` (the three-way lookup, D-19-05; recorded fixtures in CI) → `actual = {title, authors, doi, retraction_status}`.
   - **An entry without a DOI** is re-fetched at its OWN registrar and runs the same AND-gate: an arXiv-only preprint (`eprint` + `archivePrefix = {arXiv}`) at the arXiv API, a PubMed record (`pmid`) at PubMed E-utilities, a book (`isbn`) at the books registries (Open Library / Google Books). A found record runs the AND-gate (a PubMed "Retracted Publication" is `MIS-CITED`); a failed or offline lookup is `UNVERIFIABLE` (blocking); only a definitive not-found from every identifier the entry carries is `FABRICATED` (`reason = 'no registrar has this work (…)'`). An entry with no DOI, arXiv id, PMID or ISBN is `FABRICATED` (`'no DOI, arXiv id, PMID or ISBN in citation entry (cannot verify upstream)'`) — except the user's own PDF that no registrar identified (an unhydrated bring-your-own entry in LIBRARY.json): it is `UNVERIFIABLE` (blocking) with the command that identifies it, `pensmith add <DOI or arXiv id> --pdf .paper/sources/<file>` — the user's real document is never called invented (S-03; OK-BYO is Phase 20, VRFY-14).
   - **A DataCite arXiv DOI** (`10.48550/arXiv.<id>`, which research takes from Semantic Scholar and OpenAlex for arXiv-only works) is not a Crossref DOI: the entry is re-fetched at the arXiv API by that id (as a DOI-less arXiv entry), never read as Crossref's 404 (FABRICATED). A DOI naming one arXiv id and an `eprint` naming another is `MIS-CITED`.
   - If `fetchById(doi)` returns null — Crossref's definitive "no such record" (HTTP 404) → `verdict = 'FABRICATED'`, `reason = 'DOI ${doi} did not resolve via Crossref'`.
   - If the lookup FAILED (it throws `SourceLookupError`: a 429 or 5xx after retries, an exhausted host, an open circuit breaker, a transport error, or a 200 whose body is not a Crossref answer) → `verdict = 'UNVERIFIABLE'`, `reason = 'Crossref re-fetch of ${doi} failed: <reason> — re-run verify once the lookup answers'`. A failed lookup is never "did not resolve": it BLOCKS compile and done like a failing verdict. A definitive record that cannot be compared (Crossref's record of a standard lists no author or editor) is `UNVERIFIABLE` too, with a reason that does not promise a retry helps.
   - If the Crossref record itself carries a retraction notice (`updated-by` of a retraction / withdrawal / removal kind — Crossref serves the Retraction Watch data there) → `verdict = 'MIS-CITED'`, `reason = 'cited work is retracted (Crossref's record of <doi> at verify time: <notice>)'`, with the real title / first-author scores (SRC-04; the label becomes RETRACTED in Phase 20, VRFY-15; compile's refusal says `MIS-CITED: the cited work is retracted`).
   - If the re-fetch is UNAVAILABLE because of the network mode — a sources-offline fixture miss (`PENSMITH_OFFLINE=1`, the test runner) or `--dry-run` — → `verdict = 'UNVERIFIABLE'`, `reason = 'offline: no recorded fixture — re-run online'` (or `'dry-run: no live re-fetch under --dry-run — re-run online'`). It is never OK, MIS-CITED or FABRICATED (RUN-03, D-17-07), and it BLOCKS compile and done like a failing verdict. The same holds when the live Retraction Watch re-query (Crossref REST `works?filter=updates:<doi>`, `update-to` notices of a retraction kind) is unavailable offline, or its live lookup fails — a non-200, an error document inside an HTTP 200, unreadable JSON or a transport failure is "retraction status unknown", never "not retracted": `verdict = 'UNVERIFIABLE'` unless the other DOI confirms a retraction (a confirmed retraction is `MIS-CITED`).
   - Compute `titleJW = jaroWinkler(nfkcNormalize(actual.title), nfkcNormalize(claimed.title))` against `TITLE_JW_THRESHOLD = 0.92` (CONTEXT D-11).
   - Compute `authorJW = jaroWinkler(firstAuthorSurname(actual.authors), firstAuthorSurname(claimed.authors))` against `AUTHOR_JW_THRESHOLD = 0.85` (first-author surname via `bin/lib/author-normalize.ts` per D-11). A surname keeps its particles (`van der Maaten`); a corporate author (`{The ENCODE Project Consortium}`) is compared without its braces.
   - **DETERMINISTIC AND-gate verdict** (no LLM): if both `titleJW >= TITLE_JW_THRESHOLD` AND `authorJW >= AUTHOR_JW_THRESHOLD` → `verdict = 'OK'`; otherwise `verdict = 'MIS-CITED'`, `reason = 'titleJW=${...} authorJW=${...} below threshold'`.

4a. **Field-presence sub-gate (DETERMINISTIC, no LLM — Codex MEDIUM #9 / OpenCode MEDIUM #5)**:
    Run BEFORE finalizing the JW AND-gate verdict:
    - If `claimed.title.length < 1` OR `claimed.authors[0]?.length < 1` → `verdict = 'MIS-CITED'`, `reason = 'claimed citation metadata incomplete (empty title or no authors)'`.
    - If `actual.title.length < 1` → `verdict = 'MIS-CITED'`, `reason = 'source API returned empty title — entry may be malformed upstream; manual review recommended'`.
    - **Retracted-flag handling**: if `claimed.retracted === true` or the bib's `note = {RETRACTED}` (recorded when the source entered the library — research's cross-check, or the registrar record `add` read) → `verdict = 'MIS-CITED'`, `reason = 'cited work is retracted (recorded when the source entered the library: <notice>)'`, after the same re-fetch, so the row carries the real scores (`n/a` when there was no record to compare) and says where the flag came from. **Override even if JW thresholds pass** — retraction is a citation-integrity failure regardless of metadata match.
    - **Multi-DOI redirect handling**: if `fetchById(claimed.doi)` returns a record whose `doi` field DIFFERS from `claimed.doi` — compared case-insensitively, since DOIs are (Crossref returns canonical DOI for redirected entries), treat as `'OK'` iff `titleJW >= 0.98` AND `authorJW >= 0.95` (stricter band to account for Crossref publishing two distinct DOIs for the same work). Otherwise `verdict = 'MIS-CITED'`, `reason = 'claimed DOI ${claimed.doi} resolves to a different work (canonical: ${actual.doi})'`.

5. **Narrate Pass-1 results into VERIFICATION.md** via TEMPLATE LITERAL (no LLM): for each `pass1Result`, one list row (`bin/lib/verify/verdict-rows.ts renderPass1VerdictRow` — the same module parses it back for compile and done):
   ```text
   - ${citekey}: **${verdict}** — titleJW=${titleJW.toFixed(2)}, authorJW=${authorJW.toFixed(2)} — ${reason}
   ```
   The narration is mechanical string interpolation — no model call is issued. The rows go under `## Pass-1 (citation integrity, deterministic — D-11 AND-gate)`.

6. **PASS 3 — Quote Integrity (DETERMINISTIC, VRFY-04 / VRFY-05)**:

   Quote extraction uses `bin/lib/quote-extractor.ts extractQuotes(draftMd)` (Plan 07 amendment — Codex HIGH #4 / OpenCode HIGH consensus #4) with these rules:
   - Block quotes (lines beginning with `> `): always included if word count >= 10.
   - Inline quotes (text wrapped in `"…"` or `"…"` or `'…'`): included only if the quote contains >= 10 words AND >= 60 characters.
   - Multi-paragraph block quotes: treated as one quote, word count = total.
   - Pandoc citation tokens (`[@citekey]`) stripped BEFORE counting words.
   - Quotes with fewer than 10 words are NOT extracted (the writer is responsible for inline-cite integrity at Pass-1 level for short attribution).

   For each extracted quote with an associated citekey:
   - **(0)** The source's own bring-your-own PDF first (SRC-15, S-17 — local, so offline too): its text through `bin/lib/byo-text.ts` (re-hashed against LIBRARY.json). The quote found there → `verdict = 'OK'`, `reason = 'verified against your local file sources/<citekey>.pdf (sha256 …)'`. Not found there → the open-access copy below is checked as well, and the verdict is `NOT_FOUND` unless that copy has the quote (`reason = 'quote not found in your local file …'`). A recorded copy that is MISSING or CHANGED since ingest (moved, deleted, edited, replaced by another version) made the quote checkable and no longer does: the verdict is `NOT_FOUND` (blocking) unless the open-access copy has the quote, with the way back (`reason = 'quote cannot be checked against your local file: <why> — restore that PDF, or attach the right copy with pensmith add <identifier> --pdf <file> --replace-pdf; …'`) — editing or removing a local file never turns a verdict into a pass (ROADMAP Phase 19 criterion 6). A copy whose text never counted (image-only, attached at the user's word) adds its reason to the open-access verdict.
   - **(a)** Look up the open-access copy: `sources.unpaywall.lookupById(doi)` (the three-way lookup, D-19-05). When the DOI gives no open-access PDF (Unpaywall has none, or does not index it — a DataCite arXiv DOI is not asked) and the entry has an arXiv id (its `eprint`, or the id a DataCite arXiv DOI names), the quote is checked against the arXiv PDF of that id (`https://arxiv.org/pdf/<id>`, derived from the id Pass 1 verified at arXiv, never from a URL stored in a local file, S-17) — the same basis `bin/lib/full-text.ts` uses for the drafter's full-text flag (GRND-14). Unpaywall requires a contact email: without `PENSMITH_CONTACT_EMAIL` (or the variable `[network] contact_email_env` names) the lookup is failed with `Unpaywall skipped: set PENSMITH_CONTACT_EMAIL` and no request is made.
     A failed lookup → `verdict = 'PDF_UNAVAILABLE'`, `reason = '<the lookup reason> — the open-access copy of DOI ${doi} was not looked up'` (never "No OA PDF available"). Unpaywall has no record → `reason = 'Unpaywall has no record of DOI ${doi} (…)'`. A record without an OA PDF (`oa_pdf_url`: the best location's PDF, then any other location's PDF, then an arXiv / PMC / `.pdf` link) → `reason = 'No OA PDF available for DOI ${doi}'`.
   - **(b)** Else fetch the PDF as a plain request (source `generic`: the PDF host never receives the contact email; every redirect hop is SSRF-checked) under the `MAX_PDF_BYTES` cap, and check what came back with `bin/lib/pdf-response.ts checkPdfResponse` on the byte-faithful `bodyBytes`: a non-200 → `reason = 'OA PDF fetch returned HTTP <status>'`; a landing page → `reason = 'OA PDF fetch returned not a PDF (got text/html)'`; a refused request → `reason = 'OA PDF fetch failed: <why>'` — each `PDF_UNAVAILABLE`, never fed to the extractor.
   - **(c)** Extract text: `const text = await extractPdfText(bytes)` (the `bin/lib/pdf-text.ts` chokepoint per D-06 / Plan 03-02 Task 2.1). An extraction error → `PDF_UNAVAILABLE`, `reason = 'OA PDF text extraction failed: <why>'` (reported, never thrown).
     If `text.replace(/\s/g, '').length < 50` → `verdict = 'TEXT_UNAVAILABLE'`, `reason = 'PDF appears image-only or scanned (<50 non-whitespace chars). Pass 3 cannot run.'`.
   - **(d)** Else normalize + match: `const ratio = levenshteinSubstring(nfkcNormalize(quote), nfkcNormalize(text))`.
     If `ratio >= QUOTE_LEV_THRESHOLD (0.95)` → `verdict = 'OK'`; else `verdict = 'NOT_FOUND'`.

   **Per-source Pass-3 status** (DETERMINISTIC, OpenCode HIGH #2 / Codex HIGH consensus #2 — 4-way discrimination):
   - If any quote has `verdict = 'NOT_FOUND'` → section Pass-3 FAILS for this source.
   - Else if all quotes are `'OK'` → section Pass-3 PASSES for this source.
   - Else if all quotes are `'PDF_UNAVAILABLE'` or `'TEXT_UNAVAILABLE'` → section Pass-3 is **UNVERIFIABLE** for this source (D-08-AMENDED `status: 'unverifiable'`).
   - Mixed (some `'OK'`, some `'PDF_UNAVAILABLE'`): per-source Pass-3 is **UNVERIFIABLE** overall (do NOT auto-promote to PASS — surface to writer so they can substitute a quote with available OA PDF backing).

7. **Narrate Pass-3 results into VERIFICATION.md** via TEMPLATE LITERAL (no LLM): for each `pass3Result`, one list row (`renderPass3VerdictRow`):
   ```text
   - ${citekey} ("${quoteSnippet}…"): **${verdict}** — lev=${levRatio.toFixed(3)} — ${reason}
   ```
   The rows go under `## Pass-3 (quote integrity, deterministic — levenshtein-substring)`.

8. **Compute overall verdict** (DETERMINISTIC, no LLM):
   - **FAIL** (`status: failed`) iff any `'FABRICATED'` / `'MIS-CITED'` Pass-1 verdict or any `'NOT_FOUND'` Pass-3 verdict.
   - **UNVERIFIABLE, blocking** (`status: unverifiable`) iff no FAIL and any Pass-1 verdict is `'UNVERIFIABLE'` (checked offline or under `--dry-run`, step 4): compile and done refuse the row with "re-run online".
   - **UNVERIFIABLE, advisory** (`status: unverifiable`) iff no FAIL, no Pass-1 UNVERIFIABLE, and a Pass-3 quote is `'PDF_UNAVAILABLE'` / `'TEXT_UNAVAILABLE'`: it surfaces loudly in VERIFICATION.md but does not block compile (Pitfall 3; the README disclaimer per PRD §3 covers it).
   - **PASS** (`status: verified`) otherwise.

9. **Write `<sectionVerification(n, slug)>`** = `.paper/sections/<NN>-<slug>/VERIFICATION.md` via `bin/lib/atomic-write.ts` (D-07 chokepoint), in this order:
   - **Offline marker** (RUN-02): when sources were offline, the FIRST line is `> OFFLINE MODE (<reason>) — recorded fixtures, not live results.` (or the `--dry-run` synthetic-sources form). A VERIFICATION.md written under `--dry-run` never lets a real compile or export through (RUN-27): re-verify without `--dry-run`.
   - `# VERIFICATION (Section N, slug)` and the `Status: verified | failed | unverifiable` line (compile and done refuse a missing Status line and a `Status: failed` even when no row parses — fail closed).
   - The Pass-1 rows (step 5) and the Pass-3 rows (step 7).
   - The source-freshness table and the ADVISORY claim-support (Pass 2) and orphan-claim (Pass 4) sections. They are computed after the status above is frozen and never change it (VRFY-07). With no model configured (Tier 1, or a Tier-2 user checking a hand-written draft, D-V1-04) they record `skipped (no LLM configured)` rows and verify still exits by the frozen status. When the session cost cap (or an invalid runtime config) stops them, their rows say `not run (…)`, VERIFICATION.md and step 10 are still written, and verify then exits with that failure's code (5 for the cost cap). A failed Retraction Watch probe is an `unavailable` freshness row, never silence. The DOI HEAD probe asks only whether doi.org resolves the handle: its redirect is the answer (never followed), and only a 4xx/5xx from doi.org is a WARN row.

10. **Update PlanFrontmatter** per D-08-AMENDED LOCKED enum:
    - **PASS** → `status: 'verified'`.
    - **UNVERIFIABLE** → `status: 'unverifiable'`.
    - **FAIL** → `status: 'failed'`.

    Set `verified_against_draft_hash` (the per-section hash compile recomputes from DRAFT.md bytes + sorted `assigned_sources`). If the drafter is re-run, the hash changes, automatically invalidating this verification — the cycle-break between write and verify (D-08-AMENDED).

    **Exit code** (RUN-09): 0 for `verified` and for an advisory `unverifiable`; **4** (EXIT_BLOCKED) for `failed` and for a blocking Pass-1 UNVERIFIABLE.

11. **Section-isolation invariant** (TEST-09): this verb MUST NOT touch any file outside `.paper/sections/<NN>-<slug>/` — except the bib repair of step 3 (a paper-level file rendered from LIBRARY.json; no other section's files are ever touched).

12. **Shell fallback** (TIER-06 equivalence path): `pensmith verify <N> [--yolo]`.
