// bin/lib/migrations/library/v1_to_v2.ts — LIBRARY.json v1 → v2 (BRDTH-01 /
// D-17-43).
//
// Two shapes carried `$schemaVersion: 1` in the field:
//   1. The strict v1 foundation-slice entry `{id, doi?, arxiv?, pmid?, pmcid?,
//      title?, addedAt}` (written by the old addEntry).
//   2. The research-written SourceCandidate entry `{source, id, title, authors,
//      year?, doi?, abstract?, oa_pdf_url?, retracted, retraction_details?,
//      last_verified, citekey, raw}` — WITHOUT the `addedAt` v1 required, which
//      is why every real library failed validation (T1-9).
// Both become v2 entries through the same shaping the live writer uses
// (./shape.ts). The adapter payload (`raw`) is dropped; a SourceCandidate's
// `source` becomes the provenance tag `research:<source>`; a missing `addedAt`
// becomes the entry's `last_verified` (when research fetched it) or the
// migration time. Duplicate citekeys (never produced by the writers, but a
// hand-edited file could carry them) are suffixed deterministically so the
// v2 uniqueness invariant holds; nothing is dropped. Idempotent on v2 input.

import { candidateToEntry, sanitizeCitekey, type LibraryCandidate } from './shape.js';
import { suffixForCollision } from '../../bibtex-write.js';

function isoOrNull(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v))
    ? new Date(v).toISOString()
    : null;
}

export function migrate(input: unknown, now: string = new Date().toISOString()): unknown {
  if (typeof input !== 'object' || input === null) return input;
  const src = input as Record<string, unknown>;
  if (src['$schemaVersion'] === 2) return JSON.parse(JSON.stringify(src)) as unknown;
  const rawEntries = Array.isArray(src['entries']) ? (src['entries'] as unknown[]) : [];

  const used = new Set<string>();
  const entries = rawEntries.map((raw) => {
    const e = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const isCandidate = typeof e['citekey'] === 'string' || typeof e['source'] === 'string';
    const authors = Array.isArray(e['authors']) ? (e['authors'] as unknown[]).filter((a): a is string => typeof a === 'string') : [];
    const year = typeof e['year'] === 'number' ? e['year'] : undefined;
    const candidate: LibraryCandidate = {
      citekey: sanitizeCitekey(isCandidate ? e['citekey'] : e['id'], { authors, year }),
      ...(typeof e['source'] === 'string' ? { source: e['source'] } : {}),
      ...(isCandidate && typeof e['id'] === 'string' ? { id: e['id'] } : {}),
      doi: typeof e['doi'] === 'string' ? e['doi'] : null,
      arxiv: typeof e['arxiv'] === 'string' ? e['arxiv'] : null,
      pmid: typeof e['pmid'] === 'string' ? e['pmid'] : null,
      pmcid: typeof e['pmcid'] === 'string' ? e['pmcid'] : null,
      isbn: typeof e['isbn'] === 'string' ? e['isbn'] : null,
      title: typeof e['title'] === 'string' ? e['title'] : null,
      authors,
      year: year ?? null,
      abstract: typeof e['abstract'] === 'string' ? e['abstract'] : null,
      oa_pdf_url: typeof e['oa_pdf_url'] === 'string' ? e['oa_pdf_url'] : null,
      retracted: e['retracted'] === true,
      retraction_details: typeof e['retraction_details'] === 'string' ? e['retraction_details'] : null,
      last_verified: typeof e['last_verified'] === 'string' ? e['last_verified'] : null,
      raw: e['raw'],
    };
    const provenance = typeof e['source'] === 'string' ? [`research:${e['source']}`] : ['v1'];
    const addedAt = isoOrNull(e['addedAt']) ?? isoOrNull(e['last_verified']) ?? now;
    const entry = candidateToEntry(candidate, provenance, addedAt);
    let key = entry.citekey;
    for (let n = 1; used.has(key); n += 1) key = entry.citekey + suffixForCollision(n);
    used.add(key);
    return { ...entry, citekey: key };
  });

  return { $schemaVersion: 2, entries };
}

export default migrate;
