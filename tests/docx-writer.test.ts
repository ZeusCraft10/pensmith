// tests/docx-writer.test.ts — the built-in .docx writer (EXP-08, EXP-05,
// D-21-10).
//
// Without pandoc a requested docx is still a docx: WordprocessingML with
// Word's built-in style IDs (Heading 1 for the title, Heading 2 for the
// sections, Normal, Quote, Bibliography with a hanging indent), lists through
// numbering.xml, real footnotes in footnotes.xml, superscript runs, blank
// core and app properties, no custom.xml, no footer, epoch zip dates — and
// pandoc reads it back (when installed).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { writeDocx } from '../bin/lib/export/docx-writer.js';
import { exportDraft } from '../bin/lib/exporter.js';
import { withCapturedOutput } from '../bin/lib/output-sink.js';
import { sampleDocument, samplePaper } from './helpers/export-doc.js';
import { requirePandoc, runPandocIn } from './helpers/pandoc-oracle.js';

/** Every element of an XML text opens and closes in order (a well-formedness check without a parser). */
function assertBalanced(xml: string, part: string): void {
  const stack: string[] = [];
  const body = xml.replace(/<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '');
  for (const m of body.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
    if (m[4] === '/') continue;
    if (m[1] === '/') assert.equal(stack.pop(), m[2], `${part}: </${m[2]}> closes the wrong element`);
    else stack.push(m[2] as string);
  }
  assert.deepEqual(stack, [], `${part}: unclosed elements`);
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/.test(body), `${part}: an unescaped &`);
}

test('EXP-08 / EXP-05: the built-in docx is well-formed WordprocessingML with Word\'s style IDs — Heading 1 title, Heading 2 sections, Quote, lists, a table, a References list with a hanging indent', async () => {
  const { doc } = await sampleDocument('apa');
  const zip = await JSZip.loadAsync(await writeDocx(doc));
  const names = Object.keys(zip.files).sort();
  assert.deepEqual(names, ['[Content_Types].xml', '_rels/.rels', 'docProps/app.xml', 'docProps/core.xml', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/numbering.xml', 'word/settings.xml', 'word/styles.xml']);
  for (const n of names) assertBalanced(await zip.file(n)!.async('string'), n);
  const xml = await zip.file('word/document.xml')!.async('string');
  const paras = [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map((m) => m[1] as string);
  const styleOf = (text: string): string | undefined =>
    /<w:pStyle w:val="([^"]+)"\/>/.exec(paras.find((p) => p.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').includes(text)) ?? '')?.[1];
  assert.equal(styleOf('The Paradigm & the Bank'), 'Heading1', 'the title is Heading 1');
  assert.equal(styleOf('Introduction'), 'Heading2', 'a section is Heading 2');
  assert.equal(styleOf('References'), 'Heading2', 'the References heading is Heading 2');
  assert.equal(styleOf('Trust can be measured'), 'Quote');
  assert.equal(styleOf('Kuhn, T. S. (1962)'), 'Bibliography');
  assert.equal(styleOf('First point'), 'ListParagraph');
  assert.match(paras.find((p) => p.includes('First point')) ?? '', /<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="\d+"\/><\/w:numPr>/);
  assert.match(paras.find((p) => p.includes('A nested point')) ?? '', /<w:ilvl w:val="1"\/>/, 'a nested item is level 2');
  assert.match(xml, /<w:tbl>/);
  assert.match(xml, /<w:i\/><w:iCs\/><\/w:rPr><w:t xml:space="preserve">growth<\/w:t>/, 'emphasis is a run property');
  assert.match(xml, /\(Lindqvist &amp; Berg, 2012, p\. 150\)/, 'APA in-text citation with its locator');
  assert.ok(!/footerReference|headerReference/.test(xml), 'no header, no footer');
  const styles = await zip.file('word/styles.xml')!.async('string');
  for (const id of ['Normal', 'Heading1', 'Heading2', 'Quote', 'Bibliography', 'FootnoteText', 'FootnoteReference', 'SourceCode', 'VerbatimChar']) assert.match(styles, new RegExp(`w:styleId="${id}"`));
  assert.match(styles, /w:styleId="Bibliography">[\s\S]*?<w:ind w:left="720" w:hanging="720"\/>/, 'the Bibliography style hangs');
  const numbering = await zip.file('word/numbering.xml')!.async('string');
  assert.match(numbering, /<w:numFmt w:val="bullet"\/>/);
  assert.match(numbering, /<w:numFmt w:val="decimal"\/>/);
});

test('EXP-08 (zero trace by construction): blank core and app properties, no custom.xml, epoch dates, no pensmith, deterministic bytes', async () => {
  const { doc } = await sampleDocument('apa');
  const a = await writeDocx(doc);
  const b = await writeDocx(doc);
  assert.ok(a.equals(b), 'the same document gives the same bytes');
  const zip = await JSZip.loadAsync(a);
  const core = await zip.file('docProps/core.xml')!.async('string');
  assert.match(core, /<dc:title><\/dc:title><dc:creator><\/dc:creator>/);
  assert.match(core, /1970-01-01T00:00:00Z<\/dcterms:created>/);
  const app = await zip.file('docProps/app.xml')!.async('string');
  assert.ok(!/<Application>|<AppVersion>/.test(app), app);
  assert.equal(zip.file('docProps/custom.xml'), null);
  for (const [name, entry] of Object.entries(zip.files)) {
    assert.equal(entry.date.getTime(), Date.UTC(1980, 0, 1), `${name} date`);
    assert.ok(!/pensmith/i.test(await entry.async('string')), `${name} names pensmith`);
  }
});

test('EXP-04 / D-21-03: a note style gives real footnotes (word/footnotes.xml) and a superscript style superscript runs', async () => {
  const notes = await JSZip.loadAsync(await writeDocx((await sampleDocument('chicago-notes-bib')).doc));
  const fn = await notes.file('word/footnotes.xml')!.async('string');
  assertBalanced(fn, 'footnotes.xml');
  assert.match(fn, /<w:footnote w:type="separator" w:id="-1">/);
  assert.match(fn, /<w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"\/><\/w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"\/><\/w:rPr><w:footnoteRef\/>/);
  assert.match(fn, /Thomas S\. Kuhn/);
  const body = await notes.file('word/document.xml')!.async('string');
  assert.match(body, /<w:footnoteReference w:id="1"\/>/);
  assert.ok((await notes.file('word/_rels/document.xml.rels')!.async('string')).includes('Target="footnotes.xml"'));
  assert.ok(notes.file('word/_rels/footnotes.xml.rels') !== null, 'a footnote\'s DOI link is a relationship of the footnotes part');
  const ama = await JSZip.loadAsync(await writeDocx((await sampleDocument('ama')).doc));
  assert.match(await ama.file('word/document.xml')!.async('string'), /<w:vertAlign w:val="superscript"\/><\/w:rPr><w:t xml:space="preserve">1<\/w:t>/);
});

test('EXP-08: exportDraft without pandoc writes export/DRAFT.docx, names the built-in writer, and pandoc reads it back (-f docx) with the title, sections, citations and references', async (t) => {
  const { root, inputPath } = samplePaper();
  const { result, output } = await withCapturedOutput(() => exportDraft({ inputPath, format: 'docx', paperRoot: root, pandocPresent: false, style: 'apa' }));
  assert.match(output, /DRAFT\.docx — built-in docx writer — pandoc not found/);
  // The scrubbed package holds only its parts: no directory entries (the scrub
  // rewrites docProps/ and _rels/ parts without creating folder entries).
  const pkg = await JSZip.loadAsync(readFileSync(result.outputPath));
  assert.deepEqual(Object.values(pkg.files).filter((f) => f.dir).map((f) => f.name), [], 'no directory entries in the docx');
  if (!requirePandoc(t, 'docx read-back')) return;
  const md = runPandocIn({ 'in.docx': readFileSync(result.outputPath) }, ['in.docx', '-f', 'docx', '-t', 'markdown', '--wrap=none']);
  assert.match(md, /^# The Paradigm & the Bank: 100% "Growth"$/m);
  assert.match(md, /^## Introduction$/m);
  assert.match(md, /^## Discussion$/m);
  assert.match(md, /^## References$/m);
  assert.match(md, /\(Kuhn, 1962\)/);
  assert.match(md, /Lindqvist & Berg \(2012\) argue/);
  assert.match(md, /^> Trust can be measured/m);
  assert.match(md, /^-\s+First point with `code`$/m);
  assert.match(md, /Kuhn, T\. S\. \(1962\)\. \*The Structure of Scientific Revolutions\*/);
  const notes = runPandocIn({ 'in.docx': await writeDocx((await sampleDocument('chicago-notes-bib')).doc) }, ['in.docx', '-f', 'docx', '-t', 'markdown', '--wrap=none']);
  assert.match(notes, /accumulate\.\[\^1\]/);
  assert.match(notes, /^\[\^1\]: Thomas S\. Kuhn, \*The Structure of Scientific Revolutions\*/m);
});
