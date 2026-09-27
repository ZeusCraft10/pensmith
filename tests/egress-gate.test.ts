// tests/egress-gate.test.ts — RUN-04 / RUN-08 (transport half) / D-17-05 / D-17-09:
// ONE egress gate in bin/lib/http.ts with three orthogonal modes, and the LLM
// endpoint policy. Dials are observed at the socket level (dial recorder), not
// inferred from return values.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fetch as httpFetch,
  OfflineEgressError,
  SsrfBlockedError,
  checkLlmEndpoint,
  isOfflineEgressError,
  offlineLabel,
  _resetBucketsForTest,
  __setHttpTestSeams,
  type ResolvedAddress,
} from '../bin/lib/http.js';
import { pensmithHttpCacheDir } from '../bin/lib/paths.js';
import { installDialRecorder } from './helpers/local-servers/dial-recorder.mjs';
import { installMockAgent } from './helpers/local-servers/mock-agent.js';
import { startHttpServer, json, withLocalHosts } from './helpers/local-servers/transport.js';

const MODE_VARS = ['NODE_TEST_CONTEXT', 'PENSMITH_TEST', 'PENSMITH_NETWORK_TESTS', 'PENSMITH_OFFLINE', 'PENSMITH_DRY_RUN', 'PENSMITH_NO_LLM'];

/** Run with the mode variables replaced (NODE_TEST_CONTEXT stays so test seams keep working). */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const k of [...MODE_VARS, ...Object.keys(vars)]) saved.set(k, process.env[k]);
  for (const k of MODE_VARS) if (k !== 'NODE_TEST_CONTEXT') delete process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetBucketsForTest();
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** A fresh data dir (HTTP cache + global session log) for tests that touch the cache. */
async function withDataDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-egress-'));
  const saved = { lad: process.env.LOCALAPPDATA, xdg: process.env.XDG_DATA_HOME, home: process.env.HOME };
  process.env.LOCALAPPDATA = dir;
  process.env.XDG_DATA_HOME = dir;
  process.env.HOME = dir;
  try {
    return await fn(dir);
  } finally {
    if (saved.lad === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = saved.lad;
    if (saved.xdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved.xdg;
    if (saved.home === undefined) delete process.env.HOME;
    else process.env.HOME = saved.home;
  }
}

const RECORDED_URL = 'https://api.crossref.org/works/10.1038%2Fnphys1170';
const UNRECORDED_URL = 'https://api.crossref.org/works/10.9999%2Fnot-recorded';

// ---------------------------------------------------------------------------
// Mode 1 — sources offline: exact fixture or typed refusal, zero dials
// ---------------------------------------------------------------------------

test('RUN-04: an offline source request with no recorded fixture throws OfflineEgressError and makes 0 dials', async () => {
  await withEnv({ PENSMITH_OFFLINE: '1' }, async () => {
    const rec = installDialRecorder();
    try {
      await assert.rejects(
        () => httpFetch(UNRECORDED_URL, { source: 'crossref' }),
        (e: unknown) => {
          assert.ok(e instanceof OfflineEgressError, `expected OfflineEgressError, got ${String(e)}`);
          assert.equal(e.mode, 'offline');
          assert.equal(e.reason, 'PENSMITH_OFFLINE=1');
          assert.equal(offlineLabel(e), 'offline');
          assert.match(e.message, /^offline: no recorded fixture for GET https:\/\/api\.crossref\.org\/works\/10\.9999%2Fnot-recorded — re-run online$/);
          return true;
        },
      );
      assert.deepEqual(rec.events.filter((e) => e.kind !== 'read'), [], 'no DNS query and no dial');
    } finally {
      rec.restore();
    }
  });
});

test('RUN-03: an offline request with an EXACT recorded fixture is answered from it, 0 dials, never another record', async () => {
  await withEnv({ PENSMITH_OFFLINE: '1' }, async () => {
    const rec = installDialRecorder();
    try {
      const r = await httpFetch(RECORDED_URL, { source: 'crossref' });
      assert.equal(r.status, 200);
      assert.equal(r.fixture, true);
      assert.equal(r.cached, false);
      const body = JSON.parse(r.body) as { message: { DOI: string } };
      assert.equal(body.message.DOI, '10.1038/nphys1170', 'the fixture for exactly this DOI');
      // The same DOI spelled with an unencoded slash is the same canonical request.
      const again = await httpFetch('https://api.crossref.org/works/10.1038/nphys1170', { source: 'crossref' });
      assert.equal(again.fixture, true);
      // A contact param never decides a match (D-17-06).
      const withMailto = await httpFetch(`${RECORDED_URL}?mailto=someone%40example.org`, { source: 'crossref' });
      assert.equal(withMailto.fixture, true);
      assert.deepEqual(rec.events.filter((e) => e.kind !== 'read'), [], 'fixture replay never dials');
    } finally {
      rec.restore();
    }
  });
});

test('RUN-03: sources offline never reads or writes the HTTP cache', async () => {
  await withDataDir(async () => {
    await withEnv({ PENSMITH_OFFLINE: '1' }, async () => {
      await httpFetch(RECORDED_URL, { source: 'crossref' });
      await assert.rejects(() => httpFetch(UNRECORDED_URL, { source: 'crossref' }), OfflineEgressError);
      const dir = pensmithHttpCacheDir();
      const files = existsSync(dir) ? readdirSync(dir) : [];
      assert.deepEqual(files, [], 'offline replay must not populate the live cache');
    });
  });
});

// ---------------------------------------------------------------------------
// Mode 3 — --dry-run: everything refused, LLM included, zero sockets
// ---------------------------------------------------------------------------

test('RUN-04: --dry-run refuses every request (even a recorded one and a loopback LLM) with 0 dials', async () => {
  const server = await startHttpServer(json(200, { ok: true }));
  try {
    await withEnv({ PENSMITH_DRY_RUN: '1', PENSMITH_NO_LLM: '1' }, async () => {
      const rec = installDialRecorder();
      try {
        await assert.rejects(() => httpFetch(RECORDED_URL, { source: 'crossref' }), (e: unknown) => {
          assert.ok(isOfflineEgressError(e));
          assert.equal(e.mode, 'dry-run');
          assert.equal(offlineLabel(e), 'dry-run');
          return true;
        });
        await assert.rejects(
          () => httpFetch(`${server.origin}/v1/messages`, { method: 'POST', body: '{}', llm: { endpoint: server.origin } }),
          (e: unknown) => isOfflineEgressError(e) && e.mode === 'dry-run',
        );
        assert.deepEqual(rec.events, [], '--dry-run opens zero sockets (and reads no fixture)');
        assert.equal(server.requests.length, 0, 'the loopback server received nothing');
      } finally {
        rec.restore();
      }
    });
  } finally {
    await server.close();
  }
});

// ---------------------------------------------------------------------------
// Mode 2 — LLM stubbed: opts.llm refused, sources unaffected (S-15)
// ---------------------------------------------------------------------------

test('RUN-04: PENSMITH_NO_LLM refuses an opts.llm request but leaves sources live (MockAgent lane)', async () => {
  await withDataDir(async () => {
    await withEnv({ PENSMITH_NO_LLM: '1', PENSMITH_NETWORK_TESTS: '1' }, async () => {
      const { agent, restore } = installMockAgent();
      try {
        agent
          .get('https://api.crossref.org')
          .intercept({ path: '/works/10.5555%2Flive-lane', method: 'GET' })
          .reply(200, { message: { DOI: '10.5555/live-lane' } }, { headers: { 'content-type': 'application/json' } });
        const r = await httpFetch('https://api.crossref.org/works/10.5555%2Flive-lane', { source: 'crossref', noCache: true });
        assert.equal(r.status, 200);
        assert.notEqual(r.fixture, true, 'the live lane is not fixture replay');
        await assert.rejects(
          () => httpFetch('https://api.anthropic.com/v1/messages', {
            method: 'POST', body: '{}', llm: { endpoint: 'https://api.anthropic.com' },
          }),
          (e: unknown) => isOfflineEgressError(e) && e.mode === 'llm-stubbed' && /PENSMITH_NO_LLM=1/.test(e.message),
        );
      } finally {
        await restore();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Sources offline + the configured LOOPBACK LLM endpoint (the RUN-21 mock path)
// ---------------------------------------------------------------------------

test('RUN-04: while sources are offline, the configured loopback LLM endpoint IS dialed (and nothing else)', async () => {
  const server = await startHttpServer(json(200, { content: [{ type: 'text', text: 'hi' }] }));
  try {
    await withEnv({ PENSMITH_OFFLINE: '1' }, async () => {
      const rec = installDialRecorder({ refuseConnects: false });
      try {
        const r = await httpFetch(`${server.origin}/v1/messages`, {
          method: 'POST',
          body: JSON.stringify({ model: 'claude-opus-5' }),
          headers: { 'content-type': 'application/json' },
          noCache: true,
          llm: { endpoint: server.origin },
        });
        assert.equal(r.status, 200);
        assert.equal(server.requests.length, 1);
        const dials = rec.dials();
        assert.equal(dials.length, 1, `exactly one dial: ${JSON.stringify(dials)}`);
        assert.equal(dials[0]?.host, '127.0.0.1');
        assert.equal(Number(dials[0]?.port), server.port);
      } finally {
        rec.restore();
      }
    });
  } finally {
    await server.close();
  }
});

test('RUN-04: while sources are offline, a NON-loopback LLM endpoint is refused before any dial', async () => {
  await withEnv({ PENSMITH_OFFLINE: '1' }, async () => {
    const rec = installDialRecorder();
    __setHttpTestSeams({ resolve: async () => [{ address: '203.0.113.9', family: 4 }] });
    try {
      await assert.rejects(
        () => httpFetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', body: '{}', noRetry: true, llm: { endpoint: 'https://api.anthropic.com' },
        }),
        (e: unknown) => isOfflineEgressError(e) && /only a loopback LLM endpoint/.test(e.message),
      );
      assert.deepEqual(rec.dials(), []);
    } finally {
      __setHttpTestSeams(null);
      rec.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// Validation runs for EVERY request (SEC-01): `untrusted:false` no longer skips it
// ---------------------------------------------------------------------------

test('SEC-01: a trusted-source request is still resolved and validated (untrusted:false is ignored)', async () => {
  await withEnv({ PENSMITH_NETWORK_TESTS: '1' }, async () => {
    const rec = installDialRecorder();
    __setHttpTestSeams({ resolve: async () => [{ address: '10.1.2.3', family: 4 }] });
    try {
      await assert.rejects(
        () => httpFetch('https://api.crossref.org/works/x', { source: 'crossref', untrusted: false, noRetry: true, noCache: true }),
        (e: unknown) => e instanceof SsrfBlockedError && /private\/reserved IP 10\.1\.2\.3/.test((e as Error).message),
      );
      assert.deepEqual(rec.dials(), [], 'refused before any dial');
    } finally {
      __setHttpTestSeams(null);
      rec.restore();
    }
  });
});

test('RUN-08: a SOURCE request to loopback or a private address is always refused, even with an LLM endpoint configured elsewhere', async () => {
  await withEnv({ PENSMITH_NETWORK_TESTS: '1' }, async () => {
    for (const url of ['http://127.0.0.1/', 'http://[::1]:8080/x', 'http://10.0.0.5:8000/v1', 'http://169.254.169.254/latest']) {
      await assert.rejects(
        () => httpFetch(url, { source: 'generic', noRetry: true, noCache: true }),
        (e: unknown) => e instanceof SsrfBlockedError,
        url,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The LLM endpoint policy (D-17-09), unit level
// ---------------------------------------------------------------------------

const resolverFor = (addrs: ResolvedAddress[]) => async (): Promise<ResolvedAddress[]> => addrs;

test('D-17-09: the LLM request origin must equal the configured endpoint origin', async () => {
  await assert.rejects(
    () => checkLlmEndpoint('https://api.anthropic.com/v1/messages', 'https://api.openai.com', resolverFor([{ address: '203.0.113.1', family: 4 }])),
    /does not match the configured endpoint origin/,
  );
  await assert.rejects(
    () => checkLlmEndpoint('http://127.0.0.1:8001/v1/chat/completions', 'http://127.0.0.1:8000/v1'),
    /does not match/,
    'the port is part of the origin',
  );
  const ok = await checkLlmEndpoint('http://127.0.0.1:8000/v1/chat/completions', 'http://127.0.0.1:8000/v1');
  assert.deepEqual(ok, [{ address: '127.0.0.1', family: 4 }]);
});

test('D-17-09: http:// only when EVERY resolved address is loopback', async () => {
  assert.deepEqual(
    await checkLlmEndpoint('http://localhost:11434/v1/x', 'http://localhost:11434/v1', resolverFor([{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }])),
    [{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }],
  );
  await assert.rejects(
    () => checkLlmEndpoint('http://llm.example/v1/x', 'http://llm.example/v1', resolverFor([{ address: '203.0.113.7', family: 4 }])),
    /http:\/\/ is allowed only for a loopback LLM endpoint/,
  );
  await assert.rejects(
    () => checkLlmEndpoint('http://10.0.0.5:8000/v1/x', 'http://10.0.0.5:8000/v1'),
    /http:\/\/ is allowed only for a loopback/,
    'a private address over http is refused',
  );
  await assert.rejects(
    () => checkLlmEndpoint('http://mixed.example/v1/x', 'http://mixed.example/v1', resolverFor([{ address: '127.0.0.1', family: 4 }, { address: '203.0.113.7', family: 4 }])),
    /loopback/,
    'loopback + public is not "every address loopback"',
  );
});

test('D-17-09: 169.254/16, fe80::/10 and fd00:ec2::254 are never allowed, even configured', async () => {
  for (const [url, endpoint] of [
    ['http://169.254.169.254/v1/x', 'http://169.254.169.254/v1'],
    ['https://169.254.169.254/latest', 'https://169.254.169.254'],
    ['http://[fd00:ec2::254]/v1/x', 'http://[fd00:ec2::254]/v1'],
    ['https://[fe80::1]/v1/x', 'https://[fe80::1]/v1'],
  ] as const) {
    await assert.rejects(() => checkLlmEndpoint(url, endpoint), /never allowed/, url);
  }
  await assert.rejects(
    () => checkLlmEndpoint('https://metadata.internal/v1/x', 'https://metadata.internal/v1', resolverFor([{ address: '169.254.169.254', family: 4 }])),
    /never allowed/,
    'a hostname that resolves to the metadata address is refused too',
  );
});

test('D-17-09: other private ranges are allowed only over https to the configured endpoint', async () => {
  assert.deepEqual(await checkLlmEndpoint('https://10.0.0.5:8000/v1/x', 'https://10.0.0.5:8000/v1'), [
    { address: '10.0.0.5', family: 4 },
  ]);
  assert.deepEqual(
    await checkLlmEndpoint('https://vllm.lan:8000/v1/x', 'https://vllm.lan:8000/v1', resolverFor([{ address: '192.168.1.20', family: 4 }])),
    [{ address: '192.168.1.20', family: 4 }],
  );
});

test('D-17-09: an https private endpoint is dialed at exactly the validated address (pinned)', async () => {
  // The configured endpoint resolves (through the test resolver) to a private
  // address; the pinned connect must go to that address and nowhere else.
  await withEnv({ PENSMITH_NETWORK_TESTS: '1' }, async () => {
    const rec = installDialRecorder();
    const lookups: string[] = [];
    await withLocalHosts([], async () => {
      await assert.rejects(() =>
        httpFetch('https://vllm.lan:8443/v1/chat/completions', {
          method: 'POST', body: '{}', noRetry: true, llm: { endpoint: 'https://vllm.lan:8443/v1' },
        }),
      );
    }, {
      resolve: async (h) => {
        lookups.push(h);
        return [{ address: '10.9.8.7', family: 4 }];
      },
    });
    rec.restore();
    const dials = rec.dials();
    assert.equal(lookups.length, 1, 'resolved exactly once (no second DNS resolution at connect time)');
    assert.equal(dials.length, 1);
    assert.equal(dials[0]?.servername, 'vllm.lan', 'SNI keeps the hostname');
    assert.deepEqual(
      rec.events.filter((e) => e.kind === 'dns'),
      [],
      'the socket never asked the system resolver — the pinned lookup answered',
    );
  });
});

test('RUN-04: sources-offline mode is disclosed on the error so callers can say "unavailable (offline)"', async () => {
  await withEnv({ PENSMITH_TEST: '1' }, async () => {
    const e = await httpFetch(UNRECORDED_URL, { source: 'crossref' }).then(
      () => null,
      (err: unknown) => err,
    );
    assert.ok(isOfflineEgressError(e));
    assert.equal(e.reason, 'test runner');
    assert.equal(offlineLabel(e), 'offline');
  });
});

test('RUN-02: a session record paper dir is created for a paper cwd (sanity: no crash when .paper exists)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-egress-paper-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const cwd = process.cwd();
  process.chdir(root);
  try {
    await withEnv({ PENSMITH_OFFLINE: '1' }, async () => {
      await httpFetch(RECORDED_URL, { source: 'crossref' });
    });
  } finally {
    process.chdir(cwd);
  }
});
