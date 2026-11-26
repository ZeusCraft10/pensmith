// tests/write-refusals.test.ts — when write refuses, what it says to do works.
//
// `pensmith write N` refuses a section that is already drafted (failed
// included) unless --force is given. verify and compile still told the
// author to run a plain `pensmith write N` after failing a section, which
// write then refused. A forced re-draft that was refused set a verified
// section back to 'writing', so a plain write replaced it later. A PLAN.md
// the user broke was reported as "no plan yet; run `pensmith plan N`",
// which plan refuses for a broken PLAN.md. And with no key configured,
// `write abc` reported the missing key (exit 1) instead of the bad input
// (exit 2).

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _setGeneratorForTest, type Generator } from '../bin/lib/anthropic.js';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';
import { writeOutline, type Outline } from '../bin/lib/outline-store.js';
import { renderPlan } from '../bin/lib/plan-store.js';
import { initState } from '../bin/lib/state.js';
import { runWrite, useWriteHarness } from './lib/write-harness.js';
import { runCli } from './lib/export-fixture.js';

const OUTLINE: Outline = {
  title: 'Social Media and Adolescent Anxiety',
  thesis: 'The association is real; the causal case is weak.',
  sections: [
    { n: 1, slug: 'evidence', title: 'What the Evidence Shows', purpose: 'Survey the cohort studies.', depends_on: [], word_target: 400, assigned_sources: ['hayes2020'], counterargument: false },
  ],
};

const BIB =
  '@article{hayes2020,\n  title = {Daily Social Media Use and Anxiety in a Cohort of Adolescents},\n' +
  '  author = {Hayes, A.},\n  year = {2020},\n  doi = {10.1000/hayes2020}\n}\n';

const planFile = (root: string): string => join(root, '.paper', 'sections', '01-evidence', 'PLAN.md');
const draftFile = (root: string): string => join(root, '.paper', 'sections', '01-evidence', 'DRAFT.md');
const statusOf = (root: string): unknown => parseFrontmatter(readFileSync(planFile(root), 'utf8')).frontmatter['status'];

/** A one-section paper whose plan assigns hayes2020, which LIBRARY.json and CITATIONS.bib hold. */
async function paper(status = 'planned', draft: string | null = null): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-write-refusals-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  await initState(root);
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), JSON.stringify({
    $schemaVersion: 2, researched_at: '2026-11-01T00:00:00.000Z',
    entries: [{
      id: 'hayes2020', type: 'article-journal', title: 'Daily Social Media Use and Anxiety in a Cohort of Adolescents',
      author: [{ family: 'Hayes', given: 'A.' }], issued: { 'date-parts': [[2020]] }, 'container-title': 'Journal of Adolescent Health',
      DOI: '10.1000/hayes2020', abstract: 'Daily use predicted later anxiety symptoms.',
      custom: { identities: ['doi:10.1000/hayes2020'], added_at: '2026-11-01T00:00:00.000Z' },
    }],
  }));
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), BIB);
  await writeOutline(root, OUTLINE);
  const s = OUTLINE.sections[0]!;
  const plan = renderPlan(
    { n: s.n, slug: s.slug, title: s.title, depends_on: [], purpose: s.purpose, word_target: s.word_target, assigned_sources: s.assigned_sources },
    { assigned_sources: ['hayes2020'], claims: [{ claim: 'Daily use predicts later anxiety.', sources: ['hayes2020'] }], brief: 'Set out what the cohort studies show, keeping association and causation apart.', voice: 'plain' },
  ).replace('status: planned', `status: ${status}`);
  writeFileSync(planFile(root), plan);
  if (draft !== null) writeFileSync(draftFile(root), draft);
  return root;
}

interface Call { user: string }

/** A drafter that answers with each of `answers` in turn, the last one from then on. */
function drafter(calls: Call[], answers: Array<{ draft: string; gaps: unknown[] }>): Generator {
  return {
    async generate(req) {
      calls.push({ user: req.messages.at(-1)!.content });
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
      return {
        text: JSON.stringify(answer),
        model: req.model, stop: 'complete', stopReason: 'end_turn',
        usage: [{ model: req.model, inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }],
      };
    },
  };
}

const CITED = { draft: 'Daily use predicted later anxiety in a large cohort [@hayes2020].', gaps: [] };

const io = useWriteHarness();

/** The `pensmith write ...` command a message tells the author to run, as write's arguments. */
function advisedWrite(text: string): Record<string, unknown> {
  const m = /[`']pensmith (write \d+(?: --[a-z-]+)*)[`']/.exec(text);
  assert.ok(m, `the message names a write command:\n${text}`);
  const [, n, ...flags] = m[1]!.split(' ');
  return { n, ...Object.fromEntries(flags.map((f) => [f.slice(2), true])) };
}

/** Run the write a message advises, with a drafter that cites the section's source; it must draft the section. */
async function followAdvice(root: string, text: string): Promise<void> {
  const calls: Call[] = [];
  _setGeneratorForTest(drafter(calls, [CITED]));
  const res = await runWrite(root, advisedWrite(text));
  assert.equal(res['exitCode'], 0, `the advised write must work:\n${io.stderr}`);
  assert.equal(calls.length, 1);
  assert.match(readFileSync(draftFile(root), 'utf8'), /\[@hayes2020\]/);
  assert.equal(statusOf(root), 'written');
}

const PLACEHOLDER = '[PENSMITH_NO_LLM placeholder — Write section 1 (evidence).]\n';

for (const [what, draft] of [
  ['cites none of its sources', 'Daily use predicted later anxiety in a large cohort.\n'],
  ['is empty', '\n'],
  ['is placeholder text', PLACEHOLDER],
] as const) {
  test(`verify fails a draft that ${what}, and the write it advises drafts the section again`, async () => {
    const root = await paper('written', draft);
    const v = runCli(['verify', '1'], root);
    assert.equal(v.status, 2, v.stdout + v.stderr);
    assert.equal(statusOf(root), 'failed');
    const verification = readFileSync(join(root, '.paper', 'sections', '01-evidence', 'VERIFICATION.md'), 'utf8');
    await followAdvice(root, verification);
  });
}

test('compile refuses a placeholder draft, and the write it advises drafts the section again', async () => {
  const root = await paper('written', PLACEHOLDER);
  const c = runCli(['compile'], root);
  assert.equal(c.status, 2, c.stdout + c.stderr);
  await followAdvice(root, c.stdout + c.stderr);
});

test('a forced re-draft that is refused leaves a verified section verified, so a plain write still leaves it alone', async () => {
  const kept = 'The author\'s verified draft [@hayes2020].\n';
  const root = await paper('verified', kept);
  const calls: Call[] = [];
  _setGeneratorForTest(drafter(calls, [{ draft: 'Sleep matters too [@park2019].', gaps: [] }]));
  const forced = await runWrite(root, { n: 1, force: true });
  assert.equal(forced['exitCode'], 2, io.stderr);
  assert.equal(calls.length, 2, 'sent back once, then refused');
  assert.equal(readFileSync(draftFile(root), 'utf8'), kept, 'DRAFT.md is unchanged');
  assert.ok(!existsSync(`${draftFile(root)}.bak`));
  assert.equal(statusOf(root), 'verified', 'the status says what DRAFT.md still is');

  process.exitCode = 0;
  const plain = await runWrite(root, { 'max-parallel': '1' });
  assert.equal(plain['exitCode'], 0, io.stderr);
  assert.equal(calls.length, 2, 'a wave write does not draft it again');
  assert.equal(readFileSync(draftFile(root), 'utf8'), kept);
});

for (const [what, text] of [
  ['a lost colon', '---\nsection: 1\nslug: evidence\ntitle: What the Evidence Shows\nstatus planned\nassigned_sources: [hayes2020]\n---\n## Brief\n\nMy own notes.\n'],
  ['a deleted closing ---', '---\nsection: 1\nslug: evidence\nstatus: planned\n## Brief\n\nMy own notes.\n'],
  ['an alias to no anchor', '---\nsection: 1\nslug: evidence\ntitle: T\nstatus: *missing\n---\n## Brief\n\nMy own notes.\n'],
  ['a frontmatter the schema rejects', '---\nsection: 1\nslug: evidence\ntitle: T\nstatus: planned\nassigned_sources: hayes2020\n---\n## Brief\n\nMy own notes.\n'],
] as const) {
  test(`a PLAN.md with ${what} is reported as unusable, with plan --force, in write <n> and in a wave`, async () => {
    const root = await paper();
    writeFileSync(planFile(root), text);
    const calls: Call[] = [];
    _setGeneratorForTest(drafter(calls, [CITED]));

    const one = await runWrite(root, { n: 1 });
    assert.equal(one['exitCode'], 2, io.stderr);
    assert.match(io.stderr, /section 1 \(evidence\).*PLAN\.md cannot be used.*`pensmith plan 1 --force`/);
    assert.doesNotMatch(io.stderr, /no plan yet/);

    io.stderr = '';
    process.exitCode = 0;
    const wave = await runWrite(root, { 'max-parallel': '1' });
    assert.notEqual(wave['exitCode'], 0, io.stderr);
    assert.match(io.stderr, /section 1 \(evidence\).*PLAN\.md cannot be used.*`pensmith plan 1 --force`/);
    assert.doesNotMatch(io.stderr, /no plan yet/);
    assert.equal(calls.length, 0, 'nothing was asked of the model');
    assert.equal(readFileSync(planFile(root), 'utf8'), text, 'the PLAN.md is left as the user wrote it');
  });
}

test('with no key configured, a <n> that is not a section number is still invalid input (exit 2)', async () => {
  const root = await paper();
  for (const bad of ['abc', '0']) {
    const r = runCli(['write', bad], root, { PENSMITH_NO_LLM: '' });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /<n> must be a positive integer/);
    assert.doesNotMatch(r.stderr, /no LLM key configured/);
  }
  // A valid <n> with no key is still the missing key.
  const ok = runCli(['write', '1'], root, { PENSMITH_NO_LLM: '' });
  assert.equal(ok.status, 1, ok.stdout + ok.stderr);
  assert.match(ok.stderr, /no LLM key configured/);
});

test('write refuses a placeholder PLAN.md when a model is configured (exit 2), and advises plan --force', async () => {
  // A PLAN.md written under PENSMITH_NO_LLM holds no plan. With a real model
  // configured, write drafted from it as if it were one.
  const root = await paper();
  const s = OUTLINE.sections[0]!;
  writeFileSync(planFile(root), renderPlan(
    { n: s.n, slug: s.slug, title: s.title, depends_on: [], purpose: s.purpose, word_target: s.word_target, assigned_sources: s.assigned_sources },
    null,
    '[PENSMITH_NO_LLM placeholder — Plan section 1 (evidence).]',
  ));
  const calls: Call[] = [];
  _setGeneratorForTest(drafter(calls, [CITED]));
  for (const args of [{ n: 1 }, { 'max-parallel': '1' }]) {
    io.stderr = '';
    process.exitCode = 0;
    const res = await runWrite(root, args);
    assert.equal(res['exitCode'], 2, `${JSON.stringify(args)}: ${io.stderr}`);
    assert.match(io.stderr, /placeholder/);
    assert.match(io.stderr, /`pensmith plan 1 --force`/);
  }
  assert.equal(calls.length, 0, 'the drafter was never asked');
  assert.ok(!existsSync(draftFile(root)));

  // Under PENSMITH_NO_LLM a placeholder plan still gives a placeholder draft.
  process.env['PENSMITH_NO_LLM'] = '1';
  process.exitCode = 0;
  const offline = await runWrite(root, { n: 1 });
  assert.equal(offline['exitCode'], 0, io.stderr);
  assert.ok(existsSync(draftFile(root)));
});

test('a hand-edited year that is not an integer is left out of the drafter\'s input, and write does not crash', async () => {
  const root = await paper();
  const lib = JSON.parse(readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8')) as { entries: Array<Record<string, unknown>> };
  lib.entries[0]!['issued'] = { 'date-parts': [[2019.5]] };
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), JSON.stringify(lib));
  const systems: string[] = [];
  _setGeneratorForTest({
    async generate(req) {
      systems.push(req.system);
      return {
        text: JSON.stringify(CITED), model: req.model, stop: 'complete', stopReason: 'end_turn',
        usage: [{ model: req.model, inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }],
      };
    },
  });
  const res = await runWrite(root, { n: 1 });
  assert.equal(res['exitCode'], 0, io.stderr);
  assert.equal(systems.length, 1);
  assert.doesNotMatch(systems[0]!, /"year"/);
  assert.match(readFileSync(draftFile(root), 'utf8'), /\[@hayes2020\]/);
});
