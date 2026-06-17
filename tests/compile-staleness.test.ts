// tests/compile-staleness.test.ts — COMP-01 staleness re-verify (D-08, Plan 04-05).
//
// RED-first: bin/lib/compile.ts does not exist yet.
//
// D-08 (LOCKED): when a section's verified_against_draft_hash no longer matches
// computeDraftHash(currentDraftBytes, sources), the section is STALE. Compile
//   - emits a WARN ("section <N> stale — re-verifying"),
//   - auto-re-verifies that section with Pass 1 + Pass 3 ONLY (NEVER Pass 2/4),
//   - on all-pass: continues, records the event under
//     `## Compile-Staleness Resolved` in COMPILE-REPORT.md,
//   - on any re-verify failure: BLOCKS compile (refuses) per PRD §14.
//
// The re-verify transport is an injectable seam (`reVerify`) — production wires
// runPass1 + runPass3; tests feed a deterministic verdict so CI never touches a
// live model/network and Pass 2/4 are provably never reachable. The test also
// asserts the seam is invoked ONLY for the stale section (fresh sections skip it).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCompile } from '../bin/lib/compile.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';

interface SectionSpec {
  n: number;
  slug: string;
  draft: string;
  assignedSources: string[];
  /** When true, store a deliberately-mismatched hash so the section is STALE. */
  stale: boolean;
}

function seedPaper(specs: SectionSpec[]): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-compile-stale-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const rows = specs
    .slice()
    .sort((a, b) => a.n - b.n)
    .map((s) => `| ${s.n} | ${s.slug} | ${s.slug} | | 300 | ${s.assignedSources.join(', ')} |`);
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    ['# Stale Fixture', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n'),
  );
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '');
  for (const s of specs) {
    const dir = join(root, '.paper', 'sections', `${String(s.n).padStart(2, '0')}-${s.slug}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'DRAFT.md'), s.draft);
    const freshHash = computeDraftHash(Buffer.from(s.draft, 'utf8'), s.assignedSources);
    const storedHash = s.stale ? 'stale_hash_does_not_match' : freshHash;
    writeFileSync(
      join(dir, 'PLAN.md'),
      [
        '---',
        `section: ${s.n}`,
        `slug: ${s.slug}`,
        `title: ${s.slug}`,
        'depends_on: []',
        `assigned_sources: [${s.assignedSources.map((k) => `'${k}'`).join(', ')}]`,
        `verified_against_draft_hash: '${storedHash}'`,
        'status: verified',
        '---',
        '',
        `# ${s.slug}`,
        '',
      ].join('\n'),
    );
    // A clean VERIFICATION.md so the fresh sections pass the verdict gate.
    writeFileSync(
      join(dir, 'VERIFICATION.md'),
      [
        `# VERIFICATION (Section ${s.n}, ${s.slug})`,
        '',
        'Status: verified',
        '',
        '## Pass-1 (citation integrity, deterministic — D-11 AND-gate)',
        '',
        ...s.assignedSources.map((ck) => `- ${ck}: **OK** — titleJW=1.00, authorJW=1.00 — D-11 AND-gate passed`),
        '',
      ].join('\n'),
    );
  }
  return root;
}

test('D-08: a stale section triggers WARN + Pass 1+3 re-verify; all-pass → compile continues + records the event', async () => {
  const root = seedPaper([
    { n: 1, slug: 'intro', draft: '# Intro\n\nGrounded [@smith2020].\n', assignedSources: ['smith2020'], stale: false },
    { n: 2, slug: 'body', draft: '# Body\n\nGrounded [@jones2019].\n', assignedSources: ['jones2019'], stale: true },
  ]);

  const reVerified: number[] = [];
  let pass2or4Invoked = false;
  const warnings: string[] = [];

  const result = await runCompile({
    paperRoot: root,
    yolo: true,
    onWarn: (w: string) => warnings.push(w),
    // Deterministic re-verify seam. Production wires runPass1 + runPass3. The
    // seam exposes which passes ran so the test can assert Pass 2/4 are never
    // reachable on the staleness path.
    reVerify: async ({ n, runPass2, runPass4 }: { n: number; runPass2?: () => void; runPass4?: () => void }) => {
      reVerified.push(n);
      if (runPass2) { runPass2(); pass2or4Invoked = true; }
      if (runPass4) { runPass4(); pass2or4Invoked = true; }
      // Pass 1 + Pass 3 both clean.
      return { passed: true, failingCitekeys: [] };
    },
  });

  assert.equal(result.refused, false, 'all-pass staleness re-verify must NOT block compile');
  assert.deepEqual(reVerified, [2], 're-verify must run ONLY for the stale section (n=2)');
  assert.equal(pass2or4Invoked, false, 'Pass 2/4 must NEVER be invoked on the staleness path (D-08)');
  assert.ok(
    warnings.some((w) => /stale/i.test(w) && /\b2\b/.test(w)),
    'a WARN naming the stale section must be emitted',
  );
  // The resolved event must be recorded in COMPILE-REPORT.md.
  const reportPath = join(root, '.paper', 'COMPILE-REPORT.md');
  assert.ok(existsSync(reportPath), 'COMPILE-REPORT.md must be written');
  const report = readFileSync(reportPath, 'utf8');
  assert.match(report, /## Compile-Staleness Resolved/, 'report must carry the staleness section');
  assert.match(report, /body|\b2\b/, 'the resolved stale section must be recorded');
  assert.equal(existsSync(join(root, '.paper', 'DRAFT.md')), true, 'compile continues → DRAFT.md written');
});

test('D-08: a stale section whose re-verify FAILS blocks compile (refuse, no DRAFT.md)', async () => {
  const root = seedPaper([
    { n: 1, slug: 'intro', draft: '# Intro\n\nGrounded [@smith2020].\n', assignedSources: ['smith2020'], stale: true },
  ]);

  const result = await runCompile({
    paperRoot: root,
    yolo: true,
    reVerify: async ({ n }: { n: number }) => {
      void n;
      // Re-verify surfaces a fresh FABRICATED on the stale section.
      return { passed: false, failingCitekeys: ['smith2020'] };
    },
  });

  assert.equal(result.refused, true, 're-verify failure on a stale section must block compile');
  assert.match((result.refuseReasons ?? []).join(' '), /smith2020/, 'refuse names the re-verify-flagged citekey');
  assert.equal(existsSync(join(root, '.paper', 'DRAFT.md')), false, 'no DRAFT.md when staleness re-verify fails');
});

test('D-08: NO stale sections → re-verify seam is never called', async () => {
  const root = seedPaper([
    { n: 1, slug: 'intro', draft: '# Intro\n\nGrounded [@smith2020].\n', assignedSources: ['smith2020'], stale: false },
    { n: 2, slug: 'body', draft: '# Body\n\nGrounded [@jones2019].\n', assignedSources: ['jones2019'], stale: false },
  ]);
  let called = false;
  const result = await runCompile({
    paperRoot: root,
    yolo: true,
    reVerify: async () => { called = true; return { passed: true, failingCitekeys: [] }; },
  });
  assert.equal(called, false, 'fresh sections must not trigger re-verify');
  assert.equal(result.refused, false);
  assert.equal(existsSync(join(root, '.paper', 'DRAFT.md')), true);
});
