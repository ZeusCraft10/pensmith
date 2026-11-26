// bin/lib/sources/pubmed.ts — PubMed E-utilities adapter (RSCH-03, RSCH-04, T-3-13).
//
// Endpoints (two-step search, single-step fetchById):
//   search step 1: GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=<encoded>&retmode=json&retmax=20
//                  -> .esearchresult.idlist: string[] of PMIDs
//   search step 2: GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=<csv>&retmode=json
//                  -> .result.<pmid> objects
//   fetchById:     GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=<pmid>&retmode=json
//
// PubMed authors come as a surname and initials, "Wakefield AJ" (no comma);
// author-normalize.ts parsePubmedName reads them as family "Wakefield", given
// "A. J.". A collective author is kept whole.
//
// RESEARCH pitfall: pubdate is a loose string like "2019 Jul" or "2020 May 12".
// Year extraction = first 4-digit token only.

import { fetch as httpFetch } from '../http.js';
import { generateCitekey } from '../citekey.js';
import { displayName, parsePubmedName, presentNames } from '../author-normalize.js';
import { normalizePmcid } from '../doi.js';
import type { CslName, SourceCandidate } from '../schemas/source-candidate.js';
import { askRegistry, definedFields, firstString, unavailable, type Lookup, type WorkName, type WorkRecord } from './work-record.js';

const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

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
  title?: string;
  authors?: PubmedAuthor[];
  pubdate?: string;
  epubdate?: string;
  source?: string;
  fulljournalname?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  articleids?: PubmedArticleId[];
  /** Set instead of the fields above when the PMID does not exist. */
  error?: string;
}

function parseYear(pubdate: string | undefined): number | undefined {
  if (!pubdate) return undefined;
  const m = pubdate.match(/(\d{4})/);
  if (!m || !m[1]) return undefined;
  const y = Number(m[1]);
  return y >= 1800 && y <= 2100 ? y : undefined;
}

/** The article ID of type `idtype` ('doi', 'pmc'), or undefined. */
function articleId(rec: PubmedRecord, idtype: string): string | undefined {
  for (const id of rec.articleids ?? []) {
    if (id.idtype === idtype && typeof id.value === 'string' && id.value) return id.value;
  }
  return undefined;
}

/** A PubMed author as a CSL name: a collective name whole, a person as surname and initials. */
function cslName(a: PubmedAuthor): CslName | null {
  const name = String(a.name ?? '').trim();
  if (!name) return null;
  return a.authtype === 'CollectiveName' ? { literal: name } : parsePubmedName(name);
}

function toCandidate(rec: PubmedRecord): SourceCandidate | null {
  const pmid = rec.uid;
  if (!pmid) return null;
  const title = String(rec.title ?? '').trim();
  if (!title) return null;

  const names = presentNames((rec.authors ?? []).map(cslName));
  if (names.length === 0) return null;
  const authors = names.map(displayName);

  const year = parseYear(rec.pubdate);
  const doi = articleId(rec, 'doi');
  const citekey = generateCitekey({ authors, year });
  const pmcid = normalizePmcid(articleId(rec, 'pmc') ?? '');

  return {
    source: 'pubmed',
    id: pmid,
    doi,
    title,
    authors,
    names,
    year,
    pmid,
    ...(pmcid ? { pmcid } : {}),
    csl_type: 'article-journal',
    ...definedFields({
      // NLM adds a place to some journal names ("Lancet (London, England)").
      container_title: firstString(rec.fulljournalname?.replace(/\s*\([^()]*\)\s*$/, '')) ?? firstString(rec.source),
      volume: firstString(rec.volume),
      issue: firstString(rec.issue),
      page: firstString(rec.pages),
    }),
    retracted: false,
    last_verified: new Date().toISOString(),
    citekey,
    raw: rec,
  };
}

interface EsearchResponse {
  esearchresult?: { idlist?: string[] };
}
interface EsummaryResponse {
  result?: Record<string, unknown> & { uids?: string[] };
}

function recordsFromEsummary(body: EsummaryResponse, ids: string[]): PubmedRecord[] {
  const result = body.result ?? {};
  const records: PubmedRecord[] = [];
  for (const id of ids) {
    const rec = result[id];
    if (rec && typeof rec === 'object') {
      records.push(rec as PubmedRecord);
    }
  }
  return records;
}

export async function search(
  query: string,
  opts: { limit?: number } = {},
): Promise<SourceCandidate[]> {
  const limit = opts.limit ?? 20;
  // Two-step request via the chokepoint.
  const esearchUrl = `${BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retmax=${limit}`;
  try {
    const res1 = await httpFetch(esearchUrl, { source: 'pubmed' });
    if (res1.status !== 200) return [];
    const body1 = typeof res1.body === 'string' ? (JSON.parse(res1.body) as unknown) : res1.body;
    const idlist = ((body1 as EsearchResponse)?.esearchresult?.idlist) ?? [];
    if (idlist.length === 0) return [];

    const idCsv = idlist.join(',');
    const esummaryUrl = `${BASE}/esummary.fcgi?db=pubmed&id=${encodeURIComponent(idCsv)}&retmode=json`;
    const res2 = await httpFetch(esummaryUrl, { source: 'pubmed' });
    if (res2.status !== 200) return [];
    const body2 = typeof res2.body === 'string' ? (JSON.parse(res2.body) as unknown) : res2.body;
    const records = recordsFromEsummary(body2 as EsummaryResponse, idlist);
    return records.map(toCandidate).filter((c): c is SourceCandidate => c !== null);
  } catch {
    return [];
  }
}

/**
 * The PubMed article with `pmid` as a research candidate, read as search()
 * reads an esummary record, or null when there is none or PubMed could not be
 * asked. Pass 1 does not use this: it asks lookupPmid, which tells "no such
 * paper" from "no answer".
 */
export async function fetchById(pmid: string): Promise<SourceCandidate | null> {
  const url = `${BASE}/esummary.fcgi?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=json`;
  try {
    const res = await httpFetch(url, { source: 'pubmed' });
    if (res.status !== 200) return null;
    const body = typeof res.body === 'string' ? (JSON.parse(res.body) as unknown) : res.body;
    const first = recordsFromEsummary(body as EsummaryResponse, [pmid])[0];
    return first ? toCandidate(first) : null;
  } catch {
    return null;
  }
}

/** A PubMed author: "Vaswani A" (surname, then initials) or a collective name. */
function pubmedName(a: PubmedAuthor): WorkName | null {
  const name = String(a.name ?? '').trim();
  if (!name) return null;
  return a.authtype === 'CollectiveName' ? { literal: name } : { text: name };
}

/**
 * Ask PubMed for the article with `pmid`. esummary answers an unknown PMID
 * with an `error` entry under that PMID, which is not_found. A top-level
 * `error` is about the request (a rate limit, a refused parameter), not the
 * PMID, so it is unavailable like any other failure.
 */
export async function lookupPmid(pmid: string): Promise<Lookup> {
  const url = `${BASE}/esummary.fcgi?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=json`;
  return askRegistry('PubMed', url, { source: 'pubmed' }, (res) => {
    if (res.status !== 200) return null;
    const body = JSON.parse(res.body) as EsummaryResponse & { error?: string };
    if (typeof body.error === 'string') return unavailable('PubMed', body.error.slice(0, 120));
    const rec = recordsFromEsummary(body, [pmid])[0];
    if (rec?.error) return { kind: 'not_found', registry: 'PubMed', authoritative: true };
    const title = String(rec?.title ?? '').trim();
    if (!rec || !title) return null;
    const years = [parseYear(rec.pubdate), parseYear(rec.epubdate)].filter((y): y is number => y !== undefined);
    const record: WorkRecord = {
      registry: 'PubMed',
      title,
      authors: (rec.authors ?? []).map(pubmedName).filter((n): n is WorkName => n !== null),
      years: [...new Set(years)],
      venues: [rec.fulljournalname, rec.source].filter((v): v is string => typeof v === 'string' && v.trim() !== ''),
      journalArticle: true,
      raw: rec,
    };
    const doi = articleId(rec, 'doi');
    if (doi) record.doi = doi;
    return { kind: 'found', registry: 'PubMed', record };
  });
}
