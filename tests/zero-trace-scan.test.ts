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
  writeFileSync(home, 'A path /Users/bob/Desktop/notes leaked.\n');
  assert.ok((await scanExportFile(home, CTX(root))).some((f) => /home-folder path of the OS user/.test(f.finding)), 'the OS user\'s home-folder path');
  writeFileSync(home, 'A path /home/nobody-zt/notes.txt leaked.\n');
  assert.ok((await scanExportFile(home, CTX(root))).some((f) => /path in the home folder/.test(f.finding)), 'a path in $HOME');
});

// Review round 1: a source's web address, or another user's example path in
// the prose, is not this machine's path — the export is not refused (it was
// refused, and deleted, on every run). Metadata still may hold none of them.
test('EXP-07 (review r1): web URLs holding /home/x/ or /Users/x/ and example paths in prose pass; the same path in metadata is flagged', async () => {
  const root = bobPaper();
  const dir = join(root, '.paper', 'export');
  const md = join(dir, 'a.md');
  writeFileSync(md, 'See <https://www.example.org/home/research/report.pdf> and https://www.example.edu/Users/smith/notes.pdf.\n\nThe tool keeps its data under /home/alice/data/ and C:\\Users\\carol\\AppData\\ by default.\n\nSmith, J. (2020). Notes. https://www.example.edu/home/smith/notes.pdf\n');
  assert.deepEqual(await scanExportFile(md, CTX(root)), []);
  const bib = join(dir, 'a.bib');
  writeFileSync(bib, '@misc{a, title = {Report}, url = {https://www.example.org/home/research/report.pdf}, abstract = {Files under /home/user/ are cached.}, year = {2020}}\n');
  assert.deepEqual(await scanExportFile(bib, CTX(root)), []);
  const ris = join(dir, 'a.ris');
  writeFileSync(ris, 'TY  - GEN\nTI  - Report\nUR  - https://www.example.org/home/research/report.pdf\nER  - \n');
  assert.deepEqual(await scanExportFile(ris, CTX(root)), []);
  // The OS user's home inside a web URL is a site's path too.
  writeFileSync(md, 'See https://www.example.edu/home/bob/notes.pdf for details.\n');
  assert.deepEqual(await scanExportFile(md, CTX(root)), []);
  // Metadata (a bib comment) may hold no home-folder path of anyone, and no file:// URL.
  writeFileSync(bib, '% from /home/alice/papers\n@misc{a, title = {Report}, year = {2020}}\n');
  assert.ok((await scanExportFile(bib, CTX(root))).some((f) => f.where === 'outside the entries' && /home-folder path/.test(f.finding)));
  writeFileSync(bib, '% from file:///srv/papers\n@misc{a, title = {Report}, year = {2020}}\n');
  assert.ok((await scanExportFile(bib, CTX(root))).some((f) => /file:\/\/ URL/.test(f.finding)));
});

test('EXP-07 (review r1): an untrusted-data fence marker in author content is flagged (a model artifact)', async () => {
  const { FENCE_OPEN } = await import('../bin/lib/untrusted-fence.js');
  const root = bobPaper();
  const md = join(root, '.paper', 'export', 'fence.md');
  writeFileSync(md, `# Title\n\n${FENCE_OPEN}\nA paragraph.\n`);
  assert.ok((await scanExportFile(md, CTX(root))).some((f) => /fence marker/.test(f.finding)));
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

// Review round 1: an external relationship's target is the hyperlink the body
// or a reference shows (author content). The scrub never rewrites it (it did:
// every dry-run DOI link lost "pensmith" while its text kept it), and the scan
// checks it as author content — a web address passes, a local path does not.
test('EXP-06 (review r1): zeroTracePatch keeps an external hyperlink target as written; the scan checks it as author content', async () => {
  const root = bobPaper();
  const rels = (target: string): string =>
    '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    `<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${target}" TargetMode="External"/>` +
    '<!-- written by pensmith --></Relationships>';
  const build = async (target: string): Promise<string> => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>doi.org/10.0000/pensmith-dryrun.bbe3ccd6</w:t></w:r></w:p></w:body></w:document>');
    zip.file('word/_rels/document.xml.rels', rels(target));
    const file = join(root, '.paper', 'export', `links-${Math.random().toString(36).slice(2)}.docx`);
    writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
    return file;
  };
  const file = await build('https://doi.org/10.0000/pensmith-dryrun.bbe3ccd6');
  await zeroTracePatch(file);
  const out = await (await JSZip.loadAsync(readFileSync(file))).file('word/_rels/document.xml.rels')!.async('string');
  assert.match(out, /Target="https:\/\/doi\.org\/10\.0000\/pensmith-dryrun\.bbe3ccd6"/, 'the link target still matches its text');
  assert.doesNotMatch(out, /<!--/, 'the structural comment is removed');
  assert.deepEqual(await scanExportFile(file, CTX(root)), [], 'a web address in a link target is author content');
  const local = await build(`file://${root}/notes.pdf`);
  await zeroTracePatch(local);
  assert.ok((await scanExportFile(local, CTX(root))).some((f) => f.where === 'word/_rels/document.xml.rels' && /paper's folder path/.test(f.finding)));
});

// Review round 2: a short project root (/app, /data, /code in a container) is
// matched only as a whole path — `web/app` or `meta/data` in the prose is not
// the paper's folder, and every export of such a paper was refused.
test('EXP-07 (review r2): a short root or home is a finding only as a whole path, never inside another path segment', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-zt-short-'));
  const md = join(dir, 'DRAFT.md');
  const scan = async (text: string, paperRoot: string, home = '/home/nobody-zt'): Promise<string[]> => {
    writeFileSync(md, text);
    return (await scanExportFile(md, { paperRoot, home, username: 'bob' })).map((f) => f.finding);
  };
  assert.deepEqual(await scan('We separate the source/code from the web/app layer and the meta/data store.\n', '/app'), []);
  assert.deepEqual(await scan('We separate the source/code layer.\n', '/code'), []);
  assert.deepEqual(await scan('Meta/data and /apple and /app.js and /application/x are other paths.\n', '/app'), []);
  assert.deepEqual(await scan('A path x/root/notes is not the home folder.\n', '/srv/p', '/root'), []);
  assert.match((await scan('My notes are in /app/notes.txt.\n', '/app')).join(), /paper's folder path \(\/app\)/);
  assert.match((await scan('The paper lives in /app.\n', '/app')).join(), /paper's folder path/);
  assert.match((await scan('See file:///app/notes.txt.\n', '/app')).join(), /paper's folder path/);
  assert.match((await scan('See (/app/notes) and "/app/x".\n', '/app')).join(), /paper's folder path/);
  assert.match((await scan('Kept in /root/notes.txt.\n', '/srv/p', '/root')).join(), /path in the home folder/);
  // The export itself (the reviewer's case): a paper whose root is /app or
  // /code exports prose holding web/app and source/code in every format.
  const text = '# Title\n\n## Methods\n\nWe separate the source/code from the web/app layer [@x2020].\n';
  for (const paperRoot of ['/app', '/code']) {
    for (const format of ['md', 'docx', 'latex', 'pdf'] as const) {
      const out = join(dir, `out-${paperRoot.slice(1)}-${format}`);
      await withCapturedOutput(() => exportDraft({ inputPath: join(dir, 'DRAFT.md'), text, bibText: BIB, format, paperRoot, outputDir: out, pandocPresent: false, style: 'apa' }));
      assert.ok(readdirSync(out).some((f) => f.startsWith('DRAFT')), `${paperRoot} ${format}`);
    }
  }
});

// Review round 2: "generated by" is ordinary wording, and a MATLAB / TeX code
// block's `%` comment line is the author's — only a tool's places (metadata,
// a .tex's comment lines outside verbatim blocks) are checked for a generator
// comment. The md and LaTeX exports of such a paper were refused.
test('EXP-07 (review r2): a "generated by" %-line in author content (code block, wrapped prose) passes md, tex and docx; a tool comment is still flagged', async () => {
  const text =
    '# Title\n\n## Methods\n\nThe sample [@x2020] was simulated.\n\n```matlab\n%% Data generated by the Monte Carlo simulation\nx = randn(100,1);\n```\n\n' +
    'Of all answers, the share\n% of respondents generated by referral were excluded.\n';
  const { root, inputPath } = paperWith(text);
  for (const format of ['md', 'docx', 'latex', 'pdf'] as const) {
    const out = join(root, `out-${format}`);
    await withCapturedOutput(() => exportDraft({ inputPath, format, paperRoot: root, outputDir: out, pandocPresent: false, style: 'apa' }));
    const [file] = readdirSync(out).filter((f) => f.startsWith('DRAFT'));
    assert.ok(file !== undefined, format);
    if (format === 'latex') assert.match(readFileSync(join(out, file), 'utf8'), /%% Data generated by the Monte Carlo simulation/, 'the code line is kept as written');
  }
  // pandoc's LaTeX scrub keeps a verbatim comment line and drops its own.
  const tex = '% generated by pandoc\n\\documentclass{article}\n\\begin{document}\n\\begin{verbatim}\n%% Data generated by the Monte Carlo simulation\n\\end{verbatim}\n\\end{document}\n';
  const scrubbed = scrubPandocLatex(tex);
  assert.match(scrubbed, /%% Data generated by the Monte Carlo simulation/);
  assert.doesNotMatch(scrubbed, /% generated by pandoc/);
  const file = join(root, '.paper', 'export', 'T.tex');
  mkdirSync(join(root, '.paper', 'export'), { recursive: true });
  writeFileSync(file, scrubbed);
  assert.deepEqual(await scanExportFile(file, CTX(root)), []);
  // A comment line outside a verbatim block, in the body, is the writer's.
  writeFileSync(file, '\\documentclass{article}\n\\begin{document}\nBody.\n% Generated by pandoc\n\\end{document}\n');
  assert.ok((await scanExportFile(file, CTX(root))).some((f) => f.where === 'comment'));
  // Metadata keeps the generator-comment rule: a bib comment, a docx structural part.
  const bib = join(root, '.paper', 'export', 'G.bib');
  writeFileSync(bib, '% generated by some tool\n@misc{a, title = {Data generated by simulation}, year = {2020}}\n');
  const bibFindings = await scanExportFile(bib, CTX(root));
  assert.ok(bibFindings.some((f) => f.where === 'outside the entries' && /generator comment/.test(f.finding)), JSON.stringify(bibFindings));
  assert.ok(!bibFindings.some((f) => f.where === 'entries'));
});

// Review round 2: a LaTeX title is the paper's own text — "How Pensmith
// Checks Citations" or "/r/science" — not tool metadata; the preamble's other
// lines keep the metadata rules.
test('EXP-07 (review r2): a .tex title naming pensmith or holding /r/science passes on the built-in writer; the rest of the preamble keeps the metadata rules', async () => {
  for (const title of ['How Pensmith Checks Citations', 'Misinformation on /r/science and /r/askscience']) {
    const { root, inputPath } = paperWith(`# ${title}\n\n## Pensmith in Practice\n\nPensmith is a tool [@x2020].\n`);
    await withCapturedOutput(() => exportDraft({ inputPath, format: 'latex', paperRoot: root, pandocPresent: false, style: 'apa' }));
    const tex = readFileSync(join(root, '.paper', 'export', 'DRAFT.tex'), 'utf8');
    assert.ok(tex.includes('\\title{'), title);
  }
  const root = bobPaper();
  const file = join(root, '.paper', 'export', 'P.tex');
  writeFileSync(file, '\\documentclass{article}\n\\hypersetup{pdftitle={How Pensmith Works on /r/science}, pdfcreator={}}\n\\title{How \\emph{Pensmith} Works on /r/science}\n\\author{}\n\\begin{document}\n\\maketitle\nBody.\n\\end{document}\n');
  assert.deepEqual(await scanExportFile(file, CTX(root)), []);
  // A title still may not hold this machine's paths.
  writeFileSync(file, `\\documentclass{article}\n\\title{Notes from ${root}/x}\n\\begin{document}\nBody.\n\\end{document}\n`);
  assert.ok((await scanExportFile(file, CTX(root))).some((f) => f.where === 'title' && /paper's folder path/.test(f.finding)));
  // The rest of the preamble is metadata.
  writeFileSync(file, '\\documentclass{article}\n\\usepackage{pensmith-macros}\n\\title{T}\n\\begin{document}\nBody.\n\\end{document}\n');
  assert.ok((await scanExportFile(file, CTX(root))).some((f) => f.where === 'preamble' && /names pensmith/.test(f.finding)));
});

// Review round 2: a PDF's page text is glyph codes the file scan cannot read,
// so the same author rule runs on the text the PDF will print, before it is
// built — the PDF of a draft holding the paper's folder path is refused like
// its md, docx and tex.
test('EXP-07 (review r2): the PDF export of a text holding the paper\'s folder path is refused before anything is written', async () => {
  const { root, inputPath } = paperWith('# A Paper\n\nPLACEHOLDER\n');
  writeFileSync(inputPath, `# A Paper\n\nMy notes are in ${root}/notes [@x2020].\n`);
  await assert.rejects(
    withCapturedOutput(() => exportDraft({ inputPath, format: 'pdf', paperRoot: root, pandocPresent: false, style: 'apa' })),
    (e: unknown) => e instanceof ZeroTraceError && e.exitCode === EXIT_ERROR && /DRAFT\.pdf \(text\) holds the paper's folder path/.test(e.message),
  );
  assert.deepEqual(readdirSync(join(root, '.paper', 'export')), [], 'nothing is left in export/');
});
