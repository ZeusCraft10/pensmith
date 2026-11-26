// bin/lib/ris-write.ts — CITATIONS.ris as a view of the library.
//
// The RIS sibling of bibtex-write.ts: one RIS2001 record (the spec Mendeley
// and EndNote read) per library item, in citekey order, each carrying its
// citekey as ID. formatRis in bin/lib/citations.ts does the rendering, so this
// file never imports citation-js itself.

import { byCitekey } from './bibtex-write.js';
import { formatRis } from './citations.js';
import type { Library, LibraryItem } from './schemas/library.js';

/** The CSL-JSON a RIS record is rendered from: the item without the library's own bookkeeping. */
function risCsl(item: LibraryItem): Record<string, unknown> {
  const { custom, ...csl } = item;
  if (custom.retracted) csl['note'] = 'RETRACTED';
  return csl;
}

/** CITATIONS.ris for `library`; '' when it holds nothing. */
export function libraryRis(library: Pick<Library, 'entries'>): string {
  const items = [...library.entries].sort(byCitekey);
  return formatRis(items.map(risCsl));
}
