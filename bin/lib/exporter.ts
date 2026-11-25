// bin/lib/exporter.ts — the trace-free export (`pensmith done`).
//
// Non-negotiable: no exported document carries a pensmith trace or a trace of
// the machine it was made on, in any format. Each export is built in a fresh
// staging folder inside .paper/, scrubbed, scanned by trace-scan.ts, and only
// then moved into the export folder. Anything the scanner finds refuses the
// export and nothing is written.
//
// Formats:
//   md     — always rendered here: one citeproc session over the whole paper
//            (citation-js), so numeric styles number by first appearance.
//   docx   — Pandoc with --citeproc, then docProps rebuilt from an allowlist.
//   pdf    — Pandoc + a TeX engine, then the info dictionary and XMP removed.
//   latex  — Pandoc --standalone when present (a file that compiles), else
//            the offline writer below.
// Pandoc runs inside the staging folder with relative file names, so no
// absolute path reaches its metadata.
//
// A docx or pdf that cannot be made (no Pandoc, no TeX engine) is a refusal
// that names the missing tool; it is never swapped for a Markdown file.
//
// All file writes go through the atomic-write chokepoint.

import { execFile } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream } from 'pdf-lib';
import { renderCitationsInDocument, SUPPORTED_STYLES, type RenderedCitations } from './citations.js';
import { atomicWriteFile, makeTempDir, removePath } from './atomic-write.js';
import { findCitations, type Citation } from './citation-grammar.js';
import { cslHtmlToLatex, cslHtmlToMarkdown } from './csl-html.js';
import { readBibEntries, selectEntries, toBibtex, toRis, type CslEntry } from './export-bib.js';
import { isHumanizerSkillPresent, isPandocPresent } from './ecosystem-presence.js';
import { homeDirs, paperDir } from './paths.js';
import { describeFinding, scanExportFile, type TraceFormat } from './trace-scan.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findPkgRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 8; i++) {
    try {
      if (statSync(path.join(cur, 'package.json')).isFile()) return cur;
    } catch {
      // continue
    }
    const next = path.dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  return start;
}

const PKG_ROOT = findPkgRoot(__dirname);

// Fixed epoch for ZIP entry timestamps and docx dates: no authoring time ships.
const EPOCH = new Date(0);
const EPOCH_W3CDTF = '1970-01-01T00:00:00Z';

// ---------------------------------------------------------------------------
// runHumanizer — DONE-03 humanizer wrap (skip-clean, never-throws)
// ---------------------------------------------------------------------------

/**
 * Injectable TaskRunner seam (GEN-05). Mirrors the __setInterpolateForTest
 * pattern in bin/cli/intake.ts and the setZoteroClientForTest pattern in
 * bin/lib/sources/zotero-mcp.ts.
 *
 * In Tier 1 production, the Claude Code Task transport is the runner.
 * In Tier 2 (or when no transport is available), this stays null and
 * runHumanizer cleanly skips.
 */
export type TaskRunner = (skill: string, input: Record<string, string>) => Promise<{ output: string }>;

let _taskRunner: TaskRunner | null = null;

/**
 * Test-only seam: override the module-level TaskRunner. Pass null to clear
 * (restores Tier-2 / no-transport behaviour). Double-underscore prefix marks
 * this as test-only (mirrors __setInterpolateForTest in intake.ts).
 */
export function __setTaskRunnerForTest(fn: TaskRunner | null): void {
  _taskRunner = fn;
}

/**
 * DONE-03 humanizer wrap — the done-orchestrator humanize step (the symbol the
 * Wave-0 tests/humanizer-wrap.test.ts pins to this module).
 *
 * Behavior (T-06-05-03 — a missing skill must NEVER fail the export):
 *   - _taskRunner !== null (Tier 1 / injected runner): invoke the runner with
 *     the draft, write the output to `.paper/FINAL.md` via atomicWriteFile, and
 *     return the FINAL.md path. This is the only path that returns a non-null
 *     value — a FINAL.md path is returned ONLY when a real humanized artifact
 *     was written. The skill-presence check is bypassed when a runner is
 *     explicitly wired (the runner IS the transport + skill).
 *   - _taskRunner === null AND isHumanizerSkillPresent() === false → print a
 *     clear stdout banner ('humanizer skill not found at
 *     ~/.claude/skills/humanizer/ — skipping humanize step.') and return null.
 *     The export proceeds on DRAFT.md.
 *   - _taskRunner === null AND skill present (Tier 2 / no transport): the
 *     @clack/CLI surface has no Task transport to invoke the skill, so skip
 *     cleanly with a distinct banner and let the export proceed on DRAFT.md.
 *
 * NEVER throws — any unexpected error degrades to a clean null skip (advisory).
 * `paperRoot` is the FINAL.md anchor; always resolves via paperDir(paperRoot)
 * (never cwd-relative — Pitfall 8; Phase 14 GATE-04 expects FINAL.md in
 * .paper/).
 *
 * done.ts OWNS the before/after scoreHonesty + renderHonestyReport flow —
 * this function must NOT call scoreHonesty.
 */
export async function runHumanizer(
  draftMd: string,
  paperRoot?: string,
): Promise<string | null> {
  try {
    // Tier-1 path: an injectable TaskRunner is present (live Task API or test
    // seam). Invoke the runner, write the output to .paper/FINAL.md, and return
    // its path. The skill-presence check is bypassed — the runner IS the
    // transport; callers that wire it have already confirmed availability.
    if (_taskRunner !== null) {
      const { output } = await _taskRunner('humanizer', { draft: draftMd });
      const finalPath = join(paperDir(paperRoot), 'FINAL.md');
      await atomicWriteFile(finalPath, output);
      return finalPath;
    }

    // No runner wired (Tier 2 / no transport): check skill presence.
    if (!isHumanizerSkillPresent()) {
      process.stdout.write(
        'pensmith done: humanizer skill not found at ~/.claude/skills/humanizer/ — skipping humanize step.\n',
      );
      return null;
    }

    // Skill present but no Task transport (Tier-2 era): skip cleanly with a
    // distinct banner; the export proceeds on DRAFT.md.
    process.stdout.write(
      'pensmith done: humanizer skill present but no Task transport in this tier — skipping humanize step (export proceeds on DRAFT.md).\n',
    );
    return null;
  } catch {
    // Advisory — the humanize step must NEVER fail the export (Pitfall 7).
    process.stdout.write(
      'pensmith done: humanizer skill not found at ~/.claude/skills/humanizer/ — skipping humanize step.\n',
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// zeroTracePatch — rebuild a .docx's package metadata from an allowlist
// ---------------------------------------------------------------------------

const REL_OFFICE_DOCUMENT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const REL_CORE = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';
const REL_APP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties';
const CT_CORE = 'application/vnd.openxmlformats-package.core-properties+xml';
const CT_APP = 'application/vnd.openxmlformats-officedocument.extended-properties+xml';
const CT_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// The only document properties an export carries: two fixed timestamps.
const CORE_XML =
  XML_DECL +
  '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"' +
  ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"' +
  ' xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
  `<dcterms:created xsi:type="dcterms:W3CDTF">${EPOCH_W3CDTF}</dcterms:created>` +
  `<dcterms:modified xsi:type="dcterms:W3CDTF">${EPOCH_W3CDTF}</dcterms:modified>` +
  '</cp:coreProperties>';
const APP_XML =
  XML_DECL +
  '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"' +
  ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"></Properties>';

/** The attributes of each `<tag .../>` element in `xml`, raw (still escaped). */
function elementAttrs(xml: string, tag: string): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  for (const m of xml.matchAll(new RegExp(`<${tag}\\b([^>]*?)\\/?>`, 'g'))) {
    const attrs: Record<string, string> = {};
    for (const a of (m[1] ?? '').matchAll(/([A-Za-z_:][\w.:-]*)\s*=\s*"([^"]*)"/g)) attrs[a[1]!] = a[2]!;
    out.push(attrs);
  }
  return out;
}

/**
 * Rebuild a .docx's package metadata from an allowlist (the mandatory last
 * step of every docx export):
 *   - every docProps/ part is dropped, custom.xml included, where Pandoc
 *     records the --csl and --bibliography paths;
 *   - core.xml and app.xml are written fresh with no names, titles,
 *     application stamp or edit time;
 *   - _rels/.rels keeps only the main document and those two parts, and
 *     [Content_Types].xml is rewritten to match.
 * The document body is not touched: the author's words are the author's.
 * Idempotent.
 */
export async function zeroTracePatch(docxPath: string): Promise<void> {
  const zip = await JSZip.loadAsync(await fsp.readFile(docxPath));

  const rels = (await zip.file('_rels/.rels')?.async('string')) ?? '';
  const mainTarget =
    elementAttrs(rels, 'Relationship').find((r) => r['Type'] === REL_OFFICE_DOCUMENT)?.['Target'] ?? 'word/document.xml';

  for (const name of Object.keys(zip.files)) {
    if (/^docprops\//i.test(name)) zip.remove(name);
  }
  zip.file('docProps/core.xml', CORE_XML);
  zip.file('docProps/app.xml', APP_XML);

  zip.file(
    '_rels/.rels',
    XML_DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${REL_OFFICE_DOCUMENT}" Target="${mainTarget}"/>` +
      `<Relationship Id="rId2" Type="${REL_CORE}" Target="docProps/core.xml"/>` +
      `<Relationship Id="rId3" Type="${REL_APP}" Target="docProps/app.xml"/>` +
      '</Relationships>',
  );

  const types = (await zip.file('[Content_Types].xml')?.async('string')) ?? '';
  const defaults = elementAttrs(types, 'Default');
  if (defaults.length === 0) {
    defaults.push(
      { Extension: 'rels', ContentType: 'application/vnd.openxmlformats-package.relationships+xml' },
      { Extension: 'xml', ContentType: 'application/xml' },
    );
  }
  const overrides = elementAttrs(types, 'Override').filter((o) => {
    const part = (o['PartName'] ?? '').replace(/^\//, '');
    return part.length > 0 && !/^docprops\//i.test(part) && zip.file(part) !== null;
  });
  const main = mainTarget.replace(/^\//, '');
  if (zip.file(main) && !overrides.some((o) => (o['PartName'] ?? '').replace(/^\//, '') === main)) {
    overrides.push({ PartName: `/${main}`, ContentType: CT_MAIN });
  }
  overrides.push({ PartName: '/docProps/core.xml', ContentType: CT_CORE }, { PartName: '/docProps/app.xml', ContentType: CT_APP });
  zip.file(
    '[Content_Types].xml',
    XML_DECL +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      defaults.map((d) => `<Default Extension="${d['Extension'] ?? ''}" ContentType="${d['ContentType'] ?? ''}"/>`).join('') +
      overrides.map((o) => `<Override PartName="${o['PartName'] ?? ''}" ContentType="${o['ContentType'] ?? ''}"/>`).join('') +
      '</Types>',
  );

  for (const entry of Object.values(zip.files)) entry.date = EPOCH;
  await atomicWriteFile(docxPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

// ---------------------------------------------------------------------------
// zeroTracePdf — remove the info dictionary, XMP and TeX producer keys
// ---------------------------------------------------------------------------

/**
 * Strip a PDF's metadata structurally (the mandatory last step of every pdf
 * export). The info dictionary is replaced by an empty one, which removes
 * /Producer, /Creator, /Title and TeX's /PTEX.Fullbanner banner together.
 * Every XMP metadata stream is deleted as an object (pdf-lib writes every
 * object it holds, reachable or not), and /Metadata and /PTEX.* keys are
 * dropped from every dictionary. No byte-level edits: they would break the
 * cross-reference offsets. Idempotent.
 */
export async function zeroTracePdf(pdfPath: string): Promise<void> {
  const pdf = await PDFDocument.load(await fsp.readFile(pdfPath), { updateMetadata: false });
  const ctx = pdf.context;

  const oldInfo = ctx.trailerInfo.Info;
  if (oldInfo instanceof PDFRef) ctx.delete(oldInfo);
  ctx.trailerInfo.Info = ctx.register(ctx.obj({}));

  const metadataStreams: PDFRef[] = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream || obj instanceof PDFRawStream ? obj.dict : null;
    if (!dict) continue;
    if (dict.get(PDFName.of('Type')) === PDFName.of('Metadata')) metadataStreams.push(ref);
    for (const key of dict.keys()) {
      const k = key.asString();
      if (k === '/Metadata' || k.startsWith('/PTEX.')) dict.delete(key);
    }
  }
  pdf.catalog.delete(PDFName.of('Metadata'));
  for (const ref of metadataStreams) ctx.delete(ref);

  // Without object streams every dictionary is plain text in the file, so the
  // trace scan (and anyone auditing the file) can read it.
  await atomicWriteFile(pdfPath, Buffer.from(await pdf.save({ updateFieldAppearances: false, useObjectStreams: false })));
}

// ---------------------------------------------------------------------------
// Export errors
// ---------------------------------------------------------------------------

export type ExportFailureKind =
  /** Pandoc or the TeX engine the format needs is not installed. */
  | 'missing-tool'
  /** Pandoc, TeX or a scrub step failed. */
  | 'tool-failed'
  /** The finished file still carries a trace, so it was not written. */
  | 'trace-found'
  /** A citation names a work that is not in CITATIONS.bib. */
  | 'unresolved-citation'
  /** The bibliography or the requested style cannot be used. */
  | 'invalid-input';

/** Why an export did not happen. Nothing was written to the export folder. */
export class ExportError extends Error {
  constructor(
    readonly kind: ExportFailureKind,
    message: string,
    readonly details: readonly string[] = [],
  ) {
    super(message);
    this.name = 'ExportError';
  }
}

// ---------------------------------------------------------------------------
// Offline rendering: Markdown and LaTeX with document-level citeproc
// ---------------------------------------------------------------------------

/** The heading over the reference list, as each style names it. */
function referencesHeading(style: string): string {
  if (style === 'mla') return 'Works Cited';
  if (style === 'chicago-notes-bib') return 'Bibliography';
  return 'References';
}

// Private-use code points mark where rendered text goes, so the LaTeX writer
// can escape the prose first and insert already-formatted citations after.
const CITE = (i: number): string => `${i}`;
const NOTE = (i: number): string => `${i}`;
const REF = (i: number): string => `${i}`;
const SENTINEL_RE = /(\d+)|(\d+)|(\d+)/g;

/**
 * `md` with each citation replaced by a marker. In a note style the marker
 * goes after the punctuation that follows the citation, as notes are placed.
 */
function markCitations(md: string, cites: readonly Citation[], rendered: RenderedCitations): string {
  let out = '';
  let pos = 0;
  cites.forEach((c, i) => {
    let before = md.slice(pos, c.start);
    pos = c.end;
    if (!rendered.noteStyle) {
      // A superscript citation (AMA) sits against the word it follows.
      if ((rendered.citations[i] ?? '').startsWith('<sup>')) before = before.replace(/[ \t]+$/, '');
      out += before + CITE(i);
      return;
    }
    const inline = rendered.inline[i] ?? '';
    if (!inline) before = before.replace(/[ \t]+$/, '');
    out += before + (inline ? CITE(i) : '');
    const punct = /^[.,;:!?]/.exec(md.slice(pos));
    if (punct) {
      out += punct[0];
      pos += punct[0].length;
    }
    out += NOTE(i);
  });
  return out + md.slice(pos);
}

interface OfflineDoc {
  marked: string;
  rendered: RenderedCitations | null;
  heading: string;
}

function prepareOffline(md: string, cites: readonly Citation[], entries: CslEntry[], style: string): OfflineDoc {
  if (cites.length === 0) return { marked: md, rendered: null, heading: '' };
  const rendered = renderCitationsInDocument(entries, style, cites);
  let marked = markCitations(md, cites, rendered).replace(/\s+$/, '');
  if (rendered.bibliography.length > 0) {
    marked += `\n\n## ${referencesHeading(style)}\n\n${rendered.bibliography.map((_, j) => REF(j)).join('\n\n')}`;
  }
  return { marked: `${marked}\n`, rendered, heading: referencesHeading(style) };
}

/** A note is a sentence: its first letter is a capital ("See", not "see"). Skips leading tags. */
function capitalize(html: string): string {
  return html.replace(/^((?:<[^>]*>|[^\p{L}<])*)(\p{Ll})/u, (_m, pre: string, c: string) => pre + c.toUpperCase());
}

function renderMarkdown(doc: OfflineDoc): string {
  const r = doc.rendered;
  if (!r) return doc.marked;
  const body = doc.marked.replace(SENTINEL_RE, (_m, c?: string, n?: string, ref?: string) => {
    if (c !== undefined) {
      const i = Number(c);
      return cslHtmlToMarkdown(r.noteStyle ? (r.inline[i] ?? '') : (r.citations[i] ?? ''));
    }
    if (n !== undefined) return `[^${Number(n) + 1}]`;
    return cslHtmlToMarkdown(r.bibliography[Number(ref)] ?? '');
  });
  if (!r.noteStyle) return body;
  // In a note style every citation is a note, numbered in order.
  const notes = r.citations.map((html, i) => `[^${i + 1}]: ${cslHtmlToMarkdown(capitalize(html))}`);
  return `${body.replace(/\s+$/, '')}\n\n${notes.join('\n\n')}\n`;
}

/** Escape LaTeX's special characters in prose (backslash first). */
function escapeLatex(s: string): string {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

/**
 * The offline Markdown→LaTeX writer, used when Pandoc is not installed. It
 * writes a complete, compilable document: a leading `# ` heading becomes the
 * title, `## `/`### ` become sections, other blocks become paragraphs, and
 * citations, notes and references arrive already formatted.
 */
function renderLatex(doc: OfflineDoc): string {
  const lines = doc.marked.split(/\r?\n/);
  let title = '';
  const body: string[] = [];
  let para: string[] = [];
  const flush = (): void => {
    if (para.length > 0) {
      body.push(escapeLatex(para.join(' ').trim()));
      para = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const text = escapeLatex(h[2]!.trim());
      if (h[1] === '#' && !title) title = text;
      else if (h[1] === '###') body.push(`\\subsection{${text}}`);
      else body.push(`\\section{${text}}`);
    } else if (line.trim() === '') {
      flush();
    } else {
      para.push(line);
    }
  }
  flush();

  const r = doc.rendered;
  const latex = (html: string): string => cslHtmlToLatex(html, escapeLatex);
  const text = body.join('\n\n').replace(SENTINEL_RE, (_m, c?: string, n?: string, ref?: string) => {
    if (!r) return '';
    if (c !== undefined) {
      const i = Number(c);
      return latex(r.noteStyle ? (r.inline[i] ?? '') : (r.citations[i] ?? ''));
    }
    if (n !== undefined) return `\\footnote{${latex(capitalize(r.citations[Number(n)] ?? ''))}}`;
    return latex(r.bibliography[Number(ref)] ?? '');
  });

  const preamble = ['\\documentclass{article}', '\\usepackage[utf8]{inputenc}', '\\usepackage[T1]{fontenc}'];
  if (title) preamble.push(`\\title{${title}}`, '\\author{}', '\\date{}');
  preamble.push('\\begin{document}');
  if (title) preamble.push('\\maketitle');
  return `${preamble.join('\n')}\n\n${text}\n\n\\end{document}\n`;
}

// ---------------------------------------------------------------------------
// Pandoc
// ---------------------------------------------------------------------------

interface PandocFailure {
  code?: string | number;
  killed?: boolean;
  signal?: string;
  stderr?: string;
}

function lastLines(s: string, n = 12): string {
  return s.trim().split(/\r?\n/).slice(-n).join('\n');
}

async function runPandoc(args: string[], cwd: string, format: ExportFormat): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('pandoc', args, { cwd, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (!err) {
        resolve(String(stderr ?? ''));
        return;
      }
      const e = err as unknown as PandocFailure;
      const errText = String(stderr ?? e.stderr ?? '');
      if (e.code === 'ENOENT') {
        reject(new ExportError('missing-tool', 'Pandoc is not installed.'));
      } else if (format === 'pdf' && (e.code === 47 || /not found\. Please select a different --pdf-engine/i.test(errText))) {
        reject(new ExportError('missing-tool', 'No PDF engine is installed (Pandoc needs pdflatex or another TeX engine).', [lastLines(errText)]));
      } else if (e.killed || e.signal) {
        reject(new ExportError('tool-failed', 'Pandoc did not finish within 3 minutes.'));
      } else {
        reject(new ExportError('tool-failed', `Pandoc failed (exit ${String(e.code ?? '?')}).`, [lastLines(errText)]));
      }
    });
  });
}

/** Turn unknown narrative `@word`s into plain text so Pandoc does not cite them. */
function escapeUncited(md: string, ignored: readonly Citation[]): string {
  let out = md;
  for (const c of [...ignored].sort((a, b) => b.start - a.start)) {
    out = `${out.slice(0, c.start)}\\${out.slice(c.start)}`;
  }
  return out;
}

async function pandocExport(
  stage: string,
  stem: string,
  md: string,
  cites: readonly Citation[],
  ignored: readonly Citation[],
  style: string,
  format: 'docx' | 'pdf' | 'latex',
): Promise<string> {
  let manuscript = escapeUncited(md, ignored).replace(/\s+$/, '');
  if (cites.length > 0) manuscript += `\n\n## ${referencesHeading(style)}\n\n::: {#refs}\n:::`;
  await atomicWriteFile(join(stage, 'manuscript.md'), `${manuscript}\n`);

  const ext = format === 'latex' ? 'tex' : format;
  const output = `${stem}.${ext}`;
  const args = [
    'manuscript.md',
    '--from', 'markdown',
    '--to', format,
    '--output', output,
    // A leading `# Title` becomes the document title; sections become level 1.
    '--shift-heading-level-by=-1',
    // Keep the title and any author out of the PDF metadata LaTeX would write.
    '--variable', 'title-meta=',
    '--variable', 'author-meta=',
  ];
  if (format === 'latex') args.push('--standalone');
  if (cites.length > 0) {
    await atomicWriteFile(
      join(stage, 'style.csl'),
      await fsp.readFile(path.join(PKG_ROOT, 'templates', 'citation-styles', `${style}.csl`)),
    );
    args.push('--citeproc', '--csl', 'style.csl', '--bibliography', 'CITATIONS.bib');
  }

  const warnings = await runPandoc(args, stage, format);
  const missing = [...warnings.matchAll(/Citeproc: citation (\S+) not found/g)].map((m) => m[1]!);
  if (missing.length > 0) {
    throw new ExportError('unresolved-citation', 'Pandoc found citations with no bibliography entry.', missing);
  }

  const outPath = join(stage, output);
  try {
    if (format === 'docx') await zeroTracePatch(outPath);
    else if (format === 'pdf') await zeroTracePdf(outPath);
    else {
      // Pandoc's LaTeX template signs the PDF it will make: pdfcreator={LaTeX via pandoc}.
      const tex = await fsp.readFile(outPath, 'utf8');
      await atomicWriteFile(outPath, tex.replace(/pdfcreator=\{LaTeX via pandoc\}/g, 'pdfcreator={}'));
    }
  } catch (err) {
    throw new ExportError('tool-failed', `Could not remove the document metadata: ${err instanceof Error ? err.message : String(err)}`);
  }
  await removePath(join(stage, 'manuscript.md'));
  await removePath(join(stage, 'style.csl'));
  return outPath;
}

// ---------------------------------------------------------------------------
// exportDraft
// ---------------------------------------------------------------------------

export type ExportFormat = 'docx' | 'pdf' | 'latex' | 'md';

export interface ExportOptions {
  /** The manuscript to export (the compiled DRAFT.md or the humanized FINAL.md). */
  inputPath: string;
  /** The export folder; defaults to `<paperDir>/export`. */
  outputDir?: string;
  format: ExportFormat;
  /** Project root for paperDir() resolution. */
  paperRoot?: string;
  /** Injectable Pandoc presence (deterministic tests); defaults to a live probe. */
  pandocPresent?: boolean;
  /** Citation style key (`apa`, `ieee`, ...). Defaults to `apa`. */
  style?: string;
}

export interface ExportResult {
  outputPath: string;
  format: ExportFormat;
  pandocUsed: boolean;
  /** The exported bibliography files; absent when the paper cites nothing. */
  bibPath?: string;
  risPath?: string;
  /** The keys the exported paper cites, in first-appearance order. */
  citedKeys: string[];
}

const DELIVERABLE_EXTS = ['md', 'docx', 'pdf', 'tex'];

/** `p` resolved, through symlinks where it exists, so two spellings of one folder compare equal. */
function realPath(p: string): string {
  const abs = path.resolve(p);
  try {
    return realpathSync.native(abs);
  } catch {
    return abs;
  }
}

function traceFormat(file: string): TraceFormat {
  const ext = extname(file).slice(1);
  return ext === 'tex' ? 'latex' : (ext as TraceFormat);
}

/**
 * Export one manuscript in one format. Builds every file in a staging folder,
 * scans each for traces, then replaces the previous export with them. On any
 * failure it throws an ExportError and leaves the export folder as it was.
 */
export async function exportDraft(opts: ExportOptions): Promise<ExportResult> {
  const { inputPath, format } = opts;
  const paper = paperDir(opts.paperRoot);
  const exportDir = opts.outputDir ?? join(paper, 'export');
  const style = opts.style ?? 'apa';
  if (!SUPPORTED_STYLES.includes(style)) {
    throw new ExportError('invalid-input', `Unknown citation style '${style}'. Supported: ${SUPPORTED_STYLES.join(', ')}.`);
  }
  const stem = basename(inputPath, extname(inputPath));
  // Each export replaces DRAFT.*, FINAL.*, <stem>.* and CITATIONS.* in the
  // export folder, so it must not be the paper folder (the canonical
  // CITATIONS.bib) or the folder that holds the manuscript itself.
  const target = realPath(exportDir);
  if (target === realPath(paper) || target === realPath(dirname(inputPath))) {
    throw new ExportError(
      'invalid-input',
      `The export folder ${exportDir} holds the manuscript or the paper's own files, which an export would replace. Choose another folder.`,
    );
  }
  const md = await fsp.readFile(inputPath, 'utf8');

  // Citations and the works they cite. A bracketed citation of a key with no
  // entry is refused; a narrative `@word` with no entry is ordinary text
  // (a handle, an email-like word), as it would read in the source.
  const bibPathSrc = join(paper, 'CITATIONS.bib');
  const bibText = existsSync(bibPathSrc) ? await fsp.readFile(bibPathSrc, 'utf8') : '';
  const all = findCitations(md);
  let entries: CslEntry[] = [];
  try {
    entries = await readBibEntries(bibText);
  } catch (err) {
    if (all.some((c) => !c.narrative)) {
      throw new ExportError('invalid-input', `CITATIONS.bib could not be read: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const known = new Set(entries.map((e) => e.id));
  const unknownCited = [...new Set(all.filter((c) => !c.narrative).flatMap((c) => c.items.map((i) => i.key)).filter((k) => !known.has(k)))];
  if (unknownCited.length > 0) {
    throw new ExportError('unresolved-citation', 'The paper cites works that are not in CITATIONS.bib.', unknownCited);
  }
  const cites = all.filter((c) => !c.narrative || known.has(c.items[0]!.key));
  const ignored = all.filter((c) => c.narrative && !known.has(c.items[0]!.key));
  const citedKeys = [...new Set(cites.flatMap((c) => c.items.map((i) => i.key)))];
  const { entries: exported } = selectEntries(entries, citedKeys);

  const pandoc = opts.pandocPresent ?? isPandocPresent();
  if ((format === 'docx' || format === 'pdf') && !pandoc) {
    throw new ExportError(
      'missing-tool',
      `Pandoc is not installed, so a .${format} cannot be made. Install Pandoc (https://pandoc.org/installing.html)` +
        `${format === 'pdf' ? ' and a TeX engine' : ''}, or export with --format md.`,
    );
  }

  const stage = await makeTempDir(paper, '.export-');
  try {
    const files: string[] = [];
    if (exported.length > 0) {
      await atomicWriteFile(join(stage, 'CITATIONS.bib'), toBibtex(exported));
      await atomicWriteFile(join(stage, 'CITATIONS.ris'), toRis(exported));
      files.push(join(stage, 'CITATIONS.bib'), join(stage, 'CITATIONS.ris'));
    }

    let outputFile: string;
    let pandocUsed = false;
    if (format === 'md') {
      outputFile = join(stage, `${stem}.md`);
      await atomicWriteFile(outputFile, renderMarkdown(prepareOffline(md, cites, exported, style)));
    } else if (format === 'latex' && !pandoc) {
      outputFile = join(stage, `${stem}.tex`);
      await atomicWriteFile(outputFile, renderLatex(prepareOffline(md, cites, exported, style)));
    } else {
      outputFile = await pandocExport(stage, stem, md, cites, ignored, style, format);
      pandocUsed = true;
    }
    files.push(outputFile);

    // The last gate: every file that would ship is scanned.
    const ctx = {
      authorText: md,
      bibliographicText: JSON.stringify(exported),
      sensitivePaths: [...homeDirs(), paper, path.resolve(opts.paperRoot ?? process.cwd()), PKG_ROOT, tmpdir(), stage],
    };
    const findings = [];
    for (const f of files) findings.push(...(await scanExportFile(f, traceFormat(f), ctx)));
    if (findings.length > 0) {
      throw new ExportError(
        'trace-found',
        'The exported file would carry a trace of pensmith or of this computer, so it was not written.',
        findings.map(describeFinding),
      );
    }

    // Replace the previous export: no stale file from an earlier run stays.
    await fsp.mkdir(exportDir, { recursive: true });
    for (const s of new Set(['DRAFT', 'FINAL', stem])) {
      for (const ext of DELIVERABLE_EXTS) await removePath(join(exportDir, `${s}.${ext}`));
    }
    await removePath(join(exportDir, 'CITATIONS.bib'));
    await removePath(join(exportDir, 'CITATIONS.ris'));
    // Copied rather than renamed: the export folder may be on another disk.
    const published = new Map<string, string>();
    for (const f of files) {
      const dest = join(exportDir, basename(f));
      await atomicWriteFile(dest, await fsp.readFile(f));
      published.set(basename(f), dest);
    }

    return {
      outputPath: published.get(basename(outputFile))!,
      format,
      pandocUsed,
      ...(published.has('CITATIONS.bib') ? { bibPath: published.get('CITATIONS.bib')! } : {}),
      ...(published.has('CITATIONS.ris') ? { risPath: published.get('CITATIONS.ris')! } : {}),
      citedKeys,
    };
  } finally {
    await removePath(stage);
  }
}
