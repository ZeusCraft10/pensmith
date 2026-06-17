// tests/write-orchestrator.test.ts — Phase 4 Plan 04-03 (RED → GREEN).
//
// Covers the wave-driven write orchestrator (`bin/lib/write-orchestrator.ts`):
//   - runAllSections drains waves serially; within a wave, sections run in
//     bounded parallel under `maxParallel`. ASSERT ON FINAL SETTLED STATE,
//     NEVER ON EVENT ORDER (04-RESEARCH §O — parallel timing is non-deterministic).
//   - D-03 within-wave failure policy: a sibling failure does NOT cancel
//     in-flight siblings; a transitive-dep failure marks the dependent subtree
//     `blocked` and skips it, while orthogonal subtrees still complete.
//   - D-02 Tier-2 forced-serial: maxParallel: 1 produces a deterministic serial
//     order and emits exactly one WARN containing "max-parallel ignored".
//
// The per-section writer is STUBBED with synthetic resolved-promise ticks (NO
// real sleeps). The stub records which slugs it was asked to write.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAllSections, type WaveResult } from '../bin/lib/write-orchestrator.js';

// ---- Fixture helpers -------------------------------------------------------

interface SeedSection {
  n: number;
  slug: string;
  title: string;
  depends_on: string[];
  wave?: number;
}

/**
 * Seed a fresh .paper/ root with an OUTLINE.md (locked GFM table) and one
 * sections/<NN>-<slug>/PLAN.md per section so the orchestrator can read the
 * frontmatter map it builds the wave graph from.
 */
function seedPaper(sections: SeedSection[]): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-write-orch-'));
  const paper = join(root, '.paper');
  mkdirSync(paper, { recursive: true });

  // OUTLINE.md — locked header: | # | slug | title | depends_on | word target | assigned_sources |
  const rows = sections
    .map(
      (s) =>
        `| ${s.n} | ${s.slug} | ${s.title} | ${s.depends_on.join(', ')} | 300 |  |`,
    )
    .join('\n');
  const outline = [
    '# Test Paper',
    '',
    '| # | slug | title | depends_on | word target | assigned_sources |',
    '| --- | --- | --- | --- | --- | --- |',
    rows,
    '',
  ].join('\n');
  writeFileSync(join(paper, 'OUTLINE.md'), outline);

  // Per-section PLAN.md with valid frontmatter.
  for (const s of sections) {
    const dir = join(paper, 'sections', `${String(s.n).padStart(2, '0')}-${s.slug}`);
    mkdirSync(dir, { recursive: true });
    const fmLines = [
      '---',
      `section: ${s.n}`,
      `slug: ${s.slug}`,
      `title: ${s.title}`,
      `depends_on: [${s.depends_on.join(', ')}]`,
      'assigned_sources: []',
      ...(s.wave !== undefined ? [`wave: ${s.wave}`] : []),
      'status: planned',
      '---',
      '',
      `# ${s.title}`,
      '',
    ];
    writeFileSync(join(dir, 'PLAN.md'), fmLines.join('\n'));
  }
  return root;
}

/** Flatten every per-section result across all waves into one slug→status map. */
function statusBySlug(results: WaveResult[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const wave of results) {
    for (const s of wave.sections) {
      m.set(s.slug, s.status);
    }
  }
  return m;
}

// ---- Tests -----------------------------------------------------------------

test('runAllSections: all sections in a 3-node diamond reach a terminal state (order-independent)', async () => {
  // deps: b→a, c→a  ⇒ a in wave 1; b, c are wave-2 siblings.
  const root = seedPaper([
    { n: 1, slug: 'a', title: 'A', depends_on: [] },
    { n: 2, slug: 'b', title: 'B', depends_on: ['a'] },
    { n: 3, slug: 'c', title: 'C', depends_on: ['a'] },
  ]);

  const written: string[] = [];
  const results = await runAllSections(root, {
    maxParallel: 2,
    writeSection: async (node) => {
      // Synthetic tick — no real sleep, just yield to the event loop.
      await Promise.resolve();
      written.push(node.slug);
    },
  });

  // Assert on FINAL settled state, never on event order (04-RESEARCH §O).
  const status = statusBySlug(results);
  assert.equal(status.get('a'), 'done', 'a must complete');
  assert.equal(status.get('b'), 'done', 'b must complete');
  assert.equal(status.get('c'), 'done', 'c must complete');
  assert.deepEqual([...written].sort(), ['a', 'b', 'c'], 'all three sections must be written');

  // Two waves: [a], then [b, c].
  assert.equal(results.length, 2, 'expected exactly 2 waves');
  assert.deepEqual(results[0]!.sections.map((s) => s.slug), ['a']);
  assert.deepEqual(results[1]!.sections.map((s) => s.slug).sort(), ['b', 'c']);
});

test('runAllSections: a failed dep blocks its subtree but an orthogonal root still completes (D-03)', async () => {
  // a fails. b→a and c→a are downstream and must be BLOCKED + skipped.
  // d has no deps (orthogonal subtree) and must COMPLETE.
  const root = seedPaper([
    { n: 1, slug: 'a', title: 'A', depends_on: [] },
    { n: 2, slug: 'b', title: 'B', depends_on: ['a'] },
    { n: 3, slug: 'c', title: 'C', depends_on: ['a'] },
    { n: 4, slug: 'd', title: 'D', depends_on: [] },
  ]);

  const written: string[] = [];
  const results = await runAllSections(root, {
    maxParallel: 4,
    writeSection: async (node) => {
      await Promise.resolve();
      if (node.slug === 'a') throw new Error('synthetic write failure for a');
      written.push(node.slug);
    },
  });

  const status = statusBySlug(results);
  assert.equal(status.get('a'), 'failed', 'a must be failed');
  assert.equal(status.get('b'), 'blocked', 'b must be blocked (transitive dep failed)');
  assert.equal(status.get('c'), 'blocked', 'c must be blocked (transitive dep failed)');
  assert.equal(status.get('d'), 'done', 'd is orthogonal and must complete');

  // b and c must never have been written (skipped, not attempted).
  assert.ok(!written.includes('b'), 'b must not be written');
  assert.ok(!written.includes('c'), 'c must not be written');
  assert.ok(written.includes('d'), 'd must be written');
});

test('runAllSections: a failed sibling does NOT cancel its in-flight wave-peers (D-03)', async () => {
  // a, b, e are all roots (wave 1). a fails; b and e must still complete —
  // one rejection in a wave never cancels siblings.
  const root = seedPaper([
    { n: 1, slug: 'a', title: 'A', depends_on: [] },
    { n: 2, slug: 'b', title: 'B', depends_on: [] },
    { n: 3, slug: 'e', title: 'E', depends_on: [] },
  ]);

  const written: string[] = [];
  const results = await runAllSections(root, {
    maxParallel: 3,
    writeSection: async (node) => {
      await Promise.resolve();
      if (node.slug === 'a') throw new Error('synthetic failure for a');
      written.push(node.slug);
    },
  });

  const status = statusBySlug(results);
  assert.equal(status.get('a'), 'failed');
  assert.equal(status.get('b'), 'done', 'sibling b must complete despite a failing');
  assert.equal(status.get('e'), 'done', 'sibling e must complete despite a failing');
  assert.deepEqual([...written].sort(), ['b', 'e']);
});

test('runAllSections: Tier-2 (maxParallel 1) runs serially and emits exactly one "max-parallel ignored" WARN (D-02)', async () => {
  const root = seedPaper([
    { n: 1, slug: 'a', title: 'A', depends_on: [] },
    { n: 2, slug: 'b', title: 'B', depends_on: ['a'] },
    { n: 3, slug: 'c', title: 'C', depends_on: ['a'] },
  ]);

  // Capture stderr to count the WARN (D-02: WARN goes to stderr, not stdout).
  const warnings: string[] = [];
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const patched = (chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    warnings.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return originalStderrWrite(chunk as never, ...(rest as never[]));
  };
  process.stderr.write = patched as typeof process.stderr.write;

  let results: WaveResult[];
  try {
    results = await runAllSections(root, {
      maxParallel: 1,
      writeSection: async () => {
        await Promise.resolve();
      },
    });
  } finally {
    process.stderr.write = originalStderrWrite;
  }

  const status = statusBySlug(results);
  assert.equal(status.get('a'), 'done');
  assert.equal(status.get('b'), 'done');
  assert.equal(status.get('c'), 'done');

  const ignoredWarns = warnings.filter((w) => /max-parallel ignored/i.test(w));
  assert.equal(
    ignoredWarns.length,
    1,
    `expected exactly one "max-parallel ignored" WARN; got ${ignoredWarns.length}: ${JSON.stringify(warnings)}`,
  );
});
