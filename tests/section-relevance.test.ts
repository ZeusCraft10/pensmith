// tests/section-relevance.test.ts — SRC-14 (D-19-20): the remap proposes only
// the sections whose title, purpose or plan overlaps a new source.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { contentWords, sectionRelevance, rankSections, loadSectionInfos, type SectionInfo } from '../bin/lib/section-relevance.js';

const SECTIONS: SectionInfo[] = [
  { n: 1, slug: 'intro', title: 'Introduction', purpose: 'Frame the question of social media and adolescent wellbeing.', body: '' },
  { n: 2, slug: 'attention-models', title: 'Attention-based sequence models', purpose: 'Explain how transformers replaced recurrent networks.', body: '- Claim: self-attention scales better than recurrence.' },
  { n: 3, slug: 'methods', title: 'Methods', purpose: 'Describe the survey sample and the questionnaire.', body: '' },
];
const VASWANI = { title: 'Attention Is All You Need', abstract: 'The dominant sequence transduction models are based on complex recurrent networks. We propose the Transformer.' };

test('SRC-14: content words drop stop words and fold plurals', () => {
  assert.deepEqual([...contentWords('The Networks and the Studies of Transformers')].sort(), ['network', 'transformer']);
  assert.deepEqual([...contentWords(null)], []);
});

test('SRC-14: only the overlapping section is relevant, with the shared words named', () => {
  const ranked = rankSections(VASWANI, SECTIONS);
  assert.deepEqual(ranked.map((r) => [r.section.n, r.relevant]), [[1, false], [2, true], [3, false]]);
  assert.deepEqual(ranked[1]!.shared, ['attention', 'model', 'network', 'recurrent', 'sequence', 'transformer']);
});

test('SRC-14: one shared word in both titles is enough; one shared body word is not', () => {
  const s: SectionInfo = { n: 4, slug: 'depression', title: 'Adolescent depression', purpose: '', body: '' };
  assert.equal(sectionRelevance({ title: 'Depression in adolescents: a cohort', abstract: null }, s).relevant, true);
  const weak: SectionInfo = { n: 5, slug: 'x', title: 'Unrelated heading', purpose: 'mentions cohort once', body: '' };
  assert.equal(sectionRelevance({ title: 'Depression in adolescents: a cohort', abstract: null }, weak).relevant, false);
});

test('SRC-14: loadSectionInfos reads STATE.json sections, PLAN.md title/purpose/body, OUTLINE.md titles (CRLF too)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-relevance-'));
  const { initState, initSection } = await import('../bin/lib/state.js');
  const { sectionPlan } = await import('../bin/lib/paths.js');
  await initState(root);
  await initSection(root, 1, 'intro');
  await initSection(root, 2, 'attention-models');
  fs.writeFileSync(
    path.join(root, '.paper', 'OUTLINE.md'),
    ['# P', '', '| # | slug | title | depends_on | word target | assigned_sources |', '|---|---|---|---|---|---|', '| 1 | intro | Introduction | | 300 | |', '| 2 | attention-models | Attention models | | 500 | |', ''].join('\r\n'),
  );
  fs.mkdirSync(path.dirname(sectionPlan(2, 'attention-models', root)), { recursive: true });
  fs.writeFileSync(
    sectionPlan(2, 'attention-models', root),
    ['---', 'section: 2', 'slug: attention-models', 'title: Attention-based sequence models', 'purpose: Explain transformers.', 'status: planned', 'assigned_sources: []', '---', '', '- Claim: attention replaces recurrence.', ''].join('\r\n'),
  );
  const infos = await loadSectionInfos(root);
  assert.deepEqual(
    infos.map((s) => [s.n, s.slug, s.title, s.purpose]),
    [
      [1, 'intro', 'Introduction', ''],
      [2, 'attention-models', 'Attention-based sequence models', 'Explain transformers.'],
    ],
  );
  assert.match(infos[1]!.body, /attention replaces recurrence/);
});
