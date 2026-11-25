// bin/lib/sources/unpaywall.ts — Unpaywall OA-status adapter (RSCH-04, T-3-13).
//
// Endpoint:
//   fetchById, lookupOaPdfs:  GET https://api.unpaywall.org/v2/<doi>?email=<contact>
//
// Unpaywall refuses a request without an email (HTTP 422), so Pass 3 asks it
// only when PENSMITH_CONTACT_EMAIL is set, after OpenAlex.
//
// Unpaywall is a DOI-lookup service — there is no native "search". We expose a
// `search()` export for protocol compatibility but it always returns [] (the
// research workflow calls Unpaywall only after another source has supplied a
// DOI). It is protocol-shaped but inert.
//
// Polite-pool via `email=` query param (Unpaywall's published etiquette).

import { fetch as httpFetch } from '../http.js';
import { generateCitekey } from '../citekey.js';
import { displayName, nameFromParts, presentNames } from '../author-normalize.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';
import { askOaPdfs, contactParam, type OaPdfAnswer } from './work-record.js';

const BASE = 'https://api.unpaywall.org';

// The contact email is read when each URL is built; contactParam leaves the
// ?email= param out when PENSMITH_CONTACT_EMAIL is unset.
const recordUrl = (doi: string): string => `${BASE}/v2/${encodeURIComponent(doi)}${contactParam('email', '?')}`;

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
  oa_locations?: UnpaywallOALocation[];
}

function toCandidate(item: UnpaywallResponse): SourceCandidate | null {
  const doi = item.doi;
  if (!doi) return null;
  const title = String(item.title ?? '').trim();
  if (!title) return null;

  const names = presentNames((item.z_authors ?? []).map((a) => nameFromParts(a.family, a.given)));
  if (names.length === 0) return null;
  const authors = names.map(displayName);

  const year =
    typeof item.year === 'number' && item.year >= 1800 && item.year <= 2100
      ? item.year
      : undefined;

  const oaPdf = item.best_oa_location?.url_for_pdf;
  // D-14: oa_pdf_url is z.string().url().optional() — only set when valid.
  const oa_pdf_url = typeof oaPdf === 'string' && /^https?:\/\//i.test(oaPdf)
    ? oaPdf
    : undefined;

  const citekey = generateCitekey({ authors, year });

  return {
    source: 'unpaywall',
    id: doi,
    doi,
    title,
    authors,
    names,
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
  try {
    const res = await httpFetch(recordUrl(doi), { source: 'unpaywall' });
    if (res.status !== 200) return null;
    const body = typeof res.body === 'string' ? (JSON.parse(res.body) as unknown) : res.body;
    return toCandidate(body as UnpaywallResponse);
  } catch {
    return null;
  }
}

/**
 * The open-access PDFs Unpaywall lists for the work with `doi`, best first.
 * Ask only with a contact email: without one Unpaywall answers 422, which
 * reads as no answer.
 */
export function lookupOaPdfs(doi: string): Promise<OaPdfAnswer> {
  return askOaPdfs<UnpaywallResponse>(recordUrl(doi), { source: 'unpaywall' }, (item) =>
    [item.best_oa_location, ...(Array.isArray(item.oa_locations) ? item.oa_locations : [])].map((l) => l?.url_for_pdf));
}
