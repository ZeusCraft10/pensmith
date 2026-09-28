// bin/lib/pymupdf-shellout.ts — RSCH-05b graceful-absent PyMuPDF subprocess
// wrapper (SWP-59 / SRC-15 hardening, D-19-22).
//
// =====================================================================
//   When it runs
// =====================================================================
// bin/lib/pdf-text.ts calls pymupdfExtract when pdf-parse THROWS or returns
// near-empty text (the image-only / scanned-PDF heuristic). PyMuPDF often
// reads PDFs the 2018 PDF.js fork inside pdf-parse cannot.
//
// =====================================================================
//   Graceful-absent is the DESIGNED path (not an error case)
// =====================================================================
// On ANY failure — no Python interpreter (ENOENT), PyMuPDF not installed (the
// import fails, non-zero exit), a timeout, an unreadable result — this module
// returns `null` and NEVER throws. The caller treats `null` as "PyMuPDF
// unavailable".
//
// =====================================================================
//   The text never comes from stdout (SWP-59)
// =====================================================================
// Current PyMuPDF prints a deprecation warning to STDOUT when imported as
// `fitz`, and interpreters print warnings on stderr; the old wrapper returned
// stdout as the PDF's text, so a warning could become a "title". The script
// now imports `pymupdf` (falling back to `fitz` only on releases older than
// 1.24.3, which lack the `pymupdf` name) and writes its answer — each page's
// text, the page count and the document metadata — as JSON to a RESULT FILE
// whose path it is given. stdout and stderr are ignored entirely.
//
// =====================================================================
//   No shell-injection surface (T-08-03-01)
// =====================================================================
// `execFile` with an ARGS ARRAY — no shell. The script is a constant written
// to a file; it and the two paths it needs (the PDF and the result file) are
// passed as argv entries, all generated here inside a fresh private temp
// directory (never user input). The untrusted PDF BYTES go to disk in that
// directory, never to the command line.
//
// =====================================================================
//   Resource hygiene (T-08-03-02 / T-08-03-06)
// =====================================================================
// - a 15 s timeout and a 1 MB stdout/stderr buffer bound a runaway interpreter;
//   either → caught → next candidate / null;
// - the result file is read only up to MAX_RESULT_BYTES;
// - the temp directory (PDF + result) is ALWAYS removed in a `finally`.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { atomicWriteFile } from './atomic-write.js';

const execFileAsync = promisify(execFile);

/** Hard ceiling on the PyMuPDF subprocess; a hung interpreter is caught -> null. */
const PYMUPDF_TIMEOUT_MS = 15_000;

/** Cap on captured stdout/stderr (both are discarded; the cap only bounds memory). */
const PYMUPDF_MAX_BUFFER = 1024 * 1024;

/** Cap on the JSON result file read back. */
const MAX_RESULT_BYTES = 64 * 1024 * 1024;

/**
 * The extraction script (a constant, written to `extract.py` in the private
 * temp directory). argv[1] = the PDF, argv[2] = the result file. Imports
 * `pymupdf`, falling back to `fitz` only when that name is missing
 * (PyMuPDF < 1.24.3).
 */
export const PYMUPDF_SCRIPT = [
  'import sys, json',
  'try:',
  '    import pymupdf',
  'except ImportError:',
  '    import fitz as pymupdf',
  'doc = pymupdf.open(sys.argv[1])',
  'pages = [page.get_text() for page in doc]',
  'meta = doc.metadata or {}',
  'out = {"pages": pages, "numpages": len(pages), "metadata": {k: v for k, v in meta.items() if isinstance(v, str) and v}}',
  'with open(sys.argv[2], "w", encoding="utf-8") as f:',
  '    json.dump(out, f)',
].join('\n');

/**
 * Candidate Python interpreters to try, in order. `PENSMITH_PYTHON` (when set)
 * is the SOLE candidate — tests point it at a nonexistent path to force the
 * ENOENT/null degradation path; operators on exotic setups use it to pin one.
 *
 * Without an override we try the common interpreter names (audit #37): on
 * Windows `python3` is usually absent and the real interpreter is `python` or
 * the `py` launcher, so Windows tries those FIRST.
 */
export function pythonCandidates(): string[] {
  const override = process.env.PENSMITH_PYTHON;
  if (typeof override === 'string' && override.length > 0) return [override];
  return process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
}

/** What PyMuPDF extracted. */
export interface PymupdfResult {
  /** Every page's text, each preceded by a blank line (pdf-parse's layout). */
  readonly text: string;
  readonly pages: readonly string[];
  readonly numpages: number;
  /** PyMuPDF's document metadata mapped onto PDF Info keys (Title, Author, Subject, Keywords, …). */
  readonly info: Readonly<Record<string, string>>;
}

const META_TO_INFO: Readonly<Record<string, string>> = {
  title: 'Title',
  author: 'Author',
  subject: 'Subject',
  keywords: 'Keywords',
  creator: 'Creator',
  producer: 'Producer',
  creationDate: 'CreationDate',
  modDate: 'ModDate',
};

/** The result file's JSON, validated; null when it is not the script's shape. */
function readResult(raw: string): PymupdfResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = parsed as { pages?: unknown; numpages?: unknown; metadata?: unknown };
  if (!Array.isArray(o.pages) || !o.pages.every((p) => typeof p === 'string')) return null;
  const pages = o.pages as string[];
  const info: Record<string, string> = {};
  if (o.metadata && typeof o.metadata === 'object') {
    for (const [k, v] of Object.entries(o.metadata as Record<string, unknown>)) {
      const key = META_TO_INFO[k];
      if (key && typeof v === 'string' && v.trim()) info[key] = v;
    }
  }
  return {
    text: pages.map((p) => `\n\n${p}`).join(''),
    pages,
    numpages: typeof o.numpages === 'number' ? o.numpages : pages.length,
    info,
  };
}

/**
 * Extract a PDF with PyMuPDF. Returns null (never throws) when no interpreter
 * with PyMuPDF is available or the extraction fails. See the header.
 */
export async function pymupdfExtract(buf: Buffer | Uint8Array): Promise<PymupdfResult | null> {
  let dir: string | null = null;
  try {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pensmith-pymupdf-'));
    const pdfPath = path.join(dir, 'input.pdf');
    const resultPath = path.join(dir, 'result.json');
    // The script runs from a file (a multi-line `-c` argument is fragile on
    // Windows command lines). Both writes go through the D-07 atomic-write
    // chokepoint (raw fs.writeFile is banned outside it).
    const scriptPath = path.join(dir, 'extract.py');
    await atomicWriteFile(scriptPath, `${PYMUPDF_SCRIPT}\n`);
    await atomicWriteFile(pdfPath, Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
    for (const bin of pythonCandidates()) {
      try {
        await fs.promises.rm(resultPath, { force: true });
        await execFileAsync(bin, [scriptPath, pdfPath, resultPath], {
          timeout: PYMUPDF_TIMEOUT_MS,
          maxBuffer: PYMUPDF_MAX_BUFFER,
          windowsHide: true,
        });
        const stat = await fs.promises.stat(resultPath);
        if (stat.size > MAX_RESULT_BYTES) return null;
        const result = readResult(await fs.promises.readFile(resultPath, 'utf8'));
        if (result !== null) return result;
      } catch {
        // This interpreter is absent, lacks PyMuPDF, timed out, or could not
        // read the PDF — try the next candidate.
      }
    }
    return null;
  } catch {
    // A failure OUTSIDE the per-interpreter loop (e.g. the temp directory).
    return null;
  } finally {
    if (dir !== null) await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The text-only view of pymupdfExtract (RSCH-05b contract): the extracted
 * text, or null when PyMuPDF is unavailable, failed, or found no text.
 */
export async function pymupdfShellout(buf: Buffer | Uint8Array): Promise<string | null> {
  const r = await pymupdfExtract(buf);
  return r !== null && r.text.trim().length > 0 ? r.text : null;
}
