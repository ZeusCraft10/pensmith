// bin/lib/verify/resolve.ts — find the work a bibliography entry names, by its identifiers.
//
// Pass 1 used to ask Crossref alone and read every non-200 as "fabricated",
// so arXiv and Zenodo DOIs, books, PubMed-only articles and every citation
// checked during a Crossref rate limit were accused of being invented. Now each
// identifier goes to the registries that can answer for it:
//
//   DOI    Crossref, then DataCite, then doi.org content negotiation (which
//          covers mEDRA, JaLC and the other agencies);
//   arXiv  the arXiv API;
//   PMID   PubMed E-utilities (esummary);
//   ISBN   Open Library.
//
// and the answers combine as:
//   - any registry returns the work      → found (the metadata is then compared);
//   - every registry says "no such work" → not_found (FABRICATED);
//   - otherwise, some registry gave no answer (timeout, 429, 5xx) → unavailable
//     (UNRESOLVED: blocking, and worth retrying).

import { looksLikeIsbn, normalizeArxiv, normalizeDoi, normalizeIsbn, normalizePmid } from '../doi.js';
import { lookupDoi as crossrefLookup } from '../sources/crossref.js';
import { lookupDoi as dataciteLookup } from '../sources/datacite.js';
import { lookupDoi as doiOrgLookup } from '../sources/doi-content.js';
import { lookupArxiv } from '../sources/arxiv.js';
import { lookupPmid } from '../sources/pubmed.js';
import { lookupIsbn } from '../sources/openlibrary.js';
import type { Lookup, RegistryName, WorkRecord } from '../sources/work-record.js';

export type WorkIdKind = 'doi' | 'arxiv' | 'pmid' | 'isbn';

export interface WorkId {
  kind: WorkIdKind;
  /** As the bibliography wrote it. */
  raw: string;
  /** The form registries are asked for; null when `raw` is not a valid identifier of its kind. */
  value: string | null;
  /** How a verdict names it: "DOI 10.1038/x", "arXiv:1706.03762". */
  shown: string;
}

export type IdResolution =
  | { kind: 'found'; record: WorkRecord }
  | {
      kind: 'not_found';
      /** The registries that answered "no such work". */
      registries: RegistryName[];
      /** False when a registry's silence does not show the work is not real (Open Library). */
      authoritative: boolean;
      /** Set when the identifier itself is malformed, so no registry was asked. */
      invalid?: string;
    }
  | {
      kind: 'unavailable';
      failures: Array<{ registry: RegistryName; detail: string }>;
      /** Registries that did answer, with "no such work". */
      registries: RegistryName[];
    };

const ARXIV_URL = /arxiv\.org\/(?:abs|pdf)\/([^\s?#]+?)(?:\.pdf)?(?:[?#]|$)/i;
const DOI_URL = /^https?:\/\/(?:dx\.)?doi\.org\/(10\.[^\s?#]+)/i;
// A 13- or 10-digit ISBN with its separators, inside text such as
// "0-262-03384-4 (hbk)" or "ISBN 978-0-262-03384-8".
const ISBN_SHAPE = /(?<![\dX])(?:(?:\d[\s-]?){12}\d|(?:\d[\s-]?){9}[\dX])(?![\dX])/i;

/** The DOI a doi.org or dx.doi.org link names, or ''. */
function doiFromUrl(url: string): string {
  const m = DOI_URL.exec(url);
  if (!m) return '';
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return m[1]!;
  }
}

/** The arXiv ID registries are asked for: normalizeArxiv's form without its `arxiv:` prefix. */
function arxivQueryId(raw: string): string | null {
  const n = normalizeArxiv(raw.replace(/^arxiv:\s*/i, 'arXiv:'));
  return n === null ? null : n.replace(/^arxiv:/, '');
}

/**
 * The identifiers of a bibliography entry, most reliable first: DOI, arXiv ID,
 * PMID, ISBN. `csl` is the entry as citation-js reads it; `fields` holds its
 * raw BibTeX fields, because citation-js drops `eprint` and `pmid`.
 */
export function workIdentifiers(csl: Record<string, unknown>, fields: Record<string, string> = {}): WorkId[] {
  const ids: WorkId[] = [];
  const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

  const url = text(csl['URL']) || text(fields['url']);
  // An entry may give its DOI only as a doi.org link, which the reference list prints.
  const doi = text(csl['DOI']) || text(fields['doi']) || doiFromUrl(url);
  if (doi) ids.push({ kind: 'doi', raw: doi, value: normalizeDoi(doi), shown: `DOI ${doi}` });

  const eprintType = (fields['archiveprefix'] ?? fields['eprinttype'] ?? '').trim().toLowerCase();
  const eprint = text(fields['eprint']);
  const arxivRaw = [
    eprintType === 'arxiv' ? eprint : '',
    text(fields['arxiv']),
    text(fields['arxivid']),
    eprintType === '' && arxivQueryId(eprint) !== null ? eprint : '',
    ARXIV_URL.exec(url)?.[1] ?? '',
  ].find((s) => s !== '');
  if (arxivRaw) {
    const value = arxivQueryId(arxivRaw);
    ids.push({ kind: 'arxiv', raw: arxivRaw, value, shown: `arXiv:${value ?? arxivRaw}` });
  }

  const pmidRaw = text(fields['pmid']) || (eprintType === 'pubmed' ? eprint : '');
  if (pmidRaw) {
    const value = normalizePmid(pmidRaw);
    ids.push({ kind: 'pmid', raw: pmidRaw, value, shown: `PMID ${value ?? pmidRaw}` });
  }

  // An ISBN field may list several (hardback, paperback, ISBN-10 and -13),
  // each perhaps with a label or a qualifier such as "(pbk)".
  const isbnRaw = (text(csl['ISBN']) || text(fields['isbn'])).split(/[,;]|\s(?=[\dXx-]{10,}\b)/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ISBN_SHAPE.exec(s)?.[0] ?? s);
  const isbn = isbnRaw.find((s) => normalizeIsbn(s) !== null) ?? isbnRaw.find(looksLikeIsbn) ?? isbnRaw[0];
  if (isbn) ids.push({ kind: 'isbn', raw: isbn, value: normalizeIsbn(isbn), shown: `ISBN ${isbn}` });

  return ids;
}

const LOOKUPS: Readonly<Record<WorkIdKind, ReadonlyArray<(v: string) => Promise<Lookup>>>> = {
  doi: [crossrefLookup, dataciteLookup, doiOrgLookup],
  arxiv: [lookupArxiv],
  pmid: [lookupPmid],
  isbn: [lookupIsbn],
};

const INVALID: Readonly<Record<WorkIdKind, string>> = {
  doi: 'is not a valid DOI',
  arxiv: 'is not a valid arXiv ID',
  pmid: 'is not a valid PubMed ID',
  isbn: 'is not a valid ISBN',
};

/** Ask each registry that can answer for `id`, in turn, until one finds the work. */
export async function resolveId(id: WorkId): Promise<IdResolution> {
  if (id.value === null) {
    // An ISBN of the right length whose check digit fails is a typo; say so.
    const why = id.kind === 'isbn' && looksLikeIsbn(id.raw) ? `${INVALID.isbn} (its check digit is wrong)` : INVALID[id.kind];
    return { kind: 'not_found', registries: [], authoritative: true, invalid: `${id.raw} ${why}` };
  }
  const failures: Array<{ registry: RegistryName; detail: string }> = [];
  const said: RegistryName[] = [];
  let authoritative = true;
  for (const lookup of LOOKUPS[id.kind]) {
    const r = await lookup(id.value);
    if (r.kind === 'found') return { kind: 'found', record: r.record };
    if (r.kind === 'unavailable') failures.push({ registry: r.registry, detail: r.detail });
    else {
      said.push(r.registry);
      authoritative &&= r.authoritative;
    }
  }
  return failures.length > 0
    ? { kind: 'unavailable', failures, registries: said }
    : { kind: 'not_found', registries: said, authoritative };
}

/** "Crossref, DataCite and doi.org". */
export function registryList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
