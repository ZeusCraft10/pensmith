// bin/lib/export/pandoc.ts — the pandoc path of docx, PDF and LaTeX exports
// (EXP-06, D-21-02, D-21-09).
//
// Pandoc runs blind: in a fresh temporary directory as its working directory,
// with only relative, neutral names in its argv — `input.md` (the gated text),
// `references.json` (the cited entries as CSL JSON, case-protected exactly as
// the built-in renderer reads them, D-21-06: pandoc's BibTeX reader would
// sentence-case every title and lowercase "China"), `style.csl` (a copy of the
// resolved style, a bundled key's or the user's file, D-21-07) and
// `out.<ext>` — so nothing pandoc records (docProps/custom.xml, the PDF's
// /Info, a LaTeX comment) can hold a local path. The output's bytes are read
// back and the temporary directory removed; the exporter writes them into
// export/, scrubs them (zero-trace.ts) and scans them.
//
// The reader stays `markdown-yaml_metadata_block-raw_attribute-raw_tex`
// (VRFY-10 defence in depth: a YAML block, raw `{=format}` output or raw TeX in
// the text is read as text). The bibliography follows an explicit unnumbered
// `## References` (or `## Bibliography`) heading and a `#refs` div, so it is a
// level-2 heading like the sections on every writer; LaTeX and PDF shift
// headings up one level (`--shift-heading-level-by=-1`: the paper's `# title`
// becomes `\title`) and LaTeX is `--standalone` (its template defines the
// citeproc macros). A PDF needs an engine — pdflatex, xelatex, lualatex or
// tectonic, the first one found on PATH; without one the exporter uses the
// built-in PDF writer and says so.

import { execFile, execFileSync } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { atomicWriteFile } from '../atomic-write.js';
import { caseProtectItems, cslStyleText } from '../citations.js';

const execFileAsync = promisify(execFile);

/** The PDF engines pandoc can drive, in the order they are tried. */
export const PDF_ENGINES = ['pdflatex', 'xelatex', 'lualatex', 'tectonic'] as const;

/** The first PDF engine on PATH that answers `--version`, or null. */
export function detectPdfEngine(): string | null {
  for (const engine of PDF_ENGINES) {
    try {
      execFileSync(engine, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
      return engine;
    } catch {
      /* not installed */
    }
  }
  return null;
}

/** What a pandoc run needs. */
export interface PandocInput {
  /** The gated text. */
  readonly text: string;
  readonly format: 'docx' | 'pdf' | 'latex';
  /** The cited entries (parsed CSL-JSON) and the style, or null to render no citations. */
  readonly citations: { readonly entries: ReadonlyArray<Record<string, unknown>>; readonly style: string; readonly referencesTitle: string | null } | null;
  /** The PDF engine (format `pdf`). */
  readonly pdfEngine?: string;
}

/** The pandoc argv for an input (relative names only). */
export function pandocArgs(input: PandocInput): string[] {
  const ext = input.format === 'latex' ? 'tex' : input.format;
  const args = [
    'input.md',
    '--from', 'markdown-yaml_metadata_block-raw_attribute-raw_tex',
    '--to', input.format === 'pdf' ? 'latex' : input.format,
    '--output', `out.${ext}`,
  ];
  if (input.format === 'latex' || input.format === 'pdf') args.push('--shift-heading-level-by=-1');
  if (input.format === 'latex') args.push('--standalone');
  if (input.format === 'pdf') {
    args.push(`--pdf-engine=${input.pdfEngine ?? 'pdflatex'}`, '--variable', 'pdfcreator=', '--variable', 'pdfproducer=', '--variable', 'pdfauthor=');
  }
  if (input.citations !== null) {
    args.push('--citeproc', '--csl', 'style.csl', '--bibliography', 'references.json');
    if (input.citations.referencesTitle === null) args.push('--metadata', 'suppress-bibliography=true');
  }
  return args;
}

/** Run pandoc on `input` in a fresh temporary directory and return the output's bytes. Throws on a pandoc failure. */
export async function runPandoc(input: PandocInput): Promise<Buffer> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), 'pensmith-export-'));
  try {
    let text = input.text.replace(/\s+$/u, '');
    if (input.citations !== null) {
      await atomicWriteFile(join(dir, 'references.json'), JSON.stringify(caseProtectItems(input.citations.entries), null, 1));
      await atomicWriteFile(join(dir, 'style.csl'), cslStyleText(input.citations.style));
      if (input.citations.referencesTitle !== null) {
        text += `\n\n## ${input.citations.referencesTitle} {.unnumbered}\n\n::: {#refs}\n:::`;
      }
    }
    await atomicWriteFile(join(dir, 'input.md'), `${text}\n`);
    const ext = input.format === 'latex' ? 'tex' : input.format;
    await execFileAsync('pandoc', pandocArgs(input), { cwd: dir, timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
    return await fsp.readFile(join(dir, `out.${ext}`));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/**
 * The scrub of a pandoc .tex (D-21-08): the hyperref setup's creator and
 * producer (`pdfcreator={LaTeX via pandoc}`) emptied, and any comment line
 * that names a generator removed.
 */
export function scrubPandocLatex(tex: string): string {
  return tex
    .replace(/\b(pdfcreator|pdfproducer|pdfauthor)=\{[^{}]*\}/g, '$1={}')
    .split(/\r?\n/)
    .filter((l) => !/^\s*%.*\b(pensmith|generated by|pandoc)\b/i.test(l))
    .join('\n');
}
