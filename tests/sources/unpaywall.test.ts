// tests/sources/unpaywall.test.ts — Unpaywall adapter (RSCH-04, SRC-03, SRC-05,
// T-3-13, CI-07) and the three-way lookup contract (D-19-05).
//
// The recordings are TODAY's live shape (`z_authors[].raw_author_name`, every
// OA location); the legacy `family` / `given` shape is a hand-written
// SYNTHETIC fixture (tests/fixtures/cassettes/synthetic/unpaywall/). Unpaywall
// requires a contact email: without one the lookup is failed with
// `Unpaywall skipped: set PENSMITH_CONTACT_EMAIL` and no request is made.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as unpaywall from '../../bin/lib/sources/unpaywall.js';
import { SourceCandidateSchema } from '../../bin/lib/schemas/source-candidate.js';
import { _resetContactEmailForTest } from '../../bin/lib/contact-email.js';
import { RECORDED_DOI, recorded, assertOfflineMiss } from './recorded.js';
import { threeWayContract, withContactEmail, liveLane } from './three-way.js';

const EMAIL = 'pensmith-dev@example.org';

test('unpaywall: the recordings are the current live shape (raw_author_name) with the email scrubbed', () => {
  for (const name of ['doi-nphys1170', 'doi-s41586-020-2649-2', 'doi-pone-0000001']) {
    const [entry] = recorded('unpaywall', name);
    const body = entry!.response as { z_authors?: Array<Record<string, unknown>> };
    assert.ok((body.z_authors ?? []).length > 0);
    assert.ok((body.z_authors ?? []).every((a) => typeof a['raw_author_name'] === 'string'));
    assert.ok(!entry!.path.includes('email='), 'the contact email param is scrubbed from the recording');
  }
});

test('SRC-03: 10.1038/s41586-020-2649-2 — authors from raw_author_name, every OA location, the best PDF (recorded)', async () => {
  await withContactEmail(EMAIL, async () => {
    const r = await unpaywall.lookupById('10.1038/s41586-020-2649-2');
    assert.equal(r.kind, 'found');
    if (r.kind !== 'found') return;
    const c = r.candidate;
    assert.equal(c.title, 'Array programming with NumPy');
    assert.equal(c.authors.length, 26);
    assert.equal(c.authors[0], 'Charles R. Harris');
    assert.equal(c.authors[2], 'Stéfan J. van der Walt');
    assert.equal(c.oa_pdf_url, 'https://www.nature.com/articles/s41586-020-2649-2.pdf');
    assert.ok((c.oa_locations ?? []).length >= 5, 'every OA location is kept');
    assert.ok((c.oa_locations ?? []).some((l) => l.url_for_pdf === 'https://arxiv.org/pdf/2006.10256'));
    assert.ok((c.oa_locations ?? []).some((l) => l.host_type === 'repository' && l.version === 'acceptedVersion'));
    assert.equal(c.venue, 'Nature');
    assert.equal(c.year, 2020);
    assert.ok(SourceCandidateSchema.safeParse(c).success);
  });
});

test('SRC-03: 10.1371/journal.pone.0000001 — authors and the publisher PDF (recorded)', async () => {
  await withContactEmail(EMAIL, async () => {
    const c = await unpaywall.fetchById('10.1371/journal.pone.0000001');
    assert.ok(c);
    assert.deepEqual(c.authors, ['Maria C Almeida', 'Alexandre A Steiner', 'Luiz G S Branco', 'Andrej A Romanovsky']);
    assert.equal(c.oa_pdf_url, 'https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0000001&type=printable');
    const again = await unpaywall.fetchById(RECORDED_DOI);
    assert.ok(again, 'the nphys1170 recording now hydrates');
    assert.ok(again.authors.length > 0);
  });
});

test('SRC-03: the legacy family/given shape still parses (synthetic)', async () => {
  await withContactEmail(EMAIL, async () => {
    const r = await unpaywall.fetchById('10.48550/arxiv.1706.03762');
    assert.ok(r);
    assert.equal(r.source, 'unpaywall');
    assert.deepEqual(r.authors, ['Vaswani, Ashish', 'Shazeer, Noam']);
    assert.equal(r.oa_pdf_url, 'https://arxiv.org/pdf/1706.03762.pdf');
  });
});

test('SRC-03 (D-19-12): no contact email → failed "Unpaywall skipped: set PENSMITH_CONTACT_EMAIL", one stderr notice, no request', async () => {
  _resetContactEmailForTest();
  unpaywall._resetUnpaywallNoticeForTest();
  const chunks: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    chunks.push(String(s));
    return true;
  };
  try {
    await withContactEmail(undefined, async () => {
      // A DOI with no fixture: were a request made offline it would be an
      // OfflineEgressError — the skip happens before any request.
      const r = await unpaywall.lookupById('10.9999/no-fixture-needed');
      assert.deepEqual(r, { kind: 'failed', reason: 'Unpaywall skipped: set PENSMITH_CONTACT_EMAIL' });
      await assert.rejects(() => unpaywall.fetchById('10.9999/no-fixture-needed'), /unpaywall lookup of 10\.9999\/no-fixture-needed failed: Unpaywall skipped: set PENSMITH_CONTACT_EMAIL/);
    });
  } finally {
    (process.stderr as unknown as { write: typeof orig }).write = orig;
  }
  const notices = chunks.join('').split('\n').filter((l) => l.includes('Unpaywall skipped'));
  assert.equal(notices.length, 1, 'one notice per run');
});

test('SRC-03: a 4xx surfaces Unpaywall\'s own message', async () => {
  await liveLane(async (agent) => {
    agent
      .get('https://api.unpaywall.org')
      .intercept({ path: (p: string) => p.startsWith('/v2/10.5555%2Fbad-request'), method: 'GET' })
      .reply(422, JSON.stringify({ HTTP_status_code: 422, error: true, message: 'Email address required in API call' }), { headers: { 'content-type': 'application/json' } });
    const r = await unpaywall.lookupById('10.5555/bad-request');
    assert.deepEqual(r, { kind: 'failed', reason: 'HTTP 422: Email address required in API call', status: 422 });
  }, { contactEmail: EMAIL });
});

test('SRC-03: the best PDF — best location, then any url_for_pdf, then a PDF-looking or arXiv abstract URL', () => {
  const loc = (url?: string, pdf?: string) => ({ ...(url ? { url } : {}), ...(pdf ? { url_for_pdf: pdf } : {}) });
  assert.equal(unpaywall.bestPdfUrl(loc('https://a.org', 'https://a.org/x.pdf'), [loc('https://b.org', 'https://b.org/y.pdf')]), 'https://a.org/x.pdf');
  assert.equal(unpaywall.bestPdfUrl(loc('https://a.org'), [loc('https://c.org'), loc('https://b.org', 'https://b.org/y.pdf')]), 'https://b.org/y.pdf');
  assert.equal(unpaywall.bestPdfUrl(null, [loc('https://arxiv.org/abs/2006.10256')]), 'https://arxiv.org/pdf/2006.10256');
  assert.equal(unpaywall.bestPdfUrl(null, [loc('https://repo.example/paper.pdf')]), 'https://repo.example/paper.pdf');
  assert.equal(unpaywall.bestPdfUrl(null, [loc('https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7759461/pdf/nihms.pdf')]), 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7759461/pdf/nihms.pdf');
  assert.equal(unpaywall.bestPdfUrl(null, [loc('http://urn.fi/URN:NBN:fi:jyu-202010096147')]), undefined);
  assert.equal(unpaywall.unpaywallAuthorName({ raw_author_name: '  Charles  R. Harris ' }), 'Charles R. Harris');
  assert.equal(unpaywall.unpaywallAuthorName({ family: 'Vaswani', given: 'Ashish' }), 'Vaswani, Ashish');
});

test('unpaywall.search() is inert (DOI-lookup service)', async () => {
  assert.deepEqual(await unpaywall.search('attention mechanisms'), []);
});

test('RUN-03: an unrecorded DOI is a typed offline miss — never the first cassette entry', async () => {
  await withContactEmail(EMAIL, () => assertOfflineMiss(() => unpaywall.fetchById('10.1093/nar/gkab1112'), 'fetchById miss'));
});

threeWayContract({
  adapter: 'unpaywall',
  lookupById: unpaywall.lookupById,
  fetchById: unpaywall.fetchById,
  origin: 'https://api.unpaywall.org',
  idFor: (t) => `10.5555/${t}`,
  pathPrefixFor: (t) => `/v2/10.5555/${t}?email=`,
  found: (t) => ({
    body: {
      doi: `10.5555/${t}`,
      title: 'A Found Work',
      year: 2019,
      z_authors: [{ raw_author_name: 'Fay Found' }],
      best_oa_location: { url: 'https://repo.example/x', url_for_pdf: 'https://repo.example/x.pdf', host_type: 'repository', version: 'acceptedVersion' },
      oa_locations: [{ url: 'https://repo.example/x', url_for_pdf: 'https://repo.example/x.pdf', host_type: 'repository', version: 'acceptedVersion' }],
    },
  }),
  checkFound: (c, t) => {
    assert.equal(c.doi, `10.5555/${t}`);
    assert.deepEqual(c.authors, ['Fay Found']);
    assert.equal(c.oa_pdf_url, 'https://repo.example/x.pdf');
  },
  invalid: (m) => ({ body: { HTTP_status_code: 500, error: true, message: `internal error ${m}` } }),
  offlineMissId: '10.9999/three-way-offline-miss',
  contactEmail: EMAIL,
});
