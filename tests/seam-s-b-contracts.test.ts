// tests/seam-s-b-contracts.test.ts — the small shared contracts of Phase 19
// seam S-B: the three-way lookup result, the PDF-response check, the contact
// email resolver, the transport's host-availability errors and their
// user-facing reasons, and the extended SourceCandidate schema.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  lookupFound,
  lookupNotFound,
  lookupFailed,
  unwrapLookup,
  SourceLookupError,
  isSourceLookupError,
} from '../bin/lib/sources/lookup.js';
import { checkPdfResponse, hasPdfMagic } from '../bin/lib/pdf-response.js';
import {
  contactEmail,
  isAllowedContactEnvName,
  isPlausibleEmail,
  DEFAULT_CONTACT_EMAIL_ENV,
  _resetContactEmailForTest,
} from '../bin/lib/contact-email.js';
import { updatePaperConfig, rawTable } from '../bin/lib/config.js';
import {
  RateLimitExhaustedError,
  CircuitOpenError,
  RedirectError,
  SsrfBlockedError,
  isHostUnavailableError,
  formatRetryAfter,
} from '../bin/lib/http.js';
import { errorFailureReason } from '../bin/lib/sources/search-failure.js';
import { SourceCandidateSchema, type SourceCandidate } from '../bin/lib/schemas/source-candidate.js';
import { EXIT_ERROR } from '../bin/lib/exit-codes.js';

const CANDIDATE: SourceCandidate = {
  source: 'books',
  id: '9780226458083',
  isbn: '9780226458083',
  title: 'The Structure of Scientific Revolutions',
  authors: ['Kuhn, Thomas S.'],
  year: 1996,
  publisher: 'University of Chicago Press',
  type: 'book',
  retracted: false,
  last_verified: '2026-09-28T00:00:00.000Z',
  citekey: 'kuhn1996',
  raw: null,
};

test('seam S-B: SourceCandidate accepts the new sources and bibliographic fields', () => {
  assert.equal(SourceCandidateSchema.safeParse(CANDIDATE).success, true);
  for (const source of ['zotero', 'byo', 'books']) {
    assert.equal(SourceCandidateSchema.safeParse({ ...CANDIDATE, source }).success, true, source);
  }
  const withOa = {
    ...CANDIDATE,
    source: 'unpaywall',
    oa_locations: [{ url: 'https://example.org/landing', url_for_pdf: 'https://example.org/x.pdf', host_type: 'repository', version: 'acceptedVersion' }],
    retraction_status: 'clear',
    zotero: { library: 'users/1', key: 'ABCDEFGH' },
    volume: '521',
    issue: '7553',
    pages: '436-444',
    editors: ['Doe, J.'],
    venue: 'Nature',
    pmid: '26017442',
  };
  assert.equal(SourceCandidateSchema.safeParse(withOa).success, true);
  assert.equal(SourceCandidateSchema.safeParse({ ...CANDIDATE, type: 'blogpost' }).success, false);
});

test('seam S-B: unwrapLookup — found → candidate, not-found → null, failed → SourceLookupError', () => {
  assert.equal(unwrapLookup(lookupFound(CANDIDATE), 'books', 'x'), CANDIDATE);
  assert.equal(unwrapLookup(lookupNotFound('HTTP 404'), 'crossref', '10.5555/none'), null);
  const failed = lookupFailed('HTTP 503 after retries', { status: 503, retryAfterMs: 1000 });
  assert.deepEqual(failed, { kind: 'failed', reason: 'HTTP 503 after retries', status: 503, retryAfterMs: 1000 });
  assert.deepEqual(lookupFailed('offline'), { kind: 'failed', reason: 'offline' }, 'absent extras are omitted');
  assert.throws(
    () => unwrapLookup(failed, 'crossref', '10.1038/nature14539'),
    (e: unknown) => {
      assert.ok(isSourceLookupError(e));
      const err = e as SourceLookupError;
      assert.equal(err.message, 'crossref lookup of 10.1038/nature14539 failed: HTTP 503 after retries');
      assert.equal(err.exitCode, EXIT_ERROR);
      assert.equal(err.status, 503);
      assert.equal(err.retryAfterMs, 1000);
      assert.equal(err.source, 'crossref');
      return true;
    },
  );
});

test('seam S-B: checkPdfResponse accepts real PDF bytes and names what else came back', () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
  assert.equal(hasPdfMagic(pdf), true);
  const ok = checkPdfResponse({ status: 200, headers: { 'content-type': 'application/octet-stream' }, bodyBytes: pdf });
  assert.equal(ok.ok, true);
  const junkFirst = Buffer.concat([Buffer.alloc(200, 0x0a), pdf]);
  assert.equal(checkPdfResponse({ status: 200, headers: {}, bodyBytes: junkFirst }).ok, true, 'junk before the header is allowed');
  assert.deepEqual(
    checkPdfResponse({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, bodyBytes: Buffer.from('<html>login</html>') }),
    { ok: false, reason: 'not a PDF (got text/html)' },
  );
  assert.deepEqual(checkPdfResponse({ status: 404, headers: {}, bodyBytes: pdf }), { ok: false, reason: 'HTTP 404' });
  assert.deepEqual(checkPdfResponse({ status: 200, headers: {} }), { ok: false, reason: 'empty response body' });
  assert.deepEqual(checkPdfResponse({ status: 200, headers: {}, bodyBytes: Buffer.from('plain') }), { ok: false, reason: 'not a PDF (got no content type)' });
});

function withEnv(vars: Record<string, string | undefined>, fn: () => void | Promise<void>): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

function captureStderr(): { text: () => string; restore: () => void } {
  const original = process.stderr.write.bind(process.stderr);
  let buf = '';
  (process.stderr as unknown as { write: (c: string | Uint8Array) => boolean }).write = (c: string | Uint8Array): boolean => {
    buf += typeof c === 'string' ? c : Buffer.from(c).toString('utf8');
    return true;
  };
  return { text: () => buf, restore: () => { (process.stderr as unknown as { write: typeof original }).write = original; } };
}

test('seam S-B: contact email — default variable, configured variable, refusals', async () => {
  _resetContactEmailForTest();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-contact-'));
  fs.mkdirSync(path.join(root, '.paper'), { recursive: true });
  await withEnv({ PENSMITH_CONTACT_EMAIL: 'pensmith-dev@example.org', MY_WORK_EMAIL: 'work@example.org', AWS_SECRET_ACCESS_KEY: 'secret-value' }, async () => {
    assert.deepEqual(contactEmail(root), { email: 'pensmith-dev@example.org', envName: DEFAULT_CONTACT_EMAIL_ENV, source: 'default' });

    await updatePaperConfig(root, (raw) => {
      rawTable(raw, 'network')['contact_email_env'] = 'MY_WORK_EMAIL';
    });
    assert.deepEqual(contactEmail(root), { email: 'work@example.org', envName: 'MY_WORK_EMAIL', source: 'config' });

    const err = captureStderr();
    try {
      await updatePaperConfig(root, (raw) => {
        rawTable(raw, 'network')['contact_email_env'] = 'AWS_SECRET_ACCESS_KEY';
      });
      const r = contactEmail(root);
      assert.equal(r.envName, DEFAULT_CONTACT_EMAIL_ENV, 'a non-email variable name is never read');
      assert.equal(r.email, 'pensmith-dev@example.org');
      contactEmail(root);
    } finally {
      err.restore();
    }
    assert.equal((err.text().match(/ignoring \[network\] contact_email_env/g) ?? []).length, 1, 'warned once');
    assert.doesNotMatch(err.text(), /secret-value/);
  });
  await withEnv({ PENSMITH_CONTACT_EMAIL: 'not an email' }, () => {
    const err = captureStderr();
    try {
      const other = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-contact2-'));
      assert.equal(contactEmail(other).email, null);
    } finally {
      err.restore();
    }
    assert.match(err.text(), /not an email address/);
    assert.doesNotMatch(err.text(), /not an email"/);
  });
  await withEnv({ PENSMITH_CONTACT_EMAIL: undefined }, () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-contact3-'));
    assert.equal(contactEmail(other).email, null);
  });
  assert.equal(isAllowedContactEnvName('LAB_MAILTO'), true);
  assert.equal(isAllowedContactEnvName('lower_email'), false);
  assert.equal(isAllowedContactEnvName('GITHUB_TOKEN'), false);
  assert.equal(isPlausibleEmail('a@b.co'), true);
  assert.equal(isPlausibleEmail('Name <a@b.co>'), false);
  assert.equal(isPlausibleEmail(`${'x'.repeat(250)}@b.co`), false);
});

test('seam S-B: host-availability and redirect errors read as what happened', () => {
  assert.equal(formatRetryAfter(35_000), '~35 s');
  assert.equal(formatRetryAfter(12 * 60_000), '~12 min');
  assert.equal(formatRetryAfter(22_400_000), '~6 h');
  assert.equal(formatRetryAfter(3 * 86_400_000), '~3 d');
  const exhausted = new RateLimitExhaustedError('api.openalex.org', 22_400_000);
  assert.equal(exhausted.message, 'api.openalex.org: rate limit exhausted (retry after ~6 h)');
  assert.equal(exhausted.status, 429);
  const open = new CircuitOpenError('api.labs.example.org', 503, 3);
  assert.ok(isHostUnavailableError(exhausted) && isHostUnavailableError(open));
  assert.equal(isHostUnavailableError(new Error('x')), false);
  assert.equal(errorFailureReason(exhausted), 'rate limit exhausted (retry after ~6 h)');
  assert.equal(errorFailureReason(open), 'skipped after 3 consecutive HTTP 503 responses');
  assert.equal(errorFailureReason(new RedirectError('too-many', 'https://x/', 'more than 5 hops from https://x/')), 'too many redirects: more than 5 hops from https://x/');
  assert.match(errorFailureReason(new SsrfBlockedError('SSRF guard: "x" resolves to private/reserved IP 127.0.0.1 — blocked')), /^SSRF guard/);
});
