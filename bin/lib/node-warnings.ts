// bin/lib/node-warnings.ts — keep a dependency's deprecation noise off the
// user's terminal (RUN-12 clean output, CI-06).
//
// citation-js pulls in sync-fetch → node-fetch@2 → whatwg-url, which requires
// Node's deprecated `punycode` builtin. On Node 22+ that prints a two-line
// DEP0040 DeprecationWarning to stderr on EVERY command (`--help` included).
// It is not actionable by a user and not ours to fix in place, so exactly that
// code is filtered; every other warning still reaches Node's own printer
// unchanged (and `--no-warnings` / NODE_OPTIONS keep working, because the
// original listeners are the ones that print).
//
// Imported FIRST by each process entry point (bin/pensmith.ts, mcp/server.ts)
// so the filter is in place before any module that loads citation-js runs.
// Importing it installs the filter; installWarningFilter() is idempotent.

/** Warning codes a dependency emits that pensmith silences (nothing else). */
export const SILENCED_WARNING_CODES: ReadonlySet<string> = new Set(['DEP0040']);

let installed = false;

/** Route `warning` events through a filter that drops SILENCED_WARNING_CODES. */
export function installWarningFilter(): void {
  if (installed) return;
  installed = true;
  const printers = process.listeners('warning');
  process.removeAllListeners('warning');
  // A plain function: EventEmitter calls it with the process object as its
  // receiver, and the original printers get that same receiver.
  process.on('warning', function (this: NodeJS.Process, warning: Error & { code?: string }) {
    if (typeof warning.code === 'string' && SILENCED_WARNING_CODES.has(warning.code)) return;
    for (const print of printers) print.call(this, warning);
  });
}

installWarningFilter();
