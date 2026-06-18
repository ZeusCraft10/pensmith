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
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    writeFileSync(join(root, 'STATE.json'), '{ not json');
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
