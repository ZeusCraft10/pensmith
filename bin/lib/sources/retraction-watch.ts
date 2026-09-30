// bin/lib/sources/retraction-watch.ts — Retraction Watch side-channel filter
// (T-3-13, D-15 LOCKED, SRC-04).
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
// Endpoint (CI-07, D-17-47; the retraction lookup of SRC-04):
//   fetchById:  GET https://api.crossref.org/works?filter=updates:<doi>
//                   &select=DOI,title,author,update-to&rows=20[&mailto=<contact>]
// Crossref REST lists the notices that update a work; since 2023 it carries the
// Retraction Watch database as `update-to` entries with `source:
// "retraction-watch"`. A notice whose `update-to` names this DOI with a
// retraction-kind type (retraction, withdrawal, removal, partial retraction)
// means the work is retracted. The old Crossref Labs endpoint
// (/data/retractions?filter=record:<doi>) answered every request with an HTTP
// 200 wrapping a "not-polite" error, which read as "not retracted".
//
// The contact email is the one resolver's (bin/lib/contact-email.ts, D-19-09):
// the configured variable, sent as `mailto` and scrubbed from recordings.
//
// Outcomes:
//   - a retraction notice          → a retracted SourceCandidate;
//   - a valid answer with none     → null ("not retracted", a live answer);
//   - anything else (a non-200, a body that is not a Crossref work list — an
//     error inside a 200 included — unparseable JSON, a transport failure, an
//     exhausted host or an open circuit breaker)
//                                  → RetractionLookupError: the status is
//     UNKNOWN, never "not retracted" (SRC-04 fail-closed; Pass 1 records
//     UNVERIFIABLE, the freshness table an "unavailable" row, research
//     `retraction status unknown`). The shape check is also the transport's
//     `validate`, so such a body is never cached or recorded (SRC-17);
//   - offline with no exact fixture → the typed OfflineEgressError (RUN-03).

import { fetch as httpFetch, MAX_JSON_RESPONSE_BYTES } from '../http.js';
import { contactEmail } from '../contact-email.js';
import { generateCitekey } from '../citekey.js';
import { answeredAt, exchange, jsonShape, statusReason, validator, type LookupOptions, type ShapeCheck } from './registrar-response.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';

const BASE = 'https://api.crossref.org';

/** Crossref update types that mean the work itself is no longer valid. */
const RETRACTION_TYPES: ReadonlySet<string> = new Set(['retraction', 'withdrawal', 'removal', 'partial_retraction']);

/** True for a Crossref update type that retracts the work it updates (D-19-11). */
export function isRetractionUpdateType(type: unknown): boolean {
  return typeof type === 'string' && RETRACTION_TYPES.has(type.toLowerCase());
}

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

/** One Crossref update entry (`update-to` on a notice, `updated-by` on the work it updates). */
export interface CrossrefUpdate {
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

/**
 * The one-line description of a retraction notice:
 * `2010-02-06: Retraction (notice 10.1016/…; Retraction Watch record 4036)`.
 * Shared by this lookup and the Crossref record's own `updated-by` entries.
 */
export function formatRetractionNotice(update: CrossrefUpdate): string {
  const date = updateDate(update);
  const label = update.label ?? update.type ?? 'Retraction';
  const where = [
    update.DOI ? `notice ${update.DOI}` : null,
    update.source === 'retraction-watch' && update['record-id'] ? `Retraction Watch record ${update['record-id']}` : null,
  ].filter((x): x is string => x !== null);
  return `${date ? `${date}: ` : ''}${label}${where.length > 0 ? ` (${where.join('; ')})` : ''}`;
}

function toCandidate(doi: string, notice: CrossrefNotice, update: CrossrefUpdate, checkedAt: string): SourceCandidate {
  // On a notice, `update-to[].DOI` is the retracted work; the notice's own DOI
  // names where the retraction was published.
  const described: CrossrefUpdate = {
    ...(update.type !== undefined ? { type: update.type } : {}),
    ...(update.label !== undefined ? { label: update.label } : {}),
    ...(update.source !== undefined ? { source: update.source } : {}),
    ...(update['record-id'] !== undefined ? { 'record-id': update['record-id'] } : {}),
    ...(update.updated !== undefined ? { updated: update.updated } : {}),
    ...(notice.DOI ? { DOI: notice.DOI } : {}),
  };
  const retraction_details = formatRetractionNotice(described);
  const label = update.label ?? update.type ?? 'Retraction';
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
    retraction_status: 'retracted',
    last_verified: checkedAt,
    citekey: generateCitekey({ authors: byline }),
    raw: notice,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const WORK_LIST: ShapeCheck = jsonShape(
  (b) => isObject(b) && b['status'] === 'ok' && b['message-type'] === 'work-list' && isObject(b['message']) && Array.isArray(b['message']['items']),
  'Crossref work list (status "ok", message-type "work-list")',
);

/** The lookup URL for `doi` (the contact email, when configured, as `mailto`). */
export function retractionLookupUrl(doi: string): string {
  const email = contactEmail().email;
  return (
    `${BASE}/works?filter=${encodeURIComponent(`updates:${doi}`)}` +
    `&select=${encodeURIComponent('DOI,title,author,update-to')}&rows=20` +
    (email ? `&mailto=${encodeURIComponent(email)}` : '')
  );
}

/**
 * D-15 LOCKED: Retraction Watch is fetchById-only. Returns a retracted
 * SourceCandidate when a retraction-kind notice updates `doi`, null when the
 * live answer lists none, and throws RetractionLookupError when the status
 * cannot be determined (see the module header). `refresh` skips the HTTP-cache
 * read (VRFY-28: a re-check of an `unknown` status is never served from cache).
 */
export async function fetchById(doi: string, opts: LookupOptions = {}): Promise<SourceCandidate | null> {
  const url = retractionLookupUrl(doi);
  const ex = await exchange(
    () =>
      httpFetch(url, {
        source: 'retraction-watch',
        maxBytes: MAX_JSON_RESPONSE_BYTES,
        validate: validator(WORK_LIST),
        ...(opts.refresh === true ? { refresh: true } : {}),
      }),
    { service: 'Crossref', check: WORK_LIST },
  );
  if (ex.kind === 'failed') throw new RetractionLookupError(doi, `the Crossref lookup failed (${ex.reason})`);
  if (ex.kind === 'status') throw new RetractionLookupError(doi, `Crossref answered ${statusReason(ex.res)}`);
  const items = (JSON.parse(ex.res.body) as { message: { items: CrossrefNotice[] } }).message.items;
  for (const notice of items) {
    for (const u of notice['update-to'] ?? []) {
      if (sameDoi(u.DOI, doi) && isRetractionUpdateType(u.type)) {
        return toCandidate(doi, notice, u, answeredAt(ex.res));
      }
    }
  }
  return null;
}
