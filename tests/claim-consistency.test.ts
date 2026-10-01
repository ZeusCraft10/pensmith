// tests/claim-consistency.test.ts — the cross-section contradiction check
// (Phase 21, EXP-11; D-21-15, the D-12 amendment): candidates, the heuristic
// floor, the cap, the request shape and the counting rules, driven directly
// (the Tier-1 consistency tools, PLUG-07, use the same functions).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  applyConsistencyReply,
  collectClaims,
  consistencyCandidates,
  consistencyRequest,
  contentTerms,
  contradictionHeuristic,
  type ClaimSource,
} from '../bin/lib/claim-consistency.js';
import { ClaimConsistencySchema, contractFor } from '../bin/lib/llm-contracts.js';
import { slugSpec } from '../bin/lib/llm-models.js';
import { structuredStub } from '../bin/lib/llm-stubs.js';
import { requestHints } from '../bin/lib/prompt-request.js';
import { loadPrompt } from '../bin/lib/prompt-loader.js';
import { FENCE_OPEN } from '../bin/lib/untrusted-fence.js';

interface Fixture {
  sections: Array<{ n: number; slug: string; title: string; assigned: string[]; draft: string; claims: string[] }>;
}
const fixture = (name: string): Fixture =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/contradictions/${name}.json`, import.meta.url)), 'utf8')) as Fixture;

function sources(f: Fixture): ClaimSource[] {
  return f.sections.map((s) => ({
    section: String(s.n),
    slug: s.slug,
    title: s.title,
    planBody: `## Claims\n\n${s.claims.map((c, i) => `${i + 1}. ${c}\n   - Sources: ${s.assigned.join(', ')}`).join('\n')}\n`,
    draft: s.draft,
  }));
}

test('EXP-11: the heuristic flags "X causes Y" against "no relationship between X and Y", and opposite directions of change; it leaves unrelated or merely overlapping claims alone', () => {
  const a = 'Heavy screen time causes sleep loss in adolescents across the schools we surveyed [@a].';
  const b = 'There is no relationship between screen time and sleep loss in adolescents at these schools [@b].';
  assert.equal(contradictionHeuristic(a, b)?.kind, 'negation');
  assert.equal(contradictionHeuristic(b, a)?.kind, 'negation', 'symmetric');
  assert.equal(
    contradictionHeuristic('Tree planting increased canopy cover in the twelve cities measured [@a].', 'Canopy cover decreased in the twelve cities measured during the drought [@b].')?.kind,
    'direction',
  );
  assert.equal(contradictionHeuristic(a, 'Neural networks learn layered representations of raw data [@c].'), null, 'no shared subject');
  assert.equal(contradictionHeuristic(a, 'Students who sleep less report lower grades in school [@c].'), null, 'two shared terms covering under 80% of the shorter sentence');
  assert.equal(contradictionHeuristic(b, 'There is no relationship between screen time and sleep loss in adults [@c].'), null, 'both negated: no polarity flip');
  assert.deepEqual(contentTerms('The effects of Screen Time [@k] on adolescents’ sleep.'), ['screen', 'time', 'adolescent', 'sleep']);
});

test('EXP-11: collectClaims reads PLAN.md ## Claims and the draft claim sentences, a planned claim the draft states counted once', () => {
  const claims = collectClaims(sources(fixture('x-causes-y')));
  const s2 = claims.filter((c) => c.section === '2');
  assert.ok(s2.some((c) => c.origin === 'draft' && /causes sleep loss/.test(c.text)));
  assert.ok(!s2.some((c) => c.origin === 'plan' && /causes sleep loss/.test(c.text)), 'the planned claim the draft states is not a second candidate');
});

test('EXP-11: the fixture gives exactly one flagged pair (the heuristic, no model), a consistent paper none; candidates are ranked heuristic-first and capped', () => {
  const { pairs, sent } = consistencyCandidates(collectClaims(sources(fixture('x-causes-y'))), { maxPairs: 20 });
  const flagged = pairs.filter((p) => p.heuristic !== null);
  assert.equal(flagged.length, 1);
  assert.equal(pairs[0]!.heuristic?.kind, 'negation', 'heuristic flags rank first');
  assert.deepEqual([pairs[0]!.a.section, pairs[0]!.b.section], ['2', '3']);
  const none = applyConsistencyReply({ pairs, sent, verdicts: null, cap: 20, skipped: 'skipped (no LLM)' });
  assert.equal(none.flagged.length, 1);
  assert.equal(none.flagged[0]!.by, 'heuristic');
  assert.equal(none.judged, 0);

  const consistent = consistencyCandidates(collectClaims(sources(fixture('consistent'))), { maxPairs: 20 });
  assert.equal(applyConsistencyReply({ pairs: consistent.pairs, sent: consistent.sent, verdicts: null, cap: 20 }).flagged.length, 0);

  const capped = consistencyCandidates(collectClaims(sources(fixture('x-causes-y'))), { maxPairs: 1 });
  assert.equal(capped.sent.length, 1, 'the cap is honoured');
  assert.equal(capped.sent[0]!.id, 'p1');
  assert.equal(consistencyCandidates(collectClaims(sources(fixture('x-causes-y'))), { maxPairs: 0 }).sent.length, 0);
});

test('EXP-11 counting (D-21-15): model CONTRADICTS + unjudged heuristic flags; a heuristic flag judged CONSISTENT is cleared, UNCLEAR is listed; unknown and repeated ids are ignored', () => {
  const { pairs, sent } = consistencyCandidates(collectClaims(sources(fixture('x-causes-y'))), { maxPairs: 20 });
  const p1 = pairs[0]!;
  const contradicts = applyConsistencyReply({ pairs, sent, verdicts: [{ id: 'p1', verdict: 'CONTRADICTS', rationale: 'r' }, { id: 'p1', verdict: 'CONSISTENT', rationale: 'second answer ignored' }, { id: 'p999', verdict: 'CONTRADICTS', rationale: 'unknown' }], cap: 20 });
  assert.deepEqual(contradicts.flagged.map((f) => [f.pair.id, f.by]), [['p1', 'model']]);
  const cleared = applyConsistencyReply({ pairs, sent, verdicts: [{ id: p1.id, verdict: 'CONSISTENT', rationale: 'different populations' }], cap: 20 });
  assert.equal(cleared.flagged.length, 0);
  assert.deepEqual(cleared.cleared.map((c) => c.rationale), ['different populations']);
  const unclear = applyConsistencyReply({ pairs, sent, verdicts: [{ id: p1.id, verdict: 'UNCLEAR', rationale: 'cannot tell' }], cap: 20 });
  assert.equal(unclear.flagged.length, 0);
  assert.equal(unclear.undecided.length, 1);
  // A heuristic flag the model was never sent (beyond the cap) still counts.
  const notSent = applyConsistencyReply({ pairs, sent: [], verdicts: [], cap: 0 });
  assert.deepEqual(notSent.flagged.map((f) => f.by), ['heuristic']);
});

test('EXP-11 / D-12 amendment: the claim-consistency slug — fixed template, one fenced <pairs> block, judgment tier, structured contract and stub', () => {
  const { sent } = consistencyCandidates(collectClaims(sources(fixture('x-causes-y'))), { maxPairs: 20 });
  const req = consistencyRequest(sent);
  assert.equal(req.system, loadPrompt('claim-consistency'));
  assert.equal(req.messages.length, 1);
  assert.ok(req.messages[0]!.content.startsWith(`<pairs>\n${FENCE_OPEN}\n`), 'the pairs are fenced (they come from drafts)');
  const spec = slugSpec('claim-consistency');
  assert.deepEqual([spec.verb, spec.tier, spec.structured, spec.template], ['compile', 'judgment', true, true]);
  assert.ok(contractFor('claim-consistency'));
  const stub = structuredStub('claim-consistency', requestHints(req)) as { pairs: Array<{ id: string; verdict: string }> };
  assert.deepEqual(stub.pairs.map((p) => p.verdict), sent.map(() => 'UNCLEAR'), 'the stub judges nothing');
  assert.deepEqual(stub.pairs.map((p) => p.id), sent.map((p) => p.id));
  assert.equal(ClaimConsistencySchema.safeParse({ pairs: [{ id: 'p1', verdict: 'MAYBE', rationale: '' }] }).success, false);
});
