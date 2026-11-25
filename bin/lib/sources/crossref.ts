// bin/lib/sources/crossref.ts — Crossref adapter.
//
// Endpoints:
//   search:    GET https://api.crossref.org/works?query=<encoded>&rows=<limit>
//   lookupDoi: GET https://api.crossref.org/works/<doi>
//
// Crossref's polite pool asks for a contact address. bin/lib/http.ts puts
// PENSMITH_CONTACT_EMAIL in the User-Agent; when it is set, requests here also
// carry it as `mailto`, the form Crossref documents. With no address configured
// nothing identifying is sent.
//
// Crossref registers most DOIs, but not all: arXiv, Zenodo and other DataCite
// DOIs, and mEDRA or JaLC ones, are a 404 here. So a 404 only says "not a
// Crossref DOI"; Pass 1 asks DataCite and doi.org before calling a DOI
// unregistered (bin/lib/verify/resolve.ts).
//
// Offline mode and test cassettes are handled inside http.ts, so this file only
// knows the live API.

import { fetch as httpFetch } from '../http.js';
import { generateCitekey } from '../citekey.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';
import {
  allStrings,
  cslDateYear,
  cslNames,
  firstString,
  unavailableDetail,
  type Lookup,
  type WorkRecord,
} from './work-record.js';

const BASE = 'https://api.crossref.org';

interface CrossrefName {
  family?: string;
  given?: string;
  /** An organization author ("The ENCODE Project Consortium"). */
  name?: string;
}

interface CrossrefItem {
  DOI?: string;
  title?: string[] | string;
  subtitle?: string[];
  author?: CrossrefName[];
  issued?: { 'date-parts'?: number[][] };
  abstract?: string;
}

/** `?mailto=` (or `&mailto=`) when a contact address is configured, else nothing. */
function mailto(sep: '?' | '&'): string {
  const email = process.env['PENSMITH_CONTACT_EMAIL']?.trim();
  return email ? `${sep}mailto=${encodeURIComponent(email)}` : '';
}

function parseYear(item: CrossrefItem): number | undefined {
  const y = cslDateYear(item.issued);
  return y !== undefined && y >= 1800 ? y : undefined;
}

function toCandidate(item: CrossrefItem): SourceCandidate | null {
  const doi = typeof item.DOI === 'string' ? item.DOI : undefined;
  if (!doi) return null;
  const title = Array.isArray(item.title)
    ? (item.title[0] ?? '').toString()
    : String(item.title ?? '');
  if (!title) return null;

  // Authors are "Family, Given" strings. An organization author has only a
  // name; it is kept as is, so a consortium paper is not dropped.
  const authors = (item.author ?? [])
    .map((a) => {
      const family = String(a.family ?? '').trim();
      const given = String(a.given ?? '').trim();
      if (!family) return String(a.name ?? '').trim();
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

/** A WorkRecord from a Crossref `message`. */
function toRecord(msg: Record<string, unknown>): WorkRecord | null {
  const title = firstString(msg['title']);
  if (!title) return null;
  const years = ['issued', 'published-print', 'published-online', 'published']
    .map((k) => cslDateYear(msg[k]))
    .filter((y): y is number => y !== undefined);
  const rec: WorkRecord = {
    registry: 'Crossref',
    title,
    authors: cslNames(msg['author']),
    editors: cslNames(msg['editor']),
    years: [...new Set(years)],
    venues: [...allStrings(msg['container-title']), ...allStrings(msg['short-container-title'])],
    journalArticle: msg['type'] === 'journal-article',
    raw: msg,
  };
  const doi = firstString(msg['DOI']);
  if (doi) rec.doi = doi;
  const subtitle = firstString(msg['subtitle']);
  if (subtitle) rec.subtitle = subtitle;
  const alt = allStrings(msg['original-title']);
  if (alt.length > 0) rec.altTitles = alt;
  return rec;
}

export async function search(
  query: string,
  opts: { limit?: number } = {},
): Promise<SourceCandidate[]> {
  const limit = opts.limit ?? 20;
  const url = `${BASE}/works?query=${encodeURIComponent(query)}&rows=${limit}${mailto('&')}`;
  try {
    const res = await httpFetch(url, {
      source: 'crossref',
    });
    if (res.status !== 200) return [];
    const body = typeof res.body === 'string' ? (JSON.parse(res.body) as unknown) : res.body;
    const items = ((body as { message?: { items?: CrossrefItem[] } })?.message?.items) ?? [];
    return items.map(toCandidate).filter((c): c is SourceCandidate => c !== null);
  } catch {
    return [];
  }
}

/**
 * Ask Crossref for `doi`. A 404 is `not_found` (Crossref does not hold it);
 * any other status, a thrown transport error, or a body that does not parse is
 * `unavailable`, because none of them says anything about the DOI.
 */
export async function lookupDoi(doi: string): Promise<Lookup & { item?: CrossrefItem }> {
  const url = `${BASE}/works/${encodeURIComponent(doi)}${mailto('?')}`;
  let res;
  try {
    res = await httpFetch(url, { source: 'crossref' });
  } catch (err) {
    return { kind: 'unavailable', registry: 'Crossref', detail: unavailableDetail(err) };
  }
  if (res.status === 404 || res.status === 410) {
    return { kind: 'not_found', registry: 'Crossref', authoritative: true };
  }
  if (res.status !== 200) {
    return { kind: 'unavailable', registry: 'Crossref', detail: `HTTP ${res.status}` };
  }
  let msg: Record<string, unknown> | undefined;
  try {
    msg = (JSON.parse(res.body) as { message?: Record<string, unknown> })?.message;
  } catch {
    msg = undefined;
  }
  const record = msg ? toRecord(msg) : null;
  if (!msg || !record) {
    return { kind: 'unavailable', registry: 'Crossref', detail: 'unreadable response' };
  }
  return { kind: 'found', registry: 'Crossref', record, item: msg as CrossrefItem };
}

/**
 * The Crossref work for `doi` as a research candidate, or null when Crossref
 * has none or could not be asked. `pensmith add` uses this.
 */
export async function fetchById(doi: string): Promise<SourceCandidate | null> {
  const r = await lookupDoi(doi);
  return r.kind === 'found' && r.item ? toCandidate(r.item) : null;
}
