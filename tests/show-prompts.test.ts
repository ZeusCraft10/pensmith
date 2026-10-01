// tests/show-prompts.test.ts — RUN-16 / D-17-12: --show-prompts shows
// everything before it leaves the machine.
//
// The mirror lives in the ONE egress gate (bin/lib/http.ts), so every request —
// source APIs, the LLM, GPTZero, DuckDuckGo — is printed to stderr BEFORE it is
// sent: `[show-prompts] <METHOD> <url>` with secret query params redacted, the
// FULL body for an LLM request, a length + 200-char preview for any other POST,
// and never a header (headers carry the keys). Ordering is proven against a
// local server: when the request reaches the server, the mirror line is already
// on stderr.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetch as httpFetch, _resetBucketsForTest } from '../bin/lib/http.js';
import { setMirrorPromptsToStderr } from '../bin/lib/session-log.js';
import { loadCassetteFile } from '../bin/lib/http-mock.js';
import { measureHonesty } from '../bin/lib/honesty.js';
import { runPlagiarism } from '../bin/lib/plagiarism.js';
import { installMockAgent } from './helpers/local-servers/mock-agent.js';
import { startHttpServer, withLocalHosts } from './helpers/local-servers/transport.js';

const SENTINEL = 'sk-sentinel-show-prompts-9f8e7d6c';

interface Captured { lines: string[]; text(): string; }

/** Enable the mirror and tee stderr (never swallow: the test runner reports on stdout/stderr). */
async function withMirror<T>(fn: (cap: Captured) => Promise<T>, enabled = true): Promise<T> {
  const chunks: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    chunks.push(String(s));
    return orig(s);
  };
  setMirrorPromptsToStderr(enabled);
  const cap: Captured = {
    get lines() {
      return chunks.join('').split(/\r?\n/).filter((l) => l.startsWith('[show-prompts] '));
    },
    text: () => chunks.join(''),
  };
  try {
    return await fn(cap);
  } finally {
    setMirrorPromptsToStderr(false);
    (process.stderr as unknown as { write: typeof orig }).write = orig;
  }
}

/** The live test lane for the duration of `fn` (the gate stays in force). */
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

test('RUN-16: a source GET is mirrored (secret params redacted, no header) BEFORE the server receives it', async () => {
  const host = 'api.mirror.test';
  let mirroredBeforeArrival: boolean | null = null;
  let cap: Captured | null = null;
  const server = await startHttpServer((_req, res) => {
    mirroredBeforeArrival = (cap?.lines ?? []).some((l) => l.startsWith('[show-prompts] GET http://api.mirror.test:'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  try {
    await withMirror(async (c) => {
      cap = c;
      await liveLane(() =>
        withLocalHosts([host], async () => {
          const url = `http://${host}:${server.port}/works?query=sagas&api_key=${SENTINEL}&mailto=someone%40example.org`;
          const res = await httpFetch(url, { source: 'crossref', noCache: true, headers: { 'x-api-key': SENTINEL } });
          assert.equal(res.status, 200);
        }),
      );
      assert.equal(mirroredBeforeArrival, true, 'the mirror line is on stderr before the request reaches the server');
      assert.deepEqual(c.lines, [
        `[show-prompts] GET http://${host}:${server.port}/works?query=sagas&api_key=REDACTED&mailto=someone%40example.org`,
      ]);
      assert.ok(!c.text().includes(SENTINEL), 'the key (query param and header) never reaches stderr');
    });
    // The key really was sent — it is only the mirror that omits it.
    assert.equal(server.requests[0]?.headers['x-api-key'], SENTINEL);
  } finally {
    await server.close();
  }
});

test('RUN-16: an LLM request mirrors its FULL body (not a preview) before it is sent; headers never', async () => {
  let cap: Captured | null = null;
  let mirroredBeforeArrival: boolean | null = null;
  const server = await startHttpServer((_req, res) => {
    mirroredBeforeArrival = (cap?.lines ?? []).some((l) => l.startsWith('[show-prompts] body: {"model"'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"id":"msg_1","content":[{"type":"text","text":"ok"}]}');
  });
  try {
    const long = 'x'.repeat(900);
    const body = JSON.stringify({ model: 'claude-test', messages: [{ role: 'user', content: `summarize ${long} END` }] });
    await withMirror(async (c) => {
      cap = c;
      // Sources are offline under the test runner; the configured LOOPBACK LLM
      // endpoint is the one socket the gate allows (RUN-04, D-17-09).
      const res = await httpFetch(`${server.origin}/v1/messages`, {
        method: 'POST', body, noRetry: true,
        headers: { 'content-type': 'application/json', 'x-api-key': SENTINEL, authorization: `Bearer ${SENTINEL}` },
        llm: { endpoint: server.origin },
      });
      assert.equal(res.status, 200);
      assert.equal(mirroredBeforeArrival, true, 'the LLM body is mirrored before the request reaches the endpoint');
      assert.deepEqual(c.lines, [
        `[show-prompts] POST ${server.origin}/v1/messages`,
        `[show-prompts] body: ${body}`,
      ]);
      assert.ok(c.text().includes(' END'), 'the full body, past any preview length');
      assert.ok(!c.text().includes(SENTINEL));
    });
  } finally {
    await server.close();
  }
});

test('RUN-16: GPTZero — the POST is mirrored with a length + 200-char preview; the key never appears', async () => {
  const savedKey = process.env['GPTZERO_API_KEY'];
  process.env['GPTZERO_API_KEY'] = SENTINEL;
  const { agent, restore } = installMockAgent();
  let sentKey: string | undefined;
  const cs = loadCassetteFile('gptzero', 'predict-text');
  agent
    .get('https://api.gptzero.me')
    .intercept({ path: '/v2/predict/text', method: 'POST' })
    .reply((req) => {
      sentKey = (req.headers as Record<string, string>)['x-api-key'];
      return { statusCode: 200, data: JSON.stringify(cs?.[0]?.response), responseOptions: { headers: { 'content-type': 'application/json' } } };
    })
    .persist();
  const text = `${'The paper text that is scored for transparency only. '.repeat(10)}TAIL-MARKER`;
  // A live score appends to <cwd>/.paper/COSTS.jsonl (ARCH-10) — run from a
  // temp project, never from the repo checkout.
  const savedCwd = process.cwd();
  process.chdir(mkdtempSync(join(tmpdir(), 'pensmith-show-prompts-')));
  try {
    await withMirror(async (c) => {
      const score = await liveLane(() => measureHonesty(text, { consentGranted: true }));
      assert.equal(score.kind, 'score', 'the live lane scores against the MockAgent');
      const [head, preview, ...rest] = c.lines;
      assert.equal(head, '[show-prompts] POST https://api.gptzero.me/v2/predict/text');
      const m = /^\[show-prompts\] body: (\d+) bytes: (.*)$/.exec(preview ?? '');
      assert.ok(m, `a length + preview line, got ${preview}`);
      const payload = JSON.stringify({ document: text });
      assert.equal(Number(m[1]), Buffer.byteLength(payload, 'utf8'), 'the byte length of the whole payload');
      assert.equal(m[2], payload.slice(0, 200), 'a 200-char preview of the payload');
      assert.ok(!c.text().includes('TAIL-MARKER'), 'never more than the preview');
      assert.deepEqual(rest, []);
      assert.ok(!c.text().includes(SENTINEL), 'the GPTZero key never reaches stderr');
    });
    assert.equal(sentKey, SENTINEL, 'the key was sent in the header — only the mirror omits it');
  } finally {
    process.chdir(savedCwd);
    await restore();
    if (savedKey === undefined) delete process.env['GPTZERO_API_KEY'];
    else process.env['GPTZERO_API_KEY'] = savedKey;
  }
});

test('RUN-16: DuckDuckGo — every plagiarism phrase query is mirrored before it is sent', async () => {
  const { agent, restore } = installMockAgent();
  const DDG = 'https://html.duckduckgo.com';
  const queried: Array<{ q: string | null; mirroredFirst: boolean }> = [];
  let cap: Captured | null = null;
  const mirroredQueries = (): Array<string | null> =>
    (cap?.lines ?? [])
      .filter((l) => l.startsWith(`[show-prompts] GET ${DDG}/html/?q=`))
      .map((l) => new URL(l.slice('[show-prompts] GET '.length)).searchParams.get('q'));
  const html = String(loadCassetteFile('duckduckgo', 'html-search')?.[0]?.response ?? '');
  agent
    .get(DDG)
    .intercept({ path: /^\/html\/\?q=/, method: 'GET' })
    .reply((req) => {
      const q = new URL(String(req.path), DDG).searchParams.get('q');
      queried.push({ q, mirroredFirst: mirroredQueries().includes(q) });
      return { statusCode: 200, data: html, responseOptions: { headers: { 'content-type': 'text/html' } } };
    })
    .persist();
  try {
    await withMirror(async (c) => {
      cap = c;
      const results = await liveLane(() =>
        runPlagiarism('The transformer relies solely on attention mechanisms across every layer of the network.'),
      );
      assert.ok(results.length >= 1 && queried.length >= 1);
      assert.deepEqual(mirroredQueries(), queried.map((x) => x.q), 'exactly one mirror line per query sent, same query');
      assert.ok(queried.every((x) => x.mirroredFirst), 'each query was on stderr before the request was dispatched');
      // EXP-19 (D-21-22): each phrase is sent as a quoted exact-phrase query.
      for (const r of results) assert.ok(queried.some((x) => x.q === `"${r.phrase}"`), `the quoted phrase "${r.phrase}" was the query`);
    });
  } finally {
    await restore();
  }
});

test('RUN-16: a fixture-served request is mirrored; a refused one (no fixture) is not; mirror off prints nothing', async () => {
  await withMirror(async (c) => {
    const hit = await httpFetch('https://api.crossref.org/works/10.1038%2Fnphys1170', { source: 'crossref' });
    assert.equal(hit.status, 200);
    await assert.rejects(httpFetch('https://api.crossref.org/works/10.9999%2Fnot-recorded', { source: 'crossref' }));
    assert.deepEqual(c.lines, ['[show-prompts] GET https://api.crossref.org/works/10.1038%2Fnphys1170']);
  });
  await withMirror(async (c) => {
    await httpFetch('https://api.crossref.org/works/10.1038%2Fnphys1170', { source: 'crossref' });
    assert.deepEqual(c.lines, [], 'without --show-prompts nothing is mirrored');
  }, false);
});
