// tests/estimator.test.ts — ERGO-02 / ERGO-03, updated for Phase 17 (RUN-20,
// RUN-26, D-17-26, D-17-27).
//
// Contract (bin/lib/estimator.ts):
//   projectEstimate({ paperRoot, sessionCapUsd?, from? })
//     → { rows, totalUsd, capUsd, exceedsCap, nothingLeft, … }
//   - totalUsd === sum of row.usd
//   - exceedsCap === (totalUsd > cap). Superseded: the v0.1 ERGO-03
//     `exceedsHalfCap` (50% heuristic) refused the default §15 paper; the
//     --yolo pre-flight now compares against the cap itself (D-17-27).
//   - C2-H1 (updated by RUN-20): a paper-less dir never throws and projects the
//     WHOLE pipeline from the assignment / length target (it used to be empty).
//   - C4-HIGH: a present-but-corrupt or schema-invalid STATE.json never throws
//     and is treated like "no sections registered yet" (same as a fresh dir).
//   - T-07-03: projection never bills (no COSTS.jsonl) and never dials.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox, type LlmSandbox } from './helpers/llm-sandbox.js';
import {
  MIN_P90_SAMPLES,
  p90,
  parseLengthWords,
  projectEstimate,
  sectionCountForLength,
  draftAdvisoryWork,
  plannedAdvisoryWork,
  verifyCallsFor,
  WORDS_PER_PARAGRAPH,
} from '../bin/lib/estimator.js';
import { initSection, initState } from '../bin/lib/state.js';
import { writePlan } from './helpers/paper-cli-harness.js';

async function twoSectionPaper(sb: LlmSandbox): Promise<void> {
  await initState(sb.root);
  fs.writeFileSync(path.join(sb.paper, 'INTAKE.md'), 'Topic: t\n');
  fs.writeFileSync(path.join(sb.paper, 'LIBRARY.json'), '{"$schemaVersion":1,"entries":[]}');
  await initSection(sb.root, 1, 'intro');
  await initSection(sb.root, 2, 'methods');
}

test('ERGO-02: projectEstimate returns rows + totalUsd === sum(row.usd) + the cap verdict', async () => {
  await withLlmSandbox({}, async (sb) => {
    await twoSectionPaper(sb);
    const res = await projectEstimate({ paperRoot: sb.root, sessionCapUsd: 100 });
    assert.ok(Array.isArray(res.rows) && res.rows.length > 0);
    const sum = res.rows.reduce((acc, r) => acc + r.usd, 0);
    assert.ok(Math.abs(res.totalUsd - sum) < 1e-9, `totalUsd ${res.totalUsd} === sum ${sum}`);
    for (const r of res.rows) {
      for (const k of ['step', 'inputTokens', 'outputTokens', 'usd']) assert.ok(k in r, `row carries "${k}"`);
    }
    assert.deepEqual(res.rows.map((r) => r.step), ['plan §1', 'write §1', 'verify §1', 'plan §2', 'write §2', 'verify §2', 'compile', 'done']);
    // Not drafted yet: the 1,500-word default over two sections, at the discipline band's highest density (3 per paragraph).
    const verify = res.rows.find((r) => r.step === 'verify §1')!;
    const planned = plannedAdvisoryWork(750, 0, 3);
    assert.deepEqual(planned, { pairs: 3 * Math.ceil(750 / WORDS_PER_PARAGRAPH), paragraphs: Math.ceil(750 / WORDS_PER_PARAGRAPH) });
    assert.deepEqual(verify.calls.map((c) => [c.slug, c.calls]), verifyCallsFor(planned));
    // done audits the whole paper: one orphan-label call per paragraph.
    const done = res.rows.find((r) => r.step === 'done')!;
    assert.deepEqual(done.calls.map((c) => [c.slug, c.calls]), [['orphan-label', 2 * planned.paragraphs]]);
    assert.ok(done.usd > 0, 'done is priced (whole-paper Pass 4)');
    assert.equal(res.capUsd, 100);
    assert.equal(res.sectionSource, 'state');
  });
});

test('ERGO-03 (D-17-27): exceedsCap compares with the cap itself, not 50% of it', async () => {
  await withLlmSandbox({}, async (sb) => {
    await twoSectionPaper(sb);
    const probe = await projectEstimate({ paperRoot: sb.root, sessionCapUsd: 1_000 });
    const total = probe.totalUsd;
    assert.ok(total > 0);
    // Between 50% and 100% of the cap: the old heuristic refused; now it does not.
    const between = await projectEstimate({ paperRoot: sb.root, sessionCapUsd: total * 1.5 });
    assert.equal(between.exceedsCap, false, 'a projection at 67% of the cap is not refused');
    const over = await projectEstimate({ paperRoot: sb.root, sessionCapUsd: total * 0.9 });
    assert.equal(over.exceedsCap, true, 'a projection above the cap is');
    const exact = await projectEstimate({ paperRoot: sb.root, sessionCapUsd: total });
    assert.equal(exact.exceedsCap, false, 'exactly at the cap fits');
  });
});

test('ERGO-03: the cap defaults to [budget] cost_cap_usd / $5 when not passed', async () => {
  await withLlmSandbox({}, async (sb) => {
    await twoSectionPaper(sb);
    assert.equal((await projectEstimate({ paperRoot: sb.root })).capUsd, 5);
    sb.writePaperConfig('schema_version = 1\n[budget]\ncost_cap_usd = 9\n');
    assert.equal((await projectEstimate({ paperRoot: sb.root })).capUsd, 9);
  });
});

test('T-07-03 / ERGO-02: projection never bills (no COSTS.jsonl) and never dials the model', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test-estimator-0001' } }, async (sb) => {
    await twoSectionPaper(sb);
    await projectEstimate({ paperRoot: sb.root, sessionCapUsd: 100 });
    assert.equal(fs.existsSync(path.join(sb.paper, 'COSTS.jsonl')), false);
    assert.equal(sb.mock!.requests.length, 0);
  });
});

test('ERGO-02 / C2-H1 (RUN-20): a paper-less dir never throws and projects the whole pipeline', async () => {
  await withLlmSandbox({ paper: false }, async (sb) => {
    fs.writeFileSync(path.join(sb.root, 'assignment.md'), 'A 2,500 words essay on tides.\n');
    const res = await projectEstimate({ paperRoot: sb.root, sessionCapUsd: 100 });
    assert.equal(res.sectionSource, 'derived');
    assert.equal(res.lengthWords, 2500);
    assert.equal(res.sectionCount, 5);
    const steps = res.rows.map((r) => r.step);
    for (const s of ['new', 'research', 'outline', 'plan §5', 'write §5', 'verify §5', 'compile', 'done']) assert.ok(steps.includes(s), s);
    assert.ok(res.totalUsd > 0);
    assert.equal(fs.existsSync(sb.paper), false, 'nothing written');
  });
});

test('ERGO-02 / C4-HIGH: invalid-JSON and schema-invalid STATE.json never throw (treated as no sections)', async () => {
  for (const body of ['{ not json', JSON.stringify({ $schemaVersion: 2, paperId: 'p', createdAt: new Date().toISOString(), sections: [{ n: 1 }] })]) {
    await withLlmSandbox({}, async (sb) => {
      fs.writeFileSync(path.join(sb.paper, 'STATE.json'), body);
      let res: Awaited<ReturnType<typeof projectEstimate>> | undefined;
      await assert.doesNotReject(async () => { res = await projectEstimate({ paperRoot: sb.root, sessionCapUsd: 100 }); });
      assert.equal(res!.sectionSource, 'derived');
      assert.ok(res!.rows.some((r) => r.step === 'outline'), 'projects from the outline on');
      assert.equal(res!.exceedsCap, false);
    });
  }
});

test('RUN-26: p90 is nearest-rank over recorded samples; length parsing and section count clamps', () => {
  assert.equal(MIN_P90_SAMPLES, 5);
  assert.equal(p90([]), null);
  assert.equal(p90([10]), 10);
  assert.equal(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 9);
  assert.equal(p90([5, 1, 4, 2, 3]), 5);
  assert.equal(parseLengthWords('Write a 1500-word literature review'), 1500);
  assert.equal(parseLengthWords('about 2,500 words'), 2500);
  assert.equal(parseLengthWords('8 pages double spaced'), 2200);
  assert.equal(parseLengthWords('no length here'), null);
  assert.equal(sectionCountForLength(500), 3);
  assert.equal(sectionCountForLength(1500), 3);
  assert.equal(sectionCountForLength(3000), 6);
  assert.equal(sectionCountForLength(20_000), 8);
});

test('SRC-08 / SRC-09: the research row is one disambiguator call plus ceil(candidates / 150) evaluator calls from the paper\'s adapter plan', async () => {
  const { researchCalls } = await import('../bin/lib/estimator.js');
  const { estimatedResearchCandidates, evaluatorCallsFor } = await import('../bin/lib/adapter-plan.js');
  await withLlmSandbox({}, async (sb) => {
    fs.writeFileSync(path.join(sb.paper, 'INTAKE.md'), '---\ntopic: attention\ndiscipline: computer-science\n---\n# Intake\n');
    // computer-science: arxiv, semanticscholar, openalex, crossref, pubmed → 10 × 5 × 10 / 2 = 250 candidates → 2 calls.
    assert.equal(estimatedResearchCandidates(10, 5), 250);
    assert.deepEqual(researchCalls(sb.root, {}), [['topic-disambiguator', 1], ['source-evaluator', evaluatorCallsFor(250)]]);
    assert.equal(evaluatorCallsFor(250), 2);
    const res = await projectEstimate({ paperRoot: sb.root, sessionCapUsd: 100 });
    const row = res.rows.find((r) => r.step === 'research')!;
    assert.deepEqual(row.calls.map((c) => [c.slug, c.calls]), [['topic-disambiguator', 1], ['source-evaluator', 2]]);
    const scoped = await projectEstimate({ paperRoot: sb.root, sessionCapUsd: 100, scope: { verb: 'research' } });
    assert.deepEqual(scoped.rows[0]!.calls.map((c) => [c.slug, c.calls]), [['topic-disambiguator', 1], ['source-evaluator', 2]], 'the --estimate research row');
    // allowed_databases narrows the plan: one adapter → 50 candidates → 1 call.
    sb.writePaperConfig('schema_version = 1\n\n[sources]\nallowed_databases = ["openalex"]\n');
    assert.deepEqual(researchCalls(sb.root, {}), [['topic-disambiguator', 1], ['source-evaluator', 1]]);
    // A configured Zotero library joins the plan.
    sb.writePaperConfig('schema_version = 1\n');
    assert.deepEqual(researchCalls(sb.root, { ZOTERO_API_KEY: 'set' }), [['topic-disambiguator', 1], ['source-evaluator', evaluatorCallsFor(estimatedResearchCandidates(10, 6))]]);
  });
});

test('GRND-17: `plan N --research` is priced as the section research pass — evaluator calls over its two queries, the planner only with --revise', async () => {
  const { sectionResearchCalls, SECTION_RESEARCH_QUERIES } = await import('../bin/lib/estimator.js');
  const { estimatedResearchCandidates, evaluatorCallsFor } = await import('../bin/lib/adapter-plan.js');
  await withLlmSandbox({}, async (sb) => {
    fs.writeFileSync(path.join(sb.paper, 'INTAKE.md'), '---\ntopic: attention\ndiscipline: computer-science\n---\n# Intake\n');
    assert.equal(SECTION_RESEARCH_QUERIES, 2);
    const evaluator = Math.max(1, evaluatorCallsFor(estimatedResearchCandidates(2, 5)));
    assert.deepEqual(sectionResearchCalls(sb.root, {}), [['source-evaluator', evaluator]]);
    const research = await projectEstimate({ paperRoot: sb.root, sessionCapUsd: 100, scope: { verb: 'plan', section: 2, research: true } });
    assert.equal(research.rows.length, 1);
    assert.equal(research.rows[0]!.step, 'plan §2 --research');
    assert.deepEqual(research.rows[0]!.calls.map((c) => [c.slug, c.calls]), [['source-evaluator', evaluator]], 'no planner call without --revise');
    const revise = await projectEstimate({ paperRoot: sb.root, sessionCapUsd: 100, scope: { verb: 'plan', section: 2, research: true, revise: true } });
    assert.deepEqual(revise.rows[0]!.calls.map((c) => [c.slug, c.calls]), [['source-evaluator', evaluator], ['section-planner', 1]]);
    const plain = await projectEstimate({ paperRoot: sb.root, sessionCapUsd: 100, scope: { verb: 'plan', section: 2 } });
    assert.deepEqual(plain.rows[0]!.calls.map((c) => [c.slug, c.calls]), [['section-planner', 1]], 'a plain plan is the planner call');
  });
});

test('D-20-28 / D-20-29 (review round 2): a drafted section\'s verify is priced from its draft — one claim-support call per (citing sentence, key) pair, one orphan-label call per paragraph; done from the compiled paper', async () => {
  await withLlmSandbox({}, async (sb) => {
    await twoSectionPaper(sb);
    const draft = [
      '# Intro',
      '',
      'Trees cool cities [@a; @b]. Shade lowers heat [@a]. Canopy matters [@c, p. 4].',
      '',
      'A second paragraph with one claim [@b] and a quiet sentence.',
      '',
    ].join('\n');
    const dir = path.dirname(writePlan(sb.root, 1, 'intro', { status: 'written', assigned_sources: '[a, b, c]' }));
    fs.writeFileSync(path.join(dir, 'DRAFT.md'), draft);
    const work = draftAdvisoryWork(draft);
    assert.deepEqual(work, { pairs: 5, paragraphs: 2 }, 'a, b | a | c | b — the (sentence, key) pairs; two prose paragraphs');
    const res = await projectEstimate({ paperRoot: sb.root, sessionCapUsd: 100 });
    const verify = res.rows.find((r) => r.step === 'verify §1')!;
    assert.deepEqual(verify.calls.map((c) => [c.slug, c.calls]), verifyCallsFor(work));
    assert.ok(!res.rows.some((r) => r.step === 'write §1'), 'the written section is not re-priced');
    // A compiled paper: done's audit counts its paragraphs.
    fs.writeFileSync(path.join(sb.paper, 'DRAFT.md'), `${draft}\nOne more paragraph [@c].\n`);
    const compiled = await projectEstimate({ paperRoot: sb.root, sessionCapUsd: 100 });
    assert.deepEqual(compiled.rows.find((r) => r.step === 'done')!.calls.map((c) => [c.slug, c.calls]), [['orphan-label', 3]]);
    assert.ok(!compiled.rows.some((r) => r.step === 'compile'), 'compiled already');
  });
});
