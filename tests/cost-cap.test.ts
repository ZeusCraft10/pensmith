// tests/cost-cap.test.ts — the paper's cost cap, enforced before every paid call.
//
// The old gate summed .paper/COSTS.jsonl per scope id against a $0.50 default
// that no verb overrode. The ledger is never reset, so after a few re-drafts a
// section could never be written again, while the paper as a whole had no
// limit at all: PENSMITH_COST_CAP_USD only fed the --yolo pre-flight, and
// config.toml's [budget] cost_cap_usd was read by nothing. Now one cap covers
// everything the paper has spent, from PENSMITH_COST_CAP_USD, then
// `cost_cap_usd` under [budget] in .paper/config.toml, then $5, and a call that could pass it is refused before
// anything is sent.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { complete, _setGeneratorForTest, type Generator } from '../bin/lib/anthropic.js';
import { CostCapExceededError, resolveCostCap } from '../bin/lib/budget.js';
import { scoreHonestyWithOptions } from '../bin/lib/honesty.js';
import { isolatedCliEnv } from './lib/cli-env.js';

const ENV_KEYS = ['PENSMITH_NO_LLM', 'PENSMITH_COST_CAP_USD', 'PENSMITH_OFFLINE', 'GPTZERO_API_KEY', 'PENSMITH_TEST_CASSETTES'];
let saved: Record<string, string | undefined> = {};
let root: string;
let origCwd: string;
let calls = 0;

const echo: Generator = {
  async generate(req) {
    calls += 1;
    return { text: 'An answer.', model: req.model, stop: 'complete', stopReason: 'end_turn', usage: [{ model: req.model, inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 }] };
  },
};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ['PENSMITH_NO_LLM', 'PENSMITH_COST_CAP_USD', 'PENSMITH_OFFLINE']) delete process.env[k];
  root = mkdtempSync(path.join(tmpdir(), 'pensmith-cost-cap-'));
  mkdirSync(path.join(root, '.paper'), { recursive: true });
  origCwd = process.cwd();
  process.chdir(root);
  calls = 0;
  _setGeneratorForTest(echo);
});

afterEach(() => {
  _setGeneratorForTest(null);
  process.chdir(origCwd);
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(root, { recursive: true, force: true });
});

/** Seed the ledger with `rows` of [scopeId, costUsd]. */
function spent(dir: string, rows: Array<[string, number]>): void {
  writeFileSync(path.join(dir, '.paper', 'COSTS.jsonl'), rows.map(([scopeId, costUsd]) =>
    JSON.stringify({ ts: '2026-11-01T00:00:00.000Z', scope: 'section', scopeId, provider: 'anthropic', model: 'claude-opus-5-5', costUsd })).join('\n') + '\n');
}

const ASK = { system: 'Draft.', messages: [{ role: 'user' as const, content: 'Write section 1.' }], role: 'write' as const, scope: 'section' as const, scopeId: 'write-1' };

test('a section whose drafts have cost more than $0.50 can still be drafted again', async () => {
  spent(root, [['write-1', 0.2], ['write-1', 0.2], ['write-1', 0.2]]);
  const res = await complete(ASK);
  assert.equal(res.text, 'An answer.');
  assert.equal(calls, 1);
});

test('the paper cap refuses a call once spending across every step would pass it, before anything is sent', async () => {
  spent(root, Array.from({ length: 10 }, (_, i) => [`plan-${i + 1}`, 0.4995] as [string, number]));
  await assert.rejects(complete(ASK), (e: unknown) => {
    assert.ok(e instanceof CostCapExceededError, `got ${String(e)}`);
    assert.equal(e.exitCode, 2);
    assert.equal(e.cap, 5);
    assert.ok(Math.abs(e.spent - 4.995) < 1e-9);
    assert.match(e.message, /cost cap/);
    assert.match(e.message, /PENSMITH_COST_CAP_USD/);
    assert.match(e.message, /cost_cap_usd/);
    return true;
  });
  assert.equal(calls, 0, 'the provider was not called');
});

test('PENSMITH_COST_CAP_USD sets the cap', async () => {
  spent(root, [['plan-1', 4.995]]);
  process.env['PENSMITH_COST_CAP_USD'] = '20';
  await complete(ASK);
  assert.equal(calls, 1);
  process.env['PENSMITH_COST_CAP_USD'] = '4';
  await assert.rejects(complete(ASK), CostCapExceededError);
});

test('[budget] cost_cap_usd in .paper/config.toml sets it, and the variable overrides it', async () => {
  spent(root, [['outline', 1.5]]);
  writeFileSync(path.join(root, '.paper', 'config.toml'), '[budget]\ncost_cap_usd = 1.0\n');
  assert.deepEqual(resolveCostCap(root), { capUsd: 1, warnAtUsd: null, source: 'config.toml' });
  await assert.rejects(complete(ASK), CostCapExceededError);

  // A config.toml in the project root is the user's own file, not the paper's.
  rmSync(path.join(root, '.paper', 'config.toml'));
  writeFileSync(path.join(root, 'config.toml'), '[project]\ntitle = "x"\n\n[budget]\ncost_cap_usd = 1.25\n');
  assert.equal(resolveCostCap(root).source, 'default');
  writeFileSync(path.join(root, '.paper', 'config.toml'), '[budget]\ncost_cap_usd = 1.25\n');
  assert.equal(resolveCostCap(root).capUsd, 1.25);
  await assert.rejects(complete(ASK), CostCapExceededError);

  process.env['PENSMITH_COST_CAP_USD'] = '10';
  assert.equal(resolveCostCap(root).source, 'PENSMITH_COST_CAP_USD');
  await complete(ASK);
  assert.equal(calls, 1);
});

test('warn_at_usd prints the running total once when spending passes it', async () => {
  spent(root, [['outline', 0.6]]);
  writeFileSync(path.join(root, '.paper', 'config.toml'), '[budget]\ncost_cap_usd = 5\nwarn_at_usd = 0.5\n');
  const orig = process.stderr.write.bind(process.stderr);
  let stderr = '';
  process.stderr.write = ((c: string | Uint8Array) => { stderr += String(c); return true; }) as typeof process.stderr.write;
  try {
    await complete(ASK);
    await complete(ASK);
  } finally {
    process.stderr.write = orig;
  }
  assert.equal(stderr.match(/of the \$5\.00 cost cap/g)?.length, 1, stderr);
});

test('a call made for a named paper is capped and recorded on that paper, not where the cwd is', async () => {
  // The cwd (root) is at its cap; the paper the call is for has spent nothing.
  spent(root, [['write-1', 5]]);
  const other = mkdtempSync(path.join(tmpdir(), 'pensmith-cost-cap-other-'));
  const res = await complete({ ...ASK, paperRoot: other });
  assert.equal(res.text, 'An answer.');
  const rows = readFileSync(path.join(other, '.paper', 'COSTS.jsonl'), 'utf8').trim().split('\n');
  assert.equal(rows.length, 1, 'the call is on the named paper\'s ledger');
  assert.equal(readFileSync(path.join(root, '.paper', 'COSTS.jsonl'), 'utf8').trim().split('\n').length, 1, 'the cwd\'s ledger is untouched');
  // And the named paper's own cap applies.
  writeFileSync(path.join(other, '.paper', 'config.toml'), '[budget]\ncost_cap_usd = 0.000001\n');
  await assert.rejects(complete({ ...ASK, paperRoot: other }), CostCapExceededError);
  rmSync(other, { recursive: true, force: true });
});

test('the GPTZero score is skipped when the paper is at its cost cap', async () => {
  spent(root, [['write-1', 5]]);
  process.env['GPTZERO_API_KEY'] = 'test-key-offline';
  process.env['PENSMITH_TEST_CASSETTES'] = '1';
  const result = await scoreHonestyWithOptions('some text', { consentGranted: true });
  assert.equal(result, null, 'no score: the call would have passed the paper cap');
});

test('the CLI refuses a step over the cap with exit 2 and a plain message', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pensmith-cost-cap-cli-'));
  mkdirSync(path.join(dir, '.paper'), { recursive: true });
  spent(dir, [['write-1', 5]]);
  const r = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url)), 'plan', '1'], {
    cwd: dir,
    env: isolatedCliEnv({ ANTHROPIC_API_KEY: 'sk-ant-dummy', PENSMITH_NO_LLM: undefined, PENSMITH_COST_CAP_USD: undefined }),
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(r.status, 2, `stdout=${r.stdout} stderr=${r.stderr}`);
  assert.match(r.stderr, /REFUSED/);
  assert.match(r.stderr, /cost cap/);
  assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack trace');
  assert.ok(!existsSync(path.join(dir, '.paper', 'sections')) || !existsSync(path.join(dir, '.paper', 'sections', '01-placeholder', 'PLAN.md')), 'no PLAN.md written');
  rmSync(dir, { recursive: true, force: true });
});

test('a wave write at the cap names each refused section and exits 2', () => {
  // `pensmith write` with no section number drafts every planned section. Each
  // section's error used to be reduced to a "failed" count, exit 1, so the
  // cost-cap refusal never reached the person running it.
  const dir = mkdtempSync(path.join(tmpdir(), 'pensmith-cost-cap-wave-'));
  const paper = path.join(dir, '.paper');
  mkdirSync(paper, { recursive: true });
  writeFileSync(path.join(paper, 'OUTLINE.md'),
    '# Paper\n\n| # | slug | title | depends_on | word target | assigned_sources |\n| --- | --- | --- | --- | --- | --- |\n' +
    '| 1 | intro | Intro | | 300 | |\n| 2 | method | Method | | 300 | |\n');
  for (const [n, slug] of [[1, 'intro'], [2, 'method']] as const) {
    const sec = path.join(paper, 'sections', `0${n}-${slug}`);
    mkdirSync(sec, { recursive: true });
    writeFileSync(path.join(sec, 'PLAN.md'), `---\nsection: ${n}\nslug: ${slug}\ntitle: ${slug}\nstatus: planned\nassigned_sources: []\n---\n# ${slug}\n\nBrief.\n`);
  }
  spent(dir, [['write-1', 5]]);
  const r = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url)), 'write'], {
    cwd: dir,
    env: isolatedCliEnv({ ANTHROPIC_API_KEY: 'sk-ant-dummy', PENSMITH_NO_LLM: undefined, PENSMITH_COST_CAP_USD: undefined }),
    encoding: 'utf8',
    timeout: 60_000,
  });
  try {
    assert.equal(r.status, 2, `stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stderr, /section 1 \(intro\): REFUSED — this step could take the paper past its cost cap/);
    assert.match(r.stderr, /section 2 \(method\):/, 'the second section is accounted for too');
    assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack trace');
    assert.ok(!existsSync(path.join(paper, 'sections', '01-intro', 'DRAFT.md')), 'nothing was drafted');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
