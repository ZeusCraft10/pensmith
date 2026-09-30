// tests/wave-write-plan-errors.test.ts — GRND-16 / D-18-27: wave write works on
// planner-produced PLAN.md files. It schedules from depends_on (§2 after §1,
// §3 independent → waves {1,3} then {2}) and verifies every draft; a malformed
// PLAN.md is ONE line naming the file and the field (never a ZodError), the
// independent sections still draft, and the command exits non-zero; the
// outline's stubs are skipped with a note; a single `write N` on a stub refuses
// with EXIT_USAGE naming `pensmith plan N`; `--max-parallel 1` prints no
// warning, and the default the docs state equals the code.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox, type LlmSandbox } from './helpers/llm-sandbox.js';
import { seedBriefPaper, threeSectionOutline } from './helpers/section-fixture.js';
import { numberFreshOutline, registerSections } from '../bin/lib/section-stubs.js';
import { renderOutlineMd } from '../bin/lib/outline-parse.js';
import { renderPlannedPlanMd } from '../bin/lib/plan-render.js';
import { DEFAULT_MAX_PARALLEL } from '../bin/cli/write.js';

const KEY = 'sk-test-wave-plan-errors-0001';

/** §1 introduction, §2 background (depends on §1), §3 conclusion (independent); planned unless listed in `stubs`. */
async function paper(sb: LlmSandbox, stubs: readonly string[] = []): Promise<void> {
  await seedBriefPaper(sb.root);
  const outline = threeSectionOutline();
  outline.sections[2]!.depends_on = [];
  const entries = numberFreshOutline(outline.sections);
  fs.writeFileSync(path.join(sb.paper, 'OUTLINE.md'), renderOutlineMd({ thesis: outline.thesis, sections: entries }, 'Attention'));
  await registerSections(sb.root, entries); // stubs for all three
  for (const e of entries) {
    if (stubs.includes(e.slug)) continue;
    fs.writeFileSync(
      path.join(sb.paper, 'sections', `0${e.n}-${e.slug}`, 'PLAN.md'),
      renderPlannedPlanMd(
        // No assigned sources: these cases pin SCHEDULING, and a citation-free
        // draft of a section with assigned sources is NO-CITATIONS (VRFY-24).
        { section: e.n, slug: e.slug, title: e.title, depends_on: e.depends_on, word_target: e.estimated_word_count, assigned_sources: [] },
        { claims: [{ claim: `${e.slug} claim.`, sources: [], evidence: '', counterexamples: '' }], structure: [{ paragraph: 1, purpose: 'p', claims: [1] }], voice: 'Plain.' },
      ),
    );
  }
}

function events(stdout: string): Array<Record<string, unknown>> {
  return stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as Record<string, unknown>);
}

const write = (sb: LlmSandbox, ...args: string[]) => sb.runTsx(null, ['write', ...args], { env: { ANTHROPIC_API_KEY: KEY } });

/**
 * These tests are about scheduling, not citation verification: the fixture's
 * sources carry no DOI and the paper has no CITATIONS.bib, so a draft citing
 * them fails Pass 1 closed (the drafter stub cites every assigned key, D-18-06).
 * The drafter is scripted to a citation-free section — and the planned
 * sections are assigned no source, so a citation-free draft is not
 * NO-CITATIONS (VRFY-24) — so verify's verdict is `verified` and each exit
 * code comes from the scheduling under test.
 */
function citationFreeDrafts(sb: LlmSandbox, count: number): void {
  const text = 'Attention lets a model weigh every position of its input when it builds each output.\n\nThe section explains the idea in plain terms.\n';
  sb.mock!.script('section-drafter', ...Array.from({ length: count }, () => ({ text })));
}

test('GRND-16: waves {1,3} then {2}; every section drafted and verified', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await paper(sb);
    citationFreeDrafts(sb, 3);
    const r = await write(sb, '--yolo');
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const starts = events(r.stdout).filter((e) => e['event'] === 'section_start');
    const byWave = new Map<number, string[]>();
    for (const e of starts) byWave.set(e['wave'] as number, [...(byWave.get(e['wave'] as number) ?? []), e['section'] as string]);
    assert.deepEqual([...byWave.entries()].map(([w, s]) => [w, s.sort()]), [[1, ['conclusion', 'introduction']], [2, ['background']]]);
    for (const e of events(r.stdout).filter((x) => x['event'] === 'section_done')) assert.equal(e['verify'], 'verified');
    for (const d of ['01-introduction', '02-background', '03-conclusion']) {
      assert.ok(fs.existsSync(path.join(sb.paper, 'sections', d, 'VERIFICATION.md')), `${d} verified`);
    }
    assert.doesNotMatch(r.stderr, /max-parallel ignored/);
  });
});

test('GRND-16: a malformed PLAN.md is one line naming the file and the field; independent sections still draft; exit non-zero', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await paper(sb);
    const bad = path.join(sb.paper, 'sections', '01-introduction', 'PLAN.md');
    fs.writeFileSync(bad, fs.readFileSync(bad, 'utf8').replace(/^section: 1$/m, 'number: 1'));
    citationFreeDrafts(sb, 2);
    const r = await write(sb, '--yolo', '--max-parallel', '1');
    assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /^pensmith write: section 1 \(introduction\) skipped — \.paper\/sections\/01-introduction\/PLAN\.md: invalid field "section": Required$/m);
    assert.doesNotMatch(r.stderr, /ZodError|"code":|\bat .*\.[jt]s:\d+/);
    assert.doesNotMatch(r.stderr, /max-parallel ignored/, '--max-parallel 1 prints no warning');
    for (const d of ['02-background', '03-conclusion']) {
      assert.ok(fs.existsSync(path.join(sb.paper, 'sections', d, 'DRAFT.md')), `${d} drafted`);
      assert.match(fs.readFileSync(path.join(sb.paper, 'sections', d, 'PLAN.md'), 'utf8'), /^status: verified$/m, `${d} verified — the non-zero exit is the malformed PLAN.md's`);
    }
    assert.equal(fs.existsSync(path.join(sb.paper, 'sections', '01-introduction', 'DRAFT.md')), false);
  });
});

test('GRND-16: the outline\'s stubs are skipped with a note; a single write on a stub refuses (exit 2) naming plan N', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await paper(sb, ['background']);
    citationFreeDrafts(sb, 2);
    const r = await write(sb, '--yolo');
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /^pensmith write: section 2 \(background\) is not planned yet — skipped; run `pensmith plan 2`$/m);
    assert.equal(fs.existsSync(path.join(sb.paper, 'sections', '02-background', 'DRAFT.md')), false);
    const one = await write(sb, '2');
    assert.equal(one.status, 2, one.stderr);
    assert.match(one.stderr, /^pensmith: section 2 is not planned yet — run `pensmith plan 2` first$/m);
    assert.equal(sb.mock!.callCount('section-drafter'), 2, 'the stub never reached the drafter');
  });
});

test('GRND-16: the documented --max-parallel default equals the code', () => {
  const doc = fs.readFileSync(new URL('../workflows/write.md', import.meta.url), 'utf8');
  const stated = [...doc.matchAll(/--max-parallel`?\s*\(default (\d+)\)/g)].map((m) => Number(m[1]));
  assert.ok(stated.length > 0, 'workflows/write.md states the default');
  for (const n of stated) assert.equal(n, DEFAULT_MAX_PARALLEL);
  assert.equal(DEFAULT_MAX_PARALLEL, 5);
  assert.doesNotMatch(doc, /max-parallel ignored/);
});
