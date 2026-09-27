// tests/replay.test.ts — RUN-17 (D-17-30): replay from SESSION.log.
//
// `resume --replay <entryId>` re-dispatches the logged verb (with the logged
// argv) and, with sources offline, serves the logged model responses matched
// by (slug, sha256 of the request body) — the mock is never dialled and the
// artefact is reproduced byte-for-byte. `[logging] session_bodies = "redacted"`
// records are not replayable. scripts/extract-fixture.mjs turns a SESSION.log
// into a mock fixture, byte-identical to bin/lib/replay.ts buildFixture().

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { withLlmSandbox, readJsonl, type LlmSandbox } from './helpers/llm-sandbox.js';
import { startMockLlm } from './helpers/local-servers/mock-llm.js';
import { buildFixture, readLlmRecords, isReplayable } from '../bin/lib/replay.js';
import { complete } from '../bin/lib/anthropic.js';

const KEY = 'sk-test-replay-0001';
const EXTRACT = path.resolve('scripts', 'extract-fixture.mjs');
const ASSIGNMENT = 'Write a 1500-word literature review on attention mechanisms in transformers, APA style.\n';

function llmRecords(sb: LlmSandbox): Array<Record<string, unknown>> {
  return readJsonl(path.join(sb.paper, 'SESSION.log')).filter((r) => r['kind'] === 'llm');
}

test('RUN-17: resume --replay (sources offline) reproduces INTAKE.md byte-for-byte without dialling the model', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY }, paper: false }, async (sb) => {
    fs.writeFileSync(path.join(sb.root, 'assignment.txt'), ASSIGNMENT);
    const first = await sb.runTsx(null, ['new', '--from', 'assignment.txt', '--yolo']);
    assert.equal(first.status, 0, first.stderr);
    const intakePath = path.join(sb.paper, 'INTAKE.md');
    const original = fs.readFileSync(intakePath, 'utf8');
    const calls = sb.mock!.callCount();
    assert.equal(sb.mock!.callCount('intake-clarifier'), 1);

    const rec = llmRecords(sb).find((r) => r['slug'] === 'intake-clarifier')!;
    assert.ok(rec, 'the intake-clarifier call was logged');
    assert.equal(rec['verb'], 'new');
    const argvEvent = readJsonl(path.join(sb.paper, 'SESSION.log')).find((r) => r['event'] === 'session.argv');
    assert.deepEqual(argvEvent?.['argv'], ['new', '--from', 'assignment.txt', '--yolo'], 'the invocation argv is logged once');

    fs.rmSync(intakePath);
    const replay = await sb.runTsx(null, ['resume', '--replay', String(rec['id'])], { env: { PENSMITH_OFFLINE: '1' } });
    assert.equal(replay.status, 0, replay.stderr);
    assert.match(replay.stderr, new RegExp(`replaying ${String(rec['id'])} → new --from assignment\\.txt --yolo \\(sources offline: serving the logged model responses\\)`));
    assert.equal(fs.readFileSync(intakePath, 'utf8'), original, 'byte-for-byte');
    assert.equal(sb.mock!.callCount(), calls, 'the mock was not called again');
    const replayed = llmRecords(sb).at(-1)!;
    assert.equal(replayed['replay_of'], rec['id']);
    assert.equal(replayed['cost_usd'], 0, 'a replayed response is not billed');
  });
});

test('RUN-17: an unknown id and a redacted record are refused with one line', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    sb.writePaperConfig('schema_version = 1\n[logging]\nsession_bodies = "redacted"\n');
    await complete({ slug: 'orphan-label', system: '', messages: [{ role: 'user', content: 'label me' }] });
    const rec = llmRecords(sb).at(-1)!;
    assert.equal(rec['session_bodies'], 'redacted');
    const req = rec['request'] as { sha256: string; preview: string; chars: number; messages?: unknown };
    assert.equal(req.messages, undefined, 'no request body stored');
    assert.ok(req.preview.length <= 200 && req.chars > req.preview.length, 'only a 200-char preview + hash');
    assert.equal(typeof rec['request_sha256'], 'string');
    assert.equal(isReplayable(readLlmRecords(sb.root).at(-1)!), false);

    const redacted = await sb.runTsx(null, ['resume', '--replay', String(rec['id'])], { env: { PENSMITH_OFFLINE: '1' } });
    assert.notEqual(redacted.status, 0);
    assert.match(redacted.stderr, /is not replayable — its bodies were not stored \(\[logging\] session_bodies = "redacted"/);

    const missing = await sb.runTsx(null, ['resume', '--replay', 'nope:1'], { env: { PENSMITH_OFFLINE: '1' } });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /replay: no SESSION\.log model-call record with id nope:1/);
  });
});

test('RUN-17: extract-fixture.mjs output equals buildFixture(), and the mock serves it by slug', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    sb.mock!.script('claim-support', { data: { verdict: 'PARTIAL', rationale: 'recorded rationale', evidence: 'p. 4' } });
    const a = await complete<{ verdict: string }>({ slug: 'claim-support', section: 1, system: '', messages: [{ role: 'user', content: 'claim A' }] });
    await complete({ slug: 'section-drafter', section: 1, system: 's', messages: [{ role: 'user', content: 'draft' }] });
    assert.equal(a.data?.verdict, 'PARTIAL');

    const logFile = path.join(sb.paper, 'SESSION.log');
    const fromScript = JSON.parse(execFileSync(process.execPath, [EXTRACT, logFile], { encoding: 'utf8' })) as unknown;
    assert.deepEqual(fromScript, JSON.parse(JSON.stringify(buildFixture(readLlmRecords(sb.root)))));
    const fx = fromScript as { version: number; slugs: Record<string, unknown[]> };
    assert.equal(fx.version, 1);
    assert.deepEqual(Object.keys(fx.slugs).sort(), ['claim-support', 'section-drafter']);

    // A fresh mock loaded with the fixture answers the same request with the recorded reply.
    const fxPath = path.join(sb.root, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify(fromScript));
    const replayMock = await startMockLlm({ fixture: fxPath });
    try {
      sb.writeGlobalRuntime({ $schemaVersion: 2, provider: 'anthropic', endpoint: replayMock.url });
      const b = await complete<{ verdict: string; rationale: string }>({ slug: 'claim-support', section: 1, system: '', messages: [{ role: 'user', content: 'claim A' }] });
      assert.equal(b.data?.verdict, 'PARTIAL');
      assert.equal(b.data?.rationale, 'recorded rationale');
    } finally {
      await replayMock.close();
    }
  });
});
