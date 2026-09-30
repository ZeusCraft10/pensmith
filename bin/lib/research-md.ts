// bin/lib/research-md.ts — the curated source list of .paper/RESEARCH.md,
// rendered from LIBRARY.json (Phase 19 seam S-B; SRC-09, SRC-14, SRC-15,
// SRC-16, GRND-17; PRD §7.2, §7.15, §9).
//
// SEAM FILE (Phase 19 plan, S-B). Every Phase 19 stream applies it
// byte-identically from .planning/phases/19-sources/seams/; no stream edits it
// during Phase 19.
//
// RESEARCH.md has three parts:
//   1. the generated research log (scope, queries, per-adapter outcomes),
//      rewritten by each `pensmith research` run;
//   2. inside it, the SOURCES BLOCK — every LIBRARY.json entry with its
//      formatted reference, tier, relevance, provenance tags (search,
//      bring-your-own, zotero, added, plan-research, imported), why-relevant
//      note and abstract — between SOURCES_START and SOURCES_END;
//   3. after RESEARCH_LOG_END, the user's notes, never touched.
// The sources block is a VIEW of LIBRARY.json: every ingest path (research,
// `add`, BYO ingest, Zotero ingest, `plan --research`) calls
// refreshResearchSources() after its upsertSources(), so RESEARCH.md never
// lists a source the library lacks or misses one it has. Nothing else in the
// file changes. The block uses list items only (no `### ` headings), so the
// tutorial's curated-claims parser (bin/cli/goal.ts) never mistakes a source
// for a curated `supports:` entry.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { libraryPaths, tryLoadLibrary } from './library.js';
import type { LibraryEntry } from './schemas/library.js';
import { lookupTable } from './lookup-table.js';

/**
 * The line that ends the generated research log. Identical to (and asserted
 * equal with) research-orchestrator.ts's RESEARCH_LOG_END; stream `research`
 * turns that one into a re-export of this.
 */
export const RESEARCH_LOG_END =
  '<!-- end of the research log: `pensmith research` rewrites everything above this line; notes below it are kept -->';

export const SOURCES_START = '<!-- pensmith:sources:start (rendered from LIBRARY.json) -->';
export const SOURCES_END = '<!-- pensmith:sources:end -->';

/**
 * `s` with the HTML-comment delimiters made inert (`<!--` → `<!‑‑`, `-->` →
 * `‑‑>`, U+2011 non-breaking hyphens). Titles, abstracts, notes and reasons
 * come from registrars, Zotero items and PDF metadata: a value carrying a
 * marker comment (`<!-- pensmith:sources:end -->`) must never read as one
 * (review round 2). Every value rendered into RESEARCH.md goes through it.
 */
export function inertMarkup(s: string): string {
  return s.replace(/<!--/g, '<!\u2011\u2011').replace(/-->/g, '\u2011\u2011>');
}

/**
 * The start offsets of the lines of `text` that are exactly `marker` (a
 * trailing `\r` allowed). Markers are matched only as whole lines: a marker's
 * text inside a line is never one.
 */
export function markerLines(text: string, marker: string): number[] {
  const out: number[] = [];
  let at = 0;
  for (const line of text.split('\n')) {
    if (line.replace(/\r$/, '') === marker) out.push(at);
    at += line.length + 1;
  }
  return out;
}

const ABSTRACT_CHARS = 600;
const MAX_LISTED_AUTHORS = 3;

/** Provenance-tag prefix → the tag RESEARCH.md shows. */
const TAG_FOR_PREFIX: Readonly<Record<string, string>> = lookupTable({
  research: 'search',
  add: 'added',
  byo: 'bring-your-own',
  zotero: 'zotero',
  'plan-research': 'plan-research',
  'bib-import': 'imported',
  v1: 'imported',
});

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** `text` cut at a word boundary to at most `max` characters, with an ellipsis when cut. */
function excerpt(text: string, max: number): string {
  const flat = oneLine(text);
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

/** The provenance tags of an entry, in first-seen order, deduplicated. */
export function provenanceTags(entry: Pick<LibraryEntry, 'provenance' | 'byo' | 'synthetic'>): string[] {
  const tags: string[] = [];
  const push = (t: string): void => {
    if (!tags.includes(t)) tags.push(t);
  };
  for (const p of entry.provenance) {
    const [prefix = p, adapter = ''] = p.split(':');
    // A research hit from the user's own library is tagged by where it came
    // from (`research:zotero` → zotero, `research:byo` → bring-your-own).
    if (adapter === 'zotero' || adapter === 'zotero-mcp') push('zotero');
    else if (adapter === 'byo') push('bring-your-own');
    else push(TAG_FOR_PREFIX[prefix] ?? prefix);
  }
  if (entry.byo !== null) push('bring-your-own');
  if (entry.synthetic) push('synthetic (dry-run)');
  return tags;
}

/** An author string as a reader sees it: braces of a corporate name removed. */
function displayAuthor(a: string): string {
  const t = a.trim();
  return t.startsWith('{') && t.endsWith('}') ? t.slice(1, -1).trim() : t;
}

/** The persistent identifier a reader can follow, or null. */
function identifierText(e: LibraryEntry): string | null {
  if (e.doi) return `https://doi.org/${e.doi}`;
  if (e.arxiv) return `arXiv:${e.arxiv}`;
  if (e.isbn) return `ISBN ${e.isbn}`;
  if (e.pmid) return `PMID ${e.pmid}`;
  if (e.pmcid) return e.pmcid;
  return null;
}

/**
 * A deterministic, style-neutral reference line: Authors (Year). Title.
 * Venue, Volume(Issue), Pages. Publisher. Identifier. (The paper's CSL style is
 * applied at export; this line only has to identify the work unambiguously.)
 */
export function formatReference(e: LibraryEntry): string {
  const names = e.authors.map(displayAuthor).filter((a) => a.length > 0);
  const who =
    names.length === 0
      ? e.editors.length > 0
        ? `${e.editors.slice(0, MAX_LISTED_AUTHORS).map(displayAuthor).join('; ')} (Ed${e.editors.length > 1 ? 's' : ''}.)`
        : 'Anonymous'
      : names.length > MAX_LISTED_AUTHORS
        ? `${names.slice(0, MAX_LISTED_AUTHORS).join('; ')}; et al.`
        : names.join('; ');
  const parts: string[] = [`${who} (${e.year ?? 'n.d.'}).`];
  parts.push(`${oneLine(e.title ?? '(untitled)').replace(/[.]+$/, '')}.`);
  const where: string[] = [];
  if (e.venue) where.push(oneLine(e.venue));
  if (e.volume) where.push(e.issue ? `${e.volume}(${e.issue})` : e.volume);
  else if (e.issue) where.push(`(${e.issue})`);
  if (e.pages) where.push(e.pages);
  if (where.length > 0) parts.push(`${where.join(', ')}.`);
  if (e.publisher && e.publisher !== e.venue) parts.push(`${oneLine(e.publisher)}.`);
  const id = identifierText(e);
  if (id) parts.push(id);
  return parts.join(' ');
}

/** Sources sorted for reading: relevance (highest first, unscored last), then citekey. */
function sortedForReading(entries: readonly LibraryEntry[]): LibraryEntry[] {
  return [...entries].sort((a, b) => {
    const ra = a.relevance ?? -1;
    const rb = b.relevance ?? -1;
    if (ra !== rb) return rb - ra;
    return a.citekey < b.citekey ? -1 : a.citekey > b.citekey ? 1 : 0;
  });
}

/** The sources block (markers included) for `entries`. Deterministic. */
export function renderSourcesBlock(entries: readonly LibraryEntry[]): string {
  const lines: string[] = [SOURCES_START, `## Sources (${entries.length})`, ''];
  if (entries.length === 0) lines.push('_No sources in LIBRARY.json yet._');
  for (const e of sortedForReading(entries)) {
    lines.push(`- [@${e.citekey}] ${formatReference(e)}`);
    const facts: string[] = [`Tier: ${e.tier ?? 'not evaluated'}`];
    if (e.relevance !== null) facts.push(`Relevance: ${e.relevance.toFixed(2)}`);
    const tags = provenanceTags(e);
    if (tags.length > 0) facts.push(`Tags: ${tags.join(', ')}`);
    lines.push(`  - ${facts.join(' · ')}`);
    if (e.why_relevant) lines.push(`  - Why relevant: ${oneLine(e.why_relevant)}`);
    if (e.abstract) lines.push(`  - Abstract: ${excerpt(e.abstract, ABSTRACT_CHARS)}`);
    if (e.retraction_status === 'retracted') {
      lines.push(`  - Retraction: RETRACTED${e.retraction_details ? ` — ${oneLine(e.retraction_details)}` : ''}`);
    } else if (e.retraction_status === 'unknown') {
      // D-20-13: another agency's DOI has no retraction data (the reason is
      // recorded); otherwise the lookup failed. Either way: never "clear".
      lines.push(
        e.retraction_details
          ? `  - Retraction: retraction status unknown (${oneLine(e.retraction_details)}; it is re-checked at verify time)`
          : '  - Retraction: retraction status unknown (the lookup failed; it is re-checked at verify time)',
      );
    }
    if (!e.hydrated) {
      lines.push('  - Metadata: local only — no registrar record matched this PDF confidently; check it before citing');
    }
  }
  return [SOURCES_START, ...lines.slice(1).map(inertMarkup), SOURCES_END].join('\n');
}

/**
 * `existing` RESEARCH.md text with its sources block replaced by `block`
 * (inserted just above RESEARCH_LOG_END when the file has none; a new file
 * when `existing` is null or blank). Everything outside the block is kept
 * byte-for-byte. The block adopts the file's line ending (LF or CRLF).
 */
export function upsertSourcesBlock(existing: string | null, block: string): string {
  if (existing === null || existing.trim().length === 0) {
    return `# Research\n\n${block}\n\n${RESEARCH_LOG_END}\n`;
  }
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const b = eol === '\n' ? block : block.replace(/\n/g, '\r\n');
  const start = markerLines(existing, SOURCES_START).at(-1) ?? -1;
  const end = start >= 0 ? markerLines(existing, SOURCES_END).find((i) => i > start) ?? -1 : -1;
  if (start >= 0 && end >= 0) {
    return existing.slice(0, start) + b + existing.slice(end + SOURCES_END.length);
  }
  const logEnd = markerLines(existing, RESEARCH_LOG_END)[0] ?? -1;
  if (logEnd >= 0) {
    const before = existing.slice(0, logEnd).replace(/(?:\r?\n)*$/, '');
    return `${before}${eol}${eol}${b}${eol}${eol}${existing.slice(logEnd)}`;
  }
  return `# Research${eol}${eol}${b}${eol}${eol}${RESEARCH_LOG_END}${eol}${eol}${existing}`;
}

export interface RefreshResult {
  readonly path: string;
  readonly changed: boolean;
  readonly count: number;
}

/**
 * Re-render the sources block of the paper's RESEARCH.md from its LIBRARY.json
 * (under the RESEARCH.md lock; written only when the text changes). A paper
 * with neither a library nor a RESEARCH.md is left alone.
 */
export async function refreshResearchSources(root: string): Promise<RefreshResult> {
  const dir = libraryPaths(root).dir;
  const file = path.join(dir, 'RESEARCH.md');
  const library = await tryLoadLibrary(root);
  const entries = library?.entries ?? [];
  return withLock(file, async () => {
    const existing = fs.existsSync(file) ? await fs.promises.readFile(file, 'utf8') : null;
    if (existing === null && entries.length === 0) return { path: file, changed: false, count: 0 };
    const next = upsertSourcesBlock(existing, renderSourcesBlock(entries));
    if (next === existing) return { path: file, changed: false, count: entries.length };
    await atomicWriteFile(file, next);
    return { path: file, changed: true, count: entries.length };
  });
}
