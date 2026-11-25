// bin/lib/verify/pass3.ts — Pass-3 quote-integrity verifier (VRFY-04, D-13).
//
// Deterministic — NO LLM (D-13 LOCKED INVARIANT).
//
// Pipeline per quote:
//   1. Extract the quotations and the keys they cite from DRAFT.md via
//      bin/lib/quote-extractor.ts.
//   2. Resolve citekey -> DOI from .paper/CITATIONS.bib.
//   3. Look up Unpaywall OA PDF URL for that DOI (HTTP via bin/lib/http.ts).
//   4. Fetch the PDF bytes and extract text via bin/lib/pdf-text.ts.
//   5. NFKC-normalize both the claimed quote AND the extracted PDF text.
//   6. Compute levenshteinSubstring(quote, pdfText); compare to QUOTE_LEV_THRESHOLD.
//
// Verdict enum:
//   - OK             — match ratio >= QUOTE_LEV_THRESHOLD (a short quote: found verbatim)
//   - NOT_FOUND      — match ratio < QUOTE_LEV_THRESHOLD (a short quote: not found verbatim)
//   - PDF_UNAVAILABLE — no DOI or no Unpaywall OA URL
//   - TEXT_UNAVAILABLE — PDF parsed but appears image-only (<50 non-WS chars)
//   - UNATTRIBUTED   — a long quotation that cites nothing, so no source can be checked
//
// CYCLE-2 H-4 signature lock:
//   `runPass3(draftMd, bibByCitekey)` is the canonical entrypoint.
//   `runPass3Unit({ claimedQuote, pdfText })` is the fixture-shape helper
//   used by tests/known-bad-quotes.test.ts in Plan 03-09.

import { levenshteinSubstring, QUOTE_LEV_THRESHOLD } from '../fuzzy.js';
import { nfkcNormalize } from '../normalize.js';
import { extractPdfText } from '../pdf-text.js';
import { sources } from '../sources/index.js';
import { fetch as httpFetch } from '../http.js';
import { isOfflineMode, OFFLINE_SKIP_NOTE } from '../network-mode.js';
import { extractQuotes } from '../quote-extractor.js';
import { NO_CITATION_KEY } from './verdict-rows.js';

export type Pass3Verdict = 'OK' | 'NOT_FOUND' | 'PDF_UNAVAILABLE' | 'TEXT_UNAVAILABLE' | 'UNATTRIBUTED';

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
 * Pure deterministic except for the HTTP fetches.
 */
export async function runPass3(
  draftMd: string,
  bibByCitekey: Map<string, BibLike>,
): Promise<Pass3Result[]> {
  const quotes = extractQuotes(draftMd);
  const results: Pass3Result[] = [];

  for (const q of quotes) {
    const snippet = q.text.slice(0, 40);
    if (q.unattributed) {
      results.push({
        citekey: NO_CITATION_KEY, quoteSnippet: snippet,
        verdict: 'UNATTRIBUTED', levRatio: 0,
        reason: 'a direct quotation with no citation, so no source can be checked — cite its source as [@key, p. N] or remove the quotation marks',
      });
      continue;
    }
    const claimed = bibByCitekey.get(q.citekey);

    if (!claimed?.DOI) {
      results.push({
        citekey: q.citekey, quoteSnippet: snippet,
        verdict: 'PDF_UNAVAILABLE', levRatio: 0,
        reason: 'No DOI for citekey — cannot fetch OA PDF',
      });
      continue;
    }

    // Offline: no source text can be fetched, so the quote is unchecked.
    if (isOfflineMode()) {
      results.push({
        citekey: q.citekey, quoteSnippet: snippet,
        verdict: 'PDF_UNAVAILABLE', levRatio: 0,
        reason: `${OFFLINE_SKIP_NOTE}: source text not fetched — re-run verify with network access`,
      });
      continue;
    }

    const oaCandidate = await sources.unpaywall.fetchById(claimed.DOI);
    const oaUrl = oaCandidate?.oa_pdf_url;
    if (!oaUrl) {
      results.push({
        citekey: q.citekey, quoteSnippet: snippet,
        verdict: 'PDF_UNAVAILABLE', levRatio: 0,
        reason: `No OA PDF available for DOI ${claimed.DOI}`,
      });
      continue;
    }

    try {
      const resp = await httpFetch(oaUrl, { source: 'unpaywall' });
      const body = resp.body;
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
      const text = await extractPdfText(buf);
      if (text.replace(/\s/g, '').length < 50) {
        results.push({
          citekey: q.citekey, quoteSnippet: snippet,
          verdict: 'TEXT_UNAVAILABLE', levRatio: 0,
          reason: 'PDF appears image-only or scanned (<50 non-whitespace chars)',
        });
        continue;
      }
      if (q.exact) {
        // A few words: a fuzzy threshold would accept a changed word.
        const found = nfkcNormalize(text).toLowerCase().includes(nfkcNormalize(q.text).toLowerCase());
        results.push({
          citekey: q.citekey, quoteSnippet: snippet,
          verdict: found ? 'OK' : 'NOT_FOUND', levRatio: found ? 1 : 0,
          reason: found ? 'short quote found verbatim' : 'short quote not found verbatim in OA PDF',
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        citekey: q.citekey, quoteSnippet: snippet,
        verdict: 'PDF_UNAVAILABLE', levRatio: 0,
        reason: `PDF fetch/parse failed: ${msg}`,
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
