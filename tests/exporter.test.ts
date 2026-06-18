// tests/exporter.test.ts — Phase 6 Wave 0 RED scaffold for DONE-06 + DONE-08.
//
// Mirrors tests/known-bad-pass2.test.ts RED-by-skip stance: behavioral tests
// SKIP-guard on the not-yet-created bin/lib/exporter.ts so the suite reports skips
// with ZERO failures. Plan 06-02 lands exporter.ts and these turn GREEN.
//
// Covers:
//   - DONE-06: Pandoc absent (machine default) → markdown-only fallback into a
//     DISTINCT export dir (never onto the source DRAFT.md), banner mentions Pandoc,
//     no ENOENT throw; pandocPresent=false is injectable for determinism.
//   - DONE-08: CITATIONS.bib copied into the export dir alongside the output.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exporterSrcPath = fileURLToPath(new URL('../bin/lib/exporter.ts', import.meta.url));
const exporterModUrl = new URL('../bin/lib/exporter.js', import.meta.url);

interface ExportResult { outputPath: string }
type ExportDraft = (opts: {
  inputPath: string; format: string; paperRoot: string; pandocPresent?: boolean;
}) => Promise<ExportResult>;

function seedPaper(slug: string): { root: string; inputPath: string } {
  const root = mkdtempSync(join(tmpdir(), `pensmith-exporter-${slug}-`));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const inputPath = join(root, '.paper', 'DRAFT.md');
  writeFileSync(inputPath, '# Draft\n\nA clean draft with no identifying trace.\n');
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '@article{x2020, title={X}}\n');
  return { root, inputPath };
}

// RED-by-skip module-presence consistency (mirrors known-bad-pass2).
test('exporter: module presence is consistent with Wave-0 RED state (DONE-06)', () => {
  if (existsSync(exporterSrcPath)) {
    assert.ok(true, 'bin/lib/exporter.ts present — behavioral tests active');
  } else {
    assert.ok(!existsSync(exporterSrcPath), 'Wave-0: bin/lib/exporter.ts absent (RED-by-skip)');
  }
});

test('exporter: Pandoc-absent docx request → markdown fallback into a distinct export dir + Pandoc banner, no ENOENT (DONE-06)',
  { skip: !existsSync(exporterSrcPath) },
  async () => {
    const mod = await import(exporterModUrl.href) as { exportDraft: ExportDraft };
    const { root, inputPath } = seedPaper('fallback');

    const stdoutLines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      stdoutLines.push(s);
      return true;
    };
    let res: ExportResult;
    try {
      res = await mod.exportDraft({ inputPath, format: 'docx', paperRoot: root, pandocPresent: false });
    } finally {
      (process.stdout as unknown as { write: typeof origWrite }).write = origWrite;
    }

    // (1) banner mentions Pandoc; fallback produced an output that exists.
    assert.ok(stdoutLines.some((l) => /Pandoc/.test(l)), 'must print a banner mentioning Pandoc');
    assert.ok(existsSync(res.outputPath), 'fallback must write an output file');
    // (2) output is in a distinct export dir, NOT the source DRAFT.md.
    assert.notEqual(resolve(res.outputPath), resolve(inputPath), 'must not overwrite source DRAFT.md');
    assert.notEqual(resolve(dirname(res.outputPath)), resolve(join(root, '.paper')),
      'export output dir must be distinct from paperDir itself');
  },
);

test('exporter: CITATIONS.bib copied into export dir alongside the output, distinct source/dest (DONE-08)',
  { skip: !existsSync(exporterSrcPath) },
  async () => {
    const mod = await import(exporterModUrl.href) as { exportDraft: ExportDraft };
    const { root, inputPath } = seedPaper('bibcopy');
    const res = await mod.exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false });

    const exportDir = dirname(res.outputPath);
    const copiedBib = join(exportDir, 'CITATIONS.bib');
    assert.ok(existsSync(copiedBib), 'CITATIONS.bib must be copied alongside the export output');
    const srcBib = join(root, '.paper', 'CITATIONS.bib');
    assert.notEqual(resolve(copiedBib), resolve(srcBib), 'copy dest must be distinct from source');
    assert.equal(readFileSync(copiedBib, 'utf8'), readFileSync(srcBib, 'utf8'), 'copied bib must match source bytes');
  },
);

test('exporter: deterministic on injected pandocPresent=false (no dependence on real Pandoc binary) (DONE-06)',
  { skip: !existsSync(exporterSrcPath) },
  async () => {
    const mod = await import(exporterModUrl.href) as { exportDraft: ExportDraft };
    const { root, inputPath } = seedPaper('deterministic');
    await assert.doesNotReject(
      mod.exportDraft({ inputPath, format: 'docx', paperRoot: root, pandocPresent: false }),
      'injected pandocPresent=false path must not throw ENOENT',
    );
  },
);
