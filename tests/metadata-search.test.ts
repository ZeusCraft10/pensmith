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
import { arxivTitleQuery, bibliographicQuery, metadataSearch, pubmedTitleQuery } from '../bin/lib/verify/metadata-search.js';
import { titleSearchUrl as dataciteTitleSearchUrl } from '../bin/lib/sources/datacite.js';
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

test('D-20-11: a later re-post of the same title does not pass — the 2025 copies of "Attention Is All You Need" at Crossref are not the 2017 paper; the arXiv search finds the 2017 preprint (recorded answers)', async () => {
  const found = await metadataSearch({ title: 'Attention is All You Need', authors: ['Vaswani, Ashish'], year: 2017 });
  // Crossref's closest records are the re-posts (the year rule refuses them); arXiv holds the paper itself.
  assert.equal(found.kind, 'match', JSON.stringify(found));
  assert.equal(found.kind === 'match' ? found.identifier : '', 'arXiv:1706.03762');
  assert.equal(found.kind === 'match' ? found.registrar : '', 'arXiv');
  assert.equal(found.kind === 'match' ? found.candidate.year : 0, 2017);
  // The exact requests the recordings hold.
  assert.equal(arxivTitleQuery({ title: 'Attention is All You Need', authors: ['Vaswani, Ashish'], year: 2017 }), 'ti:"Attention is All You Need" AND au:Vaswani');
  assert.equal(arxivTitleQuery({ title: 'A Work That Was Never Published', authors: ['Nobody, Ann'], year: 2017 }), 'ti:"A Work That Was Never Published" AND au:Nobody');
  assert.equal(pubmedTitleQuery({ title: 'A Work That Was Never Published', authors: ['Nobody, Ann'], year: 2017 }), '"A Work That Was Never Published"[ti] AND Nobody[au]');
  assert.equal(dataciteTitleSearchUrl('A Work That Was Never Published'), 'https://api.datacite.org/dois?query=titles.title%3A%22A%20Work%20That%20Was%20Never%20Published%22&page%5Bsize%5D=5');
});

/** The registrars past Crossref answer "nothing" (arXiv, PubMed, DataCite, OpenAlex — less those `skip` names), each call counted. */
function answerEmpty(agent: Agent, counts: Record<string, number> = {}, skip: readonly string[] = []): Record<string, number> {
  const bump = (k: string): void => {
    counts[k] = (counts[k] ?? 0) + 1;
  };
  agent.get('https://export.arxiv.org').intercept({ path: (p: string) => p.startsWith('/api/query?'), method: 'GET' }).reply(() => {
    bump('arxiv');
    return { statusCode: 200, data: '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>', responseOptions: { headers: { 'content-type': 'application/atom+xml' } } };
  }).persist();
  agent.get('https://eutils.ncbi.nlm.nih.gov').intercept({ path: (p: string) => p.startsWith('/entrez/eutils/esearch.fcgi?'), method: 'GET' }).reply(() => {
    bump('pubmed');
    return { statusCode: 200, data: JSON.stringify({ esearchresult: { count: '0', idlist: [] } }), responseOptions: JSON_HEADERS };
  }).persist();
  agent.get('https://api.datacite.org').intercept({ path: (p: string) => p.startsWith('/dois?'), method: 'GET' }).reply(() => {
    bump('datacite');
    return { statusCode: 200, data: JSON.stringify({ data: [], meta: { total: 0 } }), responseOptions: JSON_HEADERS };
  }).persist();
  if (!skip.includes('openalex')) {
    agent.get('https://api.openalex.org').intercept({ path: (p: string) => p.startsWith('/works?'), method: 'GET' }).reply(() => {
      bump('openalex');
      return { statusCode: 200, data: JSON.stringify({ results: [] }), responseOptions: JSON_HEADERS };
    }).persist();
  }
  return counts;
}

const JSON_HEADERS = { headers: { 'content-type': 'application/json' } } as const;
type Agent = Parameters<Parameters<typeof liveLane>[0]>[0];

test('VRFY-12 (MockAgent): a metadata search that got no answer is UNVERIFIABLE-NETWORK — never UNRESOLVABLE', async () => {
  await liveLane(async (agent) => {
    const title = `An Unanswered Search ${uniq('ms')}`;
    agent
      .get('https://api.crossref.org')
      .intercept({ path: (p: string) => p.startsWith('/works?query.bibliographic='), method: 'GET' })
      .reply(503, 'Service Unavailable', { headers: { 'content-type': 'text/plain' } })
      .persist();
    // Every other registrar answered: nothing — one search without an answer is enough for no-answer.
    answerEmpty(agent);
    const found = await metadataSearch({ title, authors: ['Doe, Jane'], year: 2020 });
    assert.equal(found.kind, 'no-answer');
    const [r] = await runPass1('A claim [@doe2020].\n', bibWith(`@article{doe2020,\n  author = {Doe, Jane},\n  title = {${title}},\n  year = {2020},\n}\n`));
    assert.equal(r?.verdict, 'UNVERIFIABLE-NETWORK', r?.reason);
    // (The first search opened the host's circuit breaker: the second is refused before any request.)
    assert.match(r?.reason ?? '', /the metadata search did not answer \(Crossref: (?:HTTP 503 after retries|skipped after 3 consecutive HTTP 503 responses)\); arXiv: no record; PubMed: no record; DataCite: no record; OpenAlex: no record — re-run verify once the lookup answers$/);
  });
});

test('VRFY-12: offline with no recorded search, the entry is UNVERIFIABLE-NETWORK (retry online), never FABRICATED', async () => {
  const [r] = await runPass1('A claim [@ghost2020].\n', bibWith('@article{ghost2020,\n  author = {Ghost, Casper},\n  title = {An Unrecorded Search Title},\n  year = {2020},\n}\n'));
  assert.equal(r?.verdict, 'UNVERIFIABLE-NETWORK');
  assert.match(r?.reason ?? '', /offline: no recorded fixture for the Crossref search/);
});

test('VRFY-12 (review round 2, MockAgent): a work no registrar holds a DOI for (JMLR) is found at OpenAlex — OK naming its OpenAlex id; every search answering "nothing" is UNRESOLVABLE naming each', async () => {
  await liveLane(async (agent) => {
    const tag = uniq('jmlr');
    const title = `Visualizing Data using t-SNE ${tag}`;
    agent.get('https://api.crossref.org').intercept({ path: (p: string) => p.startsWith('/works?query.bibliographic='), method: 'GET' }).reply(200, JSON.stringify({ status: 'ok', 'message-type': 'work-list', message: { items: [] } }), JSON_HEADERS).persist();
    const counts: Record<string, number> = {};
    // arXiv, PubMed and DataCite have nothing; OpenAlex has the JMLR paper (no DOI).
    const bump = (k: string): void => { counts[k] = (counts[k] ?? 0) + 1; };
    agent.get('https://export.arxiv.org').intercept({ path: (p: string) => p.startsWith('/api/query?'), method: 'GET' }).reply(() => { bump('arxiv'); return { statusCode: 200, data: '<feed xmlns="http://www.w3.org/2005/Atom"></feed>', responseOptions: { headers: { 'content-type': 'application/atom+xml' } } }; }).persist();
    agent.get('https://eutils.ncbi.nlm.nih.gov').intercept({ path: (p: string) => p.startsWith('/entrez/eutils/esearch.fcgi?'), method: 'GET' }).reply(() => { bump('pubmed'); return { statusCode: 200, data: JSON.stringify({ esearchresult: { idlist: [] } }), responseOptions: JSON_HEADERS }; }).persist();
    agent.get('https://api.datacite.org').intercept({ path: (p: string) => p.startsWith('/dois?'), method: 'GET' }).reply(() => { bump('datacite'); return { statusCode: 200, data: JSON.stringify({ data: [] }), responseOptions: JSON_HEADERS }; }).persist();
    agent.get('https://api.openalex.org').intercept({ path: (p: string) => p.startsWith('/works?'), method: 'GET' }).reply(() => {
      bump('openalex');
      return {
        statusCode: 200,
        data: JSON.stringify({ results: [{ id: 'https://openalex.org/W2187089797', title, publication_year: 2008, authorships: [{ author: { display_name: 'Laurens van der Maaten' } }, { author: { display_name: 'Geoffrey Hinton' } }], type: 'article' }] }),
        responseOptions: JSON_HEADERS,
      };
    }).persist();
    const found = await metadataSearch({ title, authors: ['van der Maaten, Laurens'], year: 2008 });
    assert.equal(found.kind, 'match', JSON.stringify(found));
    assert.equal(found.kind === 'match' ? found.identifier : '', 'OpenAlex W2187089797');
    assert.equal(found.kind === 'match' ? found.registrar : '', 'OpenAlex');
    assert.deepEqual(counts, { arxiv: 1, pubmed: 1, datacite: 1, openalex: 1 }, 'each registrar asked once, OpenAlex last');
    const [r] = await runPass1('A claim [@maaten2008].\n', bibWith(`@article{maaten2008,\n  author = {van der Maaten, Laurens and Hinton, Geoffrey},\n  title = {${title}},\n  journal = {Journal of Machine Learning Research},\n  year = {2008},\n}\n`));
    assert.equal(r?.verdict, 'OK', r?.reason);
    assert.match(r?.reason ?? '', /^no identifier in the entry; the metadata search matched OpenAlex W2187089797 \(OpenAlex\); D-11 AND-gate passed \(year 2008\)/);

    // A work nobody holds: every search answered "nothing" — UNRESOLVABLE, naming each and the remedies.
    const none = await metadataSearch({ title: `A Work That Was Never Published ${tag}`, authors: ['Nobody, Ann'], year: 2017 });
    assert.equal(none.kind, 'no-match', JSON.stringify(none));
    assert.match(none.kind === 'no-match' ? none.reason : '', /Crossref: no record; arXiv: no record; PubMed: no record; DataCite: no record; OpenAlex: none of its 1 closest record\(s\) matches strictly/);
  });
});

test('VRFY-12 (review round 2, MockAgent): an OpenAlex match with a DOI is confirmed at Crossref — Crossref\'s record decides; one naming another work matches nothing', async () => {
  await liveLane(async (agent) => {
    const tag = uniq('oa-doi');
    const title = `Dropout A Simple Way to Prevent Neural Networks from Overfitting ${tag}`;
    const doi = `10.5555/${tag}`;
    const crossref = agent.get('https://api.crossref.org');
    crossref.intercept({ path: (p: string) => p.startsWith('/works?query.bibliographic='), method: 'GET' }).reply(200, JSON.stringify({ status: 'ok', 'message-type': 'work-list', message: { items: [] } }), JSON_HEADERS).persist();
    let crossrefRecordTitle = title;
    crossref.intercept({ path: (p: string) => decodeURIComponent(p) === `/works/${doi}`, method: 'GET' }).reply(() => ({
      statusCode: 200,
      data: JSON.stringify({ status: 'ok', 'message-type': 'work', message: { DOI: doi, title: [crossrefRecordTitle], author: [{ family: 'Srivastava', given: 'Nitish' }], issued: { 'date-parts': [[2014]] }, type: 'journal-article' } }),
      responseOptions: JSON_HEADERS,
    })).persist();
    crossref.intercept({ path: /^\/works\?filter=updates/, method: 'GET' }).reply(200, JSON.stringify({ status: 'ok', 'message-type': 'work-list', message: { items: [] } }), JSON_HEADERS).persist();
    answerEmpty(agent, {}, ['openalex']);
    agent.get('https://api.openalex.org').intercept({ path: (p: string) => p.startsWith('/works?'), method: 'GET' }).reply(200, JSON.stringify({
      results: [{ id: 'https://openalex.org/W1', doi: `https://doi.org/${doi}`, title, publication_year: 2014, authorships: [{ author: { display_name: 'Nitish Srivastava' } }] }],
    }), JSON_HEADERS).persist();
    const claimed = { title, authors: ['Srivastava, Nitish'], year: 2014 };
    const found = await metadataSearch(claimed);
    assert.equal(found.kind, 'match', JSON.stringify(found));
    assert.equal(found.kind === 'match' ? found.identifier : '', `DOI ${doi}`);
    assert.equal(found.kind === 'match' ? found.registrar : '', 'OpenAlex, confirmed at Crossref');
    assert.equal(found.kind === 'match' ? found.candidate.source : '', 'crossref');
    // Crossref's record of that DOI is another work: OpenAlex's pairing is not trusted.
    crossrefRecordTitle = 'A Completely Different Paper About Something Else';
    const other = await metadataSearch({ ...claimed, title: `${title} again` }, { refresh: true });
    assert.notEqual(other.kind, 'match');
  });
});

test('VRFY-12 (review round 2): a book cited as "Title: Subtitle" is asked at Open Library by its main title, and its answer (title and subtitle) matches whole', async () => {
  await liveLane(async (agent) => {
    const tag = uniq('book');
    const main = `Discipline and Punish ${tag}`;
    const asked: string[] = [];
    agent.get('https://openlibrary.org').intercept({ path: (p: string) => p.startsWith('/search.json?'), method: 'GET' }).reply((opts) => {
      asked.push(decodeURIComponent(String(opts.path)));
      return {
        statusCode: 200,
        data: JSON.stringify({ numFound: 1, docs: [{ key: '/works/OL26841W', title: main, subtitle: 'The Birth of the Prison', author_name: ['Michel Foucault'], first_publish_year: 1975, editions: { docs: [{ key: '/books/OL1M', title: main, subtitle: 'The Birth of the Prison', publish_date: ['1995'], isbn: ['9780679752554'] }] } }] }),
        responseOptions: JSON_HEADERS,
      };
    }).persist();
    const found = await metadataSearch({ title: `${main}: The Birth of the Prison`, authors: ['Foucault, Michel'], year: 1995 }, { isBook: true });
    assert.ok(asked.length >= 1 && asked.every((q) => q.includes(`title=${main}&`)), `asked by the main title: ${asked.join(' | ')}`);
    assert.equal(found.kind, 'match', JSON.stringify(found));
    assert.equal(found.kind === 'match' ? found.registrar : '', 'Open Library');
  });
});
