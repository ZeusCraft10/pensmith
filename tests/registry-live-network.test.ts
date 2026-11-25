// tests/registry-live-network.test.ts — registry requests in live mode, over a
// local proxy that hangs up on every CONNECT, so nothing leaves the machine.
//
// arXiv's API terms ask for at most one request every three seconds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'node:net';
import { withNetworkEnv } from './lib/net-harness.js';
import { fetch as httpFetch } from '../bin/lib/http.js';

interface HangUpProxy {
  url: string;
  /** When each CONNECT arrived, and for which host. */
  connects: Array<{ at: number; target: string }>;
  close: () => Promise<void>;
}

/** A proxy that reads each CONNECT and hangs up without opening a tunnel. */
async function startHangUpProxy(): Promise<HangUpProxy> {
  const connects: Array<{ at: number; target: string }> = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => { /* the client may reset first */ });
    let head = '';
    sock.on('data', (c: Buffer) => {
      head += c.toString('latin1');
      if (!head.includes('\r\n\r\n')) return;
      const line = head.split('\r\n')[0] ?? '';
      connects.push({ at: Date.now(), target: line.split(' ')[1] ?? '' });
      sock.destroy();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    connects,
    close: () => new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
    }),
  };
}

test('arXiv requests are spaced at least three seconds apart', { timeout: 30_000 }, async () => {
  const proxy = await startHangUpProxy();
  try {
    await withNetworkEnv({ HTTPS_PROXY: proxy.url }, async () => {
      for (const id of ['1706.03762', '1810.04805']) {
        await httpFetch(`https://export.arxiv.org/api/query?id_list=${id}`, { source: 'arxiv', noRetry: true, noCache: true })
          .catch(() => undefined);
      }
    });
    assert.equal(proxy.connects.length, 2, 'one CONNECT per request');
    const gap = proxy.connects[1]!.at - proxy.connects[0]!.at;
    assert.ok(gap >= 2_900, `the second arXiv request waited ${gap} ms`);
  } finally {
    await proxy.close();
  }
});
