// bin/lib/sources/pubmed.ts — PubMed E-utilities adapter (RSCH-03, RSCH-04,
// SRC-05, T-3-13).
//
// Endpoints (two-step search, single-step lookup):
//   search step 1: GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=<q>&retmode=json&retmax=<n>
//                  [&datetype=pdat&mindate=<year>&maxdate=3000]
//                  -> .esearchresult.idlist: string[] of PMIDs
//   search step 2: GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=<csv>&retmode=json
//                  -> .result.<pmid> objects
//   lookupById:    GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=<pmid>&retmode=json
//
// A complete record (SRC-05, D-19-13): PMID, PMCID, DOI, the journal's full
// name as venue, volume, issue, pages, the CSL type from the publication types,
// and collective (group) authors written braced (`{COVID-19 Study Group}`).
// PubMed personal names come in surname-first compact form: "Vaswani A" (NO
// comma); bin/lib/author-normalize.ts handles both forms. pubdate is a loose
// string like "2019 Jul" or "2020 May 12" — the year is its first 4-digit token.
//
// Three-way lookups (D-19-05): found | not-found (esummary's per-record
// `error`, e.g. "cannot get document summary") | failed (a non-200 after
// retries, an exhausted host, a body that is not an E-utilities answer).
// Offline replay is the exact-match fixture store inside bin/lib/http.ts; the
// typed OfflineEgressError is rethrown so callers report "unavailable (offline)".

import { fetch as httpFetch, MAX_JSON_RESPONSE_BYTES } from '../http.js';
import { type SearchOptions } from './search-failure.js';
import { exchange, jsonShape, statusReason, validator, type Exchange, type ShapeCheck } from './registrar-response.js';
import { lookupFailed, lookupFound, lookupNotFound, unwrapLookup, type LookupResult } from './lookup.js';
import { generateCitekey } from '../citekey.js';
import { normalizePmid, normalizePmcid } from '../doi.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';
import type { SourceType } from '../schemas/source-types.js';

const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const SERVICE = 'PubMed';

interface PubmedAuthor {
  name?: string;
  authtype?: string;
}
interface PubmedArticleId {
  idtype?: string;
  value?: string;
}
interface PubmedRecord {
  uid?: string;
  error?: string;
  title?: string;
  authors?: PubmedAuthor[];
  pubdate?: string;
  articleids?: PubmedArticleId[];
  source?: string;
  fulljournalname?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  pubtype?: string[];
  doctype?: string;
  publishername?: string;
  booktitle?: string;
}

function parseYear(pubdate: string | undefined): number | undefined {
  if (!pubdate) return undefined;
  const m = /(\d{4})/.exec(pubdate);
  if (!m?.[1]) return undefined;
  const y = Number(m[1]);
  return y >= 1800 && y <= 2100 ? y : undefined;
}

function articleId(rec: PubmedRecord, type: string): string | undefined {
  for (const id of rec.articleids ?? []) {
    if (id.idtype === type && typeof id.value === 'string' && id.value.trim()) return id.value.trim();
  }
  return undefined;
}

/** PubMed publication / document types → a CSL type. */
function pubmedCslType(rec: PubmedRecord): SourceType {
  if (rec.doctype === 'book') return 'book';
  if (rec.doctype === 'chapter') return 'chapter';
  const types = (rec.pubtype ?? []).map((t) => t.toLowerCase());
  if (types.includes('preprint')) return 'preprint';
  if (types.includes('dataset')) return 'dataset';
  if (types.includes('news') || types.includes('newspaper article')) return 'article-newspaper';
  if (types.includes('technical report')) return 'report';
  return 'article-journal';
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

export function pubmedToCandidate(rec: PubmedRecord): SourceCandidate | null {
  const pmid = str(rec.uid);
  if (!pmid || rec.error !== undefined) return null;
  const title = String(rec.title ?? '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  if (!title) return null;

  const authors = (rec.authors ?? [])
    .map((a) => {
      const name = String(a.name ?? '').trim();
      if (!name) return '';
      // A group author ("CollectiveName") is one corporate name, never a surname + initials.
      return a.authtype === 'CollectiveName' ? `{${name.replace(/[{}]/g, '')}}` : name;
    })
    .filter(Boolean);
  if (authors.length === 0) return null;

  const year = parseYear(rec.pubdate);
  const doi = articleId(rec, 'doi');
  const pmcRaw = articleId(rec, 'pmc') ?? articleId(rec, 'pmcid')?.replace(/^pmc-id:\s*/i, '').replace(/;.*$/, '');
  const pmcid = pmcRaw !== undefined ? normalizePmcid(pmcRaw) : null;
  const venue = str(rec.fulljournalname) ?? str(rec.source) ?? str(rec.booktitle);
  const volume = str(rec.volume);
  const issue = str(rec.issue);
  const pages = str(rec.pages);
  const publisher = str(rec.publishername);

  return {
    source: 'pubmed',
    id: pmid,
    pmid,
    ...(doi !== undefined ? { doi } : {}),
    ...(pmcid !== null ? { pmcid } : {}),
    title,
    authors,
    ...(year !== undefined ? { year } : {}),
    ...(venue !== undefined ? { venue } : {}),
    ...(volume !== undefined ? { volume } : {}),
    ...(issue !== undefined ? { issue } : {}),
    ...(pages !== undefined ? { pages } : {}),
    ...(publisher !== undefined ? { publisher } : {}),
    type: pubmedCslType(rec),
    retracted: false,
    last_verified: new Date().toISOString(),
    citekey: generateCitekey({ authors, ...(year !== undefined ? { year } : {}) }),
    raw: rec,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const ESEARCH: ShapeCheck = jsonShape(
  (b) => isObject(b) && isObject(b['esearchresult']) && Array.isArray(b['esearchresult']['idlist']) && b['esearchresult']['ERROR'] === undefined,
  'E-utilities esearch result (idlist)',
);
const ESUMMARY: ShapeCheck = jsonShape((b) => isObject(b) && isObject(b['result']), 'E-utilities esummary result');

function recordsFromEsummary(body: { result?: Record<string, unknown> }, ids: readonly string[]): PubmedRecord[] {
  const result = body.result ?? {};
  const records: PubmedRecord[] = [];
  for (const id of ids) {
    const rec = result[id];
    if (isObject(rec)) records.push(rec as PubmedRecord);
  }
  return records;
}

async function get(url: string, check: ShapeCheck): Promise<Exchange> {
  return exchange(
    () => httpFetch(url, { source: 'pubmed', maxBytes: MAX_JSON_RESPONSE_BYTES, validate: validator(check) }),
    { service: SERVICE, check },
  );
}

function failureOf(ex: Exchange): string | null {
  if (ex.kind === 'failed') return ex.reason;
  if (ex.kind === 'status') return statusReason(ex.res);
  return null;
}

export async function search(query: string, opts: SearchOptions = {}): Promise<SourceCandidate[]> {
  const limit = opts.limit ?? 20;
  const dates =
    typeof opts.fromYear === 'number' && Number.isInteger(opts.fromYear)
      ? `&datetype=pdat&mindate=${opts.fromYear}&maxdate=3000`
      : '';
  const esearchUrl = `${BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retmax=${limit}${dates}`;
  const ex1 = await get(esearchUrl, ESEARCH);
  const fail1 = failureOf(ex1);
  if (fail1 !== null || ex1.kind !== 'ok') {
    opts.onFailure?.(fail1 ?? 'unknown failure');
    return [];
  }
  const idlist = ((JSON.parse(ex1.res.body) as { esearchresult: { idlist: unknown[] } }).esearchresult.idlist)
    .filter((x): x is string => typeof x === 'string');
  if (idlist.length === 0) return [];

  const esummaryUrl = `${BASE}/esummary.fcgi?db=pubmed&id=${encodeURIComponent(idlist.join(','))}&retmode=json`;
  const ex2 = await get(esummaryUrl, ESUMMARY);
  const fail2 = failureOf(ex2);
  if (fail2 !== null || ex2.kind !== 'ok') {
    opts.onFailure?.(fail2 ?? 'unknown failure');
    return [];
  }
  const records = recordsFromEsummary(JSON.parse(ex2.res.body) as { result?: Record<string, unknown> }, idlist);
  return records.map(pubmedToCandidate).filter((c): c is SourceCandidate => c !== null);
}

/** PubMed's answer for one PMID (`31978945`, `PMID:31978945`): found | not-found | failed (reason). */
export async function lookupById(id: string): Promise<LookupResult> {
  const pmid = normalizePmid(id);
  if (pmid === null) return lookupNotFound(`not a PMID: ${JSON.stringify(id.slice(0, 80))}`);
  const ex = await get(`${BASE}/esummary.fcgi?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=json`, ESUMMARY);
  if (ex.kind === 'failed') {
    return lookupFailed(ex.reason, {
      ...(ex.status !== undefined ? { status: ex.status } : {}),
      ...(ex.retryAfterMs !== undefined ? { retryAfterMs: ex.retryAfterMs } : {}),
    });
  }
  if (ex.kind === 'status') {
    if (ex.res.status === 404) return lookupNotFound('HTTP 404 (PubMed has no such record)');
    return lookupFailed(statusReason(ex.res), { status: ex.res.status });
  }
  const [rec] = recordsFromEsummary(JSON.parse(ex.res.body) as { result?: Record<string, unknown> }, [pmid]);
  if (!rec) return lookupNotFound(`PubMed has no record for PMID ${pmid}`);
  if (typeof rec.error === 'string') return lookupNotFound(`PubMed has no record for PMID ${pmid} (${rec.error})`);
  const candidate = pubmedToCandidate(rec);
  if (candidate === null) return lookupFailed('the PubMed record has no title or no authors', { status: 200 });
  return lookupFound(candidate);
}

export async function fetchById(pmid: string): Promise<SourceCandidate | null> {
  return unwrapLookup(await lookupById(pmid), 'pubmed', pmid);
}
