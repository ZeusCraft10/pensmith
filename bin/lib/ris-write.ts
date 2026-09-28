// bin/lib/ris-write.ts — source records -> .paper/CITATIONS.ris serializer
// (CITE-05; D-19 LOCKED citation-js chokepoint, D-07 LOCKED atomic-write
// chokepoint).
//
// BRDTH-01 / D-17-43: .paper/CITATIONS.ris is RENDERED from LIBRARY.json by the
// one library writer (bin/lib/library.ts), in the same critical section as
// CITATIONS.bib. Only library.ts may call renderRis / writeRis (chokepoint row
// `library-writer`).
//
// This module is the RIS sibling of bibtex-write.ts and rides the same two
// chokepoints:
//   1. citation-js — we import { Cite } from './citations.js' (the SOLE module
//      that imports the library directly). NEVER import 'citation-js' here —
//      ESLint no-restricted-imports backstops the chokepoint (RESEARCH Pitfall
//      8). The @citation-js/plugin-ris formatter is already bundled inside
//      citation-js@0.7.22, so no new npm dep is required.
//   2. atomic-write — writeRis calls atomicWriteFile from './atomic-write.js'
//      for the final write; we NEVER call raw fs write/append directly.
//
// The CSL intermediate (toCsl: names parsed by person-name.ts, the CSL type,
// container title, volume, issue, pages, publisher, editors and identifiers —
// SRC-12) and the citekey uniqueness authority (assignUniqueCitekeys) are
// imported from bibtex-write.ts, so a source describes the same work in both
// files and the .ris order matches the .bib order. The RIS text itself comes
// from citation-js's 'ris' formatter with spec:'new' (REQUIRED for
// Mendeley/EndNote interop — RESEARCH Pitfall 4). RIS records carry no citekey
// header; the citekey is the ID tag.
//
// Empty array:
//   - renderRis([]) is '' and writeRis([], target) writes a zero-length file
//     (parity with CITATIONS.bib), so no downstream reader ENOENTs.

import { Cite } from './citations.js';
import { atomicWriteFile } from './atomic-write.js';
import { assignUniqueCitekeys, toCsl, type BibSource, type CslEntry } from './bibtex-write.js';

/**
 * Render sources as RIS2001 text, keyed and sorted exactly like renderBibtex
 * (diff-stable), id-less sources dropped. '' for none.
 */
export function renderRis(sources: BibSource[]): string {
  const survivors: Array<{ source: BibSource; csl: CslEntry }> = [];
  for (const c of sources) {
    const csl = toCsl(c);
    if (csl) survivors.push({ source: c, csl });
  }
  const keyed = assignUniqueCitekeys(survivors.map((s) => s.source));
  const entries = keyed.map((c, i) => {
    const csl = survivors[i]!.csl;
    csl.id = c.citekey;
    return { citekey: c.citekey, csl };
  });
  entries.sort((a, b) => a.citekey.localeCompare(b.citekey));
  if (entries.length === 0) return '';

  // THE SOLE DIVERGENCE from renderBibtex: format 'ris' with spec:'new'
  // (RIS2001 — Pitfall 4) instead of 'bibtex'.
  const cite = new Cite(entries.map((e) => e.csl));
  return (cite as { format: (...args: unknown[]) => string }).format('ris', {
    spec: 'new',
    format: 'text',
  });
}

/**
 * Render `sources` (renderRis) and write them atomically to `targetPath`.
 * Only bin/lib/library.ts calls this in shipped code (chokepoint row
 * `library-writer`).
 *
 * @param sources LIBRARY.json v2 entries (or SourceCandidate[]).
 * @param targetPath Absolute or relative path; parent dir created if missing.
 */
export async function writeRis(sources: BibSource[], targetPath: string): Promise<void> {
  await atomicWriteFile(targetPath, renderRis(sources));
}
