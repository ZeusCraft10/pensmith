// bin/lib/sources/arxiv.ts — arXiv adapter (RSCH-03, RSCH-04, SRC-02, SRC-05,
// T-3-13).
//
// Endpoints (https — the http:// host answers 301, CI-07):
//   search:     GET https://export.arxiv.org/api/query?search_query=<encoded>&max_results=<n>
//   lookupById: GET https://export.arxiv.org/api/query?id_list=<arxiv-id>
//
// Atom-XML response. We parse with a tiny regex-based extractor instead of
// pulling in fast-xml-parser / xml2js — keeps zero extra deps and the shape
// is simple/stable (entry > id|title|summary|published|author>name|arxiv:doi|
// arxiv:journal_ref).
//
// A complete record (SRC-02, D-19-13): `arxiv` is the bare identifier without
// its version (`1706.03762`, `hep-th/9901001`), `doi` the published version's
// DOI when arXiv lists one, `venue` the journal reference, `abstract` the
// summary, and `type` is always `preprint` (the eprint itself).
//
// lookupById accepts every spelling a user or a PDF carries — `arXiv:` prefix,
// abs / pdf URLs, a version suffix, new-style (`1706.03762v7`) and old-style
// ids (`hep-th/9901001v2`, `math.GT/0309136`, an upper-case archive) — and asks
// arXiv for the canonical id (versionless; an old-style subject class is not
// part of the id). found | not-found (an empty feed, or arXiv's own "incorrect
// id" error entry) | failed (a non-200 after retries, an exhausted host, a
// body that is not an Atom feed). RESEARCH note: arXiv has no polite pool and
// no key; the courtesy is its documented request rate, which the transport
// enforces per host.
//
// Offline replay is the exact-match fixture store inside bin/lib/http.ts; the
// typed OfflineEgressError is rethrown so callers report "unavailable (offline)".

import { fetch as httpFetch, MAX_JSON_RESPONSE_BYTES } from '../http.js';
import { type SearchOptions } from './search-failure.js';
import { exchange, statusReason, validator, type ShapeCheck } from './registrar-response.js';
import { lookupFailed, lookupFound, lookupNotFound, unwrapLookup, type LookupResult } from './lookup.js';
import { generateCitekey } from '../citekey.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';

const BASE = 'https://export.arxiv.org';
const SERVICE = 'arXiv';

/** arXiv serves Atom XML; http.ts defaults to Accept: application/json. */
const ATOM_HEADERS = { accept: 'application/atom+xml' } as const;

interface ArxivEntry {
  id: string;
  title: string;
  summary: string | undefined;
  published: string | undefined;
  authors: string[];
  doi: string | undefined;
  journalRef: string | undefined;
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
    .replace(/&#x([0-9a-f]+);/gi, (w, h: string) => {
      const c = parseInt(h, 16);
      return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : w;
    })
    .replace(/&#(\d+);/g, (w, d: string) => {
      const c = parseInt(d, 10);
      return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : w;
    })
    .replace(/&amp;/g, '&')
    .trim();
}

function text(xml: string, tag: string): string | undefined {
  const raw = extractOne(xml, tag);
  if (raw === undefined) return undefined;
  const t = decodeXmlEntities(raw).replace(/\s+/g, ' ').trim();
  return t.length > 0 ? t : undefined;
}

function parseEntry(entryXml: string): ArxivEntry | null {
  const id = text(entryXml, 'id');
  if (!id) return null;
  const title = text(entryXml, 'title');
  if (!title) return null;

  // <author><name>…</name></author>: extract all <name> tags inside <author>.
  const authors = extractAll(entryXml, 'author')
    .map((block) => {
      const name = extractOne(block, 'name');
      return name ? decodeXmlEntities(name).replace(/\s+/g, ' ') : '';
    })
    .filter(Boolean);

  return {
    id,
    title,
    summary: text(entryXml, 'summary'),
    published: text(entryXml, 'published'),
    authors,
    // Namespaced tags — the colon is literal in the pattern.
    doi: text(entryXml, 'arxiv:doi'),
    journalRef: text(entryXml, 'arxiv:journal_ref'),
  };
}

/**
 * The canonical arXiv identifier — versionless, old-style archive lower-cased
 * and without its subject class — or null when `input` is not an arXiv id.
 * Accepts `arXiv:` prefixes, abs / pdf URLs (with or without `.pdf`), version
 * suffixes and a trailing period.
 */
export function canonicalArxivId(input: string): string | null {
  let s = input.trim().replace(/\.$/, '');
  const url = /^(?:https?:\/\/)?(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\/(.+?)(?:\.pdf)?\/?$/i.exec(s);
  if (url?.[1]) s = url[1];
  s = s.replace(/^arxiv:\s*/i, '');
  const modern = /^(\d{4}\.\d{4,5})(?:v\d+)?$/i.exec(s);
  if (modern?.[1]) return modern[1];
  const old = /^([a-z]+(?:-[a-z]+)?)(?:\.[a-z]{2})?\/(\d{7})(?:v\d+)?$/i.exec(s);
  if (old?.[1] && old[2]) return `${old[1].toLowerCase()}/${old[2]}`;
  return null;
}

/** The versionless id of an entry's `<id>` URL (`http://arxiv.org/abs/1706.03762v7` → `1706.03762`). */
function entryArxivId(entryId: string): string | undefined {
  return canonicalArxivId(entryId) ?? undefined;
}

function toCandidate(entry: ArxivEntry): SourceCandidate | null {
  if (!entry.id || !entry.title) return null;
  if (entry.authors.length === 0) return null;

  // Year extracted from ISO published date (YYYY-MM-DDTHH:MM:SSZ).
  let year: number | undefined;
  const m = entry.published ? /^(\d{4})-/.exec(entry.published) : null;
  if (m?.[1]) {
    const y = Number(m[1]);
    if (y >= 1800 && y <= 2100) year = y;
  }

  const arxiv = entryArxivId(entry.id);
  // arXiv emits "Given Family" display names; author-normalize handles them.
  return {
    source: 'arxiv',
    id: entry.id,
    ...(arxiv !== undefined ? { arxiv } : {}),
    ...(entry.doi !== undefined ? { doi: entry.doi } : {}),
    title: entry.title,
    authors: entry.authors,
    ...(year !== undefined ? { year } : {}),
    ...(entry.summary !== undefined ? { abstract: entry.summary } : {}),
    ...(entry.journalRef !== undefined ? { venue: entry.journalRef } : {}),
    type: 'preprint',
    retracted: false,
    last_verified: new Date().toISOString(),
    citekey: generateCitekey({ authors: entry.authors, ...(year !== undefined ? { year } : {}) }),
    raw: entry,
  };
}

/** arXiv's error entries (`<id>http://arxiv.org/api/errors#…</id>`) are not works. */
function isErrorEntry(entryXml: string): boolean {
  return /<id>\s*https?:\/\/arxiv\.org\/api\/errors/i.test(entryXml);
}

// CR-05: the lazy `extractAll` regex is linear on well-formed input; a huge
// malformed feed is bounded upstream — bin/lib/http.ts streams every body under
// maxBytes and aborts with ResponseTooLargeError before full buffering (SEC-03).
function parseFeed(xml: string): SourceCandidate[] {
  return extractAll(xml, 'entry')
    .filter((e) => !isErrorEntry(e))
    .map(parseEntry)
    .filter((e): e is ArxivEntry => e !== null)
    .map(toCandidate)
    .filter((c): c is SourceCandidate => c !== null);
}

/** The Atom feed shape check (SRC-17: an HTML error page is never cached). */
const FEED: ShapeCheck = (res) => (/<feed\b[^>]*>/.test(res.body) ? null : 'no Atom <feed>');

export async function search(query: string, opts: SearchOptions = {}): Promise<SourceCandidate[]> {
  const limit = opts.limit ?? 20;
  const url = `${BASE}/api/query?search_query=${encodeURIComponent(query)}&max_results=${limit}`;
  const ex = await exchange(
    () => httpFetch(url, { source: 'arxiv', headers: ATOM_HEADERS, maxBytes: MAX_JSON_RESPONSE_BYTES, validate: validator(FEED) }),
    { service: SERVICE, check: FEED },
  );
  if (ex.kind === 'failed') {
    opts.onFailure?.(ex.reason);
    return [];
  }
  if (ex.kind === 'status') {
    opts.onFailure?.(statusReason(ex.res));
    return [];
  }
  return parseFeed(ex.res.body);
}

/** arXiv's answer for one identifier: found | not-found | failed (reason). */
export async function lookupById(id: string): Promise<LookupResult> {
  const canonical = canonicalArxivId(id);
  if (canonical === null) return lookupNotFound(`not an arXiv identifier: ${JSON.stringify(id.slice(0, 80))}`);
  const url = `${BASE}/api/query?id_list=${encodeURIComponent(canonical)}`;
  const ex = await exchange(
    () => httpFetch(url, { source: 'arxiv', headers: ATOM_HEADERS, maxBytes: MAX_JSON_RESPONSE_BYTES, validate: validator(FEED) }),
    { service: SERVICE, check: FEED },
  );
  if (ex.kind === 'failed') {
    return lookupFailed(ex.reason, {
      ...(ex.status !== undefined ? { status: ex.status } : {}),
      ...(ex.retryAfterMs !== undefined ? { retryAfterMs: ex.retryAfterMs } : {}),
    });
  }
  if (ex.kind === 'status') {
    if (ex.res.status === 404) return lookupNotFound('HTTP 404 (arXiv has no such paper)');
    return lookupFailed(statusReason(ex.res), { status: ex.res.status });
  }
  const entries = extractAll(ex.res.body, 'entry');
  if (entries.some(isErrorEntry)) return lookupNotFound(`arXiv has no paper ${canonical} (the id was rejected)`);
  const match = parseFeed(ex.res.body).find((c) => c.arxiv === canonical);
  if (!match) return lookupNotFound(`arXiv has no paper ${canonical}`);
  return lookupFound(match);
}

export async function fetchById(id: string): Promise<SourceCandidate | null> {
  return unwrapLookup(await lookupById(id), 'arxiv', id);
}
