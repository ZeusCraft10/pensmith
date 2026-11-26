// bin/lib/export-record.ts — which compiled draft the last export came from.
//
// done writes .paper/EXPORT.json after an export succeeds, beside FINAL.md
// (the text it shipped): the SHA-256 of the compiled .paper/DRAFT.md the
// export was checked against and of FINAL.md. The router counts a paper as
// done only while both still match, so a recompile, or a FINAL.md left by
// anything but a finished export, sends it back to `done`.

import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { atomicWriteFile } from './atomic-write.js';
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
  await atomicWriteFile(exportRecordPath(paperRoot), `${JSON.stringify(ExportRecordSchema.parse(record), null, 2)}\n`);
}

/** The record of the last export, or null when there is none to trust. Never throws. */
export function readExportRecord(paperRoot: string): ExportRecord | null {
  const file = exportRecordPath(paperRoot);
  if (!existsSync(file)) return null;
  try {
    const parsed = ExportRecordSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
