// tests/mock-llm.test.ts — RUN-21 (D-17-28): the deterministic mock LLM, driven
// through the REAL transport (bin/lib/anthropic.ts complete() → bin/lib/http.ts).
//
// Covers: both wire shapes (captured body, text parsed with the thinking block
// ignored, call counts), GET /v1/models, SSE streaming (and slow streaming),
// scripted replies, fixture files, every failure injection mapped to its
// RUN-12 / RUN-24 outcome, and that close() leaves no listening socket.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { startMockLlm } from './helpers/local-servers/mock-llm.js';
import {
  complete,
  probeLlmEndpoint,
  ProviderHttpError,
  ProviderRefusalError,
  ProviderTruncatedError,
} from '../bin/lib/anthropic.js';
import { resolveRuntime } from '../bin/lib/runtime.js';

const KEY = 'sk-test-mock-llm-key-0001';

test('RUN-21: anthropic shape — captured body, thinking block ignored, thinking billed as output', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const res = await complete({ slug: 'section-drafter', section: 1, system: 'sys', messages: [{ role: 'user', content: 'Write section 1 (intro).' }] });
    const mock = sb.mock!;
    assert.equal(mock.callCount(), 1);
    assert.equal(mock.callCount('section-drafter'), 1);
    const body = mock.bodiesFor('section-drafter')[0]!;
    assert.equal(body['model'], 'claude-opus-5', 'default generation model');
    assert.match(res.text, /^mock-llm reply \(section-drafter\)/);
    assert.ok(!res.text.includes('mock-signature'), 'thinking content never leaks into the text');
    // The mock counts 64 thinking tokens as output on claude-opus-5.
    assert.ok(res.outputTokens >= 64 + Math.ceil(res.text.length / 4) - 1, `thinking billed as output: ${res.outputTokens}`);
    assert.equal(mock.requests[0]!.headers['anthropic-version'], '2023-06-01');
    assert.equal(mock.requests[0]!.headers['x-api-key'], KEY);
  });
});

test('RUN-21: openai shape — chat completions body and a schema-valid structured reply', async () => {
  await withLlmSandbox({ mock: 'openai', env: { OPENAI_API_KEY: KEY } }, async (sb) => {
    const res = await complete<{ scopes: Array<{ label: string; queries: string[] }> }>({
      slug: 'topic-disambiguator',
      system: 'sys',
      messages: [{ role: 'user', content: 'Topic: medieval Icelandic sagas' }],
    });
    const body = sb.mock!.bodiesFor('topic-disambiguator')[0]!;
    assert.equal(body['model'], 'gpt-6-luna', 'judgment slug → the small OpenAI model');
    assert.equal(typeof body['max_completion_tokens'], 'number');
    assert.equal(body['max_tokens'], undefined);
    assert.equal((body['response_format'] as { type: string }).type, 'json_schema');
    assert.ok(Array.isArray(res.data?.scopes) && res.data!.scopes.length >= 1);
    assert.equal(sb.mock!.requests[0]!.headers['authorization'], `Bearer ${KEY}`);
  });
});

test('RUN-21: GET /v1/models answers the doctor endpoint probe', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const probe = await probeLlmEndpoint(await resolveRuntime());
    assert.equal(probe.reachable, true, probe.detail);
    assert.equal(sb.mock!.requests.at(-1)!.path, '/v1/models');
  });
});

test('RUN-21: SSE streaming (slow chunks) — the >16k retry streams and parses', async () => {
  await withLlmSandbox(
    { mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY }, mockOptions: { streamChunkDelayMs: 2 } },
    async (sb) => {
      sb.mock!.fail({ kind: 'max_tokens' }, { slug: 'outline-author', times: 1 });
      const res = await complete<{ sections: unknown[] }>({
        slug: 'outline-author',
        system: 's',
        messages: [{ role: 'user', content: 'Topic: attention mechanisms' }],
      });
      const bodies = sb.mock!.bodiesFor('outline-author');
      assert.equal(bodies.length, 2);
      assert.equal(bodies[0]!['stream'], undefined, 'first attempt (16k) is not streamed');
      assert.equal(bodies[1]!['stream'], true, 'the 32k retry streams');
      assert.equal(bodies[1]!['max_tokens'], 32_000);
      assert.ok(Array.isArray(res.data?.sections) && res.data!.sections.length >= 2);
    },
  );
});

test('RUN-21: scripted replies per slug are served in order, then the default', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    sb.mock!.script('orphan-label', { data: { label: 'claim' } }, { text: '{"label":"definition"}' });
    const a = await complete<{ label: string }>({ slug: 'orphan-label', system: '', messages: [{ role: 'user', content: 'x' }] });
    const b = await complete<{ label: string }>({ slug: 'orphan-label', system: '', messages: [{ role: 'user', content: 'y' }] });
    const c = await complete<{ label: string }>({ slug: 'orphan-label', system: '', messages: [{ role: 'user', content: 'z' }] });
    assert.deepEqual([a.data?.label, b.data?.label, c.data?.label], ['claim', 'definition', 'UNCLEAR']);
  });
});

test('RUN-21: fixture files serve each slug (exact request hash first, then in order)', async () => {
  await withLlmSandbox({ mock: false, env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const fxPath = path.join(sb.root, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({
      version: 1,
      slugs: { 'claim-support': [{ request_sha256: 'no-match', text: '{"verdict":"SUPPORTED","rationale":"fixture","evidence":""}' }] },
    }));
    const mock = await startMockLlm({ fixture: fxPath });
    try {
      sb.writeGlobalRuntime({ $schemaVersion: 2, provider: 'anthropic', endpoint: mock.url });
      const r = await complete<{ verdict: string; rationale: string }>({ slug: 'claim-support', system: '', messages: [{ role: 'user', content: 'claim' }] });
      assert.equal(r.data?.verdict, 'SUPPORTED');
      assert.equal(r.data?.rationale, 'fixture');
    } finally {
      await mock.close();
    }
  });
});

test('RUN-21: failure injection maps to the RUN-12 / RUN-24 outcomes', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const call = (slug = 'section-drafter', timeoutMs?: number) =>
      complete({ slug, system: 's', messages: [{ role: 'user', content: 'go' }], ...(timeoutMs ? { timeoutMs } : {}) });
    const m = sb.mock!;

    m.fail({ kind: 'http', status: 401 });
    await assert.rejects(call(), (e: unknown) => e instanceof ProviderHttpError && /rejected the API key \(HTTP 401/.test(e.message) && /ANTHROPIC_API_KEY/.test(e.message));

    m.fail({ kind: 'model_not_found' });
    await assert.rejects(call(), (e: unknown) => e instanceof ProviderHttpError && /does not serve model "claude-opus-5"/.test(e.message) && /\[runtime\] model/.test(e.message));

    m.fail({ kind: 'http', status: 429 }, { times: 5 });
    await assert.rejects(call(), (e: unknown) => e instanceof ProviderHttpError && /HTTP 429/.test(e.message));

    m.fail({ kind: 'http', status: 503 }, { times: 5 });
    await assert.rejects(call(), (e: unknown) => e instanceof ProviderHttpError && /HTTP 503/.test(e.message));

    m.fail({ kind: 'timeout' });
    await assert.rejects(call('section-drafter', 400), (e: unknown) => e instanceof ProviderHttpError && /timed out/.test(e.message));

    m.fail({ kind: 'refusal', category: 'cyber', recommendedModel: 'claude-opus-4-8' });
    await assert.rejects(call(), (e: unknown) => e instanceof ProviderRefusalError && /provider refused \(category: cyber\)/.test(e.message) && /claude-opus-4-8/.test(e.message));

    m.fail({ kind: 'max_tokens' }, { slug: 'section-drafter', times: 2 });
    await assert.rejects(call(), (e: unknown) => e instanceof ProviderTruncatedError && e.exitCode === 1);

    for (const e of [ProviderHttpError, ProviderRefusalError, ProviderTruncatedError]) {
      assert.equal(e.prototype instanceof Error, true);
    }
  });
});

test('RUN-21: close() stops listening and leaves no open socket', async () => {
  await withLlmSandbox({ mock: false, env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const mock = await startMockLlm();
    sb.writeGlobalRuntime({ $schemaVersion: 2, provider: 'anthropic', endpoint: mock.url });
    // A real call leaves a keep-alive connection in the transport's pool.
    await complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: 'go' }] });
    assert.ok(mock.openSockets >= 1, 'the keep-alive socket is tracked');
    const port = Number(new URL(mock.url).port);
    await mock.close();
    assert.equal(mock.listening, false);
    assert.equal(mock.openSockets, 0, 'close() destroyed every socket');
    // The port is free again: a new server can bind it.
    const again = await startMockLlm({ port });
    assert.equal(again.url, `http://127.0.0.1:${port}`);
    await again.close();
  });
});
