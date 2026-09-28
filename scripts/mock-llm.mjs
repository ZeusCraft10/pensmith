#!/usr/bin/env node
// scripts/mock-llm.mjs — run the RUN-21 mock LLM standalone (D-17-28).
//
//   npm run mock-llm -- --port 18080 [--shape anthropic|openai|both]
//                       [--fixture fx.json] [--delay-ms N] [--stream-delay-ms N]
//                       [--fail <kind>[:<times>]] [--capture requests.jsonl]
//
// The server speaks the Anthropic Messages and OpenAI chat-completions shapes
// (both on one port by default; --shape anthropic|openai answers only that one
// and 404s the other) plus GET /v1/models, and exposes the captured requests at
// GET /__mock/requests (key headers shown only as "[present]"). Point a paper
// at it through the GLOBAL runtime.json in an isolated data dir, e.g.
//   {"$schemaVersion":2,"provider":"anthropic","endpoint":"http://127.0.0.1:18080",
//    "api_key_env":"ANTHROPIC_API_KEY"}
// It is used by the Phase 17 acceptance checks and by later phases (SWEEP-01).
//
// --fail kinds: 401 | 404 (model_not_found) | 429 | 500 | 503 | 529 | timeout |
// refusal | content_filter | max_tokens | incomplete (no stop reason: a cut
// stream) — applied to every request, or to the
// first <times> requests. Runs through tsx (the helper is TypeScript).

import { appendFileSync } from 'node:fs';
import { startMockLlm } from '../tests/helpers/local-servers/mock-llm.ts';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] !== undefined) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : fallback;
}

function failureFor(kind) {
  if (/^\d{3}$/.test(kind)) return kind === '404' ? { kind: 'model_not_found' } : { kind: 'http', status: Number(kind) };
  if (kind === 'timeout') return { kind: 'timeout' };
  if (kind === 'refusal') return { kind: 'refusal', category: 'cyber' };
  if (kind === 'content_filter') return { kind: 'refusal', contentFilter: true };
  if (kind === 'max_tokens') return { kind: 'max_tokens' };
  if (kind === 'incomplete') return { kind: 'incomplete' };
  throw new Error(`mock-llm: unknown --fail kind "${kind}"`);
}

const shape = arg('shape', 'both');
if (!['anthropic', 'openai', 'both'].includes(shape)) {
  process.stderr.write(`mock-llm: --shape must be anthropic, openai or both (got ${shape})\n`);
  process.exit(2);
}
const port = Number(arg('port', '0'));
const capture = arg('capture', undefined);
const mock = await startMockLlm({
  port,
  shape,
  delayMs: Number(arg('delay-ms', '0')),
  streamChunkDelayMs: Number(arg('stream-delay-ms', '0')),
  ...(arg('fixture', undefined) ? { fixture: arg('fixture', undefined) } : {}),
  onRequest: (r) => {
    const model = r.body && typeof r.body.model === 'string' ? r.body.model : '-';
    process.stdout.write(`[mock-llm] ${r.method} ${r.path} slug=${r.slug ?? '-'} model=${model}\n`);
    if (capture) {
      const headers = Object.fromEntries(
        Object.entries(r.headers).map(([k, v]) => [k, k === 'x-api-key' || k === 'authorization' ? '[present]' : v]),
      );
      appendFileSync(capture, JSON.stringify({ ...r, headers }) + '\n');
    }
  },
});

const failArg = arg('fail', undefined);
if (failArg) {
  const [kind, times] = failArg.split(':');
  const failure = failureFor(kind);
  mock.fail(failure, { times: times ? Number(times) : 1_000_000 });
}

process.stdout.write(`mock-llm listening on ${mock.url} (shape: ${shape})\n`);
const stop = async () => {
  await mock.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
