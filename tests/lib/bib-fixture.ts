// tests/lib/bib-fixture.ts — CITATIONS.bib fixtures.
//
// bibForDrafts: a bibliography that holds every work a fixture draft cites.
// compile refuses a manuscript citing a work the bibliography does not hold,
// so a "verified" fixture needs one.
//
// bibFile / pass1Verdict: a bibliography written where Pass 1 reads it, and the
// Pass-1 verdict for its one entry.
//
// Not a test file (the runner collects only *.test.ts).

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { citedKeys, findCitations } from '../../bin/lib/citation-grammar.js';
import { runPass1, type Pass1Result } from '../../bin/lib/verify/pass1.js';

/** BibTeX with one article for each key cited in `drafts`. */
export function bibForDrafts(...drafts: string[]): string {
  return citedKeys(findCitations(drafts.join('\n\n')))
    .map((key, i) =>
      `@article{${key},\n  title = {Fixture Work ${i + 1}},\n  author = {Author, Fixture},\n  year = {2020},\n  doi = {10.1000/fixture.${i + 1}}\n}\n`,
    )
    .join('\n');
}

/** `bib` written as `.paper/CITATIONS.bib` under a fresh temporary root; its path. */
export function bibFile(bib: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-bib-fixture-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const p = join(root, '.paper', 'CITATIONS.bib');
  writeFileSync(p, bib);
  return p;
}

/** The Pass-1 verdict for the first entry of `bib`, cited once in a one-line draft. */
export async function pass1Verdict(bib: string): Promise<Pass1Result> {
  const key = /^@\w+\{([^,]+),/m.exec(bib)![1]!;
  const results = await runPass1(`# S\n\nA claim [@${key}].\n`, bibFile(bib));
  const r = results.find((x) => x.citekey === key);
  assert.ok(r, `no verdict for ${key}`);
  return r;
}
