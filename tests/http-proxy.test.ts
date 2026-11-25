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
  close: () => Promise<void>;
}

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

async function startFakeProxy(opts: { refuseConnect?: boolean } = {}): Promise<FakeProxy> {
  const requestLines: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => { /* client may hang up mid-test */ });
    onHead(sock, (head) => {
      const line = head.split('\r\n')[0] ?? '';
      requestLines.push(line);
      if (line.startsWith('CONNECT ')) {
        if (opts.refuseConnect) {
          sock.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
          return;
        }
        sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        onHead(sock, (inner) => {
          requestLines.push(`tunnel: ${inner.split('\r\n')[0] ?? ''}`);
          sock.end(CANNED);
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
  const proxy = await startFakeProxy({ refuseConnect: true });
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
