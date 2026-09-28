// tests/byo-new-cli.test.ts — bring-your-own PDFs through the whole paper
// pipeline with the BUILT CLI (19-PLAN §7.4; SRC-15, D-19-21).
//
//   1. `new --from a.txt --pdfs pdfs --yolo` ingests the two generated PDFs
//      (the arXiv-layout attention paper and the DOI-footer "Measured
//      measurement") as two LIBRARY.json entries tagged bring-your-own, listed
//      under that tag in RESEARCH.md, and records `[sources] byo_pdf_dir`.
//   2. `research --yolo` re-reads the folder (nothing new: every PDF is known
//      by its hash) and its recorded Crossref hits include 10.1038/nphys1170 —
//      that search hit MERGES into the bring-your-own entry: one entry, both
//      tags, the citekey kept.
//   3. `outline --yolo` assigns a bring-your-own source to a section, `plan`
//      keeps it in the section's allowed set, `write` drafts a section citing
//      it, and `verify` accepts the citation (Pass 1 against the recorded
//      Crossref record).
//
// Sources are offline under the test runner: every request is answered by a
// recording; the model is the in-process RUN-21 mock with scripted replies
// (the planner is the deterministic PENSMITH_NO_LLM stub, which keeps the
// outline's sources).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox, type LlmSandbox } from './helpers/llm-sandbox.js';
import { runBuilt, REPO } from './helpers/built-cli.js';
import { discoverCandidates, researchAdapterPlan, type AdapterRegistry } from '../bin/lib/research-orchestrator.js';
import { sources } from '../bin/lib/sources/index.js';
import { provenanceTags } from '../bin/lib/research-md.js';
import { Schema as LibrarySchema } from '../bin/lib/schemas/library.js';
import { parsePromptBlocks } from '../bin/lib/prompt-request.js';

const KEY = 'sk-test-byo-new-cli-0001';
const BYO = path.join(REPO, 'tests', 'fixtures', 'byo');
const MERGE_QUERY = 'measured measurement Aspelmeyer';
const QUERIES = [MERGE_QUERY, 'optomechanics measurement back-action', 'quantum measurement mechanical oscillators', 'pulsed optomechanics', 'measurement induced cooling'];

function lib(sb: LlmSandbox): ReturnType<typeof LibrarySchema.parse> {
  return LibrarySchema.parse(JSON.parse(fs.readFileSync(path.join(sb.paper, 'LIBRARY.json'), 'utf8')));
}

test('SRC-15 (built CLI): new --pdfs → research merges a search hit into the bring-your-own entry → the outline assigns it and the draft cites it', async () => {
  await withLlmSandbox({ mock: 'anthropic', paper: false, env: { ANTHROPIC_API_KEY: KEY, PENSMITH_NO_LLM: undefined } }, async (sb) => {
    fs.copyFileSync(path.join(REPO, 'tests', 'fixtures', 'assignment.txt'), path.join(sb.root, 'a.txt'));
    fs.mkdirSync(path.join(sb.root, 'pdfs'));
    for (const f of ['attention-arxiv-layout.pdf', 'doi-footer.pdf']) fs.copyFileSync(path.join(BYO, f), path.join(sb.root, 'pdfs', f));

    // 1. new --pdfs (the intake model stubbed).
    const n = await runBuilt(sb, ['new', '--from', 'a.txt', '--pdfs', 'pdfs', '--yolo'], { env: { PENSMITH_NO_LLM: '1' } });
    assert.equal(n.status, 0, `${n.stdout}\n${n.stderr}`);
    const after1 = lib(sb);
    assert.deepEqual(after1.entries.map((e) => e.citekey).sort(), ['aspelmeyer2009', 'vaswani2017']);
    for (const e of after1.entries) assert.deepEqual(provenanceTags(e), ['bring-your-own'], e.citekey);
    const md1 = fs.readFileSync(path.join(sb.paper, 'RESEARCH.md'), 'utf8');
    assert.equal((md1.match(/Tags: bring-your-own/g) ?? []).length, 2, 'both listed under the bring-your-own tag');

    // 2. research: the recorded Crossref hits for MERGE_QUERY include the DOI-footer PDF's work.
    const registry = sources as unknown as AdapterRegistry;
    const plan = researchAdapterPlan({ registry, byPreference: true, discipline: 'other', env: {} });
    const found = await discoverCandidates({ queries: QUERIES, plan, registry, warn: () => undefined });
    const same = found.candidates.find((c) => c.candidate.doi?.toLowerCase() === '10.1038/nphys1170');
    assert.ok(same, 'the recording carries the same work as a search hit');
    sb.mock!.script('topic-disambiguator', { data: { ambiguous: false, scopes: [{ label: 'optomechanics', description: 'Measurement in quantum optomechanics.', queries: QUERIES }] } });
    sb.mock!.script('source-evaluator', {
      data: {
        verdicts: [
          ...found.candidates.map((c, i) => ({ citekey: c.candidate.citekey, keep: true, reason: `Relevant to measurement (${i}).`, relevance: 0.9 - i * 0.01, tier: 'other' })),
          // The bring-your-own attention paper is not among the hits: research asks the evaluator about it too.
          { citekey: 'vaswani2017', keep: false, reason: 'About attention models, not measurement.', relevance: 0.12, tier: 'other' },
        ],
      },
    });
    const r = await runBuilt(sb, ['research', '--yolo']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /^ {2}bring-your-own +2 {2}ok \(pdfs: 0 new, 2 already in library\)$/m, 'the folder is re-read; both PDFs are known by their hash');
    const after2 = lib(sb);
    const asp = after2.entries.filter((e) => e.doi === '10.1038/nphys1170');
    assert.equal(asp.length, 1, 'the search hit and the bring-your-own PDF are ONE entry');
    assert.equal(asp[0]!.citekey, 'aspelmeyer2009', 'the bring-your-own citekey is kept');
    assert.deepEqual(provenanceTags(asp[0]!), ['bring-your-own', 'search'], 'both tags');
    assert.ok(asp[0]!.byo, 'the hashed PDF record survives the merge');
    // The other bring-your-own entry was evaluated as well: annotated, never dropped.
    const vas = after2.entries.find((e) => e.citekey === 'vaswani2017')!;
    assert.ok(vas, 'a rejected bring-your-own source stays in the library');
    assert.deepEqual(provenanceTags(vas), ['bring-your-own'], 'no new tag');
    assert.equal(vas.tier, 'preprint', 'the metadata tier (arXiv) wins over the model\'s');
    assert.equal(vas.relevance, 0.12);
    assert.equal(vas.why_relevant, 'Your own source; the evaluator judged it off-scope: About attention models, not measurement.');
    const sent = sb.mock!.bodiesFor('source-evaluator').flatMap((b) => {
      const msgs = b['messages'] as Array<{ content: string }>;
      return JSON.parse(parsePromptBlocks(msgs[msgs.length - 1]!.content).get('candidates') ?? '[]') as Array<{ citekey: string }>;
    });
    assert.equal(sent.filter((c) => c.citekey === 'vaswani2017').length, 1, 'the evaluator saw the bring-your-own entry once');
    assert.equal(sent.filter((c) => c.citekey === 'aspelmeyer2009').length, 1, 'the merged one once (as the search hit)');
    assert.match(r.stdout, /; 1 of your own source\(s\) evaluated$/m);

    // 3. outline → plan → write → verify with the bring-your-own source.
    sb.mock!.script('outline-author', {
      data: {
        thesis: 'Measurement shapes what optomechanical systems reveal.',
        sections: [
          { n: 1, slug: 'measurement', title: 'Measurement', purpose: 'What measuring a mechanical oscillator does.', depends_on: [], estimated_word_count: 400, assigned_sources: ['aspelmeyer2009'], role: 'intro' },
          { n: 2, slug: 'attention', title: 'Attention', purpose: 'A note on attention models.', depends_on: ['measurement'], estimated_word_count: 400, assigned_sources: ['vaswani2017'], role: 'conclusion' },
        ],
      },
    });
    const o = await runBuilt(sb, ['outline', '--yolo']);
    assert.equal(o.status, 0, `${o.stdout}\n${o.stderr}`);
    const outline = fs.readFileSync(path.join(sb.paper, 'OUTLINE.md'), 'utf8');
    assert.match(outline, /aspelmeyer2009/, 'the outline assigns the bring-your-own source');

    const p = await runBuilt(sb, ['plan', '1', '--yolo'], { env: { PENSMITH_NO_LLM: '1' } });
    assert.equal(p.status, 0, `${p.stdout}\n${p.stderr}`);
    const sectionDir = fs.readdirSync(path.join(sb.paper, 'sections')).find((d) => d.startsWith('01-'))!;
    assert.match(fs.readFileSync(path.join(sb.paper, 'sections', sectionDir, 'PLAN.md'), 'utf8'), /aspelmeyer2009/, 'the plan keeps it in the allowed set');

    sb.mock!.script('section-drafter', {
      text: '# Measurement\n\nMeasuring a mechanical oscillator disturbs it, and that back-action can itself be put to use [@aspelmeyer2009].\n',
    });
    const w = await runBuilt(sb, ['write', '1', '--yolo']);
    assert.equal(w.status, 0, `${w.stdout}\n${w.stderr}`);
    const draft = fs.readFileSync(path.join(sb.paper, 'sections', sectionDir, 'DRAFT.md'), 'utf8');
    assert.match(draft, /\[@aspelmeyer2009\]/, 'the draft cites the bring-your-own source');

    const v = await runBuilt(sb, ['verify', '1', '--yolo'], { env: { PENSMITH_NO_LLM: '1' } });
    assert.equal(v.status, 0, `${v.stdout}\n${v.stderr}`);
    const verification = fs.readFileSync(path.join(sb.paper, 'sections', sectionDir, 'VERIFICATION.md'), 'utf8');
    assert.match(verification, /aspelmeyer2009: \*\*OK\*\*/, 'Pass 1 accepts the citation against the recorded Crossref record');
  });
});
