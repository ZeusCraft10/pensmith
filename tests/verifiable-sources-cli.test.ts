// tests/verifiable-sources-cli.test.ts — the grounded path with sources that
// have no Crossref DOI (review round 1 of the Phase 18/19 merge; D-18-37,
// ROADMAP Phase 19 criterion 7, SRC-11, SRC-13, SRC-15), through the BUILT CLI.
//
// Pass 1 checks an ISBN at the books registries and an arXiv id at arXiv, so
// outline and plan must offer such sources (source-context.ts
// verifierBlindSpot reads Pass 1's own route, verify/pass1-identifiers.ts):
//
//   1. A History paper whose only source is a book added by ISBN: the outline
//      allocates it, the planner keeps it, the drafter cites it, and verify
//      passes it through the books registries.
//   2. A computer-science paper whose only source is the user's own PDF,
//      identified by its arXiv id (`new --pdfs`): allocated, cited, verified
//      OK at arXiv, compiled and exported.
//
// Offline under the test runner (every request is answered by a recording);
// the model is the deterministic PENSMITH_NO_LLM stub (the outline stub
// allocates the offered sources; the drafter stub cites every assigned key).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox, type LlmSandbox } from './helpers/llm-sandbox.js';
import { runBuilt, REPO } from './helpers/built-cli.js';
import { seedBriefPaper } from './helpers/section-fixture.js';
import { parseOutline } from '../bin/lib/outline-parse.js';
import { loadFrontmatterDocSync } from '../bin/lib/frontmatter.js';
import { formatSectionId, sectionIdOf } from '../bin/lib/section-id.js';

const NO_LLM = { PENSMITH_NO_LLM: '1' };

function outlineRows(sb: LlmSandbox): ReturnType<typeof parseOutline>['sections'] {
  return parseOutline(fs.readFileSync(path.join(sb.paper, 'OUTLINE.md'), 'utf8')).sections;
}

function sectionDir(sb: LlmSandbox, n: number, slug: string): string {
  return path.join(sb.paper, 'sections', `${String(n).padStart(2, '0')}-${slug}`);
}

/** outline → (plan, write) the section holding `key`; returns its folder. */
async function allocatePlanWrite(sb: LlmSandbox, key: string): Promise<string> {
  const o = await runBuilt(sb, ['outline', '--yolo'], { env: NO_LLM });
  assert.equal(o.status, 0, `outline\n${o.stdout}\n${o.stderr}`);
  assert.doesNotMatch(o.stderr, /not offered to the outline/, `${key} is offered to the outline`);
  const row = outlineRows(sb).find((r) => r.assigned_sources.includes(key));
  assert.ok(row, `the outline allocates ${key}:\n${fs.readFileSync(path.join(sb.paper, 'OUTLINE.md'), 'utf8')}`);
  const id = formatSectionId(sectionIdOf(row.n, row.suffix));

  const p = await runBuilt(sb, ['plan', id, '--yolo'], { env: NO_LLM });
  assert.equal(p.status, 0, `plan ${id}\n${p.stdout}\n${p.stderr}`);
  assert.doesNotMatch(p.stderr, /leaves out|has no assigned sources/, 'the planner keeps the source');
  const dir = sectionDir(sb, row.n, row.slug);
  const plan = loadFrontmatterDocSync('plan', path.join(dir, 'PLAN.md'));
  assert.ok((plan.frontmatter['assigned_sources'] as string[]).includes(key), `PLAN.md keeps ${key}`);

  const w = await runBuilt(sb, ['write', id, '--yolo'], { env: NO_LLM });
  assert.equal(w.status, 0, `write ${id}\n${w.stdout}\n${w.stderr}`);
  assert.match(fs.readFileSync(path.join(dir, 'DRAFT.md'), 'utf8'), new RegExp(`@${key}\\b`), 'the draft cites it');
  return dir;
}

test('D-18-37 / criterion 7 (built CLI): a History paper\'s ISBN-only book is allocated by the outline, kept by the planner, cited and verified OK', async () => {
  await withLlmSandbox({ env: NO_LLM }, async (sb) => {
    await seedBriefPaper(
      sb.root,
      {
        topic: 'how paradigm shifts change scientific practice',
        thesis: 'Scientific revolutions replace the questions a field asks, not only its answers.',
        discipline: 'history',
      },
      { sources: [], assignment: 'Write a 1500-word history paper on how scientific revolutions happen.' },
    );
    const a = await runBuilt(sb, ['add', 'isbn:9780226458083', '--yolo']);
    assert.equal(a.status, 0, `add\n${a.stdout}\n${a.stderr}`);
    assert.match(a.stdout, /added kuhn1996/);

    const dir = await allocatePlanWrite(sb, 'kuhn1996');
    const verification = fs.readFileSync(path.join(dir, 'VERIFICATION.md'), 'utf8');
    assert.match(verification, /- kuhn1996: \*\*OK\*\* — .*ISBN 9780226458083 re-fetched from the books registries; D-11 AND-gate passed/);
  });
});

test('D-18-37 / SRC-15 (built CLI): your own PDF identified by its arXiv id is allocated, cited, verified OK at arXiv, compiled and exported', async () => {
  await withLlmSandbox({ paper: false, env: NO_LLM }, async (sb) => {
    fs.copyFileSync(path.join(REPO, 'tests', 'fixtures', 'assignment.txt'), path.join(sb.root, 'a.txt'));
    fs.mkdirSync(path.join(sb.root, 'pdfs'));
    fs.copyFileSync(path.join(REPO, 'tests', 'fixtures', 'byo', 'attention-arxiv-layout.pdf'), path.join(sb.root, 'pdfs', 'attention-arxiv-layout.pdf'));
    const n = await runBuilt(sb, ['new', '--from', 'a.txt', '--pdfs', 'pdfs', '--yolo'], { env: NO_LLM });
    assert.equal(n.status, 0, `new\n${n.stdout}\n${n.stderr}`);
    const lib = JSON.parse(fs.readFileSync(path.join(sb.paper, 'LIBRARY.json'), 'utf8')) as { entries: Array<Record<string, unknown>> };
    const vas = lib.entries.find((e) => e['citekey'] === 'vaswani2017');
    assert.ok(vas, 'the PDF was identified as vaswani2017');
    assert.equal(vas['doi'], null, 'no DOI');
    assert.equal(vas['arxiv'], '1706.03762', 'identified by its arXiv id');
    assert.ok(vas['byo'], 'kept as your own hashed PDF');

    const dir = await allocatePlanWrite(sb, 'vaswani2017');
    const verification = fs.readFileSync(path.join(dir, 'VERIFICATION.md'), 'utf8');
    assert.match(verification, /- vaswani2017: \*\*OK\*\* — .*arXiv:1706\.03762 re-fetched from arXiv; D-11 AND-gate passed/);

    // Every other section of the stub outline cites the same (only) source.
    for (const row of outlineRows(sb)) {
      if (fs.existsSync(path.join(sectionDir(sb, row.n, row.slug), 'VERIFICATION.md'))) continue;
      const id = formatSectionId(sectionIdOf(row.n, row.suffix));
      const p = await runBuilt(sb, ['plan', id, '--yolo'], { env: NO_LLM });
      assert.equal(p.status, 0, `plan ${id}\n${p.stdout}\n${p.stderr}`);
      const w = await runBuilt(sb, ['write', id, '--yolo'], { env: NO_LLM });
      assert.equal(w.status, 0, `write ${id}\n${w.stdout}\n${w.stderr}`);
    }
    const c = await runBuilt(sb, ['compile', '--yolo'], { env: NO_LLM });
    assert.equal(c.status, 0, `compile\n${c.stdout}\n${c.stderr}`);
    const d = await runBuilt(sb, ['done', '--yolo', '--format', 'md'], { env: NO_LLM });
    assert.equal(d.status, 0, `done\n${d.stdout}\n${d.stderr}`);
    const exported = fs.readdirSync(path.join(sb.paper, 'export'));
    const bib = exported.find((f) => f.endsWith('.bib'));
    assert.ok(bib, `an export bibliography: ${exported.join(', ')}`);
    const bibText = fs.readFileSync(path.join(sb.paper, 'export', bib), 'utf8');
    assert.match(bibText, /@misc\{vaswani2017,/, 'the exported bibliography cites the preprint');
    assert.match(bibText, /eprint = \{1706\.03762\}/);
  });
});
