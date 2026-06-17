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
