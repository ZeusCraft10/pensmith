// bin/lib/outline-parse.ts — PURE parser for the on-disk .paper/OUTLINE.md.
//
// Phase 4 Plan 04-01. The raw-file READ side lives in bin/lib/outline.ts
// (loadOutline); this module is the string→object PARSE side and performs NO
// fs I/O — keeping it pure makes the wave scheduler (scheduler.ts) and the
// compile pipeline (Plan 05) trivially testable.
//
// =========================================================================
// LOCKED .paper/OUTLINE.md FORMAT (derived from workflows/outline.md §4/§5)
// =========================================================================
// The production `outline` verb persists the outline as human-readable GFM:
//   1. An H1 title line:  `# <Paper Title>`
//   2. A GFM pipe table with the header row (column order LOCKED):
//        | # | slug | title | depends_on | word target | assigned_sources |
//      a delimiter row, then one data row per section in OUTLINE (=reader)
//      order:
//        | 1 | 01-introduction | Introduction | | 800 | smith2020, jones2019 |
//
// Mapping:
//   #                -> n (positive int)
//   slug             -> slug (validated via paths.ts::validateSlug)
//   title            -> title (raw cell text)
//   depends_on       -> depends_on (comma-split bare slugs; empty cell = [])
//   word target      -> estimated_word_count (optional positive int)
//   assigned_sources -> ignored by the wave graph (not consumed here)
//
// A malformed data row (wrong column count, non-numeric `#`, bad slug, bad
// word target) throws an Error naming the 1-based SOURCE line number, mirroring
// the strict invariant-throw style of generateCitekey in citekey.ts.
// =========================================================================

import { validateSlug } from './paths.js';

export interface ParsedOutlineSection {
  /** 1-based outline (reader) order index. */
  n: number;
  /** Bare kebab-case slug (validated). */
  slug: string;
  /** Raw human-readable title text. */
  title: string;
  /** Optional target word count. */
  estimated_word_count?: number;
  /** Bare slugs this section depends on (empty array when none). */
  depends_on: string[];
}

export interface ParsedOutline {
  paper_title: string;
  sections: ParsedOutlineSection[];
}

const EXPECTED_HEADER = ['#', 'slug', 'title', 'depends_on', 'word target', 'assigned_sources'];

/** A GFM delimiter row is all cells of the form `---`/`:--:`/etc. */
function isDelimiterRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c.trim()));
}

/**
 * Split a single GFM table line into trimmed cells. A leading and trailing
 * pipe are optional; we drop the empty edge cells they produce.
 */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/**
 * Parse the on-disk OUTLINE.md markdown into an ordered, slug-keyed section
 * list. PURE: no fs, no network. Throws on a malformed entry, naming the line.
 */
export function parseOutline(raw: string): ParsedOutline {
  const lines = raw.split(/\r?\n/);

  let paperTitle = '';
  let headerLineIdx = -1;

  // Find the H1 title (first `# ` line) and the table header row.
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (paperTitle === '' && /^#\s+\S/.test(trimmed)) {
      paperTitle = trimmed.replace(/^#\s+/, '').trim();
      continue;
    }
    if (trimmed.startsWith('|')) {
      const cells = splitRow(trimmed);
      if (
        cells.length === EXPECTED_HEADER.length &&
        cells.every((c, j) => c.toLowerCase() === EXPECTED_HEADER[j])
      ) {
        headerLineIdx = i;
        break;
      }
    }
  }

  if (headerLineIdx === -1) {
    throw new Error(
      `outline-parse: no section table found — expected a header row ` +
        `"| ${EXPECTED_HEADER.join(' | ')} |"`,
    );
  }

  const sections: ParsedOutlineSection[] = [];
  const seenSlugs = new Set<string>();

  for (let i = headerLineIdx + 1; i < lines.length; i += 1) {
    const lineNo = i + 1; // 1-based source line number
    const trimmed = lines[i]!.trim();
    if (trimmed === '') continue; // blank line ends/skips
    if (!trimmed.startsWith('|')) continue; // non-table content after table

    const cells = splitRow(trimmed);
    if (isDelimiterRow(cells)) continue; // GFM `| --- | --- | ... |` row

    if (cells.length !== EXPECTED_HEADER.length) {
      throw new Error(
        `outline-parse: couldn't parse line ${lineNo}: expected ` +
          `${EXPECTED_HEADER.length} columns, got ${cells.length}: ${JSON.stringify(trimmed)}`,
      );
    }

    const [nCell, slugCell, titleCell, depsCell, wordCell] = cells as [
      string, string, string, string, string, string,
    ];

    const n = Number(nCell);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(
        `outline-parse: couldn't parse line ${lineNo}: ` +
          `section number must be a positive integer, got ${JSON.stringify(nCell)}`,
      );
    }

    const slug = slugCell;
    try {
      validateSlug(slug);
    } catch (err) {
      throw new Error(
        `outline-parse: couldn't parse line ${lineNo}: invalid slug ` +
          `${JSON.stringify(slug)} — ${(err as Error).message}`,
      );
    }
    if (seenSlugs.has(slug)) {
      throw new Error(
        `outline-parse: couldn't parse line ${lineNo}: duplicate slug ${JSON.stringify(slug)}`,
      );
    }
    seenSlugs.add(slug);

    const depends_on = depsCell
      .split(',')
      .map((d) => d.trim())
      .filter((d) => d.length > 0);
    for (const dep of depends_on) {
      try {
        validateSlug(dep);
      } catch (err) {
        throw new Error(
          `outline-parse: couldn't parse line ${lineNo}: invalid depends_on slug ` +
            `${JSON.stringify(dep)} — ${(err as Error).message}`,
        );
      }
    }

    const section: ParsedOutlineSection = {
      n,
      slug,
      title: titleCell,
      depends_on,
    };

    const wordTrimmed = wordCell.trim();
    if (wordTrimmed !== '') {
      const wc = Number(wordTrimmed);
      if (!Number.isInteger(wc) || wc < 0) {
        throw new Error(
          `outline-parse: couldn't parse line ${lineNo}: word target must be a ` +
            `non-negative integer, got ${JSON.stringify(wordTrimmed)}`,
        );
      }
      section.estimated_word_count = wc;
    }

    sections.push(section);
  }

  return { paper_title: paperTitle, sections };
}

// =========================================================================
// Renderer (RUN-25 / D-17-23): the canonical OUTLINE.md is rendered from the
// validated outline-author object — never copied from model text — and is
// exactly the table parseOutline() reads back.
// =========================================================================

/**
 * The `assigned_sources` column per section number (the table's 6th column,
 * which parseOutline's wave-graph view does not carry). Used by `plan` to hand
 * the section planner the outline's source assignment. Pure; never throws —
 * an unparseable outline yields an empty map.
 */
export function parseOutlineAssignedSources(raw: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  let parsed: ParsedOutline;
  try {
    parsed = parseOutline(raw);
  } catch {
    return out;
  }
  const bySlug = new Map(parsed.sections.map((s) => [s.slug, s.n]));
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = splitRow(trimmed);
    if (cells.length !== EXPECTED_HEADER.length || isDelimiterRow(cells)) continue;
    const n = bySlug.get(cells[1] ?? '');
    if (n === undefined || String(n) !== cells[0]) continue;
    out.set(n, (cells[5] ?? '').split(',').map((c) => c.trim()).filter((c) => c.length > 0));
  }
  return out;
}

/** The subset of the llm-contracts.ts OutlineSchema the renderer needs. */
export interface OutlineRenderInput {
  thesis: string;
  sections: ReadonlyArray<{
    n: number;
    slug: string;
    title: string;
    purpose: string;
    depends_on: readonly string[];
    estimated_word_count: number;
    assigned_sources: readonly string[];
    role: string;
    voice?: string | undefined;
  }>;
}

/** One table cell: single line, no pipe (parseOutline splits on '|'). */
function cell(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
}

/**
 * Render the canonical OUTLINE.md: an H1 title, the thesis, the locked section
 * table, then one detail line per section (role, purpose, voice). The detail
 * lines never start with '|', so parseOutline ignores them.
 */
export function renderOutlineMd(outline: OutlineRenderInput, paperTitle: string): string {
  const lines: string[] = [`# ${cell(paperTitle) || 'Outline'}`, ''];
  if (outline.thesis.trim()) lines.push(`Thesis: ${cell(outline.thesis)}`, '');
  lines.push(`| ${EXPECTED_HEADER.join(' | ')} |`);
  lines.push(`| ${EXPECTED_HEADER.map(() => '---').join(' | ')} |`);
  const ordered = [...outline.sections].sort((a, b) => a.n - b.n);
  for (const s of ordered) {
    lines.push(
      `| ${s.n} | ${s.slug} | ${cell(s.title)} | ${s.depends_on.join(', ')} | ${s.estimated_word_count} | ${s.assigned_sources.map(cell).join(', ')} |`,
    );
  }
  lines.push('', '## Sections', '');
  for (const s of ordered) {
    const bits = [`role: ${cell(s.role)}`];
    if (s.purpose.trim()) bits.push(`purpose: ${cell(s.purpose)}`);
    if (s.voice && s.voice.trim()) bits.push(`voice: ${cell(s.voice)}`);
    lines.push(`- §${s.n} ${cell(s.title)} — ${bits.join('; ')}`);
  }
  lines.push('');
  const md = lines.join('\n');
  // Self-check: the rendered file must round-trip through the parser.
  parseOutline(md);
  return md;
}
