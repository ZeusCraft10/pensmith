// tests/gates-plan-research.test.ts — the `plan-research` gate (GRND-17,
// RUN-28, D-19-18): --yolo adds every hit the evaluator kept; a run that
// cannot ask refuses (exit 3) before anything; in a terminal (numbered
// prompts here) the hits are listed with tier and year, known works labelled
// "already in library as <key>", and only the chosen ones reach the section;
// choosing none is the gate's decline (exit 3) with nothing changed.
//
// The real section research runs in a child process (numbered prompts read the
// child's stdin) against the in-process RUN-21 mock LLM, with fake adapters
// injected through the research registry seam by a small driver script.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { withLlmSandbox, type LlmSandbox } from './helpers/llm-sandbox.js';
import { gateDef } from '../bin/lib/gates.js';
import { EXIT_APPROVAL } from '../bin/lib/exit-codes.js';
import { renderIntakeDocument } from '../bin/lib/intake-brief.js';
import { upsertSources } from '../bin/lib/library.js';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';

const KEY = 'sk-test-plan-research-gate-0001';
const repo = (rel: string): string => pathToFileURL(fileURLToPath(new URL(`../${rel}`, import.meta.url))).href;

function hit(n: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: 'crossref', id: `10.5555/gate.${n}`, doi: `10.5555/gate.${n}`,
    title: `Instagram and adolescent depression, cohort ${n}`, authors: [`Cohort${n}, Cam`], year: 2018 + n,
    abstract: `Cohort ${n} links Instagram use to depressive symptoms.`, retracted: false,
    last_verified: '2026-09-28T00:00:00.000Z', citekey: `cohort${n}${2018 + n}`, raw: {}, type: 'article-journal', venue: 'Pediatrics',
    ...extra,
  };
}

async function seed(sb: LlmSandbox): Promise<string> {
  fs.writeFileSync(path.join(sb.paper, 'INTAKE.md'), renderIntakeDocument({ topic: 'social media and adolescent depression', discipline: 'psychology' }, 'x', []));
  fs.writeFileSync(path.join(sb.paper, 'STATE.json'), JSON.stringify({ $schemaVersion: 2, paperId: 'gate', createdAt: '2026-01-01T00:00:00.000Z', sections: [{ n: 1, slug: 'intro' }, { n: 2, slug: 'background' }] }) + '\n');
  fs.writeFileSync(path.join(sb.paper, 'OUTLINE.md'), '# Outline\n\n| # | slug | title | depends_on | word target | assigned_sources |\n| --- | --- | --- | --- | --- | --- |\n| 1 | intro | Introduction |  | 300 |  |\n| 2 | background | Background |  | 300 |  |\n');
  for (const [n, slug, title] of [[1, 'intro', 'Introduction'], [2, 'background', 'Background']] as const) {
    const dir = path.join(sb.paper, 'sections', `0${n}-${slug}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'PLAN.md'), `---\nschema_version: 2\nsection: ${n}\nslug: ${slug}\ntitle: ${title}\ndepends_on: []\nassigned_sources: []\nstatus: planned\nverified_against_draft_hash: null\n---\n\n## Brief\n\nSection ${n}.\n`);
  }
  // A work the library already has (by DOI): hit 2 is it.
  await upsertSources(sb.root, [{ ...hit(2), citekey: 'known2020' }], { provenance: 'research' });
  const file = path.join(sb.root, 'section-driver.mts');
  fs.writeFileSync(
    file,
    [
      `import { __setResearchRegistryForTest } from ${JSON.stringify(repo('bin/lib/research-orchestrator.ts'))};`,
      `import { runSectionResearch } from ${JSON.stringify(repo('bin/lib/section-research.ts'))};`,
      `const hits = ${JSON.stringify([hit(1), hit(2), hit(3)])};`,
      "__setResearchRegistryForTest({ crossref: { search: async (q) => q.endsWith('Background') ? [] : hits } });",
      'try {',
      "  const r = await runSectionResearch({ root: process.cwd(), n: 2, slug: 'background', query: 'instagram adolescent depression', yolo: process.argv.includes('--yolo') });",
      "  process.stdout.write(JSON.stringify({ ok: true, added: r.added }) + '\\n');",
      '} catch (e) {',
      "  process.stdout.write(JSON.stringify({ ok: false, message: e.message, exitCode: e.exitCode ?? 1 }) + '\\n');",
      '  process.exitCode = e.exitCode ?? 1;',
      '}',
    ].join('\n'),
  );
  return file;
}

function digest(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string): void => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (/SESSION\.log|COSTS\.jsonl/.test(name)) continue;
      if (fs.statSync(p).isDirectory()) walk(p);
      else h.update(`${path.relative(dir, p)}\0`).update(fs.readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex');
}

const assigned = (sb: LlmSandbox): unknown =>
  parseFrontmatter(fs.readFileSync(path.join(sb.paper, 'sections', '02-background', 'PLAN.md'), 'utf8')).frontmatter['assigned_sources'];

test('RUN-28 plan-research: the registry row — --yolo adds every hit, no terminal refuses with 3, an explicit decline is 3', () => {
  const g = gateDef('plan-research');
  assert.equal(g.yolo, 'skip');
  assert.equal(g.yoloChoice, 'add every hit to the section');
  assert.equal(g.nonInteractive, 'refuse');
  assert.equal(g.nonTtyExit, EXIT_APPROVAL);
  assert.equal(g.declineExit, EXIT_APPROVAL);
  assert.equal(g.requirement, 'GRND-17');
});

test('GRND-17: in a terminal the hits are listed (tier, year, "already in library as"), and only the chosen ones reach section 2', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY, PENSMITH_NO_LLM: undefined } }, async (sb) => {
    const driver = await seed(sb);
    sb.mock!.script('source-evaluator', { data: { verdicts: [
      { citekey: 'cohort12019', keep: true, reason: 'The largest cohort.', relevance: 0.9, tier: 'peer-reviewed' },
      { citekey: 'cohort22020', keep: true, reason: 'Same cohort, later wave.', relevance: 0.8, tier: 'peer-reviewed' },
      { citekey: 'cohort32021', keep: false, reason: 'Cross-sectional only.', relevance: 0.3, tier: 'peer-reviewed' },
    ] } });
    const r = await sb.runTsx(driver, [], { env: { PENSMITH_PROMPT_MODE: 'numbered' }, input: '2,3\n' });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /Add these research hits to section 2 "Background"\? \(3 found; the evaluator's picks are preselected\)/);
    assert.match(r.stderr, /2\) cohort22020 {2}— \[peer-reviewed\] Instagram and adolescent depression, cohort 2 \(2020\)\n\s+already in library as known2020; Same cohort, later wave\./);
    assert.match(r.stderr, /3\) cohort32021 {2}— \[peer-reviewed\] Instagram and adolescent depression, cohort 3 \(2021\)\n\s+rejected by the evaluator: Cross-sectional only\./);
    assert.deepEqual(assigned(sb), ['known2020', 'cohort32021'], 'the chosen hits, by their library keys (hit 2 is the known work)');
    const log = fs.readFileSync(path.join(sb.paper, 'sections', '02-background', 'RESEARCH-LOG.md'), 'utf8');
    assert.match(log, /\[@cohort12019\] .* — deselected/);
  });
});

test('GRND-17: choosing no hit is the gate\'s decline — exit 3, nothing changed; without a terminal and --yolo: exit 3 before any request', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY, PENSMITH_NO_LLM: undefined } }, async (sb) => {
    const driver = await seed(sb);
    const before = digest(sb.paper);
    const none = await sb.runTsx(driver, [], { env: { PENSMITH_PROMPT_MODE: 'numbered' }, input: '0\n' });
    assert.equal(none.status, EXIT_APPROVAL, `${none.stdout}\n${none.stderr}`);
    assert.match(none.stdout, /no hit was selected for section 2; nothing was changed/);
    assert.equal(digest(sb.paper), before, 'nothing changed');

    const calls = sb.mock!.callCount();
    const refused = await sb.runTsx(driver, [], { env: { PENSMITH_PROMPT_MODE: undefined } });
    assert.equal(refused.status, EXIT_APPROVAL, `${refused.stdout}\n${refused.stderr}`);
    assert.match(refused.stdout, /needs an answer: re-run in a terminal, or pass --yolo to add every hit to the section/);
    assert.equal(sb.mock!.callCount(), calls, 'no model request');
    assert.equal(digest(sb.paper), before);

    const yolo = await sb.runTsx(driver, ['--yolo'], { env: { PENSMITH_PROMPT_MODE: undefined } });
    assert.equal(yolo.status, 0, `${yolo.stdout}\n${yolo.stderr}`);
    assert.deepEqual(assigned(sb), ['cohort12019', 'known2020', 'cohort32021'], '--yolo adds every hit the evaluator kept (the mock stub keeps all)');
  });
});
