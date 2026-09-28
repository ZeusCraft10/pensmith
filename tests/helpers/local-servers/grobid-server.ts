// tests/helpers/local-servers/grobid-server.ts — a loopback stand-in for a
// GROBID server (https://github.com/kermitt2/grobid) for the bin/lib/grobid.ts
// tests (SRC-15, D-19-21).
//
// It speaks the one endpoint pensmith uses — POST /api/processHeaderDocument
// with a multipart/form-data body (the PDF as `input`, plus form fields) — and
// answers with a scripted TEI document (200), no content (204) or an error
// status, recording every request's parsed parts. GET /api/isalive answers
// `true` like the real server.
//
// Lives under tests/helpers/local-servers/ (the V6 exemption: the only place a
// test may import node:http).

import { startHttpServer, type LocalServer } from './transport.js';

export interface GrobidPart {
  readonly name: string;
  readonly filename: string | null;
  readonly contentType: string | null;
  readonly data: Buffer;
}

export interface GrobidRequest {
  readonly method: string;
  readonly path: string;
  readonly contentType: string;
  readonly parts: GrobidPart[];
}

export type GrobidReply = { status: 200; tei: string } | { status: 204 } | { status: number; body: string };

export interface GrobidServer extends LocalServer {
  readonly calls: GrobidRequest[];
  /** Replace the scripted answer for later requests. */
  reply(next: GrobidReply): void;
}

/** Split a multipart/form-data body into its parts (enough for a test double). */
export function parseMultipart(body: Buffer, contentType: string): GrobidPart[] {
  const m = /boundary=("?)([^";]+)\1/i.exec(contentType);
  if (!m?.[2]) return [];
  const delimiter = Buffer.from(`--${m[2]}`);
  const parts: GrobidPart[] = [];
  let start = body.indexOf(delimiter);
  while (start >= 0) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next < 0) break;
    let chunk = body.subarray(start + delimiter.length, next);
    if (chunk.subarray(0, 2).toString() === '\r\n') chunk = chunk.subarray(2);
    if (chunk.subarray(chunk.length - 2).toString() === '\r\n') chunk = chunk.subarray(0, chunk.length - 2);
    const headerEnd = chunk.indexOf('\r\n\r\n');
    if (headerEnd >= 0) {
      const head = chunk.subarray(0, headerEnd).toString('utf8');
      const data = chunk.subarray(headerEnd + 4);
      const name = /name="([^"]*)"/i.exec(head)?.[1] ?? '';
      const filename = /filename="([^"]*)"/i.exec(head)?.[1] ?? null;
      const ct = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim() ?? null;
      parts.push({ name, filename, contentType: ct, data });
    }
    start = next;
  }
  return parts;
}

/** Start the stand-in on 127.0.0.1:0 with an initial scripted answer. */
export async function startGrobidServer(initial: GrobidReply): Promise<GrobidServer> {
  let scripted: GrobidReply = initial;
  const calls: GrobidRequest[] = [];
  const server = await startHttpServer((req, res, body) => {
    const path = req.url ?? '/';
    if (req.method === 'GET' && path === '/api/isalive') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('true');
      return;
    }
    const contentType = String(req.headers['content-type'] ?? '');
    calls.push({ method: req.method ?? 'GET', path, contentType, parts: parseMultipart(body, contentType) });
    if (req.method !== 'POST' || path !== '/api/processHeaderDocument') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    if ('tei' in scripted) {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(scripted.tei);
    } else if ('body' in scripted) {
      res.writeHead(scripted.status, { 'content-type': 'text/plain' });
      res.end(scripted.body);
    } else {
      res.writeHead(204);
      res.end();
    }
  });
  return Object.assign(server, {
    calls,
    reply(next: GrobidReply): void {
      scripted = next;
    },
  });
}
