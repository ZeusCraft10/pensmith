// tests/open-access.test.ts — GRND-14 / SRC-03: a source with a DOI records the
// open-access PDF Unpaywall lists for it (`oa_url`), so full-text.ts can tell
// the drafter which sources Pass 3 can check. An enrichment, never a gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { enrichOpenAccess, describeOpenAccess, type OpenAccessTarget } from '../bin/lib/open-access.js';
import { lookupFound, lookupNotFound, lookupFailed } from '../bin/lib/sources/lookup.js';
import { OfflineEgressError } from '../bin/lib/http.js';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';
import { sandbox, runCli, writeState } from './helpers/paper-cli-harness.js';

const oa = (doi: string, url: string | undefined): SourceCandidate =>
  ({
    source: 'unpaywall',
    id: doi,
    doi,
    title: 'T',
    authors: ['A, B'],
    retracted: false,
    last_verified: '2026-01-01T00:00:00.000Z',
    citekey: 'a2020',
    raw: {},
    ...(url !== undefined ? { oa_pdf_url: url } : {}),
  }) as SourceCandidate;

test('GRND-14: enrichOpenAccess records Unpaywall\'s OA PDF as oa_url for each DOI without a confirmed one — an adapter\'s own link does not spare the lookup', async () => {
  const asked: string[] = [];
  const targets: OpenAccessTarget[] = [
    { doi: '10.5555/open' },
    { doi: '10.5555/closed' },
    { doi: '10.5555/gone' },
    { doi: '10.5555/has', oa_url: 'https://example.org/already.pdf' },
    { doi: null },
    // OpenAlex's open primary location (review round 2): not what Pass 3 checks.
    { doi: '10.5555/adapter', oa_pdf_url: 'https://example.org/adapter.pdf' },
    // A DataCite arXiv DOI: Unpaywall does not index it; its text is the arXiv PDF.
    { doi: '10.48550/arxiv.2102.05095', oa_pdf_url: 'https://arxiv.org/pdf/2102.05095' },
  ];
  const checked: string[] = [];
  const s = await enrichOpenAccess(targets, {
    lookup: async (doi) => {
      asked.push(doi);
      if (doi === '10.5555/open') return lookupFound(oa(doi, 'https://example.org/open.pdf'));
      if (doi === '10.5555/closed' || doi === '10.5555/adapter') return lookupFound(oa(doi, undefined));
      return lookupNotFound('HTTP 404');
    },
    confirm: async (url) => {
      checked.push(url);
      return { ok: true };
    },
  });
  assert.deepEqual(checked, ['https://example.org/open.pdf'], 'the listed PDF is checked before it becomes oa_url');
  assert.deepEqual(asked, ['10.5555/open', '10.5555/closed', '10.5555/gone', '10.5555/adapter'], 'every DOI without a confirmed oa_url, except a DataCite arXiv DOI');
  assert.equal(targets[0]!.oa_url, 'https://example.org/open.pdf');
  assert.equal(targets[1]!.oa_url, undefined);
  assert.equal(targets[5]!.oa_url, undefined, 'Unpaywall has no PDF: the adapter link does not become oa_url');
  assert.equal(targets[6]!.oa_url, undefined);
  assert.deepEqual(s, { asked: 4, found: 1, unconfirmed: 0, problem: null });
  assert.equal(describeOpenAccess(s), 'open access: 1 of 4 source(s) with a DOI have an open-access PDF (Unpaywall, checked)');
});

test('GRND-14 (review round 3): a link Unpaywall lists that does not answer with a PDF (a landing page, a bot wall) never becomes oa_url — the source counts as abstract-only, and the summary says so', async () => {
  const targets: OpenAccessTarget[] = [{ doi: '10.5555/landing' }, { doi: '10.5555/wall' }, { doi: '10.5555/pdf' }];
  const urls: Record<string, string> = {
    '10.5555/landing': 'https://repositorio.example.edu/handle/unal/81004',
    '10.5555/wall': 'https://www.publisher.example/doi/pdf/10.5555/wall',
    '10.5555/pdf': 'https://repo.example.org/pdf.pdf',
  };
  const s = await enrichOpenAccess(targets, {
    lookup: async (doi) => lookupFound(oa(doi, urls[doi])),
    confirm: async (url) =>
      url.includes('handle') ? { ok: false, reason: 'not a PDF (got text/html)' } : url.includes('publisher') ? { ok: false, reason: 'HTTP 403' } : { ok: true },
  });
  assert.deepEqual(targets.map((t) => t.oa_url), [undefined, undefined, 'https://repo.example.org/pdf.pdf']);
  assert.deepEqual(targets.map((t) => t.oa_pdf_url), [urls['10.5555/landing'], urls['10.5555/wall'], urls['10.5555/pdf']], 'what Unpaywall said is kept on the candidate');
  assert.deepEqual({ found: s.found, unconfirmed: s.unconfirmed }, { found: 1, unconfirmed: 2 });
  assert.equal(
    describeOpenAccess(s),
    'open access: 1 of 3 source(s) with a DOI have an open-access PDF (Unpaywall, checked); 2 link(s) Unpaywall lists did not answer with a PDF (repositorio.example.edu: not a PDF (got text/html)), so they count as abstract-only',
  );
});

test('GRND-14 (review round 3, MockAgent): confirmOpenAccessPdf reads only the PDF\'s first bytes the way Pass 3 fetches it — 200 %PDF (after a redirect) yes; 403 HTML, a 200 landing page and an SSRF target no', async () => {
  const { installMockAgent } = await import('./helpers/local-servers/mock-agent.js');
  const { confirmOpenAccessPdf, PDF_PREFIX_BYTES } = await import('../bin/lib/open-access.js');
  const { _resetHostStateForTest } = await import('../bin/lib/http.js');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-oa-confirm-'));
  const vars: Record<string, string | undefined> = { PENSMITH_NETWORK_TESTS: '1', PENSMITH_OFFLINE: undefined, XDG_DATA_HOME: data, LOCALAPPDATA: data, HOME: data };
  const saved = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetHostStateForTest();
  const m = installMockAgent();
  try {
    const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200_000, 0x20)]);
    const repo = m.agent.get('https://repo.example.org');
    repo.intercept({ path: '/moved.pdf', method: 'GET' }).reply(302, '', { headers: { location: 'https://repo.example.org/real.pdf' } });
    repo.intercept({ path: '/real.pdf', method: 'GET' }).reply(200, big, { headers: { 'content-type': 'application/pdf' } });
    repo.intercept({ path: '/handle/1', method: 'GET' }).reply(200, '<!doctype html><title>Repository</title>', { headers: { 'content-type': 'text/html' } });
    m.agent.get('https://www.publisher.example').intercept({ path: '/doi/pdf/x', method: 'GET' }).reply(403, '<html>Are you a robot?</html>', { headers: { 'content-type': 'text/html' } });
    assert.deepEqual(await confirmOpenAccessPdf('https://repo.example.org/moved.pdf'), { ok: true });
    assert.deepEqual(await confirmOpenAccessPdf('https://repo.example.org/handle/1'), { ok: false, reason: 'not a PDF (got text/html)' });
    assert.deepEqual(await confirmOpenAccessPdf('https://www.publisher.example/doi/pdf/x'), { ok: false, reason: 'HTTP 403' });
    const ssrf = await confirmOpenAccessPdf('http://127.0.0.1:9/x.pdf');
    assert.equal(ssrf.ok, false);
    assert.match(ssrf.ok ? '' : ssrf.reason, /SSRF guard/);
    assert.equal(PDF_PREFIX_BYTES, 1029);
  } finally {
    await m.restore();
    _resetHostStateForTest();
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const { closeSessionLog } = await import('../bin/lib/session-log.js');
    await closeSessionLog();
    fs.rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('GRND-14: a failed or offline lookup is reported, never a gate; offline stops asking', async () => {
  const failed = await enrichOpenAccess([{ doi: '10.5555/x' }], { lookup: async () => lookupFailed('HTTP 503 after retries') });
  assert.deepEqual(failed, { asked: 1, found: 0, unconfirmed: 0, problem: 'Unpaywall lookup failed: HTTP 503 after retries' });
  let calls = 0;
  const offline = await enrichOpenAccess([{ doi: '10.5555/a' }, { doi: '10.5555/b' }], {
    lookup: async () => {
      calls += 1;
      throw new OfflineEgressError('offline', 'test runner', 'GET https://api.unpaywall.org/v2/x', 'offline: no recorded fixture');
    },
  });
  assert.equal(calls, 1, 'the rest would miss the same way');
  assert.match(offline.problem ?? '', /^not looked up \(offline/);
});

test('GRND-14: without a contact email Unpaywall is not asked (it requires one) and the summary says so', async () => {
  const saved = process.env['PENSMITH_CONTACT_EMAIL'];
  delete process.env['PENSMITH_CONTACT_EMAIL'];
  try {
    const s = await enrichOpenAccess([{ doi: '10.5555/x' }]);
    assert.deepEqual(s, { asked: 1, found: 0, unconfirmed: 0, problem: 'not looked up: Unpaywall needs a contact email (set PENSMITH_CONTACT_EMAIL)' });
  } finally {
    if (saved !== undefined) process.env['PENSMITH_CONTACT_EMAIL'] = saved;
  }
});

test('GRND-14 (built CLI): `add` of an open-access DOI records its OA PDF as oa_url once the PDF answered as one (recorded Crossref + Unpaywall + the PDF\'s first bytes)', () => {
  const sb = sandbox('open-access-add');
  const root = sb.project('p');
  writeState(root, [], 'open-access-add');
  const r = runCli(sb, root, ['add', '10.1371/journal.pone.0000001', '--yolo'], {
    timeoutMs: 120_000,
    env: { PENSMITH_CONTACT_EMAIL: 'pensmith-dev@example.org' },
  });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const [entry] = (JSON.parse(fs.readFileSync(path.join(root, '.paper', 'LIBRARY.json'), 'utf8')) as { entries: Array<{ citekey: string; oa_url: string | null }> }).entries;
  assert.equal(entry!.citekey, 'almeida2006');
  assert.equal(entry!.oa_url, 'https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0000001&type=printable');
});
