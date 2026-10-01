// tests/prompt-cache.test.ts — RUN-26 (D-18-05): prompt caching is real.
//
// Phase 17 sent `cache_control` on a system prompt that changed on every call,
// so nothing was ever read from the cache. Phase 18 makes every template fixed
// instruction text (the system prompt) and sends the per-call data last
// (prompt-request.ts). This file proves the consequence end to end:
//   - the system prompt of every slug is byte-identical across different
//     inputs, and every Anthropic request marks it with cache_control;
//   - the per-model minimum cacheable prefix is recorded and reported
//     (claude-opus-5 512, claude-haiku-4-5 4096, …);
//   - against the RUN-21 mock (which simulates caching per model minimum and
//     TTL), a repeated call reads the cached prefix: `cache_read_input_tokens
//     > 0` in the reply, `cache_read_tokens` in SESSION.log, and the COSTS
//     entry priced with the read at 0.1× input; a Haiku 4.5 judgment slug is
//     below its minimum and never caches; the OpenAI shape reports
//     `prompt_tokens_details.cached_tokens`;
//   - through the real CLI: `pensmith verify 1` on a two-citation section with
//     `[runtime.slugs.claim-support] model = "claude-opus-5"` — the second
//     claim-support call reads the cache — and `status --config` shows the
//     cache column.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox, readJsonl, type LlmSandbox } from './helpers/llm-sandbox.js';
import { complete } from '../bin/lib/anthropic.js';
import { buildPromptRequest, PROMPT_INPUTS, type PromptValues } from '../bin/lib/prompt-request.js';
import { loadPrompt } from '../bin/lib/prompt-loader.js';
import {
  ANTHROPIC_MIN_CACHEABLE_TOKENS,
  MODELS,
  OPENAI_CACHE_INCREMENT_TOKENS,
  PROMPT_CACHE_TTL_MS,
  SLUG_NAMES,
  UNLISTED_MIN_CACHEABLE_TOKENS,
  cachePrefixRule,
  describeCacheReach,
  slugSpec,
  systemCacheReach,
} from '../bin/lib/llm-models.js';
import { resolvePrice, costOf } from '../bin/lib/pricing.js';
import { claimSupportRequest } from '../bin/lib/verify/pass2.js';
import { projectCallUsd } from '../bin/lib/estimator.js';
import { writeOutline, writePlan, writeState, sectionDirOf } from './helpers/paper-cli-harness.js';

const KEY = 'sk-ant-test-prompt-cache-0001';

/** Sample values for every input of `slug` (distinct per `variant`). */
function sampleValues(slug: string, variant: number): PromptValues {
  const out: Record<string, string> = {};
  for (const s of PROMPT_INPUTS[slug]!) out[s.tag] = `sample ${s.tag} value, variant ${variant}`;
  return out;
}

// ---- The fixed prefix -------------------------------------------------------------

test('RUN-26: every slug\'s system prompt is its template, byte-identical across different inputs', () => {
  for (const slug of Object.keys(PROMPT_INPUTS)) {
    const a = buildPromptRequest(slug, sampleValues(slug, 1));
    const b = buildPromptRequest(slug, sampleValues(slug, 2));
    assert.equal(a.system, b.system, `${slug}: identical system prompt`);
    assert.equal(a.system, loadPrompt(slug), `${slug}: the system prompt is the unmodified template`);
    assert.notEqual(a.messages[0]!.content, b.messages[0]!.content, `${slug}: the data differs`);
    assert.ok(!a.system.includes('variant 1'), `${slug}: no data in the system prompt`);
  }
});

test('RUN-26: every slug sends its template as one cache_control-marked system block (Anthropic shape)', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    for (const slug of SLUG_NAMES) {
      assert.equal(slugSpec(slug).cacheSystem, true, `${slug}: cacheSystem`);
      // S-06 / D-21-18: a model slug with no template (the humanizer: the user's
      // installed SKILL.md is its system prompt) is cached the same way, with
      // the system prompt its caller supplies.
      const req = slugSpec(slug).template
        ? buildPromptRequest(slug, sampleValues(slug, 1))
        : { system: '# Humanizer\n\nRewrite the text so it reads naturally.', messages: [{ role: 'user' as const, content: 'sample text, variant 1' }] };
      await complete({ slug, system: req.system, messages: req.messages });
      const body = sb.mock!.bodiesFor(slug)[0]!;
      assert.deepEqual(body['system'], [{ type: 'text', text: slugSpec(slug).template ? loadPrompt(slug) : req.system, cache_control: { type: 'ephemeral' } }], slug);
      const msgs = body['messages'] as Array<{ role: string; content: string }>;
      assert.equal(msgs.length, 1, `${slug}: the data is sent once, in one user message`);
      assert.equal(msgs[0]!.content, req.messages[0]!.content);
    }
  });
});

test('RUN-26: the chat shape sends the template as the first (system) message', async () => {
  await withLlmSandbox({ mock: 'openai', env: { OPENAI_API_KEY: KEY } }, async (sb) => {
    const req = buildPromptRequest('orphan-label', sampleValues('orphan-label', 1));
    await complete({ slug: 'orphan-label', system: req.system, messages: req.messages });
    const msgs = sb.mock!.bodiesFor('orphan-label')[0]!['messages'] as Array<{ role: string; content: string }>;
    assert.deepEqual(msgs.map((m) => m.role), ['system', 'user']);
    assert.equal(msgs[0]!.content, loadPrompt('orphan-label'));
  });
});

// ---- The per-model minimums --------------------------------------------------------

test('D-18-05: the minimum cacheable prefix per model (claude-api skill table, 2026-06-24)', () => {
  assert.equal(ANTHROPIC_MIN_CACHEABLE_TOKENS['claude-opus-5'], 512);
  assert.equal(ANTHROPIC_MIN_CACHEABLE_TOKENS['claude-fable-5'], 512);
  assert.equal(ANTHROPIC_MIN_CACHEABLE_TOKENS['claude-fable-5-1'], 512);
  assert.equal(ANTHROPIC_MIN_CACHEABLE_TOKENS['claude-sonnet-5'], 1024);
  assert.equal(ANTHROPIC_MIN_CACHEABLE_TOKENS['claude-opus-4-8'], 1024);
  assert.equal(ANTHROPIC_MIN_CACHEABLE_TOKENS['claude-haiku-4-5'], 4096);
  // Every Anthropic model in the capability table is either listed or reported against 4096.
  for (const [id, caps] of Object.entries(MODELS)) {
    if (caps.provider !== 'anthropic') continue;
    const rule = cachePrefixRule('anthropic', id);
    assert.equal(rule.mode, 'marker');
    assert.equal(rule.minTokens, ANTHROPIC_MIN_CACHEABLE_TOKENS[id] ?? UNLISTED_MIN_CACHEABLE_TOKENS, id);
  }
  assert.deepEqual(cachePrefixRule('anthropic', 'claude-some-future-model'), { mode: 'marker', minTokens: 4096, listed: false });
  assert.deepEqual(cachePrefixRule('openai', 'gpt-6-luna'), { mode: 'automatic', minTokens: 1024, listed: true });
  assert.deepEqual(cachePrefixRule('ollama', 'llama3'), { mode: 'none', minTokens: null, listed: true });

  const opus = describeCacheReach(systemCacheReach('anthropic', 'claude-opus-5', 860));
  assert.equal(opus.column, 'yes');
  assert.match(opus.detail, /system prompt ~860 tokens reaches the 512-token minimum for claude-opus-5/);
  const haiku = describeCacheReach(systemCacheReach('anthropic', 'claude-haiku-4-5', 860));
  assert.equal(haiku.column, 'no');
  assert.match(haiku.detail, /is below the 4096-token minimum for claude-haiku-4-5 \(marked, not cached\)/);
  assert.match(describeCacheReach(systemCacheReach('anthropic', 'claude-x', 5000)).detail, /assumed for claude-x \(not in the caching table\)/);
  assert.equal(describeCacheReach(systemCacheReach('vllm', 'm', 5000)).column, 'n/a');

  // --estimate stays conservative: a projection prices every input token uncached.
  const price = resolvePrice('anthropic', 'claude-opus-5');
  assert.equal(projectCallUsd(price, 1_000_000, 0, 100).usd, price.inputPerMtok);
});

// ---- The mock proves it (in process) ----------------------------------------------------

function claimRequest(n: number) {
  return claimSupportRequest(`src${n}`, `Claim sentence number ${n} cites a source [@src${n}].`, {
    title: `Source ${n}`,
    author: [{ family: 'Author', given: `N${n}` }],
    abstract: `An abstract for source ${n} that reports the finding the claim relies on.`,
  });
}

test('RUN-26: a repeated claim-support call on claude-opus-5 reads the cached system prompt; COSTS prices the read at 0.1x', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const r1 = claimRequest(1);
    const r2 = claimRequest(2);
    const first = await complete({ slug: 'claim-support', section: 1, model: 'claude-opus-5', system: r1.system, messages: r1.messages });
    const second = await complete({ slug: 'claim-support', section: 1, model: 'claude-opus-5', system: r2.system, messages: r2.messages });
    const [u1, u2] = sb.mock!.usagesFor('claim-support');
    assert.equal(u1!['cache_read_input_tokens'], 0, 'a cold cache');
    assert.ok((u1!['cache_creation_input_tokens'] as number) >= 512, `the system prefix is written: ${JSON.stringify(u1)}`);
    assert.ok((u2!['cache_read_input_tokens'] as number) >= 512, `the second call reads it: ${JSON.stringify(u2)}`);
    assert.equal(u2!['cache_creation_input_tokens'], 0);
    assert.equal(first.cacheWriteTokens, u1!['cache_creation_input_tokens']);
    assert.equal(second.cacheReadTokens, u2!['cache_read_input_tokens']);

    const costs = readJsonl(path.join(sb.paper, 'COSTS.jsonl')).filter((c) => c['slug'] === 'claim-support');
    assert.equal(costs.length, 2);
    const price = resolvePrice('anthropic', 'claude-opus-5');
    assert.equal(price.cacheReadPerMtok, 0.5, 'claude-opus-5: $5 input, cache read at 0.1x');
    const c2 = costs[1]!;
    assert.equal(c2['cacheReadTokens'], u2!['cache_read_input_tokens']);
    const expected = costOf(price, {
      inputTokens: u2!['input_tokens'] as number,
      outputTokens: u2!['output_tokens'] as number,
      cacheWriteTokens: 0,
      cacheReadTokens: u2!['cache_read_input_tokens'] as number,
    });
    assert.ok(Math.abs((c2['costUsd'] as number) - expected) < 1e-12, `${String(c2['costUsd'])} vs ${expected}`);
    const uncached = costOf(price, {
      inputTokens: (u2!['input_tokens'] as number) + (u2!['cache_read_input_tokens'] as number),
      outputTokens: u2!['output_tokens'] as number,
    });
    assert.ok((c2['costUsd'] as number) < uncached, 'the read is cheaper than resending the prefix');

    const llm = readJsonl(path.join(sb.paper, 'SESSION.log')).filter((r) => r['kind'] === 'llm' && r['slug'] === 'claim-support');
    assert.equal(llm.length, 2);
    assert.equal(llm[0]!['cache_read_tokens'], 0);
    assert.ok((llm[1]!['cache_read_tokens'] as number) > 0, 'SESSION.log records the cache read');
    assert.equal(llm[1]!['cost_usd'], c2['costUsd'], 'SESSION.log cost == COSTS.jsonl cost');
  });
});

test('RUN-26: claim-support on its default claude-haiku-4-5 is below the 4096-token minimum and never caches', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    for (const n of [1, 2, 3]) {
      const r = claimRequest(n);
      await complete({ slug: 'claim-support', system: r.system, messages: r.messages });
    }
    assert.equal(sb.mock!.bodiesFor('claim-support')[0]!['model'], 'claude-haiku-4-5');
    for (const u of sb.mock!.usagesFor('claim-support')) {
      assert.equal(u['cache_read_input_tokens'], 0);
      assert.equal(u['cache_creation_input_tokens'], 0);
    }
    assert.equal(sb.mock!.cacheStats().entries, 0);
  });
});

test('RUN-26: the cached prefix expires after the 5-minute TTL; a read refreshes it', async () => {
  let now = 1_000_000;
  await withLlmSandbox({ mock: 'anthropic', mockOptions: { now: () => now }, env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const call = async (n: number): Promise<Record<string, unknown>> => {
      const r = claimRequest(n);
      await complete({ slug: 'claim-support', model: 'claude-opus-5', system: r.system, messages: r.messages });
      return sb.mock!.usagesFor('claim-support').at(-1)!;
    };
    assert.ok((await call(1))['cache_creation_input_tokens'] as number > 0);
    now += PROMPT_CACHE_TTL_MS - 1_000;
    assert.ok((await call(2))['cache_read_input_tokens'] as number > 0, 'read inside the TTL (refreshes it)');
    now += PROMPT_CACHE_TTL_MS - 1_000;
    assert.ok((await call(3))['cache_read_input_tokens'] as number > 0, 'the read refreshed the entry');
    now += PROMPT_CACHE_TTL_MS + 1;
    const cold = await call(4);
    assert.equal(cold['cache_read_input_tokens'], 0, 'expired');
    assert.ok((cold['cache_creation_input_tokens'] as number) > 0, 'written again');
    const stats = sb.mock!.cacheStats();
    assert.equal(stats.reads, 2);
    assert.equal(stats.writes, 2);
  });
});

test('RUN-26: the OpenAI shape reports automatic prefix caching (prompt_tokens_details.cached_tokens)', async () => {
  await withLlmSandbox({ mock: 'openai', env: { OPENAI_API_KEY: KEY } }, async (sb) => {
    // A source-evaluator request well above OpenAI's 1024-token minimum.
    const candidates = Array.from({ length: 12 }, (_, i) => ({
      citekey: `cand${i}`, title: `Candidate study number ${i} on transformer attention`, authors: ['A. Author', 'B. Author'],
      year: 2020, venue: null, doi: `10.1234/cand.${i}`, abstract: 'An abstract that describes the study design, the data and the main result in two sentences. '.repeat(3),
    }));
    const req = buildPromptRequest('source-evaluator', { topic: 'attention', discipline: 'computer-science', scope: 'transformer-attention', candidates });
    const first = await complete({ slug: 'source-evaluator', system: req.system, messages: req.messages });
    const second = await complete({ slug: 'source-evaluator', system: req.system, messages: req.messages });
    const [u1, u2] = sb.mock!.usagesFor('source-evaluator') as Array<{ prompt_tokens: number; prompt_tokens_details: { cached_tokens: number } }>;
    assert.equal(u1!.prompt_tokens_details.cached_tokens, 0);
    const cached = u2!.prompt_tokens_details.cached_tokens;
    assert.ok(cached >= 1024, `cached ${cached}`);
    assert.equal(cached % OPENAI_CACHE_INCREMENT_TOKENS, 0, '128-token increments');
    assert.equal(first.cacheReadTokens, 0);
    assert.equal(second.cacheReadTokens, cached);
    assert.equal(second.inputTokens, u2!.prompt_tokens - cached, 'uncached input = prompt - cached');
    const price = resolvePrice('openai', 'gpt-6-luna');
    assert.ok(Math.abs(second.costUsd - costOf(price, { inputTokens: second.inputTokens, outputTokens: second.outputTokens, cacheReadTokens: cached })) < 1e-12);

    // A prompt under 1024 tokens is never cached.
    const short = buildPromptRequest('orphan-label', { paragraph: 'p' });
    await complete({ slug: 'orphan-label', system: short.system, messages: short.messages });
    await complete({ slug: 'orphan-label', system: short.system, messages: short.messages });
    for (const u of sb.mock!.usagesFor('orphan-label') as Array<{ prompt_tokens_details: { cached_tokens: number } }>) {
      assert.equal(u.prompt_tokens_details.cached_tokens, 0);
    }
  });
});

// ---- Through the real CLI ---------------------------------------------------------------

/** The recorded Crossref work (tests/fixtures/cassettes/crossref/works-nphys1170.json). */
const BIB = [
  '@article{aspelmeyer2009,',
  '  title = {Measured measurement},',
  '  author = {Aspelmeyer, Markus},',
  '  doi = {10.1038/nphys1170},',
  '  year = {2009},',
  '  abstract = {Quantum measurement is now routine in optomechanical experiments at the standard quantum limit.}',
  '}',
  '',
  '@article{teufel2011,',
  '  title = {Sideband cooling of micromechanical motion to the quantum ground state},',
  '  author = {Teufel, John D.},',
  '  doi = {10.1038/nature10261},',
  '  year = {2011},',
  '  abstract = {A micromechanical drum resonator is cooled to its quantum ground state with sideband cooling.}',
  '}',
  '',
].join('\n');

function seedTwoCitationSection(sb: LlmSandbox): void {
  const root = sb.root;
  writeState(root, [{ n: 1, slug: 'intro' }]);
  fs.writeFileSync(path.join(sb.paper, 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 1, entries: [] }));
  fs.writeFileSync(path.join(sb.paper, 'CITATIONS.bib'), BIB);
  writeOutline(root, [{ n: 1, slug: 'intro', sources: ['aspelmeyer2009', 'teufel2011'] }]);
  writePlan(root, 1, 'intro', { status: 'written', assigned_sources: '[aspelmeyer2009, teufel2011]' });
  fs.writeFileSync(
    path.join(sectionDirOf(root, 1, 'intro'), 'DRAFT.md'),
    'Measurement in optomechanics is now routine at the quantum limit [@aspelmeyer2009]. ' +
      'Mechanical resonators have been cooled to their quantum ground state [@teufel2011].\n',
  );
}

test('RUN-26 (CLI): `pensmith verify 1` with claim-support on claude-opus-5 — the second claim-support call reads the cache', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    seedTwoCitationSection(sb);
    sb.writePaperConfig('schema_version = 1\n\n[runtime.slugs.claim-support]\nmodel = "claude-opus-5"\n');
    const r = await sb.runTsx(null, ['verify', '1'], { env: { ANTHROPIC_API_KEY: KEY } });
    // teufel2011 has no recorded Crossref cassette: offline under the test runner
    // it is UNVERIFIABLE (blocking, exit 4); the advisory Pass 2 runs regardless.
    assert.equal(r.status, 4, `${r.stdout}\n${r.stderr}`);
    const bodies = sb.mock!.bodiesFor('claim-support');
    assert.equal(bodies.length, 2, 'one claim-support call per cited source');
    for (const b of bodies) {
      assert.equal(b['model'], 'claude-opus-5');
      assert.deepEqual(b['system'], [{ type: 'text', text: loadPrompt('claim-support'), cache_control: { type: 'ephemeral' } }]);
    }
    const [u1, u2] = sb.mock!.usagesFor('claim-support');
    assert.equal(u1!['cache_read_input_tokens'], 0);
    assert.ok((u1!['cache_creation_input_tokens'] as number) > 0);
    assert.ok((u2!['cache_read_input_tokens'] as number) > 0, `second reply reads the cache: ${JSON.stringify(u2)}`);

    const llm = readJsonl(path.join(sb.paper, 'SESSION.log')).filter((x) => x['kind'] === 'llm' && x['slug'] === 'claim-support');
    assert.equal(llm.length, 2);
    assert.equal(llm[1]!['cache_read_tokens'], u2!['cache_read_input_tokens'], 'SESSION.log cache_read_tokens');
    const costs = readJsonl(path.join(sb.paper, 'COSTS.jsonl')).filter((x) => x['slug'] === 'claim-support');
    assert.equal(costs.length, 2);
    const price = resolvePrice('anthropic', 'claude-opus-5');
    const expected = costOf(price, {
      inputTokens: u2!['input_tokens'] as number,
      outputTokens: u2!['output_tokens'] as number,
      cacheReadTokens: u2!['cache_read_input_tokens'] as number,
    });
    assert.ok(Math.abs((costs[1]!['costUsd'] as number) - expected) < 1e-12, 'the read is priced at 0.1x input');
    const v = fs.readFileSync(path.join(sectionDirOf(sb.root, 1, 'intro'), 'VERIFICATION.md'), 'utf8');
    assert.match(v, /## Pass-2 \(claim support, advisory/);
  });
});

test('RUN-26 (CLI): with the default claude-haiku-4-5 nothing caches, and `status --config` says why', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    seedTwoCitationSection(sb);
    sb.writePaperConfig('schema_version = 1\n');
    const r = await sb.runTsx(null, ['verify', '1'], { env: { ANTHROPIC_API_KEY: KEY } });
    assert.equal(r.status, 4, `${r.stdout}\n${r.stderr}`);
    const usages = sb.mock!.usagesFor('claim-support');
    assert.equal(usages.length, 2);
    for (const u of usages) {
      assert.equal(u['cache_read_input_tokens'], 0);
      assert.equal(u['cache_creation_input_tokens'], 0);
    }
    const s = await sb.runTsx(null, ['status', '--config'], { env: { ANTHROPIC_API_KEY: KEY } });
    assert.equal(s.status, 0, s.stderr);
    assert.match(s.stdout, /claim-support\s+judgment\s+claude-haiku-4-5\s+effort n\/a\s+cache no\s+\(.*cache: system prompt ~\d+ tokens is below the 4096-token minimum for claude-haiku-4-5 \(marked, not cached\)\)/);
    assert.match(s.stdout, /smoother\s+generation\s+claude-opus-5\s+effort medium\s+cache yes\s+\(.*cache: system prompt ~\d+ tokens reaches the 512-token minimum for claude-opus-5 \(cache_control marked\)\)/);
  });
});
