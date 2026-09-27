// tests/llm-ssrf-bypass.test.ts — audit #34 regression + RUN-07 config-time
// endpoint / key-variable policy (S-18, D-17-19).
//
// 1. Source-grep (audit #34): complete()'s provider fetch is a generic-source,
//    never-cached POST that opts out of the redundant SSRF DNS pre-flight for
//    the trusted, globally configured endpoint (untrusted:false), and declares
//    itself an LLM request (llm:{endpoint}, V3) with the response size cap
//    (maxBytes) so http.ts applies the LLM-endpoint policy and the cap.
// 2. Behaviour: a paper's files cannot choose where prompts and keys go. A
//    paper `[runtime] endpoint` / `api_key_env` is a config error naming the
//    GLOBAL runtime.json, nothing is sent and the named variable is never
//    read; a global `api_key_env` outside the key-name rule is rejected.
//    Paper-level provider/model overrides stay per paper.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { complete } from '../bin/lib/anthropic.js';
import { ConfigError } from '../bin/lib/config.js';
import { RuntimeConfigError } from '../bin/lib/runtime.js';

const anthropicSrc = readFileSync(
  fileURLToPath(new URL('../bin/lib/anthropic.ts', import.meta.url)),
  'utf8',
);

test("audit #34: complete()'s provider fetch passes untrusted:false to skip the redundant SSRF preflight", () => {
  assert.match(
    anthropicSrc,
    /source:\s*'generic',[\s\S]{0,80}noCache:\s*true,[\s\S]{0,80}untrusted:\s*false/,
    "complete() must pass untrusted:false alongside source:'generic'/noCache to bypass the redundant SSRF preflight (#34)",
  );
});

test('RUN-07 / V3: every LLM fetch declares llm:{endpoint} and the maxBytes response cap', () => {
  const fetches = anthropicSrc.match(/await fetch\([^;]*?\}\);/gs) ?? [];
  assert.ok(fetches.length >= 2, 'the completion POST and the doctor GET');
  for (const f of fetches) {
    assert.match(f, /llm:\s*\{\s*endpoint\b/, `llm:{endpoint} in: ${f.slice(0, 80)}`);
    assert.match(f, /maxBytes:\s*LLM_MAX_BYTES/, 'the response size cap');
  }
});

/** Count reads of one env variable while `fn` runs. */
async function countEnvReads(name: string, fn: () => Promise<void>): Promise<number> {
  const real = process.env;
  let reads = 0;
  process.env = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === name) reads += 1;
      return Reflect.get(target, prop, receiver) as unknown;
    },
    has(target, prop) {
      if (prop === name) reads += 1;
      return Reflect.has(target, prop);
    },
    getOwnPropertyDescriptor(target, prop) {
      if (prop === name) reads += 1;
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
  });
  try {
    await fn();
  } finally {
    process.env = real;
  }
  return reads;
}

test('RUN-07: a paper [runtime] endpoint or api_key_env fails naming the global runtime.json; nothing is sent; the variable is never read', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test-ssrf-0001' } }, async (sb) => {
    const globalFile = path.join(sb.pensmithData, 'runtime.json');
    process.env['GITHUB_TOKEN'] = 'ghp_should_never_be_read';
    try {
      for (const line of ['endpoint = "http://169.254.169.254/latest"', 'api_key_env = "GITHUB_TOKEN"']) {
        sb.writePaperConfig(`schema_version = 1\n[runtime]\n${line}\n`);
        const reads = await countEnvReads('GITHUB_TOKEN', async () => {
          await assert.rejects(
            complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: 'x' }] }),
            (e: unknown) => e instanceof ConfigError && e.message.includes(globalFile) && !e.message.includes('\n'),
          );
        });
        assert.equal(reads, 0, `GITHUB_TOKEN was never read (${line})`);
      }
    } finally {
      delete process.env['GITHUB_TOKEN'];
    }
    assert.equal(sb.mock!.callCount(), 0, 'nothing was sent');
    // Positive control: the counter does see the configured key variable being read.
    sb.writePaperConfig('schema_version = 1\n');
    const keyReads = await countEnvReads('ANTHROPIC_API_KEY', async () => {
      await complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: 'x' }] });
    });
    assert.ok(keyReads > 0, 'the env-read counter works');
  });
});

test('RUN-07: a GLOBAL api_key_env outside the key-name rule is rejected before any request', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test-ssrf-0002' } }, async (sb) => {
    sb.writeGlobalRuntime({ $schemaVersion: 2, provider: 'anthropic', endpoint: sb.mock!.url, api_key_env: 'GITHUB_TOKEN' });
    await assert.rejects(
      complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: 'x' }] }),
      (e: unknown) => e instanceof RuntimeConfigError && /api_key_env must be ANTHROPIC_API_KEY, OPENAI_API_KEY/.test(e.message),
    );
    assert.equal(sb.mock!.callCount(), 0);
  });
});

test('RUN-07: a paper [runtime] model overrides the global model for that paper only', async () => {
  let mockUrl = '';
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test-ssrf-0003' }, runtime: { model: 'claude-opus-4-8' } }, async (sb) => {
    mockUrl = sb.mock!.url;
    sb.writePaperConfig('schema_version = 1\n[runtime]\nmodel = "claude-sonnet-5"\n');
    await complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: 'a' }] });
    assert.equal(sb.mock!.bodiesFor('section-drafter')[0]!['model'], 'claude-sonnet-5');
  });
  assert.ok(mockUrl);
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test-ssrf-0004' }, runtime: { model: 'claude-opus-4-8' } }, async (sb) => {
    await complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: 'b' }] });
    assert.equal(sb.mock!.bodiesFor('section-drafter')[0]!['model'], 'claude-opus-4-8', 'a second paper without an override keeps the global model');
  });
});
