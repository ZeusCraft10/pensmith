// Child-process driver for tests/legacy-layout-migration.test.ts: run
// migrateLegacyLayout(root) (and optionally the router) in a sandboxed data
// dir and print one JSON line with the outcome.
//
// usage: legacy-move.ts <root> [--router]

import { migrateLegacyLayout } from '../../../bin/lib/state.js';
import { resolveNextAction } from '../../../bin/lib/router.js';

const [root, flag] = process.argv.slice(2);
if (!root) throw new Error('usage: legacy-move.ts <root> [--router]');

try {
  if (flag === '--router') {
    const decision = await resolveNextAction(root);
    process.stdout.write(JSON.stringify({ ok: true, decision }) + '\n');
  } else {
    const result = await migrateLegacyLayout(root);
    process.stdout.write(JSON.stringify({ ok: true, moved: result.moved }) + '\n');
  }
} catch (e) {
  const err = e as Error & { exitCode?: number };
  process.stdout.write(JSON.stringify({ ok: false, name: err.name, message: err.message, exitCode: err.exitCode ?? null }) + '\n');
}
