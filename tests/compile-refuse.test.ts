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
