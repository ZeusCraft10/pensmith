// bin/lib/hooks/entry.ts — what every hook entry does before its own work
// (PLUG-14, D-23a-15).
//
// The four hook entries (hooks/*.ts → plugin/dist/hooks/*.mjs) run on every
// matching Claude Code event, in every project the plugin is enabled in, so
// the common path must be cheap: read the stdin JSON, resolve the paper the
// hook addresses, and stop there when the folder holds none — no output, no
// file created, well under 500 ms. Only then does an entry `import()` its
// heavy module (esbuild inlines those but defers their initialisation).
//
// The paper resolves through resolvePaperRoot in 'hook' mode (RUN-14,
// D-17-33): PENSMITH_PAPER_ROOT, else the folder the hook runs in (the stdin
// `cwd`, else the working directory) — never `--paper`, never the `pensmith
// open` pointer. This module is light (paths.ts and output-sink.ts only) and
// never writes stdout: only the entries in hooks/ print protocol JSON (the
// stdout-sink row, PLUG-13).

import { hasPaper, resolvePaperRoot, setActivePaperRoot, workingDirectory } from '../paths.js';
import { setOutputSink } from '../output-sink.js';
import { hookInputCwd, type HookInput } from './stdin.js';

/**
 * The project root of the paper this hook addresses, or null when the folder
 * holds no paper. Like the MCP server, it records the root as the process's
 * active root and points the output sink at stderr before the entry imports
 * any heavier module: the hook's stdout is the Claude Code hook protocol
 * (SessionStart's one JSON line), so a verb or bin/lib line printed through
 * out() must never land there (PLUG-13, PLUG-14).
 */
export function hookPaperRoot(input: HookInput | null, env: NodeJS.ProcessEnv = process.env): string | null {
  const resolution = resolvePaperRoot({ mode: 'hook', verb: null, cwd: hookInputCwd(input) ?? workingDirectory(), env });
  if (resolution.kind !== 'root' || !hasPaper(resolution.root)) return null;
  setActivePaperRoot(resolution.root);
  setOutputSink(process.stderr);
  return resolution.root;
}

/** One stderr line for a hook failure (Claude Code keeps hook stderr in its debug log). */
export function hookDiagnostic(hook: string, what: string, err?: unknown): void {
  const detail = err === undefined ? '' : `: ${err instanceof Error ? err.message : String(err)}`;
  process.stderr.write(`[pensmith ${hook}] ${what}${detail}`.replace(/\s*\r?\n\s*/g, ' ') + '\n');
}
