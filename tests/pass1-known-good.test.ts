// tests/pass1-known-good.test.ts — real works cited correctly must all be OK.
//
// tests/fixtures/pass1-known-good.bib writes recorded works (Crossref,
// DataCite, doi.org, arXiv, PubMed and Open Library answers) the many ways a
// bibliography does: braced and unbraced particles, initials, given-first
// names, "and others", consortium authors, journal abbreviations, LaTeX
// italics against registry <i> and MathML, a missing subtitle, a year one
// off, uppercase and doi.org DOIs, labelled PMIDs and ISBNs. A matcher change
// that accuses one of them of being MIS-CITED or FABRICATED fails here. Its
// twin for invented and wrong citations is tests/known-bad-citations.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPass1 } from '../bin/lib/verify/pass1.js';

const CORPUS = fileURLToPath(new URL('./fixtures/pass1-known-good.bib', import.meta.url));

test('Pass 1: every entry of the known-good corpus is OK', async () => {
  const keys = [...readFileSync(CORPUS, 'utf8').matchAll(/^@\w+\{([^,]+),/gm)].map((m) => m[1]!);
  assert.ok(keys.length >= 12, `the corpus lists ${keys.length} entries`);
  const root = mkdtempSync(join(tmpdir(), 'pensmith-known-good-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const bibPath = join(root, '.paper', 'CITATIONS.bib');
  copyFileSync(CORPUS, bibPath);
  const draft = `# S\n\n${keys.map((k) => `A claim [@${k}].`).join(' ')}\n`;
  const results = await runPass1(draft, bibPath);
  assert.deepEqual(results.map((r) => r.citekey), keys);
  const wrong = results.filter((r) => r.verdict !== 'OK').map((r) => `${r.citekey}: ${r.verdict} — ${r.reason}`);
  assert.deepEqual(wrong, []);
});
