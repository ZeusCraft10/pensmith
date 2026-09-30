// bin/lib/full-text.ts — which sources have legitimately available full text,
// and which draft quotes lean on a source without it (GRND-14, D-19-23).
//
// The drafter may quote directly only from a source whose full text Pass 3
// can actually check (a quote from an abstract-only source can only end as
// UNVERIFIABLE-QUOTE, VRFY-20). The flag never marks a source Pass 3 cannot
// check; it may mark fewer (Phase 20, D-20-18: Pass 3 also reads a PMCID's
// Europe PMC full text and every PDF Unpaywall lists at verify time). A source
// is marked when Pass 3 checks a quote against (pass3.ts, verify/source-text.ts):
//   - its own bring-your-own PDF, read only through byo-text.ts, which
//     re-hashes the PDF (SRC-15, S-17): an entry whose `byo` record has an
//     extracted-text hash and was not attached by the user's say-so against a
//     failed title / first-author check (`byo.asserted`);
//   - the open-access PDF Unpaywall lists for its DOI (SRC-03): an entry with
//     a DOI whose `oa_url` was recorded at ingest. `oa_url` is written only
//     from Unpaywall's answer, and only once that URL answered HTTP 200 with a
//     PDF when asked the way Pass 3 asks it (open-access.ts enrichOpenAccess,
//     review round 3: a landing page or an HTML bot wall is abstract-only) —
//     never from another adapter's open-access link (OpenAlex's primary
//     location), which Pass 3 does not consult;
//   - the arXiv PDF of its arXiv id when that id is what Pass 1 verifies: a
//     DataCite arXiv DOI `10.48550/arXiv.<id>` (which Unpaywall does not
//     index), or an arXiv id on an entry with no other DOI. Pass 3 derives the
//     URL from the id, never from a URL stored in a local file (S-17). (An
//     arXiv id beside another DOI counts in Pass 3 only when the PDF shows the
//     entry's title, so it is not marked here.)
// Nothing else is marked: a PMCID alone, or a URL some adapter reported.
//
// The recorded BYO hashes are what this pure function reads: a PDF moved or
// edited since ingest still counts here, and Pass 3 (which re-hashes through
// byoText) then blocks the quote with the way back (restore the PDF). A caller
// that must know the text is readable NOW (the drafter: bin/cli/write.ts
// withVerifiedByo) calls byo-text.ts byoText for BYO sources first.
//
// source-context.ts `fullTextAvailable` (the drafter request's `full_text`)
// delegates to this function, and draft-containment.ts's
// `quote-without-full-text` violation comes from quotesWithoutFullText with
// the describeQuotesWithoutFullText text (the Phase 18/19 merge, 19-PLAN §9),
// so write's single corrective turn enforces the policy. Pure: no I/O.

import { extractQuotes, type ExtractQuotesOptions } from './quote-extractor.js';
import { normArxiv } from './migrations/library/shape.js';
import type { LibraryEntry } from './schemas/library.js';

export type FullTextSource = 'bring-your-own PDF' | 'open-access PDF' | 'arXiv PDF';

type FullTextFields = Pick<LibraryEntry, 'byo' | 'oa_url' | 'doi'> & { readonly arxiv?: string | null | undefined };

const DATACITE_ARXIV_DOI = /^(?:https?:\/\/(?:dx\.)?doi\.org\/)?10\.48550\/arxiv\./i;

/** True for a DataCite arXiv DOI (`10.48550/arXiv.1706.03762`): an arXiv id, not a Crossref / Unpaywall DOI. */
export function isDataCiteArxivDoi(doi: string | null | undefined): boolean {
  return typeof doi === 'string' && DATACITE_ARXIV_DOI.test(doi.trim());
}

/** The entry's versionless arXiv id — its `arxiv` field, else the id a DataCite arXiv DOI names — or null. */
export function arxivIdOfEntry(entry: { readonly doi?: string | null | undefined; readonly arxiv?: string | null | undefined }): string | null {
  const own = normArxiv(entry.arxiv ?? null);
  if (own !== null) return own;
  return isDataCiteArxivDoi(entry.doi) ? normArxiv(entry.doi) : null;
}

/** The arXiv PDF of a (versionless) arXiv id: derived from the id, never from a stored URL (S-17). */
export function arxivPdfUrl(arxivId: string): string {
  return `https://arxiv.org/pdf/${encodeURI(arxivId)}`;
}

/** Where a source's checkable full text comes from, or null when it has none (in the order above). */
export function fullTextSource(entry: FullTextFields): FullTextSource | null {
  if (entry.byo !== null && entry.byo.text_sha256 !== null && entry.byo.asserted !== true) return 'bring-your-own PDF';
  if (entry.oa_url && entry.oa_url.trim() !== '' && entry.doi && !isDataCiteArxivDoi(entry.doi)) return 'open-access PDF';
  if (arxivIdOfEntry(entry) !== null && (!entry.doi || isDataCiteArxivDoi(entry.doi))) return 'arXiv PDF';
  return null;
}

/** True when the source's full text is legitimately available (see the header). */
export function fullTextAvailable(entry: FullTextFields): boolean {
  return fullTextSource(entry) !== null;
}

/** The full-text flag of every entry, by citekey. */
export function fullTextByCitekey(entries: ReadonlyArray<FullTextFields & Pick<LibraryEntry, 'citekey'>>): Map<string, boolean> {
  return new Map(entries.map((e) => [e.citekey, fullTextAvailable(e)]));
}

export interface QuoteWithoutFullText {
  readonly citekey: string;
  /** The quoted text (citation tokens stripped, whitespace collapsed). */
  readonly quote: string;
  readonly kind: 'block' | 'inline';
}

/**
 * The direct quotes in `draft` attributed to a source without full text —
 * the same quotes Pass 3 checks (quote-extractor.ts, with the same
 * `[verification] quote_min_words` when the caller passes it). A citekey
 * missing from `fullText` counts as "no full text": an unknown source's quote
 * cannot be checked either. A quote attributed to no citation is not listed
 * here: Pass 3 blocks it as UNATTRIBUTED.
 */
export function quotesWithoutFullText(
  draft: string,
  fullText: ReadonlyMap<string, boolean> | Readonly<Record<string, boolean>>,
  opts: ExtractQuotesOptions = {},
): QuoteWithoutFullText[] {
  const has = (key: string): boolean =>
    fullText instanceof Map ? fullText.get(key) === true : (fullText as Readonly<Record<string, boolean>>)[key] === true;
  const out: QuoteWithoutFullText[] = [];
  for (const q of extractQuotes(draft, opts)) {
    if (q.citekey !== null && !has(q.citekey)) out.push({ citekey: q.citekey, quote: q.text, kind: q.kind });
  }
  return out;
}

/**
 * The corrective instruction for quotes from sources without full text — the
 * text draft-containment.ts's `quote-without-full-text` violation gives
 * write's one corrective turn (and, when it persists, the section's
 * `failure_reason`). Each quote is named by its citekey and first words;
 * empty input → ''.
 */
export function describeQuotesWithoutFullText(quotes: readonly QuoteWithoutFullText[]): string {
  if (quotes.length === 0) return '';
  const shown = quotes.slice(0, 5).map((q) => {
    const words = q.quote.split(/\s+/).filter(Boolean);
    const head = words.slice(0, 8).join(' ');
    return `[@${q.citekey}] "${head}${words.length > 8 ? ' …' : ''}"`;
  });
  const more = quotes.length > 5 ? `; … (${quotes.length - 5} more)` : '';
  return (
    `direct quote(s) from source(s) whose full text pensmith cannot check (full_text: false): ${shown.join('; ')}${more} — ` +
    'paraphrase them, or quote only a source marked full_text: true'
  );
}
