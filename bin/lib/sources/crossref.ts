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
// Transport errors degrade the same way, EXCEPT the typed OfflineEgressError
// (sources-offline fixture miss or --dry-run), which is rethrown so callers can
// say "unavailable (offline | dry-run)" instead of "not found" (RUN-03/RUN-04).
// There is no adapter-level offline branch: offline replay is the exact-match
// fixture store inside bin/lib/http.ts (D-06, D-17-06), never a first-item
// fallback.
//
// `select=` keeps search responses small (the fields toCandidate reads), which
// also keeps recorded fixtures under the 51200-byte cap.

import { fetch as httpFetch, isOfflineEgressError, MAX_JSON_RESPONSE_BYTES } from '../http.js';
import { errorFailureReason, httpFailureReason, type SearchOptions } from './search-failure.js';
import { generateCitekey } from '../citekey.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';

const BASE = 'https://api.crossref.org';
// CR-03 fix: remove module-level hard-coded UA. bin/lib/http.ts already
// owns the polite-pool UA — it reads PENSMITH_CONTACT_EMAIL at request
// time and warns once when unset.

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

/** The Crossref fields toCandidate reads (search responses only; /works/{doi} has no select). */
const SEARCH_SELECT = 'DOI,title,author,issued,abstract,container-title,type';

export async function search(
  query: string,
  opts: SearchOptions = {},
): Promise<SourceCandidate[]> {
  const limit = opts.limit ?? 20;
  const url = `${BASE}/works?query=${encodeURIComponent(query)}&rows=${limit}&select=${encodeURIComponent(SEARCH_SELECT)}`;
  try {
    const res = await httpFetch(url, { source: 'crossref', maxBytes: MAX_JSON_RESPONSE_BYTES });
    if (res.status !== 200) {
      opts.onFailure?.(httpFailureReason(res.status));
      return [];
    }
    const body = JSON.parse(res.body) as unknown;
    const items = ((body as { message?: { items?: CrossrefItem[] } })?.message?.items) ?? [];
    return items.map(toCandidate).filter((c): c is SourceCandidate => c !== null);
  } catch (err) {
    if (isOfflineEgressError(err)) throw err;
    opts.onFailure?.(errorFailureReason(err));
    return [];
  }
}

export async function fetchById(doi: string): Promise<SourceCandidate | null> {
  const url = `${BASE}/works/${encodeURIComponent(doi)}`;
  try {
    const res = await httpFetch(url, { source: 'crossref', maxBytes: MAX_JSON_RESPONSE_BYTES });
    if (res.status !== 200) return null;
    const body = JSON.parse(res.body) as unknown;
    const msg = (body as { message?: CrossrefItem })?.message;
    return msg ? toCandidate(msg) : null;
  } catch (err) {
    if (isOfflineEgressError(err)) throw err;
    return null;
  }
}
