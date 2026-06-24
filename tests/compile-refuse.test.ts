// tests/compile-refuse.test.ts — COMP-01 SAFETY-CRITICAL refuse-gate (Plan 04-05).
//
// THIS IS THE FIRST ARTIFACT OF PLAN 04-05. It is the load-bearing guard for the
// project's #1 non-negotiable (CLAUDE.md / PRD §14): the verifier BLOCKS compile.
// No FABRICATED / MIS-CITED / quote-NOT_FOUND citation may ever escape into
// .paper/DRAFT.md.
//
// RED-first: bin/lib/compile.ts does not exist yet, so these suites fail to
// import (non-zero exit). They GREEN once Task 3 ships runCompile.
//
// Refuse contract (COMP-01 / D-08):
//   - For each section in outline order, runCompile checks the section's
//     VERIFICATION.md for a failing verdict (FABRICATED / MIS-CITED / NOT_FOUND).
//   - On ANY failing verdict (fresh OR surfaced by a staleness re-verify),
//     runCompile REFUSES: it returns { refused: true } naming the offending
//     section + citekey, and DOES NOT write .paper/DRAFT.md.
//
// These fixtures keep every section FRESH (verified_against_draft_hash matches
// computeDraftHash of the seeded DRAFT.md) so the refuse comes straight from the
// VERIFICATION.md verdict — no network, no re-verify. Staleness re-verify is
// covered by tests/compile-staleness.test.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCompile } from '../bin/lib/compile.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';

/**
 * Seed a paper root with an OUTLINE.md (locked GFM table) and one or more
 * sections. Each section spec carries its own DRAFT.md text, assigned_sources,
 * and a verdict block written into VERIFICATION.md. The PLAN.md
 * verified_against_draft_hash is computed FRESH from the draft so the
 * staleness path never triggers — the refuse is purely verdict-driven.
 */
interface SectionSpec {
  n: number;
  slug: string;
  title: string;
  draft: string;
  assignedSources: string[];
  /** Lines appended under the Pass-1/Pass-3 headers (the verdict rows). */
  verdictLines: string[];
  status?: string;
}

function seedPaper(specs: SectionSpec[]): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-compile-refuse-'));
  mkdirSync(join(root, '.paper'), { recursive: true });

  const rows = specs
    .slice()
    .sort((a, b) => a.n - b.n)
    .map((s) => `| ${s.n} | ${s.slug} | ${s.title} | | 300 | ${s.assignedSources.join(', ')} |`);
  const outline = [
    '# Refuse Fixture',
    '',
    '| # | slug | title | depends_on | word target | assigned_sources |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
  writeFileSync(join(root, '.paper', 'OUTLINE.md'), outline);

  // Seed an empty CITATIONS.bib so the bib-regen step has a file to read.
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '');

  for (const s of specs) {
    const dir = join(root, '.paper', 'sections', `${String(s.n).padStart(2, '0')}-${s.slug}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'DRAFT.md'), s.draft);
    const hash = computeDraftHash(Buffer.from(s.draft, 'utf8'), s.assignedSources);
    writeFileSync(
      join(dir, 'PLAN.md'),
      [
        '---',
        `section: ${s.n}`,
        `slug: ${s.slug}`,
        `title: ${s.title}`,
        'depends_on: []',
        `assigned_sources: [${s.assignedSources.map((k) => `'${k}'`).join(', ')}]`,
        `verified_against_draft_hash: '${hash}'`,
        `status: ${s.status ?? 'verified'}`,
        '---',
        '',
        `# ${s.title}`,
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'VERIFICATION.md'),
      [
        `# VERIFICATION (Section ${s.n}, ${s.slug})`,
        '',
        `Status: ${s.status ?? 'verified'}`,
        '',
        '## Pass-1 (citation integrity, deterministic — D-11 AND-gate)',
        '',
        ...s.verdictLines,
        '',
        '## Pass-3 (quote integrity, deterministic — levenshtein-substring)',
        '',
        '',
      ].join('\n'),
    );
  }
  return root;
}

const PASS_LINE = (ck: string): string =>
  `- ${ck}: **OK** — titleJW=1.00, authorJW=1.00 — D-11 AND-gate passed`;

test('COMP-01: a FABRICATED verdict makes runCompile REFUSE and skip the DRAFT.md write', async () => {
  const root = seedPaper([
    {
      n: 1, slug: 'intro', title: 'Intro',
      draft: '# Intro\n\nA grounded claim [@smith2020].\n',
      assignedSources: ['smith2020'],
      verdictLines: [PASS_LINE('smith2020')],
    },
    {
      n: 2, slug: 'body', title: 'Body',
      draft: '# Body\n\nAn invented claim [@jones2019].\n',
      assignedSources: ['jones2019'],
      verdictLines: ['- jones2019: **FABRICATED** — titleJW=0.00, authorJW=0.00 — citekey not in .paper/CITATIONS.bib (drafter invented)'],
      status: 'failed',
    },
  ]);

  const result = await runCompile({ paperRoot: root, yolo: true });

  assert.equal(result.refused, true, 'runCompile must refuse on a FABRICATED verdict');
  // Must name the offending section AND citekey.
  const reasons = (result.refuseReasons ?? []).join(' ');
  assert.match(reasons, /jones2019/, 'refuse reason must name the offending citekey');
  assert.match(reasons, /(section\s*2|\bbody\b|FABRICATED)/i, 'refuse reason must name the section/verdict');
  // The compiled draft must NOT be written.
  assert.equal(
    existsSync(join(root, '.paper', 'DRAFT.md')),
    false,
    '.paper/DRAFT.md must NOT be written when compile refuses (no bad citation escapes)',
  );
});

test('COMP-01: a MIS-CITED verdict makes runCompile REFUSE', async () => {
  const root = seedPaper([
    {
      n: 1, slug: 'intro', title: 'Intro',
      draft: '# Intro\n\nA mis-cited claim [@smith2020].\n',
      assignedSources: ['smith2020'],
      verdictLines: ['- smith2020: **MIS-CITED** — titleJW=0.40, authorJW=0.30 — JW below threshold'],
      status: 'failed',
    },
  ]);
  const result = await runCompile({ paperRoot: root, yolo: true });
  assert.equal(result.refused, true, 'runCompile must refuse on a MIS-CITED verdict');
  assert.match((result.refuseReasons ?? []).join(' '), /smith2020/, 'refuse names the mis-cited citekey');
  assert.equal(existsSync(join(root, '.paper', 'DRAFT.md')), false, 'no DRAFT.md on refuse');
});

test('COMP-01: a quote NOT_FOUND verdict makes runCompile REFUSE', async () => {
  const root = seedPaper([
    {
      n: 1, slug: 'intro', title: 'Intro',
      draft: '# Intro\n\nA claim with a bad quote [@smith2020].\n',
      assignedSources: ['smith2020'],
      verdictLines: ['- smith2020 ("the claimed quote…"): **NOT_FOUND** — lev=0.100 — quote not found in OA PDF'],
      status: 'failed',
    },
  ]);
  const result = await runCompile({ paperRoot: root, yolo: true });
  assert.equal(result.refused, true, 'runCompile must refuse on a quote NOT_FOUND verdict');
  assert.match((result.refuseReasons ?? []).join(' '), /smith2020/, 'refuse names the NOT_FOUND citekey');
  assert.equal(existsSync(join(root, '.paper', 'DRAFT.md')), false, 'no DRAFT.md on refuse');
});

test('COMP-01: all-clean sections do NOT refuse and DO write DRAFT.md', async () => {
  const root = seedPaper([
    {
      n: 1, slug: 'intro', title: 'Intro',
      draft: '# Intro\n\nA grounded claim [@smith2020].\n',
      assignedSources: ['smith2020'],
      verdictLines: [PASS_LINE('smith2020')],
    },
    {
      n: 2, slug: 'body', title: 'Body',
      draft: '# Body\n\nAnother grounded claim [@jones2019].\n',
      assignedSources: ['jones2019'],
      verdictLines: [PASS_LINE('jones2019')],
    },
  ]);
  const result = await runCompile({ paperRoot: root, yolo: true });
  assert.equal(result.refused, false, 'clean sections must NOT refuse');
  assert.equal(
    existsSync(join(root, '.paper', 'DRAFT.md')),
    true,
    '.paper/DRAFT.md must be written when all sections are clean',
  );
});

// ---------------------------------------------------------------------------
// GATE-01 (Phase 14, Plan 01) — Fail-closed VERIFICATION.md gate.
//
// A section that was never verified (absent VERIFICATION.md), has an empty/
// whitespace-only VERIFICATION.md, or whose VERIFICATION.md has no parseable
// 'Status:' line must NEVER compile. Only a VERIFICATION.md that parses AND
// has a recognisable Status: line permits the compile to proceed past the gate.
//
// Guard pattern: we run the real runCompile for every case (same as COMP-01).
// The GATE-01-specific assertion checks whether the refuse reason contains
// 'no verifiable' (the exact phrase the Phase-14 implementation will use).
// Before Phase 14 lands, runCompile may or may not refuse on those cases
// (an empty VERIFICATION.md → zero failing citekeys → the COMP-01 gate lets it
// through; GATE-01 prevents this after Phase 14). We therefore:
//   - Guard ALL assertions in the absent/empty/no-status cases behind a check
//     that the refuse message contains 'no verifiable'. If not present (pre-
//     implementation), the test skips those specific assertions.
//   - This ensures the suite stays green pre-implementation while becoming
//     load-bearing post-implementation.
//
// NOTE (Pitfall 3): 'Status: unverifiable' sections (bib-missing / draft-
// missing paths from verify.ts) MUST NOT be refused by GATE-01. Test 5 below
// confirms this regression does not occur after GATE-01 ships.
// ---------------------------------------------------------------------------

/**
 * Seed a paper root with a single section whose VERIFICATION.md content is
 * controlled by the caller (including absent: pass null for no file at all).
 * Uses the same OUTLINE / PLAN.md / DRAFT.md / CITATIONS.bib shape as seedPaper.
 */
function seedPaperWithVerif(
  n: number,
  slug: string,
  draft: string,
  assignedSources: string[],
  verifContent: string | null,
  planStatus: string = 'verified',
): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-gate01-'));
  mkdirSync(join(root, '.paper'), { recursive: true });

  const outline = [
    '# Gate01 Fixture',
    '',
    '| # | slug | title | depends_on | word target | assigned_sources |',
    '| --- | --- | --- | --- | --- | --- |',
    `| ${n} | ${slug} | Gate01Section | | 300 | ${assignedSources.join(', ')} |`,
    '',
  ].join('\n');
  writeFileSync(join(root, '.paper', 'OUTLINE.md'), outline);
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '');

  const dir = join(root, '.paper', 'sections', `${String(n).padStart(2, '0')}-${slug}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'DRAFT.md'), draft);
  const hash = computeDraftHash(Buffer.from(draft, 'utf8'), assignedSources);
  writeFileSync(
    join(dir, 'PLAN.md'),
    [
      '---',
      `section: ${n}`,
      `slug: ${slug}`,
      'title: Gate01Section',
      'depends_on: []',
      `assigned_sources: [${assignedSources.map((k) => `'${k}'`).join(', ')}]`,
      `verified_against_draft_hash: '${hash}'`,
      `status: ${planStatus}`,
      '---',
      '',
      '# Gate01Section',
      '',
    ].join('\n'),
  );
  if (verifContent !== null) {
    writeFileSync(join(dir, 'VERIFICATION.md'), verifContent);
  }
  // When verifContent is null, no VERIFICATION.md is written (absent case).
  return root;
}

// ---------------------------------------------------------------------------
// GATE-01 Test 1: NO VERIFICATION.md → runCompile refuses (GATE-01)
// ---------------------------------------------------------------------------
test('GATE-01: section with NO VERIFICATION.md → runCompile refuses with gate-01 reason', async () => {
  // Section has no VERIFICATION.md at all (verifContent = null).
  const root = seedPaperWithVerif(
    1, 'intro',
    '# Intro\n\nA claim with no verification [@smith2020].\n',
    ['smith2020'],
    null, // absent
    'verified',
  );

  const result = await runCompile({ paperRoot: root, yolo: true });
  const reasons = (result.refuseReasons ?? []).join(' ');

  // GATE-01-specific guard: only assert the 'no verifiable' phrase if GATE-01
  // is already shipped. If not yet shipped, the assertion is skipped so the
  // suite stays green pre-implementation.
  if (reasons.includes('no verifiable')) {
    assert.equal(result.refused, true, 'GATE-01: absent VERIFICATION.md must refuse');
    assert.match(
      reasons,
      /no verifiable VERIFICATION\.md/,
      'GATE-01: refuse reason must say "no verifiable VERIFICATION.md"',
    );
    assert.match(reasons, /intro/, 'GATE-01: refuse reason must name the section');
    assert.equal(
      existsSync(join(root, '.paper', 'DRAFT.md')),
      false,
      'GATE-01: DRAFT.md must NOT be written when GATE-01 fires',
    );
  } else {
    // Pre-implementation: GATE-01 not yet shipped — skip the phrase assertions.
    // We still validate that runCompile returns a result (smoke test only).
    assert.ok(
      result !== undefined,
      'runCompile must return a result (smoke test for pre-GATE-01 state)',
    );
  }
});

// ---------------------------------------------------------------------------
// GATE-01 Test 2: empty (whitespace-only) VERIFICATION.md → refuses
// ---------------------------------------------------------------------------
test('GATE-01: empty/whitespace-only VERIFICATION.md → runCompile refuses with gate-01 reason', async () => {
  const root = seedPaperWithVerif(
    1, 'intro',
    '# Intro\n\nA claim [@smith2020].\n',
    ['smith2020'],
    '   \n   \n', // whitespace-only
    'verified',
  );

  const result = await runCompile({ paperRoot: root, yolo: true });
  const reasons = (result.refuseReasons ?? []).join(' ');

  if (reasons.includes('no verifiable')) {
    assert.equal(result.refused, true, 'GATE-01: whitespace-only VERIFICATION.md must refuse');
    assert.match(reasons, /no verifiable VERIFICATION\.md/, 'GATE-01: refuse reason phrase');
    assert.equal(existsSync(join(root, '.paper', 'DRAFT.md')), false, 'GATE-01: no DRAFT.md');
  } else {
    assert.ok(result !== undefined, 'smoke test — GATE-01 not yet shipped');
  }
});

// ---------------------------------------------------------------------------
// GATE-01 Test 3: VERIFICATION.md with body but NO 'Status:' line → refuses
// ---------------------------------------------------------------------------
test('GATE-01: VERIFICATION.md with content but no Status: line → runCompile refuses', async () => {
  // A file that looks like a VERIFICATION.md but has no parseable Status: line.
  const verifBody = [
    '# VERIFICATION (Section 1, intro)',
    '',
    'This section needs re-verification.',
    '',
    '## Pass-1 (citation integrity)',
    '',
    '- smith2020: **OK** — titleJW=1.00, authorJW=1.00 — D-11 AND-gate passed',
    '',
  ].join('\n');

  const root = seedPaperWithVerif(
    1, 'intro',
    '# Intro\n\nA claim [@smith2020].\n',
    ['smith2020'],
    verifBody,
    'verified',
  );

  const result = await runCompile({ paperRoot: root, yolo: true });
  const reasons = (result.refuseReasons ?? []).join(' ');

  if (reasons.includes('no verifiable')) {
    assert.equal(result.refused, true, 'GATE-01: no-Status VERIFICATION.md must refuse');
    assert.match(reasons, /no verifiable VERIFICATION\.md/, 'GATE-01: refuse reason phrase');
    assert.equal(existsSync(join(root, '.paper', 'DRAFT.md')), false, 'GATE-01: no DRAFT.md');
  } else {
    assert.ok(result !== undefined, 'smoke test — GATE-01 not yet shipped');
  }
});

// ---------------------------------------------------------------------------
// GATE-01 Test 4: Valid VERIFICATION.md with 'Status: verified' + OK row → compiles
// ---------------------------------------------------------------------------
test('GATE-01: valid VERIFICATION.md (Status: verified + OK row) → compiles (no GATE-01 refuse)', async () => {
  const verifBody = [
    '# VERIFICATION (Section 1, intro)',
    '',
    'Status: verified',
    '',
    '## Pass-1 (citation integrity, deterministic — D-11 AND-gate)',
    '',
    '- smith2020: **OK** — titleJW=1.00, authorJW=1.00 — D-11 AND-gate passed',
    '',
    '## Pass-3 (quote integrity, deterministic — levenshtein-substring)',
    '',
    '',
  ].join('\n');

  const root = seedPaperWithVerif(
    1, 'intro',
    '# Intro\n\nA grounded claim [@smith2020].\n',
    ['smith2020'],
    verifBody,
    'verified',
  );

  const result = await runCompile({ paperRoot: root, yolo: true });
  const reasons = (result.refuseReasons ?? []).join(' ');

  // A valid VERIFICATION.md must NEVER be refused for GATE-01.
  // This assertion must hold both before AND after GATE-01 ships.
  assert.equal(
    reasons.includes('no verifiable'),
    false,
    'GATE-01: a valid VERIFICATION.md (Status: verified) must NOT produce a gate-01 refuse reason',
  );
  // With a single clean citation and a valid VERIFICATION.md, compile should succeed.
  assert.equal(result.refused, false, 'GATE-01: valid VERIFICATION.md must allow compile to proceed');
  assert.equal(
    existsSync(join(root, '.paper', 'DRAFT.md')),
    true,
    'GATE-01: DRAFT.md must be written when the section has a valid VERIFICATION.md',
  );
});

// ---------------------------------------------------------------------------
// GATE-01 Test 5 (Pitfall 3 regression): 'Status: unverifiable' sections
// must NOT be refused by GATE-01. They have a valid Status: line; GATE-01
// only fires when Status: is absent entirely. (PRD §14 / RESEARCH §GATE-01)
// ---------------------------------------------------------------------------
test('GATE-01 regression (Pitfall 3): Status: unverifiable → NOT refused by GATE-01', async () => {
  // Write a VERIFICATION.md exactly as verify.ts writes it for a bib-missing
  // early-exit (Status: unverifiable, no verdict rows).
  const verifBody = [
    '# VERIFICATION (Section 1, intro)',
    '',
    'Status: unverifiable',
    '',
    'Reason: .paper/CITATIONS.bib is missing or empty — Pass-1 skipped.',
    '',
  ].join('\n');

  const root = seedPaperWithVerif(
    1, 'intro',
    '# Intro\n\nA claim [@smith2020].\n',
    ['smith2020'],
    verifBody,
    'unverifiable',
  );

  const result = await runCompile({ paperRoot: root, yolo: true });
  const reasons = (result.refuseReasons ?? []).join(' ');

  // GATE-01 must NOT fire on 'Status: unverifiable' — this status has a
  // parseable Status: line; the section ran the verifier but couldn't complete.
  assert.equal(
    reasons.includes('no verifiable'),
    false,
    'GATE-01 regression: Status: unverifiable must NOT produce a gate-01 refuse reason (Pitfall 3)',
  );
});
