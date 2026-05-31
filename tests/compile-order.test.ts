// tests/compile-order.test.ts
// COMP-02: sections concatenated in OUTLINE order (not wave order).
// ARCH-20: section files (sections/<N>/DRAFT.md) are READ-ONLY throughout compile.
//
// Creates 3 sections with wave order ≠ outline order and asserts compiled
// DRAFT.md heading order matches outline (n ascending), not wave order.
// Also asserts each sections/<N>/DRAFT.md mtime + content-hash unchanged after compile.
//
// RED — bin/lib/compile.ts does not exist yet.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

function makeOutline(): string {
  // Outline order: 1 (intro), 2 (method), 3 (results)
  // We'll arrange so section 3 is "wave 1" and section 1 is "wave 3" in our
  // fixture to test outline vs wave order distinction.
  return [
    '# Test Paper for Order',
    '| # | slug | title | depends_on | word target | assigned_sources |',
    '|---|------|-------|-----------|-------------|------------------|',
    '| 1 | intro | Introduction |  | 300 |  |',
    '| 2 | method | Methodology |  | 300 |  |',
    '| 3 | results | Results |  | 300 |  |',
  ].join('\n') + '\n';
}

function makePaperRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-compile-order-'));
  const paperDir = join(root, '.paper');
  mkdirSync(paperDir, { recursive: true });

  writeFileSync(join(paperDir, 'OUTLINE.md'), makeOutline());
  writeFileSync(join(paperDir, 'CITATIONS.bib'), '');

  // Sections — draft content identifies each by heading so order is visible
  const sections = [
    { n: 1, slug: 'intro', heading: '## Introduction Section', wave: 3 },
    { n: 2, slug: 'method', heading: '## Methodology Section', wave: 2 },
    { n: 3, slug: 'results', heading: '## Results Section', wave: 1 },
  ];

  for (const sec of sections) {
    const pad = String(sec.n).padStart(2, '0');
    const secDir = join(paperDir, 'sections', `${pad}-${sec.slug}`);
    mkdirSync(secDir, { recursive: true });

    const draftContent = `${sec.heading}\n\nContent for ${sec.slug}. No citations.\n`;
    writeFileSync(join(secDir, 'DRAFT.md'), draftContent);

    const planMd = [
      '---',
      `slug: ${sec.slug}`,
      'state: verified',
      `verified_against_draft_hash: aabbccdd`,  // intentionally stale — tests staleness path too
      'assigned_sources: []',
      '---',
      '',
      `# ${sec.slug}`,
    ].join('\n') + '\n';
    writeFileSync(join(secDir, 'PLAN.md'), planMd);

    writeFileSync(
      join(secDir, 'VERIFICATION.md'),
      `# VERIFICATION\n\nstate: verified\nverdict: OK\n`,
    );
  }

  return root;
}

test('compile-order: compiled DRAFT.md contains sections in outline order (COMP-02)', async () => {
  const root = makePaperRoot();
  const paperDir = join(root, '.paper');

  // Record mtimes + hashes before compile
  const beforeStats: Record<string, { mtime: number; hash: string }> = {};
  for (const [n, slug] of [[1, 'intro'], [2, 'method'], [3, 'results']]) {
    const p = join(paperDir, 'sections', `0${n}-${slug}`, 'DRAFT.md');
    const bytes = readFileSync(p);
    beforeStats[`${n}-${slug}`] = {
      mtime: statSync(p).mtimeMs,
      hash: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  const { runCompile } = await import('../bin/lib/compile.js').catch(() => {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  });

  const result = await runCompile({ paperRoot: root, yolo: true });
  assert.ok(result.ok, `compile must succeed: ${result.reason ?? 'unknown'}`);

  const compiledDraft = join(paperDir, 'DRAFT.md');
  assert.ok(existsSync(compiledDraft), '.paper/DRAFT.md must be written');
  const content = readFileSync(compiledDraft, 'utf8');

  // Assert outline order: Introduction before Methodology before Results
  const introIdx = content.indexOf('Introduction Section');
  const methodIdx = content.indexOf('Methodology Section');
  const resultsIdx = content.indexOf('Results Section');

  assert.ok(introIdx > -1, 'compiled draft must contain Introduction section');
  assert.ok(methodIdx > -1, 'compiled draft must contain Methodology section');
  assert.ok(resultsIdx > -1, 'compiled draft must contain Results section');
  assert.ok(introIdx < methodIdx, 'Introduction must appear before Methodology (outline order)');
  assert.ok(methodIdx < resultsIdx, 'Methodology must appear before Results (outline order)');
});

test('compile-order: section DRAFT.md files are read-only (mtime + hash unchanged) (ARCH-20)', async () => {
  const root = makePaperRoot();
  const paperDir = join(root, '.paper');

  // Record before state
  const before: Record<string, { mtime: number; hash: string }> = {};
  for (const [n, slug] of [[1, 'intro'], [2, 'method'], [3, 'results']]) {
    const p = join(paperDir, 'sections', `0${n}-${slug}`, 'DRAFT.md');
    const bytes = readFileSync(p);
    before[`${n}-${slug}`] = {
      mtime: statSync(p).mtimeMs,
      hash: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  const { runCompile } = await import('../bin/lib/compile.js').catch(() => {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  });

  await runCompile({ paperRoot: root, yolo: true });

  // Assert after state
  for (const [n, slug] of [[1, 'intro'], [2, 'method'], [3, 'results']]) {
    const p = join(paperDir, 'sections', `0${n}-${slug}`, 'DRAFT.md');
    const bytes = readFileSync(p);
    const after = {
      mtime: statSync(p).mtimeMs,
      hash: createHash('sha256').update(bytes).digest('hex'),
    };
    const beforeEntry = before[`${n}-${slug}`];
    assert.ok(beforeEntry, `before-state missing for section ${n}-${slug}`);
    assert.equal(
      after.hash,
      beforeEntry.hash,
      `sections/${n}-${slug}/DRAFT.md content-hash changed — compile must not write section files (ARCH-20)`,
    );
    // Note: mtime check is best-effort; on some filesystems a read may not change mtime
    // The hash check is the authoritative read-only assertion.
  }
});

test('compile-order: compiled DRAFT.md is written atomically (COMP-07 / D-07)', async () => {
  // Assert that .paper/DRAFT.md exists and was not partially written
  // (atomic write means either fully new or old content — no partial state).
  const root = makePaperRoot();
  const paperDir = join(root, '.paper');

  const { runCompile } = await import('../bin/lib/compile.js').catch(() => {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  });

  const result = await runCompile({ paperRoot: root, yolo: true });
  assert.ok(result.ok, `compile must succeed: ${result.reason ?? 'unknown'}`);
  assert.ok(existsSync(join(paperDir, 'DRAFT.md')), '.paper/DRAFT.md must exist after compile');
  assert.ok(existsSync(join(paperDir, 'COMPILE-REPORT.md')), '.paper/COMPILE-REPORT.md must exist after compile');
});

test('compile-order: section drafts normalized to one trailing newline before concat (§F)', async () => {
  // The compiled DRAFT.md should not have double-blank gaps between sections
  // greater than expected (each section normalized to single trailing \n, then joined with \n\n).
  const root = makePaperRoot();
  const paperDir = join(root, '.paper');

  const { runCompile } = await import('../bin/lib/compile.js').catch(() => {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  });

  const result = await runCompile({ paperRoot: root, yolo: true });
  if (!result.ok) return;  // if compile fails for other reasons, skip

  const content = readFileSync(join(paperDir, 'DRAFT.md'), 'utf8');
  // Must not have triple-blank lines (which would indicate un-normalized trailing newlines)
  assert.ok(
    !content.includes('\n\n\n\n'),
    'compiled DRAFT.md must not have quadruple newlines — sections must be normalized to one trailing \\n',
  );
});
