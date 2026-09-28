// bin/lib/source-input.ts — what did the user hand `pensmith add`?
// (SRC-13, D-19-20).
//
// `add` accepts an identifier, a URL, a local PDF or a folder of PDFs. This
// module classifies the argument once, before any lookup, so every later step
// works on a normalized value:
//
//   DOI      10.1038/nature14539, `doi:` / `DOI: 10.…` / `DOI 10.…`, and doi.org
//            URLs, percent-encoded or not (normalized by doi.ts)
//   arXiv    arXiv:1706.03762, 1706.03762, 1706.03762v7, old-style
//            hep-th/9901001v2, math.GT/0309136, HEP-TH/9901001, a trailing
//            period, and arxiv.org/abs|pdf URLs — an arXiv URL is an
//            identifier, its PDF is never downloaded (the version is dropped:
//            the library keeps one entry per work)
//   PMID     PMID:31978945 / pmid: 31978945 / PMID 31978945, and PubMed URLs
//            (bare digits are ambiguous and are not a PMID)
//   ISBN     isbn:<ISBN> (ISBN-10 or -13, hyphens allowed), or a bare 10/13-digit
//            string whose check digit is valid → ISBN-13
//   URL      any other http(s) URL
//   PDF      an existing local file ending in .pdf or starting with %PDF-
//   folder   an existing local directory (bring-your-own ingest)
//
// An existing local path wins over an identifier reading of the same text.
// Anything else is `unknown` with a one-line reason: `add` turns it into a
// usage error (exit 2, D-19-27) before any request.
//
// Pure except for the local-path checks (fs.statSync / a 5-byte read). DOI,
// arXiv and PMID parsing is delegated to doi.ts (the identifier chokepoint).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { normalizeDoi, normalizeArxiv, normalizePmid } from './doi.js';
import { normArxiv, normIsbn } from './migrations/library/shape.js';
import { sources } from './sources/index.js';
import { lookupFailed, lookupFound, lookupNotFound, isSourceLookupError, type LookupResult } from './sources/lookup.js';
import type { SourceCandidate } from './schemas/source-candidate.js';

export type SourceInput =
  | { readonly kind: 'doi'; readonly raw: string; readonly doi: string }
  | { readonly kind: 'arxiv'; readonly raw: string; readonly arxiv: string }
  | { readonly kind: 'pmid'; readonly raw: string; readonly pmid: string }
  | { readonly kind: 'isbn'; readonly raw: string; readonly isbn: string }
  | { readonly kind: 'url'; readonly raw: string; readonly url: string }
  | { readonly kind: 'pdf'; readonly raw: string; readonly path: string }
  | { readonly kind: 'dir'; readonly raw: string; readonly path: string }
  | { readonly kind: 'unknown'; readonly raw: string; readonly reason: string };

/** The identifier kinds (the inputs a registrar lookup resolves). */
export type IdentifierInput = Extract<SourceInput, { kind: 'doi' | 'arxiv' | 'pmid' | 'isbn' }>;

export function isIdentifierInput(s: SourceInput): s is IdentifierInput {
  return s.kind === 'doi' || s.kind === 'arxiv' || s.kind === 'pmid' || s.kind === 'isbn';
}

/** A short label for messages: `DOI 10.…`, `arXiv:…`, `PMID …`, `ISBN …`. */
export function identifierLabel(s: IdentifierInput): string {
  switch (s.kind) {
    case 'doi':
      return `DOI ${s.doi}`;
    case 'arxiv':
      return `arXiv:${s.arxiv}`;
    case 'pmid':
      return `PMID ${s.pmid}`;
    case 'isbn':
      return `ISBN ${s.isbn}`;
  }
}

const ARXIV_HOSTS = new Set(['arxiv.org', 'www.arxiv.org', 'export.arxiv.org']);
const PUBMED_HOSTS = new Set(['pubmed.ncbi.nlm.nih.gov', 'www.ncbi.nlm.nih.gov']);
const DOI_HOSTS = new Set(['doi.org', 'dx.doi.org', 'www.doi.org', 'www.dx.doi.org']);

/** Bare arXiv id (no version) from an arXiv URL path (`/abs/<id>`, `/pdf/<id>[.pdf]`), else null. */
function arxivFromUrl(u: URL): string | null {
  const m = /^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?\/?$/i.exec(decodeURIComponentSafe(u.pathname));
  return m?.[1] ? normArxiv(m[1]) : null;
}

function pmidFromUrl(u: URL): string | null {
  const m = /^\/(?:pubmed\/)?(\d{1,9})\/?$/.exec(u.pathname);
  return m?.[1] ?? null;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function classifyUrl(raw: string): SourceInput {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { kind: 'unknown', raw, reason: 'not a valid URL' };
  }
  const host = u.hostname.toLowerCase();
  if (DOI_HOSTS.has(host)) {
    const doi = normalizeDoi(raw);
    if (!doi) return { kind: 'unknown', raw, reason: 'the doi.org link does not contain a DOI' };
    const arxiv = normArxiv(doi);
    return arxiv ? { kind: 'arxiv', raw, arxiv } : { kind: 'doi', raw, doi };
  }
  if (ARXIV_HOSTS.has(host)) {
    const arxiv = arxivFromUrl(u);
    if (arxiv) return { kind: 'arxiv', raw, arxiv };
  }
  if (PUBMED_HOSTS.has(host)) {
    const pmid = pmidFromUrl(u);
    if (pmid) return { kind: 'pmid', raw, pmid };
  }
  return { kind: 'url', raw, url: u.toString() };
}

/** True when the file starts with the PDF header. */
function startsWithPdfMagic(file: string): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(5);
    const n = fs.readSync(fd, head, 0, 5, 0);
    return n === 5 && head.toString('latin1') === '%PDF-';
  } catch {
    return false;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function classifyLocal(raw: string, cwd: string | undefined): SourceInput | null {
  // A relative path is relative to the directory the user typed in (the
  // process working directory, via path.resolve) — never to the paper root.
  const abs = cwd !== undefined ? path.resolve(cwd, raw) : path.resolve(raw);
  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
  } catch {
    return null;
  }
  if (st.isDirectory()) return { kind: 'dir', raw, path: abs };
  if (st.isFile()) {
    if (/\.pdf$/i.test(abs) || startsWithPdfMagic(abs)) return { kind: 'pdf', raw, path: abs };
    return { kind: 'unknown', raw, reason: `${raw} is not a PDF` };
  }
  return { kind: 'unknown', raw, reason: `${raw} is not a file or folder` };
}

/**
 * Classify one `add` argument (see the header). `cwd` resolves a relative
 * local path (default: the directory the user typed in).
 */
export function classifySourceInput(input: string, cwd?: string): SourceInput {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return { kind: 'unknown', raw, reason: 'no source given' };

  if (/^https?:\/\//i.test(raw)) return classifyUrl(raw);

  const local = classifyLocal(raw, cwd);
  if (local !== null) return local;

  const doi = normalizeDoi(raw);
  if (doi) {
    // A DataCite arXiv DOI (10.48550/arXiv.<id>) names the arXiv record: look
    // it up at arXiv (Crossref has no record for it).
    const arxiv = normArxiv(doi);
    return arxiv ? { kind: 'arxiv', raw, arxiv } : { kind: 'doi', raw, doi };
  }

  if (/^arxiv:/i.test(raw) || normalizeArxiv(raw) !== null) {
    const arxiv = normArxiv(raw.replace(/^arxiv:\s*/i, 'arXiv:').replace(/[.,;:)\]}>"']+$/, ''));
    if (arxiv) return { kind: 'arxiv', raw, arxiv };
    return { kind: 'unknown', raw, reason: 'not an arXiv identifier (expected e.g. arXiv:1706.03762 or hep-th/9901001)' };
  }

  if (/^pmid\b/i.test(raw)) {
    const pmid = normalizePmid(raw);
    return pmid ? { kind: 'pmid', raw, pmid } : { kind: 'unknown', raw, reason: 'not a PubMed id (expected PMID:<digits>)' };
  }

  if (/^isbn(?:-1[03])?\s*:?/i.test(raw)) {
    const isbn = normIsbn(raw.replace(/^isbn(?:-1[03])?\s*:?\s*/i, ''));
    return isbn ? { kind: 'isbn', raw, isbn } : { kind: 'unknown', raw, reason: 'not a valid ISBN (the check digit does not match)' };
  }
  const digits = raw.replace(/[\s-]/g, '');
  if (/^(?:\d{9}[\dXx]|\d{13})$/.test(digits)) {
    const isbn = normIsbn(digits);
    if (isbn) return { kind: 'isbn', raw, isbn };
  }

  if (/\.pdf$/i.test(raw)) return { kind: 'unknown', raw, reason: `${raw}: no such file` };
  if (/^\d{1,9}$/.test(raw)) {
    return { kind: 'unknown', raw, reason: `"${raw}" is ambiguous — for a PubMed id pass PMID:${raw}` };
  }
  return {
    kind: 'unknown',
    raw,
    reason:
      `"${raw}" is not a DOI, arXiv id, PMID:<id>, isbn:<ISBN>, http(s) URL, local PDF or folder`,
  };
}

/**
 * The identifier an HTML landing page declares for itself — its Highwire /
 * Dublin Core `<meta>` tags (`citation_doi`, `dc.identifier`, `prism.doi`,
 * `citation_arxiv_id`, `citation_pmid`) — or null. Only the page's own
 * metadata is read: a DOI merely mentioned in the page body (a reference
 * list, a "cited by" box) is never taken as the page's work.
 */
export function identifierFromHtml(html: string): IdentifierInput | null {
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const attr = (tag: string, name: string): string | null => {
    const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
    return m ? (m[1] ?? m[2] ?? null) : null;
  };
  const byName = (names: readonly string[]): string | null => {
    for (const tag of metas) {
      const key = (attr(tag, 'name') ?? attr(tag, 'property') ?? '').toLowerCase();
      if (names.includes(key)) {
        const content = attr(tag, 'content');
        if (content && content.trim()) return content.trim();
      }
    }
    return null;
  };
  const doiRaw = byName(['citation_doi', 'dc.identifier', 'prism.doi', 'bepress_citation_doi', 'doi']);
  const doi = doiRaw ? normalizeDoi(doiRaw) : null;
  if (doi) {
    const arxiv = normArxiv(doi);
    return arxiv ? { kind: 'arxiv', raw: doiRaw!, arxiv } : { kind: 'doi', raw: doiRaw!, doi };
  }
  const arxivRaw = byName(['citation_arxiv_id']);
  const arxiv = arxivRaw ? normArxiv(arxivRaw) : null;
  if (arxiv) return { kind: 'arxiv', raw: arxivRaw!, arxiv };
  const pmidRaw = byName(['citation_pmid']);
  const pmid = pmidRaw ? normalizePmid(pmidRaw) : null;
  if (pmid) return { kind: 'pmid', raw: pmidRaw!, pmid };
  return null;
}

// ---------------------------------------------------------------------------
// Resolving an identifier (the three-way lookup, D-19-05).
// ---------------------------------------------------------------------------

/** The part of an adapter module an identifier lookup uses. */
interface IdentifierAdapter {
  lookupById?: (id: string) => Promise<LookupResult>;
  fetchById?: (id: string) => Promise<SourceCandidate | null>;
}

/**
 * The registry adapter named `name`, when this build has it. Looked up by name
 * (not imported by module) so the ISBN path reaches the books adapter
 * (`books`, SRC-11) through the one registry.
 */
function registryAdapter(name: string): IdentifierAdapter | undefined {
  return (sources as unknown as Record<string, IdentifierAdapter | undefined>)[name];
}

const ADAPTER_FOR: Readonly<Record<IdentifierInput['kind'], string>> = {
  doi: 'crossref',
  arxiv: 'arxiv',
  pmid: 'pubmed',
  isbn: 'books',
};

/** The id string the adapter's lookup takes. */
function adapterId(input: IdentifierInput): string {
  switch (input.kind) {
    case 'doi':
      return input.doi;
    case 'arxiv':
      return input.arxiv;
    case 'pmid':
      return input.pmid;
    case 'isbn':
      return `isbn:${input.isbn}`;
  }
}

/**
 * Look an identifier up at its registrar: Crossref (DOI), arXiv, PubMed
 * (PMID) or the books adapter (ISBN). Three outcomes — found, not-found (the
 * registrar has no such record), failed (the lookup could not be answered;
 * the reason says why) — never two (D-19-05). An adapter's `lookupById` is
 * used when it has one; otherwise `fetchById` (null = not-found, a thrown
 * SourceLookupError = failed). The typed OfflineEgressError (sources offline
 * with no recorded answer, or --dry-run) propagates: it is a mode, not an
 * outcome.
 */
export async function lookupIdentifier(input: IdentifierInput): Promise<LookupResult> {
  const name = ADAPTER_FOR[input.kind];
  const adapter = registryAdapter(name);
  const id = adapterId(input);
  if (typeof adapter?.lookupById === 'function') return adapter.lookupById(id);
  if (typeof adapter?.fetchById === 'function') {
    try {
      const c = await adapter.fetchById(id);
      return c !== null ? lookupFound(c) : lookupNotFound(`${name} has no record of ${identifierLabel(input)}`);
    } catch (e) {
      if (isSourceLookupError(e)) {
        return lookupFailed(e.reason, {
          ...(e.status !== undefined ? { status: e.status } : {}),
          ...(e.retryAfterMs !== undefined ? { retryAfterMs: e.retryAfterMs } : {}),
        });
      }
      throw e;
    }
  }
  return lookupFailed(`no ${input.kind === 'isbn' ? 'book (ISBN)' : name} lookup is available in this build`);
}

/** The records a title search returned, and the searches that failed. */
export interface TitleSearchOutcome {
  readonly candidates: readonly SourceCandidate[];
  readonly failures: readonly string[];
}

/** How many hits of each title search are compared. */
export const TITLE_SEARCH_LIMIT = 5;

/**
 * Search a title at Crossref, then — only when Crossref returns nothing that
 * `accept` takes — at OpenAlex (D-19-20). Only the title is sent. Returns
 * every hit in order (Crossref first) plus the failure reasons of searches
 * that could not be answered. OfflineEgressError propagates.
 */
export async function searchByTitle(
  title: string,
  accept: (c: SourceCandidate) => boolean = () => true,
): Promise<TitleSearchOutcome> {
  const candidates: SourceCandidate[] = [];
  const failures: string[] = [];
  for (const name of ['crossref', 'openalex'] as const) {
    let failed: string | null = null;
    const hits = await sources[name].search(title, {
      limit: TITLE_SEARCH_LIMIT,
      onFailure: (reason: string) => {
        failed = reason;
      },
    });
    if (failed !== null) failures.push(`${name} title search: ${String(failed)}`);
    candidates.push(...hits);
    if (hits.some(accept)) break;
  }
  return { candidates, failures };
}
