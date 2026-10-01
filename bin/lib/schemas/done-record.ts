// bin/lib/schemas/done-record.ts — `.paper/DONE-RECORD.json` v3 (v1: main-branch
// merge review, round 1, VRFY-26; v2: Phase 21, GRND-11, D-21-25; v3: Phase 21
// review round 1, `exported`).
//
// done records what its export was made from, so the router can tell a
// finished paper from one that changed since — by content, never by mtime.
//
//   - A draft-mode record (v1's fields; `mode` absent or `draft`): the sha256
//     of the compiled DRAFT.md bytes its gate judged, and of the FINAL.md it
//     left — exactly the text it exported (the humanized manuscript when a
//     humanizer ran, else the compiled draft). The router calls the paper
//     complete only while DRAFT.md and FINAL.md still hold those bytes
//     (bin/lib/done-record.ts), so a FINAL.md written or edited by hand is
//     never reported as the finished paper, and done refuses to replace one.
//     `exported` (v3) is false when `pensmith humanize` wrote FINAL.md without
//     exporting it: the router then names `pensmith export` instead of
//     calling the paper complete while export/ holds older text.
//   - An outline-mode record (`mode: 'outline'`, GRND-11): the sha256 of the
//     `.paper/OUTLINE.md` and `.paper/CITATIONS.bib` the outline export was
//     made from and of the `.paper/ANNOTATED-BIBLIOGRAPHY.md` it wrote, and
//     the export files it made (`export/OUTLINE.<ext>`,
//     `export/ANNOTATED-BIBLIOGRAPHY.<ext>` — names only, validated here, so
//     the router may quote them). The router routes an outline-only paper to
//     done until these match (D-21-25).
//
// A v1 record is a draft record; migrations/done-record/v1_to_v2.ts lifts it,
// then v2_to_v3.ts (a v2 draft record was always written by an export).
// `$schemaVersion`, strict. Adding a field is a migration plus a version bump
// (S-20).

import { z } from 'zod';

export const DONE_RECORD_SCHEMA_VERSION = 3;

const SHA256 = /^[0-9a-f]{64}$/;

/** An outline-mode export file, relative to the paper folder (`.dry-run` names under --dry-run, GRND-19). */
export const OUTLINE_EXPORT_PATH = /^export\/(?:OUTLINE|ANNOTATED-BIBLIOGRAPHY)(?:\.dry-run)?\.(?:md|docx|pdf|tex)$/;

/** The record a draft-mode done writes (v1's fields). */
export const DoneRecordSchema = z
  .object({
    $schemaVersion: z.literal(DONE_RECORD_SCHEMA_VERSION),
    /** Absent (every v1 record, and what draft-mode done writes) means draft. */
    mode: z.literal('draft').optional(),
    done_at: z.string().datetime(),
    /** sha256 of the `.paper/DRAFT.md` bytes done's gate judged. */
    compiled_draft_sha256: z.string().regex(SHA256),
    /** sha256 of the `.paper/FINAL.md` done left: the text it exported. */
    final_sha256: z.string().regex(SHA256),
    /** True when that text is the humanizer's (GATE-04 judged it), false when it is the compiled draft. */
    humanized: z.boolean(),
    /** True when an export rendered that FINAL.md; false when `pensmith humanize` wrote it and nothing exported it yet (v3). */
    exported: z.boolean(),
  })
  .strict();

/** The record an outline-mode done writes (GRND-11, D-21-25). */
export const OutlineDoneRecordSchema = z
  .object({
    $schemaVersion: z.literal(DONE_RECORD_SCHEMA_VERSION),
    mode: z.literal('outline'),
    done_at: z.string().datetime(),
    /** sha256 of the `.paper/OUTLINE.md` the export was made from. */
    outline_sha256: z.string().regex(SHA256),
    /** sha256 of the `.paper/CITATIONS.bib` the outline export was made from (as it stands after done's library writes). */
    bib_sha256: z.string().regex(SHA256),
    /** sha256 of the `.paper/ANNOTATED-BIBLIOGRAPHY.md` done wrote. */
    annotated_sha256: z.string().regex(SHA256),
    /**
     * sha256 of the annotated bibliography done's earlier run left, which this
     * record replaces (v3): done writes the record BEFORE the file, so a done
     * stopped between the two leaves that older text — done's own, `stale`,
     * never `edited` (review round 1).
     */
    previous_annotated_sha256: z.string().regex(SHA256).optional(),
    /** The export files made from these inputs, relative to the paper folder. */
    outline_exports: z.array(z.string().regex(OUTLINE_EXPORT_PATH)).min(1),
  })
  .strict();

/** Either record, as the file holds it. */
export const DoneRecordFileSchema = z.union([DoneRecordSchema, OutlineDoneRecordSchema]);

export type DoneRecord = z.infer<typeof DoneRecordSchema>;
export type OutlineDoneRecord = z.infer<typeof OutlineDoneRecordSchema>;
export type DoneRecordFile = z.infer<typeof DoneRecordFileSchema>;
