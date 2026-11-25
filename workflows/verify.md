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
produced by registry lookups and a word-by-word metadata comparison (Pass 1, step 4)
and `levenshteinSubstring` (Pass-3 quote integrity) alone. The dormant fuzzy-judge and quote-checker prompts
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

4. **PASS 1 — Citation Integrity (DETERMINISTIC, VRFY-01)** — `bin/lib/verify/pass1.ts`, no LLM:
   - Extract every citation from DRAFT.md through `bin/lib/citation-grammar.ts` (Pandoc clusters, narrative `@key`, suppress-author `-@key`).
   - A citekey absent from `.paper/CITATIONS.bib` → `FABRICATED`. An entry with an empty title or no authors → `MIS-CITED`. A retraction recorded in the bib (`note = {RETRACTED}`) → `RETRACTED`, offline too.
   - Read the entry's identifiers, most reliable first: DOI (or a doi.org link in `url`), arXiv ID, PMID, ISBN (`bin/lib/verify/resolve.ts`). Ask the registries that hold each: Crossref, then DataCite, then doi.org content negotiation for a DOI; the arXiv API; PubMed esummary; Open Library.
   - `FABRICATED` only when every registry asked answers "no such work" authoritatively. A registry that gives no answer (offline, timeout, 429, 5xx) → `UNRESOLVED`, which blocks and is retried on the next verify. An entry with no identifier, or a book Open Library does not list → `UNRESOLVED`. A malformed identifier → `MIS-CITED`.
   - Compare the entry with the record found (`bin/lib/verify/work-match.ts`): the title word by word (markup, case, spelling and a missing subtitle set aside; numbers must match), the first author and every other named author, the year within one, and a journal article's journal. Any mismatch → `MIS-CITED`, with each problem in the reason.
   - Retraction (`bin/lib/verify/retraction.ts`), read from the same record: a Crossref `updated-by` notice of type retraction, partial retraction, withdrawal or removal (or an `update-to` naming the work's own DOI, a retraction in place), PubMed's "Retracted Publication" type, or a "RETRACTED:" / "WITHDRAWN:" title label (which is not part of the title for the comparison above). When the record says nothing, OpenAlex `is_retracted` is asked; no answer from OpenAlex never blocks, and the reason says it could not be asked. A retracted work → `RETRACTED` (blocking), unless the section's `ACKNOWLEDGEMENTS.json` holds an acknowledgement for that citekey and that work (`pensmith ack`, `workflows/ack.md`) → `RETRACTED_ACKNOWLEDGED` (not blocking; verify, compile and done warn). An expression of concern → `EXPRESSION_OF_CONCERN` (not blocking; they warn). Otherwise `OK`.

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
