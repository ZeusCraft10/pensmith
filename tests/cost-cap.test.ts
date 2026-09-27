// tests/cost-cap.test.ts — RUN-18 / RUN-26 (D-17-26): the per-session cost cap.
//
// Before every model call the transport compares this session's spend plus the
// call's projection — input estimate + min(p90 output, max_tokens), never
// max_tokens itself — with the cap ([budget] cost_cap_usd, default $5,
// PENSMITH_COST_CAP_USD overrides). Over the cap a terminal (or scripted
// numbered prompts) is asked ONCE per session; a run that cannot prompt sends
// nothing and refuses with EXIT_COST_CAP (5). --yolo never skips it.
// warn_at_usd prints one warning with the running total.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { withLlmSandbox, readJsonl } from './helpers/llm-sandbox.js';
import { complete } from '../bin/lib/anthropic.js';
import { GateRefusedError } from '../bin/lib/gates.js';
import { EXIT_COST_CAP } from '../bin/lib/exit-codes.js';
import { resolveCostCap, DEFAULT_SESSION_CAP_USD, _resetCostCapForTest, _reservedUsdForTest } from '../bin/lib/budget.js';
import { p90OutputFor, projectCallUsd, projectEstimate, estimateTokens, _resetSamplesForTest } from '../bin/lib/estimator.js';
import { resolvePrice } from '../bin/lib/pricing.js';
import { slugSpec } from '../bin/lib/llm-models.js';

const KEY = 'sk-test-cost-cap-0001';
const ANTHROPIC_TS = pathToFileURL(path.resolve('bin/lib/anthropic.ts')).href;

function drafterCall(n = 0): Promise<unknown> {
  return complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: `go ${n}` }] });
}

function writeSamples(paper: string, slug: string, outputs: number[]): void {
  const lines = outputs.map((o, i) => JSON.stringify({ ts: new Date().toISOString(), kind: 'llm', id: `old:${i + 1}`, run_id: 'old', slug, output_tokens: o, stop_reason: 'end_turn' }));
  fs.appendFileSync(path.join(paper, 'SESSION.log'), lines.join('\n') + '\n');
}

test('RUN-18: cap precedence — PENSMITH_COST_CAP_USD > [budget] cost_cap_usd > $5.00', async () => {
  await withLlmSandbox({}, async (sb) => {
    assert.deepEqual(resolveCostCap(sb.root, {}), { capUsd: DEFAULT_SESSION_CAP_USD, capSource: 'default', warnAtUsd: null });
    sb.writePaperConfig('schema_version = 1\n[budget]\ncost_cap_usd = 12.5\nwarn_at_usd = 2\n');
    assert.deepEqual(resolveCostCap(sb.root, {}), { capUsd: 12.5, capSource: 'config', warnAtUsd: 2 });
    assert.deepEqual(resolveCostCap(sb.root, { PENSMITH_COST_CAP_USD: '0.75' }), { capUsd: 0.75, capSource: 'env', warnAtUsd: 2 });
    assert.equal(resolveCostCap(sb.root, { PENSMITH_COST_CAP_USD: 'abc' }).capSource, 'config', 'an invalid env value is ignored');
  });
});

test('RUN-26: the projection uses the p90 (shipped, then recorded), never max_tokens', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY, PENSMITH_COST_CAP_USD: '0.30' } }, async (sb) => {
    const spec = slugSpec('section-drafter');
    const price = resolvePrice('anthropic', 'claude-opus-5');
    assert.ok(projectCallUsd(price, 10, spec.maxTokens, spec.maxTokens).usd > 0.3, 'a max_tokens projection would exceed $0.30');
    assert.ok(projectCallUsd(price, 10, spec.p90Output, spec.maxTokens).usd < 0.3, 'the shipped p90 projection fits');
    assert.equal(p90OutputFor(sb.root, 'section-drafter').source, 'default');

    await drafterCall();
    assert.equal(sb.mock!.callCount(), 1, 'the call was sent: the p90 projection fits the cap');

    // Five recorded samples near max_tokens replace the shipped default.
    _resetSamplesForTest();
    _resetCostCapForTest();
    fs.rmSync(path.join(sb.paper, 'COSTS.jsonl'), { force: true });
    writeSamples(sb.paper, 'section-drafter', [15_000, 15_200, 15_400, 15_600, 15_800]);
    assert.deepEqual(p90OutputFor(sb.root, 'section-drafter'), { tokens: 15_800, source: 'recorded' });
    await assert.rejects(drafterCall(1), GateRefusedError);
    assert.equal(sb.mock!.callCount(), 1, 'nothing was sent over the cap');
    // max_tokens stays the ceiling: a p90 above it is clamped.
    assert.equal(projectCallUsd(price, 0, 99_999, spec.maxTokens).outputTokens, spec.maxTokens);
  });
});

test('RUN-18: over the cap without a terminal → GateRefusedError exit 5, one line, 0 requests sent', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY, PENSMITH_COST_CAP_USD: '0.01' } }, async (sb) => {
    await assert.rejects(drafterCall(), (e: unknown) => {
      assert.ok(e instanceof GateRefusedError);
      assert.equal(e.exitCode, EXIT_COST_CAP);
      assert.equal(e.exitCode, 5);
      assert.equal(e.gateId, 'cost-cap');
      assert.ok(!e.message.includes('\n'));
      assert.match(e.message, /section-drafter on claude-opus-5: projected \$0\.\d+ \+ \$0\.00 spent this session > cap \$0\.01/);
      assert.match(e.message, /--yolo does not skip this gate/);
      return true;
    });
    assert.equal(sb.mock!.callCount(), 0);
    assert.equal(readJsonl(path.join(sb.paper, 'COSTS.jsonl')).length, 0, 'nothing billed');
  });
});

test('RUN-18: the cap counts THIS session only (earlier sessions in COSTS.jsonl do not count)', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY, PENSMITH_COST_CAP_USD: '1' } }, async (sb) => {
    fs.writeFileSync(path.join(sb.paper, 'COSTS.jsonl'), JSON.stringify({ ts: '2026-01-01T00:00:00Z', scope: 'task', scopeId: 'x', provider: 'anthropic', model: 'claude-opus-5', inputTokens: 0, outputTokens: 0, costUsd: 50, session: 'an-earlier-session' }) + '\n');
    await drafterCall();
    assert.equal(sb.mock!.callCount(), 1);
  });
});

test('RUN-18: warn_at_usd prints exactly one warning with the running total', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    sb.writePaperConfig('schema_version = 1\n[budget]\nwarn_at_usd = 0.000001\n');
    const orig = process.stderr.write.bind(process.stderr);
    let err = '';
    (process.stderr as unknown as { write: (c: string | Uint8Array) => boolean }).write = (c: string | Uint8Array): boolean => {
      err += String(c);
      return true;
    };
    try {
      await drafterCall(1);
      await drafterCall(2);
      await drafterCall(3);
    } finally {
      (process.stderr as unknown as { write: typeof orig }).write = orig;
    }
    const warnings = err.split('\n').filter((l) => l.includes('cost warning'));
    assert.equal(warnings.length, 1, err);
    assert.match(warnings[0]!, /^pensmith: cost warning — \$0\.\d+ spent this session \(warn_at_usd \$0\.0000, cap \$5\.00\)\.$/);
  });
});

const SCRIPT = (count: number): string => `
import { complete } from ${JSON.stringify(ANTHROPIC_TS)};
const out = [];
for (let i = 0; i < ${count}; i += 1) {
  try {
    await complete({ slug: 'section-drafter', system: 's', messages: [{ role: 'user', content: 'go ' + i }] });
    out.push('ok');
  } catch (e) {
    out.push('refused:' + e.name + ':' + e.exitCode);
    break;
  }
}
process.stdout.write(JSON.stringify(out));
`;

test('RUN-18: numbered prompt — "y" approves once for the whole session; "n" sends nothing (exit 5)', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const script = path.join(sb.root, 'cap-script.mts');
    fs.writeFileSync(script, SCRIPT(3));
    const env = { PENSMITH_PROMPT_MODE: 'numbered', PENSMITH_COST_CAP_USD: '0.01' };

    const yes = await sb.runTsx(script, [], { env, input: 'y\n' });
    assert.equal(yes.status, 0, yes.stderr);
    assert.deepEqual(JSON.parse(yes.stdout), ['ok', 'ok', 'ok']);
    assert.equal(sb.mock!.callCount(), 3);
    const asked = yes.stderr.split('\n').filter((l) => l.includes('would exceed your $0.01 cost cap'));
    assert.equal(asked.length, 1, `asked once per session:\n${yes.stderr}`);

    sb.mock!.reset();
    const no = await sb.runTsx(script, [], { env, input: 'n\n' });
    assert.deepEqual(JSON.parse(no.stdout), ['refused:GateRefusedError:5']);
    assert.equal(sb.mock!.callCount(), 0, 'a decline sends nothing');
  });
});

test('RUN-18: --yolo never skips the cap — spawned CLI runs refuse before any request', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    fs.writeFileSync(path.join(sb.paper, 'INTAKE.md'), 'Topic: glacier retreat\nDiscipline: other\n');
    const env = { PENSMITH_COST_CAP_USD: '0.0001' };

    // --yolo: the D-17-27 pre-flight (this run's steps only) refuses with
    // EXIT_COST_CAP before dispatch, through the same cost-cap gate and the same
    // one-line message as the per-call check — and no internal requirement ID.
    const yolo = await sb.runTsx(null, ['outline', '--force', '--yolo'], { env });
    assert.equal(yolo.status, EXIT_COST_CAP, yolo.stderr);
    // One refusal line (the RUN-02 test-runner OFFLINE banner may precede it).
    const refusal = /^pensmith: This call would exceed your cost cap\. Continue\? \(outline: projected \$0\.\d+ \+ \$0\.00 spent this session > cap \$0\.0001; raise \[budget\] cost_cap_usd or PENSMITH_COST_CAP_USD\) needs an answer: re-run in a terminal \(--yolo does not skip this gate\)\.$/m;
    assert.match(yolo.stderr, refusal);
    assert.equal(yolo.stderr.split('\n').filter((l) => l.startsWith('pensmith: ')).length, 1, yolo.stderr);
    assert.doesNotMatch(yolo.stderr, /RUN-\d+/, 'no internal requirement ID in user output');

    // Without --yolo and without a terminal: the per-call cap gate refuses. (A
    // verb with no approval question of its own — `outline` would stop first,
    // at its outline-approval gate, before any model call: RUN-28.)
    fs.writeFileSync(path.join(sb.root, 'assignment.txt'), 'Write a 1500-word essay on glacier retreat.\n');
    const plain = await sb.runTsx(null, ['new', '--from', 'assignment.txt'], { env });
    // The dispatcher prints the GateRefusedError as one line and exits with its code.
    assert.equal(plain.status, EXIT_COST_CAP, plain.stderr);
    assert.match(plain.stderr, /This call would exceed your cost cap\. Continue\? \(intake-clarifier on \S+: projected \$0\.\d+ \+ \$0\.00 spent this session > cap \$0\.0001/);
    assert.match(plain.stderr, /--yolo does not skip this gate/);

    assert.equal(sb.mock!.callCount(), 0, 'no request in either run');
    assert.equal(fs.existsSync(path.join(sb.paper, 'OUTLINE.md')), false);
  });
});

test('RUN-18 / D-17-27: the --yolo pre-flight projects THIS run only — `outline --yolo` runs under a cap the whole paper would exceed', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    fs.writeFileSync(path.join(sb.paper, 'INTAKE.md'), 'Topic: glacier retreat\nDiscipline: other\nLength: 12000 words\n');
    sb.writePaperConfig('schema_version = 1\n[budget]\ncost_cap_usd = 0.5\n');
    const whole = await projectEstimate({ paperRoot: sb.root });
    const step = await projectEstimate({ paperRoot: sb.root, scope: { verb: 'outline' } });
    assert.ok(whole.totalUsd > 0.5, `the remaining pipeline is over the cap ($${whole.totalUsd.toFixed(2)})`);
    assert.ok(step.totalUsd > 0 && step.totalUsd < 0.5, `the outline step alone is under it ($${step.totalUsd.toFixed(2)})`);
    assert.deepEqual(step.rows.map((r) => r.step), ['outline']);

    const r = await sb.runTsx(null, ['outline', '--yolo']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.doesNotMatch(r.stderr, /cost cap/);
    assert.equal(sb.mock!.callCount('outline-author'), 1, 'the outline call was made');
    assert.ok(fs.existsSync(path.join(sb.paper, 'OUTLINE.md')));
  });
});

test('RUN-18: calls in flight count toward the cap — 5 parallel calls under a 2.5-call cap send exactly 2', async () => {
  const spec = slugSpec('section-drafter');
  const price = resolvePrice('anthropic', 'claude-opus-5');
  const one = projectCallUsd(price, estimateTokens('s'.length + 'go 0'.length), spec.p90Output, spec.maxTokens).usd;
  const cap = one * 2.5;
  await withLlmSandbox(
    { mock: 'anthropic', mockOptions: { delayMs: 300 }, env: { ANTHROPIC_API_KEY: KEY, PENSMITH_COST_CAP_USD: String(cap) } },
    async (sb) => {
      // All five are checked while the first ones are still in flight (the mock
      // answers after 300 ms), as parallel MCP tool calls for different sections are.
      const settled = await Promise.allSettled([0, 1, 2, 3, 4].map((n) => drafterCall(n)));
      const sent = settled.filter((r) => r.status === 'fulfilled').length;
      const refused = settled.filter((r) => r.status === 'rejected' && r.reason instanceof GateRefusedError && r.reason.exitCode === EXIT_COST_CAP).length;
      assert.equal(sent, 2, `exactly two calls fit the cap: ${JSON.stringify(settled.map((r) => r.status))}`);
      assert.equal(refused, 3, 'the other three are refused before sending');
      assert.equal(sb.mock!.callCount(), 2, 'only two requests reached the provider');
      assert.equal(_reservedUsdForTest(), 0, 'every reservation was released');
    },
  );
});
