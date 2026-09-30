#!/usr/bin/env node
// hooks/session-start.ts — Claude Code SessionStart hook entry (PLUG-14,
// D-23a-15). Bundled to plugin/dist/hooks/session-start.mjs (scripts/
// bundle.mjs); plugin/hooks/hooks.json runs it for every SessionStart source,
// `startup|resume|clear|compact|fork` (review round 3: after `/clear` and in a
// forked session the model's context also lacks the paper's step).
//
// In a folder that holds a paper it prints exactly ONE JSON line:
//   {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}
// — the router's next step, after a compaction (stdin `source: compact`) a
// summary of a not-done HANDOFF.json, and the instruction to run /pensmith
// (bin/lib/hooks/session-start.ts). Claude Code
// adds additionalContext to the model's context; it never prints
// `systemMessage`, which only the user sees. Outside a paper it prints nothing.
//
// stdout is the hook-protocol channel: that one line or nothing. Diagnostics go
// to stderr. It always exits 0 — a hook must never break the session.

import { isMainModule } from '../bin/lib/main-guard.js';
import { readHookInput } from '../bin/lib/hooks/stdin.js';
import { hookDiagnostic, hookPaperRoot } from '../bin/lib/hooks/entry.js';

async function main(): Promise<void> {
  const input = await readHookInput();
  const root = hookPaperRoot(input);
  if (root === null) return; // no paper here: no output, no files
  const [{ sessionStartOutput }, { routeOptionsFor }] = await Promise.all([
    import('../bin/lib/hooks/session-start.js'),
    import('../bin/cli/route-options.js'),
  ]);
  // `source` limits the HANDOFF summary to the SessionStart after a compaction.
  const output = await sessionStartOutput(root, { routeOptions: routeOptionsFor(root), source: input?.source });
  // Wait for the flush: a pipe can be asynchronous, and the process exits next.
  await new Promise<void>((resolve) => {
    process.stdout.write(JSON.stringify(output) + '\n', () => resolve());
  });
}

if (isMainModule(import.meta.url)) {
  main()
    .catch((e: unknown) => hookDiagnostic('session-start', 'resume context skipped', e))
    .finally(() => process.exit(0));
}
