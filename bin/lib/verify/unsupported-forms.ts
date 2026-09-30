// bin/lib/verify/unsupported-forms.ts — every way of attributing a source that
// the verifier cannot check against the bibliography (VRFY-10, D-20-08).
//
// Only a Pandoc citation (`[@key]` and the other forms citation-token.ts
// reads) names an entry of CITATIONS.bib, so only a Pandoc citation can be
// verified. Every other attribution — author-date prose "(Nguyen & Patel,
// 2019)", a Markdown footnote, an inline note, a reference list typed into
// the draft, a raw TeX `\cite`, HTML `<cite>` / `<sup>` markers, numbered
// `[1]` markers — would carry a fabricated source straight past Pass 1 into
// the export (the audit's V4, V6 and V7 escapes, FU1-GATE-1). Each one found is
// a blocking UNSUPPORTED-FORM row naming its text and line; the gate core runs
// this scanner over every section draft, the compiled DRAFT.md and FINAL.md.
// Notes the exporter generates for a note style are produced after the gate
// and never re-enter it.
//
// Fail closed: only the spans citation-token.ts PROVES are code (fenced blocks,
// inline code spans — provableCodeSpans, D-18-42) and TeX math (`$…$`, `$$…$$`)
// are skipped; everything else is scanned. A few shapes that are not
// citations are left alone because they cannot be mistaken for one: a lone
// name before a year ("the Treaty of Versailles (1919)"), a parenthetical
// with no name ("(n = 2019)", "(1919)", "(COVID-19)"), a year range
// ("(World War II, 1939–1945)"), an exponent ("m<sup>2</sup>", "x²"), an
// email address.
//
// PURE: no I/O. Line numbers are 1-based and count `\n`, so an LF and a CRLF
// copy of a draft report the same lines.

import { lineOfOffset, offsetInSpans, provableCodeSpans } from '../citation-token.js';
import type { TextFinding } from './verdicts.js';

/** The forms this scanner reports (TextFinding.form). */
export const UNSUPPORTED_FORMS = [
  'author-date',
  'footnote',
  'inline-note',
  'reference-list',
  'tex-cite',
  'html-cite',
  'numeric-marker',
  'superscript-marker',
] as const;
export type UnsupportedForm = (typeof UNSUPPORTED_FORMS)[number];

/** One line per form: why it blocks and what to write instead. */
export const UNSUPPORTED_FORM_REASONS: Readonly<Record<UnsupportedForm, string>> = {
  'author-date': 'an author-date citation the verifier cannot check against CITATIONS.bib — cite the source as [@citekey]',
  footnote: 'a footnote the verifier cannot check — cite the source in the text as [@citekey] (a note citation style makes the notes at export)',
  'inline-note': 'an inline note the verifier cannot check — cite the source in the text as [@citekey] (a note citation style makes the notes at export)',
  'reference-list':
    'a reference list typed into the draft, which the verifier cannot check — remove it: the export builds the bibliography from the [@citekey] citations',
  'tex-cite': 'a raw TeX citation command the verifier cannot check — write [@citekey]',
  'html-cite': 'HTML citation markup the verifier cannot check — write [@citekey]',
  'numeric-marker': 'a numbered citation marker the verifier cannot check — write [@citekey] (a numeric citation style numbers the citations at export)',
  'superscript-marker':
    'a superscript citation marker the verifier cannot check — write [@citekey] (a numeric citation style numbers the citations at export)',
};

interface RawFinding {
  readonly form: UnsupportedForm;
  readonly start: number;
  readonly end: number;
}

// ---------------------------------------------------------------------------
// Lines and skipped spans.
// ---------------------------------------------------------------------------

interface Line {
  readonly start: number;
  /** Offset of the line end (its `\r\n` / `\n` excluded). */
  readonly end: number;
  readonly text: string;
}

function linesOf(md: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (;;) {
    const nl = md.indexOf('\n', start);
    const rawEnd = nl === -1 ? md.length : nl;
    const end = rawEnd > start && md[rawEnd - 1] === '\r' ? rawEnd - 1 : rawEnd;
    out.push({ start, end, text: md.slice(start, end) });
    if (nl === -1) return out;
    start = nl + 1;
  }
}

const BLANK_RE = /^[ \t]*$/;

/**
 * TeX math spans as Pandoc's `tex_math_dollars` reads them: `$$…$$`, and `$…$`
 * whose opening `$` is followed by a non-space, whose closing `$` follows a
 * non-space and is not followed by a digit, on one line; `\$` is literal.
 */
function mathSpans(md: string, code: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /(?<!\\)\$\$[\s\S]*?(?<!\\)\$\$|(?<![\\$])\$(?![\s$])(?:\\.|[^$\\\n])*?(?<![\s\\])\$(?![\d$])/g;
  for (const m of md.matchAll(re)) {
    if (offsetInSpans(m.index, code)) continue;
    if (/\n[ \t]*\r?\n/.test(m[0])) continue; // math never spans a blank line
    out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reference lists (a heading or a bold / emphasised / lone line naming one, and
// every entry under it up to the next heading).
// ---------------------------------------------------------------------------

const REFERENCE_LIST_NAMES: ReadonlySet<string> = new Set([
  'references',
  'reference list',
  'list of references',
  'bibliography',
  'selected bibliography',
  'works cited',
  'works consulted',
  'cited works',
  'literature cited',
  'notes',
  'endnotes',
  'footnotes',
  'sources',
  'sources cited',
  'citations',
  'further reading',
]);

/** A heading or label text reduced to its name: numbering, emphasis marks, a trailing colon and case removed. */
function listName(text: string): string {
  return text
    .replace(/[*_]+/g, '')
    .replace(/^\s*(?:\d+(?:\.\d+)*\.?|[IVXLC]+\.)\s+/, '')
    .replace(/[\s:.]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t#]*$/;
const SETEXT_RULE_RE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const EMPHASIS_LINE_RE = /^[ \t]*(\*\*|__|\*|_)(?!\s)(.+?)(?<!\s)\1[ \t]*:?[ \t]*$/;
const LIST_ITEM_RE = /^[ \t]*(?:[-*+]|\d{1,3}[.)]|\[\d{1,3}\])[ \t]+/;

/** How line `i` opens a heading: 'atx', 'setext' (its next line is the rule), 'label' (bold / lone line), or null. */
function headingKind(lines: readonly Line[], i: number): 'atx' | 'setext' | 'label' | null {
  const text = (lines[i] as Line).text;
  if (ATX_RE.test(text)) return 'atx';
  const prevBlank = i === 0 || BLANK_RE.test((lines[i - 1] as Line).text);
  const next = lines[i + 1];
  if (!BLANK_RE.test(text) && prevBlank && next !== undefined && SETEXT_RULE_RE.test(next.text)) return 'setext';
  if (EMPHASIS_LINE_RE.test(text)) return 'label';
  return null;
}

function headingText(lines: readonly Line[], i: number, kind: 'atx' | 'setext' | 'label'): string {
  const text = (lines[i] as Line).text;
  if (kind === 'atx') return ATX_RE.exec(text)?.[2] ?? '';
  if (kind === 'label') return EMPHASIS_LINE_RE.exec(text)?.[2] ?? '';
  return text;
}

function referenceLists(md: string, lines: readonly Line[]): RawFinding[] {
  const out: RawFinding[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as Line;
    let kind = headingKind(lines, i);
    let name = kind === null ? '' : listName(headingText(lines, i, kind));
    // A line that is nothing but the name ("References", "Sources:") opening a paragraph.
    if (!REFERENCE_LIST_NAMES.has(name)) {
      const prevBlank = i === 0 || BLANK_RE.test((lines[i - 1] as Line).text);
      if (!prevBlank) continue;
      name = listName(line.text);
      if (!REFERENCE_LIST_NAMES.has(name) || line.text.trim().length > 40) continue;
      kind = 'label';
    }
    const headingEnd = kind === 'setext' ? (lines[i + 1] as Line).end : line.end;
    out.push({ form: 'reference-list', start: line.start, end: headingEnd });
    // Every entry up to the next heading: a list item, or a paragraph.
    let j = kind === 'setext' ? i + 2 : i + 1;
    let entry: { start: number; end: number } | null = null;
    const flush = (): void => {
      if (entry !== null) out.push({ form: 'reference-list', start: entry.start, end: entry.end });
      entry = null;
    };
    for (; j < lines.length; j += 1) {
      const l = lines[j] as Line;
      if (BLANK_RE.test(l.text)) {
        flush();
        continue;
      }
      if (headingKind(lines, j) !== null) break;
      if (entry === null || LIST_ITEM_RE.test(l.text)) {
        flush();
        entry = { start: l.start, end: l.end };
      } else {
        (entry as { start: number; end: number }).end = l.end;
      }
    }
    flush();
    i = j - 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Footnotes and inline notes.
// ---------------------------------------------------------------------------

function footnotes(md: string, lines: readonly Line[]): RawFinding[] {
  const out: RawFinding[] = [];
  const defStarts = new Set<number>();
  for (const l of lines) {
    const m = /^ {0,3}\[\^[^\]\s]+\]:/.exec(l.text);
    if (m === null) continue;
    defStarts.add(l.start + l.text.indexOf('['));
    out.push({ form: 'footnote', start: l.start + l.text.indexOf('['), end: l.end });
  }
  for (const m of md.matchAll(/\[\^[^\]\s]+\]/g)) {
    if (defStarts.has(m.index) || escaped(md, m.index)) continue;
    out.push({ form: 'footnote', start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** True when an odd run of backslashes ends just before `i`. */
function escaped(text: string, i: number): boolean {
  let n = 0;
  for (let j = i - 1; j >= 0 && text[j] === '\\'; j -= 1) n += 1;
  return n % 2 === 1;
}

/** The offset just past the `]` that closes the `[` at `open` (nesting counted), or the end of its paragraph. */
function closeBracket(md: string, open: number): number {
  let depth = 0;
  for (let i = open; i < md.length; i += 1) {
    const c = md[i];
    if (c === '\n' && /^\r?\n[ \t]*\r?\n/.test(md.slice(i))) return i;
    if (escaped(md, i)) continue;
    if (c === '[') depth += 1;
    else if (c === ']') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return md.length;
}

function inlineNotes(md: string): RawFinding[] {
  const out: RawFinding[] = [];
  for (let at = md.indexOf('^['); at !== -1; at = md.indexOf('^[', at + 2)) {
    if (escaped(md, at)) continue;
    out.push({ form: 'inline-note', start: at, end: closeBracket(md, at + 1) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Raw TeX and HTML citation markup.
// ---------------------------------------------------------------------------

const TEX_CITE_RE =
  /\\(?:[Pp]aren|[Tt]ext|[Ff]oot|[Aa]uto|[Ss]mart|[Ss]uper|[Ff]ull|[Nn]o)?[Cc]ite[A-Za-z]*\*?(?:[ \t]*\[[^\]\n]*\]){0,2}(?:[ \t]*\{[^}\n]*\})?|\\(?:bibitem|bibliography|printbibliography|addbibresource|nocite)\b(?:[ \t]*\[[^\]\n]*\])?(?:[ \t]*\{[^}\n]*\})?|\\begin[ \t]*\{thebibliography\}/g;

function texCites(md: string): RawFinding[] {
  return [...md.matchAll(TEX_CITE_RE)].map((m) => ({ form: 'tex-cite' as const, start: m.index, end: m.index + m[0].length }));
}

/** True when a plain superscript number right after `before` reads as an exponent (`m²`, `10⁶`, `x²`), not a marker. */
function exponentContext(before: string): boolean {
  const word = /[\p{L}\p{N}]+$/u.exec(before)?.[0] ?? '';
  if (word === '') return false;
  return /\p{N}$/u.test(word) || word.length <= 2;
}

/** A reference marker's content: `1`, `[1]`, `1,2`, `1–3`. */
const MARKER_CONTENT_RE = /^\s*\[?\s*\d{1,3}(?:\s*[-–—,]\s*\d{1,3})*\s*\]?\s*$/;
const PLAIN_NUMBER_RE = /^\s*\d{1,3}\s*$/;

function htmlCites(md: string): RawFinding[] {
  const out: RawFinding[] = [];
  for (const m of md.matchAll(/<cite\b[^>]*>/gi)) {
    const close = md.slice(m.index).search(/<\/cite\s*>/i);
    const end = close === -1 ? m.index + m[0].length : m.index + close + md.slice(m.index + close).indexOf('>') + 1;
    out.push({ form: 'html-cite', start: m.index, end });
  }
  for (const m of md.matchAll(/<ref\b[^>]*\/?>/gi)) out.push({ form: 'html-cite', start: m.index, end: m.index + m[0].length });
  for (const m of md.matchAll(/<sup\b[^>]*>([\s\S]*?)<\/sup\s*>/gi)) {
    const inner = m[1] as string;
    const text = inner.replace(/<[^>]*>/g, '');
    const linked = /<a\b[^>]*href\s*=\s*["']?#/i.test(inner);
    const year = /\b(?:1[5-9]|20)\d{2}\b/.test(text) && /\p{L}/u.test(text);
    const marker = MARKER_CONTENT_RE.test(text);
    if (!linked && !year && !marker) continue;
    if (!linked && !year && PLAIN_NUMBER_RE.test(text) && exponentContext(md.slice(Math.max(0, m.index - 40), m.index))) continue;
    out.push({ form: 'html-cite', start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

function superscriptMarkers(md: string): RawFinding[] {
  const out: RawFinding[] = [];
  // Pandoc superscripts `^1^`, `^1,2^`, `^[1]^`-free (`^[` is an inline note).
  for (const m of md.matchAll(/(?<![\\^])\^(\d{1,3}(?:[,–-]\d{1,3})*)\^/g)) {
    const plain = PLAIN_NUMBER_RE.test(m[1] as string);
    if (plain && exponentContext(md.slice(Math.max(0, m.index - 40), m.index))) continue;
    out.push({ form: 'superscript-marker', start: m.index, end: m.index + m[0].length });
  }
  // Unicode superscript digits after a word or closing punctuation ("studies¹", "shown.²").
  const uni = new RegExp(`[${SUPERSCRIPT_DIGITS}]+(?:[,⁻–-][${SUPERSCRIPT_DIGITS}]+)*`, 'gu');
  for (const m of md.matchAll(uni)) {
    const before = md.slice(Math.max(0, m.index - 40), m.index);
    const afterPunct = /[.,;:)\]"'”’]$/u.test(before);
    const single = !/[,⁻–-]/.test(m[0]);
    if (!afterPunct && (before === '' || /\s$/.test(before) || (single && exponentContext(before)))) continue;
    out.push({ form: 'superscript-marker', start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Numbered markers `[1]`, `[2, 3]`, `[4–6]`, `[7, p. 12]`.
// ---------------------------------------------------------------------------

function numericMarkers(md: string): RawFinding[] {
  const out: RawFinding[] = [];
  const re = /\[\s*\d{1,3}(?:\s*[-–—,]\s*\d{1,3})*(?:\s*,\s*pp?\.\s*\d+(?:\s*[-–—]\s*\d+)?)?\s*\]/g;
  for (const m of md.matchAll(re)) {
    const before = m.index > 0 ? (md[m.index - 1] as string) : '';
    const after = md[m.index + m[0].length] ?? '';
    // An array index `x[1]`, a reference link `[text][1]`, an image, an
    // escape, an inline note `^[1]`, a link `[1](…)` / `[1][…]` or a link
    // definition `[1]: …` is not a citation marker.
    if (/[\p{L}\p{N}\]!\\^]/u.test(before) || /[([:]/.test(after)) continue;
    out.push({ form: 'numeric-marker', start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Author-date citations.
// ---------------------------------------------------------------------------

/** A capitalised name word: `Nguyen`, `O'Neil`, `García-López`, `St.`, `U.S.`, `WHO`. */
const CAPWORD = String.raw`\p{Lu}(?:[\p{L}\p{M}'’.]|-(?=\p{L}))*`;
const PARTICLE = String.raw`(?:van|von|de|der|den|del|della|di|da|du|le|la|ten|ter|al|el|bin|ibn|dos|das|do|zu)`;
/** Lower-case words inside a corporate author's name (`World Health Organization`, `Department of Health and Human Services`). */
const JOINER = String.raw`(?:of|for|the|on|in|and|to|de|du|des|für|und|&)`;
/**
 * One author: particles, then capitalised words (a corporate name may join
 * them with `of`, `for`, … and carry its abbreviation: `World Health
 * Organization [WHO]`).
 */
const AUTHOR = String.raw`(?:${PARTICLE}\s+)*${CAPWORD}(?:(?:\s+(?:${PARTICLE}|${JOINER}))*\s+${CAPWORD})*(?:\s*\[\p{Lu}[^\]]{0,19}\])?`;
/** One author for narrative prose (at most two capitalised words, no joiners): `Nguyen`, `van der Berg`, `Le Guin`. */
const NARRATIVE_AUTHOR = String.raw`(?:${PARTICLE}\s+)*${CAPWORD}(?:[ \t]+${CAPWORD})?`;
const ET_AL = String.raw`et\.?\s+al\.?`;
/** A publication year: `2019`, `2019a`, `1900/1953`, `n.d.`, `in press`, `forthcoming` — never a range. */
const YEAR = String.raw`(?:(?:1[5-9]|20)\d{2}[a-z]?(?:\/(?:1[5-9]|20)\d{2}[a-z]?)?(?![\d–—-])|n\.\s?d\.|in\s+press|forthcoming|in\s+preparation|under\s+review)`;
const PREFIX = String.raw`(?:see(?:\s+also)?|but\s+see|e\.g\.,?|i\.e\.,?|cf\.|compare|for\s+example,?|for\s+a\s+review,?\s+see|as\s+cited\s+in|as\s+reviewed\s+in|reviewed\s+in|quoted\s+in|cited\s+in|following|contra)`;

/** A parenthetical / bracketed segment that is an author-date citation (APA, Harvard, Chicago author-date, MLA with et al. or two names). */
const SEGMENT_RE = new RegExp(
  String.raw`^\s*(?:${PREFIX}\s+)?(?<names>${AUTHOR}(?:\s*,\s*${AUTHOR})*(?:\s*,?\s*(?:&|and)\s+${AUTHOR})?(?:\s*,?\s+${ET_AL})?)\s*(?:'s|’s)?(?:\s*,\s*|\s+)(?:${YEAR}(?:\s*[,:].*)?|(?<page>\d{1,4}(?:[-–]\d{1,4})?))\s*$`,
  'u',
);

/** Single capitalised words that open a dated parenthetical without naming an author: "(March 2020)", "(Since 2019)". */
const NOT_AUTHORS: ReadonlySet<string> = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'jan.', 'feb.', 'mar.', 'apr.', 'jun.', 'jul.', 'aug.', 'sep.', 'sept.', 'oct.', 'nov.', 'dec.',
  'spring', 'summer', 'autumn', 'fall', 'winter', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'since', 'in', 'by', 'from', 'until', 'till', 'before', 'after', 'during', 'as', 'of', 'circa', 'ca.', 'c.', 'around', 'about',
  'approximately', 'approx.', 'up', 'to', 'through', 'throughout', 'the', 'a', 'an', 'at', 'on', 'for', 'year', 'years', 'fy',
  'ad', 'ce', 'bce', 'bc', 'early', 'late', 'mid', 'figure', 'fig.', 'table', 'chapter', 'section', 'appendix', 'vol.', 'volume',
  'no.', 'issue', 'page', 'pages', 'version', 'edition', 'ed.', 'est.', 'established', 'founded', 'born', 'died', 'b.', 'd.',
  'updated', 'revised', 'accessed', 'retrieved', 'published', 'copyright', 'total', 'wave', 'cohort', 'phase', 'step', 'study',
  'experiment', 'model', 'sample', 'n', 'mean', 'median', 'age', 'ages', 'aged', 'q1', 'q2', 'q3', 'q4',
]);

function authorDateSegment(segment: string): boolean {
  const m = SEGMENT_RE.exec(segment);
  if (m === null) return false;
  const names = (m.groups?.['names'] ?? '').trim();
  const several = /\s(?:&|and)\s|,|\bet\.?\s+al\b/u.test(names);
  // An author and a bare page ("(Smith 45)") reads like "(Figure 3)": only with
  // two names or et al. ("(Smith and Jones 45)", "(Smith et al. 12)").
  if (m.groups?.['page'] !== undefined && !several) return false;
  if (!several && !/\s/.test(names) && NOT_AUTHORS.has(names.toLowerCase())) return false;
  return true;
}

function authorDate(md: string): RawFinding[] {
  const out: RawFinding[] = [];
  // Parenthetical and bracketed groups: "(Nguyen & Patel, 2019)", "[Smith 2020; Lee 2021]".
  for (const m of md.matchAll(/\(([^()]{2,400})\)|\[([^[\]@^]{2,400})\]/g)) {
    const inner = (m[1] ?? m[2]) as string;
    if (/\n[ \t]*\r?\n/.test(inner)) continue;
    if (m[2] !== undefined) {
      const before = m.index > 0 ? (md[m.index - 1] as string) : '';
      const after = md[m.index + m[0].length] ?? '';
      if (/[!\]\\]/.test(before) || /[([:]/.test(after)) continue; // a link, an image, a definition
    }
    if (inner.split(';').some((s) => authorDateSegment(s.replace(/\s+/g, ' ')))) {
      out.push({ form: 'author-date', start: m.index, end: m.index + m[0].length });
    }
  }
  // Narrative with two names or et al.: "Nguyen and Patel (2019)", "Smith et al. (2019, p. 4)".
  const narrative = new RegExp(
    String.raw`(?<![\p{L}\p{M}])(?:${NARRATIVE_AUTHOR}(?:\s*,\s*${NARRATIVE_AUTHOR})*\s*,?\s*(?:and|&)\s+${NARRATIVE_AUTHOR}|${NARRATIVE_AUTHOR}\s+${ET_AL})\s*(?:'s|’s)?\s*$`,
    'u',
  );
  const dated = new RegExp(String.raw`\(\s*${YEAR}(?:\s*[,:][^()\n]*)?\)`, 'gu');
  for (const m of md.matchAll(dated)) {
    const windowStart = Math.max(0, m.index - 120);
    const window = md.slice(windowStart, m.index);
    const lastBreak = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n\r\n'));
    const head = lastBreak === -1 ? window : window.slice(lastBreak + 1);
    const n = narrative.exec(head);
    if (n === null) continue;
    const start = m.index - head.length + n.index;
    out.push({ form: 'author-date', start, end: m.index + m[0].length });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The scanner.
// ---------------------------------------------------------------------------

/**
 * Every attribution in `md` the verifier cannot check against the bibliography
 * (VRFY-10, D-20-08), outside provable code and math, in document order: one
 * blocking UNSUPPORTED-FORM finding per occurrence (a reference list: its
 * heading and each entry under it). A finding inside another one (an
 * author-date string in a reference-list entry, a `[1]` in a footnote
 * definition) is reported once, by the outer one.
 */
export function findUnsupportedForms(md: string): TextFinding[] {
  const code = provableCodeSpans(md);
  const skip = [...code, ...mathSpans(md, code)];
  const lines = linesOf(md);
  const raw = [
    ...referenceLists(md, lines),
    ...footnotes(md, lines),
    ...inlineNotes(md),
    ...texCites(md),
    ...htmlCites(md),
    ...superscriptMarkers(md),
    ...numericMarkers(md),
    ...authorDate(md),
  ]
    .filter((f) => !offsetInSpans(f.start, skip))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: RawFinding[] = [];
  for (const f of raw) {
    if (kept.some((k) => f.start >= k.start && f.end <= k.end)) continue;
    kept.push(f);
  }
  return kept.map((f) => ({
    verdict: 'UNSUPPORTED-FORM',
    form: f.form,
    text: firstLine(md.slice(f.start, f.end)),
    line: lineOfOffset(md, f.start),
    reason: UNSUPPORTED_FORM_REASONS[f.form],
  }));
}

/** The first line of a finding's text, at most 120 characters. */
function firstLine(text: string): string {
  const line = (text.split(/\r?\n/)[0] ?? '').trimEnd();
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}
