// bin/lib/verify/metadata-search.ts — Pass 1's metadata search for a citation
// that carries no identifier (Phase 20, VRFY-12, D-20-11).
//
// An entry with no DOI, arXiv id, PMID or ISBN (and no bring-your-own PDF of
// the user's) was FABRICATED without a single request before Phase 20. A real
// work cited without its identifier is not an invented one, so Pass 1 now
// asks the registrars to find it:
//   - Crossref's `query.bibliographic` with the title, the first author's
//     surname and the year (every entry);
//   - for a book (BibTeX @book), first the books registries' title search
//     (Open Library `title` + `author`).
// Only a STRICT match passes (the risk is a wrong work passing, 20-PLAN §10):
// title Jaro-Winkler ≥ STRICT_TITLE_JW (whole or without its subtitle), first
// author ≥ AUTHOR_JW_THRESHOLD, and the year within ±1 when both carry one
// (name-match.ts). The matched record's identifier is named in the row.
//
// Outcomes: `match` (OK, naming the identifier); `no-match` — every
// applicable search answered, and nothing in any answer matched strictly
// (UNRESOLVABLE, blocking: add the work's identifier); `no-answer` — a search
// that could have matched did not answer (UNVERIFIABLE-NETWORK: retry online,
// never UNRESOLVABLE). Offline, a search with no recorded fixture is a
// `no-answer` (RUN-03).

import { AUTHOR_JW_THRESHOLD } from '../fuzzy.js';
import { isOfflineEgressError, offlineLabel } from '../http.js';
import { sources } from '../sources/index.js';
import { plainText } from '../markup.js';
import { matchWork, surnameForms, STRICT_TITLE_JW, type ClaimedWork, type MatchResult } from './name-match.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';

export type MetadataSearchOutcome =
  | {
      readonly kind: 'match';
      readonly candidate: SourceCandidate;
      readonly match: MatchResult;
      /** The matched record's identifier, as a row names it (`DOI 10.…`, `ISBN 978…`). */
      readonly identifier: string;
      /** Which search found it (`Crossref`, `Open Library`). */
      readonly registrar: string;
    }
  | { readonly kind: 'no-match'; readonly reason: string }
  | { readonly kind: 'no-answer'; readonly reason: string };

/** The first author's surname as a search term (the display family, not folded). */
function authorTerm(claimed: ClaimedWork): string | null {
  const first = claimed.authors[0] ?? claimed.editors?.[0];
  if (first === undefined) return null;
  const s = first.replace(/[{}]/g, '').trim();
  const family = s.includes(',') ? (s.split(',')[0] ?? '').trim() : s;
  return family.length > 0 && surnameForms(first).length > 0 ? family : null;
}

/** The free-form citation Crossref's `query.bibliographic` is asked with: title, first author, year. */
export function bibliographicQuery(claimed: ClaimedWork): string {
  return [plainText(claimed.title).trim(), authorTerm(claimed), claimed.year !== null ? String(claimed.year) : null]
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .join(' ');
}

/** The identifier a matched record is named by. */
function identifierOf(c: SourceCandidate): string | null {
  if (c.doi) return `DOI ${c.doi}`;
  if (c.isbn) return `ISBN ${c.isbn}`;
  if (c.arxiv) return `arXiv:${c.arxiv}`;
  if (c.pmid) return `PMID ${c.pmid}`;
  return null;
}

/** The best strict match among `candidates`, or null. */
function bestStrictMatch(claimed: ClaimedWork, candidates: readonly SourceCandidate[]): { candidate: SourceCandidate; match: MatchResult } | null {
  let best: { candidate: SourceCandidate; match: MatchResult } | null = null;
  for (const c of candidates) {
    if (identifierOf(c) === null) continue;
    const match = matchWork(claimed, c, { titleThreshold: STRICT_TITLE_JW, authorThreshold: AUTHOR_JW_THRESHOLD });
    if (!match.ok) continue;
    if (best === null || match.titleJW + match.authorJW > best.match.titleJW + best.match.authorJW) best = { candidate: c, match };
  }
  return best;
}

type SearchAnswer = { kind: 'ok'; candidates: SourceCandidate[] } | { kind: 'failed'; reason: string };

async function asked(run: () => Promise<SearchAnswer>, who: string): Promise<SearchAnswer> {
  try {
    return await run();
  } catch (err) {
    if (isOfflineEgressError(err)) {
      return { kind: 'failed', reason: `${offlineLabel(err)}: no recorded fixture for the ${who} search — re-run online` };
    }
    throw err;
  }
}

/**
 * Search the registrars for the work `claimed` describes (see the header).
 * `isBook` adds the books registries' title search (first). `refresh` skips
 * the HTTP-cache read (VRFY-28).
 */
export async function metadataSearch(claimed: ClaimedWork, opts: { isBook?: boolean; refresh?: boolean } = {}): Promise<MetadataSearchOutcome> {
  const refresh = opts.refresh === true ? { refresh: true } : {};
  const searches: Array<{ who: string; run: () => Promise<SearchAnswer> }> = [];
  if (opts.isBook === true) {
    searches.push({ who: 'Open Library', run: () => sources.books.searchTitle(plainText(claimed.title), authorTerm(claimed), refresh) });
  }
  searches.push({ who: 'Crossref', run: () => sources.crossref.searchBibliographic(bibliographicQuery(claimed), refresh) });

  const failures: string[] = [];
  const empties: string[] = [];
  for (const s of searches) {
    const answer = await asked(s.run, s.who);
    if (answer.kind === 'failed') {
      failures.push(`${s.who}: ${answer.reason}`);
      continue;
    }
    const best = bestStrictMatch(claimed, answer.candidates);
    if (best !== null) {
      return { kind: 'match', candidate: best.candidate, match: best.match, identifier: identifierOf(best.candidate) as string, registrar: s.who };
    }
    empties.push(`${s.who}: ${answer.candidates.length === 0 ? 'no record' : `none of its ${answer.candidates.length} closest record(s) matches strictly`}`);
  }
  if (failures.length > 0) {
    return { kind: 'no-answer', reason: `the metadata search did not answer (${failures.join('; ')})${empties.length > 0 ? `; ${empties.join('; ')}` : ''}` };
  }
  return { kind: 'no-match', reason: `no registrar record matches its title, first author and year (${empties.join('; ')})` };
}
