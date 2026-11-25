// bin/lib/sources/work-record.ts — the shape every registry lookup answers with.
//
// Pass 1 asks several registries about one identifier (Crossref, DataCite and
// doi.org for a DOI; arXiv, PubMed and Open Library for the others). Each
// adapter turns its own response into a WorkRecord, so the verifier compares a
// bibliography entry against one shape whatever registry answered.
//
// A lookup has three outcomes, and only one of them says a work does not exist:
//   found        the registry returned the work's metadata;
//   not_found    the registry answered and has no such work;
//   unavailable  no answer: a timeout, a 429 or 5xx after retries, a proxy or
//                DNS failure, or a response that could not be read.
// Treating "unavailable" as "not found" is what made rate limits and outages
// read as fabricated references.

/**
 * A personal or corporate name as a registry gives it. Structured registries
 * fill family/given (CSL also has particles and suffixes); corporate authors
 * come as `literal`; registries that only give a display string ("Ashish
 * Vaswani", "Vaswani A") put it in `text`.
 */
export interface WorkName {
  family?: string;
  given?: string;
  /** "van der", "de la": the CSL non-dropping and dropping particles, joined. */
  particle?: string;
  suffix?: string;
  /** A corporate or consortium name ("The ENCODE Project Consortium"). */
  literal?: string;
  /** An unstructured display name, order unknown. */
  text?: string;
}

export type RegistryName = 'Crossref' | 'DataCite' | 'doi.org' | 'arXiv' | 'PubMed' | 'Open Library';

export interface WorkRecord {
  registry: RegistryName;
  /** The DOI the registry reports for the work, when it has one. */
  doi?: string;
  /** Main title as the registry gives it; it may hold HTML, MathML or entities. */
  title: string;
  subtitle?: string;
  /** Translated or alternative titles the work is also known by. */
  altTitles?: string[];
  authors: WorkName[];
  editors?: WorkName[];
  /** Every year the work is dated by: issued, print, online, preprint versions. */
  years: number[];
  /** Journal or container names, full and abbreviated. */
  venues: string[];
  /** A journal article, whose journal name the bibliography must get right. */
  journalArticle: boolean;
  /** The registry's own response, for checks that read more of it. */
  raw: unknown;
}

export type Lookup =
  | { kind: 'found'; registry: RegistryName; record: WorkRecord }
  | {
      kind: 'not_found';
      registry: RegistryName;
      /**
       * False when the registry's silence does not show the work is not real.
       * Open Library holds only some books, so a missing ISBN there means
       * "cannot confirm", not "invented".
       */
      authoritative: boolean;
      detail?: string;
    }
  | { kind: 'unavailable'; registry: RegistryName; detail: string };

/** Why a request got no answer, in a few words, without the URL. */
export function unavailableDetail(err: unknown): string {
  const e = err as { status?: number; code?: string; name?: string } | null;
  if (e && typeof e.status === 'number') return `HTTP ${e.status}`;
  if (e && typeof e.code === 'string') return e.code;
  if (e && typeof e.name === 'string' && e.name !== 'Error') return e.name;
  return 'no response';
}

/** A year between 1500 and 2100 from a number or the start of a date string. */
export function yearOf(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(/^\s*(\d{4})/.exec(v)?.[1]) : NaN;
  return Number.isInteger(n) && n >= 1500 && n <= 2100 ? n : undefined;
}

/** The first year of a CSL / Crossref date (`{ 'date-parts': [[2017, 6]] }`). */
export function cslDateYear(d: unknown): number | undefined {
  const parts = (d as { 'date-parts'?: unknown } | null)?.['date-parts'];
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return undefined;
  return yearOf(parts[0][0]);
}

/** A string, or the first string of an array (CSL and Crossref use both). */
export function firstString(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (Array.isArray(v)) {
    for (const x of v) if (typeof x === 'string' && x.trim()) return x.trim();
  }
  return undefined;
}

/** Every non-empty string of a string or string array. */
export function allStrings(v: unknown): string[] {
  if (typeof v === 'string') return v.trim() ? [v.trim()] : [];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
  return [];
}

interface CslName {
  family?: unknown;
  given?: unknown;
  literal?: unknown;
  name?: unknown;
  suffix?: unknown;
  'non-dropping-particle'?: unknown;
  'dropping-particle'?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * A CSL-JSON (or Crossref) name. Crossref writes an organization as `name`,
 * CSL as `literal`; both become a corporate name.
 */
export function cslName(n: unknown): WorkName | null {
  if (!n || typeof n !== 'object') return null;
  const c = n as CslName;
  const literal = str(c.literal) || str(c.name);
  const family = str(c.family);
  if (!family) return literal ? { literal } : null;
  const particle = [str(c['dropping-particle']), str(c['non-dropping-particle'])].filter(Boolean).join(' ');
  const out: WorkName = { family };
  const given = str(c.given);
  if (given) out.given = given;
  if (particle) out.particle = particle;
  const suffix = str(c.suffix);
  if (suffix) out.suffix = suffix;
  return out;
}

export function cslNames(v: unknown): WorkName[] {
  return Array.isArray(v) ? v.map(cslName).filter((x): x is WorkName => x !== null) : [];
}

/**
 * A WorkRecord from a CSL-JSON item, the format DOI content negotiation
 * returns for every registration agency that supports it.
 */
export function recordFromCsl(registry: RegistryName, item: Record<string, unknown>): WorkRecord | null {
  const title = firstString(item['title']);
  if (!title) return null;
  const years = ['issued', 'published-print', 'published-online', 'original-date']
    .map((k) => cslDateYear(item[k]))
    .filter((y): y is number => y !== undefined);
  const type = str(item['type']);
  const rec: WorkRecord = {
    registry,
    title,
    authors: cslNames(item['author']),
    editors: cslNames(item['editor']),
    years: [...new Set(years)],
    venues: [...allStrings(item['container-title']), ...allStrings(item['container-title-short'])],
    journalArticle: type === 'article-journal' || type === 'journal-article',
    raw: item,
  };
  const doi = firstString(item['DOI']);
  if (doi) rec.doi = doi;
  const subtitle = firstString(item['subtitle']);
  if (subtitle) rec.subtitle = subtitle;
  const alt = allStrings(item['original-title']);
  if (alt.length > 0) rec.altTitles = alt;
  return rec;
}
