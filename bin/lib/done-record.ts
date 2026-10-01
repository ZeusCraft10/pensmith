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
//
// v2 (Phase 21, GRND-11, D-21-25) adds the outline-mode record: an
// outline-only paper's done writes `.paper/ANNOTATED-BIBLIOGRAPHY.md` and
// exports OUTLINE.<ext> and ANNOTATED-BIBLIOGRAPHY.<ext>, and records the
// sha256 of OUTLINE.md, CITATIONS.bib and ANNOTATED-BIBLIOGRAPHY.md with the
// files it exported (outlineDoneState):
//
//   - `absent`:  no outline record (and no annotated bibliography) — done has
//                not run in outline mode;
//   - `current`: the outline, the bibliography and the annotated bibliography
//                hold the recorded bytes and every recorded export is there —
//                the outline-only paper is complete;
//   - `stale`:   the outline or the bibliography changed since (or an export
//                is gone) — done exports again;
//   - `edited`:  ANNOTATED-BIBLIOGRAPHY.md is not the text done wrote (edited
//                or written by hand) — done never replaces it: it refuses and
//                the router reports attention, naming the remedy;
//   - `newer`:   the record was written by a newer pensmith — never read as
//                this version's, never overwritten.
//
// The record is read through a versioned reader (a v1 record is migrated in
// memory, migrations/done-record/v1_to_v2.ts; a newer one is refused, never
// overwritten). readDoneRecord returns only a draft-mode record, as before.

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { fileSha256 } from './compile-inputs.js';
import { EXIT_ERROR, PensmithError } from './exit-codes.js';
import { paperDir } from './paths.js';
import { migrate as v1ToV2 } from './migrations/done-record/v1_to_v2.js';
import {
  DONE_RECORD_SCHEMA_VERSION,
  DoneRecordFileSchema,
  DoneRecordSchema,
  OutlineDoneRecordSchema,
  type DoneRecord,
  type OutlineDoneRecord,
} from './schemas/done-record.js';

/** The record's file name in the paper folder. */
export const DONE_RECORD_FILE = 'DONE-RECORD.json';

/** `<root>/.paper/DONE-RECORD.json`. */
export function doneRecordPath(paperRoot: string): string {
  return join(paperDir(paperRoot), DONE_RECORD_FILE);
}

/** The record file as read (never throws). */
export type DoneRecordRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'newer'; readonly version: number }
  | { readonly kind: 'draft'; readonly record: DoneRecord }
  | { readonly kind: 'outline'; readonly record: OutlineDoneRecord };

/**
 * Read DONE-RECORD.json through the versioned reader: a v1 record is migrated
 * in memory (v1_to_v2), a record from a newer pensmith is `newer` (never
 * read as this version's), anything that does not parse is `invalid`.
 * Never throws.
 */
export function readDoneRecordFile(paperRoot: string): DoneRecordRead {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(doneRecordPath(paperRoot), 'utf8'));
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? { kind: 'absent' } : { kind: 'invalid' };
  }
  const version = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)['$schemaVersion'] : undefined;
  if (typeof version === 'number' && Number.isInteger(version) && version > DONE_RECORD_SCHEMA_VERSION) return { kind: 'newer', version };
  if (version === 1) value = v1ToV2(value);
  const parsed = DoneRecordFileSchema.safeParse(value);
  if (!parsed.success) return { kind: 'invalid' };
  return parsed.data.mode === 'outline'
    ? { kind: 'outline', record: parsed.data }
    : { kind: 'draft', record: parsed.data as DoneRecord };
}

/** The draft-mode record, or null when there is none (absent, unreadable, newer, or an outline record). Never throws. */
export function readDoneRecord(paperRoot: string): DoneRecord | null {
  const read = readDoneRecordFile(paperRoot);
  return read.kind === 'draft' ? read.record : null;
}

/** The outline-mode record (GRND-11), or null. Never throws. */
export function readOutlineDoneRecord(paperRoot: string): OutlineDoneRecord | null {
  const read = readDoneRecordFile(paperRoot);
  return read.kind === 'outline' ? read.record : null;
}

/** The refusal of a record a newer pensmith wrote (never overwritten). */
export function newerDoneRecordReason(paperRoot: string, version: number): string {
  return (
    `${basename(paperDir(paperRoot))}/${DONE_RECORD_FILE} was written by a newer pensmith (record v${version}; this one reads v${DONE_RECORD_SCHEMA_VERSION}) — ` +
    'upgrade pensmith to finish this paper (the record is left as it is)'
  );
}

/** Throw when the record on disk was written by a newer pensmith: it is never overwritten. */
export function assertDoneRecordWritable(paperRoot: string): void {
  const read = readDoneRecordFile(paperRoot);
  if (read.kind === 'newer') throw new PensmithError(newerDoneRecordReason(paperRoot, read.version), EXIT_ERROR);
}

/** Write the record of an export done just made (done's session lock is held). A newer record is never overwritten. */
export async function writeDoneRecord(
  paperRoot: string,
  r: { readonly doneAt: string; readonly compiledDraftSha256: string; readonly finalSha256: string; readonly humanized: boolean },
): Promise<void> {
  assertDoneRecordWritable(paperRoot);
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

// ---------------------------------------------------------------------------
// Outline-only mode (GRND-11, D-21-25).
// ---------------------------------------------------------------------------

/** The annotated bibliography's file name in the paper folder. */
export const ANNOTATED_BIBLIOGRAPHY_FILE = 'ANNOTATED-BIBLIOGRAPHY.md';

/** `<root>/.paper/ANNOTATED-BIBLIOGRAPHY.md`. */
export function annotatedBibliographyPath(paperRoot: string): string {
  return join(paperDir(paperRoot), ANNOTATED_BIBLIOGRAPHY_FILE);
}

/** Write the record of an outline export done just made (done's session lock is held). A newer record is never overwritten. */
export async function writeOutlineDoneRecord(
  paperRoot: string,
  r: {
    readonly doneAt: string;
    readonly outlineSha256: string;
    readonly bibSha256: string;
    readonly annotatedSha256: string;
    /** The export files, relative to the paper folder (`export/OUTLINE.md`, …). */
    readonly exports: readonly string[];
  },
): Promise<void> {
  assertDoneRecordWritable(paperRoot);
  const record: OutlineDoneRecord = OutlineDoneRecordSchema.parse({
    $schemaVersion: DONE_RECORD_SCHEMA_VERSION,
    mode: 'outline',
    done_at: r.doneAt,
    outline_sha256: r.outlineSha256,
    bib_sha256: r.bibSha256,
    annotated_sha256: r.annotatedSha256,
    outline_exports: [...r.exports],
  });
  await atomicWriteFile(doneRecordPath(paperRoot), JSON.stringify(record, null, 2) + '\n');
}

export type OutlineDoneState = 'absent' | 'current' | 'stale' | 'edited' | 'newer';

/** What outlineDoneState found. */
export interface OutlineDoneRead {
  readonly state: OutlineDoneState;
  /** The outline record, when there is one. */
  readonly record: OutlineDoneRecord | null;
  /** The record's version when it is `newer`. */
  readonly newerVersion?: number;
}

/** Where an outline-only paper's export stands (see the module header), with its record. Never throws. */
export function outlineDoneState(paperRoot: string): OutlineDoneRead {
  const read = readDoneRecordFile(paperRoot);
  if (read.kind === 'newer') return { state: 'newer', record: null, newerVersion: read.version };
  const record = read.kind === 'outline' ? read.record : null;
  const annotated = annotatedBibliographyPath(paperRoot);
  if (existsSync(annotated)) {
    const sha = fileSha256(annotated);
    // Not the text done wrote (or unreadable): never replaced, never "complete".
    if (record === null || sha === '' || sha !== record.annotated_sha256) return { state: 'edited', record };
  } else {
    return { state: record === null ? 'absent' : 'stale', record };
  }
  const dir = paperDir(paperRoot);
  const current =
    record.outline_sha256 === fileSha256(join(dir, 'OUTLINE.md')) &&
    record.bib_sha256 === fileSha256(join(dir, 'CITATIONS.bib')) &&
    record.outline_exports.every((p) => existsSync(join(dir, p)));
  return { state: current ? 'current' : 'stale', record };
}

/**
 * The line that names an annotated bibliography done did not write and its
 * remedy: done's refusal and the router's attention detail.
 */
export function editedAnnotatedReason(paperRoot: string): string {
  const dir = basename(paperDir(paperRoot));
  return (
    `${dir}/${ANNOTATED_BIBLIOGRAPHY_FILE} is not the text \`pensmith done\` wrote (it was edited or written by hand) — done never replaces your file: ` +
    `move ${dir}/${ANNOTATED_BIBLIOGRAPHY_FILE} out of the paper folder (your copy keeps the edit) and run \`pensmith done\``
  );
}
