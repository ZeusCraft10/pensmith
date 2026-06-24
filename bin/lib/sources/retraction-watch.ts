// bin/lib/sources/retraction-watch.ts — Retraction Watch side-channel filter
// (T-3-13, D-15 LOCKED).
//
// D-15 LOCKED: this adapter exposes `fetchById` ONLY — no `search` export.
// Retraction Watch is NOT a discovery source; it is a post-hoc filter the
// verifier consults to mark already-discovered candidates as retracted.
// Surfacing a search() would invite call sites to use it as a primary
// discovery channel, which would (a) burn the Crossref Labs polite-pool
// for noise, and (b) couple retraction-status fan-out into the discovery
// path where it doesn't belong (the verifier's job).
//
// The ESLint chokepoint (eslint.config.js) backstops this with a no-export
// rule on `bin/lib/sources/retraction-watch.ts`; the matching test
// `tests/sources/retraction-watch.test.ts` asserts `adapter.search === undefined`.
//
// Endpoint:
//   fetchById:  GET https://api.labs.crossref.org/data/retractions?filter=record:<doi>

import { fetch as httpFetch } from '../http.js';
import { isOfflineMode, loadCassetteDir } from '../http-mock.js';
import { generateCitekey } from '../citekey.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';

const BASE = 'https://api.labs.crossref.org';

interface RWAuthor {
  given?: string;
  family?: string;
}
interface RWItem {
  doi?: string;
  title?: string;
  authors?: RWAuthor[];
  year?: number;
  retractedDate?: string;
  reason?: string;
}
interface RWResponse {
  items?: RWItem[];
}

function toCandidate(item: RWItem): SourceCandidate | null {
  const doi = item.doi;
  if (!doi) return null;
  const title = String(item.title ?? '').trim();
  if (!title) return null;

  const authors = (item.authors ?? [])
    .map((a) => {
      const family = String(a.family ?? '').trim();
      const given = String(a.given ?? '').trim();
      if (!family) return '';
      return given ? `${family}, ${given}` : family;
    })
    .filter(Boolean);
  if (authors.length === 0) return null;

  const year =
    typeof item.year === 'number' && item.year >= 1800 && item.year <= 2100
      ? item.year
      : undefined;

  const retractedDate = item.retractedDate ? String(item.retractedDate) : undefined;
  const reason = item.reason ? String(item.reason) : undefined;
  const retraction_details = retractedDate && reason
    ? `${retractedDate}: ${reason}`
    : (retractedDate ?? reason);

  const base: Partial<SourceCandidate> = { authors, year };
  const citekey = generateCitekey(base);

  return {
    source: 'retraction-watch',
    id: doi,
    doi,
    title,
    authors,
    year,
    retracted: true, // D-15 surface-twice: discovery via this adapter == retracted.
    retraction_details,
    last_verified: new Date().toISOString(),
    citekey,
    raw: item,
  };
}

/**
 * D-15 LOCKED: Retraction Watch is fetchById-only. The lookup queries
 * Crossref Labs' retractions index, filtered by DOI. Returns a fully-formed
 * SourceCandidate with retracted=true when the DOI is on the retraction
 * list, or null when it isn't.
 */
export async function fetchById(doi: string): Promise<SourceCandidate | null> {
  if (isOfflineMode()) {
    // Scan ALL committed retraction-watch cassettes for a direct DOI match.
    // Using loadCassetteDir (not a single fetchById-fake file) ensures new per-DOI
    // cassettes (e.g. gate03-blocking-doi.json) are found without changing this code.
    // Only a DIRECT path match (filter=record:<doi>) returns a hit; there is NO
    // fallback to the first-any-retractions entry — that fallback caused false positives
    // for DOIs not present in any cassette (GATE-03 blocking test deviation fix).
    const cassettes = loadCassetteDir('retraction-watch');
    // Treat an empty cassette array the same as a missing directory (null).
    // loadCassetteDir returns [] when the directory exists but has no .json files;
    // allowing [] through causes every DOI to look un-retracted (silent GATE-03
    // bypass) in an environment where the cassette dir was created but files deleted.
    if (!cassettes || cassettes.length === 0) return null;
    const direct = cassettes.find(
      (c) => c.method === 'GET' && c.path.includes(`filter=record:${doi}`),
    );
    if (!direct) return null;
    const body = direct.response as RWResponse;
    const first = body.items?.[0];
    return first ? toCandidate(first) : null;
  }

  const url = `${BASE}/data/retractions?filter=record:${encodeURIComponent(doi)}`;
  try {
    const res = await httpFetch(url, { source: 'retraction-watch' });
    if (res.status !== 200) return null;
    const body = typeof res.body === 'string' ? (JSON.parse(res.body) as unknown) : res.body;
    const items = (body as RWResponse)?.items ?? [];
    const first = items[0];
    return first ? toCandidate(first) : null;
  } catch {
    return null;
  }
}
