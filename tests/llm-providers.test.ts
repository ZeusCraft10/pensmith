// tests/llm-providers.test.ts — RUN-07 / RUN-08 / RUN-24 (D-17-19..D-17-21):
// every provider transport and the Anthropic request policy, observed in the
// captured request bodies (mock LLM) and, for the real hosts, through the V5
// MockAgent seam with PENSMITH_NETWORK_TESTS=1.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { withLlmSandbox, readJsonl } from './helpers/llm-sandbox.js';
import { installMockAgent } from './helpers/local-servers/mock-agent.js';
import { complete, FALLBACK_BETA } from '../bin/lib/anthropic.js';
import { setRuntimeOverride } from '../bin/lib/runtime.js';

const KEY = 'sk-test-providers-0001';
const FORBIDDEN_PARAMS = ['temperature', 'top_p', 'top_k', 'budget_tokens'];

function assertNoSampling(body: Record<string, unknown>, label: string): void {
  for (const k of FORBIDDEN_PARAMS) assert.equal(k in body, false, `${label}: ${k} is never sent`);
  const thinking = body['thinking'] as Record<string, unknown> | undefined;
  assert.equal(thinking?.['budget_tokens'], undefined, `${label}: no budget_tokens`);
  const msgs = body['messages'] as Array<{ role: string }>;
  assert.equal(msgs.at(-1)?.role, 'user', `${label}: no assistant prefill`);
}

test('RUN-24: Opus 5 / Sonnet 5 send adaptive thinking + effort; Haiku 4.5 sends neither; no sampling params', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: 'a' }] });
    setRuntimeOverride({ model: 'claude-sonnet-5' });
    await complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: 'b' }] });
    setRuntimeOverride({});
    await complete({ slug: 'claim-support', system: '', messages: [{ role: 'user', content: 'c' }] });
    const [opus, sonnet] = sb.mock!.bodiesFor('section-drafter');
    const [haiku] = sb.mock!.bodiesFor('claim-support');
    assert.equal(opus!['model'], 'claude-opus-5');
    assert.deepEqual(opus!['thinking'], { type: 'adaptive' });
    assert.equal((opus!['output_config'] as { effort: string }).effort, 'high', 'the drafter runs at high');
    assert.equal(sonnet!['model'], 'claude-sonnet-5');
    assert.deepEqual(sonnet!['thinking'], { type: 'adaptive' });
    assert.equal(haiku!['model'], 'claude-haiku-4-5');
    assert.equal(haiku!['thinking'], undefined, 'Haiku 4.5: no thinking parameter');
    const oc = haiku!['output_config'] as Record<string, unknown>;
    assert.equal(oc['effort'], undefined, 'Haiku 4.5 rejects effort — never sent');
    assert.equal((oc['format'] as { type: string }).type, 'json_schema', 'structured output still sent');
    for (const [b, l] of [[opus, 'opus'], [sonnet, 'sonnet'], [haiku, 'haiku']] as const) assertNoSampling(b!, l);
  });
});

test('RUN-26: cacheSystem slugs send cache_control ephemeral on the system block', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await complete({ slug: 'section-planner', section: 1, system: 'stable planner system', messages: [{ role: 'user', content: 'plan' }] });
    await complete({ slug: 'outline-author', system: 'outline system', messages: [{ role: 'user', content: 'outline' }] });
    const planner = sb.mock!.bodiesFor('section-planner')[0]!;
    assert.deepEqual(planner['system'], [{ type: 'text', text: 'stable planner system', cache_control: { type: 'ephemeral' } }]);
    assert.equal(sb.mock!.bodiesFor('outline-author')[0]!['system'], 'outline system');
  });
});

test('RUN-08: openai — max_completion_tokens, reasoning_effort, strict json_schema, Bearer', async () => {
  await withLlmSandbox({ mock: 'openai', env: { OPENAI_API_KEY: KEY } }, async (sb) => {
    await complete({ slug: 'outline-author', system: 's', messages: [{ role: 'user', content: 'x' }] });
    const body = sb.mock!.bodiesFor('outline-author')[0]!;
    assert.equal(body['model'], 'gpt-6-astra');
    assert.equal(body['max_completion_tokens'], 16_000);
    assert.equal(body['reasoning_effort'], 'medium');
    const rf = body['response_format'] as { type: string; json_schema: { name: string; strict: boolean; schema: Record<string, unknown> } };
    assert.equal(rf.type, 'json_schema');
    assert.equal(rf.json_schema.strict, true);
    assert.equal(rf.json_schema.name, 'outline-author');
    assert.equal((body['messages'] as Array<{ role: string }>)[0]!.role, 'system');
    assertNoSampling(body, 'openai');
    assert.equal(sb.mock!.requests[0]!.headers['authorization'], `Bearer ${KEY}`);
  });
});

test('RUN-08: ollama / vllm / openai-compatible — chat completions at the base URL, max_tokens, auth only when set', async () => {
  for (const provider of ['ollama', 'vllm', 'openai-compatible'] as const) {
    await withLlmSandbox({ mock: provider }, async (sb) => {
      setRuntimeOverride({ model: 'qwen2.5' });
      const r = await complete<{ scopes: unknown[] }>({ slug: 'topic-disambiguator', system: 's', messages: [{ role: 'user', content: 'Topic: sagas' }] });
      const req = sb.mock!.requests.at(-1)!;
      assert.equal(req.path, '/v1/chat/completions', provider);
      assert.equal(req.headers['authorization'], undefined, `${provider}: no Authorization without a key variable`);
      const body = req.body!;
      assert.equal(body['model'], 'qwen2.5');
      assert.equal(body['max_tokens'], 4_000);
      assert.equal(body['max_completion_tokens'], undefined);
      assert.equal(body['reasoning_effort'], undefined);
      const rf = body['response_format'] as { json_schema: { strict?: boolean } };
      assert.equal(rf.json_schema.strict, undefined, 'non-strict json_schema (Ollama format / vLLM guided JSON)');
      assert.ok(Array.isArray(r.data?.scopes));
      assert.equal(r.costUsd, 0, 'local providers price at $0');
    });
  }
  // A configured key variable adds the Authorization header.
  await withLlmSandbox({ mock: 'openai-compatible', runtime: { api_key_env: 'LLM_TEST_API_KEY', model: 'm1' }, env: { LLM_TEST_API_KEY: 'sk-local-key-000001' } }, async (sb) => {
    await complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: 'x' }] });
    assert.equal(sb.mock!.requests.at(-1)!.headers['authorization'], 'Bearer sk-local-key-000001');
  });
});

test('D-17-21: refusal fallbacks are opt-in — "default" + the beta header, priced per usage.iterations, disclosed', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: 'off' }] });
    assert.equal(sb.mock!.bodiesFor('section-drafter')[0]!['fallbacks'], undefined, 'off by default');
    assert.equal(sb.mock!.requests[0]!.headers['anthropic-beta'], undefined);

    sb.writePaperConfig('schema_version = 1\n[runtime]\nrefusal_fallbacks = "default"\n');
    sb.mock!.script('section-drafter', {
      text: 'served by the fallback',
      servedModel: 'claude-opus-4-8',
      iterations: [
        { type: 'message', model: 'claude-opus-5', input_tokens: 1000, output_tokens: 0 },
        { type: 'fallback_message', model: 'claude-opus-4-8', input_tokens: 1000, output_tokens: 400 },
      ],
      extraBlocks: [{ type: 'fallback', from: { model: 'claude-opus-5' }, to: { model: 'claude-opus-4-8' } }],
    });
    const r = await complete({ slug: 'section-drafter', section: 2, system: 's', messages: [{ role: 'user', content: 'on' }] });
    const body = sb.mock!.bodiesFor('section-drafter')[1]!;
    assert.equal(body['fallbacks'], 'default');
    assert.equal(sb.mock!.requests.at(-1)!.headers['anthropic-beta'], FALLBACK_BETA);
    assert.equal(FALLBACK_BETA, 'server-side-fallback-2026-07-01');
    assert.equal(r.text, 'served by the fallback', 'the fallback block is ignored');
    assert.equal(r.servedModel, 'claude-opus-4-8');
    const expected = (1000 * 5) / 1e6 + (1000 * 5 + 400 * 25) / 1e6;
    assert.ok(Math.abs(r.costUsd - expected) < 1e-9, `priced per iteration: ${r.costUsd} vs ${expected}`);
    const recs = readJsonl(path.join(sb.paper, 'SESSION.log')).filter((x) => x['kind'] === 'llm');
    const last = recs.at(-1)!;
    assert.equal(last['fallbacks'], 'default');
    assert.equal(last['fallback_used'], true);
    assert.equal(last['served_model'], 'claude-opus-4-8');

    // Judgment slugs on Haiku 4.5 never send it (not supported there).
    await complete({ slug: 'orphan-label', system: '', messages: [{ role: 'user', content: 'x' }] });
    assert.equal(sb.mock!.bodiesFor('orphan-label')[0]!['fallbacks'], undefined);
  });
});

test('RUN-07: with only OPENAI_API_KEY the real openai host is called (Bearer, default model) — V5 MockAgent', async () => {
  await withLlmSandbox({ env: { OPENAI_API_KEY: KEY, PENSMITH_NETWORK_TESTS: '1' } }, async () => {
    const mock = installMockAgent();
    try {
      let captured: { headers?: Record<string, string>; body?: string } = {};
      mock.agent.get('https://api.openai.com').intercept({ path: '/v1/chat/completions', method: 'POST' }).reply(200, (opts) => {
        captured = { headers: opts.headers as Record<string, string>, body: String(opts.body) };
        return JSON.stringify({ model: 'gpt-6-astra', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
      }, { headers: { 'content-type': 'application/json' } });
      const r = await complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: 'x' }] });
      assert.equal(r.text, 'ok');
      assert.equal(JSON.parse(captured.body!)['model'], 'gpt-6-astra');
      assert.match(JSON.stringify(captured.headers).toLowerCase(), /"authorization":"bearer sk-test-providers-0001"/);
    } finally {
      await mock.restore();
    }
  });
});

test('RUN-07: with only ANTHROPIC_API_KEY the real anthropic host is called with claude-opus-5 — V5 MockAgent', async () => {
  await withLlmSandbox({ env: { ANTHROPIC_API_KEY: KEY, PENSMITH_NETWORK_TESTS: '1' } }, async () => {
    const mock = installMockAgent();
    try {
      let body: Record<string, unknown> = {};
      let headers: Record<string, string> = {};
      mock.agent.get('https://api.anthropic.com').intercept({ path: '/v1/messages', method: 'POST' }).reply(200, (opts) => {
        body = JSON.parse(String(opts.body)) as Record<string, unknown>;
        headers = opts.headers as Record<string, string>;
        return JSON.stringify({ type: 'message', model: 'claude-opus-5', content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: 'hello' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 9 } });
      }, { headers: { 'content-type': 'application/json' } });
      const r = await complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: 'x' }] });
      assert.equal(r.text, 'hello');
      assert.equal(body['model'], 'claude-opus-5');
      const h = JSON.stringify(headers).toLowerCase();
      assert.ok(h.includes('"x-api-key":"sk-test-providers-0001"') && h.includes('"anthropic-version":"2023-06-01"'));
    } finally {
      await mock.restore();
    }
  });
});
