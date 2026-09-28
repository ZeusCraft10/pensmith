// tests/source-input.test.ts — SRC-13 (D-19-20): `add` classifies its
// argument once, before any request, into DOI / arXiv / PMID / ISBN / URL /
// local PDF / folder — or a one-line usage reason.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifySourceInput, identifierFromHtml, lookupIdentifier } from '../bin/lib/source-input.js';

const BYO_PDF = fileURLToPath(new URL('./fixtures/byo/attention-arxiv-layout.pdf', import.meta.url));

function kindOf(s: string, cwd?: string): unknown {
  const r = classifySourceInput(s, cwd);
  switch (r.kind) {
    case 'doi':
      return ['doi', r.doi];
    case 'arxiv':
      return ['arxiv', r.arxiv];
    case 'pmid':
      return ['pmid', r.pmid];
    case 'isbn':
      return ['isbn', r.isbn];
    case 'url':
      return ['url', r.url];
    case 'pdf':
    case 'dir':
      return [r.kind, r.path];
    case 'unknown':
      return ['unknown', r.reason];
  }
}

test('SRC-13: DOIs in every spelling', () => {
  for (const v of ['10.1038/nature14539', 'DOI: 10.1038/nature14539', 'doi:10.1038/nature14539', 'https://doi.org/10.1038%2Fnature14539', 'https://dx.doi.org/10.1038/NATURE14539']) {
    assert.deepEqual(kindOf(v), ['doi', '10.1038/nature14539'], v);
  }
});

test('SRC-13: arXiv ids and arXiv URLs are identifiers (the version is dropped; the PDF is never downloaded)', () => {
  for (const v of [
    'arXiv:1706.03762',
    'arxiv:1706.03762v7',
    '1706.03762',
    '1706.03762.',
    'https://arxiv.org/abs/1706.03762',
    'https://arxiv.org/abs/1706.03762v5',
    'https://arxiv.org/pdf/1706.03762',
    'https://arxiv.org/pdf/1706.03762v7.pdf',
    'https://export.arxiv.org/abs/1706.03762',
    '10.48550/arXiv.1706.03762',
    'https://doi.org/10.48550/arXiv.1706.03762',
  ]) {
    assert.deepEqual(kindOf(v), ['arxiv', '1706.03762'], v);
  }
  assert.deepEqual(kindOf('hep-th/9901001v2'), ['arxiv', 'hep-th/9901001']);
  assert.deepEqual(kindOf('math.GT/0309136'), ['arxiv', 'math.GT/0309136']);
  assert.deepEqual(kindOf('HEP-TH/9901001'), ['arxiv', 'hep-th/9901001']);
  assert.deepEqual(kindOf('https://arxiv.org/abs/hep-th/9901001'), ['arxiv', 'hep-th/9901001']);
});

test('SRC-13: PMIDs need their prefix; PubMed URLs are PMIDs; bare digits are ambiguous (usage reason)', () => {
  for (const v of ['PMID:31978945', 'pmid:31978945', 'PMID: 31978945', 'https://pubmed.ncbi.nlm.nih.gov/31978945/']) {
    assert.deepEqual(kindOf(v), ['pmid', '31978945'], v);
  }
  const bare = kindOf('31978945') as [string, string];
  assert.equal(bare[0], 'unknown');
  assert.match(bare[1], /PMID:31978945/);
});

test('SRC-13: ISBNs — isbn: prefix or a checksum-valid bare ISBN-10/13; a bad check digit is refused', () => {
  assert.deepEqual(kindOf('isbn:9780226458083'), ['isbn', '9780226458083']);
  assert.deepEqual(kindOf('ISBN 978-0-226-45808-3'), ['isbn', '9780226458083']);
  assert.deepEqual(kindOf('978-0-226-45808-3'), ['isbn', '9780226458083']);
  assert.deepEqual(kindOf('0226458083'), ['isbn', '9780226458083']);
  const bad = kindOf('isbn:9780226458084') as [string, string];
  assert.equal(bad[0], 'unknown');
  assert.match(bad[1], /check digit/);
});

test('SRC-13: other URLs are URLs; local PDFs and folders are local; a missing .pdf is "no such file"', () => {
  assert.deepEqual(kindOf('https://example.org/paper.pdf'), ['url', 'https://example.org/paper.pdf']);
  assert.deepEqual(kindOf(BYO_PDF), ['pdf', BYO_PDF]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-srcin-'));
  assert.deepEqual(kindOf(dir), ['dir', dir]);
  fs.copyFileSync(BYO_PDF, path.join(dir, 'no-extension'));
  assert.deepEqual(kindOf('no-extension', dir), ['pdf', path.join(dir, 'no-extension')], 'the %PDF- magic makes a file a PDF');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');
  assert.deepEqual(kindOf('notes.txt', dir), ['unknown', 'notes.txt is not a PDF']);
  assert.deepEqual(kindOf('missing.pdf', dir), ['unknown', 'missing.pdf: no such file']);
  const garbage = kindOf('not an identifier') as [string, string];
  assert.equal(garbage[0], 'unknown');
  assert.match(garbage[1], /is not a DOI, arXiv id, PMID:<id>, isbn:<ISBN>, http\(s\) URL, local PDF or folder/);
});

test('SRC-13: an HTML landing page is identified only by its own <meta> tags', () => {
  const page = (metas: string, body = ''): string => `<html><head>${metas}</head><body>${body}</body></html>`;
  assert.deepEqual(identifierFromHtml(page('<meta name="citation_doi" content="10.1038/nature14539">')), {
    kind: 'doi', raw: '10.1038/nature14539', doi: '10.1038/nature14539',
  });
  assert.deepEqual(identifierFromHtml(page(`<meta content='doi:10.1038/NPHYS1170' name='DC.Identifier'/>`)), {
    kind: 'doi', raw: 'doi:10.1038/NPHYS1170', doi: '10.1038/nphys1170',
  });
  assert.deepEqual(identifierFromHtml(page('<meta name="citation_arxiv_id" content="1706.03762">')), { kind: 'arxiv', raw: '1706.03762', arxiv: '1706.03762' });
  assert.deepEqual(identifierFromHtml(page('<meta name="citation_pmid" content="31978945">')), { kind: 'pmid', raw: '31978945', pmid: '31978945' });
  assert.equal(identifierFromHtml(page('', '<p>We cite doi:10.1038/nature14539 here.</p>')), null, 'a DOI in the body is not the page\'s own');
});

test('SRC-13: an ISBN lookup goes to the registry\'s books adapter; without one the lookup FAILS (never "not found")', async () => {
  const { sources } = await import('../bin/lib/sources/index.js');
  const { isOfflineEgressError } = await import('../bin/lib/http.js');
  let r;
  try {
    r = await lookupIdentifier({ kind: 'isbn', raw: 'isbn:9780226458083', isbn: '9780226458083' });
  } catch (e) {
    // With the books adapter present, an offline run without a recorded
    // answer is the typed offline refusal — a mode, not an outcome.
    assert.ok('books' in sources && isOfflineEgressError(e), String(e));
    return;
  }
  if ('books' in sources) {
    assert.notEqual(r.kind, 'not-found');
  } else {
    assert.equal(r.kind, 'failed');
    assert.match((r as { reason: string }).reason, /no book \(ISBN\) lookup is available/);
  }
});
