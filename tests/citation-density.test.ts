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
import { computeCitationDensity, proseParagraphs, resolveDensityBand, type CitationDensityReport } from '../bin/lib/citation-density.js';
import { densityBandFor, disciplineSlugs, presetFor } from '../bin/lib/disciplines.js';
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

test('EXP-12: every canonical preset slug resolves to its own preset band', () => {
  for (const slug of disciplineSlugs()) {
    const preset = presetFor(slug).densityPerParagraph;
    assert.deepEqual(computeCitationDensity([], slug).band, { min: preset.min, max: preset.max }, slug);
    const r = resolveDensityBand({ paperDiscipline: { slug, source: 'intake' } });
    assert.deepEqual([r.discipline, r.disciplineSource, r.band, r.bandSource], [slug, 'INTAKE.md', { min: preset.min, max: preset.max }, `${slug} preset`]);
  }
});

test('EXP-12 (D-21-16): config min/max override the preset band, --discipline overrides both, each source named; min above max is ignored with a warning', () => {
  const cs = { slug: 'computer-science', source: 'config' as const };
  assert.deepEqual(resolveDensityBand({ paperDiscipline: cs, configMin: 2, configMax: 5 }), {
    discipline: 'computer-science',
    disciplineSource: 'config.toml [project] discipline_preset',
    band: { min: 2, max: 5 },
    bandSource: 'config.toml [verification] citation_density_min and citation_density_max',
  });
  assert.deepEqual(resolveDensityBand({ paperDiscipline: cs, configMax: 6 }).band, { min: 1, max: 6 });
  const flag = resolveDensityBand({ flagDiscipline: 'history', paperDiscipline: cs, configMin: 2, configMax: 5 });
  assert.deepEqual([flag.discipline, flag.disciplineSource, flag.band, flag.bandSource], ['history', '--discipline', { min: 0.5, max: 2 }, 'history preset (--discipline)']);
  const bad = resolveDensityBand({ paperDiscipline: cs, configMin: 4, configMax: 2 });
  assert.deepEqual(bad.band, { min: 1, max: 3 });
  assert.match(bad.warning ?? '', /citation_density_min \(4\) is above citation_density_max \(2\) — ignored/);
  assert.equal(resolveDensityBand({}).disciplineSource, 'preset default');
});

test('EXP-12: a history paper lists its 5-citation and its 0-citation body paragraphs as out of band; a locator-only section has non-zero density', () => {
  const report = computeCitationDensity(
    [
      {
        n: 1,
        slug: 'archives',
        text:
          'The archive holds letters [@a; @b], ledgers [@c], maps [@d, p. 4] and diaries [@e] from the period.\n\n' +
          'A paragraph of argument that cites nothing at all.\n\n' +
          'A well-cited paragraph [@a].',
      },
      { n: 2, slug: 'locators', text: 'Only locators are cited here [@a, pp. 3-5].\n\nAnd here [@b, chap. 2].' },
    ],
    'history',
  );
  const s1 = report.sections[0]!;
  assert.deepEqual(s1.out_of_band.map((p) => [p.index, p.citations, p.status]), [[1, 5, 'above'], [2, 0, 'below']]);
  const r = citationDensityForReport(report, { discipline: 'INTAKE.md', band: 'history preset' });
  const md = renderCompileReport({ compiled_at: '2026-09-28T00:00:00.000Z', sections_count: 2, stale_resolved_count: 0, citation_density: r.entries, citation_density_summary: r.summary, offline_marker: null });
  assert.match(md, /^ {2}- paragraph 1 \(5 citations, band 0\.5–2\): "The archive holds letters , ledgers , maps …"$/m);
  assert.match(md, /^ {2}- paragraph 2 \(0 citations, band 0\.5–2\): "A paragraph of argument that cites nothing at …"$/m);
  assert.match(md, /^Discipline: history \(from INTAKE\.md\) · band 0\.5–2 citations per paragraph \(from history preset\)/m);
  const s2 = report.sections[1]!;
  assert.ok(s2.citations_per_paragraph > 0 && s2.citations === 2, 'a locator-only citation counts');
});
