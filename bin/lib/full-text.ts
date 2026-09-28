// bin/lib/full-text.ts — which sources have legitimately available full text,
// and which draft quotes lean on a source without it (GRND-14, D-19-23).
//
// The drafter may quote directly only from a source whose full text can be
// checked (VRFY-19 checks every quote against real text; a quote from an
// abstract-only source can only end as UNVERIFIABLE-QUOTE, VRFY-20). A source
// has full text when it has:
//   - a bring-your-own PDF whose extracted text was hashed at ingest
//     (`byo.text_sha256`, SRC-15 — read later only through byo-text.ts, which
//     re-hashes the PDF);
//   - an open-access PDF location (`oa_url`, Unpaywall SRC-03);
//   - an arXiv id (the arXiv PDF is open);
//   - a PubMed Central id (PMC full text is open).
//
// Phase 18's source-context.ts `fullTextAvailable` delegates to this function
// at the Phase 18/19 merge, and its draft-containment.ts adds the
// `quote-without-full-text` violation from quotesWithoutFullText (19-PLAN §9),
// so write's single corrective turn enforces the policy. Pure: no I/O.

import { extractQuotes } from './quote-extractor.js';
import type { LibraryEntry } from './schemas/library.js';

export type FullTextSource = 'bring-your-own PDF' | 'open-access PDF' | 'arXiv' | 'PubMed Central';

type FullTextFields = Pick<LibraryEntry, 'byo' | 'oa_url' | 'arxiv' | 'pmcid'>;

/** Where a source's full text comes from, or null when it has none (in the order above). */
export function fullTextSource(entry: FullTextFields): FullTextSource | null {
  if (entry.byo !== null && entry.byo.text_sha256 !== null) return 'bring-your-own PDF';
  if (entry.oa_url) return 'open-access PDF';
  if (entry.arxiv) return 'arXiv';
  if (entry.pmcid) return 'PubMed Central';
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
 * the same quotes Pass 3 checks (quote-extractor.ts). A citekey missing from
 * `fullText` counts as "no full text": an unknown source's quote cannot be
 * checked either.
 */
export function quotesWithoutFullText(
  draft: string,
  fullText: ReadonlyMap<string, boolean> | Readonly<Record<string, boolean>>,
): QuoteWithoutFullText[] {
  const has = (key: string): boolean =>
    fullText instanceof Map ? fullText.get(key) === true : (fullText as Readonly<Record<string, boolean>>)[key] === true;
  return extractQuotes(draft)
    .filter((q) => !has(q.citekey))
    .map((q) => ({ citekey: q.citekey, quote: q.text, kind: q.kind }));
}
