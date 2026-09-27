// tests/lock-conflict.cjs
// Child helper for the cross-process lock tests (TEST-07, RUN-22).
//
// Spawned by tests/lock.test.ts and tests/lock-contention.test.ts as
// `node --import tsx tests/lock-conflict.cjs`. It drives the REAL
// bin/lib/lock.ts (loaded through the tsx loader), so both sides of every
// cross-process test run the production acquisition path (FIFO + one
// proper-lockfile attempt + jittered backoff + owner.json).
//
// Modes (env):
//   RESOURCE (required)   the resource path to lock.
//   HOLD_MS=<n>           acquire, print `ACQUIRED <epoch-ms> <pid>`, hold n ms,
//                         print `RELEASING <epoch-ms>`, release, exit 0.
//   HOLD_MS=forever       acquire, print `ACQUIRED <epoch-ms> <pid>`, never
//                         release (the parent kills the process).
//   CONTEND=<n>           run n concurrent withLock calls, each holding
//                         HOLD_MS (default 5) ms; print
//                         `DONE ok=<n> fail=<n> ms=<elapsed>` (+ `FAIL <msg>`
//                         lines) and exit 0 when every call succeeded.
//   TIMEOUT_MS=<n>        the timeoutMs passed to the lock (default 10000).
//
// Why a .cjs: package.json has "type":"module"; the .cjs extension keeps this
// a CommonJS script (require for builtins) while the lock module itself is
// loaded with a dynamic import() through tsx. The data dir (and therefore
// pensmithLockDir()) comes from the env the parent passes — the same env the
// parent's own lock.ts resolves, so both processes share one lock directory.

const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const resource = process.env.RESOURCE;
  if (!resource) {
    console.error('RESOURCE env required');
    process.exit(2);
  }
  const lockUrl = pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'lock.ts')).href;
  const { tryAcquire, withLock } = await import(lockUrl);
  const timeoutMs = parseInt(process.env.TIMEOUT_MS || '10000', 10);

  if (process.env.CONTEND) {
    const n = parseInt(process.env.CONTEND, 10);
    const holdMs = parseInt(process.env.HOLD_MS || '5', 10);
    const t0 = Date.now();
    const results = await Promise.allSettled(
      Array.from({ length: n }, () =>
        withLock(resource, () => new Promise((r) => setTimeout(r, holdMs)), { timeoutMs }),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    for (const f of failed) console.log('FAIL', String(f.reason && f.reason.message));
    console.log(`DONE ok=${n - failed.length} fail=${failed.length} ms=${Date.now() - t0}`);
    process.exit(failed.length === 0 ? 0 : 1);
  }

  const hold = process.env.HOLD_MS || '2000';
  const release = await tryAcquire(resource, { timeoutMs });
  // stdout is the parent's signal channel — these lines are load-bearing.
  console.log('ACQUIRED', Date.now(), process.pid);
  if (hold === 'forever') {
    setInterval(() => {}, 60_000); // keep the event loop (and the lock) alive
    return;
  }
  await new Promise((r) => setTimeout(r, parseInt(hold, 10)));
  console.log('RELEASING', Date.now());
  await release();
  process.exit(0);
})().catch((err) => {
  console.error('CHILD-ERROR', err && err.message);
  process.exit(3);
});
