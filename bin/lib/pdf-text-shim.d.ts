// bin/lib/pdf-text-shim.d.ts — Ambient declaration for pdf-parse sub-path import.
//
// The npm `pdf-parse@1.1.1` package does NOT ship type declarations for
// the sub-path entrypoint `pdf-parse/lib/pdf-parse.js`. Only the bare
// `pdf-parse` index exports any. But the bare import triggers the
// debug-mode ENOENT shim under ESM (RESEARCH.md Pitfall #1), so the
// chokepoint (bin/lib/pdf-worker.ts, the worker that runs the parse for
// bin/lib/pdf-text.ts — D-06 / T-3-11 / SEC-02) uses the sub-path and needs
// this shim to compile.
//
// We declare ONLY the surface the chokepoint consumes: the text, the page
// count, the Info dictionary and the XMP metadata object, and the
// `pagerender` option (the worker records each page's text for PDF
// identification). New fields go through the chokepoint, not through richer
// global typings.

declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info: unknown;
    metadata: unknown;
  }
  interface PdfParseOptions {
    pagerender?: (pageData: never) => Promise<string>;
    max?: number;
  }
  const pdfParse: (buf: Uint8Array, options?: PdfParseOptions) => Promise<PdfParseResult>;
  export default pdfParse;
}
