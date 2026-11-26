// bin/lib/library-item.ts — library items (CSL-JSON) from research candidates
// and from bibliography entries, and the identifiers a work is known by.
//
// A work is identified by its DOI, arXiv ID, PubMed ID, PMC ID or ISBN, each
// in one normalized spelling ("doi:10.1038/x", "arxiv:1706.03762",
// "pmid:9500320", "pmcid:PMC123", "isbn:9780262033848"). arXiv's own DOI
// (10.48550/arXiv.<id>) also names the arXiv ID, and an ISBN-10 is written as
// its ISBN-13, so two records of one work share a key however each registry
// spells it.

import { parseDisplayName, parsePubmedName, presentNames } from './author-normalize.js';
import {
  arxivFromDoi,
  arxivFromLink,
  bareArxivId,
  doiFromLink,
  isbn13,
  isbnsIn,
  normalizeDoi,
  normalizeIsbn,
  normalizePmcid,
  normalizePmid,
} from './doi.js';
import { firstString } from './sources/work-record.js';
import type { CslName, SourceCandidate } from './schemas/source-candidate.js';
import type { LibraryItem, Provenance } from './schemas/library.js';

interface IdFields {
  doi?: string | null | undefined;
  arxiv?: string | null | undefined;
  pmid?: string | null | undefined;
  pmcid?: string | null | undefined;
  isbn?: string | null | undefined;
}

/** The identity keys of a work with these identifiers, most reliable first. */
export function identityKeys(ids: IdFields): string[] {
  const out: string[] = [];
  const add = (k: string | null): void => {
    if (k && !out.includes(k)) out.push(k);
  };
  const doi = ids.doi ? normalizeDoi(ids.doi) : null;
  add(doi && `doi:${doi}`);
  const arxiv = (ids.arxiv ? bareArxivId(ids.arxiv) : null) ?? (doi ? arxivFromDoi(doi) : null);
  add(arxiv && `arxiv:${arxiv}`);
  const pmid = ids.pmid ? normalizePmid(ids.pmid) : null;
  add(pmid && `pmid:${pmid}`);
  const pmcid = ids.pmcid ? normalizePmcid(ids.pmcid) : null;
  add(pmcid && `pmcid:${pmcid}`);
  for (const raw of isbnsIn(ids.isbn ?? '')) {
    const isbn = normalizeIsbn(raw);
    add(isbn && `isbn:${isbn13(isbn)}`);
  }
  return out;
}

/** The identity keys of a research candidate: its own, then those of records merged into it. */
export function candidateIdentities(c: SourceCandidate): string[] {
  const own = identityKeys({ doi: c.doi, arxiv: c.arxiv, pmid: c.pmid, pmcid: c.pmcid, isbn: c.isbn });
  return [...new Set([...own, ...(c.also_known_as ?? [])])];
}

/** The identity keys of a library item: its own identifiers and those recorded for it. */
export function itemIdentities(item: LibraryItem): string[] {
  const own = identityKeys({ doi: item.DOI, arxiv: item.custom.arxiv, pmid: item.PMID, pmcid: item.PMCID, isbn: item.ISBN });
  return [...new Set([...own, ...item.custom.identities])];
}

/** A candidate's authors as CSL names: the adapter's structured names, or its display strings read back. */
function candidateNames(c: SourceCandidate): CslName[] {
  if (c.names && c.names.length > 0) return c.names;
  const parse = c.source === 'pubmed' ? parsePubmedName : parseDisplayName;
  return presentNames(c.authors.map(parse));
}

/** The CSL type of a candidate whose adapter did not give one. */
function defaultType(c: SourceCandidate): string {
  if (c.source === 'arxiv') return 'article';
  return c.isbn && !c.doi ? 'book' : 'article-journal';
}

/**
 * The library item for a research candidate, under `citekey`. Only the
 * candidate's own identifiers are printed; those of other records of the same
 * work (`also_known_as`) are kept only to find it again.
 */
export function itemFromCandidate(
  c: SourceCandidate,
  citekey: string,
  at: string,
  opts: { provenance?: readonly Provenance[] } = {},
): LibraryItem {
  const item: LibraryItem = {
    id: citekey,
    type: c.csl_type ?? defaultType(c),
    title: c.title,
    custom: {
      identities: candidateIdentities(c),
      retracted: c.retracted === true,
      provenance: [...(opts.provenance ?? [{ source: c.source, id: c.id, at }, ...(c.merged_from ?? []).map((m) => ({ ...m, at }))])],
      added_at: at,
    },
  };
  const names = candidateNames(c);
  if (names.length > 0) item.author = names;
  if (typeof c.year === 'number') item.issued = { 'date-parts': [[c.year]] };
  const set = (k: 'container-title' | 'volume' | 'issue' | 'page' | 'publisher' | 'URL' | 'abstract', v: string | undefined): void => {
    if (v) item[k] = v;
  };
  set('container-title', c.container_title);
  set('volume', c.volume);
  set('issue', c.issue);
  set('page', c.page);
  set('publisher', c.publisher);
  set('URL', c.url);
  set('abstract', c.abstract);
  // The bibliography holds one spelling of each identifier.
  const doi = c.doi ? normalizeDoi(c.doi) : null;
  if (doi) item.DOI = doi;
  const isbn = c.isbn ? normalizeIsbn(c.isbn) : null;
  if (isbn) item.ISBN = isbn;
  const pmid = c.pmid ? normalizePmid(c.pmid) : null;
  if (pmid) item.PMID = pmid;
  const pmcid = c.pmcid ? normalizePmcid(c.pmcid) : null;
  if (pmcid) item.PMCID = pmcid;
  const arxiv = c.arxiv ? bareArxivId(c.arxiv) : null;
  if (arxiv) item.custom.arxiv = arxiv;
  if (c.retraction_details) item.custom.retraction_details = c.retraction_details;
  if (c.oa_pdf_url) item.custom.oa_pdf_url = c.oa_pdf_url;
  return item;
}

// CSL keys citation-js adds to a parsed entry that are not bibliographic.
const PARSE_ONLY_KEYS: ReadonlySet<string> = new Set(['_graph', 'id', 'citation-key', 'custom']);

/**
 * The library item for a bibliography entry, under its own key: the CSL
 * variables citation-js read, the identifiers it drops (eprint, PMID) from the
 * raw fields, and the entry's text, which is written back exactly as it was.
 * A `note = {RETRACTED}` is the retraction flag, not a note.
 */
export function itemFromBibEntry(
  key: string,
  text: string,
  csl: Record<string, unknown> | undefined,
  fields: Record<string, string> | undefined,
  at: string,
  provenance: Provenance,
): LibraryItem {
  const item: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(csl ?? {})) {
    if (!PARSE_ONLY_KEYS.has(k) && v !== undefined && v !== null && v !== '') item[k] = v;
  }
  const f = fields ?? {};
  const retracted = item['note'] === 'RETRACTED';
  if (retracted) delete item['note'];
  const eprintType = (f['archiveprefix'] ?? f['eprinttype'] ?? '').trim().toLowerCase();
  const eprint = (f['eprint'] ?? '').trim();
  const url = typeof item['URL'] === 'string' ? (item['URL'] as string) : (f['url'] ?? '');
  const arxiv = bareArxivId(eprintType === 'arxiv' || eprintType === '' ? eprint : '')
    ?? bareArxivId(f['arxiv'] ?? f['arxivid'] ?? '')
    ?? bareArxivId(arxivFromLink(url));
  const pmid = normalizePmid(f['pmid'] ?? (eprintType === 'pubmed' ? eprint : ''));
  if (pmid && !item['PMID']) item['PMID'] = pmid;
  const doi = typeof item['DOI'] === 'string' ? (item['DOI'] as string) : (f['doi'] || doiFromLink(url));
  return {
    ...item,
    id: key,
    type: typeof item['type'] === 'string' && item['type'] ? (item['type'] as string) : 'document',
    title: firstString(item['title']) ?? '',
    custom: {
      ...(arxiv ? { arxiv } : {}),
      identities: identityKeys({
        doi,
        arxiv,
        pmid,
        pmcid: typeof item['PMCID'] === 'string' ? (item['PMCID'] as string) : undefined,
        isbn: typeof item['ISBN'] === 'string' ? (item['ISBN'] as string) : f['isbn'],
      }),
      retracted,
      bibtex: text,
      provenance: [provenance],
      added_at: at,
    },
  } as LibraryItem;
}
