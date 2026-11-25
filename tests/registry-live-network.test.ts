// tests/registry-live-network.test.ts — in live mode, a registry that cannot be
// reached gives UNRESOLVED, and arXiv is asked at most once every three seconds.
//
// crossref.fetchById used to swallow every thrown error (DNS, proxy, 429 or
// 5xx after retries) and return null, which Pass 1 reported as FABRICATED
// "DOI did not resolve via Crossref". Here the network is a local proxy that
// hangs up on every CONNECT, so http.ts retries and then throws, the way a
// dead network or an outage behaves. Nothing leaves the machine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withNetworkEnv } from './lib/net-harness.js';
import { fetch as httpFetch } from '../bin/lib/http.js';
import { runPass1 } from '../bin/lib/verify/pass1.js';

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

test('live Pass 1: registries that cannot be reached give UNRESOLVED, never FABRICATED', { timeout: 90_000 }, async () => {
  const proxy = await startHangUpProxy();
  try {
    const root = mkdtempSync(join(tmpdir(), 'pensmith-pass1-live-'));
    mkdirSync(join(root, '.paper'), { recursive: true });
    const bibPath = join(root, '.paper', 'CITATIONS.bib');
    writeFileSync(bibPath,
      '@article{walt2011,\n  title = {The NumPy Array},\n  author = {van der Walt, Stéfan},\n' +
      '  year = {2011},\n  doi = {10.1109/MCSE.2011.37}\n}\n');
    const results = await withNetworkEnv({ HTTPS_PROXY: proxy.url, HTTP_PROXY: proxy.url }, () =>
      runPass1('# S\n\nNumPy [@walt2011].\n', bibPath));
    const r = results.find((x) => x.citekey === 'walt2011');
    assert.equal(r?.verdict, 'UNRESOLVED', r?.reason);
    assert.match(r!.reason, /could not be checked/);
    assert.match(r!.reason, /re-run verify/);
    const hosts = new Set(proxy.connects.map((c) => c.target));
    for (const h of ['api.crossref.org:443', 'api.datacite.org:443', 'doi.org:443']) {
      assert.ok(hosts.has(h), `Pass 1 asked ${h} before giving up (asked: ${[...hosts].join(', ')})`);
    }
  } finally {
    await proxy.close();
  }
});

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
