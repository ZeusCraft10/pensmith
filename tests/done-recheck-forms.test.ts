// tests/done-recheck-forms.test.ts — the humanizer gate (GATE-04) compares
// every citation, not only bare `[@key]` tokens.
//
// reCheckFinalMd built both key sets with a bare-lowercase `[@key]` regex, so a
// humanizer that added a key to a cluster, cited a new work in running text or
// typed an author-year citation passed the gate unseen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reCheckFinalMd } from '../bin/cli/done.js';

function bibPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-gate04-forms-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  return join(root, '.paper', 'CITATIONS.bib');
}

const DRAFT = 'Coherence lasts [@smith2020, p. 4], as @Jones2019 agrees [-@doe2021].';

const CHANGES: Array<[string, string, RegExp]> = [
  ['a key added to a cluster', 'Coherence lasts [@smith2020, p. 4; @ghost2099], as @Jones2019 agrees [-@doe2021].', /added: \[ghost2099\]/],
  ['a narrative citation added', 'Coherence lasts [@smith2020, p. 4], as @Jones2019 and @ghost2099 agree [-@doe2021].', /added: \[ghost2099\]/],
  ['an uppercase key dropped', 'Coherence lasts [@smith2020, p. 4], as many agree [-@doe2021].', /dropped: \[Jones2019\]/],
  ['a suppress-author key swapped', 'Coherence lasts [@smith2020, p. 4], as @Jones2019 agrees [-@ghost2099].', /added: \[ghost2099\].*dropped: \[doe2021\]/],
  ['an author-year citation typed in', 'Coherence lasts [@smith2020, p. 4] (Ghost, 2099), as @Jones2019 agrees [-@doe2021].', /\(Ghost, 2099\)/],
];

for (const [what, finalMd, reason] of CHANGES) {
  test(`GATE-04: ${what} after humanization blocks export`, async () => {
    const r = await reCheckFinalMd(finalMd, DRAFT, bibPath());
    assert.equal(r.passed, false, `${what} must block`);
    assert.match(r.reason, reason);
  });
}

test('GATE-04: reworded prose with the same citations passes', async () => {
  const r = await reCheckFinalMd('Coherence persists [@smith2020, p. 4], and @Jones2019 concurs [-@doe2021].', DRAFT, bibPath());
  assert.deepEqual(r, { passed: true, reason: '' });
});

test('GATE-04: a long quotation the humanizer left without its citation blocks, even with no CITATIONS.bib', async () => {
  const quote = 'coherence plays no role whatsoever in any photosynthetic energy transfer process observed to date';
  const draft = `They wrote "${quote}" [@smith2020, p. 4].`;
  const finalMd = `They wrote "${quote}". Smith agrees [@smith2020, p. 4].`;
  const r = await reCheckFinalMd(finalMd, draft, bibPath());
  assert.equal(r.passed, false);
  assert.match(r.reason, /UNATTRIBUTED|no citation/);
});
