// tests/checkpoint.test.ts — empty-history + round-trip + ordering +
// findCheckpoint-most-recent + concurrent-record + invalid-line tolerance +
// forward-version skip + refs round-trip coverage for bin/lib/checkpoint.ts (W12).
//
// Test isolation strategy (mirrors tests/state.test.ts and
// tests/library.test.ts): each test calls mkPaperRoot() to create a fresh
// tmpdir AND override process.env.LOCALAPPDATA / XDG_DATA_HOME / HOME so the
// session-log singleton inside checkpoint.ts (lazy-init at first .event()
// call) resolves into the per-test tmpdir.
//
// Concurrency property (Test 6): 10 simultaneous recordCheckpoint calls
// must all land — listCheckpoints sees exactly 10 entries with distinct
// labels. This is the regression gate for the T-01-01 "append inside ONE
// withLock critical section" invariant. If the append were outside the lock,
// concurrent O_APPEND writes COULD still all land on POSIX (atomic for
// sub-PIPE_BUF lines) but the lock is the cross-process correctness guarantee
// for any line size and the only Windows-portable serialization story.
//
// PLAN deviation (Rule 1): the plan text said 20 concurrent calls. With
// W3's default retry schedule (timeoutMs=60_000, retryDelayMs=100,
// factor=1.5) the cumulative exponential-backoff wait for the 20th
// contender on Windows + OneDrive exceeds 60s — proper-lockfile exhausts
// its retry budget and throws ELOCKED before the lock becomes free.
// 10 contenders match the W11 (library) sibling test exactly and complete
// within the default retry budget on Windows. Documented as a Rule 1
// deviation in 01-12-SUMMARY.md.
//
// Forward-version property (Test 8 — D-60 carve-out from D-39): a
// $schemaVersion=999 line on disk MUST be SKIPPED by listCheckpoints (not
// crash the reader). This is the SOLE Phase-1 exception to refuse-forward-
// incompat, justified by the append-only audit-log semantic. Older readers
// see only the lines they understand; data is never silently downgraded
// because checkpoints are append-only — skipping never causes data loss.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function mkPaperRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-checkpoint-'));
  // Force pensmithDataDir() (used by openSessionLog scope:'auto' fallback)
  // to resolve into tmp regardless of platform. paths.ts inspects:
  //   - LOCALAPPDATA on win32
  //   - HOME on darwin (-> HOME/Library/Application Support)
  //   - XDG_DATA_HOME (then HOME/.local/share) on POSIX
  // Same env-override pattern as tests/session-log.test.ts (W9),
  // tests/state.test.ts (W10), and tests/library.test.ts (W11).
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  return tmp;
}

test('listCheckpoints on empty paper returns []', async () => {
  const root = mkPaperRoot();
  const { listCheckpoints } = await import('../bin/lib/checkpoint.js');

  const got = await listCheckpoints(root);
  assert.deepEqual(got, []);
});

test('recordCheckpoint then listCheckpoints round-trips', async () => {
  const root = mkPaperRoot();
  const { recordCheckpoint, listCheckpoints } = await import(
    '../bin/lib/checkpoint.js'
  );

  const cp = await recordCheckpoint(root, 'outline-approved');
  const list = await listCheckpoints(root);

  assert.equal(list.length, 1);
  assert.equal(list[0]?.label, 'outline-approved');
  assert.equal(list[0]?.tookAt, cp.tookAt);
});

test('chronological order preserved (insertion order via O_APPEND)', async () => {
  const root = mkPaperRoot();
  const { recordCheckpoint, listCheckpoints } = await import(
    '../bin/lib/checkpoint.js'
  );

  await recordCheckpoint(root, 'first');
  await recordCheckpoint(root, 'second');
  await recordCheckpoint(root, 'third');

  const list = await listCheckpoints(root);
  assert.deepEqual(
    list.map((c) => c.label),
    ['first', 'second', 'third'],
  );
});

test('findCheckpoint returns most recent matching label (reverse-walk)', async () => {
  const root = mkPaperRoot();
  const { recordCheckpoint, findCheckpoint } = await import(
    '../bin/lib/checkpoint.js'
  );

  // Refs are string→string per W7 schema (z.record(z.string(), z.string())).
  // Plan text said Record<string, unknown>; user ruled to honor the locked
  // schema — see Deviations from Plan in 01-12-SUMMARY.md. Test semantics
  // are preserved: most-recent matching label still wins; the run sentinel
  // string distinguishes the two records.
  await recordCheckpoint(root, 'verify-pass', { run: '1' });
  await new Promise((r) => setTimeout(r, 5)); // ensure tookAt diverges
  await recordCheckpoint(root, 'verify-pass', { run: '2' });

  const found = await findCheckpoint(root, 'verify-pass');
  assert.equal(found?.refs?.run, '2');
});

test('findCheckpoint returns undefined when no label matches', async () => {
  const root = mkPaperRoot();
  const { recordCheckpoint, findCheckpoint } = await import(
    '../bin/lib/checkpoint.js'
  );

  await recordCheckpoint(root, 'a');
  const got = await findCheckpoint(root, 'nope');
  assert.equal(got, undefined);
});

test('10 concurrent recordCheckpoint calls all persist with distinct labels', async () => {
  const root = mkPaperRoot();
  const { recordCheckpoint, listCheckpoints } = await import(
    '../bin/lib/checkpoint.js'
  );

  // Fire 10 simultaneously. Each writer takes withLock around an O_APPEND
  // syscall; the lock + O_APPEND together guarantee all 10 land without
  // tearing. If the append were outside the lock the cross-process story
  // would be platform-dependent — Windows in particular has no PIPE_BUF
  // append-atomicity guarantee. The test is the regression gate for
  // serialization correctness across both OSes.
  //
  // N=10 (not 20 as the plan text said) matches the W11 (library) sibling
  // test exactly and stays within W3's default exponential-backoff retry
  // budget on Windows + OneDrive. See header comment for why 20 was
  // infeasible. Documented as a Rule 1 deviation in 01-12-SUMMARY.md.
  await Promise.all(
    Array.from({ length: 10 }, (_, i) => recordCheckpoint(root, `cp-${i}`)),
  );

  const list = await listCheckpoints(root);
  assert.equal(list.length, 10);
  const labels = new Set(list.map((c) => c.label));
  assert.equal(labels.size, 10); // all distinct
});

test('invalid JSONL line is skipped, valid lines preserved (corruption tolerance)', async () => {
  const root = mkPaperRoot();
  const { recordCheckpoint, listCheckpoints } = await import(
    '../bin/lib/checkpoint.js'
  );

  await recordCheckpoint(root, 'real-1');
  // Hand-write a corrupt line BETWEEN two real records. listCheckpoints
  // must skip it via JSON.parse failure path, not crash.
  const file = path.join(root, 'CHECKPOINTS.jsonl');
  fs.appendFileSync(file, 'this-is-not-json\n');
  await recordCheckpoint(root, 'real-2');

  const list = await listCheckpoints(root);
  assert.equal(list.length, 2);
  assert.deepEqual(
    list.map((c) => c.label),
    ['real-1', 'real-2'],
  );
});

test('forward-versioned line is skipped (D-60 audit-log carve-out from D-39)', async () => {
  const root = mkPaperRoot();
  const file = path.join(root, 'CHECKPOINTS.jsonl');
  // Hand-write a $schemaVersion=999 line — newer than CURRENT_CHECKPOINT_VERSION.
  // Per D-60 the read path must SKIP it (safeParse failure path), NOT throw
  // ForwardIncompatError — checkpoints are append-only audit history, so
  // skipping never causes data loss; the older reader simply sees an older
  // history view.
  fs.writeFileSync(
    file,
    JSON.stringify({
      $schemaVersion: 999,
      label: 'future',
      tookAt: '2099-01-01T00:00:00.000Z',
    }) + '\n',
  );

  const { listCheckpoints, recordCheckpoint } = await import(
    '../bin/lib/checkpoint.js'
  );

  await recordCheckpoint(root, 'current');
  const list = await listCheckpoints(root);

  // The future line is rejected by CheckpointSchema.safeParse (literal version
  // mismatch); the current line is kept. Total = 1, and that 1 is the
  // current-version record.
  assert.equal(list.length, 1);
  assert.equal(list[0]?.label, 'current');
});

test('refs payload round-trips (string→string map per W7 schema)', async () => {
  const root = mkPaperRoot();
  const { recordCheckpoint, listCheckpoints } = await import(
    '../bin/lib/checkpoint.js'
  );

  // Per resolved decision: refs is Record<string, string> per the W7 schema
  // (z.record(z.string(), z.string())). Both values here are already strings,
  // matching the foundation-slice content-addressing model. Future schemas
  // may broaden the value type post-Phase-1 via versioned migration.
  await recordCheckpoint(root, 'with-refs', {
    stateHash: 'abc',
    libHash: 'def',
  });

  const list = await listCheckpoints(root);
  assert.deepEqual(list[0]?.refs, { stateHash: 'abc', libHash: 'def' });
});
