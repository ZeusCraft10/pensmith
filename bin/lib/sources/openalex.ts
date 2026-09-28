// bin/lib/sources/openalex.ts — OpenAlex adapter (RSCH-03, RSCH-04, T-3-13).
//
// Endpoints:
//   search:     GET https://api.openalex.org/works?search=<encoded>&per-page=<limit>
//   fetchById:  GET https://api.openalex.org/works/<id>
//
// Polite-pool mailto query param (NOT a header — different from Crossref).
// RESEARCH pitfall #2: OpenAlex's keyless budget is now shared per IP; a keyed
// pool is the adapter's future (tracked outside Phase 17). The mailto param is
// scrubbed from recorded fixtures and never decides a fixture match (D-17-06).
//
// `select=` keeps responses to the fields toCandidate reads. Offline replay is
// the exact-match fixture store inside bin/lib/http.ts; the typed
// OfflineEgressError is rethrown so callers can report "unavailable (offline)".

import { fetch as httpFetch, isOfflineEgressError, MAX_JSON_RESPONSE_BYTES } from '../http.js';
import { errorFailureReason, httpFailureReason, type SearchOptions } from './search-failure.js';
import { generateCitekey } from '../citekey.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';

const BASE = 'https://api.openalex.org';

// CR-03 fix: read contact email lazily at URL-build time. When
// PENSMITH_CONTACT_EMAIL is unset, OMIT the &mailto param entirely —
// http.ts:166 documents the no-contact degradation banner.
function mailtoParam(prefix: '&' | '?' = '&'): string {
  const email = process.env['PENSMITH_CONTACT_EMAIL']?.trim();
  return email ? `${prefix}mailto=${encodeURIComponent(email)}` : '';
}

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

/** The OpenAlex fields toCandidate reads. */
const SELECT = 'id,doi,title,publication_year,authorships';

export async function search(
  query: string,
  opts: SearchOptions = {},
): Promise<SourceCandidate[]> {
  const limit = opts.limit ?? 20;
  const url = `${BASE}/works?search=${encodeURIComponent(query)}&per-page=${limit}&select=${encodeURIComponent(SELECT)}${mailtoParam('&')}`;
  try {
    const res = await httpFetch(url, { source: 'openalex', maxBytes: MAX_JSON_RESPONSE_BYTES });
    if (res.status !== 200) {
      opts.onFailure?.(httpFailureReason(res.status));
      return [];
    }
    const body = JSON.parse(res.body) as unknown;
    const results = ((body as { results?: OpenAlexWork[] })?.results) ?? [];
    return results.map(toCandidate).filter((c): c is SourceCandidate => c !== null);
  } catch (err) {
    if (isOfflineEgressError(err)) throw err;
    opts.onFailure?.(errorFailureReason(err));
    return [];
  }
}

export async function fetchById(id: string): Promise<SourceCandidate | null> {
  const url = `${BASE}/works/${encodeURIComponent(id)}?select=${encodeURIComponent(SELECT)}${mailtoParam('&')}`;
  try {
    const res = await httpFetch(url, { source: 'openalex', maxBytes: MAX_JSON_RESPONSE_BYTES });
    if (res.status !== 200) return null;
    const body = JSON.parse(res.body) as unknown;
    return toCandidate(body as OpenAlexWork);
  } catch (err) {
    if (isOfflineEgressError(err)) throw err;
    return null;
  }
}
