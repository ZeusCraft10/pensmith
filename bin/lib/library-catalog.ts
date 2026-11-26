// bin/lib/library-catalog.ts — the library as a short list for a prompt.
//
// The outline author and the section planner choose sources by citekey, so
// they are shown what LIBRARY.json holds: each work's citekey, title, year and
// first author, as JSON. It is data from registries and the user's own files,
// so its template tokens are escaped before it goes into a prompt.

import { escapeTemplateTokens } from './intake-parse.js';
import type { Library } from './schemas/library.js';

export interface CatalogEntry {
  citekey: string;
  title: string;
  year?: number;
  first_author?: string;
}

/** The works in `library` (as readLibrarySync read it), in library order. */
export function libraryCatalog(library: Library | null): CatalogEntry[] {
  return (library?.entries ?? []).map((e) => {
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
export function libraryCatalogJson(library: Library | null): string {
  return escapeTemplateTokens(JSON.stringify(libraryCatalog(library), null, 2));
}
