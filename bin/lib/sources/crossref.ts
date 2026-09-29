// bin/lib/sources/crossref.ts — Crossref adapter (RSCH-03, RSCH-04, SRC-04,
// SRC-05, T-3-13).
//
// Endpoints:
//   search:     GET https://api.crossref.org/works?query=<q>&rows=<n>&select=<fields>
//                   [&filter=from-pub-date:<year>,prefix:<doi prefix>]
//   lookupById: GET https://api.crossref.org/works/<doi>   (the whole record;
//                   this route does not accept `select`)
//
// Politeness: the contact email rides in the User-Agent (`(mailto:…)`), which
// bin/lib/http.ts owns (D-19-08) — Crossref reads it from there.
//
// Three-way lookups (D-19-05): lookupById answers found | not-found (HTTP 404)
// | failed (a 429 / 5xx after retries, an exhausted host, an open breaker, a
// transport error, or a body that is not a Crossref answer — an error document
// inside a 200 included). fetchById is the unwrapped view: the candidate, null
// for not-found, a thrown SourceLookupError for failed. The typed
// OfflineEgressError (sources offline without an exact fixture, or --dry-run)
// is rethrown by both (RUN-03).
//
// A complete record (D-19-13): authors with only a `name` are corporate authors
// written braced (`{The ENCODE Project Consortium}`); an editor-only work (an
// edited volume) carries `editors` and uses them as its authors; the
// container title is the venue; volume, issue, page, publisher, ISBN, the
// JATS-stripped abstract and the CSL type come from the record.
//
// Retraction status (D-19-11, SRC-04): the Crossref record itself carries the
// Retraction Watch notices as `updated-by` (search selects the field, the
// singleton route returns it whole). A retraction / withdrawal / removal /
// partial retraction notice, or a `RETRACTED:` title prefix, makes the
// candidate `retracted` with the notice as its details; otherwise its status is
// `clear` — a decided answer the research cross-check does not ask again.

import { fetch as httpFetch, MAX_JSON_RESPONSE_BYTES } from '../http.js';
import { type SearchOptions } from './search-failure.js';
import { exchange, jsonShape, statusReason, validator, type ShapeCheck } from './registrar-response.js';
import { lookupFailed, lookupFound, lookupNotFound, unwrapLookup, type LookupResult } from './lookup.js';
import { formatRetractionNotice, isRetractionUpdateType, type CrossrefUpdate } from './retraction-watch.js';
import { generateCitekey } from '../citekey.js';
import { normalizeDoi } from '../doi.js';
import { decodeEntities, plainText, plainTextOpt } from '../markup.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';
import type { SourceType } from '../schemas/source-types.js';

const BASE = 'https://api.crossref.org';
const SERVICE = 'Crossref';

interface CrossrefPerson {
  family?: string;
  given?: string;
  name?: string;
  suffix?: string;
}

interface CrossrefDate {
  'date-parts'?: Array<Array<number | null>>;
}

export interface CrossrefItem {
  DOI?: string;
  title?: string[] | string;
  author?: CrossrefPerson[];
  editor?: CrossrefPerson[];
  issued?: CrossrefDate;
  'published-print'?: CrossrefDate;
  'published-online'?: CrossrefDate;
  abstract?: string;
  'container-title'?: string[] | string;
  type?: string;
  volume?: string;
  issue?: string;
  page?: string;
  publisher?: string;
  ISBN?: string[];
  'updated-by'?: CrossrefUpdate[];
}

/** Crossref work types → CSL types (D-19-13). */
const CSL_TYPE: Readonly<Record<string, SourceType>> = {
  'journal-article': 'article-journal',
  'proceedings-article': 'paper-conference',
  book: 'book',
  monograph: 'book',
  'edited-book': 'book',
  'reference-book': 'book',
  'book-set': 'book',
  'book-chapter': 'chapter',
  'book-section': 'chapter',
  'book-part': 'chapter',
  'reference-entry': 'chapter',
  report: 'report',
  'report-component': 'report',
  dissertation: 'thesis',
  'posted-content': 'preprint',
  dataset: 'dataset',
};

/** The CSL type of a Crossref work type (`other` when Crossref names something else). */
export function crossrefCslType(type: string | undefined): SourceType | undefined {
  if (typeof type !== 'string' || type.length === 0) return undefined;
  return CSL_TYPE[type] ?? 'other';
}

function firstString(v: string[] | string | undefined): string {
  if (Array.isArray(v)) return String(v[0] ?? '').trim();
  return typeof v === 'string' ? v.trim() : '';
}

function yearOf(d: CrossrefDate | undefined): number | undefined {
  const y = d?.['date-parts']?.[0]?.[0];
  return typeof y === 'number' && y >= 1800 && y <= 2100 ? y : undefined;
}

function parseYear(item: CrossrefItem): number | undefined {
  return yearOf(item.issued) ?? yearOf(item['published-print']) ?? yearOf(item['published-online']);
}

/**
 * One Crossref contributor as an author string: `Family, Given[, Suffix]`,
 * `Family`, a braced corporate name `{Name}` (name-only entries: consortia,
 * groups), or a lone given name (mononyms).
 */
export function crossrefPersonName(p: CrossrefPerson): string {
  const family = String(p.family ?? '').trim();
  const given = String(p.given ?? '').trim();
  const suffix = String(p.suffix ?? '').trim();
  const name = String(p.name ?? '').replace(/[{}]/g, '').trim();
  if (family) {
    if (!given) return family;
    return suffix ? `${family}, ${given}, ${suffix}` : `${family}, ${given}`;
  }
  if (name) return `{${name}}`;
  return given;
}

function people(list: CrossrefPerson[] | undefined): string[] {
  return (Array.isArray(list) ? list : []).map(crossrefPersonName).filter((s) => s.length > 0);
}

/**
 * A Crossref JATS abstract as plain text: a leading `Abstract` heading is
 * dropped, section headings become `Heading: `, tags are stripped, entities
 * decoded, whitespace collapsed. undefined when nothing is left.
 */
export function stripJats(abstract: string | undefined): string | undefined {
  if (typeof abstract !== 'string') return undefined;
  const text = decodeEntities(
    abstract
      .replace(/^\s*<(?:jats:)?title\b[^>]*>\s*(?:abstract|summary)\s*<\/(?:jats:)?title>/i, '')
      .replace(/<\/(?:jats:)?title>/gi, ': ')
      .replace(/<\/(?:jats:)?(?:p|sec|list-item)>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0 ? text : undefined;
}

/** The ISBN to record: a 13-digit one when Crossref lists it, else the first (hyphens dropped). */
function pickIsbn(list: string[] | undefined): string | undefined {
  const all = (Array.isArray(list) ? list : [])
    .map((s) => String(s).replace(/[\s-]/g, '').toUpperCase())
    .filter((s) => /^(?:\d{13}|\d{9}[\dX])$/.test(s));
  return all.find((s) => s.length === 13) ?? all[0];
}

/** The retraction status the record itself carries (D-19-11). */
function retractionOf(item: CrossrefItem, title: string): Pick<SourceCandidate, 'retracted' | 'retraction_details' | 'retraction_status'> {
  const notice = (Array.isArray(item['updated-by']) ? item['updated-by'] : []).find((u) => isRetractionUpdateType(u?.type));
  if (notice) {
    return { retracted: true, retraction_status: 'retracted', retraction_details: formatRetractionNotice(notice) };
  }
  if (/^\s*retracted\s*:/i.test(title)) {
    return { retracted: true, retraction_status: 'retracted', retraction_details: 'the Crossref title is marked "RETRACTED:"' };
  }
  return { retracted: false, retraction_status: 'clear' };
}

/**
 * A Crossref work as a SourceCandidate, or null when it has no DOI, no title,
 * or nobody to attribute it to (no author and no editor).
 */
export function crossrefToCandidate(item: CrossrefItem): SourceCandidate | null {
  const doi = typeof item.DOI === 'string' ? item.DOI.trim() : '';
  if (!doi) return null;
  // SRC-05 / SRC-12: inline JATS / HTML and entities out (markup.ts), so the
  // bib, RESEARCH.md and the exported reference list show the title's text.
  const title = plainText(firstString(item.title));
  if (!title) return null;

  const editors = people(item.editor);
  const named = people(item.author);
  // An editor-only work (an edited volume) is attributed to its editors.
  const authors = named.length > 0 ? named : editors;
  if (authors.length === 0) return null;

  const year = parseYear(item);
  const venue = plainText(firstString(item['container-title']));
  const type = crossrefCslType(item.type);
  const isbn = pickIsbn(item.ISBN);
  const abstract = stripJats(item.abstract);
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined);
  const volume = str(item.volume);
  const issue = str(item.issue);
  const pages = str(item.page);
  const publisher = plainTextOpt(str(item.publisher));

  return {
    source: 'crossref',
    id: doi,
    doi,
    title,
    authors,
    ...(year !== undefined ? { year } : {}),
    ...(abstract !== undefined ? { abstract } : {}),
    ...(venue ? { venue } : {}),
    ...(volume !== undefined ? { volume } : {}),
    ...(issue !== undefined ? { issue } : {}),
    ...(pages !== undefined ? { pages } : {}),
    ...(publisher !== undefined ? { publisher } : {}),
    ...(isbn !== undefined ? { isbn } : {}),
    ...(type !== undefined ? { type } : {}),
    ...(editors.length > 0 ? { editors } : {}),
    ...retractionOf(item, title),
    last_verified: new Date().toISOString(),
    citekey: generateCitekey({ authors, ...(year !== undefined ? { year } : {}) }),
    raw: item,
  };
}

// ---------------------------------------------------------------------------
// Shape checks (SRC-17: an error body is never cached, recorded or parsed)
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const WORK_LIST: ShapeCheck = jsonShape(
  (b) => isObject(b) && b['status'] === 'ok' && b['message-type'] === 'work-list' && isObject(b['message']) && Array.isArray(b['message']['items']),
  'Crossref work list (status "ok", message-type "work-list")',
);

const WORK: ShapeCheck = jsonShape(
  (b) => isObject(b) && b['status'] === 'ok' && b['message-type'] === 'work' && isObject(b['message']) && typeof b['message']['DOI'] === 'string',
  'Crossref work (status "ok", message-type "work")',
);

/** The Crossref fields a search candidate needs (search responses only). */
const SEARCH_SELECT = [
  'DOI', 'title', 'author', 'editor', 'issued', 'abstract', 'container-title', 'type',
  'volume', 'issue', 'page', 'publisher', 'ISBN', 'updated-by',
].join(',');

/** The search URL (exported for the recorder and tests: the exact request the adapter makes). */
export function searchUrl(query: string, opts: SearchOptions = {}): string {
  const limit = opts.limit ?? 20;
  const filters: string[] = [];
  if (typeof opts.fromYear === 'number' && Number.isInteger(opts.fromYear)) filters.push(`from-pub-date:${opts.fromYear}`);
  const prefix = typeof opts.doiPrefix === 'string' ? opts.doiPrefix.trim() : '';
  // A registrant prefix (`10.3386` — NBER): the directory indicator, a dot, 4–9 digits.
  if (prefix.startsWith('10.') && /^\d+\.\d{4,9}$/.test(prefix)) filters.push(`prefix:${prefix}`);
  return (
    `${BASE}/works?query=${encodeURIComponent(query)}&rows=${limit}&select=${encodeURIComponent(SEARCH_SELECT)}` +
    (filters.length > 0 ? `&filter=${encodeURIComponent(filters.join(','))}` : '')
  );
}

export async function search(query: string, opts: SearchOptions = {}): Promise<SourceCandidate[]> {
  const url = searchUrl(query, opts);
  const ex = await exchange(
    () => httpFetch(url, { source: 'crossref', maxBytes: MAX_JSON_RESPONSE_BYTES, validate: validator(WORK_LIST) }),
    { service: SERVICE, check: WORK_LIST },
  );
  if (ex.kind === 'failed') {
    opts.onFailure?.(ex.reason);
    return [];
  }
  if (ex.kind === 'status') {
    opts.onFailure?.(statusReason(ex.res));
    return [];
  }
  const items = ((JSON.parse(ex.res.body) as { message: { items: CrossrefItem[] } }).message.items);
  return items.map(crossrefToCandidate).filter((c): c is SourceCandidate => c !== null);
}

/** Crossref's answer for one DOI: found | not-found (HTTP 404) | failed (reason). */
export async function lookupById(id: string): Promise<LookupResult> {
  const doi = normalizeDoi(id);
  if (doi === null) return lookupNotFound(`not a DOI: ${JSON.stringify(id.slice(0, 80))}`);
  const url = `${BASE}/works/${encodeURIComponent(doi)}`;
  const ex = await exchange(
    () => httpFetch(url, { source: 'crossref', maxBytes: MAX_JSON_RESPONSE_BYTES, validate: validator(WORK) }),
    { service: SERVICE, check: WORK },
  );
  if (ex.kind === 'failed') {
    return lookupFailed(ex.reason, {
      ...(ex.status !== undefined ? { status: ex.status } : {}),
      ...(ex.retryAfterMs !== undefined ? { retryAfterMs: ex.retryAfterMs } : {}),
    });
  }
  if (ex.kind === 'status') {
    if (ex.res.status === 404) return lookupNotFound('HTTP 404 (Crossref has no record of this DOI)');
    return lookupFailed(statusReason(ex.res), { status: ex.res.status });
  }
  const msg = (JSON.parse(ex.res.body) as { message: CrossrefItem }).message;
  const candidate = crossrefToCandidate(msg);
  if (candidate === null) {
    return lookupFailed(
      "Crossref's record of this DOI lists no title, or no author or editor, so it cannot be cited or checked (an incomplete registrar record — asking again gives the same answer)",
      { status: 200, permanent: true },
    );
  }
  return lookupFound(candidate);
}

export async function fetchById(doi: string): Promise<SourceCandidate | null> {
  return unwrapLookup(await lookupById(doi), 'crossref', doi);
}
