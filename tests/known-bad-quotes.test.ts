// tests/known-bad-quotes.test.ts — the known-bad quotation corpus, through the
// real `pensmith verify`.
//
// This used to call a test-only twin of Pass 3 against "snippets" shorter than
// the quotations, so a quote could only fail to fit and every case was
// NOT_FOUND whatever the matcher did. Now a section quotes the corpus from a
// real paper whose open-access PDF is recorded (arXiv:2109.00022, CC BY 4.0),
// and the real CLI finds the PDF through OpenAlex, extracts its text and
// checks each quotation: the faithful quotations are OK and every fabricated
// or distorted one is NOT_FOUND, which blocks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VISIBLE_ISLANDS_BIB, verifySection } from './lib/verify-cli.js';

interface Corpus {
  source: { citekey: string; doi: string };
  known_good: string[];
  known_bad: Array<{ quote: string; distortion: string }>;
}

const CORPUS = JSON.parse(readFileSync(new URL('./fixtures/known-bad-quotes.json', import.meta.url), 'utf8')) as Corpus;

/** A quotation in running text, cited to the paper with a page locator. */
const quoted = (q: string, key: string): string => (/^[“"]/.test(q) ? `As the authors put it, ${q} [@${key}, p. 2].` : `As the authors put it, "${q}" [@${key}, p. 2].`);

test('the corpus has ten known-bad quotations, at least five with characters a PDF copy leaves', () => {
  assert.equal(CORPUS.known_bad.length, 10);
  const marks = /[\uFB01\u00AD\u201C\u201D\u2014]/;
  assert.ok(CORPUS.known_bad.filter((b) => marks.test(b.quote)).length >= 5);
});

test('pensmith verify finds the faithful quotations and gives every known-bad one NOT_FOUND', () => {
  const key = CORPUS.source.citekey;
  const draft = `# Introduction\n\n${[...CORPUS.known_good, ...CORPUS.known_bad.map((b) => b.quote)].map((q) => quoted(q, key)).join('\n\n')}\n`;
  const v = verifySection(draft, VISIBLE_ISLANDS_BIB(key));
  assert.equal(v.status, 2, `fabricated quotations block\n${v.out}`);
  assert.equal(v.record.status, 'failed');
  assert.deepEqual(v.record.citations.map((c) => [c.citekey, c.verdict]), [[key, 'OK']], 'the work itself is real');

  // The row recording quotation `q`: among `rows`, the one whose quote, quotation marks aside, `q` starts with.
  const rowFor = (q: string, rows = v.record.quotes, prefix = 40) =>
    rows.find((r) => q.replace(/[“”"]/g, '').startsWith(r.quote.replace(/[“”"…]/g, '').trim().slice(0, prefix)));
  for (const q of CORPUS.known_good) {
    const row = rowFor(q);
    assert.equal(row?.verdict, 'OK', `faithful: ${q}\n${JSON.stringify(row)}`);
  }
  const notFound = v.record.quotes.filter((r) => r.verdict === 'NOT_FOUND');
  for (const b of CORPUS.known_bad) {
    const row = rowFor(b.quote, notFound, 30);
    assert.ok(row, `${b.distortion}: ${b.quote}\n${JSON.stringify(v.record.quotes, null, 1)}`);
    assert.match(row.reason, /arxiv\.org\/pdf\/2109\.00022/, 'checked against the recorded open-access PDF');
  }
  assert.equal(notFound.length, 10, '10/10 known-bad quotations are NOT_FOUND');
  assert.equal(v.record.quotes.filter((r) => r.verdict === 'OK').length, CORPUS.known_good.length);
});
