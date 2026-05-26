// bin/lib/pdf-text-shim.d.ts — Ambient declaration for pdf-parse sub-path import.
//
// The npm `pdf-parse@1.1.1` package does NOT ship type declarations for
// the sub-path entrypoint `pdf-parse/lib/pdf-parse.js`. Only the bare
// `pdf-parse` index exports any. But the bare import triggers the
// debug-mode ENOENT shim under ESM (RESEARCH.md Pitfall #1), so
// `bin/lib/pdf-text.ts` (the sole allowed importer per D-06 / T-3-11)
// uses the sub-path — and needs this shim to compile.
//
// We declare ONLY the narrow surface the chokepoint consumes (`.text`
// and `.numpages`). Widening this shim is a chokepoint-bypass smell —
// new fields go through bin/lib/pdf-text.ts wrappers, not through richer
// global typings.

declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string;
    numpages: number;
  }
  const pdfParse: (buf: Buffer) => Promise<PdfParseResult>;
  export default pdfParse;
}
