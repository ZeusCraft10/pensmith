# pensmith verify

> Verify citations + claims in one section. Per-section verb — touches ONLY
> `.paper/sections/<NN>-<slug>/` (TEST-09 section-isolation invariant).
>
> **D-13 LOCKED INVARIANT — Phase 3 verify path is 100% deterministic.**
> Zero LLM calls between Pass-1 fetch and `<sectionVerification>` write.

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

## Body

> **D-13 LOCKED INVARIANT — Phase 3 verify path is 100% deterministic.**
> NO LLM call SHALL be made between the Pass-1 fetch and the `sectionVerification` write.
> The dormant fuzzy-judge and quote-checker prompts exist (Plan 05 hash-pins them) but are
> DORMANT — calibrated for Phase 8 ambiguous-case tie-break only.
> Narration in VERIFICATION.md is built from template literals embedded in this body, NOT
> from any model call.
> Audit gate (BL-2): a CI-side regex grep on this file matches zero LLM-invocation patterns inside the `## Body` section. The exact regex lives in `.planning/phases/03-vertical-slice-one-section/03-06-PLAN.md` (verification block) and is enforced by the merge gate, not duplicated here (to keep this file inert under its own grep).

1. **Parse args**: `pensmith verify <N>` — `N` is the 1-based section number. Read `.paper/OUTLINE.md` to resolve the slug.

2. **Set status to `'verifying'`** (D-08-AMENDED LOCKED enum value): update the section's PlanFrontmatter `status: 'verifying'` via `bin/lib/frontmatter.ts updateFrontmatter()` (round-trip-safe per D-08).

3. **Read inputs**:
   - `<sectionDraft(n, slug)>` = `.paper/sections/<NN>-<slug>/DRAFT.md` — Markdown body with Pandoc `[@citekey]` tokens (D-21).
   - `<sectionPlan(n, slug)>` = `.paper/sections/<NN>-<slug>/PLAN.md` — for `assigned_sources` and the `verified_against_draft_hash` invalidation check.
   - **`.paper/CITATIONS.bib`** — canonical BibTeX (D-20), parsed through `bin/lib/citations.ts parseBibtex` (D-19 citation-js chokepoint). This file is the **single source of truth** for citation metadata at verify time; `LIBRARY.json` is NOT consulted at verify time.

4. **PASS 1 — Citation Integrity (DETERMINISTIC, VRFY-01)**:
   - Extract every `[@citekey]` token from DRAFT.md (Pandoc citation regex).
   - For each citekey, look up the parsed `.paper/CITATIONS.bib` entry → `claimed = {title, authors, doi, retracted}`.
   - If the citekey is absent from `.paper/CITATIONS.bib` → `verdict = 'FABRICATED'`, `reason = 'citekey ${citekey} not present in .paper/CITATIONS.bib (citation invented by drafter)'`. Skip the rest of step 4 for this citekey.
   - For each DOI present in claimed: call `sources.crossref.fetchById(doi)` (cassette-backed in CI per Plan 03-04 Task 4.1) → `actual = {title, authors, doi}`.
   - If `fetchById(doi)` returns null / 404 → `verdict = 'FABRICATED'`, `reason = 'DOI ${doi} did not resolve at Crossref'`.
   - Compute `titleJW = jaroWinkler(nfkcNormalize(actual.title), nfkcNormalize(claimed.title))` against `TITLE_JW_THRESHOLD = 0.92` (CONTEXT D-11).
   - Compute `authorJW = jaroWinkler(firstAuthorSurname(actual.authors), firstAuthorSurname(claimed.authors))` against `AUTHOR_JW_THRESHOLD = 0.85` (first-author surname via `bin/lib/author-normalize.ts` per D-11).
   - **DETERMINISTIC AND-gate verdict** (no LLM): if both `titleJW >= TITLE_JW_THRESHOLD` AND `authorJW >= AUTHOR_JW_THRESHOLD` → `verdict = 'OK'`; otherwise `verdict = 'MIS-CITED'`, `reason = 'titleJW=${...} authorJW=${...} below threshold'`.

4a. **Field-presence sub-gate (DETERMINISTIC, no LLM — Codex MEDIUM #9 / OpenCode MEDIUM #5)**:
    Run BEFORE finalizing the JW AND-gate verdict:
    - If `claimed.title.length < 1` OR `claimed.authors[0]?.length < 1` → `verdict = 'MIS-CITED'`, `reason = 'claimed citation metadata incomplete (empty title or no authors)'`.
    - If `actual.title.length < 1` → `verdict = 'MIS-CITED'`, `reason = 'source API returned empty title — entry may be malformed upstream; manual review recommended'`.
    - **Retracted-flag handling**: if `claimed.retracted === true` (from the `.paper/CITATIONS.bib` parse, propagated from research-time Retraction Watch cross-check) → `verdict = 'MIS-CITED'`, `reason = 'cited a retracted work (per Retraction Watch cross-check at research time)'`. **Override even if JW thresholds pass** — retraction is a citation-integrity failure regardless of metadata match.
    - **Multi-DOI redirect handling**: if `fetchById(claimed.doi)` returns a record whose `doi` field DIFFERS from `claimed.doi` (Crossref returns canonical DOI for redirected entries), treat as `'OK'` iff `titleJW >= 0.98` AND `authorJW >= 0.95` (stricter band to account for Crossref publishing two distinct DOIs for the same work). Otherwise `verdict = 'MIS-CITED'`, `reason = 'claimed DOI ${claimed.doi} resolves to a different work (canonical: ${actual.doi})'`.

5. **Narrate Pass-1 results into VERIFICATION.md** via TEMPLATE LITERAL (no LLM): for each `pass1Result`, format as a Markdown table row:
   ```text
   | ${citekey} | ${verdict} | titleJW=${titleJW.toFixed(2)} authorJW=${authorJW.toFixed(2)} | ${reason} |
   ```
   The narration is mechanical string interpolation — no model call is issued. The table is appended to `VERIFICATION.md` under `## Pass 1 — Citation Integrity`.

6. **PASS 3 — Quote Integrity (DETERMINISTIC, VRFY-04 / VRFY-05)**:

   Quote extraction uses `bin/lib/quote-extractor.ts extractQuotes(draftMd)` (Plan 07 amendment — Codex HIGH #4 / OpenCode HIGH consensus #4) with these rules:
   - Block quotes (lines beginning with `> `): always included if word count >= 10.
   - Inline quotes (text wrapped in `"…"` or `"…"` or `'…'`): included only if the quote contains >= 10 words AND >= 60 characters.
   - Multi-paragraph block quotes: treated as one quote, word count = total.
   - Pandoc citation tokens (`[@citekey]`) stripped BEFORE counting words.
   - Quotes with fewer than 10 words are NOT extracted (the writer is responsible for inline-cite integrity at Pass-1 level for short attribution).

   For each extracted quote with an associated citekey:
   - **(a)** Fetch OA PDF URL: `const oaUrl = sources.unpaywall.fetchById(doi)?.oa_pdf_url`.
     If `!oaUrl` → `verdict = 'PDF_UNAVAILABLE'`, `reason = 'No OA PDF available for DOI ${doi} (Unpaywall returned no oa_pdf_url)'`.
   - **(b)** Else fetch bytes: `const buf = await http.get(oaUrl)` (cassette-backed in CI).
   - **(c)** Extract text: `const text = await extractPdfText(buf)` (the `bin/lib/pdf-text.ts` chokepoint per D-06 / Plan 03-02 Task 2.1).
     If `text.replace(/\s/g, '').length < 50` → `verdict = 'TEXT_UNAVAILABLE'`, `reason = 'PDF appears image-only or scanned (<50 non-whitespace chars). Pass 3 cannot run.'`.
   - **(d)** Else normalize + match: `const ratio = levenshteinSubstring(nfkcNormalize(quote), nfkcNormalize(text))`.
     If `ratio >= QUOTE_LEV_THRESHOLD (0.95)` → `verdict = 'OK'`; else `verdict = 'NOT_FOUND'`.

   **Per-source Pass-3 status** (DETERMINISTIC, OpenCode HIGH #2 / Codex HIGH consensus #2 — 4-way discrimination):
   - If any quote has `verdict = 'NOT_FOUND'` → section Pass-3 FAILS for this source.
   - Else if all quotes are `'OK'` → section Pass-3 PASSES for this source.
   - Else if all quotes are `'PDF_UNAVAILABLE'` or `'TEXT_UNAVAILABLE'` → section Pass-3 is **UNVERIFIABLE** for this source (D-08-AMENDED `status: 'unverifiable'`).
   - Mixed (some `'OK'`, some `'PDF_UNAVAILABLE'`): per-source Pass-3 is **UNVERIFIABLE** overall (do NOT auto-promote to PASS — surface to writer so they can substitute a quote with available OA PDF backing).

7. **Narrate Pass-3 results into VERIFICATION.md** via TEMPLATE LITERAL (no LLM): for each `pass3Result`, format as a Markdown table row:
   ```text
   | ${quote.slice(0,40)}... | ${verdict} | levRatio=${ratio.toFixed(3)} |
   ```
   Appended under `## Pass 3 — Quote Integrity`.

8. **Compute overall verdict** (DETERMINISTIC, no LLM):
   - **PASS** iff every Pass-1 verdict is `'OK'` AND every Pass-3 verdict is `'OK'` (NO `'unverifiable'`, NO `'NOT_FOUND'`).
   - **UNVERIFIABLE** iff Pass-1 all `'OK'` AND Pass-3 has >= 1 `'unverifiable'` verdict AND zero `'NOT_FOUND'` verdicts → overall `status = 'unverifiable'` (D-08-AMENDED).
     **Phase 3 policy (CYCLE-3 MEDIUM REVIEWS CONVERGENCE)**: `'unverifiable'` does NOT block compile in Phase 3 (the README disclaimer per PRD §3 covers this), but DOES surface loudly in VERIFICATION.md so the writer knows. A future approval-gate phase (DEFERRED to Phase 7 'compile + export polish' per ROADMAP.md, when `pensmith compile` lands) will optionally add a `--strict` flag that escalates `'unverifiable'` to a compile-blocking error.
   - **FAIL** otherwise (any `'FABRICATED'` / `'MIS-CITED'` / `'NOT_FOUND'`).

9. **Write `<sectionVerification(n, slug)>`** = `.paper/sections/<NN>-<slug>/VERIFICATION.md` via `bin/lib/atomic-write.ts` (D-07 chokepoint) with:
   - `## Pass 1 — Citation Integrity` table (step 5 narration).
   - `## Pass 3 — Quote Integrity` table (step 7 narration).
   - `## Overall Verdict` line (step 8).
   - **D-13 LOCKED INVARIANT footer**: literal block `> This verification was produced by the deterministic Pass-1/Pass-3 algorithms. No LLM was invoked at verify time per D-13.`

10. **Update PlanFrontmatter** per D-08-AMENDED LOCKED enum:
    - **PASS** → `status: 'verified'`.
    - **UNVERIFIABLE** → `status: 'unverifiable'`.
    - **FAIL** → `status: 'failed'`.

    Set `verified_against_draft_hash = sha256(DRAFT.md)`. If the drafter is re-run, the hash changes, automatically invalidating this verification — the cycle-break between write and verify (D-08-AMENDED).

11. **Section-isolation invariant** (TEST-09): this verb MUST NOT touch any file outside `.paper/sections/<NN>-<slug>/`.

12. **Shell fallback** (TIER-06 equivalence path): `pensmith verify <N> [--yolo]`.
