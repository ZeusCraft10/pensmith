// tests/pass1-known-good.test.ts — real works cited correctly must all be OK.
//
// tests/fixtures/pass1-known-good.bib writes recorded works (Crossref,
// DataCite, doi.org, arXiv, PubMed and Open Library answers) the many ways a
// bibliography does: braced and unbraced particles, initials, given-first
// names, "and others", consortium authors, journal abbreviations, LaTeX
// italics against registry <i> and MathML, a missing subtitle, a year one
// off, British spelling, uppercase and doi.org DOIs, labelled PMIDs and
// ISBNs. A matcher change that accuses one of them of being MIS-CITED or
// FABRICATED fails here. Its twin for invented and wrong citations is
// tests/known-bad-citations.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runPass1 } from '../bin/lib/verify/pass1.js';
import { bibFile } from './lib/bib-fixture.js';
import { citationVerdicts, verifySection } from './lib/verify-cli.js';

const CORPUS = fileURLToPath(new URL('./fixtures/pass1-known-good.bib', import.meta.url));

test('Pass 1: every entry of the known-good corpus is OK', async () => {
  const corpus = readFileSync(CORPUS, 'utf8');
  const keys = [...corpus.matchAll(/^@\w+\{([^,]+),/gm)].map((m) => m[1]!);
  assert.ok(keys.length >= 13, `the corpus lists ${keys.length} entries`);
  const bibPath = bibFile(corpus);
  const draft = `# S\n\n${keys.map((k) => `A claim [@${k}].`).join(' ')}\n`;
  const results = await runPass1(draft, bibPath);
  assert.deepEqual(results.map((r) => r.citekey), keys);
  const wrong = results.filter((r) => r.verdict !== 'OK').map((r) => `${r.citekey}: ${r.verdict} — ${r.reason}`);
  assert.deepEqual(wrong, []);
  // OpenAlex answered the retraction cross-check for every work it holds
  // (recorded: tests/fixtures/cassettes/openalex/known-good-retraction.json).
  const unchecked = results.filter((r) => /OpenAlex could not be asked/.test(r.reason)).map((r) => `${r.citekey}: ${r.reason}`);
  assert.deepEqual(unchecked, []);
});

test('pensmith verify: a section citing the whole known-good corpus is verified', () => {
  const corpus = readFileSync(CORPUS, 'utf8');
  const keys = [...corpus.matchAll(/^@\w+\{([^,]+),/gm)].map((m) => m[1]!);
  const v = verifySection(`# Introduction\n\n${keys.map((k) => `One claim here rests on this work [@${k}].`).join('\n')}\n`, corpus);
  assert.equal(v.status, 0, v.out);
  assert.equal(v.record.status, 'verified');
  assert.deepEqual(Object.entries(citationVerdicts(v.record)).filter(([, verdict]) => verdict !== 'OK'), []);
  assert.equal(v.record.citations.length, keys.length);
});
