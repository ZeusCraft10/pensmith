// tests/metadata-search.test.ts — Pass 1's metadata search for an entry with no
// identifier (Phase 20, VRFY-12, D-20-11): verify/metadata-search.ts and the
// runPass1 rows it produces.
//
//   - a strict match (title ≥ 0.95, first author ≥ 0.85, year ±1) → OK naming
//     the matched identifier (recorded: Crossref query.bibliographic for
//     "Deep learning" LeCun 2015 → 10.1038/nature14539);
//   - a book: the books registries' title search first, then Crossref;
//   - nothing matches strictly → UNRESOLVABLE (blocking) — including a later
//     re-post of the same title (a 2025 copy of Vaswani et al. 2017: the year
//     rule keeps a wrong work from passing);
//   - a search that got no answer → UNVERIFIABLE-NETWORK, never UNRESOLVABLE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bibliographicQuery, metadataSearch } from '../bin/lib/verify/metadata-search.js';
import { runPass1 } from '../bin/lib/verify/pass1.js';
import { bibliographicSearchUrl } from '../bin/lib/sources/crossref.js';
import { titleSearchUrl } from '../bin/lib/sources/books.js';
import { liveLane, uniq } from './sources/three-way.js';

function bibWith(entry: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-metadata-search-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const p = join(root, '.paper', 'CITATIONS.bib');
  writeFileSync(p, entry);
  return p;
}

test('the query is the title, the first author\'s family name and the year — the exact recorded request', () => {
  const q = bibliographicQuery({ title: 'Deep learning', authors: ['LeCun, Yann'], year: 2015 });
  assert.equal(q, 'Deep learning LeCun 2015');
  assert.equal(bibliographicSearchUrl(q), 'https://api.crossref.org/works?query.bibliographic=Deep%20learning%20LeCun%202015&rows=5&select=DOI%2Ctitle%2Cauthor%2Ceditor%2Cissued%2Capproved%2Cposted%2Cabstract%2Ccontainer-title%2Ctype%2Cvolume%2Cissue%2Cpage%2Cpublisher%2CISBN%2Cupdated-by%2Csubtitle');
  assert.equal(bibliographicQuery({ title: 'An integrated encyclopedia', authors: ['{The ENCODE Project Consortium}'], year: 2012 }), 'An integrated encyclopedia The ENCODE Project Consortium 2012');
  assert.equal(bibliographicQuery({ title: 'X', authors: [], editors: ['Navab, Nassir'], year: null }), 'X Navab');
  assert.match(titleSearchUrl('The Structure of Scientific Revolutions', 'Kuhn'), /^https:\/\/openlibrary\.org\/search\.json\?title=The%20Structure%20of%20Scientific%20Revolutions&author=Kuhn&fields=/);
});

test('VRFY-12: an identifier-less entry of a real work is OK, naming the matched DOI (recorded Crossref answer)', async () => {
  const found = await metadataSearch({ title: 'Deep learning', authors: ['LeCun, Yann'], year: 2015 });
  assert.equal(found.kind, 'match');
  assert.equal(found.kind === 'match' ? found.identifier : '', 'DOI 10.1038/nature14539');
  const [r] = await runPass1('A claim [@lecun2015].\n', bibWith('@article{lecun2015,\n  author = {LeCun, Yann and Bengio, Yoshua},\n  title = {Deep learning},\n  year = {2015},\n}\n'));
  assert.equal(r?.verdict, 'OK', r?.reason);
  assert.match(r?.reason ?? '', /^no identifier in the entry; the metadata search matched DOI 10\.1038\/nature14539 \(Crossref\); D-11 AND-gate passed \(year 2015\)$/);
  assert.ok(typeof r?.checkedAt === 'string');
});

test('VRFY-12: a book with no ISBN is searched at the books registries, then Crossref — OK naming the match', async () => {
  const [r] = await runPass1(
    'A claim [@kuhn1996].\n',
    bibWith('@book{kuhn1996,\n  author = {Kuhn, Thomas S.},\n  title = {The Structure of Scientific Revolutions},\n  year = {1996},\n  publisher = {University of Chicago Press},\n}\n'),
  );
  // Open Library lists the work with first-edition years (no strict year match); Crossref has the 1996 edition.
  assert.equal(r?.verdict, 'OK', r?.reason);
  assert.match(r?.reason ?? '', /the metadata search matched DOI 10\.7208\/chicago\/9780226458106\.001\.0001 \(Crossref\)/);
});

test('VRFY-12: an entry matching nothing is UNRESOLVABLE (blocking), naming the fix', async () => {
  const none = await metadataSearch({ title: 'A Work That Was Never Published', authors: ['Nobody, Ann'], year: 2017 });
  assert.equal(none.kind, 'no-match');
  const [r] = await runPass1('A claim [@nobody2017].\n', bibWith('@article{nobody2017,\n  author = {Nobody, Ann},\n  title = {A Work That Was Never Published},\n  year = {2017},\n}\n'));
  assert.equal(r?.verdict, 'UNRESOLVABLE');
  assert.match(r?.reason ?? '', /no registrar record matches its title, first author and year .* — add the work's identifier \(pensmith add/);
});

test('D-20-11: a later re-post of the same title does not pass — the 2025 copies of "Attention Is All You Need" are not the 2017 paper', async () => {
  const found = await metadataSearch({ title: 'Attention is All You Need', authors: ['Vaswani, Ashish'], year: 2017 });
  assert.equal(found.kind, 'no-match', JSON.stringify(found));
});

test('VRFY-12 (MockAgent): a metadata search that got no answer is UNVERIFIABLE-NETWORK — never UNRESOLVABLE', async () => {
  await liveLane(async (agent) => {
    const title = `An Unanswered Search ${uniq('ms')}`;
    agent
      .get('https://api.crossref.org')
      .intercept({ path: (p: string) => p.startsWith('/works?query.bibliographic='), method: 'GET' })
      .reply(503, 'Service Unavailable', { headers: { 'content-type': 'text/plain' } })
      .persist();
    const found = await metadataSearch({ title, authors: ['Doe, Jane'], year: 2020 });
    assert.equal(found.kind, 'no-answer');
    const [r] = await runPass1('A claim [@doe2020].\n', bibWith(`@article{doe2020,\n  author = {Doe, Jane},\n  title = {${title}},\n  year = {2020},\n}\n`));
    assert.equal(r?.verdict, 'UNVERIFIABLE-NETWORK', r?.reason);
    // (The first search opened the host's circuit breaker: the second is refused before any request.)
    assert.match(r?.reason ?? '', /the metadata search did not answer \(Crossref: (?:HTTP 503 after retries|skipped after 3 consecutive HTTP 503 responses)\).* — re-run verify once the lookup answers$/);
  });
});

test('VRFY-12: offline with no recorded search, the entry is UNVERIFIABLE-NETWORK (retry online), never FABRICATED', async () => {
  const [r] = await runPass1('A claim [@ghost2020].\n', bibWith('@article{ghost2020,\n  author = {Ghost, Casper},\n  title = {An Unrecorded Search Title},\n  year = {2020},\n}\n'));
  assert.equal(r?.verdict, 'UNVERIFIABLE-NETWORK');
  assert.match(r?.reason ?? '', /offline: no recorded fixture for the Crossref search/);
});
