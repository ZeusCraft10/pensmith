// bin/lib/export/latex-writer.ts — the built-in LaTeX writer (EXP-09, D-21-10).
//
// Used when pandoc is not on PATH (and when a pandoc run fails). It writes a
// standalone `article` document that compiles under pdfLaTeX and under XeTeX /
// LuaTeX (tectonic included), loading only packages every TeX distribution
// ships: `iftex` (to choose the font set-up for the engine), `fontenc` +
// `inputenc` + `textcomp` under pdfTeX or `fontspec` under XeTeX / LuaTeX, and
// `hyperref`. The paper's `# title` is `\title`, its `## sections` are
// `\section`s (unnumbered: `secnumdepth` 0), every special character is
// escaped, notes are `\footnote`s, superscripts `\textsuperscript`, small caps
// `\textsc`, block quotes `quote`, lists `itemize` / `enumerate`, code
// `verbatim` / `\texttt`, pipe tables `tabular` with wrapped columns, and the
// bibliography an unnumbered section of hanging paragraphs. No generator
// comment, no metadata (D-21-08). The product never needs a TeX engine; the
// tests compile the output when one is installed (tests/latex-standalone.test.ts).

import type { Block, Inline, ListStyle } from './markdown.js';
import type { ExportDocument } from './document.js';
import { foldCandidates } from './glyphs.js';

/** Characters pdfLaTeX's T1 / utf8 set-up cannot print, as text-mode commands. */
const LATEX_CHARS: Readonly<Record<string, string>> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '&': '\\&',
  '#': '\\#',
  '^': '\\textasciicircum{}',
  _: '\\_',
  '%': '\\%',
  '~': '\\textasciitilde{}',
  '<': '\\textless{}',
  '>': '\\textgreater{}',
  '|': '\\textbar{}',
  '"': '\\textquotedbl{}',
  '\u00a0': '~',
  '\u2009': '\\,',
  '…': '\\ldots{}',
  '•': '\\textbullet{}',
  '€': '\\texteuro{}',
  '†': '\\textdagger{}',
  '‡': '\\textdaggerdbl{}',
  '™': '\\texttrademark{}',
  '≤': '\\ensuremath{\\leq}',
  '≥': '\\ensuremath{\\geq}',
  '≠': '\\ensuremath{\\neq}',
  '≈': '\\ensuremath{\\approx}',
  '±': '\\ensuremath{\\pm}',
  '×': '\\ensuremath{\\times}',
  '÷': '\\ensuremath{\\div}',
  '∞': '\\ensuremath{\\infty}',
  '→': '\\ensuremath{\\rightarrow}',
  '←': '\\ensuremath{\\leftarrow}',
  '√': '\\ensuremath{\\surd}',
  'µ': '\\ensuremath{\\mu}',
  '′': '\\ensuremath{\\prime}',
  '−': '\\ensuremath{-}',
};

/** Greek letters (pdfLaTeX has no text Greek in T1) as math commands. */
const GREEK: ReadonlyArray<[string, string]> = [
  ['α', 'alpha'], ['β', 'beta'], ['γ', 'gamma'], ['δ', 'delta'], ['ε', 'epsilon'], ['ζ', 'zeta'], ['η', 'eta'], ['θ', 'theta'],
  ['ι', 'iota'], ['κ', 'kappa'], ['λ', 'lambda'], ['μ', 'mu'], ['ν', 'nu'], ['ξ', 'xi'], ['π', 'pi'], ['ρ', 'rho'], ['σ', 'sigma'],
  ['ς', 'varsigma'], ['τ', 'tau'], ['υ', 'upsilon'], ['φ', 'phi'], ['χ', 'chi'], ['ψ', 'psi'], ['ω', 'omega'], ['Γ', 'Gamma'],
  ['Δ', 'Delta'], ['Θ', 'Theta'], ['Λ', 'Lambda'], ['Ξ', 'Xi'], ['Π', 'Pi'], ['Σ', 'Sigma'], ['Υ', 'Upsilon'], ['Φ', 'Phi'],
  ['Ψ', 'Psi'], ['Ω', 'Omega'],
];
const GREEK_MAP: Readonly<Record<string, string>> = Object.fromEntries(GREEK.map(([c, n]) => [c, `\\ensuremath{\\${n}}`]));

const SUB_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
const SUP_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** True for a character pdfLaTeX's T1 / utf8 / textcomp set-up prints without a declaration. */
export function pdfTexKnows(ch: string): boolean {
  const cp = ch.codePointAt(0) as number;
  return cp < 0x0180 || '–—‘’“”‚„‹›«»·°§¶©®'.includes(ch);
}

/**
 * A spelling every engine prints for a character pdfLaTeX's set-up has no
 * declaration for, or null: Greek and the common symbols as math, sub- and
 * superscript digits as `\textsubscript` / `\textsuperscript`, other spaces as
 * a thin space, and a fold (glyphs.ts foldCandidates: the non-breaking hyphen
 * to a hyphen, a ligature to its letters) when its characters are printable.
 */
export function latexCharFor(ch: string): string | null {
  const mapped = GREEK_MAP[ch] ?? (LATEX_CHARS[ch]?.startsWith('\\ensuremath') === true ? LATEX_CHARS[ch] : undefined);
  if (mapped !== undefined) return mapped;
  const sub = SUB_DIGITS.indexOf(ch);
  if (sub !== -1) return `\\textsubscript{${sub}}`;
  const sup = SUP_DIGITS.indexOf(ch);
  if (sup !== -1) return `\\textsuperscript{${sup}}`;
  for (const f of foldCandidates(ch)) {
    if (f === '') return '{}';
    if (f === ' ') return '\\,';
    if ([...f].every((c) => pdfTexKnows(c) || LATEX_CHARS[c] !== undefined || GREEK_MAP[c] !== undefined)) {
      return [...f].map((c) => LATEX_CHARS[c] ?? GREEK_MAP[c] ?? c).join('');
    }
  }
  return null;
}

/** The characters of `chars` that pdfLaTeX prints as `?` (latexCharFor has no spelling for them). */
export function pdfTexUnprintable(chars: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const ch of chars) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x20 || pdfTexKnows(ch) || LATEX_CHARS[ch] !== undefined || GREEK_MAP[ch] !== undefined) continue;
    if (latexCharFor(ch) === null) out.add(ch);
  }
  return [...out].sort();
}

/**
 * Text escaped for LaTeX: the ten specials, characters the T1 set-up cannot
 * print as commands, Greek as math, latexCharFor's spellings, and every other
 * character outside Latin-1, Latin Extended-A and the T1 / textcomp
 * punctuation as `\textfallback{?}{<char>}`: the character itself under XeTeX
 * / LuaTeX, a `?` under pdfLaTeX (which has no glyph for it and would stop on
 * it) — the exporter names those characters in a note.
 */
export function escapeLatex(s: string): string {
  let out = '';
  for (const ch of s) {
    const mapped = LATEX_CHARS[ch] ?? GREEK_MAP[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x20) {
      out += cp === 0x09 ? ' ' : '';
      continue;
    }
    // Latin-1, Latin Extended-A, and the typographic punctuation T1 + textcomp know.
    if (pdfTexKnows(ch)) {
      out += ch;
      continue;
    }
    out += latexCharFor(ch) ?? `\\textfallback{?}{${ch}}`;
  }
  // A line that would start with `[` after a \\ or \item would be read as an optional argument.
  return out.replace(/\[/g, '{[}').replace(/\]/g, '{]}');
}

/**
 * The `\DeclareUnicodeCharacter` lines for the characters of `chars` pdfLaTeX
 * cannot print — latexCharFor's spelling, else `?` (the exporter names those).
 */
export function pdfTexDeclarations(chars: Iterable<string>): string[] {
  const todo = [...new Set([...chars].filter((ch) => (ch.codePointAt(0) as number) >= 0x20 && !pdfTexKnows(ch)))].sort();
  return todo.map((ch) => {
    const code = (ch.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0');
    return `  \\DeclareUnicodeCharacter{${code}}{${latexCharFor(ch) ?? '?'}}`;
  });
}

/**
 * pandoc's standalone LaTeX for pdfLaTeX (the scrub of the pandoc path,
 * export/pandoc.ts): pandoc writes every character as it is, and pdfLaTeX
 * stops on one its T1 / utf8 set-up has no declaration for (`α`). Each such
 * character of the document gets a `\DeclareUnicodeCharacter` under
 * `\ifPDFTeX` — Greek and the common symbols as math, anything else as
 * `?` — so the file compiles under pdfLaTeX as under XeTeX / LuaTeX, which
 * print the characters themselves.
 */
export function declarePdfTexCharacters(tex: string): string {
  const at = tex.indexOf('\\begin{document}');
  if (at === -1) return tex;
  const decl = pdfTexDeclarations(tex.slice(at));
  if (decl.length === 0) return tex;
  return `${tex.slice(0, at)}\\ifPDFTeX\n${decl.join('\n')}\n\\fi\n${tex.slice(at)}`;
}

/**
 * Where a note is written: `inline` as `\footnote{…}` (body text), `none` not
 * at all (inside a note, and a heading's short title), or `mark` as
 * `\footnotemark` with the note's number added to `marks` (a table cell — a
 * `\footnote` there is swallowed — or a heading, whose `\footnotetext` follows
 * it).
 */
type NoteMode = { readonly kind: 'inline' } | { readonly kind: 'none' } | { readonly kind: 'mark'; readonly marks: number[] };

const INLINE_NOTE: NoteMode = { kind: 'inline' };
const NO_NOTE: NoteMode = { kind: 'none' };

/** `\footnotetext` lines for the notes a table or heading marked. */
function footnoteTexts(marks: readonly number[], notes: ReadonlyArray<readonly Inline[]>): string {
  return marks.map((n) => `\\footnotetext[${n}]{${inlinesTex(notes[n - 1] ?? [], notes, NO_NOTE)}}`).join('\n');
}

function inlinesTex(nodes: readonly Inline[], notes: ReadonlyArray<readonly Inline[]>, mode: NoteMode = INLINE_NOTE): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text':
          return escapeLatex(n.text);
        case 'code':
          return `\\texttt{${escapeLatex(n.text)}}`;
        case 'break':
          return '\\\\\n';
        case 'note':
          if (mode.kind === 'none') return '';
          if (mode.kind === 'mark') {
            mode.marks.push(n.n);
            return '\\footnotemark{}';
          }
          return `\\footnote{${inlinesTex(notes[n.n - 1] ?? [], notes, NO_NOTE)}}`;
        case 'emph':
          return `\\emph{${inlinesTex(n.children, notes, mode)}}`;
        case 'strong':
          return `\\textbf{${inlinesTex(n.children, notes, mode)}}`;
        case 'strike':
          return inlinesTex(n.children, notes, mode);
        case 'sup':
          return `\\textsuperscript{${inlinesTex(n.children, notes, mode)}}`;
        case 'sub':
          return `\\textsubscript{${inlinesTex(n.children, notes, mode)}}`;
        case 'smallcaps':
          return `\\textsc{${inlinesTex(n.children, notes, mode)}}`;
        case 'link':
          if (!/^[a-z][a-z0-9+.-]*:/i.test(n.href)) return inlinesTex(n.children, notes, mode);
          return `\\href{${n.href.replace(/[\\{}%#~^&_$]/g, (c) => `\\${c}`)}}{${inlinesTex(n.children, notes, mode)}}`;
        default:
          return '';
      }
    })
    .join('');
}

const ENUM_COUNTERS = ['enumi', 'enumii', 'enumiii', 'enumiv'];
const ENUM_FORMAT: Readonly<Record<ListStyle, string>> = {
  decimal: '\\arabic',
  'lower-alpha': '\\alph',
  'upper-alpha': '\\Alph',
  'lower-roman': '\\roman',
  'upper-roman': '\\Roman',
};

function blocksTex(blocks: readonly Block[], notes: ReadonlyArray<readonly Inline[]>, depth = 0): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.t) {
      case 'heading': {
        const cmd = ['section', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'][Math.min(b.level, 6) - 1] as string;
        // A note in a heading: `\footnotemark` in the heading (a `\footnote`
        // in a moving argument stops pdfLaTeX), a short title without it for
        // the bookmarks, and the note's `\footnotetext` after the heading.
        const marks: number[] = [];
        const title = inlinesTex(b.children, notes, { kind: 'mark', marks });
        if (marks.length === 0) out.push(`\\${cmd}{${title}}`);
        else out.push(`\\${cmd}[${inlinesTex(b.children, notes, NO_NOTE)}]{${title}}\n${footnoteTexts(marks, notes)}`);
        break;
      }
      case 'para':
      case 'plain':
        out.push(inlinesTex(b.children, notes));
        break;
      case 'quote':
        out.push(`\\begin{quote}\n${blocksTex(b.blocks, notes, depth)}\n\\end{quote}`);
        break;
      case 'bullets':
        out.push(`\\begin{itemize}\n${b.items.map((it) => `\\item ${blocksTex(it, notes, depth + 1)}`).join('\n')}\n\\end{itemize}`);
        break;
      case 'ordered': {
        const counter = ENUM_COUNTERS[Math.min(depth, 3)] as string;
        const setup =
          `\\renewcommand{\\the${counter}}{${ENUM_FORMAT[b.style]}{${counter}}}` +
          `\\renewcommand{\\label${counter}}{\\the${counter}.}` +
          (b.start !== 1 ? `\\setcounter{${counter}}{${b.start - 1}}` : '');
        out.push(`\\begin{enumerate}${setup}\n${b.items.map((it) => `\\item ${blocksTex(it, notes, depth + 1)}`).join('\n')}\n\\end{enumerate}`);
        break;
      }
      case 'code':
        out.push(`\\begin{verbatim}\n${b.text.replace(/\\end\{verbatim\}/g, '\\end {verbatim}')}\n\\end{verbatim}`);
        break;
      case 'hr':
        out.push('\\begin{center}\\rule{0.5\\linewidth}{0.5pt}\\end{center}');
        break;
      case 'table': {
        const cols = Math.max(b.head.length, 1);
        const w = (0.96 / cols).toFixed(3);
        const align = (a: string): string => (a === 'center' ? '\\centering' : a === 'right' ? '\\raggedleft' : '\\raggedright');
        const spec = b.aligns.map((a) => `>{${align(a)}\\arraybackslash}p{${w}\\linewidth}`).join('');
        // A note in a cell: `\footnotemark` there (a `\footnote` inside a
        // tabular is swallowed) and its `\footnotetext` after the table.
        const marks: number[] = [];
        const mode: NoteMode = { kind: 'mark', marks };
        const row = (cells: ReadonlyArray<readonly Inline[]>, bold: boolean): string =>
          cells.map((c) => (bold ? `\\textbf{${inlinesTex(c, notes, mode)}}` : inlinesTex(c, notes, mode))).join(' & ') + ' \\\\';
        const tabular = `\\begin{center}\n\\begin{tabular}{${spec}}\n\\hline\n${row(b.head, true)}\n\\hline\n${b.rows.map((r) => row(r, false)).join('\n')}\n\\hline\n\\end{tabular}\n\\end{center}`;
        out.push(marks.length === 0 ? tabular : `${tabular}\n${footnoteTexts(marks, notes)}`);
        break;
      }
    }
  }
  return out.join('\n\n');
}

/** The standalone .tex text of a document. */
export function writeLatex(doc: ExportDocument): string {
  const blocks = [...doc.blocks];
  let title = '';
  const first = blocks[0];
  if (first?.t === 'heading' && first.level === 1) {
    title = inlinesTex(first.children, doc.notes);
    blocks.shift();
  }
  const usesTable = blocks.some(function hasTable(b: Block): boolean {
    if (b.t === 'table') return true;
    if (b.t === 'quote') return b.blocks.some(hasTable);
    if (b.t === 'bullets' || b.t === 'ordered') return b.items.some((it) => it.some(hasTable));
    return false;
  });
  const preamble = [
    '\\documentclass[11pt]{article}',
    '\\usepackage{iftex}',
    '\\ifPDFTeX',
    '  \\usepackage[T1]{fontenc}',
    '  \\usepackage[utf8]{inputenc}',
    '  \\usepackage{textcomp}',
    '\\else',
    '  \\usepackage{fontspec}',
    '\\fi',
    ...(usesTable ? ['\\usepackage{array}'] : []),
    '\\newcommand{\\textfallback}[2]{\\ifPDFTeX#1\\else#2\\fi}',
    '\\usepackage[hidelinks]{hyperref}',
    '\\setcounter{secnumdepth}{0}',
    '\\setlength{\\parskip}{0.5em}',
    '\\setlength{\\parindent}{0pt}',
    '\\setlength{\\emergencystretch}{3em}',
    title !== '' ? `\\title{${title}}` : '',
    '\\author{}',
    '\\date{}',
  ].filter((l) => l !== '');
  let body = blocksTex(blocks, doc.notes);
  if (doc.bibliography !== null) {
    const entries = doc.bibliography.entries.map((e) => {
      const label = e.label !== null ? `${inlinesTex(e.label, doc.notes)}~` : '';
      return `\\noindent\\hangindent=2em\\hangafter=1 ${label}${inlinesTex(e.body, doc.notes)}\\par`;
    });
    body += `\n\n\\section*{${escapeLatex(doc.bibliography.title)}}\n\n${entries.join('\n\n')}`;
  }
  return `${preamble.join('\n')}\n\n\\begin{document}\n${title !== '' ? '\\maketitle\n' : ''}\n${body}\n\n\\end{document}\n`;
}
