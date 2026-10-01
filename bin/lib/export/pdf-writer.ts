// bin/lib/export/pdf-writer.ts — the built-in PDF writer (EXP-09, D-21-10).
//
// Used when pandoc or a PDF engine is missing (and when a pandoc PDF run
// fails): a requested PDF is always a PDF (D-21-02). It lays the document
// model (document.ts) out on US Letter pages with one-inch margins in an OFL
// serif family shipped with the plugin (Liberation Serif — regular, italic,
// bold, bold italic — in the plugin's templates/fonts/, with its licence
// OFL.txt; read through paths.ts pluginTemplatePath and subset on embed, so a
// PDF carries only the glyphs it uses): the title centred, headings, wrapped
// paragraphs (ragged right, no hyphenation), emphasis, strong, small caps,
// strikeout, superscript and subscript, code, block quotes, bullet and ordered
// lists, pipe tables, horizontal rules, page footnotes (a note that does not
// fit continues at the foot of the next page), the bibliography with hanging
// indents, and page numbers. The text is real text: pdf-text.ts extracts it.
//
// Zero trace (D-21-08): the document is created without pdf-lib's metadata
// (no Producer, Creator or dates in /Info) and carries no XMP; the export's
// scanner (zero-trace.ts) checks it like any other file.

import { readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { pluginTemplatePath } from '../paths.js';
import type { Block, Inline, ListStyle } from './markdown.js';
import type { ExportDocument } from './document.js';
import { drawableText, PDF_FONT_FILES } from './glyphs.js';

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 72;
const TEXT_W = PAGE_W - 2 * MARGIN;
const BODY = 11;
const LEAD = 1.32;
const NOTE_SIZE = 9;
const NOTE_GAP = 10;

/** The four faces of the shipped serif family. */
const FONT_FILES = PDF_FONT_FILES;

/** The shipped font files' paths (the PDF writer cannot run without them). */
export function pdfFontPaths(): string[] {
  return Object.values(FONT_FILES).map((f) => pluginTemplatePath('fonts', f));
}

interface Fonts {
  readonly regular: PDFFont;
  readonly italic: PDFFont;
  readonly bold: PDFFont;
  readonly boldItalic: PDFFont;
}

/** The style of one stretch of text. */
interface TextStyle {
  readonly italic: boolean;
  readonly bold: boolean;
  readonly code: boolean;
  readonly sup: boolean;
  readonly sub: boolean;
  readonly smallCaps: boolean;
  readonly strike: boolean;
}

const PLAIN: TextStyle = { italic: false, bold: false, code: false, sup: false, sub: false, smallCaps: false, strike: false };

/** One unbreakable piece of a line: a word (or part of one), with its style, or a note reference. */
interface Atom {
  readonly text: string;
  readonly style: TextStyle;
  /** White space before this atom (a break opportunity). */
  readonly spaceBefore: boolean;
  readonly note?: number;
  readonly hardBreak?: boolean;
}

/** A laid-out piece of a line. */
interface Seg {
  readonly text: string;
  readonly font: PDFFont;
  readonly size: number;
  readonly x: number;
  readonly rise: number;
  readonly strike: boolean;
  readonly width: number;
}

/** A laid-out line: its segments, its height and the notes it references. */
interface Line {
  readonly segs: Seg[];
  readonly height: number;
  readonly notes: number[];
  /** Extra space above the line (between blocks). */
  readonly before: number;
}

const charSets = new WeakMap<PDFFont, Set<number>>();

/**
 * `text` as `font` can draw it (glyphs.ts drawableText): a character it lacks
 * is folded to one it has, else drawn as `?` (never a hidden .notdef) and
 * recorded in `missing` — the exporter names those characters in a note.
 */
function coverable(font: PDFFont, text: string, missing: Set<string>): string {
  let set = charSets.get(font);
  if (set === undefined) {
    set = new Set(font.getCharacterSet());
    charSets.set(font, set);
  }
  const has = set;
  return drawableText(text, (cp) => has.has(cp), missing);
}

function fontFor(fonts: Fonts, s: TextStyle): PDFFont {
  if (s.bold && s.italic) return fonts.boldItalic;
  if (s.bold) return fonts.bold;
  if (s.italic) return fonts.italic;
  return fonts.regular;
}

/** Flatten inlines into atoms (words), each with its style. */
function atomize(nodes: readonly Inline[], style: TextStyle = PLAIN, out: Atom[] = [], state = { space: false }): Atom[] {
  for (const n of nodes) {
    switch (n.t) {
      case 'text': {
        const parts = n.text.split(/( +)/);
        for (const p of parts) {
          if (p === '') continue;
          if (/^ +$/.test(p)) {
            state.space = true;
            continue;
          }
          out.push({ text: p, style, spaceBefore: state.space });
          state.space = false;
        }
        break;
      }
      case 'code':
        out.push({ text: n.text, style: { ...style, code: true }, spaceBefore: state.space });
        state.space = false;
        break;
      case 'break':
        out.push({ text: '', style, spaceBefore: false, hardBreak: true });
        state.space = false;
        break;
      case 'note':
        out.push({ text: String(n.n), style: { ...style, sup: true }, spaceBefore: false, note: n.n });
        break;
      case 'emph':
        atomize(n.children, { ...style, italic: !style.italic }, out, state);
        break;
      case 'strong':
        atomize(n.children, { ...style, bold: true }, out, state);
        break;
      case 'strike':
        atomize(n.children, { ...style, strike: true }, out, state);
        break;
      case 'sup':
        atomize(n.children, { ...style, sup: true }, out, state);
        break;
      case 'sub':
        atomize(n.children, { ...style, sub: true }, out, state);
        break;
      case 'smallcaps':
        atomize(n.children, { ...style, smallCaps: true }, out, state);
        break;
      case 'link':
        atomize(n.children, style, out, state);
        break;
    }
  }
  return out;
}

/** The PDF typesetter: pages, the cursor, the footnote area. */
class Typesetter {
  readonly doc: PDFDocument;
  readonly fonts: Fonts;
  readonly notes: ReadonlyArray<readonly Inline[]>;
  private page!: PDFPage;
  private y = 0;
  private foot: Line[] = [];
  private footHeight = 0;
  private pendingFoot: Line[] = [];
  private pageNo = 0;
  private readonly notesPlaced = new Set<number>();
  /** The characters drawn as `?` (no glyph in the font, no fold). */
  readonly missing: Set<string>;

  constructor(doc: PDFDocument, fonts: Fonts, notes: ReadonlyArray<readonly Inline[]>, missing: Set<string>) {
    this.doc = doc;
    this.fonts = fonts;
    this.notes = notes;
    this.missing = missing;
    this.newPage();
  }

  private newPage(): void {
    if (this.pageNo > 0) this.finishPage();
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pageNo += 1;
    this.y = PAGE_H - MARGIN;
    this.foot = [];
    this.footHeight = 0;
    // A note that did not fit continues at the foot of this page.
    const carried = this.pendingFoot;
    this.pendingFoot = [];
    for (const l of carried) this.addFootLine(l);
  }

  private addFootLine(l: Line): void {
    this.foot.push(l);
    this.footHeight += l.height;
  }

  private bottom(extraFoot = 0): number {
    const h = this.footHeight + extraFoot;
    return MARGIN + (h > 0 ? h + NOTE_GAP : 0);
  }

  /** Finish the document: the last page, and as many more as the notes still waiting need. */
  finish(): void {
    while (this.pendingFoot.length > 0) this.newPage();
    this.finishPage();
  }

  private finishPage(): void {
    // The footnotes, under a short rule.
    if (this.foot.length > 0) {
      let y = MARGIN + this.footHeight;
      this.page.drawLine({ start: { x: MARGIN, y: y + NOTE_GAP / 2 }, end: { x: MARGIN + TEXT_W / 3, y: y + NOTE_GAP / 2 }, thickness: 0.4, color: rgb(0, 0, 0) });
      for (const l of this.foot) {
        this.drawLine(l, y);
        y -= l.height;
      }
    }
    const num = String(this.pageNo);
    const w = this.fonts.regular.widthOfTextAtSize(num, 9);
    this.page.drawText(num, { x: (PAGE_W - w) / 2, y: MARGIN / 2, size: 9, font: this.fonts.regular });
  }

  /** Draw a line whose top is at `top`. */
  private drawLine(l: Line, top: number): void {
    const baseline = top - l.height * 0.78;
    for (const s of l.segs) {
      if (s.text === '') continue;
      this.page.drawText(s.text, { x: s.x, y: baseline + s.rise, size: s.size, font: s.font, color: rgb(0, 0, 0) });
      if (s.strike) {
        const yy = baseline + s.rise + s.size * 0.3;
        this.page.drawLine({ start: { x: s.x, y: yy }, end: { x: s.x + s.width, y: yy }, thickness: 0.5, color: rgb(0, 0, 0) });
      }
    }
  }

  /** The lines of note n at the footnote size (its number first). */
  private noteLines(n: number): Line[] {
    const body = this.notes[n - 1] ?? [];
    const atoms: Atom[] = [{ text: String(n), style: { ...PLAIN, sup: true }, spaceBefore: false }, ...atomize(body, PLAIN, [], { space: true })];
    return this.breakLines(atoms, { left: MARGIN, width: TEXT_W, size: NOTE_SIZE, align: 'left', hangIndent: 0 }).map((l) => ({ ...l, before: 0 }));
  }

  /** Space (a gap between blocks) — dropped at the top of a page. */
  gap(pts: number): void {
    if (this.y < PAGE_H - MARGIN - 0.5) this.y -= pts;
  }

  /** Start a new page unless `need` points of body still fit on this one. */
  ensure(need: number): void {
    if (this.y - need < this.bottom()) this.newPage();
  }

  /** The note lines of the notes in `notes` not placed yet. */
  private freshNoteLines(notes: readonly number[]): { fresh: number[]; lines: Line[] } {
    const fresh = notes.filter((n, i) => !this.notesPlaced.has(n) && notes.indexOf(n) === i);
    return { fresh, lines: fresh.flatMap((n) => this.noteLines(n)) };
  }

  /** Put note lines at the foot of this page, or carry them to the next one. */
  private queueNotes(fresh: readonly number[], noteLines: readonly Line[]): void {
    for (const n of fresh) this.notesPlaced.add(n);
    for (const nl of noteLines) {
      if (this.pendingFoot.length === 0 && this.y >= this.bottom(nl.height)) this.addFootLine(nl);
      else this.pendingFoot.push(nl);
    }
  }

  /** Place one body line with its notes (see the module header for the footnote rule); returns where it was drawn. */
  place(l: Line): { page: PDFPage; top: number } {
    const { fresh, lines: noteLines } = this.freshNoteLines(l.notes);
    const noteH = noteLines.reduce((a, x) => a + x.height, 0);
    const fitsAll = this.y - l.height >= this.bottom(noteH);
    const firstH = noteLines[0]?.height ?? 0;
    const fitsSome = noteLines.length > 0 && this.y - l.height >= this.bottom(firstH);
    if (!fitsAll && !fitsSome && this.y < PAGE_H - MARGIN - 0.5) {
      this.newPage();
      return this.place(l);
    }
    const at = { page: this.page, top: this.y };
    this.drawLine(l, this.y);
    this.y -= l.height;
    this.queueNotes(fresh, noteLines);
    return at;
  }

  /** Lay out atoms into lines (greedy, ragged right). */
  breakLines(
    atoms: readonly Atom[],
    o: { left: number; width: number; size: number; align: 'left' | 'center'; hangIndent: number; firstIndent?: number },
  ): Line[] {
    const lines: Line[] = [];
    let cur: Array<{ atom: Atom; text: string; width: number; font: PDFFont; size: number; rise: number }> = [];
    let curW = 0;
    let lineNo = 0;
    const widthOf = (lineIdx: number): number => o.width - (lineIdx === 0 ? (o.firstIndent ?? 0) : o.hangIndent);
    const leftOf = (lineIdx: number): number => o.left + (lineIdx === 0 ? (o.firstIndent ?? 0) : o.hangIndent);
    const measure = (a: Atom): { text: string; width: number; font: PDFFont; size: number; rise: number } => {
      const font = a.style.code ? this.fonts.regular : fontFor(this.fonts, a.style);
      let size = a.style.code ? o.size * 0.92 : o.size;
      let text = a.text;
      if (a.style.smallCaps) {
        text = text.toUpperCase();
        size *= 0.82;
      }
      let rise = 0;
      if (a.style.sup) {
        size *= 0.68;
        rise = o.size * 0.36;
      } else if (a.style.sub) {
        size *= 0.68;
        rise = -o.size * 0.16;
      }
      text = coverable(font, text, this.missing);
      return { text, width: font.widthOfTextAtSize(text, size), font, size, rise };
    };
    const space = this.fonts.regular.widthOfTextAtSize(' ', o.size);
    const flush = (): void => {
      // Merge runs of the same font, size and rise into one drawn string (spaces included), so extraction keeps the words apart.
      const segs: Seg[] = [];
      let x = leftOf(lineNo);
      if (o.align === 'center') x += (widthOf(lineNo) - curW) / 2;
      for (const [i, c] of cur.entries()) {
        const gap = i > 0 && c.atom.spaceBefore ? space : 0;
        const last = segs[segs.length - 1];
        if (last !== undefined && last.font === c.font && last.size === c.size && last.rise === c.rise && last.strike === c.atom.style.strike) {
          const text = last.text + (gap > 0 ? ' ' : '') + c.text;
          segs[segs.length - 1] = { ...last, text, width: last.width + gap + c.width };
        } else {
          // A segment after a space starts with that space, so a text extractor keeps the words apart.
          segs.push({ text: (gap > 0 ? ' ' : '') + c.text, font: c.font, size: c.size, x, rise: c.rise, strike: c.atom.style.strike, width: gap + c.width });
        }
        x += gap + c.width;
      }
      lines.push({ segs, height: o.size * LEAD, notes: cur.filter((c) => c.atom.note !== undefined).map((c) => c.atom.note as number), before: 0 });
      cur = [];
      curW = 0;
      lineNo += 1;
    };
    for (const a of atoms) {
      if (a.hardBreak === true) {
        flush();
        continue;
      }
      let m = measure(a);
      const gap = cur.length > 0 && a.spaceBefore ? space : 0;
      if (cur.length > 0 && curW + gap + m.width > widthOf(lineNo)) flush();
      // A word longer than the line is cut where it no longer fits. The cut
      // is found from per-character advances summed once (review round 3:
      // re-measuring every shorter prefix took minutes on a long URL, hash or
      // code line), then confirmed with one real measurement (kerning).
      if (cur.length === 0 && m.width > widthOf(lineNo) && m.text.length > 1) {
        const chars = Array.from(m.text);
        const advance = new Map<string, number>();
        const cum: number[] = [0];
        for (const ch of chars) {
          let w = advance.get(ch);
          if (w === undefined) {
            w = m.font.widthOfTextAtSize(ch, m.size);
            advance.set(ch, w);
          }
          cum.push((cum[cum.length - 1] as number) + w);
        }
        let from = 0;
        while (chars.length - from > 1 && (cum[chars.length] as number) - (cum[from] as number) > widthOf(lineNo)) {
          const limit = widthOf(lineNo);
          let k = from + 1;
          while (k + 1 < chars.length && (cum[k + 1] as number) - (cum[from] as number) <= limit) k += 1;
          let piece = chars.slice(from, k).join('');
          while (k > from + 1 && m.font.widthOfTextAtSize(piece, m.size) > limit) {
            k -= 1;
            piece = chars.slice(from, k).join('');
          }
          cur.push({ atom: { ...a, text: piece }, text: piece, width: m.font.widthOfTextAtSize(piece, m.size), font: m.font, size: m.size, rise: m.rise });
          curW = (cur[0] as { width: number }).width;
          flush();
          from = k;
        }
        const rest = chars.slice(from).join('');
        m = { ...m, text: rest, width: m.font.widthOfTextAtSize(rest, m.size) };
      }
      const g = cur.length > 0 && a.spaceBefore ? space : 0;
      cur.push({ atom: a, ...m });
      curW += g + m.width;
    }
    if (cur.length > 0 || lines.length === 0) flush();
    return lines;
  }

  /** Lay out and place a paragraph. */
  paragraph(nodes: readonly Inline[], o: { left: number; width: number; size: number; align?: 'left' | 'center'; hangIndent?: number; before?: number; after?: number; keepWithNext?: boolean; marker?: string }): void {
    const atoms = atomize(nodes);
    const lines = this.breakLines(atoms, { left: o.left, width: o.width, size: o.size, align: o.align ?? 'left', hangIndent: o.hangIndent ?? 0 });
    this.gap(o.before ?? 0);
    if (o.keepWithNext === true) this.ensure(lines.reduce((a, l) => a + l.height, 0) + BODY * LEAD * 2);
    lines.forEach((l, i) => {
      this.ensure(l.height);
      const at = this.place(l);
      if (i === 0 && o.marker !== undefined) {
        const font = this.fonts.regular;
        const marker = coverable(font, o.marker, this.missing);
        const w = font.widthOfTextAtSize(marker, o.size);
        at.page.drawText(marker, { x: o.left - w - 5, y: at.top - l.height * 0.78, size: o.size, font, color: rgb(0, 0, 0) });
      }
    });
    this.gap(o.after ?? 0);
  }

  rule(): void {
    this.gap(4);
    this.ensure(8);
    this.page.drawLine({ start: { x: MARGIN + TEXT_W * 0.25, y: this.y - 4 }, end: { x: MARGIN + TEXT_W * 0.75, y: this.y - 4 }, thickness: 0.5, color: rgb(0, 0, 0) });
    this.y -= 8;
    this.gap(6);
  }

  code(text: string, left: number, width: number): void {
    const size = BODY * 0.85;
    this.gap(2);
    for (const raw of text.split('\n')) {
      const atoms: Atom[] = [{ text: raw.replace(/ /g, ' ') || ' ', style: { ...PLAIN, code: true }, spaceBefore: false }];
      for (const l of this.breakLines(atoms, { left, width, size, align: 'left', hangIndent: 0 })) {
        this.ensure(l.height);
        this.place(l);
      }
    }
    this.gap(6);
  }

  table(b: Extract<Block, { t: 'table' }>, left: number, width: number): void {
    const cols = Math.max(b.head.length, 1);
    const colW = width / cols;
    const size = BODY * 0.9;
    const pad = 4;
    const row = (cells: ReadonlyArray<readonly Inline[]>, header: boolean): void => {
      const laid = cells.map((c, i) =>
        this.breakLines(atomize(header ? [{ t: 'strong', children: c }] : c), {
          left: left + i * colW + pad,
          width: colW - 2 * pad,
          size,
          align: b.aligns[i] === 'center' ? 'center' : 'left',
          hangIndent: 0,
        }),
      );
      const h = Math.max(...laid.map((ls) => ls.reduce((a, l) => a + l.height, 0))) + 2 * pad;
      // A note cited in a cell goes to the foot like any other (its marker
      // is drawn with the row; review round 1: the note text was lost).
      const { fresh, lines: noteLines } = this.freshNoteLines(laid.flatMap((ls) => ls.flatMap((l) => l.notes)));
      const noteH = noteLines.reduce((a, x) => a + x.height, 0);
      if (this.y - h < this.bottom(noteLines.length > 0 ? noteH : 0) && this.y < PAGE_H - MARGIN - 0.5) this.newPage();
      const top = this.y;
      laid.forEach((ls) => {
        let y = top - pad;
        for (const l of ls) {
          this.drawLine(l, y);
          y -= l.height;
        }
      });
      for (let i = 0; i <= cols; i++) {
        this.page.drawLine({ start: { x: left + i * colW, y: top }, end: { x: left + i * colW, y: top - h }, thickness: 0.4, color: rgb(0, 0, 0) });
      }
      this.page.drawLine({ start: { x: left, y: top }, end: { x: left + width, y: top }, thickness: 0.4, color: rgb(0, 0, 0) });
      this.page.drawLine({ start: { x: left, y: top - h }, end: { x: left + width, y: top - h }, thickness: 0.4, color: rgb(0, 0, 0) });
      this.y -= h;
      this.queueNotes(fresh, noteLines);
    };
    this.gap(4);
    row(b.head, true);
    for (const r of b.rows) row(r, false);
    this.gap(8);
  }
}

const HEADING_SIZES = [17, 14, 12.5, 11.5, 11, 11];

function romanize(n: number): string {
  const table: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  let v = n;
  for (const [k, s] of table) while (v >= k) {
    out += s;
    v -= k;
  }
  return out;
}

function listLabel(style: ListStyle, n: number): string {
  switch (style) {
    case 'lower-alpha':
      return `${String.fromCharCode(96 + (((n - 1) % 26) + 1))}.`;
    case 'upper-alpha':
      return `${String.fromCharCode(64 + (((n - 1) % 26) + 1))}.`;
    case 'lower-roman':
      return `${romanize(n)}.`;
    case 'upper-roman':
      return `${romanize(n).toUpperCase()}.`;
    default:
      return `${n}.`;
  }
}

function layoutBlocks(t: Typesetter, blocks: readonly Block[], ctx: { left: number; width: number; size: number; depth: number; marker?: string }): void {
  let marker = ctx.marker;
  for (const b of blocks) {
    switch (b.t) {
      case 'heading': {
        const size = HEADING_SIZES[Math.min(b.level, 6) - 1] as number;
        t.paragraph([{ t: 'strong', children: b.children }], {
          left: ctx.left, width: ctx.width, size, align: b.level === 1 ? 'center' : 'left', before: b.level === 1 ? 0 : 10, after: b.level === 1 ? 14 : 4, keepWithNext: true,
        });
        break;
      }
      case 'para':
      case 'plain':
        t.paragraph(b.children, { left: ctx.left, width: ctx.width, size: ctx.size, after: b.t === 'plain' ? 2 : 7, ...(marker !== undefined ? { marker } : {}) });
        marker = undefined;
        break;
      case 'quote':
        layoutBlocks(t, b.blocks, { ...ctx, left: ctx.left + 28, width: ctx.width - 56, size: ctx.size * 0.95, depth: ctx.depth, ...(marker !== undefined ? { marker } : {}) });
        marker = undefined;
        break;
      case 'bullets':
      case 'ordered':
        b.items.forEach((item, i) => {
          const label = b.t === 'bullets' ? ['•', '◦', '▪'][ctx.depth % 3] as string : listLabel(b.style, b.start + i);
          layoutBlocks(t, item.length > 0 ? item : [{ t: 'plain', children: [] }], { left: ctx.left + 22, width: ctx.width - 22, size: ctx.size, depth: ctx.depth + 1, marker: label });
        });
        t.gap(4);
        break;
      case 'code':
        t.code(b.text, ctx.left + 12, ctx.width - 12);
        break;
      case 'hr':
        t.rule();
        break;
      case 'table':
        t.table(b, ctx.left, ctx.width);
        break;
    }
  }
}

/**
 * The PDF bytes of a document. Every character the font cannot show (and no
 * fold replaces) is drawn as `?` and added to `missing` (glyphs.ts), so the
 * exporter can name it.
 */
export async function writePdf(doc: ExportDocument, missing: Set<string> = new Set()): Promise<Buffer> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.registerFontkit(fontkit as unknown as Parameters<typeof pdf.registerFontkit>[0]);
  const embed = async (file: string): Promise<PDFFont> => pdf.embedFont(readFileSync(pluginTemplatePath('fonts', file)), { subset: true });
  const fonts: Fonts = {
    regular: await embed(FONT_FILES.regular),
    italic: await embed(FONT_FILES.italic),
    bold: await embed(FONT_FILES.bold),
    boldItalic: await embed(FONT_FILES.boldItalic),
  };
  const t = new Typesetter(pdf, fonts, doc.notes, missing);
  layoutBlocks(t, doc.blocks, { left: MARGIN, width: TEXT_W, size: BODY, depth: 0 });
  if (doc.bibliography !== null) {
    layoutBlocks(t, [{ t: 'heading', level: 2, children: [{ t: 'text', text: doc.bibliography.title }] }], { left: MARGIN, width: TEXT_W, size: BODY, depth: 0 });
    const labelled = doc.bibliography.entries.some((e) => e.label !== null);
    const labelW = labelled
      ? Math.max(...doc.bibliography.entries.map((e) => fonts.regular.widthOfTextAtSize((e.label ?? []).map((x) => (x.t === 'text' ? x.text : '')).join(''), BODY))) + 6
      : 0;
    for (const e of doc.bibliography.entries) {
      if (labelled) {
        const label = (e.label ?? []).map((x) => (x.t === 'text' ? x.text : '')).join('');
        t.paragraph(e.body, { left: MARGIN + labelW, width: TEXT_W - labelW, size: BODY, after: 5, marker: label });
      } else {
        t.paragraph(e.body, { left: MARGIN, width: TEXT_W, size: BODY, hangIndent: 24, after: 5 });
      }
    }
  }
  t.finish();
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
