// tests/estimator.test.ts — Phase 7 Wave 0 RED scaffold for ERGO-02 / ERGO-03.
//
// RED-by-skip precedent (05-01 / 06-01): every behavioral assertion is
// skip-guarded on existsSync('bin/lib/estimator.ts'). Until Plan 07-02 lands
// the module the suite reports SKIPS with ZERO failures.
//
// Asserts the EXACT contract from 07-01-PLAN.md <interfaces>:
//   export function projectEstimate(args: { paperRoot: string; sessionCapUsd?: number })
//     : Promise<{ rows: EstimateRow[]; totalUsd: number; exceedsHalfCap: boolean }>
//   - totalUsd === sum of row.usd
//   - exceedsHalfCap === (totalUsd > sessionCapUsd * 0.5)
//   - C2-H1: paper-less dir → empty projection, never throws
//   - C4-HIGH: present-but-corrupt / schema-invalid STATE.json → empty projection,
//     never throws (same disposition as the fresh-dir case)
//   - T-07-03: NO COSTS.jsonl is written during projection (projection never bills)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pensmithDataDir, sectionPlan } from '../bin/lib/paths.js';
import { estimateCost } from '../bin/lib/pricing.js';
import { isolatedCliEnv } from './lib/cli-env.js';
import { writeVerificationFixture } from './lib/verification-fixture.js';

// RED-by-skip guard — the module under test does not exist until Plan 07-02.
const ESTIMATOR_SRC = fileURLToPath(new URL('../bin/lib/estimator.ts', import.meta.url));
const built = existsSync(ESTIMATOR_SRC);
const ESTIMATOR_MOD = new URL('../bin/lib/estimator.js', import.meta.url).href;

interface EstimateRow { step: string; inputTokens: number; outputTokens: number; usd: number; }
interface EstimateResult { rows: EstimateRow[]; totalUsd: number; exceedsHalfCap: boolean; }
type ProjectEstimate = (args: { paperRoot: string; sessionCapUsd?: number }) => Promise<EstimateResult>;

async function loadProject(): Promise<ProjectEstimate> {
  const mod = (await import(ESTIMATOR_MOD)) as { projectEstimate: ProjectEstimate };
  return mod.projectEstimate;
}

function freshRoot(): string {
  return mkdtempSync(join(tmpdir(), 'pensmith-estimator-'));
}

function writeState(root: string, sections: Array<{ n: number; slug: string }>): void {
  writeFileSync(
    join(root, 'STATE.json'),
    JSON.stringify({
      $schemaVersion: 2,
      paperId: 'estimator-test',
      createdAt: new Date().toISOString(),
      sections,
    }),
  );
}

// --- RED-by-skip presence guard ---
test('ERGO-02: estimator module presence is consistent with Wave-0 RED state', () => {
  if (built) {
    assert.ok(built, 'bin/lib/estimator.ts present — behavioral tests active');
  } else {
    assert.ok(!built, 'Wave-0: bin/lib/estimator.ts absent (RED-by-skip)');
  }
});

// === Shape + totalUsd arithmetic ===
test('ERGO-02: projectEstimate returns { rows, totalUsd, exceedsHalfCap } with totalUsd === sum(row.usd)',
  { skip: !built }, async () => {
    const projectEstimate = await loadProject();
    const root = freshRoot();
    writeState(root, [{ n: 1, slug: 'intro' }, { n: 2, slug: 'methods' }]);
    const res = await projectEstimate({ paperRoot: root, sessionCapUsd: 100 });
    assert.ok(Array.isArray(res.rows), 'ERGO-02: rows must be an array');
    assert.equal(typeof res.totalUsd, 'number', 'ERGO-02: totalUsd must be a number');
    assert.equal(typeof res.exceedsHalfCap, 'boolean', 'ERGO-02: exceedsHalfCap must be a boolean');
    const sum = res.rows.reduce((acc, r) => acc + r.usd, 0);
    assert.ok(Math.abs(res.totalUsd - sum) < 1e-9,
      `ERGO-02: totalUsd (${res.totalUsd}) must equal the sum of row.usd (${sum})`);
    for (const r of res.rows) {
      for (const k of ['step', 'inputTokens', 'outputTokens', 'usd']) {
        assert.ok(k in r, `ERGO-02: each EstimateRow must carry "${k}" (got ${Object.keys(r).join(', ')})`);
      }
    }
  });

// === ERGO-03: exceedsHalfCap predicate arithmetic — over the 50% cap ===
test('ERGO-03: exceedsHalfCap === true when totalUsd > sessionCapUsd * 0.5',
  { skip: !built }, async () => {
    const projectEstimate = await loadProject();
    const root = freshRoot();
    // Many sections drive the projection up; a tiny cap forces over-50%.
    writeState(root, Array.from({ length: 20 }, (_, i) => ({ n: i + 1, slug: `s${i + 1}` })));
    const res = await projectEstimate({ paperRoot: root, sessionCapUsd: 0.0001 });
    assert.equal(res.exceedsHalfCap, res.totalUsd > 0.0001 * 0.5,
      'ERGO-03: exceedsHalfCap must equal (totalUsd > sessionCapUsd * 0.5)');
    assert.equal(res.exceedsHalfCap, true,
      'ERGO-03: a tiny cap against a real projection must trip exceedsHalfCap');
  });

// === ERGO-03: exceedsHalfCap predicate arithmetic — under the 50% cap ===
test('ERGO-03: exceedsHalfCap === false when totalUsd <= sessionCapUsd * 0.5',
  { skip: !built }, async () => {
    const projectEstimate = await loadProject();
    const root = freshRoot();
    writeState(root, [{ n: 1, slug: 'intro' }]);
    const res = await projectEstimate({ paperRoot: root, sessionCapUsd: 1_000_000 });
    assert.equal(res.exceedsHalfCap, res.totalUsd > 1_000_000 * 0.5,
      'ERGO-03: exceedsHalfCap must equal (totalUsd > sessionCapUsd * 0.5)');
    assert.equal(res.exceedsHalfCap, false,
      'ERGO-03: a huge cap must NOT trip exceedsHalfCap (no false refusal)');
  });

// === T-07-03: projection must not bill — no COSTS.jsonl written ===
test('T-07-03 / ERGO-02: projectEstimate does NOT write .paper/COSTS.jsonl (no real LLM/network)',
  { skip: !built }, async () => {
    const projectEstimate = await loadProject();
    const root = freshRoot();
    writeState(root, [{ n: 1, slug: 'intro' }, { n: 2, slug: 'methods' }]);
    process.env['PENSMITH_DRY_RUN'] = '1';
    try {
      await projectEstimate({ paperRoot: root, sessionCapUsd: 100 });
    } finally {
      delete process.env['PENSMITH_DRY_RUN'];
    }
    assert.ok(
      !existsSync(join(root, '.paper', 'COSTS.jsonl')),
      'T-07-03: projection is a pure cost forecast — it must NEVER append to COSTS.jsonl',
    );
  });

// === C2-H1: paper-less dir → empty projection, never throws ===
test('ERGO-02 / C2-H1: projectEstimate on a paper-less dir → empty projection, no throw',
  { skip: !built }, async () => {
    const projectEstimate = await loadProject();
    const root = freshRoot(); // no STATE.json
    let res: EstimateResult | undefined;
    await assert.doesNotReject(
      async () => { res = await projectEstimate({ paperRoot: root, sessionCapUsd: 100 }); },
      'C2-H1: a paper-less dir must NOT crash projectEstimate (StateNotFoundError caught)',
    );
    assert.notEqual(res, undefined, 'C2-H1: result must be defined');
    assert.deepEqual(res!.rows, [], 'C2-H1: paper-less dir yields an empty rows projection');
    assert.equal(res!.totalUsd, 0, 'C2-H1: paper-less dir yields totalUsd 0');
    assert.equal(res!.exceedsHalfCap, false, 'C2-H1: paper-less dir is under-cap (no refusal)');
  });

// === C4-HIGH: invalid-JSON STATE.json → empty projection, never throws ===
test('ERGO-02 / C4-HIGH: invalid-JSON STATE.json → empty projection, no throw (same as fresh dir)',
  { skip: !built }, async () => {
    const projectEstimate = await loadProject();
    const root = freshRoot();
    mkdirSync(join(root, '.paper'), { recursive: true });
    writeFileSync(join(root, '.paper', 'STATE.json'), '{ not json');
    let res: EstimateResult | undefined;
    await assert.doesNotReject(
      async () => { res = await projectEstimate({ paperRoot: root, sessionCapUsd: 100 }); },
      'C4-HIGH: a present-but-corrupt STATE.json must behave like a missing one (no throw)',
    );
    assert.notEqual(res, undefined, 'C4-HIGH: result must be defined');
    assert.deepEqual(res!.rows, [], 'C4-HIGH: corrupt STATE.json yields an empty rows projection');
    assert.equal(res!.totalUsd, 0, 'C4-HIGH: corrupt STATE.json yields totalUsd 0');
    assert.equal(res!.exceedsHalfCap, false,
      'C4-HIGH: corrupt STATE.json is under-cap so --yolo/--estimate does not crash');
  });

// === C4-HIGH: schema-invalid STATE.json → empty projection, never throws ===
test('ERGO-02 / C4-HIGH: schema-invalid STATE.json (section missing slug) → empty projection, no throw',
  { skip: !built }, async () => {
    const projectEstimate = await loadProject();
    const root = freshRoot();
    writeFileSync(
      join(root, 'STATE.json'),
      JSON.stringify({
        $schemaVersion: 2,
        paperId: 'p',
        createdAt: new Date().toISOString(),
        sections: [{ n: 1 }],
      }),
    );
    let res: EstimateResult | undefined;
    await assert.doesNotReject(
      async () => { res = await projectEstimate({ paperRoot: root, sessionCapUsd: 100 }); },
      'C4-HIGH: a schema-invalid STATE.json must NOT crash projectEstimate (no throw)',
    );
    assert.notEqual(res, undefined, 'C4-HIGH: result must be defined');
    assert.deepEqual(res!.rows, [], 'C4-HIGH: schema-invalid STATE.json yields an empty rows projection');
    assert.equal(res!.exceedsHalfCap, false, 'C4-HIGH: schema-invalid STATE.json is under-cap');
  });

// === Only the work still to do, priced with the configured model ===
//
// The projection used to add research, outline, plan/write/verify for every
// section and compile and done, whatever was already finished and whatever
// verb was asked for, priced at a retired model. `pensmith done --yolo` on any
// seven-section paper was refused before it ran, though done makes one
// advisory pass.

function paperWith(statuses: string[]): string {
  const root = freshRoot();
  writeState(root, statuses.map((_, i) => ({ n: i + 1, slug: `s${i + 1}` })));
  mkdirSync(join(root, '.paper'), { recursive: true });
  // The outline is the section list the estimator walks.
  writeFileSync(join(root, '.paper', 'OUTLINE.md'), [
    '# Outline', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |',
    ...statuses.map((_, i) => `| ${i + 1} | s${i + 1} | S${i + 1} | | 300 | |`), '',
  ].join('\n'));
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 2, researched_at: '2026-11-01T00:00:00Z', items: [] }));
  statuses.forEach((status, i) => {
    const plan = sectionPlan(i + 1, `s${i + 1}`, root);
    mkdirSync(dirname(plan), { recursive: true });
    writeFileSync(plan, `---\nsection: ${i + 1}\nslug: s${i + 1}\nstatus: ${status}\n---\n`);
  });
  return root;
}

test('estimate: `done` on a finished seven-section paper costs only its own pass and is under half the cap',
  { skip: !built }, async () => {
    const projectEstimate = await loadProject();
    const root = paperWith(Array.from({ length: 7 }, () => 'verified'));
    const res = await projectEstimate({ paperRoot: root, sessionCapUsd: 5, verb: 'done' } as never);
    assert.deepEqual(res.rows.map((r) => r.step), ['done']);
    assert.equal(res.exceedsHalfCap, false);
  });

test('estimate: a bare run counts only the sections still to finish', { skip: !built }, async () => {
  const projectEstimate = await loadProject();
  const root = paperWith(['verified', 'verified', 'written', 'writing']);
  const res = await projectEstimate({ paperRoot: root, sessionCapUsd: 5 });
  assert.deepEqual(res.rows.map((r) => r.step), ['verify §3', 'write §4', 'verify §4', 'done']);
});

test('estimate: a failed or unverifiable section is priced as the step the router sends it to', { skip: !built }, async () => {
  // A failed section was priced as verify, but the router sends it to
  // plan --revise (a citation revise can repair), write --force (a draft
  // with nothing to check), verify (a registry did not answer) or to the
  // person; an unverifiable one it compiles with a warning.
  const projectEstimate = await loadProject();
  const root = paperWith(['failed', 'failed', 'failed', 'failed', 'unverifiable']);
  const record = (n: number, draft: string, spec: Record<string, unknown>): void => {
    const dir = dirname(sectionPlan(n, `s${n}`, root));
    writeFileSync(join(dir, 'DRAFT.md'), draft);
    writeVerificationFixture(dir, { n, slug: `s${n}`, draft, ...spec });
  };
  record(1, 'A claim [@ghost2020].\n', { citations: [{ citekey: 'ghost2020', verdict: 'FABRICATED' }] });
  record(2, '[PENSMITH_NO_LLM placeholder]\n', { status: 'failed', checked: false, reason: 'the draft is placeholder text' });
  record(3, 'A claim [@slow2020].\n', { citations: [{ citekey: 'slow2020', verdict: 'UNRESOLVED', retryable: true }] });
  record(4, 'A claim (Smith, 2020).\n', { citations: [{ citekey: 'Smith, 2020', verdict: 'RAW_CITATION' }] });
  record(5, 'He wrote "a long quotation of more than ten words that no source can confirm for us".\n', {
    status: 'unverifiable', citations: [], quotes: [{ citekey: '', quote: 'a long quotation of more than ten words that no source can confirm for us', verdict: 'UNATTRIBUTED' }],
  });
  const res = await projectEstimate({ paperRoot: root, sessionCapUsd: 5 });
  assert.deepEqual(res.rows.map((r) => r.step), ['revise §1', 'verify §1', 'write §2', 'verify §2', 'verify §3', 'done']);
});

test('estimate: a wave write counts only the sections that still need drafting; compile costs nothing',
  { skip: !built }, async () => {
    const projectEstimate = await loadProject();
    const root = paperWith(['verified', 'writing', 'planned']);
    const write = await projectEstimate({ paperRoot: root, sessionCapUsd: 5, verb: 'write' } as never);
    assert.deepEqual(write.rows.map((r) => r.step), ['write §2', 'write §3']);
    const compile = await projectEstimate({ paperRoot: root, sessionCapUsd: 5, verb: 'compile' } as never);
    assert.deepEqual(compile.rows, []);
  });

test('estimate: steps are priced with the model runtime.json configures', { skip: !built }, async () => {
  const projectEstimate = await loadProject();
  const root = paperWith(['planned']);
  const savedXdg = process.env['XDG_DATA_HOME'];
  const savedHome = process.env['HOME'];
  const savedLad = process.env['LOCALAPPDATA'];
  const data = mkdtempSync(join(tmpdir(), 'pensmith-estimator-data-'));
  process.env['XDG_DATA_HOME'] = data;
  process.env['HOME'] = data;
  process.env['LOCALAPPDATA'] = data;
  try {
    const byDefault = await projectEstimate({ paperRoot: root, sessionCapUsd: 5, verb: 'write', n: 1 } as never);
    const dir = pensmithDataDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'runtime.json'), JSON.stringify({ $schemaVersion: 1, providers: { anthropic: { name: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY', defaultModel: 'claude-haiku-5-5' } } }));
    const configured = await projectEstimate({ paperRoot: root, sessionCapUsd: 5, verb: 'write', n: 1 } as never);
    const heur = configured.rows[0]!;
    assert.equal(heur.step, 'write §1');
    assert.ok(Math.abs(heur.usd - estimateCost({ provider: 'anthropic', modelId: 'claude-haiku-5-5', inputTokens: heur.inputTokens, outputTokens: heur.outputTokens })) < 1e-12);
    assert.ok(Math.abs(byDefault.rows[0]!.usd - estimateCost({ provider: 'anthropic', modelId: 'claude-opus-5-5', inputTokens: heur.inputTokens, outputTokens: heur.outputTokens })) < 1e-12);
  } finally {
    if (savedXdg === undefined) delete process.env['XDG_DATA_HOME']; else process.env['XDG_DATA_HOME'] = savedXdg;
    if (savedHome === undefined) delete process.env['HOME']; else process.env['HOME'] = savedHome;
    if (savedLad === undefined) delete process.env['LOCALAPPDATA']; else process.env['LOCALAPPDATA'] = savedLad;
  }
});

test('the --yolo pre-flight does not run when no model is called (stub mode or offline)', async () => {
  const { shouldRunYoloCapPreflight } = await import('../bin/pensmith.js');
  for (const [k, v] of [['PENSMITH_NO_LLM', '1'], ['PENSMITH_OFFLINE', '1']] as const) {
    const saved = process.env[k];
    process.env[k] = v;
    try {
      assert.equal(shouldRunYoloCapPreflight(['write', '--yolo']), false, `${k}=1 makes no paid call`);
    } finally {
      if (saved === undefined) delete process.env[k]; else process.env[k] = saved;
    }
  }
});

test('`pensmith done --yolo` on a finished seven-section paper is not refused by the pre-flight', { skip: !built }, () => {
  const root = paperWith(Array.from({ length: 7 }, () => 'verified'));
  const r = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url)), 'done', '--yolo'], {
    cwd: root,
    env: isolatedCliEnv({ PENSMITH_NO_LLM: undefined, PENSMITH_OFFLINE: undefined, PENSMITH_COST_CAP_USD: undefined }),
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.doesNotMatch(r.stderr, /--yolo estimate exceeds/, `stderr=${r.stderr}`);
});

// === Each planned row is priced from its own runtime.json read ===
//
// projectEstimate resolves the configured model once for every row it prices,
// so `--estimate` (and the --yolo pre-flight) leaves one runtime.load record in
// the paper's session log per row. A behaviour-preserving cleanup once cached
// the price per step, which cut a ten-section estimate's 33 records to 6.
test('`pensmith --estimate` reads runtime.json once for every row it prices', { skip: !built }, () => {
  const root = freshRoot();
  writeState(root, Array.from({ length: 10 }, (_, i) => ({ n: i + 1, slug: `sec-${i + 1}` })));
  mkdirSync(join(root, '.paper'), { recursive: true });
  // The sections are the outline's: ten of them, none planned yet.
  writeFileSync(join(root, '.paper', 'OUTLINE.md'), [
    '# Outline', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |',
    ...Array.from({ length: 10 }, (_, i) => `| ${i + 1} | sec-${i + 1} | Section ${i + 1} | | 300 | |`), '',
  ].join('\n'));
  try {
    const r = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url)), '--estimate'], {
      cwd: root,
      env: isolatedCliEnv({
        ANTHROPIC_API_KEY: undefined,
        PENSMITH_COST_CAP_USD: undefined,
        PENSMITH_DRY_RUN: undefined,
        PENSMITH_TEST_CASSETTES: undefined,
      }),
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.equal(r.status, 0, `stdout=${r.stdout} stderr=${r.stderr}`);
    const rows = r.stdout.split('\n').filter((l) => / in=\d+ out=\d+ → \$/.test(l));
    // research, plan/write/verify for each of the ten sections, done.
    assert.equal(rows.length, 32, r.stdout);
    const log = readFileSync(join(root, '.paper', 'SESSION.log'), 'utf8');
    const loads = log.split('\n').filter((l) => l.includes('"event":"runtime.load"'));
    assert.equal(loads.length, rows.length, `one runtime.load per priced row\n${log}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
