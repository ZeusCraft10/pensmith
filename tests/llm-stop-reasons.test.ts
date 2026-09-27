// tests/llm-stop-reasons.test.ts — RUN-24 (D-17-21): stop reasons.
//
//   refusal     → one-line ProviderRefusalError (exit 1) naming the category and
//                 the provider's suggested model; nothing is written; the billed
//                 attempt is still logged and costed.
//   max_tokens  → ONE retry at the doubled budget (streamed above 16k); a second
//                 truncation is a one-line ProviderTruncatedError and the
//                 truncated text is never persisted.
//   OpenAI      → finish_reason "length" is max_tokens; "content_filter" and a
//                 message.refusal are refusals.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox, readJsonl, type LlmSandbox } from './helpers/llm-sandbox.js';
import { complete, ProviderRefusalError, ProviderTruncatedError } from '../bin/lib/anthropic.js';
import { outlineCommand } from '../bin/cli/outline.js';

const KEY = 'sk-test-stop-reasons-0001';
type Run = (ctx: { args: Record<string, unknown> }) => Promise<unknown>;

function llmRecords(sb: LlmSandbox): Array<Record<string, unknown>> {
  return readJsonl(path.join(sb.paper, 'SESSION.log')).filter((r) => r['kind'] === 'llm');
}

function costs(sb: LlmSandbox): Array<Record<string, unknown>> {
  return readJsonl(path.join(sb.paper, 'COSTS.jsonl'));
}

function seedIntake(sb: LlmSandbox): void {
  fs.writeFileSync(path.join(sb.paper, 'INTAKE.md'), 'Topic: coral bleaching\nDiscipline: biology\n');
}

test('RUN-24: Anthropic refusal → one-line exit-1 error with category + suggested model; nothing written; attempt logged and costed', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    seedIntake(sb);
    sb.mock!.fail({ kind: 'refusal', category: 'cyber', recommendedModel: 'claude-opus-4-8' }, { slug: 'outline-author' });
    await assert.rejects(
      (outlineCommand.run as Run)({ args: { yolo: true, force: true } }),
      (e: unknown) => {
        assert.ok(e instanceof ProviderRefusalError);
        assert.equal(e.exitCode, 1);
        assert.equal(e.category, 'cyber');
        assert.ok(!e.message.includes('\n'), 'one line');
        assert.match(e.message, /^provider refused \(category: cyber\) — anthropic model claude-opus-5 declined the request; the provider suggests retrying on claude-opus-4-8/);
        return true;
      },
    );
    assert.equal(sb.mock!.callCount('outline-author'), 1, 'a refusal is never retried as a corrective retry');
    assert.equal(fs.existsSync(path.join(sb.paper, 'OUTLINE.md')), false);
    const rec = llmRecords(sb).at(-1)!;
    assert.equal(rec['stop_reason'], 'refusal');
    assert.equal(rec['refusal_category'], 'cyber');
    assert.equal(costs(sb).length, 1, 'the refused attempt is billed and recorded');
  });
});

test('RUN-24: a refusal without a category or suggestion still yields a one-line message', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    sb.mock!.fail({ kind: 'refusal', category: null, recommendedModel: null });
    await assert.rejects(
      complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: 'go' }] }),
      (e: unknown) => e instanceof ProviderRefusalError && /^provider refused \(category: unspecified\)/.test(e.message) && !/suggests/.test(e.message),
    );
  });
});

test('RUN-24: max_tokens once → one retry at the doubled budget, both attempts logged + costed', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    sb.mock!.fail({ kind: 'max_tokens' }, { slug: 'claim-support', times: 1 });
    const r = await complete<{ verdict: string }>({ slug: 'claim-support', section: 1, system: '', messages: [{ role: 'user', content: 'claim' }] });
    assert.ok(r.data?.verdict, 'the retry produced a valid object');
    const bodies = sb.mock!.bodiesFor('claim-support');
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0]!['max_tokens'], 2000);
    assert.equal(bodies[1]!['max_tokens'], 4000);
    assert.equal(bodies[1]!['stream'], undefined, 'a 4k retry is below the 16k streaming threshold');
    const recs = llmRecords(sb);
    assert.deepEqual(recs.map((x) => [x['attempt'], x['stop_reason']]), [['initial', 'max_tokens'], ['max_tokens-retry', 'end_turn']]);
    assert.equal(costs(sb).length, 2);
    const sum = costs(sb).reduce((a, c) => a + Number(c['costUsd']), 0);
    assert.ok(Math.abs(sum - r.costUsd) < 1e-12, 'the call cost equals the COSTS.jsonl entries it appended');
  });
});

test('RUN-24: max_tokens twice → ProviderTruncatedError (exit 1); the truncated text is never persisted', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    seedIntake(sb);
    sb.mock!.fail({ kind: 'max_tokens' }, { slug: 'outline-author', times: 2 });
    await assert.rejects(
      (outlineCommand.run as Run)({ args: { yolo: true, force: true } }),
      (e: unknown) =>
        e instanceof ProviderTruncatedError &&
        e.exitCode === 1 &&
        !e.message.includes('\n') &&
        /stopped at max_tokens \(32000\) twice for outline-author/.test(e.message) &&
        /nothing was written/.test(e.message) &&
        /\[runtime\.slugs\.outline-author\]/.test(e.message),
    );
    assert.equal(sb.mock!.callCount('outline-author'), 2, 'never a third attempt');
    assert.equal(fs.existsSync(path.join(sb.paper, 'OUTLINE.md')), false);
  });
});

test('RUN-24: OpenAI finish_reason "length" retries once at the doubled budget', async () => {
  await withLlmSandbox({ mock: 'openai', env: { OPENAI_API_KEY: KEY } }, async (sb) => {
    sb.mock!.fail({ kind: 'max_tokens' }, { slug: 'section-drafter', times: 1 });
    const r = await complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: 'x' }] });
    assert.equal(r.stopReason, 'end_turn');
    const bodies = sb.mock!.bodiesFor('section-drafter');
    assert.deepEqual(bodies.map((b) => b['max_completion_tokens']), [16_000, 32_000]);
    assert.equal(bodies[1]!['stream'], true, 'the 32k retry streams');

    sb.mock!.fail({ kind: 'max_tokens' }, { slug: 'section-drafter', times: 2 });
    await assert.rejects(
      complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: 'x' }] }),
      (e: unknown) => e instanceof ProviderTruncatedError && /openai model gpt-6-astra stopped at max_tokens/.test(e.message),
    );
  });
});

test('RUN-24: OpenAI content_filter and message.refusal are refusals (exit 1)', async () => {
  await withLlmSandbox({ mock: 'openai', env: { OPENAI_API_KEY: KEY } }, async (sb) => {
    sb.mock!.fail({ kind: 'refusal', contentFilter: true });
    await assert.rejects(
      complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: 'x' }] }),
      (e: unknown) => e instanceof ProviderRefusalError && e.exitCode === 1 && /^provider refused \(category: content_filter\)/.test(e.message),
    );
    sb.mock!.fail({ kind: 'refusal' });
    await assert.rejects(
      complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: 'x' }] }),
      (e: unknown) => e instanceof ProviderRefusalError && /openai model gpt-6-astra declined/.test(e.message),
    );
    assert.equal(sb.mock!.callCount('section-drafter'), 2, 'refusals are not retried');
  });
});
