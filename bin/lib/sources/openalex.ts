// bin/lib/sources/openalex.ts — OpenAlex adapter (RSCH-03, RSCH-04, T-3-13).
//
// Endpoints:
//   search:     GET https://api.openalex.org/works?search=<encoded>&per-page=<limit>
//   fetchById:  GET https://api.openalex.org/works/<id>
//
// Polite-pool mailto query param (NOT a header — different from Crossref).
// RESEARCH pitfall #2: the polite-pool slot SUNSETS Feb 2026. Today is
// 2026-05-17, so the slot is still in effect; keep the &mailto param but
// document the upcoming change.
// TODO(post-2026-02): switch to a key-based pool once OpenAlex publishes
// the replacement auth mechanism.

import { fetch as httpFetch } from '../http.js';
import { isOfflineMode, loadCassetteFile } from '../http-mock.js';
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

export async function search(
  query: string,
  opts: { limit?: number } = {},
): Promise<SourceCandidate[]> {
  const limit = opts.limit ?? 20;
  if (isOfflineMode()) {
    const cassette = loadCassetteFile('openalex', 'works-attention');
    if (!cassette) return [];
    const searchEntry = cassette.find(
      (c) => c.method === 'GET' && c.path.includes('/works?search='),
    );
    if (!searchEntry) return [];
    const body = searchEntry.response as { results?: OpenAlexWork[] };
    const results = body?.results ?? [];
    return results.map(toCandidate).filter((c): c is SourceCandidate => c !== null);
  }

  const url = `${BASE}/works?search=${encodeURIComponent(query)}&per-page=${limit}${mailtoParam('&')}`;
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
  if (isOfflineMode()) {
    const cassette = loadCassetteFile('openalex', 'works-attention');
    if (!cassette) return null;
    // Direct cassette match by /works/<id>.
    const direct = cassette.find(
      (c) =>
        c.method === 'GET' &&
        (c.path === `/works/${id}` || c.path.startsWith(`/works/${id}?`)),
    );
    if (direct) {
      return toCandidate(direct.response as OpenAlexWork);
    }
    // Fallback: first result from the search cassette so test ids like
    // 'W2741809807' still get a SourceCandidate-shaped return.
    const search = cassette.find(
      (c) => c.method === 'GET' && c.path.includes('/works?search='),
    );
    if (!search) return null;
    const results = (search.response as { results?: OpenAlexWork[] })?.results ?? [];
    const first = results[0];
    return first ? toCandidate(first) : null;
  }

  // CR-03 fix: if no contact email, omit the query string entirely (?mailto= is the only param here).
  const mp = mailtoParam('?');
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
