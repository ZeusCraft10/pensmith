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
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAllSections } from '../bin/lib/write-orchestrator.js';
import { sectionDraft } from '../bin/lib/paths.js';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { fingerprint, outlineSection, seedBriefPaper } from './helpers/section-fixture.js';

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

// GRND-09 / D-18-18 (Phase 18): a re-outline is section-as-phase too. With N=4
// drafted sections, `outline --force --yolo` that keeps §1, §2 and §4 and drops
// §3 leaves every file of the kept sections byte- and mtime-identical, moves §3
// to sections/_archive/, and renames nothing.
test('section-isolation-N: outline --force keeps every kept section byte- and mtime-identical', async () => {
  const KEY = 'sk-test-section-iso-n-0001';
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await seedBriefPaper(sb.root);
    const four = {
      thesis: 'Self-attention displaced recurrence because it models long-range dependencies in parallel.',
      sections: [
        outlineSection(1, 'intro', { role: 'intro', assigned_sources: ['vaswani2017'], estimated_word_count: 375 }),
        outlineSection(2, 'background', { depends_on: ['intro'], assigned_sources: ['bahdanau2015'], estimated_word_count: 375 }),
        outlineSection(3, 'methods', { depends_on: ['background'], assigned_sources: ['luong2015'], estimated_word_count: 375 }),
        outlineSection(4, 'results', { role: 'conclusion', depends_on: ['background'], assigned_sources: ['devlin2019'], estimated_word_count: 375 }),
      ],
    };
    sb.mock!.script('outline-author', { data: four });
    const first = await sb.runTsx(null, ['outline', '--yolo'], { env: { ANTHROPIC_API_KEY: KEY } });
    assert.equal(first.status, 0, first.stderr);
    const sections = join(sb.paper, 'sections');
    for (const d of ['01-intro', '02-background', '03-methods', '04-results']) {
      writeFileSync(join(sections, d, 'DRAFT.md'), `Draft of ${d}.\n`);
      writeFileSync(join(sections, d, 'VERIFICATION.md'), `Verification of ${d}.\n`);
    }
    const kept = ['01-intro', '02-background', '04-results'];
    const before = new Map(kept.map((d) => [d, fingerprint(join(sections, d))]));

    const three = { ...four, sections: [four.sections[0]!, four.sections[1]!, { ...four.sections[3]!, estimated_word_count: 750 }] };
    sb.mock!.script('outline-author', { data: three });
    const r = await sb.runTsx(null, ['outline', '--force', '--yolo'], { env: { ANTHROPIC_API_KEY: KEY } });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    for (const d of kept) assert.deepEqual(fingerprint(join(sections, d)), before.get(d), `${d}: every file byte- and mtime-identical`);
    assert.deepEqual(
      readdirSync(sections).sort(),
      ['01-intro', '02-background', '04-results', '_archive'],
      'nothing renamed or renumbered',
    );
    assert.deepEqual(readdirSync(join(sections, '_archive')), ['03-methods']);
  });
});
