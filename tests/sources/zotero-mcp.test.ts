// tests/sources/zotero-mcp.test.ts — the Zotero item normalizer (SRC-16, D-19-24).
//
// bin/lib/sources/zotero-mcp.ts validates a Zotero item (a full Web / local
// API item, or the `data` object a Zotero MCP server hands back) and maps it
// onto the library candidate shape. The injected-client seam
// (setZoteroClientForTest) is gone: Tier 2 pulls through the real client
// (tests/zotero-client.test.ts, MockAgent) and Tier 1 submits items to
// paper_ingest_zotero_items (tests/mcp-zotero-ingest.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateZoteroItem,
  normalizeZoteroItem,
  toSourceCandidate,
  parseExtra,
  type ZoteroItem,
} from '../../bin/lib/sources/zotero-mcp.js';
import * as normalizer from '../../bin/lib/sources/zotero-mcp.js';
import { SourceCandidateSchema } from '../../bin/lib/schemas/source-candidate.js';

/** A real Zotero Web API item shape (group 100, "Geography and Music"). */
const JOURNAL_ITEM = {
  key: 'XMT4Q4FT',
  version: 1,
  library: { type: 'group', id: 100, name: 'Geography and Music' },
  meta: { creatorSummary: 'Wood et al.', parsedDate: '2007', numChildren: 0 },
  data: {
    key: 'XMT4Q4FT',
    version: 1,
    itemType: 'journalArticle',
    title: 'The art of doing (geographies of) music',
    creators: [
      { creatorType: 'author', firstName: 'Nichola', lastName: 'Wood' },
      { creatorType: 'author', firstName: 'Michelle', lastName: 'Duffy' },
      { creatorType: 'author', firstName: 'Susan J', lastName: 'Smith' },
    ],
    abstractNote: 'Like every other work of art, music has become the stuff of social research.',
    publicationTitle: 'Environment and Planning D: Society and Space',
    publisher: '',
    date: '2007',
    volume: '25',
    issue: '5',
    pages: '867 – 889',
    DOI: '10.1068/d416t',
    citationKey: '',
    url: 'http://www.envplan.com/abstract.cgi?id=d416t',
    extra: '',
    collections: [],
    tags: [],
  },
};

function valid(raw: unknown): ZoteroItem {
  const v = validateZoteroItem(raw);
  assert.ok(v.ok, v.ok ? '' : v.error);
  return v.item;
}

test('SRC-16: the setZoteroClientForTest seam is gone (no injectable fake client in shipped code)', () => {
  assert.equal('setZoteroClientForTest' in normalizer, false);
  assert.equal('search' in normalizer, false, 'the normalizer is not an adapter; the registry key `zotero` is sources/zotero.ts');
});

test('SRC-16: a full Web API journal article normalizes to a zotero candidate with every bibliographic field', () => {
  const item = valid(JOURNAL_ITEM);
  assert.equal(item.library, 'groups/100', 'the item names its own library');
  const c = normalizeZoteroItem(item, 'users/1');
  assert.ok(c);
  assert.equal(c.source, 'zotero');
  assert.equal(c.id, 'zotero:groups/100/XMT4Q4FT');
  assert.deepEqual(c.zotero, { library: 'groups/100', key: 'XMT4Q4FT' });
  assert.equal(c.title, 'The art of doing (geographies of) music');
  assert.deepEqual(c.authors, ['Wood, Nichola', 'Duffy, Michelle', 'Smith, Susan J']);
  assert.deepEqual(c.editors, []);
  assert.equal(c.year, 2007);
  assert.equal(c.doi, '10.1068/d416t');
  assert.equal(c.venue, 'Environment and Planning D: Society and Space');
  assert.equal(c.volume, '25');
  assert.equal(c.issue, '5');
  assert.equal(c.pages, '867 – 889');
  assert.equal(c.type, 'article-journal');
  assert.equal(c.publisher, undefined, 'an empty publisher is not a publisher');
  assert.match(c.abstract ?? '', /^Like every other work of art/);
  assert.equal(c.citekey, 'wood2007');
  const sc = toSourceCandidate(c);
  assert.ok(sc, 'a valid SourceCandidate');
  assert.equal(SourceCandidateSchema.safeParse(sc).success, true);
  assert.equal(sc.source, 'zotero');
});

test('SRC-16: a bare data object (as a Zotero MCP server returns it) takes the fallback library', () => {
  const c = normalizeZoteroItem(valid(JOURNAL_ITEM.data), 'local');
  assert.deepEqual(c?.zotero, { library: 'local', key: 'XMT4Q4FT' });
  const users0 = normalizeZoteroItem(valid({ ...JOURNAL_ITEM, library: { type: 'user', id: 0 } }), 'local');
  assert.equal(users0?.zotero.library, 'local', 'users/0 is the local API’s own library');
});

test('SRC-16: creators — single-field names are braced literals, editors are kept, an editor-only work uses its editors as authors', () => {
  const report = normalizeZoteroItem(
    valid({ key: 'AAAAAAA2', itemType: 'report', title: 'An integrated encyclopedia of DNA elements', creators: [{ creatorType: 'author', name: 'ENCODE Project Consortium' }, { creatorType: 'translator', firstName: 'X', lastName: 'Y' }], institution: 'NHGRI', date: 'September 2012' }),
    'users/7',
  );
  assert.deepEqual(report?.authors, ['{ENCODE Project Consortium}']);
  assert.equal(report?.type, 'report');
  assert.equal(report?.publisher, 'NHGRI', "a report's institution is its publisher");
  assert.equal(report?.year, 2012);
  const edited = normalizeZoteroItem(
    valid({ key: 'AAAAAAA3', itemType: 'book', title: 'The Oxford Handbook of Things', creators: [{ creatorType: 'editor', firstName: 'Ada', lastName: 'Lovelace' }, { creatorType: 'seriesEditor', lastName: 'Babbage' }], publisher: 'Oxford University Press', ISBN: '978-0-226-45808-3 0226458083', date: '1962' }),
    'users/7',
  );
  assert.deepEqual(edited?.authors, ['Lovelace, Ada', 'Babbage']);
  assert.deepEqual(edited?.editors, ['Lovelace, Ada', 'Babbage']);
  assert.equal(edited?.type, 'book');
  assert.equal(edited?.isbn, '9780226458083', 'the first valid ISBN, as ISBN-13');
});

test('SRC-16: extra lines (LF and CRLF) give arXiv / PMID / PMCID / DOI and a Better BibTeX citation key; archiveID gives a preprint its arXiv id', () => {
  for (const nl of ['\n', '\r\n']) {
    const c = normalizeZoteroItem(
      valid({ key: 'AAAAAAA4', itemType: 'journalArticle', title: 'Some study', creators: [{ creatorType: 'author', firstName: 'Q', lastName: 'Rao' }], extra: ['Citation Key: rao2020study', 'PMID: 31978945', 'PMCID: PMC7092803', 'DOI: 10.1056/NEJMoa2001017', 'arXiv: 2001.00001v2'].join(nl), date: '2020-02-20' }),
      'users/7',
    );
    assert.equal(c?.citekey, 'rao2020study');
    assert.equal(c?.pmid, '31978945');
    assert.equal(c?.pmcid, 'PMC7092803');
    assert.equal(c?.doi, '10.1056/nejmoa2001017');
    assert.equal(c?.arxiv, '2001.00001');
  }
  const preprint = normalizeZoteroItem(
    valid({ key: 'AAAAAAA5', itemType: 'preprint', title: 'Attention Is All You Need', creators: [{ creatorType: 'author', firstName: 'Ashish', lastName: 'Vaswani' }], archiveID: 'arXiv:1706.03762', repository: 'arXiv', date: '2017-06-12', citationKey: 'vaswani2017attention' }),
    'users/7',
  );
  assert.equal(preprint?.arxiv, '1706.03762');
  assert.equal(preprint?.type, 'preprint');
  assert.equal(preprint?.venue, 'arXiv');
  assert.equal(preprint?.citekey, 'vaswani2017attention', "Zotero 7's citationKey field is kept");
  assert.deepEqual(parseExtra('A: 1\r\nB: two\nA: 3'), new Map([['a', '1'], ['b', 'two']]));
});

test('SRC-16: notes, attachments, annotations and title-less items are not works', () => {
  for (const itemType of ['note', 'attachment', 'annotation']) {
    assert.equal(normalizeZoteroItem(valid({ key: 'AAAAAAA6', itemType, title: 'x' }), 'local'), null, itemType);
  }
  assert.equal(normalizeZoteroItem(valid({ key: 'AAAAAAA7', itemType: 'book', title: '   ' }), 'local'), null);
});

test('SRC-16: an item without creators is a library candidate but not a SourceCandidate (search needs an author)', () => {
  const c = normalizeZoteroItem(valid({ key: 'AAAAAAA8', itemType: 'webpage', title: 'A web page', websiteTitle: 'Example' }), 'local');
  assert.ok(c);
  assert.deepEqual(c.authors, []);
  assert.equal(c.type, 'webpage');
  assert.equal(c.venue, 'Example');
  assert.equal(toSourceCandidate(c), null);
});

test('SRC-16: validation names the malformed field with its path', () => {
  const bad = validateZoteroItem({ key: 'ABCD2345', data: { key: 'short', itemType: 'book', title: 'T' } }, 'items[2]');
  assert.equal(bad.ok, false);
  assert.match(bad.ok ? '' : bad.error, /^items\[2\]\.data\.key: a Zotero item key is 8 characters/);
  const noType = validateZoteroItem({ key: 'ABCD2345', title: 'T' }, 'items[0]');
  assert.match(noType.ok ? '' : noType.error, /^items\[0\]\.itemType: Required/);
  const creators = validateZoteroItem({ key: 'ABCD2345', itemType: 'book', title: 'T', creators: [{ lastName: 5 }] }, 'items[1]');
  assert.match(creators.ok ? '' : creators.error, /^items\[1\]\.creators\[0\]\.lastName: Expected string, received number/);
  const notObject = validateZoteroItem('a string', 'items[3]');
  assert.match(notObject.ok ? '' : notObject.error, /^items\[3\]: expected a Zotero item object, got string/);
});
