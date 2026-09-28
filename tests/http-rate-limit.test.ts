// tests/http-rate-limit.test.ts — SRC-17 (D-19-08): per-host rate limits.
//
//   - token buckets are keyed per HOST and seeded from the source table: arXiv
//     is held to one request per 3 s; Crossref search, works and retraction
//     lookups share api.crossref.org's bucket;
//   - a scholarly API's `X-Rate-Limit-Limit` / `X-Rate-Limit-Interval` lowers
//     the host's rate (a `1` / `1s` header holds the next requests ≥ 1 s apart)
//     and never raises it; any other host's headers are ignored; a declared
//     rate slower than one request per 30 s marks the host exhausted (fail
//     fast); the wait for a token counts against the request's timeout;
//   - a Retry-After beyond the 30 s cap (keyless OpenAlex's `Retry-After:
//     22400`) is ONE attempt, one `rate limit exhausted (retry after ~6 h)`
//     stderr line, and zero further requests to that host in this process;
//   - Zotero's `Backoff` header holds the host.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installMockAgent, type InstalledMockAgent } from './helpers/local-servers/mock-agent.js';
import {
  fetch as httpFetch,
  RateLimitExhaustedError,
  RETRY_AFTER_CAP_MS,
  declaredRate,
  isHostUnavailableError,
  _resetHostStateForTest,
  _resetBucketsForTest,
  _resetWarnedForTest,
} from '../bin/lib/http.js';
import { errorFailureReason } from '../bin/lib/sources/search-failure.js';

async function lane<T>(fn: (m: InstalledMockAgent) => Promise<T>): Promise<T> {
  const data = mkdtempSync(join(tmpdir(), 'pensmith-ratelimit-'));
  const vars: Record<string, string | undefined> = {
    PENSMITH_NETWORK_TESTS: '1',
    PENSMITH_OFFLINE: undefined,
    LOCALAPPDATA: data,
    XDG_DATA_HOME: data,
    HOME: data,
    PENSMITH_CONTACT_EMAIL: 'pensmith-dev@example.org',
  };
  const saved = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetHostStateForTest();
  _resetWarnedForTest();
  const m = installMockAgent();
  try {
    return await fn(m);
  } finally {
    await m.restore().catch(() => undefined);
    _resetHostStateForTest();
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(data, { recursive: true, force: true });
  }
}

async function captureStderr<T>(fn: () => Promise<T>): Promise<{ result: T; err: string }> {
  const original = process.stderr.write.bind(process.stderr);
  let err = '';
  process.stderr.write = ((c: string | Uint8Array): boolean => {
    err += typeof c === 'string' ? c : Buffer.from(c).toString('utf8');
    return true;
  }) as typeof process.stderr.write;
  try {
    return { result: await fn(), err };
  } finally {
    process.stderr.write = original;
  }
}

const JSON_HEADERS = { 'content-type': 'application/json' };

test('SRC-17: declaredRate reads X-Rate-Limit-Limit / -Interval (1/1s → 1 rps; 50/1s; 60/1m; garbage → null)', () => {
  assert.equal(declaredRate({ 'x-rate-limit-limit': '1', 'x-rate-limit-interval': '1s' }), 1);
  assert.equal(declaredRate({ 'x-rate-limit-limit': '50', 'x-rate-limit-interval': '1s' }), 50);
  assert.equal(declaredRate({ 'x-rate-limit-limit': '60', 'x-rate-limit-interval': '1m' }), 1);
  assert.equal(declaredRate({ 'x-rate-limit-limit': '3', 'x-rate-limit-interval': '500ms' }), 6);
  assert.equal(declaredRate({ 'x-rate-limit-limit': '3' }), null);
  assert.equal(declaredRate({ 'x-rate-limit-limit': 'lots', 'x-rate-limit-interval': '1s' }), null);
  assert.equal(declaredRate({}), null);
});

test('SRC-17: `x-rate-limit-limit: 1` / `x-rate-limit-interval: 1s` holds the host to ≤ 1 request per second (timestamps)', async () => {
  await lane(async (m) => {
    const at: number[] = [];
    m.agent
      .get('https://api.crossref.org')
      .intercept({ path: /^\/works\/10\.5555%2Frate\d$/, method: 'GET' })
      .reply(() => {
        at.push(Date.now());
        return { statusCode: 200, data: '{}', responseOptions: { headers: { ...JSON_HEADERS, 'x-rate-limit-limit': '1', 'x-rate-limit-interval': '1s' } } };
      })
      .times(3);
    // Crossref is seeded at 3 rps; its own header lowers it to 1 rps.
    for (let i = 0; i < 3; i += 1) {
      await httpFetch(`https://api.crossref.org/works/10.5555%2Frate${i}`, { source: 'crossref', noCache: true });
    }
    assert.equal(at.length, 3);
    const gaps = [at[1]! - at[0]!, at[2]! - at[1]!];
    for (const g of gaps) assert.ok(g >= 950, `requests after the header are ≥ 1 s apart, got ${gaps.join(', ')} ms`);
  });
});

test('SRC-17: a host that is not a scholarly API cannot lower the rate with X-Rate-Limit headers', async () => {
  await lane(async (m) => {
    const at: number[] = [];
    m.agent
      .get('https://pdfs.example.org')
      .intercept({ path: /^\/p\/\d\.pdf$/, method: 'GET' })
      .reply(() => {
        at.push(Date.now());
        return { statusCode: 200, data: '%PDF-1.4', responseOptions: { headers: { 'content-type': 'application/pdf', 'x-rate-limit-limit': '1', 'x-rate-limit-interval': '100h' } } };
      })
      .times(3);
    const started = Date.now();
    for (let i = 0; i < 3; i += 1) await httpFetch(`https://pdfs.example.org/p/${i}.pdf`, { source: 'generic', noCache: true });
    assert.equal(at.length, 3);
    assert.ok(Date.now() - started < 3000, `the generic host kept its own seed (${Date.now() - started} ms for 3 requests)`);
  });
});

test('SRC-17: a declared rate slower than one request per 30 s marks the host exhausted — fail fast, never a sleep', async () => {
  await lane(async (m) => {
    let n = 0;
    m.agent
      .get('https://api.crossref.org')
      .intercept({ path: /^\/works\//, method: 'GET' })
      .reply(() => {
        n += 1;
        return { statusCode: 200, data: '{}', responseOptions: { headers: { ...JSON_HEADERS, 'x-rate-limit-limit': '1', 'x-rate-limit-interval': '100h' } } };
      })
      .persist();
    const { result, err } = await captureStderr(async () => {
      const first = await httpFetch('https://api.crossref.org/works/10.5555%2Fslow1', { source: 'crossref', noCache: true });
      const started = Date.now();
      const second = await httpFetch('https://api.crossref.org/works/10.5555%2Fslow2', { source: 'crossref', noCache: true }).then(
        () => null,
        (e: unknown) => e,
      );
      return { first, second, ms: Date.now() - started };
    });
    assert.equal(result.first.status, 200, 'the answer that declared the rate is returned');
    assert.ok(result.second instanceof RateLimitExhaustedError, String(result.second));
    assert.ok(result.ms < 1000, `failed fast (${result.ms} ms)`);
    assert.equal(n, 1, 'no second request');
    assert.match(err, /api\.crossref\.org: rate limit exhausted \(retry after ~4 d\)/, "100 h, rounded to days");
  });
});

test('SRC-17: waiting for the host\'s token counts against the request timeout (never a hang)', async () => {
  await lane(async (m) => {
    m.agent
      .get('https://export.arxiv.org')
      .intercept({ path: /^\/api\/query\?id_list=/, method: 'GET' })
      .reply(200, '<feed/>', { headers: { 'content-type': 'application/atom+xml' } })
      .persist();
    await httpFetch('https://export.arxiv.org/api/query?id_list=t1', { source: 'arxiv', noCache: true });
    // arXiv's bucket grants the next token 3 s later; this request allows 500 ms.
    const started = Date.now();
    await assert.rejects(
      () => httpFetch('https://export.arxiv.org/api/query?id_list=t2', { source: 'arxiv', noCache: true, timeoutMs: 500 }),
      (e: unknown) => isHostUnavailableError(e) && /export\.arxiv\.org: rate limit exhausted/.test((e as Error).message),
    );
    assert.ok(Date.now() - started < 2000, `gave up within the timeout (${Date.now() - started} ms)`);
  });
});

test('SRC-17: a declared rate never RAISES a host above its seed (arXiv stays at one request per 3 s)', async () => {
  await lane(async (m) => {
    const at: number[] = [];
    m.agent
      .get('https://export.arxiv.org')
      .intercept({ path: /^\/api\/query\?id_list=\d$/, method: 'GET' })
      .reply(() => {
        at.push(Date.now());
        return { statusCode: 200, data: '<feed/>', responseOptions: { headers: { 'content-type': 'application/atom+xml', 'x-rate-limit-limit': '100', 'x-rate-limit-interval': '1s' } } };
      })
      .times(2);
    await httpFetch('https://export.arxiv.org/api/query?id_list=1', { source: 'arxiv', noCache: true });
    await httpFetch('https://export.arxiv.org/api/query?id_list=2', { source: 'arxiv', noCache: true });
    const gap = at[1]! - at[0]!;
    assert.ok(gap >= 2900, `arXiv's floor is one request every 3 s even when a header says 100/s (gap ${gap} ms)`);
  });
});

test('SRC-17: buckets are per host — Crossref works and retraction lookups share api.crossref.org, another host is not held', async () => {
  await lane(async (m) => {
    const crossref: number[] = [];
    const other: number[] = [];
    m.agent.get('https://api.crossref.org').intercept({ path: /^\/works/, method: 'GET' }).reply(() => {
      crossref.push(Date.now());
      return { statusCode: 200, data: '{"status":"ok","message-type":"work","message":{}}', responseOptions: { headers: { ...JSON_HEADERS, 'x-rate-limit-limit': '1', 'x-rate-limit-interval': '1s' } } };
    }).times(2);
    m.agent.get('https://api.openalex.org').intercept({ path: /^\/works/, method: 'GET' }).reply(() => {
      other.push(Date.now());
      return { statusCode: 200, data: '{"results":[]}', responseOptions: { headers: JSON_HEADERS } };
    }).times(3);
    await httpFetch('https://api.crossref.org/works/10.1%2Fa', { source: 'crossref', noCache: true });
    const t0 = Date.now();
    for (let i = 0; i < 3; i += 1) await httpFetch(`https://api.openalex.org/works?search=q${i}`, { source: 'openalex', noCache: true });
    assert.ok(Date.now() - t0 < 900, 'OpenAlex is not held by Crossref\'s declared rate');
    await httpFetch('https://api.crossref.org/works?filter=updates%3A10.1%2Fa', { source: 'retraction-watch', noCache: true });
    assert.ok(crossref[1]! - crossref[0]! >= 950, 'the retraction lookup waited on the shared api.crossref.org bucket');
  });
});

test('SRC-17: Retry-After: 22400 → one attempt, one `rate limit exhausted (retry after ~6 h)` line, then 0 requests to that host', async () => {
  await lane(async (m) => {
    let requests = 0;
    m.agent.get('https://api.openalex.org').intercept({ path: /^\/works/, method: 'GET' }).reply(() => {
      requests += 1;
      return { statusCode: 429, data: '{"error":"Insufficient budget"}', responseOptions: { headers: { ...JSON_HEADERS, 'retry-after': '22400', 'x-ratelimit-remaining-usd': '0' } } };
    }).persist();
    const { err } = await captureStderr(async () => {
      for (const q of ['q1', 'q2', 'q3']) {
        await assert.rejects(
          () => httpFetch(`https://api.openalex.org/works?search=${q}`, { source: 'openalex', noCache: true }),
          (e: unknown) => {
            assert.ok(e instanceof RateLimitExhaustedError, String(e));
            assert.ok(isHostUnavailableError(e));
            assert.equal(e.host, 'api.openalex.org');
            assert.equal(e.status, 429);
            assert.match(e.message, /rate limit exhausted \(retry after ~6 h\)/);
            assert.equal(errorFailureReason(e), 'rate limit exhausted (retry after ~6 h)');
            return true;
          },
        );
      }
      return undefined;
    });
    assert.equal(requests, 1, 'a single attempt: never retried, and the later queries send nothing');
    const lines = err.split('\n').filter((l) => l.includes('rate limit exhausted'));
    assert.equal(lines.length, 1, `exactly one stderr line: ${JSON.stringify(err)}`);
    assert.match(lines[0]!, /^pensmith: api\.openalex\.org: rate limit exhausted \(retry after ~6 h\)/);
  });
});

test('SRC-17: an exhausted host fails fast while other hosts keep working; _resetHostStateForTest clears it', async () => {
  await lane(async (m) => {
    m.agent.get('https://api.semanticscholar.org').intercept({ path: /.*/, method: 'GET' }).reply(429, '{}', { headers: { 'retry-after': '3600' } });
    m.agent.get('https://api.crossref.org').intercept({ path: /.*/, method: 'GET' }).reply(200, '{"status":"ok","message-type":"work-list","message":{"items":[]}}', { headers: JSON_HEADERS });
    await captureStderr(() => assert.rejects(() => httpFetch('https://api.semanticscholar.org/graph/v1/paper/search?query=a', { source: 'semanticscholar', noCache: true }), RateLimitExhaustedError));
    await assert.rejects(() => httpFetch('https://api.semanticscholar.org/graph/v1/paper/search?query=b', { source: 'semanticscholar', noCache: true }), (e: unknown) => {
      assert.ok(e instanceof RateLimitExhaustedError);
      assert.match(e.message, /retry after ~(59|60) min/);
      return true;
    });
    const ok = await httpFetch('https://api.crossref.org/works?query=a', { source: 'crossref', noCache: true });
    assert.equal(ok.status, 200);
    _resetHostStateForTest();
    m.agent.get('https://api.semanticscholar.org').intercept({ path: /.*/, method: 'GET' }).reply(200, '{"data":[]}', { headers: JSON_HEADERS });
    const again = await httpFetch('https://api.semanticscholar.org/graph/v1/paper/search?query=c', { source: 'semanticscholar', noCache: true });
    assert.equal(again.status, 200, 'the reset host is asked again');
  });
});

test('SRC-17: a Retry-After within the 30 s cap is honoured and retried (not exhausted)', async () => {
  await lane(async (m) => {
    const pool = m.agent.get('https://api.crossref.org');
    pool.intercept({ path: '/works/10.1%2Fra', method: 'GET' }).reply(429, '{}', { headers: { 'retry-after': '1' } });
    pool.intercept({ path: '/works/10.1%2Fra', method: 'GET' }).reply(200, '{"status":"ok","message-type":"work","message":{}}', { headers: JSON_HEADERS });
    const t0 = Date.now();
    const res = await httpFetch('https://api.crossref.org/works/10.1%2Fra', { source: 'crossref', noCache: true });
    assert.equal(res.status, 200);
    assert.ok(Date.now() - t0 >= 900);
    assert.ok(RETRY_AFTER_CAP_MS === 30_000);
  });
});

test('SRC-17: an HTTP-date Retry-After days away also marks the host exhausted', async () => {
  await lane(async (m) => {
    const when = new Date(Date.now() + 2 * 86_400_000).toUTCString();
    m.agent.get('https://api.unpaywall.org').intercept({ path: /.*/, method: 'GET' }).reply(503, 'busy', { headers: { 'retry-after': when } });
    await captureStderr(() =>
      assert.rejects(() => httpFetch('https://api.unpaywall.org/v2/10.1%2Fx', { source: 'unpaywall', noCache: true }), (e: unknown) => {
        assert.ok(e instanceof RateLimitExhaustedError);
        assert.equal(e.status, 503);
        assert.match(e.message, /retry after ~(2 d|4\d h)/);
        return true;
      }),
    );
  });
});

test('SRC-17: Zotero `Backoff: 1` holds the next request to that host ≥ 1 s', async () => {
  await lane(async (m) => {
    const at: number[] = [];
    m.agent.get('https://api.zotero.org').intercept({ path: /^\/users\/1\/items/, method: 'GET' }).reply(() => {
      at.push(Date.now());
      return { statusCode: 200, data: '[]', responseOptions: { headers: { ...JSON_HEADERS, backoff: '1' } } };
    }).times(2);
    await httpFetch('https://api.zotero.org/users/1/items?start=0', { source: 'zotero', noCache: true });
    await httpFetch('https://api.zotero.org/users/1/items?start=25', { source: 'zotero', noCache: true });
    assert.ok(at[1]! - at[0]! >= 950, `Backoff held the host (${at[1]! - at[0]!} ms)`);
  });
});

test('SRC-17: a Backoff beyond the cap marks the host exhausted — the answered request still returns', async () => {
  await lane(async (m) => {
    let n = 0;
    m.agent.get('https://api.zotero.org').intercept({ path: /.*/, method: 'GET' }).reply(() => {
      n += 1;
      return { statusCode: 200, data: '[]', responseOptions: { headers: { ...JSON_HEADERS, backoff: '600' } } };
    }).persist();
    const { result } = await captureStderr(() => httpFetch('https://api.zotero.org/users/1/items', { source: 'zotero', noCache: true }));
    assert.equal(result.status, 200, 'the answer that carried Backoff is returned');
    await assert.rejects(() => httpFetch('https://api.zotero.org/users/1/items?start=25', { source: 'zotero', noCache: true }), RateLimitExhaustedError);
    assert.equal(n, 1);
  });
});

test('SRC-17: _resetBucketsForTest resets the per-host state too (buckets are per host)', async () => {
  await lane(async (m) => {
    m.agent.get('https://api.openalex.org').intercept({ path: /.*/, method: 'GET' }).reply(429, '{}', { headers: { 'retry-after': '99999' } });
    await captureStderr(() => assert.rejects(() => httpFetch('https://api.openalex.org/works?search=x', { source: 'openalex', noCache: true }), RateLimitExhaustedError));
    _resetBucketsForTest();
    m.agent.get('https://api.openalex.org').intercept({ path: /.*/, method: 'GET' }).reply(200, '{"results":[]}', { headers: JSON_HEADERS });
    const res = await httpFetch('https://api.openalex.org/works?search=y', { source: 'openalex', noCache: true });
    assert.equal(res.status, 200);
  });
});
