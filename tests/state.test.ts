// tests/state.test.ts — round-trip + collision + not-found + save-load +
// concurrent updateState + forward-incompat + invalid-mutator coverage for
// bin/lib/state.ts (W10).
//
// Test isolation strategy (mirrors tests/session-log.test.ts):
//   Each test calls mkPaperRoot() to create a fresh tmpdir AND override
//   process.env.LOCALAPPDATA / XDG_DATA_HOME / HOME so the session-log
//   singleton inside state.ts (lazy-initialized at first use) resolves
//   into the per-test tmpdir. The state.ts module is dynamically imported
//   AFTER the env override so its first-call logger init picks up the
//   redirected paths.
//
// Concurrency property (Test 5): Per D-58 the schema is locked to three
// fields, so we cannot test "both mutations visible". Instead we verify
// the lock-correctness invariant directly: two simultaneous updateState
// calls must (a) both resolve, (b) leave STATE.json valid + parseable,
// (c) end up with createdAt equal to ONE of the two stamps (not garbage,
// not torn). That's a strictly weaker but achievable assertion under the
// foundation-slice schema.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function mkPaperRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-state-'));
  // Force pensmithDataDir() (used by openSessionLog scope:'auto' fallback)
  // to resolve into tmp regardless of platform. paths.ts inspects:
  //   - LOCALAPPDATA on win32
  //   - HOME on darwin (-> HOME/Library/Application Support)
  //   - XDG_DATA_HOME (then HOME/.local/share) on POSIX
  // Same env-override pattern as tests/session-log.test.ts (W9).
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  return tmp;
}

test('initState then loadState round-trips ($schemaVersion + paperId + createdAt)', async () => {
  const root = mkPaperRoot();
  const { initState, loadState } = await import('../bin/lib/state.js');

  const seeded = await initState(root, { paperId: 'paper-abc' });
  const loaded = await loadState(root);

  assert.equal(loaded.paperId, 'paper-abc');
  assert.equal(loaded.$schemaVersion, seeded.$schemaVersion);
  assert.equal(loaded.createdAt, seeded.createdAt);
  // Sanity: createdAt is a real ISO-8601 timestamp.
  assert.ok(!Number.isNaN(Date.parse(loaded.createdAt)), 'createdAt must be ISO-8601');
});

test('initState refuses to overwrite an existing STATE.json', async () => {
  const root = mkPaperRoot();
  const { initState, StateAlreadyExistsError } = await import('../bin/lib/state.js');

  await initState(root);
  await assert.rejects(
    () => initState(root),
    (e: unknown) => e instanceof StateAlreadyExistsError,
  );
});

test('loadState throws StateNotFoundError when STATE.json is absent', async () => {
  const root = mkPaperRoot();
  const { loadState, StateNotFoundError } = await import('../bin/lib/state.js');

  await assert.rejects(
    () => loadState(root),
    (e: unknown) => e instanceof StateNotFoundError,
  );
});

test('saveState then loadState round-trips a mutated value', async () => {
  const root = mkPaperRoot();
  const { initState, saveState, loadState } = await import('../bin/lib/state.js');

  const seeded = await initState(root, { paperId: 'paper-rt' });
  const updated = { ...seeded, createdAt: '2099-01-01T00:00:00.000Z' };
  await saveState(root, updated);

  const back = await loadState(root);
  assert.equal(back.createdAt, '2099-01-01T00:00:00.000Z');
  assert.equal(back.paperId, 'paper-rt');
  assert.equal(back.$schemaVersion, seeded.$schemaVersion);
});

test('concurrent updateState calls serialize (no torn writes; final value is one of the two stamps)', async () => {
  const root = mkPaperRoot();
  const { initState, updateState, loadState } = await import('../bin/lib/state.js');

  await initState(root, { paperId: 'paper-race' });

  const stamp1 = '2099-01-01T00:00:00.000Z';
  const stamp2 = '2099-01-02T00:00:00.000Z';
  // Fire both updateState calls without awaiting either individually so they
  // race for the lock. Both must resolve (no deadlock); the final on-disk
  // createdAt must match exactly one of the two stamps; paperId must
  // survive unchanged.
  await Promise.all([
    updateState(root, async (s) => ({ ...s, createdAt: stamp1 })),
    updateState(root, async (s) => ({ ...s, createdAt: stamp2 })),
  ]);

  const final = await loadState(root);
  assert.ok(
    [stamp1, stamp2].includes(final.createdAt),
    `expected one of the two stamps (no torn write), got ${final.createdAt}`,
  );
  assert.equal(final.paperId, 'paper-race');
});

test('forward-incompat: $schemaVersion=999 on disk throws ForwardIncompatError', async () => {
  const root = mkPaperRoot();
  const file = path.join(root, 'STATE.json');
  // Hand-write a future-version STATE.json that this build cannot read.
  fs.writeFileSync(
    file,
    JSON.stringify({
      $schemaVersion: 999,
      paperId: 'fut',
      createdAt: '2099-01-01T00:00:00.000Z',
    }),
  );

  const { loadState } = await import('../bin/lib/state.js');
  const { ForwardIncompatError } = await import('../bin/lib/migrations/loader.js');

  await assert.rejects(
    () => loadState(root),
    (e: unknown) => e instanceof ForwardIncompatError,
  );
});

test('BLOCKER-01: concurrent initState calls — exactly one succeeds, others get AlreadyExists (no clobber)', async () => {
  const root = mkPaperRoot();
  const { initState, StateAlreadyExistsError, loadState } = await import('../bin/lib/state.js');

  // Fire 8 concurrent initState calls with distinct paperIds. The lock-
  // inside-init fix guarantees exactly one wins the race; the others all
  // observe the seeded file inside the critical section and throw
  // StateAlreadyExistsError. The on-disk paperId must match exactly one of
  // the candidate seeds — never a partial/torn write, never a clobbered
  // value from a later writer.
  const N = 8;
  const ids = Array.from({ length: N }, (_, i) => `paper-race-${i}`);
  const results = await Promise.allSettled(
    ids.map((id) => initState(root, { paperId: id })),
  );

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, `exactly one initState must succeed; got ${fulfilled.length}`);
  assert.equal(rejected.length, N - 1, `the other ${N - 1} must reject`);
  for (const r of rejected) {
    assert.ok(
      (r as PromiseRejectedResult).reason instanceof StateAlreadyExistsError,
      'every loser must throw StateAlreadyExistsError',
    );
  }

  // The on-disk paperId must equal the winner's paperId — confirms no
  // clobber by a later contender after the winner committed.
  const winner = (fulfilled[0] as PromiseFulfilledResult<{ paperId: string }>).value;
  const final = await loadState(root);
  assert.equal(final.paperId, winner.paperId, 'on-disk paperId must match the race winner');
  assert.ok(ids.includes(final.paperId), 'on-disk paperId must be one of the candidates');
});

test('updateState mutator that returns invalid shape rejects (StateSchema.parse fails)', async () => {
  const root = mkPaperRoot();
  const { initState, updateState } = await import('../bin/lib/state.js');

  await initState(root);

  // Mutator returns an empty object — fails .min(1) on paperId, missing
  // $schemaVersion literal, missing createdAt. zod's error message will
  // mention at least one of the three.
  await assert.rejects(
    () => updateState(root, () => ({} as never)),
    (e: unknown) => /paperId|createdAt|schemaVersion/i.test(String((e as Error)?.message ?? e)),
  );
});
