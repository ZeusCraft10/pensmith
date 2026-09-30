// bin/lib/sources/unpaywall.ts — Unpaywall OA-status adapter (RSCH-04, SRC-03,
// SRC-05, T-3-13).
//
// Endpoint:
//   lookupById:  GET https://api.unpaywall.org/v2/<doi>?email=<contact>
//
// Unpaywall is a DOI-lookup service — there is no native "search". We expose a
// `search()` export for protocol compatibility but it always returns [] (the
// research workflow calls Unpaywall only after another source has supplied a
// DOI). D-15 keeps retraction-watch fetchById-only as a hard rule; Unpaywall is
// soft-only: protocol-shaped but inert.
//
// The contact email is REQUIRED (Unpaywall answers 422 without one). It is the
// one resolver's address (bin/lib/contact-email.ts, D-19-09); when none is
// configured the lookup is `failed: Unpaywall skipped: set
// PENSMITH_CONTACT_EMAIL` (the configured variable's name) with one stderr
// notice per run — never a silent null, and no request is made. The param is
// scrubbed from recorded fixtures and never decides a fixture match.
//
// The answer (SRC-03, D-19-12):
//   - authors from `z_authors[].raw_author_name` (the current shape) or
//     `family` / `given` (the legacy shape);
//   - every `oa_locations[]` entry, as the candidate's `oa_locations`;
//   - `oa_pdf_url` = the best PDF: best_oa_location's `url_for_pdf`, then any
//     other location's `url_for_pdf`, then a location URL that is itself a PDF
//     link (arXiv / PMC / `.pdf`) or an arXiv abstract page's PDF.
// A 404 is not-found; another 4xx is failed with Unpaywall's own message.
//
// Offline replay is the exact-match fixture store inside bin/lib/http.ts — there
// is no "first cassette entry" fallback (RUN-03); the typed OfflineEgressError is
// rethrown so Pass 3 reports the text as unavailable (offline).

import { fetch as httpFetch, MAX_JSON_RESPONSE_BYTES } from '../http.js';
import { contactEmail } from '../contact-email.js';
import { exchange, jsonShape, statusReason, validator, type ShapeCheck } from './registrar-response.js';
import { lookupFailed, lookupFound, lookupNotFound, unwrapLookup, type LookupResult } from './lookup.js';
import { generateCitekey } from '../citekey.js';
import { displayAuthorName } from '../person-name.js';
import { normalizeDoi } from '../doi.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';
import { OaLocationSchema, type OaLocation } from '../schemas/source-types.js';

const BASE = 'https://api.unpaywall.org';
const SERVICE = 'Unpaywall';

interface UnpaywallAuthor {
  given?: string | null;
  family?: string | null;
  raw_author_name?: string | null;
}
interface UnpaywallOALocation {
  url?: string | null;
  url_for_pdf?: string | null;
  url_for_landing_page?: string | null;
  host_type?: string | null;
  version?: string | null;
  license?: string | null;
}
export interface UnpaywallResponse {
  doi?: string;
  title?: string | null;
  year?: number | null;
  is_oa?: boolean;
  genre?: string | null;
  journal_name?: string | null;
  publisher?: string | null;
  z_authors?: UnpaywallAuthor[] | null;
  best_oa_location?: UnpaywallOALocation | null;
  oa_locations?: UnpaywallOALocation[] | null;
}

/** The reason every Unpaywall lookup fails with when no contact email is configured. */
export function unpaywallSkippedReason(): string {
  return `Unpaywall skipped: set ${contactEmail().envName}`;
}

let warnedNoEmail = false;
function warnNoEmailOnce(reason: string): void {
  if (warnedNoEmail) return;
  warnedNoEmail = true;
  process.stderr.write(`pensmith: ${reason} — Unpaywall requires a contact email, so open-access lookups are skipped.\n`);
}

/** Test hook: let the missing-email notice print again. */
export function _resetUnpaywallNoticeForTest(): void {
  warnedNoEmail = false;
}

/** One `z_authors` entry as an author string (current and legacy shapes). */
export function unpaywallAuthorName(a: UnpaywallAuthor): string {
  const family = String(a.family ?? '').trim();
  const given = String(a.given ?? '').trim();
  if (family) return given ? `${family}, ${given}` : family;
  return displayAuthorName(String(a.raw_author_name ?? ''));
}

function httpUrl(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!/^https?:\/\//i.test(s)) return undefined;
  try {
    new URL(s);
    return s;
  } catch {
    return undefined;
  }
}

function toOaLocation(l: UnpaywallOALocation): OaLocation | null {
  const url = httpUrl(l.url) ?? httpUrl(l.url_for_landing_page);
  const pdf = httpUrl(l.url_for_pdf);
  if (url === undefined && pdf === undefined) return null;
  const parsed = OaLocationSchema.safeParse({
    ...(url !== undefined ? { url } : {}),
    ...(pdf !== undefined ? { url_for_pdf: pdf } : {}),
    ...(typeof l.host_type === 'string' && l.host_type ? { host_type: l.host_type } : {}),
    ...(typeof l.version === 'string' && l.version ? { version: l.version } : {}),
    ...(typeof l.license === 'string' && l.license ? { license: l.license } : {}),
  });
  return parsed.success ? parsed.data : null;
}

/** A location URL that is itself a PDF link, or the PDF of an arXiv abstract page. */
function pdfLinkOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const arxivAbs = /^https?:\/\/(?:www\.)?arxiv\.org\/abs\/([^?#]+?)\/?$/i.exec(url);
  if (arxivAbs?.[1]) return `https://arxiv.org/pdf/${arxivAbs[1]}`;
  if (/^https?:\/\/(?:www\.)?arxiv\.org\/pdf\//i.test(url)) return url;
  if (/^https?:\/\/(?:www\.ncbi\.nlm\.nih\.gov\/pmc|pmc\.ncbi\.nlm\.nih\.gov)\/articles\/PMC\d+\/pdf\//i.test(url)) return url;
  if (/\.pdf(?:[?#].*)?$/i.test(url)) return url;
  return undefined;
}

/** The best PDF among the locations (D-19-12), or undefined. */
export function bestPdfUrl(best: OaLocation | null, locations: readonly OaLocation[]): string | undefined {
  if (best?.url_for_pdf) return best.url_for_pdf;
  const other = locations.find((l) => l.url_for_pdf !== undefined);
  if (other?.url_for_pdf) return other.url_for_pdf;
  for (const l of best ? [best, ...locations] : locations) {
    const pdf = pdfLinkOf(l.url);
    if (pdf !== undefined) return pdf;
  }
  return undefined;
}

export function unpaywallToCandidate(item: UnpaywallResponse): SourceCandidate | null {
  const doi = typeof item.doi === 'string' ? item.doi.trim() : '';
  if (!doi) return null;
  const title = String(item.title ?? '').replace(/\s+/g, ' ').trim();
  if (!title) return null;

  const authors = (item.z_authors ?? []).map(unpaywallAuthorName).filter(Boolean);
  if (authors.length === 0) return null;

  const year = typeof item.year === 'number' && item.year >= 1800 && item.year <= 2100 ? item.year : undefined;
  const best = item.best_oa_location ? toOaLocation(item.best_oa_location) : null;
  const oa_locations = (item.oa_locations ?? []).map(toOaLocation).filter((l): l is OaLocation => l !== null);
  const oa_pdf_url = bestPdfUrl(best, oa_locations);
  const venue = typeof item.journal_name === 'string' && item.journal_name.trim() ? item.journal_name.trim() : undefined;
  const publisher = typeof item.publisher === 'string' && item.publisher.trim() ? item.publisher.trim() : undefined;

  return {
    source: 'unpaywall',
    id: doi,
    doi,
    title,
    authors,
    ...(year !== undefined ? { year } : {}),
    ...(venue !== undefined ? { venue } : {}),
    ...(publisher !== undefined ? { publisher } : {}),
    ...(oa_pdf_url !== undefined ? { oa_pdf_url } : {}),
    ...(oa_locations.length > 0 ? { oa_locations } : {}),
    retracted: false,
    last_verified: new Date().toISOString(),
    citekey: generateCitekey({ authors, ...(year !== undefined ? { year } : {}) }),
    raw: item,
  };
}

/**
 * Unpaywall has no native search endpoint — it is a DOI lookup service.
 * Returning [] preserves the adapter protocol (every source exposes
 * search/fetchById) so the orchestrator can iterate uniformly.
 */
export async function search(
  _query: string,
  // The limit option is part of the adapter protocol; Unpaywall has no
  // native search so we accept-and-ignore.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _opts: { limit?: number } = {},
): Promise<SourceCandidate[]> {
  return [];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const RECORD: ShapeCheck = jsonShape((b) => isObject(b) && typeof b['doi'] === 'string', 'Unpaywall record (doi)');

/** Unpaywall's answer for one DOI: found | not-found (HTTP 404) | failed (reason). */
export async function lookupById(id: string): Promise<LookupResult> {
  const doi = normalizeDoi(id);
  if (doi === null) return lookupNotFound(`not a DOI: ${JSON.stringify(id.slice(0, 80))}`);
  const email = contactEmail().email;
  if (email === null) {
    const reason = unpaywallSkippedReason();
    warnNoEmailOnce(reason);
    return lookupFailed(reason);
  }
  const url = `${BASE}/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`;
  const ex = await exchange(
    () => httpFetch(url, { source: 'unpaywall', maxBytes: MAX_JSON_RESPONSE_BYTES, validate: validator(RECORD) }),
    { service: SERVICE, check: RECORD },
  );
  if (ex.kind === 'failed') {
    return lookupFailed(ex.reason, {
      ...(ex.status !== undefined ? { status: ex.status } : {}),
      ...(ex.retryAfterMs !== undefined ? { retryAfterMs: ex.retryAfterMs } : {}),
    });
  }
  if (ex.kind === 'status') {
    if (ex.res.status === 404) return lookupNotFound('HTTP 404 (Unpaywall has no record of this DOI)');
    return lookupFailed(statusReason(ex.res), { status: ex.res.status });
  }
  const candidate = unpaywallToCandidate(JSON.parse(ex.res.body) as UnpaywallResponse);
  if (candidate === null) return lookupFailed('the Unpaywall record has no title or no authors (an incomplete registrar record — asking again gives the same answer)', { status: 200, permanent: true });
  return lookupFound(candidate);
}

export async function fetchById(doi: string): Promise<SourceCandidate | null> {
  return unwrapLookup(await lookupById(doi), 'unpaywall', doi);
}

// ---------------------------------------------------------------------------
// The open-access PDFs of a DOI, for Pass 3 (VRFY-19, D-20-18).
// ---------------------------------------------------------------------------

/**
 * Unpaywall's answer for one DOI as Pass 3 reads it: every PDF it lists.
 *   found      the record: `pdfUrls` best first (best_oa_location, then the
 *              other oa_locations in order; each location's `url_for_pdf`,
 *              else a location URL that is itself a PDF link — the links
 *              bestPdfUrl and open-access.ts consider), de-duplicated; and
 *              whether Unpaywall calls the work open access at all (`isOa`);
 *   not-found  HTTP 404: Unpaywall has no record of the DOI;
 *   failed     no usable answer. `noEmail`: no request was made because no
 *              contact email is configured (Unpaywall requires one);
 *              `status`: the HTTP status of an answer that was not a record.
 * The request is the one lookupById makes (one cache entry, one recording).
 * Throws only the typed OfflineEgressError (sources offline, no recording).
 */
export type OaPdfLookup =
  | { readonly kind: 'found'; readonly isOa: boolean; readonly pdfUrls: readonly string[] }
  | { readonly kind: 'not-found'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string; readonly status?: number; readonly noEmail?: boolean };

/** The PDF links of an Unpaywall record, best first, de-duplicated. */
export function oaPdfUrls(item: Pick<UnpaywallResponse, 'best_oa_location' | 'oa_locations'>): string[] {
  const locations = [item.best_oa_location, ...(item.oa_locations ?? [])].filter((l): l is UnpaywallOALocation => l !== null && l !== undefined && typeof l === 'object');
  const out: string[] = [];
  const add = (u: string | undefined): void => {
    if (u !== undefined && !out.includes(u)) out.push(u);
  };
  for (const l of locations) add(httpUrl(l.url_for_pdf));
  for (const l of locations) add(pdfLinkOf(httpUrl(l.url)));
  return out;
}

export async function lookupOaPdfUrls(id: string, opts: { readonly refresh?: boolean } = {}): Promise<OaPdfLookup> {
  const doi = normalizeDoi(id);
  if (doi === null) return { kind: 'not-found', reason: `not a DOI: ${JSON.stringify(id.slice(0, 80))}` };
  const email = contactEmail().email;
  if (email === null) {
    const reason = unpaywallSkippedReason();
    warnNoEmailOnce(reason);
    return { kind: 'failed', reason, noEmail: true };
  }
  const url = `${BASE}/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`;
  const ex = await exchange(
    // VRFY-28: a citation due for a re-check asks Unpaywall again (the HTTP
    // cache read is skipped and the fresh answer written back).
    () => httpFetch(url, { source: 'unpaywall', maxBytes: MAX_JSON_RESPONSE_BYTES, validate: validator(RECORD), ...(opts.refresh === true ? { refresh: true } : {}) }),
    { service: SERVICE, check: RECORD },
  );
  if (ex.kind === 'failed') return { kind: 'failed', reason: ex.reason, ...(ex.status !== undefined ? { status: ex.status } : {}) };
  if (ex.kind === 'status') {
    if (ex.res.status === 404) return { kind: 'not-found', reason: 'HTTP 404 (Unpaywall has no record of this DOI)' };
    return { kind: 'failed', reason: statusReason(ex.res), status: ex.res.status };
  }
  const item = JSON.parse(ex.res.body) as UnpaywallResponse;
  return { kind: 'found', isOa: item.is_oa !== false, pdfUrls: oaPdfUrls(item) };
}
