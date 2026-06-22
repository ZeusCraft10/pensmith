// bin/lib/exporter.ts
//
// Zero-trace export (DONE-07 / TEST-10) — THE non-negotiable: no exported doc
// carries a pensmith metadata trace, in ANY format. zeroTracePatch() is the
// MANDATORY last step of every .docx export; zeroTracePdf() is the MANDATORY
// last step of every .pdf export. Pandoc shellout via execFile (never exec).
// md-only fallback when Pandoc/PDF-engine absent (DONE-06) — never throws.
// Exports written to a DISTINCT export dir, never over the source artifacts.
//
// WHY in-process scrubs (not just Pandoc flags):
//   - .docx: even `--metadata author=""` leaves an empty-but-present field, and a
//     source YAML header can inject a real name. zeroTracePatch loads the ZIP and
//     blanks the FULL identifying field set across core.xml + app.xml, then sweeps
//     EVERY non-binary entry (incl. _rels/.rels) for the literal 'pensmith'.
//   - .pdf: the `--variable pdfcreator=/pdfproducer=` flags CANNOT strip the XMP
//     stream the engine injects (06-RESEARCH Pitfall 3). pdf-lib's save()
//     serializes ALL indirect objects regardless of reachability, so deleting the
//     catalog /Metadata reference is NOT enough — the XMP stream OBJECT must be
//     deleted from the context so save() never emits it (HIGH-C2-1). NO
//     length-altering byte edits on the serialized PDF (the latin1 replace
//     approach shifts xref offsets + /Length values and corrupts the file).
//
// Both scrubs run OFFLINE in-process (JSZip for docx, pure-JS pdf-lib for pdf),
// so the gating zero-trace test passes on the build machine where Pandoc + the
// PDF engine are absent.
//
// D-07 chokepoint: all file output routes through atomicWriteFile / copyFile;
// this module NEVER calls fs.writeFile-family methods directly.

import { execFile } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { PDFDocument, PDFName } from 'pdf-lib';
import { atomicWriteFile } from './atomic-write.js';
import { isHumanizerSkillPresent, isPandocPresent } from './ecosystem-presence.js';
import { paperDir } from './paths.js';

const execFileAsync = promisify(execFile);

// Fixed epoch used for ZIP entry timestamps + dcterms normalization — keeps the
// scrubbed .docx deterministic (Pitfall 6) and strips authoring-time metadata.
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
// zeroTracePatch — DOCX ZIP scrub (DONE-07 / T-06-04-01)
// ---------------------------------------------------------------------------

// The FULL identifying field set blanked in docProps/core.xml (HIGH-2 — the
// narrow set in a prior cycle MISSED dc:subject/dc:description/cp:category/
// cp:contentStatus). Each is set to an empty element.
const CORE_BLANK_TAGS = [
  'dc:creator',
  'dc:title',
  'dc:subject',
  'dc:description',
  'cp:keywords',
  'cp:category',
  'cp:contentStatus',
  'cp:lastModifiedBy',
];

// The extended-property fields blanked in docProps/app.xml.
const APP_BLANK_TAGS = ['Application', 'Company', 'Manager', 'Template'];

/**
 * Blank an XML element `<ns:tag ...>...</ns:tag>` to `<ns:tag></ns:tag>`,
 * tolerating (a) attribute-bearing open tags, (b) multiline content, and
 * (c) the self-closing form `<ns:tag/>`. Escapes the tag name for the RegExp.
 */
function blankXmlTag(xml: string, tag: string): string {
  const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Paired form: <tag ...> ... </tag>  (attributes optional, content any).
  const paired = new RegExp(`<${esc}(\\s[^>]*)?>[\\s\\S]*?<\\/${esc}>`, 'g');
  // Self-closing form: <tag ... />
  const selfClosing = new RegExp(`<${esc}(\\s[^>]*)?\\/>`, 'g');
  return xml.replace(paired, `<${tag}></${tag}>`).replace(selfClosing, `<${tag}></${tag}>`);
}

/**
 * Set a `<dcterms:created>`/`<dcterms:modified>` element to the fixed epoch,
 * preserving its attributes (e.g. `xsi:type="dcterms:W3CDTF"`).
 */
function epochDctermsTag(xml: string, tag: string): string {
  const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const paired = new RegExp(`<${esc}((?:\\s[^>]*)?)>[\\s\\S]*?<\\/${esc}>`, 'g');
  const selfClosing = new RegExp(`<${esc}((?:\\s[^>]*)?)\\/>`, 'g');
  return xml
    .replace(paired, (_m, attrs: string) => `<${tag}${attrs}>${EPOCH_W3CDTF}</${tag}>`)
    .replace(selfClosing, (_m, attrs: string) => `<${tag}${attrs}>${EPOCH_W3CDTF}</${tag}>`);
}

/**
 * Heuristic: is this ZIP entry a binary part we must NOT string-sweep?
 *
 * MEDIUM-1 (cycle-3): the defense-in-depth 'pensmith' sweep must NOT run a
 * string replace over binary parts (media images, embedded fonts, thumbnails) —
 * doing so would corrupt the LIVE Pandoc docx path (the CI fixture has no binary
 * parts, but a real export may). We treat known binary subtrees + a NUL-byte
 * sniff as binary and pass those entries through untouched.
 */
function isBinaryDocxEntry(name: string, text: string): boolean {
  const lower = name.toLowerCase();
  if (
    lower.startsWith('word/media/') ||
    lower.startsWith('word/embeddings/') ||
    lower.startsWith('word/fonts/') ||
    lower.startsWith('docprops/thumbnail') ||
    /\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|bin|ttf|otf|woff2?|eot)$/.test(lower)
  ) {
    return true;
  }
  // NUL byte → certainly not text we should string-edit.
  return text.includes('\x00');
}

/**
 * zeroTracePatch — MANDATORY last step of every .docx export (DONE-07).
 *
 * Loads `docxPath` as a ZIP, blanks the FULL identifying field set in
 * docProps/core.xml + docProps/app.xml, epochs the dcterms timestamps, sweeps
 * EVERY non-binary entry (including non-.xml entries like `_rels/.rels`) for the
 * literal 'pensmith', and writes the result back atomically.
 *
 * Idempotent (running twice yields the same clean output) and tolerant (missing
 * core.xml/app.xml is skipped without error).
 */
export async function zeroTracePatch(docxPath: string): Promise<void> {
  const buf = await fsp.readFile(docxPath);
  const zip = await JSZip.loadAsync(buf);

  // (1) docProps/core.xml — blank the full identifying set + epoch timestamps.
  const coreEntry = zip.file('docProps/core.xml');
  if (coreEntry) {
    let core = await coreEntry.async('string');
    for (const tag of CORE_BLANK_TAGS) core = blankXmlTag(core, tag);
    core = epochDctermsTag(core, 'dcterms:created');
    core = epochDctermsTag(core, 'dcterms:modified');
    zip.file('docProps/core.xml', core, { date: EPOCH });
  }

  // (2) docProps/app.xml — blank the extended-property identifying fields.
  const appEntry = zip.file('docProps/app.xml');
  if (appEntry) {
    let app = await appEntry.async('string');
    for (const tag of APP_BLANK_TAGS) app = blankXmlTag(app, tag);
    zip.file('docProps/app.xml', app, { date: EPOCH });
  }

  // (3) Defense-in-depth sweep — strip the literal 'pensmith' from EVERY
  //     non-binary entry (incl. _rels/.rels, custom.xml, headers, any text
  //     part — NOT just *.xml). Binary parts pass through untouched.
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    let text: string;
    try {
      text = await file.async('string');
    } catch {
      // Unreadable as string → treat as binary, leave untouched.
      continue;
    }
    if (isBinaryDocxEntry(name, text)) continue;
    if (/pensmith/i.test(text)) {
      const swept = text.replace(/pensmith/gi, '');
      zip.file(name, swept, { date: EPOCH });
    }
  }

  const out = await zip.generateAsync({ type: 'nodebuffer' });
  await atomicWriteFile(docxPath, out);
}

// ---------------------------------------------------------------------------
// zeroTracePdf — PDF /Info clear + STRUCTURAL XMP-object delete (DONE-07 / T-06-04-02)
// ---------------------------------------------------------------------------

/**
 * zeroTracePdf — MANDATORY last step of every .pdf export (DONE-07, HIGH-C2-1).
 *
 * Loads `pdfPath` via pure-JS pdf-lib (no external engine), empties the /Info
 * document-info dictionary (Producer/Creator/Author/Title/Subject/Keywords),
 * and removes the XMP metadata stream STRUCTURALLY — capturing the catalog
 * /Metadata indirect ref and deleting the actual indirect stream OBJECT from the
 * context BEFORE save() (pdf-lib serializes ALL indirect objects regardless of
 * reachability, so deleting only the catalog reference leaves the <x:xmpmeta>
 * stream object in the context and save() still writes it — leaking BOTH
 * 'pensmith' AND the non-'pensmith' token 'Trace Sentinel'). Also drops the
 * catalog entry. Performs NO length-altering byte edits on the serialized PDF;
 * any literal-'pensmith' check is a READ-ONLY post-save assertion.
 *
 * Idempotent and tolerant: a PDF with no /Info or /Metadata is scrubbed without
 * error; never throws on a malformed-but-loadable PDF (other than the explicit
 * residual assertion, which signals an incomplete structural strip to fix).
 */
export async function zeroTracePdf(pdfPath: string): Promise<void> {
  const buf = await fsp.readFile(pdfPath);
  // updateMetadata:false → do NOT let pdf-lib re-inject its own Producer/ModDate.
  const pdf = await PDFDocument.load(buf, { updateMetadata: false });

  // Empty the /Info document-info dictionary.
  pdf.setTitle('');
  pdf.setAuthor('');
  pdf.setSubject('');
  pdf.setKeywords([]);
  pdf.setProducer('');
  pdf.setCreator('');
  // Normalize dates to the fixed epoch (determinism; not identifying trace).
  try {
    pdf.setCreationDate(EPOCH);
    pdf.setModificationDate(EPOCH);
  } catch {
    // Some pdf-lib builds may reject epoch dates — non-fatal, dates are not trace.
  }

  // Remove the XMP metadata stream STRUCTURALLY (THE HIGH-C2-1 fix).
  try {
    const metaRef = pdf.catalog.get(PDFName.of('Metadata'));
    if (metaRef) {
      // Delete the ACTUAL indirect stream object so save() cannot serialize it.
      pdf.context.delete(metaRef as Parameters<typeof pdf.context.delete>[0]);
      // Also drop the catalog entry.
      pdf.catalog.delete(PDFName.of('Metadata'));
    }
  } catch {
    // A PDF with no /Metadata (or an unusual catalog) → nothing to remove.
  }

  // updateFieldAppearances:false → no incidental form mutation. NO post-save
  // length-altering byte edit (that would shift xref offsets + /Length values
  // and corrupt the file).
  const bytes = await pdf.save({ updateFieldAppearances: false });
  const out = Buffer.from(bytes);

  // READ-ONLY defense-in-depth assertion: a residual 'pensmith' means the
  // structural strip is incomplete and must be FIXED — never byte-edited away.
  if (out.toString('latin1').toLowerCase().includes('pensmith')) {
    throw new Error(
      `zeroTracePdf: residual 'pensmith' after structural scrub of ${pdfPath} — ` +
        `the XMP/Info strip is incomplete (fix the structural removal, do NOT byte-edit)`,
    );
  }

  await atomicWriteFile(pdfPath, out);
}

// ---------------------------------------------------------------------------
// exportDraft — orchestration (DONE-06 + DONE-08 + per-format scrub wiring)
// ---------------------------------------------------------------------------

export type ExportFormat = 'docx' | 'pdf' | 'latex' | 'md';

export interface ExportOptions {
  /** Absolute (or cwd-relative) path to the source markdown draft. */
  inputPath: string;
  /** Override the export dir; defaults to `<paperDir>/export` (DISTINCT). */
  outputDir?: string;
  format: ExportFormat;
  /** Project root for paperDir() resolution. */
  paperRoot?: string;
  /** Injectable Pandoc-presence flag (deterministic tests); defaults to live probe. */
  pandocPresent?: boolean;
}

export interface ExportResult {
  outputPath: string;
  format: ExportFormat;
  pandocUsed: boolean;
  bibCopied: boolean;
  risCopied: boolean; // CITE-05 — CITATIONS.ris bundled alongside .bib
}

/**
 * Escape LaTeX-special characters in body text so a deterministic offline
 * md→tex conversion produces compilable output without a TeX toolchain.
 * Order matters: backslash first so the replacements we inject are not
 * re-escaped.
 */
function escapeLatex(s: string): string {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

/**
 * Deterministic OFFLINE markdown→LaTeX writer (MEDIUM-2). Produces a REAL .tex
 * artifact with NO Pandoc dependency and NO generator comment (no `% pensmith`,
 * no `% Generated by`), so CI (Pandoc-absent) emits + scans an actual .tex file.
 *
 * Minimal but valid: an ATX `# ` heading becomes the document title; `## `/`### `
 * become \section/\subsection; blank-line-separated blocks become paragraphs.
 * This is intentionally conservative — the contract is "a real, comment-free,
 * trace-free .tex artifact", not full Markdown fidelity (Pandoc handles the rich
 * path when present).
 */
function renderLatex(md: string): string {
  const lines = md.split(/\r?\n/);
  let title = '';
  const bodyParts: string[] = [];
  let para: string[] = [];

  const flushPara = (): void => {
    if (para.length > 0) {
      bodyParts.push(escapeLatex(para.join(' ').trim()));
      para = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#\s+/.test(line)) {
      flushPara();
      if (!title) title = line.replace(/^#\s+/, '').trim();
      else bodyParts.push(`\\section{${escapeLatex(line.replace(/^#\s+/, '').trim())}}`);
    } else if (/^##\s+/.test(line)) {
      flushPara();
      bodyParts.push(`\\section{${escapeLatex(line.replace(/^##\s+/, '').trim())}}`);
    } else if (/^###\s+/.test(line)) {
      flushPara();
      bodyParts.push(`\\subsection{${escapeLatex(line.replace(/^###\s+/, '').trim())}}`);
    } else if (line.trim() === '') {
      flushPara();
    } else {
      para.push(line);
    }
  }
  flushPara();

  const preamble = [
    '\\documentclass{article}',
    '\\usepackage[utf8]{inputenc}',
    title ? `\\title{${escapeLatex(title)}}` : '',
    '\\begin{document}',
    title ? '\\maketitle' : '',
  ]
    .filter((l) => l.length > 0)
    .join('\n');

  return `${preamble}\n\n${bodyParts.join('\n\n')}\n\n\\end{document}\n`;
}

/**
 * Single markdown-emit code path (used by both the format==='md' branch and the
 * Pandoc-absent fallback). Markdown is trace-free by construction — NO generator
 * comment is injected. Output goes into the distinct export dir via the
 * atomic-write chokepoint.
 */
async function writeMarkdown(md: string, outputPath: string): Promise<void> {
  await atomicWriteFile(outputPath, md);
}

/**
 * Build the Pandoc argv (array — never a shell string; T-06-04 command-injection
 * mitigation). Base args carry zero-trace metadata flags as defense-in-depth;
 * the in-process scrub is the actual guarantee.
 */
function buildPandocArgs(inputPath: string, outputPath: string, format: ExportFormat): string[] {
  const to = format === 'latex' ? 'latex' : format;
  const args = [
    inputPath,
    '--from', 'markdown',
    '--to', to,
    '--output', outputPath,
    '--metadata', 'title=',
    '--metadata', 'author=',
    '--metadata', 'date=',
  ];
  if (format === 'pdf') {
    args.push('--variable', 'pdfcreator=', '--variable', 'pdfproducer=', '--variable', 'pdfauthor=');
  }
  return args;
}

/**
 * exportDraft — orchestrate a single-format export (DONE-06 + DONE-08).
 *
 * Writes EVERY output into a DISTINCT export dir (default `<paperDir>/export`),
 * never `paperDir` itself — so an output never collides with the source
 * DRAFT.md/sections/CITATIONS.bib (MEDIUM-1). Behavior by format:
 *   - 'latex': deterministic OFFLINE md→tex writer (no Pandoc) → a REAL scanned
 *     .tex with NO generator comment. If Pandoc is present, the Pandoc latex
 *     path may be used, then any '% pensmith'/'% Generated' line is stripped.
 *   - 'md': single markdown-emit code path into the export dir.
 *   - 'docx'/'pdf' with Pandoc present: execFile pandoc with zero-trace flags,
 *     then the MANDATORY per-format scrub (zeroTracePatch / zeroTracePdf).
 *   - 'docx'/'pdf' with Pandoc (or the PDF engine) absent: md-only fallback +
 *     banner mentioning Pandoc; NEVER throws ENOENT.
 *
 * CITATIONS.bib is ALWAYS copied into the export dir (DONE-08) when the source
 * exists, guarded `bibSrc !== bibDst` (the distinct dir guarantees this is never
 * a same-path no-op).
 */
export async function exportDraft(opts: ExportOptions): Promise<ExportResult> {
  const { inputPath, format } = opts;
  const exportDir = opts.outputDir ?? join(paperDir(opts.paperRoot), 'export');
  await fsp.mkdir(exportDir, { recursive: true });

  const pandoc = opts.pandocPresent ?? isPandocPresent();
  const stem = basename(inputPath, extname(inputPath));

  let outputPath: string;
  let pandocUsed = false;

  if (format === 'latex') {
    // Deterministic OFFLINE md→tex — a real scanned artifact, no Pandoc needed.
    outputPath = join(exportDir, `${stem}.tex`);
    if (pandoc) {
      try {
        await execFileAsync('pandoc', buildPandocArgs(inputPath, outputPath, 'latex'), {
          timeout: 60_000,
        });
        // Defensively strip any generator/provenance comment line Pandoc emits.
        const tex = await fsp.readFile(outputPath, 'utf8');
        const cleaned = tex
          .split(/\r?\n/)
          .filter((l) => !/^\s*%\s*(pensmith|generated by)/i.test(l))
          .join('\n');
        await atomicWriteFile(outputPath, cleaned);
        pandocUsed = true;
      } catch {
        // Pandoc latex path failed — fall through to the offline writer.
        const md = await fsp.readFile(inputPath, 'utf8');
        await atomicWriteFile(outputPath, renderLatex(md));
      }
    } else {
      const md = await fsp.readFile(inputPath, 'utf8');
      await atomicWriteFile(outputPath, renderLatex(md));
    }
  } else if (format === 'md' || !pandoc) {
    // md-only path (explicit md request OR Pandoc-absent fallback for docx/pdf).
    if (!pandoc && format !== 'md') {
      process.stdout.write('pensmith export: Pandoc not found — markdown-only fallback.\n');
    }
    outputPath = join(exportDir, `${stem}.md`);
    const md = await fsp.readFile(inputPath, 'utf8');
    await writeMarkdown(md, outputPath);
  } else {
    // Pandoc present + format is docx/pdf.
    const ext = format === 'docx' ? 'docx' : 'pdf';
    outputPath = join(exportDir, `${stem}.${ext}`);
    try {
      await execFileAsync('pandoc', buildPandocArgs(inputPath, outputPath, format), {
        timeout: 60_000,
      });
      // MANDATORY per-format zero-trace scrub — the actual guarantee.
      if (format === 'docx') await zeroTracePatch(outputPath);
      else await zeroTracePdf(outputPath);
      pandocUsed = true;
    } catch {
      // A missing PDF engine (or any Pandoc failure) → md-only fallback, never throw.
      process.stdout.write(
        `pensmith export: ${format === 'pdf' ? 'PDF engine' : 'Pandoc'} not available — markdown-only fallback.\n`,
      );
      outputPath = join(exportDir, `${stem}.md`);
      const md = await fsp.readFile(inputPath, 'utf8');
      await writeMarkdown(md, outputPath);
      pandocUsed = false;
    }
  }

  // DONE-08 — copy CITATIONS.bib into the export dir (every path), guarded so it
  // is never a same-path no-op and never throws when the source bib is absent.
  let bibCopied = false;
  const bibSrc = join(paperDir(opts.paperRoot), 'CITATIONS.bib');
  const bibDst = join(exportDir, 'CITATIONS.bib');
  if (bibSrc !== bibDst && existsSync(bibSrc)) {
    await fsp.copyFile(bibSrc, bibDst);
    bibCopied = true;
  }

  // CITE-05 (DONE-08 extension): copy CITATIONS.ris into the export dir
  // alongside .bib. Same pattern as bibCopied — same-path guard + existsSync
  // guard so it never throws when the .ris is absent and never overwrites the
  // source. RIS is plain-text bibliographic data with NO pensmith fingerprint
  // (same zero-trace posture as .bib — no metadata to scrub).
  let risCopied = false;
  const risSrc = join(paperDir(opts.paperRoot), 'CITATIONS.ris');
  const risDst = join(exportDir, 'CITATIONS.ris');
  if (risSrc !== risDst && existsSync(risSrc)) {
    await fsp.copyFile(risSrc, risDst);
    risCopied = true;
  }

  return { outputPath, format, pandocUsed, bibCopied, risCopied };
}
