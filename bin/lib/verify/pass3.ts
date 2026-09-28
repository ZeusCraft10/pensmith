// bin/lib/verify/pass3.ts — Pass-3 quote-integrity verifier (VRFY-04, D-13).
//
// Deterministic — NO LLM (D-13 LOCKED INVARIANT).
//
// Pipeline per quote:
//   1. Extract quoted-claim ranges from DRAFT.md via bin/lib/quote-extractor.ts
//      (>= 10 words, with associated [@citekey]).
//   2. Resolve citekey -> DOI from .paper/CITATIONS.bib.
//   3. Look up the DOI's open-access copy through Unpaywall's three-way lookup
//      (D-19-05): a failed lookup reports its reason (e.g. `Unpaywall skipped:
//      set PENSMITH_CONTACT_EMAIL`, `HTTP 503 after retries`), never "no OA PDF".
//   4. Fetch the OA PDF (source 'generic': the PDF host is not a polite pool and
//      never receives the contact email), check that the final response really
//      is a PDF (pdf-response.ts checkPdfResponse on the byte-faithful
//      bodyBytes), then extract its text via bin/lib/pdf-text.ts; an extraction
//      error is reported, never thrown.
//   5. NFKC-normalize both the claimed quote AND the extracted PDF text.
//   6. Compute levenshteinSubstring(quote, pdfText); compare to QUOTE_LEV_THRESHOLD.
//
// Verdict enum:
//   - OK             — match ratio >= QUOTE_LEV_THRESHOLD
//   - NOT_FOUND      — match ratio < QUOTE_LEV_THRESHOLD
//   - PDF_UNAVAILABLE — no DOI or no Unpaywall OA URL, or the text is unavailable
//                       because the run is offline / --dry-run (RUN-04: no
//                       request is made; "text unavailable (offline)")
//   - TEXT_UNAVAILABLE — PDF parsed but appears image-only (<50 non-WS chars)
//
// Reserved dry-run identifiers (RUN-27): accepted only under --dry-run (the
// synthetic source has no text → PDF_UNAVAILABLE "text unavailable (dry-run)");
// outside --dry-run a quote attributed to one is NOT_FOUND ("reserved dry-run
// identifier") without any request.
//
// The OA PDF is fetched byte-faithfully (bodyBytes, audit #29) under the
// MAX_PDF_BYTES response cap (SEC-03).
//
// CYCLE-2 H-4 signature lock:
//   `runPass3(draftMd, bibByCitekey)` is the canonical entrypoint.
//   `runPass3Unit({ claimedQuote, pdfText })` is the fixture-shape helper
//   used by tests/known-bad-quotes.test.ts in Plan 03-09.

import { levenshteinSubstring, QUOTE_LEV_THRESHOLD } from '../fuzzy.js';
import { nfkcNormalize } from '../normalize.js';
import { extractPdfText, MAX_PDF_BYTES } from '../pdf-text.js';
import { lookupById as unpaywallLookupById } from '../sources/unpaywall.js';
import { fetch as httpFetch, isOfflineEgressError, offlineLabel, type HttpResponse } from '../http.js';
import { checkPdfResponse } from '../pdf-response.js';
import { errorFailureReason } from '../sources/search-failure.js';
import { networkMode } from '../http-mock.js';
import { isReservedDryRunId } from '../doi.js';
import { extractQuotes } from '../quote-extractor.js';

export type Pass3Verdict = 'OK' | 'NOT_FOUND' | 'PDF_UNAVAILABLE' | 'TEXT_UNAVAILABLE';

export interface Pass3Result {
  citekey: string;
  /** First 40 chars of the claimed quote — for human-readable diagnostics. */
  quoteSnippet: string;
  verdict: Pass3Verdict;
  levRatio: number;
  reason: string;
}

interface BibLike {
  DOI?: string;
}

/**
 * Run Pass-3 against every quote in `draftMd`, looking up source PDFs via
 * the bib map.
 *
 * Pure deterministic except for the HTTP fetches, which are made only when the
 * run is live: offline and --dry-run report the text as unavailable instead.
 */
export async function runPass3(
  draftMd: string,
  bibByCitekey: Map<string, BibLike>,
): Promise<Pass3Result[]> {
  const quotes = extractQuotes(draftMd);
  const results: Pass3Result[] = [];
  const mode = networkMode();

  for (const q of quotes) {
    const snippet = q.text.slice(0, 40);
    const claimed = bibByCitekey.get(q.citekey);

    if (!claimed?.DOI) {
      results.push({
        citekey: q.citekey, quoteSnippet: snippet,
        verdict: 'PDF_UNAVAILABLE', levRatio: 0,
        reason: 'No DOI for citekey — cannot fetch OA PDF',
      });
      continue;
    }

    if (isReservedDryRunId(claimed.DOI)) {
      results.push(
        mode.dryRun
          ? {
              citekey: q.citekey, quoteSnippet: snippet,
              verdict: 'PDF_UNAVAILABLE', levRatio: 0,
              reason: 'text unavailable (dry-run): a synthetic dry-run source has no text',
            }
          : {
              citekey: q.citekey, quoteSnippet: snippet,
              verdict: 'NOT_FOUND', levRatio: 0,
              reason: `reserved dry-run identifier ${claimed.DOI} — a synthetic source cannot be quoted`,
            },
      );
      continue;
    }

    if (mode.sourcesOffline) {
      // RUN-04: no Unpaywall lookup and no OA-PDF fetch offline or under --dry-run.
      results.push({
        citekey: q.citekey, quoteSnippet: snippet,
        verdict: 'PDF_UNAVAILABLE', levRatio: 0,
        reason: `text unavailable (${mode.dryRun ? 'dry-run' : 'offline'}) — re-run online to check the quote`,
      });
      continue;
    }

    const unavailable = (reason: string): void => {
      results.push({ citekey: q.citekey, quoteSnippet: snippet, verdict: 'PDF_UNAVAILABLE', levRatio: 0, reason });
    };

    let lookup: Awaited<ReturnType<typeof unpaywallLookupById>>;
    try {
      lookup = await unpaywallLookupById(claimed.DOI);
    } catch (err) {
      if (!isOfflineEgressError(err)) throw err;
      unavailable(`text unavailable (${offlineLabel(err)}) — re-run online to check the quote`);
      continue;
    }
    if (lookup.kind === 'failed') {
      // D-19-05: the reason, never "no OA PDF" (e.g. the missing contact email).
      unavailable(`${lookup.reason} — the open-access copy of DOI ${claimed.DOI} was not looked up`);
      continue;
    }
    if (lookup.kind === 'not-found') {
      unavailable(`Unpaywall has no record of DOI ${claimed.DOI} (${lookup.reason})`);
      continue;
    }
    const oaUrl = lookup.candidate.oa_pdf_url;
    if (!oaUrl) {
      unavailable(`No OA PDF available for DOI ${claimed.DOI}`);
      continue;
    }

    // The OA PDF host is an arbitrary site: 'generic' (plain User-Agent, no
    // contact email), every hop SSRF-checked by the transport; noCache so the
    // byte-faithful bodyBytes is always present (audit #29).
    let resp: HttpResponse;
    try {
      resp = await httpFetch(oaUrl, { source: 'generic', noCache: true, maxBytes: MAX_PDF_BYTES });
    } catch (err) {
      if (isOfflineEgressError(err)) {
        unavailable(`text unavailable (${offlineLabel(err)}) — re-run online to check the quote`);
        continue;
      }
      unavailable(`OA PDF fetch failed: ${errorFailureReason(err)}`);
      continue;
    }
    const pdf = checkPdfResponse(resp);
    if (!pdf.ok) {
      unavailable(`OA PDF fetch returned ${pdf.reason}`);
      continue;
    }

    let text: string;
    try {
      text = await extractPdfText(pdf.bytes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      unavailable(`OA PDF text extraction failed: ${(msg.split(/\r?\n/)[0] ?? '').slice(0, 200)}`);
      continue;
    }
    if (text.replace(/\s/g, '').length < 50) {
      results.push({
        citekey: q.citekey, quoteSnippet: snippet,
        verdict: 'TEXT_UNAVAILABLE', levRatio: 0,
        reason: 'PDF appears image-only or scanned (<50 non-whitespace chars)',
      });
      continue;
    }
    const ratio = levenshteinSubstring(nfkcNormalize(q.text), nfkcNormalize(text));
    if (ratio >= QUOTE_LEV_THRESHOLD) {
      results.push({
        citekey: q.citekey, quoteSnippet: snippet,
        verdict: 'OK', levRatio: ratio,
        reason: 'levenshtein-substring above threshold',
      });
    } else {
      results.push({
        citekey: q.citekey, quoteSnippet: snippet,
        verdict: 'NOT_FOUND', levRatio: ratio,
        reason: `quote not found in OA PDF (lev=${ratio.toFixed(3)} < ${QUOTE_LEV_THRESHOLD})`,
      });
    }
  }
  return results;
}

/**
 * CYCLE-2 H-4 — fixture-shape helper for tests/known-bad-quotes.test.ts.
 *
 * Operates on a single `{ claimedQuote, pdfText }` pair so unit fixtures
 * can be tested in isolation. No HTTP, no Unpaywall, no extractPdfText.
 * Plan 03-09 tests/known-bad-quotes.test.ts MUST import this helper,
 * NOT `runPass3`.
 */
export function runPass3Unit(input: {
  claimedQuote: string;
  pdfText: string;
}): { verdict: Pass3Verdict; levRatio: number } {
  const ratio = levenshteinSubstring(nfkcNormalize(input.claimedQuote), nfkcNormalize(input.pdfText));
  if (ratio >= QUOTE_LEV_THRESHOLD) return { verdict: 'OK', levRatio: ratio };
  return { verdict: 'NOT_FOUND', levRatio: ratio };
}
