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
// after the gate but hold nothing the gate did not judge.
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
import { isHumanizerSkillPresent, isPandocPresent } from './ecosystem-presence.js';
import { paperDir, projectRoot, dryRunWorkspaceActive } from './paths.js';
import { planExportCitations, writeExportCitations, type ExportCitationsPlan } from './library.js';
import { extractCitedKeysForVerification } from './citation-token.js';
import { EXIT_ERROR, PensmithError } from './exit-codes.js';
import { prepareText, type PreparedText } from './export/render.js';
import { writeMarkdown } from './export/md-writer.js';
import { buildExportDocument } from './export/document.js';
import { writeDocx } from './export/docx-writer.js';
import { pdfFontPaths, writePdf } from './export/pdf-writer.js';
import { writeLatex } from './export/latex-writer.js';
import { detectPdfEngine, runPandoc, scrubPandocLatex } from './export/pandoc.js';
import { ZeroTraceError, scanExportFile, zeroTracePatch, zeroTracePdf, type ZeroTraceFinding } from './export/zero-trace.js';

export { zeroTracePatch, zeroTracePdf, ZeroTraceError, scanExportFile };
export type { ZeroTraceFinding };

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
      writeOut(
        'pensmith done: humanizer skill not found at ~/.claude/skills/humanizer/ — skipping humanize step.\n',
      );
      return null;
    }

    // Skill present but no Task transport (Tier-2 era): skip cleanly with a
    // distinct banner; the export proceeds on DRAFT.md.
    writeOut(
      'pensmith done: humanizer skill present but no Task transport in this tier — skipping humanize step (export proceeds on DRAFT.md).\n',
    );
    return null;
  } catch {
    // Advisory — the humanize step must NEVER fail the export (Pitfall 7).
    writeOut(
      'pensmith done: humanizer skill not found at ~/.claude/skills/humanizer/ — skipping humanize step.\n',
    );
    return null;
  }
}

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

/** The built-in writer's bytes for `format`. */
async function builtIn(format: ExportFormat, prep: PreparedText, withBibliography: boolean): Promise<{ bytes: string | Buffer; literal: readonly string[] }> {
  if (format === 'md') return { bytes: writeMarkdown(prep, { withBibliography }), literal: [] };
  const doc = buildExportDocument(prep, { withBibliography });
  if (format === 'docx') return { bytes: await writeDocx(doc), literal: doc.literal };
  if (format === 'latex') return { bytes: writeLatex(doc), literal: doc.literal };
  const missing = pdfFontPaths().filter((p) => !existsSync(p));
  if (missing.length > 0) {
    throw new ExportFormatError(`cannot write the PDF: the built-in PDF writer's font ${missing[0]} is missing — reinstall pensmith, or install pandoc and a TeX engine`);
  }
  return { bytes: await writePdf(doc), literal: doc.literal };
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
  if (writer === 'pandoc') {
    try {
      const out = await runPandoc({
        text,
        format: format as 'docx' | 'pdf' | 'latex',
        citations:
          opts.style !== undefined && plan.entries.length > 0
            ? { entries: plan.entries, style: opts.style, referencesTitle: withBibliography && prep.bibliography.length > 0 ? prep.referencesTitle : null }
            : null,
        ...(engine !== null ? { pdfEngine: engine } : {}),
      });
      bytes = format === 'latex' ? scrubPandocLatex(out.toString('utf8')) : out;
    } catch (e) {
      writer = 'built-in';
      notes.push(`built-in ${FORMAT_LABEL[format]} writer — pandoc failed (${firstLine(e)})`);
    }
  }
  if (bytes === null) {
    const made = await builtIn(format, prep, withBibliography);
    bytes = made.bytes;
    for (const l of made.literal) notes.push(`${l} (the built-in writer reads a Markdown subset)`);
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
    if (writer === 'pandoc' && format === 'docx') await zeroTracePatch(outputPath);
    if (writer === 'pandoc' && format === 'pdf') await zeroTracePdf(outputPath);
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

  const how = writer === 'pandoc' ? `pandoc ${FORMAT_LABEL[format]} writer` : notes[0]?.startsWith('built-in') === true ? (notes[0] as string) : `built-in ${FORMAT_LABEL[format]} writer`;
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
