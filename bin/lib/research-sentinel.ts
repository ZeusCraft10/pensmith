// bin/lib/research-sentinel.ts — "has the research stage been done?" for the
// router, the list/status deriver and the estimator (audit M1; D-19-16,
// D-19-27; Phase 19 review round 1).
//
// The research stage is done — the router may move on to the outline — when
//   - the paper is outlined (OUTLINE.md exists), or
//   - .paper/RESEARCH.md is the log of a research run (`# Research log`) that
//     did not fail, or
//   - .paper/RESEARCH.md is a legacy / curated file (not just the sources view
//     the library writer renders), or
//   - LIBRARY.json holds an entry some research produced (a provenance tag
//     other than the user's own-source paths `byo`, `zotero` and `add`: e.g.
//     `research:…`, `plan-research:…`, an imported bib), or it is unreadable
//     (the next verb reports it in one line, RUN-12, instead of the router
//     looping on research), or it exists and is empty (the Phase 17 rule).
// NOT done: a paper whose only sources are the user's own — `new --pdfs`,
// `add`, a Zotero ingest (Tier 1's paper_ingest_zotero_items included) — and
// whose RESEARCH.md is only the sources view those paths refresh: PRD §7.1 /
// §7.2 route `new` to research, which ingests the user's sources FIRST and then
// searches; an outline built on two PDFs alone skips discovery.
// A FAILED research run (no sources found, all excluded, all rejected, none
// kept — its log is written and LIBRARY.json left untouched, D-19-16) is done
// only when sources exist anyway (the user's own, an earlier run's) or the
// paper is outlined: routing an empty paper to an outline with zero
// candidates was the audit M1 bug.
//
// Pure and total: every read is guarded; it never throws.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The `Result:` summaries of a research run that wrote no library
 * (bin/cli/research.ts). A RESEARCH.md whose research log carries one of
 * these is the record of a failed run, not research output.
 */
export const FAILED_RESEARCH_RESULTS: readonly string[] = Object.freeze([
  'no sources found',
  'no usable sources',
  'no relevant sources',
  'no sources kept',
]);

type LibraryState = 'absent' | 'empty' | 'own-only' | 'researched' | 'unreadable';

/** The provenance prefixes of the user's own sources (not a research run's output). */
export const OWN_SOURCE_PROVENANCE: ReadonlySet<string> = new Set(['byo', 'zotero', 'add']);

function isOwnOnly(entry: unknown): boolean {
  const tags = (entry as { provenance?: unknown } | null)?.provenance;
  if (!Array.isArray(tags) || tags.length === 0) return false;
  return tags.every((t) => typeof t === 'string' && OWN_SOURCE_PROVENANCE.has(t.split(':')[0] ?? ''));
}

function libraryState(pDir: string): LibraryState {
  const file = join(pDir, 'LIBRARY.json');
  if (!existsSync(file)) return 'absent';
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { entries?: unknown };
    if (!Array.isArray(parsed.entries)) return 'unreadable';
    if (parsed.entries.length === 0) return 'empty';
    return parsed.entries.every(isOwnOnly) ? 'own-only' : 'researched';
  } catch {
    return 'unreadable';
  }
}

/** The markers of the sources view research-md.ts renders (kept literal: this module stays dependency-free). */
const SOURCES_START = '<!-- pensmith:sources:start';
const SOURCES_END = '<!-- pensmith:sources:end -->';
const LOG_END = '<!-- end of the research log:';

/**
 * True when RESEARCH.md is nothing but the sources view the library writer
 * renders (`# Research`, the sources block, the end-of-log line, and the
 * user's notes below it) — what `new --pdfs`, `add` and a Zotero ingest write
 * before any research run.
 */
export function isSourcesViewOnly(text: string): boolean {
  // Markers count only at the start of a line (the renderer makes a value's
  // own `<!--` inert, and a marker text inside a line is never one).
  let head = text;
  const logEnd = lineStartIndex(head, LOG_END);
  if (logEnd < 0) return false;
  head = head.slice(0, logEnd);
  const start = lineStartIndex(head, SOURCES_START);
  if (start >= 0) {
    const end = lineStartIndex(head, SOURCES_END, start);
    if (end < 0) return false;
    head = head.slice(0, start) + head.slice(end + SOURCES_END.length);
  }
  return head.replace(/^#\s+Research\s*$/m, '').trim().length === 0;
}

/** The offset of the first line (at or after `from`) that starts with `prefix`, or -1. */
function lineStartIndex(text: string, prefix: string, from = 0): number {
  let at = text.indexOf(prefix, from);
  while (at >= 0) {
    if (at === 0 || text[at - 1] === '\n') return at;
    at = text.indexOf(prefix, at + 1);
  }
  return -1;
}

/** True when `text` is the log of a research run that ended without a library. */
export function isFailedResearchLog(text: string): boolean {
  if (!/^# Research log\s*$/m.test(text)) return false;
  const m = /^Result:\s*(.*)$/m.exec(text);
  if (m === null) return false;
  const result = (m[1] ?? '').trim().toLowerCase();
  return FAILED_RESEARCH_RESULTS.some((r) => result.startsWith(r));
}

function readText(file: string): string | null {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  } catch {
    return null;
  }
}

/** Whether the paper at `<project>/.paper` (`pDir`) is past the research stage (see the header). Never throws. */
export function isResearchDone(pDir: string): boolean {
  try {
    if (existsSync(join(pDir, 'OUTLINE.md'))) return true;
    const lib = libraryState(pDir);
    const log = readText(join(pDir, 'RESEARCH.md'));
    if (log !== null && isFailedResearchLog(log)) {
      // The last research run failed: done only if sources exist anyway.
      return lib === 'own-only' || lib === 'researched' || lib === 'unreadable';
    }
    if (log !== null && (/^# Research log\s*$/m.test(log) || !isSourcesViewOnly(log))) return true;
    return lib === 'researched' || lib === 'unreadable' || lib === 'empty';
  } catch {
    return false;
  }
}
