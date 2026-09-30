// tests/runtime.test.ts — bin/lib/runtime.ts: the global runtime.json (v2 +
// the v1 → v2 migration), resolution precedence (RUN-07, D-17-19), per-slug
// models (RUN-26), key resolution and the no-key-on-disk property (T-01-07).
//
// Superseded behaviour (Phase 17): runtime.json v1 keyed a `providers` map and
// a paper-level `<root>/runtime.json` overlaid it. v2 is one flat provider;
// the paper overlay is retired (a one-time warning names .paper/config.toml
// [runtime]); endpoint and api_key_env come only from the global file.
//
// Isolation: every test runs in tests/helpers/llm-sandbox.ts (temp paper root
// as cwd, temp data dir via XDG_DATA_HOME / LOCALAPPDATA / HOME).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import {
  MissingApiKeyError,
  RuntimeConfigError,
  openAlexKey,
  getProviderApiKey,
  loadRuntimeConfig,
  resolveRuntime,
  resolveSlug,
  runtimeFlagsFromArgv,
  saveRuntimeConfig,
  setRuntimeOverride,
} from '../bin/lib/runtime.js';
import { CURRENT_RUNTIME_CONFIG_VERSION, isAllowedApiKeyEnv } from '../bin/lib/schemas/runtime-config.js';
import { PensmithError } from '../bin/lib/exit-codes.js';
import { parsePaperConfigText } from '../bin/lib/config.js';

function captureStderr<T>(fn: () => Promise<T>): Promise<{ value: T; stderr: string }> {
  const orig = process.stderr.write.bind(process.stderr);
  let stderr = '';
  process.stderr.write = ((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  return fn().then(
    (value) => { process.stderr.write = orig; return { value, stderr }; },
    (e: unknown) => { process.stderr.write = orig; throw e; },
  );
}

test('loadRuntimeConfig with no file returns v2 defaults including the OpenAlex slot', async () => {
  await withLlmSandbox({}, async () => {
    const cfg = await loadRuntimeConfig();
    assert.equal(cfg.$schemaVersion, CURRENT_RUNTIME_CONFIG_VERSION);
    assert.equal(CURRENT_RUNTIME_CONFIG_VERSION, 2);
    assert.equal(cfg.provider, undefined);
    assert.equal(cfg.openalexApiKeyEnv, 'OPENALEX_API_KEY');
    assert.equal(cfg.openalexApiKeyOptional, true);
    assert.equal(cfg.contactEmailEnv, 'PENSMITH_CONTACT_EMAIL');
  });
});

test('D-17-19: a v1 runtime.json migrates to v2 (first provider entry) and is written back', async () => {
  await withLlmSandbox({}, async (sb) => {
    const file = path.join(sb.pensmithData, 'runtime.json');
    fs.writeFileSync(file, JSON.stringify({
      $schemaVersion: 1,
      providers: {
        openai: { name: 'openai', apiKeyEnv: 'OPENAI_API_KEY', defaultModel: 'gpt-5' },
        anthropic: { name: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY' },
      },
      contactEmailEnv: 'MY_CONTACT',
    }));
    const cfg = await loadRuntimeConfig();
    assert.equal(cfg.provider, 'openai');
    assert.equal(cfg.model, 'gpt-5');
    assert.equal(cfg.api_key_env, undefined, 'the provider default variable is not repeated');
    assert.equal(cfg.contactEmailEnv, 'MY_CONTACT');
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    assert.equal(onDisk['$schemaVersion'], 2, 'the migrated file is written back');
    assert.equal(onDisk['providers'], undefined);
  });
});

test('RUN-07: a v1 file naming a non-conforming key variable fails with the rule, not silently', async () => {
  await withLlmSandbox({}, async (sb) => {
    fs.writeFileSync(path.join(sb.pensmithData, 'runtime.json'), JSON.stringify({
      $schemaVersion: 1,
      providers: { anthropic: { name: 'anthropic', apiKeyEnv: 'GITHUB_TOKEN' } },
    }));
    await assert.rejects(loadRuntimeConfig(), (e: unknown) =>
      e instanceof RuntimeConfigError && /api_key_env must be ANTHROPIC_API_KEY, OPENAI_API_KEY or a name matching/.test(e.message));
  });
});

test('RUN-07: api_key_env accepts only the provider variables or *_API_KEY names', () => {
  for (const ok of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GROQ_API_KEY', 'MY_LOCAL_LLM_API_KEY']) assert.ok(isAllowedApiKeyEnv(ok), ok);
  for (const bad of ['GITHUB_TOKEN', 'HOME', 'AWS_SECRET_ACCESS_KEY', 'api_key', '_API_KEY', 'X_API_KEY_2']) assert.equal(isAllowedApiKeyEnv(bad), false, bad);
});

test('RUN-08: an unknown provider is one friendly line listing the valid values (no zod dump)', async () => {
  await withLlmSandbox({ runtime: { provider: 'bogus' } }, async () => {
    await assert.rejects(resolveRuntime(), (e: unknown) => {
      assert.ok(e instanceof RuntimeConfigError);
      assert.match(e.message, /unknown provider "bogus"/);
      assert.match(e.message, /anthropic, openai, ollama, vllm, openai-compatible/);
      assert.ok(!e.message.includes('\n'), 'one line');
      assert.ok(!/invalid_enum_value|ZodError|"code"/.test(e.message), 'no zod dump');
      assert.equal(e.exitCode, 1);
      return true;
    });
  });
  await withLlmSandbox({}, async () => {
    setRuntimeOverride({ provider: 'bogus' });
    await assert.rejects(resolveRuntime(), /unknown provider "bogus" \(--runtime\); valid values: anthropic/);
  });
});

test('RUN-07: precedence — flag > paper config > global > env detection > default', async () => {
  await withLlmSandbox({}, async (sb) => {
    // default
    let rt = await resolveRuntime();
    assert.equal(rt.provider, 'anthropic');
    assert.equal(rt.providerSource, 'default');
    assert.equal(rt.model, 'claude-opus-5');
    assert.equal(rt.endpoint, 'https://api.anthropic.com');
    assert.equal(rt.apiKeyEnv, 'ANTHROPIC_API_KEY');

    // env detection: only OPENAI_API_KEY → openai + its default model
    process.env['OPENAI_API_KEY'] = 'sk-o';
    rt = await resolveRuntime();
    assert.equal(rt.provider, 'openai');
    assert.equal(rt.providerSource, 'env');
    assert.equal(rt.model, 'gpt-6-astra');
    assert.equal(rt.endpoint, 'https://api.openai.com/v1');
    process.env['ANTHROPIC_API_KEY'] = 'sk-a';
    assert.equal((await resolveRuntime()).provider, 'anthropic', 'both keys set → anthropic');

    // global beats env
    sb.writeGlobalRuntime({ $schemaVersion: 2, provider: 'openai', model: 'gpt-5' });
    rt = await resolveRuntime();
    assert.equal(rt.provider, 'openai');
    assert.equal(rt.providerSource, 'global');
    assert.equal(rt.model, 'gpt-5');

    // paper config beats global; the global model (another provider's) does not leak
    sb.writePaperConfig('schema_version = 1\n[runtime]\nprovider = "anthropic"\nmodel = "claude-sonnet-5"\n');
    rt = await resolveRuntime();
    assert.equal(rt.provider, 'anthropic');
    assert.equal(rt.providerSource, 'config');
    assert.equal(rt.model, 'claude-sonnet-5');
    assert.equal(rt.modelSource, 'config');

    // flags beat everything
    setRuntimeOverride(runtimeFlagsFromArgv(['write', '1', '--runtime', 'ollama', '--model=qwen2.5']));
    rt = await resolveRuntime();
    assert.equal(rt.provider, 'ollama');
    assert.equal(rt.providerSource, 'flag');
    assert.equal(rt.model, 'qwen2.5');
    assert.equal(rt.endpoint, 'http://127.0.0.1:11434/v1');
    assert.equal(rt.apiKeyEnv, null, 'local providers need no key variable');
  });
});

test('RUN-08: a local provider has no default model; openai-compatible needs a global endpoint', async () => {
  await withLlmSandbox({ runtime: { provider: 'vllm' } }, async () => {
    const rt = await resolveRuntime();
    assert.equal(rt.model, null);
    assert.equal(rt.endpoint, 'http://127.0.0.1:8000/v1');
  });
  await withLlmSandbox({ runtime: { provider: 'openai-compatible', model: 'm', endpoint: 'http://localhost:8000/v1', api_key_env: 'LLM_TEST_API_KEY' } }, async () => {
    const rt = await resolveRuntime();
    assert.equal(rt.endpoint, 'http://localhost:8000/v1');
    assert.equal(rt.endpointSource, 'global');
    assert.equal(rt.apiKeyEnv, 'LLM_TEST_API_KEY');
    assert.equal(await getProviderApiKey('openai-compatible'), '', 'the key is optional for local providers');
    process.env['LLM_TEST_API_KEY'] = 'sk-local-1234567';
    assert.equal(await getProviderApiKey('openai-compatible'), 'sk-local-1234567');
  });
});

test('RUN-07: the retired paper runtime.json overlay is ignored with a one-time warning', async () => {
  await withLlmSandbox({}, async (sb) => {
    fs.writeFileSync(path.join(sb.root, 'runtime.json'), JSON.stringify({ $schemaVersion: 1, providers: { openai: { name: 'openai', apiKeyEnv: 'OPENAI_API_KEY' } } }));
    const first = await captureStderr(() => resolveRuntime());
    assert.equal(first.value.provider, 'anthropic', 'the overlay is not read');
    assert.match(first.stderr, /is no longer read .*\.paper\/config\.toml \[runtime\]/);
    const second = await captureStderr(() => resolveRuntime());
    assert.equal(second.stderr.includes('no longer read'), false, 'warned once');
  });
});

test('RUN-26: per-slug models — generation on the configured model, judgment on the small model', async () => {
  await withLlmSandbox({}, async (sb) => {
    let rt = await resolveRuntime();
    assert.equal(resolveSlug(rt, 'outline-author').model, 'claude-opus-5');
    assert.equal(resolveSlug(rt, 'section-drafter').effort, 'high');
    assert.equal(resolveSlug(rt, 'claim-support').model, 'claude-haiku-4-5');
    assert.equal(resolveSlug(rt, 'source-evaluator').model, 'claude-haiku-4-5');

    sb.writePaperConfig('schema_version = 1\n[runtime]\neffort = "low"\n[runtime.slugs.claim-support]\nmodel = "claude-sonnet-5"\n');
    rt = await resolveRuntime();
    assert.equal(resolveSlug(rt, 'claim-support').model, 'claude-sonnet-5', 'only Pass 2 changes');
    assert.equal(resolveSlug(rt, 'claim-support').modelSource, 'slug-config');
    assert.equal(resolveSlug(rt, 'orphan-label').model, 'claude-haiku-4-5');
    assert.equal(resolveSlug(rt, 'outline-author').effort, 'low', '[runtime] effort applies to generation slugs');
    assert.equal(resolveSlug(rt, 'orphan-label').effort, 'low', 'judgment keeps its own default (low)');

    setRuntimeOverride({ model: 'claude-sonnet-5' });
    rt = await resolveRuntime();
    assert.equal(resolveSlug(rt, 'section-planner').model, 'claude-sonnet-5', '--model changes generation slugs');
    assert.equal(resolveSlug(rt, 'topic-disambiguator').model, 'claude-haiku-4-5', '--model never changes judgment slugs');

    setRuntimeOverride({ provider: 'ollama', model: 'llama3.3' });
    rt = await resolveRuntime();
    assert.equal(resolveSlug(rt, 'orphan-label').model, 'llama3.3', 'local providers use the configured model for every slug');
  });
});

test('RUN-26: the step aliases `[runtime.slugs.pass2]` / pass4 / evaluator / queries override their prompt slug; an explicit slug table wins', async () => {
  await withLlmSandbox({}, async (sb) => {
    sb.writePaperConfig('schema_version = 1\n[runtime.slugs.pass2]\nmodel = "claude-sonnet-5"\n');
    let rt = await resolveRuntime();
    assert.equal(resolveSlug(rt, 'claim-support').model, 'claude-sonnet-5', '[runtime.slugs.pass2] changes Pass 2');
    assert.equal(resolveSlug(rt, 'claim-support').modelSource, 'slug-config');
    for (const other of ['orphan-label', 'source-evaluator', 'topic-disambiguator']) {
      assert.equal(resolveSlug(rt, other).model, 'claude-haiku-4-5', `${other} is unchanged`);
    }
    assert.equal(resolveSlug(rt, 'section-drafter').model, 'claude-opus-5');

    sb.writePaperConfig(
      'schema_version = 1\n[runtime.slugs.pass4]\neffort = "medium"\n[runtime.slugs.evaluator]\nmodel = "claude-sonnet-5"\n' +
        '[runtime.slugs.queries]\nmodel = "claude-sonnet-5"\n[runtime.slugs.pass2]\nmodel = "claude-opus-5"\n[runtime.slugs.claim-support]\nmodel = "claude-sonnet-5"\n',
    );
    rt = await resolveRuntime();
    assert.equal(resolveSlug(rt, 'orphan-label').effort, 'medium');
    assert.equal(resolveSlug(rt, 'source-evaluator').model, 'claude-sonnet-5');
    assert.equal(resolveSlug(rt, 'topic-disambiguator').model, 'claude-sonnet-5');
    assert.equal(resolveSlug(rt, 'claim-support').model, 'claude-sonnet-5', 'the explicit slug table wins over its alias');
    const cfg = parsePaperConfigText(fs.readFileSync(path.join(sb.paper, 'config.toml'), 'utf8'));
    assert.ok(cfg.warnings.some((w) => /"runtime\.slugs\.pass2" and "runtime\.slugs\.claim-support" name the same step/.test(w)), cfg.warnings.join('\n'));
    assert.ok(!cfg.warnings.some((w) => /unknown prompt slug/.test(w)), 'the aliases are known');
  });
});

test('getProviderApiKey resolves the configured variable; a missing hosted key is a one-line PensmithError', async () => {
  await withLlmSandbox({ runtime: { provider: 'anthropic', api_key_env: 'LLM_TEST_API_KEY' } }, async () => {
    await assert.rejects(getProviderApiKey('anthropic'), (e: unknown) =>
      e instanceof MissingApiKeyError && e instanceof PensmithError && e.exitCode === 1
      && /LLM_TEST_API_KEY is not set/.test(e.message)
      && /Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY \(or configure a local endpoint\)/.test(e.message));
    process.env['LLM_TEST_API_KEY'] = 'sk-test-resolved-1';
    assert.equal(await getProviderApiKey('anthropic'), 'sk-test-resolved-1');
  });
});

test('CRITICAL: persisted runtime.json never contains a resolved key VALUE (T-01-07)', async () => {
  await withLlmSandbox({}, async (sb) => {
    const sentinel = 'SECRET-VALUE-DO-NOT-LEAK-7d1f';
    process.env['LLM_TEST_API_KEY'] = sentinel;
    await saveRuntimeConfig({
      $schemaVersion: 2,
      provider: 'anthropic',
      api_key_env: 'LLM_TEST_API_KEY',
      openalexApiKeyEnv: 'OPENALEX_API_KEY',
      openalexApiKeyOptional: true,
      contactEmailEnv: 'PENSMITH_CONTACT_EMAIL',
    });
    assert.equal(await getProviderApiKey('anthropic'), sentinel);
    const raw = fs.readFileSync(path.join(sb.pensmithData, 'runtime.json'), 'utf8');
    assert.ok(raw.includes('LLM_TEST_API_KEY'), 'the variable NAME is persisted');
    assert.equal(raw.includes(sentinel), false, 'the VALUE never reaches disk');
    for (const f of fs.readdirSync(sb.pensmithData)) {
      const p = path.join(sb.pensmithData, f);
      if (fs.statSync(p).isFile()) assert.equal(fs.readFileSync(p, 'utf8').includes(sentinel), false, `${f} must not hold the key`);
    }
  });
});

test('saveRuntimeConfig refuses an invalid config before touching disk', async () => {
  await withLlmSandbox({}, async (sb) => {
    await assert.rejects(saveRuntimeConfig({ $schemaVersion: 2, api_key_env: 'GITHUB_TOKEN' } as never));
    assert.equal(fs.existsSync(path.join(sb.pensmithData, 'runtime.json')), false);
  });
});

test('openAlexKey: no value when unset (optional), the value when set, the configured variable and `required` from runtime.json', async () => {
  await withLlmSandbox({}, async (sb) => {
    delete process.env['OPENALEX_API_KEY'];
    assert.deepEqual(await openAlexKey(), { value: undefined, envName: 'OPENALEX_API_KEY', required: false });
    process.env['OPENALEX_API_KEY'] = 'oa-key-1';
    try {
      assert.equal((await openAlexKey()).value, 'oa-key-1');
    } finally {
      delete process.env['OPENALEX_API_KEY'];
    }
    sb.writeGlobalRuntime({ $schemaVersion: 2, openalexApiKeyOptional: false });
    assert.deepEqual(await openAlexKey(), { value: undefined, envName: 'OPENALEX_API_KEY', required: true });
  });
});

test('runtime: PENSMITH_S2_API_KEY value never persisted into the runtime config (T-01-07, D-16)', async () => {
  await withLlmSandbox({}, async () => {
    process.env['PENSMITH_S2_API_KEY'] = 'sk-test-secret-do-not-leak';
    try {
      const cfg = await loadRuntimeConfig();
      assert.equal(JSON.stringify(cfg).includes('sk-test-secret-do-not-leak'), false);
    } finally {
      delete process.env['PENSMITH_S2_API_KEY'];
    }
  });
});
