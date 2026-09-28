// bin/lib/outline-parse.ts — PURE parser and renderer for .paper/OUTLINE.md
// (GRND-07, D-18-14).
//
// The raw-file READ side lives in bin/lib/outline.ts (loadOutline); this module
// is the string↔object side and performs NO fs I/O — keeping it pure makes the
// wave scheduler, compile, the router's helpers and the Tier-1 outline
// registration (Phase 23) trivially testable.
//
// =========================================================================
// CANONICAL .paper/OUTLINE.md FORMAT (Phase 18; rendered by renderOutlineMd)
// =========================================================================
//   # <paper title>
//
//   Thesis: <thesis>
//
//   | # | slug | title | role | depends_on | word target | assigned_sources | voice |
//   | --- | --- | --- | --- | --- | --- | --- | --- |
//   | 1 | introduction | Introduction | intro |  | 300 | vaswani2017, bahdanau2015 |  |
//   | 1a | background | Background | body | introduction | 300 | luong2015 | plain |
//   | 3 | conclusion | Conclusion | conclusion | background | 300 | vaswani2017 |  |
//
//   ## Sections
//
//   - §1 Introduction — role: intro; purpose: Frame the question.
//
// Columns:
//   #                -> n + optional suffix (`1`, `1a`: section-id.ts)
//   slug             -> slug (validated via paths.ts::validateSlug)
//   title            -> title (raw cell text)
//   role             -> role (one of SECTION_ROLES; empty = unknown)
//   depends_on       -> depends_on (comma-split bare slugs; empty cell = [])
//   word target      -> estimated_word_count (optional non-negative int)
//   assigned_sources -> assigned_sources (comma-split citekeys; FEED-04 seeds
//                       each section's stub PLAN.md from it)
//   voice            -> voice (optional voice hint, PRD §7.18)
// The `## Sections` detail lines carry each section's purpose; they never
// start with '|', so the table scan ignores them.
//
// The LEGACY 6-column table (Phase 3..17) is still read:
//   | # | slug | title | depends_on | word target | assigned_sources |
// with role and voice absent. A legacy slug keeps its spelling (an outline
// written by an older pensmith may carry `01-introduction` slugs whose folders
// are `01-01-introduction/`): only the MODEL's reply is normalised
// (llm-contracts.ts OutlineSchema), never a file on disk.
//
// A malformed data row (wrong column count, bad `#`, bad slug, bad role, bad
// word target, duplicate id or slug) throws an Error naming the 1-based SOURCE
// line number. Line endings may be LF or CRLF.
// =========================================================================

import { validateSlug } from './paths.js';
import { SECTION_ROLES, type SectionRole } from './schemas/plan-frontmatter.js';
import { compareSectionIds, formatSectionId, parseSectionId, sectionIdOf } from './section-id.js';

export interface ParsedOutlineSection {
  /** Section number (the `#` cell without its letter). */
  n: number;
  /** One lowercase letter for a section inserted after §n (`1a`), else absent. */
  suffix?: string;
  /** Bare kebab-case slug (validated). */
  slug: string;
  /** Raw human-readable title text. */
  title: string;
  /** Optional target word count. */
  estimated_word_count?: number;
  /** Bare slugs this section depends on (empty array when none). */
  depends_on: string[];
  /** The section's role (absent in a legacy table or an empty cell). */
  role?: SectionRole;
  /** The outline's source allocation for this section (citekeys). */
  assigned_sources?: string[];
  /** Optional voice hint (PRD §7.18). */
  voice?: string;
  /** The section's purpose, from the `## Sections` detail lines. */
  purpose?: string;
}

/**
 * The minimal outline shape the wave scheduler and compile consume (callers
 * and tests may build one by hand). parseOutline returns the richer
 * OutlineDocument, which is assignable to it.
 */
export interface ParsedOutline {
  paper_title: string;
  thesis?: string;
  format?: 'canonical' | 'legacy';
  sections: ParsedOutlineSection[];
}

/** One row of a parsed OUTLINE.md (every field the file carries). */
export interface OutlineRow extends ParsedOutlineSection {
  assigned_sources: string[];
}

/** A parsed OUTLINE.md. */
export interface OutlineDocument extends ParsedOutline {
  /** The `Thesis:` line ('' when absent). */
  thesis: string;
  /** Which table the file carries. */
  format: 'canonical' | 'legacy';
  /** Sections in table order. */
  sections: OutlineRow[];
}

/** The canonical header (Phase 18). */
export const OUTLINE_HEADER = ['#', 'slug', 'title', 'role', 'depends_on', 'word target', 'assigned_sources', 'voice'] as const;
/** The pre-Phase-18 header, still accepted. */
export const LEGACY_OUTLINE_HEADER = ['#', 'slug', 'title', 'depends_on', 'word target', 'assigned_sources'] as const;

const ROLE_SET: ReadonlySet<string> = new Set(SECTION_ROLES);

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

function headerMatches(cells: readonly string[], header: readonly string[]): boolean {
  return cells.length === header.length && cells.every((c, j) => c.toLowerCase() === header[j]);
}

function list(cell: string): string[] {
  return cell.split(',').map((d) => d.trim()).filter((d) => d.length > 0);
}

/** `- §1a Title — role: body; purpose: …` → id, role, purpose. */
const DETAIL_RE = /^-\s+§(\d{1,2}[a-z]?)\s.*?\s—\s+role:\s*([a-z-]+)(?:;\s*purpose:\s*(.*?))?(?:;\s*voice:\s*.*)?\s*$/;

/**
 * Parse the on-disk OUTLINE.md markdown into an ordered, slug-keyed section
 * list. PURE: no fs, no network. Throws on a malformed entry, naming the line.
 */
export function parseOutline(raw: string): OutlineDocument {
  const lines = raw.split(/\r?\n/);

  let paperTitle = '';
  let thesis = '';
  let headerLineIdx = -1;
  let format: OutlineDocument['format'] = 'canonical';

  // Find the H1 title (first `# ` line), the thesis line and the table header row.
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i]!.trim();
    if (paperTitle === '' && /^#\s+\S/.test(trimmed)) {
      paperTitle = trimmed.replace(/^#\s+/, '').trim();
      continue;
    }
    if (thesis === '' && /^Thesis:\s*\S/.test(trimmed)) {
      thesis = trimmed.replace(/^Thesis:\s*/, '').trim();
      continue;
    }
    if (trimmed.startsWith('|')) {
      const cells = splitRow(trimmed);
      if (headerMatches(cells, OUTLINE_HEADER)) {
        headerLineIdx = i;
        format = 'canonical';
        break;
      }
      if (headerMatches(cells, LEGACY_OUTLINE_HEADER)) {
        headerLineIdx = i;
        format = 'legacy';
        break;
      }
    }
  }

  if (headerLineIdx === -1) {
    throw new Error(
      `outline-parse: no section table found — expected a header row ` +
        `"| ${OUTLINE_HEADER.join(' | ')} |"`,
    );
  }

  const header: readonly string[] = format === 'canonical' ? OUTLINE_HEADER : LEGACY_OUTLINE_HEADER;
  const sections: OutlineRow[] = [];
  const seenSlugs = new Set<string>();
  const seenIds = new Set<string>();
  let i = headerLineIdx + 1;

  for (; i < lines.length; i += 1) {
    const lineNo = i + 1; // 1-based source line number
    const trimmed = lines[i]!.trim();
    if (trimmed === '') continue; // blank line ends/skips
    if (!trimmed.startsWith('|')) {
      if (/^##\s/.test(trimmed)) break; // the detail section follows the table
      continue; // non-table content after the table
    }

    const cells = splitRow(trimmed);
    if (isDelimiterRow(cells)) continue; // GFM `| --- | --- | ... |` row

    if (cells.length !== header.length) {
      throw new Error(
        `outline-parse: couldn't parse line ${lineNo}: expected ` +
          `${header.length} columns, got ${cells.length}: ${JSON.stringify(trimmed)}`,
      );
    }

    const get = (name: string): string => cells[header.indexOf(name)] ?? '';
    const idCell = get('#');
    const id = parseSectionId(idCell);
    if (id === null) {
      throw new Error(
        `outline-parse: couldn't parse line ${lineNo}: ` +
          `section number must be 1-99 with an optional letter (e.g. 2 or 1a), got ${JSON.stringify(idCell)}`,
      );
    }
    const idText = formatSectionId(id);
    if (seenIds.has(idText)) {
      throw new Error(`outline-parse: couldn't parse line ${lineNo}: duplicate section number ${JSON.stringify(idText)}`);
    }
    seenIds.add(idText);

    const slug = get('slug');
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

    const depends_on = list(get('depends_on'));
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

    const section: OutlineRow = {
      n: id.n,
      slug,
      title: get('title'),
      depends_on,
      assigned_sources: list(get('assigned_sources')),
    };
    if (id.suffix !== undefined) section.suffix = id.suffix;

    const wordTrimmed = get('word target').trim();
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

    if (format === 'canonical') {
      const role = get('role');
      if (role !== '') {
        if (!ROLE_SET.has(role)) {
          throw new Error(
            `outline-parse: couldn't parse line ${lineNo}: role must be one of ${SECTION_ROLES.join(', ')}, got ${JSON.stringify(role)}`,
          );
        }
        section.role = role as SectionRole;
      }
      const voice = get('voice');
      if (voice !== '') section.voice = voice;
    }

    sections.push(section);
  }

  // The `## Sections` detail lines: each section's purpose (and its role in a
  // legacy file, whose table has no role column).
  const byId = new Map(sections.map((s) => [formatSectionId(sectionIdOf(s.n, s.suffix)), s]));
  for (; i < lines.length; i += 1) {
    const m = DETAIL_RE.exec(lines[i]!.trim());
    if (!m) continue;
    const s = byId.get(m[1] as string);
    if (!s) continue;
    const role = m[2] as string;
    if (s.role === undefined && ROLE_SET.has(role)) s.role = role as SectionRole;
    const purpose = (m[3] ?? '').trim();
    if (purpose.length > 0 && s.purpose === undefined) s.purpose = purpose;
  }

  return { paper_title: paperTitle, thesis, format, sections };
}

/** A section's id (`1`, `1a`) as its `#` cell prints it. */
export function outlineSectionId(s: Pick<ParsedOutlineSection, 'n' | 'suffix'>): string {
  return formatSectionId(sectionIdOf(s.n, s.suffix));
}

/** The sections of a parsed outline in (n, suffix) order. */
export function orderedOutlineSections<T extends ParsedOutlineSection>(outline: { sections: readonly T[] }): T[] {
  return [...outline.sections].sort((a, b) => compareSectionIds(sectionIdOf(a.n, a.suffix), sectionIdOf(b.n, b.suffix)));
}

// =========================================================================
// Renderer (RUN-25 / D-17-23, GRND-07): the canonical OUTLINE.md is rendered
// from the validated outline object — never copied from model text — and is
// exactly the table parseOutline() reads back.
// =========================================================================

/** One section as the renderer needs it (llm-contracts.ts OutlineSchema plus an optional letter). */
export interface OutlineRenderSection {
  n: number;
  suffix?: string | undefined;
  slug: string;
  title: string;
  purpose: string;
  depends_on: readonly string[];
  estimated_word_count: number;
  assigned_sources: readonly string[];
  role: string;
  voice?: string | undefined;
}

/** The subset of the llm-contracts.ts OutlineSchema the renderer needs. */
export interface OutlineRenderInput {
  thesis: string;
  sections: ReadonlyArray<OutlineRenderSection>;
}

/** One table cell: single line, no pipe (parseOutline splits on '|'). */
function cell(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
}

/**
 * Render the canonical OUTLINE.md: an H1 title, the thesis, the section table
 * in (n, suffix) order, then one detail line per section (role, purpose). The
 * detail lines never start with '|', so the table scan ignores them.
 * `marker` (the --dry-run offline marker line) goes after the H1 title.
 */
export function renderOutlineMd(outline: OutlineRenderInput, paperTitle: string, opts: { marker?: string | null } = {}): string {
  const lines: string[] = [`# ${cell(paperTitle) || 'Outline'}`, ''];
  if (opts.marker) lines.push(opts.marker, '');
  if (outline.thesis.trim()) lines.push(`Thesis: ${cell(outline.thesis)}`, '');
  lines.push(`| ${OUTLINE_HEADER.join(' | ')} |`);
  lines.push(`| ${OUTLINE_HEADER.map(() => '---').join(' | ')} |`);
  const ordered = [...outline.sections].sort((a, b) =>
    compareSectionIds(sectionIdOf(a.n, a.suffix), sectionIdOf(b.n, b.suffix)),
  );
  for (const s of ordered) {
    const id = formatSectionId(sectionIdOf(s.n, s.suffix));
    lines.push(
      `| ${id} | ${s.slug} | ${cell(s.title)} | ${cell(s.role)} | ${s.depends_on.join(', ')} | ${s.estimated_word_count} | ` +
        `${s.assigned_sources.map(cell).join(', ')} | ${cell(s.voice ?? '')} |`,
    );
  }
  lines.push('', '## Sections', '');
  for (const s of ordered) {
    const id = formatSectionId(sectionIdOf(s.n, s.suffix));
    const bits = [`role: ${cell(s.role)}`];
    if (s.purpose.trim()) bits.push(`purpose: ${cell(s.purpose)}`);
    lines.push(`- §${id} ${cell(s.title)} — ${bits.join('; ')}`);
  }
  lines.push('');
  const md = lines.join('\n');
  // Self-check: the rendered file must round-trip through the parser.
  parseOutline(md);
  return md;
}
