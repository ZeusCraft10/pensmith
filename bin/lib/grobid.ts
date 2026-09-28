// bin/lib/grobid.ts — optional GROBID header extraction for bring-your-own PDFs
// (SRC-15, D-19-21).
//
// GROBID (https://github.com/kermitt2/grobid) reads a scholarly PDF's header —
// title, authors, DOI — far more reliably than a text heuristic. pensmith uses
// it ONLY when the user runs a GROBID server on their own machine and names it
// in the environment:
//
//     PENSMITH_GROBID_URL=http://127.0.0.1:8070   (or http://localhost:8070)
//
// The PDF is uploaded to that server, so the address must be loopback: a
// remote GROBID would receive the user's PDFs, which never leave the machine
// (PRIVACY.md). A non-loopback URL is ignored with a one-time warning. The
// variable is read from the environment only — a paper's files cannot point
// pensmith at a port — and http.ts enforces the same rule at the egress gate
// (FetchOptions.localService 'grobid': exactly that loopback origin).
//
// The request asks GROBID not to consolidate (`consolidateHeader=0`), so the
// GROBID server itself sends nothing to Crossref or any other service.
//
// grobidHeader(pdfBytes) → {title, authors, doi, arxiv} | null:
//   null  — GROBID is not configured, or it found no header (HTTP 204, or TEI
//           without a title);
//   throws GrobidError for any other answer; transport refusals
//           (OfflineEgressError, SsrfBlockedError, CircuitOpenError …) pass
//           through unchanged. The caller (BYO identification) falls back to
//           its own heuristic.

import { randomBytes } from 'node:crypto';
import { fetch as httpFetch, localServiceOrigin } from './http.js';
import { normalizeDoi } from './doi.js';
import { PensmithError, EXIT_ERROR } from './exit-codes.js';

export interface GrobidHeader {
  readonly title: string;
  /** `Family, Given` strings, in document order. */
  readonly authors: string[];
  /** The normalized DOI, when the header names one. */
  readonly doi: string | null;
  /** The bare arXiv id (no `arXiv:` prefix, no version), when the header names one. */
  readonly arxiv: string | null;
}

/** GROBID answered, but not with a header (an unexpected status). */
export class GrobidError extends PensmithError {
  readonly status: number;
  constructor(status: number, detail: string) {
    super(`GROBID header extraction failed: HTTP ${status}${detail ? ` — ${detail}` : ''}`, EXIT_ERROR);
    this.name = 'GrobidError';
    this.status = status;
  }
}

const GROBID_TIMEOUT_MS = 60_000;
const MAX_TEI_BYTES = 2 * 1024 * 1024;

let warnedNotLoopback = false;

/** Test hook: let the non-loopback warning print again. */
export function _resetGrobidWarningForTest(): void {
  warnedNotLoopback = false;
}

/**
 * The processHeaderDocument endpoint of the configured GROBID server, or null
 * when none is configured (or the configured one is not loopback — warned once).
 */
export function grobidEndpoint(): string | null {
  const raw = process.env.PENSMITH_GROBID_URL?.trim();
  if (!raw) return null;
  const origin = localServiceOrigin('grobid');
  if (origin === null) {
    if (!warnedNotLoopback) {
      warnedNotLoopback = true;
      process.stderr.write(
        'pensmith: PENSMITH_GROBID_URL is ignored — it must name a GROBID server on this machine ' +
          '(http://127.0.0.1:<port>, http://[::1]:<port> or http://localhost:<port>); your PDFs never leave the machine.\n',
      );
    }
    return null;
  }
  // Keep a path prefix (a GROBID behind a local reverse proxy at /grobid).
  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    return null;
  }
  const prefix = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  return new URL(`${prefix}api/processHeaderDocument`, origin).href;
}

/** A multipart/form-data body: the PDF as `input`, and consolidateHeader=0. */
function multipart(pdf: Buffer): { body: Buffer; contentType: string } {
  const boundary = `----pensmith-${randomBytes(12).toString('hex')}`;
  const crlf = '\r\n';
  const head = Buffer.from(
    `--${boundary}${crlf}` +
      `Content-Disposition: form-data; name="input"; filename="document.pdf"${crlf}` +
      `Content-Type: application/pdf${crlf}${crlf}`,
    'utf8',
  );
  const tail = Buffer.from(
    `${crlf}--${boundary}${crlf}` +
      `Content-Disposition: form-data; name="consolidateHeader"${crlf}${crlf}` +
      `0${crlf}` +
      `--${boundary}--${crlf}`,
    'utf8',
  );
  return { body: Buffer.concat([head, pdf, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

// ---------------------------------------------------------------------------
// TEI parsing (the header subset GROBID returns). Regex-based, like the arXiv
// Atom reader: no XML dependency, and GROBID's TEI shape is stable.
// ---------------------------------------------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Element text: tags stripped, entities decoded, whitespace (CR/LF included) collapsed. */
function textOf(xml: string): string {
  return decodeEntities(xml.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function firstBlock(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return m ? (m[1] ?? '') : null;
}

function allBlocks(xml: string, tag: string): Array<{ attrs: string; inner: string }> {
  const out: Array<{ attrs: string; inner: string }> = [];
  const re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push({ attrs: m[1] ?? '', inner: m[2] ?? '' });
  return out;
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs);
  return m ? decodeEntities(m[1] ?? '') : null;
}

/** A TEI persName as `Family, Given Middle` (null without a surname). */
function personName(persName: string): string | null {
  const surname = textOf(firstBlock(persName, 'surname') ?? '');
  if (!surname) return null;
  const given = allBlocks(persName, 'forename')
    .map((f) => textOf(f.inner))
    .filter((f) => f.length > 0)
    .join(' ');
  return given ? `${surname}, ${given}` : surname;
}

/**
 * Parse the header GROBID returns for processHeaderDocument. Returns null when
 * the TEI has no title (GROBID found no usable header).
 */
export function parseGrobidTei(tei: string): GrobidHeader | null {
  const header = firstBlock(tei, 'teiHeader') ?? tei;
  const analytic = firstBlock(header, 'analytic');
  const titleStmt = firstBlock(header, 'titleStmt');
  const titles = [...allBlocks(titleStmt ?? '', 'title'), ...allBlocks(analytic ?? '', 'title')];
  const main = titles.find((t) => attr(t.attrs, 'type') === 'main') ?? titles[0];
  const title = main ? textOf(main.inner) : '';
  if (!title) return null;
  const authors: string[] = [];
  for (const a of allBlocks(analytic ?? header, 'author')) {
    const pers = firstBlock(a.inner, 'persName');
    const name = pers !== null ? personName(pers) : null;
    if (name && !authors.includes(name)) authors.push(name);
  }
  let doi: string | null = null;
  let arxiv: string | null = null;
  for (const idno of allBlocks(header, 'idno')) {
    const type = (attr(idno.attrs, 'type') ?? '').toLowerCase();
    const value = textOf(idno.inner);
    if (type === 'doi' && doi === null) doi = normalizeDoi(value);
    if (type === 'arxiv' && arxiv === null) {
      const bare = value.replace(/^arxiv:\s*/i, '').replace(/v\d+$/i, '').trim();
      arxiv = bare.length > 0 ? bare : null;
    }
  }
  return { title, authors, doi, arxiv };
}

/**
 * Ask the user's local GROBID server for `pdf`'s header. See the file header
 * for the null / throw contract.
 */
export async function grobidHeader(pdf: Buffer): Promise<GrobidHeader | null> {
  const endpoint = grobidEndpoint();
  if (endpoint === null) return null;
  const { body, contentType } = multipart(pdf);
  const res = await httpFetch(endpoint, {
    method: 'POST',
    body,
    headers: { accept: 'application/xml', 'content-type': contentType },
    source: 'generic',
    localService: 'grobid',
    noCache: true,
    timeoutMs: GROBID_TIMEOUT_MS,
    maxBytes: MAX_TEI_BYTES,
  });
  if (res.status === 204) return null;
  if (res.status !== 200) throw new GrobidError(res.status, res.body.replace(/\s+/g, ' ').trim().slice(0, 160));
  return parseGrobidTei(res.body);
}
