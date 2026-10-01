// tests/done-gate-advisory.test.ts — bin/lib/done-gate.ts (Phase 21, D-21-17).
//
// The export gate helpers moved out of bin/cli/done.ts into bin/lib (so the
// Tier-1 tools and compile's report call the same code) and are still
// re-exported from done.ts. readSectionAdvisory reads a section's own
// VERIFICATION.md for COMPILE-REPORT's Advisory Findings: the Pass-2 rows that
// are not SUPPORTED (fail safe on a table it cannot read) and the Pass-4
// orphans — or that the passes were not run on the current draft.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as doneGate from '../bin/lib/done-gate.js';
import * as doneCli from '../bin/cli/done.js';
import { renderPass2Section, type Pass2Result } from '../bin/lib/verify/pass2.js';
import { renderPass4Section, type Pass4Result } from '../bin/lib/verify/pass4.js';
import { COMPILE_REVERIFY_NOT_RUN } from '../bin/cli/verify.js';

function section(root: string, n: number, slug: string, verification: string | null): doneGate.DoneSection {
  const dir = path.join(root, '.paper', 'sections', `${String(n).padStart(2, '0')}-${slug}`);
  fs.mkdirSync(dir, { recursive: true });
  if (verification !== null) fs.writeFileSync(path.join(dir, 'VERIFICATION.md'), verification);
  return { identity: { n, slug }, id: String(n), planPath: path.join(dir, 'PLAN.md'), assignedSources: [], verifiedHash: null, currentDraftHash: null };
}

const row = (citekey: string, verdict: Pass2Result['verdict'], claim: string): Pass2Result => ({ citekey, claimSentence: claim, verdict, rationale: `why ${verdict}`, evidence: '' });

test('D-21-17: every moved symbol is re-exported, unchanged, from bin/cli/done.ts', () => {
  for (const name of ['doneSections', 'runExportBlockingGate', 'exportAcceptanceSets', 'recomputeExportGate', 'sectionQuoteIndex', 'citedKeySetChange', 'readUnsupportedClaims', 'unjudgedClaimSections', 'readSectionAdvisory', 'unjudgedLine'] as const) {
    assert.equal(typeof (doneGate as Record<string, unknown>)[name], 'function', name);
    assert.equal((doneCli as Record<string, unknown>)[name], (doneGate as Record<string, unknown>)[name], `${name} is the same function`);
  }
});

test('D-21-17: readSectionAdvisory lists non-SUPPORTED Pass-2 rows and Pass-4 orphans per section, and names a section not judged on its current draft', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-advisory-'));
  try {
    const p2 = renderPass2Section([
      row('a2020', 'SUPPORTED', 'Trees cool streets [@a2020].'),
      row('b2021', 'PARTIAL', 'Shade lowers heat deaths by half [@b2021].'),
      row('c2019', 'UNSUPPORTED', 'Every city plants trees [@c2019].'),
      row('d2018', 'UNCLEAR', 'Canopy grew [@d2018].'),
    ]);
    const p4: Pass4Result[] = [
      { paragraphIndex: 1, totalSentences: 3, claimsDetected: 2, orphanCount: 1, claims: [], orphans: ['Urban heat always kills more people than floods do in every season.'] },
      { paragraphIndex: 2, totalSentences: 2, claimsDetected: 1, orphanCount: 0, claims: [], orphans: [] },
    ];
    const s1 = section(root, 1, 'heat', `# VERIFICATION (Section 1, heat)\n\nStatus: verified\n\n${p2}\n${renderPass4Section(p4)}`);
    const notRun = `## Pass-2 (claim support, advisory)\n\n_(${COMPILE_REVERIFY_NOT_RUN} 2\`)_\n\n## Pass-4 (orphan claims, advisory)\n\n_(${COMPILE_REVERIFY_NOT_RUN} 2\`)_\n`;
    const s2 = section(root, 2, 'trees', `# VERIFICATION (Section 2, trees)\n\nStatus: verified\n\n${notRun}`);
    const s3 = section(root, 3, 'none', null);
    const broken = section(root, 4, 'broken', '# VERIFICATION\n\nStatus: verified\n\n## Pass-2 (claim support, advisory — LLM-judged)\n\n| what | is | this |\n|---|---|---|\n| x | y | z |\n');
    const adv = doneGate.readSectionAdvisory(root, [s1, s2, s3, broken]);
    assert.equal(adv.length, 4);
    const [a1, a2, a3, a4] = adv as [doneGate.SectionAdvisory, doneGate.SectionAdvisory, doneGate.SectionAdvisory, doneGate.SectionAdvisory];
    assert.equal(a1.pass2, 'judged');
    assert.deepEqual(a1.pass2Rows.map((r) => [r.row, r.result.citekey, r.result.verdict]), [[2, 'b2021', 'PARTIAL'], [3, 'c2019', 'UNSUPPORTED'], [4, 'd2018', 'UNCLEAR']]);
    assert.equal(a1.pass4, 'judged');
    assert.deepEqual(a1.orphans, [{ paragraph: 1, sentence: 'Urban heat always kills more people than floods do in every season.' }]);
    assert.equal(a2.pass2, 'not-run');
    assert.equal(a2.pass4, 'not-run');
    assert.deepEqual([a2.pass2Rows, a2.orphans], [[], []]);
    assert.equal(a3.pass2, 'absent');
    assert.equal(a3.pass4, 'absent');
    assert.equal(a4.pass2, 'judged');
    assert.deepEqual(a4.pass2Rows.map((r) => r.result.citekey), ['<unparseable>'], 'a table it cannot read fails safe');
    // done's UNSUPPORTED-claims reader still reads only UNSUPPORTED rows.
    assert.deepEqual(doneGate.readUnsupportedClaims(root, [s1]).map((c) => c.result.citekey), ['c2019']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
