// bin/cli/open.ts — `pensmith open <name>` verb (LIB-03). Switch the active paper
// by name without a `cd`.
//
// THIN ORCHESTRATOR (status.ts shape): loadGlobalLibrary() → find entry by name
// → if found AND its folderPath exists on disk, write the active-paper pointer
// via atomicWriteFile (D-07 chokepoint — NEVER raw fs.writeFile) and report the
// switch. stdout-only (no console.*).
//
// SECURITY (T-08-01-03 / T-08-01-04):
//   - The active pointer write goes through atomicWriteFile (D-07), never a raw
//     fs.writeFile, and lives in pensmithDataDir() (never a sync-folder-risk
//     `.paper/`).
//   - A missing/relocated folderPath is guarded with fs.existsSync BEFORE
//     switching: never crash, return { ok: false } with a clear message (the
//     status.ts never-crash precedent).
//
// The untrusted `<name>` arg is used only for an exact-match lookup against the
// registry — it never reaches path.join, so no traversal surface.

import { defineCommand } from 'citty';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadGlobalLibrary } from '../lib/global-library.js';
import { pensmithActivePointerPath } from '../lib/paths.js';
import { atomicWriteFile } from '../lib/atomic-write.js';

export const openCommand = defineCommand({
  meta: {
    name: 'open',
    description: 'Switch the active paper by name (writes the active-paper pointer).',
  },
  args: {
    name: {
      type: 'positional',
      description: 'Paper name (as shown by `pensmith list`).',
      required: true,
    },
  },
  async run({ args }) {
    const name = String(args.name);

    const lib = await loadGlobalLibrary();
    const entry = lib.entries.find((e) => e.name === name);
    if (!entry) {
      process.stdout.write(
        `pensmith open: no paper named "${name}". Run \`pensmith list\` to see papers.\n`,
      );
      return { ok: false, reason: 'not-found' };
    }

    // T-08-01-04: never switch to a missing/relocated folder. existsSync never
    // throws (returns false on any error).
    if (!fs.existsSync(entry.folderPath)) {
      process.stdout.write(
        `pensmith open: folder not found for "${entry.name}": ${entry.folderPath}\n`,
      );
      return { ok: false, reason: 'folder-missing' };
    }

    // T-08-01-03: write the active pointer via the D-07 atomicWriteFile
    // chokepoint (NEVER raw fs.writeFile). pensmithDataDir() may not exist yet.
    const activePtr = pensmithActivePointerPath();
    await fs.promises.mkdir(path.dirname(activePtr), { recursive: true });
    await atomicWriteFile(
      activePtr,
      JSON.stringify(
        {
          paperId: entry.id,
          folderPath: entry.folderPath,
          openedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
    );

    process.stdout.write(
      `pensmith open: switched to "${entry.name}" at ${entry.folderPath}\n`,
    );
    return { ok: true, folderPath: entry.folderPath };
  },
});

export default openCommand;
