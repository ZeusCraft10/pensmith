// tests/zero-trace-export.test.ts — Phase 6 Wave 0 RED scaffold for TEST-10 / DONE-07.
//
// THE GATING TEST. NON-NEGOTIABLE per CLAUDE.md / ROADMAP SC1: zero pensmith
// trace + zero identifying metadata in ANY exported document. This suite scans
// ALL FOUR export formats (.md, .tex, .docx, .pdf) OFFLINE, Pandoc-INDEPENDENT
// and PDF-engine-INDEPENDENT (pdf-lib is pure-JS), against committed negative
// controls (sample-zero-trace.docx / .pdf) and the exporter's deterministic
// offline md→tex writer.
//
// RED-by-skip (mirrors tests/known-bad-pass2.test.ts): the two negative-control
// tests (Test A docx, Test C pdf) PASS now because the fixtures genuinely carry a
// trace. The four scrub/scan tests (B docx, D pdf, E md, F tex) are SKIP-guarded
// on bin/lib/exporter.ts — they un-skip and must PASS once Wave 2 lands the module.
// The whole suite reports skips with ZERO failures in Wave 0.
//
// Test D is load-bearing: it asserts BOTH 'pensmith' AND the non-'pensmith' token
// 'Trace Sentinel' are gone after zeroTracePdf(), proving STRUCTURAL XMP-stream
// removal (the indirect object deleted) rather than a literal byte-mask that would
// leave 'Trace Sentinel' behind in an intact <x:xmpmeta> block.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';

const FIXTURE_DOCX = fileURLToPath(new URL('../tests/fixtures/sample-zero-trace.docx', import.meta.url));
const FIXTURE_PDF = fileURLToPath(new URL('../tests/fixtures/sample-zero-trace.pdf', import.meta.url));

// Exporter module: production source path (existence guard) + runtime import URL.
const exporterSrcPath = fileURLToPath(new URL('../bin/lib/exporter.ts', import.meta.url));
const exporterModUrl = new URL('../bin/lib/exporter.js', import.meta.url);

// The identifying core.xml fields that zeroTracePatch MUST blank.
const CORE_FIELDS = [
  'dc:creator', 'dc:title', 'dc:subject', 'dc:description',
  'cp:keywords', 'cp:category', 'cp:contentStatus', 'cp:lastModifiedBy',
];

// =====================================================================
//   Test A — DOCX negative control (always runs)
// =====================================================================
test('zero-trace Test A: fixture .docx is a valid negative control (pensmith in core.xml + _rels/.rels)', async () => {
  const buf = readFileSync(FIXTURE_DOCX);
  const zip = await JSZip.loadAsync(buf);
  const coreEntry = zip.file('docProps/core.xml');
  const relsEntry = zip.file('_rels/.rels');
  assert.ok(coreEntry, 'fixture must contain docProps/core.xml');
  assert.ok(relsEntry, 'fixture must contain _rels/.rels');
  const core = await coreEntry.async('string');
  const rels = await relsEntry.async('string');
  assert.match(core, /<dc:creator>\s*Trace Sentinel\s*<\/dc:creator>/, 'fixture must carry a non-empty dc:creator');
  assert.ok(core.toLowerCase().includes('pensmith'), 'fixture core.xml must carry literal pensmith');
  assert.ok(core.includes('cp:category'), 'fixture core.xml must carry cp:category (the narrow-patch trap)');
  assert.ok(rels.toLowerCase().includes('pensmith'), 'fixture _rels/.rels (non-.xml) must carry pensmith (the .xml-only-sweep trap)');
});

// =====================================================================
//   Test B — DOCX scrub (skip-guarded on exporter.ts)
// =====================================================================
test('zero-trace Test B: zeroTracePatch removes ALL trace from every docx entry (DONE-07)',
  { skip: !existsSync(exporterSrcPath) },
  async () => {
    const mod = await import(exporterModUrl.href) as {
      zeroTracePatch: (docxPath: string) => Promise<void>;
    };
    const dir = mkdtempSync(join(tmpdir(), 'pensmith-ztdocx-'));
    const tmpDocx = join(dir, 'out.docx');
    copyFileSync(FIXTURE_DOCX, tmpDocx);
    await mod.zeroTracePatch(tmpDocx);

    const zip = await JSZip.loadAsync(readFileSync(tmpDocx));
    const violations: string[] = [];

    // (1) NO entry (incl. non-.xml like _rels/.rels) contains 'pensmith'.
    for (const [name, file] of Object.entries(zip.files)) {
      if (file.dir) continue;
      const text = await file.async('string').catch(() => '');
      if (text.toLowerCase().includes('pensmith')) {
        violations.push(`${name}: contains 'pensmith'`);
      }
    }
    // explicit _rels/.rels assertion (the trap entry)
    const rels = await zip.file('_rels/.rels')?.async('string') ?? '';
    if (rels.toLowerCase().includes('pensmith')) {
      violations.push('_rels/.rels: still contains pensmith');
    }

    // (2) core.xml identifying fields blank.
    const core = await zip.file('docProps/core.xml')?.async('string') ?? '';
    for (const tag of CORE_FIELDS) {
      const re = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`);
      const m = re.exec(core);
      if (m && m[1] && m[1].trim().length > 0) {
        violations.push(`docProps/core.xml: ${tag} not blank: '${m[1].trim()}'`);
      }
    }
    // (3) timestamps normalized to epoch.
    for (const ts of ['dcterms:created', 'dcterms:modified']) {
      const re = new RegExp(`<${ts}[^>]*>([^<]*)</${ts}>`);
      const m = re.exec(core);
      if (m && m[1] && !m[1].includes('1970-01-01T00:00:00Z')) {
        violations.push(`docProps/core.xml: ${ts} not epoch: '${m[1]}'`);
      }
    }
    // (4) app.xml identifying fields blank/removed.
    const app = await zip.file('docProps/app.xml')?.async('string') ?? '';
    for (const tag of ['Application', 'Company', 'Manager']) {
      const re = new RegExp(`<${tag}>([^<]+)</${tag}>`);
      const m = re.exec(app);
      if (m && m[1] && m[1].trim().length > 0) {
        violations.push(`docProps/app.xml: ${tag} not blank: '${m[1].trim()}'`);
      }
    }

    assert.deepEqual(violations, [], `zero-trace docx violations: ${violations.join(' | ')}`);
  },
);

// =====================================================================
//   Test C — PDF negative control (always runs)
// =====================================================================
test('zero-trace Test C: fixture .pdf is a valid negative control (pensmith + Trace Sentinel in /Info AND XMP)', async () => {
  const bytes = readFileSync(FIXTURE_PDF);
  const s = bytes.toString('latin1');
  // pensmith in /Info AND XMP
  assert.match(s, /\/Producer\s*\(pensmith/, 'fixture /Info must carry pensmith (Producer)');
  assert.match(s, /x:xmpmeta[\s\S]*pensmith/, 'fixture XMP stream must carry pensmith');
  // Trace Sentinel in /Info AND XMP — the structural-removal negative control.
  assert.match(s, /\/Author\s*\(Trace Sentinel/, 'fixture /Info must carry Trace Sentinel (Author)');
  assert.match(s, /x:xmpmeta[\s\S]*Trace Sentinel/, 'fixture XMP stream must carry Trace Sentinel');
});

// =====================================================================
//   Test D — PDF scrub (skip-guarded on exporter.ts) — LOAD-BEARING
// =====================================================================
test('zero-trace Test D: zeroTracePdf structurally removes XMP (pensmith AND Trace Sentinel gone, still loads) (DONE-07 / HIGH-1)',
  { skip: !existsSync(exporterSrcPath) },
  async () => {
    const mod = await import(exporterModUrl.href) as {
      zeroTracePdf: (pdfPath: string) => Promise<void>;
    };
    const dir = mkdtempSync(join(tmpdir(), 'pensmith-ztpdf-'));
    const tmpPdf = join(dir, 'out.pdf');
    copyFileSync(FIXTURE_PDF, tmpPdf);
    await mod.zeroTracePdf(tmpPdf);

    const scrubbed = readFileSync(tmpPdf);
    const s = scrubbed.toString('latin1');
    const violations: string[] = [];

    // (1) NO 'pensmith' anywhere.
    if (/pensmith/i.test(s)) violations.push("raw bytes still contain 'pensmith'");
    // (2) NO 'Trace Sentinel' anywhere — proves structural XMP removal, not literal mask.
    if (/Trace Sentinel/.test(s)) violations.push("raw bytes still contain 'Trace Sentinel' (XMP not structurally removed)");
    // (3) /Info identifying fields empty/removed AND no identifying XMP stream remains.
    for (const tag of ['Producer', 'Creator', 'Author', 'Title', 'Subject', 'Keywords']) {
      const re = new RegExp(`/${tag}\\s*\\(([^)]+)\\)`);
      const m = re.exec(s);
      if (m && m[1] && m[1].trim().length > 0) {
        violations.push(`/Info /${tag} not empty: '${m[1].trim()}'`);
      }
    }
    if (/x:xmpmeta[\s\S]*(?:Trace Sentinel|pensmith)/.test(s)) {
      violations.push('an identifying x:xmpmeta stream still remains');
    }

    assert.deepEqual(violations, [], `zero-trace pdf violations: ${violations.join(' | ')}`);

    // (4) scrubbed PDF still loads — no length-altering byte edit corrupted it.
    await assert.doesNotReject(PDFDocument.load(scrubbed), 'scrubbed PDF must still load via pdf-lib');
  },
);

// =====================================================================
//   Test E — md trace-free (skip-guarded on exporter.ts)
// =====================================================================
test('zero-trace Test E: exported .md carries no pensmith and no generator comment (DONE-07)',
  { skip: !existsSync(exporterSrcPath) },
  async () => {
    const mod = await import(exporterModUrl.href) as {
      exportDraft: (opts: {
        inputPath: string; format: string; paperRoot: string; pandocPresent?: boolean;
      }) => Promise<{ outputPath: string }>;
    };
    const root = mkdtempSync(join(tmpdir(), 'pensmith-ztmd-'));
    mkdirSync(join(root, '.paper'), { recursive: true });
    const inputPath = join(root, '.paper', 'DRAFT.md');
    writeFileSync(inputPath, '# A Clean Draft\n\nBody text with no identifying trace whatsoever.\n');
    writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '');

    const res = await mod.exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false });
    const out = readFileSync(res.outputPath, 'utf8');
    assert.ok(!out.toLowerCase().includes('pensmith'), "exported .md must not contain 'pensmith'");
    assert.ok(!/<!--\s*generated by/i.test(out), 'exported .md must not contain a generator HTML comment');
  },
);

// =====================================================================
//   Test F — tex trace-free on a REAL offline-produced artifact
// =====================================================================
test('zero-trace Test F: exported .tex (deterministic offline md→tex, no Pandoc) carries no trace + no generator comment (DONE-07)',
  { skip: !existsSync(exporterSrcPath) },
  async () => {
    const mod = await import(exporterModUrl.href) as {
      exportDraft: (opts: {
        inputPath: string; format: string; paperRoot: string; pandocPresent?: boolean;
      }) => Promise<{ outputPath: string }>;
    };
    const root = mkdtempSync(join(tmpdir(), 'pensmith-zttex-'));
    mkdirSync(join(root, '.paper'), { recursive: true });
    const inputPath = join(root, '.paper', 'DRAFT.md');
    writeFileSync(inputPath, '# A Clean Draft\n\nBody text with no identifying trace whatsoever.\n');
    writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '');

    // pandocPresent:false drives the deterministic offline md→tex writer — the
    // produced .tex is a REAL scanned artifact, not "clean by construction".
    const res = await mod.exportDraft({ inputPath, format: 'latex', paperRoot: root, pandocPresent: false });
    assert.ok(res.outputPath.endsWith('.tex'), 'offline latex export must produce a real .tex artifact');
    const out = readFileSync(res.outputPath, 'utf8');
    assert.ok(!out.toLowerCase().includes('pensmith'), "exported .tex must not contain 'pensmith'");
    assert.ok(!/%\s*pensmith/i.test(out), 'exported .tex must not contain a "% pensmith" comment');
    assert.ok(!/%\s*Generated by/i.test(out), 'exported .tex must not contain a "% Generated by" comment');
  },
);
