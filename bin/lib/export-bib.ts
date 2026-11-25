// bin/lib/export-bib.ts — the bibliography files that ship with an export.
//
// The exported CITATIONS.bib and CITATIONS.ris list exactly the works the
// exported paper cites, nothing else. The research-time files hold every
// candidate the search turned up (uncited, pruned, retracted, never checked),
// so copying them would ship works the verifier never vouched for.
//
// Only standard bibliographic fields are kept. Pensmith's own bookkeeping
// (verification timestamps, the RETRACTED note) and free-text fields such as
// notes and abstracts never leave the project.

import { formatBibtex, formatRis, parseBib, parseBibFieldsByCitekey } from './citations.js';

export type CslEntry = Record<string, unknown> & { id: string };

// CSL-JSON variables a reference manager needs to identify and format a work.
const EXPORT_FIELDS: ReadonlySet<string> = new Set([
  'id', 'type', 'title', 'title-short', 'author', 'editor', 'translator', 'container-author',
  'container-title', 'container-title-short', 'collection-title', 'collection-number',
  'publisher', 'publisher-place', 'issued', 'volume', 'issue', 'page', 'number',
  'number-of-pages', 'edition', 'genre', 'event-title', 'event-place', 'language',
  'DOI', 'ISBN', 'ISSN', 'URL', 'PMID', 'PMCID',
]);

// Raw BibTeX fields that identify a work where CSL has no variable: an arXiv
// preprint's eprint and a PubMed article's PMID. citation-js drops them when
// it reads the bibliography, so they are read and written as they are.
const IDENTIFIER_FIELDS: readonly string[] = ['eprint', 'archiveprefix', 'eprinttype', 'primaryclass', 'pmid'];

/** The identifier fields (IDENTIFIER_FIELDS) of each entry of a BibTeX file's text, by citekey. */
export async function readIdentifierFields(bibText: string): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();
  for (const [key, fields] of await parseBibFieldsByCitekey(bibText)) {
    const ids = Object.fromEntries(IDENTIFIER_FIELDS.filter((f) => fields[f]).map((f) => [f, fields[f]!]));
    if (Object.keys(ids).length > 0) out.set(key, ids);
  }
  return out;
}

/** Parse a BibTeX file's text; an empty file has no entries. */
export async function readBibEntries(bibText: string): Promise<CslEntry[]> {
  if (bibText.trim().length === 0) return [];
  const entries = await parseBib(bibText);
  return entries
    .map((e) => ({ ...e, id: String(e['id'] ?? '') }))
    .filter((e) => e.id.length > 0);
}

/** `entry` with only the exportable fields. */
export function exportableEntry(entry: CslEntry): CslEntry {
  const out: CslEntry = { id: entry.id };
  for (const [k, v] of Object.entries(entry)) {
    if (EXPORT_FIELDS.has(k) && v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

/**
 * The exportable entries for `keys`, in key order (so the files diff cleanly).
 * Keys with no entry are returned in `missing`.
 */
export function selectEntries(entries: CslEntry[], keys: readonly string[]): { entries: CslEntry[]; missing: string[] } {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const picked: CslEntry[] = [];
  const missing: string[] = [];
  for (const k of new Set(keys)) {
    const e = byId.get(k);
    if (e) picked.push(exportableEntry(e));
    else missing.push(k);
  }
  picked.sort((a, b) => a.id.localeCompare(b.id));
  return { entries: picked, missing };
}

/**
 * BibTeX for `entries`, each keyed by its citekey, with its identifier fields
 * from `identifiers` (readIdentifierFields). Names and titles in any script
 * are kept.
 */
export function toBibtex(entries: readonly CslEntry[], identifiers: ReadonlyMap<string, Readonly<Record<string, string>>> = new Map()): string {
  return formatBibtex(entries.map((e) => ({ ...e, 'citation-key': e.id })), identifiers);
}

/** RIS for `entries`. Each record carries its citekey (ID) and DOI (DO). */
export function toRis(entries: readonly CslEntry[]): string {
  const ris = formatRis(entries);
  // citation-js leaves DO out of some record types; a reader needs the DOI.
  const doiById = new Map(entries.map((e) => [e.id, typeof e['DOI'] === 'string' ? (e['DOI'] as string) : '']));
  return ris
    .split(/(?<=^ER {2}- ?\r?\n?)/m)
    .map((rec) => {
      const id = /^ID {2}- (.+)$/m.exec(rec)?.[1]?.trim();
      const doi = id ? doiById.get(id) : '';
      if (!doi || /^DO {2}- /m.test(rec)) return rec;
      return rec.replace(/^ER {2}- ?/m, `DO  - ${doi}\nER  - `);
    })
    .join('');
}
