// bin/lib/sources/arxiv.ts — arXiv adapter.
//
// Endpoints:
//   search:      GET https://export.arxiv.org/api/query?search_query=<encoded>&max_results=20
//   fetchById /
//   lookupArxiv: GET https://export.arxiv.org/api/query?id_list=<arxiv-id>
//
// Atom-XML response. We parse with a tiny regex-based extractor instead of
// pulling in fast-xml-parser / xml2js — keeps zero extra deps and the shape
// is simple/stable (entry > id|title|published|author>name|arxiv:doi).
//
// arXiv has no polite pool and no key. Its terms ask for at most one request
// every three seconds, which bin/lib/http.ts enforces for this source.
//
// An unknown ID gives an empty feed; a malformed one gives HTTP 400 and an
// entry whose id is an api/errors link. Neither is a paper.

import { fetch as httpFetch } from '../http.js';
import { generateCitekey } from '../citekey.js';
import { displayName, parseDisplayName, presentNames } from '../author-normalize.js';
import { arxivFromLink, bareArxivId } from '../doi.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';
import { askRegistry, unavailable, yearOf, type Lookup, type WorkRecord } from './work-record.js';

// https only: search terms and IDs must never travel in cleartext.
const BASE = 'https://export.arxiv.org';

interface ArxivEntry {
  id: string;
  title: string;
  published: string | undefined;
  updated: string | undefined;
  authors: string[];
  doi: string | undefined;
  summary: string | undefined;
}

// Helper: pull all <tag>…</tag> blocks. `s` flag = . matches \n.
function extractAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (typeof m[1] === 'string') out.push(m[1]);
  }
  return out;
}

function extractOne(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`);
  const m = xml.match(re);
  return m?.[1];
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function parseEntry(entryXml: string): ArxivEntry | null {
  const idRaw = extractOne(entryXml, 'id');
  if (!idRaw) return null;
  const id = decodeXmlEntities(idRaw);

  const titleRaw = extractOne(entryXml, 'title');
  if (!titleRaw) return null;
  const title = decodeXmlEntities(titleRaw).replace(/\s+/g, ' ');

  const publishedRaw = extractOne(entryXml, 'published');
  const published = publishedRaw ? decodeXmlEntities(publishedRaw) : undefined;
  const updatedRaw = extractOne(entryXml, 'updated');
  const updated = updatedRaw ? decodeXmlEntities(updatedRaw) : undefined;

  // <author><name>…</name></author>: extract all <name> tags inside <author>.
  const authorBlocks = extractAll(entryXml, 'author');
  const authors = authorBlocks
    .map((block) => {
      const name = extractOne(block, 'name');
      return name ? decodeXmlEntities(name) : '';
    })
    .filter(Boolean);

  // arxiv:doi is a namespaced tag — the colon escapes fine in a regex literal.
  const doiRaw = extractOne(entryXml, 'arxiv:doi');
  const doi = doiRaw ? decodeXmlEntities(doiRaw) : undefined;
  const summaryRaw = extractOne(entryXml, 'summary');
  const summary = summaryRaw ? decodeXmlEntities(summaryRaw).replace(/\s+/g, ' ') : undefined;

  return { id, title, published, updated, authors, doi, summary };
}

// The id of the error entry arXiv answers a malformed ID with.
const ARXIV_ERROR = /\/api\/errors/;

/** The error entry arXiv returns for a malformed ID is not a paper. */
function isErrorEntry(e: ArxivEntry): boolean {
  return ARXIV_ERROR.test(e.id);
}

function toCandidate(entry: ArxivEntry): SourceCandidate | null {
  if (!entry.id || !entry.title) return null;
  if (entry.authors.length === 0) return null;

  // Year extracted from ISO published date (YYYY-MM-DDTHH:MM:SSZ).
  let year: number | undefined;
  if (entry.published) {
    const m = entry.published.match(/^(\d{4})-/);
    if (m && m[1]) {
      const y = Number(m[1]);
      if (y >= 1800 && y <= 2100) year = y;
    }
  }

  // arXiv has display names only ("Ashish Vaswani"), split here.
  const names = presentNames(entry.authors.map(parseDisplayName));
  if (names.length === 0) return null;
  const authors = names.map(displayName);
  const citekey = generateCitekey({ authors, year });
  const arxiv = bareArxivId(arxivFromLink(entry.id));

  return {
    source: 'arxiv',
    id: entry.id,
    doi: entry.doi,
    title: entry.title,
    authors,
    names,
    year,
    ...(arxiv ? { arxiv, url: `https://arxiv.org/abs/${arxiv}` } : {}),
    ...(entry.summary ? { abstract: entry.summary } : {}),
    csl_type: 'article',
    publisher: 'arXiv',
    retracted: false,
    last_verified: new Date().toISOString(),
    citekey,
    raw: entry,
  };
}

// CR-05 fix: hard per-adapter size cap. The `extractAll` regex is lazy
// (linear on well-formed input) but a malformed feed without a closing
// </entry> can devolve into O(n²) backtracking on huge bodies. Cap at
// 10 MB — real arXiv ATOM responses for a 50-result query are < 200 KB.
// TODO: add an upstream MAX_RESPONSE_BYTES cap inside bin/lib/http.ts.callOnce
// (deferred — out of scope for this fix pass; see REVIEW.md CR-05).
const ARXIV_MAX_BODY_BYTES = 10_000_000;

function parseFeed(xml: string): SourceCandidate[] {
  if (xml.length > ARXIV_MAX_BODY_BYTES) {
    process.stderr.write(
      `[arxiv] feed body exceeds ${ARXIV_MAX_BODY_BYTES} bytes (got ${xml.length}); bailing (CR-05)\n`,
    );
    return [];
  }
  return parseEntries(xml)
    .map(toCandidate)
    .filter((c): c is SourceCandidate => c !== null);
}

function parseEntries(xml: string): ArxivEntry[] {
  return extractAll(xml, 'entry')
    .map(parseEntry)
    .filter((e): e is ArxivEntry => e !== null && !isErrorEntry(e));
}

export async function search(
  query: string,
  opts: { limit?: number } = {},
): Promise<SourceCandidate[]> {
  const limit = opts.limit ?? 20;
  const url = `${BASE}/api/query?search_query=${encodeURIComponent(query)}&max_results=${limit}`;
  try {
    const res = await httpFetch(url, { source: 'arxiv' });
    if (res.status !== 200) return [];
    const body = typeof res.body === 'string' ? res.body : String(res.body ?? '');
    return parseFeed(body);
  } catch {
    return [];
  }
}

/**
 * The first research candidate of arXiv's feed for `id`, read as search()
 * reads a feed, or null when there is none or arXiv could not be asked.
 * Pass 1 does not use this: it asks lookupArxiv, which tells "no such paper"
 * from "no answer".
 */
export async function fetchById(id: string): Promise<SourceCandidate | null> {
  const url = `${BASE}/api/query?id_list=${encodeURIComponent(id)}`;
  try {
    const res = await httpFetch(url, { source: 'arxiv' });
    if (res.status !== 200) return null;
    const body = typeof res.body === 'string' ? res.body : String(res.body ?? '');
    return parseFeed(body)[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Ask arXiv for the paper with `id` (`1706.03762`, `cs.CL/0301012`, with or
 * without a version). An empty feed or arXiv's error entry is not_found; any
 * other failure is unavailable.
 */
export async function lookupArxiv(id: string): Promise<Lookup> {
  const url = `${BASE}/api/query?id_list=${encodeURIComponent(id)}`;
  return askRegistry('arXiv', url, { source: 'arxiv' }, (res) => {
    const body = res.body;
    if (res.status !== 200 && !(res.status === 400 && ARXIV_ERROR.test(body))) return null;
    if (body.length > ARXIV_MAX_BODY_BYTES || !/<feed\b/.test(body)) return unavailable('arXiv', 'unreadable response');
    const entry = parseEntries(body)[0];
    if (!entry) return { kind: 'not_found', registry: 'arXiv', authoritative: true };
    // A preprint is dated by its first version and by later ones; a
    // bibliography may give either year.
    const years = [yearOf(entry.published), yearOf(entry.updated)].filter((y): y is number => y !== undefined);
    const record: WorkRecord = {
      registry: 'arXiv',
      title: entry.title,
      authors: entry.authors.map((text) => ({ text })),
      years: [...new Set(years)],
      venues: [],
      journalArticle: false,
      raw: entry,
    };
    return { kind: 'found', registry: 'arXiv', record };
  });
}
