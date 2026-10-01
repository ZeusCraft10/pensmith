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
import * as zlib from 'node:zlib';
import { normalizeDoi, normalizeArxiv, normalizePmid } from './doi.js';
import { normArxiv, normIsbn } from './migrations/library/shape.js';
import { sources } from './sources/index.js';
import { lookupFailed, lookupFound, lookupNotFound, isSourceLookupError, type LookupResult } from './sources/lookup.js';
import { registrationAgency, doiPrefix } from './sources/doi-ra.js';
import * as doiContent from './sources/doi-cn.js';
import { confirmRegistrarRecords } from './sources/registrar-confirm.js';
import type { SourceCandidate } from './schemas/source-candidate.js';
import { isOfflineEgressError, offlineLabel } from './http.js';

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

/** The most text an HTML page's gzip body may inflate to (a decompression bomb is refused, not read). */
const MAX_INFLATED_HTML_BYTES = 8 * 1024 * 1024;

/**
 * The text of an HTML answer. Some servers — Open Journal Systems sites among
 * them — gzip the page even for a client that asked for no encoding, and send
 * it WITHOUT a Content-Encoding header (review round 3: First Monday, AAAI's
 * OJS). Such a body starts with the gzip magic (1f 8b 08) and is inflated here
 * (at most MAX_INFLATED_HTML_BYTES); any other body is its UTF-8 text.
 */
export function htmlBodyText(res: { readonly body: string; readonly bodyBytes?: Buffer | undefined }): string {
  const bytes = res.bodyBytes;
  if (bytes !== undefined && bytes.length >= 3 && bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 0x08) {
    try {
      return zlib.gunzipSync(bytes, { maxOutputLength: MAX_INFLATED_HTML_BYTES }).toString('utf8');
    } catch {
      return res.body;
    }
  }
  return res.body;
}

/**
 * The identifier an HTML landing page declares for itself — its Highwire /
 * Dublin Core `<meta>` tags (`citation_doi`, `dc.identifier.doi`, `prism.doi`,
 * `dc.identifier` when its value is a DOI, `citation_arxiv_id`,
 * `citation_pmid`) — or null. Only the page's own
 * metadata is read: a DOI merely mentioned in the page body (a reference
 * list, a "cited by" box) is never taken as the page's work.
 */
export function identifierFromHtml(html: string): IdentifierInput | null {
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const attr = (tag: string, name: string): string | null => {
    const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
    return m ? (m[1] ?? m[2] ?? null) : null;
  };
  // Every value the page declares under `names`, in the NAMES' priority order
  // (then document order): a generic tag earlier in the page (Open Journal
  // Systems puts `DC.Identifier` = its internal article id before
  // `citation_doi`) never hides a specific one (review round 3).
  const valuesOf = (names: readonly string[]): string[] => {
    const out: string[] = [];
    for (const want of names) {
      for (const tag of metas) {
        const key = (attr(tag, 'name') ?? attr(tag, 'property') ?? '').toLowerCase();
        if (key !== want) continue;
        const content = attr(tag, 'content');
        if (content && content.trim()) out.push(content.trim());
      }
    }
    return out;
  };
  // The first value that IS an identifier of that kind: `dc.identifier` may
  // hold a URI, a handle or an internal id — such a value is skipped, never
  // taken as "the page declares no DOI".
  const first = <T>(names: readonly string[], parse: (raw: string) => T | null): { raw: string; value: T } | null => {
    for (const raw of valuesOf(names)) {
      const value = parse(raw);
      if (value !== null) return { raw, value };
    }
    return null;
  };
  const doi = first(['citation_doi', 'dc.identifier.doi', 'prism.doi', 'bepress_citation_doi', 'doi', 'dc.identifier'], normalizeDoi);
  if (doi) {
    const arxiv = normArxiv(doi.value);
    return arxiv ? { kind: 'arxiv', raw: doi.raw, arxiv } : { kind: 'doi', raw: doi.raw, doi: doi.value };
  }
  const arxiv = first(['citation_arxiv_id'], normArxiv);
  if (arxiv) return { kind: 'arxiv', raw: arxiv.raw, arxiv: arxiv.value };
  const pmid = first(['citation_pmid'], normalizePmid);
  if (pmid) return { kind: 'pmid', raw: pmid.raw, pmid: pmid.value };
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
 * SourceLookupError = failed). A DOI Crossref answers 404 for is not-found
 * only when doi.org says Crossref registers its prefix (crossrefNotFound). A
 * PubMed record with a DOI is confirmed at Crossref (pubmedConfirmed). The
 * typed OfflineEgressError (sources offline with no recorded answer, or
 * --dry-run) propagates: it is a mode, not an outcome.
 */
export async function lookupIdentifier(input: IdentifierInput): Promise<LookupResult> {
  const name = ADAPTER_FOR[input.kind];
  const adapter = registryAdapter(name);
  const id = adapterId(input);
  if (typeof adapter?.lookupById === 'function') {
    const r = await adapter.lookupById(id);
    if (input.kind === 'doi' && r.kind === 'not-found') return crossrefNotFound(input.doi, r);
    if (input.kind === 'pmid' && r.kind === 'found') return pubmedConfirmed(r.candidate);
    return r;
  }
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

/**
 * PubMed's record of a PMID, as Pass 1 will read it (review round 2 of the
 * Phase 20 + 23a merge): PubMed is not a DOI's registrar, and Pass 1 checks a
 * cited DOI at Crossref. For a non-English article PubMed's title is the
 * English translation in brackets while Crossref holds the printed title, so
 * the record as PubMed gave it would be blocked as MIS-CITED on its own title.
 * The one confirmation research applies to its kept hits
 * (sources/registrar-confirm.ts: the same work — PubMed's original-language
 * title counts — takes Crossref's bibliographic fields; identifiers, abstract
 * and provenance stay) runs here too, so every path that identifies a PMID
 * like `add` — `add`, a URL that declares a PMID, research's prune question —
 * stores what verify finds — the DOI asked at its own registrar
 * (registrarLookup). Best-effort: a DOI no registrar answers for, a failed or
 * offline lookup, or another work under the DOI leaves the record as PubMed
 * gave it.
 */
async function pubmedConfirmed(candidate: SourceCandidate): Promise<LookupResult> {
  const { candidates } = await confirmRegistrarRecords([candidate], (doi) => registrarLookup(doi));
  return lookupFound(candidates[0] ?? candidate);
}

/**
 * A DOI's record where Pass 1 reads it (VRFY-11): Crossref, else — on
 * Crossref's 404 — the agency doi.org names (crossrefNotFound: DataCite, or
 * content negotiation for mEDRA / JaLC / KISTI). `crossref` is the Crossref
 * lookup to start from (research passes its registry's). Research's
 * aggregator confirmation and `add`'s PubMed confirmation ask a DOI through
 * it (sources/registrar-confirm.ts; main-branch merge review, round 2: a
 * DataCite DOI was never confirmed). The typed OfflineEgressError propagates.
 */
export async function registrarLookup(
  doi: string,
  crossref: (doi: string) => Promise<LookupResult> = (d) => sources.crossref.lookupById(d),
): Promise<LookupResult> {
  const r = await crossref(doi);
  return r.kind === 'not-found' ? crossrefNotFound(doi, r) : r;
}

/**
 * Crossref answered 404 for `doi`: definitive only when Crossref registers the
 * DOI's prefix (D-19-05, review round 3). doi.org names the prefix's agency,
 * and the DOI is then read where Pass 1 reads it (VRFY-11, D-20-10):
 * Crossref → not-found (the identifier is wrong); DataCite (Zenodo, Figshare,
 * Dryad …) → DataCite's record (sources/datacite.ts); mEDRA, JaLC, KISTI →
 * doi.org content negotiation (sources/doi-cn.ts); an agency that serves no
 * record → failed, saying so; no agency → not-found (the prefix does not
 * exist); the question unanswered → failed with the reason. The typed
 * OfflineEgressError propagates.
 */
async function crossrefNotFound(doi: string, notFound: LookupResult): Promise<LookupResult> {
  const ra = await registrationAgency(doi);
  switch (ra.kind) {
    case 'agency': {
      if (/^crossref$/i.test(ra.agency)) return notFound;
      const elsewhere = `registered with ${ra.agency}, not Crossref`;
      const r = /^datacite$/i.test(ra.agency)
        ? await sources.datacite.lookupById(doi)
        : doiContent.servesContentNegotiation(ra.agency)
          ? await doiContent.lookupById(doi)
          : null;
      if (r === null) {
        return lookupFailed(
          `${elsewhere}, which serves no record pensmith can read — add the work by its arXiv id, PMID or ISBN instead`,
          { permanent: true },
        );
      }
      if (r.kind === 'found') return r;
      if (r.kind === 'not-found') return lookupNotFound(`${elsewhere}, and ${ra.agency} has no record of it (${r.reason})`);
      return lookupFailed(`${elsewhere}; ${ra.agency} lookup failed (${r.reason})`, {
        ...(r.status !== undefined ? { status: r.status } : {}),
        ...(r.retryAfterMs !== undefined ? { retryAfterMs: r.retryAfterMs } : {}),
        ...(r.permanent === true ? { permanent: true } : {}),
      });
    }
    case 'unknown-prefix':
      return lookupNotFound(`no registration agency holds the DOI prefix ${doiPrefix(doi) ?? doi}`);
    case 'failed':
      return lookupFailed(
        `Crossref has no record of this DOI, and doi.org could not say which agency registered it (${ra.reason}) — try again later`,
      );
  }
}

/** What `paper_doi_verify` answers for one DOI (the three outcomes of its registrar's lookup, D-19-05). */
export interface DoiCheck {
  /** `found`, `not-found` (the registrar that holds the prefix has no such DOI), `failed` (no answer — never "not found"), or `invalid` (not a DOI). */
  readonly outcome: 'found' | 'not-found' | 'failed' | 'invalid';
  /** True only when the DOI's registrar holds a record of it. */
  readonly valid: boolean;
  /** The normalized DOI, or null when the input is not one. */
  readonly canonical: string | null;
  /** Why the DOI was not found, or why the lookup could not be answered. */
  readonly reason?: string;
  /** The registrar's record, for a found DOI. */
  readonly metadata?: { title: string; authors: string[]; year?: number; venue?: string; source: string };
}

/**
 * Check one DOI at its registrar, as `add` and Pass 1 read it (VRFY-11): Crossref,
 * else the agency doi.org names — DataCite, or content negotiation for mEDRA /
 * JaLC / KISTI. A registrar that cannot answer (offline, rate limited, 5xx) is
 * `failed` with the reason, never `not-found` (D-20-03). The MCP
 * `paper_doi_verify` tool returns this. Never throws for a lookup outcome.
 */
export async function checkDoi(doi: string): Promise<DoiCheck> {
  const canonical = normalizeDoi(doi);
  if (canonical === null) return { outcome: 'invalid', valid: false, canonical: null, reason: 'not a DOI (a DOI starts with 10. and a registrant prefix)' };
  let r: LookupResult;
  try {
    r = await lookupIdentifier({ kind: 'doi', raw: doi, doi: canonical });
  } catch (e) {
    if (isOfflineEgressError(e)) {
      return { outcome: 'failed', valid: false, canonical, reason: `the registrar was not asked (${offlineLabel(e)}) — check it again online` };
    }
    throw e;
  }
  if (r.kind === 'found') {
    const c = r.candidate;
    return {
      outcome: 'found',
      valid: true,
      canonical,
      metadata: {
        title: c.title,
        authors: c.authors,
        ...(c.year !== undefined ? { year: c.year } : {}),
        ...(c.venue !== undefined ? { venue: c.venue } : {}),
        source: c.source,
      },
    };
  }
  return { outcome: r.kind, valid: false, canonical, reason: r.reason };
}

/** The arXiv API query for a title (the `ti:` field, as a phrase). */
export function arxivTitleQuery(title: string): string {
  return `ti:"${title.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()}"`;
}

/**
 * Search a title at arXiv (pdf-identify.ts asks only when the title and first
 * author matched nothing but a later re-post, or the OpenAlex search failed).
 * Only the title is sent.
 * OfflineEgressError propagates.
 */
export async function searchArxivByTitle(title: string): Promise<TitleSearchOutcome> {
  let failed: string | null = null;
  const hits = await sources.arxiv.search(arxivTitleQuery(title), {
    limit: TITLE_SEARCH_LIMIT,
    onFailure: (reason: string) => {
      failed = reason;
    },
  });
  return { candidates: hits, failures: failed !== null ? [`arxiv title search: ${String(failed)}`] : [] };
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
