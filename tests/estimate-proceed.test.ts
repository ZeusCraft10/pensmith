// tests/estimate-proceed.test.ts — RUN-20 / RUN-26 (D-17-26, D-17-27): --estimate.
//
// --estimate projects the REMAINING work with the resolved runtime's per-slug
// models and prices and the p90 output projection, makes no LLM or network
// call, prints per-step rows + total + model + cap, then asks "Proceed?"
// (estimate-proceed gate): a run that cannot prompt prints and exits 0, "n"
// exits 0 with nothing sent, "y" dispatches exactly the next router action.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox, type LlmSandbox } from './helpers/llm-sandbox.js';
import { projectEstimate, renderEstimate } from '../bin/lib/estimator.js';
import { initState, initSection } from '../bin/lib/state.js';
import { setRuntimeOverride } from '../bin/lib/runtime.js';
import { writeDoneRecordFile } from './helpers/paper-cli-harness.js';

const KEY = 'sk-test-estimate-0001';
const ASSIGNMENT = fs.readFileSync(path.join('tests', 'fixtures', 'assignment.txt'), 'utf8');

function totalOf(out: string): number {
  const m = /total: \$(\d+\.\d\d)/.exec(out);
  assert.ok(m, `a total line:\n${out}`);
  return Number(m[1]);
}

async function researchedPaper(sb: LlmSandbox): Promise<void> {
  await initState(sb.root);
  fs.writeFileSync(path.join(sb.paper, 'INTAKE.md'), 'Topic: attention mechanisms in transformers\nDiscipline: computer-science\n\n## Assignment\n\n' + ASSIGNMENT);
  fs.writeFileSync(path.join(sb.paper, 'RESEARCH.md'), '# Research\n');
  fs.writeFileSync(path.join(sb.paper, 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 1, entries: [{ citekey: 'vaswani2017', title: 'Attention is all you need' }] }));
}

test('RUN-20: a fresh dir with only the §15 assignment — full pipeline rows, total under $3.50, no request', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY }, paper: false }, async (sb) => {
    fs.writeFileSync(path.join(sb.root, 'assignment.txt'), ASSIGNMENT);
    const r = await sb.runTsx(null, ['--estimate']);
    assert.equal(r.status, 0, r.stderr);
    const out = r.stdout;
    for (const step of ['new', 'research', 'outline', 'plan §1', 'write §1', 'verify §1', 'plan §3', 'write §3', 'verify §3', 'compile', 'done']) {
      assert.match(out, new RegExp(`^  ${step.replace('§', '§')}\\s`, 'm'), `row "${step}"`);
    }
    assert.match(out, /generation claude-opus-5, judgment claude-haiku-4-5/, 'names the models');
    assert.match(out, /3 section\(s\) \(from a 1,500-word target\)/);
    const total = totalOf(out);
    assert.ok(total > 0, 'non-zero total');
    assert.ok(total < 3.5, `the default §15 paper projects under $5.00 with >= 30% margin (got $${total})`);
    assert.match(out, /\(cap \$5\.00;/);
    assert.equal(sb.mock!.requests.length, 0, 'estimating makes no LLM call');
    assert.ok(!r.stdout.includes('Proceed?') && !r.stderr.includes('Proceed?'), 'a non-interactive run prints and exits without asking');
    assert.equal(fs.existsSync(path.join(sb.root, '.paper')), false, 'estimating writes nothing');
  });
});

test('RUN-20: numbered "n" exits 0 with 0 requests; "y" dispatches exactly the next router action', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await researchedPaper(sb);
    const env = { PENSMITH_PROMPT_MODE: 'numbered' };

    const no = await sb.runTsx(null, ['--estimate'], { env, input: 'n\n' });
    assert.equal(no.status, 0, no.stderr);
    assert.match(no.stderr, /Proceed\? \(confirm\)\n\[y\/N\]/);
    assert.ok(!/^  research\s/m.test(no.stdout), 'research is done (LIBRARY.json exists) — excluded');
    assert.match(no.stdout, /^  outline\s/m);
    assert.equal(sb.mock!.requests.length, 0);

    // The outline's own approval gate follows (answered, or refused without a
    // terminal); either way exactly one router action ran.
    const yes = await sb.runTsx(null, ['--estimate'], { env, input: 'y\ny\n' });
    assert.match(yes.stdout, /^  outline\s/m, 'the estimate printed first');
    const slugs = sb.mock!.requests.map((q) => q.headers['x-pensmith-slug']);
    assert.deepEqual(slugs, ['outline-author'], 'exactly the next router action (outline) ran');
  });
});

test('RUN-20: completed steps are excluded; a finished paper has nothing left to run', async () => {
  await withLlmSandbox({ env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await researchedPaper(sb);
    await initSection(sb.root, 1, 'intro');
    await initSection(sb.root, 2, 'body');
    const plan = (n: number, slug: string, status: string): void => {
      const dir = path.join(sb.paper, 'sections', `0${n}-${slug}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'PLAN.md'), `---\nsection: ${n}\nslug: ${slug}\ntitle: T\ndepends_on: []\nassigned_sources: []\nstatus: ${status}\nverified_against_draft_hash: null\n---\n## Brief\n\nx\n`);
    };
    plan(1, 'intro', 'verified');
    plan(2, 'body', 'written');
    const est = await projectEstimate({ paperRoot: sb.root });
    const steps = est.rows.map((r) => r.step);
    assert.deepEqual(steps, ['verify §2', 'compile', 'done'], 'no §1 rows; §2 only needs verify; no outline/research');
    assert.equal(est.sectionSource, 'state');

    plan(2, 'body', 'verified');
    fs.writeFileSync(path.join(sb.paper, 'DRAFT.md'), '# Draft\n');
    fs.writeFileSync(path.join(sb.paper, 'FINAL.md'), '# Final\n');
    writeDoneRecordFile(sb.root); // done exported it (done-record.ts)
    const done = await projectEstimate({ paperRoot: sb.root });
    assert.equal(done.nothingLeft, true);
    assert.equal(renderEstimate(done), 'pensmith estimate: nothing left to run ($0.00)');
  });
});

test('D-21-27: the §15 paper with the humanizer skill installed — compile smooths and judges, done humanizes each section — still projects ≥ 30% under the $5 cap', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY }, paper: false }, async (sb) => {
    fs.writeFileSync(path.join(sb.root, 'assignment.txt'), ASSIGNMENT);
    const skillDir = path.join(sb.dataDir, '.claude', 'skills', 'humanizer');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.copyFileSync(new URL('./fixtures/humanizer-skill/humanizer-skill.md', import.meta.url), path.join(skillDir, 'SKILL.md'));
    const r = await sb.runTsx(null, ['--estimate'], { env: { USERPROFILE: sb.dataDir } });
    assert.equal(r.status, 0, r.stderr);
    // 3 sections: 2 smoother + 1 claim-consistency at compile; 3 humanizer, the claim-support re-judging of
    // the citing sentences they change (review round 3) and the Pass-4 audit at done.
    assert.match(r.stdout, /^  compile\s+3\s.*claude-opus-5, claude-haiku-4-5$/m);
    const doneRow = /^  done\s+(\d+)\s/m.exec(r.stdout);
    assert.ok(doneRow && Number(doneRow[1]) >= 4, `done counts the 3 humanizer calls: ${r.stdout}`);
    const total = totalOf(r.stdout);
    assert.ok(total < 3.5, `the default §15 paper projects under $5.00 with >= 30% margin (got $${total})`);
    assert.equal(sb.mock!.requests.length, 0, 'estimating makes no LLM call');
  });
});

test('RUN-20: --estimate on an explicit verb projects that verb (and section) — `write` includes the verify it chains (GRND-15), a wave `write` prices every planned section', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await researchedPaper(sb);
    await initSection(sb.root, 1, 'intro');
    await initSection(sb.root, 2, 'body');
    for (const [n, slug] of [[1, 'intro'], [2, 'body']] as const) {
      const dir = path.join(sb.paper, 'sections', `0${n}-${slug}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'PLAN.md'), `---\nsection: ${n}\nslug: ${slug}\ntitle: T\ndepends_on: []\nassigned_sources: []\nstatus: verified\nverified_against_draft_hash: null\n---\n## Brief\n\nx\n`);
    }
    fs.writeFileSync(path.join(sb.paper, 'DRAFT.md'), '# Draft\n');
    fs.writeFileSync(path.join(sb.paper, 'FINAL.md'), '# Final\n');
    writeDoneRecordFile(sb.root); // done exported it (done-record.ts)
    // The whole paper is done: bare --estimate has nothing left …
    const bare = await sb.runTsx(null, ['--estimate']);
    assert.equal(bare.status, 0, bare.stderr);
    assert.match(bare.stdout, /nothing left to run \(\$0\.00\)/);
    // … but `write 1` still makes a paid drafter call — and verifies the
    // draft it writes (GRND-15, D-18-26) — and says so.
    const one = await sb.runTsx(null, ['write', '1', '--estimate']);
    assert.equal(one.status, 0, one.stderr);
    assert.match(one.stdout, /^  write §1\s/m);
    assert.match(one.stdout, /^  verify §1\s/m, 'write chains verify');
    assert.doesNotMatch(one.stdout, /^  (write §2|verify §2|compile|done)\s/m, 'only the named section');
    assert.ok(totalOf(one.stdout) > 0, 'a re-draft is priced');
    // `write 1 --no-verify` drafts only.
    const draftOnly = await sb.runTsx(null, ['write', '1', '--no-verify', '--estimate']);
    assert.equal(draftOnly.status, 0, draftOnly.stderr);
    assert.match(draftOnly.stdout, /^  write §1\s/m);
    assert.doesNotMatch(draftOnly.stdout, /^  (verify|write §2|compile|done)/m, 'no verify with --no-verify');
    assert.ok(totalOf(draftOnly.stdout) > 0 && totalOf(draftOnly.stdout) <= totalOf(one.stdout));
    // A wave `write` re-drafts and re-verifies every planned section, verified ones included.
    const wave = await sb.runTsx(null, ['write', '--estimate']);
    assert.equal(wave.status, 0, wave.stderr);
    for (const step of ['write §1', 'write §2', 'verify §1', 'verify §2']) {
      assert.match(wave.stdout, new RegExp(`^  ${step}\\s`, 'm'), step);
    }
    assert.ok(Math.abs(totalOf(wave.stdout) - 2 * totalOf(one.stdout)) < 0.011, 'two drafter calls and two verifications');
    const waveDraftOnly = await sb.runTsx(null, ['write', '--no-verify', '--estimate']);
    assert.equal(waveDraftOnly.status, 0, waveDraftOnly.stderr);
    assert.doesNotMatch(waveDraftOnly.stdout, /^  verify/m);
    assert.ok(Math.abs(totalOf(waveDraftOnly.stdout) - 2 * totalOf(draftOnly.stdout)) < 0.011, 'two drafter calls');
    // Phase 21 (D-21-27): compile smooths the one boundary and judges the
    // cross-section claims — two calls for two sections ...
    const compile = await sb.runTsx(null, ['compile', '--estimate']);
    assert.equal(compile.status, 0, compile.stderr);
    assert.match(compile.stdout, /^  compile\s+2\s/m);
    assert.ok(totalOf(compile.stdout) > 0);
    // ... and with both steps turned off it makes no model call, and says so.
    fs.writeFileSync(path.join(sb.paper, 'config.toml'), 'schema_version = 4\n\n[compile]\nsmooth_transitions = false\ncontradiction_pairs = 0\n');
    const quiet = await sb.runTsx(null, ['compile', '--estimate']);
    assert.equal(quiet.status, 0, quiet.stderr);
    assert.match(quiet.stdout, /^  compile\s.*no model calls$/m);
    assert.equal(sb.mock!.requests.length, 0, 'estimating makes no LLM call');
  });
});

test('RUN-20 / RUN-26: a cheaper generation model lowers the total in proportion; an unknown model is flagged', async () => {
  await withLlmSandbox({ env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    fs.writeFileSync(path.join(sb.root, 'assignment.txt'), ASSIGNMENT);
    const opus = await projectEstimate({ paperRoot: sb.root });
    setRuntimeOverride({ model: 'claude-haiku-4-5' });
    const haiku = await projectEstimate({ paperRoot: sb.root });
    assert.ok(haiku.totalUsd < opus.totalUsd, `${haiku.totalUsd} < ${opus.totalUsd}`);
    const write = (e: typeof opus): number => e.rows.find((r) => r.step === 'write §1')!.usd;
    // Haiku 4.5 is $1/$5 vs Opus 5 at $5/$25: exactly one fifth for a generation-only row.
    assert.ok(Math.abs(write(haiku) * 5 - write(opus)) < 1e-9);
    const verify = (e: typeof opus): number => e.rows.find((r) => r.step === 'verify §1')!.usd;
    assert.equal(verify(haiku), verify(opus), 'judgment slugs are unchanged by --model');
    assert.match(renderEstimate(haiku), /generation claude-haiku-4-5/);

    setRuntimeOverride({ model: 'claude-some-future-model' });
    const unknown = await projectEstimate({ paperRoot: sb.root });
    const text = renderEstimate(unknown);
    assert.match(text, /claude-some-future-model \(fallback price\)/);
    assert.ok(unknown.rows.some((r) => r.fallbackPrice));
  });
});

test('RUN-20: PENSMITH_NO_LLM projects $0.00 for every model row', async () => {
  await withLlmSandbox({ env: { PENSMITH_NO_LLM: '1' } }, async (sb) => {
    fs.writeFileSync(path.join(sb.root, 'assignment.txt'), ASSIGNMENT);
    const est = await projectEstimate({ paperRoot: sb.root });
    assert.equal(est.totalUsd, 0);
    assert.equal(est.llmStubbed, true);
    assert.match(renderEstimate(est), /\(LLM stubbed: \$0\.00\)/);
  });
});
