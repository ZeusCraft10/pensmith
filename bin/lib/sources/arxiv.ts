// bin/lib/sources/arxiv.ts — arXiv adapter (RSCH-03, RSCH-04, T-3-13).
//
// Endpoints:
//   search:     GET http://export.arxiv.org/api/query?search_query=<encoded>&max_results=20
//   fetchById:  GET http://export.arxiv.org/api/query?id_list=<arxiv-id>
//
// Atom-XML response. We parse with a tiny regex-based extractor instead of
// pulling in fast-xml-parser / xml2js — keeps zero extra deps and the shape
// is simple/stable (entry > id|title|published|author>name|arxiv:doi).
//
// RESEARCH note: arXiv has no polite-pool, no auth — the only courtesy is
// the documented 3-second rate limit which our chokepoint (bin/lib/http.ts)
// already enforces per-source.

import { fetch as httpFetch } from '../http.js';
import { isOfflineMode, loadCassetteFile } from '../http-mock.js';
import { generateCitekey } from '../citekey.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';

const BASE = 'http://export.arxiv.org';

interface ArxivEntry {
  id: string;
  title: string;
  published: string | undefined;
  authors: string[];
  doi: string | undefined;
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

  return { id, title, published, authors, doi };
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

  // arXiv emits "Given Family" display names. We keep them as-is —
  // author-normalize handles given-first form.
  const base: Partial<SourceCandidate> = { authors: entry.authors, year };
  const citekey = generateCitekey(base);

  return {
    source: 'arxiv',
    id: entry.id,
    doi: entry.doi,
    title: entry.title,
    authors: entry.authors,
    year,
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
  const entries = extractAll(xml, 'entry');
  return entries
    .map(parseEntry)
    .filter((e): e is ArxivEntry => e !== null)
    .map(toCandidate)
    .filter((c): c is SourceCandidate => c !== null);
}

export async function search(
  query: string,
  opts: { limit?: number } = {},
): Promise<SourceCandidate[]> {
  const limit = opts.limit ?? 20;
  if (isOfflineMode()) {
    const cassette = loadCassetteFile('arxiv', 'query-attention');
    if (!cassette) return [];
    const searchEntry = cassette.find(
      (c) => c.method === 'GET' && c.path.includes('search_query='),
    );
    if (!searchEntry) return [];
    const body = String(searchEntry.response ?? '');
    return parseFeed(body);
  }

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

export async function fetchById(id: string): Promise<SourceCandidate | null> {
  if (isOfflineMode()) {
    const cassette = loadCassetteFile('arxiv', 'query-attention');
    if (!cassette) return null;
    // Direct match on id_list=<id>
    const direct = cassette.find(
      (c) => c.method === 'GET' && c.path.includes(`id_list=${id}`),
    );
    if (direct) {
      const body = String(direct.response ?? '');
      const results = parseFeed(body);
      return results[0] ?? null;
    }
    // Fallback: first entry from the search cassette.
    const searchEntry = cassette.find(
      (c) => c.method === 'GET' && c.path.includes('search_query='),
    );
    if (!searchEntry) return null;
    const body = String(searchEntry.response ?? '');
    const results = parseFeed(body);
    return results[0] ?? null;
  }

  const url = `${BASE}/api/query?id_list=${encodeURIComponent(id)}`;
  try {
    const res = await httpFetch(url, { source: 'arxiv' });
    if (res.status !== 200) return null;
    const body = typeof res.body === 'string' ? res.body : String(res.body ?? '');
    const results = parseFeed(body);
    return results[0] ?? null;
  } catch {
    return null;
  }
}
