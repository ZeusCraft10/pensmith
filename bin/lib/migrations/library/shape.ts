// bin/lib/migrations/library/shape.ts — pure shaping of source records into
// LIBRARY.json entries (BRDTH-01 / D-17-43; the v3 fields by Phase 19 seam S-B).
//
// Shared by the v1→v2 migration (v1_to_v2.ts, which must turn research-written
// SourceCandidate[] entries into v2 entries) and the one library writer
// (bin/lib/library.ts upsertSources, which turns fresh candidates into entries).
// One conversion, so a migrated library and a freshly written one are the same
// shape. Pure: no I/O, no clock (callers pass `now`).
//
// Identifier normalization (the dedup keys):
//   - DOI   → doi.ts normalizeDoi (case, https://doi.org/ and doi: prefixes).
//   - arXiv → doi.ts normalizeArxiv, version suffix dropped, bare id
//             (`1706.03762`, `cs.CL/0301012`); a DataCite arXiv DOI
//             (10.48550/arXiv.1706.03762) also yields the arXiv id.
//   - PMID  → digits; PMCID → PMC<digits>; ISBN → ISBN-13 digits (an ISBN-10
//             is converted, so both spellings of one book dedup).

import { plainText } from '../../markup.js';
import { normalizeDoi, normalizeArxiv, normalizePmid, normalizePmcid } from '../../doi.js';
import { generateCitekey } from '../../citekey.js';
import { CITEKEY_GRAMMAR, ByoRecordSchema, type ByoRecordInput, type LibraryEntry } from '../../schemas/library.js';
import {
  SourceTypeSchema,
  SourceTierSchema,
  RetractionStatusSchema,
  ZoteroRefSchema,
  type SourceType,
  type SourceTier,
  type RetractionStatus,
  type ZoteroRef,
} from '../../schemas/source-types.js';

/**
 * A source handed to the library writer. SourceCandidate (research adapters)
 * satisfies it structurally; `add`, `plan --research`, BYO and Zotero ingest
 * build the same shape. Everything but `title` is optional.
 */
export interface LibraryCandidate {
  citekey?: string | undefined;
  /** The adapter that produced it (SourceCandidate.source) — a provenance detail. */
  source?: string | undefined;
  /** SourceCandidate.id: a DOI, arXiv id, PMID, S2 id or OpenAlex W-id, per `source`. */
  id?: string | undefined;
  doi?: string | null | undefined;
  arxiv?: string | null | undefined;
  /** Legacy spelling carried by some bib-derived candidates. */
  arxivId?: string | null | undefined;
  pmid?: string | null | undefined;
  pmcid?: string | null | undefined;
  isbn?: string | null | undefined;
  title?: string | null | undefined;
  authors?: string[] | undefined;
  year?: number | null | undefined;
  venue?: string | null | undefined;
  abstract?: string | null | undefined;
  oa_url?: string | null | undefined;
  /** An adapter's open-access link (SourceCandidate): NOT stored as oa_url (see candidateToEntry). */
  oa_pdf_url?: string | null | undefined;
  alternate_dois?: string[] | undefined;
  retracted?: boolean | undefined;
  retraction_details?: string | null | undefined;
  synthetic?: boolean | undefined;
  last_verified?: string | null | undefined;
  raw?: unknown;
  // v3 (Phase 19 seam S-B) — every field optional; unknown values are dropped
  // by candidateToEntry (an invalid enum value or a non-string becomes null).
  type?: SourceType | string | null | undefined;
  publisher?: string | null | undefined;
  volume?: string | number | null | undefined;
  issue?: string | number | null | undefined;
  pages?: string | null | undefined;
  editors?: string[] | undefined;
  tier?: SourceTier | string | null | undefined;
  relevance?: number | null | undefined;
  why_relevant?: string | null | undefined;
  /** false = a bring-your-own PDF kept with local metadata only (SRC-15). */
  hydrated?: boolean | undefined;
  retraction_status?: RetractionStatus | string | null | undefined;
  zotero?: ZoteroRef | null | undefined;
  /** The bring-your-own PDF record (file under .paper/, sha256s) — SRC-15. */
  byo?: ByoRecordInput | null | undefined;
}

export function normDoi(v: unknown): string | null {
  return typeof v === 'string' ? normalizeDoi(v) : null;
}

/** Bare arXiv id without version, or null. Accepts ids, `arXiv:` forms, abs URLs and 10.48550 DOIs. */
export function normArxiv(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let s = v.trim();
  const url = /arxiv\.org\/(?:abs|pdf)\/([^?#\s]+?)(?:\.pdf)?$/i.exec(s);
  if (url?.[1]) s = url[1];
  const dataCite = /^(?:https?:\/\/(?:dx\.)?doi\.org\/)?10\.48550\/arxiv\.(.+)$/i.exec(s);
  if (dataCite?.[1]) s = dataCite[1];
  const n = normalizeArxiv(s);
  if (!n) return null;
  return n.replace(/^arxiv:/, '').replace(/v\d+$/, '');
}

export function normPmid(v: unknown): string | null {
  return typeof v === 'string' ? normalizePmid(v) : typeof v === 'number' ? normalizePmid(String(v)) : null;
}

export function normPmcid(v: unknown): string | null {
  return typeof v === 'string' ? normalizePmcid(v) : null;
}

/** ISBN-13 digits (an ISBN-10 is converted), or null when the check digit fails. */
export function normIsbn(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/^isbn(?:-1[03])?:?/i, '').replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{13}$/.test(s)) {
    const sum = [...s.slice(0, 12)].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
    return (10 - (sum % 10)) % 10 === Number(s[12]) ? s : null;
  }
  if (/^\d{9}[\dX]$/.test(s)) {
    const sum10 = [...s].reduce((acc, d, i) => acc + (d === 'X' ? 10 : Number(d)) * (10 - i), 0);
    if (sum10 % 11 !== 0) return null;
    const core = `978${s.slice(0, 9)}`;
    const sum = [...core].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
    return `${core}${(10 - (sum % 10)) % 10}`;
  }
  return null;
}

/**
 * Preprint-server DOI registrants (the D-17-43 "SSRN / Research Square" rule,
 * extended to the other common servers). A normalized DOI is split on its first
 * '/' and matched by registrant + suffix shape — no DOI regex here (doi.ts owns
 * DOI parsing; the input is already normalized by it).
 */
const PREPRINT_REGISTRANTS: ReadonlyArray<{ registrant: string; suffix: RegExp }> = [
  { registrant: '10.2139', suffix: /^ssrn\./ }, // SSRN
  { registrant: '10.21203', suffix: /^rs\./ }, // Research Square
  { registrant: '10.48550', suffix: /^arxiv\./ }, // arXiv (DataCite)
  { registrant: '10.1101', suffix: /^(?:\d{4}\.\d{2}\.\d{2}\.\d+|\d{6})(?:v\d+)?$/ }, // bioRxiv / medRxiv (not CSHL journals)
  { registrant: '10.31219', suffix: /^osf\.io\// }, // OSF Preprints
  { registrant: '10.31234', suffix: /^osf\.io\// }, // PsyArXiv
  { registrant: '10.31235', suffix: /^osf\.io\// }, // SocArXiv
  { registrant: '10.35542', suffix: /^osf\.io\// }, // EdArXiv
  { registrant: '10.20944', suffix: /^preprints/ }, // Preprints.org
  { registrant: '10.26434', suffix: /^chemrxiv/ }, // ChemRxiv
  { registrant: '10.36227', suffix: /^techrxiv/ }, // TechRxiv
  { registrant: '10.22541', suffix: /^au\./ }, // Authorea
];

/** True for a DOI minted by a preprint server (never the version of record). */
export function isPreprintDoi(doi: string | null | undefined): boolean {
  if (!doi) return false;
  const slash = doi.indexOf('/');
  if (slash < 0) return false;
  const registrant = doi.slice(0, slash);
  const suffix = doi.slice(slash + 1);
  return PREPRINT_REGISTRANTS.some((p) => p.registrant === registrant && p.suffix.test(suffix));
}

/**
 * The DOI a versioned DOI is a version of (`10.6084/m9.figshare.123.v2` →
 * `10.6084/m9.figshare.123`; Figshare and other posted-content registrars mint
 * one DOI per version, `<base>.vN` or `<base>_vN`), or null when `doi` carries
 * no version suffix. Review round 2 (ROADMAP Phase 19 criterion 4).
 */
export function doiVersionBase(doi: string | null | undefined): string | null {
  if (!doi) return null;
  const m = /^(10\.\d{4,9}\/.+?)[._]v\d+$/i.exec(doi.trim());
  return m?.[1] ? m[1].toLowerCase() : null;
}

/** Normalized title for version matching: NFKC, lowercase, punctuation → space. */
export function normTitle(t: string | null | undefined): string {
  return (t ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** A string's plain text (markup.ts), anything else unchanged. */
function plainTextOf(v: unknown): unknown {
  return typeof v === 'string' ? plainText(v) : v;
}

function nonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function validUrl(v: unknown): string | null {
  const s = nonEmpty(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? s : null;
  } catch {
    return null;
  }
}

function validIso(v: unknown): string | null {
  const s = nonEmpty(v);
  return s && !Number.isNaN(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}T/.test(s) ? new Date(s).toISOString() : null;
}

/** A short bibliographic string (volume / issue): numbers become their decimal text. */
function shortField(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return nonEmpty(v);
}

function enumOrNull<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }, v: unknown): T | null {
  const r = schema.safeParse(v);
  return r.success ? r.data : null;
}

/** Relevance in [0, 1] (the evaluator's score), else null. */
function relevanceOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
}

/** Best-effort venue from an adapter's native payload (Crossref, OpenAlex). */
function venueFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const ct = r['container-title'];
  if (Array.isArray(ct) && typeof ct[0] === 'string') return nonEmpty(ct[0]);
  if (typeof ct === 'string') return nonEmpty(ct);
  const loc = r['primary_location'] as Record<string, unknown> | undefined;
  const src = loc?.['source'] as Record<string, unknown> | undefined;
  if (src && typeof src['display_name'] === 'string') return nonEmpty(src['display_name']);
  const hv = r['host_venue'] as Record<string, unknown> | undefined;
  if (hv && typeof hv['display_name'] === 'string') return nonEmpty(hv['display_name']);
  if (typeof r['journal'] === 'string') return nonEmpty(r['journal']);
  return null;
}

/**
 * A valid citekey for `raw`: kept verbatim when it already satisfies the Pandoc
 * key grammar (a user's hand-made key must keep resolving in their drafts),
 * else sanitized to the D-14 form, else the deterministic generated key.
 */
export function sanitizeCitekey(raw: unknown, c: Pick<LibraryCandidate, 'authors' | 'year'>): string {
  if (typeof raw === 'string' && CITEKEY_GRAMMAR.test(raw)) return raw;
  if (typeof raw === 'string') {
    const s = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/, '');
    if (/^[a-z][a-z0-9_-]*$/.test(s)) return s;
  }
  return generateCitekey({
    authors: c.authors ?? [],
    ...(typeof c.year === 'number' ? { year: c.year } : {}),
  });
}

/**
 * Shape one candidate into a current-version entry (identifiers normalized,
 * SourceCandidate spellings mapped, the v3 fields validated or nulled). `citekey` is the candidate's (sanitized) key — the writer
 * resolves collisions against the library afterwards.
 */
export function candidateToEntry(c: LibraryCandidate, provenance: string[], now: string): LibraryEntry {
  const source = typeof c.source === 'string' ? c.source : undefined;
  const id = typeof c.id === 'string' ? c.id : undefined;
  let doi = normDoi(c.doi) ?? (id && source !== 'arxiv' && source !== 'pubmed' ? normDoi(id) : null);
  let arxiv = normArxiv(c.arxiv) ?? normArxiv(c.arxivId) ?? (source === 'arxiv' && id ? normArxiv(id) : null);
  // A DataCite arXiv DOI is an arXiv id in DOI clothing: keep the DOI, and record the id.
  if (!arxiv && doi) arxiv = normArxiv(doi);
  const pmid = normPmid(c.pmid) ?? (source === 'pubmed' && id ? normPmid(id) : null);
  const alternates = new Set<string>();
  for (const a of c.alternate_dois ?? []) {
    const n = normDoi(a);
    if (n) alternates.add(n);
  }
  // An arXiv record's DOI is the journal's version of record (arXiv's
  // arxiv:doi), but its title and authors are the preprint's (review round 1
  // of the Phase 18/19 merge): as the primary DOI, Pass 1 would compare the
  // preprint with the journal's Crossref record — MIS-CITED whenever the title
  // or the author order changed on publication. Such an entry IS the preprint:
  // identified by its arXiv id (Pass 1 re-fetches it at arXiv), with the
  // journal DOI kept as a candidate only (VRFY-14). When the version of record
  // itself is ingested, the library merges it by that DOI and its metadata and
  // DOI win (library.ts mergeInto). A DataCite arXiv DOI is the preprint's own.
  const preprintOfRecord = source === 'arxiv' && doi !== null && arxiv !== null && normArxiv(doi) === null;
  if (preprintOfRecord && doi !== null) {
    alternates.add(doi);
    doi = null;
  }
  if (!doi && alternates.size > 0 && !preprintOfRecord) {
    doi = [...alternates][0]!;
    alternates.delete(doi);
  }
  if (doi) alternates.delete(doi);
  const authors = (c.authors ?? []).map((a) => (typeof a === 'string' ? a.trim() : '')).filter((a) => a.length > 0);
  const year = typeof c.year === 'number' && Number.isInteger(c.year) && c.year >= 1000 && c.year <= 2200 ? c.year : null;
  const editors = (c.editors ?? []).map((a) => (typeof a === 'string' ? a.trim() : '')).filter((a) => a.length > 0);
  // Fail closed (SRC-04): a retraction recorded either way is recorded both ways.
  const statusIn = enumOrNull(RetractionStatusSchema, c.retraction_status);
  const retracted = c.retracted === true || statusIn === 'retracted';
  const retraction_status: RetractionStatus = retracted ? 'retracted' : statusIn ?? 'unchecked';
  return {
    citekey: sanitizeCitekey(c.citekey, { authors, year }),
    doi,
    arxiv,
    pmid,
    pmcid: normPmcid(c.pmcid),
    isbn: normIsbn(c.isbn),
    // Registrar / Zotero markup out (`<i>…</i>`, `&amp;`): markup.ts.
    title: nonEmpty(plainTextOf(c.title)),
    authors,
    year,
    venue: nonEmpty(plainTextOf(c.venue)) ?? nonEmpty(plainTextOf(venueFromRaw(c.raw))),
    abstract: nonEmpty(c.abstract),
    // Only an Unpaywall-confirmed PDF (open-access.ts sets `oa_url`): the copy
    // Pass 3 checks and full-text.ts counts. An adapter's `oa_pdf_url`
    // (OpenAlex's open location) is not that copy (GRND-14, review round 2).
    oa_url: validUrl(c.oa_url),
    alternate_dois: [...alternates],
    provenance: [...new Set(provenance.filter((p) => p.length > 0))],
    retracted,
    retraction_details: nonEmpty(c.retraction_details),
    synthetic: c.synthetic === true,
    last_verified: validIso(c.last_verified),
    byo: enumOrNull(ByoRecordSchema, c.byo),
    type: enumOrNull(SourceTypeSchema, c.type),
    publisher: nonEmpty(plainTextOf(c.publisher)),
    volume: shortField(c.volume),
    issue: shortField(c.issue),
    pages: nonEmpty(c.pages),
    editors,
    tier: enumOrNull(SourceTierSchema, c.tier),
    relevance: relevanceOrNull(c.relevance),
    why_relevant: nonEmpty(c.why_relevant),
    hydrated: c.hydrated !== false,
    retraction_status,
    zotero: enumOrNull(ZoteroRefSchema, c.zotero),
    addedAt: now,
    updatedAt: now,
  };
}
