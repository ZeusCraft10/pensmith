#!/usr/bin/env node
// hooks/pre-compact.ts — Claude Code PreCompact hook entry (PLUG-14,
// D-23a-15, D-23a-16). Bundled to plugin/dist/hooks/pre-compact.mjs
// (scripts/bundle.mjs); plugin/hooks/hooks.json runs it with a 10 s timeout.
//
// In a folder that holds a paper it writes `.paper/HANDOFF.json` v2 — the
// phase, section and plan/write/verify position from the router's decision —
// before Claude Code compacts the context (bin/lib/hooks/pre-compact.ts),
// within its own 8 s deadline. Outside a paper it does nothing.
//
// It writes nothing to stdout (PreCompact has no output protocol); a failed
// write is one stderr line. It always exits 0 — a hook must never block a
// compaction.

import { isMainModule } from '../bin/lib/main-guard.js';
import { readHookInput } from '../bin/lib/hooks/stdin.js';
import { hookDiagnostic, hookPaperRoot } from '../bin/lib/hooks/entry.js';

async function main(): Promise<void> {
  const input = await readHookInput();
  const root = hookPaperRoot(input);
  if (root === null) return; // no paper here: nothing to hand off
  const [{ writePreCompactHandoff }, { routeOptionsFor }] = await Promise.all([
    import('../bin/lib/hooks/pre-compact.js'),
    import('../bin/cli/route-options.js'),
  ]);
  const result = await writePreCompactHandoff(root, { routeOptions: routeOptionsFor(root) });
  if (!result.written) hookDiagnostic('pre-compact', 'HANDOFF.json not written', result.error);
}

if (isMainModule(import.meta.url)) {
  main()
    .catch((e: unknown) => hookDiagnostic('pre-compact', 'HANDOFF.json not written', e))
    .finally(() => process.exit(0));
}
