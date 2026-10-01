// bin/lib/export/markdown.ts — the Markdown subset the built-in writers read
// (D-21-10).
//
// The docx, PDF and LaTeX writers that run without pandoc read the gated text
// with this reader: ATX (and setext) headings, paragraphs, emphasis and strong
// emphasis, strikeout, superscript and subscript, inline code and code blocks
// (fenced and indented), block quotes, bullet and ordered lists (nested;
// decimal, letter and roman markers), links and autolinks, horizontal rules,
// pipe tables, hard line breaks, backslash escapes and HTML entities — read as
// pandoc's Markdown reader reads them (`markdown-yaml_metadata_block-
// raw_attribute-raw_tex`: a heading, a block quote or an indented code block
// needs a blank line before it, `_` inside a word is a letter). Anything else
// (raw HTML, TeX math, images, inline notes, bracketed spans, definition lists,
// line blocks, fenced divs, grid tables) is written as its literal text, with
// one note per kind in `ParsedMarkdown.literal` — never dropped.
// tests/markdown-subset.property.test.ts checks the block and inline structure
// against `pandoc -t json` over generated drafts.
//
// Typographic quotes and dashes (pandoc's `smart` extension) are applied by
// the writers (smartText), not here, so the reader's structure is the one
// pandoc builds with `-smart`.

/** An inline node. Text holds single spaces between words (a soft line break is a space). */
export type Inline =
  | { readonly t: 'text'; readonly text: string }
  | { readonly t: 'break' }
  | { readonly t: 'emph' | 'strong' | 'strike' | 'sup' | 'sub' | 'smallcaps'; readonly children: readonly Inline[] }
  | { readonly t: 'code'; readonly text: string }
  | { readonly t: 'link'; readonly href: string; readonly children: readonly Inline[] }
  | { readonly t: 'note'; readonly n: number };

/** The marker style of an ordered list. */
export type ListStyle = 'decimal' | 'lower-alpha' | 'upper-alpha' | 'lower-roman' | 'upper-roman';

/** A block node. */
export type Block =
  | { readonly t: 'heading'; readonly level: number; readonly children: readonly Inline[] }
  | { readonly t: 'para'; readonly children: readonly Inline[] }
  | { readonly t: 'plain'; readonly children: readonly Inline[] }
  | { readonly t: 'quote'; readonly blocks: readonly Block[] }
  | { readonly t: 'bullets'; readonly items: ReadonlyArray<readonly Block[]> }
  | { readonly t: 'ordered'; readonly start: number; readonly style: ListStyle; readonly items: ReadonlyArray<readonly Block[]> }
  | { readonly t: 'code'; readonly text: string }
  | { readonly t: 'hr' }
  | {
      readonly t: 'table';
      readonly aligns: ReadonlyArray<'left' | 'right' | 'center' | 'default'>;
      readonly head: ReadonlyArray<readonly Inline[]>;
      readonly rows: ReadonlyArray<ReadonlyArray<readonly Inline[]>>;
    };

/** A parsed document and the constructs it wrote as literal text (one note per kind). */
export interface ParsedMarkdown {
  readonly blocks: Block[];
  readonly literal: string[];
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`]*)$/;
const ATX_RE = /^ {0,3}(#{1,6})(?=[ \t]|$)[ \t]*(.*?)[ \t]*$/;
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const BULLET_RE = /^( {0,3})([-+*])( {1,4}|\t|$)/;
const ORDERED_RE = /^( {0,3})(?:(\d{1,9})|([a-z])|([A-Z])|([ivxlcdm]+)|([IVXLCDM]+)|#)([.)])( {1,4}|\t|$)/;
const PAREN_ORDERED_RE = /^( {0,3})\((?:(\d{1,9})|([a-z])|([A-Z])|([ivxlcdm]+)|([IVXLCDM]+)|#)\)( {1,4}|\t|$)/;
const QUOTE_RE = /^ {0,3}> ?/;
const SETEXT_RE = /^ {0,3}(=+|-+)[ \t]*$/;
const TABLE_SEP_RE = /^ {0,3}\|?[ \t]*:?-{1,}:?[ \t]*(?:\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/;

function isBlank(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

/** Expand tabs to the next multiple of 4 (CommonMark / pandoc tab stops). */
function detab(line: string): string {
  if (!line.includes('\t')) return line;
  let out = '';
  for (const ch of line) {
    if (ch === '\t') out += ' '.repeat(4 - (out.length % 4));
    else out += ch;
  }
  return out;
}

const ROMAN_VALUES: Readonly<Record<string, number>> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

function romanValue(s: string): number | null {
  if (!/^(?=[ivxlcdm])m{0,4}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/i.test(s)) return null;
  let total = 0;
  const lower = s.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    const v = ROMAN_VALUES[lower[i] as string] as number;
    const next = ROMAN_VALUES[lower[i + 1] as string] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}

/** One list marker on a line: its kind, indentation, content column and (ordered) number and style. */
interface ListMarker {
  readonly ordered: boolean;
  readonly indent: number;
  readonly content: number;
  readonly bullet?: string;
  readonly start?: number;
  readonly style?: ListStyle;
  readonly delim?: string;
}

function listMarker(line: string): ListMarker | null {
  const b = BULLET_RE.exec(line);
  if (b !== null && !HR_RE.test(line)) {
    const indent = (b[1] as string).length;
    const gap = b[3] as string;
    const content = indent + 1 + (gap === '' ? 1 : gap.length);
    return { ordered: false, indent, content, bullet: b[2] as string };
  }
  for (const [re, paren] of [[ORDERED_RE, false], [PAREN_ORDERED_RE, true]] as const) {
    const m = re.exec(line);
    if (m === null) continue;
    const indent = (m[1] as string).length;
    const gap = (paren ? m[7] : m[8]) as string;
    const delim = paren ? '()' : (m[7] as string);
    let start = 1;
    let style: ListStyle = 'decimal';
    if (m[2] !== undefined) start = Number(m[2]);
    else if (m[5] !== undefined || m[6] !== undefined) {
      const r = (m[5] ?? m[6]) as string;
      // A single letter that is also a roman numeral (`i`, `v`, `x`, `c`, …) reads as a letter unless it is `i`/`I`.
      if (r.length === 1 && !/^[iI]$/.test(r)) {
        style = /[a-z]/.test(r) ? 'lower-alpha' : 'upper-alpha';
        start = r.toLowerCase().charCodeAt(0) - 96;
      } else {
        const v = romanValue(r);
        if (v === null) continue;
        style = r === r.toLowerCase() ? 'lower-roman' : 'upper-roman';
        start = v;
      }
    } else if (m[3] !== undefined) {
      style = 'lower-alpha';
      start = (m[3] as string).charCodeAt(0) - 96;
    } else if (m[4] !== undefined) {
      style = 'upper-alpha';
      start = (m[4] as string).charCodeAt(0) - 64;
      // pandoc: a capital letter with a period needs at least two spaces after it.
      if (delim === '.' && gap.length < 2) continue;
    }
    const markerLen = m[0].length - gap.length - indent;
    const content = indent + markerLen + (gap === '' ? 1 : gap.length);
    return { ordered: true, indent, content, start, style, delim };
  }
  return null;
}

/**
 * pandoc's compactify over a list's items: when the last item ends with a
 * paragraph and no other paragraph is in the list's items, that paragraph is
 * plain; when no item holds a paragraph the list stays as it is; otherwise
 * every plain block of every item becomes a paragraph (the list is loose).
 */
function compactify(items: Block[][]): Block[][] {
  if (items.length === 0) return items;
  const others = items.slice(0, -1).flat();
  const final = items[items.length - 1] as Block[];
  const last = final[final.length - 1];
  if (last?.t === 'para' && ![...final.slice(0, -1), ...others].some((b) => b.t === 'para')) {
    return [...items.slice(0, -1), [...final.slice(0, -1), { t: 'plain', children: last.children }]];
  }
  if (!items.flat().some((b) => b.t === 'para')) return items;
  return items.map((blocks) => blocks.map((b) => (b.t === 'plain' ? ({ t: 'para', children: b.children } as Block) : b)));
}

/** The parse state for one container's lines. */
class BlockParser {
  private readonly literal: Set<string>;

  constructor(literal: Set<string>) {
    this.literal = literal;
  }

  /** Parse a container's lines; in a list item a list marker line starts a (nested) list, as in pandoc. */
  parse(lines: readonly string[], inListItem = false): Block[] {
    const out: Block[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i] as string;
      if (isBlank(line)) {
        i++;
        continue;
      }
      // pandoc needs a blank line before a heading, a block quote or an indented code block (except at the start).
      const afterBlank = i === 0 || isBlank(lines[i - 1] as string);
      const fence = FENCE_RE.exec(line);
      if (fence !== null) {
        const marker = fence[1] as string;
        const body: string[] = [];
        let j = i + 1;
        const indent = /^ */.exec(line)?.[0].length ?? 0;
        for (; j < lines.length; j++) {
          const l = lines[j] as string;
          const close = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`).exec(l);
          if (close !== null) break;
          body.push(l.replace(new RegExp(`^ {0,${indent}}`), ''));
        }
        out.push({ t: 'code', text: body.join('\n') });
        i = Math.min(j + 1, lines.length);
        continue;
      }
      const atx = ATX_RE.exec(line);
      if (atx !== null && (afterBlank || out.length === 0)) {
        const text = (atx[2] as string).replace(/[ \t]+#+[ \t]*$/, '').replace(/^#+$/, '');
        out.push({ t: 'heading', level: (atx[1] as string).length, children: parseInlines(text, this.literal) });
        i++;
        continue;
      }
      if (HR_RE.test(line)) {
        out.push({ t: 'hr' });
        i++;
        continue;
      }
      if (QUOTE_RE.test(line) && afterBlank) {
        const body: string[] = [];
        let j = i;
        for (; j < lines.length; j++) {
          const l = lines[j] as string;
          if (QUOTE_RE.test(l)) body.push(l.replace(QUOTE_RE, ''));
          else if (!isBlank(l) && body.length > 0 && !isBlank(body[body.length - 1] as string)) body.push(l);
          else break;
        }
        out.push({ t: 'quote', blocks: this.parse(body) });
        i = j;
        continue;
      }
      const marker = listMarker(line);
      if (marker !== null) {
        const r = this.parseList(lines, i, marker);
        out.push(r.block);
        i = r.next;
        continue;
      }
      if (/^ {4}/.test(detab(line)) && (afterBlank || out.length === 0)) {
        const body: string[] = [];
        let j = i;
        for (; j < lines.length; j++) {
          const l = detab(lines[j] as string);
          if (/^ {4}/.test(l)) body.push(l.slice(4));
          else if (isBlank(l)) body.push('');
          else break;
        }
        while (body.length > 0 && body[body.length - 1] === '') body.pop();
        out.push({ t: 'code', text: body.join('\n') });
        i = j;
        continue;
      }
      if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1] as string) && (lines[i + 1] as string).includes('-')) {
        const r = this.parseTable(lines, i);
        if (r !== null) {
          out.push(r.block);
          i = r.next;
          continue;
        }
      }
      // A paragraph: lines up to a blank line (or, in a list, the next item).
      const para: string[] = [line];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j] as string;
        if (isBlank(l)) break;
        if (FENCE_RE.test(l)) break;
        if (inListItem && listMarker(l) !== null) break;
        para.push(l);
      }
      // A setext heading: one line underlined with = or -.
      if (para.length === 2 && SETEXT_RE.test(para[1] as string) && (afterBlank || out.length === 0)) {
        const level = (para[1] as string).trim().startsWith('=') ? 1 : 2;
        out.push({ t: 'heading', level, children: parseInlines((para[0] as string).trim(), this.literal) });
        i = j;
        continue;
      }
      this.noteLiteralBlocks(para);
      // In a list item a paragraph not followed by a blank line is plain text (pandoc's para / plain).
      const plain = inListItem && !(j < lines.length && isBlank(lines[j] as string));
      out.push({ t: plain ? 'plain' : 'para', children: parseInlines(para.join('\n'), this.literal) });
      i = j;
    }
    return out;
  }

  /** Note the block-level constructs outside the subset that a paragraph carries as text. */
  private noteLiteralBlocks(para: readonly string[]): void {
    const first = para[0] as string;
    if (/^ {0,3}:{3,}/.test(first)) this.literal.add('a fenced div (:::) was written as text');
    else if (/^ {0,3}\|(?: |$)/.test(first) && !first.includes('|', first.indexOf('|') + 1)) this.literal.add('a line block (|) was written as text');
    else if (/^ {0,3}<[a-zA-Z/!]/.test(first)) this.literal.add('raw HTML was written as text');
    else if (/^ {0,3}\+[-=+]+\+/.test(first)) this.literal.add('a grid table was written as text');
    if (para.length >= 2 && /^ {0,3}[:~][ \t]/.test(para[1] as string)) this.literal.add('a definition list was written as text');
  }

  private parseList(lines: readonly string[], from: number, first: ListMarker): { block: Block; next: number } {
    const items: Block[][] = [];
    let i = from;
    let marker: ListMarker | null = first;
    while (marker !== null && i < lines.length) {
      // An item's lines (its content column removed), with the blank lines
      // after it, as pandoc's list-item reader collects them: a paragraph of
      // the item followed by a blank line is a paragraph, else plain text.
      const body: string[] = [((lines[i] as string).length > marker.content ? detab(lines[i] as string).slice(marker.content) : '')];
      let j = i + 1;
      let sawBlank = false;
      for (; j < lines.length; j++) {
        const l = detab(lines[j] as string);
        if (isBlank(l)) {
          sawBlank = true;
          body.push('');
          continue;
        }
        const indent = /^ */.exec(l)?.[0].length ?? 0;
        if (indent >= marker.content) {
          sawBlank = false;
          body.push(l.slice(marker.content));
          continue;
        }
        const next = listMarker(l);
        // A list marker left of the content column ends the item (a sibling, or a list of another kind).
        if (next !== null && next.indent < marker.content) break;
        if (sawBlank) break;
        // A lazy continuation line of the item's paragraph.
        body.push(l.trimStart());
      }
      items.push(this.parse(body, true));
      i = j;
      // The next item: a marker of the same kind (blank lines between items allowed).
      let k = i;
      while (k < lines.length && isBlank(lines[k] as string)) k++;
      const next = k < lines.length ? listMarker(detab(lines[k] as string)) : null;
      if (next === null || next.ordered !== first.ordered || (next.ordered && next.style !== first.style) || (!next.ordered && next.bullet !== first.bullet) || next.indent >= marker.content) {
        break;
      }
      i = k;
      marker = next;
    }
    const finalItems = compactify(items);
    const block: Block = first.ordered
      ? { t: 'ordered', start: first.start ?? 1, style: first.style ?? 'decimal', items: finalItems }
      : { t: 'bullets', items: finalItems };
    return { block, next: i };
  }

  private parseTable(lines: readonly string[], from: number): { block: Block; next: number } | null {
    const cells = (row: string): string[] => {
      let r = row.trim();
      if (r.startsWith('|')) r = r.slice(1);
      if (r.endsWith('|') && !r.endsWith('\\|')) r = r.slice(0, -1);
      const out: string[] = [];
      let cur = '';
      let code = false;
      for (let k = 0; k < r.length; k++) {
        const ch = r[k] as string;
        if (ch === '\\' && r[k + 1] === '|') {
          cur += '|';
          k++;
          continue;
        }
        if (ch === '`') code = !code;
        if (ch === '|' && !code) {
          out.push(cur.trim());
          cur = '';
          continue;
        }
        cur += ch;
      }
      out.push(cur.trim());
      return out;
    };
    const head = cells(lines[from] as string);
    const seps = cells(lines[from + 1] as string);
    if (seps.length !== head.length) return null;
    const aligns = seps.map((s) => {
      const l = s.startsWith(':');
      const r = s.endsWith(':');
      return l && r ? 'center' : r ? 'right' : l ? 'left' : 'default';
    }) as Array<'left' | 'right' | 'center' | 'default'>;
    const rows: Inline[][][] = [];
    let i = from + 2;
    for (; i < lines.length; i++) {
      const l = lines[i] as string;
      if (isBlank(l) || !l.includes('|')) break;
      const row = cells(l);
      rows.push(head.map((_h, c) => parseInlines(row[c] ?? '', this.literal)));
    }
    return { block: { t: 'table', aligns, head: head.map((h) => parseInlines(h, this.literal)), rows }, next: i };
  }
}

/** Parse a Markdown text in the subset (CRLF and LF alike). */
export function parseMarkdown(text: string): ParsedMarkdown {
  const literal = new Set<string>();
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks = new BlockParser(literal).parse(lines);
  return { blocks, literal: [...literal] };
}

// ---------------------------------------------------------------------------
// Inlines
// ---------------------------------------------------------------------------

const ESCAPABLE = /[!-/:-@[-`{-~]/;
const ENTITY_RE = /^&(?:#[xX]([0-9a-fA-F]{1,6})|#(\d{1,7})|([A-Za-z][A-Za-z0-9]{1,31}));/;
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', sect: '§', para: '¶', deg: '°',
  plusmn: '±', times: '×', divide: '÷', euro: '€', pound: '£', yen: '¥', cent: '¢', laquo: '«', raquo: '»', middot: '·',
  bull: '•', dagger: '†', Dagger: '‡', prime: '′', Prime: '″', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', mu: 'μ', pi: 'π', sigma: 'σ',
  le: '≤', ge: '≥', ne: '≠', asymp: '≈', infin: '∞', larr: '←', rarr: '→', shy: '­', thinsp: ' ', ensp: ' ', emsp: ' ',
};

/** Append text to an inline list, merging with a text node before it. */
function pushText(out: Inline[], text: string): void {
  if (text === '') return;
  const last = out[out.length - 1];
  if (last !== undefined && last.t === 'text') out[out.length - 1] = { t: 'text', text: last.text + text };
  else out.push({ t: 'text', text });
}

/** White space normalised the way pandoc reads it: runs of spaces, tabs and newlines → one space. */
function normalizeSpaces(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    if (n.t === 'text') pushText(out, n.text.replace(/[ \t\n]+/g, ' '));
    else if (n.t === 'break') {
      const last = out[out.length - 1];
      if (last !== undefined && last.t === 'text') out[out.length - 1] = { t: 'text', text: last.text.replace(/ +$/, '') };
      out.push(n);
    } else out.push(n);
  }
  // No space right after a hard break.
  for (let k = 1; k < out.length; k++) {
    const n = out[k] as Inline;
    if (out[k - 1]?.t === 'break' && n.t === 'text') out[k] = { t: 'text', text: n.text.replace(/^ +/, '') };
  }
  return out.filter((n) => n.t !== 'text' || n.text !== '');
}

/** Trim leading and trailing white space of an inline list (a block's content). */
function trimInlines(nodes: Inline[]): Inline[] {
  const out = [...nodes];
  while (out[out.length - 1]?.t === 'break') out.pop();
  const first = out[0];
  if (first?.t === 'text') out[0] = { t: 'text', text: first.text.replace(/^\s+/, '') };
  const li = out.length - 1;
  const last = out[li];
  if (last?.t === 'text') out[li] = { t: 'text', text: last.text.replace(/\s+$/, '') };
  return out.filter((n) => n.t !== 'text' || n.text !== '');
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

class InlineParser {
  private readonly s: string;
  private readonly literal: Set<string>;

  constructor(s: string, literal: Set<string>) {
    this.s = s;
    this.literal = literal;
  }

  /** Parse s[from, to) into inlines; `close` is a delimiter that ends this run (for emphasis). */
  run(from: number, to: number): Inline[] {
    const out: Inline[] = [];
    let i = from;
    const s = this.s;
    while (i < to) {
      const ch = s[i] as string;
      if (ch === '\\') {
        const next = s[i + 1];
        if (next === '\n') {
          out.push({ t: 'break' });
          i += 2;
          continue;
        }
        if (next === ' ') {
          pushText(out, ' ');
          i += 2;
          continue;
        }
        if (next !== undefined && i + 1 < to && ESCAPABLE.test(next)) {
          pushText(out, next);
          i += 2;
          continue;
        }
        pushText(out, '\\');
        i++;
        continue;
      }
      if (ch === '\n') {
        // Two or more spaces before a newline: a hard line break.
        const before = s.slice(from, i);
        if (/ {2,}$/.test(before)) {
          const last = out[out.length - 1];
          if (last?.t === 'text') out[out.length - 1] = { t: 'text', text: last.text.replace(/ +$/, '') };
          out.push({ t: 'break' });
        } else pushText(out, '\n');
        i++;
        continue;
      }
      if (ch === '`') {
        const r = this.codeSpan(i, to);
        if (r !== null) {
          out.push({ t: 'code', text: r.text });
          i = r.end;
          continue;
        }
        const run = /^`+/.exec(s.slice(i, to))?.[0] ?? '`';
        pushText(out, run);
        i += run.length;
        continue;
      }
      if (ch === '*' || ch === '_') {
        const r = this.emphasis(i, to, out);
        if (r !== null) {
          out.push(...r.nodes);
          i = r.end;
          continue;
        }
        const run = (ch === '*' ? /^\*+/ : /^_+/).exec(s.slice(i, to))?.[0] ?? ch;
        pushText(out, run);
        i += run.length;
        continue;
      }
      if (ch === '~' && s[i + 1] === '~') {
        const end = this.findCloser(i + 2, to, '~~');
        if (end !== -1 && !/\s/.test(s[i + 2] ?? ' ')) {
          out.push({ t: 'strike', children: this.run(i + 2, end) });
          i = end + 2;
          continue;
        }
      }
      if (ch === '^' || (ch === '~' && s[i + 1] !== '~')) {
        const r = this.supSub(i, to, ch);
        if (r !== null) {
          out.push(r.node);
          i = r.end;
          continue;
        }
        if (ch === '^' && s[i + 1] === '[') this.literal.add('an inline note (^[…]) was written as text');
      }
      if (ch === '!' && s[i + 1] === '[') {
        const r = this.link(i + 1, to);
        if (r !== null) {
          this.literal.add('an image was written as text');
          pushText(out, s.slice(i, r.end));
          i = r.end;
          continue;
        }
      }
      if (ch === '[') {
        const r = this.link(i, to);
        if (r !== null) {
          out.push({ t: 'link', href: r.href, children: r.children });
          i = r.end;
          continue;
        }
        const span = /^\[[^\]]*\]\{[^}]*\}/.exec(s.slice(i, to));
        if (span !== null) this.literal.add('a bracketed span ([…]{…}) was written as text');
      }
      if (ch === '<') {
        const auto = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/.exec(s.slice(i, to));
        if (auto !== null) {
          out.push({ t: 'link', href: auto[1] as string, children: [{ t: 'text', text: auto[1] as string }] });
          i += auto[0].length;
          continue;
        }
        const mail = /^<([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/.exec(s.slice(i, to));
        if (mail !== null) {
          out.push({ t: 'link', href: `mailto:${mail[1] as string}`, children: [{ t: 'text', text: mail[1] as string }] });
          i += mail[0].length;
          continue;
        }
        if (/^<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>|^<!--/.test(s.slice(i, to))) this.literal.add('raw HTML was written as text');
      }
      if (ch === '&') {
        const ent = ENTITY_RE.exec(s.slice(i, to));
        if (ent !== null) {
          const cp = ent[1] !== undefined ? parseInt(ent[1], 16) : ent[2] !== undefined ? Number(ent[2]) : null;
          const decoded = cp !== null ? (cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '�') : ENTITIES[ent[3] as string];
          if (decoded !== undefined) {
            pushText(out, decoded);
            i += ent[0].length;
            continue;
          }
        }
      }
      if (ch === '$') {
        const math = /^\$(?![\s$])((?:[^$\\]|\\.)*?[^\s\\])\$(?!\d)/.exec(s.slice(i, to));
        if (math !== null) this.literal.add('TeX math ($…$) was written as text');
      }
      pushText(out, ch);
      i++;
    }
    return out;
  }

  private codeSpan(i: number, to: number): { text: string; end: number } | null {
    const run = /^`+/.exec(this.s.slice(i, to))?.[0] ?? '';
    let k = i + run.length;
    while (k < to) {
      const at = this.s.indexOf(run, k);
      if (at === -1 || at + run.length > to) return null;
      const after = this.s[at + run.length];
      const before = this.s[at - 1];
      if (after === '`' || (before === '`' && at - 1 >= i + run.length)) {
        k = at + 1;
        while (this.s[k] === '`') k++;
        continue;
      }
      const text = this.s.slice(i + run.length, at).replace(/[ \t]*\n[ \t]*/g, ' ').trim();
      return { text, end: at + run.length };
    }
    return null;
  }

  /** The index of `delim` in [from, to) outside code spans and escapes, preceded by a non-space; -1 when absent. */
  private findCloser(from: number, to: number, delim: string): number {
    for (let k = from; k < to; k++) {
      const ch = this.s[k];
      if (ch === '\\') {
        k++;
        continue;
      }
      if (ch === '`') {
        const r = this.codeSpan(k, to);
        if (r !== null) {
          k = r.end - 1;
          continue;
        }
      }
      if (this.s.startsWith(delim, k) && !/\s/.test(this.s[k - 1] ?? ' ')) return k;
    }
    return -1;
  }

  private supSub(i: number, to: number, ch: string): { node: Inline; end: number } | null {
    for (let k = i + 1; k < to; k++) {
      const c = this.s[k] as string;
      if (c === '\\') {
        k++;
        continue;
      }
      if (/\s/.test(c)) return null;
      if (c === ch) {
        if (k === i + 1) return null;
        return { node: { t: ch === '^' ? 'sup' : 'sub', children: this.run(i + 1, k) }, end: k + 1 };
      }
    }
    return null;
  }

  /** Emphasis or strong emphasis opening at i (pandoc's rules, simplified to balanced runs). */
  private emphasis(i: number, to: number, before: readonly Inline[]): { nodes: Inline[]; end: number } | null {
    const s = this.s;
    const ch = s[i] as string;
    let n = 0;
    while (s[i + n] === ch) n++;
    const after = s[i + n];
    if (after === undefined || i + n >= to || /\s/.test(after)) return null;
    // `_` inside a word is a letter (intraword_underscores).
    const prev = i > 0 ? s[i - 1] : undefined;
    if (ch === '_' && prev !== undefined && WORD_CHAR.test(prev)) return null;
    void before;
    const tryClose = (count: number): number => {
      for (let k = i + count; k < to; k++) {
        const c = s[k];
        if (c === '\\') {
          k++;
          continue;
        }
        if (c === '`') {
          const r = this.codeSpan(k, to);
          if (r !== null) {
            k = r.end - 1;
            continue;
          }
        }
        if (c === '[') {
          const r = this.link(k, to);
          if (r !== null) {
            k = r.end - 1;
            continue;
          }
        }
        if (c !== ch) continue;
        let m = 0;
        while (s[k + m] === ch) m++;
        if (/\s/.test(s[k - 1] ?? ' ')) {
          k += m - 1;
          continue;
        }
        if (ch === '_' && s[k + m] !== undefined && WORD_CHAR.test(s[k + m] as string)) {
          k += m - 1;
          continue;
        }
        if (m === count || (m > count && count < 3)) {
          // A longer closing run closes the inner emphasis first (`***a** b*`).
          return m === count ? k : k + (m - count);
        }
        if (m < count) {
          k += m - 1;
          continue;
        }
        k += m - 1;
      }
      return -1;
    };
    const count = Math.min(n, 3);
    if (count === 3) {
      const end = tryClose(3);
      if (end !== -1) return { nodes: [{ t: 'strong', children: [{ t: 'emph', children: this.run(i + 3, end) }] }], end: end + 3 };
      const e2 = tryClose(2);
      if (e2 !== -1) return { nodes: [{ t: 'text', text: ch }, { t: 'strong', children: this.run(i + 3, e2) }], end: e2 + 2 };
      return null;
    }
    const end = tryClose(count);
    if (end === -1) return null;
    const children = this.run(i + count, end);
    if (children.length === 0) return null;
    return { nodes: [{ t: count === 2 ? 'strong' : 'emph', children }], end: end + count };
  }

  /** `[text](dest "title")` at i: the link's children, target and end; null when it is not one. */
  link(i: number, to: number): { children: Inline[]; href: string; end: number } | null {
    const s = this.s;
    let depth = 0;
    let k = i;
    for (; k < to; k++) {
      const c = s[k];
      if (c === '\\') {
        k++;
        continue;
      }
      if (c === '`') {
        const r = this.codeSpan(k, to);
        if (r !== null) {
          k = r.end - 1;
          continue;
        }
      }
      if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (k >= to || s[k + 1] !== '(') return null;
    const dest = /^\(\s*(<[^<>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+("[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/.exec(s.slice(k + 1, to));
    if (dest === null) return null;
    let href = dest[1] as string;
    if (href.startsWith('<')) href = href.slice(1, -1);
    href = href.replace(/\\([!-/:-@[-`{-~])/g, '$1');
    return { children: this.run(i + 1, k), href, end: k + 1 + dest[0].length };
  }
}

/** Parse inline Markdown into inlines (white space normalised, trimmed). */
export function parseInlines(text: string, literal: Set<string> = new Set()): Inline[] {
  const p = new InlineParser(text, literal);
  return trimInlines(normalizeSpaces(deepNormalize(p.run(0, text.length))));
}

function deepNormalize(nodes: Inline[]): Inline[] {
  return nodes.map((n) => {
    if ('children' in n && n.t !== 'link') return { t: n.t, children: normalizeSpaces(deepNormalize([...n.children])) } as Inline;
    if (n.t === 'link') return { t: 'link', href: n.href, children: normalizeSpaces(deepNormalize([...n.children])) };
    return n;
  });
}

// ---------------------------------------------------------------------------
// Typography (pandoc's `smart` extension), applied by the writers
// ---------------------------------------------------------------------------

/**
 * Text with pandoc's smart typography: `---` → em dash, `--` → en dash,
 * `...` → ellipsis, straight quotes → curly quotes (an apostrophe inside or at
 * the end of a word → ’). `prev` is the character before this text (for the
 * opening/closing decision across inline boundaries).
 */
export function smartText(text: string, prev = ' '): string {
  let out = '';
  let last = prev;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === '-' && text[i + 1] === '-') {
      if (text[i + 2] === '-') {
        out += '—';
        i += 2;
      } else {
        out += '–';
        i += 1;
      }
      last = out[out.length - 1] as string;
      continue;
    }
    if (ch === '.' && text[i + 1] === '.' && text[i + 2] === '.') {
      out += '…';
      i += 2;
      last = '…';
      continue;
    }
    if (ch === '"') {
      const opening = /[\s([{—–-]/u.test(last) || last === '';
      out += opening ? '“' : '”';
      last = out[out.length - 1] as string;
      continue;
    }
    if (ch === "'") {
      const next = text[i + 1] ?? ' ';
      const opening = (/[\s([{—–-]/u.test(last) || last === '') && !/\s/.test(next);
      out += opening && !/\d/.test(next) ? '‘' : '’';
      last = out[out.length - 1] as string;
      continue;
    }
    out += ch;
    last = ch;
  }
  return out;
}
