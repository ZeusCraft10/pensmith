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
//   abstracts:     GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=<csv>&rettype=abstract&retmode=xml
//                  (one request per ≤ EFETCH_BATCH ids; Phase 20 carry-over 3, D-20-16)
//
// Abstracts (D-20-16): esummary carries none, so Pass 2 had no source text for
// a PubMed-only work. After esummary the adapter asks efetch for the ids it
// returned (search: every hit; lookupById: the one record, unless the caller
// asks for no abstract — Pass 1 compares titles and authors only) and records
// each article's `abstract` (its AbstractText parts, `LABEL: text` for a
// structured abstract) and its own PMCID (the article's ArticleIdList, never a
// cited reference's). efetch is best-effort: a failed or offline-missing
// efetch leaves the abstracts empty and is NAMED — search reports it through
// `onWarning` (the adapter's status line: `abstracts unavailable (…)`),
// lookupById in the candidate's `raw.abstractNote` — and never fails the
// search or the lookup. efetch's XML carries each article's reference list, so
// an answer for ten hits is often a few hundred KB: over the 51200-byte
// cassette cap, which is why the offline lane replays efetch only for single
// records (tests/fixtures/cassettes/pubmed/efetch-*.json) and the live lane
// (`npm run live:sources`) covers search.
//
// A complete record (SRC-05, D-19-13): PMID, PMCID, DOI, the journal's full
// name as venue, volume, issue, pages, the CSL type from the publication types,
// and collective (group) authors written braced (`{COVID-19 Study Group}`).
// PubMed personal names come in surname-first compact form with NO comma
// ("Zhu N", "Gao GF", "King ML Jr"): the adapter rewrites each into the
// canonical "Family, Initials" form ("Zhu, N") through person-name.ts
// fromPubmedCompactName — read as a display name, "Zhu N" would be given
// "Zhu", family "N", and every BibTeX / RIS / Pass-1 consumer would swap the
// parts. A record PubMed types "Retracted Publication" is retracted. pubdate is
// a loose string like "2019 Jul" or "2020 May 12" — the year is its first
// 4-digit token.
//
// Three-way lookups (D-19-05): found | not-found (esummary's per-record
// `error`, e.g. "cannot get document summary") | failed (a non-200 after
// retries, an exhausted host, a body that is not an E-utilities answer).
// Offline replay is the exact-match fixture store inside bin/lib/http.ts; the
// typed OfflineEgressError is rethrown so callers report "unavailable (offline)".

import { decodeEntities, plainText, plainTextOpt } from '../markup.js';
import { fetch as httpFetch, isOfflineEgressError, offlineLabel, MAX_JSON_RESPONSE_BYTES } from '../http.js';
import { type SearchOptions } from './search-failure.js';
import { answeredAt, exchange, jsonShape, statusReason, validator, type Exchange, type LookupOptions, type ShapeCheck } from './registrar-response.js';
import { lookupFailed, lookupFound, lookupNotFound, unwrapLookup, type LookupResult } from './lookup.js';
import { generateCitekey } from '../citekey.js';
import { normalizePmid, normalizePmcid } from '../doi.js';
import { fromPubmedCompactName } from '../person-name.js';
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

export function pubmedToCandidate(rec: PubmedRecord, checkedAt: string = new Date().toISOString()): SourceCandidate | null {
  const pmid = str(rec.uid);
  if (!pmid || rec.error !== undefined) return null;
  const title = plainText(String(rec.title ?? '')).replace(/\.$/, '');
  if (!title) return null;

  const authors = (rec.authors ?? [])
    .map((a) => {
      const name = String(a.name ?? '').trim();
      if (!name) return '';
      // A group author ("CollectiveName") is one corporate name, never a surname + initials.
      return a.authtype === 'CollectiveName' ? `{${name.replace(/[{}]/g, '')}}` : fromPubmedCompactName(name);
    })
    .filter(Boolean);
  if (authors.length === 0) return null;

  const year = parseYear(rec.pubdate);
  const doi = articleId(rec, 'doi');
  const pmcRaw = articleId(rec, 'pmc') ?? articleId(rec, 'pmcid')?.replace(/^pmc-id:\s*/i, '').replace(/;.*$/, '');
  const pmcid = pmcRaw !== undefined ? normalizePmcid(pmcRaw) : null;
  const venue = plainTextOpt(str(rec.fulljournalname) ?? str(rec.source) ?? str(rec.booktitle));
  const volume = str(rec.volume);
  const issue = str(rec.issue);
  const pages = str(rec.pages);
  const publisher = str(rec.publishername);
  const retracted = (rec.pubtype ?? []).some((t) => t.toLowerCase() === 'retracted publication');

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
    retracted,
    ...(retracted
      ? { retraction_status: 'retracted' as const, retraction_details: 'PubMed publication type: Retracted Publication' }
      : {}),
    last_verified: checkedAt,
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

async function get(url: string, check: ShapeCheck, opts: LookupOptions & { maxBytes?: number } = {}): Promise<Exchange> {
  return exchange(
    () =>
      httpFetch(url, {
        source: 'pubmed',
        maxBytes: opts.maxBytes ?? MAX_JSON_RESPONSE_BYTES,
        validate: validator(check),
        ...(opts.refresh === true ? { refresh: true } : {}),
      }),
    { service: SERVICE, check },
  );
}

// ---------------------------------------------------------------------------
// Abstracts (efetch, D-20-16)
// ---------------------------------------------------------------------------

/** The most ids one efetch request asks for (D-20-16: at most 200). */
export const EFETCH_BATCH = 200;
/** efetch's XML carries each article's reference list: allow a large answer (still bounded, SEC-03). */
const EFETCH_MAX_BYTES = 32 * 1024 * 1024;

const EFETCH: ShapeCheck = (res) => (/<PubmedArticleSet\b/.test(res.body) ? null : 'no <PubmedArticleSet>');

/** The efetch URL for `ids` (exported for the recorder and tests: the exact request). */
export function efetchUrl(ids: readonly string[]): string {
  return `${BASE}/efetch.fcgi?db=pubmed&id=${encodeURIComponent(ids.join(','))}&rettype=abstract&retmode=xml`;
}

/** What efetch says about one article. */
export interface PubmedArticleFacts {
  readonly abstract?: string;
  readonly pmcid?: string;
}

/**
 * Inline XML markup out (PubMed's inline formatting — i, b, u, sup, sub — with
 * no space, so "H<sub>2</sub>O" stays one word; any other tag as a space),
 * entities decoded, whitespace collapsed.
 */
function xmlText(s: string): string {
  const flat = s.replace(/<\/?(?:i|b|u|sup|sub)(?:\s[^>]*)?>/g, '').replace(/<[^>]+>/g, ' ');
  return decodeEntities(flat).replace(/\s+/g, ' ').replace(/\s+([.,;:!?)])/g, '$1').trim();
}

/**
 * The abstract and own PMCID of every article in an efetch PubmedArticleSet,
 * by PMID. A structured abstract's parts are joined `LABEL: text`; a cited
 * reference's ArticleIdList (inside ReferenceList) is never read. Linear
 * regular expressions only (CR-05); the answer is bounded by maxBytes.
 */
export function parseEfetchArticles(xml: string): Map<string, PubmedArticleFacts> {
  const out = new Map<string, PubmedArticleFacts>();
  for (const block of xml.split(/<\/PubmedArticle>|<\/PubmedBookArticle>/)) {
    const pmid = /<PMID\b[^>]*>\s*(\d{1,9})\s*<\/PMID>/.exec(block)?.[1];
    if (pmid === undefined || out.has(pmid)) continue;
    const abstractXml = /<Abstract>([\s\S]*?)<\/Abstract>/.exec(block)?.[1] ?? '';
    const parts: string[] = [];
    for (const m of abstractXml.matchAll(/<AbstractText\b([^>]*)>([\s\S]*?)<\/AbstractText>/g)) {
      const text = xmlText(m[2] ?? '');
      if (!text) continue;
      const label = /\bLabel="([^"]*)"/.exec(m[1] ?? '')?.[1]?.trim();
      parts.push(label && !/^unlabelled$/i.test(label) ? `${xmlText(label)}: ${text}` : text);
    }
    const dataAt = block.indexOf('<PubmedData>');
    const own = dataAt >= 0 ? (block.slice(dataAt).split('<ReferenceList')[0] ?? '') : '';
    const ids = /<ArticleIdList>([\s\S]*?)<\/ArticleIdList>/.exec(own)?.[1] ?? '';
    const pmcRaw = /<ArticleId\s+IdType="pmc">\s*([^<]+?)\s*<\/ArticleId>/.exec(ids)?.[1];
    const pmcid = pmcRaw !== undefined ? normalizePmcid(pmcRaw) : null;
    out.set(pmid, {
      ...(parts.length > 0 ? { abstract: parts.join(' ') } : {}),
      ...(pmcid !== null ? { pmcid } : {}),
    });
  }
  return out;
}

/**
 * efetch's answers for `ids` (one request per ≤ EFETCH_BATCH): the facts per
 * PMID, and why some are missing (null when every request answered). Never
 * throws for a failed or offline-missing request (D-20-16).
 */
export async function fetchAbstracts(
  ids: readonly string[],
  opts: LookupOptions = {},
): Promise<{ facts: Map<string, PubmedArticleFacts>; failure: string | null }> {
  const facts = new Map<string, PubmedArticleFacts>();
  let failure: string | null = null;
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += EFETCH_BATCH) {
    const batch = unique.slice(i, i + EFETCH_BATCH);
    let ex: Exchange;
    try {
      ex = await get(efetchUrl(batch), EFETCH, { ...opts, maxBytes: EFETCH_MAX_BYTES });
    } catch (err) {
      if (!isOfflineEgressError(err)) throw err;
      failure ??= `${offlineLabel(err)}: no recorded fixture for the efetch request — re-run online`;
      continue;
    }
    if (ex.kind === 'failed') {
      failure ??= `efetch failed: ${ex.reason}`;
      continue;
    }
    if (ex.kind === 'status') {
      failure ??= `efetch failed: ${statusReason(ex.res)}`;
      continue;
    }
    for (const [pmid, f] of parseEfetchArticles(ex.res.body)) facts.set(pmid, f);
  }
  return { facts, failure };
}

/** The candidates with efetch's abstract and PMCID added (a PMCID esummary gave is kept). */
function withArticleFacts(candidates: SourceCandidate[], facts: ReadonlyMap<string, PubmedArticleFacts>): SourceCandidate[] {
  return candidates.map((c) => {
    const f = c.pmid !== undefined ? facts.get(c.pmid) : undefined;
    if (f === undefined) return c;
    return {
      ...c,
      ...(f.abstract !== undefined ? { abstract: f.abstract } : {}),
      ...(c.pmcid === undefined && f.pmcid !== undefined ? { pmcid: f.pmcid } : {}),
    };
  });
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
  const at = answeredAt(ex2.res);
  const records = recordsFromEsummary(JSON.parse(ex2.res.body) as { result?: Record<string, unknown> }, idlist);
  const candidates = records.map((r) => pubmedToCandidate(r, at)).filter((c): c is SourceCandidate => c !== null);
  if (candidates.length === 0) return candidates;
  // D-20-16: the abstracts — best-effort; a failure is named, never fatal.
  const { facts, failure } = await fetchAbstracts(candidates.map((c) => c.pmid).filter((x): x is string => x !== undefined));
  if (failure !== null) opts.onWarning?.(`abstracts unavailable (${failure})`);
  return withArticleFacts(candidates, facts);
}

/**
 * PubMed's answer for one PMID (`31978945`, `PMID:31978945`): found | not-found
 * | failed (reason). `refresh` skips the HTTP-cache read (VRFY-28);
 * `abstract: false` skips efetch (Pass 1 compares metadata only).
 */
export async function lookupById(id: string, opts: LookupOptions & { abstract?: boolean } = {}): Promise<LookupResult> {
  const pmid = normalizePmid(id);
  if (pmid === null) return lookupNotFound(`not a PMID: ${JSON.stringify(id.slice(0, 80))}`);
  const ex = await get(`${BASE}/esummary.fcgi?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=json`, ESUMMARY, opts);
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
  const candidate = pubmedToCandidate(rec, answeredAt(ex.res));
  if (candidate === null) return lookupFailed('the PubMed record has no title or no authors (an incomplete registrar record — asking again gives the same answer)', { status: 200, permanent: true });
  if (opts.abstract === false) return lookupFound(candidate);
  const { facts, failure } = await fetchAbstracts([pmid], opts);
  const found = withArticleFacts([candidate], facts)[0] ?? candidate;
  return lookupFound(failure === null ? found : { ...found, raw: { ...rec, abstractNote: `abstract unavailable (${failure})` } });
}

export async function fetchById(pmid: string): Promise<SourceCandidate | null> {
  return unwrapLookup(await lookupById(pmid), 'pubmed', pmid);
}
