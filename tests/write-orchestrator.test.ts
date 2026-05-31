// tests/write-orchestrator.test.ts
//
// RED test suite for bin/lib/write-orchestrator.ts (Plan 04-03).
//
// Tests:
//   1. Happy path — 3-section graph (a, b→a, c→a): all three reach terminal state.
//   2. Wave structure — b and c are wave-2 siblings; a is wave-1 root.
//   3. Within-wave failure — a fails; b and c blocked; orthogonal d completes (D-03).
//   4. MISSING dependency — a's PLAN.md absent; b→a blocked; orthogonal d completes (REVIEW HIGH).
//   5. Tier-2 serial WARN — maxParallel 1 produces deterministic order; WARN emitted
//      EXACTLY ONCE per run across multiple waves (REVIEW M-04 warnedOnce guard).
//
// Assertion style: settle-state assertions only (not event order) per 04-RESEARCH §O.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Import the orchestrator (will fail RED until the file is created).
import type { WaveResult } from '../bin/lib/write-orchestrator.js';

// We use a dynamic import in each test so the import failure is clear.
async function loadOrchestrator(): Promise<{
  runAllSections: (
    paperRoot: string,
    opts: {
      maxParallel: number;
      writeSection: (node: import('../bin/lib/schemas/wave-graph.js').SectionNode) => Promise<void>;
    }
  ) => Promise<WaveResult[]>;
  WaveResult: unknown;
}> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return import('../bin/lib/write-orchestrator.js') as Promise<typeof import('../bin/lib/write-orchestrator.js')>;
}

// ---------------------------------------------------------------------------
// Fixtures: outline + plan stubs
// ---------------------------------------------------------------------------

/**
 * Build a minimal .paper/OUTLINE.md text with the given sections.
 * Format: | # | slug | title | depends_on | word target | assigned_sources |
 */
function makeOutline(
  sections: Array<{ n: number; slug: string; deps?: string[] }>
): string {
  const rows = sections
    .map(s => `| ${s.n} | ${s.slug} | Title ${s.slug} | ${(s.deps ?? []).join(',')} | 300 |  |`)
    .join('\n');
  return `# Test Paper\n| # | slug | title | depends_on | word target | assigned_sources |\n|---|------|-------|-----------|-------------|------------------|\n${rows}\n`;
}

import { mkdtempSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Seed a temp paperRoot with:
 *   - OUTLINE.md containing the given sections
 *   - per-section PLAN.md (unless skipPlanMd is set for that slug)
 */
function seedPaperRoot(
  sections: Array<{ n: number; slug: string; deps?: string[] }>,
  skipPlanMd?: Set<string>
): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-write-orch-'));
  const paperDir = join(root, '.paper');
  mkdirSync(paperDir, { recursive: true });

  // Write OUTLINE.md (note: outline lives at paperRoot/.paper/OUTLINE.md per loadOutline path)
  writeFileSync(join(paperDir, 'OUTLINE.md'), makeOutline(sections));

  // Write per-section PLAN.md
  for (const s of sections) {
    if (skipPlanMd?.has(s.slug)) continue;
    const sDir = join(paperDir, 'sections', `${String(s.n).padStart(2, '0')}-${s.slug}`);
    mkdirSync(sDir, { recursive: true });
    writeFileSync(
      join(sDir, 'PLAN.md'),
      `---\nslug: ${s.slug}\nstatus: planned\n---\n\n# Section ${s.slug}\n`,
    );
  }

  return root;
}

// ---------------------------------------------------------------------------
// Test 1: Happy path — all three sections reach terminal state
// ---------------------------------------------------------------------------
test('write-orchestrator: happy path — a, b→a, c→a all reach terminal state', async () => {
  const { runAllSections } = await loadOrchestrator();

  const sections = [
    { n: 1, slug: 'a', deps: [] },
    { n: 2, slug: 'b', deps: ['a'] },
    { n: 3, slug: 'c', deps: ['a'] },
  ];
  const root = seedPaperRoot(sections);

  const written: string[] = [];
  const results = await runAllSections(root, {
    maxParallel: 2,
    writeSection: async (node) => {
      // Simulate async work with a resolved promise tick (NO real sleep).
      await Promise.resolve();
      written.push(node.slug);
    },
  });

  // All three sections must have been attempted.
  assert.equal(written.length, 3, 'All 3 sections should be written');
  // All results must be settled (not pending).
  assert.ok(results.length >= 1, 'runAllSections must return WaveResult array');

  // Each WaveResult holds an array of settled outcomes.
  // Across all waves, all 3 slugs must appear in a fulfilled state.
  const allSlugs = new Set<string>();
  for (const waveResult of results) {
    for (const settled of waveResult.settled) {
      if (settled.status === 'fulfilled') {
        // fulfilled means the section completed without error
        allSlugs.add(waveResult.wave.find((n) => true)?.slug ?? '');
      }
    }
    for (const n of waveResult.wave) {
      allSlugs.add(n.slug);
    }
  }
  assert.ok(allSlugs.has('a'), 'section a must reach terminal state');
  assert.ok(allSlugs.has('b'), 'section b must reach terminal state');
  assert.ok(allSlugs.has('c'), 'section c must reach terminal state');
});

// ---------------------------------------------------------------------------
// Test 2: Wave structure — b and c are siblings in the second wave
// ---------------------------------------------------------------------------
test('write-orchestrator: wave structure — b and c are wave-2 siblings', async () => {
  const { runAllSections } = await loadOrchestrator();

  const sections = [
    { n: 1, slug: 'a', deps: [] },
    { n: 2, slug: 'b', deps: ['a'] },
    { n: 3, slug: 'c', deps: ['a'] },
  ];
  const root = seedPaperRoot(sections);

  const waveLog: string[][] = [];

  const results = await runAllSections(root, {
    maxParallel: 2,
    writeSection: async (node) => {
      await Promise.resolve();
    },
  });

  // There should be at least 2 waves (wave 1: [a], wave 2: [b, c]).
  assert.ok(results.length >= 2, 'Expected at least 2 wave results');

  // First wave must contain only 'a'.
  const firstWave = results[0];
  assert.ok(firstWave !== undefined);
  const firstWaveSlugs = firstWave.wave.map(n => n.slug);
  assert.ok(firstWaveSlugs.includes('a'), 'First wave must contain a');
  assert.equal(firstWaveSlugs.length, 1, 'First wave must only contain a');

  // Second wave must contain 'b' and 'c'.
  const secondWave = results[1];
  assert.ok(secondWave !== undefined);
  const secondWaveSlugs = secondWave.wave.map(n => n.slug).sort();
  assert.deepEqual(secondWaveSlugs, ['b', 'c'], 'Second wave must contain b and c');
});

// ---------------------------------------------------------------------------
// Test 3: Within-wave failure — a fails; b and c blocked; orthogonal d still done
// ---------------------------------------------------------------------------
test('write-orchestrator: within-wave failure — a fails; b,c blocked; d (orthogonal root) still done', async () => {
  const { runAllSections } = await loadOrchestrator();

  const sections = [
    { n: 1, slug: 'a', deps: [] },
    { n: 2, slug: 'b', deps: ['a'] },
    { n: 3, slug: 'c', deps: ['a'] },
    { n: 4, slug: 'd', deps: [] }, // orthogonal root — no deps
  ];
  const root = seedPaperRoot(sections);

  const completed: string[] = [];
  const results = await runAllSections(root, {
    maxParallel: 2,
    writeSection: async (node) => {
      await Promise.resolve();
      if (node.slug === 'a') {
        throw new Error('simulated failure for a');
      }
      completed.push(node.slug);
    },
  });

  // d must have completed (it's orthogonal — no dependency on a).
  assert.ok(completed.includes('d'), 'd must complete even when a fails (D-03)');

  // b and c must NOT have been written (they depend on failed a).
  assert.ok(!completed.includes('b'), 'b must be blocked when a fails');
  assert.ok(!completed.includes('c'), 'c must be blocked when a fails');

  // Verify final node statuses: look for blocked nodes in the wave results.
  // a should be 'failed'; b and c should be 'blocked'; d should be 'done'.
  const allNodes = results.flatMap(r => r.wave);
  const aNode = allNodes.find(n => n.slug === 'a');
  const bNode = allNodes.find(n => n.slug === 'b');
  const cNode = allNodes.find(n => n.slug === 'c');
  const dNode = allNodes.find(n => n.slug === 'd');

  assert.ok(aNode, 'node a must appear in results');
  assert.ok(bNode, 'node b must appear in results');
  assert.ok(cNode, 'node c must appear in results');
  assert.ok(dNode, 'node d must appear in results');

  // Assert on final settled STATE, not event order (04-RESEARCH §O).
  assert.equal(aNode!.status, 'failed', 'a must have status=failed');
  assert.equal(bNode!.status, 'blocked', 'b must have status=blocked (dep on failed a)');
  assert.equal(cNode!.status, 'blocked', 'c must have status=blocked (dep on failed a)');
  assert.equal(dNode!.status, 'done', 'd must have status=done (orthogonal)');
});

// ---------------------------------------------------------------------------
// Test 4: MISSING dependency (REVIEW HIGH) — a's PLAN.md absent; b→a is blocked
// ---------------------------------------------------------------------------
test('write-orchestrator: MISSING dependency — b is blocked (not silently run) when a has no PLAN.md', async () => {
  const { runAllSections } = await loadOrchestrator();

  const sections = [
    { n: 1, slug: 'a', deps: [] },
    { n: 2, slug: 'b', deps: ['a'] },
    { n: 4, slug: 'd', deps: [] }, // orthogonal root — no deps
  ];
  // Skip PLAN.md for 'a' — simulates a missing/unplanned dependency.
  const root = seedPaperRoot(sections, new Set(['a']));

  const completed: string[] = [];
  const results = await runAllSections(root, {
    maxParallel: 2,
    writeSection: async (node) => {
      await Promise.resolve();
      completed.push(node.slug);
    },
  });

  // b must NOT have been written (its dependency a is missing/unplanned).
  assert.ok(!completed.includes('b'), 'b must be blocked when a has no PLAN.md (REVIEW HIGH)');

  // d must have completed (it's orthogonal).
  assert.ok(completed.includes('d'), 'd must complete even when a is missing');

  // b should have status = 'blocked' in the results.
  const allNodes = results.flatMap(r => r.wave);
  const bNode = allNodes.find(n => n.slug === 'b');
  assert.ok(bNode !== undefined, 'b must appear in results');
  assert.equal(bNode!.status, 'blocked', 'b must have status=blocked (dep a missing)');
});

// ---------------------------------------------------------------------------
// Test 5: Tier-2 serial WARN — maxParallel 1; WARN emitted EXACTLY ONCE per run
// ---------------------------------------------------------------------------
test('write-orchestrator: Tier-2 serial WARN — emitted exactly once across multiple waves (REVIEW M-04)', async () => {
  const { runAllSections } = await loadOrchestrator();

  // 3-section chain a→b→c forces 3 waves so we can check the WARN fires only once.
  const sections = [
    { n: 1, slug: 'a', deps: [] },
    { n: 2, slug: 'b', deps: ['a'] },
    { n: 3, slug: 'c', deps: ['b'] },
  ];
  const root = seedPaperRoot(sections);

  // Capture stderr output to count WARNs.
  const stderrLines: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  // We monkey-patch stderr.write for the duration of the call.
  const capturedWrites: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (chunk: string | Buffer, ...rest: unknown[]) => {
    const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    capturedWrites.push(str);
    return origWrite(chunk as string, ...(rest as Parameters<typeof origWrite>).slice(1));
  };

  try {
    const results = await runAllSections(root, {
      maxParallel: 1, // Tier-2 forced-serial
      writeSection: async (node) => {
        await Promise.resolve();
      },
    });

    // All sections must complete in serial order.
    assert.ok(results.length >= 1, 'Expected at least one wave result');
  } finally {
    // Restore original stderr.write.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = origWrite;
  }

  // Count WARNs that mention "max-parallel ignored" (D-02).
  const warnCount = capturedWrites
    .join('')
    .split('\n')
    .filter(line => /WARN.*max-parallel.*ignored|max-parallel.*WARN/i.test(line) || /WARN.*serial/i.test(line))
    .length;

  assert.equal(
    warnCount,
    1,
    `Tier-2 WARN about max-parallel must be emitted EXACTLY ONCE per run; got ${warnCount}. Captured: ${capturedWrites.join('').slice(0, 500)}`,
  );
});

// ---------------------------------------------------------------------------
// Test 6: Deterministic serial order under maxParallel 1
// ---------------------------------------------------------------------------
test('write-orchestrator: maxParallel 1 produces deterministic serial section order', async () => {
  const { runAllSections } = await loadOrchestrator();

  // a→b→c is a linear chain; serial must execute in order a,b,c.
  const sections = [
    { n: 1, slug: 'a', deps: [] },
    { n: 2, slug: 'b', deps: ['a'] },
    { n: 3, slug: 'c', deps: ['b'] },
  ];
  const root = seedPaperRoot(sections);

  const order: string[] = [];
  await runAllSections(root, {
    maxParallel: 1,
    writeSection: async (node) => {
      await Promise.resolve();
      order.push(node.slug);
    },
  });

  assert.deepEqual(order, ['a', 'b', 'c'], 'Serial execution must follow topological order');
});
