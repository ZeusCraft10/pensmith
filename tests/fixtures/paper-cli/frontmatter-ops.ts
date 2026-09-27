// Child-process driver for tests/frontmatter-versioning.test.ts: the
// write-back paths take the per-file lock (lock dir under the data dir), so
// they run here with the sandbox env and print one JSON line.
//
// usage:
//   frontmatter-ops.ts load <kind> <file> <writeBack:true|false>
//   frontmatter-ops.ts update-plan <file> <status>

import { loadFrontmatterDoc, type FrontmatterKind } from '../../../bin/lib/frontmatter.js';
import { updatePlanFrontmatter } from '../../../bin/lib/plan-status.js';

const [op, a, b, c] = process.argv.slice(2);

async function main(): Promise<unknown> {
  if (op === 'load' && a && b) {
    const doc = await loadFrontmatterDoc(a as FrontmatterKind, b, { writeBack: c === 'true' });
    return { diskVersion: doc.diskVersion, version: doc.version, migrated: doc.migrated, frontmatter: doc.frontmatter };
  }
  if (op === 'update-plan' && a && b) {
    return { updated: await updatePlanFrontmatter(a, (fm) => { fm['status'] = b; }) };
  }
  throw new Error(`bad args: ${process.argv.slice(2).join(' ')}`);
}

try {
  process.stdout.write(JSON.stringify({ ok: true, result: await main() }) + '\n');
} catch (e) {
  const err = e as Error & { exitCode?: number };
  process.stdout.write(JSON.stringify({ ok: false, name: err.name, message: err.message, exitCode: err.exitCode ?? null }) + '\n');
}
