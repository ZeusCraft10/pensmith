#!/usr/bin/env node
// hooks/post-tool-use.ts — Claude Code PostToolUse hook entry (PLUG-14,
// D-23a-15). Bundled to plugin/dist/hooks/post-tool-use.mjs (scripts/
// bundle.mjs); plugin/hooks/hooks.json runs it after the pensmith MCP tools
// (matcher `^mcp__(?:plugin_pensmith_)?pensmith__.*`: the plugin's server,
// `mcp__plugin_pensmith_pensmith__*`, and the developer .mcp.json server that
// Claude Code keeps in its place at the repo root, `mcp__pensmith__*`).
//
// In a folder that holds a paper it reads the stdin `tool_name` and
// `session_id` and appends at most one checkpoint per minute to
// pensmithDataDir()/checkpoints/<projectHash>.jsonl (bin/lib/hooks/
// post-tool-use.ts) — never under the user's `.claude/` or the paper's
// `.paper/`. Outside a paper it does nothing.
//
// It writes nothing to stdout; diagnostics go to stderr. It always exits 0.

import { isMainModule } from '../bin/lib/main-guard.js';
import { readHookInput } from '../bin/lib/hooks/stdin.js';
import { hookDiagnostic, hookPaperRoot } from '../bin/lib/hooks/entry.js';

async function main(): Promise<void> {
  const input = await readHookInput();
  const root = hookPaperRoot(input);
  if (root === null) return; // no paper here: no checkpoint
  const [{ recordCheckpoint }, { routeOptionsFor }] = await Promise.all([
    import('../bin/lib/hooks/post-tool-use.js'),
    import('../bin/cli/route-options.js'),
  ]);
  const outcome = await recordCheckpoint(
    root,
    { sessionId: input?.session_id ?? null, toolName: input?.tool_name ?? null },
    { routeOptions: routeOptionsFor(root) },
  );
  if (outcome.kind === 'failed') hookDiagnostic('post-tool-use', `checkpoint not written to ${outcome.file}`, outcome.error);
}

if (isMainModule(import.meta.url)) {
  main()
    .catch((e: unknown) => hookDiagnostic('post-tool-use', 'checkpoint skipped', e))
    .finally(() => process.exit(0));
}
