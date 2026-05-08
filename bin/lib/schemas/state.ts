// bin/lib/schemas/state.ts — foundation-slice state schema (D-58).
//
// Phase 1 scope (D-58): the state file at this stage is JUST a PROJECT.md
// scope marker — paperId + createdAt + the schema-version envelope. The
// section state machine, wave scheduler bookkeeping, and per-section status
// fields are added in Phase 2 via a forward migration (state v1→v2 ships
// a no-op skeleton in this wave to prove the registry mechanism).
//
// Per D-37 every persisted JSON file carries a top-level `$schemaVersion: number`.
// Per D-38 zod is the runtime-validation engine.
//
// Export convention (revision-locked): the version constant is named
// CURRENT_STATE_VERSION (not a bare CURRENT_VERSION) so a single consumer
// file can `import { CURRENT_STATE_VERSION } from '../schemas/state.js';
// import { CURRENT_LIBRARY_VERSION } from '../schemas/library.js';` without
// a re-alias dance.

import { z } from 'zod';

export const CURRENT_STATE_VERSION = 1;

export const Schema = z.object({
  $schemaVersion: z.literal(CURRENT_STATE_VERSION),
  paperId: z.string().min(1),
  createdAt: z.string().datetime(),
});

export type State = z.infer<typeof Schema>;
