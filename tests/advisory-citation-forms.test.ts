// tests/advisory-citation-forms.test.ts — the advisory passes and checks read
// citations in every Pandoc form.
//
// Pass 2 (claim support), Pass 4 (orphan claims), the compile citation
// density and the plagiarism phrase picker each had their own bare-lowercase
// `[@key]` regex, so a `[@k, p. 4]`, `[@a; @b]`, `@k` or `[@Key]` citation was
// not judged, counted an uncited claim as an orphan, and leaked locator words
// into plagiarism queries.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPass2 } from '../bin/lib/verify/pass2.js';
import { runPass4 } from '../bin/lib/verify/pass4.js';
import { computeCitationDensity } from '../bin/lib/citation-density.js';
import { extractDistinctivePhrases } from '../bin/lib/plagiarism.js';

const DRAFT = [
  'Coherence persists for hundreds of femtoseconds [@engel2007, p. 4].',
  'Two later groups agree [see @Lee2010; -@panitchayangkoon2010].',
  'As @scholes2011 [p. 9] argues, the effect is robust.',
].join(' ');

test('Pass 2: one claim per cited key, in any form, with the sentence that cites it', async () => {
  const saved = process.env['PENSMITH_NO_LLM'];
  process.env['PENSMITH_NO_LLM'] = '1';
  try {
    const rows = await runPass2(DRAFT, new Map(), { n: 1 });
    assert.deepEqual(rows.map((r) => [r.citekey, r.claimSentence]), [
      ['engel2007', 'Coherence persists for hundreds of femtoseconds [@engel2007, p. 4].'],
      ['Lee2010', 'Two later groups agree [see @Lee2010; -@panitchayangkoon2010].'],
      ['panitchayangkoon2010', 'Two later groups agree [see @Lee2010; -@panitchayangkoon2010].'],
      ['scholes2011', 'As @scholes2011 [p. 9] argues, the effect is robust.'],
    ]);
  } finally {
    if (saved === undefined) delete process.env['PENSMITH_NO_LLM'];
    else process.env['PENSMITH_NO_LLM'] = saved;
  }
});

test('Pass 4: a claim cited with a locator, a cluster or a narrative citation is not an orphan', async () => {
  const saved = process.env['PENSMITH_NO_LLM'];
  process.env['PENSMITH_NO_LLM'] = '1';
  try {
    for (const cite of ['[@engel2007, p. 4]', '[@Lee2010; @kim2011]', '[-@engel2007]', 'as @engel2007 shows']) {
      const para = `This result clearly demonstrates that coherence is therefore essential for transfer ${cite}.`;
      const [r] = await runPass4(para, { n: 1 });
      assert.equal(r!.orphanCount, 0, `cited with ${cite}`);
    }
    const [uncited] = await runPass4('This result clearly demonstrates that coherence is therefore essential for transfer.', { n: 1 });
    assert.equal(uncited!.orphanCount, 1, 'the same claim with no citation is an orphan');
  } finally {
    if (saved === undefined) delete process.env['PENSMITH_NO_LLM'];
    else process.env['PENSMITH_NO_LLM'] = saved;
  }
});

test('citation density counts every cited work, in any form', () => {
  const report = computeCitationDensity([{ n: 1, slug: 'intro', text: DRAFT }], 'default');
  assert.equal(report.sections[0]!.citations, 4);
});

test('plagiarism phrases never carry citation prefixes, keys or locators', () => {
  const phrases = extractDistinctivePhrases(
    'Quantum coherence persists remarkably long inside photosynthetic complexes [see @engel2007, chap. 3] according to recent measurements.',
  );
  assert.ok(phrases.length > 0);
  for (const p of phrases) assert.doesNotMatch(p, /\bsee\b|chap|engel2007|@/, p);
});
