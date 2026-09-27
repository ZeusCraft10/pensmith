// tests/llm-transport.test.ts — GEN-06 transport contract (Phase 11), migrated
// to the Phase 17 runtime (RUN-21 mock LLM, V5 MockAgent seam).
//
// T-11-01: complete() returns the deterministic stub under PENSMITH_NO_LLM=1 with no request.
// T-11-02: (superseded by RUN-18 / D-17-26) the SESSION cost cap refuses BEFORE any request;
//          the per-scope assertBudget pre-call check was removed from the transport.
// T-11-03: the API key value NEVER appears in any file, stdout or stderr — only in the
//          outgoing x-api-key header.
// T-11-04: MissingApiKeyError propagates out of complete() when no key is configured.
// T-11-05: each generative verb exits non-zero + one stderr line when no LLM is configured.
// T-11-06: each generative verb writes a NON-placeholder artifact under PENSMITH_NO_LLM=1.
// T-11-07: Anthropic → POST https://api.anthropic.com/v1/messages, body + headers.
// T-11-08: OpenAI → POST https://api.openai.com/v1/chat/completions, body + Bearer.
//
// Loopback cases use the mock LLM (tests/helpers/local-servers/mock-llm.ts) through
// the REAL transport. The real-host cases (T-11-07/08) intercept with the V5
// MockAgent seam and set PENSMITH_NETWORK_TESTS=1 for their duration (the
// test-lane live seam). No undici import and no eslint exemption in this file.
// T-11-05/06 spawn the BUILT CLI (run `npm run build` first) with data dirs
// redirected into the temp root.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withLlmSandbox, readJsonl } from './helpers/llm-sandbox.js';
import { installMockAgent } from './helpers/local-servers/mock-agent.js';
import { complete, isNoLlmMode, MissingApiKeyError, ProviderHttpError } from '../bin/lib/anthropic.js';
import { GateRefusedError } from '../bin/lib/gates.js';
import { currentSessionId } from '../bin/lib/session-log.js';
import { _resetWarnedForTest } from '../bin/lib/http.js';

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

const CLI_BIN = path.join(repoRoot(), 'dist', 'bin', 'pensmith.js');

function walk(dir: string): Array<{ path: string; text: string }> {
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ path: string; text: string }> = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push({ path: p, text: fs.readFileSync(p, 'utf8') });
  }
  return out;
}

function captureStdio(): { restore(): { stdout: string; stderr: string } } {
  let stdout = '';
  let stderr = '';
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  // stdout is teed, never swallowed: the node:test reporter writes its TAP
  // lines there, and a swallowed line silently drops a test from the count.
  (process.stdout as unknown as { write: (c: string | Uint8Array) => boolean }).write = (c) => { stdout += String(c); return o(c); };
  (process.stderr as unknown as { write: (c: string | Uint8Array) => boolean }).write = (c) => { stderr += String(c); return true; };
  return {
    restore() {
      (process.stdout as unknown as { write: typeof o }).write = o;
      (process.stderr as unknown as { write: typeof e }).write = e;
      return { stdout, stderr };
    },
  };
}

test('isNoLlmMode: returns true iff PENSMITH_NO_LLM===1', async () => {
  await withLlmSandbox({}, async () => {
    process.env['PENSMITH_NO_LLM'] = '1';
    assert.equal(isNoLlmMode(), true);
    process.env['PENSMITH_NO_LLM'] = '0';
    assert.equal(isNoLlmMode(), false);
    delete process.env['PENSMITH_NO_LLM'];
    assert.equal(isNoLlmMode(), false);
  });
});

test('T-11-01: complete() returns the offline stub under PENSMITH_NO_LLM=1 with no request', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { PENSMITH_NO_LLM: '1' } }, async (sb) => {
    const text = await complete({ slug: 'section-drafter', system: 'You are a helpful assistant.', messages: [{ role: 'user', content: 'Write a short intro.' }] });
    assert.match(text.text, /^\[PENSMITH_NO_LLM placeholder — /);
    assert.equal(text.inputTokens, 0);
    assert.equal(text.outputTokens, 0);
    assert.equal(text.costUsd, 0);
    const structured = await complete<{ label: string }>({ slug: 'orphan-label', system: '', messages: [{ role: 'user', content: 'x' }] });
    assert.ok(structured.data?.label, 'structured slugs get a schema-valid stub object');
    assert.equal(sb.mock!.callCount(), 0, 'no request was sent');
    assert.equal(fs.existsSync(path.join(sb.paper, 'COSTS.jsonl')), false, 'nothing billed');
  });
});

test('T-11-02 (RUN-18): the session cost cap refuses BEFORE any request', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-ant-test-budget-gate-key', PENSMITH_COST_CAP_USD: '1' } }, async (sb) => {
    // $1.00 already spent by THIS session; any further call crosses the $1 cap.
    fs.writeFileSync(path.join(sb.paper, 'COSTS.jsonl'), JSON.stringify({
      ts: new Date().toISOString(), scope: 'task', scopeId: 'test-budget', provider: 'anthropic',
      model: 'claude-haiku-4-5', inputTokens: 100000, outputTokens: 10000, costUsd: 1.0, session: currentSessionId(),
    }) + '\n');
    await assert.rejects(
      complete({ slug: 'orphan-label', system: 'You are a helpful assistant.', messages: [{ role: 'user', content: 'Label this.' }] }),
      (err: unknown) => err instanceof GateRefusedError && err.exitCode === 5 && /\$1\.00 spent this session > cap \$1\.00/.test(err.message),
    );
    assert.equal(sb.mock!.callCount(), 0, 'nothing was sent');
  });
});

test('T-11-03: the API key value never leaks to disk, stdout or stderr — only to the x-api-key header', async () => {
  const KEY_SENTINEL = 'PENSMITH-TEST-SENTINEL-KEY-NOLEAK-A7F2B9C1';
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY_SENTINEL } }, async (sb) => {
    const cap = captureStdio();
    let out: { stdout: string; stderr: string };
    try {
      await complete({ slug: 'section-drafter', section: 1, system: 'You are a helpful assistant.', messages: [{ role: 'user', content: 'Hello.' }] });
    } finally {
      out = cap.restore();
    }
    assert.equal(out.stdout.includes(KEY_SENTINEL), false, 'stdout');
    assert.equal(out.stderr.includes(KEY_SENTINEL), false, 'stderr');
    for (const f of [...walk(sb.root), ...walk(sb.dataDir)]) {
      assert.equal(f.text.includes(KEY_SENTINEL), false, `key leaked to ${f.path}`);
    }
    assert.ok(readJsonl(path.join(sb.paper, 'SESSION.log')).some((r) => r['kind'] === 'llm'), 'the call was logged');
    // Positive: the key WAS sent, in the x-api-key header.
    assert.equal(sb.mock!.callCount(), 1);
    assert.equal(sb.mock!.requests[0]!.headers['x-api-key'], KEY_SENTINEL);
  });
});

test('RUN-12: a model request carries a plain pensmith User-Agent — never the contact email, and no polite-pool WARN', async () => {
  for (const email of ['reviewer@example.com', undefined]) {
    await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test-ua-0001', PENSMITH_CONTACT_EMAIL: email } }, async (sb) => {
      _resetWarnedForTest();
      const cap = captureStdio();
      let out: { stdout: string; stderr: string };
      try {
        await complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: 'go' }] });
      } finally {
        out = cap.restore();
      }
      const ua = sb.mock!.requests[0]!.headers['user-agent'] ?? '';
      assert.match(ua, /^pensmith\/[^\s()]+$/, `plain User-Agent, got ${JSON.stringify(ua)}`);
      assert.ok(!ua.includes('@') && !ua.includes('no-contact'), 'no contact email (or its absence) is sent to the model provider');
      assert.doesNotMatch(out.stderr, /PENSMITH_CONTACT_EMAIL/, 'an LLM-only run prints no polite-pool warning');
    });
  }
});

test('T-11-04: complete() rejects with MissingApiKeyError when no API key is configured', async () => {
  await withLlmSandbox({ mock: 'anthropic' }, async (sb) => {
    await assert.rejects(
      complete({ slug: 'section-drafter', system: 'You are a helpful assistant.', messages: [{ role: 'user', content: 'Hello.' }] }),
      (err: unknown) => {
        assert.ok(err instanceof MissingApiKeyError);
        assert.equal(err.exitCode, 1);
        assert.match(err.message, /Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY \(or configure a local endpoint\)/);
        return true;
      },
    );
    assert.equal(sb.mock!.callCount(), 0);
  });
});

test('RUN-12: a connect timeout reads "could not connect" with the time spent — never the 600s request timeout', async () => {
  await withLlmSandbox({ env: { ANTHROPIC_API_KEY: 'sk-ant-test-connect-timeout', PENSMITH_NETWORK_TESTS: '1' } }, async () => {
    const mock = installMockAgent();
    try {
      const err = Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' });
      mock.agent.get('https://api.anthropic.com').intercept({ path: '/v1/messages', method: 'POST' }).replyWithError(err).persist();
      await assert.rejects(
        complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: 'go' }] }),
        (e: unknown) => {
          assert.ok(e instanceof ProviderHttpError, String(e));
          assert.match(e.message, /^could not connect to anthropic at https:\/\/api\.anthropic\.com\S* \(no answer after \d+(?: ms|s) of connection attempts\) — start the server or fix /);
          assert.doesNotMatch(e.message, /600s|timed out after/);
          return true;
        },
      );
    } finally {
      await mock.restore();
    }
  });
});

test('T-11-07: Anthropic provider sends the current body and both headers to api.anthropic.com', async () => {
  await withLlmSandbox({ env: { ANTHROPIC_API_KEY: 'sk-ant-test-body-shape-key', PENSMITH_NETWORK_TESTS: '1' } }, async () => {
    const mock = installMockAgent();
    try {
      let capturedBody = '';
      let capturedHeaders: Record<string, string | string[]> = {};
      mock.agent.get('https://api.anthropic.com').intercept({ path: '/v1/messages', method: 'POST' }).reply(200, (opts) => {
        capturedHeaders = opts.headers as Record<string, string | string[]>;
        capturedBody = String(opts.body);
        return JSON.stringify({
          id: 'msg_shape_test', type: 'message', role: 'assistant', model: 'claude-opus-5',
          content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'Anthropic shape test response.' }],
          stop_reason: 'end_turn', usage: { input_tokens: 12, output_tokens: 6 },
        });
      }, { headers: { 'content-type': 'application/json' } });
      const result = await complete({ slug: 'section-drafter', system: 'You are an academic writing assistant.', messages: [{ role: 'user', content: 'Write a one-sentence intro.' }] });
      assert.equal(result.text, 'Anthropic shape test response.');
      const body = JSON.parse(capturedBody) as Record<string, unknown>;
      assert.equal(body['model'], 'claude-opus-5');
      assert.equal(body['max_tokens'], 16_000);
      assert.equal(body['system'], 'You are an academic writing assistant.');
      assert.ok(Array.isArray(body['messages']));
      assert.deepEqual(body['thinking'], { type: 'adaptive' });
      assert.equal('temperature' in body, false);
      // WR-02: BOTH headers (AND), and the key value itself.
      const h = JSON.stringify(capturedHeaders).toLowerCase();
      assert.ok(h.includes('x-api-key') && h.includes('anthropic-version'), JSON.stringify(capturedHeaders));
      assert.ok(JSON.stringify(capturedHeaders).includes('sk-ant-test-body-shape-key'));
    } finally {
      await mock.restore();
    }
  });
});

test('T-11-08: OpenAI provider sends the chat-completions body and Authorization: Bearer to api.openai.com', async () => {
  await withLlmSandbox({ env: { OPENAI_API_KEY: 'sk-openai-test-body-shape-key', PENSMITH_NETWORK_TESTS: '1' }, runtime: { provider: 'openai', model: 'gpt-6-astra' } }, async () => {
    const mock = installMockAgent();
    try {
      let capturedBody = '';
      let capturedHeaders: Record<string, string | string[]> = {};
      mock.agent.get('https://api.openai.com').intercept({ path: '/v1/chat/completions', method: 'POST' }).reply(200, (opts) => {
        capturedHeaders = opts.headers as Record<string, string | string[]>;
        capturedBody = String(opts.body);
        return JSON.stringify({
          id: 'chatcmpl-shape-test', object: 'chat.completion', model: 'gpt-6-astra',
          choices: [{ message: { role: 'assistant', content: 'OpenAI shape test response.' }, finish_reason: 'stop', index: 0 }],
          usage: { prompt_tokens: 14, completion_tokens: 7 },
        });
      }, { headers: { 'content-type': 'application/json' } });
      const result = await complete({ slug: 'section-drafter', system: 'You are an academic writing assistant.', messages: [{ role: 'user', content: 'Write a one-sentence intro.' }] });
      assert.equal(result.text, 'OpenAI shape test response.');
      const body = JSON.parse(capturedBody) as Record<string, unknown>;
      assert.equal(body['model'], 'gpt-6-astra');
      assert.equal(body['max_completion_tokens'], 16_000);
      assert.equal(body['reasoning_effort'], 'high');
      const msgs = body['messages'] as Array<{ role: string; content: string }>;
      assert.deepEqual(msgs[0], { role: 'system', content: 'You are an academic writing assistant.' });
      const h = JSON.stringify(capturedHeaders).toLowerCase();
      assert.ok(h.includes('"authorization":"bearer sk-openai-test-body-shape-key"'), JSON.stringify(capturedHeaders));
    } finally {
      await mock.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// T-11-05 + T-11-06: per-verb integration against the BUILT CLI.
// ---------------------------------------------------------------------------

const VERBS_FOR_INTEGRATION = ['intake', 'research', 'outline', 'plan', 'write', 'revise'] as const;
type GenerativeVerb = typeof VERBS_FOR_INTEGRATION[number];

// Minimal args to reach the LLM check. research/outline pass --yolo: their
// default-on approval gates exit 3 in a non-TTY spawn, and PENSMITH_NO_LLM
// stubs the model, not the gates.
const VERB_REQUIRED_ARGS: Record<GenerativeVerb, string[]> = {
  // RUN-09: `new` needs an assignment in a non-interactive run (EXIT_USAGE otherwise).
  intake: ['--from', fileURLToPath(new URL('./fixtures/assignment.txt', import.meta.url))],
  research: ['--yolo'],
  outline: ['--yolo'],
  plan: ['1'],
  write: ['1'],
  revise: ['1', '--revise'],
};

// RUN-11: the CLI rejects anything that is not one of the 16 verbs, so the
// intake and revise implementations are reached through their real commands —
// `new` (bin/cli/intake.ts) and `plan <n> --revise` (the canonical revise
// surface, bin/lib/revise.ts) — while `verb` still names the implementation.
const VERB_CLI_NAME: Record<GenerativeVerb, string> = {
  intake: 'new',
  research: 'research',
  outline: 'outline',
  plan: 'plan',
  write: 'write',
  revise: 'plan',
};

function spawnEnv(tmpRoot: string, extra: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, XDG_DATA_HOME: tmpRoot, LOCALAPPDATA: tmpRoot, HOME: tmpRoot };
  for (const k of ['PENSMITH_NO_LLM', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) delete env[k];
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

for (const verb of VERBS_FOR_INTEGRATION) {
  test(`T-11-05: verb '${verb}' exits non-zero + stderr banner when no LLM is configured`, () => {
    assert.ok(fs.existsSync(CLI_BIN), `${CLI_BIN} missing — run \`npm run build\``);
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `pensmith-t1105-${verb}-`));
    fs.mkdirSync(path.join(tmpRoot, '.paper'), { recursive: true });
    try {
      const result = spawnSync(process.execPath, [CLI_BIN, VERB_CLI_NAME[verb], ...VERB_REQUIRED_ARGS[verb]], {
        cwd: tmpRoot, env: spawnEnv(tmpRoot, {}), encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
      });
      assert.notEqual(result.status, 0, `T-11-05 (${verb}): expected non-zero exit. stderr: ${result.stderr}`);
      // RUN-07: every generative verb calls assertLlmConfigured() and prints the one hint.
      assert.match(result.stderr, /Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY \(or configure a local endpoint\)/, `T-11-05 (${verb})`);
      assert.equal(result.stdout.includes('tier2-placeholder'), false, `T-11-05 (${verb}): GEN-06 violation`);
      assert.equal(result.stdout.includes('"ok":true'), false, `T-11-05 (${verb}): ok:true on the missing-key path`);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test(`T-11-06: verb '${verb}' writes NON-placeholder artifact under PENSMITH_NO_LLM=1`, () => {
    assert.ok(fs.existsSync(CLI_BIN), `${CLI_BIN} missing — run \`npm run build\``);
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `pensmith-t1106-${verb}-`));
    fs.mkdirSync(path.join(tmpRoot, '.paper'), { recursive: true });
    try {
      const result = spawnSync(process.execPath, [CLI_BIN, VERB_CLI_NAME[verb], ...VERB_REQUIRED_ARGS[verb]], {
        cwd: tmpRoot, env: spawnEnv(tmpRoot, { PENSMITH_NO_LLM: '1' }), encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
      });
      assert.equal(result.status, 0, `T-11-06 (${verb}): expected exit 0 under PENSMITH_NO_LLM=1, got ${result.status}. stderr: ${result.stderr}`);
      const combined = walk(path.join(tmpRoot, '.paper')).map((f) => f.text).join('\n');
      assert.equal(combined.includes('tier2-placeholder'), false, `T-11-06 (${verb}): artifact contains 'tier2-placeholder'`);
      assert.equal(result.stdout.includes('tier2-placeholder'), false, `T-11-06 (${verb}): stdout contains 'tier2-placeholder'`);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
}
