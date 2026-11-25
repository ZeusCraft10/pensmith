// bin/lib/migrations/library/v1_to_v2.ts — LIBRARY.json v1 → v2.
//
// v1 held research candidates as the adapters returned them: display-string
// authors ("Ashish Vaswani", "Wakefield AJ"), a DOI, and a citekey (an arXiv
// or PubMed candidate's id is its arXiv ID or PMID). v2 holds
// CSL-JSON items (bin/lib/schemas/library.ts). Each v1 entry becomes an item
// under the same citekey, its authors read back into name objects the way
// its adapter writes them. An entry with no title or no citekey (the shape of
// an early placeholder that no command wrote) has nothing to cite and is
// dropped. An older pensmith also wrote LIBRARY.json as a bare array; that is
// read the same way.
//
// Works added by an older `pensmith add` were written to CITATIONS.bib only;
// the library reads them in from the bibliography the first time it writes
// (bin/lib/library.ts), keeping each entry's text as it was.

import { bareArxivId, normalizePmid } from '../../doi.js';
import { itemFromCandidate } from '../../library-item.js';
import type { LibraryItem } from '../../schemas/library.js';
import type { SourceCandidate } from '../../schemas/source-candidate.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** A v1 entry (a research candidate) as an item, or null when it has nothing to cite. */
function migrateEntry(raw: unknown, now: string): LibraryItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const title = str(e['title']);
  const citekey = str(e['citekey']);
  if (!title || !citekey) return null;
  const at = str(e['last_verified']) && ISO.test(String(e['last_verified'])) ? String(e['last_verified']) : now;
  const source = str(e['source']) ?? 'crossref';
  const authors = Array.isArray(e['authors']) ? e['authors'].filter((a): a is string => typeof a === 'string' && a.trim() !== '') : [];
  const year = typeof e['year'] === 'number' && Number.isInteger(e['year']) ? e['year'] : undefined;
  // v1 kept no arXiv ID or PMID, but an arXiv or PubMed candidate's own id is one.
  const id = str(e['id']) ?? citekey;
  const arxiv = source === 'arxiv' ? bareArxivId(/\/abs\/(.+)$/.exec(id)?.[1] ?? id) : null;
  const pmid = source === 'pubmed' ? normalizePmid(id) : null;
  const candidate = {
    source,
    id,
    ...(arxiv ? { arxiv } : {}),
    ...(pmid ? { pmid } : {}),
    title,
    authors,
    ...(year !== undefined ? { year } : {}),
    ...(str(e['doi']) ? { doi: str(e['doi']) } : {}),
    ...(str(e['abstract']) ? { abstract: str(e['abstract']) } : {}),
    ...(str(e['oa_pdf_url']) ? { oa_pdf_url: str(e['oa_pdf_url']) } : {}),
    ...(str(e['retraction_details']) ? { retraction_details: str(e['retraction_details']) } : {}),
    retracted: e['retracted'] === true,
    last_verified: at,
    citekey,
    raw: null,
  } as SourceCandidate;
  return itemFromCandidate(candidate, citekey, at, { provenance: [{ source, id: candidate.id, at }] });
}

/** Migrate a v1 LIBRARY.json value (or a bare array of entries) to v2. */
export function migrate(input: unknown, now: string = new Date().toISOString()): unknown {
  const entries = Array.isArray(input)
    ? input
    : Array.isArray((input as { entries?: unknown } | null)?.entries)
      ? (input as { entries: unknown[] }).entries
      : [];
  const seen = new Set<string>();
  const items: LibraryItem[] = [];
  for (const raw of entries) {
    const item = migrateEntry(raw, now);
    // Research gave every candidate a distinct key; a repeat would make two
    // works answer to one citation, so only the first keeps it.
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  // Only research wrote a v1 library, so research has run.
  return { $schemaVersion: 2, entries: items, bibtex_preamble: [], researched_at: now };
}
