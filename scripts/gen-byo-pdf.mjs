// scripts/gen-byo-pdf.mjs — one-shot generator for the Phase 8 BYO PDF fixture.
//
// pdf-parse@1.1.1 (a 2018 pdf.js fork) has a content-stream lexer that aborts
// with "Command token too long: 128" on several PDF idioms (the binary sniff
// comment, certain operator runs). A classic uncompressed PDF 1.4 with short
// content-stream tokens (one Tj per line, no T* leading-relative text op)
// parses cleanly. We build the cross-reference table from exact byte offsets.
//
// Run via: node scripts/gen-byo-pdf.mjs
import { writeFileSync } from 'node:fs';

const lines = [
  'Attention Is All You Need',
  'Vaswani Shazeer Parmar Uszkoreit 2017',
  'Abstract The dominant sequence transduction models are based on',
  'complex recurrent or convolutional neural networks',
  'We propose the Transformer based solely on attention mechanisms',
  'doi 10.48550 arXiv 1706.03762',
];

function escPdf(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

// Absolute-positioned Td per line (no T*); short operator tokens only.
let content = 'BT /F1 12 Tf\n';
let y = 740;
for (const ln of lines) {
  content += '56 ' + y + ' Td (' + escPdf(ln) + ') Tj\n';
  // reset text matrix between lines: move back to x=56 by using absolute Td
  // requires a fresh BT/ET per line for absolute coords. Simpler: ET/BT pairs.
  content = content; // placeholder
  y -= 18;
}
content += 'ET';

// Rebuild with ET/BT per line so each Td is absolute (Td is relative to the
// current line matrix; a fresh BT resets it to identity).
content = '';
y = 740;
for (const ln of lines) {
  content += 'BT /F1 12 Tf 56 ' + y + ' Td (' + escPdf(ln) + ') Tj ET\n';
  y -= 18;
}
content = content.trimEnd();

const objs = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  '<< /Length ' + Buffer.byteLength(content, 'latin1') + ' >>\nstream\n' + content + '\nendstream',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];

let pdf = '%PDF-1.4\n';
const offsets = [];
for (let i = 0; i < objs.length; i++) {
  offsets.push(Buffer.byteLength(pdf, 'latin1'));
  pdf += (i + 1) + ' 0 obj\n' + objs[i] + '\nendobj\n';
}
const xrefStart = Buffer.byteLength(pdf, 'latin1');
const n = objs.length + 1;
pdf += 'xref\n0 ' + n + '\n';
pdf += '0000000000 65535 f \n';
for (const off of offsets) {
  pdf += String(off).padStart(10, '0') + ' 00000 n \n';
}
pdf += 'trailer\n<< /Size ' + n + ' /Root 1 0 R >>\n';
pdf += 'startxref\n' + xrefStart + '\n%%EOF\n';

writeFileSync('tests/fixtures/pdf/byo-text.pdf', Buffer.from(pdf, 'latin1'));
console.log('wrote', Buffer.byteLength(pdf, 'latin1'), 'bytes');
