/**
 * bin/lib/outline-parse.ts
 * 
 * Pure parser for .paper/OUTLINE.md markdown table.
 */

import { validateSlug } from './paths.js';

export interface ParsedOutlineSection {
  n: number;
  slug: string;
  title: string;
  depends_on: string[];
  estimated_word_count?: number;
  assigned_sources: string[];
}

export interface ParsedOutline {
  paper_title: string;
  sections: ParsedOutlineSection[];
}

/**
 * Parse the on-disk .paper/OUTLINE.md format.
 * Format: Markdown table
 * | # | slug | title | depends_on | word target | assigned_sources |
 */
export function parseOutline(raw: string): ParsedOutline {
  const lines = raw.split(/\r?\n/);
  const sections: ParsedOutlineSection[] = [];
  let paper_title = '';

  const slugs = new Set<string>();
  const nums = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine === undefined) continue;
    const line = rawLine.trim();
    if (!line) continue;

    // Extract paper title from first H1
    if (!paper_title && line.startsWith('# ')) {
      paper_title = line.slice(2).trim();
      continue;
    }

    // Skip header and separator lines
    if (line.startsWith('| # |') || (line.startsWith('|--') && line.includes('|'))) {
      continue;
    }

    // Parse table row
    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line.slice(1, -1).split('|').map(c => c.trim());
      if (cells.length < 6) {
        throw new Error(`outline-parse: couldn't parse line ${i + 1}: ${line}`);
      }

      const nStr = cells[0];
      const slug = cells[1];
      const title = cells[2];

      if (nStr === undefined || slug === undefined || title === undefined) {
        throw new Error(`outline-parse: couldn't parse line ${i + 1}: ${line}`);
      }

      const n = parseInt(nStr, 10);
      const depends_on = cells[3] ? cells[3].split(',').map(s => s.trim()).filter(Boolean) : [];
      const word_target = cells[4] ? parseInt(cells[4], 10) : undefined;
      const assigned_sources = cells[5] ? cells[5].split(',').map(s => s.trim()).filter(Boolean) : [];

      if (isNaN(n)) {
        throw new Error(`outline-parse: couldn't parse line ${i + 1}: ${line}`);
      }

      validateSlug(slug);

      if (slugs.has(slug)) {
        throw new Error(`duplicate slug: ${slug}`);
      }
      if (nums.has(n)) {
        throw new Error(`duplicate section number: ${n}`);
      }

      slugs.add(slug);
      nums.add(n);

      const section: ParsedOutlineSection = {
        n,
        slug,
        title,
        depends_on,
        assigned_sources
      };

      if (word_target !== undefined && !Number.isNaN(word_target)) {
        section.estimated_word_count = word_target;
      }

      sections.push(section);
    }
  }

  return {
    paper_title: paper_title || 'Untitled Paper',
    sections
  };
}
