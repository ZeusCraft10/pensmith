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
//   5. Check the quotation appears in that text word for word, allowing an
//      ellipsis, a bracketed insertion and PDF extraction noise, never a
//      changed word (bin/lib/verify/quote-match.ts).
//
// Verdict enum:
//   - OK             — found word for word
//   - NOT_FOUND      — not in the source text (blocks compile and export)
//   - PDF_UNAVAILABLE — no DOI or no Unpaywall OA URL
//   - TEXT_UNAVAILABLE — PDF parsed but appears image-only (<50 non-WS chars)
//   - UNATTRIBUTED   — a long quotation that cites nothing, so no source can be
//                      checked (does not block; the section is unverifiable)
//
// CYCLE-2 H-4 signature lock:
//   `runPass3(draftMd, bibByCitekey)` is the canonical entrypoint.
//   `runPass3Unit({ claimedQuote, pdfText })` is the fixture-shape helper
//   used by tests/known-bad-quotes.test.ts in Plan 03-09.

import { matchQuote } from './quote-match.js';
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
  /** 1 when the quotation was found, else 0 (the `lev=` field of the verdict row). */
  levRatio: number;
  reason: string;
}

interface BibLike {
  DOI?: string;
}

/**
 * Whether a short quotation appears word for word in `sourceText`. Short and
 * long quotations follow the same rules (bin/lib/verify/quote-match.ts).
 */
export function shortQuoteFound(quote: string, sourceText: string): boolean {
  return matchQuote(quote, sourceText).found;
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
        reason: 'a direct quotation with no citation, so no source can be checked — if it quotes a source, ' +
          'cite it as [@key, p. N]; your own data (an interview, a participant) or an epigraph can stay, but check it yourself',
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

    // Looked up and fetched per quotation, never remembered for the run: a
    // failed lookup or fetch for one quotation must not leave a later
    // quotation of the same source unchecked. A repeat of a success comes
    // from the HTTP cache.
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
      const match = matchQuote(q.text, text);
      results.push({
        citekey: q.citekey, quoteSnippet: snippet,
        verdict: match.found ? 'OK' : 'NOT_FOUND', levRatio: match.found ? 1 : 0,
        reason: match.found ? `quote ${match.reason}` : `quote ${match.reason} in the OA PDF`,
      });
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
 * Check one quotation against a source text, with no HTTP and no PDF: the
 * same match runPass3 makes once it has the text.
 */
export function runPass3Unit(input: {
  claimedQuote: string;
  pdfText: string;
}): { verdict: Pass3Verdict; levRatio: number } {
  const found = matchQuote(input.claimedQuote, input.pdfText).found;
  return { verdict: found ? 'OK' : 'NOT_FOUND', levRatio: found ? 1 : 0 };
}
