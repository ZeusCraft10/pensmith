// tests/mock-llm.test.ts — RUN-21 (D-17-28): the deterministic mock LLM, driven
// through the REAL transport (bin/lib/anthropic.ts complete() → bin/lib/http.ts).
//
// Covers: both wire shapes (captured body, text parsed with the thinking block
// ignored, call counts), GET /v1/models, SSE streaming (and slow streaming),
// scripted replies, fixture files, every failure injection mapped to its
// RUN-12 / RUN-24 outcome, that close() leaves no listening socket, and that
// the default replies read the request's data blocks exactly as the
// PENSMITH_NO_LLM stubs do (D-18-06). The prompt-cache simulation is covered by
// tests/prompt-cache.test.ts.

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
import { textStub } from '../bin/lib/llm-text-stubs.js';
import { buildPromptRequest, requestHints } from '../bin/lib/prompt-request.js';
import { expandTopicQueries } from '../bin/lib/query-expansion.js';

const KEY = 'sk-test-mock-llm-key-0001';

test('RUN-21: anthropic shape — captured body, thinking block ignored, thinking billed as output', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const res = await complete({ slug: 'section-drafter', section: 1, system: 'sys', messages: [{ role: 'user', content: 'Write section 1 (intro).' }] });
    const mock = sb.mock!;
    assert.equal(mock.callCount(), 1);
    assert.equal(mock.callCount('section-drafter'), 1);
    const body = mock.bodiesFor('section-drafter')[0]!;
    assert.equal(body['model'], 'claude-opus-5', 'default generation model');
    // D-18-06: the default reply of a text slug is its contract stub, built from
    // the request exactly as PENSMITH_NO_LLM builds it.
    assert.equal(res.text, textStub('section-drafter', [{ role: 'user', content: 'Write section 1 (intro).' }]));
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
    const claim = { sentence: 'Trees lower asthma rates.', needs_citation: true, supported_by: [] };
    sb.mock!.script('orphan-label', { data: { claims: [claim] } }, { text: '{"claims":[{"sentence":"A definition.","needs_citation":false,"supported_by":[]}]}' });
    type Audit = { claims: Array<{ sentence: string; needs_citation: boolean }> };
    const a = await complete<Audit>({ slug: 'orphan-label', system: '', messages: [{ role: 'user', content: 'x' }] });
    const b = await complete<Audit>({ slug: 'orphan-label', system: '', messages: [{ role: 'user', content: 'y' }] });
    const c = await complete<Audit>({ slug: 'orphan-label', system: '', messages: [{ role: 'user', content: 'z' }] });
    assert.deepEqual(a.data?.claims, [claim], 'the first scripted reply (an object)');
    assert.deepEqual(b.data?.claims.map((x) => x.needs_citation), [false], 'the second scripted reply (text)');
    assert.deepEqual(c.data?.claims, [], 'then the default: the conservative stub names no claim (D-20-29)');
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
    // A judgment slug runs its own default model: `[runtime] model` / --model
    // would not change it — the slug override does (RUN-12, D-17-24).
    m.fail({ kind: 'model_not_found' });
    await assert.rejects(call('claim-support'), (e: unknown) => {
      assert.ok(e instanceof ProviderHttpError);
      assert.match(e.message, /does not serve model "claude-haiku-4-5"/);
      assert.match(e.message, /— change \.paper\/config\.toml \[runtime\.slugs\.claim-support\] model$/);
      return true;
    });

    m.fail({ kind: 'http', status: 429 }, { times: 5 });
    await assert.rejects(call(), (e: unknown) => e instanceof ProviderHttpError && /HTTP 429/.test(e.message));

    m.fail({ kind: 'http', status: 503 }, { times: 5 });
    await assert.rejects(call(), (e: unknown) => e instanceof ProviderHttpError && /HTTP 503/.test(e.message) && /after retries/.test(e.message));

    // 529 overloaded_error is transient: retried like 5xx (the official SDKs do),
    // so two overloads then a reply succeeds on the third attempt.
    m.reset();
    m.fail({ kind: 'http', status: 529, errorType: 'overloaded_error', message: 'Overloaded' }, { times: 2 });
    const ok = await call();
    assert.equal(ok.stopReason, 'end_turn');
    assert.equal(m.callCount('section-drafter'), 3, '529 retried twice, then answered');
    m.fail({ kind: 'http', status: 529, errorType: 'overloaded_error' }, { times: 5 });
    await assert.rejects(call(), (e: unknown) => e instanceof ProviderHttpError && /is overloaded \(HTTP 529 overloaded_error\) after retries/.test(e.message));
    // A non-retryable 5xx is sent once and never claims retries.
    m.reset();
    m.fail({ kind: 'http', status: 501, errorType: 'api_error' });
    await assert.rejects(call(), (e: unknown) => e instanceof ProviderHttpError && /failed with HTTP 501 api_error — re-run later/.test(e.message) && !/after retries/.test(e.message));
    assert.equal(m.callCount('section-drafter'), 1, 'a 501 is not retried');

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
    // The http.ts egress gate dials through a per-request pinned Agent that it
    // destroys after the response (SEC-01), so a finished call leaves no pooled
    // connection behind. To prove close() tears down a LIVE socket, hold one
    // open: the mock delays its reply, and close() runs while the request is
    // still in flight.
    const mock = await startMockLlm({ delayMs: 5_000 });
    sb.writeGlobalRuntime({ $schemaVersion: 2, provider: 'anthropic', endpoint: mock.url });
    const inFlight = complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: 'go' }] })
      .then(() => 'resolved' as const, () => 'rejected' as const);
    const deadline = Date.now() + 5_000;
    while (mock.openSockets < 1 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    assert.ok(mock.openSockets >= 1, 'the in-flight request socket is tracked');
    const port = Number(new URL(mock.url).port);
    await mock.close();
    assert.equal(mock.listening, false);
    assert.equal(mock.openSockets, 0, 'close() destroyed every socket');
    // The torn-down request fails on the client side instead of hanging.
    assert.equal(await inFlight, 'rejected');
    // The port is free again: a new server can bind it.
    const again = await startMockLlm({ port });
    assert.equal(again.url, `http://127.0.0.1:${port}`);
    await again.close();
  });
});

test('RUN-12: verify whose advisory Pass 2 hits a model the provider does not serve prints one WARN naming the slug key; the rows are UNCLEAR', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const sec = path.join(sb.paper, 'sections', '01-intro');
    fs.mkdirSync(sec, { recursive: true });
    fs.writeFileSync(path.join(sb.paper, 'STATE.json'), JSON.stringify({ $schemaVersion: 2, paperId: 'p2-404', createdAt: new Date().toISOString(), sections: [{ n: 1, slug: 'intro' }] }));
    fs.writeFileSync(path.join(sb.paper, 'OUTLINE.md'), ['# Outline', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |', '| 1 | intro | Introduction | | 300 | aspelmeyer2009 |', ''].join('\n'));
    // An abstract gives Pass 2 source text to judge (with none it makes no model call, D-20-28).
    fs.writeFileSync(path.join(sb.paper, 'CITATIONS.bib'), '@article{aspelmeyer2009,\n  title = {Measured measurement},\n  author = {Aspelmeyer, Markus},\n  doi = {10.1038/nphys1170},\n  year = {2009},\n  abstract = {Quantum measurement shapes what an observer can record.}\n}\n');
    fs.writeFileSync(path.join(sec, 'PLAN.md'), ['---', 'section: 1', 'slug: intro', 'title: Introduction', 'depends_on: []', 'assigned_sources: [aspelmeyer2009]', 'status: written', '---', ''].join('\n'));
    fs.writeFileSync(path.join(sec, 'DRAFT.md'), '# Introduction\n\nMeasurement shapes what an observer records [@aspelmeyer2009].\n');
    sb.mock!.fail({ kind: 'model_not_found' }, { slug: 'claim-support', times: 5 });
    const r = await sb.runTsx(null, ['verify', '1', '--yolo'], { env: { PENSMITH_OFFLINE: '1' } });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const warns = r.stderr.split('\n').filter((l) => l.startsWith('pensmith verify: WARN — Pass 2'));
    assert.equal(warns.length, 1, `one WARN line:\n${r.stderr}`);
    assert.match(warns[0]!, /could not judge 1 claim\(s\): anthropic does not serve model "claude-haiku-4-5" .*\[runtime\.slugs\.claim-support\] model \(recorded as UNCLEAR in VERIFICATION\.md\)$/);
    assert.match(fs.readFileSync(path.join(sec, 'VERIFICATION.md'), 'utf8'), /\*\*UNCLEAR\*\* \| LLM error: /);
  });
});

// ---- D-18-06: the mock reads the request's data blocks like a model ------------

test('D-18-06: default structured replies read the request blocks — the same object complete() stubs under PENSMITH_NO_LLM', async () => {
  const candidates = [
    { citekey: 'vaswani2017', title: 'Attention is all you need', authors: ['A. Vaswani'], year: 2017, venue: 'arXiv', doi: null, abstract: null },
    { citekey: 'bahdanau2015', title: 'Neural machine translation', authors: ['D. Bahdanau'], year: 2015, venue: null, doi: null, abstract: null },
  ];
  const evaluator = buildPromptRequest('source-evaluator', { topic: 'attention', discipline: 'computer-science', scope: 'transformer-attention', candidates });
  const disambiguator = buildPromptRequest('topic-disambiguator', { topic: 'attention mechanisms in neural translation', discipline: 'computer-science', assignment: 'Write about attention.' });
  let mocked: unknown[] = [];
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async () => {
    const e = await complete({ slug: 'source-evaluator', system: evaluator.system, messages: evaluator.messages });
    const d = await complete({ slug: 'topic-disambiguator', system: disambiguator.system, messages: disambiguator.messages });
    mocked = [e.data, d.data];
  });
  let stubbed: unknown[] = [];
  await withLlmSandbox({ env: { PENSMITH_NO_LLM: '1' } }, async () => {
    const e = await complete({ slug: 'source-evaluator', system: evaluator.system, messages: evaluator.messages, stubHint: requestHints(evaluator) });
    const d = await complete({ slug: 'topic-disambiguator', system: disambiguator.system, messages: disambiguator.messages, stubHint: requestHints(disambiguator) });
    stubbed = [e.data, d.data];
  });
  assert.deepEqual(mocked, stubbed, 'mock and stub agree');
  const verdicts = (mocked[0] as { verdicts: Array<{ citekey: string; keep: boolean }> }).verdicts;
  assert.deepEqual(verdicts.map((v) => [v.citekey, v.keep]), [['vaswani2017', true], ['bahdanau2015', true]], 'every candidate kept');
  const scopes = (mocked[1] as { scopes: Array<{ queries: string[] }> }).scopes;
  // Phase 19 (SRC-08, D-19-15): the stub's queries are the deterministic
  // expansion of the topic block, led by the topic itself.
  assert.deepEqual(scopes[0]!.queries, expandTopicQueries('attention mechanisms in neural translation', 'computer-science'), 'queries come from the topic block');
  assert.equal(scopes[0]!.queries[0], 'attention mechanisms in neural translation');
});

test('D-18-06: a corrective retry still reads the blocks of the first user turn', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const req = buildPromptRequest('source-evaluator', {
      topic: 't', discipline: 'other', scope: 's',
      candidates: [{ citekey: 'only2020', title: 'x', authors: [], year: null, venue: null, doi: null, abstract: null }],
    });
    sb.mock!.script('source-evaluator', { text: 'not json at all' });
    const r = await complete<{ verdicts: Array<{ citekey: string }> }>({ slug: 'source-evaluator', system: req.system, messages: req.messages });
    assert.equal(sb.mock!.callCount('source-evaluator'), 2, 'one corrective retry');
    assert.deepEqual(r.data!.verdicts.map((v) => v.citekey), ['only2020']);
  });
});
