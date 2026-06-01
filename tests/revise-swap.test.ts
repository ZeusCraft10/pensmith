// tests/revise-swap.test.ts — RED suite for Plan 04-04 Task 1 (WRTE-02).
//
// Tests the runRevise chokepoint. All cases drive the --yolo path or stub
// the approval gate; the interactive @clack/prompts UI is NOT exercised in CI.
//
// Cassettes under tests/cassettes/ are pre-recorded LLM JSON responses
// (not HTTP cassettes — those live in tests/fixtures/cassettes/).
//
// Coverage:
//   1. accept + reset: swap cassette → DRAFT.md patched, hash → null
//   2. reject no-op: rejected cassette + user rejects → DRAFT.md unchanged
//   3. RETRY_EXHAUSTED: yolo + 2 bad responses → VERIFICATION.md gets RETRY_EXHAUSTED
//   4. --research cross-section isolation: sibling section mtime unchanged
//   5. REMOVE-ACTION edge cases:
//      a. compound [@a; @b] → remove one key, keep the other
//      b. sole key → strip entire [...] clause
//      c. duplicate citekey → disambiguate by patch.before_excerpt/after_excerpt

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

// This import will fail (RED) until bin/lib/revise.ts is created in Task 2.
import { runRevise } from '../bin/lib/revise.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal paper fixture for testing:
 *   <root>/.paper/sections/NN-slug/PLAN.md         — assigned_sources, voice hint
 *   <root>/.paper/sections/NN-slug/DRAFT.md        — body with citation tokens
 *   <root>/.paper/sections/NN-slug/VERIFICATION.md — one failing verdict
 *   <root>/.paper/CITATIONS.bib                    — minimal bib
 *   <root>/.paper/RESEARCH.md                      — project research file
 */
interface FixtureOpts {
  n: number;
  slug: string;
  assignedSources?: string[];
  draftContent?: string;
  verificationContent?: string;
  voiceHint?: string;
}

function seedFixture(opts: FixtureOpts): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-revise-test-'));
  const {
    n,
    slug,
    assignedSources = ['smith2019', 'wang2018'],
    draftContent,
    verificationContent,
    voiceHint = 'Voice: declarative, cite empirical evidence.',
  } = opts;

  const padded = String(n).padStart(2, '0');
  const secDir = join(root, '.paper', 'sections', `${padded}-${slug}`);
  mkdirSync(secDir, { recursive: true });
  mkdirSync(join(root, '.paper'), { recursive: true });

  // PLAN.md
  const planContent = [
    '---',
    `section: ${n}`,
    `slug: ${slug}`,
    `title: Test Section ${n}`,
    'depends_on: []',
    `assigned_sources: [${assignedSources.map((s) => `'${s}'`).join(', ')}]`,
    'verified_against_draft_hash: "deadbeef1234"',
    'status: written',
    '---',
    '',
    `## Brief`,
    ``,
    `Test section brief. ${voiceHint}`,
    '',
  ].join('\n');
  writeFileSync(join(secDir, 'PLAN.md'), planContent, 'utf8');

  // DRAFT.md
  const draft = draftContent ??
    `# Test Section\n\nSome supporting evidence [@jones2020] in the context of studies.\n`;
  writeFileSync(join(secDir, 'DRAFT.md'), draft, 'utf8');

  // VERIFICATION.md — one FABRICATED verdict
  const verification = verificationContent ??
    `# VERIFICATION (Section ${n}, ${slug})\n\nStatus: failed\n\n` +
    `## Pass-1 (citation integrity, deterministic — D-11 AND-gate)\n\n` +
    `- jones2020: **FABRICATED** — titleJW=0.00, authorJW=0.00 — citekey jones2020 not present in .paper/CITATIONS.bib (citation invented by drafter)\n`;
  writeFileSync(join(secDir, 'VERIFICATION.md'), verification, 'utf8');

  // CITATIONS.bib
  writeFileSync(
    join(root, '.paper', 'CITATIONS.bib'),
    `@article{smith2019,\n  title={Smith Study 2019},\n  author={Smith, John},\n  year={2019}\n}\n@article{wang2018,\n  title={Wang Research 2018},\n  author={Wang, Li},\n  year={2018}\n}\n`,
    'utf8',
  );

  // RESEARCH.md
  writeFileSync(join(root, '.paper', 'RESEARCH.md'), '# Research Log\n\n', 'utf8');

  return root;
}

/**
 * Read the cassette JSON from tests/cassettes/<name>.json and return it as a string.
 */
function loadCassetteJson(name: string): string {
  return readFileSync(join('tests', 'cassettes', `${name}.json`), 'utf8');
}

// ---------------------------------------------------------------------------
// Test 1: accept + reset — swap cassette → DRAFT.md patched, hash → null
// ---------------------------------------------------------------------------
test('revise: accept swap → DRAFT.md patched and verified_against_draft_hash reset to null', async () => {
  const root = seedFixture({ n: 2, slug: 'methods' });
  const cassetteResponse = loadCassetteJson('revise-swap-suggest');

  const result = await runRevise({
    paperRoot: root,
    n: 2,
    slug: 'methods',
    yolo: true,
    _llmResponseOverride: cassetteResponse,
  });

  // DRAFT.md must be patched (original token replaced)
  const draftPath = join(root, '.paper', 'sections', '02-methods', 'DRAFT.md');
  const draft = readFileSync(draftPath, 'utf8');
  assert.ok(!draft.includes('[@jones2020]'), 'flagged citekey must be removed from DRAFT.md');
  assert.ok(draft.includes('[@smith2019]'), 'replacement citekey must appear in DRAFT.md');

  // PLAN.md verified_against_draft_hash must be null
  const planPath = join(root, '.paper', 'sections', '02-methods', 'PLAN.md');
  const planText = readFileSync(planPath, 'utf8');
  assert.match(planText, /verified_against_draft_hash:\s*null/, 'hash must be reset to null');

  assert.ok(result.accepted === true, 'result.accepted must be true');
});

// ---------------------------------------------------------------------------
// Test 2: reject no-op — rejected cassette + user rejects → DRAFT.md unchanged
// ---------------------------------------------------------------------------
test('revise: user rejects → DRAFT.md unchanged, exit 0', async () => {
  const root = seedFixture({ n: 2, slug: 'methods' });
  const originalDraft = readFileSync(join(root, '.paper', 'sections', '02-methods', 'DRAFT.md'), 'utf8');
  const cassetteResponse = loadCassetteJson('revise-swap-rejected');

  const result = await runRevise({
    paperRoot: root,
    n: 2,
    slug: 'methods',
    yolo: false,
    _forceReject: true,                  // test-only: simulate user pressing "reject"
    _llmResponseOverride: cassetteResponse,
  });

  // DRAFT.md must be unchanged
  const afterDraft = readFileSync(join(root, '.paper', 'sections', '02-methods', 'DRAFT.md'), 'utf8');
  assert.equal(afterDraft, originalDraft, 'DRAFT.md must be unchanged after rejection');
  assert.ok(result.accepted === false, 'result.accepted must be false');
});

// ---------------------------------------------------------------------------
// Test 3: RETRY_EXHAUSTED — yolo + 2 failed attempts → VERIFICATION.md updated
// ---------------------------------------------------------------------------
test('revise: --yolo retry exhaustion writes RETRY_EXHAUSTED to VERIFICATION.md', async () => {
  const root = seedFixture({ n: 2, slug: 'methods' });

  const result = await runRevise({
    paperRoot: root,
    n: 2,
    slug: 'methods',
    yolo: true,
    _llmResponseOverride: '{ "action": "invalid_action" }',  // invalid every time → always rejected at validation
    _maxRetries: 2,
  });

  const verifPath = join(root, '.paper', 'sections', '02-methods', 'VERIFICATION.md');
  const verif = readFileSync(verifPath, 'utf8');
  assert.match(verif, /RETRY_EXHAUSTED/, 'VERIFICATION.md must contain RETRY_EXHAUSTED after cap exhaustion');
  assert.ok(result.status === 'retry_exhausted', 'result.status must be retry_exhausted');
});

// ---------------------------------------------------------------------------
// Test 4: --research cross-section isolation — sibling mtime unchanged
// ---------------------------------------------------------------------------
test('revise: --research only writes to project RESEARCH.md and section RESEARCH-LOG.md; sibling section untouched', async () => {
  const root = seedFixture({ n: 2, slug: 'methods' });

  // Seed a sibling section (section 3) so we can check its mtime
  const siblingDir = join(root, '.paper', 'sections', '03-results');
  mkdirSync(siblingDir, { recursive: true });
  const siblingPlanPath = join(siblingDir, 'PLAN.md');
  writeFileSync(siblingPlanPath, '---\nsection: 3\nslug: results\ntitle: Results\n---\n', 'utf8');
  const siblingMtime = statSync(siblingPlanPath).mtimeMs;

  await runRevise({
    paperRoot: root,
    n: 2,
    slug: 'methods',
    yolo: true,
    research: 'attention mechanisms in deep learning',
    _skipLlmRevise: true,   // test-only: skip the citation-swap step, only run --research
  });

  // Project RESEARCH.md must be updated
  const projectResearch = readFileSync(join(root, '.paper', 'RESEARCH.md'), 'utf8');
  assert.match(projectResearch, /attention mechanisms/, 'project RESEARCH.md must contain the research query');

  // Section RESEARCH-LOG.md must be created for section 2
  const researchLog = readFileSync(join(root, '.paper', 'sections', '02-methods', 'RESEARCH-LOG.md'), 'utf8');
  assert.match(researchLog, /attention mechanisms/, 'section RESEARCH-LOG.md must contain the query');

  // Sibling section PLAN.md mtime must be unchanged
  const siblingMtimeAfter = statSync(siblingPlanPath).mtimeMs;
  assert.equal(siblingMtimeAfter, siblingMtime, 'sibling section PLAN.md mtime must not change (cross-section isolation)');
});

// ---------------------------------------------------------------------------
// Test 5a: REMOVE-ACTION — compound [@a; @b] — remove one key, preserve the other
// ---------------------------------------------------------------------------
test('revise: remove action on compound [@a; @b] leaves [@b] intact', async () => {
  // Build a cassette for compound removal (revise-swap-remove.json is the basis)
  const compoundCassette = JSON.stringify({
    action: 'remove',
    flagged_citekey: 'fabricated2021',
    replacement_citekey: null,
    rationale: 'No support in assigned sources.',
    patch: {
      before_excerpt: 'claim [@fabricated2021; @smith2019] more',
      after_excerpt: 'claim [@smith2019] more',
    },
  });

  const draftWithCompound = `# Test\n\nThe claim [@fabricated2021; @smith2019] more context here.\n`;
  const verifContent =
    `# VERIFICATION\n\nStatus: failed\n\n## Pass-1 (citation integrity, deterministic — D-11 AND-gate)\n\n` +
    `- fabricated2021: **FABRICATED** — titleJW=0.00, authorJW=0.00 — citekey fabricated2021 not present in .paper/CITATIONS.bib\n`;

  const root = seedFixture({
    n: 2,
    slug: 'methods',
    assignedSources: ['smith2019', 'wang2018'],
    draftContent: draftWithCompound,
    verificationContent: verifContent,
  });

  await runRevise({
    paperRoot: root,
    n: 2,
    slug: 'methods',
    yolo: true,
    _llmResponseOverride: compoundCassette,
  });

  const draft = readFileSync(join(root, '.paper', 'sections', '02-methods', 'DRAFT.md'), 'utf8');
  assert.ok(!draft.includes('fabricated2021'), 'fabricated2021 must be removed');
  assert.ok(draft.includes('[@smith2019]'), 'smith2019 must remain in the bracket');
  assert.ok(!draft.includes('[@fabricated2021; @smith2019]'), 'compound token must be gone');
});

// ---------------------------------------------------------------------------
// Test 5b: REMOVE-ACTION — sole key → strip entire [...] clause
// ---------------------------------------------------------------------------
test('revise: remove action on sole [@key] strips entire [...] clause', async () => {
  const singleCassette = JSON.stringify({
    action: 'remove',
    flagged_citekey: 'fabricated2021',
    replacement_citekey: null,
    rationale: 'No support.',
    patch: {
      before_excerpt: 'claim [@fabricated2021] more',
      after_excerpt: 'claim more',
    },
  });

  const draftWithSole = `# Test\n\nThe claim [@fabricated2021] more context here.\n`;
  const verifContent =
    `# VERIFICATION\n\nStatus: failed\n\n## Pass-1 (citation integrity, deterministic — D-11 AND-gate)\n\n` +
    `- fabricated2021: **FABRICATED** — titleJW=0.00, authorJW=0.00 — citekey not in bib\n`;

  const root = seedFixture({
    n: 2,
    slug: 'methods',
    assignedSources: ['smith2019', 'wang2018'],
    draftContent: draftWithSole,
    verificationContent: verifContent,
  });

  await runRevise({
    paperRoot: root,
    n: 2,
    slug: 'methods',
    yolo: true,
    _llmResponseOverride: singleCassette,
  });

  const draft = readFileSync(join(root, '.paper', 'sections', '02-methods', 'DRAFT.md'), 'utf8');
  assert.ok(!draft.includes('[@fabricated2021]'), 'sole token must be removed');
  assert.ok(!draft.includes('[@fabricated2021'), 'no residual bracket must remain');
  // Surrounding prose must be preserved (no double space)
  assert.ok(draft.includes('claim more context'), 'surrounding prose must be preserved');
});

// ---------------------------------------------------------------------------
// Test 5c: REMOVE-ACTION — citekey appears twice → only the matched occurrence is affected
// ---------------------------------------------------------------------------
test('revise: remove action disambiguates by before_excerpt when citekey appears twice', async () => {
  const disambigCassette = JSON.stringify({
    action: 'remove',
    flagged_citekey: 'jones2020',
    replacement_citekey: null,
    rationale: 'No support for this specific claim.',
    patch: {
      before_excerpt: 'Second claim [@jones2020] in the middle',
      after_excerpt: 'Second claim in the middle',
    },
  });

  // Draft has jones2020 twice
  const draftTwice =
    `# Test\n\nFirst claim [@jones2020] at start.\n\nSecond claim [@jones2020] in the middle of text.\n`;
  const verifContent =
    `# VERIFICATION\n\nStatus: failed\n\n## Pass-1 (citation integrity, deterministic — D-11 AND-gate)\n\n` +
    `- jones2020: **FABRICATED** — titleJW=0.00, authorJW=0.00 — citekey not in bib\n`;

  const root = seedFixture({
    n: 2,
    slug: 'methods',
    assignedSources: ['smith2019', 'wang2018'],
    draftContent: draftTwice,
    verificationContent: verifContent,
  });

  await runRevise({
    paperRoot: root,
    n: 2,
    slug: 'methods',
    yolo: true,
    _llmResponseOverride: disambigCassette,
  });

  const draft = readFileSync(join(root, '.paper', 'sections', '02-methods', 'DRAFT.md'), 'utf8');
  // Second occurrence must be gone (matched by before_excerpt)
  assert.ok(!draft.includes('Second claim [@jones2020]'), 'second occurrence must be removed');
  // First occurrence must be UNTOUCHED (different context)
  assert.ok(draft.includes('First claim [@jones2020]'), 'first occurrence must remain (different context)');
});

// ---------------------------------------------------------------------------
// Test 6: LLM injection mitigation — replacement_citekey not in assigned_sources → rejected
// ---------------------------------------------------------------------------
test('revise: rejects LLM response with replacement_citekey outside assigned_sources', async () => {
  const injectionCassette = JSON.stringify({
    action: 'swap',
    flagged_citekey: 'jones2020',
    replacement_citekey: 'outside-assigned',  // NOT in assigned_sources = ['smith2019', 'wang2018']
    rationale: 'outside-assigned is a perfect fit.',
    patch: {
      before_excerpt: 'evidence [@jones2020] in the',
      after_excerpt: 'evidence [@outside-assigned] in the',
    },
  });

  const root = seedFixture({ n: 2, slug: 'methods' });
  const originalDraft = readFileSync(join(root, '.paper', 'sections', '02-methods', 'DRAFT.md'), 'utf8');

  await assert.rejects(
    () => runRevise({
      paperRoot: root,
      n: 2,
      slug: 'methods',
      yolo: true,
      _llmResponseOverride: injectionCassette,
      _throwOnInvalidResponse: true,   // test-only: surface validation error as throw
    }),
    /not in assigned_sources|invalid replacement/i,
    'must reject when replacement_citekey is outside assigned_sources',
  );

  // DRAFT.md must be unchanged
  const afterDraft = readFileSync(join(root, '.paper', 'sections', '02-methods', 'DRAFT.md'), 'utf8');
  assert.equal(afterDraft, originalDraft, 'DRAFT.md must be unchanged after injection rejection');
});

// Void the async import to prevent unhandled-rejection noise in RED phase
void readFile;
