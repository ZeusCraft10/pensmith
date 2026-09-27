// tests/llm-doctor-probe.test.ts — RUN-07 / RUN-08: the doctor
// runtime-config-presence probe.
//
// It names the resolved provider, model and key variable (with their source),
// lists presence booleans only (never a key value — sentinel), prints the
// "Set one of: …" hint when no key is set, FAILs an invalid runtime listing the
// valid providers, and probes a local / configured endpoint with GET /models.

import test from 'node:test';
import assert from 'node:assert/strict';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { startMockLlm } from './helpers/local-servers/mock-llm.js';
import { runtimeConfigPresenceProbe } from '../bin/lib/doctor/probes/runtime-config-presence.js';

const SENTINEL = 'sk-DOCTOR-SENTINEL-0123456789';

test('RUN-07: no key → WARN with the one "Set one of" hint; presence booleans only', async () => {
  await withLlmSandbox({}, async () => {
    const r = await runtimeConfigPresenceProbe.run();
    assert.equal(r.severity, 'WARN');
    assert.equal(r.fix, 'Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY (or configure a local endpoint).');
    assert.match(r.summary, /provider anthropic \(default\), model claude-opus-5 \(default\), key ANTHROPIC_API_KEY \(default\): absent/);
    const detail = JSON.parse(r.detail ?? '[]') as Array<{ name: string; apiKeyEnv: string; present: boolean }>;
    assert.deepEqual(detail.map((d) => [d.name, d.apiKeyEnv, d.present]), [['anthropic', 'ANTHROPIC_API_KEY', false], ['openai', 'OPENAI_API_KEY', false]]);
    assert.match(r.summary, /refusal fallbacks: off/);
    assert.match(r.summary, /PENSMITH_NO_LLM replaces every LLM call with a deterministic stub/);
  });
});

test('RUN-07: only OPENAI_API_KEY → openai (env detection) with gpt-6-astra; the value never appears', async () => {
  await withLlmSandbox({ env: { OPENAI_API_KEY: SENTINEL } }, async () => {
    const r = await runtimeConfigPresenceProbe.run();
    assert.equal(r.severity, 'PASS', r.summary);
    assert.match(r.summary, /provider openai \(env\), model gpt-6-astra \(default\), key OPENAI_API_KEY \(default\): present/);
    assert.match(r.summary, /endpoint https:\/\/api\.openai\.com\/v1: not probed \(sources offline\)/);
    for (const text of [r.summary, r.detail ?? '', r.fix ?? '']) assert.equal(text.includes('SENTINEL'), false);
  });
});

test('RUN-08: an unknown provider in the global runtime.json FAILs and lists the valid providers', async () => {
  await withLlmSandbox({ runtime: { provider: 'bedrock' } }, async () => {
    const r = await runtimeConfigPresenceProbe.run();
    assert.equal(r.severity, 'FAIL');
    assert.match(r.summary, /unknown provider "bedrock" \(valid values: anthropic, openai, ollama, vllm, openai-compatible\)/);
    assert.equal(r.fix, 'Use one of the valid providers: anthropic, openai, ollama, vllm, openai-compatible.');
  });
});

test('RUN-08: a local provider endpoint is probed with GET /models — PASS when up, WARN when down', async () => {
  await withLlmSandbox({ env: { ANTHROPIC_API_KEY: undefined } }, async (sb) => {
    const mock = await startMockLlm();
    const endpoint = `${mock.url}/v1`;
    sb.writeGlobalRuntime({ $schemaVersion: 2, provider: 'ollama', model: 'qwen2.5', endpoint });
    try {
      const up = await runtimeConfigPresenceProbe.run();
      assert.equal(up.severity, 'PASS', up.summary);
      assert.match(up.summary, /no key variable \(local provider\)/);
      assert.match(up.summary, /GET http:\/\/127\.0\.0\.1:\d+\/v1\/models → 200: PASS/);
      assert.equal(mock.requests.at(-1)!.path, '/v1/models');
    } finally {
      await mock.close();
    }
    const down = await runtimeConfigPresenceProbe.run();
    assert.equal(down.severity, 'WARN');
    assert.match(down.summary, /WARN \(not reachable\)/);
    assert.equal(down.fix, 'Start the ollama server or fix "endpoint" in the global runtime.json.');
  });
});

test('RUN-07: a configured endpoint that answers 401 is up but rejected the key — the fix names the key variable', async () => {
  await withLlmSandbox({ env: { ANTHROPIC_API_KEY: SENTINEL } }, async (sb) => {
    const mock = await startMockLlm({ modelsStatus: 401 });
    sb.writeGlobalRuntime({ $schemaVersion: 2, provider: 'anthropic', endpoint: mock.url });
    try {
      const r = await runtimeConfigPresenceProbe.run();
      assert.equal(r.severity, 'WARN');
      assert.match(r.summary, /→ HTTP 401: WARN \(the key in ANTHROPIC_API_KEY was rejected\)/);
      assert.equal(r.fix, 'Check ANTHROPIC_API_KEY: the anthropic endpoint rejected it (a revoked, mistyped or wrong-provider key).');
      for (const text of [r.summary, r.detail ?? '', r.fix ?? '']) assert.equal(text.includes('SENTINEL'), false);
    } finally {
      await mock.close();
    }
  });
});

test('RUN-07: a hosted endpoint is not probed while its key is absent (a keyless request only proves a 401)', async () => {
  await withLlmSandbox({ env: { ANTHROPIC_API_KEY: undefined } }, async (sb) => {
    const mock = await startMockLlm();
    sb.writeGlobalRuntime({ $schemaVersion: 2, provider: 'anthropic', endpoint: mock.url });
    try {
      const r = await runtimeConfigPresenceProbe.run();
      assert.equal(r.severity, 'WARN');
      assert.match(r.summary, /endpoint http:\/\/127\.0\.0\.1:\d+: not probed \(no key\)/);
      assert.equal(mock.requests.length, 0, 'no keyless request is sent');
    } finally {
      await mock.close();
    }
  });
});
