// bin/lib/schemas/done-record.ts — `.paper/DONE-RECORD.json` v1 (main-branch
// merge review, round 1; VRFY-26).
//
// done records what its export was made from: the sha256 of the compiled
// DRAFT.md bytes its gate judged, and of the FINAL.md it left — exactly the
// text it exported (the humanized manuscript when a humanizer ran, else the
// compiled draft). The router calls the paper complete only while DRAFT.md
// and FINAL.md still hold those bytes (bin/lib/done-record.ts), so a FINAL.md
// written or edited by hand is never reported as the finished paper, and done
// refuses to replace one.
//
// `$schemaVersion`, strict. Adding a field is a migration plus a version bump
// (S-20).

import { z } from 'zod';

export const DONE_RECORD_SCHEMA_VERSION = 1;

const SHA256 = /^[0-9a-f]{64}$/;

export const DoneRecordSchema = z
  .object({
    $schemaVersion: z.literal(DONE_RECORD_SCHEMA_VERSION),
    done_at: z.string().datetime(),
    /** sha256 of the `.paper/DRAFT.md` bytes done's gate judged. */
    compiled_draft_sha256: z.string().regex(SHA256),
    /** sha256 of the `.paper/FINAL.md` done left: the text it exported. */
    final_sha256: z.string().regex(SHA256),
    /** True when that text is the humanizer's (GATE-04 judged it), false when it is the compiled draft. */
    humanized: z.boolean(),
  })
  .strict();

export type DoneRecord = z.infer<typeof DoneRecordSchema>;
