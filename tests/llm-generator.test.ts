// tests/llm-generator.test.ts — complete() on the official Anthropic SDK and
// on the OpenAI-compatible path, against a MockAgent behind bin/lib/http.ts.
//
// The old transport read content[0] and required text, so every answer from a
// current model (thinking blocks come first) was rejected, and a cut-off or
// declined answer came back as success. It sent one non-streaming POST under
// a 30 s header timeout with no 529 retry, priced calls by the runtime.json
// key instead of the provider's name, and knew only model IDs no API serves.
// Each test below drives the real complete() through the real SDK and http.ts.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import {
  complete,
  _setGeneratorForTest,
  ProviderError,
  RefusalError,
  TruncatedError,
  GenerationError,
} from '../bin/lib/anthropic.js';
import { _resetBucketsForTest } from '../bin/lib/http.js';
import { anthropicGenerator } from '../bin/lib/generators/anthropic.js';
import { openAiGenerator } from '../bin/lib/generators/openai.js';
import { pensmithDataDir } from '../bin/lib/paths.js';
import { estimateCost } from '../bin/lib/pricing.js';

const ENV_KEYS = [
  'PENSMITH_TEST_CASSETTES', 'PENSMITH_OFFLINE', 'PENSMITH_NO_LLM', 'PENSMITH_COST_CAP_USD',
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_BASE_URL', 'PENSMITH_CONTACT_EMAIL',
  'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'LOCALAPPDATA', 'HOME',
];
const KEY = 'sk-ant-test-generator-key-5f1c';

let saved: Record<string, string | undefined> = {};
let prevDispatcher: Dispatcher;
let agent: MockAgent;
let root: string;
let origCwd: string;

beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ['PENSMITH_TEST_CASSETTES', 'PENSMITH_OFFLINE', 'PENSMITH_NO_LLM', 'PENSMITH_COST_CAP_USD', 'OPENAI_API_KEY', 'ANTHROPIC_BASE_URL']) delete process.env[k];
  process.env['ANTHROPIC_API_KEY'] = KEY;
  process.env['PENSMITH_CONTACT_EMAIL'] = 'someone@example.org';
  root = mkdtempSync(path.join(tmpdir(), 'pensmith-llm-gen-'));
  for (const k of ['XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'LOCALAPPDATA', 'HOME']) process.env[k] = root;
  await fsp.mkdir(path.join(root, '.paper'), { recursive: true });
  origCwd = process.cwd();
  process.chdir(root);
  _resetBucketsForTest();
  prevDispatcher = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});

afterEach(async () => {
  _setGeneratorForTest(null);
  process.chdir(origCwd);
  setGlobalDispatcher(prevDispatcher);
  await agent.close();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// A Messages API stream, as server-sent events
// ---------------------------------------------------------------------------

type Block = { type: 'thinking'; thinking: string } | { type: 'text'; text: string } | { type: 'fallback'; from: string; to: string };

interface StreamSpec {
  model?: string;
  blocks: Block[];
  stopReason: string;
  stopDetails?: Record<string, unknown>;
  inputTokens?: number;
  outputTokens?: number;
  iterations?: Array<Record<string, unknown>>;
}

function sse(events: Array<Record<string, unknown> & { type: string }>): string {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

function messageStream(s: StreamSpec): string {
  const events: Array<Record<string, unknown> & { type: string }> = [{
    type: 'message_start',
    message: {
      id: 'msg_test', type: 'message', role: 'assistant', model: s.model ?? 'claude-opus-5-5', content: [],
      stop_reason: null, stop_sequence: null,
      usage: { input_tokens: s.inputTokens ?? 1000, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }];
  s.blocks.forEach((b, index) => {
    if (b.type === 'thinking') {
      events.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      if (b.thinking) events.push({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: b.thinking } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'c2ln' } });
    } else if (b.type === 'text') {
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } });
    } else {
      events.push({ type: 'content_block_start', index, content_block: { type: 'fallback', from: { model: b.from }, to: { model: b.to } } });
    }
    events.push({ type: 'content_block_stop', index });
  });
  events.push({
    type: 'message_delta',
    delta: { stop_reason: s.stopReason, stop_sequence: null, ...(s.stopDetails ? { stop_details: s.stopDetails } : {}) },
    usage: { output_tokens: s.outputTokens ?? 500, ...(s.iterations ? { iterations: s.iterations } : {}) },
  });
  events.push({ type: 'message_stop' });
  return sse(events);
}

interface Seen { body: Record<string, unknown>; headers: Record<string, string> }

/** Answer POST /v1/messages with each of `answers` in turn; returns what was sent. */
function answerMessages(...answers: Array<{ status?: number; body: string; headers?: Record<string, string> }>): Seen[] {
  const seen: Seen[] = [];
  let i = 0;
  agent.get('https://api.anthropic.com')
    .intercept({ path: (p) => p.startsWith('/v1/messages'), method: 'POST' })
    .reply((opts) => {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries((opts.headers ?? {}) as Record<string, string | string[]>)) {
        headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
      }
      seen.push({ body: JSON.parse(String(opts.body)) as Record<string, unknown>, headers });
      const a = answers[Math.min(i, answers.length - 1)]!;
      i += 1;
      return {
        statusCode: a.status ?? 200,
        data: a.body,
        responseOptions: { headers: { 'content-type': a.status && a.status >= 400 ? 'application/json' : 'text/event-stream', ...(a.headers ?? {}) } },
      };
    })
    .persist();
  return seen;
}

function costRows(): Array<Record<string, unknown>> {
  const file = path.join(root, '.paper', 'COSTS.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

async function writeRuntime(providers: Record<string, unknown>): Promise<void> {
  const dir = pensmithDataDir();
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'runtime.json'), JSON.stringify({ $schemaVersion: 1, providers }), 'utf8');
}

const ASK = { system: 'You draft academic prose.', messages: [{ role: 'user' as const, content: 'Write the introduction.' }] };

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

test('an answer that starts with thinking blocks returns its text blocks, and its cost is recorded', async () => {
  const seen = answerMessages({ body: messageStream({
    blocks: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Coherence ' }, { type: 'text', text: 'persists.' }],
    stopReason: 'end_turn', inputTokens: 1200, outputTokens: 800,
  }) });
  const res = await complete({ ...ASK, role: 'write', scope: 'section', scopeId: 'write-intro' });
  assert.equal(res.text, 'Coherence persists.');
  assert.equal(res.model, 'claude-opus-5-5');

  const [sent] = seen;
  assert.ok(sent);
  assert.equal(sent.body['model'], 'claude-opus-5-5', 'the default model');
  assert.equal(sent.body['stream'], true, 'the answer is streamed');
  for (const k of ['temperature', 'top_p', 'top_k']) assert.ok(!(k in sent.body), `no ${k}`);
  assert.equal((sent.body['output_config'] as { effort?: string }).effort, 'high', 'the write role drafts at high effort');
  assert.equal(sent.body['fallbacks'], 'default');
  assert.match(sent.headers['anthropic-beta'] ?? '', /server-side-fallback-2026-07-01/);
  assert.equal(sent.headers['x-api-key'], KEY);
  const messages = sent.body['messages'] as Array<{ role: string }>;
  assert.equal(messages.at(-1)?.role, 'user', 'no assistant prefill');
  assert.doesNotMatch(sent.headers['user-agent'] ?? '', /someone@example\.org/, 'the registries\' contact email is not sent to the model provider');

  const rows = costRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!['provider'], 'anthropic');
  assert.equal(rows[0]!['model'], 'claude-opus-5-5');
  assert.equal(rows[0]!['scopeId'], 'write-intro');
  assert.ok(Math.abs(Number(rows[0]!['costUsd']) - (1200 * 4 + 800 * 20) / 1e6) < 1e-12, `priced at $4/$20 per Mtok: ${JSON.stringify(rows[0])}`);
});

test('an answer cut off at max_tokens is a TruncatedError, and its cost is still recorded', async () => {
  answerMessages({ body: messageStream({ blocks: [{ type: 'text', text: 'Coherence persists in' }], stopReason: 'max_tokens' }) });
  await assert.rejects(complete({ ...ASK, role: 'write', maxTokens: 64 }), (e: unknown) =>
    e instanceof TruncatedError && e.maxTokens === 64 && /cut off/.test(e.message));
  assert.equal(costRows().length, 1, 'the tokens a truncated answer used are on the ledger');
});

test('a declined request is a RefusalError carrying the category', async () => {
  answerMessages({ body: messageStream({ blocks: [], stopReason: 'refusal', stopDetails: { type: 'refusal', category: 'bio', explanation: 'policy' } }) });
  await assert.rejects(complete({ ...ASK, role: 'write' }), (e: unknown) =>
    e instanceof RefusalError && e.category === 'bio' && e.exitCode === 2 && /declined/.test(e.message));
  assert.equal(costRows().length, 1);
});

test('a 529 overload is retried by the SDK, honouring retry-after', async () => {
  const overloaded = { status: 529, body: JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), headers: { 'retry-after-ms': '5' } };
  const seen = answerMessages(overloaded, { body: messageStream({ blocks: [{ type: 'text', text: 'Done.' }], stopReason: 'end_turn' }) });
  const res = await complete({ ...ASK, role: 'plan' });
  assert.equal(res.text, 'Done.');
  assert.equal(seen.length, 2, 'one retry after the 529');
});

test('a 529 that does not clear is a ProviderError of kind overloaded', async () => {
  const seen = answerMessages({ status: 529, body: JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), headers: { 'retry-after-ms': '5' } });
  await assert.rejects(complete({ ...ASK, role: 'plan' }), (e: unknown) => e instanceof ProviderError && e.kind === 'overloaded' && e.status === 529);
  assert.equal(seen.length, 3, 'the first attempt and two retries');
  assert.equal(costRows().length, 0, 'nothing was generated, so nothing is charged');
});

test('an answer that does not start within the deadline is a timeout, and the request is sent once', async () => {
  // The SDK retries a failed fetch; http.ts refuses to send a POST that may
  // have reached the API again. The error used to say the API "could not be
  // reached", which hid that the model was asked and did not answer in time.
  let hits = 0;
  agent.get('https://api.anthropic.com')
    .intercept({ path: (p) => p.startsWith('/v1/messages'), method: 'POST' })
    .reply(() => {
      hits += 1;
      return { statusCode: 200, data: messageStream({ blocks: [{ type: 'text', text: 'Late.' }], stopReason: 'end_turn' }), responseOptions: { headers: { 'content-type': 'text/event-stream' } } };
    })
    .delay(300)
    .persist();
  _setGeneratorForTest(anthropicGenerator({ apiKey: KEY, timeoutMs: 50 }));
  await assert.rejects(complete({ ...ASK, role: 'write' }), (e: unknown) => {
    assert.ok(e instanceof ProviderError, `got ${String(e)}`);
    assert.equal(e.kind, 'timeout');
    assert.match(e.message, /did not answer within/);
    assert.match(e.message, /not sent again/);
    assert.doesNotMatch(e.message, /could not reach/);
    return true;
  });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(hits, 1, 'one request reached the API');
});

test('a stream that goes quiet partway is a timeout, and the tokens it reported are charged', async () => {
  // MockAgent cannot stall a body halfway, so a local server sends the start
  // of an answer and then nothing.
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(messageStream({ blocks: [], stopReason: 'end_turn', inputTokens: 1200 }).split('event: message_delta')[0]);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const savedNoProxy = [process.env['NO_PROXY'], process.env['no_proxy']];
  process.env['NO_PROXY'] = '127.0.0.1';
  process.env['no_proxy'] = '127.0.0.1';
  setGlobalDispatcher(prevDispatcher);
  try {
    _setGeneratorForTest(anthropicGenerator({ apiKey: KEY, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, timeoutMs: 200 }));
    await assert.rejects(complete({ ...ASK, role: 'write' }), (e: unknown) => {
      assert.ok(e instanceof ProviderError, `got ${String(e)}`);
      assert.equal(e.kind, 'timeout');
      assert.match(e.message, /stopped sending for 200 ms partway through its answer/);
      return true;
    });
    assert.equal(costRows()[0]?.['inputTokens'], 1200);
  } finally {
    setGlobalDispatcher(agent);
    for (const [k, v] of [['NO_PROXY', savedNoProxy[0]], ['no_proxy', savedNoProxy[1]]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('a rejected key is a ProviderError of kind auth that does not echo the key', async () => {
  answerMessages({ status: 401, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
  await assert.rejects(complete({ ...ASK }), (e: unknown) =>
    e instanceof ProviderError && e.kind === 'auth' && !e.message.includes(KEY));
});

test('a JSON Schema is sent as output_config.format, and the parsed answer is returned', async () => {
  const schema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: false };
  const seen = answerMessages({ body: messageStream({ blocks: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"title":"Intro"}' }], stopReason: 'end_turn' }) });
  const res = await complete({ ...ASK, role: 'outline', jsonSchema: schema });
  assert.deepEqual(res.json, { title: 'Intro' });
  const format = (seen[0]!.body['output_config'] as { format?: unknown }).format;
  assert.deepEqual(format, { type: 'json_schema', schema });
});

test('an answer that is not the JSON the schema asked for is a GenerationError', async () => {
  answerMessages({ body: messageStream({ blocks: [{ type: 'text', text: 'Here is the outline: ...' }], stopReason: 'end_turn' }) });
  await assert.rejects(complete({ ...ASK, jsonSchema: { type: 'object' } }), (e: unknown) => e instanceof GenerationError && e.code === 'LLM_BAD_JSON');
});

test('a server-side fallback is priced per model, and its marker block is not text', async () => {
  answerMessages({ body: messageStream({
    model: 'claude-opus-4-8',
    blocks: [{ type: 'fallback', from: 'claude-opus-5-5', to: 'claude-opus-4-8' }, { type: 'text', text: 'Answered by the fallback.' }],
    stopReason: 'end_turn',
    iterations: [
      { type: 'message', input_tokens: 1000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      { type: 'fallback_message', model: 'claude-opus-4-8', input_tokens: 1000, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    ],
  }) });
  const res = await complete({ ...ASK, role: 'write' });
  assert.equal(res.text, 'Answered by the fallback.');
  const rows = costRows();
  assert.deepEqual(rows.map((r) => r['model']), ['claude-opus-5-5', 'claude-opus-4-8']);
  assert.ok(Math.abs(Number(rows[0]!['costUsd']) - 1000 * 4 / 1e6) < 1e-12);
  assert.ok(Math.abs(Number(rows[1]!['costUsd']) - (1000 * 5 + 400 * 25) / 1e6) < 1e-12);
});

test('per-role model and effort come from runtime.json; a model without server-side fallback gets none', async () => {
  await writeRuntime({ anthropic: { name: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY', roles: { verify: { model: 'claude-haiku-5-5', effort: 'medium' } } } });
  const seen = answerMessages({ body: messageStream({ model: "claude-haiku-5-5", blocks: [{ type: "text", text: "claim" }], stopReason: "end_turn" }) });
  await complete({ ...ASK, role: 'verify' });
  const sent = seen[0]!;
  assert.equal(sent.body['model'], 'claude-haiku-5-5');
  assert.equal((sent.body['output_config'] as { effort?: string }).effort, 'medium');
  assert.ok(!('fallbacks' in sent.body), 'Claude Haiku 5.5 has no server-side fallback');
  assert.doesNotMatch(sent.headers['anthropic-beta'] ?? '', /server-side-fallback/);
});

test('a provider keyed "claude" in runtime.json is priced as Anthropic', async () => {
  await writeRuntime({ claude: { name: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY' } });
  answerMessages({ body: messageStream({ blocks: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn', inputTokens: 100, outputTokens: 10 }) });
  const res = await complete({ ...ASK });
  assert.equal(res.text, 'ok');
  assert.equal(costRows()[0]!['provider'], 'anthropic');
  assert.ok(Math.abs(res.costUsd! - estimateCost({ provider: 'anthropic', modelId: 'claude-opus-5-5', inputTokens: 100, outputTokens: 10 })) < 1e-12);
});

test('older models get thinking turned on and only the effort levels they take', async () => {
  // Opus 4.6 to 4.8 and Sonnet 4.6 run without thinking unless asked; Opus 4.6
  // and Sonnet 4.6 have no xhigh, and Opus 4.5 takes only low, medium and high.
  // An effort a model does not take is a 400, so it is lowered to one it does.
  const cases: Array<[string, string, string]> = [
    ['claude-opus-5-5', 'xhigh', 'xhigh'],
    ['claude-opus-4-8', 'max', 'max'],
    ['claude-opus-4-7', 'xhigh', 'xhigh'],
    ['claude-opus-4-6', 'xhigh', 'high'],
    ['claude-sonnet-4-6', 'max', 'max'],
    ['claude-opus-4-5', 'max', 'high'],
  ];
  const seen = answerMessages({ body: messageStream({ blocks: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn' }) });
  for (const [model, effort] of cases) {
    await writeRuntime({ anthropic: { name: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY', roles: { write: { model, effort } } } });
    await complete({ ...ASK, role: 'write' });
  }
  cases.forEach(([model, , sentEffort], i) => {
    const body = seen[i]!.body;
    assert.equal(body['model'], model);
    assert.equal((body['output_config'] as { effort?: string }).effort, sentEffort, `${model} effort`);
    // Opus 5.5 thinks adaptively by default; Opus 4.5 has no adaptive thinking.
    const noThinkingField = model === 'claude-opus-5-5' || model === 'claude-opus-4-5';
    assert.deepEqual(body['thinking'], noThinkingField ? undefined : { type: 'adaptive' }, `${model} thinking`);
  });
});

test('an unlisted model runs, with no effort sent, and is costed at the highest rate', async () => {
  await writeRuntime({ anthropic: { name: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY', defaultModel: 'claude-future-9' } });
  const seen = answerMessages({ body: messageStream({ model: 'claude-future-9', blocks: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn', inputTokens: 1000, outputTokens: 1000 }) });
  const res = await complete({ ...ASK });
  assert.equal(seen[0]!.body['model'], 'claude-future-9');
  assert.ok(!('output_config' in seen[0]!.body), 'effort is sent only to models known to take it');
  assert.ok(Math.abs(res.costUsd! - (1000 * 10 + 1000 * 50) / 1e6) < 1e-12, `highest Anthropic rates ($10/$50): ${res.costUsd}`);
});

test('the SDK\'s requests go through http.ts: in cassette mode an unrecorded call fails as unrecorded', async () => {
  process.env['PENSMITH_TEST_CASSETTES'] = '1';
  await assert.rejects(complete({ ...ASK }), (e: unknown) =>
    e instanceof ProviderError && e.kind === 'connection' && /cassette/i.test(e.message));
});

test('an error event mid-stream is a ProviderError, and the tokens used so far are charged', async () => {
  const partial = sse([
    { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2000, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Half an' } },
    { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
  ]);
  answerMessages({ body: partial });
  await assert.rejects(complete({ ...ASK, role: 'write' }), (e: unknown) => e instanceof ProviderError && e.kind === 'overloaded');
  const rows = costRows();
  assert.equal(rows.length, 1, 'the partial attempt is on the ledger');
  assert.equal(rows[0]!['inputTokens'], 2000);
});

test('a fake Generator can stand in for the provider; the cost cap and ledger still apply', async () => {
  delete process.env['ANTHROPIC_API_KEY'];
  _setGeneratorForTest({
    async generate(req) {
      return { text: `echo ${req.messages.at(-1)!.content}`, model: req.model, stop: 'complete', stopReason: 'end_turn', usage: [{ model: req.model, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }] };
    },
  });
  const res = await complete({ ...ASK, role: 'plan' });
  assert.equal(res.text, 'echo Write the introduction.');
  assert.equal(costRows().length, 1);
});

// ---------------------------------------------------------------------------
// OpenAI-compatible
// ---------------------------------------------------------------------------

function answerChat(origin: string, pathPrefix: string, status: number, body: unknown): Seen[] {
  const seen: Seen[] = [];
  agent.get(origin).intercept({ path: (p) => p.startsWith(pathPrefix), method: 'POST' }).reply((opts) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((opts.headers ?? {}) as Record<string, string | string[]>)) headers[k.toLowerCase()] = String(v);
    seen.push({ body: JSON.parse(String(opts.body)) as Record<string, unknown>, headers });
    return { statusCode: status, data: JSON.stringify(body), responseOptions: { headers: { 'content-type': 'application/json' } } };
  }).persist();
  return seen;
}

const chat = (content: string, finish: string) => ({
  id: 'c', object: 'chat.completion', model: 'gpt-4o',
  choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content } }],
  usage: { prompt_tokens: 100, completion_tokens: 20 },
});

test('the OpenAI path sends max_completion_tokens, never max_tokens', async () => {
  process.env['OPENAI_API_KEY'] = 'sk-openai-test';
  await writeRuntime({ openai: { name: 'openai', apiKeyEnv: 'OPENAI_API_KEY', defaultModel: 'gpt-4o' } });
  const seen = answerChat('https://api.openai.com', '/v1/chat/completions', 200, chat('An answer.', 'stop'));
  const res = await complete({ ...ASK, role: 'plan', maxTokens: 1234 });
  assert.equal(res.text, 'An answer.');
  const body = seen[0]!.body;
  assert.equal(body['max_completion_tokens'], 1234);
  assert.ok(!('max_tokens' in body), 'reasoning models refuse max_tokens');
  assert.equal((body['messages'] as Array<{ role: string }>)[0]!.role, 'system');
  assert.equal(seen[0]!.headers['authorization'], 'Bearer sk-openai-test');
  assert.doesNotMatch(seen[0]!.headers['user-agent'] ?? '', /someone@example\.org/);
});

test('the default OpenAI model is never sent an output limit past its own', async () => {
  // The role limits (64k for a draft, 32k for an outline or plan) suit models
  // that stream and think; gpt-4o and gpt-4o-mini refuse more than 16,384
  // completion tokens with an HTTP 400.
  process.env['OPENAI_API_KEY'] = 'sk-openai-test';
  await writeRuntime({ openai: { name: 'openai', apiKeyEnv: 'OPENAI_API_KEY' } });
  const seen = answerChat('https://api.openai.com', '/v1/chat/completions', 200, chat('An answer.', 'stop'));
  for (const role of ['write', 'outline', 'plan', 'verify'] as const) await complete({ ...ASK, role });
  assert.deepEqual(seen.map((s) => s.body['model']), ['gpt-4o', 'gpt-4o', 'gpt-4o', 'gpt-4o']);
  assert.deepEqual(seen.map((s) => s.body['max_completion_tokens']), [16_384, 16_384, 16_384, 8_000]);

  await writeRuntime({ openai: { name: 'openai', apiKeyEnv: 'OPENAI_API_KEY', defaultModel: 'gpt-4o-mini', roles: { plan: { maxTokens: 20_000 } } } });
  await complete({ ...ASK, role: 'write' });
  await complete({ ...ASK, role: 'plan' });
  assert.equal(seen[4]!.body['max_completion_tokens'], 16_384);
  assert.equal(seen[5]!.body['max_completion_tokens'], 20_000, 'a limit runtime.json sets is sent as set');
});

test('the OpenAI path treats finish_reason length as truncated and content_filter as declined', async () => {
  process.env['OPENAI_API_KEY'] = 'sk-openai-test';
  await writeRuntime({ openai: { name: 'openai', apiKeyEnv: 'OPENAI_API_KEY' } });
  answerChat('https://api.openai.com', '/v1/chat/completions', 200, chat('', 'length'));
  await assert.rejects(complete({ ...ASK }), TruncatedError);
  await agent.close();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  answerChat('https://api.openai.com', '/v1/chat/completions', 200, chat('', 'content_filter'));
  await assert.rejects(complete({ ...ASK }), RefusalError);
});

test('an OpenAI-compatible server at a configured base URL (a local model) is used, at the rates runtime.json sets', async () => {
  process.env['OPENAI_API_KEY'] = 'ollama';
  await writeRuntime({ local: { name: 'openai', apiKeyEnv: 'OPENAI_API_KEY', defaultModel: 'llama3.3', baseUrl: 'http://127.0.0.1:11434/v1', pricePerMtok: { input: 0, output: 0 } } });
  const seen = answerChat('http://127.0.0.1:11434', '/v1/chat/completions', 200, { ...chat('Local answer.', 'stop'), model: 'llama3.3' });
  const res = await complete({ ...ASK, role: 'write' });
  assert.equal(res.text, 'Local answer.');
  assert.equal(seen[0]!.body['model'], 'llama3.3');
  assert.equal(res.costUsd, 0);
});

test('an OpenAI-compatible answer that does not start within the deadline is a timeout, and the request is sent once', async () => {
  // It used to be a ProviderError of kind connection ("could not reach"),
  // which hid that the model was asked and did not answer in time.
  process.env['OPENAI_API_KEY'] = 'sk-openai-test';
  await writeRuntime({ openai: { name: 'openai', apiKeyEnv: 'OPENAI_API_KEY', defaultModel: 'gpt-4o' } });
  let hits = 0;
  agent.get('https://api.openai.com')
    .intercept({ path: (p) => p.startsWith('/v1/chat/completions'), method: 'POST' })
    .reply(() => {
      hits += 1;
      return { statusCode: 200, data: JSON.stringify(chat('Late.', 'stop')), responseOptions: { headers: { 'content-type': 'application/json' } } };
    })
    .delay(300)
    .persist();
  _setGeneratorForTest(openAiGenerator({ apiKey: 'sk-openai-test', timeoutMs: 50 }));
  await assert.rejects(complete({ ...ASK, role: 'write' }), (e: unknown) => {
    assert.ok(e instanceof ProviderError, `got ${String(e)}`);
    assert.equal(e.kind, 'timeout');
    assert.match(e.message, /did not answer within/);
    assert.match(e.message, /not sent again/);
    assert.doesNotMatch(e.message, /could not reach/);
    return true;
  });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(hits, 1, 'one request reached the server');
});

test('common OpenAI chat models are never sent an output limit past their own', async () => {
  // A role default of 64,000 (write) or 16,000 (intake) is past what these
  // models allow, and OpenAI answers that with an HTTP 400.
  process.env['OPENAI_API_KEY'] = 'sk-openai-test';
  const seen = answerChat('https://api.openai.com', '/v1/chat/completions', 200, chat('An answer.', 'stop'));
  const expected: Array<[string, number]> = [
    ['gpt-4.1', 32_768], ['gpt-4.1-mini', 32_768], ['gpt-4.1-nano', 32_768], ['gpt-4.1-2025-04-14', 32_768],
    ['gpt-4-turbo', 4_096], ['gpt-3.5-turbo', 4_096],
  ];
  for (const [model] of expected) {
    await writeRuntime({ openai: { name: 'openai', apiKeyEnv: 'OPENAI_API_KEY', defaultModel: model } });
    await complete({ ...ASK, role: 'write' });
  }
  assert.deepEqual(seen.map((s) => [s.body['model'], s.body['max_completion_tokens']]), expected);
});

test('an HTTP 400 for an output limit past the model\'s names the runtime.json setting for that role', async () => {
  process.env['OPENAI_API_KEY'] = 'sk-openai-test';
  await writeRuntime({ openai: { name: 'openai', apiKeyEnv: 'OPENAI_API_KEY', defaultModel: 'o-something-new' } });
  answerChat('https://api.openai.com', '/v1/chat/completions', 400, {
    error: {
      message: 'max_completion_tokens is too large: 64000. This model supports at most 32768 completion tokens, whereas you provided 64000.',
      type: 'invalid_request_error', param: 'max_completion_tokens', code: 'invalid_value',
    },
  });
  await assert.rejects(complete({ ...ASK, role: 'write' }), (e: unknown) => {
    assert.ok(e instanceof ProviderError, `got ${String(e)}`);
    assert.equal(e.kind, 'bad_request');
    assert.match(e.message, /roles\.write\.maxTokens/);
    assert.match(e.message, /runtime\.json/);
    return true;
  });
  // Any other 400 keeps its own message.
  await agent.close();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  answerChat('https://api.openai.com', '/v1/chat/completions', 400, { error: { message: 'Invalid schema for response_format', type: 'invalid_request_error' } });
  await assert.rejects(complete({ ...ASK, role: 'plan' }), (e: unknown) => {
    assert.ok(e instanceof ProviderError);
    assert.doesNotMatch(e.message, /maxTokens/);
    return true;
  });
});

test('an empty user turn is refused before any provider is asked', async () => {
  // The Messages API answers an empty user message with an HTTP 400.
  let calls = 0;
  _setGeneratorForTest({
    async generate(req) {
      calls += 1;
      return { text: 'x', model: req.model, stop: 'complete', stopReason: 'end_turn', usage: [] };
    },
  });
  for (const content of ['', '  \n\t ']) {
    await assert.rejects(complete({ system: 'S', messages: [{ role: 'user', content }], role: 'intake' }), /empty/);
  }
  assert.equal(calls, 0);
  assert.equal(costRows().length, 0);
});
