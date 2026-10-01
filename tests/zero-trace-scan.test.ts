// tests/zero-trace-scan.test.ts — the zero-trace scanner (EXP-07, D-21-08).
//
// Every file an export writes is scanned after writing and after its scrub.
// These cases build the negative controls the plan names — the unpatched
// docx fixture with pandoc's path-bearing custom.xml, a PDF with pdf-lib's
// default Producer, an app.xml naming a generator, a PNG with a tEXt chunk,
// pdfTeX's /PTEX.Fullbanner, a path under <tmp>/x/Users/bob/School/essay —
// and prove each is flagged, that the scrubs clean them, that author content
// is never flagged for a bare word (audit #18), that every writer's output
// passes, and that a hit or a failed scrub leaves NOTHING in export/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { scanExportFile, zeroTracePatch, zeroTracePdf, ZeroTraceError } from '../bin/lib/export/zero-trace.js';
import { scrubPandocLatex } from '../bin/lib/export/pandoc.js';
import { __setScrubForTest, exportDraft, type ExportFormat } from '../bin/lib/exporter.js';
import { withCapturedOutput } from '../bin/lib/output-sink.js';
import { EXIT_ERROR } from '../bin/lib/exit-codes.js';

const FIXTURE_DOCX = fileURLToPath(new URL('./fixtures/sample-zero-trace.docx', import.meta.url));
/** A paper under a home-like path (EXP-06's acceptance shape). */
function bobPaper(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'pensmith-zt-')), 'x', 'Users', 'bob', 'School', 'essay');
  mkdirSync(join(root, '.paper', 'export'), { recursive: true });
  return root;
}
const CTX = (root: string): { paperRoot: string; home: string; username: string } => ({ paperRoot: root, home: '/home/nobody-zt', username: 'bob' });

test('EXP-07: the unpatched fixture docx is flagged — custom.xml with absolute paths, the creator, the generator, pensmith', async () => {
  const root = bobPaper();
  const file = join(root, '.paper', 'export', 'fixture.docx');
  copyFileSync(FIXTURE_DOCX, file);
  const findings = await scanExportFile(file, CTX(root));
  const text = findings.map((f) => `${f.where}: ${f.finding}`).join('\n');
  assert.match(text, /docProps\/custom\.xml: is a custom-properties part/);
  assert.match(text, /docProps\/custom\.xml: holds an absolute path \(\/tmp\/x\/Users\/bob\/School\/essay\/\.paper\/export\/CITATIONS\.bib\)/);
  assert.match(text, /docProps\/custom\.xml: .*(\.csl|citation-styles|\.claude\/plugins)/);
  assert.match(text, /docProps\/app\.xml: sets Application \("Microsoft Word 12\.0\.0"\)/);
  assert.match(text, /docProps\/app\.xml: sets AppVersion/);
  assert.match(text, /docProps\/core\.xml: sets dc:creator/);
  assert.match(text, /names pensmith/);
});

test('EXP-06: zeroTracePatch cleans the fixture completely — the scan then finds nothing', async () => {
  const root = bobPaper();
  const file = join(root, '.paper', 'export', 'fixture.docx');
  copyFileSync(FIXTURE_DOCX, file);
  await zeroTracePatch(file);
  assert.deepEqual(await scanExportFile(file, CTX(root)), []);
  const zip = await JSZip.loadAsync(readFileSync(file));
  assert.equal(zip.file('docProps/custom.xml'), null, 'custom.xml removed');
  for (const [name, entry] of Object.entries(zip.files)) assert.equal(entry.date.getTime(), Date.UTC(1980, 0, 1), `${name} carries the zip epoch`);
});

test('EXP-07: a docx whose app.xml names a generator is flagged', async () => {
  const root = bobPaper();
  const zip = new JSZip();
  zip.file('docProps/app.xml', '<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>pandoc</Application><AppVersion>3.9</AppVersion></Properties>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Body.</w:t></w:r></w:p></w:body></w:document>');
  const file = join(root, '.paper', 'export', 'gen.docx');
  writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
  const findings = (await scanExportFile(file, CTX(root))).map((f) => f.finding).join('\n');
  assert.match(findings, /sets Application \("pandoc"\)/);
  assert.match(findings, /sets AppVersion \("3\.9"\)/);
});

/** A minimal PNG with a tEXt chunk (the scanner reads chunk types, not CRCs). */
function pngWithText(): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0])),
    chunk('tEXt', Buffer.from('Software\0an image tool', 'latin1')),
    chunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0, 0, 0, 1, 0, 1])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('EXP-07: a docx embedding a PNG with a tEXt chunk is flagged (BRDTH-02 strips them on embed)', async () => {
  const root = bobPaper();
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>');
  zip.file('word/media/image1.png', pngWithText());
  const file = join(root, '.paper', 'export', 'img.docx');
  writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
  const findings = await scanExportFile(file, CTX(root));
  assert.ok(findings.some((f) => f.where === 'word/media/image1.png' && /PNG tEXt chunk/.test(f.finding)), JSON.stringify(findings));
});

test('EXP-07: a PDF with pdf-lib\'s default Producer / Creator is flagged; one with /PTEX.Fullbanner too; zeroTracePdf cleans both', async () => {
  const root = bobPaper();
  const dflt = await PDFDocument.create();
  dflt.addPage();
  const a = join(root, '.paper', 'export', 'default.pdf');
  writeFileSync(a, await dflt.save());
  const fa = (await scanExportFile(a, CTX(root))).map((f) => f.finding).join('\n');
  assert.match(fa, /sets \/Producer \("pdf-lib/);
  assert.match(fa, /sets \/Creator \("pdf-lib/);

  const tex = await PDFDocument.create({ updateMetadata: false });
  tex.addPage();
  const info = tex.context.obj({ Producer: PDFString.of('pdfTeX-1.40.26'), 'PTEX.Fullbanner': PDFString.of('This is pdfTeX, Version 3.141592653-2.6-1.40.26') });
  tex.context.trailerInfo.Info = tex.context.register(info);
  const b = join(root, '.paper', 'export', 'ptex.pdf');
  writeFileSync(b, await tex.save());
  const fb = (await scanExportFile(b, CTX(root))).map((f) => f.finding).join('\n');
  assert.match(fb, /non-standard key \/PTEX\.Fullbanner \(a TeX engine banner\)/);
  assert.match(fb, /sets \/Producer \("pdfTeX/);

  await zeroTracePdf(a);
  await zeroTracePdf(b);
  assert.deepEqual(await scanExportFile(a, CTX(root)), []);
  assert.deepEqual(await scanExportFile(b, CTX(root)), []);
  const reloaded = await PDFDocument.load(readFileSync(b), { updateMetadata: false });
  assert.equal(reloaded.catalog.get(PDFName.of('Metadata')), undefined);
});

test('EXP-07: a path under <tmp>/x/Users/bob/School/essay is flagged in metadata and in author content; a bare word never is (audit #18)', async () => {
  const root = bobPaper();
  const md = join(root, '.paper', 'export', 'DRAFT.md');
  writeFileSync(md, `# Title\n\nSee ${root}/notes.txt for details.\n`);
  const f1 = await scanExportFile(md, CTX(root));
  assert.ok(f1.some((f) => /paper's folder path/.test(f.finding)), JSON.stringify(f1));
  writeFileSync(md, '# Title\n\nThe user asked pensmith-like tools about a .bib file and the Bob family; the /usr/bin/env idiom is common.\n');
  assert.deepEqual(await scanExportFile(md, CTX(root)), [], 'author prose with bare words passes');
  const home = join(root, '.paper', 'export', 'home.md');
  writeFileSync(home, 'A path /Users/alice/Desktop/notes leaked.\n');
  assert.ok((await scanExportFile(home, CTX(root))).some((f) => /home-folder path/.test(f.finding)));
});

test('EXP-07: a pandoc LaTeX preamble naming its generator is flagged, and the LaTeX scrub cleans it', async () => {
  const root = bobPaper();
  const file = join(root, '.paper', 'export', 'DRAFT.tex');
  const tex = '% Options for packages loaded elsewhere\n\\documentclass{article}\n\\hypersetup{\n  pdftitle={T},\n  pdfcreator={LaTeX via pandoc}}\n\\begin{document}\nBody.\n\\end{document}\n';
  writeFileSync(file, tex);
  assert.ok((await scanExportFile(file, CTX(root))).some((f) => /pdfcreator/.test(f.finding)));
  writeFileSync(file, scrubPandocLatex(tex));
  assert.deepEqual(await scanExportFile(file, CTX(root)), []);
});

test('EXP-07: a bib comment holding a path and a RIS RETRACTED note are flagged; entries with a title naming pensmith pass', async () => {
  const root = bobPaper();
  const bib = join(root, '.paper', 'export', 'CITATIONS.bib');
  writeFileSync(bib, `% exported from ${root}/.paper/CITATIONS.bib\n@article{a, title = {On pensmith and other tools}, year = {2020}}\n`);
  assert.ok((await scanExportFile(bib, CTX(root))).some((f) => f.where === 'outside the entries'));
  writeFileSync(bib, '@article{a, title = {On pensmith and other tools}, year = {2020}}\n');
  assert.deepEqual(await scanExportFile(bib, CTX(root)), []);
  const ris = join(root, '.paper', 'export', 'CITATIONS.ris');
  writeFileSync(ris, 'TY  - JOUR\nID  - a\nN1  - RETRACTED\nER  - \n');
  assert.ok((await scanExportFile(ris, CTX(root))).some((f) => /RETRACTED/.test(f.finding)));
});

const BIB = '@article{x2020, author = {Xu, Wei}, title = {Growth in China}, journal = {J}, year = {2020}, doi = {10.1/x}}\n';

function paperWith(draft: string): { root: string; inputPath: string } {
  const root = bobPaper();
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), BIB);
  const inputPath = join(root, '.paper', 'DRAFT.md');
  writeFileSync(inputPath, draft);
  return { root, inputPath };
}

for (const format of ['md', 'docx', 'pdf', 'latex'] as const satisfies readonly ExportFormat[]) {
  test(`EXP-07: the built-in ${format} writer's output, its bib and its RIS pass the scan (a paper under …/Users/bob/School/essay)`, async () => {
    const { root, inputPath } = paperWith('# A Paper\n\n## One\n\nA claim [@x2020, p. 4] about growth in China. A user wrote about pensmith.\n');
    const { result } = await withCapturedOutput(() => exportDraft({ inputPath, format, paperRoot: root, pandocPresent: false, style: 'apa' }));
    for (const f of readdirSync(join(root, '.paper', 'export'))) {
      assert.deepEqual(await scanExportFile(join(root, '.paper', 'export', f), { paperRoot: root }), [], f);
    }
    assert.equal(result.writer, 'built-in');
  });
}

test('D-21-08: a scan hit deletes every file the export wrote and throws ZeroTraceError (EXIT_ERROR) — the bib and RIS included', async () => {
  const { root, inputPath } = paperWith('# A Paper\n\nMy notes are in PLACEHOLDER [@x2020].\n');
  writeFileSync(inputPath, `# A Paper\n\nMy notes are in ${root}/notes [@x2020].\n`);
  await assert.rejects(
    withCapturedOutput(() => exportDraft({ inputPath, format: 'docx', paperRoot: root, pandocPresent: false, style: 'apa' })),
    (e: unknown) => e instanceof ZeroTraceError && e.exitCode === EXIT_ERROR && /DRAFT\.docx \(word\/document\.xml\) holds the paper's folder path/.test(e.message),
  );
  assert.deepEqual(readdirSync(join(root, '.paper', 'export')), [], 'nothing is left in export/');
});

test('D-21-08 / EXP-07: an injected scrub failure leaves no .docx in export/ and throws ZeroTraceError (EXIT_ERROR) — no Markdown fallback', async () => {
  const { root, inputPath } = paperWith('# A Paper\n\nA claim [@x2020].\n');
  __setScrubForTest(async () => {
    throw new Error('simulated zip failure');
  });
  try {
    await assert.rejects(
      withCapturedOutput(() => exportDraft({ inputPath, format: 'docx', paperRoot: root, pandocPresent: false, style: 'apa' })),
      (e: unknown) => e instanceof ZeroTraceError && e.exitCode === EXIT_ERROR && /could not be scrubbed \(simulated zip failure\)/.test(e.message),
    );
  } finally {
    __setScrubForTest(null);
  }
  const left = readdirSync(join(root, '.paper', 'export'));
  assert.ok(!left.some((f) => f.endsWith('.docx') || f.endsWith('.md')), `no docx, no Markdown stand-in: ${left.join(', ')}`);
  assert.ok(!existsSync(join(root, '.paper', 'export', 'CITATIONS.bib')));
});
