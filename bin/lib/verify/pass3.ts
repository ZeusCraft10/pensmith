// bin/lib/verify/pass3.ts — Pass-3 quote-integrity verifier (VRFY-04).
//
// Deterministic; no LLM.
//
// For each quotation in DRAFT.md (bin/lib/quote-extractor.ts):
//   1. find the DOI of each work it cites in .paper/CITATIONS.bib, read as
//      Pass 1 reads it (a doi.org link or a `doi:` prefix is the same DOI);
//   2. find the work's open-access PDF links (OpenAlex, then Unpaywall when a
//      contact email is set) and read the first PDF that has text
//      (bin/lib/verify/source-text.ts);
//   3. check the quotation appears in that text word for word, allowing an
//      ellipsis, a bracketed insertion and PDF extraction noise, never a
//      changed word (bin/lib/verify/quote-match.ts).
//
// Verdicts:
//   - OK               found word for word
//   - NOT_FOUND        not in the source text (blocks compile and export)
//   - PDF_UNAVAILABLE  no DOI, no open-access PDF, or the PDF could not be fetched
//   - TEXT_UNAVAILABLE the PDF is scanned images, with no text to check
//   - UNATTRIBUTED     a long quotation that cites nothing, so no source can be
//                      checked (does not block; the section is unverifiable)
//
// `runPass3(draftMd, bibByCitekey)` checks a draft.

import { matchQuote, type QuoteSource } from './quote-match.js';
import { openAccessText } from './source-text.js';
import { workIdentifiers } from './resolve.js';
import { isOfflineMode, OFFLINE_SKIP_NOTE } from '../network-mode.js';
import { extractQuotes } from '../quote-extractor.js';
import { NO_CITATION_KEY } from './verdict-rows.js';
import { quoteId } from './verification-record.js';

export type Pass3Verdict = 'OK' | 'NOT_FOUND' | 'PDF_UNAVAILABLE' | 'TEXT_UNAVAILABLE' | 'UNATTRIBUTED';

export interface Pass3Result {
  citekey: string;
  /** First 40 chars of the claimed quote — for human-readable diagnostics. */
  quoteSnippet: string;
  verdict: Pass3Verdict;
  /** 1 when the quotation was found, else 0 (the `lev=` field of the verdict row). */
  levRatio: number;
  reason: string;
  /** The first 12 hex digits of the SHA-256 of the whole quotation, which the snippet may cut short. */
  quoteId: string;
}

interface BibLike {
  DOI?: string;
  URL?: string;
}

/**
 * Run Pass 3 on every quotation in `draftMd`, finding each cited work's
 * open-access PDF through its DOI in `bibByCitekey`. Each run reads its
 * sources itself, so a later run checks against the source as it is then.
 *
 * Deterministic except for the HTTP requests.
 */
export async function runPass3(
  draftMd: string,
  bibByCitekey: Map<string, BibLike>,
): Promise<Pass3Result[]> {
  const quotes = extractQuotes(draftMd);
  const results: Pass3Result[] = [];
  // The texts read in this run, by PDF link. Only a success is kept: a failed
  // lookup or fetch for one quotation must not leave a later quotation of the
  // same work unchecked, so the next one asks again.
  const texts = new Map<string, QuoteSource>();

  for (const q of quotes) {
    const snippet = q.text.slice(0, 40);
    const id = quoteId(q.text);
    const push = (verdict: Pass3Verdict, reason: string, citekey = q.citekey): void => {
      results.push({ citekey, quoteSnippet: snippet, verdict, levRatio: verdict === 'OK' ? 1 : 0, reason, quoteId: id });
    };
    if (q.unattributed) {
      push('UNATTRIBUTED', 'a direct quotation with no citation, so no source can be checked — if it quotes a source, ' +
        'cite it as [@key, p. N]; your own data (an interview, a participant) or an epigraph can stay, but check it yourself',
      NO_CITATION_KEY);
      continue;
    }
    const entry = bibByCitekey.get(q.citekey);
    const work = entry ? workIdentifiers({ DOI: entry.DOI, URL: entry.URL }).find((w) => w.kind === 'doi') : undefined;
    if (!work) {
      push('PDF_UNAVAILABLE', 'No DOI for citekey — cannot fetch OA PDF');
      continue;
    }
    if (work.value === null) {
      push('PDF_UNAVAILABLE', `the entry's DOI field "${work.raw}" is not a DOI — cannot fetch OA PDF`);
      continue;
    }
    const doi = work.value;
    // Offline: no source text can be fetched, so the quote is unchecked.
    if (isOfflineMode()) {
      push('PDF_UNAVAILABLE', `${OFFLINE_SKIP_NOTE}: source text not fetched — re-run verify with network access`);
      continue;
    }

    const got = await openAccessText(doi, texts);
    if (got.kind === 'none') {
      if (got.noLinks) push('PDF_UNAVAILABLE', `No OA PDF available for DOI ${doi}: ${got.reason}`);
      else push(got.scanned ? 'TEXT_UNAVAILABLE' : 'PDF_UNAVAILABLE', `PDF fetch/parse failed: ${got.reason}`);
      continue;
    }
    const match = matchQuote(q.text, got.source);
    push(match.found ? 'OK' : 'NOT_FOUND', `quote ${match.reason}, checked against the OA PDF ${got.url}`);
  }
  return results;
}
