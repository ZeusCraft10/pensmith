// tests/http-deadline.test.ts — what a missed timeoutMs does to direct requests.
//
// Each attempt in bin/lib/http.ts is bounded by timeoutMs. Two things must hold
// when that deadline passes:
//
//   - A request that may already have reached the server is re-sent only if
//     repeating it is harmless. A POST to an LLM provider that answers slowly
//     is a billed generation; sending it five times bills five.
//   - Only the late request is given up. Requests to other servers running at
//     the same moment (research fans out across registries) keep going, are not
//     sent twice, and do not fail with an error naming someone else's deadline.
//
// The servers are tiny TCP listeners on 127.0.0.1 that speak just enough HTTP
// to count the requests they receive. Proxy variables are cleared, so every
// request here is a direct connection. Proxy tunnels are covered in
// tests/http-proxy.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'node:net';
import { fetch as httpFetch } from '../bin/lib/http.js';
import { providerPost, settle, withNetworkEnv } from './lib/net-harness.js';

const withDirectNetwork = <T>(fn: () => Promise<T>): Promise<T> => withNetworkEnv({}, fn);

interface CountingServer {
  url: string;
  /** Requests whose head the server received. */
  hits: () => number;
  close: () => Promise<void>;
}

/**
 * `answerAfterMs(n)` says when to answer the n-th request (counting from 1);
 * `null` means never.
 */
async function startServer(answerAfterMs: (n: number) => number | null): Promise<CountingServer> {
  let hits = 0;
  const timers = new Set<NodeJS.Timeout>();
  const sockets = new Set<net.Socket>();
  const answer = (sock: net.Socket, n: number): void => {
    const delay = answerAfterMs(n);
    if (delay === null) return;
    const body = JSON.stringify({ n });
    const t = setTimeout(() => {
      timers.delete(t);
      if (sock.destroyed) return;
      sock.end(
        'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n' +
        `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
      );
    }, delay);
    timers.add(t);
  };
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => { /* the client may abort mid-request */ });
    // Count every request head on the connection, skipping each request body.
    let buf = Buffer.alloc(0);
    let skip = 0;
    sock.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (skip > 0) {
          const n = Math.min(skip, buf.length);
          buf = buf.subarray(n);
          skip -= n;
          if (skip > 0) return;
        }
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buf.subarray(0, end).toString('latin1');
        buf = buf.subarray(end + 4);
        skip = Number(/\r\ncontent-length:\s*(\d+)/i.exec(head)?.[1] ?? 0);
        hits += 1;
        answer(sock, hits);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    hits: () => hits,
    close: () => new Promise<void>((resolve) => {
      for (const t of timers) clearTimeout(t);
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
    }),
  };
}

// Keeps a regression from hanging the run; far above every timeoutMs below.
const GUARD_MS = 10_000;
const settleWithin = <T>(p: Promise<T>) => settle(p, GUARD_MS);

test('http deadline: a POST whose response is slower than timeoutMs reaches the server exactly once', async () => {
  const server = await startServer(() => 3_000);
  try {
    const r = await withDirectNetwork(() => settleWithin(providerPost(`${server.url}/v1/messages`, 300)));
    assert.ok(r.error, `the request must fail at its deadline; it resolved after ${r.ms} ms`);
    assert.match(String(r.error), /deadline/i);
    assert.equal(server.hits(), 1, `the provider received the same POST ${server.hits()} times`);
    assert.ok(r.ms < 2_000, `failed after ${r.ms} ms; timeoutMs was 300`);
  } finally {
    await server.close();
  }
});

test('http deadline: a GET that missed its deadline is retried', async () => {
  const server = await startServer((n) => (n === 1 ? null : 0));
  try {
    const r = await withDirectNetwork(() => settleWithin(httpFetch(`${server.url}/works/slow`, {
      source: 'crossref', noCache: true, timeoutMs: 300,
    })));
    assert.equal(r.error, undefined, `the retry must succeed; got ${String(r.error)}`);
    assert.equal(r.value?.status, 200);
    assert.equal(server.hits(), 2);
  } finally {
    await server.close();
  }
});

for (const noRetry of [true, false]) {
  test(`http deadline: a missed deadline leaves an unrelated request alone (noRetry: ${noRetry})`, async () => {
    const stalled = await startServer(() => null);
    const healthy = await startServer(() => 700);
    try {
      const [late, fine] = await withDirectNetwork(() => Promise.all([
        settleWithin(httpFetch(`${stalled.url}/works/late`, { source: 'crossref', noCache: true, noRetry: true, timeoutMs: 300 })),
        settleWithin(httpFetch(`${healthy.url}/works/fine`, { source: 'openalex', noCache: true, noRetry, timeoutMs: 5_000 })),
      ]));
      assert.match(String(late.error), /deadline/i, 'the late request fails at its own deadline');
      assert.equal(fine.error, undefined, `the healthy request must succeed; got ${String(fine.error)}`);
      assert.equal(fine.value?.status, 200);
      assert.equal(healthy.hits(), 1, `the healthy server received the request ${healthy.hits()} times`);
    } finally {
      await stalled.close();
      await healthy.close();
    }
  });
}
