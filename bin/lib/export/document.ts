// bin/lib/export/document.ts — the document model the built-in docx, PDF and
// LaTeX writers serialise (D-21-10).
//
// buildExportDocument reads the gated text with the Markdown subset reader
// (markdown.ts) and puts each placed citation (render.ts) where it stood: an
// in-text citation as its rendered runs, a note as a reference to its
// footnote. The citations travel through the reader as private placeholders
// (never as text a Markdown reader could interpret), so a rendered citation is
// never re-read as Markdown and a writer can add nothing but the rendering of
// what the gate read (D-21-12). Author text gets pandoc's smart typography
// (curly quotes, dashes, ellipses); citeproc's text is used as citeproc wrote it.

import type { RichRun } from '../citations.js';
import { parseMarkdown, smartText, type Block, type Inline } from './markdown.js';
import type { PreparedText } from './render.js';

/** One bibliography entry: its margin label (a numeric style's `[1]`) and its text. */
export interface DocumentBibEntry {
  readonly label: readonly Inline[] | null;
  readonly body: readonly Inline[];
}

/** What the built-in writers serialise. */
export interface ExportDocument {
  /** The body, the paper's `# title` included as a level-1 heading. */
  readonly blocks: readonly Block[];
  /** Note n is `notes[n - 1]`. */
  readonly notes: ReadonlyArray<readonly Inline[]>;
  /** The bibliography under its heading, or null when there is none to print. */
  readonly bibliography: {
    readonly title: string;
    readonly hangingIndent: boolean;
    readonly entries: readonly DocumentBibEntry[];
  } | null;
  /** The constructs outside the Markdown subset that were written as text (one line each). */
  readonly literal: readonly string[];
}

const RUNS_OPEN = '';
const NOTE_OPEN = '';
const CLOSE = '';
const PLACEHOLDER_RE = /([])(\d+)/g;

/** Rich-text runs as inlines (superscript and subscript outermost, then link, small caps, bold, italic). */
export function runsToInlines(runs: readonly RichRun[]): Inline[] {
  return runs.map((r): Inline => {
    let node: Inline = { t: 'text', text: r.text };
    if (r.italic === true) node = { t: 'emph', children: [node] };
    if (r.bold === true) node = { t: 'strong', children: [node] };
    if (r.smallCaps === true) node = { t: 'smallcaps', children: [node] };
    if (r.href !== undefined) node = { t: 'link', href: r.href, children: [node] };
    if (r.sup === true) node = { t: 'sup', children: [node] };
    else if (r.sub === true) node = { t: 'sub', children: [node] };
    return node;
  });
}

/** The last character of an inline list's text (for the smart-quote decision). */
function lastChar(nodes: readonly Inline[], fallback: string): string {
  for (let k = nodes.length - 1; k >= 0; k--) {
    const n = nodes[k] as Inline;
    if (n.t === 'text' && n.text !== '') return n.text[n.text.length - 1] as string;
    if (n.t === 'code' && n.text !== '') return n.text[n.text.length - 1] as string;
    if ('children' in n) {
      const c = lastChar(n.children, '');
      if (c !== '') return c;
    }
    if (n.t === 'break') return '\n';
  }
  return fallback;
}

/** Inlines with smart typography in their text nodes (code untouched). */
function smartInlines(nodes: readonly Inline[], prev = ' '): Inline[] {
  const out: Inline[] = [];
  let before = prev;
  for (const n of nodes) {
    if (n.t === 'text') {
      const text = smartText(n.text, before);
      out.push({ t: 'text', text });
    } else if (n.t === 'link') out.push({ t: 'link', href: n.href, children: smartInlines(n.children, before) });
    else if ('children' in n) out.push({ t: n.t, children: smartInlines(n.children, before) } as Inline);
    else out.push(n);
    before = lastChar(out, before);
  }
  return out;
}

/** Replace the placeholders in text nodes with the citation runs and note references they stand for. */
function resolvePlaceholders(nodes: readonly Inline[], runs: ReadonlyArray<readonly RichRun[]>): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    if (n.t === 'text') {
      let at = 0;
      for (const m of n.text.matchAll(PLACEHOLDER_RE)) {
        if (m.index > at) out.push({ t: 'text', text: n.text.slice(at, m.index) });
        const id = Number(m[2]);
        if (m[1] === RUNS_OPEN) out.push(...runsToInlines(runs[id] ?? []));
        else out.push({ t: 'note', n: id });
        at = m.index + m[0].length;
      }
      if (at < n.text.length) out.push({ t: 'text', text: n.text.slice(at) });
    } else if (n.t === 'link') out.push({ t: 'link', href: n.href, children: resolvePlaceholders(n.children, runs) });
    else if ('children' in n) out.push({ t: n.t, children: resolvePlaceholders(n.children, runs) } as Inline);
    else out.push(n);
  }
  return out;
}

function mapBlocks(blocks: readonly Block[], f: (inl: readonly Inline[]) => Inline[]): Block[] {
  return blocks.map((b): Block => {
    switch (b.t) {
      case 'heading':
        return { t: 'heading', level: b.level, children: f(b.children) };
      case 'para':
      case 'plain':
        return { t: b.t, children: f(b.children) };
      case 'quote':
        return { t: 'quote', blocks: mapBlocks(b.blocks, f) };
      case 'bullets':
        return { t: 'bullets', items: b.items.map((it) => mapBlocks(it, f)) };
      case 'ordered':
        return { t: 'ordered', start: b.start, style: b.style, items: b.items.map((it) => mapBlocks(it, f)) };
      case 'table':
        return { t: 'table', aligns: b.aligns, head: b.head.map(f), rows: b.rows.map((r) => r.map(f)) };
      default:
        return b;
    }
  });
}

/**
 * The document model of a prepared text: its blocks with every citation
 * placed, its notes and its bibliography (`withBibliography` false leaves the
 * bibliography out — an export with `bibliography: 'none'`).
 */
export function buildExportDocument(prep: PreparedText, opts: { readonly withBibliography: boolean }): ExportDocument {
  const runs: Array<readonly RichRun[]> = [];
  let text = '';
  let at = 0;
  const literal: string[] = [];
  const source = prep.text.includes(RUNS_OPEN) || prep.text.includes(NOTE_OPEN) || prep.text.includes(CLOSE)
    ? null
    : prep.text;
  if (source === null) literal.push('private-use characters (U+E000–U+E002) in the text were replaced');
  const base = source ?? prep.text;
  const clean = (s: string): string => (source === null ? s.replace(/[-]/g, '�') : s);
  for (const p of prep.placed) {
    text += clean(base.slice(at, p.start));
    for (const part of p.parts) {
      if (part.kind === 'text') text += clean(part.text);
      else if (part.kind === 'runs') {
        text += `${RUNS_OPEN}${runs.length}${CLOSE}`;
        runs.push(part.runs);
      } else text += `${NOTE_OPEN}${part.n}${CLOSE}`;
    }
    at = p.end;
  }
  text += clean(base.slice(at));
  const parsed = parseMarkdown(text);
  const blocks = mapBlocks(parsed.blocks, (inl) => resolvePlaceholders(smartInlines(inl), runs));
  const notes = prep.notes.map((n) => runsToInlines(n));
  const bibliography =
    opts.withBibliography && prep.bibliography.length > 0
      ? {
          title: prep.referencesTitle,
          hangingIndent: prep.hangingIndent || prep.bibliography.every((e) => e.label === null),
          entries: prep.bibliography.map((e) => ({ label: e.label !== null ? runsToInlines(e.label) : null, body: runsToInlines(e.runs) })),
        }
      : null;
  return { blocks, notes, bibliography, literal: [...literal, ...parsed.literal] };
}

/** The plain text of inlines (notes as nothing). */
export function inlineText(nodes: readonly Inline[]): string {
  return nodes
    .map((n) => {
      if (n.t === 'text' || n.t === 'code') return n.text;
      if (n.t === 'break') return '\n';
      if (n.t === 'note') return '';
      return inlineText(n.children);
    })
    .join('');
}
