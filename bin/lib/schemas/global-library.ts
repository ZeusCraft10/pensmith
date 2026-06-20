// bin/lib/schemas/global-library.ts — the GLOBAL PAPER REGISTRY schema (LIB-01).
//
// ⚠️ THIS IS THE *PAPER* REGISTRY — NOT the per-paper citation store and NOT the
// fingerprint registry. Three distinct on-disk stores live in this codebase; do
// not conflate them:
//
//   1. PER-PAPER citation store  — bin/lib/schemas/library.ts (D-59) at
//      <paperRoot>/.paper/LIBRARY.json. Sources / cite-keys for ONE paper.
//   2. GLOBAL PAPER registry     — THIS FILE at pensmithDataDir()/library/index.json.
//      One entry per PAPER (across all projects). KEEPS folderPath.
//   3. STYLE FINGERPRINT registry — pensmithDataDir()/style-fingerprints.json
//      (08-02). Path-FREE by design (hashes + paper identity only, no folderPath).
//
// LIB-03 / LOAD-BEARING: the PAPER registry entry RETAINS `folderPath` (an
// absolute path). This is deliberate and required:
//   - `open` switches the active paper by writing that folderPath into the
//     active pointer.
//   - `list` loads each paper's authoritative STATE.json FROM that folderPath to
//     DERIVE the LIB-05 lifecycle status at display time.
// The "path-free" constraint applies ONLY to the SEPARATE fingerprint registry
// (#3 above) — it must NEVER be applied to this file.
//
// Schema shape mirrors bin/lib/schemas/library.ts EXACTLY (a $schemaVersion
// envelope + a default([]) entries array) — same structure, different scope.

import { z } from 'zod';

export const CURRENT_GLOBAL_LIBRARY_VERSION = 1;

/**
 * A single PAPER entry in the global registry.
 *
 * - `id`         — the paper's stable identifier (the paperId from STATE.json;
 *                  a UUID v4 in production, but the schema only requires a
 *                  non-empty string so the registry stays decoupled from the id
 *                  GENERATOR — the global-library.test.ts contract registers
 *                  bare ids like 'paper-1', and intake supplies the real UUID).
 * - `name`       — display title.
 * - `folderPath` — absolute path to the paper's project root (LIB-03; KEEP it).
 *                  `open` switches to it; `deriveLibraryStatus` reads its
 *                  STATE.json from it. NEVER drop this field.
 * - `class`      — grouping bucket for `list` (defaults to 'Unfiled').
 * - `status`     — the stored LIB-05 lifecycle value. Seeded at intake
 *                  registration (08-05) and consulted by `list` ONLY for the
 *                  terminal `archived` flag — the live display value is DERIVED
 *                  at display time from the paper's STATE.json (DERIVE-AT-DISPLAY,
 *                  Open-Q4). The field is representable so the round-trip is
 *                  lossless and `archived` can be honored.
 * - `sectioningProgress` — optional {done,total} for the sectioning case.
 */
export const GlobalLibraryEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  folderPath: z.string().min(1),
  class: z.string().default('Unfiled'),
  status: z.enum([
    'intake',
    'research',
    'outline',
    'sectioning',
    'compile',
    'done',
    'archived',
  ]),
  sectioningProgress: z
    .object({
      done: z.number().int().min(0),
      total: z.number().int().min(1),
    })
    .optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const GlobalLibrarySchema = z.object({
  $schemaVersion: z.literal(CURRENT_GLOBAL_LIBRARY_VERSION),
  entries: z.array(GlobalLibraryEntrySchema).default([]),
});

export type GlobalLibraryEntry = z.infer<typeof GlobalLibraryEntrySchema>;
export type GlobalLibrary = z.infer<typeof GlobalLibrarySchema>;
