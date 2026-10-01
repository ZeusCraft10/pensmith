// bin/lib/done-record.ts — what a done exported, and whether FINAL.md is still
// that text (main-branch merge review, rounds 1 and 2; VRFY-26, D-18-39).
//
// done writes `.paper/DONE-RECORD.json` after it exports: the sha256 of the
// compiled DRAFT.md its gate judged and of the FINAL.md it left, which holds
// exactly the text it exported. FINAL.md is the file pensmith calls the
// finished paper (the router's terminus, `status`, the SessionStart context),
// so its state follows CONTENT, never an mtime. FINAL.md is done's own text
// when its sha256 is the record's `final_sha256`, or — a paper finished
// before the record existed (round 2: every paper an older pensmith finished,
// recompiled since or not), or a done stopped between writing FINAL.md and
// the record — the `Text checked: … (sha256 X)` line of the paper-level
// `.paper/VERIFICATION.md`, which done writes (since Phase 20) only once the
// export is made, naming the exact text it exported:
//
//   - `absent`:  no FINAL.md — done has not run for this paper;
//   - `current`: FINAL.md is done's text and DRAFT.md is the compiled draft
//                done judged (the record's, or — with no record — FINAL.md
//                itself: the export was the compiled draft) — the paper is
//                complete;
//   - `stale`:   FINAL.md is done's text of an older compiled draft (a
//                recompile since), or FINAL.md is byte-for-byte the compiled
//                draft with no record — done replaces it, and nothing written
//                by hand is lost;
//   - `edited`:  FINAL.md is none of these — edited or written by hand. done
//                never exports it and never replaces it: it refuses
//                (EXIT_BLOCKED) and the router reports attention, both naming
//                the remedy (editedFinalReason) — moving the file out of the
//                paper folder, which keeps the edit.
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

/**
 * The sha256 the paper-level `.paper/VERIFICATION.md` names as the text done
 * judged and exported (`Text checked: <file> (sha256 X)`, done.ts
 * buildVerificationReport), or null. Never throws.
 */
export function verificationCheckedSha256(paperRoot: string): string | null {
  try {
    const md = readFileSync(join(paperDir(paperRoot), 'VERIFICATION.md'), 'utf8');
    return /^Text checked: .+ \(sha256 ([0-9a-f]{64})\)\s*$/mu.exec(md)?.[1] ?? null;
  } catch {
    return null;
  }
}

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
  // Review round 2: done's export with no record of it — a paper an older
  // pensmith finished (recompiled since or not), or a done stopped after its
  // export and before the record. The text done checked and exported is named
  // in the paper-level VERIFICATION.md; a raw export of the current compiled
  // draft is complete, anything else (a humanized text, an older draft) is
  // replaced by the next done.
  if (verificationCheckedSha256(paperRoot) === finalSha) return finalSha === draftSha ? 'current' : 'stale';
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
    `draft it checks and never replaces your file: move ${dir}/FINAL.md out of the paper folder (your copy keeps the edit) and run ` +
    `\`pensmith done\`; to keep the edit in the paper itself, make it in the section drafts first (\`pensmith\` re-verifies and recompiles them)`
  );
}
