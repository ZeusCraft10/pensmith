// tests/lib/built-plugin.ts
//
// plugin/dist is built by `npm run bundle` (which `npm run check` and CI run
// before the tests) and is never committed. Tests reach the built payload
// through this helper so a missing build fails with the fix, instead of a
// bare ENOENT or a skip.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Absolute path of a built payload file such as `dist/pensmith.mjs`; fails the test if it has not been built. */
export function builtPluginFile(pluginDir: string, rel: string): string {
  const p = path.join(pluginDir, ...rel.split('/'));
  assert.ok(existsSync(p), `plugin/${rel} is missing: run \`npm run bundle\` before the tests (npm run check does both)`);
  return p;
}
