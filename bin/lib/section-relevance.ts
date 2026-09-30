// bin/lib/section-relevance.ts — which sections is a new source relevant to?
// (SRC-14, D-19-20)
//
// `add` used to offer "remap every section" after adding a source, so a
// psychology source landed in the methods section of an unrelated paper. The
// remap now proposes only the sections whose outline entry overlaps the
// source: the section's title, purpose (PLAN.md frontmatter, GRND-09) and
// plan body (its claims) against the source's title and abstract.
//
// The score is deterministic and explainable — the shared content words are
// printed next to each proposed section:
//   - words are lower-cased, NFKC-normalized letters/digits, at least 3
//     characters, minus stop words, with a light plural/suffix fold
//     ("networks" → "network", "studies" → "study");
//   - a section is relevant when it shares at least RELEVANT_MIN_SHARED
//     distinct words with the source, or at least one word that is in BOTH
//     the source title and the section title.
// Pure except loadSectionInfos, which reads STATE.json, OUTLINE.md and each
// section's PLAN.md (read-only).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadState } from './state.js';
import { sectionPlan, paperDir } from './paths.js';
import { parseOutline } from './outline-parse.js';
import { parseFrontmatter } from './frontmatter.js';
import { compareSectionIds, formatSectionId, sectionIdOf } from './section-id.js';

/** The minimum number of distinct shared content words for a relevant section. */
export const RELEVANT_MIN_SHARED = 2;

export interface SectionInfo {
  readonly n: number;
  /** The section's letter (GRND-09: §1a); absent for a plain §N. */
  readonly suffix?: string | undefined;
  readonly slug: string;
  readonly title: string;
  /** The outline purpose (PLAN.md frontmatter), when present. */
  readonly purpose: string;
  /** The PLAN.md body (claims, notes), when present. */
  readonly body: string;
}

export interface SourceText {
  readonly title: string | null;
  readonly abstract?: string | null;
}

export interface SectionRelevance {
  readonly section: SectionInfo;
  readonly relevant: boolean;
  /** The distinct content words the source and the section share, sorted. */
  readonly shared: readonly string[];
}

const STOP_WORDS = new Set(
  (
    'the and for with from into onto over under about above below between among through during before after ' +
    'this that these those their there then than they them its his her our your you are was were been being ' +
    'have has had not but can could would should will shall may might must also more most less least such ' +
    'each other some any all both either neither own same very just only via per upon within without across ' +
    'what which who whom whose when where why how here while whereas however therefore thus hence '+
    'study studies paper article chapter section review analysis approach method methods result results ' +
    'using used use based new novel toward towards one two three first second third data effect effects'
  ).split(/\s+/),
);

/** Light suffix folding so "networks"/"network" and "studies"/"study" meet. */
function fold(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('es') && /(?:ss|sh|ch|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** The distinct folded content words of `text`. */
export function contentWords(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of (text ?? '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || /^\d+$/.test(raw) || STOP_WORDS.has(raw)) continue;
    const w = fold(raw);
    if (!STOP_WORDS.has(w)) out.add(w);
  }
  return out;
}

/** How `source` relates to one section (see the header). */
export function sectionRelevance(source: SourceText, section: SectionInfo): SectionRelevance {
  const sourceWords = contentWords(`${source.title ?? ''} ${source.abstract ?? ''}`);
  const sectionWords = contentWords(`${section.title} ${section.purpose} ${section.body}`);
  const shared = [...sourceWords].filter((w) => sectionWords.has(w)).sort();
  const titleWords = contentWords(source.title);
  const sectionTitleWords = contentWords(section.title);
  const titleHit = [...titleWords].some((w) => sectionTitleWords.has(w));
  return { section, relevant: shared.length >= RELEVANT_MIN_SHARED || titleHit, shared };
}

/** Every section, scored against `source`, in section order. */
export function rankSections(source: SourceText, sections: readonly SectionInfo[]): SectionRelevance[] {
  return sections.map((s) => sectionRelevance(source, s));
}

/**
 * The paper's sections with their outline entries: STATE.json's sections, each
 * section's title / purpose / body from its PLAN.md, the OUTLINE.md title as a
 * fallback. Sections without a PLAN.md are included (a new source can be
 * assigned before planning); a missing or unreadable STATE.json yields the
 * OUTLINE.md sections, else none.
 */
export async function loadSectionInfos(root: string): Promise<SectionInfo[]> {
  // Sections are keyed by their id (`1`, `1a`): §1a is its own section (GRND-09).
  const key = (n: number, suffix: string | undefined): string => formatSectionId(sectionIdOf(n, suffix));
  const outlineTitles = new Map<string, { n: number; suffix: string | undefined; slug: string; title: string }>();
  try {
    const parsed = parseOutline(fs.readFileSync(path.join(paperDir(root), 'OUTLINE.md'), 'utf8'));
    for (const s of parsed.sections) outlineTitles.set(key(s.n, s.suffix), { n: s.n, suffix: s.suffix, slug: s.slug, title: s.title });
  } catch {
    /* no usable outline */
  }
  let rows: Array<{ n: number; suffix: string | undefined; slug: string }>;
  try {
    // STATE.json is the authority on a section's identity (D-18-38).
    const state = await loadState(root);
    rows = (state.sections ?? []).map((s) => ({ n: s.n, suffix: s.suffix, slug: s.slug }));
  } catch {
    rows = [];
  }
  if (rows.length === 0) rows = [...outlineTitles.values()].map((s) => ({ n: s.n, suffix: s.suffix, slug: s.slug }));
  const infos: SectionInfo[] = [];
  const ordered = [...rows].sort((a, b) => compareSectionIds(sectionIdOf(a.n, a.suffix), sectionIdOf(b.n, b.suffix)));
  for (const { n, suffix, slug } of ordered) {
    let title = outlineTitles.get(key(n, suffix))?.title ?? slug;
    let purpose = '';
    let body = '';
    try {
      const doc = parseFrontmatter(fs.readFileSync(sectionPlan(n, slug, root), 'utf8'));
      const fm = doc.frontmatter as Record<string, unknown>;
      if (typeof fm['title'] === 'string' && fm['title'].trim()) title = fm['title'].trim();
      if (typeof fm['purpose'] === 'string') purpose = fm['purpose'];
      body = doc.body;
    } catch {
      /* no PLAN.md yet */
    }
    infos.push({ n, ...(suffix !== undefined ? { suffix } : {}), slug, title, purpose, body });
  }
  return infos;
}
