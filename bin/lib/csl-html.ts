// bin/lib/csl-html.ts — convert citeproc's HTML output to Markdown or LaTeX.
//
// citeproc renders citations and reference entries as small HTML fragments
// (<i>, <b>, <sup>, small-caps spans, layout divs). Its plain-text output drops
// the italics that APA, MLA and Chicago require for journal and book titles,
// so the offline exporter renders HTML and converts it here.
//
// PURE module: no I/O.

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
};

/** Decode HTML character references; one that names no character (`&#0;`, past U+10FFFF) is left as it is. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

interface Markup {
  italic: [string, string];
  bold: [string, string];
  sup: [string, string];
  sub: [string, string];
  smallCaps: [string, string];
  text: (s: string) => string;
}

function convert(html: string, mk: Markup): string {
  const closers: string[] = [];
  let out = '';
  for (const tok of html.split(/(<[^>]+>)/)) {
    if (tok.length === 0) continue;
    const tag = /^<(\/?)([a-z0-9]+)([^>]*)>$/i.exec(tok);
    if (!tag) {
      out += mk.text(decodeEntities(tok).replace(/\s+/g, ' '));
      continue;
    }
    const [, slash, rawName, attrs] = tag;
    const name = rawName!.toLowerCase();
    if (name === 'br') {
      out += ' ';
      continue;
    }
    if (slash) {
      out += closers.pop() ?? '';
      continue;
    }
    let open = '';
    let close = '';
    if (name === 'i' || name === 'em') [open, close] = mk.italic;
    else if (name === 'b' || name === 'strong') [open, close] = mk.bold;
    else if (name === 'sup') [open, close] = mk.sup;
    else if (name === 'sub') [open, close] = mk.sub;
    else if (name === 'span' && /small-caps/i.test(attrs ?? '')) [open, close] = mk.smallCaps;
    else if (name === 'span' && /font-style:\s*italic/i.test(attrs ?? '')) [open, close] = mk.italic;
    else if (name === 'span' && /font-weight:\s*bold/i.test(attrs ?? '')) [open, close] = mk.bold;
    // A layout div ends with a space, so a reference number in its own column
    // ("[1]") is followed by one.
    else if (name === 'div') close = ' ';
    out += open;
    closers.push(close);
  }
  while (closers.length > 0) out += closers.pop();
  return out.replace(/[ \t\u00a0]{2,}/g, ' ').trim();
}

// LaTeX's special characters and how text writes each one.
const LATEX_ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '&': '\\&',
  '%': '\\%',
  '$': '\\$',
  '#': '\\#',
  '_': '\\_',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
};

/**
 * Escape LaTeX's special characters in text. One pass, so the braces of the
 * `\textbackslash{}` written for a backslash are not escaped again.
 */
export function escapeLatexText(s: string): string {
  return s.replace(/[\\{}&%$#_~^]/g, (c) => LATEX_ESCAPES[c] ?? c);
}

// Characters that would change the meaning of Markdown text.
function escapeMarkdown(s: string): string {
  return s.replace(/([\\`*])/g, '\\$1').replace(/</g, '&lt;');
}

/** citeproc HTML → Markdown (Pandoc and GitHub flavours both read it). */
export function cslHtmlToMarkdown(html: string): string {
  return convert(html, {
    italic: ['*', '*'],
    bold: ['**', '**'],
    sup: ['<sup>', '</sup>'],
    sub: ['<sub>', '</sub>'],
    smallCaps: ['', ''],
    text: escapeMarkdown,
  });
}

/** citeproc HTML → LaTeX, escaping text with `escape`. */
export function cslHtmlToLatex(html: string, escape: (s: string) => string): string {
  return convert(html, {
    italic: ['\\emph{', '}'],
    bold: ['\\textbf{', '}'],
    sup: ['\\textsuperscript{', '}'],
    sub: ['\\textsubscript{', '}'],
    smallCaps: ['\\textsc{', '}'],
    text: escape,
  });
}
