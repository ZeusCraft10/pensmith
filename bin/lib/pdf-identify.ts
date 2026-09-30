// bin/lib/pdf-identify.ts — which work is this PDF? (SRC-13, SRC-15, D-19-20)
//
// `add <file.pdf>`, `add <url>` that answers a PDF, and bring-your-own folder
// ingest all need the registrar record of the work a PDF contains. The audit
// found `add` hydrating the WRONG work from a PDF's licence line (UX-19): it
// took the first line as the title and the first Crossref hit as the answer.
// This module identifies a PDF from, in order:
//
//   0. when the user runs a GROBID server on this machine
//      (PENSMITH_GROBID_URL, loopback only — bin/lib/grobid.ts) and the caller
//      passes the PDF's bytes: the DOI / arXiv id GROBID reads from the header,
//      and GROBID's title and authors in place of the layout heuristic's
//      (a GROBID failure is a failure line; the heuristic below still runs);
//   1. identifiers in the embedded metadata — the Info dictionary and XMP
//      (`prism:doi`, `pdfx:doi`, `crossmark:DOI`, `dc:identifier`, a DOI in
//      Subject / Keywords, an `arXiv:` id);
//   2. identifiers on the first pages — the arXiv stamp printed down the left
//      margin (`arXiv:1706.03762v7 [cs.CL] 2 Aug 2023`), a DOI in the header or
//      footer, then any other `arXiv:` mention;
//   3. the title and first author — from the metadata when it is a real title,
//      else from a layout heuristic over page 1 that skips licence /
//      permission / copyright notices and their continuation lines, arXiv
//      stamps, affiliations, e-mail and URL lines, journal running heads —
//      searched at Crossref, then OpenAlex, accepting a hit only when its
//      title's Jaro-Winkler similarity reaches TITLE_JW_THRESHOLD AND its first
//      author's family name reaches AUTHOR_JW_THRESHOLD (the Pass-1 thresholds)
//      AND its year is plausible for the PDF (Phase 19 review round 2): a
//      record dated more than YEAR_SLACK years after the year printed on the
//      PDF's first page — or a preprint / posted-content record dated after it
//      — is a later re-post of the work, not this PDF (OpenAlex now dates
//      "Attention Is All You Need" 2025, under a re-post DOI). When such a
//      re-post was the only match, or the OpenAlex search failed, the title is
//      searched at arXiv (the preprint a PDF like that usually is) under the
//      same rules.
//
// A record found through an identifier (GROBID's, the metadata's or one
// printed in the text) is accepted only when it is the PDF's OWN work: a DOI
// or arXiv id on the first pages may belong to a work the PDF cites — in a
// footnote, a reference list, a "see also" line — and that work's title sits
// right next to its identifier there. So a record is accepted when
//   (a) its title matches the PDF's own title (metadata, GROBID or the layout
//       heuristic) at TITLE_JW_THRESHOLD and, when the PDF names an author,
//       its first author's family name matches at AUTHOR_JW_THRESHOLD — the
//       title-search rule; or
//   (b) its title is printed AS a title: it fills one to four whole lines
//       among the first TITLE_BLOCK_LINES lines of page 1, and the record's
//       first author's family name appears in the byline just below it — a
//       title embedded in a citation line never qualifies; or
//   (c) page 1 prints the record's DOI on a labelled line of its own
//       (`DOI: 10.1371/journal.pmed.0020124`, how a journal prints the
//       article's own DOI) AND its title is printed as a title with its byline
//       below ANYWHERE on page 1 — a two-column layout whose extracted text
//       puts the body before the title block (PLOS) still counts as the PDF's
//       own work, while a DOI wrapped onto its own line in a reference list
//       does not (the cited title is not printed above its author there).
// Anything short of that is `unidentified` — `add` refuses, BYO keeps the PDF
// with its local metadata flagged unhydrated. A wrong work is never returned.
//
// Privacy (PRD §9, PRIVACY.md): only an identifier or the title leaves the
// machine — one lookup per registrar consulted, never the PDF's text.

import { normalizeDoi, findDoisInText, findArxivIdsInText } from './doi.js';
import { jaroWinkler, TITLE_JW_THRESHOLD, AUTHOR_JW_THRESHOLD } from './fuzzy.js';
import { firstAuthorSurname } from './author-normalize.js';
import { normArxiv, normTitle } from './migrations/library/shape.js';
import { parsePersonName } from './person-name.js';
import { lookupIdentifier, searchByTitle, searchArxivByTitle, type TitleSearchOutcome } from './source-input.js';
import type { LookupResult } from './sources/lookup.js';
import type { SourceCandidate } from './schemas/source-candidate.js';
import type { PdfExtraction } from './pdf-text.js';
import { grobidHeader, type GrobidHeader } from './grobid.js';
import { isOfflineEgressError } from './http.js';

export { TITLE_JW_THRESHOLD, AUTHOR_JW_THRESHOLD };

/** How many leading pages are searched for identifiers and the title. */
export const IDENTIFY_PAGES = 2;

/** What the PDF itself says about the work (metadata + layout heuristic). */
export interface LocalPdfMetadata {
  readonly title: string | null;
  /** Author display strings ("Given Family" as printed), first author first. */
  readonly authors: readonly string[];
  readonly year: number | null;
  /** Where the title came from. */
  readonly titleSource: 'metadata' | 'layout' | 'grobid' | null;
}

export type IdentifyVia =
  | 'grobid-doi'
  | 'grobid-arxiv'
  | 'metadata-doi'
  | 'metadata-arxiv'
  | 'text-arxiv-stamp'
  | 'text-doi'
  | 'text-arxiv'
  | 'title-search';

export type IdentifyResult =
  | {
      readonly kind: 'identified';
      readonly candidate: SourceCandidate;
      readonly via: IdentifyVia;
      /** The identifier or title that was looked up. */
      readonly query: string;
      readonly local: LocalPdfMetadata;
    }
  | {
      readonly kind: 'unidentified';
      /** One line: why no record was accepted. */
      readonly reason: string;
      readonly local: LocalPdfMetadata;
      /** Lookups that failed (network / service), which may explain the miss. */
      readonly failures: readonly string[];
    };

/** The lookups identifyPdf performs (injectable for tests; defaults hit the adapters). */
export interface IdentifyDeps {
  lookupDoi(doi: string): Promise<LookupResult>;
  lookupArxiv(id: string): Promise<LookupResult>;
  /** Search the title; `accept` says whether a hit is a confident match (the search may stop there). */
  searchTitle(title: string, accept: (c: SourceCandidate) => boolean): Promise<TitleSearchOutcome>;
  /**
   * Search the title at arXiv — asked only when the title and first author
   * matched nothing but a record dated after the PDF (a later re-post). Absent:
   * not asked (default: source-input.ts searchArxivByTitle).
   */
  searchArxivTitle?(title: string): Promise<TitleSearchOutcome>;
  /**
   * The user's local GROBID header for these PDF bytes, or null when GROBID is
   * not configured / found no header (default: bin/lib/grobid.ts grobidHeader).
   */
  grobidHeader?(pdf: Buffer): Promise<GrobidHeader | null>;
}

const DEFAULT_DEPS: IdentifyDeps = {
  lookupDoi: (doi) => lookupIdentifier({ kind: 'doi', raw: doi, doi }),
  lookupArxiv: (arxiv) => lookupIdentifier({ kind: 'arxiv', raw: arxiv, arxiv }),
  searchTitle: (title, accept) => searchByTitle(title, accept),
  searchArxivTitle: (title) => searchArxivByTitle(title),
  grobidHeader: (pdf) => grobidHeader(pdf),
};

/**
 * How many years a registrar record may postdate the year printed on the PDF
 * (a preprint's version of record, a conference paper's journal version).
 */
export const YEAR_SLACK = 2;

/**
 * True unless `record` is dated after the PDF could have been (see the header):
 * more than YEAR_SLACK years after the PDF's own year, or — for a preprint
 * record, which the PDF would itself be — any year after it. Unknown years pass.
 */
export function plausibleYear(record: Pick<SourceCandidate, 'year' | 'type'>, local: Pick<LocalPdfMetadata, 'year'>): boolean {
  if (typeof record.year !== 'number' || local.year === null) return true;
  if (record.type === 'preprint') return record.year <= local.year;
  return record.year <= local.year + YEAR_SLACK;
}

/** Options for identifyPdf beyond the extraction. */
export interface IdentifyOptions {
  /** The PDF's bytes — needed only for the GROBID header (step 0). */
  readonly pdf?: Buffer;
}

/** GROBID's header as the PDF's own metadata (GROBID's title and authors win over the heuristic's). */
function withGrobid(local: LocalPdfMetadata, g: GrobidHeader): LocalPdfMetadata {
  const title = g.title.replace(/\s+/g, ' ').trim();
  if (!title) return local;
  return { title, authors: g.authors.length > 0 ? g.authors : local.authors, year: local.year, titleSource: 'grobid' };
}

// ---------------------------------------------------------------------------
// Metadata.
// ---------------------------------------------------------------------------

function metaString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim() : null;
}

/** A metadata title that is really a title (not a file name, a tool stamp or "untitled"). */
function usableMetadataTitle(t: string | null): string | null {
  if (!t) return null;
  if (/^(?:untitled|no title|title|document\d*|slide \d+)$/i.test(t)) return null;
  if (/\.(?:dvi|pdf|docx?|tex|ps|indd|qxd|rtf|odt)$/i.test(t)) return null;
  if (/^microsoft (?:word|powerpoint)\b|^(?:layout|template)\s*\d*$/i.test(t)) return null;
  if (/^[\w-]+$/.test(t) && !/\s/.test(t) && t.length < 20) return null; // a bare token such as "paper_v3"
  if (t.split(/\s+/).length < 2) return null;
  return t;
}

/** Identifiers declared in the Info dictionary or XMP. */
export function metadataIdentifiers(ex: Pick<PdfExtraction, 'info' | 'xmp'>): { doi: string | null; arxiv: string | null } {
  const values: string[] = [];
  const xmp = ex.xmp ?? {};
  for (const key of ['prism:doi', 'pdfx:doi', 'crossmark:doi', 'crossmark:DOI', 'dc:identifier', 'prism:url', 'dc:source']) {
    const v = metaString(xmp[key]);
    if (v) values.push(v);
  }
  const info = ex.info as Record<string, unknown>;
  for (const [k, v] of Object.entries(info)) {
    if (/^(?:doi|subject|keywords|identifier|arxiv)$/i.test(k)) {
      const s = metaString(v);
      if (s) values.push(s);
    }
  }
  let doi: string | null = null;
  let arxiv: string | null = null;
  for (const v of values) {
    doi ??= normalizeDoi(v) ?? findDoisInText(v)[0] ?? null;
    if (arxiv === null) {
      const found = findArxivIdsInText(v);
      arxiv = found.stamped[0] ?? found.mentioned[0] ?? null;
    }
  }
  // A DataCite arXiv DOI (10.48550/arXiv.<id>) in the metadata is the arXiv record.
  if (doi !== null) {
    const fromDoi = normArxiv(doi);
    if (fromDoi !== null) {
      arxiv ??= fromDoi;
      doi = null;
    }
  }
  return { doi, arxiv };
}

// ---------------------------------------------------------------------------
// The layout heuristic (page 1).
// ---------------------------------------------------------------------------

/** Words that make a line a licence / permission / copyright notice. */
const NOTICE_RE =
  /\b(?:permission|permitted|licen[cs]ed?|copyright|all rights reserved|creative commons|attribution|reproduce|reproduction|journalistic|scholarly works|terms of use|reuse|preprint|under review|accepted (?:for|at|to)|submitted to|to appear in|camera[- ]ready|proceedings of|conference on|workshop on|published (?:in|by|online)|received|revised|available online|contents lists|journal homepage|elsevier|springer|wiley|ieee|acm|arxiv)\b|©|\(c\)\s*\d{4}/i;

/** Affiliation / address markers. */
const AFFILIATION_RE =
  /\b(?:university|universit(?:y|ät|é|à|at|ad|eit)|institute|institut|department|dept\.|laborator(?:y|ies)|college|school of|faculty|centre|center for|hospital|inc\.|ltd\.?|gmbh|corporation|google|microsoft|deepmind|meta ai|openai|brain team|research lab|academy of)\b/i;

// A journal running head: `Journal of …`, `Vol. 3`, `pp.`, and the
// pipe-separated kind (`August 2005 | Volume 2 | Issue 8 | e124`, PLOS).
const RUNNING_HEAD_RE =
  /^(?:journal of|vol(?:ume)?\.?\s*\d|pp\.|page \d|issn|isbn|doi\b|https?:|www\.)|\bvol\.\s*\d+|\bno\.\s*\d+\b|\b(?:volume|issue)\s+\d+\b|\S\s+\|\s+\S/i;

/** A journal's article-type label printed above the title ("NEWS & VIEWS", "REVIEW", …). */
const ARTICLE_TYPE_RE =
  /^(?:news (?:&|and) views|reviews?|review article|article|research articles?|letters?|editorial|commentary|perspectives?|original (?:article|research)|brief (?:report|communication)|short communication|correspondence|essay|opinion|feature|analysis|research|report)$/i;

function isSkippable(line: string): boolean {
  if (NOTICE_RE.test(line)) return true;
  if (/@|https?:\/\/|www\./i.test(line)) return true;
  if (RUNNING_HEAD_RE.test(line)) return true;
  if (AFFILIATION_RE.test(line)) return true;
  if (ARTICLE_TYPE_RE.test(line)) return true;
  if (!/\p{L}{2}/u.test(line)) return true; // numbers, dates, page marks
  return false;
}

/** The heading that ends the title block: nothing after it is the title. */
const BODY_START_RE = /^(?:abstract|introduction|keywords?|summary|contents|table of contents|1\.?\s+introduction)\b/i;

/** A line that could be (part of) a title. */
function titleLike(line: string): boolean {
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 25) return false;
  if (/^\p{Ll}/u.test(line)) return false; // a continuation of the previous line
  if (BODY_START_RE.test(line)) return false;
  if (/\[\d/.test(line)) return false; // a numbered citation marker: body prose, never a title
  if (words.length > 12 && /[.;]$/.test(line)) return false; // running prose
  return true;
}

const AUTHOR_MARKERS = /[*∗†‡§¶#]|\p{L}\d/u;
const AUTHOR_SPLIT = /\s*(?:[*∗†‡§¶#]+|\d+|,|;|&|\band\b|\s{2,})\s*/u;

/** The personal names on an author line ("Ashish Vaswani* Noam Shazeer*" → both). */
export function namesFromAuthorLine(line: string): string[] {
  return line
    .split(AUTHOR_SPLIT)
    .map((s) => s.replace(/[^\p{L}\p{M}.'\s-]/gu, '').replace(/\s+/g, ' ').trim())
    .filter((s) => {
      const words = s.split(' ').filter(Boolean);
      return words.length >= 2 && words.length <= 4 && words.every((w) => /^[\p{Lu}\p{Lt}]/u.test(w) || /^(?:van|von|der|den|de|da|di|du|la|le|del|della|ten|ter|bin|al)$/.test(w));
    });
}

/**
 * A line that reads as a list of person names. A title-case title ("Deep
 * Learning") also reads as one name, so a candidate TITLE is rejected only
 * when the line carries author markers or several names (`strict`).
 */
function authorLike(line: string, strict = false): boolean {
  if (isSkippable(line)) return false;
  const names = namesFromAuthorLine(line);
  if (names.length === 0) return false;
  if (strict && names.length < 2 && !AUTHOR_MARKERS.test(line)) return false;
  const nameWords = names.join(' ').split(' ').length;
  const lineWords = line.replace(/[*∗†‡§¶#\d,;&]/gu, ' ').split(/\s+/).filter((w) => w && w.toLowerCase() !== 'and').length;
  return nameWords >= lineWords * 0.7;
}

const CONNECTOR_END = /(?:\b(?:of|and|the|for|in|on|with|to|a|an|via|from|by|under|towards?|at)|[:–—-])$/i;

/** Title and author lines from page 1 by layout (see the header). */
export function layoutTitleAndAuthors(firstPage: string): { title: string | null; authors: string[] } {
  const lines = firstPage
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0);
  // A skipped line that does not end a sentence continues on the next line
  // (a two-line permission notice): skip those continuations too.
  const usable: Array<{ line: string; index: number }> = [];
  let continuing = false;
  lines.slice(0, 40).forEach((line, index) => {
    if (isSkippable(line)) {
      continuing = !/[.!?)]$/.test(line);
      return;
    }
    if (continuing && /^\p{Ll}/u.test(line)) {
      continuing = !/[.!?)]$/.test(line);
      return;
    }
    continuing = false;
    usable.push({ line, index });
  });

  for (let i = 0; i < usable.length; i++) {
    const first = usable[i]!;
    if (BODY_START_RE.test(first.line)) break; // the title never follows the abstract heading
    if (!titleLike(first.line) || authorLike(first.line, true)) continue;
    let title = first.line;
    let next = i + 1;
    // A title wrapped over up to three lines right above the author line: take
    // every line down to it.
    let authorAt = -1;
    for (let j = i + 1; j < Math.min(usable.length, i + 4); j++) {
      const cur = usable[j]!;
      if (cur.index !== usable[j - 1]!.index + 1 || BODY_START_RE.test(cur.line)) break;
      if (authorLike(cur.line, true)) {
        authorAt = j;
        break;
      }
      if (cur.line.split(/\s+/).length > 15) break;
    }
    if (authorAt > i + 1) {
      const merged = usable.slice(i, authorAt).map((u) => u.line).join(' ');
      if (merged.split(/\s+/).length <= 25) {
        title = merged;
        next = authorAt;
      }
    }
    // Otherwise a line that visibly continues (a trailing connector word, or a
    // lower-case start) is part of the title.
    while (
      next < usable.length &&
      usable[next]!.index === usable[next - 1]!.index + 1 &&
      !authorLike(usable[next]!.line) &&
      !BODY_START_RE.test(usable[next]!.line) &&
      (CONNECTOR_END.test(title) || /^\p{Ll}/u.test(usable[next]!.line)) &&
      `${title} ${usable[next]!.line}`.split(/\s+/).length <= 25
    ) {
      title = `${title} ${usable[next]!.line}`;
      next++;
    }
    // Running prose that happened to start a page is not a title.
    if (title.split(/\s+/).length > 14 && /[.;]$/.test(title)) continue;
    // The authors: the first author-like line within the next few lines.
    let authors: string[] = [];
    for (let j = next; j < Math.min(usable.length, next + 4); j++) {
      if (authorLike(usable[j]!.line)) {
        authors = namesFromAuthorLine(usable[j]!.line);
        break;
      }
    }
    return { title: title.replace(/[.:;,]+$/, ''), authors };
  }
  return { title: null, authors: [] };
}

/** A month followed (within a day number) by a year: `August 2005`, `12 March 2018`, `Mar. 3, 2019`. */
const MONTH_YEAR_RE =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(?:\d{1,2}(?:st|nd|rd|th)?,?\s+)?(?:19[5-9]\d|20\d\d)\b/i;

/**
 * A line that dates the PDF itself: a copyright / licence line, a
 * received / accepted / published line, a citation box, a journal running
 * head (`Vol.`, `Issue`, `pp.`, `2020; 395:`), a conference or proceedings
 * line, an ISO date or a month-and-year. A year anywhere else on page 1 — in
 * the title above all ("Lessons from the 2008 Financial Crisis"), an
 * affiliation, the abstract — says nothing about when this PDF appeared.
 */
const DATE_LINE_RE = new RegExp(
  [
    '©',
    '\\(c\\)\\s*(?:19|20)\\d\\d',
    '\\b(?:copyright|licen[cs]ed?|received|accepted|revised|published|available online|first published|issued|citation|cite this|how to cite|proceedings|conference|symposium|workshop|journal)\\b',
    '\\b(?:vol(?:ume)?\\.?|no\\.|issue|pp\\.)\\s*\\d',
    '\\b(?:19|20)\\d\\d-\\d\\d-\\d\\d\\b',
    '\\b(?:19|20)\\d\\d\\s*[;,]\\s*\\d+\\s*[:(]',
    MONTH_YEAR_RE.source,
  ].join('|'),
  'i',
);

/** Lower-case letters and digits only, single-spaced (to compare a line with the title). */
function flat(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * The PDF's own year: the first plausible year on a DATE_LINE_RE line of page
 * 1 that is not part of the PDF's title (review round 3) — else null, never
 * the first number on the page (a year in the title would otherwise read as
 * the publication year and refuse the right record as "a later re-post").
 */
function yearFromText(firstPage: string, titles: ReadonlyArray<string | null>): number | null {
  const max = new Date().getUTCFullYear() + 1;
  const flatTitles = titles.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map(flat);
  for (const raw of firstPage.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line || /\barxiv:/i.test(line)) continue; // the stamp's date is the version date
    if (!DATE_LINE_RE.test(line)) continue;
    const flatLine = flat(line);
    if (flatLine.includes(' ') && flatTitles.some((t) => t.includes(flatLine))) continue; // a line of the title block
    for (const m of line.matchAll(/\b(19[5-9]\d|20\d\d)\b/g)) {
      const y = Number(m[1]);
      if (y <= max) return y;
    }
  }
  return null;
}

/** Everything the PDF says about itself (no network). */
export function localPdfMetadata(ex: Pick<PdfExtraction, 'info' | 'xmp' | 'pages' | 'text'>): LocalPdfMetadata {
  const info = ex.info as Record<string, unknown>;
  const xmp = ex.xmp ?? {};
  const metaTitle = usableMetadataTitle(metaString(xmp['dc:title']) ?? metaString(info['Title']));
  const metaAuthor = metaString(xmp['dc:creator']) ?? metaString(info['Author']);
  const firstPage = ex.pages[0] ?? ex.text.slice(0, 6000);
  const layout = layoutTitleAndAuthors(firstPage);
  const metaAuthors = metaAuthor
    ? metaAuthor
        .split(/\s*(?:;|,|\band\b|&)\s*/)
        .map((s) => s.trim())
        .filter((s) => s.split(/\s+/).length >= 2)
    : [];
  const title = metaTitle ?? layout.title;
  return {
    title,
    authors: metaAuthors.length > 0 ? metaAuthors : layout.authors,
    year: yearFromText(firstPage, [metaTitle, layout.title]),
    titleSource: metaTitle ? 'metadata' : layout.title ? 'layout' : null,
  };
}

// ---------------------------------------------------------------------------
// Matching.
// ---------------------------------------------------------------------------

/** Family name of an author display string, lowercased and normalized (Pass-1 form). */
function family(author: string): string {
  const parsed = parsePersonName(author);
  return firstAuthorSurname(parsed && !parsed.literal ? `${parsed.family}, ${parsed.given ?? ''}` : author);
}

/** Title + first-author similarity of a registrar record against the PDF's own metadata. */
export function matchScores(record: Pick<SourceCandidate, 'title' | 'authors'>, local: LocalPdfMetadata): { titleJW: number; authorJW: number } {
  const titleJW = local.title ? jaroWinkler(normTitle(record.title), normTitle(local.title)) : 0;
  const recordFirst = record.authors[0];
  const localFirst = local.authors[0];
  const authorJW = recordFirst && localFirst ? jaroWinkler(family(recordFirst), family(localFirst)) : 0;
  return { titleJW, authorJW };
}

/** How many leading lines of page 1 hold the title block (rule (b) of the header). */
export const TITLE_BLOCK_LINES = 25;
/** How many lines below a printed title the byline may sit. */
const BYLINE_LINES = 6;

/**
 * The DOIs page 1 prints on a labelled line of their own — `DOI: 10.1371/…`,
 * `doi:10.…`, `https://doi.org/10.…`, and nothing else on the line (rule (c)).
 */
export function labelledDoiLines(firstPage: string): string[] {
  const out: string[] = [];
  for (const raw of firstPage.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!/\bdoi\b|doi\.org\//.test(line)) continue;
    const dois = findDoisInText(line);
    const doi = dois[0];
    if (dois.length !== 1 || doi === undefined) continue;
    const rest = line
      .replace(/https?:\/\/(?:dx\.)?doi\.org\//g, ' ')
      .replace(/\bdoi\b\s*:?/g, ' ')
      .replace(doi, ' ');
    if (/[\p{L}\p{N}]/u.test(rest)) continue;
    if (!out.includes(doi)) out.push(doi);
  }
  return out;
}

/**
 * Rule (b): the record's title fills whole lines among the first `maxLines`
 * lines of page 1 (its title block by default), with its first author in the
 * byline below.
 */
function printedAsTitle(record: Pick<SourceCandidate, 'title' | 'authors'>, firstPage: string, maxLines = TITLE_BLOCK_LINES): boolean {
  const want = normTitle(record.title);
  const first = record.authors[0];
  if (!want || !first) return false;
  const surname = family(first).replace(/[^\p{L}\p{N}]+/gu, '');
  if (!surname) return false;
  const lines = firstPage
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .slice(0, maxLines + BYLINE_LINES);
  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    for (let n = 1; n <= 4 && i + n <= lines.length; n++) {
      const run = normTitle(lines.slice(i, i + n).join(' '));
      if (!run || jaroWinkler(run, want) < TITLE_JW_THRESHOLD) continue;
      const byline = lines.slice(i + n, i + n + BYLINE_LINES);
      if (byline.some((l) => normTitle(l).replace(/\s+/g, '').includes(surname))) return true;
    }
  }
  return false;
}

/**
 * True when `record` is the PDF's own work, not a work it cites (see the
 * header: rule (a) against the PDF's own title and first author, rule (b) the
 * title printed as a title with its byline, or rule (c) the record's DOI on a
 * labelled line of its own plus its title and byline anywhere on page 1).
 */
export function isOwnWork(
  record: Pick<SourceCandidate, 'title' | 'authors'> & { readonly doi?: string | null | undefined },
  firstPage: string,
  local: LocalPdfMetadata,
): boolean {
  if (local.title !== null) {
    const s = matchScores(record, local);
    if (s.titleJW >= TITLE_JW_THRESHOLD && (local.authors.length === 0 || s.authorJW >= AUTHOR_JW_THRESHOLD)) return true;
  }
  if (printedAsTitle(record, firstPage)) return true;
  const doi = typeof record.doi === 'string' ? normalizeDoi(record.doi) : null;
  return doi !== null && labelledDoiLines(firstPage).includes(doi) && printedAsTitle(record, firstPage, Number.POSITIVE_INFINITY);
}

function failureLine(what: string, r: Extract<LookupResult, { kind: 'failed' }>): string {
  return `${what}: ${r.reason}`;
}

/**
 * Identify the work in an extracted PDF (see the header). Lookups throw only
 * the typed OfflineEgressError (sources offline with no recorded answer, or
 * --dry-run); callers report that as "needs the network".
 */
export async function identifyPdf(ex: PdfExtraction, deps: IdentifyDeps = DEFAULT_DEPS, opts: IdentifyOptions = {}): Promise<IdentifyResult> {
  let local = localPdfMetadata(ex);
  const firstPages = ex.pages.length > 0 ? ex.pages.slice(0, IDENTIFY_PAGES).join('\n') : ex.text.slice(0, 12000);
  const firstPage = ex.pages[0] ?? ex.text.slice(0, 6000);
  const hasText = firstPages.replace(/\s/g, '').length > 0;
  const failures: string[] = [];
  const tried = new Set<string>();

  // 0. The user's local GROBID server, when configured (SRC-15, D-19-21).
  let grobid: GrobidHeader | null = null;
  if (opts.pdf !== undefined && deps.grobidHeader !== undefined) {
    try {
      grobid = await deps.grobidHeader(opts.pdf);
    } catch (e) {
      if (isOfflineEgressError(e)) throw e;
      failures.push(`GROBID: ${(e as Error).message.split(/\r?\n/)[0] ?? 'failed'}`);
    }
    if (grobid !== null) local = withGrobid(local, grobid);
  }

  // A record found by identifier must be the PDF's own work (the header);
  // one that is not is remembered for the refusal line.
  const citedWorks: string[] = [];
  const byId = async (
    kind: 'doi' | 'arxiv',
    id: string,
    via: IdentifyVia,
    requireOwnWork: boolean,
  ): Promise<IdentifyResult | null> => {
    const key = `${kind}:${id}`;
    if (tried.has(key)) return null;
    tried.add(key);
    const r = kind === 'doi' ? await deps.lookupDoi(id) : await deps.lookupArxiv(id);
    if (r.kind === 'failed') {
      failures.push(failureLine(kind === 'doi' ? `DOI ${id}` : `arXiv:${id}`, r));
      return null;
    }
    if (r.kind === 'not-found') return null;
    if (requireOwnWork && hasText && !isOwnWork(r.candidate, firstPage, local)) {
      citedWorks.push(`${kind === 'doi' ? id : `arXiv:${id}`} ("${r.candidate.title}")`);
      return null;
    }
    return { kind: 'identified', candidate: r.candidate, via, query: kind === 'doi' ? id : `arXiv:${id}`, local };
  };

  if (grobid?.doi) {
    const hit = await byId('doi', grobid.doi, 'grobid-doi', true);
    if (hit) return hit;
  }
  if (grobid?.arxiv) {
    const hit = await byId('arxiv', grobid.arxiv, 'grobid-arxiv', true);
    if (hit) return hit;
  }

  // 1. Embedded metadata identifiers.
  const meta = metadataIdentifiers(ex);
  if (meta.doi) {
    const hit = await byId('doi', meta.doi, 'metadata-doi', true);
    if (hit) return hit;
  }
  if (meta.arxiv) {
    const hit = await byId('arxiv', meta.arxiv, 'metadata-arxiv', true);
    if (hit) return hit;
  }

  // 2. Identifiers printed on the first pages.
  const ids = findArxivIdsInText(firstPages);
  for (const id of ids.stamped.slice(0, 2)) {
    const hit = await byId('arxiv', id, 'text-arxiv-stamp', true);
    if (hit) return hit;
  }
  for (const doi of findDoisInText(firstPages).slice(0, 3)) {
    const hit = await byId('doi', doi, 'text-doi', true);
    if (hit) return hit;
  }
  for (const id of ids.mentioned.slice(0, 2)) {
    const hit = await byId('arxiv', id, 'text-arxiv', true);
    if (hit) return hit;
  }

  // Identifiers that named a cited work, not this PDF: said in every refusal.
  const cited =
    citedWorks.length > 0
      ? `; ${citedWorks.join(', ')} ${citedWorks.length === 1 ? 'is a work' : 'are works'} the PDF cites, not the PDF itself`
      : '';

  // 3. Title (+ first author) search.
  if (!local.title) {
    return {
      kind: 'unidentified',
      reason: (hasText ? 'no identifier and no recognizable title on the first page' : 'no extractable text and no identifier in its metadata') + cited,
      local,
      failures,
    };
  }
  if (local.authors.length === 0) {
    return { kind: 'unidentified', reason: `no author found under the title "${local.title}" to confirm a match${cited}`, local, failures };
  }
  const matches = (c: SourceCandidate): boolean => {
    const s = matchScores(c, local);
    return s.titleJW >= TITLE_JW_THRESHOLD && s.authorJW >= AUTHOR_JW_THRESHOLD;
  };
  const confident = (c: SourceCandidate): boolean => matches(c) && plausibleYear(c, local);
  const bestOf = (candidates: readonly SourceCandidate[]): SourceCandidate | null => {
    let best: { candidate: SourceCandidate; titleJW: number } | null = null;
    for (const c of candidates) {
      if (!confident(c)) continue;
      const { titleJW } = matchScores(c, local);
      if (best === null || titleJW > best.titleJW) best = { candidate: c, titleJW };
    }
    return best?.candidate ?? null;
  };
  const search = await deps.searchTitle(local.title, confident);
  failures.push(...search.failures);
  const found = bestOf(search.candidates);
  if (found !== null) {
    return { kind: 'identified', candidate: found, via: 'title-search', query: local.title, local };
  }
  // Only a later re-post matched — or OpenAlex could not answer (keyless
  // OpenAlex is often exhausted) — so the PDF may be the arXiv preprint.
  const reposts = search.candidates.filter((c) => matches(c) && !plausibleYear(c, local));
  const openAlexFailed = search.failures.some((f) => f.startsWith('openalex'));
  if ((reposts.length > 0 || openAlexFailed) && deps.searchArxivTitle !== undefined) {
    const arxiv = await deps.searchArxivTitle(local.title);
    failures.push(...arxiv.failures);
    const hit = bestOf(arxiv.candidates);
    if (hit !== null) return { kind: 'identified', candidate: hit, via: 'title-search', query: local.title, local };
  }
  if (reposts.length > 0 && search.failures.length === 0) {
    const r = reposts[0]!;
    return {
      kind: 'unidentified',
      reason:
        `the only record matching the title "${local.title}" and its first author is dated ${r.year}` +
        `${r.doi ? ` (DOI ${r.doi})` : ''}, after the year the PDF shows (${local.year}) — a later re-post, not this PDF; ` +
        `pass the DOI or arXiv id${cited}`,
      local,
      failures,
    };
  }
  // A failed search is never "no match" (SRC-05): name every search that
  // could not be answered next to the ones that answered without a match.
  let reason: string;
  if (search.failures.length === 0) {
    reason = `no Crossref or OpenAlex record matches the title "${local.title}" and its first author closely enough`;
  } else if (search.candidates.length === 0) {
    reason = `the title search failed (${search.failures.join('; ')}) — retry later or pass the DOI`;
  } else {
    const failedNames = new Set(search.failures.map((f) => f.split(' ')[0]));
    const answered = ['crossref', 'openalex'].filter((n) => !failedNames.has(n)).map((n) => (n === 'crossref' ? 'Crossref' : 'OpenAlex'));
    reason =
      `no ${answered.join(' or ') || 'answered'} record matches the title "${local.title}" and its first author closely enough, ` +
      `and ${search.failures.join('; ')} — retry later or pass the DOI`;
  }
  return { kind: 'unidentified', reason: reason + cited, local, failures };
}
