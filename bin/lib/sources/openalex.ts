// bin/lib/sources/openalex.ts — OpenAlex adapter.
//
// Endpoints:
//   search:           GET https://api.openalex.org/works?search=<encoded>&per-page=<limit>
//   fetchById:        GET https://api.openalex.org/works/<id>
//   lookupRetraction: GET https://api.openalex.org/works/doi:<doi>?select=id,doi,title,is_retracted
//   lookupOaPdfs:     GET https://api.openalex.org/works/doi:<doi>?select=id,doi,best_oa_location,locations
//
// The contact email goes as a `mailto` query param (not a header, unlike
// Crossref), read when each URL is built and left out when
// PENSMITH_CONTACT_EMAIL is unset.

import { fetch as httpFetch } from '../http.js';
import { generateCitekey } from '../citekey.js';
import { displayName, parseDisplayName, presentNames } from '../author-normalize.js';
import { arxivFromDoi, arxivFromLink, bareArxivId, normalizePmcid, normalizePmid } from '../doi.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';
import { askOaPdfs, askSource, contactParam, definedFields, firstString, isGone, RETRACTION_STATUS_TTL_MS, type OaPdfAnswer } from './work-record.js';

const BASE = 'https://api.openalex.org';

/** The URL of the OpenAlex record of the work with `doi`, with only the `select`ed fields. */
const workByDoi = (doi: string, select: string): string =>
  `${BASE}/works/doi:${encodeURIComponent(doi)}?select=${select}${contactParam('mailto', '&')}`;

interface OpenAlexAuthor {
  author?: { display_name?: string };
}
interface OpenAlexWork {
  id?: string;
  doi?: string;
  title?: string;
  type?: string;
  publication_year?: number;
  authorships?: OpenAlexAuthor[];
  abstract_inverted_index?: Record<string, number[]>;
  ids?: { pmid?: string; pmcid?: string; arxiv?: string };
  biblio?: { volume?: string | null; issue?: string | null; first_page?: string | null; last_page?: string | null };
  primary_location?: { source?: { display_name?: string | null; type?: string | null; host_organization_name?: string | null } | null } | null;
}

/** OpenAlex work types as CSL types; an unlisted type is a generic document. */
const CSL_TYPE: Readonly<Record<string, string>> = {
  article: 'article-journal',
  review: 'article-journal',
  letter: 'article-journal',
  editorial: 'article-journal',
  preprint: 'article',
  book: 'book',
  'book-chapter': 'chapter',
  dissertation: 'thesis',
  dataset: 'dataset',
  report: 'report',
  standard: 'standard',
};

/** The PubMed or PMC ID an OpenAlex `ids` link names ("https://pubmed.ncbi.nlm.nih.gov/9500320"). */
function idFromLink(link: string | undefined, normalize: (s: string) => string | null): string | null {
  const last = (link ?? '').replace(/\/+$/, '').split('/').pop() ?? '';
  return normalize(last);
}

/** "637-641" from OpenAlex's first and last page. */
function pages(b: OpenAlexWork['biblio']): string | undefined {
  const first = firstString(b?.first_page);
  const last = firstString(b?.last_page);
  if (!first) return undefined;
  return last && last !== first ? `${first}-${last}` : first;
}

function normalizeDoi(doiUrl: string | undefined): string | undefined {
  if (!doiUrl) return undefined;
  return doiUrl.replace(/^https?:\/\/doi\.org\//i, '');
}

function toCandidate(item: OpenAlexWork): SourceCandidate | null {
  const id = item.id ?? normalizeDoi(item.doi);
  if (!id) return null;
  const title = String(item.title ?? '');
  if (!title) return null;

  // OpenAlex has display names only ("Ashish Vaswani"), split here.
  const names = presentNames((item.authorships ?? []).map((a) => parseDisplayName(String(a.author?.display_name ?? ''))));
  if (names.length === 0) return null;
  const authors = names.map(displayName);

  const year =
    typeof item.publication_year === 'number' &&
    item.publication_year >= 1800 &&
    item.publication_year <= 2100
      ? item.publication_year
      : undefined;

  const citekey = generateCitekey({ authors, year });
  const doi = normalizeDoi(item.doi);
  const arxiv = bareArxivId(arxivFromLink(item.ids?.arxiv ?? '')) ?? (doi ? arxivFromDoi(doi) : null);
  const venue = item.primary_location?.source;

  return {
    source: 'openalex',
    id,
    doi,
    title,
    authors,
    names,
    year,
    ...(arxiv ? { arxiv } : {}),
    csl_type: venue?.type === 'conference' ? 'paper-conference' : CSL_TYPE[item.type ?? ''] ?? 'document',
    ...definedFields({
      pmid: idFromLink(item.ids?.pmid, normalizePmid),
      pmcid: idFromLink(item.ids?.pmcid, normalizePmcid),
      container_title: venue?.type === 'repository' ? undefined : firstString(venue?.display_name),
      volume: firstString(item.biblio?.volume),
      issue: firstString(item.biblio?.issue),
      page: pages(item.biblio),
    }),
    retracted: false,
    last_verified: new Date().toISOString(),
    citekey,
    raw: item,
  };
}

export async function search(
  query: string,
  opts: { limit?: number } = {},
): Promise<SourceCandidate[]> {
  const limit = opts.limit ?? 20;
  const url = `${BASE}/works?search=${encodeURIComponent(query)}&per-page=${limit}${contactParam('mailto', '&')}`;
  try {
    const res = await httpFetch(url, { source: 'openalex' });
    if (res.status !== 200) return [];
    const body = typeof res.body === 'string' ? (JSON.parse(res.body) as unknown) : res.body;
    const results = ((body as { results?: OpenAlexWork[] })?.results) ?? [];
    return results.map(toCandidate).filter((c): c is SourceCandidate => c !== null);
  } catch {
    return [];
  }
}

export async function fetchById(id: string): Promise<SourceCandidate | null> {
  // CR-03 fix: if no contact email, omit the query string entirely (?mailto= is the only param here).
  const mp = contactParam('mailto', '?');
  const url = `${BASE}/works/${encodeURIComponent(id)}${mp}`;
  try {
    const res = await httpFetch(url, { source: 'openalex' });
    if (res.status !== 200) return null;
    const body = typeof res.body === 'string' ? (JSON.parse(res.body) as unknown) : res.body;
    return toCandidate(body as OpenAlexWork);
  } catch {
    return null;
  }
}

/** OpenAlex's answer to "is the work with this DOI retracted?". */
export type RetractionAnswer =
  | { kind: 'found'; retracted: boolean }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; detail: string };

/**
 * Ask OpenAlex whether the work with `doi` is retracted (its `is_retracted`,
 * which OpenAlex derives from Retraction Watch and the publishers' notices).
 * Pass 1 asks this as a cross-check when the registry record says nothing.
 * A 404 means OpenAlex does not hold the DOI; any other answer that is not a
 * readable 200 is unavailable, and says nothing either way.
 */
export function lookupRetraction(doi: string): Promise<RetractionAnswer> {
  return askSource<RetractionAnswer>(
    workByDoi(doi, 'id,doi,title,is_retracted'),
    { source: 'openalex', cacheTtlMs: RETRACTION_STATUS_TTL_MS },
    (res) => {
      if (isGone(res.status)) return { kind: 'not_found' };
      if (res.status !== 200) return null;
      const retracted = (JSON.parse(res.body) as { is_retracted?: unknown } | null)?.is_retracted;
      return typeof retracted === 'boolean' ? { kind: 'found', retracted } : null;
    },
    (detail) => ({ kind: 'unavailable', detail }),
  );
}

interface OpenAlexLocation {
  is_oa?: boolean;
  pdf_url?: unknown;
}

/**
 * The open-access PDFs OpenAlex lists for the work with `doi`: its best
 * open-access location first, then every other open-access location. OpenAlex
 * needs no contact email, so Pass 3 asks it first.
 */
export function lookupOaPdfs(doi: string): Promise<OaPdfAnswer> {
  return askOaPdfs<{ best_oa_location?: OpenAlexLocation | null; locations?: OpenAlexLocation[] }>(
    workByDoi(doi, 'id,doi,best_oa_location,locations'),
    { source: 'openalex' },
    (work) => [work.best_oa_location, ...(Array.isArray(work.locations) ? work.locations : [])]
      .filter((l) => l?.is_oa !== false)
      .map((l) => l?.pdf_url),
  );
}
