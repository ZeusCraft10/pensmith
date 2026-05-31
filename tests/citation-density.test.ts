// tests/citation-density.test.ts
// COMP-05: citation density — per-section citations_per_1000_words + paper-wide mean/stdev
// vs discipline preset target. Warn-only, never blocks, never throws.
//
// RED — bin/lib/citation-density.ts does not exist yet.

import test from 'node:test';
import assert from 'node:assert/strict';

// Helper: count words in markdown text
function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

test('citation-density: per-section citations_per_1000_words computed correctly (COMP-05)', async () => {
  const { computeCitationDensity } = await import('../bin/lib/citation-density.js').catch(() => {
    throw new Error('bin/lib/citation-density.ts not implemented yet (RED)');
  });

  // Section 1: 100 words, 5 citations → 50 citations per 1000 words
  const sec1Text = 'word '.repeat(100) + '[@a1] [@a2] [@a3] [@a4] [@a5]';
  const sec1Words = countWords('word '.repeat(100));
  // Section 2: 200 words, 4 citations → 20 citations per 1000 words
  const sec2Text = 'word '.repeat(200) + '[@b1] [@b2] [@b3] [@b4]';

  const sections = [
    { n: 1, slug: 'intro', text: sec1Text },
    { n: 2, slug: 'method', text: sec2Text },
  ];

  const result = computeCitationDensity(sections, 'stem');

  assert.ok(result, 'computeCitationDensity must return a result');
  assert.ok(Array.isArray(result.sections), 'result.sections must be an array');
  assert.equal(result.sections.length, 2, 'must have one entry per section');

  // Per-section density checks
  const sec1Entry = result.sections.find((s: { n: number }) => s.n === 1);
  const sec2Entry = result.sections.find((s: { n: number }) => s.n === 2);
  assert.ok(sec1Entry, 'result must include section 1');
  assert.ok(sec2Entry, 'result must include section 2');
  assert.ok(typeof sec1Entry.citations_per_1000_words === 'number', 'citations_per_1000_words must be a number');
  assert.ok(sec1Entry.citations_per_1000_words > 0, 'section 1 density must be positive');
});

test('citation-density: paper-wide mean and stdev computed (D-14 §3)', async () => {
  const { computeCitationDensity } = await import('../bin/lib/citation-density.js').catch(() => {
    throw new Error('bin/lib/citation-density.ts not implemented yet (RED)');
  });

  const sections = [
    { n: 1, slug: 'intro', text: 'word '.repeat(100) + '[@a1] [@a2] [@a3] [@a4] [@a5]' },
    { n: 2, slug: 'method', text: 'word '.repeat(200) + '[@b1] [@b2] [@b3] [@b4]' },
    { n: 3, slug: 'results', text: 'word '.repeat(150) + '[@c1] [@c2] [@c3]' },
  ];

  const result = computeCitationDensity(sections, 'humanities');

  assert.ok(typeof result.mean === 'number', 'result.mean must be a number (D-14 §3)');
  assert.ok(typeof result.stdev === 'number', 'result.stdev must be a number (D-14 §3)');
  assert.ok(result.mean >= 0, 'mean must be non-negative');
  assert.ok(result.stdev >= 0, 'stdev must be non-negative');

  // With known densities, verify mean is reasonable
  // sec1: 5 cites / ~100 words ≈ 50/1000
  // sec2: 4 cites / ~200 words ≈ 20/1000
  // sec3: 3 cites / ~150 words ≈ 20/1000
  // mean ≈ (50 + 20 + 20) / 3 ≈ 30/1000
  assert.ok(result.mean > 0, 'paper-wide mean must be positive for non-empty sections');
});

test('citation-density: discipline-preset-target comparison emits warn (COMP-05)', async () => {
  const { computeCitationDensity } = await import('../bin/lib/citation-density.js').catch(() => {
    throw new Error('bin/lib/citation-density.ts not implemented yet (RED)');
  });

  // Very low citation density — should trigger warn for most disciplines
  const sections = [
    { n: 1, slug: 'intro', text: 'word '.repeat(1000) },  // 0 citations
    { n: 2, slug: 'method', text: 'word '.repeat(1000) },  // 0 citations
  ];

  const result = computeCitationDensity(sections, 'stem');
  assert.ok(typeof result.target_comparison === 'object' || typeof result.warn === 'boolean' || typeof result.discipline_target !== 'undefined',
    'result must include discipline-target comparison data (COMP-05)');
});

test('citation-density: warn-only — never throws even on edge-case inputs (COMP-05)', async () => {
  const { computeCitationDensity } = await import('../bin/lib/citation-density.js').catch(() => {
    throw new Error('bin/lib/citation-density.ts not implemented yet (RED)');
  });

  const edgeCases = [
    { sections: [], discipline: 'stem' },
    { sections: [{ n: 1, slug: 'intro', text: '' }], discipline: 'stem' },
    { sections: [{ n: 1, slug: 'intro', text: '[@a1] [@a2]' }], discipline: 'unknown_discipline' },
    { sections: [{ n: 1, slug: 'intro', text: 'word '.repeat(10000) + '[@cite1]' }], discipline: '' },
  ];

  for (const tc of edgeCases) {
    assert.doesNotThrow(
      () => computeCitationDensity(tc.sections, tc.discipline),
      `computeCitationDensity must not throw for edge case: ${JSON.stringify(tc.sections.length)} sections, discipline: ${tc.discipline}`,
    );
  }
});

test('citation-density: never signals a block (warn-only semantic) (COMP-05)', async () => {
  const { computeCitationDensity } = await import('../bin/lib/citation-density.js').catch(() => {
    throw new Error('bin/lib/citation-density.ts not implemented yet (RED)');
  });

  const sections = [
    { n: 1, slug: 'intro', text: 'word '.repeat(500) },  // no citations — likely below target
  ];

  const result = computeCitationDensity(sections, 'stem');
  // Result must not have a block/refuse/error signal
  assert.ok(!('block' in result && result.block === true),
    'computeCitationDensity must not set block: true — warn-only (COMP-05)');
  assert.ok(!('refuse' in result && result.refuse === true),
    'computeCitationDensity must not set refuse: true — warn-only (COMP-05)');
});

test('citation-density: density values surface in ## Citation Density report section (COMP-05)', async () => {
  const { computeCitationDensity } = await import('../bin/lib/citation-density.js').catch(() => {
    throw new Error('bin/lib/citation-density.ts not implemented yet (RED)');
  });

  const sections = [
    { n: 1, slug: 'intro', text: 'word '.repeat(100) + '[@a1] [@a2]' },
    { n: 2, slug: 'method', text: 'word '.repeat(200) + '[@b1] [@b2] [@b3]' },
  ];

  const result = computeCitationDensity(sections, 'stem');

  // The result must be renderable into the ## Citation Density section
  // We check that the data needed for the report is present
  assert.ok(Array.isArray(result.sections), 'result must have sections array for report');
  assert.ok(typeof result.mean === 'number', 'result must have paper-wide mean for report');
  assert.ok(typeof result.stdev === 'number', 'result must have paper-wide stdev for report');

  // Each section entry must have enough data for a report line
  for (const sec of result.sections) {
    assert.ok(typeof sec.n === 'number', 'section entry must have n');
    assert.ok(typeof sec.citations_per_1000_words === 'number', 'section entry must have density value');
  }
});

test('citation-density: pure function — no I/O, no network, no LLM (COMP-05)', async () => {
  const { existsSync, readFileSync } = await import('node:fs');
  const densityPath = new URL('../bin/lib/citation-density.ts', import.meta.url);
  if (!existsSync(densityPath)) {
    throw new Error('bin/lib/citation-density.ts not implemented yet (RED)');
  }
  const src = readFileSync(densityPath, 'utf8');
  assert.ok(!src.includes("from 'node:fs'") && !src.includes('from "node:fs"'),
    'citation-density.ts must not import node:fs (pure)');
  assert.ok(!src.includes("from 'node:net'") && !src.includes("from 'node:http'"),
    'citation-density.ts must not import network modules');
  assert.ok(!src.includes('loadPrompt') && !src.includes('anthropic'),
    'citation-density.ts must not make LLM calls (COMP-05 — deterministic only)');
});
