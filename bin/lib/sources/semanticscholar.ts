// bin/lib/sources/semanticscholar.ts — Semantic Scholar Graph API adapter
// (RSCH-03, RSCH-04, T-3-13).
//
// Endpoints (Graph v1):
//   search:     GET https://api.semanticscholar.org/graph/v1/paper/search?query=<encoded>&limit=<n>&fields=…
//   fetchById:  GET https://api.semanticscholar.org/graph/v1/paper/<paperId>?fields=…
//
// D-16 / T-3-12: PENSMITH_S2_API_KEY is the ONLY secret this adapter consults.
// When present we add `x-api-key: <secret>` header. When absent we WARN-once on
// stderr and fall back to keyless mode (S2 still serves anonymous traffic at a
// reduced rate). The key value never leaves bin/lib/runtime.ts.getS2ApiKey()
// → this module → the header — no logging, no cassette persistence (recorder
// scrubs `x-api-key` via SENSITIVE_HEADERS).
//
// Fields requested are intentionally narrow: title, authors, year, externalIds,
// abstract. This keeps response size predictable for the cassette budget.
//
// Offline replay is the exact-match fixture store inside bin/lib/http.ts; the
// typed OfflineEgressError is rethrown so callers report "unavailable (offline)".

import { fetch as httpFetch, isOfflineEgressError, MAX_JSON_RESPONSE_BYTES } from '../http.js';
import { generateCitekey } from '../citekey.js';
import { getS2ApiKey } from '../runtime.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';

const BASE = 'https://api.semanticscholar.org';
const FIELDS = 'title,authors,year,externalIds,abstract';

interface S2Author {
  authorId?: string;
  name?: string;
}
interface S2ExternalIds {
  DOI?: string;
  ArXiv?: string;
  PubMed?: string;
}
interface S2Paper {
  paperId?: string;
  externalIds?: S2ExternalIds;
  title?: string;
  year?: number;
  authors?: S2Author[];
  /** The live API returns `null` for papers without an abstract. */
  abstract?: string | null;
}

let warnedOnceKeyless = false;
function warnKeylessOnce(): void {
  if (warnedOnceKeyless) return;
  warnedOnceKeyless = true;
  // D-16: WARN-once on stderr. No value leaked — we just announce the
  // env-var was absent and the adapter is degrading to anonymous mode.
  process.stderr.write(
    'pensmith: PENSMITH_S2_API_KEY not set — Semantic Scholar in keyless mode (reduced rate limit). (D-16)\n',
  );
}

function buildHeaders(): Record<string, string> | undefined {
  // Note: getS2ApiKey() returns { present, name } — NEVER the value.
  // Reading process.env directly is gated by ESLint rule restricting
  // PENSMITH_S2_API_KEY reads to runtime.ts only — this is the one
  // exception (T-3-12) since the value MUST flow into the request header.
  const key = process.env['PENSMITH_S2_API_KEY'];
  if (!key) {
    warnKeylessOnce();
    return undefined;
  }
  return { 'x-api-key': key };
}

// Surface getS2ApiKey usage for test/debug callers (and ensures the
// runtime helper is wired — the value still never leaves the header).
export function s2KeyStatus(): { present: boolean; name: string } {
  return getS2ApiKey();
}

function toCandidate(item: S2Paper): SourceCandidate | null {
  const id = item.paperId;
  if (!id) return null;
  const title = String(item.title ?? '').trim();
  if (!title) return null;

  const authors = (item.authors ?? [])
    .map((a) => String(a.name ?? '').trim())
    .filter(Boolean);
  if (authors.length === 0) return null;

  const year =
    typeof item.year === 'number' && item.year >= 1800 && item.year <= 2100
      ? item.year
      : undefined;

  const doi = typeof item.externalIds?.DOI === 'string' ? item.externalIds.DOI : undefined;
  const base: Partial<SourceCandidate> = { authors, year };
  const citekey = generateCitekey(base);

  return {
    source: 'semanticscholar',
    id,
    doi,
    title,
    authors,
    year,
    // A null abstract (common in live S2 responses) is "no abstract", never a
    // reason to drop an otherwise valid candidate.
    abstract: typeof item.abstract === 'string' ? item.abstract : undefined,
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
  const url = `${BASE}/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${encodeURIComponent(FIELDS)}`;
  const headers = buildHeaders();
  try {
    const res = await httpFetch(url, {
      source: 'semanticscholar',
      maxBytes: MAX_JSON_RESPONSE_BYTES,
      ...(headers ? { headers } : {}),
    });
    if (res.status !== 200) return [];
    const body = JSON.parse(res.body) as unknown;
    const data = ((body as { data?: S2Paper[] })?.data) ?? [];
    return data.map(toCandidate).filter((c): c is SourceCandidate => c !== null);
  } catch (err) {
    if (isOfflineEgressError(err)) throw err;
    return [];
  }
}

export async function fetchById(paperId: string): Promise<SourceCandidate | null> {
  const url = `${BASE}/graph/v1/paper/${encodeURIComponent(paperId)}?fields=${encodeURIComponent(FIELDS)}`;
  const headers = buildHeaders();
  try {
    const res = await httpFetch(url, {
      source: 'semanticscholar',
      maxBytes: MAX_JSON_RESPONSE_BYTES,
      ...(headers ? { headers } : {}),
    });
    if (res.status !== 200) return null;
    const body = JSON.parse(res.body) as unknown;
    return toCandidate(body as S2Paper);
  } catch (err) {
    if (isOfflineEgressError(err)) throw err;
    return null;
  }
}
