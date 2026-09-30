// bin/lib/verify/unsupported-forms.ts — every way of attributing a source that
// the verifier cannot check against the bibliography (VRFY-10, D-20-08).
//
// Only a Pandoc citation (`[@key]` and the other forms citation-token.ts
// reads) names an entry of CITATIONS.bib, so only a Pandoc citation can be
// verified. Every other attribution — author-date prose "(Nguyen & Patel,
// 2019)" and MLA's "(Nguyen 45)" / "(Nguyen, *Title*, 2019)", a Markdown
// footnote, an inline note, a reference list typed into the draft (under a
// reference-list heading, or entries shaped like APA / MLA / Chicago /
// Vancouver references under any heading or none), a raw TeX `\cite`, HTML
// `<cite>` / `<sup>` markers, numbered `[1]` markers — would carry a
// fabricated source straight past Pass 1 into
// the export (the audit's V4, V6 and V7 escapes, FU1-GATE-1). Each one found is
// a blocking UNSUPPORTED-FORM row naming its text and line; the gate core runs
// this scanner over every section draft, the compiled DRAFT.md and FINAL.md.
// Notes the exporter generates for a note style are produced after the gate
// and never re-enter it.
//
// What a reader of the export sees decides (review round 2): the scanners for
// author-date text, numbered markers and typed reference entries also read a
// "reader view" of the draft — emphasis marks, backslash escapes, HTML
// entities and inline HTML tags removed, a link reduced to its text,
// blockquote / definition / table / fenced-div syntax around an entry set
// aside — so `(*Smith*, 2019)`, `(Smith&nbsp;et&nbsp;al., 2019)`, `\[1\]`,
// `(see [Nguyen & Patel, 2019](https://…))`, `<p>Nguyen, T. (2019). …</p>` or a
// `> Nguyen, T. (2019). …` entry are refused like their plain forms (a row
// still names the line and the text as written). A link's or an inline HTML
// element's own text is checked as an author-date segment ("[Nguyen et al.,
// 2019](…)", `<span>Nguyen 2019</span>`); a run-in label ("**References:**
// Nguyen, T. (2019). …", "Source: Okafor 2021") is a reference list; a raw
// TeX note (`\footnote{…}`, `\endnote`, `\footnotetext`, `\marginpar`,
// `\sidenote`, …) is a footnote, and any other raw TeX environment
// (`\begin{…}`) is refused as raw TeX (the exporter reads Markdown without
// raw TeX too, so a command left in the text prints as text). A single
// author before a year is a citation when the prose treats it as one —
// "Nguyen (2019) argued", "According to Nguyen (2019)", "Nguyen's (2019)
// meta-analysis", "Nguyen and colleagues (2019)", "Nguyen (2019, p. 5)",
// "Nguyen (2019a)" — while "the Treaty of Versailles (1919) ended the war"
// stays text (D-20-08, narrowed in review round 2).
//
// Fail closed: only the spans citation-token.ts PROVES are code (fenced blocks,
// inline code spans — provableCodeSpans, D-18-42) and TeX math (`$…$`, `$$…$$`)
// are skipped; everything else is scanned. A few shapes that are not
// citations are left alone because they cannot be mistaken for one: a lone
// name before a year ("the Treaty of Versailles (1919)"), a parenthetical
// with no name ("(n = 2019)", "(1919)", "(COVID-19)"), a year range
// ("(World War II, 1939–1945)"), a numbered label ("(Figure 3)", "(Apollo
// 11)"), an interval, shape or index in brackets ("[0, 1]", "shape [32,
// 128]"), an exponent ("m<sup>2</sup>", "x²"), an email address.
//
// PURE: no I/O. Line numbers are 1-based and count `\n`, so an LF and a CRLF
// copy of a draft report the same lines.

import { findCitations, lineOfOffset, offsetInSpans, provableCodeSpans } from '../citation-token.js';
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
  'metadata-block',
  'raw-output',
  'raw-tex',
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
  'numeric-marker':
    'a numbered citation marker the verifier cannot check — write [@citekey] (a numeric citation style numbers the citations at export); ' +
    'if it is a number range or an index, not a citation, write it as math: $[1, 5]$',
  'superscript-marker':
    'a superscript citation marker the verifier cannot check — write [@citekey] (a numeric citation style numbers the citations at export)',
  'metadata-block':
    'a Pandoc metadata block, which can replace or add to the bibliography the export renders (references, bibliography, csl, nocite) ' +
    'or inject raw output, and which the verifier cannot check — remove it and cite as [@citekey]: the export sets its own metadata',
  'raw-output':
    'raw output (a {=format} block or span) that the export would copy into the document unread and the verifier cannot check — ' +
    'remove it and write Markdown, citing as [@citekey]',
  'raw-tex':
    'a raw TeX environment the verifier cannot check (the export prints raw TeX as text) — write Markdown, citing as [@citekey] ' +
    '(math belongs in $…$ or $$…$$)',
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
 * Pandoc reads left to right: a `$` inside a citation that began before it
 * (`[@k$x]`, `-@k$x` — `$` is a key character) is part of that key and opens
 * no math. A math span that opens first runs to its closing `$`, wherever that
 * falls. (HARDEN-03 found two such keys hiding the author-date text between
 * them as "math".)
 */
function mathSpans(md: string, code: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (!md.includes('$')) return out;
  const cites = findCitations(md);
  const inCitation = (at: number): boolean => cites.some((c) => c.start < at && at < c.end);
  const re = /(?<!\\)\$\$[\s\S]*?(?<!\\)\$\$|(?<![\\$])\$(?![\s$])(?:\\.|[^$\\\n])*?(?<![\s\\])\$(?![\d$])/g;
  for (let m = re.exec(md); m !== null; m = re.exec(md)) {
    if (inCitation(m.index)) {
      re.lastIndex = m.index + 1; // this `$` belongs to a key: look for math after it
      continue;
    }
    if (offsetInSpans(m.index, code)) continue;
    if (/\n[ \t]*\r?\n/.test(m[0])) continue; // math never spans a blank line
    out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

/** A set of the words in a space-separated list. */
function wordSet(words: string): ReadonlySet<string> {
  return new Set(words.split(/\s+/).filter((w) => w.length > 0));
}

// ---------------------------------------------------------------------------
// Name patterns (reference entries and author-date citations).
// ---------------------------------------------------------------------------

/** A capitalised name word: `Nguyen`, `O'Neil`, `García-López`, `St.`, `U.S.`, `WHO`. */
const CAPWORD = String.raw`\p{Lu}(?:[\p{L}\p{M}'’.]|-(?=\p{L}))*`;
const PARTICLE = String.raw`(?:van|von|de|der|den|del|della|di|da|du|le|la|ten|ter|al|el|bin|ibn|dos|das|do|zu)`;

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

/**
 * The words a reference-list heading is made of ("References Cited",
 * "References and Notes", "Selected References", "Key Sources", "Source
 * list"). A heading whose words all come from here and name a list
 * (REFERENCE_LIST_NOUNS) is a reference-list heading when an entry under it
 * has a reference entry's shape; "Literature Review", "Sources of Error" or
 * "Notes on Method" hold a word from outside, so they never are.
 */
const REFERENCE_LIST_VOCABULARY: ReadonlySet<string> = wordSet(
  'reference references referenced bibliography bibliographies bibliographic works work cited consulted used literature sources ' +
  'source citations citation notes endnotes footnotes further reading readings selected select key main primary secondary additional ' +
  'other general annotated recommended suggested list of and & the for this paper article chapter section',
);
const REFERENCE_LIST_NOUNS: ReadonlySet<string> = wordSet(
  'reference references bibliography bibliographies works literature sources source citations readings reading',
);

function vocabularyHeading(name: string): boolean {
  const words = name.split(/[\s,/]+/).filter((w) => w.length > 0);
  return words.length > 0 && words.length <= 6 && words.every((w) => REFERENCE_LIST_VOCABULARY.has(w)) && words.some((w) => REFERENCE_LIST_NOUNS.has(w));
}

// Reference entries (APA, Harvard, MLA, Chicago, Vancouver) typed as a
// paragraph or a list item, under any heading or none: a family name and
// initials or a given name, then a year in parentheses (APA, Harvard) or a
// title in quotes or emphasis (MLA, Chicago), or a Vancouver author list, a
// title and a journal with its year.
// The line may sit in a container — a block quote (`> `), a definition (`:   `),
// a list item, any indentation (an indented block is scanned, fail closed) —
// and a table cell is tested on its own (lineHasEntry).
const ENTRY_MARKER = String.raw`^[ \t]*(?:>[ \t]?)*[ \t]*(?:[:~][ \t]+)?(?:(?:[-*+]|\d{1,3}[.)]|\[\d{1,3}\])[ \t]+)?`;
const FAMILY = String.raw`(?:${PARTICLE}\s+)*\p{Lu}[\p{L}\p{M}'’]+(?:-\p{Lu}[\p{L}\p{M}'’]+)?(?:\s+\p{Lu}[\p{L}\p{M}'’]+)?`;
const INITIALS = String.raw`\p{Lu}\.(?:[\s-]*\p{Lu}\.)*`;
const GIVEN = String.raw`\p{Lu}[\p{L}\p{M}'’-]+(?:\s+(?:\p{Lu}\.|\p{Lu}[\p{L}\p{M}'’-]+))*`;
const ENTRY_YEAR = String.raw`(?:(?:1[5-9]|20)\d{2}[a-z]?|n\.\s?d\.|in\s+press|forthcoming)`;
const APA_AUTHORS = String.raw`${FAMILY},\s+${INITIALS}(?:,?\s*(?:(?:&|and)\s+)?${FAMILY},\s+${INITIALS})*(?:,?\s+(?:…|\.\.\.)\s+${FAMILY},\s+${INITIALS})?(?:,?\s+et\s+al\.)?`;
const ENTRY_SHAPES: readonly RegExp[] = [
  // APA / Harvard: Nguyen, T., & Patel, R. (2019). Title … / Nguyen, T. and Patel, R. (2019) 'Title', …
  new RegExp(String.raw`${ENTRY_MARKER}${APA_AUTHORS}\s*\(\s*${ENTRY_YEAR}[^)\n]{0,30}\)\s*[.,]?\s*(?:\p{Lu}|["'“‘*_])`, 'u'),
  // Harvard without parentheses / Chicago author-date: Nguyen, T. 2019. Title … / Nguyen, Thanh. 2019. "Title."
  new RegExp(String.raw`${ENTRY_MARKER}(?:${APA_AUTHORS}|${FAMILY},\s+${GIVEN}(?:,?\s+and\s+${GIVEN}\s+${FAMILY})?)\.?\s+${ENTRY_YEAR}\.\s+(?:\p{Lu}|["'“‘*_])`, 'u'),
  // MLA / Chicago notes-bibliography: Nguyen, Thanh. "Title." … / Nguyen, Thanh, and Raj Patel. *Title*. …
  new RegExp(String.raw`${ENTRY_MARKER}${FAMILY},\s+${GIVEN}(?:,?\s+(?:and\s+${GIVEN}\s+${FAMILY}|et\s+al))?\.\s+(?:["“][^"”\n]{3,}[.?!,]?["”]|\*[^*\n]{3,}\*|_[^_\n]{3,}_)`, 'u'),
  // Vancouver / AMA: Nguyen T, Patel R. Title. Journal. 2019;12(3):45-67.
  new RegExp(String.raw`${ENTRY_MARKER}${FAMILY}\s+\p{Lu}{1,3}(?:,\s+${FAMILY}\s+\p{Lu}{1,3})*(?:,\s+et\s+al)?\.\s+[^.\n]{3,}\.\s+[^.\n]{2,}\.\s*(?:1[5-9]|20)\d{2}(?:\s+\p{Lu}\p{Ll}{2}(?:\s+\d{1,2})?)?\s*[;:(.]`, 'u'),
];

/** True when `text` (a paragraph's or list item's first line) has the shape of a typed reference entry. */
function referenceEntryShape(text: string): boolean {
  return ENTRY_SHAPES.some((re) => re.test(text));
}

/** True when a line holds a typed reference entry: the line itself, or one of its table cells. */
function lineHasEntry(text: string): boolean {
  if (referenceEntryShape(text)) return true;
  if (!text.includes('|')) return false;
  return text.split(/(?<!\\)\|/).some((cell) => cell.trim().length > 0 && referenceEntryShape(cell.trim()));
}

/** A fenced div's fence (`::: {.references}`, `:::`) separates entries like a blank line. */
const DIV_FENCE_RE = /^[ \t]*:{3,}/;

/** The entries of a block of lines: each list item, or each paragraph, as [start line, end line] (inclusive). */
function blockEntries(lines: readonly Line[], from: number, to: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let open: [number, number] | null = null;
  for (let j = from; j < to; j += 1) {
    const l = lines[j] as Line;
    if (BLANK_RE.test(l.text) || DIV_FENCE_RE.test(l.text)) {
      if (open !== null) out.push(open);
      open = null;
      continue;
    }
    if (open === null || LIST_ITEM_RE.test(l.text)) {
      if (open !== null) out.push(open);
      open = [j, j];
    } else open[1] = j;
  }
  if (open !== null) out.push(open);
  return out;
}

/** Reference-list names a run-in label is refused for whatever follows it ("References: …", "**Works Cited:** …"). */
const STRONG_LIST_NAMES: ReadonlySet<string> = new Set([
  'references', 'reference list', 'list of references', 'bibliography', 'selected bibliography', 'works cited', 'works consulted',
  'cited works', 'literature cited', 'sources cited',
]);
/** A run-in label opening a line: the name, a colon, then text on the same line. */
const RUN_IN_RE = /^[ \t]*(?:>[ \t]?)*[ \t]*(?:[-*+][ \t]+)?([\p{L}][\p{L} ]{1,38}?)[ \t]*:[ \t]+(\S.*)$/u;

/** True when the text after a label names a source: an entry's shape or an author and a year. */
function namesASource(rest: string): boolean {
  if (referenceEntryShape(rest)) return true;
  if (rest.split(';').some((seg) => authorDateSegment(seg.replace(/[.\s]+$/u, '').replace(/\s+/g, ' ')))) return true;
  return new RegExp(String.raw`(?<![\p{L}\p{M}])${NARRATIVE_AUTHOR}\s*\(\s*${YEAR}`, 'u').test(rest);
}

/**
 * A run-in reference list: "References: Nguyen, T. (2019). …", "**Works
 * Cited:** …", "Sources: World Bank (2020); IMF (2021).", "Source: Okafor
 * 2021". A strong name is refused whatever follows; "Notes:" / "Sources:" /
 * "Source:" only when what follows names a source ("Notes: values are means"
 * is prose).
 */
function runInLabel(text: string): boolean {
  const m = RUN_IN_RE.exec(text);
  if (m === null) return false;
  const name = listName(m[1] as string);
  if (!REFERENCE_LIST_NAMES.has(name) && name !== 'source' && !vocabularyHeading(name)) return false;
  return STRONG_LIST_NAMES.has(name) || namesASource(m[2] as string);
}

function referenceLists(md: string, lines: readonly Line[]): RawFinding[] {
  void md;
  const out: RawFinding[] = [];
  const covered = new Set<number>(); // lines already reported under a heading
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as Line;
    // A run-in label: the rest of its paragraph is the list.
    if (runInLabel(line.text)) {
      let j = i;
      while (j + 1 < lines.length && !BLANK_RE.test((lines[j + 1] as Line).text) && headingKind(lines, j + 1) === null) j += 1;
      out.push({ form: 'reference-list', start: line.start, end: (lines[j] as Line).end });
      for (let x = i; x <= j; x += 1) covered.add(x);
      i = j;
      continue;
    }
    let kind = headingKind(lines, i);
    let name = kind === null ? '' : listName(headingText(lines, i, kind));
    let exact = REFERENCE_LIST_NAMES.has(name);
    let vocabulary = !exact && kind !== null && vocabularyHeading(name);
    // A line that is nothing but the name ("References", "Sources:") opening a paragraph.
    if (!exact && !vocabulary) {
      const prevBlank = i === 0 || BLANK_RE.test((lines[i - 1] as Line).text);
      if (!prevBlank) continue;
      name = listName(line.text);
      if (line.text.trim().length > 40) continue;
      exact = REFERENCE_LIST_NAMES.has(name);
      vocabulary = !exact && vocabularyHeading(name);
      if (!exact && !vocabulary) continue;
      kind = 'label';
    }
    const k = kind as 'atx' | 'setext' | 'label';
    const headingEnd = k === 'setext' ? (lines[i + 1] as Line).end : line.end;
    // Every entry up to the next heading: a list item, or a paragraph.
    const first = k === 'setext' ? i + 2 : i + 1;
    let j = first;
    while (j < lines.length && (BLANK_RE.test((lines[j] as Line).text) || headingKind(lines, j) === null)) j += 1;
    const entries = blockEntries(lines, first, j);
    // A heading named only by the vocabulary is a reference list when an entry under it has an entry's shape.
    if (vocabulary && !entries.some(([a]) => referenceEntryShape((lines[a] as Line).text))) continue;
    out.push({ form: 'reference-list', start: line.start, end: headingEnd });
    for (const [a, b] of entries) {
      out.push({ form: 'reference-list', start: (lines[a] as Line).start, end: (lines[b] as Line).end });
      for (let x = a; x <= b; x += 1) covered.add(x);
    }
    i = j - 1;
  }
  // Entries typed with no heading at all (or under any other heading): a
  // paragraph or list item whose first line has an entry's shape, then any
  // other line that holds one (in a table cell, a block quote, after a
  // soft line break, an HTML element's text).
  const reported = new Set<number>();
  for (const [a, b] of blockEntries(lines, 0, lines.length)) {
    if (covered.has(a) || headingKind(lines, a) !== null) continue;
    if (lineHasEntry((lines[a] as Line).text)) {
      out.push({ form: 'reference-list', start: (lines[a] as Line).start, end: (lines[b] as Line).end });
      for (let x = a; x <= b; x += 1) reported.add(x);
    }
  }
  for (let j = 0; j < lines.length; j += 1) {
    if (covered.has(j) || reported.has(j) || headingKind(lines, j) !== null) continue;
    const l = lines[j] as Line;
    if (lineHasEntry(l.text)) out.push({ form: 'reference-list', start: l.start, end: l.end });
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
// Pandoc metadata blocks and raw output.
//
// A YAML metadata block anywhere in the text (Pandoc's yaml_metadata_block:
// `---` at the start or after a blank line, not followed by a blank line, up to
// `---` or `...`) can set `references` — inline entries that take priority over
// CITATIONS.bib, so the export renders a work Pass 1 never checked — or
// `bibliography`, `csl`, `nocite`, `header-includes`. A raw block
// (```{=openxml}, ```{=latex}, ```{=html}) or a raw span (`…`{=format}) is
// copied into the output as is: author-date text, a reference list or a quote
// inside one reaches the exported document without any scanner reading it.
// A draft has no use for either; both are refused.
// ---------------------------------------------------------------------------

const YAML_FENCE_RE = /^---[ \t]*$/;
const YAML_END_RE = /^(?:---|\.\.\.)[ \t]*$/;
/** A line that reads as a YAML key (`references:`, `  "nocite": …`) or a flow mapping. */
const YAML_KEY_RE = /^[ \t]*(?:["']?[\p{L}\p{N}_][\p{L}\p{N}_ -]*["']?[ \t]*:(?:[ \t]|$)|\{)/u;

function metadataBlocks(lines: readonly Line[]): RawFinding[] {
  const out: RawFinding[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!YAML_FENCE_RE.test((lines[i] as Line).text)) continue;
    if (i > 0 && !BLANK_RE.test((lines[i - 1] as Line).text)) continue;
    const next = lines[i + 1];
    if (next === undefined || BLANK_RE.test(next.text)) continue;
    let end = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (YAML_END_RE.test((lines[j] as Line).text)) {
        end = j;
        break;
      }
    }
    if (end === -1) continue;
    if (!lines.slice(i + 1, end).some((l) => YAML_KEY_RE.test(l.text))) continue;
    out.push({ form: 'metadata-block', start: (lines[i] as Line).start, end: (lines[end] as Line).end });
    i = end;
  }
  return out;
}

const RAW_FENCE_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*\{[ \t]*=[^}\s]+[ \t]*\}[ \t]*$/;

function rawOutput(md: string, lines: readonly Line[]): RawFinding[] {
  const out: RawFinding[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = RAW_FENCE_RE.exec((lines[i] as Line).text);
    if (m === null) continue;
    const fence = m[1] as string;
    let end = lines.length - 1;
    for (let j = i + 1; j < lines.length; j += 1) {
      const c = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec((lines[j] as Line).text);
      if (c !== null && (c[1] as string)[0] === fence[0] && (c[1] as string).length >= fence.length) {
        end = j;
        break;
      }
    }
    out.push({ form: 'raw-output', start: (lines[i] as Line).start, end: (lines[end] as Line).end });
    i = end;
  }
  // Inline raw spans: `<w:p/>`{=openxml}, ``\cite{x}``{=latex}.
  for (const m of md.matchAll(/(`+)(?:(?!\1)[\s\S])+?\1\{[ \t]*=[^}\s]+[ \t]*\}/g)) {
    out.push({ form: 'raw-output', start: m.index, end: m.index + m[0].length });
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

/** The offset just past the `}` closing the `{` at `open` (nesting and escapes counted), or the end of its paragraph. */
function closeBrace(md: string, open: number): number {
  let depth = 0;
  for (let i = open; i < md.length; i += 1) {
    const c = md[i];
    if (c === '\n' && /^\r?\n[ \t]*\r?\n/.test(md.slice(i))) return i;
    if (c === '\\') {
      i += 1; // an escaped character (`\{`, `\}`) is text
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return md.length;
}

/** Raw TeX note commands: a footnote, an endnote, a margin or side note (their text is a note Pandoc's LaTeX writer typesets). */
const TEX_NOTE_RE = /\\(?:footnote|footnotetext|footnotemark|endnote|endnotetext|endnotemark|marginpar|marginnote|sidenote|sidenotetext|tablefootnote|mpfootnote)(?![A-Za-z@])\*?/g;

/** Raw TeX notes (`\footnote{…}` …), reported as footnotes: from the command through its brace group. */
function texNotes(md: string): RawFinding[] {
  const out: RawFinding[] = [];
  for (const m of md.matchAll(TEX_NOTE_RE)) {
    if (escaped(md, m.index)) continue; // `\\footnote` is a printed backslash, then text
    let end = m.index + m[0].length;
    for (;;) {
      const opt = /^[ \t]*\[[^\]\n]*\]/.exec(md.slice(end));
      if (opt === null) break;
      end += opt[0].length;
    }
    const brace = /^[ \t]*\{/.exec(md.slice(end));
    if (brace !== null) end = closeBrace(md, end + brace[0].length - 1);
    out.push({ form: 'footnote', start: m.index, end });
  }
  return out;
}

/** A raw TeX environment (`\begin{…}` … `\end{…}`); a TeX bibliography is tex-cite's. */
function texEnvironments(md: string): RawFinding[] {
  const out: RawFinding[] = [];
  for (const m of md.matchAll(/\\begin[ \t]*\{([A-Za-z@*]+)\}/g)) {
    if (escaped(md, m.index) || m[1] === 'thebibliography') continue;
    const name = (m[1] as string).replace(/\*/g, '\\*');
    const close = new RegExp(String.raw`\\end[ \t]*\{${name}\}`).exec(md.slice(m.index + m[0].length));
    const end = close !== null ? m.index + m[0].length + close.index + close[0].length : m.index + m[0].length;
    out.push({ form: 'raw-tex', start: m.index, end });
  }
  return out;
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
//
// Only a group that CAN be citation numbers is a marker: positive integers
// written without a leading zero, strictly ascending, each range low → high.
// "[0, 1]", "[32, 224, 224, 3]", "[5, 1]" cannot be. A group that reads as a
// value is not a marker either: after a word naming an interval, a range, an
// index or a shape ("the interval [1, 5]", "shape [32, 128]", "indices [1]
// and [2]"), after a relation or operator ("x ∈ [1, 5]", "= [2, 3]"), a
// two-or-more-number group after a preposition that introduces a value ("lies
// in [1, 5]", "scaled to [1, 10]" — but not "as described in [1, 5]" or
// "according to [2, 3]"), or a group that an operator continues
// ("[1, 5] × [1, 5]"). A group joined to such a value by "and", "or", "to", a
// comma or a dash is one too. What is left — "[1]" after a claim, "as shown
// [3]", "[2, 3]" — is a marker (fail closed).
// ---------------------------------------------------------------------------

/** Words after which any bracketed number group is a value ("indices [1]", "the interval [1, 5]", "shape [32, 128]"). */
const VALUE_WORDS: ReadonlySet<string> = new Set([
  'interval', 'intervals', 'range', 'ranges', 'bound', 'bounds', 'domain', 'codomain', 'support', 'window', 'windows', 'span',
  'index', 'indices', 'indexes', 'element', 'elements', 'entry', 'entries', 'position', 'positions', 'slot', 'slots', 'offset', 'offsets',
  'row', 'rows', 'column', 'columns', 'cell', 'cells', 'axis', 'axes', 'dimension', 'dimensions', 'dim', 'dims',
  'shape', 'shapes', 'size', 'sizes', 'array', 'arrays', 'vector', 'vectors', 'tensor', 'tensors', 'matrix', 'matrices',
  'tuple', 'tuples', 'coordinate', 'coordinates', 'point', 'points', 'pair', 'pairs', 'set', 'sets', 'list', 'lists', 'value', 'values',
]);
/** Prepositions after which a group of two or more numbers is a value ("lies in [1, 5]", "scaled to [1, 10]", "between [2, 4]"). */
const VALUE_PREPOSITIONS: ReadonlySet<string> = new Set(['in', 'to', 'into', 'onto', 'between', 'within', 'inside', 'outside']);
/**
 * Words that make the preposition after them introduce a source, not a value:
 * "as described in [1, 5]", "according to [2, 3]", "compared to [4, 6]" —
 * the group stays a marker.
 */
const CITING_BEFORE_PREPOSITION: ReadonlySet<string> = wordSet(
  'as see cf according refer referred compared similar contrast due owing thanks attributed credited shown described reported ' +
  'discussed presented proposed introduced given found studied reviewed summarized summarised cited used demonstrated observed noted ' +
  'outlined detailed explained established argued suggested examined investigated analyzed analysed developed listed published ' +
  'appeared documented derived proved proven considered adopted employed applied discussion work works studies study literature ' +
  'papers paper',
);
/** A relation or operator right before a group ("x ∈ [1, 5]", "= [2, 3]", "≤ [1]"). */
const VALUE_BEFORE_RE = /[=∈∊∉⊂⊆⊃⊇×→↦≤≥±∓−]\s*$/u;
/** An operator right after a group ("[1, 5] × [1, 5]", "[1, 5]^2", "[1, 5] ∪ …"). */
const VALUE_AFTER_RE = /^\s*(?:[×^=∪∩⊂⊆→↦−]|\\times\b)/u;
/** A connective between two groups: "and", "or", "to", a comma, a dash or "×". */
const GROUP_JOIN_RE = /^\s*(?:,|and|or|to|through|[-–—×])?\s*$/u;

/** The numbers of a marker group in order, or null when a number has a leading zero or is 0. */
function groupNumbers(group: string): { values: number[]; rangesAscend: boolean } | null {
  const body = group.replace(/^\[\s*|\s*\]$/g, '').replace(/\s*,\s*pp?\.\s*\d+(?:\s*[-–—]\s*\d+)?$/, '');
  const values: number[] = [];
  let rangesAscend = true;
  for (const part of body.split(/\s*,\s*/)) {
    const range = part.split(/\s*[-–—]\s*/);
    const nums: number[] = [];
    for (const n of range) {
      if (!/^[1-9]\d{0,2}$/.test(n)) return null; // 0, a leading zero
      nums.push(Number(n));
    }
    if (nums.length === 2 && (nums[0] as number) >= (nums[1] as number)) rangesAscend = false;
    values.push(...nums);
  }
  return { values, rangesAscend };
}

/** True when a group's numbers can be citation numbers: strictly ascending, each range low → high. */
function citationNumbers(group: string): boolean {
  const g = groupNumbers(group);
  if (g === null || !g.rangesAscend) return false;
  return g.values.every((v, i) => i === 0 || v > (g.values[i - 1] as number));
}

/** The last two words before offset `at` (lower case, nearest first; '' when absent). */
function wordsBefore(md: string, at: number): [string, string] {
  const head = md.slice(Math.max(0, at - 60), at);
  const m = /(?:([\p{L}]+)[^\p{L}\n]+)?([\p{L}]+)[\s\p{Pd}]*$/u.exec(head);
  return [m?.[2]?.toLowerCase() ?? '', m?.[1]?.toLowerCase() ?? ''];
}

function numericMarkers(md: string): RawFinding[] {
  const out: RawFinding[] = [];
  const re = /\[\s*\d{1,3}(?:\s*[-–—,]\s*\d{1,3})*(?:\s*,\s*pp?\.\s*\d+(?:\s*[-–—]\s*\d+)?)?\s*\]/g;
  /** The groups already read as values, by end offset (a group joined to one is one too). */
  const valueEnds: number[] = [];
  for (const m of md.matchAll(re)) {
    const start = m.index;
    const end = start + m[0].length;
    const before = start > 0 ? (md[start - 1] as string) : '';
    const after = md[end] ?? '';
    // An array index `x[1]`, a reference link `[text][1]`, an image, an
    // escape, an inline note `^[1]`, a link `[1](…)` / `[1][…]` or a link
    // definition `[1]: …` is not a citation marker.
    if (/[\p{L}\p{N}\]!\\^]/u.test(before) || /[([:]/.test(after)) continue;
    const several = /[-–—,]/.test(m[0].replace(/,\s*pp?\..*$/, ''));
    const lineStart = md.lastIndexOf('\n', start - 1) + 1;
    const head = md.slice(lineStart, start);
    const joined = valueEnds.some((e) => e <= start && GROUP_JOIN_RE.test(md.slice(e, start)));
    const [word, previous] = wordsBefore(md, start);
    const value =
      !citationNumbers(m[0]) ||
      joined ||
      VALUE_WORDS.has(word) ||
      (several && VALUE_PREPOSITIONS.has(word) && !CITING_BEFORE_PREPOSITION.has(previous) && /\s$/.test(head)) ||
      VALUE_BEFORE_RE.test(head) ||
      VALUE_AFTER_RE.test(md.slice(end, end + 12));
    if (value) {
      valueEnds.push(end);
      continue;
    }
    out.push({ form: 'numeric-marker', start, end });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Author-date citations.
// ---------------------------------------------------------------------------

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
const PREFIX = String.raw`(?:see(?:\s+also)?|but\s+see|e\.g\.,?|i\.e\.,?|cf\.|compare|for\s+example,?|for\s+a\s+review,?\s+see|as\s+cited\s+in|as\s+reviewed\s+in|reviewed\s+in|quoted\s+in|cited\s+in|following|contra|(?:[Ss]ources?|[Dd]ata|[Aa]dapted\s+from|[Rr]eproduced\s+from|[Rr]eprinted\s+from|[Dd]ata\s+from|[Bb]ased\s+on|[Aa]fter)\s*:?)`;

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

/**
 * Words that label a numbered thing, so "(Level 2)", "(Apollo 11)" or
 * "(Python 3)" is not an MLA author-page citation like "(Nguyen 45)".
 */
const NUMBERED_LABELS: ReadonlySet<string> = new Set([
  'eq.', 'eqs.', 'equation', 'equations', 'formula', 'hypothesis', 'hypotheses', 'level', 'levels', 'group', 'groups', 'condition', 'trial',
  'trials', 'round', 'day', 'days', 'week', 'weeks', 'month', 'months', 'grade', 'stage', 'type', 'class', 'article', 'rule', 'box', 'panel',
  'supplement', 'item', 'items', 'question', 'participant', 'subject', 'patient', 'case', 'site', 'region', 'zone', 'block', 'session',
  'lesson', 'unit', 'part', 'book', 'act', 'scene', 'line', 'lines', 'verse', 'canto', 'psalm', 'exhibit', 'plate', 'map', 'note', 'notes',
  'footnote', 'number', 'rank', 'tier', 'layer', 'node', 'epoch', 'run', 'iteration', 'fold', 'seed', 'algorithm', 'lemma', 'theorem',
  'proposition', 'corollary', 'definition', 'remark', 'example', 'exercise', 'problem', 'claim', 'assumption', 'axiom', 'conjecture',
  'property', 'protocol', 'task', 'scenario', 'setting', 'configuration', 'option', 'variant', 'arm', 'batch', 'population', 'district',
  'ward', 'room', 'building', 'floor', 'route', 'highway', 'interstate', 'station', 'channel', 'track', 'disc', 'episode', 'season',
  'release', 'build', 'level', 'python', 'java', 'windows', 'office', 'android', 'ios', 'iphone', 'galaxy', 'xbox', 'playstation', 'apollo',
  'gemini', 'artemis', 'voyager', 'pioneer', 'mariner', 'viking', 'sputnik', 'soyuz', 'catch', 'covid', 'sars', 'h1n1', 'web', 'industry',
  'generation', 'gen', 'league', 'division', 'series', 'model', 'mark', 'mk', 'figure', 'fig.', 'table', 'chapter', 'section', 'appendix',
  'title', 'phase', 'wave', 'step', 'study', 'experiment', 'cohort', 'sample', 'version', 'volume', 'issue', 'page',
]);

/** An italic or quoted title in a parenthetical ("*Street Trees*", "\"Street Trees\""). */
const TITLE_PART = String.raw`(?:\*[^*\n]{2,120}\*|_[^_\n]{2,120}_|"[^"\n]{2,120}"|“[^”\n]{2,120}”)`;
/** MLA / Chicago with a title: "(Nguyen, *Street Trees*, 2019)", "(Nguyen, *Street Trees* 45)", "(Nguyen, \"Shade\" 12)". */
const TITLE_SEGMENT_RE = new RegExp(
  String.raw`^\s*(?:${PREFIX}\s+)?${AUTHOR}(?:\s*,\s*${AUTHOR})*(?:\s*,?\s*(?:&|and)\s+${AUTHOR})?(?:\s*,?\s+${ET_AL})?\s*,\s*${TITLE_PART}\s*(?:,\s*(?:${YEAR}|p{1,2}\.\s*\d+[^,]*)|\s+\d{1,4}(?:[-–]\d{1,4})?)?\s*$`,
  'u',
);

function authorDateSegment(segment: string): boolean {
  // An APA personal communication: "(T. Nguyen, personal communication, May 3, 2019)".
  if (/\bpersonal\s+communication\b/iu.test(segment) && /\p{Lu}/u.test(segment)) return true;
  if (TITLE_SEGMENT_RE.test(segment)) return true;
  const m = SEGMENT_RE.exec(segment);
  if (m === null) return false;
  const names = (m.groups?.['names'] ?? '').trim();
  const several = /\s(?:&|and)\s|,|\bet\.?\s+al\b/u.test(names);
  // An author and a bare page is MLA's "(Nguyen 45)" for one name (particles
  // allowed: "(van der Berg 12)") that is not an acronym and not a label of a
  // numbered thing ("(Figure 3)", "(Level 2)", "(Apollo 11)"); two or more
  // words that are not particles ("(World War 2)") are not an author.
  if (m.groups?.['page'] !== undefined && !several) {
    const words = names.split(/\s+/);
    const name = words[words.length - 1] as string;
    const particlesOnly = words.slice(0, -1).every((w) => new RegExp(`^${PARTICLE}$`, 'u').test(w));
    if (!particlesOnly || /^[\p{Lu}\p{N}.]+$/u.test(name) || NUMBERED_LABELS.has(name.toLowerCase()) || NOT_AUTHORS.has(name.toLowerCase())) return false;
    return true;
  }
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
    const n = narrative.exec(head) ?? singleAuthorCitation(head, m[0], md.slice(m.index + m[0].length, m.index + m[0].length + 80));
    if (n === null) continue;
    const start = m.index - head.length + n.index;
    out.push({ form: 'author-date', start, end: m.index + m[0].length });
  }
  return out;
}

/** Verbs of reporting and finding: "Nguyen (2019) argued / found / showed …" (D-20-08, narrowed in review round 2). */
const REPORTING_VERB = String.raw`(?:argue[sd]?|arguing|f(?:ind|inds|ound)|show(?:s|ed|n)?|report(?:s|ed)?|note[sd]?|suggest(?:s|ed)?|demonstrate[sd]?|conclude[sd]?|observe[sd]?|claim(?:s|ed)?|propose[sd]?|state[sd]?|wr(?:ite|ites|ote|itten)|contend(?:s|ed)?|maintain(?:s|ed)?|assert(?:s|ed)?|emphasi[sz]e[sd]?|highlight(?:s|ed)?|document(?:s|ed)?|estimate[sd]?|describe[sd]?|explain(?:s|ed)?|examine[sd]?|investigate[sd]?|identifie[sd]|identify|review(?:s|ed)?|analy[sz]e[sd]?|survey(?:s|ed)?|hypothesi[sz]e[sd]?|posit(?:s|ed)?|caution(?:s|ed)?|warn(?:s|ed)?|recommend(?:s|ed)?|acknowledge[sd]?|confirm(?:s|ed)?|replicate[sd]?|reveal(?:s|ed)?|indicate[sd]?|discover(?:s|ed)?|assess(?:es|ed)?|evaluate[sd]?|explore[sd]?|discuss(?:es|ed)?|question(?:s|ed)?|challenge[sd]?|critici[sz]e[sd]?|dispute[sd]?|stress(?:es|ed)?|insist(?:s|ed)?|speculate[sd]?|theori[sz]e[sd]?|point(?:s|ed)?\s+out|summari[sz]e[sd]?|measure[sd]?|predict(?:s|ed)?|reason(?:s|ed)?|tested|studied|studies|modell?ed|put\s+it|says|said|writes|agree[sd]?|disagree[sd]?|den(?:y|ies|ied)|doubt(?:s|ed)?|recogni[sz]e[sd]?|reject(?:s|ed)?)`;
/** Words a writer puts between the citation and its verb: "Nguyen (2019) also found", "Nguyen (2019), however, argued". */
const BETWEEN = String.raw`(?:\s*,?\s*(?:also|further|furthermore|recently|similarly|previously|later|first|then|subsequently|convincingly|famously|notably|rightly|correctly|persuasively|explicitly|originally|elsewhere|however|moreover|in\s+contrast|by\s+contrast|for\s+example|for\s+instance|in\s+turn|instead|too|even|only|each|both|all|clearly|repeatedly|consistently|independently|\p{L}+ly)\s*,?)*`;
/** Cues before a lone name that make it a citation: "According to Nguyen (2019)", "as shown by Nguyen (2019)". */
const CITING_CUE_RE = /(?:according\s+to|as\s+(?:shown|noted|reported|described|argued|demonstrated|suggested|observed|found|stated|discussed|explained|proposed|pointed\s+out|documented|reviewed|summari[sz]ed|outlined|detailed|put)\s+by|following|\bsee(?:\s+also)?|\bcf\.)\s+$/iu;
/** A lone name and what may follow it in the head: "Nguyen", "van der Berg", "Nguyen's", "Nguyen and colleagues". */
const LONE_AUTHOR_RE = new RegExp(
  String.raw`(?<![\p{L}\p{M}])(?<name>${NARRATIVE_AUTHOR})(?<tail>\s*(?:'s|’s)|\s+(?:and|&)\s+(?:colleagues|coworkers|co-workers|associates|collaborators|coauthors|co-authors|others|team))?\s*$`,
  'u',
);

/**
 * A lone author before a year that the prose treats as a citation (see the
 * header): followed by a reporting verb, after a citing cue ("according to",
 * "as shown by"), possessive, "and colleagues", or with a page locator or a
 * year letter. A lone name before a year otherwise stays text ("the Treaty
 * of Versailles (1919) ended the war"). Returns where the name starts in
 * `head`, or null.
 */
function singleAuthorCitation(head: string, dated: string, after: string): { index: number } | null {
  const m = LONE_AUTHOR_RE.exec(head);
  if (m === null || m.groups === undefined) return null;
  const name = (m.groups['name'] ?? '').trim();
  const last = name.split(/\s+/).pop() ?? '';
  if (NOT_AUTHORS.has(last.toLowerCase()) || NUMBERED_LABELS.has(last.toLowerCase())) return null;
  // A possessive may be read into the name itself (a name word may hold an apostrophe: O'Neil).
  const tail = (m.groups['tail'] ?? '') || (/['’]s$/u.test(name) ? "'s" : '');
  const locator = new RegExp(String.raw`^\(\s*${YEAR}\s*(?:,\s*(?:pp?\.|para\.|ch(?:ap)?\.|sec\.|§)\s*\d|:\s*\d)`, 'u').test(dated);
  const letter = /^\(\s*(?:1[5-9]|20)\d{2}[a-z]\b/u.test(dated);
  const verb = new RegExp(String.raw`^${BETWEEN}\s*${REPORTING_VERB}\b`, 'iu').test(after);
  const cue = CITING_CUE_RE.test(head.slice(0, m.index));
  return tail !== '' || locator || letter || verb || cue ? { index: m.index } : null;
}

// ---------------------------------------------------------------------------
// The reader view: the draft's text as the export shows it (see the header).
// ---------------------------------------------------------------------------

interface ReaderView {
  readonly text: string;
  /** `starts[i]` / `ends[i]`: where in the draft `text[i]` is written (an escape `\[` or an entity `&nbsp;` spans several characters). */
  readonly starts: readonly number[];
  readonly ends: readonly number[];
}

/** The HTML entities a draft may write for text a citation is made of (the rest by number). */
const TEXT_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', sect: '§', middot: '·', lpar: '(', rpar: ')', lsqb: '[', rsqb: ']',
  lbrack: '[', rbrack: ']', comma: ',', period: '.', colon: ':', semi: ';', num: '#',
};
const ENTITY_RE = /&(?:([A-Za-z]+)|#(\d{1,7})|#[xX]([0-9A-Fa-f]{1,6}));/y;
const TAG_RE = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/y;
const COMMENT_RE = /<!--[\s\S]*?-->/y;
const ASCII_PUNCT_RE = /[!-/:-@[-`{-~]/;

/** The offset of the `]` closing the `[` at `open` (nesting and escapes counted, within its paragraph), or -1. */
function matchingBracket(md: string, open: number, to: number): number {
  let depth = 0;
  for (let i = open; i < to; i += 1) {
    const c = md[i];
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === '\n' && /^\r?\n[ \t]*\r?\n/.test(md.slice(i, i + 4))) return -1;
    if (c === '[') depth += 1;
    else if (c === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The offset of the `)` closing the `(` at `open` (nesting counted, on its line), or -1. */
function matchingParen(md: string, open: number, to: number): number {
  let depth = 0;
  for (let i = open; i < to; i += 1) {
    const c = md[i];
    if (c === '\n') return -1;
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Append the reader view of `md[from, to)` (see readerView). */
function readerWalk(md: string, from: number, to: number, out: string[], starts: number[], ends: number[]): void {
  const push = (ch: string, at: number, end = at + 1): void => {
    for (const unit of ch.split('')) {
      out.push(unit);
      starts.push(at);
      ends.push(end);
    }
  };
  let i = from;
  while (i < to) {
    const c = md[i] as string;
    if (c === '\\') {
      const n = md[i + 1];
      if (n !== undefined && i + 1 < to && ASCII_PUNCT_RE.test(n)) {
        push(n, i, i + 2); // an escaped mark prints as itself
        i += 2;
        continue;
      }
      push(c, i);
      i += 1;
      continue;
    }
    if (c === '&') {
      ENTITY_RE.lastIndex = i;
      const e = ENTITY_RE.exec(md);
      if (e !== null && e.index + e[0].length <= to) {
        const [, name, dec, hex] = e;
        let ch: string | null = null;
        if (name !== undefined) ch = TEXT_ENTITIES[name.toLowerCase()] ?? null;
        else {
          const code = dec !== undefined ? Number(dec) : Number.parseInt(hex ?? '', 16);
          ch = Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code === 0xa0 ? 0x20 : code) : null;
        }
        if (ch !== null) {
          push(ch, i, i + e[0].length);
          i += e[0].length;
          continue;
        }
      }
    }
    if (c === '<') {
      COMMENT_RE.lastIndex = i;
      const cm = COMMENT_RE.exec(md);
      if (cm !== null && cm.index + cm[0].length <= to) {
        i += cm[0].length; // an HTML comment is not shown
        continue;
      }
      TAG_RE.lastIndex = i;
      const t = TAG_RE.exec(md);
      if (t !== null && t.index + t[0].length <= to) {
        if (/^<br\b/i.test(t[0])) push(' ', i, i + t[0].length);
        i += t[0].length; // a tag is markup; its element's text stays
        continue;
      }
    }
    if (c === '*' || c === '`') {
      i += 1; // emphasis marks and code-span delimiters are not shown
      continue;
    }
    if (c === '~' && md[i + 1] === '~') {
      i += 2; // strikethrough
      continue;
    }
    if (c === '_') {
      const prev = md[i - 1] ?? ' ';
      const next = md[i + 1] ?? ' ';
      if (!(/[\p{L}\p{N}]/u.test(prev) && /[\p{L}\p{N}]/u.test(next))) {
        i += 1; // an emphasis underscore (one inside a word is text)
        continue;
      }
    }
    if (c === '[' || (c === '!' && md[i + 1] === '[')) {
      const open = c === '!' ? i + 1 : i;
      const close = matchingBracket(md, open, to);
      if (close !== -1) {
        const after = md[close + 1];
        let end = -1;
        if (after === '(') end = matchingParen(md, close + 1, to);
        else if (after === '[') {
          const r = md.indexOf(']', close + 2);
          end = r !== -1 && r < to && !md.slice(close + 2, r).includes('\n') ? r : -1;
        } else if (after === '{') {
          const r = md.indexOf('}', close + 2);
          end = r !== -1 && r < to && !md.slice(close + 2, r).includes('\n') ? r : -1;
        }
        if (end !== -1) {
          readerWalk(md, open + 1, close, out, starts, ends); // a link, an image or a span: its text
          i = end + 1;
          continue;
        }
      }
    }
    push(c, i);
    i += 1;
  }
}

/** The draft as a reader of the export sees its text (see the header), with each character's offset in the draft. */
function readerView(md: string): ReaderView {
  const out: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  readerWalk(md, 0, md.length, out, starts, ends);
  return { text: out.join(''), starts, ends };
}

/**
 * A finding in the reader view, placed on the draft. A reference-list finding
 * starts at its line when only markup precedes it there (`**References:** …`,
 * `<p>Lee, K. …`), so its row shows the line as written.
 */
function onDraft(f: RawFinding, view: ReaderView, md: string): RawFinding {
  let start = view.starts[f.start] ?? 0;
  const end = f.end > f.start ? (view.ends[f.end - 1] ?? start + 1) : start;
  if (f.form === 'reference-list') {
    const lineStart = md.lastIndexOf('\n', start - 1) + 1;
    if (/^[ \t*_`~]*(?:<[^<>\n]*>[ \t*_]*)*$/.test(md.slice(lineStart, start))) start = lineStart;
  }
  return { form: f.form, start, end: Math.max(end, start) };
}

/**
 * Author-date text a link or an inline HTML element shows ("[Nguyen et al.,
 * 2019](https://…)", "<span class=\"citation\">Nguyen 2019</span>"): the
 * element's reader-view text is an author-date segment.
 */
function linkedAuthorDate(md: string): RawFinding[] {
  const out: RawFinding[] = [];
  const check = (start: number, end: number, inner: string): void => {
    const text = readerView(inner).text.replace(/\s+/g, ' ').trim();
    if (text.length < 4) return;
    if (text.split(';').some((seg) => authorDateSegment(seg.replace(/^[\s(\[]+|[\s)\].,]+$/gu, '')))) out.push({ form: 'author-date', start, end });
  };
  for (let at = md.indexOf('['); at !== -1; at = md.indexOf('[', at + 1)) {
    if (escaped(md, at)) continue;
    const close = matchingBracket(md, at, md.length);
    if (close === -1) continue;
    const after = md[close + 1];
    let end = -1;
    if (after === '(') end = matchingParen(md, close + 1, md.length);
    else if (after === '[' || after === '{') {
      const r = md.indexOf(after === '[' ? ']' : '}', close + 2);
      end = r !== -1 && !md.slice(close + 2, r).includes('\n') ? r : -1;
    }
    if (end === -1) continue;
    const inner = md.slice(at + 1, close);
    if (/(?:^|[\s[;(-])@/.test(inner)) continue; // a Pandoc citation, not a link
    check(md[at - 1] === '!' ? at - 1 : at, end + 1, inner);
  }
  for (const m of md.matchAll(/<(a|span|em|i|b|strong|small|q|u|mark|abbr|dfn|s|del|ins|font)\b[^>]*>([\s\S]{2,400}?)<\/\1\s*>/gi)) {
    check(m.index, m.index + m[0].length, m[2] as string);
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
  const view = readerView(md);
  const viewLines = linesOf(view.text);
  const raw = [
    ...metadataBlocks(lines),
    ...rawOutput(md, lines),
    ...referenceLists(md, lines),
    ...footnotes(md, lines),
    ...inlineNotes(md),
    ...texCites(md),
    ...texNotes(md),
    ...texEnvironments(md),
    ...htmlCites(md),
    ...superscriptMarkers(md),
    ...numericMarkers(md),
    ...authorDate(md),
    ...linkedAuthorDate(md),
    // What the reader sees: emphasis, escapes, entities, tags and links undone.
    ...[...referenceLists(view.text, viewLines), ...numericMarkers(view.text), ...authorDate(view.text)].map((f) => onDraft(f, view, md)),
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
