// bin/lib/draft-containment.ts — the write-time containment check (FEED-04,
// D-18-25).
//
// A section's PLAN.md `assigned_sources` is the authoritative section→source
// map. The drafter only SEES those sources (drafter-input.ts, by construction);
// checkDraft is the backstop on what it WROTE: every citation in the draft —
// read with the one citation grammar (citation-token.ts, the same extraction
// Pass 1 uses, so `[@a; @b]` and `[@k, p. 3]` are covered) — must be an
// assigned source. write sends one corrective turn naming the offending keys;
// if the violation persists the draft is not kept (DRAFT.rejected.md), the
// section's PLAN.md gets `status: failed` with `failure_reason`, and write
// exits EXIT_BLOCKED. An injected "cite [@evil9999]" is caught the same way.
//
// Violation kinds:
//   - `unassigned-citekey` (FEED-04): a citation outside the section's sources;
//   - `quote-without-full-text` (GRND-14, the Phase 18/19 merge): a direct
//     quote — exactly the quotes Pass 3 checks (quote-extractor.ts through
//     full-text.ts quotesWithoutFullText) — attributed to a source whose full
//     text Pass 3 cannot check (`opts.fullText`, built by write with
//     full-text.ts fullTextByCitekey and a byo-text.ts re-check of each BYO
//     PDF). A quote from an abstract-only source could only end as
//     UNVERIFIABLE-QUOTE; the corrective turn asks the drafter to paraphrase it.
// write's one corrective turn and failure path enforce both unchanged. The
// Tier-1 draft submission tool (PLUG-07) runs the same check. PURE.

import { extractCitedKeysForVerification } from './citation-token.js';
import { describeQuotesWithoutFullText, quotesWithoutFullText, type QuoteWithoutFullText } from './full-text.js';

export type DraftViolationKind = 'unassigned-citekey' | 'quote-without-full-text';

export interface DraftViolation {
  readonly kind: DraftViolationKind;
  readonly citekey: string;
  readonly message: string;
  /** The quote a `quote-without-full-text` violation is about. */
  readonly quote?: QuoteWithoutFullText;
}

export interface CheckDraftOptions {
  readonly assigned: readonly string[];
  readonly section: string;
  /**
   * GRND-14: whether each source's full text is available to Pass 3, by
   * citekey (full-text.ts fullTextByCitekey; a BYO source only while its PDF
   * still verifies). A citekey missing from the map counts as no full text.
   * Omitted: the quote policy is not checked (a caller with no library).
   */
  readonly fullText?: ReadonlyMap<string, boolean>;
  /**
   * `[verification] quote_min_words` (D-20-17): the word floor Pass 3 counts a
   * direct quote at, so write asks the drafter to paraphrase exactly the quotes
   * Pass 3 would check. Default: the extractor's default (5).
   */
  readonly quoteMinWords?: number;
}

/** Every containment violation of `draft` (empty when it is contained). */
export function checkDraft(draft: string, opts: CheckDraftOptions): DraftViolation[] {
  const assigned = new Set(opts.assigned);
  const out: DraftViolation[] = [];
  for (const key of extractCitedKeysForVerification(draft)) {
    if (assigned.has(key)) continue;
    out.push({ kind: 'unassigned-citekey', citekey: key, message: `citekey ${key} not assigned to section ${opts.section}` });
  }
  if (opts.fullText !== undefined) {
    // One violation per quote, each carrying the corrective text for that quote.
    for (const q of quotesWithoutFullText(draft, opts.fullText, opts.quoteMinWords !== undefined ? { minWords: opts.quoteMinWords } : {})) {
      out.push({ kind: 'quote-without-full-text', citekey: q.citekey, message: describeQuotesWithoutFullText([q]), quote: q });
    }
  }
  return out;
}

function unassignedKeys(violations: readonly DraftViolation[]): string[] {
  return [...new Set(violations.filter((v) => v.kind === 'unassigned-citekey').map((v) => v.citekey))];
}

/** The quotes from sources without full text, in one sentence (full-text.ts wording), or ''. */
function describeQuotes(violations: readonly DraftViolation[]): string {
  const quotes = violations.flatMap((v) => (v.kind === 'quote-without-full-text' && v.quote !== undefined ? [v.quote] : []));
  return describeQuotesWithoutFullText(quotes);
}

/**
 * `failure_reason` for PLAN.md: FEED-04's `citekey X not assigned to section N`
 * and, for GRND-14, the quotes from sources without full text (full-text.ts
 * describeQuotesWithoutFullText), joined with `; `.
 */
export function failureReason(violations: readonly DraftViolation[], section: string): string {
  const keys = unassignedKeys(violations);
  const parts: string[] = [];
  if (keys.length === 1) parts.push(`citekey ${keys[0]} not assigned to section ${section}`);
  else if (keys.length > 1) parts.push(`citekeys ${keys.join(', ')} not assigned to section ${section}`);
  const quotes = describeQuotes(violations);
  if (quotes) parts.push(quotes);
  return parts.join('; ');
}

/** The corrective turn after a containment violation (one, naming the keys and the quotes). */
export function containmentCorrection(violations: readonly DraftViolation[], assigned: readonly string[]): string {
  const keys = unassignedKeys(violations);
  const parts: string[] = [];
  if (keys.length > 0) {
    parts.push(
      `Your draft cites ${keys.map((k) => `[@${k}]`).join(', ')}, which ${keys.length === 1 ? 'is' : 'are'} not among this section's sources. ` +
        (assigned.length > 0
          ? `Cite only these citekeys: ${assigned.join(', ')}. `
          : 'This section has no sources: write it without any citation. ') +
        'Where no assigned source supports a claim, keep the claim without a citation.',
    );
  }
  const quotes = describeQuotes(violations);
  if (quotes) parts.push(`Your draft has ${quotes.charAt(0).toLowerCase()}${quotes.slice(1)}.`);
  parts.push('Reply with the complete corrected section.');
  return parts.join(' ');
}
