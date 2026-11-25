// bin/lib/sources/openalex.ts — OpenAlex adapter (RSCH-03, RSCH-04, T-3-13).
//
// Endpoints:
//   search:           GET https://api.openalex.org/works?search=<encoded>&per-page=<limit>
//   fetchById:        GET https://api.openalex.org/works/<id>
//   lookupRetraction: GET https://api.openalex.org/works/doi:<doi>?select=id,doi,title,is_retracted
//   lookupOaPdfs:     GET https://api.openalex.org/works/doi:<doi>?select=id,doi,best_oa_location,locations
//
// Polite-pool mailto query param (NOT a header — different from Crossref).
// RESEARCH pitfall #2: the polite-pool slot SUNSETS Feb 2026. Today is
// 2026-05-17, so the slot is still in effect; keep the &mailto param but
// document the upcoming change.
// TODO(post-2026-02): switch to a key-based pool once OpenAlex publishes
// the replacement auth mechanism.

import { fetch as httpFetch } from '../http.js';
import { generateCitekey } from '../citekey.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';
import { askSource, contactParam, httpLinks, isGone, RETRACTION_STATUS_TTL_MS, type OaPdfAnswer } from './work-record.js';

const BASE = 'https://api.openalex.org';

// CR-03 fix: the contact email is read lazily at URL-build time. When
// PENSMITH_CONTACT_EMAIL is unset, contactParam OMITS the mailto param
// entirely — http.ts:166 documents the no-contact degradation banner.

interface OpenAlexAuthor {
  author?: { display_name?: string };
}
interface OpenAlexWork {
  id?: string;
  doi?: string;
  title?: string;
  publication_year?: number;
  authorships?: OpenAlexAuthor[];
  abstract_inverted_index?: Record<string, number[]>;
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

  // OpenAlex emits "Given Family" display names. We keep them as-is —
  // bin/lib/author-normalize.ts handles given-first form.
  const authors = (item.authorships ?? [])
    .map((a) => String(a.author?.display_name ?? '').trim())
    .filter(Boolean);
  if (authors.length === 0) return null;

  const year =
    typeof item.publication_year === 'number' &&
    item.publication_year >= 1800 &&
    item.publication_year <= 2100
      ? item.publication_year
      : undefined;

  const base: Partial<SourceCandidate> = { authors, year };
  const citekey = generateCitekey(base);
  const doi = normalizeDoi(item.doi);

  return {
    source: 'openalex',
    id,
    doi,
    title,
    authors,
    year,
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
  const url = `${BASE}/works/doi:${encodeURIComponent(doi)}?select=id,doi,title,is_retracted${contactParam('mailto', '&')}`;
  return askSource<RetractionAnswer>(
    url,
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
  const url = `${BASE}/works/doi:${encodeURIComponent(doi)}?select=id,doi,best_oa_location,locations${contactParam('mailto', '&')}`;
  return askSource<OaPdfAnswer>(
    url,
    { source: 'openalex' },
    (res) => {
      if (isGone(res.status)) return { kind: 'not_found' };
      if (res.status !== 200) return null;
      const work = JSON.parse(res.body) as { best_oa_location?: OpenAlexLocation | null; locations?: OpenAlexLocation[] } | null;
      if (!work || typeof work !== 'object') return null;
      const locations = [work.best_oa_location, ...(Array.isArray(work.locations) ? work.locations : [])];
      return { kind: 'found', urls: httpLinks(locations.filter((l) => l?.is_oa !== false).map((l) => l?.pdf_url)) };
    },
    (detail) => ({ kind: 'unavailable', detail }),
  );
}
