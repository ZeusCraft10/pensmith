// bin/lib/sources/openlibrary.ts — Open Library, for books cited by ISBN.
//
// Endpoint: GET https://openlibrary.org/api/books?bibkeys=ISBN:<isbn>&format=json&jscmd=data
//
// There is no public ISBN registry, and Open Library holds only part of the
// world's books. So a book it does not list is not_found with
// `authoritative: false`: Pass 1 reports that it could not confirm the book,
// never that the book was invented. An ISBN whose check digit is wrong never
// gets this far (bin/lib/doi.ts normalizeIsbn).

import { askRegistry, yearOf, type Lookup, type WorkRecord } from './work-record.js';

const BASE = 'https://openlibrary.org';

interface OpenLibraryBook {
  title?: string;
  subtitle?: string;
  authors?: Array<{ name?: string }>;
  publish_date?: string;
}

/** Ask Open Library for the book with `isbn` (digits and X only). */
export async function lookupIsbn(isbn: string): Promise<Lookup> {
  const key = `ISBN:${isbn}`;
  // `isbn` is digits and X only, so the key needs no escaping.
  const url = `${BASE}/api/books?bibkeys=${key}&format=json&jscmd=data`;
  return askRegistry('Open Library', url, { source: 'openlibrary' }, (res) => {
    if (res.status !== 200) return null;
    const body = JSON.parse(res.body) as Record<string, OpenLibraryBook> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const book = body[key];
    const title = book?.title?.trim();
    if (!book || !title) return { kind: 'not_found', registry: 'Open Library', authoritative: false };
    // publish_date is free text: "2009", "March 2009", "2009-07-31".
    const year = yearOf(/\d{4}/.exec(book.publish_date ?? '')?.[0]);
    const record: WorkRecord = {
      registry: 'Open Library',
      title,
      authors: (book.authors ?? [])
        .map((a) => a.name?.trim())
        .filter((n): n is string => Boolean(n))
        .map((text) => ({ text })),
      years: year !== undefined ? [year] : [],
      venues: [],
      journalArticle: false,
      raw: book,
    };
    if (book.subtitle?.trim()) record.subtitle = book.subtitle.trim();
    return { kind: 'found', registry: 'Open Library', record };
  });
}
