// bin/lib/export-record.ts — which compiled draft the last export came from.
//
// done writes .paper/EXPORT.json after an export succeeds, beside FINAL.md
// (the text it shipped): the SHA-256 of the compiled .paper/DRAFT.md the
// export was checked against and of FINAL.md. The router counts a paper as
// done only while both still match, so a recompile, or a FINAL.md left by
// anything but a finished export, sends it back to `done`.

import { z } from 'zod';
import { readJsonRecord, writeJsonRecord } from './json-record.js';
import { exportRecordPath } from './paths.js';
import { HEX64 } from './verify/verification-record.js';

export const ExportRecordSchema = z.object({
  $schemaVersion: z.literal(1),
  exported_at: z.string().min(1),
  /** The compiled .paper/DRAFT.md the export was checked against. */
  draft_sha256: HEX64,
  /** .paper/FINAL.md: the text exported (humanized, or the draft itself). */
  final_sha256: HEX64,
  format: z.string().min(1),
  humanized: z.boolean(),
}).strict();

export type ExportRecord = z.infer<typeof ExportRecordSchema>;

export async function writeExportRecord(paperRoot: string, record: ExportRecord): Promise<void> {
  await writeJsonRecord(exportRecordPath(paperRoot), ExportRecordSchema, record);
}

/** The record of the last export, or null when there is none to trust. Never throws. */
export function readExportRecord(paperRoot: string): ExportRecord | null {
  return readJsonRecord(exportRecordPath(paperRoot), ExportRecordSchema);
}
