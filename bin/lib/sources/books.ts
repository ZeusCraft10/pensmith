// bin/lib/sources/books.ts — the books adapter: Open Library, with Google Books
// as the keyless ISBN fallback (SRC-11, D-19-14).
//
// Endpoints:
//   search:     GET https://openlibrary.org/search.json?q=<q>&fields=<fields>&limit=<n>
//   lookupById: GET https://openlibrary.org/search.json?isbn=<isbn-13>&fields=<fields>&limit=1
//               GET https://openlibrary.org/search.json?q=key:/works/<OL…W>&fields=<fields>&limit=1
//   authors:    GET https://openlibrary.org/books/<OL…M>.json  (the matched edition)
//               GET https://openlibrary.org/authors/<OL…A>.json (each of its authors)
//   fallback:   GET https://www.googleapis.com/books/v1/volumes?q=isbn:<isbn-13>
//
// Why these routes: `search.json` answers in ONE request, with no redirect, and
// its `editions.*` sub-fields carry the matching edition's own title,
// publisher, date and ISBNs (the /isbn/<isbn> route redirects to an edition
// record whose authors are only keys — more requests for less). A title or
// author search returns works, each with its best-matching edition.
//
// An ISBN lookup's authors come from the matched EDITION's own record: the
// search index's `author_name` (work and edition alike) aggregates names across
// every edition of the work — an audiobook's narrator, a translator — so for
// Kuhn's ISBN 9780226458083 it lists "Dennis Holland" too. The edition record
// names its authors by key (one request per author, at most MAX_EDITION_AUTHORS);
// when it names none, its `by_statement` ("Thomas S. Kuhn.") filters the
// index's list. A failed edition or author request keeps the index's list
// (the book was found; only the refinement was not).
//
// A book candidate: `type: 'book'`, title (the work's casing when the edition
// title is the same words), authors (the edition's, else the work's; Open
// Library display names are "Given Family"), year (the edition's publication
// date, else the work's first publication), publisher (the edition's), ISBN-13
// (the one asked for, else the edition's first), and `id` = `isbn:<ISBN-13>`
// or the Open Library work id (`OL3259254W`) — both accepted by lookupById.
//
// Three-way lookups (D-19-05): an ISBN is found when either registrar has it;
// not-found only when both answered that they do not; failed when a registrar
// that might have it could not answer (the reasons name each). Every request
// passes a shape check so an error body is never cached (SRC-17). Offline, the
// typed OfflineEgressError is rethrown (RUN-03).
//
// Google Books' keyless quota is shared and often exhausted; its 429 reads
// `Google Books keyless quota exhausted`.

import { fetch as httpFetch, MAX_JSON_RESPONSE_BYTES } from '../http.js';
import { type SearchOptions } from './search-failure.js';
import { exchange, jsonShape, statusReason, validator, type Exchange, type ShapeCheck } from './registrar-response.js';
import { lookupFailed, lookupFound, lookupNotFound, unwrapLookup, type LookupResult } from './lookup.js';
import { generateCitekey } from '../citekey.js';
import { isbn13CheckDigit } from '../doi.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';

const OPEN_LIBRARY = 'https://openlibrary.org';
const GOOGLE_BOOKS = 'https://www.googleapis.com';

/** The Open Library fields a candidate needs (work + best-matching edition). */
const FIELDS = [
  'key', 'title', 'subtitle', 'author_name', 'first_publish_year',
  'editions', 'editions.key', 'editions.title', 'editions.subtitle', 'editions.author_name',
  'editions.publisher', 'editions.publish_date', 'editions.isbn',
].join(',');

interface OlEdition {
  key?: string;
  title?: string;
  subtitle?: string;
  author_name?: string[];
  publisher?: string[];
  publish_date?: string[];
  isbn?: string[];
}
export interface OlWork {
  key?: string;
  title?: string;
  subtitle?: string;
  author_name?: string[];
  first_publish_year?: number;
  editions?: { docs?: OlEdition[] };
}

interface GbVolumeInfo {
  title?: string;
  subtitle?: string;
  authors?: string[];
  publisher?: string;
  publishedDate?: string;
  description?: string;
  industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
}
export interface GbVolume {
  id?: string;
  volumeInfo?: GbVolumeInfo;
}

// ---------------------------------------------------------------------------
// ISBNs
// ---------------------------------------------------------------------------

/** ISBN-13 digits for an ISBN-10 or ISBN-13 (hyphens, spaces, `isbn:` allowed), or null when the check digit fails. */
export function toIsbn13(input: string): string | null {
  const s = input.trim().replace(/^isbn(?:-1[03])?\s*:?\s*/i, '').replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{13}$/.test(s)) return isbn13CheckDigit(s.slice(0, 12)) === Number(s[12]) ? s : null;
  if (/^\d{9}[\dX]$/.test(s)) {
    const sum10 = [...s].reduce((acc, d, i) => acc + (d === 'X' ? 10 : Number(d)) * (10 - i), 0);
    if (sum10 % 11 !== 0) return null;
    const core = `978${s.slice(0, 9)}`;
    return `${core}${isbn13CheckDigit(core)}`;
  }
  return null;
}

function firstIsbn13(list: readonly string[] | undefined): string | undefined {
  const all = (list ?? []).map((x) => toIsbn13(String(x))).filter((x): x is string => x !== null);
  return all[0];
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.replace(/\s+/g, ' ').trim().length > 0 ? v.replace(/\s+/g, ' ').trim() : undefined;
}

function yearIn(s: string | undefined): number | undefined {
  const m = s ? /(\d{4})/.exec(s) : null;
  const y = m?.[1] ? Number(m[1]) : NaN;
  return y >= 1800 && y <= 2100 ? y : undefined;
}

/**
 * The display title: the edition's words in the work's casing when the work
 * title starts with them (Open Library's edition titles are often lower-case,
 * its work titles sometimes carry a series suffix), else the edition's.
 */
function bookTitle(work: OlWork, edition: OlEdition | undefined): string | undefined {
  const workTitle = str(work.title);
  const edTitle = str(edition?.title);
  let title = edTitle ?? workTitle;
  if (edTitle && workTitle && workTitle.toLowerCase().startsWith(edTitle.toLowerCase())) {
    title = workTitle.slice(0, edTitle.length);
  }
  if (title === undefined) return undefined;
  const subtitle = str(edition?.subtitle) ?? (edition === undefined ? str(work.subtitle) : undefined);
  return subtitle ? `${title}: ${subtitle}` : title;
}

function workId(key: string | undefined): string | undefined {
  const m = key ? /^\/?(?:works\/)?(OL\d+W)$/.exec(key.trim()) : null;
  return m?.[1];
}

/** An Open Library work (+ its matching edition) as a book candidate. */
export function openLibraryToCandidate(work: OlWork, wantIsbn?: string): SourceCandidate | null {
  const editions = work.editions?.docs ?? [];
  const edition = wantIsbn
    ? editions.find((e) => (e.isbn ?? []).some((i) => toIsbn13(String(i)) === wantIsbn))
    : editions[0];
  if (wantIsbn && !edition) return null; // the answer is not the book that was asked for
  const title = bookTitle(work, edition);
  if (!title) return null;
  const authorList = (edition?.author_name?.length ? edition.author_name : work.author_name) ?? [];
  const authors = authorList.map((a) => String(a).replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (authors.length === 0) return null;
  const year = yearIn(edition?.publish_date?.[0]) ?? (typeof work.first_publish_year === 'number' ? yearIn(String(work.first_publish_year)) : undefined);
  const publisher = str(edition?.publisher?.[0]);
  const isbn = wantIsbn ?? firstIsbn13(edition?.isbn);
  const olWork = workId(work.key);
  const id = isbn ? `isbn:${isbn}` : olWork;
  if (!id) return null;
  return {
    source: 'books',
    id,
    title,
    authors,
    ...(year !== undefined ? { year } : {}),
    ...(publisher !== undefined ? { publisher } : {}),
    ...(isbn !== undefined ? { isbn } : {}),
    type: 'book',
    retracted: false,
    last_verified: new Date().toISOString(),
    citekey: generateCitekey({ authors, ...(year !== undefined ? { year } : {}) }),
    raw: { openLibrary: { work: work.key, edition: edition?.key } },
  };
}

/** A Google Books volume as a book candidate (the ISBN it was asked for must be among its identifiers). */
export function googleBooksToCandidate(volume: GbVolume, wantIsbn: string): SourceCandidate | null {
  const info = volume.volumeInfo ?? {};
  const ids = (info.industryIdentifiers ?? []).map((x) => toIsbn13(String(x.identifier ?? ''))).filter((x): x is string => x !== null);
  if (!ids.includes(wantIsbn)) return null;
  const base = str(info.title);
  if (!base) return null;
  const subtitle = str(info.subtitle);
  const authors = (info.authors ?? []).map((a) => String(a).replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (authors.length === 0) return null;
  const year = yearIn(info.publishedDate);
  const publisher = str(info.publisher);
  const abstract = str(info.description);
  return {
    source: 'books',
    id: `isbn:${wantIsbn}`,
    title: subtitle ? `${base}: ${subtitle}` : base,
    authors,
    ...(year !== undefined ? { year } : {}),
    ...(publisher !== undefined ? { publisher } : {}),
    ...(abstract !== undefined ? { abstract } : {}),
    isbn: wantIsbn,
    type: 'book',
    retracted: false,
    last_verified: new Date().toISOString(),
    citekey: generateCitekey({ authors, ...(year !== undefined ? { year } : {}) }),
    raw: { googleBooks: volume.id ?? null },
  };
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const OL_SEARCH: ShapeCheck = jsonShape((b) => isObject(b) && Array.isArray(b['docs']), 'Open Library search result (docs)');
const GB_VOLUMES: ShapeCheck = jsonShape(
  (b) => isObject(b) && b['kind'] === 'books#volumes' && typeof b['totalItems'] === 'number',
  'Google Books volume list',
);

async function openLibrary(url: string): Promise<Exchange> {
  return exchange(
    () => httpFetch(url, { source: 'books', maxBytes: MAX_JSON_RESPONSE_BYTES, validate: validator(OL_SEARCH) }),
    { service: 'Open Library', check: OL_SEARCH },
  );
}

async function googleBooks(url: string): Promise<Exchange> {
  return exchange(
    () => httpFetch(url, { source: 'books', maxBytes: MAX_JSON_RESPONSE_BYTES, validate: validator(GB_VOLUMES) }),
    { service: 'Google Books', check: GB_VOLUMES, rateLimited: () => 'Google Books keyless quota exhausted (HTTP 429)' },
  );
}

/** The search URL (exported so the recorder and tests name the exact request). */
export function searchUrl(query: string, opts: SearchOptions = {}): string {
  const limit = opts.limit ?? 20;
  return `${OPEN_LIBRARY}/search.json?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(FIELDS)}&limit=${limit}`;
}

/** Title / author search (Open Library). Failures → [] plus onFailure(reason). */
export async function search(query: string, opts: SearchOptions = {}): Promise<SourceCandidate[]> {
  const ex = await openLibrary(searchUrl(query, opts));
  if (ex.kind === 'failed') {
    opts.onFailure?.(ex.reason);
    return [];
  }
  if (ex.kind === 'status') {
    opts.onFailure?.(statusReason(ex.res));
    return [];
  }
  const docs = (JSON.parse(ex.res.body) as { docs: OlWork[] }).docs;
  return docs.map((d) => openLibraryToCandidate(d)).filter((c): c is SourceCandidate => c !== null);
}

type Attempt = { kind: 'found'; candidate: SourceCandidate } | { kind: 'not-found'; reason: string } | { kind: 'failed'; reason: string; status?: number };

function attemptFrom(ex: Exchange, service: string, parse: (body: string) => SourceCandidate | null, missing: string): Attempt {
  if (ex.kind === 'failed') return { kind: 'failed', reason: `${service}: ${ex.reason}`, ...(ex.status !== undefined ? { status: ex.status } : {}) };
  if (ex.kind === 'status') {
    if (ex.res.status === 404) return { kind: 'not-found', reason: `${service}: HTTP 404` };
    return { kind: 'failed', reason: `${service}: ${statusReason(ex.res)}`, status: ex.res.status };
  }
  const c = parse(ex.res.body);
  return c ? { kind: 'found', candidate: c } : { kind: 'not-found', reason: `${service}: ${missing}` };
}

/** How many of an edition's authors are resolved by name (one request each). */
export const MAX_EDITION_AUTHORS = 10;

const OL_RECORD: ShapeCheck = jsonShape((b) => isObject(b) && typeof b['key'] === 'string', 'Open Library record (key)');

async function openLibraryRecord(url: string): Promise<Record<string, unknown> | null> {
  const ex = await exchange(
    () => httpFetch(url, { source: 'books', maxBytes: MAX_JSON_RESPONSE_BYTES, validate: validator(OL_RECORD) }),
    { service: 'Open Library', check: OL_RECORD },
  );
  return ex.kind === 'ok' ? (JSON.parse(ex.res.body) as Record<string, unknown>) : null;
}

/** The last word of a display name, lower-cased and without diacritics. */
function familyToken(name: string): string {
  const words = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words[words.length - 1] ?? '';
}

/**
 * The authors of the edition `editionKey` (`/books/OL…M`) from its own record
 * (see the header), or null to keep the search index's list.
 */
async function editionAuthors(editionKey: string, indexNames: readonly string[]): Promise<string[] | null> {
  const m = /^\/?books\/(OL\d+M)$/.exec(editionKey.trim());
  if (!m) return null;
  const record = await openLibraryRecord(`${OPEN_LIBRARY}/books/${m[1]}.json`);
  if (record === null) return null;
  const keys = (Array.isArray(record['authors']) ? (record['authors'] as unknown[]) : [])
    .map((a) => (isObject(a) && isObject(a['author']) ? a['author']['key'] : isObject(a) ? a['key'] : undefined))
    .filter((k): k is string => typeof k === 'string' && /^\/authors\/OL\d+A$/.test(k))
    .slice(0, MAX_EDITION_AUTHORS);
  if (keys.length > 0) {
    const names: string[] = [];
    for (const key of keys) {
      const a = await openLibraryRecord(`${OPEN_LIBRARY}${key}.json`);
      const name = a ? str(a['name']) ?? str(a['personal_name']) : undefined;
      if (name === undefined) return null;
      names.push(name);
    }
    return names;
  }
  const by = str(record['by_statement']);
  if (by === undefined) return null;
  const byWords = new Set(by.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const kept = indexNames.filter((n) => byWords.has(familyToken(n)));
  return kept.length > 0 ? kept : null;
}

async function lookupIsbn(isbn: string): Promise<LookupResult> {
  const ol = attemptFrom(
    await openLibrary(`${OPEN_LIBRARY}/search.json?isbn=${isbn}&fields=${encodeURIComponent(FIELDS)}&limit=1`),
    'Open Library',
    (body) => {
      const docs = (JSON.parse(body) as { docs: OlWork[] }).docs;
      for (const d of docs) {
        const c = openLibraryToCandidate(d, isbn);
        if (c) return c;
      }
      return null;
    },
    `no edition with ISBN ${isbn}`,
  );
  if (ol.kind === 'found') {
    const c = ol.candidate;
    const edition = (c.raw as { openLibrary?: { edition?: string } }).openLibrary?.edition;
    const authors = edition ? await editionAuthors(edition, c.authors) : null;
    if (authors === null || authors.length === 0) return lookupFound(c);
    return lookupFound({ ...c, authors, citekey: generateCitekey({ authors, ...(c.year !== undefined ? { year: c.year } : {}) }) });
  }

  // The keyless fallback (D-19-14).
  const gb = attemptFrom(
    await googleBooks(`${GOOGLE_BOOKS}/books/v1/volumes?q=${encodeURIComponent(`isbn:${isbn}`)}`),
    'Google Books',
    (body) => {
      const items = (JSON.parse(body) as { items?: GbVolume[] }).items ?? [];
      for (const v of items) {
        const c = googleBooksToCandidate(v, isbn);
        if (c) return c;
      }
      return null;
    },
    `no volume with ISBN ${isbn}`,
  );
  if (gb.kind === 'found') return lookupFound(gb.candidate);
  if (ol.kind === 'not-found' && gb.kind === 'not-found') return lookupNotFound(`${ol.reason}; ${gb.reason}`);
  // At least one registrar could not answer: the ISBN may exist (fail closed).
  const status = gb.kind === 'failed' ? gb.status : ol.kind === 'failed' ? ol.status : undefined;
  return lookupFailed(`${ol.reason}; ${gb.reason}`, status !== undefined ? { status } : {});
}

async function lookupWork(id: string): Promise<LookupResult> {
  const ex = await openLibrary(
    `${OPEN_LIBRARY}/search.json?q=${encodeURIComponent(`key:/works/${id}`)}&fields=${encodeURIComponent(FIELDS)}&limit=1`,
  );
  const a = attemptFrom(
    ex,
    'Open Library',
    (body) => {
      const doc = (JSON.parse(body) as { docs: OlWork[] }).docs.find((d) => workId(d.key) === id);
      return doc ? openLibraryToCandidate(doc) : null;
    },
    `no work ${id}`,
  );
  if (a.kind === 'found') return lookupFound(a.candidate);
  if (a.kind === 'not-found') return lookupNotFound(a.reason);
  return lookupFailed(a.reason, a.status !== undefined ? { status: a.status } : {});
}

/**
 * A book by identifier: `isbn:<ISBN-10|13>` (or a bare, checksum-valid ISBN)
 * or an Open Library work id (`OL3259254W`, `/works/OL3259254W`).
 */
export async function lookupById(id: string): Promise<LookupResult> {
  const s = id.trim();
  const work = workId(s.replace(/^openlibrary:/i, ''));
  if (work) return lookupWork(work);
  const isbn = toIsbn13(s);
  if (isbn === null) return lookupNotFound(`not an ISBN or Open Library work id: ${JSON.stringify(s.slice(0, 80))}`);
  return lookupIsbn(isbn);
}

export async function fetchById(id: string): Promise<SourceCandidate | null> {
  return unwrapLookup(await lookupById(id), 'books', id);
}
