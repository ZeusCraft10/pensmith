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
//   - For each section in outline order, runCompile checks the verdicts the
//     section's VERIFICATION.json records for a failing verdict (FABRICATED /
//     MIS-CITED / NOT_FOUND).
//   - On ANY failing verdict (fresh OR surfaced by a staleness re-verify),
//     runCompile REFUSES: it returns { refused: true } naming the offending
//     section + citekey, and DOES NOT write .paper/DRAFT.md.
//
// These fixtures keep every section FRESH (the record is made from the seeded
// DRAFT.md) so the refuse comes straight from the recorded verdict — no
// network, no re-verify. Staleness re-verify is covered by
// tests/compile-staleness.test.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCompile } from '../bin/lib/compile.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';
import { bibForDrafts } from './lib/bib-fixture.js';
import { writeVerificationFixture, type CitationSpec, type QuoteSpec } from './lib/verification-fixture.js';

/**
 * Seed a paper root with an OUTLINE.md (locked GFM table) and one or more
 * sections. Each section spec carries its own DRAFT.md text, assigned_sources,
 * and the verdicts recorded in VERIFICATION.json. The record is made from the
 * draft, so the staleness path never triggers — the refuse is purely
 * verdict-driven.
 */
interface SectionSpec {
  n: number;
  slug: string;
  title: string;
  draft: string;
  assignedSources: string[];
  /** The recorded Pass-1 verdicts (default: OK for every cited key). */
  citations?: CitationSpec[];
  quotes?: QuoteSpec[];
  status?: 'verified' | 'failed' | 'unverifiable';
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

  // A CITATIONS.bib holding every work the drafts cite: compile refuses a
  // manuscript that cites a work the bibliography does not hold.
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), bibForDrafts(...specs.map((s) => s.draft)));

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
    writeVerificationFixture(dir, {
      n: s.n, slug: s.slug, draft: s.draft, assignedSources: s.assignedSources,
      ...(s.citations ? { citations: s.citations } : {}),
      ...(s.quotes ? { quotes: s.quotes } : {}),
      ...(s.status ? { status: s.status } : {}),
    });
  }
  return root;
}

test('COMP-01: a FABRICATED verdict makes runCompile REFUSE and skip the DRAFT.md write', async () => {
  const root = seedPaper([
    {
      n: 1, slug: 'intro', title: 'Intro',
      draft: '# Intro\n\nA grounded claim [@smith2020].\n',
      assignedSources: ['smith2020'],
    },
    {
      n: 2, slug: 'body', title: 'Body',
      draft: '# Body\n\nAn invented claim [@jones2019].\n',
      assignedSources: ['jones2019'],
      citations: [{ citekey: 'jones2019', verdict: 'FABRICATED', reason: 'citekey not in .paper/CITATIONS.bib (drafter invented)' }],
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
      citations: [{ citekey: 'smith2020', verdict: 'MIS-CITED', reason: 'the title does not match' }],
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
      quotes: [{ citekey: 'smith2020', quote: 'the claimed quote', verdict: 'NOT_FOUND', reason: 'quote not found in OA PDF' }],
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
    },
    {
      n: 2, slug: 'body', title: 'Body',
      draft: '# Body\n\nAnother grounded claim [@jones2019].\n',
      assignedSources: ['jones2019'],
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
// GATE-01 — fail closed on missing or unreadable verdicts.
//
// A section that was never verified (no VERIFICATION.json), whose record is
// not JSON, or whose record does not match its schema must NEVER compile, and
// neither does a record verify made when it could not check the section (a
// refusal, `checked: false`). VERIFICATION.md is only the rendering: a report
// with no record behind it compiles nothing.
//
// A checked section that is 'unverifiable' (a quotation nothing could check)
// does not block in this phase: it compiles, and compile warns.
// ---------------------------------------------------------------------------

/**
 * Seed a paper root with a single section whose VERIFICATION.json content is
 * controlled by the caller (null: no record at all). VERIFICATION.md holds a
 * clean-looking report either way, which must change nothing.
 */
function seedPaperWithRecord(draft: string, assignedSources: string[], record: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-gate01-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    [
      '# Gate01 Fixture',
      '',
      '| # | slug | title | depends_on | word target | assigned_sources |',
      '| --- | --- | --- | --- | --- | --- |',
      `| 1 | intro | Gate01Section | | 300 | ${assignedSources.join(', ')} |`,
      '',
    ].join('\n'),
  );
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), bibForDrafts(draft));
  const dir = join(root, '.paper', 'sections', '01-intro');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'DRAFT.md'), draft);
  writeFileSync(
    join(dir, 'PLAN.md'),
    [
      '---', 'section: 1', 'slug: intro', 'title: Gate01Section', 'depends_on: []',
      `assigned_sources: [${assignedSources.map((k) => `'${k}'`).join(', ')}]`,
      `verified_against_draft_hash: '${computeDraftHash(Buffer.from(draft, 'utf8'), assignedSources)}'`,
      'status: verified', '---', '', '# Gate01Section', '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'VERIFICATION.md'),
    '# VERIFICATION (Section 1, intro)\n\nStatus: verified\n\n## Pass-1\n\n- smith2020: **OK** — titleJW=1.00, authorJW=1.00 — ok\n',
  );
  if (record !== null) writeFileSync(join(dir, 'VERIFICATION.json'), record);
  return root;
}

const DRAFT = '# Intro\n\nA claim [@smith2020].\n';

for (const [what, record, phrase] of [
  ['no VERIFICATION.json', null, /never verified \(no VERIFICATION\.json\)/],
  ['a whitespace-only VERIFICATION.json', '   \n   \n', /could not be read \(VERIFICATION\.json is not JSON\)/],
  ['a VERIFICATION.json with no status', JSON.stringify({ $schemaVersion: 1, section: 1, slug: 'intro', citations: [] }), /does not match its schema/],
] as Array<[string, string | null, RegExp]>) {
  test(`GATE-01: a section with ${what} → runCompile refuses, whatever VERIFICATION.md says`, async () => {
    const root = seedPaperWithRecord(DRAFT, ['smith2020'], record);
    const result = await runCompile({ paperRoot: root, yolo: true, onWarn: () => {} });
    const reasons = (result.refuseReasons ?? []).join(' ');
    assert.equal(result.refused, true, reasons);
    assert.match(reasons, phrase);
    assert.match(reasons, /section 1 \(intro\)/, 'the refusal names the section');
    assert.equal(existsSync(join(root, '.paper', 'DRAFT.md')), false, 'no DRAFT.md is written');
  });
}

test('GATE-01: a valid record (verified, OK verdict) → compiles', async () => {
  const root = seedPaperWithRecord(DRAFT, ['smith2020'], null);
  writeVerificationFixture(join(root, '.paper', 'sections', '01-intro'), { n: 1, slug: 'intro', draft: DRAFT, assignedSources: ['smith2020'] });
  const result = await runCompile({ paperRoot: root, yolo: true, onWarn: () => {} });
  assert.equal(result.refused, false, (result.refuseReasons ?? []).join(' '));
  assert.equal(existsSync(join(root, '.paper', 'DRAFT.md')), true, 'DRAFT.md is written');
});

test('GATE-01: a record for another section → refuses', async () => {
  const root = seedPaperWithRecord(DRAFT, ['smith2020'], null);
  writeVerificationFixture(join(root, '.paper', 'sections', '01-intro'), { n: 2, slug: 'body', draft: DRAFT, assignedSources: ['smith2020'] });
  const result = await runCompile({ paperRoot: root, yolo: true, onWarn: () => {} });
  assert.equal(result.refused, true);
  assert.match((result.refuseReasons ?? []).join(' '), /record of section 2 \(body\)/);
});

test('GATE-01 (Pitfall 3): a checked section that is unverifiable (a quote with no source text) compiles, with a warning', async () => {
  const root = seedPaperWithRecord(DRAFT, ['smith2020'], null);
  writeVerificationFixture(join(root, '.paper', 'sections', '01-intro'), {
    n: 1, slug: 'intro', draft: DRAFT, assignedSources: ['smith2020'], status: 'unverifiable',
    quotes: [{ citekey: 'smith2020', quote: 'a quotation with no open-access text', verdict: 'PDF_UNAVAILABLE' }],
  });
  const warnings: string[] = [];
  const result = await runCompile({ paperRoot: root, yolo: true, onWarn: (m) => warnings.push(m) });
  assert.equal(result.refused, false, (result.refuseReasons ?? []).join(' '));
  assert.ok(warnings.some((w) => /could not be checked against the source text/.test(w)), warnings.join('\n'));
});

test('GATE-01: a record of a verify that could not check the section (CITATIONS.bib missing) → refuses', async () => {
  const root = seedPaperWithRecord(DRAFT, ['smith2020'], null);
  writeVerificationFixture(join(root, '.paper', 'sections', '01-intro'), {
    n: 1, slug: 'intro', draft: DRAFT, assignedSources: ['smith2020'], status: 'unverifiable', checked: false,
    reason: '.paper/CITATIONS.bib missing — run `pensmith research` first.', citations: [],
  });
  const result = await runCompile({ paperRoot: root, yolo: true, onWarn: () => {} });
  assert.equal(result.refused, true);
  assert.match((result.refuseReasons ?? []).join(' '), /not verified — \.paper\/CITATIONS\.bib missing/);
});

test('compile refuses a section whose record says verified but holds a blocking verdict', async () => {
  const root = seedPaperWithRecord(DRAFT, ['smith2020'], null);
  writeVerificationFixture(join(root, '.paper', 'sections', '01-intro'), {
    n: 1, slug: 'intro', draft: DRAFT, assignedSources: ['smith2020'], status: 'verified',
    citations: [{ citekey: 'smith2020', verdict: 'FABRICATED', reason: 'no registry holds it' }],
  });
  const result = await runCompile({ paperRoot: root, yolo: true, onWarn: () => {} });
  assert.equal(result.refused, true);
  assert.match((result.refuseReasons ?? []).join(' '), /citation \[@smith2020\] is FABRICATED — no registry holds it/);
});
