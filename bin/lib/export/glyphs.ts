// bin/lib/export/glyphs.ts — the characters a PDF can show (EXP-09, review
// round 1).
//
// Every PDF path prints a character it has no glyph for as `?` — never as
// nothing, never silently: the exporter names those characters in a
// `pensmith export: note —` line.
//
//   - The built-in PDF writer draws in the shipped Liberation Serif
//     (pdf-writer.ts): drawableText() folds a character the font lacks to one
//     it has (a non-breaking hyphen U+2011 to the hyphen, the thin and narrow
//     spaces to a space, invisible format characters to nothing, a
//     compatibility form to its NFKC spelling) and only then prints `?`.
//   - pandoc with pdfLaTeX gets a header declaring every character of the
//     document its T1 / utf8 set-up cannot print (latex-writer.ts
//     latexCharFor: Greek and the common symbols as math, sub- and
//     superscript digits, the folds) — `?` for the rest — so β, ≥ and ₂ no
//     longer stop pdfLaTeX (which sent the PDF to the built-in writer).
//   - pandoc with a XeTeX-family engine (xelatex, lualatex, tectonic) gets a
//     header that sets the same Liberation Serif as the main font (pandoc's
//     default Latin Modern has no Greek or math symbols: they vanished) and
//     makes each character the font lacks print as `?` (or its fold).
//
// documentChars() is the text a writer prints (the body, the notes, the
// rendered citations and the bibliography), so the note names exactly the
// characters of the paper that were replaced.

import { readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { pluginTemplatePath } from '../paths.js';
import type { ExportDocument } from './document.js';
import type { Block, Inline } from './markdown.js';

/** The shipped serif family the PDF paths print in (plugin templates/fonts/). */
export const PDF_FONT_FILES = {
  regular: 'LiberationSerif-Regular.ttf',
  italic: 'LiberationSerif-Italic.ttf',
  bold: 'LiberationSerif-Bold.ttf',
  boldItalic: 'LiberationSerif-BoldItalic.ttf',
} as const;

/** Format characters with no width: printed as nothing. */
const INVISIBLE = new Set(['­', '​', '‌', '‍', '⁠', '﻿']);

/** Space characters other than the plain and the no-break space. */
function isOtherSpace(cp: number): boolean {
  return (cp >= 0x2000 && cp <= 0x200a) || cp === 0x202f || cp === 0x205f || cp === 0x3000;
}

/**
 * The drawable spellings to try, in order, for a character a font lacks (the
 * character itself is tried first by the caller): the hyphen family to the
 * hyphen and then the hyphen-minus, other spaces to a space, the minus sign to
 * the hyphen-minus, and the character's NFKC spelling (a ligature, a
 * full-width letter, a compatibility digit).
 */
export function foldCandidates(ch: string): string[] {
  const cp = ch.codePointAt(0) as number;
  if (INVISIBLE.has(ch)) return [''];
  const out: string[] = [];
  if (cp === 0x2011) out.push('‐', '-');
  else if (cp === 0x2010 || cp === 0x2043 || cp === 0x2212) out.push('-');
  else if (cp === 0x2012) out.push('–', '-');
  else if (cp === 0x2015) out.push('—', '-');
  else if (isOtherSpace(cp)) out.push(' ');
  const nfkc = ch.normalize('NFKC');
  if (nfkc !== ch && nfkc.length > 0) out.push(nfkc);
  return out;
}

/**
 * `text` as a font with the glyph test `has` can draw it: each character it
 * lacks folded (foldCandidates) or, failing that, printed as `?` and added to
 * `missing`. Tabs become spaces, other control characters are dropped, the
 * no-break space becomes a space when the font lacks it.
 */
export function drawableText(text: string, has: (cp: number) => boolean, missing: Set<string>): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp === 0x09) {
      out += ' ';
      continue;
    }
    if (cp < 0x20) continue;
    if (has(cp)) {
      out += ch;
      continue;
    }
    if (cp === 0xa0) {
      out += ' ';
      continue;
    }
    const fold = foldCandidates(ch).find((f) => [...f].every((c) => has(c.codePointAt(0) as number)));
    if (fold !== undefined) {
      out += fold;
      continue;
    }
    missing.add(ch);
    out += '?';
  }
  return out;
}

let regularCoverage: ((cp: number) => boolean) | null = null;

/** The glyph test of the shipped regular face (the faces cover the same characters). */
export function pdfFontHas(): (cp: number) => boolean {
  if (regularCoverage !== null) return regularCoverage;
  const font = (fontkit as unknown as { create(buf: Buffer): { hasGlyphForCodePoint(cp: number): boolean } }).create(
    readFileSync(pluginTemplatePath('fonts', PDF_FONT_FILES.regular)),
  );
  const cache = new Map<number, boolean>();
  regularCoverage = (cp: number): boolean => {
    let v = cache.get(cp);
    if (v === undefined) {
      v = font.hasGlyphForCodePoint(cp);
      cache.set(cp, v);
    }
    return v;
  };
  return regularCoverage;
}

function inlineChars(nodes: readonly Inline[], out: string[]): void {
  for (const n of nodes) {
    if (n.t === 'text' || n.t === 'code') out.push(n.text);
    else if ('children' in n) inlineChars(n.children, out);
  }
}

function blockChars(blocks: readonly Block[], out: string[]): void {
  for (const b of blocks) {
    switch (b.t) {
      case 'heading':
      case 'para':
      case 'plain':
        inlineChars(b.children, out);
        break;
      case 'quote':
        blockChars(b.blocks, out);
        break;
      case 'bullets':
      case 'ordered':
        for (const it of b.items) blockChars(it, out);
        break;
      case 'code':
        out.push(b.text);
        break;
      case 'table':
        for (const c of b.head) inlineChars(c, out);
        for (const r of b.rows) for (const c of r) inlineChars(c, out);
        break;
      default:
        break;
    }
  }
}

/** Every character a writer prints for `doc`: the body, the notes, the bibliography's title, labels and entries. */
export function documentChars(doc: ExportDocument): Set<string> {
  const parts: string[] = [];
  blockChars(doc.blocks, parts);
  for (const n of doc.notes) inlineChars(n, parts);
  if (doc.bibliography !== null) {
    parts.push(doc.bibliography.title);
    for (const e of doc.bibliography.entries) {
      if (e.label !== null) inlineChars(e.label, parts);
      inlineChars(e.body, parts);
    }
  }
  return new Set([...parts.join('')]);
}

/** The export note for characters printed as `?`: `<n> character(s) <what>: 注 (U+6CE8), … — <remedy>`. */
export function unprintableNote(chars: readonly string[], what: string, remedy: string): string {
  const shown = chars.slice(0, 12).map((c) => `${c} (U+${(c.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')})`).join(', ');
  const more = chars.length > 12 ? ` and ${chars.length - 12} more` : '';
  return `${chars.length} character(s) ${what}: ${shown}${more} — ${remedy}`;
}
