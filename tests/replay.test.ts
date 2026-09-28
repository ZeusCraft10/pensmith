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
import { EXIT_APPROVAL } from '../bin/lib/exit-codes.js';
import { writeState, writeOutline, writePlan, sectionDirOf } from './helpers/paper-cli-harness.js';

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
    // The replay's own --yolo is the only one the replayed verb sees.
    const replay = await sb.runTsx(null, ['resume', '--replay', String(rec['id']), '--yolo'], { env: { PENSMITH_OFFLINE: '1' } });
    assert.equal(replay.status, 0, replay.stderr);
    assert.match(replay.stderr, new RegExp(`replaying ${String(rec['id'])} → new --from assignment\\.txt --yolo \\(sources offline: serving the logged model responses\\)`));
    assert.equal(fs.readFileSync(intakePath, 'utf8'), original, 'byte-for-byte');
    assert.equal(sb.mock!.callCount(), calls, 'the mock was not called again');
    const replayed = llmRecords(sb).at(-1)!;
    assert.equal(replayed['replay_of'], rec['id']);
    assert.equal(replayed['cost_usd'], 0, 'a replayed response is not billed');
  });
});

test('RUN-17: a step run with --model / --runtime replays exactly (the logged runtime flags are re-applied, never passed to the verb)', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY }, paper: false }, async (sb) => {
    fs.writeFileSync(path.join(sb.root, 'assignment.txt'), ASSIGNMENT);
    const first = await sb.runTsx(null, ['--runtime', 'anthropic', 'new', '--from', 'assignment.txt', '--yolo', '--model', 'claude-sonnet-5']);
    assert.equal(first.status, 0, first.stderr);
    const intakePath = path.join(sb.paper, 'INTAKE.md');
    const original = fs.readFileSync(intakePath, 'utf8');
    const calls = sb.mock!.callCount();
    const rec = llmRecords(sb).find((r) => r['slug'] === 'intake-clarifier')!;
    assert.equal(rec['model'], 'claude-sonnet-5', 'the logged call used the --model override');

    fs.rmSync(intakePath);
    // The logged --yolo is never inherited (RUN-28): replayed without one, `new`
    // stops at its own intake-defaults gate (GRND-02) before any request.
    const plain = await sb.runTsx(null, ['resume', '--replay', String(rec['id'])], { env: { PENSMITH_OFFLINE: '1' } });
    assert.equal(plain.status, 3, plain.stderr);
    assert.match(plain.stderr, new RegExp(`replaying ${String(rec['id'])} → new --from assignment\\.txt \\(sources offline`));
    assert.match(plain.stderr, /^pensmith: Accept the intake defaults\? \(unanswered: /m);
    assert.ok(!fs.existsSync(intakePath), 'the refused replay wrote nothing');
    // The replaying invocation's own --yolo reaches the verb; the logged --runtime/--model are re-applied.
    const replay = await sb.runTsx(null, ['resume', '--replay', String(rec['id']), '--yolo'], { env: { PENSMITH_OFFLINE: '1' } });
    assert.equal(replay.status, 0, replay.stderr);
    assert.match(replay.stderr, new RegExp(`replaying ${String(rec['id'])} → new --from assignment\\.txt --yolo \\(sources offline`));
    assert.doesNotMatch(replay.stderr, /inputs changed/);
    assert.equal(fs.readFileSync(intakePath, 'utf8'), original, 'byte-for-byte');
    assert.equal(sb.mock!.callCount(), calls, 'the mock was not called again');
    const replayed = llmRecords(sb).at(-1)!;
    assert.equal(replayed['replay_of'], rec['id']);
    assert.equal(replayed['model'], 'claude-sonnet-5');
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

// ---------------------------------------------------------------------------
// A write step replays after the section's lifecycle moved on (RUN-17), only
// the logged section is replayed, a miss changes nothing, and a replay never
// inherits the logged --yolo (RUN-28).
// ---------------------------------------------------------------------------

function seedPlannedPaper(sb: LlmSandbox, slugs: string[]): void {
  writeState(sb.root, slugs.map((slug, i) => ({ n: i + 1, slug })));
  writeOutline(sb.root, slugs.map((slug, i) => ({ n: i + 1, slug })));
  for (const [i, slug] of slugs.entries()) writePlan(sb.root, i + 1, slug, { status: 'planned' });
  fs.writeFileSync(path.join(sb.paper, 'CITATIONS.bib'), '');
  fs.writeFileSync(path.join(sb.paper, 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 2, entries: [] }));
  fs.writeFileSync(path.join(sb.paper, 'INTAKE.md'), 'Topic: attention mechanisms in transformers\n');
  fs.writeFileSync(path.join(sb.paper, 'RESEARCH.md'), '# Research\n');
}

function planStatus(file: string): string {
  return /^status:\s*(\S+)/m.exec(fs.readFileSync(file, 'utf8'))?.[1] ?? '';
}

test('RUN-17: write N → verify N → resume --replay <write id> reproduces DRAFT.md byte-for-byte (lifecycle state is not a request input)', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    seedPlannedPaper(sb, ['intro']);
    const draftPath = path.join(sectionDirOf(sb.root, 1, 'intro'), 'DRAFT.md');
    const planPath = path.join(sectionDirOf(sb.root, 1, 'intro'), 'PLAN.md');
    // --no-verify: write alone (GRND-15 chains verify otherwise); verify runs next.
    const w = await sb.runTsx(null, ['write', '1', '--yolo', '--no-verify']);
    assert.equal(w.status, 0, w.stderr);
    const original = fs.readFileSync(draftPath, 'utf8');
    assert.equal(planStatus(planPath), 'written');
    const v = await sb.runTsx(null, ['verify', '1', '--yolo']);
    assert.equal(v.status, 0, `${v.stdout}\n${v.stderr}`);
    assert.equal(planStatus(planPath), 'verified', 'verify moved the lifecycle on');
    const rec = llmRecords(sb).find((r) => r['slug'] === 'section-drafter')!;
    assert.ok(rec, 'the drafter call was logged');
    const req = JSON.stringify(rec['request']);
    assert.doesNotMatch(req, /status: |verified_against_draft_hash/, 'the drafter request carries no lifecycle fields');

    fs.writeFileSync(draftPath, 'edited since\n');
    const calls = sb.mock!.callCount();
    const replay = await sb.runTsx(null, ['resume', '--replay', String(rec['id'])], { env: { PENSMITH_OFFLINE: '1' } });
    assert.equal(replay.status, 0, replay.stderr);
    assert.match(replay.stderr, new RegExp(`replaying ${String(rec['id'])} → write 1 --no-verify \\(sources offline`));
    assert.doesNotMatch(replay.stderr, /inputs changed/);
    assert.equal(fs.readFileSync(draftPath, 'utf8'), original, 'byte-for-byte');
    assert.equal(sb.mock!.callCount(), calls, 'the mock was not called again');
    assert.equal(planStatus(planPath), 'written', 'the replayed write step marks the section written, as the logged run did');
  });
});

test('RUN-17: replaying one section of a wave `write` re-drafts only that section; a replay miss leaves PLAN.md untouched', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    seedPlannedPaper(sb, ['intro', 'body']);
    const w = await sb.runTsx(null, ['write', '--yolo']);
    assert.equal(w.status, 0, `${w.stdout}\n${w.stderr}`);
    const rec = llmRecords(sb).find((r) => r['slug'] === 'section-drafter' && r['section'] === 2)!;
    assert.ok(rec, 'section 2 drafter call logged');
    const intro = path.join(sectionDirOf(sb.root, 1, 'intro'), 'DRAFT.md');
    const body = path.join(sectionDirOf(sb.root, 2, 'body'), 'DRAFT.md');
    const bodyOriginal = fs.readFileSync(body, 'utf8');
    fs.writeFileSync(intro, 'my own intro\n');
    fs.writeFileSync(body, 'edited\n');

    const replay = await sb.runTsx(null, ['resume', '--replay', String(rec['id'])], { env: { PENSMITH_OFFLINE: '1' } });
    assert.equal(replay.status, 0, replay.stderr);
    assert.match(replay.stderr, new RegExp(`replaying ${String(rec['id'])} → write 2 \\(sources offline`));
    assert.doesNotMatch(replay.stdout, /section_start/, 'no wave was scheduled');
    assert.equal(fs.readFileSync(body, 'utf8'), bodyOriginal, 'the logged section is reproduced');
    assert.equal(fs.readFileSync(intro, 'utf8'), 'my own intro\n', 'the other section is untouched');

    // Change what section 2 should say: the replay misses and changes nothing.
    const planPath = path.join(sectionDirOf(sb.root, 2, 'body'), 'PLAN.md');
    fs.writeFileSync(planPath, fs.readFileSync(planPath, 'utf8').replace('Section 2.', 'Section 2, rewritten brief.'));
    const planBefore = fs.readFileSync(planPath, 'utf8');
    const miss = await sb.runTsx(null, ['resume', '--replay', String(rec['id'])], { env: { PENSMITH_OFFLINE: '1' } });
    assert.equal(miss.status, 1, miss.stderr);
    assert.match(miss.stderr, /no logged response matches this section-drafter request/);
    assert.equal(fs.readFileSync(planPath, 'utf8'), planBefore, 'a replay miss never marks the section writing');
  });
});

test('RUN-17 / RUN-28: a replay never inherits the logged --yolo — the outline gate refuses without a terminal', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY }, paper: false }, async (sb) => {
    fs.writeFileSync(path.join(sb.root, 'assignment.txt'), ASSIGNMENT);
    assert.equal((await sb.runTsx(null, ['new', '--from', 'assignment.txt', '--yolo'])).status, 0);
    const out = await sb.runTsx(null, ['outline', '--yolo']);
    assert.equal(out.status, 0, `${out.stdout}\n${out.stderr}`);
    const outlinePath = path.join(sb.paper, 'OUTLINE.md');
    const original = fs.readFileSync(outlinePath, 'utf8');
    const rec = llmRecords(sb).find((r) => r['slug'] === 'outline-author')!;
    assert.ok(rec, 'the outline-author call was logged');
    fs.rmSync(outlinePath);
    const statePath = path.join(sb.paper, 'STATE.json');
    fs.writeFileSync(statePath, JSON.stringify({ ...JSON.parse(fs.readFileSync(statePath, 'utf8')), sections: [] }, null, 2) + '\n');

    const refused = await sb.runTsx(null, ['resume', '--replay', String(rec['id'])], { env: { PENSMITH_OFFLINE: '1' } });
    assert.equal(refused.status, EXIT_APPROVAL, `${refused.stdout}\n${refused.stderr}`);
    assert.match(refused.stderr, new RegExp(`replaying ${String(rec['id'])} → outline \\(sources offline`));
    assert.match(refused.stderr, /Approve this outline/);
    assert.ok(!fs.existsSync(outlinePath), 'nothing was written');

    const approved = await sb.runTsx(null, ['resume', '--replay', String(rec['id']), '--yolo'], { env: { PENSMITH_OFFLINE: '1' } });
    assert.equal(approved.status, 0, approved.stderr);
    assert.equal(fs.readFileSync(outlinePath, 'utf8'), original, 'with the replay\'s own --yolo the outline is reproduced');
  });
});
