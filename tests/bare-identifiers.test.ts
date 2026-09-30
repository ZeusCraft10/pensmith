// tests/bare-identifiers.test.ts — identifiers written in a draft's prose are
// verified like cited entries (Phase 20, VRFY-10, D-20-14).
//
//   - doi.ts findBareIdentifiers finds `doi:10.…`, doi.org links (any scheme,
//     dx., percent-encoded), bare DOIs, `arXiv:…`, arxiv.org abs / pdf links,
//     `PMID: …` and PubMed links — outside provable code (closed fences and
//     inline code spans), with their line (LF and CRLF alike);
//   - runPass1 writes one row per identifier, keyed `doi:<doi>` / `arXiv:<id>`
//     / `PMID:<id>`: a real one OK naming the record's title, a fabricated one
//     FABRICATED (recorded: Crossref's 404 for 10.9999/x, doi.org: no agency
//     holds 10.9999), and one with no answer UNVERIFIABLE-NETWORK;
//   - an identifier inside a Pandoc citation key is not a bare identifier.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bareIdentifierKey, findBareIdentifiers, provableCodeSpans } from '../bin/lib/doi.js';
import { runPass1 } from '../bin/lib/verify/pass1.js';
import { parseBlockingVerdictRows, renderPass1VerdictRow } from '../bin/lib/verify/verdict-rows.js';

const keys = (md: string): string[] => findBareIdentifiers(md).map(bareIdentifierKey);

test('VRFY-10: every spelling of a DOI, arXiv id and PMID in prose is found, canonical and deduplicated', () => {
  const md = [
    'As doi:10.1038/NATURE14539 shows (and https://doi.org/10.1038/nature14539 again),',
    'see http://dx.doi.org/10.1016/S0140-6736(97)11096-0. Also 10.1056/NEJMoa2001017;',
    'a percent-encoded link https://doi.org/10.1038%2Fnphys1170 and DOI: 10.5281/zenodo.1212303.',
    'The preprint arXiv:1706.03762v5 and https://arxiv.org/abs/1810.04805 and arxiv.org/pdf/hep-th/9901001v2.pdf.',
    'PMID: 31978945, PMID 31535829 and https://pubmed.ncbi.nlm.nih.gov/42706103/ and ncbi.nlm.nih.gov/pubmed/9500320.',
  ].join('\n');
  assert.deepEqual(keys(md), [
    'doi:10.1038/nature14539',
    'doi:10.1016/s0140-6736(97)11096-0',
    'doi:10.1056/nejmoa2001017',
    'doi:10.1038/nphys1170',
    'doi:10.5281/zenodo.1212303',
    'arXiv:1706.03762',
    'arXiv:1810.04805',
    'arXiv:hep-th/9901001',
    'PMID:31978945',
    'PMID:31535829',
    'PMID:42706103',
    'PMID:9500320',
  ]);
  const found = findBareIdentifiers(md);
  assert.equal(found.find((b) => b.id === '10.1016/s0140-6736(97)11096-0')?.line, 2);
  assert.equal(found.find((b) => b.id === '9500320')?.line, 5);
});

test('VRFY-10: line numbers are the same for a CRLF draft', () => {
  const lf = 'Line one.\nSee doi:10.9999/x here.\n\nAnd arXiv:1706.03762.\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.deepEqual(findBareIdentifiers(crlf).map((b) => [bareIdentifierKey(b), b.line]), findBareIdentifiers(lf).map((b) => [bareIdentifierKey(b), b.line]));
  assert.deepEqual(findBareIdentifiers(crlf).map((b) => b.line), [2, 4]);
});

test('VRFY-10: identifiers in provable code are skipped; an unclosed fence is scanned (fail closed)', () => {
  const fenced = ['Prose doi:10.1111/a.', '```', 'doi:10.2222/b', '```', 'Inline `doi:10.3333/c` and ``PMID: 123`` then PMID: 456.'].join('\n');
  assert.deepEqual(keys(fenced), ['doi:10.1111/a', 'PMID:456']);
  assert.deepEqual(keys(fenced.replace(/\n/g, '\r\n')), ['doi:10.1111/a', 'PMID:456'], 'CRLF fences');
  const tilde = ['~~~~', 'arXiv:1706.03762', '~~~~', 'arXiv:1810.04805'].join('\n');
  assert.deepEqual(keys(tilde), ['arXiv:1810.04805']);
  const unclosed = ['```', 'doi:10.4444/d'].join('\n');
  assert.deepEqual(keys(unclosed), ['doi:10.4444/d'], 'an unclosed fence is not provable code');
  assert.deepEqual(provableCodeSpans('no code here'), []);
  // An unclosed backtick is not code either.
  assert.deepEqual(keys('a ` doi:10.5555/e'), ['doi:10.5555/e']);
});

test('VRFY-10: not identifiers — a version number, an email, a year range', () => {
  assert.deepEqual(keys('Version 10.2 of the tool, mail a@b.org, the years 2019-2020, 3.14159 and PMID alone.'), []);
});

function paper(bib: string): { root: string; bibPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-bare-ids-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const bibPath = join(root, '.paper', 'CITATIONS.bib');
  writeFileSync(bibPath, bib);
  return { root, bibPath };
}

test('VRFY-10: a bare doi:10.9999/x is FABRICATED; a bare real DOI, arXiv id and PMID verify OK naming the record', async () => {
  const { root, bibPath } = paper('');
  const draft = [
    '# Section',
    '',
    'The effect was shown earlier (doi:10.9999/x).',
    'Deep networks were reviewed in https://doi.org/10.1038/nature14539, building on arXiv:1706.03762.',
    'The virus was described in PMID: 31978945.',
  ].join('\n');
  const rows = await runPass1(draft, bibPath, { root });
  const byKey = new Map(rows.map((r) => [r.citekey, r]));
  assert.deepEqual([...byKey.keys()], ['doi:10.9999/x', 'doi:10.1038/nature14539', 'arXiv:1706.03762', 'PMID:31978945']);
  const fake = byKey.get('doi:10.9999/x')!;
  assert.equal(fake.verdict, 'FABRICATED');
  assert.match(fake.reason, /^bare identifier in the text \(line 3\): DOI 10\.9999\/x did not resolve via Crossref \(no registration agency holds its prefix 10\.9999\)$/);
  assert.equal(byKey.get('doi:10.1038/nature14539')?.verdict, 'OK');
  assert.match(byKey.get('doi:10.1038/nature14539')?.reason ?? '', /^bare identifier in the text \(line 4\): Crossref has "Deep learning"$/);
  assert.match(byKey.get('arXiv:1706.03762')?.reason ?? '', /arXiv has "Attention Is All You Need"/);
  assert.match(byKey.get('PMID:31978945')?.reason ?? '', /PubMed has "A Novel Coronavirus from Patients with Pneumonia in China, 2019"/);
  // The row round-trips through the verdict-row parser as a blocking row keyed by the identifier.
  const md = rows.map((r) => renderPass1VerdictRow(r.citekey, r.verdict, r.titleJW, r.authorJW, r.reason)).join('\n');
  assert.deepEqual(
    parseBlockingVerdictRows(md).map((r) => ({ citekey: r.citekey, verdict: r.verdict })),
    [{ citekey: 'doi:10.9999/x', verdict: 'FABRICATED' }],
  );
});

test('VRFY-10: a bare identifier with no answer is UNVERIFIABLE-NETWORK — never FABRICATED', async () => {
  const { root, bibPath } = paper('');
  const [r] = await runPass1('See doi:10.5555/pensmith-unrecorded-bare.\n', bibPath, { root });
  assert.equal(r?.citekey, 'doi:10.5555/pensmith-unrecorded-bare');
  assert.equal(r?.verdict, 'UNVERIFIABLE-NETWORK');
});

test('VRFY-10: an identifier inside a Pandoc citation is the citation\'s key, not a bare identifier', async () => {
  const { root, bibPath } = paper('');
  const rows = await runPass1('A claim [@doi:10.9999/x] and narrative @doi:10.9999/y.\n', bibPath, { root });
  assert.deepEqual(rows.map((r) => [r.citekey, r.verdict]), [
    ['doi:10.9999/x', 'FABRICATED'],
    ['doi:10.9999/y', 'FABRICATED'],
  ]);
  assert.ok(rows.every((r) => /citekey not in \.paper\/CITATIONS\.bib/.test(r.reason)), 'checked as keys (not in the bib)');
});
