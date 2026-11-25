// tests/lib/bib-fixture.ts — a CITATIONS.bib that holds every work a fixture
// draft cites. compile refuses a manuscript citing a work the bibliography
// does not hold, so a "verified" fixture needs one.
//
// Not a test file (the runner collects only *.test.ts).

import { citedKeys, findCitations } from '../../bin/lib/citation-grammar.js';

/** BibTeX with one article for each key cited in `drafts`. */
export function bibForDrafts(...drafts: string[]): string {
  return citedKeys(findCitations(drafts.join('\n\n')))
    .map((key, i) =>
      `@article{${key},\n  title = {Fixture Work ${i + 1}},\n  author = {Author, Fixture},\n  year = {2020},\n  doi = {10.1000/fixture.${i + 1}}\n}\n`,
    )
    .join('\n');
}
