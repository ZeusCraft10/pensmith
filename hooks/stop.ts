#!/usr/bin/env node
// hooks/stop.ts — Claude Code Stop hook entry (PLUG-14, RUN-23, D-17-37;
// HOOK-04 / M1 / C2-M2). Bundled to plugin/dist/hooks/stop.mjs (scripts/
// bundle.mjs).
//
// In a folder that holds a paper it releases the paper's session lock ONLY
// when the pensmith MCP server of THIS Claude session holds it (owner kind
// 'mcp' and claudeSessionId equal to the stdin `session_id`) and flushes the
// session log (bin/lib/hooks/stop.ts). A CLI session's lock, or another Claude
// session's, is never removed. Outside a paper it does nothing.
//
// It writes nothing to stdout; diagnostics go to stderr. It always exits 0.

import { isMainModule } from '../bin/lib/main-guard.js';
import { readHookInput } from '../bin/lib/hooks/stdin.js';
import { hookDiagnostic, hookPaperRoot } from '../bin/lib/hooks/entry.js';

async function main(): Promise<void> {
  const input = await readHookInput();
  const root = hookPaperRoot(input);
  if (root === null) return; // no paper here: no lock of ours to release
  const { stopHook } = await import('../bin/lib/hooks/stop.js');
  const outcome = await stopHook(root, input?.session_id ?? null);
  for (const line of outcome.errors) hookDiagnostic('stop', line);
}

if (isMainModule(import.meta.url)) {
  main()
    .catch((e: unknown) => hookDiagnostic('stop', 'shutdown cleanup skipped', e))
    .finally(() => process.exit(0));
}
