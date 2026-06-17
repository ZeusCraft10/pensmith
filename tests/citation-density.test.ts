// tests/citation-density.test.ts — COMP-05 citation density vs discipline target.
//
// RED-first: bin/lib/citation-density.ts does not exist yet.
//
// COMP-05 (canonical): citation density (per-section + paper-wide mean/stdev) is
// computed and compared to the discipline preset target. WARN-only — never
// blocks, never throws.
//
// D-14 §3 (LOCKED): the `## Citation Density` body carries per-section
// {citations_per_1000_words} plus paper-wide mean and stdev. COMP-05 adds the
// comparison to the discipline preset target.
//
// Signature: computeCitationDensity(sections, discipline) → CitationDensityReport
//   sections: { n, slug, text }[]; counts citations via extractCitekeys over text,
//   counts words, computes citations_per_1000_words; then paper-wide mean+stdev
//   and a target-comparison verdict ('below' | 'within' | 'above').

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCitationDensity, type CitationDensityReport } from '../bin/lib/citation-density.js';

test('COMP-05: per-section citations_per_1000_words is computed from citekeys + word count', () => {
  // 10 words, 2 distinct citations → 2 / 10 * 1000 = 200 per 1000 words.
  const text = 'one two three four five six seven eight [@a] [@b]';
  const report: CitationDensityReport = computeCitationDensity(
    [{ n: 1, slug: 'intro', text }],
    'cs',
  );
  assert.equal(report.sections.length, 1);
  const sec = report.sections[0]!;
  assert.equal(sec.slug, 'intro');
  // 10 whitespace-delimited tokens, 2 citation tokens → density 200.
  assert.ok(Math.abs(sec.citations_per_1000_words - 200) < 1e-6, `expected ~200, got ${sec.citations_per_1000_words}`);
});

test('COMP-05: paper-wide mean and stdev across sections', () => {
  // Section A: 5 words, 1 citation → 200/1000.
  // Section B: 5 words, 3 citations → 600/1000.
  const report = computeCitationDensity(
    [
      { n: 1, slug: 'a', text: 'w w w w [@x]' },
      { n: 2, slug: 'b', text: 'w w [@x] [@y] [@z]' },
    ],
    'cs',
  );
  // densities: a = 1/5*1000 = 200 ; b = 3/5*1000 = 600. mean = 400.
  assert.ok(Math.abs(report.mean - 400) < 1e-6, `mean expected 400, got ${report.mean}`);
  // population stdev of [200,600] = 200.
  assert.ok(Math.abs(report.stdev - 200) < 1e-6, `stdev expected 200, got ${report.stdev}`);
});

test('COMP-05: discipline target comparison emits a WARN when the mean is outside the band', () => {
  // Build a paper with a very LOW density so the mean falls below any sane target.
  const lowText = Array(200).fill('word').join(' ') + ' [@only]'; // ~5 per 1000
  const report = computeCitationDensity([{ n: 1, slug: 's', text: lowText }], 'cs');
  assert.ok(typeof report.target === 'number', 'a discipline target must be resolved');
  assert.equal(report.comparison, 'below', 'a very low density must compare "below" the target');
  assert.ok(report.warnings.length >= 1, 'a below-target density must emit at least one WARN');
});

test('COMP-05: an unknown/unset discipline falls back to a documented default target (no throw)', () => {
  assert.doesNotThrow(() => computeCitationDensity([{ n: 1, slug: 's', text: 'w w [@a]' }], 'totally-unknown-discipline'));
  const report = computeCitationDensity([{ n: 1, slug: 's', text: 'w w [@a]' }], 'totally-unknown-discipline');
  assert.ok(typeof report.target === 'number' && report.target > 0, 'unknown discipline → a positive default target');
});

test('COMP-05: computeCitationDensity NEVER throws and NEVER signals a block (warn-only)', () => {
  // Empty sections, zero-word section, and a section with no citations.
  assert.doesNotThrow(() => computeCitationDensity([], 'cs'));
  const empty = computeCitationDensity([], 'cs');
  assert.equal(empty.sections.length, 0);
  assert.doesNotThrow(() => computeCitationDensity([{ n: 1, slug: 's', text: '' }], 'cs'));
  const zero = computeCitationDensity([{ n: 1, slug: 's', text: '' }], 'cs');
  assert.ok(Number.isFinite(zero.sections[0]!.citations_per_1000_words), 'zero-word section density must be finite (no NaN/Infinity)');
  // The report carries warnings only — there is no "blocked"/"refused" field.
  const r = computeCitationDensity([{ n: 1, slug: 's', text: 'a b c [@k]' }], 'cs');
  assert.ok(Array.isArray(r.warnings), 'warnings is an array (advisory only)');
  assert.ok(!('refused' in (r as unknown as Record<string, unknown>)), 'density report must not carry a block/refuse signal');
});
