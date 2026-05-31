// tests/section-isolation-n.test.ts
//
// Extends Phase 3 SC-4 (section-isolation.test.ts) to N sections.
// Asserts that re-running the writer for section 3 only leaves all other
// sections' DRAFT.md UNCHANGED — both mtime AND content-hash.
//
// This is the section-as-phase invariant (PRD §14, D-02 LOCKED) verified
// at N=4 breadth via write-orchestrator.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  statSync,
  utimesSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// We use the write-orchestrator's runAllSections with a targeting filter to
// re-run ONLY section 3 while leaving others untouched. In practice this means
// we run the orchestrator with a writeSection stub that throws for every section
// except the target — the other sections remain at their seeded DRAFT.md state.

import type { SectionNode } from '../bin/lib/schemas/wave-graph.js';

async function loadOrchestrator(): Promise<{
  runAllSections: (
    paperRoot: string,
    opts: {
      maxParallel: number;
      writeSection: (node: SectionNode) => Promise<void>;
    }
  ) => Promise<import('../bin/lib/write-orchestrator.js').WaveResult[]>;
}> {
  return import('../bin/lib/write-orchestrator.js') as Promise<typeof import('../bin/lib/write-orchestrator.js')>;
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Build a minimal OUTLINE.md with N sections (no dependencies between them).
 */
function makeOutlineN(n: number): string {
  const rows = Array.from({ length: n }, (_, i) => {
    const num = i + 1;
    const slug = `section-${num}`;
    return `| ${num} | ${slug} | Section ${num} |  | 300 |  |`;
  }).join('\n');
  return `# Test Paper (N=${n})\n| # | slug | title | depends_on | word target | assigned_sources |\n|---|------|-------|-----------|-------------|------------------|\n${rows}\n`;
}

test('section-isolation-n: re-running section 3 leaves other N=4 sections DRAFT.md unchanged (mtime + hash)', async () => {
  const { runAllSections } = await loadOrchestrator();

  const N = 4;
  const TARGET = 3; // 1-based section index to "re-run"

  // Seed paper root.
  const root = mkdtempSync(join(tmpdir(), 'pensmith-isolation-n-'));
  const paperDir = join(root, '.paper');
  mkdirSync(paperDir, { recursive: true });

  // Write OUTLINE.md.
  writeFileSync(join(paperDir, 'OUTLINE.md'), makeOutlineN(N));

  // Seed each section with a PLAN.md and a DRAFT.md.
  const frozenTime = new Date('2025-01-01T00:00:00Z');
  const sectionDirs: string[] = [];
  for (let i = 1; i <= N; i++) {
    const slug = `section-${i}`;
    const sDir = join(paperDir, 'sections', `${String(i).padStart(2, '0')}-${slug}`);
    mkdirSync(sDir, { recursive: true });

    writeFileSync(join(sDir, 'PLAN.md'), `---\nslug: ${slug}\nstatus: planned\n---\n\n# Section ${i}\n`);
    const draftContent = `# Draft for section ${i}\n\nOriginal content ${i}.\n`;
    writeFileSync(join(sDir, 'DRAFT.md'), draftContent);

    // Freeze mtime to a well-known past time so any modification stands out.
    utimesSync(join(sDir, 'PLAN.md'), frozenTime, frozenTime);
    utimesSync(join(sDir, 'DRAFT.md'), frozenTime, frozenTime);
    utimesSync(sDir, frozenTime, frozenTime);

    sectionDirs.push(sDir);
  }

  // Snapshot mtime + content-hash for all sections EXCEPT target.
  const before: Record<number, { mtime: number; hash: string }> = {};
  for (let i = 1; i <= N; i++) {
    if (i === TARGET) continue;
    const slug = `section-${i}`;
    const draftPath = join(paperDir, 'sections', `${String(i).padStart(2, '0')}-${slug}`, 'DRAFT.md');
    const content = readFileSync(draftPath, 'utf8');
    const mtime = statSync(draftPath).mtimeMs;
    before[i] = { mtime, hash: sha256(content) };
  }

  // Run orchestrator with a writeSection stub that ONLY "writes" section TARGET.
  // For all other sections, the stub is a no-op (doesn't touch DRAFT.md).
  await runAllSections(root, {
    maxParallel: 2,
    writeSection: async (node) => {
      await Promise.resolve();
      if (node.n === TARGET) {
        // Simulate writing the target section (updates its DRAFT.md).
        const slug = `section-${TARGET}`;
        const draftPath = join(paperDir, 'sections', `${String(TARGET).padStart(2, '0')}-${slug}`, 'DRAFT.md');
        writeFileSync(draftPath, `# Draft for section ${TARGET}\n\nUpdated content.\n`);
      }
      // All other sections: stub does NOT touch their DRAFT.md files.
    },
  });

  // Assert that all non-target sections have unchanged mtime AND content-hash.
  for (let i = 1; i <= N; i++) {
    if (i === TARGET) continue;
    const slug = `section-${i}`;
    const draftPath = join(paperDir, 'sections', `${String(i).padStart(2, '0')}-${slug}`, 'DRAFT.md');
    const content = readFileSync(draftPath, 'utf8');
    const afterHash = sha256(content);
    const afterMtime = statSync(draftPath).mtimeMs;

    const snapped = before[i];
    assert.ok(snapped !== undefined);

    assert.equal(
      afterMtime,
      snapped.mtime,
      `Section-as-phase isolation violated: section ${i} DRAFT.md mtime changed from ${snapped.mtime} to ${afterMtime} (PRD §14 invariant — re-running section ${TARGET} must not touch section ${i})`,
    );

    assert.equal(
      afterHash,
      snapped.hash,
      `Section-as-phase isolation violated: section ${i} DRAFT.md content changed (hash mismatch) after re-running section ${TARGET}`,
    );
  }

  // Also confirm the target section WAS updated (proves the test is sensitive).
  const targetSlug = `section-${TARGET}`;
  const targetDraft = join(paperDir, 'sections', `${String(TARGET).padStart(2, '0')}-${targetSlug}`, 'DRAFT.md');
  const targetContent = readFileSync(targetDraft, 'utf8');
  assert.ok(
    targetContent.includes('Updated content'),
    'Target section DRAFT.md must reflect the re-run',
  );
});
