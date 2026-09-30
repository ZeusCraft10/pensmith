// tests/known-bad-pass4.test.ts — the Pass 4 deterministic floor against its
// fixture (VRFY-06, VRFY-23, D-20-29).
//
// tests/fixtures/pass4-orphan.json holds paragraphs with the orphan sentences
// the floor rule gives them (its $comment states the rule; each case's
// description records the walk). The counts are LLM-independent:
// PENSMITH_NO_LLM=1 skips the per-paragraph audit, which can only ADD orphans
// (tests/pass4-floor.test.ts drives it through the mock LLM).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractClaimsFromParagraph, runPass4 } from '../bin/lib/verify/pass4.js';
import { extractCitedKeysForVerification } from '../bin/lib/citation-token.js';

interface OrphanFixture {
  paragraph: string;
  in_text_citekeys: string[];
  expected_orphan_count: number;
  expected_orphans: string[];
  description: string;
}

const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/pass4-orphan.json', import.meta.url)), 'utf8')) as {
  $comment: string;
  cases: OrphanFixture[];
};

test('known-bad-pass4: the fixture states its rule and covers the required shapes (VRFY-06, VRFY-23)', () => {
  assert.match(FIXTURE.$comment, /D-20-29/);
  const cases = FIXTURE.cases;
  assert.ok(cases.length >= 12, `${cases.length} cases`);
  for (const e of cases) {
    assert.ok(e.paragraph.length > 0 && e.description.length > 0);
    assert.equal(e.expected_orphans.length, e.expected_orphan_count, `the orphan list matches the count: ${e.paragraph.slice(0, 60)}`);
    // in_text_citekeys is the paragraph's citations, read by the one grammar.
    assert.deepEqual(extractCitedKeysForVerification(e.paragraph), e.in_text_citekeys, e.paragraph.slice(0, 60));
  }
  assert.ok(cases.some((e) => e.expected_orphan_count === 0 && e.in_text_citekeys.length > 0), 'a cited control');
  assert.ok(cases.some((e) => /\bdefined as\b/.test(e.paragraph) && e.expected_orphan_count === 0), 'a definition');
  assert.ok(cases.some((e) => e.paragraph.includes('\r\n')), 'a CRLF twin');
  const register = cases.find((e) => e.paragraph === 'Social media use clearly causes depression in every adolescent. Studies show that 73% of American cities saw street trees lower asthma hospitalizations by 40 percent.');
  assert.equal(register?.expected_orphan_count, 2, 'the two register sentences, uncited, are both orphans');
  assert.ok(cases.some((e) => e.paragraph.startsWith('Social media use clearly causes depression in every adolescent [@smith2020].') && e.expected_orphan_count === 0), 'cited, they are none');
});

test('known-bad-pass4: every fixture paragraph yields exactly its orphan sentences under PENSMITH_NO_LLM=1', async () => {
  const before = process.env['PENSMITH_NO_LLM'];
  process.env['PENSMITH_NO_LLM'] = '1';
  try {
    for (const e of FIXTURE.cases) {
      const results = await runPass4(e.paragraph, { n: 1 });
      const orphans = results.flatMap((r) => r.orphans);
      assert.equal(results.reduce((s, r) => s + r.orphanCount, 0), e.expected_orphan_count, `count: ${e.paragraph.slice(0, 70)}`);
      assert.deepEqual(orphans, e.expected_orphans, `orphans: ${e.paragraph.slice(0, 70)}`);
    }
  } finally {
    if (before === undefined) delete process.env['PENSMITH_NO_LLM'];
    else process.env['PENSMITH_NO_LLM'] = before;
  }
});

test('known-bad-pass4: extractClaimsFromParagraph is deterministic (VRFY-06, PRD §14)', () => {
  const para = 'The analysis demonstrates that the catalyst reveals a stronger binding affinity than predicted. This consequently confirms that the effect proves reproducible across laboratories.';
  const r1 = extractClaimsFromParagraph(para);
  assert.equal(r1.length, 2);
  assert.deepEqual(extractClaimsFromParagraph(para), r1);
  assert.ok(r1.every((c) => c.claimConfidence === 'HIGH' && !c.cited));
});

test('known-bad-pass4: one strong marker is enough; one weak marker alone is AMBIGUOUS and never an orphan', () => {
  const strong = extractClaimsFromParagraph('Street trees always cool the air around a dense city block.');
  assert.deepEqual(strong.map((c) => [c.claimConfidence, c.markers]), [['HIGH', ['universal']]]);
  const weak = extractClaimsFromParagraph('Street trees are part of the landscape of most dense city blocks.');
  assert.deepEqual(weak.map((c) => c.claimConfidence), ['AMBIGUOUS']);
});
