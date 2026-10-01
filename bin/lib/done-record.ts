// bin/lib/done-record.ts — what a done exported, and whether FINAL.md is still
// that text (main-branch merge review, round 1; VRFY-26, D-18-39).
//
// done writes `.paper/DONE-RECORD.json` after it exports: the sha256 of the
// compiled DRAFT.md its gate judged and of the FINAL.md it left, which holds
// exactly the text it exported. FINAL.md is the file pensmith calls the
// finished paper (the router's terminus, `status`, the SessionStart context),
// so its state follows CONTENT, never an mtime:
//
//   - `absent`:  no FINAL.md — done has not run for this paper;
//   - `current`: FINAL.md and DRAFT.md hold the bytes done recorded — the paper
//                is complete;
//   - `stale`:   FINAL.md is done's but the compiled draft changed since (a
//                recompile), or FINAL.md is byte-for-byte the compiled draft
//                with no record (a paper an older pensmith finished) — done
//                replaces it, and nothing written by hand is lost;
//   - `edited`:  FINAL.md is neither — edited or written by hand. done never
//                exports it and never replaces it: it refuses (EXIT_BLOCKED)
//                and the router reports attention, both naming the remedy
//                (editedFinalReason).
//
// Never throws on read (the router is total).

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { fileSha256 } from './compile-inputs.js';
import { paperDir } from './paths.js';
import { DONE_RECORD_SCHEMA_VERSION, DoneRecordSchema, type DoneRecord } from './schemas/done-record.js';

/** The record's file name in the paper folder. */
export const DONE_RECORD_FILE = 'DONE-RECORD.json';

/** `<root>/.paper/DONE-RECORD.json`. */
export function doneRecordPath(paperRoot: string): string {
  return join(paperDir(paperRoot), DONE_RECORD_FILE);
}

/** The record, or null when it is absent or does not parse. Never throws. */
export function readDoneRecord(paperRoot: string): DoneRecord | null {
  try {
    const parsed = DoneRecordSchema.safeParse(JSON.parse(readFileSync(doneRecordPath(paperRoot), 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Write the record of an export done just made (done's session lock is held). */
export async function writeDoneRecord(
  paperRoot: string,
  r: { readonly doneAt: string; readonly compiledDraftSha256: string; readonly finalSha256: string; readonly humanized: boolean },
): Promise<void> {
  const record: DoneRecord = DoneRecordSchema.parse({
    $schemaVersion: DONE_RECORD_SCHEMA_VERSION,
    done_at: r.doneAt,
    compiled_draft_sha256: r.compiledDraftSha256,
    final_sha256: r.finalSha256,
    humanized: r.humanized,
  });
  await atomicWriteFile(doneRecordPath(paperRoot), JSON.stringify(record, null, 2) + '\n');
}

export type FinalMdState = 'absent' | 'current' | 'stale' | 'edited';

/** What FINAL.md is now, against the done record (see the module header). Never throws. */
export function finalMdState(paperRoot: string): FinalMdState {
  const dir = paperDir(paperRoot);
  const finalPath = join(dir, 'FINAL.md');
  if (!existsSync(finalPath)) return 'absent';
  const finalSha = fileSha256(finalPath);
  if (finalSha === '') return 'edited'; // present but unreadable: never replaced, never "complete"
  const draftSha = fileSha256(join(dir, 'DRAFT.md'));
  const record = readDoneRecord(paperRoot);
  if (record !== null && record.final_sha256 === finalSha) return record.compiled_draft_sha256 === draftSha ? 'current' : 'stale';
  return finalSha === draftSha ? 'stale' : 'edited';
}

/**
 * The line that names an `edited` FINAL.md and its remedy: done's refusal
 * and the router's attention detail. `.paper` is the paper folder's own name
 * (`.paper-dry-run` under --dry-run).
 */
export function editedFinalReason(paperRoot: string): string {
  const dir = basename(paperDir(paperRoot));
  return (
    `${dir}/FINAL.md is not the text \`pensmith done\` exported (it was edited or written by hand) — done exports only the compiled ` +
    `draft it checks and never replaces your file: make the edit in the section drafts (then \`pensmith\` re-verifies and ` +
    `recompiles them), or move ${dir}/FINAL.md out of the paper folder, and run \`pensmith done\``
  );
}
