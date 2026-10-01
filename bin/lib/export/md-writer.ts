// bin/lib/export/md-writer.ts — the Markdown export (D-21-02, D-21-04).
//
// The md export is ALWAYS this writer, never pandoc: its output must not
// depend on what is installed, and pandoc's Markdown writer adds `:::` divs and
// escapes. It writes the gated text byte for byte except where a citation
// stood (render.ts placed it): an in-text citation as its rendered text, a
// note as a `[^n]` marker whose definition follows the bibliography, a
// superscript as `^…^`. The bibliography follows a `## References` (or, for a
// note style, `## Bibliography`) heading, one paragraph per entry, as pandoc
// prints it. Rendered text is escaped so a Markdown reader shows exactly what
// citeproc printed (never a new emphasis, link or citation).

import type { RichRun } from '../citations.js';
import type { PreparedText } from './render.js';

/** Markdown-escape rendered text: every character a reader could take as markup. */
export function escapeMarkdownText(s: string): string {
  return s
    .replace(/[\\`*_[\]<>^~@#|$]/g, '\\$&')
    .replace(/&(?=#?[A-Za-z0-9]+;)/g, '\\&');
}

/** True when a link's text is its own target (an autolink). */
function isAutolink(r: RichRun): boolean {
  return r.href !== undefined && r.text === r.href && /^[a-z][a-z0-9+.-]*:\S+$/i.test(r.href);
}

/** One run as Markdown: emphasis, strong, superscript, subscript, small caps and links, white space kept outside the markers. */
function runMarkdown(r: RichRun): string {
  const lead = /^\s*/u.exec(r.text)?.[0] ?? '';
  const trail = /\s*$/u.exec(r.text.slice(lead.length))?.[0] ?? '';
  const core = r.text.slice(lead.length, r.text.length - trail.length);
  if (core === '') return r.text;
  let s: string;
  if (isAutolink(r)) s = `<${r.href}>`;
  else {
    s = escapeMarkdownText(core);
    if (r.sup === true || r.sub === true) s = s.replace(/ /g, '\\ ');
    if (r.bold === true && r.italic === true) s = `***${s}***`;
    else if (r.bold === true) s = `**${s}**`;
    else if (r.italic === true) s = `*${s}*`;
    if (r.smallCaps === true) s = `[${s}]{.smallcaps}`;
    if (r.href !== undefined) s = `[${s}](${r.href.replace(/[()\s]/g, (c) => encodeURIComponent(c))})`;
  }
  if (r.sup === true) s = `^${s}^`;
  else if (r.sub === true) s = `~${s}~`;
  return lead + s + trail;
}

/** Runs as Markdown text. */
export function runsMarkdown(runs: readonly RichRun[]): string {
  return runs.map(runMarkdown).join('');
}

/** The note label of note `n`: `[^n]`, or `[^cite-n]` when the text already uses footnote labels. */
function noteLabel(prep: PreparedText, n: number): string {
  return prep.text.includes('[^') ? `cite-${n}` : String(n);
}

/** The gated text with every placed citation written as Markdown (no bibliography, no note definitions). */
export function markdownBody(prep: PreparedText): string {
  let out = '';
  let at = 0;
  for (const p of prep.placed) {
    out += prep.text.slice(at, p.start);
    for (const part of p.parts) {
      if (part.kind === 'text') out += part.text;
      else if (part.kind === 'runs') out += runsMarkdown(part.runs);
      else out += `[^${noteLabel(prep, part.n)}]`;
    }
    at = p.end;
  }
  return out + prep.text.slice(at);
}

/** One bibliography entry as one Markdown paragraph (its margin label first, as pandoc prints it). */
export function bibEntryMarkdown(entry: { readonly label: readonly RichRun[] | null; readonly runs: readonly RichRun[] }): string {
  const body = runsMarkdown(entry.runs);
  const line = entry.label !== null ? `${runsMarkdown(entry.label)} ${body}` : body;
  // A paragraph that opens like a list item (`1. Kuhn TS.`) must stay a paragraph.
  return line.replace(/^(\d+)([.)])/u, '$1\\$2').replace(/^([-+])(?=\s)/u, '\\$1');
}

/**
 * The whole Markdown export: the body, then the bibliography under its
 * heading (when `withBibliography` and there is one), then the note
 * definitions. Ends with one newline.
 */
export function writeMarkdown(prep: PreparedText, opts: { readonly withBibliography: boolean }): string {
  let out = markdownBody(prep).replace(/\s+$/u, '');
  if (opts.withBibliography && prep.bibliography.length > 0) {
    out += `\n\n## ${prep.referencesTitle}\n\n` + prep.bibliography.map(bibEntryMarkdown).join('\n\n');
  }
  if (prep.notes.length > 0) {
    out += '\n\n' + prep.notes.map((runs, i) => `[^${noteLabel(prep, i + 1)}]: ${runsMarkdown(runs)}`).join('\n\n');
  }
  return `${out}\n`;
}
