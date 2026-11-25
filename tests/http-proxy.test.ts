// tests/http-proxy.test.ts — bin/lib/http.ts honours HTTP_PROXY / HTTPS_PROXY /
// NO_PROXY, and the SSRF guard still runs when a proxy is configured.
//
// The regression: http.ts used undici's default dispatcher, which ignores the
// proxy variables, so on proxy-only university or corporate networks every
// registry call failed at connect and Pass 1 labelled every citation FABRICATED.
//
// The "proxy" here is a tiny TCP server on 127.0.0.1 that records the request
// line it receives. For CONNECT it accepts the tunnel and answers the tunnelled
// HTTP request itself; nothing leaves the machine.
//
// Two broken proxies are modelled as well, because a proxy that misbehaves must
// not hang the CLI or be hammered with reconnects: one accepts the CONNECT and
// never answers, and one reads the CONNECT and hangs up.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'node:net';
import { fetch as httpFetch, _resetBucketsForTest } from '../bin/lib/http.js';

const PROXY_VARS = [
  'HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy',
  'PENSMITH_OFFLINE', 'PENSMITH_TEST_CASSETTES',
] as const;

const PROBE_HOST = 'pensmith-proxy-probe.invalid';
const BODY = JSON.stringify({ via: 'proxy' });
const CANNED =
  'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n' +
  `Content-Length: ${Buffer.byteLength(BODY)}\r\nConnection: close\r\n\r\n${BODY}`;

interface FakeProxy {
  url: string;
  requestLines: string[];
  /** TCP connections the proxy accepted. */
  connections: () => number;
  /** Connections that carried a CONNECT and are still open. */
  openConnects: () => number;
  close: () => Promise<void>;
}

type ConnectBehaviour = 'tunnel' | 'refuse' | 'stall' | 'hang-up';

/** Read from `sock` until a full request head (\r\n\r\n) has arrived. */
function onHead(sock: net.Socket, cb: (head: string) => void): void {
  let buf = '';
  const onData = (chunk: Buffer): void => {
    buf += chunk.toString('latin1');
    const end = buf.indexOf('\r\n\r\n');
    if (end < 0) return;
    sock.off('data', onData);
    cb(buf.slice(0, end));
  };
  sock.on('data', onData);
}

/**
 * `onConnect` picks how each CONNECT is handled; a function lets a test change
 * behaviour between attempts (the n-th CONNECT is passed, counting from 1) or
 * by tunnel target (`host:port`). `answerAfterMs` delays the tunnelled answer.
 */
async function startFakeProxy(
  opts: {
    onConnect?: ConnectBehaviour | ((n: number, target: string) => ConnectBehaviour);
    answerAfterMs?: (target: string) => number;
  } = {},
): Promise<FakeProxy> {
  const requestLines: string[] = [];
  const sockets = new Set<net.Socket>();
  const connectSockets = new Set<net.Socket>();
  let accepted = 0;
  let connects = 0;
  const server = net.createServer((sock) => {
    accepted += 1;
    sockets.add(sock);
    sock.on('close', () => {
      sockets.delete(sock);
      connectSockets.delete(sock);
    });
    sock.on('error', () => { /* client may hang up mid-test */ });
    onHead(sock, (head) => {
      const line = head.split('\r\n')[0] ?? '';
      requestLines.push(line);
      if (line.startsWith('CONNECT ')) {
        connects += 1;
        connectSockets.add(sock);
        const target = line.split(' ')[1] ?? '';
        const pick = opts.onConnect ?? 'tunnel';
        const behaviour = typeof pick === 'function' ? pick(connects, target) : pick;
        if (behaviour === 'refuse') {
          sock.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
          return;
        }
        if (behaviour === 'stall') return; // read the CONNECT, never answer
        if (behaviour === 'hang-up') {
          sock.destroy();
          return;
        }
        sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        onHead(sock, (inner) => {
          requestLines.push(`tunnel: ${inner.split('\r\n')[0] ?? ''}`);
          const delay = opts.answerAfterMs?.(target) ?? 0;
          if (delay === 0) sock.end(CANNED);
          else setTimeout(() => { if (!sock.destroyed) sock.end(CANNED); }, delay);
        });
        return;
      }
      sock.end(CANNED);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requestLines,
    connections: () => accepted,
    openConnects: () => connectSockets.size,
    close: () => new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
    }),
  };
}

async function withProxyEnv<T>(env: Partial<Record<(typeof PROXY_VARS)[number], string>>, fn: () => Promise<T>): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const k of PROXY_VARS) {
    saved.set(k, process.env[k]);
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
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

test('http proxy: HTTP_PROXY routes registry requests through the proxy', async () => {
  const proxy = await startFakeProxy();
  try {
    const res = await withProxyEnv({ HTTP_PROXY: proxy.url, http_proxy: proxy.url, NO_PROXY: '', no_proxy: '' }, () =>
      httpFetch(`http://${PROBE_HOST}/works/ping`, { source: 'crossref', noCache: true, noRetry: true }),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { via: 'proxy' });
    assert.ok(
      proxy.requestLines.some((l) => l.includes(PROBE_HOST)),
      `the proxy must see the target host; saw ${JSON.stringify(proxy.requestLines)}`,
    );
  } finally {
    await proxy.close();
  }
});

test('http proxy: HTTPS_PROXY is used for https targets (CONNECT to host:443)', async () => {
  const proxy = await startFakeProxy({ onConnect: 'refuse' });
  try {
    await withProxyEnv({ HTTPS_PROXY: proxy.url, https_proxy: proxy.url, NO_PROXY: '', no_proxy: '' }, async () => {
      await assert.rejects(
        httpFetch(`https://${PROBE_HOST}/works/ping`, { source: 'crossref', noCache: true, noRetry: true }),
      );
    });
    assert.deepEqual(proxy.requestLines, [`CONNECT ${PROBE_HOST}:443 HTTP/1.1`]);
  } finally {
    await proxy.close();
  }
});

test('http proxy: a host listed in NO_PROXY bypasses the proxy', async () => {
  const proxy = await startFakeProxy();
  try {
    await withProxyEnv({ HTTP_PROXY: proxy.url, http_proxy: proxy.url, NO_PROXY: PROBE_HOST, no_proxy: PROBE_HOST }, async () => {
      // Direct connection to a .invalid host cannot succeed.
      await assert.rejects(
        httpFetch(`http://${PROBE_HOST}/works/ping`, { source: 'crossref', noCache: true, noRetry: true }),
      );
    });
    assert.deepEqual(proxy.requestLines, [], 'NO_PROXY host must not be proxied');
  } finally {
    await proxy.close();
  }
});

test('http proxy: the SSRF guard still blocks private targets when a proxy is set', async () => {
  const proxy = await startFakeProxy();
  try {
    await withProxyEnv({ HTTP_PROXY: proxy.url, http_proxy: proxy.url, NO_PROXY: '', no_proxy: '' }, async () => {
      await assert.rejects(
        httpFetch('http://127.0.0.1:9/internal', { source: 'generic', noCache: true, noRetry: true }),
        /SSRF guard/,
      );
    });
    assert.deepEqual(proxy.requestLines, [], 'a blocked request must never reach the proxy');
  } finally {
    await proxy.close();
  }
});

async function waitFor(cond: () => boolean, withinMs: number): Promise<boolean> {
  const until = Date.now() + withinMs;
  while (!cond()) {
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 20));
  }
  return true;
}

// A request through a broken proxy must settle on its own. The guard below only
// keeps a regression from hanging the whole test run; it is far above the
// per-attempt timeout the requests ask for.
const GUARD_MS = 8_000;

async function settleWithin<T>(p: Promise<T>): Promise<{ outcome: 'ok' | 'error' | 'hung'; error?: unknown; ms: number }> {
  const started = Date.now();
  let guard: NodeJS.Timeout | undefined;
  const hung = new Promise<'hung'>((resolve) => { guard = setTimeout(() => resolve('hung'), GUARD_MS); });
  try {
    const r = await Promise.race([
      p.then(() => 'ok' as const, (error: unknown) => ({ error })),
      hung,
    ]);
    const ms = Date.now() - started;
    if (r === 'ok' || r === 'hung') return { outcome: r, ms };
    return { outcome: 'error', error: r.error, ms };
  } finally {
    clearTimeout(guard);
  }
}

test('http proxy: a proxy that accepts the CONNECT and never answers fails within timeoutMs', async () => {
  const proxy = await startFakeProxy({ onConnect: 'stall' });
  try {
    const r = await withProxyEnv({ HTTP_PROXY: proxy.url, http_proxy: proxy.url, NO_PROXY: '', no_proxy: '' }, () =>
      settleWithin(httpFetch(`http://${PROBE_HOST}/works/stall`, {
        source: 'crossref', noCache: true, noRetry: true, timeoutMs: 500,
      })),
    );
    assert.equal(r.outcome, 'error', `the request must reject, not ${r.outcome} (after ${r.ms} ms)`);
    assert.match(String(r.error), /deadline/i);
    assert.ok(r.ms < 2_500, `rejected after ${r.ms} ms; timeoutMs was 500`);
    // The abandoned CONNECT must be closed too. Left open it would wait out the
    // proxy connection's own 300 s timeout and keep the CLI process alive.
    assert.ok(await waitFor(() => proxy.openConnects() === 0, 1_000),
      `${proxy.openConnects()} CONNECT connection(s) still open after the deadline`);
  } finally {
    await proxy.close();
  }
});

test('http proxy: a proxy that hangs up on the CONNECT fails fast and is not hammered with reconnects', async () => {
  const proxy = await startFakeProxy({ onConnect: 'hang-up' });
  try {
    const r = await withProxyEnv({ HTTP_PROXY: proxy.url, http_proxy: proxy.url, NO_PROXY: '', no_proxy: '' }, () =>
      settleWithin(httpFetch(`http://${PROBE_HOST}/works/hang-up`, {
        source: 'crossref', noCache: true, noRetry: true, timeoutMs: 500,
      })),
    );
    assert.equal(r.outcome, 'error', `the request must reject, not ${r.outcome} (after ${r.ms} ms)`);
    assert.ok(r.ms < 2_500, `rejected after ${r.ms} ms; timeoutMs was 500`);
    // One attempt (noRetry) is one CONNECT. undici on its own treats the hang-up
    // as recoverable and reconnects in a tight loop, thousands of times a second.
    assert.ok(proxy.connections() <= 2, `one request opened ${proxy.connections()} proxy connections`);
  } finally {
    await proxy.close();
  }
});

test('http proxy: after a stalled tunnel the retry goes out on a fresh connection and succeeds', async () => {
  const proxy = await startFakeProxy({ onConnect: (n) => (n === 1 ? 'stall' : 'tunnel') });
  try {
    const r = await withProxyEnv({ HTTP_PROXY: proxy.url, http_proxy: proxy.url, NO_PROXY: '', no_proxy: '' }, () =>
      settleWithin(httpFetch(`http://${PROBE_HOST}/works/retry`, {
        source: 'crossref', noCache: true, timeoutMs: 500,
      })),
    );
    assert.equal(r.outcome, 'ok', `the retry must succeed; got ${r.outcome} ${String(r.error ?? '')}`);
    assert.equal(proxy.requestLines.filter((l) => l.startsWith('CONNECT ')).length, 2);
  } finally {
    await proxy.close();
  }
});

// The options bin/lib/anthropic.ts sends to the provider: a billed generation.
function providerPost(url: string, timeoutMs: number): ReturnType<typeof httpFetch> {
  return httpFetch(url, {
    method: 'POST',
    body: JSON.stringify({ prompt: 'draft section 3' }),
    source: 'generic',
    noCache: true,
    untrusted: false,
    timeoutMs,
  });
}

const tunnelled = (proxy: FakeProxy, method: string): string[] =>
  proxy.requestLines.filter((l) => l.startsWith(`tunnel: ${method} `));

test('http proxy: a POST whose tunnel the proxy never opened is retried, since nothing reached the server', async () => {
  const proxy = await startFakeProxy({ onConnect: (n) => (n === 1 ? 'stall' : 'tunnel') });
  try {
    const r = await withProxyEnv({ HTTP_PROXY: proxy.url, http_proxy: proxy.url, NO_PROXY: '', no_proxy: '' }, () =>
      settleWithin(providerPost(`http://${PROBE_HOST}/v1/messages`, 500)),
    );
    assert.equal(r.outcome, 'ok', `the retry must succeed; got ${r.outcome} ${String(r.error ?? '')}`);
    assert.equal(proxy.requestLines.filter((l) => l.startsWith('CONNECT ')).length, 2);
    assert.equal(tunnelled(proxy, 'POST').length, 1, 'the POST reached the server once');
  } finally {
    await proxy.close();
  }
});

test('http proxy: a POST that reached the server through the tunnel is not re-sent after its deadline', async () => {
  const proxy = await startFakeProxy({ answerAfterMs: () => 3_000 });
  try {
    const r = await withProxyEnv({ HTTP_PROXY: proxy.url, http_proxy: proxy.url, NO_PROXY: '', no_proxy: '' }, () =>
      settleWithin(providerPost(`http://${PROBE_HOST}/v1/messages`, 400)),
    );
    assert.equal(r.outcome, 'error', `the request must fail at its deadline, not ${r.outcome}`);
    assert.match(String(r.error), /deadline/i);
    assert.equal(tunnelled(proxy, 'POST').length, 1,
      `the provider received the same POST ${tunnelled(proxy, 'POST').length} times`);
  } finally {
    await proxy.close();
  }
});

test('http proxy: a stalled tunnel to one host leaves requests to other hosts alone', async () => {
  const STALLED_HOST = 'pensmith-proxy-stalled.invalid';
  const proxy = await startFakeProxy({
    onConnect: (_n, target) => (target.startsWith(`${STALLED_HOST}:`) ? 'stall' : 'tunnel'),
    answerAfterMs: () => 700,
  });
  try {
    const [late, fine] = await withProxyEnv({ HTTP_PROXY: proxy.url, http_proxy: proxy.url, NO_PROXY: '', no_proxy: '' }, () =>
      Promise.all([
        settleWithin(httpFetch(`http://${STALLED_HOST}/works/late`, {
          source: 'crossref', noCache: true, noRetry: true, timeoutMs: 300,
        })),
        settleWithin(httpFetch(`http://${PROBE_HOST}/works/fine`, {
          source: 'openalex', noCache: true, timeoutMs: 5_000,
        })),
      ]),
    );
    assert.equal(late.outcome, 'error');
    assert.match(String(late.error), /deadline/i);
    assert.equal(fine.outcome, 'ok', `the other request must succeed; got ${fine.outcome} ${String(fine.error ?? '')}`);
    assert.deepEqual(tunnelled(proxy, 'GET'), ['tunnel: GET /works/fine HTTP/1.1'],
      'the other request reached its server exactly once');
  } finally {
    await proxy.close();
  }
});
