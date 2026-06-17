// tests/compile-smoother.test.ts — COMP-03 N-1 per-boundary smoothing count.
//
// RED-first: bin/lib/compile.ts does not exist yet.
//
// D-12 (LOCKED): for an N-section paper the smoother makes EXACTLY N-1 calls,
// one per adjacent boundary, each seeing only [tail_K, head_{K+1}].
//
// The smoother transport is an injectable seam (`smoothBoundary`) so CI never
// calls a live model. The seam receives the boundary window (titles + tail +
// head, with citation tokens already placeholder-substituted by the pipeline)
// and returns the rewritten boundary text. This test counts invocations.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCompile, type SmoothBoundaryInput } from '../bin/lib/compile.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';

function seedN(n: number): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-compile-smoother-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const rows: string[] = [];
  for (let i = 1; i <= n; i += 1) {
    rows.push(`| ${i} | s${i} | Section ${i} | | 300 |  |`);
  }
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    ['# Smoother Count Fixture', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n'),
  );
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '');
  for (let i = 1; i <= n; i += 1) {
    const slug = `s${i}`;
    const dir = join(root, '.paper', 'sections', `${String(i).padStart(2, '0')}-${slug}`);
    mkdirSync(dir, { recursive: true });
    const draft = `# Section ${i}\n\nThe last paragraph of section ${i}.\n`;
    writeFileSync(join(dir, 'DRAFT.md'), draft);
    const hash = computeDraftHash(Buffer.from(draft, 'utf8'), []);
    writeFileSync(
      join(dir, 'PLAN.md'),
      ['---', `section: ${i}`, `slug: ${slug}`, `title: Section ${i}`, 'depends_on: []', 'assigned_sources: []', `verified_against_draft_hash: '${hash}'`, 'status: verified', '---', '', `# Section ${i}`, ''].join('\n'),
    );
    writeFileSync(
      join(dir, 'VERIFICATION.md'),
      [`# VERIFICATION (Section ${i}, ${slug})`, '', 'Status: verified', '', '## Pass-1 (citation integrity, deterministic — D-11 AND-gate)', '', '', ''].join('\n'),
    );
  }
  return root;
}

test('COMP-03: an N=3 paper invokes the smoother exactly N-1 = 2 times', async () => {
  const root = seedN(3);
  const calls: SmoothBoundaryInput[] = [];
  const result = await runCompile({
    paperRoot: root,
    yolo: true,
    smoothBoundary: async (input: SmoothBoundaryInput) => {
      calls.push(input);
      // Echo the window back unchanged (no token drift) — accepted.
      return `${input.tail}\n\n${input.head}`;
    },
  });
  assert.equal(result.refused, false);
  assert.equal(calls.length, 2, 'N=3 → exactly 2 boundary smoothing calls (N-1)');
});

test('COMP-03: an N=1 paper invokes the smoother 0 times', async () => {
  const root = seedN(1);
  let calls = 0;
  await runCompile({
    paperRoot: root,
    yolo: true,
    smoothBoundary: async (input: SmoothBoundaryInput) => { calls += 1; return `${input.tail}\n\n${input.head}`; },
  });
  assert.equal(calls, 0, 'a single-section paper has no boundaries to smooth');
});

test('COMP-03: an N=5 paper invokes the smoother exactly 4 times', async () => {
  const root = seedN(5);
  let calls = 0;
  await runCompile({
    paperRoot: root,
    yolo: true,
    smoothBoundary: async (input: SmoothBoundaryInput) => { calls += 1; return `${input.tail}\n\n${input.head}`; },
  });
  assert.equal(calls, 4, 'N=5 → exactly 4 boundary smoothing calls');
});
