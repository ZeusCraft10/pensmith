// bin/lib/library-catalog.ts — the library as a short list for a prompt.
//
// The outline author and the section planner choose sources by citekey, so
// they are shown what LIBRARY.json holds: each work's citekey, title, year and
// first author, as JSON. It is data from registries and the user's own files,
// so its template tokens are escaped before it goes into a prompt.

import { escapeTemplateTokens } from './intake-parse.js';
import { readLibrarySync } from './library.js';

export interface CatalogEntry {
  citekey: string;
  title: string;
  year?: number;
  first_author?: string;
}

/** The works in the library of the paper at `root`, in library order. */
export function libraryCatalog(root: string): CatalogEntry[] {
  return (readLibrarySync(root)?.entries ?? []).map((e) => {
    const year = (e.issued as { 'date-parts'?: unknown[][] } | undefined)?.['date-parts']?.[0]?.[0];
    const first = e.author?.[0] as { family?: string; literal?: string } | undefined;
    const author = first?.family ?? first?.literal;
    return {
      citekey: e.id,
      title: e.title,
      ...(typeof year === 'number' ? { year } : {}),
      ...(author ? { first_author: author } : {}),
    };
  });
}

/** libraryCatalog as JSON, ready to interpolate into a prompt. */
export function libraryCatalogJson(root: string): string {
  return escapeTemplateTokens(JSON.stringify(libraryCatalog(root), null, 2));
}
