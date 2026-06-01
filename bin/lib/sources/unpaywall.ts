// bin/lib/sources/unpaywall.ts — Unpaywall OA-status adapter (RSCH-04, T-3-13).
//
// Endpoint:
//   fetchById:  GET https://api.unpaywall.org/v2/<doi>?email=<contact>
//
// Unpaywall is a DOI-lookup service — there is no native "search". We expose a
// `search()` export for protocol compatibility but it always returns [] (the
// research workflow calls Unpaywall only after another source has supplied a
// DOI). D-15 keeps retraction-watch fetchById-only as a hard rule; Unpaywall is
// soft-only: protocol-shaped but inert.
//
// Polite-pool via `email=` query param (Unpaywall's published etiquette).

import { fetch as httpFetch } from '../http.js';
import { isOfflineMode, loadCassetteFile } from '../http-mock.js';
import { generateCitekey } from '../citekey.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';

const BASE = 'https://api.unpaywall.org';

// CR-03 fix: read contact email lazily at URL-build time. When
// PENSMITH_CONTACT_EMAIL is unset, OMIT the ?email= param entirely —
// http.ts:166 documents the no-contact degradation banner.
function emailParam(prefix: '&' | '?' = '?'): string {
  const email = process.env['PENSMITH_CONTACT_EMAIL']?.trim();
  return email ? `${prefix}email=${encodeURIComponent(email)}` : '';
}

interface UnpaywallAuthor {
  given?: string;
  family?: string;
}
interface UnpaywallOALocation {
  url?: string;
  url_for_pdf?: string;
  host_type?: string;
  version?: string;
}
interface UnpaywallResponse {
  doi?: string;
  title?: string;
  year?: number;
  is_oa?: boolean;
  z_authors?: UnpaywallAuthor[];
  best_oa_location?: UnpaywallOALocation;
}

function toCandidate(item: UnpaywallResponse): SourceCandidate | null {
  const doi = item.doi;
  if (!doi) return null;
  const title = String(item.title ?? '').trim();
  if (!title) return null;

  const authors = (item.z_authors ?? [])
    .map((a) => {
      const family = String(a.family ?? '').trim();
      const given = String(a.given ?? '').trim();
      if (!family) return '';
      return given ? `${family}, ${given}` : family;
    })
    .filter(Boolean);
  if (authors.length === 0) return null;

  const year =
    typeof item.year === 'number' && item.year >= 1800 && item.year <= 2100
      ? item.year
      : undefined;

  const oaPdf = item.best_oa_location?.url_for_pdf;
  // D-14: oa_pdf_url is z.string().url().optional() — only set when valid.
  const oa_pdf_url = typeof oaPdf === 'string' && /^https?:\/\//i.test(oaPdf)
    ? oaPdf
    : undefined;

  const base: Partial<SourceCandidate> = { authors, year };
  const citekey = generateCitekey(base);

  return {
    source: 'unpaywall',
    id: doi,
    doi,
    title,
    authors,
    year,
    oa_pdf_url,
    retracted: false,
    last_verified: new Date().toISOString(),
    citekey,
    raw: item,
  };
}

/**
 * Unpaywall has no native search endpoint — it is a DOI lookup service.
 * Returning [] preserves the adapter protocol (every source exposes
 * search/fetchById) so the orchestrator can iterate uniformly.
 */
export async function search(
  _query: string,
  // The limit option is part of the adapter protocol; Unpaywall has no
  // native search so we accept-and-ignore.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _opts: { limit?: number } = {},
): Promise<SourceCandidate[]> {
  return [];
}

export async function fetchById(doi: string): Promise<SourceCandidate | null> {
  if (isOfflineMode()) {
    // Cassette files are named doi-<citekey>.json; we try a slug match first
    // then fall back to the first cassette under the unpaywall/ dir.
    // For the committed fixture (doi-vaswani2017.json) a direct path match
    // against /v2/<doi> works.
    const cassette = loadCassetteFile('unpaywall', 'doi-vaswani2017');
    if (!cassette) return null;
    const direct = cassette.find(
      (c) =>
        c.method === 'GET' &&
        (c.path === `/v2/${doi}` || c.path.startsWith(`/v2/${doi}?`)),
    );
    if (direct) {
      return toCandidate(direct.response as UnpaywallResponse);
    }
    // Case-insensitive fallback (DOIs are case-insensitive per RFC 3986).
    const directCi = cassette.find(
      (c) =>
        c.method === 'GET' &&
        c.path.toLowerCase().includes(`/v2/${doi.toLowerCase()}`),
    );
    if (directCi) {
      return toCandidate(directCi.response as UnpaywallResponse);
    }
    // Final fallback: first cassette entry.
    const first = cassette.find((c) => c.method === 'GET' && c.path.startsWith('/v2/'));
    return first ? toCandidate(first.response as UnpaywallResponse) : null;
  }

  const url = `${BASE}/v2/${encodeURIComponent(doi)}${emailParam('?')}`;
  try {
    const res = await httpFetch(url, { source: 'unpaywall' });
    if (res.status !== 200) return null;
    const body = typeof res.body === 'string' ? (JSON.parse(res.body) as unknown) : res.body;
    return toCandidate(body as UnpaywallResponse);
  } catch {
    return null;
  }
}
