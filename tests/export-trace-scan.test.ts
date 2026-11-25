// tests/export-trace-scan.test.ts — the docx/pdf scrubs, and the trace scan as
// the export's last gate.
//
// zeroTracePatch used to blank a few fields in core.xml/app.xml and never
// touched docProps/custom.xml, where Pandoc records the absolute --csl and
// --bibliography paths. The scrubs now rebuild the metadata from nothing, and
// the exporter scans every finished file and refuses the export on a finding.
// None of these cases needs Pandoc.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { scanExportFile } from '../bin/lib/trace-scan.js';
import { pandocLikeDocx } from './lib/docx-fixture.js';
import { exportDraft, zeroTracePatch, zeroTracePdf, ExportError } from '../bin/lib/exporter.js';
import { compiledPaper, needsTool, runCli } from './lib/export-fixture.js';

function tmp(name: string): string {
  return join(mkdtempSync(join(tmpdir(), 'pensmith-trace-')), name);
}

test('zeroTracePatch: drops custom.xml with its relationship and content type, and rebuilds core/app from nothing', async () => {
  const file = tmp('paper.docx');
  await pandocLikeDocx(file, '/home/someone');
  await zeroTracePatch(file);

  const zip = await JSZip.loadAsync(readFileSync(file));
  assert.equal(zip.file('docProps/custom.xml'), null, 'custom.xml must be removed');
  const rels = (await zip.file('_rels/.rels')!.async('string'));
  const types = (await zip.file('[Content_Types].xml')!.async('string'));
  assert.doesNotMatch(rels, /custom-properties|custom\.xml/);
  assert.doesNotMatch(types, /custom/);
  assert.match(rels, /Target="word\/document\.xml"/, 'the main document relationship stays');
  assert.match(types, /\/word\/document\.xml/);
  const core = await zip.file('docProps/core.xml')!.async('string');
  const app = await zip.file('docProps/app.xml')!.async('string');
  assert.doesNotMatch(core, /<dc:title>T</);
  assert.match(core, /1970-01-01T00:00:00Z/);
  assert.doesNotMatch(app, /Application|TotalTime/);
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    assert.doesNotMatch(await entry.async('string'), /\/home\/someone/, `${name} still names the home folder`);
  }
  assert.deepEqual(await scanExportFile(file, 'docx', {}), [], 'a scrubbed docx passes the scanner');
});

test('zeroTracePdf: the info dictionary, XMP and TeX banner keys are removed; the scanner then passes', async () => {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.addPage();
  pdf.setProducer('pdfTeX-1.40.25');
  pdf.setCreator('LaTeX via pandoc');
  pdf.setTitle('pensmith draft');
  const info = pdf.context.lookup(pdf.context.trailerInfo.Info) as unknown as { set: (k: PDFName, v: unknown) => void };
  info.set(PDFName.of('PTEX.Fullbanner'), PDFString.of('This is pdfTeX, Version 3.14'));
  const xmp = pdf.context.flateStream('<x:xmpmeta>pensmith</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' });
  pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(xmp));
  const file = tmp('paper.pdf');
  writeFileSync(file, await pdf.save({ useObjectStreams: false }));

  const before = await scanExportFile(file, 'pdf', {});
  assert.ok(before.some((f) => f.what === 'document property'), JSON.stringify(before));
  assert.ok(before.some((f) => f.what === 'XMP metadata'), JSON.stringify(before));

  await zeroTracePdf(file);
  const raw = readFileSync(file).toString('latin1');
  for (const s of ['pdfTeX', 'PTEX', 'via pandoc', 'pensmith', '/Producer', '/Metadata']) assert.ok(!raw.includes(s), `still contains ${s}`);
  assert.deepEqual(await scanExportFile(file, 'pdf', {}), []);
});

test('export refuses when a cited work would ship a local path, and writes nothing', async () => {
  // A source added from a local PDF can carry a file URL. Shipping it in the
  // references would name the user's folders.
  const bib = '@article{local2021, author={Doe, Jane}, title={From Disk}, journal={J}, year={2021}, url={file:///home/jane/papers/from-disk.pdf}}\n';
  const root = compiledPaper({
    bib,
    sections: [{ slug: 'intro', title: 'Introduction', draft: 'A finding [@local2021].\n', sources: ['local2021'] }],
  });
  await assert.rejects(
    exportDraft({ inputPath: join(root, '.paper', 'DRAFT.md'), format: 'md', paperRoot: root, pandocPresent: false }),
    (err: unknown) => err instanceof ExportError && err.kind === 'trace-found' && err.details.some((d) => /home\/jane/.test(d)),
  );
  assert.ok(!existsSync(join(root, '.paper', 'export', 'DRAFT.md')), 'nothing is exported');
  assert.deepEqual(readdirSync(join(root, '.paper')).filter((n) => n.startsWith('.export-')), [], 'no staging folder is left');

  // Through the CLI: a refusal (exit 2) that names the finding, and no FINAL.md.
  const r = runCli(['done', '--yolo', '--raw', '--format', 'md'], root);
  assert.equal(r.status, 2, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.match(r.stdout + r.stderr, /home\/jane/);
  assert.ok(!existsSync(join(root, '.paper', 'FINAL.md')), 'a refused export does not mark the paper done');
});

const ZETA_BIB = '@article{zeta2020, author={Zeta, Zed}, title={Tidal Sediment Transport}, journal={Estuarine Science}, year={2020}, doi={10.1000/zeta}}\n';

test('a hard-wrapped "generated\\nby" in the author\'s prose exports in md and LaTeX, with and without Pandoc', async (t) => {
  // Ordinary academic prose: "energy generated by", "data generated by".
  const draft = 'Most of the power in the estuary is generated\nby tidal barrages [@zeta2020].\n';
  const root = compiledPaper({ bib: ZETA_BIB, sections: [{ slug: 'intro', title: 'Introduction', draft, sources: ['zeta2020'] }] });
  const inputPath = join(root, '.paper', 'DRAFT.md');
  for (const format of ['md', 'latex'] as const) {
    const res = await exportDraft({ inputPath, format, paperRoot: root, pandocPresent: false });
    assert.match(readFileSync(res.outputPath, 'utf8'), /generated\s+by tidal barrages/, format);
  }
  const pandoc = needsTool('pandoc');
  if (pandoc.skip) {
    t.diagnostic(pandoc.skip);
    return;
  }
  for (const format of ['latex', 'docx'] as const) {
    const res = await exportDraft({ inputPath, format, paperRoot: root, pandocPresent: true });
    assert.ok(existsSync(res.outputPath), format);
  }
  const r = runCli(['done', '--yolo', '--raw', '--format', 'latex'], root);
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
});

test('a home folder of /root does not refuse prose that says "shoot/root"', async () => {
  const draft = 'The shoot/root ratio rose under salinity [@zeta2020].\n';
  const root = compiledPaper({ bib: ZETA_BIB, sections: [{ slug: 'intro', title: 'Introduction', draft, sources: ['zeta2020'] }] });
  const saved = process.env['HOME'];
  process.env['HOME'] = '/root';
  try {
    const res = await exportDraft({ inputPath: join(root, '.paper', 'DRAFT.md'), format: 'md', paperRoot: root, pandocPresent: false });
    assert.match(readFileSync(res.outputPath, 'utf8'), /shoot\/root ratio/);
  } finally {
    if (saved === undefined) delete process.env['HOME'];
    else process.env['HOME'] = saved;
  }
});

test('an empty HOME does not hide the real home folder from the scan', async () => {
  // The user's own words are excused, except a path of this machine.
  const home = userInfo().homedir;
  const draft = `Notes are kept in ${home}/notes/tides.txt [@zeta2020].\n`;
  const root = compiledPaper({ bib: ZETA_BIB, sections: [{ slug: 'intro', title: 'Introduction', draft, sources: ['zeta2020'] }] });
  const saved = { HOME: process.env['HOME'], USERPROFILE: process.env['USERPROFILE'] };
  process.env['HOME'] = '';
  process.env['USERPROFILE'] = '';
  try {
    await assert.rejects(
      exportDraft({ inputPath: join(root, '.paper', 'DRAFT.md'), format: 'md', paperRoot: root, pandocPresent: false }),
      (err: unknown) => err instanceof ExportError && err.kind === 'trace-found' && err.details.some((d) => d.includes('local path of this machine')),
    );
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
