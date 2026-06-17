// tests/section-isolation-n.test.ts — section-as-phase invariant extended to N.
//
// Phase 4 Plan 04-03. Phase 3 SC-4 proved re-doing section 3 of N=5 leaves the
// OTHER sections' mtimes untouched. This file extends that to the wave-driven
// world (N=4) and HARDENS it: re-running the writer for section 3 ONLY must
// leave sections 1, 2, 4 with identical mtime AND identical content-hash.
//
// The orchestrator (`runAllSections`) is the wave entry point; here we drive it
// with a single-section selection (the same primitive a re-run uses) so the
// per-section isolation guarantee is exercised through the orchestrator surface.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  statSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAllSections } from '../bin/lib/write-orchestrator.js';
import { sectionDraft } from '../bin/lib/paths.js';

const SLUGS = ['intro', 'background', 'methods', 'results']; // N=4, 1-based

function contentHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Seed a fresh .paper/ root with N=4 sections, each carrying a DRAFT.md and a
 * valid PLAN.md, all stamped with a frozen mtime in the past so any write would
 * bump the mtime forward.
 */
function seedFourSections(): { root: string; frozen: Date } {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-section-iso-n-'));
  const paper = join(root, '.paper');
  mkdirSync(paper, { recursive: true });

  const rows = SLUGS.map(
    (slug, i) => `| ${i + 1} | ${slug} | ${slug} | | 300 |  |`,
  ).join('\n');
  writeFileSync(
    join(paper, 'OUTLINE.md'),
    [
      '# Test Paper',
      '',
      '| # | slug | title | depends_on | word target | assigned_sources |',
      '| --- | --- | --- | --- | --- | --- |',
      rows,
      '',
    ].join('\n'),
  );

  const frozen = new Date('2025-01-01T00:00:00Z');
  for (let i = 0; i < SLUGS.length; i += 1) {
    const n = i + 1;
    const slug = SLUGS[i]!;
    const dir = join(paper, 'sections', `${String(n).padStart(2, '0')}-${slug}`);
    mkdirSync(dir, { recursive: true });
    const plan = [
      '---',
      `section: ${n}`,
      `slug: ${slug}`,
      `title: ${slug}`,
      'depends_on: []',
      'assigned_sources: []',
      'status: planned',
      '---',
      '',
      `# ${slug}`,
      '',
    ].join('\n');
    writeFileSync(join(dir, 'PLAN.md'), plan);
    const draft = join(dir, 'DRAFT.md');
    writeFileSync(draft, `# ${slug} draft\n\nOriginal body for ${slug}.\n`);
    utimesSync(draft, frozen, frozen);
  }
  return { root, frozen };
}

test('section-isolation-N: re-running section 3 only leaves sections 1,2,4 mtime AND content-hash unchanged', async () => {
  const { root } = seedFourSections();

  // Snapshot mtime + content-hash for the THREE non-target sections.
  const before: Record<string, { mtimeMs: number; hash: string }> = {};
  for (let i = 0; i < SLUGS.length; i += 1) {
    const n = i + 1;
    if (n === 3) continue; // section 3 is the re-run target
    const draft = sectionDraft(n, SLUGS[i]!, root);
    before[SLUGS[i]!] = { mtimeMs: statSync(draft).mtimeMs, hash: contentHash(draft) };
  }

  // Re-run the writer for section 3 ONLY via the orchestrator. The injected
  // writeSection touches ONLY the selected node's own DRAFT.md — exercising the
  // section-as-phase isolation invariant through the wave surface.
  await runAllSections(root, {
    maxParallel: 1,
    only: ['methods'],
    writeSection: async (node) => {
      assert.equal(node.slug, 'methods', 'only section 3 (methods) may be re-run');
      const draft = sectionDraft(node.n, node.slug, root);
      writeFileSync(draft, `# ${node.slug} draft\n\nREWRITTEN body for ${node.slug}.\n`);
    },
  });

  // Assert the three non-target sections are byte-identical AND mtime-frozen.
  for (const slug of Object.keys(before)) {
    const n = SLUGS.indexOf(slug) + 1;
    const draft = sectionDraft(n, slug, root);
    const after = { mtimeMs: statSync(draft).mtimeMs, hash: contentHash(draft) };
    assert.equal(
      after.mtimeMs,
      before[slug]!.mtimeMs,
      `Section-as-phase isolation broken: ${slug}/DRAFT.md mtime changed (before=${before[slug]!.mtimeMs} after=${after.mtimeMs}).`,
    );
    assert.equal(
      after.hash,
      before[slug]!.hash,
      `Section-as-phase isolation broken: ${slug}/DRAFT.md content-hash changed.`,
    );
  }
});
