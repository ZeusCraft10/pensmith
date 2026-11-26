// tests/lib/mock-registries.ts — the harness for in-process tests that answer
// registry requests with an undici MockAgent that refuses every connection it
// was not told to answer (tests/sources/registry-lookups.test.ts,
// tests/sources/retraction-signals.test.ts, tests/pass3-pdf-fetch.test.ts,
// tests/http-binary-body.test.ts).
//
// Not a test file (the runner collects only *.test.ts).

import { beforeEach, afterEach } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { _resetBucketsForTest } from '../../bin/lib/http.js';

const ENV_KEYS = ['PENSMITH_TEST_CASSETTES', 'PENSMITH_OFFLINE', 'PENSMITH_CONTACT_EMAIL', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'LOCALAPPDATA', 'HOME'];

export const JSON_HEADERS = { 'content-type': 'application/json' };

/**
 * Around each test of the calling file: live mode with no contact address,
 * a fresh, empty HTTP cache under a `tmpPrefix` folder (so nothing cached
 * answers in place of a request), fresh rate-limit buckets, and a MockAgent
 * as the global dispatcher. Everything is put back, and the folder removed,
 * afterwards. Returns the current test's agent.
 */
export function useMockRegistries(tmpPrefix: string): () => MockAgent {
  const savedEnv: Record<string, string | undefined> = {};
  let prevDispatcher: Dispatcher;
  let agent: MockAgent | undefined;
  let data: string | undefined;

  beforeEach(() => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    delete process.env['PENSMITH_TEST_CASSETTES'];
    delete process.env['PENSMITH_OFFLINE'];
    delete process.env['PENSMITH_CONTACT_EMAIL'];
    data = mkdtempSync(path.join(tmpdir(), tmpPrefix));
    for (const k of ['XDG_DATA_HOME', 'XDG_CACHE_HOME', 'LOCALAPPDATA', 'HOME']) process.env[k] = data;
    _resetBucketsForTest();
    prevDispatcher = getGlobalDispatcher();
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
  });

  afterEach(async () => {
    setGlobalDispatcher(prevDispatcher);
    await agent?.close();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    if (data) rmSync(data, { recursive: true, force: true });
    data = undefined;
  });

  return () => {
    if (!agent) throw new Error('useMockRegistries: no agent outside a test');
    return agent;
  };
}

/** Answer GET eutils esummary for `pmid` (and only that) with `status` and `body`. */
export function pubmedAnswers(
  agent: MockAgent,
  pmid: string,
  status: number,
  body: string,
  headers: Record<string, string> = JSON_HEADERS,
): void {
  agent.get('https://eutils.ncbi.nlm.nih.gov')
    .intercept({
      path: (p) => p.startsWith('/entrez/eutils/esummary.fcgi?') && p.includes(`id=${pmid}&`),
      method: 'GET',
    })
    .reply(status, body, { headers })
    .persist();
}
