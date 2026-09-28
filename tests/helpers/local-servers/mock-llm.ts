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
// Default replies are the contract stubs PENSMITH_NO_LLM uses, fed the same
// hint object (D-18-06): structured slugs get schema-valid JSON from
// bin/lib/llm-stubs.ts, text slugs contract-valid prose from
// bin/lib/llm-text-stubs.ts, both reading the request's data blocks
// (prompt-request.ts promptHints) — so a mocked pipeline advances like a real
// one and a stubbed and a mocked call agree. The slug comes from the
// `x-pensmith-slug` header the transport sends.
//
// Prompt caching (RUN-26, D-18-05) is simulated per model:
//   - Anthropic shape: every block carrying `cache_control` (a system block or
//     a message content block) is a breakpoint; its key is the exact rendered
//     prefix up to and including that block, per model. A prefix shorter than
//     the model's minimum cacheable prefix (llm-models.ts — 512 on
//     claude-opus-5, 4096 on claude-haiku-4-5, 4096 for an unlisted model) is
//     never cached. The longest live entry is read (`cache_read_input_tokens`,
//     refreshing its 5-minute TTL; `ttl: "1h"` is honoured), the prefix up to
//     the last eligible breakpoint beyond it is written
//     (`cache_creation_input_tokens`), and `input_tokens` is the rest.
//   - OpenAI shape: a prompt of >= 1024 tokens is cached automatically; a
//     repeat reads the longest previously seen prefix in 128-token increments
//     (`usage.prompt_tokens_details.cached_tokens`), with the same TTL.
//   Tokens are counted as ceil(chars / 4) of the prompt text. cacheStats()
//   reports the totals; every captured request records the usage it was
//   answered with (`response.usage`).
//
// Test controls: scripted replies per slug, fixture files from
// scripts/extract-fixture.mjs, request capture, per-slug call counts, SSE
// streaming (optionally slow) whenever a request sets `stream: true`, a global
// response delay, an injectable clock (cache TTL), and failure injection (401,
// 404 model_not_found, 429, 5xx, timeout, refusal with stop_details,
// max_tokens, prose-wrapped or invalid JSON). close() destroys every socket, so
// no handle outlives a test.
//
// This is one of the modules under tests/helpers/local-servers/ allowed to
// import node:http (V6 / RUN-29); tests import it instead of node:http.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hasStructuredStub, structuredStub, stubHintsFor } from '../../../bin/lib/llm-stubs.js';
import { hasTextStub, textStub, type StubMessage } from '../../../bin/lib/llm-text-stubs.js';
import {
  OPENAI_CACHE_INCREMENT_TOKENS,
  OPENAI_MIN_CACHEABLE_TOKENS,
  PROMPT_CACHE_TTL_MS,
  cachePrefixRule,
} from '../../../bin/lib/llm-models.js';

export type MockShape = 'anthropic' | 'openai';

export type MockFailure =
  | { kind: 'http'; status: number; errorType?: string; message?: string }
  | { kind: 'model_not_found' }
  | { kind: 'timeout' }
  | { kind: 'refusal'; category?: string | null; explanation?: string; recommendedModel?: string | null; contentFilter?: boolean }
  | { kind: 'max_tokens' }
  /** A reply that ends before the model finished: no stop_reason / finish_reason (a cut stream). */
  | { kind: 'incomplete' }
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

/** What the mock answered a captured request with (set once the reply is sent). */
export interface CapturedResponse {
  status: number;
  /** The reply's usage object (Anthropic `usage` or OpenAI `usage`), null for an error reply. */
  usage: Record<string, unknown> | null;
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
  response?: CapturedResponse;
}

/** Prompt-cache totals since the mock started (or since reset()). */
export interface MockCacheStats {
  /** Live (unexpired) entries. */
  entries: number;
  /** Requests that read a cached prefix, and the tokens they read. */
  reads: number;
  readTokens: number;
  /** Requests that wrote a new prefix, and the tokens they wrote. */
  writes: number;
  writeTokens: number;
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
  /** Which API the server speaks: 'both' (default), or one — the other answers 404. */
  shape?: MockShape | 'both';
  /** Delay every response by this many ms (a "slow" provider; used for session-lock tests). */
  delayMs?: number;
  /** Status for GET /v1/models (default 200; e.g. 401 simulates a rejected key for the doctor probe). */
  modelsStatus?: number;
  /** Delay between SSE chunks when streaming. */
  streamChunkDelayMs?: number;
  /** A fixture object or a path to one (scripts/extract-fixture.mjs output). */
  fixture?: MockFixtureFile | string;
  /** Called after each captured request (the standalone runner logs it). */
  onRequest?: (req: CapturedRequest) => void;
  /** Called once a captured request has been answered (its `response` is set). */
  onResponse?: (req: CapturedRequest) => void;
  /** The clock the prompt-cache TTL uses (default Date.now). */
  now?: () => number;
}

/** Models whose default (adaptive) thinking the mock simulates with a leading empty thinking block. */
const THINKING_MODELS = new Set(['claude-opus-5', 'claude-sonnet-5']);
const THINKING_TOKENS = 64;

function tokensOf(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** The text of one message's content (a string, or text blocks). */
function contentText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.map((b) => (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : '')).join('');
}

/** The request's conversation turns as the stubs read them. */
function messagesOf(body: Record<string, unknown> | null): StubMessage[] {
  const msgs = body?.['messages'];
  if (!Array.isArray(msgs)) return [];
  return msgs.map((m) => {
    const r = (m ?? {}) as { role?: unknown; content?: unknown };
    return { role: typeof r.role === 'string' ? r.role : 'user', content: contentText(r.content) };
  });
}

// ---------------------------------------------------------------------------
// Prompt-cache simulation (RUN-26)
// ---------------------------------------------------------------------------

/** One rendered prompt block: its canonical bytes and its cache breakpoint TTL, if any. */
interface PromptBlock {
  readonly canonical: string;
  readonly chars: number;
  readonly ttlMs: number | null;
}

function ttlOf(cc: unknown): number | null {
  if (!cc || typeof cc !== 'object') return null;
  const c = cc as { type?: unknown; ttl?: unknown };
  if (c.type !== 'ephemeral') return null;
  return c.ttl === '1h' ? 60 * 60 * 1000 : PROMPT_CACHE_TTL_MS;
}

function blockOf(where: string, raw: unknown): PromptBlock {
  if (typeof raw === 'string') return { canonical: `${where}|text|${raw}`, chars: raw.length, ttlMs: null };
  const b = (raw ?? {}) as Record<string, unknown>;
  const rest: Record<string, unknown> = { ...b };
  const cc = rest['cache_control'];
  delete rest['cache_control'];
  const textPart = typeof rest['text'] === 'string' ? (rest['text'] as string) : JSON.stringify(rest);
  return { canonical: `${where}|${String(rest['type'] ?? 'block')}|${textPart}`, chars: textPart.length, ttlMs: ttlOf(cc) };
}

/** The Anthropic prompt in render order (tools, then system, then messages) as blocks. */
function anthropicBlocks(body: Record<string, unknown>): PromptBlock[] {
  const out: PromptBlock[] = [];
  const tools = body['tools'];
  if (Array.isArray(tools)) tools.forEach((t) => out.push(blockOf('tool', t)));
  const sys = body['system'];
  if (typeof sys === 'string') out.push(blockOf('system', sys));
  else if (Array.isArray(sys)) sys.forEach((b) => out.push(blockOf('system', b)));
  const msgs = body['messages'];
  if (Array.isArray(msgs)) {
    msgs.forEach((m, i) => {
      const r = (m ?? {}) as { role?: unknown; content?: unknown };
      const where = `m${i}:${String(r.role)}`;
      if (Array.isArray(r.content)) r.content.forEach((b) => out.push(blockOf(where, b)));
      else out.push(blockOf(where, typeof r.content === 'string' ? r.content : ''));
    });
  }
  return out;
}

/** The OpenAI prompt text in order (every message, role-tagged). */
function chatPromptText(body: Record<string, unknown>): string {
  const msgs = body['messages'];
  if (!Array.isArray(msgs)) return '';
  return msgs.map((m) => {
    const r = (m ?? {}) as { role?: unknown; content?: unknown };
    return `<${String(r.role)}>\n${contentText(r.content)}`;
  }).join('\n');
}

function tokensForChars(chars: number): number {
  return Math.ceil(chars / 4);
}

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
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
  /** Prompt-cache entries: key → expiry (ms) and prefix tokens. */
  private readonly cache = new Map<string, { expires: number; tokens: number }>();
  private readonly stats = { reads: 0, readTokens: 0, writes: 0, writeTokens: 0 };
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

  /** The usage each answered request of `slug` was served with, in order. */
  usagesFor(slug: string): Array<Record<string, unknown>> {
    return this.requests.filter((r) => r.slug === slug && r.response?.usage).map((r) => r.response?.usage as Record<string, unknown>);
  }

  /** Prompt-cache totals (RUN-26 simulation). */
  cacheStats(): MockCacheStats {
    const now = this.now();
    let entries = 0;
    for (const e of this.cache.values()) if (e.expires > now) entries += 1;
    return { entries, ...this.stats };
  }

  /** Forget every prompt-cache entry (a cold cache). */
  clearCache(): void {
    this.cache.clear();
  }

  reset(): void {
    this.requests.length = 0;
    this.scripts.clear();
    this.fixtureUsed.clear();
    this.cache.clear();
    Object.assign(this.stats, { reads: 0, readTokens: 0, writes: 0, writeTokens: 0 });
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  /**
   * Anthropic prompt caching: read the longest live breakpoint prefix, write
   * every eligible breakpoint prefix that is not live, report the tokens of
   * each part.
   */
  private anthropicCache(model: string, body: Record<string, unknown>): { read: number; write: number } {
    const blocks = anthropicBlocks(body);
    const min = cachePrefixRule('anthropic', model).minTokens ?? Number.POSITIVE_INFINITY;
    const now = this.now();
    const points: Array<{ key: string; tokens: number; ttlMs: number }> = [];
    let chars = 0;
    const rendered: string[] = [];
    for (const b of blocks) {
      rendered.push(b.canonical);
      chars += b.chars;
      if (b.ttlMs === null) continue;
      const tokens = tokensForChars(chars);
      if (tokens < min) continue; // below the model's minimum: silently not cached
      points.push({ key: sha(`anthropic\n${model}\n${rendered.join('\n')}`), tokens, ttlMs: b.ttlMs });
    }
    let read = 0;
    for (let i = points.length - 1; i >= 0; i -= 1) {
      const p = points[i] as { key: string; tokens: number; ttlMs: number };
      const hit = this.cache.get(p.key);
      if (hit && hit.expires > now) {
        read = p.tokens;
        hit.expires = now + p.ttlMs; // a read refreshes the entry
        break;
      }
    }
    let written = read;
    for (const p of points) {
      const e = this.cache.get(p.key);
      if (e && e.expires > now) continue;
      this.cache.set(p.key, { expires: now + p.ttlMs, tokens: p.tokens });
      written = Math.max(written, p.tokens);
    }
    return { read, write: written - read };
  }

  /** OpenAI automatic prefix caching (prompts of >= 1024 tokens, 128-token increments). */
  private openaiCache(model: string, body: Record<string, unknown>): number {
    const text = chatPromptText(body);
    if (tokensForChars(text.length) < OPENAI_MIN_CACHEABLE_TOKENS) return 0;
    const now = this.now();
    const chunkChars = OPENAI_CACHE_INCREMENT_TOKENS * 4;
    const first = OPENAI_MIN_CACHEABLE_TOKENS / OPENAI_CACHE_INCREMENT_TOKENS;
    const last = Math.floor(text.length / chunkChars);
    let cached = 0;
    for (let k = first; k <= last; k += 1) {
      const key = sha(`openai\n${model}\n${text.slice(0, k * chunkChars)}`);
      const e = this.cache.get(key);
      if (e && e.expires > now) cached = k * OPENAI_CACHE_INCREMENT_TOKENS;
      this.cache.set(key, { expires: now + PROMPT_CACHE_TTL_MS, tokens: k * OPENAI_CACHE_INCREMENT_TOKENS });
    }
    return cached;
  }

  private countCache(read: number, write: number): void {
    if (read > 0) {
      this.stats.reads += 1;
      this.stats.readTokens += read;
    }
    if (write > 0) {
      this.stats.writes += 1;
      this.stats.writeTokens += write;
    }
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

  /**
   * The default reply: the contract stub for the slug, fed the hints of the
   * request's data blocks exactly as complete() feeds them under
   * PENSMITH_NO_LLM (D-18-06). A request without a known slug gets a short
   * labelled text.
   */
  private defaultReply(slug: string | null, body: Record<string, unknown> | null): MockReply {
    const messages = messagesOf(body);
    if (slug && hasStructuredStub(slug)) return { data: structuredStub(slug, stubHintsFor(messages)) };
    if (slug && hasTextStub(slug)) return { text: textStub(slug, messages) };
    const last = messages.at(-1)?.content ?? '';
    return { text: `mock-llm reply (${slug ?? 'unknown slug'}): ${last.replace(/\s+/g, ' ').slice(0, 80)}` };
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
      const modelsStatus = this.opts.modelsStatus ?? 200;
      if (modelsStatus !== 200) {
        res.writeHead(modelsStatus, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
        return;
      }
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
    const only = this.opts.shape ?? 'both';
    if (!shape || (only !== 'both' && shape !== only)) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `mock-llm: no route ${req.method} ${p}${shape ? ` (this mock speaks ${only} only)` : ''}` } }));
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
    // The real Messages API rejects empty content in any message except an
    // optional final assistant turn (HTTP 400 invalid_request_error).
    const emptyAt = shape === 'anthropic' ? emptyNonFinalMessage(body) : -1;
    if (emptyAt >= 0) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: `messages.${emptyAt}: all messages must have non-empty content except for the optional final assistant message` } }));
      return;
    }
    const reply = this.nextScripted(slug) ?? this.fromFixture(slug, captured.bodySha256) ?? this.defaultReply(slug, body);
    if (this.delayMs > 0) await sleep(this.delayMs);
    await this.respond(res, shape, body ?? {}, reply, captured);
  }

  /** Record what `captured` was answered with and tell the listener. */
  private answered(captured: CapturedRequest, status: number, usage: Record<string, unknown> | null): void {
    captured.response = { status, usage };
    this.opts.onResponse?.(captured);
  }

  private capture(r: Omit<CapturedRequest, 'bodySha256' | 'at'>): CapturedRequest {
    const full: CapturedRequest = { ...r, bodySha256: createHash('sha256').update(r.rawBody, 'utf8').digest('hex'), at: Date.now() };
    this.requests.push(full);
    this.opts.onRequest?.(full);
    return full;
  }

  private async respond(res: ServerResponse, shape: MockShape, body: Record<string, unknown>, reply: MockReply, captured: CapturedRequest): Promise<void> {
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
      this.answered(captured, status, null);
      return;
    }

    const refusal = f?.kind === 'refusal' ? f : null;
    const truncated = f?.kind === 'max_tokens';
    const incomplete = f?.kind === 'incomplete';
    let text = f?.kind === 'text' ? f.text : reply.text ?? (reply.data !== undefined ? JSON.stringify(reply.data) : '');
    if (truncated) text = text.slice(0, Math.max(1, Math.floor(text.length / 2)));
    if (refusal) text = '';
    const thinking = shape === 'anthropic' && THINKING_MODELS.has(model) && !refusal;
    const thinkingTokens = thinking ? (reply.usage?.thinking ?? THINKING_TOKENS) : 0;
    const promptTokens = reply.usage?.input ?? tokensOf(JSON.stringify(body));
    const output = (reply.usage?.output ?? tokensOf(text)) + thinkingTokens;
    const served = reply.servedModel ?? model;
    const stream = body['stream'] === true;

    if (shape === 'anthropic') {
      const blocks: Array<Record<string, unknown>> = [...(reply.extraBlocks ?? [])];
      if (thinking) blocks.push({ type: 'thinking', thinking: '', signature: 'mock-signature' });
      if (!refusal) blocks.push({ type: 'text', text });
      const stopReason = refusal ? 'refusal' : truncated ? 'max_tokens' : 'end_turn';
      const stopDetails = refusal
        ? { type: 'refusal', category: refusal.category === undefined ? 'cyber' : refusal.category, explanation: refusal.explanation ?? 'mock refusal', recommended_model: refusal.recommendedModel ?? null }
        : null;
      // RUN-26: simulated prompt caching, unless the reply scripts the numbers.
      const scripted = reply.usage?.cacheRead !== undefined || reply.usage?.cacheWrite !== undefined;
      const cached = scripted
        ? { read: reply.usage?.cacheRead ?? 0, write: reply.usage?.cacheWrite ?? 0 }
        : this.anthropicCache(model, body);
      if (!scripted) this.countCache(cached.read, cached.write);
      const input = reply.usage?.input ?? Math.max(0, promptTokens - cached.read - cached.write);
      const usage: Record<string, unknown> = {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: cached.write,
        cache_read_input_tokens: cached.read,
      };
      if (reply.iterations) usage['iterations'] = reply.iterations;
      this.answered(captured, 200, usage);
      const message = { id: `msg_mock_${this.requests.length}`, type: 'message', role: 'assistant', model: served, content: blocks, stop_reason: incomplete ? null : stopReason, stop_sequence: null, stop_details: stopDetails, usage };
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
      if (incomplete) {
        res.end(); // the stream ends cleanly at the HTTP level, before message_delta / message_stop
        return;
      }
      await send('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null, ...(stopDetails ? { stop_details: stopDetails } : {}) }, usage: { output_tokens: output } });
      await send('message_stop', { type: 'message_stop' });
      res.end();
      return;
    }

    // OpenAI chat completions
    const finish = refusal ? (refusal.contentFilter ? 'content_filter' : 'stop') : truncated ? 'length' : 'stop';
    const refusalText = refusal && !refusal.contentFilter ? 'I can’t help with that request.' : null;
    // RUN-26: simulated automatic prefix caching, unless the reply scripts it.
    const scriptedRead = reply.usage?.cacheRead;
    const cachedTokens = Math.min(promptTokens, scriptedRead ?? this.openaiCache(model, body));
    if (scriptedRead === undefined) this.countCache(cachedTokens, 0);
    const usage = {
      prompt_tokens: promptTokens,
      completion_tokens: output,
      total_tokens: promptTokens + output,
      prompt_tokens_details: { cached_tokens: cachedTokens },
      completion_tokens_details: { reasoning_tokens: 0 },
    };
    this.answered(captured, 200, usage);
    if (!stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: `chatcmpl-mock-${this.requests.length}`,
        object: 'chat.completion',
        model: served,
        choices: [{ index: 0, message: { role: 'assistant', content: refusal ? null : text, refusal: refusalText }, finish_reason: incomplete ? null : finish }],
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
    if (incomplete) {
      res.end(); // no finish_reason chunk and no [DONE]
      return;
    }
    await chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }] });
    await chunk({ ...base, choices: [], usage });
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

/** Index of the first message with empty content that is not the final assistant turn, else -1. */
function emptyNonFinalMessage(body: Record<string, unknown> | null): number {
  const msgs = body?.['messages'];
  if (!Array.isArray(msgs)) return -1;
  for (let i = 0; i < msgs.length; i += 1) {
    const m = msgs[i] as { role?: unknown; content?: unknown };
    const c = m?.content;
    const empty = (typeof c === 'string' && c.trim().length === 0) || (Array.isArray(c) && c.length === 0);
    const finalAssistant = i === msgs.length - 1 && m?.role === 'assistant';
    if (empty && !finalAssistant) return i;
  }
  return -1;
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
