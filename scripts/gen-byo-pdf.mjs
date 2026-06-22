// scripts/gen-byo-pdf.mjs — one-shot generator for the Phase 8 BYO PDF fixture.
//
// Produces a WELL-FORMED uncompressed PDF via pdf-lib (already a dependency).
// History: a prior hand-rolled %PDF-1.4 with a byte-offset xref table parsed
// locally + on win/mac but failed on ubuntu CI with PDF.js "bad XRef entry"
// (the hand-built xref was fragile across PDF.js platform builds). pdf-lib
// emits a spec-correct classic xref; `useObjectStreams: false` keeps the
// catalog/pages/page/font objects uncompressed and the text content stream as
// plain `BT /F1 Tf Td (..) Tj ET` operators, which pdf-parse@1.1.1 (a 2018
// pdf.js fork) extracts reliably on all three OSes.
//
// Run via: node scripts/gen-byo-pdf.mjs
import { writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const lines = [
  'Attention Is All You Need',
  'Vaswani Shazeer Parmar Uszkoreit 2017',
  'Abstract The dominant sequence transduction models are based on',
  'complex recurrent or convolutional neural networks',
  'We propose the Transformer based solely on attention mechanisms',
  'doi 10.48550 arXiv 1706.03762',
];

const doc = await PDFDocument.create();
// Determinism: pin metadata to epoch so the committed fixture is byte-stable
// across regenerations (no wall-clock CreationDate/ModDate drift).
const epoch = new Date(0);
doc.setCreationDate(epoch);
doc.setModificationDate(epoch);
const font = await doc.embedFont(StandardFonts.Helvetica);
const page = doc.addPage([612, 792]);
let y = 740;
for (const ln of lines) {
  page.drawText(ln, { x: 56, y, size: 12, font });
  y -= 18;
}

// useObjectStreams:false → classic uncompressed xref table (no cross-reference
// streams), which the old pdf-parse PDF.js fork parses without "bad XRef entry".
const bytes = await doc.save({ useObjectStreams: false });
writeFileSync('tests/fixtures/pdf/byo-text.pdf', bytes);
console.log('wrote', bytes.length, 'bytes (pdf-lib, uncompressed, epoch-dated)');
