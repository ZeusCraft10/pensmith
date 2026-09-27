// tests/helpers/local-servers/mock-llm.ts — the deterministic mock LLM (RUN-21, D-17-28).
//
// One local server that speaks both the Anthropic Messages API
// (POST /v1/messages) and the OpenAI chat-completions API
// (POST /v1/chat/completions, also served at /chat/completions for bases
// without /v1), plus GET /v1/models (and /models), on 127.0.0.1:<ephemeral>.
// The real transport (bin/lib/anthropic.ts → bin/lib/http.ts) reaches it
// through the runtime `endpoint` configured in the global runtime.json.
//
// Replies use the CURRENT response shapes:
//   - Anthropic: content blocks; for claude-opus-5 / claude-sonnet-5 (adaptive
//     thinking on by default) a leading `thinking` block with EMPTY text (the
//     default `display: "omitted"`), then the text block; usage counts the
//     thinking tokens as output; `stop_reason`, and `stop_details` on refusals.
//   - OpenAI: choices[0].message.{content, refusal}, finish_reason, usage with
//     prompt_tokens_details / completion_tokens_details.
// Structured requests (a slug with a contract) get schema-valid JSON from
// bin/lib/llm-stubs.ts — the same stubs PENSMITH_NO_LLM uses — with hints
// (topic, candidate citekeys, section identity) read from the request so a
// mocked pipeline advances like a real one. The slug comes from the
// `x-pensmith-slug` header the transport sends.
//
// Test controls: scripted replies per slug, fixture files from
// scripts/extract-fixture.mjs, request capture, per-slug call counts, SSE
// streaming (optionally slow) whenever a request sets `stream: true`, a global
// response delay, and failure injection (401, 404 model_not_found, 429, 5xx,
// timeout, refusal with stop_details, max_tokens, prose-wrapped or invalid
// JSON). close() destroys every socket, so no handle outlives a test.
//
// This is one of the modules under tests/helpers/local-servers/ allowed to
// import node:http (V6 / RUN-29); tests import it instead of node:http.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hasStructuredStub, structuredStub } from '../../../bin/lib/llm-stubs.js';
import { parseIntakeMd } from '../../../bin/lib/intake-parse.js';

export type MockShape = 'anthropic' | 'openai';

export type MockFailure =
  | { kind: 'http'; status: number; errorType?: string; message?: string }
  | { kind: 'model_not_found' }
  | { kind: 'timeout' }
  | { kind: 'refusal'; category?: string | null; explanation?: string; recommendedModel?: string | null; contentFilter?: boolean }
  | { kind: 'max_tokens' }
  | { kind: 'text'; text: string };

export interface MockReply {
  /** Reply text (text slugs, or a hand-written structured reply). */
  text?: string;
  /** Structured reply object (serialized as the text). */
  data?: unknown;
  /** Inject a failure instead of a normal reply. */
  failure?: MockFailure;
  /** Override usage numbers. */
  usage?: { input?: number; output?: number; thinking?: number; cacheRead?: number; cacheWrite?: number };
  /** Served model (defaults to the requested model). */
  servedModel?: string;
  /** Anthropic `usage.iterations` (refusal-fallback billing). */
  iterations?: Array<Record<string, unknown>>;
  /** Extra content blocks placed before the text (e.g. a `fallback` block). */
  extraBlocks?: Array<Record<string, unknown>>;
}

export interface CapturedRequest {
  method: string;
  path: string;
  shape: MockShape | 'models';
  slug: string | null;
  headers: Record<string, string>;
  rawBody: string;
  body: Record<string, unknown> | null;
  bodySha256: string;
  at: number;
}

export interface MockFixtureEntry {
  request_sha256: string;
  model?: string;
  text: string;
  data?: unknown;
  stop_reason?: string;
  input_tokens?: number;
  output_tokens?: number;
}

export interface MockFixtureFile {
  version: 1;
  slugs: Record<string, MockFixtureEntry[]>;
}

export interface MockLlmOptions {
  port?: number;
  /** Delay every response by this many ms (a "slow" provider; used for session-lock tests). */
  delayMs?: number;
  /** Delay between SSE chunks when streaming. */
  streamChunkDelayMs?: number;
  /** A fixture object or a path to one (scripts/extract-fixture.mjs output). */
  fixture?: MockFixtureFile | string;
  /** Called after each captured request (the standalone runner logs it). */
  onRequest?: (req: CapturedRequest) => void;
}

/** Models whose default (adaptive) thinking the mock simulates with a leading empty thinking block. */
const THINKING_MODELS = new Set(['claude-opus-5', 'claude-sonnet-5']);
const THINKING_TOKENS = 64;

function tokensOf(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function requestText(body: Record<string, unknown> | null): string {
  if (!body) return '';
  const parts: string[] = [];
  const sys = body['system'];
  if (typeof sys === 'string') parts.push(sys);
  else if (Array.isArray(sys)) for (const b of sys) if (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string') parts.push((b as { text: string }).text);
  const msgs = body['messages'];
  if (Array.isArray(msgs)) {
    for (const m of msgs) {
      const c = (m as { content?: unknown }).content;
      if (typeof c === 'string') parts.push(c);
    }
  }
  return parts.join('\n');
}

/** Hints the stubs use so a mocked pipeline advances like a real one. */
function hintsFrom(slug: string, text: string, lastUser: string): Record<string, unknown> {
  const citekeys = [...new Set([...text.matchAll(/"citekey"\s*:\s*"([^"]+)"/g)].map((m) => m[1] as string))];
  // INTAKE.md carries a `Topic:` line; the intake request itself carries only the
  // assignment, from which the heuristic the research step uses derives it.
  const topic = /^Topic:\s*(.+)$/m.exec(text)?.[1]?.trim() || parseIntakeMd(lastUser).topic.trim() || undefined;
  const hint: Record<string, unknown> = { citekeys, sources: citekeys };
  if (topic) hint['topic'] = topic;
  if (slug === 'section-planner') {
    const m = /"number"\s*:\s*(\d+)\s*,\s*"slug"\s*:\s*"([^"]+)"\s*,\s*"title"\s*:\s*"([^"]*)"/.exec(text);
    if (m) {
      hint['section'] = Number(m[1]);
      hint['slug'] = m[2];
      hint['title'] = m[3];
    }
    const deps = /"depends_on"\s*:\s*\[([^\]]*)\]/.exec(text)?.[1];
    if (deps) hint['depends_on'] = [...deps.matchAll(/"([^"]+)"/g)].map((d) => d[1] as string);
  }
  return hint;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class MockLlm {
  readonly url: string;
  readonly requests: CapturedRequest[] = [];
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly scripts = new Map<string, MockReply[]>();
  private readonly fixture: MockFixtureFile | null;
  private readonly fixtureUsed = new Set<MockFixtureEntry>();
  private readonly opts: MockLlmOptions;
  delayMs: number;

  constructor(server: Server, url: string, opts: MockLlmOptions) {
    this.server = server;
    this.url = url;
    this.opts = opts;
    this.delayMs = opts.delayMs ?? 0;
    const fx = opts.fixture;
    this.fixture = typeof fx === 'string' ? (JSON.parse(readFileSync(fx, 'utf8')) as MockFixtureFile) : fx ?? null;
    server.on('connection', (s: Socket) => {
      this.sockets.add(s);
      s.on('close', () => this.sockets.delete(s));
    });
  }

  /** Queue replies for a slug ('*' = any slug). Consumed in order; then the default reply applies. */
  script(slug: string, ...replies: MockReply[]): void {
    const q = this.scripts.get(slug) ?? [];
    q.push(...replies);
    this.scripts.set(slug, q);
  }

  /** Inject `failure` for the next `times` requests of `slug` ('*' = any). */
  fail(failure: MockFailure, opts: { slug?: string; times?: number } = {}): void {
    const times = opts.times ?? 1;
    for (let i = 0; i < times; i += 1) this.script(opts.slug ?? '*', { failure });
  }

  /** Number of model calls (POST) received, optionally for one slug. */
  callCount(slug?: string): number {
    return this.requests.filter((r) => r.shape !== 'models' && (slug === undefined || r.slug === slug)).length;
  }

  /** Captured POST bodies for a slug. */
  bodiesFor(slug: string): Array<Record<string, unknown>> {
    return this.requests.filter((r) => r.slug === slug && r.body).map((r) => r.body as Record<string, unknown>);
  }

  reset(): void {
    this.requests.length = 0;
    this.scripts.clear();
    this.fixtureUsed.clear();
  }

  /** Stop listening and destroy every open socket (no handle outlives the test). */
  async close(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** Whether the server still listens (for the no-leftover-socket assertion). */
  get listening(): boolean {
    return this.server.listening;
  }

  get openSockets(): number {
    return this.sockets.size;
  }

  // -------------------------------------------------------------------------

  private nextScripted(slug: string | null): MockReply | null {
    for (const key of [slug ?? '', '*']) {
      const q = this.scripts.get(key);
      if (q && q.length > 0) return q.shift() as MockReply;
    }
    return null;
  }

  private fromFixture(slug: string | null, sha: string): MockReply | null {
    if (!this.fixture || !slug) return null;
    const list = this.fixture.slugs[slug] ?? [];
    const exact = list.find((e) => e.request_sha256 === sha);
    const entry = exact ?? list.find((e) => !this.fixtureUsed.has(e));
    if (!entry) return null;
    this.fixtureUsed.add(entry);
    const usage: NonNullable<MockReply['usage']> = {};
    if (entry.input_tokens !== undefined) usage.input = entry.input_tokens;
    if (entry.output_tokens !== undefined) usage.output = entry.output_tokens;
    return {
      text: entry.text,
      ...(entry.data !== undefined ? { data: entry.data } : {}),
      ...(entry.stop_reason === 'max_tokens' ? { failure: { kind: 'max_tokens' } as MockFailure } : {}),
      ...(entry.model ? { servedModel: entry.model } : {}),
      usage,
    };
  }

  private defaultReply(slug: string | null, body: Record<string, unknown> | null): MockReply {
    const text = requestText(body);
    const last = Array.isArray(body?.['messages']) ? (body?.['messages'] as Array<{ content?: unknown }>).at(-1)?.content : '';
    const lastText = typeof last === 'string' ? last : '';
    if (slug && hasStructuredStub(slug)) return { data: structuredStub(slug, hintsFrom(slug, text, lastText)) };
    return { text: `mock-llm reply (${slug ?? 'unknown slug'}): ${lastText.replace(/\s+/g, ' ').slice(0, 80)}` };
  }

  /** @internal request handler */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const p = url.pathname;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v ?? '');

    if (req.method === 'GET' && p === '/__mock/requests') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(this.requests.map((r) => ({ ...r, headers: redactHeaders(r.headers) }))));
      return;
    }
    if (req.method === 'GET' && (p === '/v1/models' || p === '/models')) {
      this.capture({ method: 'GET', path: p, shape: 'models', slug: null, headers, rawBody, body: null });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'gpt-6-astra', 'gpt-6-luna'].map((id) => ({ id, type: 'model', object: 'model', display_name: id })),
        has_more: false,
      }));
      return;
    }
    const shape: MockShape | null = req.method === 'POST' && p === '/v1/messages'
      ? 'anthropic'
      : req.method === 'POST' && (p === '/v1/chat/completions' || p === '/chat/completions')
        ? 'openai'
        : null;
    if (!shape) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `mock-llm: no route ${req.method} ${p}` } }));
      return;
    }

    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      body = null;
    }
    const slug = headers['x-pensmith-slug'] || null;
    const captured = this.capture({ method: 'POST', path: p, shape, slug, headers, rawBody, body });
    const reply = this.nextScripted(slug) ?? this.fromFixture(slug, captured.bodySha256) ?? this.defaultReply(slug, body);
    if (this.delayMs > 0) await sleep(this.delayMs);
    await this.respond(res, shape, body ?? {}, reply);
  }

  private capture(r: Omit<CapturedRequest, 'bodySha256' | 'at'>): CapturedRequest {
    const full: CapturedRequest = { ...r, bodySha256: createHash('sha256').update(r.rawBody, 'utf8').digest('hex'), at: Date.now() };
    this.requests.push(full);
    this.opts.onRequest?.(full);
    return full;
  }

  private async respond(res: ServerResponse, shape: MockShape, body: Record<string, unknown>, reply: MockReply): Promise<void> {
    const model = typeof body['model'] === 'string' ? (body['model'] as string) : 'unknown-model';
    const f = reply.failure;
    if (f?.kind === 'timeout') return; // never answer; close() destroys the socket
    if (f?.kind === 'http' || f?.kind === 'model_not_found') {
      const status = f.kind === 'model_not_found' ? 404 : f.status;
      const type = f.kind === 'model_not_found'
        ? (shape === 'anthropic' ? 'not_found_error' : 'model_not_found')
        : (f.errorType ?? (status === 401 ? 'authentication_error' : status === 429 ? 'rate_limit_error' : status >= 500 ? 'api_error' : 'invalid_request_error'));
      const message = f.kind === 'model_not_found' ? `model: ${model}` : (f.message ?? `mock ${status}`);
      const errBody = shape === 'anthropic'
        ? { type: 'error', error: { type, message } }
        : { error: { message, type: f.kind === 'model_not_found' ? 'invalid_request_error' : type, code: f.kind === 'model_not_found' ? 'model_not_found' : null } };
      res.writeHead(status, { 'content-type': 'application/json', 'retry-after': '0' });
      res.end(JSON.stringify(errBody));
      return;
    }

    const refusal = f?.kind === 'refusal' ? f : null;
    const truncated = f?.kind === 'max_tokens';
    let text = f?.kind === 'text' ? f.text : reply.text ?? (reply.data !== undefined ? JSON.stringify(reply.data) : '');
    if (truncated) text = text.slice(0, Math.max(1, Math.floor(text.length / 2)));
    if (refusal) text = '';
    const thinking = shape === 'anthropic' && THINKING_MODELS.has(model) && !refusal;
    const thinkingTokens = thinking ? (reply.usage?.thinking ?? THINKING_TOKENS) : 0;
    const input = reply.usage?.input ?? tokensOf(JSON.stringify(body));
    const output = (reply.usage?.output ?? tokensOf(text)) + thinkingTokens;
    const served = reply.servedModel ?? model;
    const stream = body['stream'] === true;

    if (shape === 'anthropic') {
      const blocks: Array<Record<string, unknown>> = [...(reply.extraBlocks ?? [])];
      if (thinking) blocks.push({ type: 'thinking', thinking: '', signature: 'mock-signature' });
      if (!refusal) blocks.push({ type: 'text', text });
      const stopReason = refusal ? 'refusal' : truncated ? 'max_tokens' : 'end_turn';
      const stopDetails = refusal
        ? { type: 'refusal', category: refusal.category ?? 'cyber', explanation: refusal.explanation ?? 'mock refusal', recommended_model: refusal.recommendedModel ?? null }
        : null;
      const usage: Record<string, unknown> = {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: reply.usage?.cacheWrite ?? 0,
        cache_read_input_tokens: reply.usage?.cacheRead ?? 0,
      };
      if (reply.iterations) usage['iterations'] = reply.iterations;
      const message = { id: `msg_mock_${this.requests.length}`, type: 'message', role: 'assistant', model: served, content: blocks, stop_reason: stopReason, stop_sequence: null, stop_details: stopDetails, usage };
      if (!stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(message));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = async (event: string, data: unknown): Promise<void> => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        if (this.opts.streamChunkDelayMs) await sleep(this.opts.streamChunkDelayMs);
      };
      await send('message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null, stop_details: null, usage: { input_tokens: input, output_tokens: 1, cache_creation_input_tokens: usage['cache_creation_input_tokens'], cache_read_input_tokens: usage['cache_read_input_tokens'] } } });
      let index = 0;
      for (const b of blocks) {
        if (b['type'] === 'text') {
          await send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
          const t = String(b['text'] ?? '');
          for (let i = 0; i < t.length; i += 24) {
            await send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: t.slice(i, i + 24) } });
          }
        } else {
          await send('content_block_start', { type: 'content_block_start', index, content_block: b });
        }
        await send('content_block_stop', { type: 'content_block_stop', index });
        index += 1;
      }
      await send('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null, ...(stopDetails ? { stop_details: stopDetails } : {}) }, usage: { output_tokens: output } });
      await send('message_stop', { type: 'message_stop' });
      res.end();
      return;
    }

    // OpenAI chat completions
    const finish = refusal ? (refusal.contentFilter ? 'content_filter' : 'stop') : truncated ? 'length' : 'stop';
    const refusalText = refusal && !refusal.contentFilter ? 'I can’t help with that request.' : null;
    const usage = {
      prompt_tokens: input,
      completion_tokens: output,
      total_tokens: input + output,
      prompt_tokens_details: { cached_tokens: reply.usage?.cacheRead ?? 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
    };
    if (!stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: `chatcmpl-mock-${this.requests.length}`,
        object: 'chat.completion',
        model: served,
        choices: [{ index: 0, message: { role: 'assistant', content: refusal ? null : text, refusal: refusalText }, finish_reason: finish }],
        usage,
      }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const chunk = async (data: unknown): Promise<void> => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      if (this.opts.streamChunkDelayMs) await sleep(this.opts.streamChunkDelayMs);
    };
    const base = { id: `chatcmpl-mock-${this.requests.length}`, object: 'chat.completion.chunk', model: served };
    if (refusalText) await chunk({ ...base, choices: [{ index: 0, delta: { refusal: refusalText }, finish_reason: null }] });
    for (let i = 0; !refusal && i < text.length; i += 24) {
      await chunk({ ...base, choices: [{ index: 0, delta: { content: text.slice(i, i + 24) }, finish_reason: null }] });
    }
    await chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }] });
    await chunk({ ...base, choices: [], usage });
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

function redactHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k] = k === 'x-api-key' || k === 'authorization' ? '[present]' : v;
  return out;
}

/** Start a mock LLM on 127.0.0.1 (port 0 = ephemeral). */
export async function startMockLlm(opts: MockLlmOptions = {}): Promise<MockLlm> {
  let mock: MockLlm | null = null;
  const server = createServer((req, res) => {
    void mock?.handle(req, res).catch((e: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `mock-llm internal error: ${String(e)}` } }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  mock = new MockLlm(server, `http://127.0.0.1:${port}`, opts);
  return mock;
}
