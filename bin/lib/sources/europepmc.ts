// bin/lib/sources/europepmc.ts — Europe PMC open-access full text (Phase 20,
// VRFY-19, D-20-18).
//
// Endpoint:
//   GET https://www.ebi.ac.uk/europepmc/webservices/rest/PMC<id>/fullTextXML
//
// Europe PMC serves the full text of the articles in its open-access subset as
// JATS XML; any other PMCID answers 404. Pass 3 reads it as the third place a
// quote's source text can come from (after the user's own PDF and Unpaywall's
// open-access PDFs; before the arXiv PDF). The PMCID comes from the paper's
// library, so the answer is used only when the article it describes carries
// the DOI or PMID Pass 1 verified for the citation (`ids`, checked by
// bin/lib/verify/source-text.ts): a PMCID edited to point at another article
// never lends that article's text to a quote.
//
// No key and no contact email (Europe PMC asks neither): the request carries
// the plain `pensmith/<version>` User-Agent and only the PMCID. A full-text
// source only — no `search` (research never queries it) and no metadata
// lookup (a citation's record comes from its registrar).
//
// The three-way contract (D-19-05): lookupFullText answers found (the article:
// its ids, title, authors, year and plain text) | not-found (HTTP 404: not in
// the open-access subset, or no such PMCID) | failed (no usable answer; never
// read as "not found"). Offline replay is the exact-match fixture store in
// bin/lib/http.ts: a miss throws the typed OfflineEgressError.

import { fetch as httpFetch, MAX_JSON_RESPONSE_BYTES } from '../http.js';
import { exchange, statusReason, validator, type ShapeCheck } from './registrar-response.js';
import { decodeEntities } from '../markup.js';
import { normalizeDoi } from '../doi.js';

const BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest';
const SERVICE = 'Europe PMC';

/** A PMCID in its canonical form (`PMC1234567`), or null. */
export function normPmcid(id: string): string | null {
  const m = /^\s*(?:pmcid:\s*)?(?:PMC)?(\d{1,10})\s*$/i.exec(id);
  return m ? `PMC${m[1]}` : null;
}

/** The full-text URL of a PMCID. */
export function fullTextXmlUrl(pmcid: string): string {
  return `${BASE}/${pmcid}/fullTextXML`;
}

/** The identifiers an article's JATS front matter names. */
export interface ArticleIds {
  readonly doi: string | null;
  readonly pmid: string | null;
  readonly pmcid: string | null;
}

/** An article's full text as Pass 3 reads it. */
export interface EuropePmcArticle {
  readonly ids: ArticleIds;
  readonly title: string | null;
  readonly authors: readonly string[];
  readonly year: number | null;
  /** Title, abstract, body and back matter as plain text (the reference list left out). */
  readonly text: string;
}

const JATS: ShapeCheck = (res) => (/<article[\s>]/.test(res.body) && /<\/article>\s*$/.test(res.body.trim()) ? null : 'no JATS <article>');

/**
 * Elements of the abstract, body and back matter whose content is never the
 * article's prose: the reference list, citation markers, formula source.
 * (The rest of the front matter is not read at all.)
 */
const DROPPED_ELEMENTS = ['ref-list', 'xref', 'tex-math', 'mml:math', 'math', 'object-id'];

/** Block elements that end a line of text. */
const BLOCK_TAGS = /<\/?(?:p|sec|title|article-title|abstract|caption|label|td|th|tr|list-item|disp-quote|fn|table-wrap|fig|boxed-text|def-item|term|def|statement|kwd-group|body|back|front|ack|app|glossary|notes|trans-abstract)\b[^>]*>/gi;

/** The text of the first `<tag …>…</tag>` in `xml` (tags stripped), or null. */
function firstText(xml: string, re: RegExp): string | null {
  const m = re.exec(xml);
  if (m === null) return null;
  const t = decodeEntities((m[1] ?? '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  return t.length > 0 ? t : null;
}

/** Remove every `<name …>…</name>` element (non-greedy; nested elements of other names inside are removed with it). */
function dropElements(xml: string, names: readonly string[]): string {
  let out = xml;
  for (const name of names) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`<${esc}(?:\\s[^>]*)?/>`, 'gi'), ' ');
    out = out.replace(new RegExp(`<${esc}(?:\\s[^>]*)?>[\\s\\S]*?</${esc}>`, 'gi'), ' ');
  }
  return out;
}

/** An article's ids, title, authors, year and plain text from its JATS XML. */
export function jatsToArticle(xml: string): EuropePmcArticle {
  const meta = /<article-meta\b[\s\S]*?<\/article-meta>/i.exec(xml)?.[0] ?? '';
  const id = (type: string): string | null => firstText(meta, new RegExp(`<article-id\\b[^>]*pub-id-type="${type}"[^>]*>([\\s\\S]*?)</article-id>`, 'i'));
  const rawDoi = id('doi');
  const rawPmcid = id('pmcid') ?? id('pmc');
  const pmid = id('pmid');
  const title = firstText(meta, /<article-title\b[^>]*>([\s\S]*?)<\/article-title>/i);
  const authors: string[] = [];
  // Every <contrib> of the front matter that is not marked as another role
  // (an editor, a reviewer): some articles mark the role on the contrib-group.
  for (const c of meta.matchAll(/<contrib\b([^>]*)>([\s\S]*?)<\/contrib>/gi)) {
    const role = /contrib-type="([^"]*)"/i.exec(c[1] ?? '')?.[1];
    if (role !== undefined && role.toLowerCase() !== 'author') continue;
    const inner = c[2] ?? '';
    const family = firstText(inner, /<surname\b[^>]*>([\s\S]*?)<\/surname>/i);
    const given = firstText(inner, /<given-names\b[^>]*>([\s\S]*?)<\/given-names>/i);
    const collab = firstText(inner, /<collab\b[^>]*>([\s\S]*?)<\/collab>/i);
    if (family) authors.push(given ? `${family}, ${given}` : family);
    else if (collab) authors.push(collab);
  }
  const yearText = firstText(meta, /<pub-date\b[^>]*>[\s\S]*?<year>([\s\S]*?)<\/year>/i);
  const year = yearText !== null && /^\d{4}$/.test(yearText) ? Number(yearText) : null;

  // The readable text: title and abstract from the front matter, then body and back.
  const abstracts = [...meta.matchAll(/<abstract\b[^>]*>[\s\S]*?<\/abstract>/gi)].map((m) => m[0]).join('\n');
  const body = /<body\b[^>]*>[\s\S]*<\/body>/i.exec(xml)?.[0] ?? '';
  const back = /<back\b[^>]*>[\s\S]*<\/back>/i.exec(xml)?.[0] ?? '';
  const readable = dropElements(`${title ?? ''}\n${abstracts}\n${body}\n${back}`, DROPPED_ELEMENTS)
    .replace(BLOCK_TAGS, '\n')
    .replace(/<[^>]+>/g, '');
  const text = decodeEntities(readable)
    .split('\n')
    .map((l) => l.replace(/[ \t\r\f\v]+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n');
  return {
    ids: { doi: rawDoi === null ? null : normalizeDoi(rawDoi), pmid: pmid !== null && /^\d+$/.test(pmid) ? pmid : null, pmcid: rawPmcid === null ? null : normPmcid(rawPmcid) },
    title,
    authors,
    year,
    text,
  };
}

/** The outcome of one full-text request (see the header); throws only OfflineEgressError. */
export type FullTextLookup =
  | { readonly kind: 'found'; readonly article: EuropePmcArticle; readonly url: string; readonly body: string }
  | { readonly kind: 'not-found'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string; readonly status?: number };

/**
 * The open-access full text of `pmcid`. Not cached by the HTTP layer: Pass 3
 * keeps the extracted text in its own cache (bin/lib/verify/source-text.ts).
 */
export async function lookupFullText(pmcid: string): Promise<FullTextLookup> {
  const id = normPmcid(pmcid);
  if (id === null) return { kind: 'not-found', reason: `not a PMCID: ${JSON.stringify(pmcid.slice(0, 40))}` };
  const url = fullTextXmlUrl(id);
  const ex = await exchange(
    () =>
      httpFetch(url, {
        source: 'europepmc',
        headers: { accept: 'application/xml' },
        noCache: true,
        maxBytes: MAX_JSON_RESPONSE_BYTES,
        validate: validator(JATS),
      }),
    { service: SERVICE, check: JATS },
  );
  if (ex.kind === 'failed') return { kind: 'failed', reason: ex.reason, ...(ex.status !== undefined ? { status: ex.status } : {}) };
  if (ex.kind === 'status') {
    if (ex.res.status === 404) return { kind: 'not-found', reason: `HTTP 404 (Europe PMC has no open-access full text of ${id})` };
    return { kind: 'failed', reason: statusReason(ex.res), status: ex.res.status };
  }
  return { kind: 'found', article: jatsToArticle(ex.res.body), url: ex.res.finalUrl ?? url, body: ex.res.body };
}
