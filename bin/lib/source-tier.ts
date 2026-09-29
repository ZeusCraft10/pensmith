// bin/lib/source-tier.ts — a source's evaluator tier from its metadata
// (SRC-09, D-19-16; PRD §7.2 tiers: peer-reviewed / preprint / book /
// gov-report / other).
//
// The tier is derived DETERMINISTICALLY wherever the registrar's metadata
// decides it, and only otherwise taken from the source-evaluator model (the
// tie-breaker). The deterministic tier also travels to the model as each
// candidate's `tier_hint`, and it wins over the model's answer: a Crossref
// `journal-article` stays peer-reviewed whatever a model says.
//
// Rules, first match wins:
//   1. a preprint-server DOI (arXiv DataCite, bioRxiv, SSRN, …), a `preprint`
//      type, or an arXiv record with no version-of-record DOI → preprint;
//   2. `book` / `chapter`, or an ISBN on a work that is not an article → book;
//   3. a `report` (or an untyped, venue-less work) from a government publisher
//      or a government web domain (`.gov`, `.gov.<cc>`, `.gouv.<cc>`,
//      `.gob.<cc>`, `.gc.ca`, `europa.eu`) → gov-report;
//   4. `article-journal` / `paper-conference`, or a PubMed record (MEDLINE
//      journals) → peer-reviewed;
//   5. newspaper / magazine articles, web pages, theses, datasets → other;
//   6. anything else (an untyped work, a non-government report such as a
//      working paper) → null: the evaluator decides.
//
// Pure: no fs, no network.

import type { SourceTier } from './schemas/source-types.js';
import { isPreprintDoi, normArxiv, normDoi, normIsbn } from './migrations/library/shape.js';

/** The metadata the tier rules read (a SourceCandidate or a LIBRARY entry satisfies it). */
export interface TierInput {
  readonly source?: string | undefined;
  readonly type?: string | null | undefined;
  readonly doi?: string | null | undefined;
  readonly arxiv?: string | null | undefined;
  readonly isbn?: string | null | undefined;
  readonly venue?: string | null | undefined;
  readonly publisher?: string | null | undefined;
  readonly id?: string | undefined;
  readonly oa_pdf_url?: string | null | undefined;
  readonly oa_url?: string | null | undefined;
}

/** Publisher names that identify a government body. */
const GOV_PUBLISHER =
  /\b(?:government|governmental|ministry|ministerie|ministère|ministerio|parliament(?:ary)?|congress(?:ional)?|senate|house of (?:commons|lords|representatives)|white house|cabinet office|department (?:of|for) (?:health|education|energy|defen[cs]e|state|justice|labou?r|commerce|agriculture|transportation|the (?:interior|treasury)|homeland)|office (?:of|for) national statistics|national institutes? of health|national audit office|bureau of (?:labor|justice) statistics|census bureau|bureau of the census|(?:congressional budget|government accountability) office|environmental protection agency|food and drug administration|centers for disease control|european (?:commission|parliament|union)|world health organization|united nations|oecd)\b/i;

/** A host on a government domain. */
const GOV_HOST = /(?:^|\.)(?:gov|mil)$|(?:^|\.)(?:gov|gouv|gob|go|govt)\.[a-z]{2}$|(?:^|\.)gc\.ca$|(?:^|\.)europa\.eu$/i;

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** True when the work's publisher or a URL it carries is a government one. */
export function isGovernmentSource(c: TierInput): boolean {
  if (c.publisher && GOV_PUBLISHER.test(c.publisher)) return true;
  for (const u of [c.oa_pdf_url, c.oa_url, c.id]) {
    const host = hostOf(u);
    if (host && GOV_HOST.test(host)) return true;
  }
  return false;
}

const ARTICLE_TYPES: ReadonlySet<string> = new Set(['article-journal', 'paper-conference']);
const OTHER_TYPES: ReadonlySet<string> = new Set(['article-newspaper', 'article-magazine', 'webpage', 'thesis', 'dataset']);

/**
 * The tier the metadata decides, or null when only a judgment can (the
 * evaluator's tier then applies). Deterministic.
 */
export function deterministicTier(c: TierInput): SourceTier | null {
  const type = typeof c.type === 'string' ? c.type : null;
  const doi = normDoi(c.doi);
  const arxiv = normArxiv(c.arxiv) ?? (c.source === 'arxiv' ? normArxiv(c.id) : null);
  const isbn = normIsbn(c.isbn);
  const venue = typeof c.venue === 'string' && c.venue.trim().length > 0 ? c.venue.trim() : null;

  // 1. Preprints: a preprint server's DOI, the preprint type, or an arXiv
  //    record that no version-of-record DOI accompanies.
  if (isPreprintDoi(doi) || type === 'preprint') return 'preprint';
  if (arxiv !== null && (doi === null || isPreprintDoi(doi)) && (type === null || type === 'preprint')) return 'preprint';

  // 2. Books and chapters (an ISBN on something that is not an article).
  if (type === 'book' || type === 'chapter') return 'book';
  if (isbn !== null && (type === null || !ARTICLE_TYPES.has(type)) && type !== 'report') return 'book';

  // 3. Government reports.
  if (type === 'report' && isGovernmentSource(c)) return 'gov-report';
  if (type === null && venue === null && isGovernmentSource(c)) return 'gov-report';

  // 4. Peer-reviewed venues.
  if (type !== null && ARTICLE_TYPES.has(type)) return 'peer-reviewed';
  if (type === null && c.source === 'pubmed' && venue !== null) return 'peer-reviewed';

  // 5. Clearly not scholarly literature.
  if (type !== null && OTHER_TYPES.has(type)) return 'other';

  // 6. A judgment call (an untyped record, a non-government report).
  return null;
}
