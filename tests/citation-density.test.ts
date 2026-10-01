// tests/citation-density.test.ts — COMP-05 citation density against the
// discipline's per-paragraph band (GRND-06, PRD §8).
//
// The band comes from the discipline preset through bin/lib/disciplines.ts
// densityBandFor() — there is no density table in citation-density.ts any
// more (the old per-1000-words DISCIPLINE_TARGETS keys never matched the
// preset slugs). A paragraph is prose between blank lines; headings, lists,
// block quotes, tables and code are not paragraphs. WARN-only: never throws,
// never blocks. D-14's per-section citations_per_1000_words and the paper-wide
// mean/stdev of those are still reported.

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCitationDensity, proseParagraphs, type CitationDensityReport } from '../bin/lib/citation-density.js';
import { densityBandFor } from '../bin/lib/disciplines.js';
import { renderCompileReport, citationDensityForReport } from '../bin/lib/compile-report.js';

test('COMP-05 / D-14: per-section citations_per_1000_words, and the paper-wide mean and stdev', () => {
  const report: CitationDensityReport = computeCitationDensity(
    [
      { n: 1, slug: 'a', text: 'w w w w [@x]' },
      { n: 2, slug: 'b', text: 'w w [@x] [@y] [@z]' },
    ],
    'computer-science',
  );
  assert.ok(Math.abs((report.sections[0]?.citations_per_1000_words ?? 0) - 200) < 1e-6);
  assert.ok(Math.abs(report.mean - 400) < 1e-6, `mean expected 400, got ${report.mean}`);
  assert.ok(Math.abs(report.stdev - 200) < 1e-6, `stdev expected 200, got ${report.stdev}`);
});

test('GRND-06: the band is the preset\'s per-paragraph band (PRD §8), resolved from a slug, name or alias', () => {
  for (const d of ['history', 'History', 'hist', 'computer-science', 'CS', 'biology', 'psychology', 'other']) {
    const r = computeCitationDensity([], d);
    assert.deepEqual(r.band, densityBandFor(d), d);
  }
  assert.deepEqual(computeCitationDensity([], 'history').band, { min: 0.5, max: 2 });
  assert.deepEqual(computeCitationDensity([], 'computer-science').band, { min: 1, max: 3 });
  assert.deepEqual(computeCitationDensity([], 'biology').band, { min: 2, max: 4 });
  assert.equal(computeCitationDensity([], 'totally-unknown-discipline').discipline, 'other', 'unknown → the fallback preset');
});

test('GRND-06: citations are counted per prose paragraph — headings, lists, quotes, tables and code are not paragraphs (LF and CRLF)', () => {
  const md = [
    '## Heading with [@h]',
    '',
    'First paragraph cites [@a] and [@b].',
    'It continues on a second line [@c].',
    '',
    '- a list item [@d]',
    '- another [@e]',
    '',
    '> a quote [@f]',
    '',
    '| t | [@g] |',
    '',
    '```',
    'code [@i]',
    '```',
    '',
    'Second paragraph has no citation.',
    '',
  ].join('\n');
  for (const text of [md, md.replace(/\n/g, '\r\n')]) {
    assert.deepEqual(proseParagraphs(text), ['First paragraph cites [@a] and [@b]. It continues on a second line [@c].', 'Second paragraph has no citation.']);
    const r = computeCitationDensity([{ n: 1, slug: 's', text }], 'history');
    const s = r.sections[0]!;
    assert.equal(s.paragraphs, 2);
    assert.equal(s.citations_per_paragraph, 1.5);
    assert.equal(s.status, 'within', 'history band 0.5–2');
    assert.deepEqual(s.out_of_band.map((p) => [p.index, p.citations, p.status]), [[1, 3, 'above'], [2, 0, 'below']]);
  }
});

test('GRND-06: a section below or above its band warns (never throws, never blocks)', () => {
  const sparse = ['One claim.', 'Another claim.', 'A third [@a].'].join('\n\n');
  const below = computeCitationDensity([{ n: 2, slug: 'body', text: sparse }], 'biology');
  assert.equal(below.sections[0]?.status, 'below');
  assert.equal(below.comparison, 'below');
  assert.match(below.warnings[0]?.detail ?? '', /^§2 \(body\): 0\.3 citations per paragraph is BELOW the biology band 2–4 \(3 paragraph\(s\), 3 outside the band\)$/);
  const dense = computeCitationDensity([{ n: 1, slug: 'x', text: 'Claim [@a] [@b] [@c] [@d].' }], 'history');
  assert.equal(dense.comparison, 'above');
  assert.equal(dense.warnings.length, 1);
  const fine = computeCitationDensity([{ n: 1, slug: 'x', text: 'Claim [@a] [@b].' }], 'computer-science');
  assert.equal(fine.comparison, 'within');
  assert.deepEqual(fine.warnings, []);
  for (const bad of [[], [{ n: 1, slug: 's', text: '' }]]) {
    const r = computeCitationDensity(bad, 'computer-science');
    assert.ok(Number.isFinite(r.mean) && Number.isFinite(r.mean_per_paragraph));
    assert.ok(!('refused' in (r as unknown as Record<string, unknown>)), 'no block/refuse signal');
  }
});

test('GRND-06: COMPILE-REPORT.md shows the band, each section\'s citations per paragraph and the paragraphs outside it', () => {
  const report = computeCitationDensity(
    [
      { n: 1, slug: 'intro', text: 'Opening claim [@a].\n\nSecond claim [@b].' },
      { n: 2, slug: 'body', text: 'Nothing cited here at all, just prose words.\n\nStill nothing.' },
    ],
    'history',
  );
  const { entries, summary } = citationDensityForReport(report);
  const md = renderCompileReport({
    compiled_at: '2026-09-28T00:00:00.000Z',
    sections_count: 2,
    stale_resolved_count: 0,
    citation_density: entries,
    citation_density_summary: summary,
    offline_marker: null,
  });
  assert.match(md, /^Discipline: history · band 0\.5–2 citations per paragraph · paper-wide 0\.5 per paragraph \(within\)$/m);
  assert.match(md, /^- 1 \(intro\): 1 citations\/paragraph over 2 paragraph\(s\) \(within 0\.5–2\); \d+(\.\d)? citations\/1000 words$/m);
  assert.match(md, /^- 2 \(body\): 0 citations\/paragraph over 2 paragraph\(s\) \(BELOW 0\.5–2\); 0 citations\/1000 words$/m);
  assert.match(md, /^ {2}- paragraph 1 \(0 citations, band 0\.5–2\): "Nothing cited here at all, just prose words\."$/m, 'EXP-12: each out-of-band paragraph names its count and the band');
});

test('VRFY-09: the density count and each paragraph\'s first words read every citation form through the one grammar', () => {
  const report = computeCitationDensity(
    [{ n: 1, slug: 'intro', text: 'As @smith2020 argues [@a, p. 5; -@b], trees cool [see @Vaswani2017] streets and shade the whole block from noon sun.' }],
    'history',
  );
  const s = report.sections[0]!;
  assert.equal(s.citations, 4, 'narrative @k, a cluster of two with a locator and author suppression, a prefixed mixed-case key');
  assert.deepEqual(s.out_of_band.map((p) => p.firstWords), ['As argues , trees cool streets and shade …']);
});
