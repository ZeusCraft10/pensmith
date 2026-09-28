// tests/plan-validate.test.ts — GRND-13 / FEED-04 / D-18-23: the planner's
// output is checked, never silently repaired: the echoed identity equals the
// OUTLINE row, assigned_sources ⊆ the allowed set ⊆ LIBRARY, every claim's
// sources ⊆ assigned_sources, every structure claim number names a claim.

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPlanIssues, planCorrection, validatePlan, type PlannerOutput } from '../bin/lib/plan-validate.js';

const SECTION = { n: 2, slug: 'background', depends_on: ['introduction'] };
const ALLOWED = ['vaswani2017', 'bahdanau2015'];
const LIB = new Set(['vaswani2017', 'bahdanau2015', 'luong2015']);

function plan(over: Partial<PlannerOutput['frontmatter']> = {}, claims?: PlannerOutput['claims'], structure?: PlannerOutput['structure']): PlannerOutput {
  return {
    frontmatter: { section: 2, slug: 'background', depends_on: ['introduction'], assigned_sources: ['vaswani2017'], ...over },
    claims: claims ?? [{ claim: 'c', sources: ['vaswani2017'] }],
    structure: structure ?? [{ paragraph: 1, claims: [1] }],
  };
}

const check = (p: PlannerOutput, allowed = ALLOWED) => validatePlan({ plan: p, section: SECTION, allowed, libraryCitekeys: LIB });

test('GRND-13: a valid plan has no issues (depends_on compared as a set)', () => {
  assert.deepEqual(check(plan()), []);
  assert.deepEqual(check(plan({ assigned_sources: [] }, [{ claim: 'framing', sources: [] }])), [], 'an uncited plan is valid');
});

test('GRND-13: a wrong section, slug or depends_on is reported against the OUTLINE row', () => {
  const issues = check(plan({ section: 9, slug: 'wrong', depends_on: ['nowhere'] }));
  assert.deepEqual(issues.map((i) => i.code), ['section-mismatch', 'slug-mismatch', 'depends-on-mismatch']);
  assert.match(formatPlanIssues(issues), /frontmatter\.section is 9, but this is section 2; frontmatter\.slug is "wrong".*\[introduction\]/);
});

test('GRND-13 / FEED-04: invented or foreign citekeys are named, not dropped', () => {
  const issues = check(plan({ assigned_sources: ['fakecite2099', 'vaswani2017', 'zzzinvented2001'] }));
  assert.deepEqual(issues.map((i) => i.code), ['foreign-citekey']);
  assert.match(issues[0]!.message, /not this section's sources: fakecite2099, zzzinvented2001 \(allowed: vaswani2017, bahdanau2015\)/);
  // A library source outside the section's allowed set is foreign too (FEED-01 isolation).
  assert.deepEqual(check(plan({ assigned_sources: ['luong2015'] }), ALLOWED).map((i) => i.code), ['foreign-citekey', 'claim-source-unassigned']);
  // An allowed key the library no longer holds is refused as well.
  assert.deepEqual(check(plan({ assigned_sources: ['gone2000'] }, [{ claim: 'c', sources: [] }]), ['gone2000']).map((i) => i.code), ['foreign-citekey']);
});

test('GRND-13: every claim source ⊆ assigned_sources; every structure claim number exists', () => {
  const issues = check(plan({}, [{ claim: 'a', sources: ['bahdanau2015'] }, { claim: 'b', sources: ['bahdanau2015', 'vaswani2017'] }], [{ paragraph: 1, claims: [1, 3] }]));
  assert.deepEqual(issues.map((i) => i.code), ['claim-source-unassigned', 'structure-claim-unknown']);
  assert.match(issues[0]!.message, /claim 1, 2 cites "bahdanau2015", which is not in assigned_sources/);
  assert.match(issues[1]!.message, /structure names claim\(s\) 3, but there are 2 claim\(s\)/);
});

test('GRND-13: the corrective turn quotes every issue', () => {
  const issues = check(plan({ slug: 'x', assigned_sources: ['fakecite2099'] }));
  const c = planCorrection(issues);
  for (const i of issues) assert.ok(c.includes(i.message));
  assert.match(c, /Copy section, slug and depends_on exactly from the section block/);
});
