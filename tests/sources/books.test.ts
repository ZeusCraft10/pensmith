// tests/sources/books.test.ts — the books adapter (SRC-11, D-19-14): Open Library
// search and ISBN lookups against REAL recordings, Google Books as the keyless
// ISBN fallback (MockAgent: its shared keyless quota was exhausted when the
// cassettes were recorded), and the three-way lookup contract (D-19-05) across
// both registrars.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as books from '../../bin/lib/sources/books.js';
import { sources } from '../../bin/lib/sources/index.js';
import { SourceCandidateSchema } from '../../bin/lib/schemas/source-candidate.js';
import { RateLimitExhaustedError, type HttpResponse } from '../../bin/lib/http.js';
import { __setRegistrarSendForTest } from '../../bin/lib/sources/registrar-response.js';
import { isSourceLookupError } from '../../bin/lib/sources/lookup.js';
import { isbn13CheckDigit } from '../../bin/lib/doi.js';
import { recorded, assertOfflineMiss } from './recorded.js';
import { liveLane, cacheFiles } from './three-way.js';

const OL = 'https://openlibrary.org';
const GB = 'https://www.googleapis.com';
const JSON_HEADERS = { headers: { 'content-type': 'application/json' } } as const;

let seq = 0;
/** A checksum-valid ISBN-13 unique to this process. */
function freshIsbn(): string {
  seq += 1;
  const core = `979${String((process.pid * 1000 + seq) % 1_000_000_000).padStart(9, '0')}`;
  return `${core}${isbn13CheckDigit(core)}`;
}

function olDoc(isbn: string, title = 'A Found Book'): unknown {
  return {
    numFound: 1,
    docs: [
      {
        key: '/works/OL1W',
        title,
        author_name: ['Fay Found'],
        first_publish_year: 1990,
        editions: { docs: [{ key: '/books/OL1M', title, publisher: ['Test Press'], publish_date: ['2001'], isbn: [isbn] }] },
      },
    ],
  };
}

function gbVolume(isbn: string): unknown {
  return {
    kind: 'books#volumes',
    totalItems: 1,
    items: [
      {
        id: 'gb1',
        volumeInfo: {
          title: 'A Google Book',
          subtitle: 'With a Subtitle',
          authors: ['Gail Books'],
          publisher: 'Fallback Press',
          publishedDate: '2011-05-01',
          description: 'A description.',
          industryIdentifiers: [{ type: 'ISBN_13', identifier: isbn }],
        },
      },
    ],
  };
}

const EMPTY_OL = { numFound: 0, docs: [] };
const EMPTY_GB = { kind: 'books#volumes', totalItems: 0 };

type Agent = Parameters<Parameters<typeof liveLane>[0]>[0];

/** The request's path and query (MockAgent hands the query re-ordered). */
function parts(p: string): URL {
  return new URL(`http://mock${p}`);
}

function olIsbn(agent: Agent, isbn: string, status: number, body: unknown): void {
  const scope = agent
    .get(OL)
    .intercept({ path: (p: string) => parts(p).pathname === '/search.json' && parts(p).searchParams.get('isbn') === isbn, method: 'GET' })
    .reply(status, typeof body === 'string' ? body : JSON.stringify(body), { headers: { 'content-type': 'application/json', 'retry-after': '0' } });
  // A retried status (429 / 5xx) is asked again by the transport.
  if (status === 429 || status >= 500) scope.persist();
}
function gbIsbn(agent: Agent, isbn: string, status: number, body: unknown): void {
  const scope = agent
    .get(GB)
    .intercept({ path: (p: string) => parts(p).pathname === '/books/v1/volumes' && parts(p).searchParams.get('q') === `isbn:${isbn}`, method: 'GET' })
    .reply(status, typeof body === 'string' ? body : JSON.stringify(body), { headers: { 'content-type': 'application/json', 'retry-after': '0' } });
  if (status === 429 || status >= 500) scope.persist();
}

test('the registry carries the books adapter (search + three-way lookups)', () => {
  assert.equal(sources.books, books);
  assert.equal(typeof sources.books.search, 'function');
  assert.equal(typeof sources.books.lookupById, 'function');
});

test('SRC-11: isbn:9780226458083 → Kuhn, The Structure of Scientific Revolutions — @book with publisher, year, ISBN-13 (recorded)', async () => {
  const [entry] = recorded('books', 'isbn-9780226458083');
  assert.equal(entry!.scope, OL);
  assert.equal(entry!.status, 200, 'one request, answered directly (no redirect)');
  for (const spelling of ['isbn:9780226458083', '9780226458083', 'ISBN 978-0-226-45808-3', '0226458083', 'isbn:0-226-45808-3']) {
    const r = await books.lookupById(spelling);
    assert.equal(r.kind, 'found', spelling);
    if (r.kind !== 'found') continue;
    const c = r.candidate;
    assert.equal(c.source, 'books');
    assert.equal(c.id, 'isbn:9780226458083');
    assert.equal(c.title, 'The Structure of Scientific Revolutions');
    assert.equal(c.authors[0], 'Thomas S. Kuhn');
    assert.equal(c.publisher, 'University of Chicago Press');
    assert.equal(c.year, 1996, 'the edition\'s date, not the work\'s first publication');
    assert.equal(c.isbn, '9780226458083');
    assert.equal(c.type, 'book');
    assert.equal(c.citekey, 'kuhn1996');
    assert.ok(SourceCandidateSchema.safeParse(c).success);
  }
});

test('SRC-11: a title search returns books (recorded Open Library search)', async () => {
  const [entry] = recorded('books', 'search-economic-consequences-of-the-peace');
  const docs = (entry!.response as { docs: unknown[] }).docs;
  const hits = await books.search('The Economic Consequences of the Peace', { limit: 5 });
  assert.equal(hits.length, docs.length);
  const [first] = hits;
  assert.ok(first);
  assert.equal(first.title, 'The Economic Consequences of the Peace');
  assert.equal(first.authors[0], 'John Maynard Keynes');
  assert.equal(first.year, 1920);
  assert.equal(first.publisher, 'Macmillan');
  assert.equal(first.id, 'OL35914W', 'an edition without an ISBN is identified by its Open Library work');
  for (const h of hits) {
    assert.equal(h.type, 'book');
    assert.equal(h.source, 'books');
    assert.ok(SourceCandidateSchema.safeParse(h).success);
  }
  assert.ok(hits.some((h) => h.isbn !== undefined && h.id === `isbn:${h.isbn}`), 'an edition with an ISBN is identified by it');
});

test('ISBN handling: ISBN-10 → ISBN-13, bad check digits and dry-run ISBNs are not ISBNs', async () => {
  assert.equal(books.toIsbn13('0-226-45808-3'), '9780226458083');
  assert.equal(books.toIsbn13('isbn:9780226458083'), '9780226458083');
  assert.equal(books.toIsbn13('9780226458084'), null);
  assert.equal(books.toIsbn13('080442957X'), '9780804429573');
  const r = await books.lookupById('isbn:978-0-00-123456-0');
  assert.equal(r.kind, 'not-found', 'a checksum-invalid ISBN (e.g. a reserved dry-run id) is not looked up');
});

test('D-19-14: Open Library has no such edition → the Google Books fallback answers', async () => {
  await liveLane(async (agent) => {
    const isbn = freshIsbn();
    olIsbn(agent, isbn, 200, EMPTY_OL);
    gbIsbn(agent, isbn, 200, gbVolume(isbn));
    const r = await books.lookupById(`isbn:${isbn}`);
    assert.equal(r.kind, 'found', JSON.stringify(r));
    if (r.kind !== 'found') return;
    assert.equal(r.candidate.title, 'A Google Book: With a Subtitle');
    assert.deepEqual(r.candidate.authors, ['Gail Books']);
    assert.equal(r.candidate.publisher, 'Fallback Press');
    assert.equal(r.candidate.year, 2011);
    assert.equal(r.candidate.isbn, isbn);
    assert.equal(r.candidate.abstract, 'A description.');
  });
});

test('D-19-14: an Open Library answer for a different edition is not the book asked for', async () => {
  await liveLane(async (agent) => {
    const isbn = freshIsbn();
    const other = freshIsbn();
    olIsbn(agent, isbn, 200, olDoc(other, 'Some Other Book'));
    gbIsbn(agent, isbn, 200, EMPTY_GB);
    const r = await books.lookupById(isbn);
    assert.equal(r.kind, 'not-found', JSON.stringify(r));
  });
});

test('three-way: found (Open Library), not-found (both registrars say no), HTTP 404 → not-found', async () => {
  await liveLane(async (agent) => {
    const isbn = freshIsbn();
    olIsbn(agent, isbn, 200, olDoc(isbn));
    const found = await books.lookupById(`isbn:${isbn}`);
    assert.equal(found.kind, 'found');
    assert.equal(found.kind === 'found' ? found.candidate.publisher : '', 'Test Press');
    assert.equal(found.kind === 'found' ? found.candidate.year : 0, 2001);

    const none = freshIsbn();
    olIsbn(agent, none, 200, EMPTY_OL);
    gbIsbn(agent, none, 200, EMPTY_GB);
    const nf = await books.lookupById(`isbn:${none}`);
    assert.equal(nf.kind, 'not-found');
    assert.match(nf.kind === 'not-found' ? nf.reason : '', /Open Library: no edition with ISBN .+; Google Books: no volume with ISBN/);

    const gone = freshIsbn();
    olIsbn(agent, gone, 404, 'Not Found');
    gbIsbn(agent, gone, 404, 'Not Found');
    assert.equal(await books.fetchById(`isbn:${gone}`), null);
  });
});

test('three-way: a registrar that could not answer makes the lookup failed (fail closed), with each reason', async () => {
  await liveLane(async (agent) => {
    const isbn = freshIsbn();
    olIsbn(agent, isbn, 200, EMPTY_OL);
    gbIsbn(agent, isbn, 429, { error: { code: 429, message: 'Quota exceeded' } });
    const r = await books.lookupById(`isbn:${isbn}`);
    assert.equal(r.kind, 'failed', JSON.stringify(r));
    assert.equal(
      r.kind === 'failed' ? r.reason : '',
      `Open Library: no edition with ISBN ${isbn}; Google Books: Google Books keyless quota exhausted (HTTP 429)`,
    );
    await assert.rejects(() => (async () => {
      const again = freshIsbn();
      olIsbn(agent, again, 200, EMPTY_OL);
      gbIsbn(agent, again, 429, { error: { code: 429 } });
      return books.fetchById(`isbn:${again}`);
    })(), (e: unknown) => isSourceLookupError(e) && e.source === 'books');
  });
});

test('three-way: a 200 that is not the service\'s answer is failed and never cached', async () => {
  await liveLane(async (agent) => {
    const isbn = freshIsbn();
    const before = cacheFiles();
    olIsbn(agent, isbn, 200, { error: 'search backend unavailable' });
    gbIsbn(agent, isbn, 200, EMPTY_GB);
    const r = await books.lookupById(`isbn:${isbn}`);
    assert.equal(r.kind, 'failed', JSON.stringify(r));
    assert.match(r.kind === 'failed' ? r.reason : '', /^Open Library: response is not an Open Library answer \(an error document: an "error" member\)/);
    const after = cacheFiles();
    // Only the valid Google Books answer may have been cached.
    assert.equal(after.length - before.length <= 1, true);
    // The same Open Library request reaches the network again: now a real answer.
    olIsbn(agent, isbn, 200, olDoc(isbn));
    const again = await books.lookupById(`isbn:${isbn}`);
    assert.equal(again.kind, 'found', JSON.stringify(again));
  });
});

test('three-way: an exhausted host is failed; search reports it and returns []', async () => {
  try {
    __setRegistrarSendForTest(async (): Promise<HttpResponse> => {
      throw new RateLimitExhaustedError('openlibrary.org', 7_200_000, 429);
    });
    const r = await books.lookupById(`isbn:${freshIsbn()}`);
    assert.equal(r.kind, 'failed');
    assert.match(r.kind === 'failed' ? r.reason : '', /^Open Library: rate limit exhausted \(retry after ~2 h\); Google Books: /);
    const reasons: string[] = [];
    assert.deepEqual(await books.search('anything', { limit: 3, onFailure: (x) => reasons.push(x) }), []);
    assert.deepEqual(reasons, ['rate limit exhausted (retry after ~2 h)']);
  } finally {
    __setRegistrarSendForTest(null);
  }
});

test('three-way: HTTP 503 after retries is failed, never not-found', async () => {
  await liveLane(async (agent) => {
    const isbn = freshIsbn();
    olIsbn(agent, isbn, 503, 'Service Unavailable');
    gbIsbn(agent, isbn, 200, EMPTY_GB);
    const r = await books.lookupById(isbn);
    assert.equal(r.kind, 'failed', JSON.stringify(r));
    assert.match(r.kind === 'failed' ? r.reason : '', /^Open Library: .*503/);
  });
});

test('RUN-03: offline with no recorded fixture → OfflineEgressError', async () => {
  await assertOfflineMiss(() => books.lookupById(`isbn:${freshIsbn()}`), 'books.lookupById miss');
  await assertOfflineMiss(() => books.search('medieval Icelandic sagas', { limit: 5 }), 'books.search miss');
});

test('Open Library work ids are lookups too (search by key)', async () => {
  await liveLane(async (agent) => {
    agent
      .get(OL)
      .intercept({ path: (p: string) => parts(p).searchParams.get('q') === 'key:/works/OL77W', method: 'GET' })
      .reply(200, JSON.stringify({ numFound: 1, docs: [{ key: '/works/OL77W', title: 'Keyed Work', author_name: ['K. Author'], first_publish_year: 1950, editions: { docs: [{ title: 'Keyed work', publisher: ['P'], publish_date: ['1951'] }] } }] }), JSON_HEADERS);
    const c = await books.fetchById('/works/OL77W');
    assert.equal(c?.id, 'OL77W');
    assert.equal(c?.title, 'Keyed Work');
    assert.equal(c?.year, 1951);
  });
});
