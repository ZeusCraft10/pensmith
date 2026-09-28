// bin/lib/sources/semanticscholar.ts — Semantic Scholar Graph API adapter
// (RSCH-03, RSCH-04, SRC-05, SRC-06, SRC-17, T-3-13).
//
// Endpoints (Graph v1):
//   search:     GET https://api.semanticscholar.org/graph/v1/paper/search?query=<q>&limit=<n>&fields=…[&year=<from>-]
//   lookupById: GET https://api.semanticscholar.org/graph/v1/paper/<id>?fields=…
//               (<id> = a paperId, or DOI:<doi>, ARXIV:<id>, PMID:<pmid>, CorpusId:<n>)
//
// Key (D-16, D-19-10): PENSMITH_S2_API_KEY is sent as the `x-api-key` header
// (bin/lib/runtime.ts s2ApiKeyValue; the transport never logs, caches or
// records it). Without a key, requests go to Semantic Scholar's shared public
// pool — every keyless client in the world shares it, and it rejects most
// requests with HTTP 429 — so the adapter prints one notice per run, and a
// keyless 429 reads `HTTP 429 — rate limited; set PENSMITH_S2_API_KEY`.
//
// A complete record (SRC-05): venue (the journal's name, else S2's venue),
// volume and pages from `journal`, DOI / arXiv id / PMID / PMCID from
// `externalIds`, the CSL type from `publicationTypes`, the abstract.
//
// Three-way lookups (D-19-05): found | not-found (HTTP 404) | failed. Offline
// replay is the exact-match fixture store inside bin/lib/http.ts; the typed
// OfflineEgressError is rethrown so callers report "unavailable (offline)".

import { fetch as httpFetch, MAX_JSON_RESPONSE_BYTES, formatRetryAfter } from '../http.js';
import { type SearchOptions } from './search-failure.js';
import { exchange, jsonShape, statusReason, validator, type Exchange, type ShapeCheck } from './registrar-response.js';
import { lookupFailed, lookupFound, lookupNotFound, unwrapLookup, type LookupResult } from './lookup.js';
import { generateCitekey } from '../citekey.js';
import { getS2ApiKey, s2ApiKeyValue } from '../runtime.js';
import { normalizeDoi, normalizePmid, normalizePmcid } from '../doi.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';
import type { SourceType } from '../schemas/source-types.js';

const BASE = 'https://api.semanticscholar.org';
const SERVICE = 'Semantic Scholar';
const FIELDS = 'title,authors,year,externalIds,abstract,venue,publicationTypes,journal';

/** The once-per-run keyless notice (D-19-10). */
export const S2_KEYLESS_NOTICE =
  'pensmith: PENSMITH_S2_API_KEY is not set — Semantic Scholar requests go to its shared keyless pool, ' +
  'which every keyless client shares and which often answers HTTP 429; a free key: ' +
  'https://www.semanticscholar.org/product/api#api-key-form';

/** The keyless rate-limit reason (D-19-10). */
export const S2_KEYLESS_429_REASON = 'HTTP 429 — rate limited; set PENSMITH_S2_API_KEY';

interface S2Author {
  authorId?: string | null;
  name?: string | null;
}
interface S2ExternalIds {
  DOI?: string;
  ArXiv?: string;
  PubMed?: string;
  PubMedCentral?: string;
}
export interface S2Paper {
  paperId?: string;
  externalIds?: S2ExternalIds | null;
  title?: string | null;
  year?: number | null;
  authors?: S2Author[] | null;
  /** The live API returns `null` for papers without an abstract. */
  abstract?: string | null;
  venue?: string | null;
  publicationTypes?: string[] | null;
  journal?: { name?: string | null; volume?: string | null; pages?: string | null } | null;
}

let warnedOnceKeyless = false;
function warnKeylessOnce(): void {
  if (warnedOnceKeyless) return;
  warnedOnceKeyless = true;
  process.stderr.write(`${S2_KEYLESS_NOTICE}\n`);
}

/** Test hook: let the keyless notice print again. */
export function _resetS2NoticeForTest(): void {
  warnedOnceKeyless = false;
}

function buildHeaders(): Record<string, string> | undefined {
  const key = s2ApiKeyValue();
  if (key === undefined) {
    warnKeylessOnce();
    return undefined;
  }
  return { 'x-api-key': key };
}

/** Presence of the key (never its value), for callers that report it. */
export function s2KeyStatus(): { present: boolean; name: string } {
  return getS2ApiKey();
}

/** S2 publication types → a CSL type (the most specific one wins). */
export function s2CslType(types: readonly string[] | null | undefined): SourceType | undefined {
  const t = new Set((types ?? []).map((x) => String(x)));
  if (t.size === 0) return undefined;
  if (t.has('Book')) return 'book';
  if (t.has('BookSection')) return 'chapter';
  if (t.has('Conference')) return 'paper-conference';
  if (t.has('Dataset')) return 'dataset';
  if (t.has('News')) return 'article-newspaper';
  if (t.has('JournalArticle') || t.has('Review') || t.has('LettersAndComments') || t.has('Editorial') || t.has('CaseReport') || t.has('ClinicalTrial') || t.has('MetaAnalysis') || t.has('Study')) {
    return 'article-journal';
  }
  return 'other';
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

export function s2ToCandidate(item: S2Paper): SourceCandidate | null {
  const id = str(item.paperId);
  if (!id) return null;
  const title = String(item.title ?? '').replace(/\s+/g, ' ').trim();
  if (!title) return null;

  const authors = (item.authors ?? []).map((a) => String(a?.name ?? '').trim()).filter(Boolean);
  if (authors.length === 0) return null;

  const year = typeof item.year === 'number' && item.year >= 1800 && item.year <= 2100 ? item.year : undefined;
  const ext = item.externalIds ?? {};
  const doi = str(ext.DOI);
  const arxiv = str(ext.ArXiv);
  const pmid = ext.PubMed !== undefined ? normalizePmid(String(ext.PubMed)) : null;
  const pmcRaw = ext.PubMedCentral !== undefined ? String(ext.PubMedCentral) : undefined;
  const pmcid = pmcRaw !== undefined ? normalizePmcid(/^pmc/i.test(pmcRaw) ? pmcRaw : `PMC${pmcRaw}`) : null;
  const venue = str(item.journal?.name) ?? str(item.venue);
  const volume = str(item.journal?.volume);
  const pages = str(item.journal?.pages)?.replace(/\s+/g, '');
  const type = s2CslType(item.publicationTypes);

  return {
    source: 'semanticscholar',
    id,
    ...(doi !== undefined ? { doi } : {}),
    ...(arxiv !== undefined ? { arxiv } : {}),
    ...(pmid !== null ? { pmid } : {}),
    ...(pmcid !== null ? { pmcid } : {}),
    title,
    authors,
    ...(year !== undefined ? { year } : {}),
    // A null abstract (common in live S2 responses) is "no abstract", never a
    // reason to drop an otherwise valid candidate.
    ...(typeof item.abstract === 'string' && item.abstract.trim() ? { abstract: item.abstract.trim() } : {}),
    ...(venue !== undefined ? { venue } : {}),
    ...(volume !== undefined ? { volume } : {}),
    ...(pages !== undefined && pages.length > 0 ? { pages } : {}),
    ...(type !== undefined ? { type } : {}),
    retracted: false,
    last_verified: new Date().toISOString(),
    citekey: generateCitekey({ authors, ...(year !== undefined ? { year } : {}) }),
    raw: item,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A search answer: `data[]`, or `total` alone when nothing matched. */
const SEARCH: ShapeCheck = jsonShape(
  (b) => isObject(b) && (Array.isArray(b['data']) || (typeof b['total'] === 'number' && b['data'] === undefined)),
  'Semantic Scholar search result (data)',
);
const PAPER: ShapeCheck = jsonShape((b) => isObject(b) && typeof b['paperId'] === 'string', 'Semantic Scholar paper (paperId)');

async function get(url: string, check: ShapeCheck): Promise<Exchange> {
  const headers = buildHeaders();
  const keyed = headers !== undefined;
  return exchange(
    () =>
      httpFetch(url, {
        source: 'semanticscholar',
        maxBytes: MAX_JSON_RESPONSE_BYTES,
        validate: validator(check),
        ...(headers ? { headers } : {}),
      }),
    {
      service: SERVICE,
      check,
      rateLimited: (info) =>
        keyed
          ? `HTTP 429 — rate limited${info.retryAfterMs !== undefined ? ` (retry after ${formatRetryAfter(info.retryAfterMs)})` : ''}`
          : S2_KEYLESS_429_REASON,
    },
  );
}

export async function search(query: string, opts: SearchOptions = {}): Promise<SourceCandidate[]> {
  const limit = opts.limit ?? 20;
  const year = typeof opts.fromYear === 'number' && Number.isInteger(opts.fromYear) ? `&year=${opts.fromYear}-` : '';
  const url = `${BASE}/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${encodeURIComponent(FIELDS)}${year}`;
  const ex = await get(url, SEARCH);
  if (ex.kind === 'failed') {
    opts.onFailure?.(ex.reason);
    return [];
  }
  if (ex.kind === 'status') {
    opts.onFailure?.(statusReason(ex.res));
    return [];
  }
  const data = (JSON.parse(ex.res.body) as { data?: S2Paper[] }).data ?? [];
  return data.map(s2ToCandidate).filter((c): c is SourceCandidate => c !== null);
}

/**
 * The Graph API path segment for an identifier: a 40-hex paperId, a DOI
 * (`DOI:` added), an arXiv id (`ARXIV:`), `PMID:` / `CorpusId:` forms as given.
 */
export function paperPathSegment(id: string): string | null {
  const s = id.trim();
  if (/^[0-9a-f]{40}$/i.test(s)) return s.toLowerCase();
  const prefixed = /^(DOI|ARXIV|PMID|PMCID|CorpusId|MAG|ACL|URL):(.+)$/i.exec(s);
  if (prefixed?.[1] && prefixed[2]) {
    const kind = prefixed[1].toUpperCase() === 'CORPUSID' ? 'CorpusId' : prefixed[1].toUpperCase();
    return `${kind}:${encodeURIComponent(prefixed[2].trim())}`;
  }
  const doi = normalizeDoi(s);
  if (doi !== null) return `DOI:${encodeURIComponent(doi)}`;
  return null;
}

/** Semantic Scholar's answer for one identifier: found | not-found (HTTP 404) | failed (reason). */
export async function lookupById(id: string): Promise<LookupResult> {
  const segment = paperPathSegment(id);
  if (segment === null) return lookupNotFound(`not a Semantic Scholar paper id or DOI: ${JSON.stringify(id.slice(0, 80))}`);
  const ex = await get(`${BASE}/graph/v1/paper/${segment}?fields=${encodeURIComponent(FIELDS)}`, PAPER);
  if (ex.kind === 'failed') {
    return lookupFailed(ex.reason, {
      ...(ex.status !== undefined ? { status: ex.status } : {}),
      ...(ex.retryAfterMs !== undefined ? { retryAfterMs: ex.retryAfterMs } : {}),
    });
  }
  if (ex.kind === 'status') {
    if (ex.res.status === 404) return lookupNotFound('HTTP 404 (Semantic Scholar has no such paper)');
    return lookupFailed(statusReason(ex.res), { status: ex.res.status });
  }
  const candidate = s2ToCandidate(JSON.parse(ex.res.body) as S2Paper);
  if (candidate === null) return lookupFailed('the Semantic Scholar record has no title or no authors', { status: 200 });
  return lookupFound(candidate);
}

export async function fetchById(paperId: string): Promise<SourceCandidate | null> {
  return unwrapLookup(await lookupById(paperId), 'semanticscholar', paperId);
}
