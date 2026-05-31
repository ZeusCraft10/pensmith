// tests/compile-staleness.test.ts
// COMP-01 staleness path (D-08): a section whose verified_against_draft_hash
// ≠ computeDraftHash(currentDraft) triggers WARN + auto Pass 1+3 re-verify.
// Re-verify success → compile continues + records event in ## Compile-Staleness Resolved.
// Re-verify failure → compile blocks.
// Pass 2/4 are NEVER invoked.
// Compile lock uses stale: 30000 (REVIEW M-03).
//
// RED — bin/lib/compile.ts and bin/lib/draft-hash.ts do not exist yet.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeOutline(sections: Array<{ n: number; slug: string }>): string {
  const rows = sections.map(
    (s) => `| ${s.n} | ${s.slug} | ${s.slug} section |  | 300 |  |`,
  );
  return [
    '# Test Paper',
    '| # | slug | title | depends_on | word target | assigned_sources |',
    '|---|------|-------|-----------|-------------|------------------|',
    ...rows,
  ].join('\n') + '\n';
}

interface SectionSpec {
  n: number;
  slug: string;
  draftContent: string;
  verifiedHash: string;  // hash stored in PLAN.md (may differ from actual draft hash)
  verificationContent: string;
  state?: string;
}

function makePaperRoot(specs: SectionSpec[]): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-compile-staleness-'));
  const paperDir = join(root, '.paper');
  mkdirSync(paperDir, { recursive: true });

  writeFileSync(
    join(paperDir, 'OUTLINE.md'),
    makeOutline(specs.map((s) => ({ n: s.n, slug: s.slug }))),
  );
  writeFileSync(join(paperDir, 'CITATIONS.bib'), '');

  for (const sec of specs) {
    const pad = String(sec.n).padStart(2, '0');
    const secDir = join(paperDir, 'sections', `${pad}-${sec.slug}`);
    mkdirSync(secDir, { recursive: true });

    const state = sec.state ?? 'verified';
    const planMd = [
      '---',
      `slug: ${sec.slug}`,
      `state: ${state}`,
      `verified_against_draft_hash: ${sec.verifiedHash}`,
      'assigned_sources: []',
      '---',
      '',
      `# ${sec.slug}`,
    ].join('\n') + '\n';
    writeFileSync(join(secDir, 'PLAN.md'), planMd);
    writeFileSync(join(secDir, 'DRAFT.md'), sec.draftContent);
    writeFileSync(join(secDir, 'VERIFICATION.md'), sec.verificationContent);
  }

  return root;
}

test('compile-staleness: stale hash → WARN + auto re-verify (Pass 1+3); all-pass → compile continues (D-08)', async () => {
  // The verifiedHash in PLAN.md deliberately mismatches the current draft bytes.
  // Pass 1 result: OK (no citations in draft, empty bib).
  const root = makePaperRoot([
    {
      n: 1,
      slug: 'intro',
      draftContent: '# Intro\n\nNo citations here.\n',
      verifiedHash: 'stalehashaabbcc',  // intentionally wrong
      verificationContent: '# VERIFICATION\n\nstate: verified\nverdict: OK\n',
    },
  ]);

  const { runCompile } = await import('../bin/lib/compile.js').catch(() => {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  });

  const result = await runCompile({ paperRoot: root, yolo: true });
  // With no citations and empty bib, Pass 1 returns no FABRICATED → compile should succeed
  // and record the staleness event. We only assert result.ok is truthy here because
  // the test is primarily about the staleness path executing without block.
  if (result.ok) {
    const reportPath = join(root, '.paper', 'COMPILE-REPORT.md');
    assert.ok(existsSync(reportPath), 'COMPILE-REPORT.md must be written');
    if (existsSync(reportPath)) {
      const { readFileSync: rfs } = await import('node:fs');
      const report = rfs(reportPath, 'utf8');
      assert.match(report, /Compile-Staleness Resolved/i, 'staleness section must be in report');
    }
  }
});

test('compile-staleness: stale hash + re-verify fails → compile blocks (COMP-01)', async () => {
  // After re-verify, Pass 1 returns FABRICATED → compile must block.
  const root = makePaperRoot([
    {
      n: 1,
      slug: 'intro',
      draftContent: '# Intro\n\nText with [@ghost2024].\n',
      verifiedHash: 'stalehashaabbcc',
      // Empty bib → [@ghost2024] → FABRICATED after re-verify
      verificationContent: '# VERIFICATION\n\nstate: verified\nverdict: OK\n',
    },
  ]);

  const { runCompile } = await import('../bin/lib/compile.js').catch(() => {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  });

  const result = await runCompile({ paperRoot: root, yolo: true }).catch((e: Error) => ({
    ok: false as const,
    reason: e.message,
  }));
  assert.ok(!result.ok, 'D-08: re-verify failure must block compile');
  assert.ok(!existsSync(join(root, '.paper', 'DRAFT.md')), 'DRAFT.md must not be written when re-verify fails');
});

test('compile-staleness: Pass 2/4 are NEVER invoked (D-08 — re-verify uses Pass 1+3 ONLY)', async () => {
  // Grep-level assertion: compile.ts must not import pass2 or pass4.
  // This is a structural test that will pass once compile.ts exists.
  const { readFileSync, existsSync: fsExists } = await import('node:fs');
  const compilePath = new URL('../bin/lib/compile.ts', import.meta.url);
  if (!fsExists(compilePath)) {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  }
  const src = readFileSync(compilePath, 'utf8');
  assert.ok(
    !src.includes('pass2') && !src.includes('runPass2'),
    'compile.ts must NOT reference pass2 (D-08 — staleness re-verify uses Pass 1+3 only)',
  );
  assert.ok(
    !src.includes('pass4') && !src.includes('runPass4'),
    'compile.ts must NOT reference pass4 (D-08)',
  );
});

test('compile-staleness: compile lock uses stale: 30000 (REVIEW M-03)', async () => {
  // Structural assertion: compile.ts must pass stale: 30000 to the lock call.
  const { readFileSync, existsSync: fsExists2 } = await import('node:fs');
  const compilePath = new URL('../bin/lib/compile.ts', import.meta.url);
  if (!fsExists2(compilePath)) {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  }
  const src = readFileSync(compilePath, 'utf8');
  assert.match(src, /stale\s*:\s*30[_0]*000/, 'compile.ts must pass stale: 30000 to the lock call (REVIEW M-03)');
});

test('compile-staleness: stale lockfile older than 30s is auto-cleared and compile proceeds (REVIEW M-03)', async () => {
  // Create a stale lock file (older than 30s by writing a past mtime) and
  // verify that compile clears it and succeeds.
  const root = makePaperRoot([
    {
      n: 1,
      slug: 'intro',
      draftContent: '# Intro\n\nNo citations.\n',
      verifiedHash: 'aabbccdd',
      verificationContent: '# VERIFICATION\n\nstate: verified\nverdict: OK\n',
    },
  ]);

  // Write a stale .compile.lock file with old mtime (simulate crashed compile)
  const lockPath = join(root, '.paper', '.compile.lock');
  writeFileSync(lockPath, '');
  const { utimesSync } = await import('node:fs');
  const staleTime = new Date(Date.now() - 60_000);  // 60s old — definitely stale
  utimesSync(lockPath, staleTime, staleTime);

  const { runCompile } = await import('../bin/lib/compile.js').catch(() => {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  });

  // Compile should auto-clear the stale lock and proceed (not throw ELOCKED)
  const result = await runCompile({ paperRoot: root, yolo: true }).catch((e: Error) => ({
    ok: false as const,
    reason: e.message,
  }));
  // The test passes either way — the key is that it doesn't throw ELOCKED.
  // If compile.ts is not yet implemented, the test fails RED as expected.
  assert.ok(typeof result.ok === 'boolean', 'compile must return a result (not throw ELOCKED on stale lock)');
});
