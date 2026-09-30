// bin/lib/verify/metadata-search.ts — Pass 1's metadata search for a citation
// that carries no identifier (Phase 20, VRFY-12, D-20-11).
//
// An entry with no DOI, arXiv id, PMID or ISBN (and no bring-your-own PDF of
// the user's) was FABRICATED without a single request before Phase 20. A real
// work cited without its identifier is not an invented one, so Pass 1 asks
// the registrars to find it, in this order, stopping at the first strict
// match:
//   - for a book (BibTeX @book), the books registries' title search (Open
//     Library `title` + `author`; a title with a subtitle is asked by its main
//     title — Open Library keeps the subtitle apart and finds nothing for the
//     two joined — and its answers carry the subtitle again);
//   - Crossref's `query.bibliographic` with the title, the first author's
//     surname and the year (every entry);
//   - arXiv's API (`ti:"<title>" AND au:<surname>`): conference papers
//     (NeurIPS, ICLR, ICML) that were never deposited with Crossref;
//   - PubMed's esearch (`"<title>"[ti] AND <surname>[au]`);
//   - DataCite's title search (datasets, software, reports, theses);
//   - OpenAlex's search (journals no registrar holds a DOI for — JMLR, PMLR
//     proceedings): an OpenAlex record with a DOI Crossref knows is replaced
//     by Crossref's own record of it when that is the same work
//     (registrar-confirm.ts); without a DOI the row names its OpenAlex id.
// Only a STRICT match passes (the risk is a wrong work passing, 20-PLAN §10):
// title Jaro-Winkler ≥ STRICT_TITLE_JW with the claimed title compared WHOLE
// (a record titled "Introduction" never matches "Introduction: …"), first
// author ≥ AUTHOR_JW_THRESHOLD, and the year within ±1 when both carry one
// (name-match.ts). The matched record's identifier is named in the row.
//
// Outcomes: `match` (OK, naming the identifier); `no-match` — every search
// answered, and nothing in any answer matched strictly (UNRESOLVABLE,
// blocking: add the work's identifier or its PDF); `no-answer` — a search
// that could have matched did not answer (UNVERIFIABLE-NETWORK: retry online,
// never UNRESOLVABLE). Offline, a search with no recorded fixture is a
// `no-answer` (RUN-03).

import { AUTHOR_JW_THRESHOLD } from '../fuzzy.js';
import { isOfflineEgressError, offlineLabel } from '../http.js';
import { sources } from '../sources/index.js';
import { plainText } from '../markup.js';
import { mainTitle, matchWork, surnameForms, STRICT_TITLE_JW, type ClaimedWork, type MatchResult } from './name-match.js';
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
  const w = c.source === 'openalex' ? /(W\d+)$/i.exec(c.id)?.[1] : undefined;
  if (w !== undefined) return `OpenAlex ${w.toUpperCase()}`;
  return null;
}

/** The best strict match among `candidates`, or null (the claimed title always compared whole). */
function bestStrictMatch(claimed: ClaimedWork, candidates: readonly SourceCandidate[]): { candidate: SourceCandidate; match: MatchResult } | null {
  let best: { candidate: SourceCandidate; match: MatchResult } | null = null;
  for (const c of candidates) {
    if (identifierOf(c) === null) continue;
    const match = matchWork(claimed, c, { titleThreshold: STRICT_TITLE_JW, authorThreshold: AUTHOR_JW_THRESHOLD, strictTitle: true });
    if (!match.ok) continue;
    if (best === null || match.titleJW + match.authorJW > best.match.titleJW + best.match.authorJW) best = { candidate: c, match };
  }
  return best;
}

/** The title as a search phrase: plain text, no quotation marks or brackets. */
function titlePhrase(title: string): string {
  return plainText(title)
    .replace(/["“”„«»[\]()]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** arXiv's query for the work: the title as a phrase, and the first author's surname (exported: the exact recorded request). */
export function arxivTitleQuery(claimed: ClaimedWork): string {
  const t = titlePhrase(claimed.title).replace(/[^\p{L}\p{N}\s-]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const who = authorTerm(claimed);
  return [`ti:"${t}"`, ...(who !== null ? [`au:${who.replace(/[^\p{L}\p{N}-]+/gu, '_')}`] : [])].join(' AND ');
}

/** PubMed's query for the work: the title as a [ti] phrase, and the first author's surname as [au] (exported: the exact recorded request). */
export function pubmedTitleQuery(claimed: ClaimedWork): string {
  const t = titlePhrase(claimed.title).replace(/[^\p{L}\p{N}\s-]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const who = authorTerm(claimed);
  return [`"${t}"[ti]`, ...(who !== null ? [`${who}[au]`] : [])].join(' AND ');
}

/** The number of records each search asks for. */
export const SEARCH_ROWS = 5;

/** An adapter search that reports its failure through `onFailure` (arXiv, PubMed, OpenAlex). */
async function viaSearch(run: (onFailure: (reason: string) => void) => Promise<SourceCandidate[]>): Promise<SearchAnswer> {
  let failure: string | null = null;
  const candidates = await run((reason) => {
    failure ??= reason;
  });
  return failure !== null ? { kind: 'failed', reason: failure } : { kind: 'ok', candidates };
}

/**
 * An OpenAlex match with a DOI: Crossref's own record of the DOI decides
 * (research's rule, registrar-confirm.ts) — it must match the claimed work
 * strictly too; a DOI Crossref does not know (DataCite's) keeps OpenAlex's
 * record; no answer from Crossref is no answer.
 */
async function confirmedAtCrossref(
  claimed: ClaimedWork,
  best: { candidate: SourceCandidate; match: MatchResult },
  refresh: { refresh?: boolean },
): Promise<{ kind: 'match'; candidate: SourceCandidate; match: MatchResult; confirmed: boolean } | { kind: 'mismatch' } | { kind: 'failed'; reason: string }> {
  const c = best.candidate;
  if (c.source !== 'openalex' || typeof c.doi !== 'string' || c.doi.trim() === '') return { kind: 'match', ...best, confirmed: false };
  const r = await sources.crossref.lookupById(c.doi, refresh);
  if (r.kind === 'failed') return { kind: 'failed', reason: `Crossref re-fetch of ${c.doi}: ${r.reason}` };
  if (r.kind === 'not-found') return { kind: 'match', ...best, confirmed: false };
  const match = matchWork(claimed, r.candidate, { titleThreshold: STRICT_TITLE_JW, authorThreshold: AUTHOR_JW_THRESHOLD, strictTitle: true });
  return match.ok ? { kind: 'match', candidate: r.candidate, match, confirmed: true } : { kind: 'mismatch' };
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
    // Open Library keeps a subtitle apart: ask by the main title (its answers carry the subtitle again).
    const title = plainText(claimed.title);
    searches.push({ who: 'Open Library', run: () => sources.books.searchTitle(mainTitle(title) ?? title, authorTerm(claimed), refresh) });
  }
  searches.push({ who: 'Crossref', run: () => sources.crossref.searchBibliographic(bibliographicQuery(claimed), refresh) });
  searches.push({ who: 'arXiv', run: () => viaSearch((onFailure) => sources.arxiv.search(arxivTitleQuery(claimed), { limit: SEARCH_ROWS, onFailure })) });
  searches.push({ who: 'PubMed', run: () => viaSearch((onFailure) => sources.pubmed.search(pubmedTitleQuery(claimed), { limit: SEARCH_ROWS, onFailure })) });
  searches.push({ who: 'DataCite', run: () => sources.datacite.searchTitle(claimed.title, refresh) });
  searches.push({ who: 'OpenAlex', run: () => viaSearch((onFailure) => sources.openalex.search(titlePhrase(claimed.title), { limit: SEARCH_ROWS, onFailure })) });

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
      // An aggregator's DOI: the registrar's own record decides.
      let confirmed: Awaited<ReturnType<typeof confirmedAtCrossref>>;
      try {
        confirmed = await confirmedAtCrossref(claimed, best, refresh);
      } catch (err) {
        if (!isOfflineEgressError(err)) throw err;
        confirmed = { kind: 'failed', reason: `${offlineLabel(err)}: no recorded fixture for the Crossref re-fetch of ${best.candidate.doi ?? ''} — re-run online` };
      }
      if (confirmed.kind === 'failed') {
        failures.push(`${s.who}: ${confirmed.reason}`);
        continue;
      }
      if (confirmed.kind === 'match') {
        return {
          kind: 'match',
          candidate: confirmed.candidate,
          match: confirmed.match,
          identifier: identifierOf(confirmed.candidate) as string,
          registrar: confirmed.confirmed ? `${s.who}, confirmed at Crossref` : s.who,
        };
      }
      empties.push(`${s.who}: its closest record's DOI names another work at Crossref`);
      continue;
    }
    empties.push(`${s.who}: ${answer.candidates.length === 0 ? 'no record' : `none of its ${answer.candidates.length} closest record(s) matches strictly`}`);
  }
  if (failures.length > 0) {
    return { kind: 'no-answer', reason: `the metadata search did not answer (${failures.join('; ')})${empties.length > 0 ? `; ${empties.join('; ')}` : ''}` };
  }
  return { kind: 'no-match', reason: `no registrar record matches its title, first author and year (${empties.join('; ')})` };
}
