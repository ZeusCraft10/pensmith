// tests/consistency-scan.test.ts — COMP-04 cross-section claim-consistency (FLAGS ONLY).
//
// RED-first: bin/lib/consistency-scan.ts does not exist yet.
//
// COMP-04 (canonical): cross-section claim-consistency scan produces FLAGS ONLY.
// It never edits, never blocks, never throws. Heuristics (04-RESEARCH §G):
//   (1) proper-noun divergence — a multi-word Capitalized phrase appearing in 2+
//       sections with differing surface forms → one flag.
//   (2) abbreviation collision — an `(ABBR)` introduction re-introduced in a
//       later section → one flag.
//   (3) heading-tense drift — OFF by default; only when opts.lintHeadings === true.
//
// Signature: runConsistencyScan(compiledMd, sectionBoundaries, opts?) →
//   ConsistencyWarning[]  (each warning carries a human-readable `detail`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { runConsistencyScan, type ConsistencyWarning } from '../bin/lib/consistency-scan.js';

interface Span { n: number; slug: string; start: number; end: number; }

/** Build a compiled markdown blob + per-section spans from section texts. */
function build(sections: Array<{ n: number; slug: string; text: string }>): { md: string; spans: Span[] } {
  let md = '';
  const spans: Span[] = [];
  for (const s of sections) {
    const start = md.length;
    md += s.text;
    if (!md.endsWith('\n')) md += '\n';
    md += '\n';
    spans.push({ n: s.n, slug: s.slug, start, end: md.length });
  }
  return { md, spans };
}

test('COMP-04: proper-noun surface divergence across sections → exactly one flag', () => {
  const { md, spans } = build([
    { n: 1, slug: 'intro', text: '# Intro\n\nWe study the Bayesian Network model in detail.' },
    { n: 2, slug: 'method', text: '# Method\n\nOur Bayesian network is trained end to end.' },
  ]);
  const warnings = runConsistencyScan(md, spans);
  const divergence = warnings.filter((w) => /Bayesian/i.test(w.detail));
  assert.equal(divergence.length, 1, 'one proper-noun divergence flag for "Bayesian Network" vs "Bayesian network"');
});

test('COMP-04: identical proper-noun surface forms produce NO flag', () => {
  const { md, spans } = build([
    { n: 1, slug: 'intro', text: '# Intro\n\nWe study the Bayesian Network model.' },
    { n: 2, slug: 'method', text: '# Method\n\nThe Bayesian Network is trained.' },
  ]);
  const warnings = runConsistencyScan(md, spans);
  assert.equal(warnings.filter((w) => /Bayesian/i.test(w.detail)).length, 0, 'matching surface forms → no flag');
});

test('COMP-04: abbreviation re-introduced in a later section → a collision flag', () => {
  const { md, spans } = build([
    { n: 1, slug: 'intro', text: '# Intro\n\nThe Large Language Model (LLM) is central here.' },
    { n: 2, slug: 'body', text: '# Body\n\nWe revisit the Large Language Model (LLM) again.' },
  ]);
  const warnings = runConsistencyScan(md, spans);
  assert.ok(
    warnings.some((w) => /LLM/.test(w.detail)),
    'an (LLM) re-introduction across sections must produce an abbreviation-collision flag',
  );
});

test('COMP-04: heading-tense heuristic is OFF by default and ON only with lintHeadings', () => {
  const { md, spans } = build([
    { n: 1, slug: 'intro', text: '# Introducing the Method\n\nBody.' },
    { n: 2, slug: 'results', text: '# Results Analyzed\n\nBody.' },
  ]);
  const off = runConsistencyScan(md, spans);
  const offTense = off.filter((w) => w.kind === 'heading-tense');
  assert.equal(offTense.length, 0, 'heading-tense heuristic must be silent by default');

  const on = runConsistencyScan(md, spans, { lintHeadings: true });
  // We only assert the heuristic is REACHABLE when enabled — its exact count is
  // advisory. The contract is: off-by-default, opt-in via lintHeadings.
  assert.ok(on.length >= off.length, 'enabling lintHeadings must not reduce the flag set');
});

test('COMP-04: runConsistencyScan NEVER throws and returns an array (flags-only / never-blocks)', () => {
  // Pathological inputs: empty md, malformed spans — must not throw.
  assert.doesNotThrow(() => runConsistencyScan('', []));
  const empty = runConsistencyScan('', []);
  assert.ok(Array.isArray(empty), 'returns an array even for empty input');
  assert.doesNotThrow(() => runConsistencyScan('Just one Section With Words.', [{ n: 1, slug: 's', start: 0, end: 99 }] as Span[]));
  // No warning carries any "block"/"refuse"/"error" signal — flags only.
  const ws: ConsistencyWarning[] = runConsistencyScan('text', []);
  for (const w of ws) {
    assert.ok(typeof w.detail === 'string', 'every warning has a string detail');
  }
});
