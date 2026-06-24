// tests/lock-conflict.cjs
// Child helper for the cross-process lock conflict test (TEST-07).
//
// Spawned by tests/lock.test.ts via child_process.spawn. Reads RESOURCE
// and HOLD_MS from env, acquires the same lock the parent will race for,
// holds for HOLD_MS, releases, exits 0. Prints `ACQUIRED <ms>` and
// `RELEASING <ms>` on stdout for the parent to parse.
//
// Why this is a .cjs (not .ts):
//   The parent test runs under tsx which transpiles ESM. child_process.spawn
//   invokes Node directly with no tsx loader, so this helper must be loadable
//   by raw Node 20.x. Using .cjs lets us `require('proper-lockfile')` natively
//   (proper-lockfile is CJS-only — see bin/lib/lock.ts header), and the file
//   is not subject to package.json's "type":"module" classification.
//
// Why we don't import from bin/lib/lock.ts here:
//   - bin/lib/lock.ts is TypeScript and ESM. Importing it from a .cjs Node
//     subprocess would require a tsx loader hook, complicating spawn args.
//   - The test's purpose is to prove TWO independent processes serialize
//     against the same lock file. The lock-file path computation MUST be
//     identical to bin/lib/lock.ts; we duplicate the small chunk of logic
//     here (sha256(resource).slice(0,12) under pensmithLockDir()) and rely
//     on the test's cross-process timing assertion to catch any drift.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createHash } = require('node:crypto');
const lockfile = require('proper-lockfile');

// Mirror of bin/lib/paths.ts localDataDir() — kept minimal (no test
// injection points; we always read process.platform / process.env).
function localDataDir() {
  if (process.platform === 'win32') {
    if (!process.env.LOCALAPPDATA) {
      throw new Error('LOCALAPPDATA is unset on Windows');
    }
    return process.env.LOCALAPPDATA;
  }
  if (process.platform === 'darwin') {
    return path.join(process.env.HOME || os.homedir(), 'Library', 'Application Support');
  }
  return process.env.XDG_DATA_HOME || path.join(process.env.HOME || os.homedir(), '.local', 'share');
}

function pensmithLockDir() {
  return path.join(localDataDir(), 'pensmith', 'locks');
}

function stubFor(resource) {
  const dir = pensmithLockDir();
  fs.mkdirSync(dir, { recursive: true });
  // HARD-01: canonicalize before hashing (mirrors bin/lib/lock.ts stubFor).
  let canonical = path.resolve(resource);
  try {
    canonical = fs.realpathSync.native(canonical);
  } catch {
    // not-yet-created file — use resolved path
  }
  if (process.platform === 'win32') canonical = canonical.toLowerCase();
  const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 12);
  const stub = path.join(dir, hash);
  fs.closeSync(fs.openSync(stub, 'a'));
  return stub;
}

(async () => {
  const resource = process.env.RESOURCE;
  const holdMs = parseInt(process.env.HOLD_MS || '2000', 10);
  if (!resource) {
    console.error('RESOURCE env required');
    process.exit(2);
  }
  const stub = stubFor(resource);
  // staleMs matches bin/lib/lock.ts default (45s) so a hung child doesn't
  // accidentally trigger stale-recovery on the parent side. retries:0 — we
  // expect to acquire immediately since the parent waits for us via stdout.
  const release = await lockfile.lock(stub, { stale: 45_000, retries: 0 });
  // stdout is the parent's signal channel — these console.log calls are
  // load-bearing (parent parses them via child.stdout.on('data')).
  console.log('ACQUIRED', Date.now());
  await new Promise((r) => setTimeout(r, holdMs));
  console.log('RELEASING', Date.now());
  await release();
  process.exit(0);
})().catch((err) => {
  console.error('CHILD-ERROR', err.message);
  process.exit(3);
});
