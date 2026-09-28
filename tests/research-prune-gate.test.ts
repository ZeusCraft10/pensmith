// tests/research-prune-gate.test.ts — the research-prune question (SRC-09,
// RUN-28, D-19-16): the evaluator's picks preselected, its rejections listed
// unselected with the reason, each option with its tier, year and an abstract
// excerpt; a rejected candidate can still be chosen (and says so in its
// why-relevant note); a deselected pick is logged in RESEARCH.md.
//
// The real verb runs in a child process (numbered prompts read the child's
// stdin) against the in-process RUN-21 mock LLM, with fake adapters injected
// through the research registry seam by a small driver script.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { renderIntakeDocument } from '../bin/lib/intake-brief.js';
import { Schema as LibrarySchema } from '../bin/lib/schemas/library.js';

const KEY = 'sk-test-prune-gate-0001';
const repo = (rel: string): string => pathToFileURL(fileURLToPath(new URL(`../${rel}`, import.meta.url))).href;

function candidate(n: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: 'crossref',
    id: `10.5555/prune.${n}`,
    doi: `10.5555/prune.${n}`,
    title: `Attention heads in transformer models, part ${n}`,
    authors: [`Author${n}, Ann`],
    year: 2015 + n,
    abstract: `Abstract ${n}: we measure how attention heads specialise across layers in large models.`,
    retracted: false,
    last_verified: '2026-09-28T00:00:00.000Z',
    citekey: `author${n}${2015 + n}`,
    raw: {},
    type: 'article-journal',
    venue: 'Neural Computation',
    ...extra,
  };
}

function driver(dir: string, candidates: unknown[]): string {
  const file = path.join(dir, 'prune-driver.mts');
  fs.writeFileSync(
    file,
    [
      `import { __setResearchRegistryForTest } from ${JSON.stringify(repo('bin/lib/research-orchestrator.ts'))};`,
      `import { runResearch } from ${JSON.stringify(repo('bin/cli/research.ts'))};`,
      `const candidates = ${JSON.stringify(candidates)};`,
      '__setResearchRegistryForTest({ crossref: { search: async () => candidates } });',
      'try {',
      '  const r = await runResearch({ root: process.cwd(), yolo: false });',
      "  process.stdout.write(JSON.stringify({ ok: true, kept: r.kept }) + '\\n');",
      '} catch (e) {',
      "  process.stdout.write(JSON.stringify({ ok: false, message: e.message, exitCode: e.exitCode ?? 1 }) + '\\n');",
      '  process.exitCode = e.exitCode ?? 1;',
      '}',
    ].join('\n'),
  );
  return file;
}

test('SRC-09: the prune question preselects the evaluator\'s picks, lists its rejections unselected with the reason, tier, year and excerpt', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY, PENSMITH_NO_LLM: undefined } }, async (sb) => {
    fs.writeFileSync(
      path.join(sb.paper, 'INTAKE.md'),
      renderIntakeDocument({ topic: 'attention heads in transformers', discipline: 'computer-science' }, 'Write about attention heads.', []),
    );
    sb.mock!.script('topic-disambiguator', { data: { ambiguous: false, scopes: [{ label: 'attention-heads', description: 'How attention heads specialise.', queries: ['attention heads', 'head pruning', 'head specialisation', 'attention layers', 'transformer heads'] }] } });
    sb.mock!.script('source-evaluator', { data: { verdicts: [
      { citekey: 'author12016', keep: true, reason: 'Measures head specialisation directly.', relevance: 0.9, tier: 'peer-reviewed' },
      { citekey: 'author22017', keep: true, reason: 'Background on pruning heads.', relevance: 0.7, tier: 'peer-reviewed' },
      { citekey: 'author32018', keep: false, reason: 'Off-scope: attention in human vision.', relevance: 0.1, tier: 'peer-reviewed' },
    ] } });
    const script = driver(sb.root, [candidate(1), candidate(2), candidate(3)]);
    // Numbered answers: keep option 1 (a pick) and option 3 (the rejection); leave pick 2 out;
    // then a blank line: no source to add.
    const r = await sb.runTsx(script, [], { env: { PENSMITH_PROMPT_MODE: 'numbered' }, input: '1,3\n\n' });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /Select candidates to keep \(3 found\): the evaluator's picks are preselected/);
    assert.match(r.stderr, /1\) author12016 {2}— \[peer-reviewed\] Attention heads in transformer models, part 1 \(2016\)/);
    assert.match(r.stderr, /Measures head specialisation directly\. — Abstract 1: we measure how attention heads specialise/);
    assert.match(r.stderr, /3\) author32018 {2}— \[peer-reviewed\] Attention heads in transformer models, part 3 \(2018\)\n\s+rejected by the evaluator: Off-scope: attention in human vision\./);
    assert.match(r.stderr, /\[default: \[peer-reviewed\] Attention heads in transformer models, part 1 \(2016\), \[peer-reviewed\] Attention heads in transformer models, part 2 \(2017\)\]/, 'only the picks are preselected');

    const lib = LibrarySchema.parse(JSON.parse(fs.readFileSync(path.join(sb.paper, 'LIBRARY.json'), 'utf8')));
    assert.deepEqual(lib.entries.map((e) => e.citekey).sort(), ['author12016', 'author32018']);
    assert.equal(lib.entries.find((e) => e.citekey === 'author32018')?.why_relevant, 'Kept at your choice; the evaluator said: Off-scope: attention in human vision.');
    const md = fs.readFileSync(path.join(sb.paper, 'RESEARCH.md'), 'utf8');
    assert.match(md, /^- \[@author22017\] .* — deselected at the approval gate$/m);
    assert.match(md, /^Result: 2 kept \(peer-reviewed 2\); 0 excluded by \[sources\] policy; 0 rejected by the evaluator; 1 deselected at the approval gate; 1 kept at your choice despite the evaluator$/m);
  });
});

test('SRC-07: every candidate rejected, and the user keeps none at the question → "no relevant sources", exit 1, no library', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY, PENSMITH_NO_LLM: undefined } }, async (sb) => {
    fs.writeFileSync(path.join(sb.paper, 'INTAKE.md'), renderIntakeDocument({ topic: 'attention heads', discipline: 'computer-science' }, 'x', []));
    sb.mock!.script('source-evaluator', { data: { verdicts: [{ citekey: 'author12016', keep: false, reason: 'Off-scope.', relevance: 0.1, tier: 'peer-reviewed' }] } });
    const script = driver(sb.root, [candidate(1)]);
    // A blank answer takes the default: nothing preselected; nothing added either.
    const r = await sb.runTsx(script, [], { env: { PENSMITH_PROMPT_MODE: 'numbered' }, input: '\n\n' });
    assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /"message":"pensmith research: no relevant sources — the evaluator rejected all 1 candidate\(s\)/);
    assert.ok(!fs.existsSync(path.join(sb.paper, 'LIBRARY.json')));
    assert.match(fs.readFileSync(path.join(sb.paper, 'RESEARCH.md'), 'utf8'), /^- \[@author12016\] .* — evaluator: Off-scope\.$/m);
  });
});

test('SRC-09 (19-PLAN §7.2): the prune question accepts a DOI to add — identified like `pensmith add`, written with the kept sources, tagged "added"', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY, PENSMITH_NO_LLM: undefined } }, async (sb) => {
    fs.writeFileSync(
      path.join(sb.paper, 'INTAKE.md'),
      renderIntakeDocument({ topic: 'deep learning review', discipline: 'computer-science' }, 'Write about deep learning.', []),
    );
    sb.mock!.script('topic-disambiguator', { data: { ambiguous: false, scopes: [{ label: 'deep-learning', description: 'Deep learning methods.', queries: ['deep learning', 'neural networks', 'representation learning', 'backpropagation', 'convolutional networks'] }] } });
    sb.mock!.script('source-evaluator', { data: { verdicts: [
      { citekey: 'author12016', keep: true, reason: 'On topic.', relevance: 0.8, tier: 'peer-reviewed' },
      { citekey: 'author22017', keep: true, reason: 'Also on topic.', relevance: 0.6, tier: 'peer-reviewed' },
    ] } });
    const script = driver(sb.root, [candidate(1), candidate(2)]);
    // Keep pick 1; then add the LeCun et al. review by its DOI (the recorded Crossref answer
    // replays under the test runner) and a DOI Crossref does not know.
    const r = await sb.runTsx(script, [], {
      env: { PENSMITH_PROMPT_MODE: 'numbered' },
      input: '1\nDOI: 10.1038/nature14539 10.5555/not-a-registered-work-0000\n',
    });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /Add a source you know — a DOI, arXiv id, PMID:<id>, isbn:<ISBN> or URL/);
    // Offline (the test runner) an unrecorded DOI is refused with add's RUN-03 wording; live it reads "not found".
    assert.match(r.stderr, /^pensmith research: DOI verification unavailable \(offline\) — 10\.5555\/not-a-registered-work-0000 NOT added; re-run online to verify and add it\.$/m, 'an unknown DOI is refused with the add wording');
    assert.match(r.stdout, /^pensmith research: DOI: 10\.1038\/nature14539 → Deep learning \(2015\)$/m);
    const lib = LibrarySchema.parse(JSON.parse(fs.readFileSync(path.join(sb.paper, 'LIBRARY.json'), 'utf8')));
    const lecun = lib.entries.find((e) => e.doi === '10.1038/nature14539');
    assert.ok(lecun, `the added DOI is in the library: ${lib.entries.map((e) => e.citekey).join(', ')}`);
    assert.equal(lecun.title, 'Deep learning');
    assert.deepEqual(lecun.provenance, ['add:crossref']);
    assert.equal(lecun.why_relevant, 'Added at the approval gate');
    assert.equal(lecun.tier, 'peer-reviewed');
    assert.deepEqual(lib.entries.map((e) => e.citekey).sort(), ['author12016', lecun.citekey].sort());
    const md = fs.readFileSync(path.join(sb.paper, 'RESEARCH.md'), 'utf8');
    assert.match(md, /; 1 added at the approval gate$/m);
    assert.match(md, new RegExp(`^- \\[@${lecun.citekey}\\] LeCun, Yann; Bengio, Yoshua; Hinton, Geoffrey \\(2015\\)\\. Deep learning\\. Nature`, 'm'));
    assert.match(md, /Tags: added/);
  });
});
