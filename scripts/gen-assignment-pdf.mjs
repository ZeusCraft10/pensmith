// scripts/gen-assignment-pdf.mjs — one-shot generator for the GRND-01 PDF
// assignment fixture (tests/fixtures/assignment.pdf), a sibling of
// scripts/gen-byo-pdf.mjs and built the same way: pdf-lib (already a
// dependency), uncompressed objects and a classic xref (`useObjectStreams:
// false`) so pdf-parse@1.1.1 extracts the text on Ubuntu, macOS and Windows,
// and epoch-dated metadata so a regeneration is byte-stable.
//
// `pensmith new @tests/fixtures/assignment.pdf` must store the text of this
// PDF (the known sentence below) and never a `%PDF-` byte in `.paper/`.
//
// Run via: node scripts/gen-assignment-pdf.mjs
import { writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const lines = [
  'CS 480 Final Paper Assignment',
  'Write a 1500-word literature review on attention mechanisms in transformers.',
  'Cite at least six peer-reviewed sources in APA style.',
  'The review must compare self-attention with recurrent sequence models.',
];

const doc = await PDFDocument.create();
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
const bytes = await doc.save({ useObjectStreams: false });
writeFileSync('tests/fixtures/assignment.pdf', bytes);
console.log('wrote', bytes.length, 'bytes (pdf-lib, uncompressed, epoch-dated)');
