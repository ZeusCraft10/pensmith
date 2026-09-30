// bin/lib/sources/datacite.ts — DataCite REST API adapter (Phase 20, VRFY-11,
// D-20-10).
//
// Endpoints:
//   lookupById:  GET https://api.datacite.org/dois/<doi>
//   searchTitle: GET https://api.datacite.org/dois?query=titles.title:"<title>"&page[size]=5
//                (Pass 1's metadata search for an entry with no identifier,
//                VRFY-12 — the title only leaves the machine)
//
// DataCite registers the DOIs of Zenodo (10.5281), figshare (10.6084), Dryad
// (10.5061), arXiv (10.48550) and many data repositories and institutional
// archives. Crossref has no record of them, so Crossref's 404 says nothing
// about whether such a DOI exists: Pass 1 asks doi.org which agency holds the
// prefix (doi-ra.ts) and, for DataCite, asks DataCite itself here. (An arXiv
// DataCite DOI is still re-fetched at arXiv by its id: the arXiv record is the
// work's own registrar record.)
//
// Three-way lookups (D-19-05): found | not-found (HTTP 404 — DataCite has no
// such DOI) | failed (a 429 / 5xx after retries, an exhausted host, an open
// breaker, a transport error, or a body that is not a DataCite answer — an
// error document inside a 200 included). fetchById is the unwrapped view. The
// typed OfflineEgressError is rethrown (RUN-03). The shape check is also the
// transport's `validate`, so an error body is never cached or recorded
// (SRC-17). No key and no contact email: DataCite's public REST API is
// anonymous (docs/SOURCES.md, PRIVACY.md) — only the DOI is sent.
//
// A candidate: title (the main title; a `Subtitle` title apart), creators as
// "Family, Given" when DataCite splits the name, else the name as given (a
// braced organisation name for an Organizational creator or a group-like
// display name), editors from the `Editor` contributors, the publication year,
// the publisher, the container title as venue, the abstract, the CSL type from
// `resourceTypeGeneral`, and the relations DataCite asserts to other DOIs
// (VRFY-14). Retraction status is `unknown`: DataCite carries no retraction
// data (VRFY-15, D-20-13) — never `clear`.

import { fetch as httpFetch, MAX_JSON_RESPONSE_BYTES } from '../http.js';
import { answeredAt, exchange, jsonShape, statusReason, validator, type LookupOptions, type ShapeCheck } from './registrar-response.js';
import { lookupFailed, lookupFound, lookupNotFound, unwrapLookup, type LookupResult } from './lookup.js';
import { generateCitekey } from '../citekey.js';
import { normalizeDoi } from '../doi.js';
import { plainText, plainTextOpt } from '../markup.js';
import { displayAuthorName } from '../person-name.js';
import { lookupTable } from '../lookup-table.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';
import type { SourceType } from '../schemas/source-types.js';

const BASE = 'https://api.datacite.org';
const SERVICE = 'DataCite';

/** Why a DataCite record's retraction status is unknown (VRFY-15, D-20-13). */
export const DATACITE_RETRACTION_UNKNOWN = 'no retraction data for DataCite DOIs';

interface DataCiteName {
  name?: string;
  nameType?: string;
  givenName?: string;
  familyName?: string;
  contributorType?: string;
}

interface DataCiteTitle {
  title?: string;
  titleType?: string;
}

interface DataCiteRelated {
  relationType?: string;
  relatedIdentifier?: string;
  relatedIdentifierType?: string;
}

export interface DataCiteAttributes {
  doi?: string;
  creators?: DataCiteName[];
  contributors?: DataCiteName[];
  titles?: DataCiteTitle[];
  publisher?: string | { name?: string };
  publicationYear?: number | string;
  types?: { resourceTypeGeneral?: string; citeproc?: string };
  descriptions?: Array<{ description?: string; descriptionType?: string }>;
  container?: { title?: string; volume?: string; issue?: string; firstPage?: string; lastPage?: string };
  relatedIdentifiers?: DataCiteRelated[];
}

/** DataCite resourceTypeGeneral → CSL type (the SourceType vocabulary). */
const CSL_TYPE: Readonly<Record<string, SourceType>> = lookupTable({
  JournalArticle: 'article-journal',
  Preprint: 'preprint',
  Dataset: 'dataset',
  Book: 'book',
  BookChapter: 'chapter',
  ConferencePaper: 'paper-conference',
  ConferenceProceeding: 'book',
  Report: 'report',
  Dissertation: 'thesis',
  Text: 'other',
  Software: 'other',
});

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

/** One DataCite creator / contributor as an author string (see the header). */
export function dataCiteName(n: DataCiteName): string {
  const family = str(n.familyName);
  const given = str(n.givenName);
  const name = str(n.name)?.replace(/[{}]/g, '');
  if (n.nameType === 'Organizational') return name ? `{${name}}` : '';
  // DataCite splits a personal name when it knows the parts; a family name that
  // repeats the whole display name ("Ines Montani") is not a split.
  if (family && given && family !== name) return `${family}, ${given}`;
  if (name) return displayAuthorName(name);
  return family ?? given ?? '';
}

/** The kebab-case relation type (`IsIdenticalTo` → `is-identical-to`). */
function kebab(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** A DataCite record as a SourceCandidate, or null when it has no title or nobody to attribute it to. */
export function dataCiteToCandidate(attrs: DataCiteAttributes, checkedAt: string = new Date().toISOString()): SourceCandidate | null {
  const doi = normalizeDoi(str(attrs.doi) ?? '');
  if (doi === null) return null;
  const titles = Array.isArray(attrs.titles) ? attrs.titles : [];
  const main = titles.find((t) => !str(t.titleType) && str(t.title)) ?? titles.find((t) => str(t.title) && t.titleType !== 'Subtitle');
  const title = plainText(str(main?.title) ?? '');
  if (!title) return null;
  const subtitle = plainTextOpt(str(titles.find((t) => t.titleType === 'Subtitle')?.title));
  const names = (list: DataCiteName[] | undefined): string[] =>
    (Array.isArray(list) ? list : []).map(dataCiteName).filter((s) => s.length > 0);
  const creators = names(attrs.creators);
  const editors = names((attrs.contributors ?? []).filter((c) => c.contributorType === 'Editor'));
  const authors = creators.length > 0 ? creators : editors;
  if (authors.length === 0) return null;
  const yearNum = Number(attrs.publicationYear);
  const year = Number.isInteger(yearNum) && yearNum >= 1800 && yearNum <= 2100 ? yearNum : undefined;
  const publisher = plainTextOpt(typeof attrs.publisher === 'string' ? str(attrs.publisher) : str(attrs.publisher?.name));
  const venue = plainTextOpt(str(attrs.container?.title));
  const abstract = plainTextOpt(str((attrs.descriptions ?? []).find((d) => d.descriptionType === 'Abstract')?.description));
  const general = str(attrs.types?.resourceTypeGeneral);
  const type = general !== undefined ? CSL_TYPE[general] ?? 'other' : undefined;
  const relations = (Array.isArray(attrs.relatedIdentifiers) ? attrs.relatedIdentifiers : [])
    .filter((r) => r.relatedIdentifierType === 'DOI' && str(r.relationType) && str(r.relatedIdentifier))
    .map((r) => ({ type: kebab(r.relationType as string), doi: normalizeDoi(r.relatedIdentifier as string) }))
    .filter((r): r is { type: string; doi: string } => r.doi !== null);
  const volume = str(attrs.container?.volume);
  const issue = str(attrs.container?.issue);
  const first = str(attrs.container?.firstPage);
  const last = str(attrs.container?.lastPage);
  const pages = first ? (last ? `${first}-${last}` : first) : undefined;
  return {
    source: 'datacite',
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
    ...(relations.length > 0 ? { relations } : {}),
    retracted: false,
    retraction_status: 'unknown',
    last_verified: checkedAt,
    citekey: generateCitekey({ authors, ...(year !== undefined ? { year } : {}) }),
    raw: attrs,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const DOI_RECORD: ShapeCheck = jsonShape(
  (b) => isObject(b) && isObject(b['data']) && b['data']['type'] === 'dois' && isObject(b['data']['attributes']),
  'DataCite DOI record (data.type "dois")',
);

/** The lookup URL for a normalized DOI (exported for the recorder and tests). */
export function lookupUrl(doi: string): string {
  return `${BASE}/dois/${encodeURIComponent(doi)}`;
}

/** DataCite's answer for one DOI: found | not-found (HTTP 404) | failed (reason). */
export async function lookupById(id: string, opts: LookupOptions = {}): Promise<LookupResult> {
  const doi = normalizeDoi(id);
  if (doi === null) return lookupNotFound(`not a DOI: ${JSON.stringify(id.slice(0, 80))}`);
  const ex = await exchange(
    () =>
      httpFetch(lookupUrl(doi), {
        source: 'datacite',
        maxBytes: MAX_JSON_RESPONSE_BYTES,
        validate: validator(DOI_RECORD),
        ...(opts.refresh === true ? { refresh: true } : {}),
      }),
    { service: SERVICE, check: DOI_RECORD },
  );
  if (ex.kind === 'failed') {
    return lookupFailed(ex.reason, {
      ...(ex.status !== undefined ? { status: ex.status } : {}),
      ...(ex.retryAfterMs !== undefined ? { retryAfterMs: ex.retryAfterMs } : {}),
    });
  }
  if (ex.kind === 'status') {
    if (ex.res.status === 404) return lookupNotFound('HTTP 404 (DataCite has no record of this DOI)');
    return lookupFailed(statusReason(ex.res), { status: ex.res.status });
  }
  const attrs = (JSON.parse(ex.res.body) as { data: { attributes: DataCiteAttributes } }).data.attributes;
  const candidate = dataCiteToCandidate(attrs, answeredAt(ex.res));
  if (candidate === null) {
    return lookupFailed(
      "DataCite's record of this DOI lists no title, or no creator or editor, so it cannot be checked (an incomplete registrar record — asking again gives the same answer)",
      { status: 200, permanent: true },
    );
  }
  return lookupFound(candidate);
}

export async function fetchById(doi: string): Promise<SourceCandidate | null> {
  return unwrapLookup(await lookupById(doi), 'datacite', doi);
}

const DOI_LIST: ShapeCheck = jsonShape((b) => isObject(b) && Array.isArray(b['data']), 'DataCite DOI list (data[])');

/** The title as a DataCite (Elasticsearch) phrase: letters, digits and spaces only. */
function phrase(title: string): string {
  return plainText(title)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The title-search URL (Pass 1's metadata search, VRFY-12) — exported for the recorder and tests (the exact request). */
export function titleSearchUrl(title: string, rows = 5): string {
  return `${BASE}/dois?query=${encodeURIComponent(`titles.title:"${phrase(title)}"`)}&page%5Bsize%5D=${rows}`;
}

/** A title search's outcome: the records DataCite found, or why it did not answer. */
export type TitleSearchResult =
  | { readonly kind: 'ok'; readonly candidates: SourceCandidate[] }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * Pass 1's metadata search for an entry with no identifier (VRFY-12): the
 * DataCite records whose title holds the claimed title as a phrase. An empty
 * list is DataCite's definitive "nothing matches"; `failed` is no answer. The
 * typed OfflineEgressError is rethrown.
 */
export async function searchTitle(title: string, opts: LookupOptions = {}): Promise<TitleSearchResult> {
  if (phrase(title) === '') return { kind: 'ok', candidates: [] };
  const ex = await exchange(
    () =>
      httpFetch(titleSearchUrl(title), {
        source: 'datacite',
        maxBytes: MAX_JSON_RESPONSE_BYTES,
        validate: validator(DOI_LIST),
        ...(opts.refresh === true ? { refresh: true } : {}),
      }),
    { service: SERVICE, check: DOI_LIST },
  );
  if (ex.kind === 'failed') return { kind: 'failed', reason: ex.reason };
  if (ex.kind === 'status') return { kind: 'failed', reason: statusReason(ex.res) };
  const at = answeredAt(ex.res);
  const data = (JSON.parse(ex.res.body) as { data: Array<{ attributes?: DataCiteAttributes }> }).data;
  return {
    kind: 'ok',
    candidates: data
      .map((d) => (isObject(d) && isObject(d.attributes) ? dataCiteToCandidate(d.attributes, at) : null))
      .filter((c): c is SourceCandidate => c !== null),
  };
}
