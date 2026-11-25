// bin/lib/ris-write.ts — CITATIONS.ris as a view of the library.
//
// The RIS sibling of bibtex-write.ts: one RIS2001 record (the spec Mendeley
// and EndNote read) per library item, in citekey order, each carrying its
// citekey as ID. formatRis in bin/lib/citations.ts does the rendering, so this
// file never imports citation-js itself.

import { formatRis } from './citations.js';
import { atomicWriteFile } from './atomic-write.js';
import { assignUniqueCitekeys } from './bibtex-write.js';
import { candidateIdentities, itemFromCandidate } from './library-item.js';
import type { Library, LibraryItem } from './schemas/library.js';
import type { SourceCandidate } from './schemas/source-candidate.js';

/** The CSL-JSON a RIS record is rendered from: the item without the library's own bookkeeping. */
function risCsl(item: LibraryItem): Record<string, unknown> {
  const { custom, ...csl } = item;
  if (custom.retracted) csl['note'] = 'RETRACTED';
  return csl;
}

/** CITATIONS.ris for `library`; '' when it holds nothing. */
export function libraryRis(library: Pick<Library, 'entries'>): string {
  const items = [...library.entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return formatRis(items.map(risCsl));
}

/**
 * Write the RIS for `candidates` to `targetPath`, as writeBibtex writes their
 * BibTeX: each candidate with an identifier, under a unique citekey. No
 * candidates writes an empty file.
 */
export async function writeRis(candidates: SourceCandidate[], targetPath: string): Promise<void> {
  const at = new Date().toISOString();
  const keyed = assignUniqueCitekeys(candidates.filter((c) => candidateIdentities(c).length > 0));
  await atomicWriteFile(targetPath, libraryRis({ entries: keyed.map((c) => itemFromCandidate(c, c.citekey, at)) }));
}
