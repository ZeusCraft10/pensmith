// bin/lib/sources/pubmed.ts — PubMed E-utilities adapter (RSCH-03, RSCH-04, T-3-13).
//
// Endpoints (two-step search, single-step fetchById):
//   search step 1: GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=<encoded>&retmode=json&retmax=20
//                  -> .esearchresult.idlist: string[] of PMIDs
//   search step 2: GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=<csv>&retmode=json
//                  -> .result.<pmid> objects
//   fetchById:     GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=<pmid>&retmode=json
//
// PubMed authors come in surname-first compact form: "Vaswani A" (NO comma).
// We pass through as-is — bin/lib/author-normalize.ts handles both
// "Family, Given" AND single-token "Family I" forms.
//
// RESEARCH pitfall: pubdate is a loose string like "2019 Jul" or "2020 May 12".
// Year extraction = first 4-digit token only.

import { fetch as httpFetch } from '../http.js';
import { isOfflineMode, loadCassetteFile } from '../http-mock.js';
import { generateCitekey } from '../citekey.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';

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
  articleids?: PubmedArticleId[];
}

function parseYear(pubdate: string | undefined): number | undefined {
  if (!pubdate) return undefined;
  const m = pubdate.match(/(\d{4})/);
  if (!m || !m[1]) return undefined;
  const y = Number(m[1]);
  return y >= 1800 && y <= 2100 ? y : undefined;
}

function extractDoi(rec: PubmedRecord): string | undefined {
  const ids = rec.articleids ?? [];
  for (const id of ids) {
    if (id.idtype === 'doi' && typeof id.value === 'string' && id.value) {
      return id.value;
    }
  }
  return undefined;
}

function toCandidate(rec: PubmedRecord): SourceCandidate | null {
  const pmid = rec.uid;
  if (!pmid) return null;
  const title = String(rec.title ?? '').trim();
  if (!title) return null;

  const authors = (rec.authors ?? [])
    .map((a) => String(a.name ?? '').trim())
    .filter(Boolean);
  if (authors.length === 0) return null;

  const year = parseYear(rec.pubdate);
  const doi = extractDoi(rec);

  const base: Partial<SourceCandidate> = { authors, year };
  const citekey = generateCitekey(base);

  return {
    source: 'pubmed',
    id: pmid,
    doi,
    title,
    authors,
    year,
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
  if (isOfflineMode()) {
    // Step 1: cassette for esearch.
    const esearchCassette = loadCassetteFile('pubmed', 'esearch-attention');
    if (!esearchCassette) return [];
    const esearchEntry = esearchCassette.find(
      (c) => c.method === 'GET' && c.path.includes('esearch.fcgi'),
    );
    if (!esearchEntry) return [];
    const idlist = (esearchEntry.response as EsearchResponse)?.esearchresult?.idlist ?? [];
    if (idlist.length === 0) return [];

    // Step 2: cassette for esummary.
    const esummaryCassette = loadCassetteFile('pubmed', 'esummary-attention');
    if (!esummaryCassette) return [];
    // Match the cassette entry whose id-list contains our first PMID.
    const wantedId = idlist[0];
    const esummaryEntry = esummaryCassette.find(
      (c) =>
        c.method === 'GET' &&
        c.path.includes('esummary.fcgi') &&
        typeof wantedId === 'string' &&
        c.path.includes(`id=${wantedId}`),
    ) ?? esummaryCassette.find(
      (c) => c.method === 'GET' && c.path.includes('esummary.fcgi'),
    );
    if (!esummaryEntry) return [];
    const records = recordsFromEsummary(esummaryEntry.response as EsummaryResponse, idlist);
    return records.map(toCandidate).filter((c): c is SourceCandidate => c !== null);
  }

  // Online path: two-step request via the chokepoint.
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

export async function fetchById(pmid: string): Promise<SourceCandidate | null> {
  if (isOfflineMode()) {
    const cassette = loadCassetteFile('pubmed', 'esummary-attention');
    if (!cassette) return null;
    // Direct cassette match: an esummary entry whose path contains id=<pmid>.
    const direct = cassette.find(
      (c) => c.method === 'GET' && c.path.includes(`id=${pmid}`),
    );
    if (direct) {
      const records = recordsFromEsummary(direct.response as EsummaryResponse, [pmid]);
      const first = records[0];
      return first ? toCandidate(first) : null;
    }
    // Fallback: first record from the first esummary cassette entry.
    const fallback = cassette.find(
      (c) => c.method === 'GET' && c.path.includes('esummary.fcgi'),
    );
    if (!fallback) return null;
    const body = fallback.response as EsummaryResponse;
    const uids = body.result?.uids ?? [];
    const first = uids[0];
    if (!first) return null;
    const records = recordsFromEsummary(body, [first]);
    const rec = records[0];
    return rec ? toCandidate(rec) : null;
  }

  const url = `${BASE}/esummary.fcgi?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=json`;
  try {
    const res = await httpFetch(url, { source: 'pubmed' });
    if (res.status !== 200) return null;
    const body = typeof res.body === 'string' ? (JSON.parse(res.body) as unknown) : res.body;
    const records = recordsFromEsummary(body as EsummaryResponse, [pmid]);
    const first = records[0];
    return first ? toCandidate(first) : null;
  } catch {
    return null;
  }
}
