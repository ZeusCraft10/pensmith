// bin/lib/sources/retraction-watch.ts — Retraction Watch side-channel filter
// (T-3-13, D-15 LOCKED).
//
// D-15 LOCKED: this adapter exposes `fetchById` ONLY — no `search` export.
// Retraction Watch is NOT a discovery source; it is a post-hoc filter the
// verifier consults to mark already-discovered candidates as retracted.
// Surfacing a search() would invite call sites to use it as a primary
// discovery channel, which would (a) burn the Crossref polite pool for noise,
// and (b) couple retraction-status fan-out into the discovery path where it
// doesn't belong (the verifier's job).
//
// The ESLint chokepoint (eslint.config.js) backstops this with a no-export
// rule on `bin/lib/sources/retraction-watch.ts`; the matching test
// `tests/sources/retraction-watch.test.ts` asserts `adapter.search === undefined`.
//
// Endpoint (CI-07; the retraction lookup of SRC-04, pulled forward because
// Phase 17 makes the network live by default):
//   fetchById:  GET https://api.crossref.org/works?filter=updates:<doi>
//                   &select=DOI,title,update-to&rows=20[&mailto=<contact>]
// Crossref REST lists the notices that update a work; since 2023 it carries the
// Retraction Watch database as `update-to` entries with `source:
// "retraction-watch"`. A notice whose `update-to` names this DOI with a
// retraction-kind type (retraction, withdrawal, removal, partial retraction)
// means the work is retracted. The old Crossref Labs endpoint
// (/data/retractions?filter=record:<doi>) answered every request with an HTTP
// 200 wrapping a "not-polite" error, which read as "not retracted".
//
// Outcomes:
//   - a retraction notice          → a retracted SourceCandidate;
//   - a valid answer with none     → null ("not retracted", a live answer);
//   - anything else (a non-200, a body that is not a Crossref work list — an
//     error inside a 200 included — unparseable JSON, a transport failure)
//                                  → RetractionLookupError: the status is
//     UNKNOWN, never "not retracted" (SRC-04 fail-closed; Pass 1 records
//     UNVERIFIABLE, the freshness table an "unavailable" row);
//   - offline with no exact fixture → the typed OfflineEgressError (RUN-03).

import { fetch as httpFetch, isOfflineEgressError, MAX_JSON_RESPONSE_BYTES } from '../http.js';
import { generateCitekey } from '../citekey.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';

const BASE = 'https://api.crossref.org';

/** Crossref update types that mean the work itself is no longer valid. */
const RETRACTION_TYPES: ReadonlySet<string> = new Set(['retraction', 'withdrawal', 'removal', 'partial_retraction']);

/** The retraction status of a DOI could not be determined (never "not retracted"). */
export class RetractionLookupError extends Error {
  readonly doi: string;
  constructor(doi: string, why: string) {
    super(`retraction status unknown for ${doi}: ${why}`);
    this.name = 'RetractionLookupError';
    this.doi = doi;
  }
}

export function isRetractionLookupError(e: unknown): e is RetractionLookupError {
  return e instanceof RetractionLookupError;
}

interface CrossrefUpdate {
  DOI?: string;
  type?: string;
  label?: string;
  source?: string;
  'record-id'?: string;
  updated?: { 'date-time'?: string; 'date-parts'?: number[][] };
}
interface CrossrefNotice {
  DOI?: string;
  title?: string[];
  author?: Array<{ given?: string; family?: string; name?: string }>;
  'update-to'?: CrossrefUpdate[];
}
interface CrossrefWorkList {
  status?: string;
  'message-type'?: string;
  message?: { items?: CrossrefNotice[] };
}

function sameDoi(a: string | undefined, b: string): boolean {
  return typeof a === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function updateDate(u: CrossrefUpdate): string | undefined {
  const iso = u.updated?.['date-time'];
  if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
  const parts = u.updated?.['date-parts']?.[0];
  if (Array.isArray(parts) && typeof parts[0] === 'number') {
    return parts.map((p, i) => (i === 0 ? String(p) : String(p).padStart(2, '0'))).join('-');
  }
  return undefined;
}

function toCandidate(doi: string, notice: CrossrefNotice, update: CrossrefUpdate): SourceCandidate {
  const date = updateDate(update);
  const label = update.label ?? update.type ?? 'Retraction';
  const where = [
    notice.DOI ? `notice ${notice.DOI}` : null,
    update.source === 'retraction-watch' && update['record-id'] ? `Retraction Watch record ${update['record-id']}` : null,
  ].filter((x): x is string => x !== null);
  const retraction_details = `${date ? `${date}: ` : ''}${label}${where.length > 0 ? ` (${where.join('; ')})` : ''}`;
  const authors = (notice.author ?? [])
    .map((a) => {
      const family = String(a.family ?? a.name ?? '').trim();
      const given = String(a.given ?? '').trim();
      return family ? (given ? `${family}, ${given}` : family) : '';
    })
    .filter(Boolean);
  const title = String(notice.title?.[0] ?? '').trim() || `${label} of ${doi}`;
  const byline = authors.length > 0 ? authors : ['Retraction Watch'];
  return {
    source: 'retraction-watch',
    id: doi,
    doi,
    title,
    authors: byline,
    retracted: true, // D-15 surface-twice: a hit from this adapter == retracted.
    retraction_details,
    last_verified: new Date().toISOString(),
    citekey: generateCitekey({ authors: byline }),
    raw: notice,
  };
}

function contactParam(): string {
  const email = process.env['PENSMITH_CONTACT_EMAIL']?.trim();
  return email ? `&mailto=${encodeURIComponent(email)}` : '';
}

/**
 * D-15 LOCKED: Retraction Watch is fetchById-only. Returns a retracted
 * SourceCandidate when a retraction-kind notice updates `doi`, null when the
 * live answer lists none, and throws RetractionLookupError when the status
 * cannot be determined (see the module header).
 */
export async function fetchById(doi: string): Promise<SourceCandidate | null> {
  const url =
    `${BASE}/works?filter=${encodeURIComponent(`updates:${doi}`)}` +
    `&select=${encodeURIComponent('DOI,title,author,update-to')}&rows=20${contactParam()}`;
  let status: number;
  let text: string;
  try {
    const res = await httpFetch(url, { source: 'retraction-watch', maxBytes: MAX_JSON_RESPONSE_BYTES });
    status = res.status;
    text = res.body;
  } catch (err) {
    if (isOfflineEgressError(err)) throw err;
    throw new RetractionLookupError(doi, `the lookup failed (${err instanceof Error ? err.message : String(err)})`);
  }
  if (status !== 200) throw new RetractionLookupError(doi, `Crossref answered HTTP ${status}`);
  let body: CrossrefWorkList;
  try {
    body = JSON.parse(text) as CrossrefWorkList;
  } catch {
    throw new RetractionLookupError(doi, 'Crossref answered with unreadable JSON');
  }
  const items = body?.message?.items;
  if (body?.status !== 'ok' || body['message-type'] !== 'work-list' || !Array.isArray(items)) {
    throw new RetractionLookupError(doi, `Crossref answered without a work list (status ${JSON.stringify(body?.status ?? null)})`);
  }
  for (const notice of items) {
    for (const u of notice['update-to'] ?? []) {
      if (sameDoi(u.DOI, doi) && typeof u.type === 'string' && RETRACTION_TYPES.has(u.type.toLowerCase())) {
        return toCandidate(doi, notice, u);
      }
    }
  }
  return null;
}
