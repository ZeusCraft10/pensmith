// bin/lib/exporter.ts — the export: every requested format, in the paper's
// citation style, with zero trace (DONE-06, DONE-07, DONE-08; EXP-01 … EXP-09,
// D-21-02 … D-21-12).
//
// exportDraft orchestrates the modules under bin/lib/export/:
//   1. The bibliography (library.ts planExportCitations, D-21-11): the
//      cited-only export/CITATIONS.bib filtered from the exact bib bytes the
//      gate judged, and export/CITATIONS.ris rendered from the SAME parsed
//      entries — the same key set by construction, asserted. A text that cites
//      keys none of which is in the bibliography is an error (EXP-01). Nothing
//      is written yet.
//   2. The citations (export/render.ts): every citation of the gated text,
//      read with the one citation grammar, rendered by ONE citeproc pass over
//      the whole document in the resolved style (a bundled key or a `.csl`
//      path) and placed as pandoc places it — in-text, superscript or a
//      footnote (D-21-03, D-21-04).
//   3. The writer (D-21-02): `md` is always the built-in Markdown writer
//      (export/md-writer.ts), never pandoc. `docx`, `pdf` and `latex` use
//      pandoc when it is on PATH (`pdf` also needs a PDF engine — pdflatex,
//      xelatex, lualatex or tectonic), run blind in a temporary directory
//      (export/pandoc.ts, D-21-09); otherwise — and when a pandoc run fails —
//      the built-in writer of the SAME format (export/docx-writer.ts,
//      pdf-writer.ts, latex-writer.ts over export/document.ts). A requested
//      format is never replaced by another; stdout names the writer
//      (`built-in docx writer — pandoc not found`). Only a format that truly
//      cannot be produced is an ExportFormatError (EXIT_ERROR).
//   4. Write, scrub, scan (export/zero-trace.ts, D-21-08): the bib, the RIS
//      and the document are written, a pandoc docx / PDF / LaTeX is scrubbed,
//      and EVERY file written is scanned. On any finding, or when a scrub
//      throws, every file this call wrote is deleted and ZeroTraceError
//      (EXIT_ERROR) is thrown — no Markdown fallback, nothing unscrubbed left
//      in export/.
//
// Nothing the exporter adds can carry an unverified citation (D-21-12,
// carry-over 4): it adds only the rendered form of each citation the gate
// read (in-text text, or a footnote whose text is the engine's note for that
// citation), the bibliography of exactly the rendered keys, the reference
// section's heading and the writers' layout. Before anything is written,
// assertRenderedKeys checks that every rendered key is a key the gated text
// cites (extractCitedKeysForVerification — the keys Pass 1 judged), that the
// rendered bibliography holds exactly the rendered keys, and that the export
// bib holds exactly the cited keys the bibliography has; a mismatch is a
// PensmithError and nothing is written. Note-style footnotes are produced
// after the gate but hold nothing the gate did not judge. One qualification
// (review round 2): a user-supplied `.csl` file is code for the engine, and
// its literal text (a `<text value="…"/>`, a macro) is printed in every
// citation, note and bibliography entry without passing the gate — so a
// `.csl` file config.toml names is used only once the user approved it
// (style-approvals.ts, the `csl-style` gate), and assertRenderedIdentifiers
// refuses an export whose rendered citations print a DOI, arXiv id or PMID
// that none of the cited entries holds.
// tests/exporter-invariant.property.test.ts checks that the export's text
// with the rendered citations, notes and bibliography removed equals the
// gated text with its citation tokens removed.
//
// D-07 chokepoint: every file goes through atomicWriteFile (the bib and RIS
// through library.ts, the one writer of CITATIONS.*).

import * as fsp from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { out as writeOut } from './output-sink.js';
import { atomicWriteFile } from './atomic-write.js';
import { isPandocPresent } from './ecosystem-presence.js';
import { paperDir, projectRoot, dryRunWorkspaceActive } from './paths.js';
import { planExportCitations, writeExportCitations, type ExportCitationsPlan } from './library.js';
import { extractCitedKeysForVerification } from './citation-token.js';
import { findBareIdentifiers } from './doi.js';
import type { RichRun } from './citations.js';
import { EXIT_ERROR, PensmithError } from './exit-codes.js';
import { prepareText, type PreparedText } from './export/render.js';
import { writeMarkdown } from './export/md-writer.js';
import { buildExportDocument, documentPlainText, type ExportDocument } from './export/document.js';
import { writeDocx } from './export/docx-writer.js';
import { pdfFontPaths, writePdf } from './export/pdf-writer.js';
import { pdfTexUnprintable, writeLatex } from './export/latex-writer.js';
import { detectPdfEngine, pandocFailure, pdfEngineHeader, runPandoc, scrubPandocLatex } from './export/pandoc.js';
import { documentChars, unprintableNote } from './export/glyphs.js';
import { ZeroTraceError, scanExportFile, scanExportText, zeroTracePatch, zeroTracePdf, type ZeroTraceFinding } from './export/zero-trace.js';

export { zeroTracePatch, zeroTracePdf, ZeroTraceError, scanExportFile };
export type { ZeroTraceFinding };

// ---------------------------------------------------------------------------
// exportDraft
// ---------------------------------------------------------------------------

export type ExportFormat = 'docx' | 'pdf' | 'latex' | 'md';

const FORMATS: readonly ExportFormat[] = ['md', 'docx', 'pdf', 'latex'];

/** A format that cannot be produced (EXIT_ERROR, one line naming why — D-21-02). */
export class ExportFormatError extends PensmithError {
  constructor(message: string) {
    super(message, EXIT_ERROR);
    this.name = 'ExportFormatError';
  }
}

export interface ExportOptions {
  /** The source draft (absolute or cwd-relative). With `text`, it only names the export. */
  inputPath: string;
  /** Override the export dir; defaults to `<paperDir>/export` (DISTINCT). */
  outputDir?: string;
  format: ExportFormat;
  /** Project root for paperDir() resolution. */
  paperRoot?: string;
  /** Injectable pandoc-presence flag (deterministic tests); defaults to a live probe. */
  pandocPresent?: boolean;
  /**
   * Injectable PDF engine for pandoc (`pdflatex`, `xelatex`, `lualatex`,
   * `tectonic`), or null for none; defaults to the first one found on PATH.
   */
  pdfEngine?: string | null;
  /**
   * The citation style: a bundled CSL key (`apa`, `ieee`, …) or an absolute
   * path to a `.csl` file (D-21-07; done resolves it, export-style.ts). When
   * absent, citations are exported as written (with a warning when the text
   * has any).
   */
  style?: string;
  /**
   * The exact markdown to export, in place of reading `inputPath` again (which
   * then only names the export): done passes the text its gate judged, so an
   * edit made while done ran — a sync client, an editor, the user at the
   * confirmation — never reaches the export ungated (VRFY-26).
   */
  text?: string;
  /** The bibliography text the gate judged (exportCitedCitations `bibText`). */
  bibText?: string;
  /**
   * `cited` (default): write export/CITATIONS.bib and .ris of the cited keys
   * and a References / Bibliography section. `none`: leave export/CITATIONS.*
   * untouched and print no bibliography (a text whose references are already
   * written in it — the annotated bibliography, GRND-11).
   */
  bibliography?: 'cited' | 'none';
}

/**
 * The file-name stem of an export of `inputPath`: `DRAFT` for DRAFT.md, and
 * under --dry-run `DRAFT.dry-run` (GRND-19, D-18-29) — a trial export in
 * `.paper-dry-run/export/` is never mistaken for the real deliverable. The
 * name is the only disclosure: the document itself stays zero-trace.
 */
export function exportStem(inputPath: string): string {
  const stem = basename(inputPath, extname(inputPath));
  return dryRunWorkspaceActive() ? `${stem}.dry-run` : stem;
}

export interface ExportResult {
  outputPath: string;
  format: ExportFormat;
  pandocUsed: boolean;
  bibCopied: boolean;
  risCopied: boolean; // CITE-05 — CITATIONS.ris bundled alongside .bib
  /** Which writer made the document (D-21-02). */
  writer: 'pandoc' | 'built-in';
  /** One line each: why the built-in writer ran, constructs written as text. */
  notes: readonly string[];
}

const FORMAT_LABEL: Readonly<Record<ExportFormat, string>> = { md: 'Markdown', docx: 'docx', pdf: 'PDF', latex: 'LaTeX' };
const FORMAT_EXT: Readonly<Record<ExportFormat, string>> = { md: 'md', docx: 'docx', pdf: 'pdf', latex: 'tex' };

/**
 * D-21-12: nothing rendered that the gate did not read, a bibliography of
 * exactly the rendered keys, an export bib of exactly the cited keys the
 * bibliography holds. Throws a PensmithError (nothing is written yet).
 */
export function assertRenderedKeys(prep: PreparedText, gatedKeys: readonly string[], plan: ExportCitationsPlan): void {
  const gated = new Set(gatedKeys);
  const foreign = prep.renderedKeys.filter((k) => !gated.has(k));
  const bibIds = new Set(prep.bibliography.map((e) => e.id));
  const rendered = new Set(prep.renderedKeys);
  const bibMismatch = [...bibIds].filter((k) => !rendered.has(k)).concat([...rendered].filter((k) => !bibIds.has(k)));
  const exported = new Set(plan.exported);
  const exportMismatch = gatedKeys.filter((k) => !exported.has(k) && !plan.missing.includes(k)).concat(plan.exported.filter((k) => !gated.has(k)));
  if (foreign.length === 0 && (prep.bibliography.length === 0 || bibMismatch.length === 0) && exportMismatch.length === 0) return;
  const why = foreign.length > 0
    ? `it would render ${foreign.join(', ')}, which the checked text does not cite`
    : bibMismatch.length > 0
      ? `its bibliography and its citations disagree on ${bibMismatch.join(', ')}`
      : `its bibliography file and the checked text disagree on ${exportMismatch.join(', ')}`;
  throw new PensmithError(`export refused: ${why} — nothing was exported`, EXIT_ERROR);
}

/** Every identifier (`doi:…`, `arxiv:…`, `pmid:…`, canonical) the cited entries' own fields hold. */
function entryIdentifiers(entries: ReadonlyArray<Record<string, unknown>>): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    for (const v of Object.values(e)) {
      if (typeof v !== 'string' && typeof v !== 'number') continue;
      const t = String(v).trim();
      for (const probe of [t, `doi:${t}`, `arXiv:${t}`, `PMID:${t}`]) for (const b of findBareIdentifiers(probe)) out.add(`${b.kind}:${b.id}`);
    }
  }
  return out;
}

/** The text and the link targets of rich runs. */
function runsAndLinks(runs: readonly RichRun[]): string {
  return [runs.map((r) => r.text).join(''), ...runs.flatMap((r) => (r.href !== undefined ? [r.href] : []))].join('\n');
}

/**
 * D-21-12, defence in depth (review round 2): every identifier the rendered
 * citations, notes and bibliography print must be one of the cited entries'
 * own. A bundled style prints only those; a `.csl` file can print any literal
 * text (`<text value="doi:10.9999/…"/>`), which no gate read — a DOI, arXiv id
 * or PMID it adds refuses the export. Throws a PensmithError (nothing is
 * written yet).
 */
export function assertRenderedIdentifiers(prep: PreparedText, entries: ReadonlyArray<Record<string, unknown>>): void {
  const own = entryIdentifiers(entries);
  const texts: string[] = [];
  for (const p of prep.placed) for (const part of p.parts) if (part.kind === 'runs') texts.push(runsAndLinks(part.runs));
  for (const n of prep.notes) texts.push(runsAndLinks(n));
  for (const e of prep.bibliography) texts.push(runsAndLinks([...(e.label ?? []), ...e.runs]));
  for (const t of texts) {
    const foreign = findBareIdentifiers(t).find((b) => !own.has(`${b.kind}:${b.id}`));
    if (foreign !== undefined) {
      throw new PensmithError(
        `export refused: the citation style printed an identifier no cited source holds (${foreign.text}) — a style's own text is not checked by the verifier, so nothing was exported; use a bundled style or another .csl file`,
        EXIT_ERROR,
      );
    }
  }
}

/** The note for characters pdfLaTeX prints as `?` in a .tex (XeTeX / LuaTeX print them with a font that has them). */
function latexUnprintableNote(doc: ExportDocument): string[] {
  const chars = pdfTexUnprintable(documentChars(doc));
  return chars.length > 0
    ? [unprintableNote(chars, 'pdfLaTeX cannot print are written to print as ? under pdfLaTeX', 'xelatex or lualatex print them with a main font that has them (\\setmainfont)')]
    : [];
}

/** The built-in writer's bytes for `format`, the constructs it wrote as text, and the characters it could not print. */
async function builtIn(format: ExportFormat, prep: PreparedText, doc: ExportDocument, withBibliography: boolean): Promise<{ bytes: string | Buffer; literal: readonly string[]; glyphs: readonly string[] }> {
  if (format === 'md') return { bytes: writeMarkdown(prep, { withBibliography }), literal: [], glyphs: [] };
  if (format === 'docx') return { bytes: await writeDocx(doc), literal: doc.literal, glyphs: [] };
  if (format === 'latex') return { bytes: writeLatex(doc), literal: doc.literal, glyphs: latexUnprintableNote(doc) };
  const missing = pdfFontPaths().filter((p) => !existsSync(p));
  if (missing.length > 0) {
    throw new ExportFormatError(`cannot write the PDF: the built-in PDF writer's font ${missing[0]} is missing — reinstall pensmith, or install pandoc and a TeX engine`);
  }
  const unprintable = new Set<string>();
  const bytes = await writePdf(doc, unprintable);
  const glyphs = unprintable.size > 0
    ? [unprintableNote([...unprintable].sort(), 'the built-in PDF font (Liberation Serif) has no glyph for were printed as ?', 'no font pensmith ships has them; the .docx and .tex exports keep them')]
    : [];
  return { bytes, literal: doc.literal, glyphs };
}

/** The zero-trace scrub of a written document (docx: zeroTracePatch; PDF: zeroTracePdf). */
async function scrub(file: string, format: ExportFormat): Promise<void> {
  if (format === 'docx') await zeroTracePatch(file);
  else if (format === 'pdf') await zeroTracePdf(file);
}

let scrubOverride: ((file: string, format: ExportFormat) => Promise<void>) | null = null;

/**
 * Test-only seam: replace the scrub step (a failing scrub must leave nothing
 * in export/, D-21-08). Pass null to restore it. Double-underscore marks it
 * test-only.
 */
export function __setScrubForTest(fn: ((file: string, format: ExportFormat) => Promise<void>) | null): void {
  scrubOverride = fn;
}

/** One line of an error, for a note. */
function firstLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const line = (msg.split('\n').find((l) => l.trim() !== '') ?? msg).trim();
  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
}

/**
 * exportDraft — export one document in one format (the module header has the
 * steps). Every output goes into a DISTINCT export dir (default
 * `<paperDir>/export`, under --dry-run `.paper-dry-run/export/` with
 * `.dry-run` names), never over the source artifacts.
 */
export async function exportDraft(opts: ExportOptions): Promise<ExportResult> {
  const format = opts.format;
  if (!FORMATS.includes(format)) {
    throw new ExportFormatError(`cannot export "${String(format)}": the export formats are md, docx, pdf and latex`);
  }
  const text = opts.text ?? (await fsp.readFile(opts.inputPath, 'utf8'));
  const root = opts.paperRoot ?? projectRoot();
  const exportDir = opts.outputDir ?? join(paperDir(opts.paperRoot), 'export');
  const stem = exportStem(opts.inputPath);
  const bibStem = exportStem('CITATIONS.bib');
  const withBibliography = (opts.bibliography ?? 'cited') === 'cited';
  const notes: string[] = [];

  // 1. The bibliography: computed and checked, nothing written yet.
  const gatedKeys = extractCitedKeysForVerification(text);
  const plan = await planExportCitations(root, gatedKeys, exportDir, opts.bibText !== undefined ? { bibText: opts.bibText } : {});
  if (plan.missing.length > 0) {
    process.stderr.write(`pensmith export: WARN — cited key(s) not in CITATIONS.bib (left as written): ${plan.missing.join(', ')}\n`);
  }
  if (opts.style === undefined && gatedKeys.length > 0) {
    process.stderr.write('pensmith export: WARN — no citation style given: the citations are exported as written\n');
  }

  // 2. The citations, rendered and placed; the D-21-12 invariant.
  const prep = await prepareText(text, plan.entries, opts.style ?? null);
  assertRenderedKeys(prep, gatedKeys, plan);
  assertRenderedIdentifiers(prep, plan.entries);
  const localeNote = prep.localeFallback !== null ? [`the style's locale ${prep.localeFallback} is not bundled: the built-in renderer used en-US terms`] : [];
  if (prep.unprinted.length > 0) notes.push(`the style prints nothing for a citation of ${prep.unprinted.join(', ')} (no printed form) — it was left out of the text, as pandoc leaves it out`);

  // 3. The writer, and the document's bytes (still nothing written).
  const pandoc = format !== 'md' && (opts.pandocPresent ?? isPandocPresent());
  let writer: 'pandoc' | 'built-in' = 'built-in';
  let engine: string | null = null;
  if (format === 'md') {
    /* always the built-in Markdown writer */
  } else if (!pandoc) {
    notes.push(`built-in ${FORMAT_LABEL[format]} writer — pandoc not found`);
  } else if (format === 'pdf') {
    engine = opts.pdfEngine !== undefined ? opts.pdfEngine : detectPdfEngine();
    if (engine === null) notes.push('built-in PDF writer — pandoc found but no PDF engine (pdflatex, xelatex, lualatex or tectonic)');
    else writer = 'pandoc';
  } else {
    writer = 'pandoc';
  }
  let bytes: string | Buffer | null = null;
  // The document model: what every writer prints (the characters a PDF or a
  // .tex cannot show are named from it, EXP-09).
  const doc = format === 'md' ? null : buildExportDocument(prep, { withBibliography });
  // A PDF's page text is glyph codes the scan of the written file cannot read:
  // the author-content rule runs on the text it will print, before any writer
  // (review round 2), so the four formats refuse the same text.
  if (format === 'pdf' && doc !== null) {
    const pdfName = `${stem}.${FORMAT_EXT[format]}`;
    const textFindings = scanExportText(pdfName, documentPlainText(doc), { paperRoot: root });
    if (textFindings.length > 0) throw new ZeroTraceError(textFindings, []);
  }
  if (writer === 'pandoc' && doc !== null) {
    const header = format === 'pdf' && engine !== null ? pdfEngineHeader(engine, documentChars(doc)) : null;
    try {
      const out = await runPandoc({
        text,
        format: format as 'docx' | 'pdf' | 'latex',
        citations:
          opts.style !== undefined && plan.entries.length > 0
            ? { entries: plan.entries, style: opts.style, referencesTitle: withBibliography && prep.bibliography.length > 0 ? prep.referencesTitle : null }
            : null,
        ...(engine !== null ? { pdfEngine: engine } : {}),
        ...(header !== null ? { pdfHeader: header } : {}),
      });
      bytes = format === 'latex' ? scrubPandocLatex(out.toString('utf8')) : out;
      if (format === 'latex') notes.push(...latexUnprintableNote(doc));
      if (header !== null && header.unprintable.length > 0) {
        notes.push(
          unprintableNote(
            [...header.unprintable],
            engine === 'pdflatex' ? 'pdfLaTeX cannot print were printed as ?' : 'the PDF font (Liberation Serif) has no glyph for were printed as ?',
            engine === 'pdflatex' ? 'a XeTeX-family engine (xelatex, lualatex or tectonic) prints those Liberation Serif has' : 'no font pensmith ships has them; the .docx and .tex exports keep them',
          ),
        );
      }
    } catch (e) {
      writer = 'built-in';
      notes.push(`built-in ${FORMAT_LABEL[format]} writer — pandoc failed (${pandocFailure(e)})`);
    }
  }
  if (bytes === null) {
    notes.push(...localeNote);
    const made = await builtIn(format, prep, doc ?? buildExportDocument(prep, { withBibliography }), withBibliography);
    bytes = made.bytes;
    for (const l of made.literal) notes.push(`${l} (the built-in writer reads a Markdown subset)`);
    notes.push(...made.glyphs);
  }

  // 4. Write, scrub, scan — on any failure, delete everything this call wrote.
  await fsp.mkdir(exportDir, { recursive: true });
  const outputPath = join(exportDir, `${stem}.${FORMAT_EXT[format]}`);
  const written: string[] = [];
  const removeWritten = async (): Promise<void> => {
    for (const f of written) await fsp.rm(f, { force: true });
  };
  let bibPath: string | null = null;
  let risPath: string | null = null;
  try {
    if (withBibliography) {
      const w = await writeExportCitations(plan, exportDir, bibStem);
      bibPath = w.bibPath;
      risPath = w.risPath;
      if (bibPath !== null) written.push(bibPath);
      if (risPath !== null) written.push(risPath);
    }
    await atomicWriteFile(outputPath, bytes);
    written.push(outputPath);
  } catch (e) {
    await removeWritten();
    throw e;
  }
  try {
    // The scrub is the mandatory last step of every docx and PDF, whichever
    // writer made it (the built-in writers' output is already clean; the scrub
    // is then a no-op that proves it).
    await (scrubOverride ?? scrub)(outputPath, format);
  } catch (e) {
    await removeWritten();
    throw new ZeroTraceError([{ file: basename(outputPath), where: 'scrub', finding: `could not be scrubbed (${firstLine(e)})` }], written);
  }
  const findings: ZeroTraceFinding[] = [];
  for (const f of written) {
    for (const finding of await scanExportFile(f, { paperRoot: root })) findings.push({ ...finding, file: basename(f) });
  }
  if (findings.length > 0) {
    await removeWritten();
    throw new ZeroTraceError(findings, written);
  }

  const how = writer === 'pandoc' ? `pandoc ${FORMAT_LABEL[format]} writer` : (notes.find((n) => n.startsWith('built-in ')) ?? `built-in ${FORMAT_LABEL[format]} writer`);
  writeOut(`pensmith export: ${basename(outputPath)} — ${how}\n`);
  for (const n of notes) if (n !== how) writeOut(`pensmith export: note — ${n}\n`);
  return {
    outputPath,
    format,
    pandocUsed: writer === 'pandoc',
    bibCopied: bibPath !== null,
    risCopied: risPath !== null,
    writer,
    notes,
  };
}
