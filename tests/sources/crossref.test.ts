// tests/sources/crossref.test.ts — Crossref adapter against RECORDED cassettes
// (RSCH-03/04, SRC-04, SRC-05, T-3-13, CI-07) and the three-way lookup contract
// (D-19-05). Offline replay is exact-match only (RUN-03).
//
// The recordings are real (scripts/refresh-cassettes.mjs, D-19-26); the
// assertions name the values Crossref holds for these works.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crossref from '../../bin/lib/sources/crossref.js';
import { SourceCandidateSchema } from '../../bin/lib/schemas/source-candidate.js';
import { RECORDED_QUERY, RECORDED_DOI, RECORDED_CROSSREF_404_DOI, recorded, assertOfflineMiss } from './recorded.js';
import { threeWayContract, liveLane, uniq } from './three-way.js';

interface Item {
  DOI?: string;
  title?: string[];
  author?: Array<{ family?: string; given?: string; name?: string }>;
  editor?: Array<{ family?: string; given?: string; name?: string }>;
  issued?: { 'date-parts'?: number[][] };
}

test('crossref.search() returns exactly the recorded works for the recorded query, with complete records (RSCH-03, SRC-05)', async () => {
  const [entry] = recorded('crossref', 'search-attention-neural-networks');
  assert.match(entry!.path, /select=[^&]*updated-by/, 'the search selects updated-by (D-19-11)');
  const items = (entry!.response as { message: { items: Item[] } }).message.items;
  const expected = items
    .filter((i) => i.DOI && i.title?.[0] && ((i.author ?? []).length > 0 || (i.editor ?? []).length > 0))
    .map((i) => i.DOI);
  assert.ok(expected.length > 0, 'the recording carries usable works');

  const results = await crossref.search(RECORDED_QUERY, { limit: 10 });
  assert.deepEqual(results.map((r) => r.doi), expected);
  for (const r of results) {
    assert.equal(r.source, 'crossref');
    assert.equal(r.id, r.doi);
    assert.match(r.citekey, /^[a-z][a-z0-9_-]*$/);
    assert.ok(r.authors.length > 0 && r.authors.every((a) => a.length > 0));
    assert.equal(r.retracted, false);
    assert.equal(r.retraction_status, 'clear', 'a Crossref record without a retraction notice is decided clear');
    assert.ok(r.type !== undefined, 'every Crossref work has a CSL type');
    assert.ok(SourceCandidateSchema.safeParse(r).success, `${r.doi} validates`);
  }
  assert.ok(results.some((r) => r.venue !== undefined), 'container titles become venues');
});

test('SRC-05: 10.1038/nature14539 — Nature, 521(7553), 436-444, publisher, CSL type, authors', async () => {
  const r = await crossref.lookupById('10.1038/nature14539');
  assert.equal(r.kind, 'found');
  if (r.kind !== 'found') return;
  const c = r.candidate;
  assert.equal(c.title, 'Deep learning');
  assert.deepEqual(c.authors, ['LeCun, Yann', 'Bengio, Yoshua', 'Hinton, Geoffrey']);
  assert.equal(c.year, 2015);
  assert.equal(c.venue, 'Nature');
  assert.equal(c.volume, '521');
  assert.equal(c.issue, '7553');
  assert.equal(c.pages, '436-444');
  assert.equal(c.publisher, 'Springer Science and Business Media LLC');
  assert.equal(c.type, 'article-journal');
  assert.equal(c.retraction_status, 'clear');
  assert.equal(c.citekey, 'lecun2015');
});

test('SRC-05: 10.1038/nature11247 — the ENCODE consortium is ONE corporate author, braced', async () => {
  const c = await crossref.fetchById('10.1038/nature11247');
  assert.ok(c);
  assert.equal(c.title, 'An integrated encyclopedia of DNA elements in the human genome');
  assert.deepEqual(c.authors, ['{The ENCODE Project Consortium}']);
  assert.equal(c.venue, 'Nature');
  assert.equal(c.volume, '489');
  assert.equal(c.issue, '7414');
  assert.equal(c.pages, '57-74');
  assert.equal(c.year, 2012);
});

test('SRC-04: the Wakefield 1998 record carries its Retraction Watch notice → retracted with details', async () => {
  const [entry] = recorded('crossref', 'works-wakefield-1998');
  const msg = (entry!.response as { message: { 'updated-by'?: Array<{ type: string }> } }).message;
  assert.ok((msg['updated-by'] ?? []).some((u) => u.type === 'retraction'), 'the recording carries the notice');
  const c = await crossref.fetchById('10.1016/S0140-6736(97)11096-0');
  assert.ok(c);
  assert.equal(c.retracted, true);
  assert.equal(c.retraction_status, 'retracted');
  assert.equal(c.retraction_details, '2010-02-06: Retraction (notice 10.1016/s0140-6736(10)60175-4; Retraction Watch record 4036)');
  assert.equal(c.venue, 'The Lancet');
  assert.equal(c.authors[0], 'Wakefield, AJ');
  assert.ok(SourceCandidateSchema.safeParse(c).success);
});

test('SRC-05: a particle surname keeps its particle (van der Maaten 2013)', async () => {
  const c = await crossref.fetchById('10.1016/j.foreco.2013.06.030');
  assert.ok(c);
  assert.deepEqual(c.authors, ['van der Maaten, Ernst']);
  assert.equal(c.venue, 'Forest Ecology and Management');
  assert.equal(c.volume, '306');
  assert.equal(c.pages, '135-141');
  assert.equal(c.citekey, 'vandermaaten2013');
});

test('crossref.lookupById() hydrates the recorded work for exactly that DOI (RSCH-04), any DOI spelling', async () => {
  const [entry] = recorded('crossref', 'works-nphys1170');
  const msg = (entry!.response as { message: Item }).message;
  for (const spelling of [RECORDED_DOI, 'https://doi.org/10.1038/NPHYS1170', 'doi:10.1038/nphys1170']) {
    const r = await crossref.fetchById(spelling);
    assert.ok(r, `${spelling} resolves`);
    assert.equal(r.doi?.toLowerCase(), RECORDED_DOI);
    assert.equal(r.title, msg.title?.[0]);
    assert.equal(r.authors[0], `${msg.author?.[0]?.family}, ${msg.author?.[0]?.given}`);
    assert.equal(r.year, msg.issued?.['date-parts']?.[0]?.[0]);
  }
});

test('a DOI Crossref does not know is not-found (a recorded 404) — fetchById null', async () => {
  const [entry] = recorded('crossref', 'works-arxiv-doi-404');
  assert.equal(entry!.status, 404);
  const r = await crossref.lookupById(RECORDED_CROSSREF_404_DOI);
  assert.equal(r.kind, 'not-found');
  assert.equal(await crossref.fetchById(RECORDED_CROSSREF_404_DOI), null);
});

test('SRC-04: a 200 carrying an inner 403 ("not-polite") is a failed lookup — never a record, never not-found', async () => {
  const r = await crossref.lookupById('10.5555/inner-403');
  assert.deepEqual(r, { kind: 'failed', reason: 'response is not a Crossref answer (an error document: an inner statusCode 403)', status: 200 });
  await assert.rejects(() => crossref.fetchById('10.5555/inner-403'), /crossref lookup of 10\.5555\/inner-403 failed: response is not a Crossref answer/);
});

test('SRC-10/SRC-11: fromYear → filter=from-pub-date, doiPrefix → filter=prefix (the nber preference)', async () => {
  const url = new URL(crossref.searchUrl('minimum wage', { limit: 3, fromYear: 2015, doiPrefix: '10.3386' }));
  assert.equal(url.searchParams.get('filter'), 'from-pub-date:2015,prefix:10.3386');
  assert.equal(new URL(crossref.searchUrl('x', { doiPrefix: 'not a prefix' })).searchParams.get('filter'), null);
  // The recorded NBER search: every hit is an NBER working paper.
  const hits = await crossref.search('minimum wage employment', { limit: 3, doiPrefix: '10.3386' });
  assert.ok(hits.length > 0);
  for (const h of hits) {
    assert.ok((h.doi ?? '').startsWith('10.3386/w'), `${h.doi} is an NBER working paper DOI`);
    assert.equal(h.type, 'report');
  }
});

test('D-19-13: Crossref types map to CSL; JATS abstracts are stripped', () => {
  assert.equal(crossref.crossrefCslType('journal-article'), 'article-journal');
  assert.equal(crossref.crossrefCslType('proceedings-article'), 'paper-conference');
  assert.equal(crossref.crossrefCslType('edited-book'), 'book');
  assert.equal(crossref.crossrefCslType('book-chapter'), 'chapter');
  assert.equal(crossref.crossrefCslType('dissertation'), 'thesis');
  assert.equal(crossref.crossrefCslType('posted-content'), 'preprint');
  assert.equal(crossref.crossrefCslType('peer-review'), 'other');
  assert.equal(crossref.crossrefCslType(undefined), undefined);
  assert.equal(
    crossref.stripJats('<jats:title>Abstract</jats:title><jats:p>Deep learning allows &lt;b&gt; models &amp; more.</jats:p>'),
    'Deep learning allows <b> models & more.',
  );
  assert.equal(
    crossref.stripJats('<jats:sec><jats:title>Background</jats:title><jats:p>One.</jats:p></jats:sec>\r\n<jats:sec><jats:title>Methods</jats:title><jats:p>Two.</jats:p></jats:sec>'),
    'Background: One. Methods: Two.',
  );
  assert.equal(crossref.stripJats('   '), undefined);
});

test('D-19-13: names — corporate, suffix, mononym; an editor-only work is attributed to its editors', () => {
  assert.equal(crossref.crossrefPersonName({ name: 'The {ENCODE} Project Consortium' }), '{The ENCODE Project Consortium}');
  assert.equal(crossref.crossrefPersonName({ family: 'King', given: 'Martin Luther', suffix: 'Jr.' }), 'King, Martin Luther, Jr.');
  assert.equal(crossref.crossrefPersonName({ given: 'Plato' }), 'Plato');
  const edited = crossref.crossrefToCandidate({
    DOI: '10.5555/edited',
    title: ['An Edited Volume'],
    editor: [{ family: 'Doe', given: 'Jane' }],
    type: 'edited-book',
    ISBN: ['0-226-45808-3', '978-0-226-45808-3'],
    issued: { 'date-parts': [[2001]] },
  });
  assert.ok(edited);
  assert.deepEqual(edited.authors, ['Doe, Jane']);
  assert.deepEqual(edited.editors, ['Doe, Jane']);
  assert.equal(edited.type, 'book');
  assert.equal(edited.isbn, '9780226458083');
  // Title marked RETRACTED: without a notice is still retracted.
  const marked = crossref.crossrefToCandidate({ DOI: '10.5555/m', title: ['RETRACTED: A Study'], author: [{ family: 'X' }] });
  assert.equal(marked?.retraction_status, 'retracted');
  // Nobody to cite → no candidate.
  assert.equal(crossref.crossrefToCandidate({ DOI: '10.5555/n', title: ['T'] }), null);
});

test('RUN-03: an unrecorded DOI or query is a typed offline miss — never the first search item', async () => {
  await assertOfflineMiss(() => crossref.fetchById('10.9999/not-recorded'), 'fetchById miss');
  await assertOfflineMiss(() => crossref.search('medieval Icelandic sagas', { limit: 10 }), 'search miss');
  // Exact means exact: the recorded query at a different result count is a different request.
  await assertOfflineMiss(() => crossref.search(RECORDED_QUERY, { limit: 7 }), 'limit mismatch');
});

test('SRC-17: a search whose 200 is not a Crossref answer reports failed and returns []', async () => {
  await liveLane(async (agent) => {
    const q = uniq('crossref search invalid');
    agent
      .get('https://api.crossref.org')
      .intercept({ path: (p: string) => p.startsWith('/works?query='), method: 'GET' })
      .reply(200, JSON.stringify({ statusCode: '403', 'message-type': 'not-polite' }), { headers: { 'content-type': 'application/json' } });
    const reasons: string[] = [];
    assert.deepEqual(await crossref.search(q, { limit: 3, onFailure: (r) => reasons.push(r) }), []);
    assert.deepEqual(reasons, ['response is not a Crossref answer (an error document: an inner statusCode 403)']);
  });
});

threeWayContract({
  adapter: 'crossref',
  lookupById: crossref.lookupById,
  fetchById: crossref.fetchById,
  origin: 'https://api.crossref.org',
  idFor: (t) => `10.5555/${t}`,
  pathPrefixFor: (t) => `/works/10.5555/${t}`,
  found: (t) => ({
    body: {
      status: 'ok',
      'message-type': 'work',
      message: {
        DOI: `10.5555/${t}`,
        title: ['A Found Work'],
        author: [{ family: 'Found', given: 'Fay' }],
        issued: { 'date-parts': [[2020]] },
        'container-title': ['Journal of Tests'],
        type: 'journal-article',
      },
    },
  }),
  checkFound: (c, t) => {
    assert.equal(c.doi, `10.5555/${t}`);
    assert.equal(c.venue, 'Journal of Tests');
    assert.equal(c.retraction_status, 'clear');
  },
  invalid: (m) => ({ body: { statusCode: '403', 'message-type': 'not-polite', message: `add a mailto ${m}` } }),
  offlineMissId: '10.9999/three-way-offline-miss',
});
