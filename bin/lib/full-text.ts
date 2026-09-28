// bin/lib/full-text.ts — which sources have legitimately available full text,
// and which draft quotes lean on a source without it (GRND-14, D-19-23).
//
// The drafter may quote directly only from a source whose full text Pass 3
// can actually check (a quote from an abstract-only source can only end as
// UNVERIFIABLE-QUOTE, VRFY-20). Pass 3 checks a quote against (pass3.ts):
//   - the source's own bring-your-own PDF, read only through byo-text.ts,
//     which re-hashes the PDF (SRC-15, S-17): an entry whose `byo` record has
//     an extracted-text hash and was not attached by the user's say-so against
//     a failed title / first-author check (`byo.asserted`);
//   - the open-access PDF Unpaywall lists for its DOI (SRC-03): an entry with
//     a DOI whose `oa_url` was recorded at ingest (open-access.ts, or
//     OpenAlex's open primary location).
// Nothing else counts: an arXiv id or a PMCID alone is not text Pass 3 can
// fetch, so such a source is paraphrased.
//
// Phase 18's source-context.ts `fullTextAvailable` delegates to this function
// at the Phase 18/19 merge, and its draft-containment.ts adds the
// `quote-without-full-text` violation from quotesWithoutFullText (19-PLAN §9),
// so write's single corrective turn enforces the policy. Pure: no I/O.

import { extractQuotes } from './quote-extractor.js';
import type { LibraryEntry } from './schemas/library.js';

export type FullTextSource = 'bring-your-own PDF' | 'open-access PDF';

type FullTextFields = Pick<LibraryEntry, 'byo' | 'oa_url' | 'doi'>;

/** Where a source's checkable full text comes from, or null when it has none (in the order above). */
export function fullTextSource(entry: FullTextFields): FullTextSource | null {
  if (entry.byo !== null && entry.byo.text_sha256 !== null && entry.byo.asserted !== true) return 'bring-your-own PDF';
  if (entry.oa_url && entry.doi) return 'open-access PDF';
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
