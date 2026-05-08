// bin/lib/schemas/checkpoint.ts — foundation-slice checkpoint envelope (D-60).
//
// Phase 1 scope: just the envelope (label + tookAt + refs map). The actual
// checkpoint snapshot semantics (which files snapshotted, restore protocol,
// retention policy) live in Phase 5+ — those phases extend this schema via
// forward migrations.
//
// `refs` is a string→string map (e.g. `{ "state.json": "<sha256>", "library.json": "<sha256>" }`)
// — content-addressed pointers into the snapshot store. Empty by default in
// the envelope-only foundation slice.

import { z } from 'zod';

export const CURRENT_CHECKPOINT_VERSION = 1;

export const Schema = z.object({
  $schemaVersion: z.literal(CURRENT_CHECKPOINT_VERSION),
  label: z.string().min(1),
  tookAt: z.string().datetime(),
  refs: z.record(z.string(), z.string()).default({}),
});

export type Checkpoint = z.infer<typeof Schema>;
