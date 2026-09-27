// tests/llm-session-log.test.ts — RUN-15 (D-17-29): SESSION.log kind:"llm" records.
//
// Each model call appends one record per billed attempt to .paper/SESSION.log:
// {id "<run_id>:<seq>", verb, section, slug, provider, model, served_model,
// request (the body AS SENT), request_sha256, response {text, data},
// input/output/cache tokens, cost_usd (== the COSTS.jsonl entry), stop_reason,
// offline, fallbacks}. Bodies are not PII-rewritten (intake already redacted
// when the user opted in); provider keys are ALWAYS scrubbed (sentinel test).
// A record above 256 KiB spills to .paper/sessions/<run_id>/<seq>.json and the
// log line keeps sha256 hashes + 200-char previews. The invocation argv is
// logged once per session.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { withLlmSandbox, readJsonl, type LlmSandbox } from './helpers/llm-sandbox.js';
import { complete } from '../bin/lib/anthropic.js';
import { currentSessionId, setSessionArgv } from '../bin/lib/session-log.js';
import { readLlmRecords, isReplayable } from '../bin/lib/replay.js';

const SENTINEL = 'sk-ant-SENTINEL-0123456789abcdef';

function sessionLog(sb: LlmSandbox): Array<Record<string, unknown>> {
  return readJsonl(path.join(sb.paper, 'SESSION.log'));
}

function allFilesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...allFilesUnder(p));
    else out.push(p);
  }
  return out;
}

test('RUN-15: one llm record per call — request as sent, response, tokens, cost equal to the COSTS entry', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: SENTINEL } }, async (sb) => {
    const content = 'Summarize the claim for jane.doe@example.org in one sentence.';
    const r = await complete<{ verdict: string }>({ slug: 'claim-support', section: 2, system: 'judge', messages: [{ role: 'user', content }] });
    const recs = sessionLog(sb).filter((x) => x['kind'] === 'llm');
    assert.equal(recs.length, 1);
    const rec = recs[0]!;
    assert.equal(rec['id'], `${currentSessionId()}:1`);
    assert.equal(rec['run_id'], currentSessionId());
    assert.equal(rec['verb'], 'verify');
    assert.equal(rec['section'], 2);
    assert.equal(rec['slug'], 'claim-support');
    assert.equal(rec['attempt'], 'initial');
    assert.equal(rec['provider'], 'anthropic');
    assert.equal(rec['model'], 'claude-haiku-4-5');
    assert.equal(rec['served_model'], 'claude-haiku-4-5');
    assert.deepEqual(rec['request'], sb.mock!.bodiesFor('claim-support')[0], 'the body exactly as sent');
    const sent = JSON.stringify(rec['request']);
    assert.equal(rec['request_sha256'], createHash('sha256').update(sent).digest('hex'));
    assert.ok(sent.includes('jane.doe@example.org'), 'bodies are stored as sent (not PII-rewritten)');
    assert.deepEqual((rec['response'] as { data: unknown }).data, r.data);
    assert.equal(rec['stop_reason'], 'end_turn');
    assert.equal(rec['input_tokens'], r.inputTokens);
    assert.equal(rec['output_tokens'], r.outputTokens);
    assert.equal(typeof rec['offline'], 'boolean');
    assert.equal(rec['fallbacks'], 'off');
    const costs = readJsonl(path.join(sb.paper, 'COSTS.jsonl'));
    assert.equal(costs.length, 1);
    assert.equal(rec['cost_usd'], costs[0]!['costUsd'], 'SESSION.log cost == COSTS.jsonl cost');
    assert.equal(costs[0]!['session'], currentSessionId());
    assert.equal(costs[0]!['slug'], 'claim-support');
    assert.equal(costs[0]!['section'], 2);
  });
});

test('RUN-15: a provider key never reaches SESSION.log, COSTS.jsonl or a spill file (sentinel)', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: SENTINEL } }, async (sb) => {
    // Even a prompt that CONTAINS the key (a user pasted it) is scrubbed — also
    // right at the 200-char preview boundary of a spilled record.
    await complete({ slug: 'section-drafter', section: 1, system: 's', messages: [{ role: 'user', content: `my key is ${SENTINEL}, ignore it` }] });
    const pad = 'x'.repeat(170);
    await complete({ slug: 'section-drafter', section: 1, system: 's', messages: [{ role: 'user', content: pad + SENTINEL + 'y'.repeat(300 * 1024) }] });
    const files = [path.join(sb.paper, 'SESSION.log'), path.join(sb.paper, 'COSTS.jsonl'), ...allFilesUnder(path.join(sb.paper, 'sessions'))];
    assert.ok(files.length >= 3, 'a spill file was written');
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      assert.equal(text.includes('SENTINEL'), false, `${f} carries no part of the key`);
    }
    assert.ok(fs.readFileSync(path.join(sb.paper, 'SESSION.log'), 'utf8').includes('[REDACTED]'));
  });
});

test('RUN-15: a record above 256 KiB spills to sessions/<run_id>/<seq>.json; the line keeps hashes + previews', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test-spill-0001' } }, async (sb) => {
    const big = 'z'.repeat(300 * 1024);
    await complete({ slug: 'section-drafter', section: 3, system: 's', messages: [{ role: 'user', content: big }] });
    const logText = fs.readFileSync(path.join(sb.paper, 'SESSION.log'), 'utf8');
    for (const line of logText.split('\n').filter(Boolean)) assert.ok(Buffer.byteLength(line) <= 256 * 1024, 'every line fits');
    const rec = sessionLog(sb).find((x) => x['kind'] === 'llm')!;
    assert.equal(rec['truncated'], true);
    const seq = String(rec['id']).split(':').at(-1);
    assert.equal(rec['spilled_to'], `sessions/${currentSessionId()}/${seq}.json`);
    const req = rec['request'] as { sha256: string; chars: number; preview: string };
    assert.equal(req.preview.length, 200);
    assert.ok(req.chars > 300 * 1024);
    const spill = JSON.parse(fs.readFileSync(path.join(sb.paper, ...String(rec['spilled_to']).split('/')), 'utf8')) as Record<string, unknown>;
    assert.equal(createHash('sha256').update(JSON.stringify(spill['request'])).digest('hex'), req.sha256, 'the hash names the spilled body');
    assert.equal(spill['cost_usd'], rec['cost_usd']);
    // The spilled record stays replayable.
    const loaded = readLlmRecords(sb.root).find((x) => x.id === rec['id'])!;
    assert.equal(isReplayable(loaded), true);
  });
});

test('RUN-15: [logging] session_bodies = "redacted" keeps hashes, counts, cost and previews only', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test-redacted-0001' } }, async (sb) => {
    sb.writePaperConfig('schema_version = 1\n[logging]\nsession_bodies = "redacted"\n');
    const r = await complete({ slug: 'section-drafter', section: 1, system: 's', messages: [{ role: 'user', content: 'a private draft paragraph' }] });
    const rec = sessionLog(sb).find((x) => x['kind'] === 'llm')!;
    const resp = rec['response'] as { sha256: string; chars: number; preview: string; text?: string };
    assert.equal(resp.text, undefined);
    assert.equal(resp.sha256, createHash('sha256').update(r.text).digest('hex'));
    assert.equal(resp.chars, r.text.length);
    assert.equal(rec['output_tokens'], r.outputTokens);
    assert.equal(rec['cost_usd'], r.costUsd);
    assert.equal(rec['session_bodies'], 'redacted');
  });
});

test('RUN-17: the invocation argv is logged once per session', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test-argv-0001' } }, async (sb) => {
    setSessionArgv(['write', '2', '--yolo']);
    await complete({ slug: 'orphan-label', system: '', messages: [{ role: 'user', content: 'a' }] });
    await complete({ slug: 'orphan-label', system: '', messages: [{ role: 'user', content: 'b' }] });
    const argv = sessionLog(sb).filter((x) => x['event'] === 'session.argv');
    assert.equal(argv.length, 1);
    assert.deepEqual(argv[0]!['argv'], ['write', '2', '--yolo']);
    assert.equal(argv[0]!['run_id'], currentSessionId());
    const ids = sessionLog(sb).filter((x) => x['kind'] === 'llm').map((x) => x['id']);
    assert.deepEqual(ids, [`${currentSessionId()}:1`, `${currentSessionId()}:2`], 'sequence numbers increase per record');
  });
});
