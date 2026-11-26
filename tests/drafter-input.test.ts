// tests/drafter-input.test.ts — the drafter's input is checked as it is sent.
//
// The old check ran on constants ({planPath, sources: [], wordTarget: 300})
// while the prompt was built from other values, so it could never fail. Now
// the prompt is rendered from the one object that is checked: no field the
// schema lacks, and no source the section's PLAN.md does not assign.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import {
  assertDrafterInput,
  draftProblems,
  renderDrafterPrompt,
  SectionDraftSchema,
  type DrafterInput,
} from '../bin/lib/drafter-input.js';
import { checkModelJson } from '../bin/lib/schemas/model-json.js';
import { readFileSync } from 'node:fs';

const INPUT: DrafterInput = {
  section: { number: 2, slug: 'background', title: 'Background', purpose: 'Set out the prior work.', depends_on: [], word_target: 600 },
  paper: { title: 'A Paper', thesis: 'A thesis.' },
  brief: '## Brief\n\nCover the prior work.',
  voice: 'formal',
  sources: [{ citekey: 'vaswani2017', title: 'Attention Is All You Need', authors: ['Vaswani, Ashish'], year: 2017 }],
};

test('drafter input: the exact shape is accepted and rendered, with its sources fenced', () => {
  assert.doesNotThrow(() => assertDrafterInput(INPUT, ['vaswani2017']));
  const prompt = renderDrafterPrompt(INPUT, ['vaswani2017']);
  assert.match(prompt, /"citekey": "vaswani2017"/);
  assert.match(prompt, /Attention Is All You Need/);
  assert.match(prompt, /Set out the prior work\./);
  assert.doesNotMatch(prompt, /\{\{\w+\}\}/, 'every placeholder is filled');
});

test('drafter input: a source the section was not assigned is refused, before anything is rendered', () => {
  assert.throws(() => assertDrafterInput(INPUT, ['devlin2018']), /vaswani2017 is not one the section's PLAN\.md assigns/);
  assert.throws(() => renderDrafterPrompt(INPUT, []), /not one the section's PLAN\.md assigns/);
  const twice = { ...INPUT, sources: [INPUT.sources[0]!, INPUT.sources[0]!] };
  assert.throws(() => assertDrafterInput(twice, ['vaswani2017']), /listed twice/);
});

test('drafter input: a missing field, or a source field the schema lacks, is refused', () => {
  const noBrief: Partial<DrafterInput> = { ...INPUT };
  delete noBrief.brief;
  assert.throws(() => assertDrafterInput(noBrief, ['vaswani2017']), /brief/);
  const withDoi = { ...INPUT, sources: [{ ...INPUT.sources[0]!, doi: '10.1/x' }] };
  assert.throws(() => assertDrafterInput(withDoi, ['vaswani2017']), /doi/);
});

test('drafter input: property — any extra top-level key is refused', () => {
  const EXTRA_KEYS = ['cwd', 'env', 'fullSourcePool', 'paperDir', 'sessionId', 'allSections', 'planPath'];
  fc.assert(
    fc.property(fc.constantFrom(...EXTRA_KEYS), (extraKey) => {
      assert.throws(() => assertDrafterInput({ ...INPUT, [extraKey]: 'injected' }, ['vaswani2017']), new RegExp(extraKey));
    }),
    { numRuns: EXTRA_KEYS.length },
  );
});

test('draft problems: keys outside the section\'s sources, citations typed as text, broken brackets, an empty draft', () => {
  const ok = { draft: 'Attention replaced recurrence [@vaswani2017, p. 2].', gaps: [] };
  assert.deepEqual(draftProblems(ok, ['vaswani2017']), []);
  assert.match(draftProblems({ draft: 'It works [@vaswani2017; @devlin2018].', gaps: [] }, ['vaswani2017']).join(), /devlin2018/);
  assert.match(draftProblems({ draft: 'As @devlin2018 shows, it works.', gaps: [] }, ['vaswani2017']).join(), /devlin2018/, 'a narrative citation counts');
  assert.match(draftProblems({ draft: 'It works [@vaswani2017].', gaps: [] }, []).join(), /it has none/);
  assert.match(draftProblems({ draft: 'It works (Vaswani et al., 2017).', gaps: [] }, ['vaswani2017']).join(), /as text/);
  assert.match(draftProblems({ draft: 'It works, see doi:10.48550/arXiv.1706.03762.', gaps: [] }, ['vaswani2017']).join(), /as text/);
  assert.match(draftProblems({ draft: 'It works [@ vaswani2017].', gaps: [] }, ['vaswani2017']).join(), /not a citation pensmith can read/);
  assert.deepEqual(draftProblems({ draft: '\n  \n', gaps: [] }, ['vaswani2017']), ['the draft is empty']);
  // A draft that cites none of the section's sources fails verify, so it is sent back here.
  assert.match(draftProblems({ draft: 'Attention suffices for translation.', gaps: [] }, ['vaswani2017']).join(), /cites none of this section's sources \(vaswani2017\)/);
  assert.match(draftProblems({ draft: 'It works [@devlin2018].', gaps: [] }, ['vaswani2017']).join(), /cites none of this section's sources/);
  assert.deepEqual(draftProblems({ draft: 'The argument in brief.', gaps: [] }, []), [], 'a section with no sources may cite none');
});

test('the section-drafter prompt\'s own example is a draft the schema and the checks accept', () => {
  const text = readFileSync(new URL('../templates/prompts/section-drafter.md', import.meta.url), 'utf8');
  const example = /```json\n([\s\S]*?)\n```/.exec(text)?.[1];
  assert.ok(example, 'the prompt has a JSON example');
  const checked = checkModelJson(SectionDraftSchema, JSON.parse(example));
  assert.ok(checked.ok, JSON.stringify(checked));
  assert.deepEqual(draftProblems(checked.value, ['smith2020', 'lee2021']), []);
});
