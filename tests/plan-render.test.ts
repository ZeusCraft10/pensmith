// tests/plan-render.test.ts — GRND-09 / GRND-13 / D-18-17 / D-18-23: the stub
// and the planned PLAN.md are rendered (never copied from model text), are
// valid v2 frontmatter, and the planned body reads back (LF and CRLF).

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';
import { PlanFrontmatterSchema } from '../bin/lib/schemas/plan-frontmatter.js';
import {
  parsePlanBody,
  parsePlanClaims,
  parsePlanStructure,
  renderPlannedPlanMd,
  renderStubPlanMd,
  summarizePlanClaims,
  type PlanEntryFields,
  type PlannedSection,
} from '../bin/lib/plan-render.js';

const ENTRY: PlanEntryFields = {
  section: 1,
  suffix: 'a',
  slug: 'background',
  title: 'Background',
  purpose: 'Establish the prior work the mechanism builds on.',
  role: 'body',
  depends_on: ['introduction'],
  word_target: 300,
  voice: 'plain, expository',
  assigned_sources: ['luong2015', 'luong2015'],
};

const PLAN: PlannedSection = {
  claims: [
    { claim: 'Attention weighs every encoder state.', sources: ['bahdanau2015'], evidence: 'Alignment weights over all states.', counterexamples: 'Short sentences gain little.' },
    { claim: 'A framing claim with no source.', sources: [], evidence: '', counterexamples: '' },
  ],
  structure: [
    { paragraph: 2, purpose: 'Frame the section.', claims: [2] },
    { paragraph: 1, purpose: 'Explain additive attention.', claims: [1, 1] },
  ],
  voice: 'Plain and expository.',
};

const MARKER = '> OFFLINE MODE (--dry-run) — synthetic dry-run sources, not live results.';

test('D-18-17: the stub PLAN.md carries the outline entry, stub: true and status planned', () => {
  const md = renderStubPlanMd(ENTRY);
  const { frontmatter, body } = parseFrontmatter(md);
  assert.deepEqual(Object.keys(frontmatter), [
    'schema_version', 'section', 'suffix', 'slug', 'title', 'purpose', 'role', 'depends_on', 'word_target', 'voice',
    'assigned_sources', 'stub', 'status', 'verified_against_draft_hash',
  ]);
  assert.equal(frontmatter['schema_version'], 2);
  assert.equal(frontmatter['stub'], true);
  assert.equal(frontmatter['status'], 'planned');
  assert.deepEqual(frontmatter['assigned_sources'], ['luong2015'], 'deduplicated');
  assert.doesNotThrow(() => PlanFrontmatterSchema.parse(frontmatter));
  assert.equal(body.trim(), '## Outline entry\n\nEstablish the prior work the mechanism builds on.');
  // No voice / suffix → the keys are omitted, never written empty.
  const plain = parseFrontmatter(renderStubPlanMd({ ...ENTRY, suffix: undefined, voice: undefined, purpose: '' })).frontmatter;
  assert.equal('suffix' in plain, false);
  assert.equal('voice' in plain, false);
  assert.equal('purpose' in plain, false);
  // --dry-run: the marker goes after the first heading.
  assert.match(renderStubPlanMd(ENTRY, { marker: MARKER }), /## Outline entry\n\n> OFFLINE MODE \(--dry-run\)/);
});

test('D-18-23: the planned PLAN.md drops stub, keeps the entry and renders Claims/Structure/Word target/Voice', () => {
  const md = renderPlannedPlanMd({ ...ENTRY, wave: 2 }, PLAN);
  const { frontmatter, body } = parseFrontmatter(md);
  assert.equal(frontmatter['stub'], undefined);
  assert.equal(frontmatter['status'], 'planned');
  assert.equal(frontmatter['wave'], 2, 'a wave: override is carried over');
  assert.equal(frontmatter['purpose'], ENTRY.purpose);
  assert.doesNotThrow(() => PlanFrontmatterSchema.parse(frontmatter));
  for (const h of ['## Claims', '## Structure', '## Word target', '## Voice']) assert.ok(body.includes(h), h);
  assert.match(body, /^1\. Attention weighs every encoder state\.\n {3}- Sources: bahdanau2015\n {3}- Evidence: Alignment weights over all states\.\n {3}- Counterexamples: Short sentences gain little\.$/m);
  assert.match(body, /^2\. A framing claim with no source\.\n {3}- Sources: \(none\)$/m);
  assert.match(body, /^1\. Explain additive attention\. — claims 1$/m, 'paragraphs sorted, claim numbers deduplicated');
  assert.match(body, /^## Word target\n\n300 words$/m);
  assert.match(body, /^## Voice\n\nPlain and expository\.$/m);
});

test('GRND-13: parsePlanClaims / parsePlanBody read the planned body back — LF and CRLF, marker ignored', () => {
  const body = parseFrontmatter(renderPlannedPlanMd(ENTRY, PLAN, { marker: MARKER })).body;
  for (const text of [body, body.replace(/\n/g, '\r\n')]) {
    assert.deepEqual(parsePlanClaims(text), [
      { claim: 'Attention weighs every encoder state.', sources: ['bahdanau2015'], evidence: 'Alignment weights over all states.', counterexamples: 'Short sentences gain little.' },
      { claim: 'A framing claim with no source.', sources: [], evidence: '', counterexamples: '' },
    ]);
    assert.deepEqual(parsePlanStructure(text), [
      { paragraph: 1, purpose: 'Explain additive attention.', claims: [1] },
      { paragraph: 2, purpose: 'Frame the section.', claims: [2] },
    ]);
    const parsed = parsePlanBody(text);
    assert.equal(parsed.wordTarget, 300);
    assert.equal(parsed.voice, 'Plain and expository.');
  }
  assert.deepEqual(parsePlanClaims('## Brief\n\nA legacy body.\n'), [], 'a legacy (Phase 17) body has no claims');
});

test('GRND-12: summarizePlanClaims is bounded to 600 characters', () => {
  const body = parseFrontmatter(renderPlannedPlanMd(ENTRY, PLAN)).body;
  assert.equal(summarizePlanClaims(body), '1. Attention weighs every encoder state. 2. A framing claim with no source.', 'no citekeys: another section\'s sources stay out (FEED-01)');
  const many: PlannedSection = { ...PLAN, claims: Array.from({ length: 40 }, (_, i) => ({ claim: `Claim number ${i} states something long enough to matter.`, sources: ['a'], evidence: '', counterexamples: '' })) };
  const s = summarizePlanClaims(parseFrontmatter(renderPlannedPlanMd(ENTRY, many)).body);
  assert.ok(s.length <= 600, `${s.length}`);
  assert.ok(s.endsWith('…'));
  assert.equal(summarizePlanClaims(parseFrontmatter(renderStubPlanMd(ENTRY)).body), '', 'a stub has no claims');
});
