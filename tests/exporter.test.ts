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

// The cited entry (x2020) and an uncited research candidate (y2021): the export
// carries only what the document cites.
const CITED_BIB_ENTRY = '@article{x2020,\n\ttitle = {X},\n\tdoi = {10.1/x},\n}\n';
const UNCITED_BIB_ENTRY = '@article{y2021,\n\ttitle = {Y},\n\tdoi = {10.1/y},\n\tnote = {RETRACTED},\n}\n';

function seedPaper(slug: string): { root: string; inputPath: string } {
  const root = mkdtempSync(join(tmpdir(), `pensmith-exporter-${slug}-`));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const inputPath = join(root, '.paper', 'DRAFT.md');
  writeFileSync(inputPath, '# Draft\n\nA clean draft with no identifying trace [@x2020].\n');
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), CITED_BIB_ENTRY + UNCITED_BIB_ENTRY);
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
    // Tee, never swallow: the node:test reporter writes its TAP lines to this
    // same stdout, and a swallowed line silently drops a test from the count.
    (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      stdoutLines.push(s);
      return origWrite(s);
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

test('exporter: the export dir gets a CITATIONS.bib holding ONLY the cited entries, byte for byte, distinct source/dest (DONE-08)',
  { skip: !existsSync(exporterSrcPath) },
  async () => {
    const mod = await import(exporterModUrl.href) as { exportDraft: ExportDraft };
    const { root, inputPath } = seedPaper('bibcopy');
    const res = await mod.exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false });

    const exportDir = dirname(res.outputPath);
    const copiedBib = join(exportDir, 'CITATIONS.bib');
    assert.ok(existsSync(copiedBib), 'CITATIONS.bib must be written alongside the export output');
    const srcBib = join(root, '.paper', 'CITATIONS.bib');
    assert.notEqual(resolve(copiedBib), resolve(srcBib), 'copy dest must be distinct from source');
    // The uncited (retracted-flagged) research candidate never leaves .paper/.
    assert.equal(readFileSync(copiedBib, 'utf8'), CITED_BIB_ENTRY, 'the exported bib is exactly the cited entry');
    assert.equal(res.bibCopied, true);
    assert.equal(readFileSync(srcBib, 'utf8'), CITED_BIB_ENTRY + UNCITED_BIB_ENTRY, 'the library bib is untouched');
  },
);

test('exporter: a document that cites nothing exports no bibliography, and a stale one is removed (DONE-08)',
  { skip: !existsSync(exporterSrcPath) },
  async () => {
    const mod = await import(exporterModUrl.href) as { exportDraft: ExportDraft };
    const { root, inputPath } = seedPaper('nocite');
    writeFileSync(join(root, '.paper', 'CITATIONS.ris'), 'TY  - JOUR\nID  - y2021\nER  - \n');
    mkdirSync(join(root, '.paper', 'export'), { recursive: true });
    writeFileSync(join(root, '.paper', 'export', 'CITATIONS.bib'), UNCITED_BIB_ENTRY);
    writeFileSync(inputPath, '# Draft\n\nNo citations here.\n');
    const res = await mod.exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false });
    assert.equal(res.bibCopied, false);
    assert.equal(res.risCopied, false);
    assert.ok(!existsSync(join(dirname(res.outputPath), 'CITATIONS.bib')), 'no bib (and the stale one is gone)');
    assert.ok(!existsSync(join(dirname(res.outputPath), 'CITATIONS.ris')), 'no ris');
  },
);

// CITE-05 — mirror of the DONE-08 bib-copy test for the RIS sibling artifact.
test('exporter: CITATIONS.ris copied into export dir alongside the output, distinct source/dest, risCopied=true (CITE-05)',
  { skip: !existsSync(exporterSrcPath) },
  async () => {
    const mod = await import(exporterModUrl.href) as { exportDraft: ExportDraft };
    const { root, inputPath } = seedPaper('riscopy');
    // Seed a CITATIONS.ris alongside the .bib the helper already wrote: the
    // cited record and an uncited one.
    const srcRis = join(root, '.paper', 'CITATIONS.ris');
    const citedRis = 'TY  - JOUR\nID  - x2020\nTI  - X\nER  - \n';
    writeFileSync(srcRis, citedRis + 'TY  - JOUR\nID  - y2021\nTI  - Y\nER  - \n');

    const res = await mod.exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false });

    const exportDir = dirname(res.outputPath);
    const copiedRis = join(exportDir, 'CITATIONS.ris');
    assert.ok(existsSync(copiedRis), 'CITATIONS.ris must be written alongside the export output');
    assert.notEqual(resolve(copiedRis), resolve(srcRis), 'copy dest must be distinct from source');
    assert.equal(readFileSync(copiedRis, 'utf8'), citedRis, 'the exported ris is exactly the cited record');
    assert.equal(res.risCopied, true, 'res.risCopied must be true when the source .ris holds a cited record');
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
  'exporter (#19): offline LaTeX export resolves [@key] + emits a References section (no raw token, no empty bibliography)',
  { skip: !renderCitationsWired },
  async () => {
    const mod = await import(exporterModUrl.href) as { exportDraft: ExportDraft };

    const fixtureMd = readFileSync(join(FIXTURE_DIR, 'section.md'), 'utf8');
    const fixtureBib = readFileSync(join(FIXTURE_DIR, 'CITATIONS.bib'), 'utf8');

    const root = mkdtempSync(join(tmpdir(), 'pensmith-rend-tex-'));
    mkdirSync(join(root, '.paper'), { recursive: true });
    const inputPath = join(root, '.paper', 'DRAFT.md');
    writeFileSync(inputPath, fixtureMd);
    writeFileSync(join(root, '.paper', 'CITATIONS.bib'), fixtureBib);

    // Fully offline LaTeX: pandocPresent:false → the deterministic md→tex writer.
    const res = await mod.exportDraft({
      inputPath,
      format: 'latex',
      paperRoot: root,
      pandocPresent: false,
      style: 'apa',
    });
    const tex = readFileSync(res.outputPath, 'utf8');

    // #19: citations must be resolved — no raw [@key] token survives in the .tex.
    assert.ok(!tex.includes('[@'), `#19 FAIL: raw [@key] token survived in .tex:\n${tex}`);
    // The formatted reference is present (Vaswani fixture entry rendered).
    assert.ok(tex.includes('Vaswani'), `#19 FAIL: formatted reference "Vaswani" absent in .tex:\n${tex}`);
    // A bibliography section is emitted (## References → \section{References}).
    assert.match(tex, /\\section\{References\}/, `#19 FAIL: no References section in .tex:\n${tex}`);
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

// Review round 3 of Phase 18 (D-18-40, D-18-42): the offline renderer reads
// citations with the gates' grammar, so every form a gate accepts is rendered —
// never shipped as raw Pandoc syntax, never with its locator dropped.
const FORMS_BIB =
  '@article{lindqvist2012, author={Lindqvist, Anna and Berg, Olof}, title={Margin debt and crashes}, journal={Journal of Finance}, year={2012}, doi={10.1000/x1}}\n' +
  '@article{smith2020, author={Smith, John}, title={Credit}, journal={Econ}, year={2020}, doi={10.1000/x2}}\n';
const FORMS_MD =
  '# Draft\n\nAs @lindqvist2012 argues, margin debt mattered [@lindqvist2012, p. 5]. Then [see @smith2020, chap. 3; -@lindqvist2012] ' +
  'and @smith2020 [p. 7]. Braced [@{smith2020}] and bare [@smith2020, 33-35, emphasis added]. Year only: -@smith2020.\n';

async function exportForms(format: 'md' | 'latex', style: string): Promise<string> {
  const mod = await import(exporterModUrl.href) as { exportDraft: ExportDraft };
  const root = mkdtempSync(join(tmpdir(), `pensmith-forms-${format}-${style}-`));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const inputPath = join(root, '.paper', 'DRAFT.md');
  writeFileSync(inputPath, FORMS_MD);
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), FORMS_BIB);
  const res = await mod.exportDraft({ inputPath, format, paperRoot: root, pandocPresent: false, style });
  return readFileSync(res.outputPath, 'utf8');
}

test('exporter (review round 3): offline md renders every citation form — locators, prefixes, -@k, @{k}, narrative @k and @k [p. n]', async () => {
  const md = await exportForms('md', 'apa');
  const body = md.split('## References')[0] as string;
  assert.ok(!/@(?:lindqvist2012|smith2020)/.test(body), `no citation stays raw Pandoc syntax:\n${body}`);
  assert.ok(body.includes('As Lindqvist & Berg (2012) argues'), `a narrative citation is "Author (Year)":\n${body}`);
  assert.ok(body.includes('(Lindqvist & Berg, 2012, p. 5)'), `the locator is kept:\n${body}`);
  assert.ok(/see Smith, 2020, Chapter 3/.test(body) && /\(2012;/.test(body), `prefix, locator label and -@k (year only) are kept:\n${body}`);
  assert.ok(body.includes('Smith (2020, p. 7)'), `@k [p. 7] is a narrative citation with its locator:\n${body}`);
  assert.ok(body.includes('Braced (Smith, 2020)'), `a braced key renders:\n${body}`);
  assert.ok(body.includes('(Smith, 2020, pp. 33–35, emphasis added)'), `a bare-number locator is a page range, the rest a suffix:\n${body}`);
  assert.ok(body.includes('Year only: (2020).'), `a narrative -@k prints the year only:\n${body}`);
});

test('exporter (review round 3): offline LaTeX renders the same forms, and a numeric style numbers sources in first-citation order like its bibliography', async () => {
  const tex = await exportForms('latex', 'apa');
  assert.ok(!/@(?:lindqvist2012|smith2020)/.test(tex), `no raw citation in the .tex:\n${tex}`);
  assert.ok(tex.includes('Lindqvist \\& Berg, 2012, p. 5') || tex.includes('Lindqvist & Berg, 2012, p. 5'), `the locator is kept in the .tex:\n${tex}`);
  const ieee = await exportForms('md', 'ieee');
  const [body, refs] = ieee.split('## References') as [string, string];
  assert.ok(body.includes('As Lindqvist and Berg [1] argues'), `a numeric narrative citation is "Author [n]":\n${body}`);
  assert.ok(body.includes('[1, p. 5]') && body.includes('Smith [2, p. 7]') && body.includes('Braced [2]'), `each source keeps its first-citation number:\n${body}`);
  assert.ok(/\[1\] A\. Lindqvist/.test(refs) && /\[2\] J\. Smith/.test(refs), `the bibliography numbers match:\n${refs}`);
});
