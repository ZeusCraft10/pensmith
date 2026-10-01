// bin/lib/markup.ts — plain text from the inline markup registrars put in
// metadata strings (Phase 19 review round 2; SRC-05, SRC-12).
//
// Crossref returns titles and journal names as they were deposited: inline
// JATS / HTML (`The Genome Sequence of <i>Drosophila melanogaster</i>`,
// `CO<sub>2</sub>`, `<scp>…</scp>`, MathML) and XML entities (`Child &amp;
// Adolescent Psychiatry`, sometimes double-encoded as `&amp;amp;`). OpenAlex and
// PubMed titles carry the same tags; book descriptions carry HTML (`<br>`,
// `<a href=…>`). Stored verbatim, they reach LIBRARY.json, CITATIONS.bib (as
// `\&amp;`), RESEARCH.md, the model requests and the exported bibliography, and
// they lower Pass 1's title similarity against a registrar that sends plain
// text. Every adapter builds its candidate strings through plainText(), the
// BibTeX writer runs it again (so an entry stored before this rule still
// renders clean), and Pass 1 compares plain titles.
//
// Only markup is removed: a tag is `<name …>` / `</name>` whose name is a known
// inline or block HTML / JATS / MathML element (namespaced forms like
// `jats:italic` and `mml:mi` included), so a title such as `x < y and z > w`
// keeps its text. Pure: no I/O.

import { lookupTable } from './lookup-table.js';

const XML_ENTITIES: Readonly<Record<string, string>> = lookupTable({
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
});

/** `&amp;`, `&#38;`, `&#x26;` and the named entities above, decoded once; unknown entities are kept. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return XML_ENTITIES[ent.toLowerCase()] ?? whole;
  });
}

/** The element names removed as markup (lowercase; a namespace prefix such as `jats:` or `mml:` is allowed). */
const MARKUP_TAGS =
  'i|b|u|s|em|strong|sub|sup|scp|sc|small|big|tt|span|a|br|p|div|font|italic|bold|underline|monospace|' +
  'sans-serif|roman|strike|named-content|inline-formula|disp-formula|tex-math|title|sec|list|list-item|' +
  'math|mi|mo|mn|ms|mtext|mrow|msub|msup|msubsup|mfrac|msqrt|mroot|mover|munder|munderover|mstyle|' +
  'mspace|mpadded|mphantom|menclose|mtable|mtr|mtd|semantics|annotation|annotation-xml';

const TAG_RE = new RegExp(`</?(?:[a-z][a-z0-9-]*:)?(?:${MARKUP_TAGS})(?:\\s[^<>]*)?/?>`, 'gi');
/** Tags that separate words (a line break or a block) become a space; inline ones join their text. */
const BREAK_TAG_RE = /<(?:br|\/?p|\/?div|\/?(?:[a-z][a-z0-9-]*:)?(?:sec|list-item|title))\b[^<>]*>/gi;

/**
 * `s` with its known markup tags removed (see the header) — a break or block
 * tag becomes a space — and nothing else: entities stay encoded, and a `<` or
 * `>` that opens no known tag (`<5 mg`, `p<0.05`, `n>100`) is text.
 */
export function stripMarkupTags(s: string): string {
  return s.replace(BREAK_TAG_RE, ' ').replace(TAG_RE, '');
}

/**
 * `s` as plain text: entities decoded (twice, for a double-encoded `&amp;amp;`),
 * markup tags removed (see the header), whitespace collapsed.
 */
export function plainText(s: string): string {
  const once = decodeEntities(s);
  const stripped = once.replace(BREAK_TAG_RE, ' ').replace(TAG_RE, '');
  return decodeEntities(stripped).replace(/\s+/g, ' ').trim();
}

/** plainText for an optional value: undefined stays undefined, an empty result becomes undefined. */
export function plainTextOpt(s: string | null | undefined): string | undefined {
  if (typeof s !== 'string') return undefined;
  const t = plainText(s);
  return t.length > 0 ? t : undefined;
}

// ---------------------------------------------------------------------------
// TeX in arXiv metadata.
// ---------------------------------------------------------------------------
//
// arXiv returns titles, abstracts, author names and journal references as the
// submitter typed them: TeX accents (`Herv{\'e}`, or already converted but
// still braced, `Herv{é}`), grouping braces, inline math (`$C^*$-algebras`,
// `$\alpha$`), escaped specials (`\%`, `\&`) and the odd `\cite{…}`. Left in,
// the BibTeX writer escapes every brace and backslash and the exported
// reference reads `Herv\textbraceleft{}é\textbraceright{}`. texToText() turns
// the common forms into the characters they stand for.

/** Accent commands → the Unicode combining mark. */
const TEX_ACCENTS: Readonly<Record<string, string>> = lookupTable({
  "'": '\u0301',
  '`': '\u0300',
  '^': '\u0302',
  '"': '\u0308',
  '~': '\u0303',
  '=': '\u0304',
  '.': '\u0307',
  c: '\u0327',
  v: '\u030C',
  u: '\u0306',
  H: '\u030B',
  k: '\u0328',
  r: '\u030A',
});

const TEX_LETTERS: Readonly<Record<string, string>> = lookupTable({
  ss: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', o: 'ø', O: 'Ø', l: 'ł', L: 'Ł', i: 'ı', j: 'ȷ',
});

/** Math-mode commands with a one-character plain rendering. */
const TEX_SYMBOLS: Readonly<Record<string, string>> = lookupTable({
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ',
  vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ',
  Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  sim: '~', times: '×', le: '≤', leq: '≤', ge: '≥', geq: '≥', pm: '±', infty: '∞', to: '→', rightarrow: '→',
  leftarrow: '←', cdot: '·', approx: '≈', ell: 'ℓ', neq: '≠', ne: '≠', partial: '∂', nabla: '∇', in: '∈',
  sqrt: '√', log: 'log', ln: 'ln', exp: 'exp', sin: 'sin', cos: 'cos', max: 'max', min: 'min',
});

/** Commands whose argument is the text (`\emph{x}` → x). */
const TEX_TEXT_COMMANDS = 'emph|textit|textbf|textsc|texttt|textrm|textsf|textup|mathrm|mathbf|mathit|mathcal|mathbb|mathsf|mathtt|text|mbox|operatorname|boldsymbol|bm';
/** Commands dropped with their argument (`\cite{…}`). */
const TEX_DROP_COMMANDS = 'cite|citep|citet|citealp|ref|eqref|label|footnote|url';

function mathToText(m: string): string {
  return m
    .replace(/\\([A-Za-z]+)/g, (whole, name: string) => TEX_SYMBOLS[name] ?? name)
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The text a TeX-marked metadata string stands for (see the block comment
 * above). Unknown commands lose their backslash; the result is NFC.
 */
export function texToText(s: string): string {
  let t = s;
  // Commands that carry text, and the ones dropped outright.
  const textCmd = new RegExp(`\\\\(?:${TEX_TEXT_COMMANDS})\\s*\\{([^{}]*)\\}`, 'g');
  const dropCmd = new RegExp(`\\\\(?:${TEX_DROP_COMMANDS})\\s*(?:\\[[^\\]]*\\])?\\{[^{}]*\\}`, 'g');
  for (let i = 0; i < 3; i += 1) t = t.replace(textCmd, '$1');
  t = t.replace(dropCmd, '');
  // Accents: \'e, \'{e}, {\'e}, \c{c}, \c c.
  t = t.replace(/\\(['`^"~=.])\s*(?:\{\s*(\\[ij]|[A-Za-z])\s*\}|(\\[ij]|[A-Za-z]))/g, (_m, acc: string, a?: string, b?: string) => {
    const ch = a ?? b ?? '';
    const base = ch === '\\i' ? 'i' : ch === '\\j' ? 'j' : ch;
    return `${base}${TEX_ACCENTS[acc] ?? ''}`;
  });
  t = t.replace(/\\([cvuHkr])(?:\s*\{\s*([A-Za-z])\s*\}|\s+([A-Za-z]))/g, (_m, acc: string, a?: string, b?: string) => `${a ?? b ?? ''}${TEX_ACCENTS[acc] ?? ''}`);
  // Special letters: \ss, {\o}, \AA{}.
  t = t.replace(/\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i|j)(?![A-Za-z])(?:\{\}|\s+(?=[A-Za-z]))?/g, (_m, name: string) => TEX_LETTERS[name] ?? name);
  // Inline math.
  t = t.replace(/\$\$?([^$]{1,200})\$\$?/g, (_m, inner: string) => mathToText(inner));
  // Escaped specials, and `~` as a tie.
  t = t.replace(/\\([%&_#$])/g, '$1').replace(/(?<!\\)~/g, ' ');
  // Remaining grouping braces, then any stray command's backslash.
  for (let i = 0; i < 4; i += 1) t = t.replace(/\{([^{}]*)\}/g, '$1');
  t = t.replace(/\\([A-Za-z]+)\s*/g, (_m, name: string) => TEX_SYMBOLS[name] ?? `${name} `);
  return t.normalize('NFC').replace(/\s+/g, ' ').trim();
}
