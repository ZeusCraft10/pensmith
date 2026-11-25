// tests/lib/pdf-fixture.ts — a small PDF holding a given text, for tests that
// serve an open-access PDF from an undici MockAgent.
//
// Not a test file (the runner collects only *.test.ts).

/**
 * An uncompressed, ASCII-only PDF holding `text` (no parentheses or
 * backslashes). A comment pads it past 4 KB: pdf-parse misreads a smaller one
 * intermittently, and a real OA PDF is never that small.
 */
export function textPdf(text: string): Buffer {
  const content = `BT /F1 10 Tf 20 700 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 2000 800] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = `%PDF-1.4\n%${'x'.repeat(5000)}\n`;
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
