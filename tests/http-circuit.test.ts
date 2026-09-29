// tests/http-circuit.test.ts — SRC-17 (D-19-08): the per-host circuit breaker.
//
//   - 3 consecutive 5xx RESPONSES (retries count) open the breaker:
//     CircuitOpenError, one stderr line for the host, and the host is skipped
//     for the rest of the run — a 3-query loop makes ≤ 3 requests to it;
//   - a 429 counts once per REQUEST, when the request is still throttled after
//     its retries (review round 3): one throttled request never opens the
//     breaker; three in a row do;
//   - any other answer resets the count;
//   - after 10 minutes an open breaker lets ONE probe through: success closes
//     it, failure re-opens it;
//   - fixture answers never count, and model requests are outside the breaker.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installMockAgent, type InstalledMockAgent } from './helpers/local-servers/mock-agent.js';
import {
  fetch as httpFetch,
  CircuitOpenError,
  BREAKER_THRESHOLD,
  BREAKER_HALF_OPEN_MS,
  isHostUnavailableError,
  _resetHostStateForTest,
} from '../bin/lib/http.js';
import { errorFailureReason } from '../bin/lib/sources/search-failure.js';
import { closeSessionLog } from '../bin/lib/session-log.js';

async function lane<T>(fn: (m: InstalledMockAgent) => Promise<T>, live = true): Promise<T> {
  const data = mkdtempSync(join(tmpdir(), 'pensmith-circuit-'));
  const vars: Record<string, string | undefined> = {
    PENSMITH_NETWORK_TESTS: live ? '1' : undefined,
    PENSMITH_OFFLINE: undefined,
    LOCALAPPDATA: data,
    XDG_DATA_HOME: data,
    HOME: data,
  };
  const saved = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetHostStateForTest();
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
    await closeSessionLog();
    rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

async function quiet<T>(fn: () => Promise<T>): Promise<{ result: T; err: string }> {
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

test('SRC-17: 3 consecutive 503s open the breaker; a 3-query loop makes ≤ 3 requests to that host and prints one line', async () => {
  await lane(async (m) => {
    let requests = 0;
    m.agent.get('https://api.semanticscholar.org').intercept({ path: /.*/, method: 'GET' }).reply(() => {
      requests += 1;
      return { statusCode: 503, data: 'unavailable' };
    }).persist();
    const reasons: string[] = [];
    const { err } = await quiet(async () => {
      for (const q of ['attention', 'transformers', 'sequence models']) {
        try {
          await httpFetch(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}`, { source: 'semanticscholar', noCache: true });
          assert.fail('a failing host never answers');
        } catch (e) {
          assert.ok(e instanceof CircuitOpenError, `CircuitOpenError, got ${String(e)}`);
          assert.ok(isHostUnavailableError(e));
          reasons.push(errorFailureReason(e));
        }
      }
      return undefined;
    });
    assert.ok(requests <= BREAKER_THRESHOLD, `≤ 3 requests to the failing host, got ${requests}`);
    assert.equal(requests, 3, 'the first query used its retries up to the threshold; the others sent nothing');
    assert.deepEqual(reasons, Array(3).fill('skipped after 3 consecutive HTTP 503 responses'));
    const lines = err.split('\n').filter((l) => l.includes('api.semanticscholar.org'));
    assert.equal(lines.length, 1, `one stderr line for the host: ${JSON.stringify(err)}`);
    assert.equal(lines[0], 'pensmith: api.semanticscholar.org: skipped for the rest of this run after 3 consecutive HTTP 503 responses');
  });
});

test('SRC-17 (review round 3): a request\'s own 429 retries are ONE strike; three requests in a row still throttled open the breaker, the fourth sends nothing', async () => {
  await lane(async (m) => {
    let requests = 0;
    m.agent.get('https://api.example-429.org').intercept({ path: /.*/, method: 'GET' }).reply(() => {
      requests += 1;
      // An explicit `Retry-After: 0` is honoured as "now" (no one-second hold).
      return { statusCode: 429, data: 'slow down', responseOptions: { headers: { 'retry-after': '0' } } };
    }).persist();
    const get = (i: number): Promise<unknown> => httpFetch(`https://api.example-429.org/x${i}`, { source: 'generic', noCache: true });
    const { err } = await quiet(async () => {
      for (let i = 0; i < 2; i += 1) {
        await assert.rejects(() => get(i), (e: unknown) => {
          assert.ok(!(e instanceof CircuitOpenError), `request ${i} ends as its own HTTP 429, not an open breaker (${String(e)})`);
          assert.equal((e as { status?: number }).status, 429);
          return true;
        });
      }
      assert.equal(requests, 10, 'each of the first two requests used all 5 of its attempts');
      await assert.rejects(() => get(2), (e: unknown) => {
        assert.ok(e instanceof CircuitOpenError, `the third throttled request opens the breaker, got ${String(e)}`);
        assert.equal(e.lastStatus, 429);
        assert.equal(e.failures, BREAKER_THRESHOLD);
        assert.equal(errorFailureReason(e), 'skipped after 3 requests in a row throttled (HTTP 429)');
        return true;
      });
      assert.equal(requests, 15);
      await assert.rejects(() => get(3), CircuitOpenError);
      assert.equal(requests, 15, 'an open breaker sends nothing');
      return undefined;
    });
    const lines = err.split('\n').filter((l) => l.includes('api.example-429.org'));
    assert.deepEqual(lines, ['pensmith: api.example-429.org: skipped for the rest of this run after 3 requests in a row throttled (HTTP 429)']);
  });
});

test('SRC-17 (review round 3): one throttled request whose retry succeeds never opens the breaker — the host keeps serving', async () => {
  await lane(async (m) => {
    const pool = m.agent.get('https://api.throttled-once.example.org');
    let requests = 0;
    const reply = (status: number) => (): { statusCode: number; data: string; responseOptions: { headers: Record<string, string> } } => {
      requests += 1;
      return { statusCode: status, data: status === 200 ? 'ok' : 'slow down', responseOptions: { headers: { 'retry-after': '0' } } };
    };
    for (let round = 0; round < 4; round += 1) {
      // Twice throttled, then served: repeated for four requests in a row.
      pool.intercept({ path: `/r${round}`, method: 'GET' }).reply(reply(429)).times(2);
      pool.intercept({ path: `/r${round}`, method: 'GET' }).reply(reply(200));
    }
    for (let round = 0; round < 4; round += 1) {
      const res = await httpFetch(`https://api.throttled-once.example.org/r${round}`, { source: 'generic', noCache: true });
      assert.equal(res.status, 200, `round ${round} recovers after its own 429s`);
    }
    assert.equal(requests, 12);
  });
});

test('SRC-17 (review round 3): a half-open probe answered 429 re-opens the breaker at once', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  await lane(async (m) => {
    const pool = m.agent.get('https://api.probe-429.example.org');
    let requests = 0;
    pool.intercept({ path: '/x', method: 'GET' }).reply(() => {
      requests += 1;
      return { statusCode: 429, data: 'slow down', responseOptions: { headers: { 'retry-after': '0' } } };
    }).persist();
    const once = (): Promise<unknown> => httpFetch('https://api.probe-429.example.org/x', { source: 'generic', noCache: true, noRetry: true });
    // noRetry: each request is one answer and, throttled, one strike.
    assert.equal(((await once()) as { status: number }).status, 429);
    assert.equal(((await once()) as { status: number }).status, 429);
    await quiet(() => assert.rejects(once, CircuitOpenError));
    assert.equal(requests, 3);
    t.mock.timers.tick(BREAKER_HALF_OPEN_MS);
    await quiet(() => assert.rejects(once, CircuitOpenError));
    assert.equal(requests, 4, 'exactly one probe');
    await assert.rejects(once, CircuitOpenError);
    assert.equal(requests, 4, 'the throttled probe re-opened the breaker');
  });
});

test('SRC-17: a successful answer resets the count — interleaved failures never open the breaker', async () => {
  await lane(async (m) => {
    const pool = m.agent.get('https://api.flaky.example.org');
    for (let round = 0; round < 3; round += 1) {
      pool.intercept({ path: `/r${round}`, method: 'GET' }).reply(502, 'bad gateway');
      pool.intercept({ path: `/r${round}`, method: 'GET' }).reply(502, 'bad gateway');
      pool.intercept({ path: `/r${round}`, method: 'GET' }).reply(200, 'ok');
    }
    for (let round = 0; round < 3; round += 1) {
      const res = await httpFetch(`https://api.flaky.example.org/r${round}`, { source: 'generic', noCache: true });
      assert.equal(res.status, 200, `round ${round} recovers after two failures`);
    }
    // A 404 is an answer too.
    pool.intercept({ path: '/missing', method: 'GET' }).reply(404, 'nope');
    assert.equal((await httpFetch('https://api.flaky.example.org/missing', { source: 'generic', noCache: true })).status, 404);
  });
});

test('SRC-17: after 10 minutes an open breaker lets ONE probe through — success closes it, failure re-opens it', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  await lane(async (m) => {
    const pool = m.agent.get('https://api.recovering.example.org');
    let requests = 0;
    const fail = (): { statusCode: number; data: string } => {
      requests += 1;
      return { statusCode: 500, data: 'down' };
    };
    pool.intercept({ path: '/x', method: 'GET' }).reply(fail).times(3);
    // noRetry: each fetch is one response. The first two 500s are returned to
    // the caller; the third consecutive one opens the breaker.
    const once = (): Promise<unknown> => httpFetch('https://api.recovering.example.org/x', { source: 'generic', noCache: true, noRetry: true });
    assert.equal(((await once()) as { status: number }).status, 500);
    assert.equal(((await once()) as { status: number }).status, 500);
    await quiet(() => assert.rejects(once, CircuitOpenError));
    assert.equal(requests, 3);

    // Still open 9 minutes later: fail fast, nothing sent.
    t.mock.timers.tick(9 * 60_000);
    await assert.rejects(() => httpFetch('https://api.recovering.example.org/x', { source: 'generic', noCache: true, noRetry: true }), CircuitOpenError);
    assert.equal(requests, 3);

    // Half-open: one probe goes out and fails → re-opened at once.
    t.mock.timers.tick(BREAKER_HALF_OPEN_MS);
    pool.intercept({ path: '/x', method: 'GET' }).reply(fail);
    await quiet(() => assert.rejects(() => httpFetch('https://api.recovering.example.org/x', { source: 'generic', noCache: true, noRetry: true }), CircuitOpenError));
    assert.equal(requests, 4, 'exactly one probe');
    await assert.rejects(() => httpFetch('https://api.recovering.example.org/x', { source: 'generic', noCache: true, noRetry: true }), CircuitOpenError);
    assert.equal(requests, 4, 'the failed probe re-opened the breaker');

    // Another 10 minutes: the probe succeeds → closed, normal traffic resumes.
    t.mock.timers.tick(BREAKER_HALF_OPEN_MS);
    pool.intercept({ path: '/x', method: 'GET' }).reply(200, 'back').times(2);
    assert.equal((await httpFetch('https://api.recovering.example.org/x', { source: 'generic', noCache: true, noRetry: true })).status, 200);
    assert.equal((await httpFetch('https://api.recovering.example.org/x', { source: 'generic', noCache: true, noRetry: true })).status, 200);
  });
});

test('SRC-17: fixture answers never count — an offline 503 fixture replayed five times leaves the host closed', async () => {
  // Sources offline (the test runner without the live lane): answers come
  // from tests/fixtures/cassettes/synthetic/net/.
  await lane(async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await httpFetch('https://unavailable.pensmith.test/service', { source: 'generic', noCache: true });
      assert.equal(res.status, 503);
      assert.equal(res.fixture, true);
    }
  }, false);
  // Live lane: the same host is not open (a fixture answer never touched it).
  await lane(async (m) => {
    m.agent.get('https://unavailable.pensmith.test').intercept({ path: '/service', method: 'GET' }).reply(200, 'up');
    const res = await httpFetch('https://unavailable.pensmith.test/service', { source: 'generic', noCache: true });
    assert.equal(res.status, 200);
  });
});

test('SRC-17: model requests are outside the breaker — provider 529s are returned for anthropic.ts to classify', async () => {
  await lane(async (m) => {
    m.agent.get('https://llm.example.org').intercept({ path: '/v1/messages', method: 'POST' }).reply(529, '{"type":"error"}').times(4);
    for (let i = 0; i < 4; i += 1) {
      const res = await httpFetch('https://llm.example.org/v1/messages', { method: 'POST', body: '{}', noCache: true, noRetry: true, llm: { endpoint: 'https://llm.example.org' } });
      assert.equal(res.status, 529);
    }
  });
});
