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
//
// Pandoc never reaches past the gate (review round 1): it runs with
// `--sandbox` (no file it is not given, no URL), the reader's
// `implicit_figures` is off and a Lua filter (`images.lua`) prints every image
// as its Markdown text — as the built-in writers do — because a PDF build
// fetches an image's URL even under `--sandbox`. Under sources-offline and
// --dry-run tectonic runs `--only-cached` (no bundle download). Every PDF gets
// a header for the engine (pdfEngineHeader): pdfLaTeX the declarations of the
// document's characters its set-up cannot print (β, ≥ and ₂ stopped it); a
// XeTeX-family engine the shipped Liberation Serif as the main font (pandoc's
// default Latin Modern has no Greek or math symbols) and `?` for each
// character that font lacks — the exporter names those characters.

import { execFile, execFileSync } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { atomicWriteFile } from '../atomic-write.js';
import { caseProtectItems, cslStyleText } from '../citations.js';
import { networkMode } from '../http-mock.js';
import { pluginTemplatePath } from '../paths.js';
import { declarePdfTexCharacters, pdfTexDeclarations, pdfTexUnprintable } from './latex-writer.js';
import { foldCandidates, pdfFontHas, PDF_FONT_FILES } from './glyphs.js';

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
  /** The engine's header (format `pdf`): pdfEngineHeader(engine, chars). */
  readonly pdfHeader?: PdfEngineHeader;
}

/** A XeTeX-family engine (fontspec): the main font can be set. */
function isUnicodeEngine(engine: string): boolean {
  return engine === 'xelatex' || engine === 'lualatex' || engine === 'tectonic';
}

/** What a PDF engine's header does for a document's characters. */
export interface PdfEngineHeader {
  /** The LaTeX passed with `--include-in-header`. */
  readonly tex: string;
  /** True when the shipped fonts are copied next to the input (a XeTeX-family engine). */
  readonly fonts: boolean;
  /** The document's characters the PDF prints as `?`. */
  readonly unprintable: readonly string[];
}

/** An active character that prints `to` (XeTeX / LuaTeX: a character is one token). */
function activeChar(ch: string, to: string): string {
  return `\\begingroup\\lccode\`\\~=\`${ch}\\lowercase{\\endgroup\\def~{${to}}}\\catcode\`${ch}=\\active`;
}

/**
 * The header for `engine` and the characters the document prints (see the
 * module header). pdfLaTeX: a declaration for each character its set-up
 * cannot print. A XeTeX-family engine: Liberation Serif (copied next to the
 * input, `Path=./`), and each character it lacks folded or printed as `?`.
 */
export function pdfEngineHeader(engine: string, chars: Iterable<string>): PdfEngineHeader {
  const all = [...new Set(chars)];
  if (!isUnicodeEngine(engine)) {
    const decl = pdfTexDeclarations(all);
    return { tex: decl.length > 0 ? `${decl.join('\n')}\n` : '', fonts: false, unprintable: pdfTexUnprintable(all) };
  }
  const has = pdfFontHas();
  const lines = [
    `\\setmainfont[Path=./,BoldFont=${PDF_FONT_FILES.bold},ItalicFont=${PDF_FONT_FILES.italic},BoldItalicFont=${PDF_FONT_FILES.boldItalic}]{${PDF_FONT_FILES.regular}}`,
  ];
  const unprintable: string[] = [];
  for (const ch of all.sort()) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80 || has(cp)) continue;
    const fold = foldCandidates(ch).find((f) => [...f].every((c) => has(c.codePointAt(0) as number) && !/[\\{}$&#^_%~]/.test(c)));
    if (fold === undefined) unprintable.push(ch);
    lines.push(activeChar(ch, fold ?? '?'));
  }
  return { tex: `${lines.join('\n')}\n`, fonts: true, unprintable };
}

/** The pandoc argv for an input (relative names only). */
export function pandocArgs(input: PandocInput): string[] {
  const ext = input.format === 'latex' ? 'tex' : input.format;
  const args = [
    'input.md',
    // No file or URL pandoc is not given (a draft's image, an include).
    '--sandbox',
    '--from', 'markdown-yaml_metadata_block-raw_attribute-raw_tex-implicit_figures',
    '--to', input.format === 'pdf' ? 'latex' : input.format,
    '--output', `out.${ext}`,
    // Every image printed as its Markdown text: a PDF build fetches an image even under --sandbox.
    '--lua-filter', 'images.lua',
  ];
  if (input.format === 'latex' || input.format === 'pdf') args.push('--shift-heading-level-by=-1');
  if (input.format === 'latex') args.push('--standalone');
  if (input.format === 'pdf') {
    const engine = input.pdfEngine ?? 'pdflatex';
    args.push(`--pdf-engine=${engine}`, '--variable', 'pdfcreator=', '--variable', 'pdfproducer=', '--variable', 'pdfauthor=');
    if (input.pdfHeader !== undefined && input.pdfHeader.tex !== '') args.push('--include-in-header', 'header.tex');
    // No bundle download while sources are offline or under --dry-run (zero sockets).
    const mode = networkMode();
    if (engine === 'tectonic' && (mode.sourcesOffline || mode.dryRun)) args.push('--pdf-engine-opt=--only-cached');
  }
  if (input.citations !== null) {
    args.push('--citeproc', '--csl', 'style.csl', '--bibliography', 'references.json');
    if (input.citations.referencesTitle === null) args.push('--metadata', 'suppress-bibliography=true');
  }
  return args;
}

/**
 * The Lua filter that prints every image as its Markdown text (`![alt](src)`):
 * pandoc never fetches or embeds a file or URL, and its output matches the
 * built-in writers', which write an image as text too.
 */
const IMAGES_LUA = `function Image(el)
  local title = ''
  if el.title ~= '' then title = ' "' .. el.title .. '"' end
  return pandoc.Str('![' .. pandoc.utils.stringify(el.caption) .. '](' .. el.src .. title .. ')')
end
`;

/**
 * Why a pandoc run failed, in one line: the TeX error (`! …` and its `l.<n>`
 * line) or pandoc's own last error line from its stderr — never its argv.
 */
export function pandocFailure(e: unknown): string {
  const stderr = typeof (e as { stderr?: unknown }).stderr === 'string' ? ((e as { stderr: string }).stderr) : '';
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  const bang = lines.findIndex((l) => l.startsWith('! '));
  let why: string;
  if (bang !== -1) {
    const at = lines.slice(bang + 1).find((l) => /^l\.\d+/.test(l));
    why = `${lines[bang]}${at !== undefined ? ` (${at})` : ''}`;
  } else {
    why = lines.filter((l) => !/^\[WARNING\]/.test(l)).pop() ?? '';
  }
  if (why === '') {
    const msg = e instanceof Error ? e.message : String(e);
    why = msg.startsWith('Command failed:') ? 'pandoc exited with an error and printed no reason' : (msg.split('\n')[0] ?? msg);
  }
  return why.length > 200 ? `${why.slice(0, 200)}…` : why;
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
    await atomicWriteFile(join(dir, 'images.lua'), IMAGES_LUA);
    if (input.format === 'pdf' && input.pdfHeader !== undefined) {
      if (input.pdfHeader.tex !== '') await atomicWriteFile(join(dir, 'header.tex'), input.pdfHeader.tex);
      if (input.pdfHeader.fonts) {
        for (const f of Object.values(PDF_FONT_FILES)) await fsp.copyFile(pluginTemplatePath('fonts', f), join(dir, f));
      }
    }
    const ext = input.format === 'latex' ? 'tex' : input.format;
    await execFileAsync('pandoc', pandocArgs(input), { cwd: dir, timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
    return await fsp.readFile(join(dir, `out.${ext}`));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/**
 * The scrub of a pandoc .tex (D-21-08): the hyperref setup's creator and
 * producer (`pdfcreator={LaTeX via pandoc}`) emptied, any comment line that
 * names a generator removed, and the characters pdfLaTeX cannot print
 * declared (latex-writer.ts declarePdfTexCharacters) so it compiles under
 * pdfLaTeX as under XeTeX (D-21-10).
 */
export function scrubPandocLatex(tex: string): string {
  return declarePdfTexCharacters(tex)
    .replace(/\b(pdfcreator|pdfproducer|pdfauthor)=\{[^{}]*\}/g, '$1={}')
    .split(/\r?\n/)
    .filter((l) => !/^\s*%.*\b(pensmith|generated by|pandoc)\b/i.test(l))
    .join('\n');
}
