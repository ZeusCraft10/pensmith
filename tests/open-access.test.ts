// tests/open-access.test.ts — GRND-14 / SRC-03: a source with a DOI records the
// open-access PDF Unpaywall lists for it (`oa_url`), so full-text.ts can tell
// the drafter which sources Pass 3 can check. An enrichment, never a gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
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
  const s = await enrichOpenAccess(targets, {
    lookup: async (doi) => {
      asked.push(doi);
      if (doi === '10.5555/open') return lookupFound(oa(doi, 'https://example.org/open.pdf'));
      if (doi === '10.5555/closed' || doi === '10.5555/adapter') return lookupFound(oa(doi, undefined));
      return lookupNotFound('HTTP 404');
    },
  });
  assert.deepEqual(asked, ['10.5555/open', '10.5555/closed', '10.5555/gone', '10.5555/adapter'], 'every DOI without a confirmed oa_url, except a DataCite arXiv DOI');
  assert.equal(targets[0]!.oa_url, 'https://example.org/open.pdf');
  assert.equal(targets[1]!.oa_url, undefined);
  assert.equal(targets[5]!.oa_url, undefined, 'Unpaywall has no PDF: the adapter link does not become oa_url');
  assert.equal(targets[6]!.oa_url, undefined);
  assert.deepEqual(s, { asked: 4, found: 1, problem: null });
  assert.equal(describeOpenAccess(s), 'open access: 1 of 4 source(s) with a DOI have an open-access PDF (Unpaywall)');
});

test('GRND-14: a failed or offline lookup is reported, never a gate; offline stops asking', async () => {
  const failed = await enrichOpenAccess([{ doi: '10.5555/x' }], { lookup: async () => lookupFailed('HTTP 503 after retries') });
  assert.deepEqual(failed, { asked: 1, found: 0, problem: 'Unpaywall lookup failed: HTTP 503 after retries' });
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
    assert.deepEqual(s, { asked: 1, found: 0, problem: 'not looked up: Unpaywall needs a contact email (set PENSMITH_CONTACT_EMAIL)' });
  } finally {
    if (saved !== undefined) process.env['PENSMITH_CONTACT_EMAIL'] = saved;
  }
});

test('GRND-14 (built CLI): `add` of an open-access DOI records its OA PDF as oa_url (recorded Crossref + Unpaywall)', () => {
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
