// bin/lib/main-guard.ts — "is this module the program entry point?" (RUN-10 /
// D-17-41). The ONE place that compares a module URL with process.argv[1]
// (chokepoint row `main-guard`, scripts/chokepoints/main-guard.json).
//
// Why not `import.meta.url === pathToFileURL(process.argv[1]).href`:
//   argv[1] is the path the user (or a shim) ran — under `npm i -g`, `npm link`
//   and node_modules/.bin that is a SYMLINK (<prefix>/bin/pensmith →
//   …/dist/bin/pensmith.js), and a symlinked plugin root or a Windows junction
//   does the same to dist/mcp/server.js. Node resolves the ESM entry module to
//   its REAL path, so import.meta.url never equals the symlink's URL: the guard
//   was false, main() never ran, and the process exited 0 having printed
//   nothing (QR-9, T1-12). Comparing realpaths fixes every launcher.
//
// Also handled:
//   - a relative argv[1] (`node dist/bin/pensmith.js`) — path.resolve;
//   - an extensionless argv[1] (`node dist/bin/pensmith`) — Node's CommonJS-
//     style main resolution appends .js/.mjs/.cjs, so we try those too;
//   - Windows: case-insensitive paths and 8.3 short names (RUNNER~1) —
//     realpathSync.native expands them, then both sides are case-folded.

import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function canonicalPath(p: string): string | null {
  const resolved = path.resolve(p);
  let real: string;
  try {
    real = fs.realpathSync.native(resolved);
  } catch {
    return null;
  }
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

/**
 * True when the module whose `import.meta.url` is `importMetaUrl` is the
 * program entry point, however it was launched: directly, through a symlink or
 * junction, an npm bin shim, or `npm link`.
 *
 * Usage (the last lines of an entry module):
 *   if (isMainModule(import.meta.url)) { void main(); }
 */
export function isMainModule(importMetaUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false;
  let self: string | null;
  try {
    self = canonicalPath(fileURLToPath(importMetaUrl));
  } catch {
    return false; // not a file: URL (e.g. data:, or a bundler-virtual module)
  }
  if (!self) return false;
  for (const candidate of [argv1, `${argv1}.js`, `${argv1}.mjs`, `${argv1}.cjs`]) {
    const entry = canonicalPath(candidate);
    if (entry !== null) return entry === self;
  }
  return false;
}
