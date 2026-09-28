// bin/lib/research-sentinel.ts — "has research produced a library?" for the
// router and the list/status deriver (audit M1; D-19-16, D-19-27).
//
// Research is done — the router may move on to the outline — unless the
// paper's last research run FAILED and left it without sources:
//   - .paper/RESEARCH.md is the log of a failed research run (no sources
//     found, all excluded by the [sources] policy, all rejected by the
//     evaluator, none kept) — since Phase 19 such a run still writes its log
//     and leaves LIBRARY.json untouched (D-19-16) — AND
//   - LIBRARY.json holds no entry (absent or empty) AND there is no
//     OUTLINE.md yet.
// Otherwise the Phase 17 rule stands (audit M1): LIBRARY.json (the research
// verb's canonical output; `add`, bring-your-own and Zotero ingest write it
// too) or a legacy / curated RESEARCH.md means research is done.
//
// Why: keying on "a file exists" alone routed a bare `pensmith` / `next` past a
// failed research run into an outline with zero candidates.
//
// Pure and total: every read is guarded; it never throws. An unreadable
// LIBRARY.json counts as holding entries — the next verb reports it in one
// line (RUN-12) rather than the router looping on research.

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

type LibraryState = 'absent' | 'empty' | 'entries' | 'unreadable';

function libraryState(pDir: string): LibraryState {
  const file = join(pDir, 'LIBRARY.json');
  if (!existsSync(file)) return 'absent';
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { entries?: unknown };
    if (!Array.isArray(parsed.entries)) return 'unreadable';
    return parsed.entries.length > 0 ? 'entries' : 'empty';
  } catch {
    return 'unreadable';
  }
}

/** True when `text` is the log of a research run that ended without a library. */
export function isFailedResearchLog(text: string): boolean {
  if (!/^# Research log\s*$/m.test(text)) return false;
  const m = /^Result:\s*(.*)$/m.exec(text);
  if (m === null) return false;
  const result = (m[1] ?? '').trim().toLowerCase();
  return FAILED_RESEARCH_RESULTS.some((r) => result.startsWith(r));
}

function failedLog(file: string): boolean {
  try {
    return isFailedResearchLog(readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
}

/** Whether the paper at `<project>/.paper` (`pDir`) is past the research stage. Never throws. */
export function isResearchDone(pDir: string): boolean {
  try {
    const lib = libraryState(pDir);
    const logFile = join(pDir, 'RESEARCH.md');
    const hasLog = existsSync(logFile);
    if (hasLog && failedLog(logFile)) {
      // The last research run failed: done only if sources exist anyway (an
      // earlier run's library, `add`, bring-your-own) or the paper is outlined.
      return lib === 'entries' || lib === 'unreadable' || existsSync(join(pDir, 'OUTLINE.md'));
    }
    return lib !== 'absent' || hasLog;
  } catch {
    return false;
  }
}
