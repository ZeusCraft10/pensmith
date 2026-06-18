// scripts/make-zero-trace-pdf-fixture.mjs — deterministic generator for the
// committed tests/fixtures/sample-zero-trace.pdf negative-control fixture
// (Phase 6 Wave 0, Plan 06-01 Task 1).
//
// PURPOSE (HIGH-1 — the PDF zero-trace contract)
// ----------------------------------------------
// Produces a REAL minimal PDF carrying identifying metadata in TWO independent
// places, so the PDF scrub (zeroTracePdf, Wave 2) can be proven to STRUCTURALLY
// remove the XMP stream rather than merely literal-mask 'pensmith':
//
//   1. An /Info dictionary with /Producer, /Creator, /Author, /Title, /Subject,
//      /Keywords. Two of these carry the literal 'pensmith' (Producer, Title)
//      and /Author carries the non-'pensmith' identifying token 'Trace Sentinel'.
//   2. An XMP metadata stream (uncompressed) carrying BOTH 'pensmith'
//      (pdf:Producer) AND 'Trace Sentinel' (dc:creator).
//
// Because 'Trace Sentinel' lives in BOTH /Info AND the XMP stream, a scrub that
// only deletes the literal 'pensmith' (e.g. a byte-sweep over an intact XMP
// block) would leave 'Trace Sentinel' behind — and zero-trace Test D would catch
// it. The only passing scrub is one that empties /Info AND deletes the XMP
// indirect object (structural removal) before re-serializing.
//
// AUTHORED BY HAND (not via pdf-lib)
// ----------------------------------
// The PDF object structure below is written as raw bytes with a hand-computed
// xref table. This keeps the fixture INDEPENDENT of the pdf-lib scrub library
// (a genuine negative control, not a closed loop). We still call
// PDFDocument.load() at the end ONLY to validate that the hand-authored bytes
// parse — never to author them.
//
// DETERMINISM
// -----------
// Fixed /ID, fixed object contents, no timestamps in the structural bytes, and a
// byte-exact xref computed from object offsets → re-running yields a byte-identical
// PDF. That stability lets tests/repo-files.test.ts SHA-256 byte-pin the fixture.
//
// REGENERATE: node scripts/make-zero-trace-pdf-fixture.mjs
// (after any intentional change, re-pin the SHA-256 in tests/repo-files.test.ts)

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PDFDocument } from 'pdf-lib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'tests', 'fixtures', 'sample-zero-trace.pdf');

// XMP packet — uncompressed. Carries 'pensmith' (pdf:Producer) AND the
// non-'pensmith' token 'Trace Sentinel' (dc:creator). Kept ASCII-only and
// LF-terminated for byte determinism.
const XMP = [
  '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
  '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
  ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
  '  <rdf:Description rdf:about=""',
  '    xmlns:pdf="http://ns.adobe.com/pdf/1.3/"',
  '    xmlns:dc="http://purl.org/dc/elements/1.1/">',
  '   <pdf:Producer>pensmith 0.1</pdf:Producer>',
  '   <dc:creator><rdf:Seq><rdf:li>Trace Sentinel</rdf:li></rdf:Seq></dc:creator>',
  '   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">pensmith draft</rdf:li></rdf:Alt></dc:title>',
  '  </rdf:Description>',
  ' </rdf:RDF>',
  '</x:xmpmeta>',
  '<?xpacket end="w"?>',
].join('\n');

function buildPdf() {
  // We assemble objects 1..6, tracking the byte offset of each so the xref table
  // is exact. All newlines are LF ('\n') for cross-platform byte determinism.
  const enc = (s) => Buffer.from(s, 'latin1');

  const header = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n';

  const objects = [];
  // 1: Catalog
  objects.push('<< /Type /Catalog /Pages 2 0 R /Metadata 6 0 R >>');
  // 2: Pages
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  // 3: Page
  objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>');
  // 4: Content stream (minimal, empty drawing)
  const content = 'BT ET';
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  // 5: /Info dictionary — identifying fields. 'pensmith' in Producer + Title;
  //    'Trace Sentinel' in Author.
  objects.push(
    '<< /Producer (pensmith 0.1) /Creator (pensmith exporter) ' +
      '/Author (Trace Sentinel) /Title (pensmith draft) ' +
      '/Subject (Trace Subject) /Keywords (trace, sentinel) >>',
  );
  // 6: XMP metadata stream (uncompressed)
  objects.push(
    `<< /Type /Metadata /Subtype /XML /Length ${XMP.length} >>\nstream\n${XMP}\nendstream`,
  );

  // Serialize objects, recording offsets.
  let body = header;
  const offsets = [];
  for (let i = 0; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(body, 'latin1');
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  // xref table
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  const n = objects.length + 1; // +1 for the free object 0
  let xref = `xref\n0 ${n}\n`;
  xref += '0000000000 65535 f \n';
  for (let i = 0; i < objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }

  // trailer — fixed /ID for determinism
  const trailer =
    `trailer\n<< /Size ${n} /Root 1 0 R /Info 5 0 R ` +
    `/ID [<0123456789ABCDEF0123456789ABCDEF> <0123456789ABCDEF0123456789ABCDEF>] >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return enc(body + xref + trailer);
}

async function main() {
  const bytes = buildPdf();
  writeFileSync(OUT, bytes);

  // Validate the hand-authored bytes parse with pdf-lib (load only — never author).
  await PDFDocument.load(bytes);

  // Self-check: 'pensmith' AND 'Trace Sentinel' present in BOTH /Info and XMP.
  const s = readFileSync(OUT, 'latin1');
  const infoRegion = s.slice(s.indexOf('/Producer'), s.indexOf('endobj', s.indexOf('/Producer')));
  const xmpRegion = s.slice(s.indexOf('x:xmpmeta'), s.indexOf('</x:xmpmeta>') + 12);
  const checks = [
    ['/Info has pensmith', /pensmith/i.test(infoRegion)],
    ['/Info has Trace Sentinel', /Trace Sentinel/.test(infoRegion)],
    ['XMP has pensmith', /pensmith/i.test(xmpRegion)],
    ['XMP has Trace Sentinel', /Trace Sentinel/.test(xmpRegion)],
  ];
  for (const [label, ok] of checks) {
    if (!ok) throw new Error(`PDF fixture self-check failed: ${label}`);
  }
  process.stdout.write(`wrote ${OUT} (${bytes.length} bytes); all self-checks passed\n`);
}

main().catch((err) => {
  process.stderr.write(`make-zero-trace-pdf-fixture failed: ${String(err)}\n`);
  process.exit(1);
});
