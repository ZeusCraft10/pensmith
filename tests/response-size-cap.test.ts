// tests/response-size-cap.test.ts — SEC-03: upstream responses have a size cap.
// http.ts streams every body under a per-call maxBytes and throws
// ResponseTooLargeError BEFORE full buffering; every adapter passes a cap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetch as httpFetch,
  ResponseTooLargeError,
  MAX_JSON_RESPONSE_BYTES,
  MAX_LLM_RESPONSE_BYTES,
  _resetBucketsForTest,
} from '../bin/lib/http.js';
import { MAX_PDF_BYTES } from '../bin/lib/pdf-text.js';
import { startHttpServer, streamBytes, withLocalHosts } from './helpers/local-servers/transport.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const HOST = 'stream.pensmith.test';

async function liveLane<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env['PENSMITH_NETWORK_TESTS'];
  process.env['PENSMITH_NETWORK_TESTS'] = '1';
  _resetBucketsForTest();
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env['PENSMITH_NETWORK_TESTS'];
    else process.env['PENSMITH_NETWORK_TESTS'] = saved;
  }
}

test('SEC-03: the default caps are 8 MiB (JSON/text), 16 MiB (LLM) and MAX_PDF_BYTES (PDF)', () => {
  assert.equal(MAX_JSON_RESPONSE_BYTES, 8 * 1024 * 1024);
  assert.equal(MAX_LLM_RESPONSE_BYTES, 16 * 1024 * 1024);
  assert.equal(MAX_PDF_BYTES, 50 * 1024 * 1024);
});

test('SEC-03: a 60 MB stream is aborted at the 8 MiB cap before full buffering, with bounded memory', async () => {
  const total = 60 * 1024 * 1024;
  const handler = streamBytes(total);
  const server = await startHttpServer(handler);
  try {
    await liveLane(async () => {
      const before = process.memoryUsage().arrayBuffers;
      await assert.rejects(
        () => withLocalHosts([HOST], () =>
          httpFetch(`http://${HOST}:${server.port}/big`, { source: 'generic', noCache: true, noRetry: true }),
        ),
        (e: unknown) => {
          assert.ok(e instanceof ResponseTooLargeError, `expected ResponseTooLargeError, got ${String(e)}`);
          assert.equal(e.maxBytes, MAX_JSON_RESPONSE_BYTES);
          assert.match(e.message, /exceeded the 8388608-byte cap/);
          return true;
        },
      );
      const grew = process.memoryUsage().arrayBuffers - before;
      // Give the server a moment to notice the hang-up, then check how much it
      // managed to push: far less than the full 60 MB (the client stopped reading).
      await new Promise((r) => setTimeout(r, 200));
      assert.ok(handler.written() < total / 2, `the server wrote ${handler.written()} of ${total} bytes — the client must stop early`);
      assert.ok(grew < 48 * 1024 * 1024, `buffered memory grew by ${grew} bytes (a 60 MB body must never be held)`);
    });
  } finally {
    await server.close();
  }
});

test('SEC-03: a declared content-length above the cap is refused before the body is read', async () => {
  const server = await startHttpServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(100 * 1024 * 1024) });
    res.write('{"partial":');
    // never finishes — the client must not wait for 100 MB
  });
  try {
    await liveLane(async () => {
      const started = Date.now();
      await assert.rejects(
        () => withLocalHosts([HOST], () =>
          httpFetch(`http://${HOST}:${server.port}/declared`, { source: 'generic', noCache: true, noRetry: true }),
        ),
        ResponseTooLargeError,
      );
      assert.ok(Date.now() - started < 5_000, 'refused up front, not after a timeout');
    });
  } finally {
    await server.close();
  }
});

test('SEC-03: a per-call maxBytes (the PDF cap) lets a larger body through', async () => {
  const size = MAX_JSON_RESPONSE_BYTES + 1024 * 1024; // 9 MiB: above the JSON default
  const server = await startHttpServer(streamBytes(size));
  try {
    await liveLane(async () => {
      const r = await withLocalHosts([HOST], () =>
        httpFetch(`http://${HOST}:${server.port}/paper.pdf`, {
          source: 'generic', noCache: true, noRetry: true, maxBytes: MAX_PDF_BYTES,
        }),
      );
      assert.equal(r.status, 200);
      assert.equal(r.bodyBytes?.length, size);
    });
  } finally {
    await server.close();
  }
});

test('SEC-03: an LLM response is capped at 16 MiB by default', async () => {
  const server = await startHttpServer(streamBytes(MAX_LLM_RESPONSE_BYTES + 512 * 1024));
  try {
    await liveLane(async () => {
      await assert.rejects(
        () => httpFetch(`${server.origin}/v1/messages`, {
          method: 'POST', body: '{}', noRetry: true, llm: { endpoint: server.origin },
        }),
        (e: unknown) => e instanceof ResponseTooLargeError && e.maxBytes === MAX_LLM_RESPONSE_BYTES,
      );
    });
  } finally {
    await server.close();
  }
});

test('SEC-03: the cap applies to fixture replay too (offline)', async () => {
  const saved = process.env['PENSMITH_OFFLINE'];
  process.env['PENSMITH_OFFLINE'] = '1';
  try {
    await assert.rejects(
      () => httpFetch('https://api.crossref.org/works/10.1038%2Fnphys1170', { source: 'crossref', maxBytes: 100 }),
      ResponseTooLargeError,
    );
  } finally {
    if (saved === undefined) delete process.env['PENSMITH_OFFLINE'];
    else process.env['PENSMITH_OFFLINE'] = saved;
  }
});

test('SEC-03: every source adapter passes an explicit cap and the arxiv.ts TODO is gone', () => {
  const dir = join(REPO, 'bin', 'lib', 'sources');
  const httpAdapters = readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => readFileSync(join(dir, f), 'utf8').includes('httpFetch('));
  assert.ok(httpAdapters.length >= 7, `expected the 7 HTTP adapters, found ${httpAdapters.join(', ')}`);
  for (const f of httpAdapters) {
    const src = readFileSync(join(dir, f), 'utf8');
    const calls = (src.match(/httpFetch\(/g) ?? []).length;
    const capped = (src.match(/maxBytes:\s*MAX_JSON_RESPONSE_BYTES/g) ?? []).length;
    assert.equal(capped, calls, `${f}: every httpFetch call passes maxBytes`);
  }
  const arxiv = readFileSync(join(dir, 'arxiv.ts'), 'utf8');
  assert.ok(!/TODO/.test(arxiv), 'the arxiv.ts upstream-cap TODO is resolved');
  // Phase 20 (VRFY-19): Pass 3's PDF fetches moved to verify/source-text.ts.
  for (const f of ['verify/source-text.ts', '../cli/add.ts']) {
    const src = readFileSync(join(REPO, 'bin', 'lib', f), 'utf8');
    assert.match(src, /maxBytes:\s*MAX_PDF_BYTES/, `${f}: PDF fetches pass MAX_PDF_BYTES`);
  }
});
