// bin/lib/sources/doi-cn.ts — a DOI's record through doi.org content
// negotiation (Phase 20, VRFY-11, D-20-10).
//
// Endpoint:
//   lookupById: GET https://doi.org/<doi>
//               Accept: application/vnd.citationstyles.csl+json
//
// doi.org answers a CSL-JSON request with a redirect to the registration
// agency's own content-negotiation service (mEDRA → data.medra.org, JaLC →
// japanlinkcenter.org/data, KISTI, …), which answers with the record as CSL
// JSON. Pass 1 asks here for a DOI that Crossref does not know and doi.org's
// agency lookup (doi-ra.ts) names one of CONTENT_NEGOTIATION_AGENCIES — the
// agencies that serve content negotiation. The redirect is followed by the one
// egress gate (http.ts: every hop re-validated, source `generic`); only the DOI
// leaves the machine.
//
// Three-way lookups (D-19-05): found (a CSL record with a title and a
// contributor) | not-found (doi.org's HTTP 404, "DOI Not Found": the handle
// does not exist) | failed — either no answer (a 429 / 5xx after retries, a
// transport error, a refused redirect) or, `permanent`, an answer that is not
// a CSL record (the agency served a landing page instead: nothing to compare,
// and asking again gives the same answer). The typed OfflineEgressError is
// rethrown (RUN-03). A CSL record carries no retraction data: its retraction
// status is `unknown` (VRFY-15, D-20-13).

import { fetch as httpFetch, MAX_JSON_RESPONSE_BYTES } from '../http.js';
import { answeredAt, exchange, parseJsonBody, statusReason, validator, type LookupOptions, type ShapeCheck } from './registrar-response.js';
import { lookupFailed, lookupFound, lookupNotFound, unwrapLookup, type LookupResult } from './lookup.js';
import { generateCitekey } from '../citekey.js';
import { normalizeDoi } from '../doi.js';
import { plainText, plainTextOpt } from '../markup.js';
import { displayAuthorName } from '../person-name.js';
import { recordedErrorBody } from '../http-mock.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';
import { SOURCE_TYPES, type SourceType } from '../schemas/source-types.js';

/**
 * The registration agencies whose DOIs doi.org content negotiation serves as
 * CSL JSON (besides Crossref and DataCite, which Pass 1 asks directly).
 * Compared case-insensitively. Another agency (ISTIC, CNKI, Airiti, EIDR, the
 * EU Publications Office, …) answers with a landing page: Pass 1 then checks
 * the entry's arXiv id / PMID / ISBN, else reports it UNVERIFIABLE naming the
 * agency.
 */
export const CONTENT_NEGOTIATION_AGENCIES: readonly string[] = Object.freeze(['mEDRA', 'JaLC', 'KISTI']);

/** True when doi.org content negotiation serves `agency`'s records as CSL JSON. */
export function servesContentNegotiation(agency: string): boolean {
  return CONTENT_NEGOTIATION_AGENCIES.some((a) => a.toLowerCase() === agency.trim().toLowerCase());
}

const CSL_ACCEPT = 'application/vnd.citationstyles.csl+json';

interface CslName {
  family?: string;
  given?: string;
  literal?: string;
  name?: string;
}

export interface CslRecord {
  DOI?: string;
  title?: string | string[];
  subtitle?: string | string[];
  author?: CslName[];
  editor?: CslName[];
  issued?: { 'date-parts'?: Array<Array<number | string | null>> };
  'container-title'?: string | string[];
  type?: string;
  publisher?: string;
  volume?: string | number;
  issue?: string | number;
  page?: string;
  abstract?: string;
}

function first(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim().length > 0 ? s.trim() : undefined;
}

/** One CSL name as an author string: "Family, Given", a braced literal, or the name as given. */
export function cslPersonName(n: CslName): string {
  const family = typeof n.family === 'string' ? n.family.trim() : '';
  const given = typeof n.given === 'string' ? n.given.trim() : '';
  const literal = (typeof n.literal === 'string' ? n.literal : typeof n.name === 'string' ? n.name : '').replace(/[{}]/g, '').trim();
  if (family) return given ? `${family}, ${given}` : family;
  if (literal) return `{${literal}}`;
  // A given-only name is how some agencies send a whole name ("北本, 朝展"): read as written.
  return given ? displayAuthorName(given) : '';
}

function yearOf(r: CslRecord): number | undefined {
  const y = Number(r.issued?.['date-parts']?.[0]?.[0]);
  return Number.isInteger(y) && y >= 1800 && y <= 2100 ? y : undefined;
}

/** A CSL-JSON record as a SourceCandidate, or null when it has no title or nobody to attribute it to. */
export function cslToCandidate(r: CslRecord, fallbackDoi: string, checkedAt: string = new Date().toISOString()): SourceCandidate | null {
  const doi = normalizeDoi(first(r.DOI) ?? '') ?? normalizeDoi(fallbackDoi);
  if (doi === null) return null;
  const title = plainText(first(r.title) ?? '');
  if (!title) return null;
  const subtitle = plainTextOpt(first(r.subtitle));
  const names = (list: CslName[] | undefined): string[] => (Array.isArray(list) ? list : []).map(cslPersonName).filter((s) => s.length > 0);
  const creators = names(r.author);
  const editors = names(r.editor);
  const authors = creators.length > 0 ? creators : editors;
  if (authors.length === 0) return null;
  const year = yearOf(r);
  const venue = plainTextOpt(first(r['container-title']));
  const publisher = plainTextOpt(first(r.publisher));
  const type = (SOURCE_TYPES as readonly string[]).includes(String(r.type)) ? (r.type as SourceType) : r.type ? 'other' : undefined;
  const text = (v: string | number | undefined): string | undefined => (v === undefined || String(v).trim() === '' ? undefined : String(v).trim());
  const volume = text(r.volume);
  const issue = text(r.issue);
  const pages = text(r.page);
  const abstract = plainTextOpt(first(r.abstract));
  return {
    source: 'doi.org',
    id: doi,
    doi,
    title,
    ...(subtitle !== undefined ? { subtitle } : {}),
    authors,
    ...(editors.length > 0 ? { editors } : {}),
    ...(year !== undefined ? { year } : {}),
    ...(abstract !== undefined ? { abstract } : {}),
    ...(venue !== undefined ? { venue } : {}),
    ...(volume !== undefined ? { volume } : {}),
    ...(issue !== undefined ? { issue } : {}),
    ...(pages !== undefined ? { pages } : {}),
    ...(publisher !== undefined ? { publisher } : {}),
    ...(type !== undefined ? { type } : {}),
    retracted: false,
    retraction_status: 'unknown',
    last_verified: checkedAt,
    citekey: generateCitekey({ authors, ...(year !== undefined ? { year } : {}) }),
    raw: r,
  };
}

/** Why a 200 is not a CSL record (an HTML landing page, an error document), or null. */
const CSL_RECORD: ShapeCheck = (res) => {
  const body = parseJsonBody(res);
  if (body === undefined || typeof body !== 'object' || body === null || Array.isArray(body)) {
    const ct = res.headers['content-type'] ?? 'no content type';
    return `not a CSL record (${ct.split(';')[0]})`;
  }
  const errorDoc = recordedErrorBody(200, body);
  if (errorDoc !== null) return `an error document: ${errorDoc}`;
  const o = body as Record<string, unknown>;
  return typeof o['title'] === 'string' || Array.isArray(o['title']) || typeof o['DOI'] === 'string' ? null : 'no CSL title or DOI';
};

/** The content-negotiation URL for a normalized DOI (exported for the recorder and tests). */
export function contentNegotiationUrl(doi: string): string {
  return `https://doi.org/${doi.split('/').map((part, i) => (i === 0 ? part : encodeURIComponent(part))).join('/')}`;
}

/**
 * The record of `id` (a DOI) through doi.org content negotiation: found |
 * not-found (doi.org's 404) | failed (see the header; `permanent` when the
 * agency answered with something that is not a record).
 */
export async function lookupById(id: string, opts: LookupOptions = {}): Promise<LookupResult> {
  const doi = normalizeDoi(id);
  if (doi === null) return lookupNotFound(`not a DOI: ${JSON.stringify(id.slice(0, 80))}`);
  const ex = await exchange(
    () =>
      httpFetch(contentNegotiationUrl(doi), {
        source: 'generic',
        headers: { accept: CSL_ACCEPT },
        maxBytes: MAX_JSON_RESPONSE_BYTES,
        validate: validator(CSL_RECORD),
        ...(opts.refresh === true ? { refresh: true } : {}),
      }),
    { service: 'doi.org content-negotiation', check: CSL_RECORD },
  );
  if (ex.kind === 'failed') {
    // A 200 that is not a record is the agency's definitive answer (a landing page).
    const definitive = ex.status === 200;
    return lookupFailed(ex.reason, {
      ...(ex.status !== undefined ? { status: ex.status } : {}),
      ...(ex.retryAfterMs !== undefined ? { retryAfterMs: ex.retryAfterMs } : {}),
      ...(definitive ? { permanent: true } : {}),
    });
  }
  if (ex.kind === 'status') {
    if (ex.res.status === 404) return lookupNotFound('HTTP 404 (doi.org: DOI Not Found)');
    // 406 Not Acceptable: the agency serves no CSL record for it — definitive.
    return lookupFailed(statusReason(ex.res), { status: ex.res.status, ...(ex.res.status === 406 ? { permanent: true } : {}) });
  }
  const candidate = cslToCandidate(parseJsonBody(ex.res) as CslRecord, doi, answeredAt(ex.res));
  if (candidate === null) {
    return lookupFailed(
      'the record doi.org served lists no title, or no author or editor, so it cannot be checked (asking again gives the same answer)',
      { status: 200, permanent: true },
    );
  }
  return lookupFound(candidate);
}

export async function fetchById(doi: string): Promise<SourceCandidate | null> {
  return unwrapLookup(await lookupById(doi), 'doi.org', doi);
}
