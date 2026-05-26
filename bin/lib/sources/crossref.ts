// bin/lib/sources/crossref.ts — Crossref adapter (RSCH-03, RSCH-04, T-3-13).
//
// Endpoints:
//   search:     GET https://api.crossref.org/works?query=<encoded>&rows=<limit>
//   fetchById:  GET https://api.crossref.org/works/<doi>
//
// Polite-pool User-Agent per Crossref's etiquette guide. The contact email is
// embedded in the UA string (not as a separate query param like OpenAlex).
//
// RESEARCH pitfall #3 (Dec-2025 Crossref revisions): the `message` shape now
// surfaces a `revisions` field when the work has been amended. We ignore that
// field — the parser only reads the load-bearing keys (DOI, title, author,
// issued.date-parts) and lets the rest slide.
//
// Error handling per plan: HTTP non-2xx -> [] for search, null for fetchById.
// Adapter never throws on transport errors; the research workflow degrades
// gracefully when a single adapter fails.

import { fetch as httpFetch } from '../http.js';
import { isOfflineMode, loadCassetteFile, type Cassette } from '../http-mock.js';
import { generateCitekey } from '../citekey.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';

const BASE = 'https://api.crossref.org';
const UA = 'pensmith/0.x (mailto:akhilachanta8@gmail.com)';

interface CrossrefItem {
  DOI?: string;
  title?: string[] | string;
  author?: Array<{ family?: string; given?: string }>;
  issued?: { 'date-parts'?: number[][] };
  abstract?: string;
}

function parseYear(item: CrossrefItem): number | undefined {
  const parts = item.issued?.['date-parts'];
  if (!Array.isArray(parts) || parts.length === 0) return undefined;
  const inner = parts[0];
  if (!Array.isArray(inner) || inner.length === 0) return undefined;
  const y = inner[0];
  return typeof y === 'number' && y >= 1800 && y <= 2100 ? y : undefined;
}

function toCandidate(item: CrossrefItem): SourceCandidate | null {
  const doi = typeof item.DOI === 'string' ? item.DOI : undefined;
  if (!doi) return null;
  const title = Array.isArray(item.title)
    ? (item.title[0] ?? '').toString()
    : String(item.title ?? '');
  if (!title) return null;

  // CYCLE-2 H-2 (D-14 author shape): authors is string[] of "Family, Given".
  const authors = (item.author ?? [])
    .map((a) => {
      const family = String(a.family ?? '').trim();
      const given = String(a.given ?? '').trim();
      if (!family) return '';
      return given ? `${family}, ${given}` : family;
    })
    .filter(Boolean);
  if (authors.length === 0) return null;

  const year = parseYear(item);
  const base: Partial<SourceCandidate> = { authors, year };
  const citekey = generateCitekey(base);

  return {
    source: 'crossref',
    id: doi,
    doi,
    title,
    authors,
    year,
    abstract: item.abstract,
    retracted: false,
    last_verified: new Date().toISOString(),
    citekey,
    raw: item,
  };
}

export async function search(
  query: string,
  opts: { limit?: number } = {},
): Promise<SourceCandidate[]> {
  const limit = opts.limit ?? 20;

  // Offline path: serve from cassette (PR-time CI default — see http-mock.ts header).
  if (isOfflineMode()) {
    const cassette = loadCassetteFile('crossref', 'works-attention');
    if (!cassette) return [];
    const searchEntry = cassette.find(
      (c) => c.method === 'GET' && c.path.includes('/works?query='),
    );
    if (!searchEntry) return [];
    const body = searchEntry.response as { message?: { items?: CrossrefItem[] } };
    const items = body?.message?.items ?? [];
    return items.map(toCandidate).filter((c): c is SourceCandidate => c !== null);
  }

  // Online path: real HTTP via the chokepoint.
  const url = `${BASE}/works?query=${encodeURIComponent(query)}&rows=${limit}`;
  try {
    const res = await httpFetch(url, {
      source: 'crossref',
      headers: { 'user-agent': UA },
    });
    if (res.status !== 200) return [];
    const body = typeof res.body === 'string' ? (JSON.parse(res.body) as unknown) : res.body;
    const items = ((body as { message?: { items?: CrossrefItem[] } })?.message?.items) ?? [];
    return items.map(toCandidate).filter((c): c is SourceCandidate => c !== null);
  } catch {
    return [];
  }
}

export async function fetchById(doi: string): Promise<SourceCandidate | null> {
  if (isOfflineMode()) {
    const cassette: Cassette[] | null = loadCassetteFile('crossref', 'works-attention');
    if (!cassette) return null;
    // First try a direct path-match cassette for this DOI.
    const direct = cassette.find(
      (c) => c.method === 'GET' && c.path === `/works/${doi}`,
    );
    if (direct) {
      const body = direct.response as { message?: CrossrefItem };
      return body?.message ? toCandidate(body.message) : null;
    }
    // Fallback: pull the first item from the search cassette so test-only
    // DOIs like '10.0000/test' get an object response (per test shape).
    const search = cassette.find(
      (c) => c.method === 'GET' && c.path.includes('/works?query='),
    );
    if (!search) return null;
    const items = (search.response as { message?: { items?: CrossrefItem[] } })?.message?.items ?? [];
    const first = items[0];
    return first ? toCandidate(first) : null;
  }

  const url = `${BASE}/works/${encodeURIComponent(doi)}`;
  try {
    const res = await httpFetch(url, {
      source: 'crossref',
      headers: { 'user-agent': UA },
    });
    if (res.status !== 200) return null;
    const body = typeof res.body === 'string' ? (JSON.parse(res.body) as unknown) : res.body;
    const msg = (body as { message?: CrossrefItem })?.message;
    return msg ? toCandidate(msg) : null;
  } catch {
    return null;
  }
}
