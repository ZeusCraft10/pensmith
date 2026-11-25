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
//   - UNATTRIBUTED   — a long quotation that cites nothing, so no source can be
//                      checked (does not block; the section is unverifiable)
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
import { ELLIPSIS, extractQuotes, MIN_SHORT_WORDS, wordCount } from '../quote-extractor.js';
import { escapeRe, sentenceEnds } from '../citation-grammar.js';
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

/** The most source text an ellipsis in a short quotation may stand for. */
export const MAX_ELIDED_CHARS = 150;

/**
 * Whether a short quotation appears word for word in `sourceText`, as whole
 * words, ignoring case and Unicode compatibility forms.
 *
 * An ellipsis (`...`, `…`, `[...]`) marks words left out of one sentence. The
 * parts around it must appear in order, in the same sentence of the source,
 * with at most MAX_ELIDED_CHARS characters between them; otherwise parts of two
 * sentences far apart pass as one quotation that can say the opposite of
 * either. Each part needs at least two words, since one word such as `is` is
 * found almost anywhere, and the quotation needs MIN_SHORT_WORDS in all.
 */
export function shortQuoteFound(quote: string, sourceText: string): boolean {
  const source = nfkcNormalize(sourceText);
  // Punctuation the omission left next to an ellipsis is not part of the quote.
  const parts = nfkcNormalize(quote).split(ELLIPSIS)
    .map((p) => p.replace(/^[\s,;:.!?]+|[\s,;:.!?]+$/g, ''))
    .filter((p) => wordCount(p) > 0);
  if (parts.reduce((n, p) => n + wordCount(p), 0) < MIN_SHORT_WORDS) return false;
  if (parts.length > 1 && parts.some((p) => wordCount(p) < 2)) return false;

  const patterns = parts.map((p) => new RegExp(String.raw`(?<![\p{L}\p{N}])${escapeRe(p)}(?![\p{L}\p{N}])`, 'giu'));
  // The source's sentence ends, found the first time a later part is.
  let ends: number[] | undefined;
  const sentenceEndIn = (a: number, b: number): boolean => {
    ends ??= sentenceEnds(source);
    let lo = 0;
    let hi = ends.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ends[mid]! < a) lo = mid + 1;
      else hi = mid;
    }
    return lo < ends.length && ends[lo]! < b;
  };
  // Part `i` at or after `from`; every later part close behind it in the same
  // sentence. Each occurrence of the first part is tried in turn.
  const matchFrom = (i: number, from: number): boolean => {
    if (i === parts.length) return true;
    const re = patterns[i]!;
    // A later part counts only when it starts within MAX_ELIDED_CHARS of
    // `from`, so it is looked for no further than that, plus its own length
    // and the character after it (two code units, for a surrogate pair).
    const hay = i === 0 ? source : source.slice(0, from + MAX_ELIDED_CHARS + parts[i]!.length + 2);
    re.lastIndex = from;
    for (let m = re.exec(hay); m; m = re.exec(hay)) {
      if (i > 0 && (m.index - from > MAX_ELIDED_CHARS || sentenceEndIn(from, m.index))) return false;
      const at = m.index;
      if (matchFrom(i + 1, at + m[0].length)) return true;
      re.lastIndex = at + 1;
    }
    return false;
  };
  return matchFrom(0, 0);
}

/** A source's extracted text, and its normalized form once a long quotation needs it. */
interface SourceText {
  text: string;
  normalized?: string;
}

/** `fn`, called once per key: a later call with the same key shares the first call's promise. */
function once<T>(fn: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const calls = new Map<string, Promise<T>>();
  return (key) => {
    let p = calls.get(key);
    if (!p) {
      p = fn(key);
      calls.set(key, p);
    }
    return p;
  };
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
  // A source several quotations cite is looked up, fetched and parsed once.
  const oaPdfUrl = once(async (doi: string) => (await sources.unpaywall.fetchById(doi))?.oa_pdf_url);
  const sourceText = once(async (url: string): Promise<SourceText> => {
    const resp = await httpFetch(url, { source: 'unpaywall' });
    const body = resp.body;
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    return { text: await extractPdfText(buf) };
  });

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

    const oaUrl = await oaPdfUrl(claimed.DOI);
    if (!oaUrl) {
      results.push({
        citekey: q.citekey, quoteSnippet: snippet,
        verdict: 'PDF_UNAVAILABLE', levRatio: 0,
        reason: `No OA PDF available for DOI ${claimed.DOI}`,
      });
      continue;
    }

    try {
      const src = await sourceText(oaUrl);
      const text = src.text;
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
        const found = shortQuoteFound(q.text, text);
        results.push({
          citekey: q.citekey, quoteSnippet: snippet,
          verdict: found ? 'OK' : 'NOT_FOUND', levRatio: found ? 1 : 0,
          reason: found ? 'short quote found verbatim'
            : ELLIPSIS.test(nfkcNormalize(q.text))
              ? `short quote not found verbatim in OA PDF — an ellipsis may leave out at most ${MAX_ELIDED_CHARS} ` +
                'characters of one sentence, with two or more quoted words in each part'
              : 'short quote not found verbatim in OA PDF',
        });
        continue;
      }
      src.normalized ??= nfkcNormalize(text);
      const ratio = levenshteinSubstring(nfkcNormalize(q.text), src.normalized);
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
