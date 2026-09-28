// tests/http-session-records.test.ts — RUN-15 (http half) / RUN-02 / D-17-13:
// every request through the http.ts egress gate leaves one kind:"http" session
// record — fixture-served, refused, live miss and cache hit alike — written to
// .paper/SESSION.log when the cwd is a paper, else the global session.log.
// Records carry the network mode (`offline: true` whenever sources are
// offline), redact secret query params, drop contact params, and never carry a
// header.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fetch as httpFetch,
  isOfflineEgressError,
  _resetBucketsForTest,
  _resetHttpLoggersForTest,
} from '../bin/lib/http.js';
import { closeSessionLog } from '../bin/lib/session-log.js';
import { pensmithDataDir } from '../bin/lib/paths.js';
import { installMockAgent } from './helpers/local-servers/mock-agent.js';

const SENTINEL = 'sk-sentinel-http-records-5a4b3c';

interface HttpRecord {
  kind: string;
  run_id?: string;
  source: string;
  method: string;
  url: string;
  offline: boolean;
  status: number | null;
  cache: 'hit' | 'miss' | 'fixture' | 'refused';
  bytes: number;
  ms: number;
  error?: string;
}

/** An isolated data dir + a cwd (with or without .paper) for the duration of `fn`. */
async function isolated<T>(opts: { paper: boolean }, fn: (logFile: string) => Promise<T>): Promise<T> {
  const data = mkdtempSync(join(tmpdir(), 'pensmith-http-records-data-'));
  const cwd = mkdtempSync(join(tmpdir(), 'pensmith-http-records-cwd-'));
  if (opts.paper) mkdirSync(join(cwd, '.paper'), { recursive: true });
  const saved = { lad: process.env.LOCALAPPDATA, xdg: process.env.XDG_DATA_HOME, home: process.env.HOME, cwd: process.cwd() };
  process.env.LOCALAPPDATA = data;
  process.env.XDG_DATA_HOME = data;
  process.env.HOME = data;
  process.chdir(cwd);
  _resetHttpLoggersForTest();
  _resetBucketsForTest();
  const logFile = opts.paper ? join(cwd, '.paper', 'SESSION.log') : join(pensmithDataDir(), 'session.log');
  try {
    return await fn(logFile);
  } finally {
    await closeSessionLog();
    _resetHttpLoggersForTest();
    process.chdir(saved.cwd);
    for (const [k, v] of [['LOCALAPPDATA', saved.lad], ['XDG_DATA_HOME', saved.xdg], ['HOME', saved.home]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function records(logFile: string): Promise<HttpRecord[]> {
  await closeSessionLog();
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as HttpRecord)
    .filter((r) => r.kind === 'http');
}

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('D-17-13: a fixture-served request records cache:"fixture", offline:true, status and bytes (global log without a paper)', async () => {
  await isolated({ paper: false }, async (logFile) => {
    const res = await httpFetch('https://api.crossref.org/works/10.1038%2Fnphys1170', { source: 'crossref' });
    const [r, ...rest] = await records(logFile);
    assert.deepEqual(rest, []);
    assert.ok(r, `one kind:"http" record in ${logFile}`);
    assert.equal(r.source, 'crossref');
    assert.equal(r.method, 'GET');
    assert.equal(r.url, 'https://api.crossref.org/works/10.1038%2Fnphys1170');
    assert.equal(r.offline, true, 'RUN-02: the record says the run was offline');
    assert.equal(r.cache, 'fixture');
    assert.equal(r.status, 200);
    assert.equal(r.bytes, res.bodyBytes?.length);
    assert.equal(typeof r.ms, 'number');
    assert.equal(typeof r.run_id, 'string');
  });
});

test('D-17-13: a refused request (offline miss) records cache:"refused", status:null and the reason', async () => {
  await isolated({ paper: true }, async (logFile) => {
    await assert.rejects(
      httpFetch('https://api.crossref.org/works/10.9999%2Fnot-recorded', { source: 'crossref' }),
      (e: unknown) => isOfflineEgressError(e),
    );
    const [r] = await records(logFile);
    assert.ok(r, `the record lands in the paper's .paper/SESSION.log (${logFile})`);
    assert.equal(r.cache, 'refused');
    assert.equal(r.status, null);
    assert.equal(r.offline, true);
    assert.match(r.error ?? '', /offline: no recorded fixture for GET https:\/\/api\.crossref\.org\/works\/10\.9999%2Fnot-recorded — re-run online/);
  });
});

test('D-17-13: a --dry-run refusal is recorded too (offline:true, refused, dry-run reason)', async () => {
  await isolated({ paper: false }, async (logFile) => {
    await withEnv({ PENSMITH_DRY_RUN: '1' }, async () => {
      await assert.rejects(
        httpFetch('https://api.crossref.org/works/10.1038%2Fnphys1170', { source: 'crossref' }),
        (e: unknown) => isOfflineEgressError(e),
      );
    });
    const [r] = await records(logFile);
    assert.equal(r?.cache, 'refused');
    assert.equal(r?.offline, true);
    assert.match(r?.error ?? '', /^dry-run: no network request is made/);
  });
});

test('D-17-13: live requests record cache:"miss" then cache:"hit"; secrets redacted, contact dropped, no header', async () => {
  await isolated({ paper: false }, async (logFile) => {
    await withEnv({ PENSMITH_NETWORK_TESTS: '1' }, async () => {
      const { agent, restore } = installMockAgent();
      agent
        .get('https://api.openalex.org')
        .intercept({ path: /^\/works\?/, method: 'GET' })
        .reply(200, { results: [] }, { headers: { 'content-type': 'application/json' } })
        .persist();
      try {
        const url = `https://api.openalex.org/works?search=sagas&api_key=${SENTINEL}&mailto=someone%40example.org`;
        const opts = { source: 'openalex' as const, headers: { 'x-api-key': SENTINEL } };
        const a = await httpFetch(url, opts);
        const b = await httpFetch(url, opts);
        assert.equal(a.cached, false);
        assert.equal(b.cached, true);
      } finally {
        await restore();
      }
    });
    const rs = await records(logFile);
    assert.deepEqual(rs.map((r) => r.cache), ['miss', 'hit']);
    for (const r of rs) {
      assert.equal(r.offline, false, 'the live test lane is not offline');
      assert.equal(r.status, 200);
      assert.equal(r.url, 'https://api.openalex.org/works?search=sagas&api_key=REDACTED', 'secret redacted, contact param dropped');
    }
    const raw = readFileSync(logFile, 'utf8');
    assert.ok(!raw.includes(SENTINEL), 'no key (query param or header) is ever recorded');
    assert.ok(!raw.includes('someone'), 'the contact email is never recorded');
    assert.ok(!/x-api-key|user-agent/i.test(raw), 'no header is recorded');
  });
});

test('RUN-15: an http record keeps the DOI and host it requested — secrets are stripped, the PII patterns are not applied to the URL', async () => {
  await isolated({ paper: true }, async (logFile) => {
    await withEnv({ PENSMITH_NETWORK_TESTS: '1' }, async () => {
      const { agent, restore } = installMockAgent();
      agent
        .get('https://api.labs.crossref.org')
        .intercept({ path: /^\/data\/retractions\?/, method: 'GET' })
        .reply(200, { message: { items: [] } }, { headers: { 'content-type': 'application/json' } })
        .persist();
      try {
        await httpFetch(
          `https://user:pw@api.labs.crossref.org/data/retractions?filter=record%3A10.1002%2F9781118445112.ch5&mailto=someone%40example.org&api_key=${SENTINEL}`,
          { source: 'crossref' },
        );
      } finally {
        await restore();
      }
    });
    const [r] = await records(logFile);
    assert.ok(r, 'the request was recorded');
    assert.equal(
      r.url,
      'https://api.labs.crossref.org/data/retractions?filter=record%3A10.1002%2F9781118445112.ch5&api_key=REDACTED',
      'the DOI survives; userinfo, the contact email and the key do not',
    );
    const raw = readFileSync(logFile, 'utf8');
    assert.ok(!raw.includes('[REDACTED:'), 'no PII-pattern marker in an http record');
    assert.ok(!raw.includes(SENTINEL) && !raw.includes('someone') && !raw.includes('pw@'));
  });
});

test('PRIVACY: an offline miss with PENSMITH_CONTACT_EMAIL set never logs the address — raw or percent-encoded', async () => {
  await isolated({ paper: true }, async (logFile) => {
    await withEnv({ PENSMITH_CONTACT_EMAIL: 'jane.student@example.edu' }, async () => {
      await assert.rejects(
        httpFetch('https://api.openalex.org/works?search=sagas&mailto=jane.student%40example.edu', { source: 'openalex' }),
        (e: unknown) => {
          assert.ok(isOfflineEgressError(e));
          assert.ok(!(e as Error).message.includes('jane.student'), 'the user-facing message drops it too');
          return true;
        },
      );
    });
    const [r] = await records(logFile); // flushes the log
    assert.equal(r?.cache, 'refused', 'the refusal was recorded');
    const raw = readFileSync(logFile, 'utf8');
    assert.ok(!raw.includes('jane.student') && !raw.includes('jane.student%40example.edu'), `no contact email in SESSION.log: ${raw}`);
  });
});

test('PRIVACY: PENSMITH_CONTACT_EMAIL rides only in polite-pool User-Agents — never DuckDuckGo, GPTZero, a user URL or a PDF host', async () => {
  await isolated({ paper: false }, async () => {
    const seen = new Map<string, string>();
    await withEnv({ PENSMITH_NETWORK_TESTS: '1', PENSMITH_CONTACT_EMAIL: 'jane.student@example.edu' }, async () => {
      const { agent, restore } = installMockAgent();
      const hosts = ['https://api.crossref.org', 'https://api.openalex.org', 'https://api.unpaywall.org', 'https://html.duckduckgo.com', 'https://api.gptzero.me', 'https://some-publisher.example', 'https://export.arxiv.org'];
      for (const origin of hosts) {
        agent.get(origin).intercept({ path: /.*/, method: 'GET' }).reply((opts) => {
          const h = opts.headers as Record<string, string>;
          const ua = Object.entries(h).find(([k]) => k.toLowerCase() === 'user-agent')?.[1] ?? '';
          seen.set(origin, ua);
          return { statusCode: 200, data: '{}', responseOptions: { headers: { 'content-type': 'application/json' } } };
        });
      }
      try {
        const calls: Array<[string, Parameters<typeof httpFetch>[1]]> = [
          ['https://api.crossref.org/works/10.1%2Fx', { source: 'crossref', noCache: true }],
          ['https://api.openalex.org/works/W1', { source: 'openalex', noCache: true }],
          ['https://api.unpaywall.org/v2/10.1/x', { source: 'unpaywall', noCache: true }],
          ['https://html.duckduckgo.com/html/?q=x', { source: 'generic', noCache: true }],
          ['https://api.gptzero.me/v2/predict/text', { source: 'generic', noCache: true }],
          ['https://some-publisher.example/paper.pdf', { source: 'generic', noCache: true }],
          ['https://export.arxiv.org/api/query?id_list=1', { source: 'arxiv', noCache: true }],
        ];
        for (const [url, opts] of calls) await httpFetch(url, opts);
      } finally {
        await restore();
      }
    });
    for (const polite of ['https://api.crossref.org', 'https://api.openalex.org', 'https://api.unpaywall.org']) {
      assert.match(seen.get(polite) ?? '', /^pensmith\/\S+ \(jane\.student@example\.edu\)$/, polite);
    }
    for (const other of ['https://html.duckduckgo.com', 'https://api.gptzero.me', 'https://some-publisher.example', 'https://export.arxiv.org']) {
      assert.match(seen.get(other) ?? '(not called)', /^pensmith\/\S+$/, `${other} gets the plain User-Agent: ${seen.get(other)}`);
    }
  });
});
