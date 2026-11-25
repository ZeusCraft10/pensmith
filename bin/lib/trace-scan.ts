// bin/lib/trace-scan.ts — the last check before an export reaches the user.
//
// An exported document must carry no trace of pensmith and no trace of the
// machine it was made on: not the tool's name, not a generator stamp, not the
// user's home folder, the paper folder or the plugin's install path. The
// scrubbers in exporter.ts remove what Pandoc and TeX are known to add; this
// scanner reads the finished files and refuses the export if anything is
// left, so an unknown leak fails closed instead of shipping.
//
// The paper's own words are not a trace. A match inside the document body that
// also appears in the author's manuscript (or, for words, in the titles and
// names of the cited works) is allowed. Metadata parts get no such allowance.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFStream, PDFString } from 'pdf-lib';

export type TraceFormat = 'docx' | 'pdf' | 'latex' | 'md' | 'bib' | 'ris';

export interface TraceFinding {
  /** File name of the exported artifact. */
  file: string;
  /** The part inside the file (a docx ZIP entry, the PDF info dictionary). */
  part?: string;
  /** What kind of trace this is. */
  what: string;
  /** The offending text, shortened. */
  match: string;
}

export interface TraceScanContext {
  /** The manuscript the export was made from. Text found there is the author's. */
  authorText?: string;
  /** Titles, names and other data of the cited works. Covers word matches only. */
  bibliographicText?: string;
  /** Absolute paths that must never appear: home, paper folder, plugin root. */
  sensitivePaths?: string[];
}

interface Pattern {
  what: string;
  re: RegExp;
  /** A path is never excused by the bibliography, only by the author's text. */
  kind: 'word' | 'path';
}

const WORD_PATTERNS: readonly Pattern[] = [
  { what: 'tool name', re: /pensmith/gi, kind: 'word' },
  { what: 'generator stamp', re: /generated (?:by|with)\b/gi, kind: 'word' },
  { what: 'generator stamp', re: /\bvia pandoc\b/gi, kind: 'word' },
];

// Path fragments that only ever come from a local machine. A URL such as
// https://example.org/home/ does not match: the lookbehind rules out a host
// or path character before the slash. Each match runs to the end of the path.
const PATH_TAIL = String.raw`[^\s"'<>(){}\[\]]*`;
const PATH_PATTERNS: readonly Pattern[] = [
  { what: 'paper folder path', re: new RegExp(String.raw`(?<![\w.-])\.paper[\\/]${PATH_TAIL}`, 'g'), kind: 'path' },
  { what: 'Claude folder path', re: new RegExp(String.raw`(?<![\w.-])\.claude[\\/]${PATH_TAIL}`, 'g'), kind: 'path' },
  {
    what: 'absolute local path',
    re: new RegExp(
      String.raw`(?<![\w.~:%-])(?:/(?:home|Users|root|tmp|private/var|var/folders)/|[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/])${PATH_TAIL}`,
      'g',
    ),
    kind: 'path',
  },
  { what: 'file URL', re: new RegExp(String.raw`\bfile:/{2,3}${PATH_TAIL}`, 'gi'), kind: 'path' },
];

// TeX and PDF tools sign their output; none of it belongs in the deliverable.
const PDF_STAMPS: readonly Pattern[] = [
  { what: 'PDF producer stamp', re: /This is (?:pdf|lua|xe|e-)?TeX/gi, kind: 'word' },
  { what: 'PDF producer stamp', re: /PTEX\.[A-Za-z]+/g, kind: 'word' },
  { what: 'PDF producer stamp', re: /\b(?:pdf|lua|xe)TeX-\d/gi, kind: 'word' },
  { what: 'PDF producer stamp', re: /pdf-lib/gi, kind: 'word' },
];

const AUTHOR_DOCX_PART = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/i;
const BINARY_DOCX_PART = /^(word\/(media|embeddings|fonts)\/|docprops\/thumbnail)|\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|bin|ttf|otf|odttf|woff2?|eot)$/i;

function shorten(s: string): string {
  const one = s.replace(/\s+/g, ' ');
  return one.length > 120 ? `${one.slice(0, 117)}...` : one;
}

function pathVariants(p: string): string[] {
  const abs = path.resolve(p);
  const forward = abs.replace(/\\/g, '/');
  const back = abs.replace(/\//g, '\\');
  const out = new Set([abs, forward, back, back.replace(/\\/g, '\\\\')]);
  try {
    out.add(pathToFileURL(abs).href);
  } catch {
    // not representable as a URL
  }
  return [...out];
}

/** Sensitive paths worth looking for (the filesystem root and short paths match everything). */
function sensitiveNeedles(paths: readonly string[] | undefined): string[] {
  const out = new Set<string>();
  for (const p of paths ?? []) {
    if (!p) continue;
    for (const v of pathVariants(p)) {
      if (v.replace(/[\\/]+$/, '').length >= 5) out.add(v.replace(/[\\/]+$/, ''));
    }
  }
  return [...out];
}

function excused(match: string, kind: Pattern['kind'], ctx: TraceScanContext, strict: boolean): boolean {
  if (strict) return false;
  const m = match.toLowerCase();
  if (ctx.authorText && ctx.authorText.toLowerCase().includes(m)) return true;
  return kind === 'word' && Boolean(ctx.bibliographicText && ctx.bibliographicText.toLowerCase().includes(m));
}

/**
 * Scan one text for traces. `strict` (metadata) text gets no allowance for
 * the author's own words.
 */
export function scanText(
  text: string,
  ctx: TraceScanContext,
  opts: { strict?: boolean; extra?: readonly Pattern[] } = {},
): Array<{ what: string; match: string }> {
  const found: Array<{ what: string; match: string }> = [];
  const strict = opts.strict === true;
  for (const p of [...WORD_PATTERNS, ...PATH_PATTERNS, ...(opts.extra ?? [])]) {
    for (const m of text.matchAll(new RegExp(p.re.source, p.re.flags))) {
      if (!excused(m[0], p.kind, ctx, strict)) found.push({ what: p.what, match: shorten(m[0]) });
    }
  }
  const caseless = process.platform === 'win32';
  const hay = caseless ? text.toLowerCase() : text;
  for (const needle of sensitiveNeedles(ctx.sensitivePaths)) {
    if (hay.includes(caseless ? needle.toLowerCase() : needle)) {
      found.push({ what: 'local path of this machine', match: shorten(needle) });
    }
  }
  return found;
}

const CORE_ALLOWED = /^(dcterms:created|dcterms:modified)$/;

/** Elements with text in a docProps part, other than the allowed timestamps. */
function docPropsValues(xml: string, allowTimestamps: boolean): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<([A-Za-z][\w.:-]*)\b[^>]*>([^<]+)<\/\1>/g)) {
    const value = m[2]!.trim();
    if (!value) continue;
    if (allowTimestamps && CORE_ALLOWED.test(m[1]!) && value === '1970-01-01T00:00:00Z') continue;
    out.push(`${m[1]}=${value}`);
  }
  return out;
}

async function scanDocx(buf: Buffer, file: string, ctx: TraceScanContext): Promise<TraceFinding[]> {
  const findings: TraceFinding[] = [];
  const zip = await JSZip.loadAsync(buf);
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (/^docprops\//i.test(name) && !/^docProps\/(core|app)\.xml$/.test(name)) {
      findings.push({ file, part: name, what: 'document property part', match: name });
      continue;
    }
    if (BINARY_DOCX_PART.test(name)) continue;
    const text = await entry.async('string');
    if (text.includes('\u0000')) continue;
    if (name === 'docProps/core.xml' || name === 'docProps/app.xml') {
      for (const v of docPropsValues(text, name === 'docProps/core.xml')) {
        findings.push({ file, part: name, what: 'document property', match: shorten(v) });
      }
    }
    if (/custom-properties/i.test(text) && /\.rels$|\[Content_Types\]\.xml$/.test(name)) {
      findings.push({ file, part: name, what: 'custom document properties', match: 'custom-properties' });
    }
    for (const f of scanText(text, ctx, { strict: !AUTHOR_DOCX_PART.test(name) })) {
      findings.push({ file, part: name, ...f });
    }
  }
  return findings;
}

async function scanPdf(buf: Buffer, file: string, ctx: TraceScanContext): Promise<TraceFinding[]> {
  const findings: TraceFinding[] = [];
  const pdf = await PDFDocument.load(buf, { updateMetadata: false });
  const info = pdf.context.lookup(pdf.context.trailerInfo.Info);
  if (info instanceof PDFDict) {
    for (const key of info.keys()) {
      findings.push({ file, part: 'document information', what: 'document property', match: key.asString() });
    }
  }
  if (pdf.catalog.get(PDFName.of('Metadata'))) {
    findings.push({ file, part: 'catalog', what: 'XMP metadata', match: '/Metadata' });
  }
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if ((obj instanceof PDFStream || obj instanceof PDFRawStream) && obj.dict.get(PDFName.of('Type')) === PDFName.of('Metadata')) {
      findings.push({ file, part: 'metadata stream', what: 'XMP metadata', match: '/Type /Metadata' });
    }
  }
  // Strings inside dictionaries (bookmarks, link targets, any leftover info)
  // are scanned decoded: a UTF-16 string hides its text from a byte search.
  const strings: string[] = [];
  const collect = (v: unknown): void => {
    if (v instanceof PDFString || v instanceof PDFHexString) strings.push(v.decodeText());
    else if (v instanceof PDFDict) for (const [, x] of v.entries()) collect(x);
    else if (v instanceof PDFArray) for (const x of v.asArray()) collect(x);
  };
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    collect(obj instanceof PDFStream || obj instanceof PDFRawStream ? obj.dict : obj);
  }
  for (const f of scanText(strings.join('\n'), ctx, { extra: PDF_STAMPS })) findings.push({ file, part: 'strings', ...f });

  const raw = buf.toString('latin1');
  if (/<x:xmpmeta|<\?xpacket/i.test(raw)) {
    findings.push({ file, part: 'raw bytes', what: 'XMP metadata', match: 'x:xmpmeta' });
  }
  for (const f of scanText(raw, ctx, { extra: PDF_STAMPS })) findings.push({ file, part: 'raw bytes', ...f });
  return findings;
}

/** Scan one exported file. An empty result means it may ship. */
export async function scanExportFile(
  filePath: string,
  format: TraceFormat,
  ctx: TraceScanContext,
): Promise<TraceFinding[]> {
  const buf = await readFile(filePath);
  const file = path.basename(filePath);
  if (format === 'docx') return scanDocx(buf, file, ctx);
  if (format === 'pdf') return scanPdf(buf, file, ctx);
  return scanText(buf.toString('utf8'), ctx).map((f) => ({ file, ...f }));
}

/** One line per finding, for a refusal message. */
export function describeFinding(f: TraceFinding): string {
  return `${f.file}${f.part ? ` (${f.part})` : ''}: ${f.what}: ${f.match}`;
}
