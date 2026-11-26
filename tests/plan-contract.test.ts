// tests/plan-contract.test.ts — the plan comes back as data and code writes PLAN.md.
//
// The section-planner prompt showed a PLAN.md whose frontmatter used number,
// state and estimated_word_count (inside a ```yaml fence), while the schema
// needs section and status; plan.ts saved the model's text as it came, so a
// prompt-compliant plan lost its frontmatter or made wave-mode write abort the
// whole paper with a ZodError. Now the planner returns JSON to a schema, code
// checks it and writes the frontmatter from the outline, and one bad PLAN.md
// fails only its own section.

import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _setGeneratorForTest, type Generator } from '../bin/lib/anthropic.js';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';
import { PlanFrontmatterSchema } from '../bin/lib/schemas/plan-frontmatter.js';
import { writeOutline, type Outline } from '../bin/lib/outline-store.js';
import { initState } from '../bin/lib/state.js';
import { resolveNextAction } from '../bin/lib/router.js';
import { isolatedCliEnv } from './lib/cli-env.js';

const OUTLINE: Outline = {
  title: 'Social Media and Adolescent Anxiety',
  thesis: 'The association is real; the causal case is weak.',
  sections: [
    { n: 1, slug: 'introduction', title: 'Introduction', purpose: 'Frame the question.', depends_on: [], word_target: 300, assigned_sources: [], counterargument: false },
    { n: 2, slug: 'evidence', title: 'What the Evidence Shows', purpose: 'Survey the cohort studies.', depends_on: ['introduction'], word_target: 900, assigned_sources: ['smith2020'], counterargument: false },
  ],
};

const BRIEF = 'This section sets out what the longitudinal evidence shows and what it cannot show, from the cohort studies that link heavy use to anxiety symptoms to the analyses that control for prior anxiety, where the association shrinks.';

const PLAN = {
  assigned_sources: ['smith2020', 'lee2021'],
  claims: [
    { claim: 'Cohort studies find a modest association.', sources: ['smith2020'] },
    { claim: 'It weakens once prior anxiety is controlled for.', sources: ['lee2021'] },
  ],
  brief: BRIEF,
  voice: 'measured, precise',
};

async function paper(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-plan-contract-'));
  const pdir = join(root, '.paper');
  mkdirSync(pdir, { recursive: true });
  await initState(root);
  writeFileSync(join(pdir, 'LIBRARY.json'), JSON.stringify({
    $schemaVersion: 2,
    researched_at: '2026-11-01T00:00:00.000Z',
    entries: ['smith2020', 'lee2021'].map((id) => ({
      id, type: 'article-journal', title: `A study ${id}`, DOI: `10.1000/${id}`,
      custom: { identities: [`doi:10.1000/${id}`], added_at: '2026-11-01T00:00:00.000Z' },
    })),
  }));
  await writeOutline(root, OUTLINE);
  return root;
}

interface Seen { system: string; messages: Array<{ role: string; content: string }>; schema: unknown }

function answering(answers: unknown[], seen: Seen[]): Generator {
  return {
    async generate(req) {
      seen.push({ system: req.system, messages: req.messages.map((m) => ({ ...m })), schema: req.jsonSchema });
      return {
        text: JSON.stringify(answers.shift()),
        model: req.model, stop: 'complete', stopReason: 'end_turn',
        usage: [{ model: req.model, inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }],
      };
    },
  };
}

let prevCwd = '';
const ENV = ['PENSMITH_NO_LLM', 'ANTHROPIC_API_KEY', 'PENSMITH_OFFLINE'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  prevCwd = process.cwd();
  for (const k of ENV) saved[k] = process.env[k];
  delete process.env['PENSMITH_NO_LLM'];
  delete process.env['PENSMITH_OFFLINE'];
  process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-not-sent';
});
afterEach(() => {
  _setGeneratorForTest(null);
  process.chdir(prevCwd);
  process.exitCode = 0;
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function runPlan(root: string, n: number): Promise<Record<string, unknown>> {
  const { planCommand } = await import('../bin/cli/plan.js');
  process.chdir(root);
  const res = (await (planCommand.run as (c: { args: Record<string, unknown> }) => Promise<Record<string, unknown>>)({ args: { n, yolo: true } })) ?? {};
  return { ...res, exitCode: process.exitCode ?? 0 };
}

const planFile = (root: string, dir: string): string => join(root, '.paper', 'sections', dir, 'PLAN.md');

test('the planner\'s JSON becomes a PLAN.md whose frontmatter code wrote from the outline', async () => {
  const root = await paper();
  const seen: Seen[] = [];
  _setGeneratorForTest(answering([PLAN], seen));
  const res = await runPlan(root, 2);
  assert.equal(res['ok'], true, JSON.stringify(res));
  assert.deepEqual(Object.keys((seen[0]!.schema as { properties: object }).properties), ['assigned_sources', 'claims', 'brief', 'voice']);
  const sent = seen[0]!.system;
  assert.match(sent, /What the Evidence Shows/);
  assert.match(sent, /Survey the cohort studies/);
  assert.match(sent, /lee2021/);

  const text = readFileSync(planFile(root, '02-evidence'), 'utf8');
  const { frontmatter, body } = parseFrontmatter(text);
  const fm = PlanFrontmatterSchema.parse(frontmatter);
  assert.deepEqual(
    { section: fm.section, slug: fm.slug, title: fm.title, depends_on: fm.depends_on, status: fm.status, assigned_sources: fm.assigned_sources },
    { section: 2, slug: 'evidence', title: 'What the Evidence Shows', depends_on: ['introduction'], status: 'planned', assigned_sources: ['smith2020', 'lee2021'] },
  );
  assert.match(body, /^## Brief\n\nThis section sets out/m);
  assert.match(body, /^Voice: measured, precise$/m);
  assert.match(body, /^- It weakens once prior anxiety is controlled for\. \(sources: lee2021\)$/m);
});

test('a plan that cites outside the library is repaired once, then refused with exit 2, the stub left as it was', async () => {
  const root = await paper();
  const stub = readFileSync(planFile(root, '02-evidence'), 'utf8');
  const bad = { ...PLAN, assigned_sources: ['smith2020', 'made2024up'], claims: [{ claim: 'x', sources: ['nowhere'] }] };
  const seen: Seen[] = [];
  _setGeneratorForTest(answering([bad, bad], seen));
  const res = await runPlan(root, 2);
  assert.equal(res['exitCode'], 2, JSON.stringify(res));
  assert.equal(seen.length, 2);
  assert.match(seen[1]!.messages.at(-1)!.content, /made2024up/);
  assert.match(seen[1]!.messages.at(-1)!.content, /nowhere/);
  assert.equal(readFileSync(planFile(root, '02-evidence'), 'utf8'), stub);
  assert.equal((await resolveNextAction(root)).verb, 'plan');
});

test('a wave write fails only the section whose PLAN.md does not parse, and drafts the others', async () => {
  const root = await paper();
  // Section 1 planned; section 2's PLAN.md in the shape the old prompt showed.
  writeFileSync(planFile(root, '01-introduction'), '---\nsection: 1\nslug: introduction\ntitle: Introduction\nstatus: planned\nassigned_sources: []\n---\n## Brief\n\nOpen it.\n');
  writeFileSync(planFile(root, '02-evidence'), '---\nnumber: 2\nslug: 02-evidence\nstate: planned\n---\n## Brief\n\nx\n');
  const r = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url)), 'write', '--max-parallel', '1'], {
    cwd: root, env: isolatedCliEnv({ PENSMITH_NO_LLM: '1' }), encoding: 'utf8',
  });
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /section 2 \(evidence\)[\s\S]*PLAN\.md/);
  assert.doesNotMatch(r.stderr, /ZodError/);
  assert.ok(existsSync(join(root, '.paper', 'sections', '01-introduction', 'DRAFT.md')), 'the other section is drafted');
});

test('the section-planner prompt\'s own example is a plan the schema and the checks accept', async () => {
  const { loadPrompt } = await import('../bin/lib/prompt-loader.js');
  const { SectionPlanSchema, planProblems } = await import('../bin/cli/plan.js');
  const example = /```json\n([\s\S]*?)\n```/.exec(loadPrompt('section-planner'))?.[1];
  assert.ok(example);
  const plan = SectionPlanSchema.parse(JSON.parse(example));
  assert.deepEqual(planProblems(plan, new Set(plan.assigned_sources)), []);
});
