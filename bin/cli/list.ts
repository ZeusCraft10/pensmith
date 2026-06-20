// bin/cli/list.ts — `pensmith list` verb (LIB-02). Show every paper grouped by
// class, with the LIB-05 lifecycle status DERIVED at display time.
//
// THIN ORCHESTRATOR (status.ts shape): loadGlobalLibrary() → group entries by
// class → for EACH entry DERIVE its status via deriveLibraryStatus(folderPath,
// entry.status) → render a grouped table to stdout. stdout-only (no console.*).
//
// DERIVE-AT-DISPLAY (Open-Q4 / LIB-05): list does NOT print the stored
// entry.status. It computes each paper's live status from that paper's
// AUTHORITATIVE STATE.json + section PLAN.md frontmatter. The stored entry.status
// feeds into deriveLibraryStatus ONLY so the terminal `archived` flag is honored
// (the one state with no on-disk marker). So a paper that has advanced
// out-of-band (e.g. its sections were written since intake) shows its REAL stage
// — the status cannot drift stale (T-08-01-06).
//
// NEVER CRASHES (T-08-01-05): deriveLibraryStatus is already never-throw, but
// `list` ALSO wraps each per-entry derivation in a belt-and-suspenders try/catch
// (the Phase-7 readSectionState never-throw discipline) — reading N papers'
// STATE.json must NEVER abort the whole list. One bad paper renders as 'unknown'
// and the list continues. An empty/absent library prints a friendly line.

import { defineCommand } from 'citty';
import { loadGlobalLibrary, deriveLibraryStatus } from '../lib/global-library.js';
import type { GlobalLibrary, GlobalLibraryEntry } from '../lib/schemas/global-library.js';

/** Render the status cell: `sectioning X/Y` when sectioning, else the bare status. */
function renderStatus(folderPath: string, storedStatus: string): string {
  try {
    const derived = deriveLibraryStatus(folderPath, storedStatus);
    if (derived.status === 'sectioning' && derived.sectioningProgress) {
      const { done, total } = derived.sectioningProgress;
      return `sectioning ${done}/${total}`;
    }
    return derived.status;
  } catch {
    // Belt-and-suspenders: a single bad paper must never abort the whole list.
    return 'unknown';
  }
}

export const listCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'List all papers grouped by class, with each paper’s live lifecycle status.',
  },
  async run() {
    // loadGlobalLibrary auto-inits on ENOENT — so it returns an empty index
    // rather than throwing on first use. Guard anyway (never-crash discipline).
    let lib: GlobalLibrary;
    try {
      lib = await loadGlobalLibrary();
    } catch {
      process.stdout.write('pensmith list: no papers yet — run `pensmith new` to start.\n');
      return { ok: true, papers: [] as GlobalLibraryEntry[] };
    }

    if (lib.entries.length === 0) {
      process.stdout.write('pensmith list: no papers yet — run `pensmith new` to start.\n');
      return { ok: true, papers: [] as GlobalLibraryEntry[] };
    }

    // Group by class (defaulting to 'Unfiled'). Map preserves insertion order so
    // the output is deterministic for a given on-disk order.
    const byClass = new Map<string, GlobalLibraryEntry[]>();
    for (const entry of lib.entries) {
      const cls = entry.class || 'Unfiled';
      const arr = byClass.get(cls) ?? [];
      arr.push(entry);
      byClass.set(cls, arr);
    }

    const lines: string[] = ['pensmith list:'];
    for (const [cls, entries] of byClass) {
      lines.push(`  [${cls}]`);
      for (const e of entries) {
        const statusStr = renderStatus(e.folderPath, e.status);
        lines.push(`    ${e.name} (${statusStr})  ${e.folderPath}`);
      }
    }

    process.stdout.write(lines.join('\n') + '\n');
    return { ok: true, papers: lib.entries };
  },
});

export default listCommand;
