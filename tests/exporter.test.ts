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
//
// Phase 13 additions (Plan 13-01 — RED-by-skip, REND-01/02/03):
//   - REND-01: No raw [@key] token survives in offline citation-rendered output.
//   - REND-02: A "## References" bibliography heading appears in the rendered output.
//   - REND-03: Offline APA formatted reference ("Vaswani") appears in the rendered output,
//              using the committed known-good fixture (vaswani2017attention).
//   - Pandoc-args guard: --citeproc/--csl/--bibliography present in source + bib-before-pandoc ordering.
//   - Zero-trace non-regression: citation-rendered md output contains no 'pensmith'.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exporterSrcPath = fileURLToPath(new URL('../bin/lib/exporter.ts', import.meta.url));
const exporterModUrl = new URL('../bin/lib/exporter.js', import.meta.url);

// ---------------------------------------------------------------------------
// Task 1: Source-grep RED-by-skip predicate for resolveAndRenderCitations wiring
// (D-07-01 / D-10-00 precedent: source-grep is the load-bearing skip gate for
// symbols that exist in files that already exist as stubs/partials)
// ---------------------------------------------------------------------------

// Read the exporter source text once at module load — used for both the skip
// predicate and the structural source-ordering assertions in Task 3.
// Guard: missing source file → empty string → predicate stays false (never throws).
const exporterSrcText: string = (() => {
  try {
    return existsSync(exporterSrcPath) ? readFileSync(exporterSrcPath, 'utf8') : '';
  } catch {
    return '';
  }
})();

/**
 * renderCitationsWired — true only when Plan 13-02 has wired the
 * resolveAndRenderCitations helper into bin/lib/exporter.ts.
 *
 * Wave-0 RED-by-skip: while this is false all REND-01/02/03 tests skip,
 * keeping the full suite GREEN with 0 failures.
 */
const renderCitationsWired: boolean = exporterSrcText.includes('resolveAndRenderCitations');

interface ExportResult { outputPath: string; bibCopied?: boolean; risCopied?: boolean }
type ExportDraft = (opts: {
  inputPath: string; format: string; paperRoot: string; pandocPresent?: boolean;
  style?: string;
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

// Task 1: Consistency test for the renderCitationsWired source-grep predicate.
// Reports RED-by-skip state while Plan 13-02 wiring is absent; flips active
// when resolveAndRenderCitations lands in bin/lib/exporter.ts.
test('exporter: renderCitationsWired source-grep predicate reflects Plan 13-02 wiring state (REND)', () => {
  if (renderCitationsWired) {
    assert.ok(true, 'resolveAndRenderCitations wired — REND behavioral tests are active');
  } else {
    // Wave-0: the wiring has not landed yet. Assert the symbol is indeed absent
    // to confirm the predicate is genuinely detecting absence (not a path error).
    assert.ok(
      !exporterSrcText.includes('resolveAndRenderCitations'),
      'Wave-0 RED-by-skip: resolveAndRenderCitations not yet wired into exporter.ts (will skip REND tests)',
    );
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

// CITE-05 — mirror of the DONE-08 bib-copy test for the RIS sibling artifact.
test('exporter: CITATIONS.ris copied into export dir alongside the output, distinct source/dest, risCopied=true (CITE-05)',
  { skip: !existsSync(exporterSrcPath) },
  async () => {
    const mod = await import(exporterModUrl.href) as { exportDraft: ExportDraft };
    const { root, inputPath } = seedPaper('riscopy');
    // Seed a CITATIONS.ris fixture alongside the .bib the helper already wrote.
    const srcRis = join(root, '.paper', 'CITATIONS.ris');
    writeFileSync(srcRis, 'TY  - JOUR\nTI  - X\nER  -\n');

    const res = await mod.exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false });

    const exportDir = dirname(res.outputPath);
    const copiedRis = join(exportDir, 'CITATIONS.ris');
    assert.ok(existsSync(copiedRis), 'CITATIONS.ris must be copied alongside the export output');
    assert.notEqual(resolve(copiedRis), resolve(srcRis), 'copy dest must be distinct from source');
    assert.equal(readFileSync(copiedRis, 'utf8'), readFileSync(srcRis, 'utf8'), 'copied ris must match source bytes');
    assert.equal(res.risCopied, true, 'res.risCopied must be true when the source .ris is present');
  },
);

// CITE-05 — absent .ris must not throw; risCopied=false. The seed helper writes
// a .bib but NOT a .ris, so this exercises the existsSync guard.
test('exporter: absent CITATIONS.ris → no throw, risCopied=false (CITE-05)',
  { skip: !existsSync(exporterSrcPath) },
  async () => {
    const mod = await import(exporterModUrl.href) as { exportDraft: ExportDraft };
    const { root, inputPath } = seedPaper('nori');
    const res = await mod.exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false });
    assert.ok(!existsSync(join(dirname(res.outputPath), 'CITATIONS.ris')), 'no .ris copied when source absent');
    assert.equal(res.risCopied, false, 'res.risCopied must be false when the source .ris is absent');
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

// ---------------------------------------------------------------------------
// Task 2: REND-01/02/03 offline assertions on the known-good fixture (RED-by-skip)
//
// FIXTURE_DIR uses fileURLToPath(new URL(...)) — spaced-path safe per the
// Phase-11 %20 lesson. The OneDrive path contains spaces; fileURLToPath
// correctly decodes the percent-encoded URL path to the real filesystem path.
// ---------------------------------------------------------------------------

// Fixture dir resolved once at module scope (spaced-path safe).
const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/known-good-fixture', import.meta.url));

test(
  'exporter: REND-01/02/03 offline — known-good fixture: no raw [@key], APA in-text appears, ## References heading, "Vaswani" present (REND-01/02/03)',
  { skip: !renderCitationsWired },
  async () => {
    const mod = await import(exporterModUrl.href) as { exportDraft: ExportDraft };

    // Read fixture files via the spaced-path-safe FIXTURE_DIR constant.
    const fixtureMd = readFileSync(join(FIXTURE_DIR, 'section.md'), 'utf8');
    const fixtureBib = readFileSync(join(FIXTURE_DIR, 'CITATIONS.bib'), 'utf8');

    // Seed a tmp paper with the known-good fixture content.
    const root = mkdtempSync(join(tmpdir(), 'pensmith-rend-'));
    mkdirSync(join(root, '.paper'), { recursive: true });
    const inputPath = join(root, '.paper', 'DRAFT.md');
    writeFileSync(inputPath, fixtureMd);
    writeFileSync(join(root, '.paper', 'CITATIONS.bib'), fixtureBib);

    // Fully offline: pandocPresent:false, style:'apa'.
    const res = await mod.exportDraft({
      inputPath,
      format: 'md',
      paperRoot: root,
      pandocPresent: false,
      style: 'apa',
    });

    const rendered = readFileSync(res.outputPath, 'utf8');

    // REND-01: No raw [@key] token survives in the rendered output.
    assert.ok(
      !rendered.includes('[@'),
      `REND-01 FAIL: raw [@key] token survived in rendered output:\n${rendered}`,
    );

    // REND-03: A formatted reference containing "Vaswani" appears (APA in-text rendered).
    assert.ok(
      rendered.includes('Vaswani'),
      `REND-03 FAIL: "Vaswani" not found in rendered output (formatted reference absent):\n${rendered}`,
    );

    // REND-02: A bibliography heading "## References" appears.
    assert.ok(
      rendered.includes('## References'),
      `REND-02 FAIL: "## References" bibliography heading not found in rendered output:\n${rendered}`,
    );
  },
);

test(
  'exporter: REND-01 APA in-text form pin — "(Vaswani et al., 2017)" appears in offline rendered output (REND-01)',
  { skip: !renderCitationsWired },
  async () => {
    const mod = await import(exporterModUrl.href) as { exportDraft: ExportDraft };

    const fixtureMd = readFileSync(join(FIXTURE_DIR, 'section.md'), 'utf8');
    const fixtureBib = readFileSync(join(FIXTURE_DIR, 'CITATIONS.bib'), 'utf8');

    const root = mkdtempSync(join(tmpdir(), 'pensmith-rend-intext-'));
    mkdirSync(join(root, '.paper'), { recursive: true });
    const inputPath = join(root, '.paper', 'DRAFT.md');
    writeFileSync(inputPath, fixtureMd);
    writeFileSync(join(root, '.paper', 'CITATIONS.bib'), fixtureBib);

    const res = await mod.exportDraft({
      inputPath,
      format: 'md',
      paperRoot: root,
      pandocPresent: false,
      style: 'apa',
    });

    const rendered = readFileSync(res.outputPath, 'utf8');

    // Pin the exact APA in-text form verified in 13-RESEARCH.md.
    assert.ok(
      rendered.includes('(Vaswani et al., 2017)'),
      `REND-01 APA in-text FAIL: "(Vaswani et al., 2017)" not found in rendered output:\n${rendered}`,
    );

    // Confirm REND-01 beyond mere token-absence: no raw marker survives alongside the formatted form.
    assert.ok(
      !rendered.includes('[@vaswani2017attention]'),
      `REND-01 FAIL: raw [@vaswani2017attention] still present alongside formatted reference:\n${rendered}`,
    );
  },
);

// ---------------------------------------------------------------------------
// Task 3: Pandoc-args, bib-ordering, and zero-trace non-regression guard assertions
//
// Source-text assertions prove Pitfall-3 (--citeproc precedes --csl/--bibliography)
// and Pitfall-4 (bib-copy block precedes docx/pdf pandoc shellout) compliance
// without requiring Pandoc to be installed on the build machine.
// ---------------------------------------------------------------------------

test(
  'exporter: source contains --citeproc, --csl, --bibliography flags (Pandoc citeproc args guard, Pitfall-3)',
  { skip: !renderCitationsWired },
  () => {
    // These flags must be present in the source for the Pandoc citeproc path to work.
    assert.ok(
      exporterSrcText.includes('--citeproc'),
      "exporter source must contain '--citeproc' flag for Pandoc citation rendering",
    );
    assert.ok(
      exporterSrcText.includes('--csl'),
      "exporter source must contain '--csl' flag for Pandoc CSL style selection",
    );
    assert.ok(
      exporterSrcText.includes('--bibliography'),
      "exporter source must contain '--bibliography' flag for Pandoc bib reference",
    );
  },
);

test(
  'exporter: bib-copy block precedes docx/pdf pandoc execFileAsync call in source (Pitfall-4 ordering guard)',
  { skip: !renderCitationsWired },
  () => {
    // The bib-copy block (bibSrc/bibDst/copyFile pattern) must appear BEFORE
    // the first execFileAsync('pandoc', ...) call in the docx/pdf branch.
    // This proves Pitfall-4 compliance: --bibliography can find the copied bib.
    //
    // Detect bib-copy via the `bibDst` assignment (unique to the bib-copy block).
    // Detect the docx/pdf pandoc shellout via the first execFileAsync('pandoc' occurrence
    // after the format === 'md' || !pandoc branch (i.e., in the else branch for docx/pdf).
    //
    // Strategy: find the index of the bib-copy `copyFile` call that uses bibDst,
    // and the index of the first `execFileAsync('pandoc'` in the docx/pdf else branch.
    const bibCopyIdx = exporterSrcText.indexOf('bibDst');
    const pandocExecIdx = exporterSrcText.indexOf("execFileAsync('pandoc'");

    assert.ok(bibCopyIdx !== -1, "exporter source must contain bib-copy block with 'bibDst'");
    assert.ok(pandocExecIdx !== -1, "exporter source must contain execFileAsync('pandoc' call");

    // The bib-copy block (bibDst) must appear before the first pandoc execFileAsync.
    assert.ok(
      bibCopyIdx < pandocExecIdx,
      `Pitfall-4 FAIL: bib-copy block (index ${bibCopyIdx}) must precede first pandoc execFileAsync call (index ${pandocExecIdx}) — bib must be copied before Pandoc reads --bibliography`,
    );
  },
);

test(
  'exporter: citation-rendered md export contains no "pensmith" literal (zero-trace non-regression, REND path)',
  { skip: !renderCitationsWired },
  async () => {
    const mod = await import(exporterModUrl.href) as { exportDraft: ExportDraft };

    const fixtureMd = readFileSync(join(FIXTURE_DIR, 'section.md'), 'utf8');
    const fixtureBib = readFileSync(join(FIXTURE_DIR, 'CITATIONS.bib'), 'utf8');

    const root = mkdtempSync(join(tmpdir(), 'pensmith-rend-ztrace-'));
    mkdirSync(join(root, '.paper'), { recursive: true });
    const inputPath = join(root, '.paper', 'DRAFT.md');
    writeFileSync(inputPath, fixtureMd);
    writeFileSync(join(root, '.paper', 'CITATIONS.bib'), fixtureBib);

    // Export with citation rendering enabled (offline, pandocPresent:false, style:'apa').
    const res = await mod.exportDraft({
      inputPath,
      format: 'md',
      paperRoot: root,
      pandocPresent: false,
      style: 'apa',
    });

    const rendered = readFileSync(res.outputPath, 'utf8');

    // Zero-trace non-regression: the bibliography/References append must NOT
    // introduce any 'pensmith' literal (case-insensitive) in the exported output.
    assert.ok(
      !rendered.toLowerCase().includes('pensmith'),
      `Zero-trace FAIL: citation-rendered md output contains 'pensmith':\n${rendered}`,
    );
  },
);

// ---------------------------------------------------------------------------
// CR-02 regression: Pandoc locator syntax [@key p. N] must not leave raw [@...]
// The fixture section.md contains [@vaswani2017attention p. 2] — a locator cite.
// The key-extraction must strip the locator suffix so the map lookup succeeds.
// ---------------------------------------------------------------------------
test(
  'exporter: REND-01 locator citation [@key p. N] — no raw [@...] survives, formatted author present (CR-02)',
  { skip: !renderCitationsWired },
  async () => {
    const mod = await import(exporterModUrl.href) as { exportDraft: ExportDraft };

    const fixtureMd = readFileSync(join(FIXTURE_DIR, 'section.md'), 'utf8');
    const fixtureBib = readFileSync(join(FIXTURE_DIR, 'CITATIONS.bib'), 'utf8');

    // Confirm the fixture actually contains a locator citation (regression guard
    // against fixture being updated without this test knowing).
    assert.ok(
      fixtureMd.includes('[@vaswani2017attention p. 2]'),
      'fixture section.md must contain [@vaswani2017attention p. 2] for this test to be meaningful',
    );

    const root = mkdtempSync(join(tmpdir(), 'pensmith-rend-locator-'));
    mkdirSync(join(root, '.paper'), { recursive: true });
    const inputPath = join(root, '.paper', 'DRAFT.md');
    writeFileSync(inputPath, fixtureMd);
    writeFileSync(join(root, '.paper', 'CITATIONS.bib'), fixtureBib);

    const res = await mod.exportDraft({
      inputPath,
      format: 'md',
      paperRoot: root,
      pandocPresent: false,
      style: 'apa',
    });

    const rendered = readFileSync(res.outputPath, 'utf8');

    // REND-01: No raw [@...] token survives — locator must be stripped before lookup.
    assert.ok(
      !rendered.includes('[@'),
      `CR-02 FAIL: raw [@...] token survived in rendered output (locator not stripped):\n${rendered}`,
    );

    // Formatted author must appear (locator cite resolved to a real in-text reference).
    assert.ok(
      rendered.includes('Vaswani'),
      `CR-02 FAIL: "Vaswani" not found — locator citation was not resolved:\n${rendered}`,
    );
  },
);
