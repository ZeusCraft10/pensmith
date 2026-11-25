// tests/sources/arxiv-https.test.ts
//
// Research search terms must never leave the machine in cleartext. The arXiv
// adapter used `http://export.arxiv.org`, so every query and ID lookup went out
// unencrypted. These tests drive the live (non-cassette) adapter path through
// bin/lib/http.ts against an undici MockAgent that only answers on
// https://export.arxiv.org and refuses every other connection, and check that
// no source adapter is left holding a plain-HTTP URL literal.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { _resetBucketsForTest } from '../../bin/lib/http.js';
import { search, fetchById } from '../../bin/lib/sources/arxiv.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const FEED = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<feed xmlns="http://www.w3.org/2005/Atom">',
  '<entry>',
  '<id>http://arxiv.org/abs/1706.03762v5</id>',
  '<title>Attention Is All You Need</title>',
  '<published>2017-06-12T00:00:00Z</published>',
  '<author><name>Ashish Vaswani</name></author>',
  '<arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.48550/arXiv.1706.03762</arxiv:doi>',
  '</entry>',
  '</feed>',
].join('\n');

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['PENSMITH_NETWORK_TESTS', 'XDG_DATA_HOME', 'LOCALAPPDATA', 'HOME'];
let prevDispatcher: Dispatcher;
let agent: MockAgent;

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  // The adapter's live path (not the cassette replay) is the one users run.
  process.env['PENSMITH_NETWORK_TESTS'] = '1';
  // A fresh, empty HTTP cache, so a response cached by another run can never
  // answer in place of the request this test makes.
  const data = mkdtempSync(path.join(tmpdir(), 'pensmith-arxiv-https-'));
  process.env['XDG_DATA_HOME'] = data;
  process.env['LOCALAPPDATA'] = data;
  process.env['HOME'] = data;
  _resetBucketsForTest();
  prevDispatcher = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect(); // anything but the https interceptor below fails
  setGlobalDispatcher(agent);
});

afterEach(async () => {
  setGlobalDispatcher(prevDispatcher);
  await agent.close();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

test('arXiv search goes to https://export.arxiv.org', async () => {
  agent
    .get('https://export.arxiv.org')
    // undici sorts query parameters before matching, so match on the parameter.
    .intercept({ path: (p) => p.startsWith('/api/query?') && p.includes('search_query=attention'), method: 'GET' })
    .reply(200, FEED, { headers: { 'content-type': 'application/atom+xml' } });
  const results = await search('attention mechanisms transformers');
  agent.assertNoPendingInterceptors();
  assert.equal(results.length, 1, 'the https response must be the one parsed');
  assert.equal(results[0]!.title, 'Attention Is All You Need');
});

test('arXiv ID lookup goes to https://export.arxiv.org', async () => {
  agent
    .get('https://export.arxiv.org')
    .intercept({ path: '/api/query?id_list=1706.03762', method: 'GET' })
    .reply(200, FEED, { headers: { 'content-type': 'application/atom+xml' } });
  const result = await fetchById('1706.03762');
  agent.assertNoPendingInterceptors();
  assert.equal(result?.doi, '10.48550/arXiv.1706.03762');
});

test('no source adapter holds a plain-HTTP URL literal', () => {
  const dir = path.join(repoRoot, 'bin', 'lib', 'sources');
  const offenders: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const src = readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/['"`]http:\/\/[^'"`\s]*/g)) offenders.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(offenders, [], 'every registry request must use https');
});
