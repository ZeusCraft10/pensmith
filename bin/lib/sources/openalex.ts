// bin/lib/sources/openalex.ts — OpenAlex adapter (RSCH-03, RSCH-04, SRC-05,
// SRC-06, T-3-13).
//
// Endpoints:
//   search:     GET https://api.openalex.org/works?search=<q>&per-page=<n>&select=<fields>
//                   [&filter=from_publication_date:<year>-01-01][&mailto=…][&api_key=…]
//   lookupById: GET https://api.openalex.org/works/<W-id | doi:<doi> | pmid:<pmid>>?select=<fields>
//
// Identification and keys (D-19-09, D-19-10):
//   - `mailto` is the one contact-email resolver's address (bin/lib/contact-email.ts);
//   - `api_key` is the variable the global runtime.json names (default
//     OPENALEX_API_KEY; bin/lib/runtime.ts openAlexKey). OpenAlex's keyless
//     traffic draws on a small daily budget shared by everyone behind the same
//     IP address; a free key has its own. Both parameters are scrubbed from
//     SESSION.log, recordings and the fixture key (the transport's job).
//   - A keyless 429 that says the daily budget is spent (`Insufficient
//     budget`, or `x-ratelimit-remaining-usd: 0`) reads `keyless daily budget
//     exhausted — set OPENALEX_API_KEY (free)`; any other keyless 429 (e.g.
//     OpenAlex's ~40 s load shedding) reads `rate limited (retry after ~N s) —
//     a free OPENALEX_API_KEY avoids this`; with a key, `rate limited (retry
//     after …)`.
//
// A complete record (SRC-05): venue and publisher from the primary location's
// source, the CSL type, volume / issue / pages from `biblio`, the abstract
// rebuilt from `abstract_inverted_index`, the DOI (without its doi.org
// prefix), PMID / PMCID from `ids`, `is_retracted` (a retracted record is
// decided; anything else is left for the research cross-check), and the
// primary location's PDF when that location is open access (`oa_pdf_url`,
// the library's `oa_url` — full-text.ts, GRND-14).
//
// Three-way lookups (D-19-05): found | not-found (HTTP 404) | failed. The
// typed OfflineEgressError is rethrown (RUN-03).

import { fetch as httpFetch, MAX_JSON_RESPONSE_BYTES, formatRetryAfter } from '../http.js';
import { contactEmail } from '../contact-email.js';
import { openAlexKey } from '../runtime.js';
import { type SearchOptions } from './search-failure.js';
import { exchange, jsonShape, statusReason, validator, type Exchange, type ShapeCheck } from './registrar-response.js';
import { lookupFailed, lookupFound, lookupNotFound, unwrapLookup, type LookupResult } from './lookup.js';
import { generateCitekey } from '../citekey.js';
import { normalizeDoi, normalizePmid, normalizePmcid } from '../doi.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';
import type { SourceType } from '../schemas/source-types.js';

const BASE = 'https://api.openalex.org';
const SERVICE = 'OpenAlex';

interface OpenAlexAuthorship {
  author?: { display_name?: string };
  raw_author_name?: string;
}
interface OpenAlexSource {
  display_name?: string;
  type?: string;
  host_organization_name?: string;
}
export interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  authorships?: OpenAlexAuthorship[];
  abstract_inverted_index?: Record<string, number[]> | null;
  type?: string | null;
  primary_location?: { source?: OpenAlexSource | null; is_oa?: boolean | null; pdf_url?: string | null } | null;
  biblio?: { volume?: string | null; issue?: string | null; first_page?: string | null; last_page?: string | null } | null;
  ids?: { pmid?: string | null; pmcid?: string | null } | null;
  is_retracted?: boolean | null;
}

/** The fields a candidate needs (search and lookups). */
const SELECT = [
  'id', 'doi', 'title', 'publication_year', 'authorships', 'type', 'primary_location',
  'biblio', 'abstract_inverted_index', 'ids', 'is_retracted',
].join(',');

function stripDoiUrl(doiUrl: string | null | undefined): string | undefined {
  if (typeof doiUrl !== 'string' || doiUrl.trim().length === 0) return undefined;
  return doiUrl.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
}

/** OpenAlex's abstract_inverted_index back to text (word → positions). */
export function abstractFromInvertedIndex(index: Record<string, number[]> | null | undefined): string | undefined {
  if (!index || typeof index !== 'object') return undefined;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const p of positions) {
      if (Number.isInteger(p) && p >= 0 && p < 100_000) words[p] = word;
    }
  }
  const text = words.filter((w) => typeof w === 'string').join(' ').replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : undefined;
}

/** OpenAlex work types → CSL types (with the primary source's type for articles). */
export function openAlexCslType(type: string | null | undefined, sourceType: string | null | undefined): SourceType | undefined {
  switch (type) {
    case undefined:
    case null:
    case '':
      return undefined;
    case 'article':
      return sourceType === 'conference' ? 'paper-conference' : 'article-journal';
    case 'review':
    case 'letter':
    case 'editorial':
    case 'erratum':
    case 'retraction':
      return 'article-journal';
    case 'preprint':
      return 'preprint';
    case 'book':
      return 'book';
    case 'book-chapter':
    case 'reference-entry':
      return 'chapter';
    case 'dissertation':
      return 'thesis';
    case 'dataset':
      return 'dataset';
    case 'report':
      return 'report';
    default:
      return 'other';
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

/** An http(s) URL, else undefined. */
function httpUrl(v: unknown): string | undefined {
  const s = str(v);
  if (s === undefined) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? s : undefined;
  } catch {
    return undefined;
  }
}

export function openAlexToCandidate(item: OpenAlexWork): SourceCandidate | null {
  const doi = stripDoiUrl(item.doi);
  const id = str(item.id) ?? doi;
  if (!id) return null;
  const title = String(item.title ?? item.display_name ?? '').replace(/\s+/g, ' ').trim();
  if (!title) return null;

  // OpenAlex emits "Given Family" display names; author-normalize handles them.
  const authors = (item.authorships ?? [])
    .map((a) => String(a.author?.display_name ?? a.raw_author_name ?? '').trim())
    .filter(Boolean);
  if (authors.length === 0) return null;

  const y = item.publication_year;
  const year = typeof y === 'number' && y >= 1800 && y <= 2100 ? y : undefined;
  const source = item.primary_location?.source ?? undefined;
  const venue = str(source?.display_name);
  const publisher = str(source?.host_organization_name);
  const type = openAlexCslType(item.type, source?.type);
  const volume = str(item.biblio?.volume);
  const issue = str(item.biblio?.issue);
  const first = str(item.biblio?.first_page);
  const last = str(item.biblio?.last_page);
  const pages = first && last && first !== last ? `${first}-${last}` : first;
  const abstract = abstractFromInvertedIndex(item.abstract_inverted_index);
  const pmid = normalizePmid(String(item.ids?.pmid ?? '').replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//i, '').replace(/\/$/, ''));
  const pmcid = normalizePmcid(String(item.ids?.pmcid ?? '').replace(/^https?:\/\/(?:www\.)?ncbi\.nlm\.nih\.gov\/pmc\/articles\//i, '').replace(/\/$/, ''));
  const retracted = item.is_retracted === true;
  const oaPdf = item.primary_location?.is_oa === true ? httpUrl(item.primary_location.pdf_url) : undefined;

  return {
    source: 'openalex',
    id,
    ...(doi !== undefined ? { doi } : {}),
    title,
    authors,
    ...(year !== undefined ? { year } : {}),
    ...(abstract !== undefined ? { abstract } : {}),
    ...(venue !== undefined ? { venue } : {}),
    ...(publisher !== undefined ? { publisher } : {}),
    ...(volume !== undefined ? { volume } : {}),
    ...(issue !== undefined ? { issue } : {}),
    ...(pages !== undefined ? { pages } : {}),
    ...(type !== undefined ? { type } : {}),
    ...(pmid !== null ? { pmid } : {}),
    ...(pmcid !== null ? { pmcid } : {}),
    ...(oaPdf !== undefined ? { oa_pdf_url: oaPdf } : {}),
    retracted,
    ...(retracted
      ? { retraction_status: 'retracted' as const, retraction_details: 'OpenAlex marks this work as retracted' }
      : {}),
    last_verified: new Date().toISOString(),
    citekey: generateCitekey({ authors, ...(year !== undefined ? { year } : {}) }),
    raw: item,
  };
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const RESULTS: ShapeCheck = jsonShape((b) => isObject(b) && Array.isArray(b['results']), 'OpenAlex results list');
const WORK: ShapeCheck = jsonShape((b) => isObject(b) && typeof b['id'] === 'string', 'OpenAlex work (id)');

interface KeyState {
  readonly value: string | undefined;
  readonly envName: string;
  readonly required: boolean;
}

/** `&mailto=…&api_key=…` for this request (each only when set). */
function identityParams(key: KeyState): string {
  const email = contactEmail().email;
  return (email ? `&mailto=${encodeURIComponent(email)}` : '') + (key.value ? `&api_key=${encodeURIComponent(key.value)}` : '');
}

/**
 * True when OpenAlex said the (keyless) daily budget is spent: its
 * `Insufficient budget` answer, or `x-ratelimit-remaining-usd: 0`. Its other
 * 429s — e.g. "Anonymous search is temporarily rate-limited while the search
 * cluster is under elevated load. Please retry in 38s" — are short waits.
 */
export function isBudgetExhausted(info: { body?: string; headers?: Readonly<Record<string, string>> }): boolean {
  if (/insufficient budget/i.test(info.body ?? '')) return true;
  const remaining = info.headers?.['x-ratelimit-remaining-usd'];
  return remaining !== undefined && remaining.trim() !== '' && Number(remaining) <= 0;
}

function rateLimitReason(key: KeyState): (info: { retryAfterMs?: number; body?: string; headers?: Readonly<Record<string, string>> }) => string {
  return (info) => {
    const wait = info.retryAfterMs !== undefined ? ` (retry after ${formatRetryAfter(info.retryAfterMs)})` : '';
    if (key.value === undefined) {
      return isBudgetExhausted(info)
        ? `keyless daily budget exhausted — set ${key.envName} (free)`
        : `rate limited${wait} — a free ${key.envName} avoids this`;
    }
    return `rate limited${wait}`;
  };
}

function missingKeyReason(key: KeyState): string {
  return `${key.envName} is not set (the global runtime.json requires an OpenAlex API key)`;
}

async function get(url: string, check: ShapeCheck, key: KeyState): Promise<Exchange> {
  return exchange(
    () => httpFetch(url, { source: 'openalex', maxBytes: MAX_JSON_RESPONSE_BYTES, validate: validator(check) }),
    { service: SERVICE, check, rateLimited: rateLimitReason(key) },
  );
}

/** The search URL without the identity parameters (what a recording stores). */
export function searchPath(query: string, opts: SearchOptions = {}): string {
  const limit = opts.limit ?? 20;
  const filter =
    typeof opts.fromYear === 'number' && Number.isInteger(opts.fromYear)
      ? `&filter=${encodeURIComponent(`from_publication_date:${opts.fromYear}-01-01`)}`
      : '';
  return `${BASE}/works?search=${encodeURIComponent(query)}&per-page=${limit}&select=${encodeURIComponent(SELECT)}${filter}`;
}

export async function search(query: string, opts: SearchOptions = {}): Promise<SourceCandidate[]> {
  const key = await openAlexKey();
  if (key.required && key.value === undefined) {
    opts.onFailure?.(missingKeyReason(key));
    return [];
  }
  const ex = await get(`${searchPath(query, opts)}${identityParams(key)}`, RESULTS, key);
  if (ex.kind === 'failed') {
    opts.onFailure?.(ex.reason);
    return [];
  }
  if (ex.kind === 'status') {
    opts.onFailure?.(statusReason(ex.res));
    return [];
  }
  const results = (JSON.parse(ex.res.body) as { results: OpenAlexWork[] }).results;
  return results.map(openAlexToCandidate).filter((c): c is SourceCandidate => c !== null);
}

/**
 * The OpenAlex path segment for an identifier: a W-id (bare or as an
 * openalex.org URL), `doi:<doi>` for a DOI, `pmid:<pmid>` for a PMID — or
 * null when it is none of them.
 */
export function workPathSegment(id: string): string | null {
  const s = id.trim();
  const w = /^(?:https?:\/\/openalex\.org\/)?(W\d+)$/i.exec(s);
  if (w?.[1]) return w[1].toUpperCase();
  const doi = normalizeDoi(s.replace(/^doi:/i, ''));
  if (doi !== null) return `doi:${encodeURIComponent(doi)}`;
  const pmid = normalizePmid(s);
  if (pmid !== null && /^pmid:/i.test(s)) return `pmid:${pmid}`;
  return null;
}

/** OpenAlex's answer for one identifier: found | not-found (HTTP 404) | failed (reason). */
export async function lookupById(id: string): Promise<LookupResult> {
  const segment = workPathSegment(id);
  if (segment === null) return lookupNotFound(`not an OpenAlex work id, DOI or PMID: ${JSON.stringify(id.slice(0, 80))}`);
  const key = await openAlexKey();
  if (key.required && key.value === undefined) return lookupFailed(missingKeyReason(key));
  const ex = await get(`${BASE}/works/${segment}?select=${encodeURIComponent(SELECT)}${identityParams(key)}`, WORK, key);
  if (ex.kind === 'failed') {
    return lookupFailed(ex.reason, {
      ...(ex.status !== undefined ? { status: ex.status } : {}),
      ...(ex.retryAfterMs !== undefined ? { retryAfterMs: ex.retryAfterMs } : {}),
    });
  }
  if (ex.kind === 'status') {
    if (ex.res.status === 404) return lookupNotFound('HTTP 404 (OpenAlex has no such work)');
    return lookupFailed(statusReason(ex.res), { status: ex.res.status });
  }
  const candidate = openAlexToCandidate(JSON.parse(ex.res.body) as OpenAlexWork);
  if (candidate === null) return lookupFailed('the OpenAlex record has no title or no authors (an incomplete registrar record — asking again gives the same answer)', { status: 200, permanent: true });
  return lookupFound(candidate);
}

export async function fetchById(id: string): Promise<SourceCandidate | null> {
  return unwrapLookup(await lookupById(id), 'openalex', id);
}
