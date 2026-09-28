// tests/pdf-identify.test.ts — SRC-13 / SRC-15 (D-19-20): a PDF is identified
// from its metadata identifiers, then identifiers on its first pages (the
// arXiv margin stamp, a footer DOI), then its title + first author — with a
// hit accepted only above the Pass-1 thresholds. A wrong work is never
// returned; only an identifier or the title ever leaves the machine.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPdf, type PdfExtraction } from '../bin/lib/pdf-text.js';
import {
  identifyPdf,
  layoutTitleAndAuthors,
  localPdfMetadata,
  metadataIdentifiers,
  matchScores,
  namesFromAuthorLine,
  TITLE_JW_THRESHOLD,
  AUTHOR_JW_THRESHOLD,
  type IdentifyDeps,
} from '../bin/lib/pdf-identify.js';
import { TITLE_JW_THRESHOLD as PASS1_TITLE, AUTHOR_JW_THRESHOLD as PASS1_AUTHOR } from '../bin/lib/fuzzy.js';
import { lookupFound, lookupNotFound, lookupFailed, type LookupResult } from '../bin/lib/sources/lookup.js';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';
import { _resetBucketsForTest } from '../bin/lib/http.js';
import { installMockAgent } from './helpers/local-servers/mock-agent.js';

const BYO = fileURLToPath(new URL('./fixtures/byo/', import.meta.url));
const load = async (name: string): Promise<PdfExtraction> => extractPdf(fs.readFileSync(path.join(BYO, name)));

function cand(over: Partial<SourceCandidate> & Pick<SourceCandidate, 'title' | 'authors'>): SourceCandidate {
  return {
    source: 'crossref',
    id: over.doi ?? 'x',
    retracted: false,
    citekey: 'x2000',
    last_verified: '2026-01-01T00:00:00.000Z',
    raw: {},
    ...over,
  } as SourceCandidate;
}

const VASWANI = cand({ source: 'arxiv', id: 'http://arxiv.org/abs/1706.03762v7', title: 'Attention Is All You Need', authors: ['Ashish Vaswani', 'Noam Shazeer'], year: 2017 });
// The wrong works the old `add` hydrated from the attention paper's licence line (UX-19).
const WRONG_HITS = [
  cand({ doi: '10.1007/978-3-031-84300-6_13', title: 'Is Attention All You Need?', authors: ['Mineault, Patrick'], year: 2025 }),
  cand({ doi: '10.5555/oohora.2023', title: 'Attention is not all you need', authors: ['Oohora, K.'], year: 2023 }),
  cand({ doi: '10.5555/engel.2009', title: 'Provided proper attribution is provided', authors: ['Engel, R.'], year: 2009 }),
];

interface Calls {
  doi: string[];
  arxiv: string[];
  title: string[];
}

function deps(over: Partial<{ doi: (d: string) => LookupResult; arxiv: (a: string) => LookupResult; title: (t: string) => SourceCandidate[] }>): { deps: IdentifyDeps; calls: Calls } {
  const calls: Calls = { doi: [], arxiv: [], title: [] };
  return {
    calls,
    deps: {
      lookupDoi: async (d) => {
        calls.doi.push(d);
        return over.doi ? over.doi(d) : lookupNotFound('HTTP 404');
      },
      lookupArxiv: async (a) => {
        calls.arxiv.push(a);
        return over.arxiv ? over.arxiv(a) : lookupNotFound('empty feed');
      },
      searchTitle: async (t) => {
        calls.title.push(t);
        return { candidates: over.title ? over.title(t) : [], failures: [] };
      },
    },
  };
}

test('SRC-13: the identification thresholds are the Pass-1 thresholds', () => {
  assert.equal(TITLE_JW_THRESHOLD, PASS1_TITLE);
  assert.equal(AUTHOR_JW_THRESHOLD, PASS1_AUTHOR);
});

test('SRC-13: the layout heuristic skips a 2-line permission notice and finds the title on line 3 and its authors', async () => {
  const ex = await load('attention-title-only.pdf');
  const lines = (ex.pages[0] ?? '').split('\n');
  assert.match(lines[0]!, /^Provided proper attribution is provided, Google hereby grants permission/, 'fixture: notice on line 1');
  assert.equal(lines[2], 'Attention Is All You Need', 'fixture: title on line 3');
  const got = layoutTitleAndAuthors(ex.pages[0]!);
  assert.equal(got.title, 'Attention Is All You Need');
  assert.deepEqual(got.authors.slice(0, 2), ['Ashish Vaswani', 'Noam Shazeer']);
});

test('SRC-13: the heuristic skips arXiv stamps, affiliations, e-mail lines, running heads and article-type labels (CRLF too)', () => {
  const page = [
    'arXiv:2101.00001v1 [cs.LG] 1 Jan 2021',
    'Journal of Things, Vol. 3, No. 2, pp. 1-10',
    'RESEARCH ARTICLE',
    'Copyright © 2021 The Authors',
    'A Study of Wrapped Titles in Scholarly',
    'Documents',
    'Jane Q. Doe1, John Smith2 and Maria de la Cruz3',
    '1 Department of Physics, University of Nowhere',
    'jane@example.org',
    'Abstract',
    'Some body text.',
  ].join('\r\n');
  const got = layoutTitleAndAuthors(page);
  assert.equal(got.title, 'A Study of Wrapped Titles in Scholarly Documents');
  assert.deepEqual(got.authors, ['Jane Q. Doe', 'John Smith', 'Maria de la Cruz']);
  assert.deepEqual(namesFromAuthorLine('Ashish Vaswani*    Noam Shazeer*'), ['Ashish Vaswani', 'Noam Shazeer']);
  assert.deepEqual(layoutTitleAndAuthors('Abstract\nThe title never follows the abstract heading.'), { title: null, authors: [] });
});

test('SRC-13: embedded metadata identifiers (Info Subject / a custom doi key) and the metadata title', async () => {
  const ex = await load('metadata-doi.pdf');
  assert.deepEqual(metadataIdentifiers(ex), { doi: '10.1038/nature14539', arxiv: null });
  const local = localPdfMetadata(ex);
  assert.equal(local.title, 'Deep learning');
  assert.equal(local.titleSource, 'metadata');
  assert.deepEqual(local.authors, ['Yann LeCun', 'Yoshua Bengio', 'Geoffrey Hinton']);
  // a DataCite arXiv DOI in the metadata is the arXiv record
  assert.deepEqual(metadataIdentifiers({ info: { Subject: 'doi:10.48550/arXiv.1706.03762' }, xmp: null }), { doi: null, arxiv: '1706.03762' });
  // XMP identifiers
  assert.deepEqual(metadataIdentifiers({ info: {}, xmp: { 'prism:doi': '10.1038/NPHYS1170' } }), { doi: '10.1038/nphys1170', arxiv: null });
});

test('SRC-13: the arXiv-layout PDF is identified by the arXiv stamp on its first page — one lookup, no title search', async () => {
  const ex = await load('attention-arxiv-layout.pdf');
  const { deps: d, calls } = deps({ arxiv: (a) => (a === '1706.03762' ? lookupFound(VASWANI) : lookupNotFound('none')), title: () => WRONG_HITS });
  const r = await identifyPdf(ex, d);
  assert.equal(r.kind, 'identified');
  assert.equal(r.kind === 'identified' && r.via, 'text-arxiv-stamp');
  assert.equal(r.kind === 'identified' && r.candidate.title, 'Attention Is All You Need');
  assert.deepEqual(calls, { doi: [], arxiv: ['1706.03762'], title: [] });
});

test('SRC-13: without identifiers the title + first author decide; the UX-19 wrong works are never accepted', async () => {
  const ex = await load('attention-title-only.pdf');
  const wrongOnly = await identifyPdf(ex, deps({ title: () => WRONG_HITS }).deps);
  assert.equal(wrongOnly.kind, 'unidentified', 'mineault2025 / oohora2023 / engel2009 are refused');
  const { deps: d, calls } = deps({ title: () => [...WRONG_HITS, VASWANI] });
  const right = await identifyPdf(ex, d);
  assert.equal(right.kind, 'identified');
  assert.equal(right.kind === 'identified' && right.candidate, VASWANI);
  assert.equal(right.kind === 'identified' && right.via, 'title-search');
  assert.deepEqual(calls.title, ['Attention Is All You Need'], 'only the title is searched');
  // the right title with the wrong first author is not confident either
  const imposter = cand({ title: 'Attention Is All You Need', authors: ['Nobody, Ann'] });
  assert.equal((await identifyPdf(ex, deps({ title: () => [imposter] }).deps)).kind, 'unidentified');
  const s = matchScores(imposter, localPdfMetadata(ex));
  assert.ok(s.titleJW >= TITLE_JW_THRESHOLD && s.authorJW < AUTHOR_JW_THRESHOLD);
});

test('SRC-13: a DOI in the footer identifies the PDF; a DOI in running text that names another work is rejected', async () => {
  const ex = await load('doi-footer.pdf');
  const measured = cand({ doi: '10.1038/nphys1170', title: 'Measured measurement', authors: ['Aspelmeyer, Markus'], year: 2009 });
  const ok = await identifyPdf(ex, deps({ doi: (x) => (x === '10.1038/nphys1170' ? lookupFound(measured) : lookupNotFound('404')) }).deps);
  assert.equal(ok.kind === 'identified' && ok.via, 'text-doi');
  // the same DOI resolving to a work whose title is not on the page is not accepted
  const other = cand({ doi: '10.1038/nphys1170', title: 'A completely different paper about lasers', authors: ['Other, Person'] });
  const { deps: d, calls } = deps({ doi: () => lookupFound(other), title: () => [] });
  const rejected = await identifyPdf(ex, d);
  assert.equal(rejected.kind, 'unidentified');
  assert.deepEqual(calls.title, ['Measured measurement'], 'it fell through to the title search');
});

test('SRC-13: a failed lookup is reported (never read as "no such record"); an image-only PDF has no title to search', async () => {
  const ex = await load('doi-footer.pdf');
  const r = await identifyPdf(ex, deps({ doi: () => lookupFailed('HTTP 503 after retries') }).deps);
  assert.equal(r.kind, 'unidentified');
  assert.deepEqual(r.kind === 'unidentified' && r.failures, ['DOI 10.1038/nphys1170: HTTP 503 after retries']);
  const scan = await load('image-only.pdf');
  const none = await identifyPdf(scan, deps({}).deps);
  assert.equal(none.kind, 'unidentified');
  assert.match(none.kind === 'unidentified' ? none.reason : '', /no extractable text/);
});

// ---------------------------------------------------------------------------
// Through the real adapters (MockAgent): what leaves the machine.
// ---------------------------------------------------------------------------

async function liveLane<T>(fn: (agent: ReturnType<typeof installMockAgent>['agent'], seen: string[]) => Promise<T>): Promise<T> {
  const saved = process.env['PENSMITH_NETWORK_TESTS'];
  process.env['PENSMITH_NETWORK_TESTS'] = '1';
  _resetBucketsForTest();
  const { agent, restore } = installMockAgent();
  const seen: string[] = [];
  try {
    return await fn(agent, seen);
  } finally {
    await restore();
    if (saved === undefined) delete process.env['PENSMITH_NETWORK_TESTS'];
    else process.env['PENSMITH_NETWORK_TESTS'] = saved;
  }
}

/** A MockAgent reply that records each request's path in `seen`. */
function record(seen: string[], body: unknown): (opts: { path: string }) => { statusCode: number; data: string; responseOptions: { headers: Record<string, string> } } {
  return (opts) => {
    seen.push(opts.path);
    return { statusCode: 200, data: JSON.stringify(body), responseOptions: { headers: { 'content-type': 'application/json' } } };
  };
}

const crossrefItem = (doi: string, title: string, family: string, given: string, year: number): Record<string, unknown> => ({
  DOI: doi,
  title: [title],
  author: [{ family, given }],
  issued: { 'date-parts': [[year]] },
});
const crossrefList = (items: unknown[]): Record<string, unknown> => ({
  status: 'ok',
  'message-type': 'work-list',
  message: { items, 'total-results': items.length, 'items-per-page': 5, query: { 'start-index': 0, 'search-terms': 'x' } },
});

test('SRC-15 (MockAgent): a title-identified PDF sends ONE request, carrying only the title', async () => {
  const ex = await load('attention-title-only.pdf');
  await liveLane(async (agent, seen) => {
    agent
      .get('https://api.crossref.org')
      .intercept({ path: /^\/works\?/, method: 'GET' })
      .reply(record(seen, crossrefList([
        crossrefItem('10.1007/978-3-031-84300-6_13', 'Is Attention All You Need?', 'Mineault', 'Patrick', 2025),
        crossrefItem('10.5555/nips.2017.attention', 'Attention Is All You Need', 'Vaswani', 'Ashish', 2017),
      ])));
    const r = await identifyPdf(ex);
    assert.equal(r.kind, 'identified');
    assert.equal(r.kind === 'identified' && r.candidate.doi, '10.5555/nips.2017.attention');
    assert.equal(seen.length, 1, 'one lookup request');
    const q = new URLSearchParams(seen[0]!.slice(seen[0]!.indexOf('?') + 1));
    assert.equal(q.get('query'), 'Attention Is All You Need', 'the request carries the title and nothing else of the PDF');
    assert.doesNotMatch(seen[0]!, /dominant|encoder|Google|attribution/i, 'no body text leaves the machine');
  });
});

test('SRC-15 (MockAgent): a no-match PDF is unidentified; Crossref then OpenAlex each get only the title', async () => {
  const ex = await load('no-match.pdf');
  await liveLane(async (agent, seen) => {
    agent
      .get('https://api.crossref.org')
      .intercept({ path: /.*/, method: 'GET' })
      .reply(record(seen, crossrefList([crossrefItem('10.5555/moss.1', 'Moss growth on limestone walls', 'Green', 'Alice', 2011)])));
    agent
      .get('https://api.openalex.org')
      .intercept({ path: /.*/, method: 'GET' })
      .reply(record(seen, { meta: { count: 0 }, results: [] }));
    const r = await identifyPdf(ex);
    assert.equal(r.kind, 'unidentified');
    assert.equal(seen.length, 2);
    for (const p of seen) {
      const q = new URLSearchParams(p.slice(p.indexOf('?') + 1));
      const sent = q.get('query') ?? q.get('search');
      assert.equal(sent, 'Field Notes on Moss Growth Beside the Old Mill Stream', p);
      assert.doesNotMatch(p, /Quillfeather|observations|village/i, 'no author name or body text leaves the machine');
    }
  });
});

test('SRC-15 (MockAgent): a DOI-footer PDF sends one request — the DOI', async () => {
  const ex = await load('doi-footer.pdf');
  await liveLane(async (agent, seen) => {
    agent
      .get('https://api.crossref.org')
      .intercept({ path: /.*/, method: 'GET' })
      .reply(record(seen, { status: 'ok', 'message-type': 'work', message: crossrefItem('10.1038/nphys1170', 'Measured measurement', 'Aspelmeyer', 'Markus', 2009) }));
    const r = await identifyPdf(ex);
    assert.equal(r.kind === 'identified' && r.via, 'text-doi');
    assert.deepEqual(seen, ['/works/10.1038%2Fnphys1170']);
  });
});
