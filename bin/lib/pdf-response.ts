// bin/lib/pdf-response.ts — is this HTTP response really a PDF? (Phase 19 seam
// S-B; SRC-01).
//
// SEAM FILE (Phase 19 plan, S-B). Every Phase 19 stream applies it
// byte-identically from .planning/phases/19-sources/seams/; no stream edits it
// during Phase 19.
//
// Every caller that fetches a PDF (`add <url>`, Pass 3's open-access copy, BYO
// hydration) checks what it actually got BEFORE handing bytes to the PDF
// extractor: the final status (after http.ts followed any redirects), then the
// content type or the `%PDF-` magic. A landing page, a login wall or an error
// page served as text/html is reported as `not a PDF (got text/html)` — never
// fed to pdf-parse, whose errors on HTML are noise the user cannot act on.
//
// The bytes are the byte-faithful `bodyBytes` (audit #29): the UTF-8 `body`
// string of a binary response is lossy and is never used here.

import type { HttpResponse } from './http.js';

export type PdfResponseCheck =
  | { readonly ok: true; readonly bytes: Buffer }
  | { readonly ok: false; readonly reason: string };

const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');
/** PDF 1.x allows up to 1024 bytes of junk before the header. */
const MAGIC_WINDOW = 1024;

/** The media type without parameters, lower-cased ('' when absent). */
function mediaType(headers: Readonly<Record<string, string>>): string {
  const ct = headers['content-type'] ?? '';
  return (ct.split(';')[0] ?? '').trim().toLowerCase();
}

/** True when `bytes` carries the PDF header within the first 1024 bytes. */
export function hasPdfMagic(bytes: Uint8Array): boolean {
  const window = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, MAGIC_WINDOW));
  return window.indexOf(PDF_MAGIC) >= 0;
}

/**
 * Accept `res` as a PDF, or say why not. A 200 with the PDF magic is accepted
 * whatever its declared type (some repositories send application/octet-stream);
 * a 200 without the magic is refused, naming the declared type.
 */
export function checkPdfResponse(res: Pick<HttpResponse, 'status' | 'headers' | 'bodyBytes'>): PdfResponseCheck {
  if (res.status !== 200) return { ok: false, reason: `HTTP ${res.status}` };
  const bytes = res.bodyBytes;
  if (!bytes || bytes.byteLength === 0) return { ok: false, reason: 'empty response body' };
  if (hasPdfMagic(bytes)) return { ok: true, bytes: Buffer.from(bytes) };
  const type = mediaType(res.headers);
  return { ok: false, reason: `not a PDF (got ${type || 'no content type'})` };
}
