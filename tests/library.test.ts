// tests/library.test.ts — round-trip + init-collision + not-found +
// addEntry persistence + duplicate-id refusal + concurrent-add + findEntry
// + forward-incompat coverage for bin/lib/library.ts (W11).
//
// Test isolation strategy (mirrors tests/state.test.ts and
// tests/session-log.test.ts): each test calls mkPaperRoot() to create a
// fresh tmpdir AND override process.env.LOCALAPPDATA / XDG_DATA_HOME / HOME
// so the session-log singleton inside library.ts (lazy-init at first
// .event() call) resolves into the per-test tmpdir.
//
// Concurrency property (Test 6): 10 simultaneous addEntry calls with
// disjoint ids must all succeed and all 10 ids must appear in the final
// loadLibrary snapshot. This is the regression gate for the T-01-01
// "load + duplicate-check + write inside ONE withLock" invariant. If
// the read were outside the lock, two callers could each observe the
// same pre-write entries[] and the second writer would silently clobber
// the first — giving a final count strictly less than 10.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function mkPaperRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-library-'));
  // Force pensmithDataDir() (used by openSessionLog scope:'auto' fallback)
  // to resolve into tmp regardless of platform. paths.ts inspects:
  //   - LOCALAPPDATA on win32
  //   - HOME on darwin (-> HOME/Library/Application Support)
  //   - XDG_DATA_HOME (then HOME/.local/share) on POSIX
  // Same env-override pattern as tests/session-log.test.ts (W9) and
  // tests/state.test.ts (W10).
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  return tmp;
}

test('initLibrary then loadLibrary returns empty entries', async () => {
  const root = mkPaperRoot();
  const { initLibrary, loadLibrary } = await import('../bin/lib/library.js');

  await initLibrary(root);
  const loaded = await loadLibrary(root);

  assert.deepEqual(loaded.entries, []);
  assert.equal(typeof loaded.$schemaVersion, 'number');
});

test('initLibrary refuses to overwrite an existing LIBRARY.json', async () => {
  const root = mkPaperRoot();
  const { initLibrary, LibraryAlreadyExistsError } = await import(
    '../bin/lib/library.js'
  );

  await initLibrary(root);
  await assert.rejects(
    () => initLibrary(root),
    (e: unknown) => e instanceof LibraryAlreadyExistsError,
  );
});

test('loadLibrary throws LibraryNotFoundError when LIBRARY.json absent', async () => {
  const root = mkPaperRoot();
  const { loadLibrary, LibraryNotFoundError } = await import(
    '../bin/lib/library.js'
  );

  await assert.rejects(
    () => loadLibrary(root),
    (e: unknown) => e instanceof LibraryNotFoundError,
  );
});

test('addEntry persists; subsequent loadLibrary sees it', async () => {
  const root = mkPaperRoot();
  const { initLibrary, addEntry, loadLibrary } = await import(
    '../bin/lib/library.js'
  );

  await initLibrary(root);
  await addEntry(root, { id: 'cite-1', addedAt: '2099-01-01T00:00:00.000Z' });

  const lib = await loadLibrary(root);
  assert.equal(lib.entries.length, 1);
  assert.equal(lib.entries[0]?.id, 'cite-1');
  assert.equal(lib.entries[0]?.addedAt, '2099-01-01T00:00:00.000Z');
});

test('addEntry refuses duplicate id; library state unchanged after failed call', async () => {
  const root = mkPaperRoot();
  const { initLibrary, addEntry, loadLibrary, DuplicateLibraryEntryError } =
    await import('../bin/lib/library.js');

  await initLibrary(root);
  await addEntry(root, { id: 'cite-A', addedAt: '2099-01-01T00:00:00.000Z' });

  await assert.rejects(
    () =>
      addEntry(root, { id: 'cite-A', addedAt: '2099-02-01T00:00:00.000Z' }),
    (e: unknown) => e instanceof DuplicateLibraryEntryError,
  );

  // Original entry preserved; addedAt of the rejected duplicate did NOT
  // bleed in. This guards the "no torn write on rejection" invariant.
  const lib = await loadLibrary(root);
  assert.equal(lib.entries.length, 1);
  assert.equal(lib.entries[0]?.addedAt, '2099-01-01T00:00:00.000Z');
});

test('10 concurrent addEntry calls with disjoint ids all succeed and all visible', async () => {
  const root = mkPaperRoot();
  const { initLibrary, addEntry, loadLibrary } = await import(
    '../bin/lib/library.js'
  );

  await initLibrary(root);

  // Fire 10 simultaneously; if the load-check-write triple were not under
  // ONE lock, the final entries[] would be strictly shorter than 10 and
  // this assertion would fail.
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      addEntry(root, { id: `e${i}`, addedAt: '2099-01-01T00:00:00.000Z' }),
    ),
  );

  const lib = await loadLibrary(root);
  const ids = lib.entries.map((e) => e.id).sort();
  assert.deepEqual(ids, [
    'e0',
    'e1',
    'e2',
    'e3',
    'e4',
    'e5',
    'e6',
    'e7',
    'e8',
    'e9',
  ]);
});

test('findEntry returns matching entry / undefined for miss', async () => {
  const root = mkPaperRoot();
  const { initLibrary, addEntry, findEntry } = await import(
    '../bin/lib/library.js'
  );

  await initLibrary(root);
  await addEntry(root, { id: 'cite-X', addedAt: '2099-01-01T00:00:00.000Z' });

  const hit = await findEntry(root, (e) => e.id === 'cite-X');
  const miss = await findEntry(root, (e) => e.id === 'nope');

  assert.equal(hit?.id, 'cite-X');
  assert.equal(miss, undefined);
});

test('forward-incompat: $schemaVersion=999 throws ForwardIncompatError', async () => {
  const root = mkPaperRoot();
  const file = path.join(root, 'LIBRARY.json');
  // Hand-craft a newer-than-code library file. loadLibrary must surface
  // the loader's ForwardIncompatError unchanged (T-01-COMPAT-01 mitigation).
  fs.writeFileSync(
    file,
    JSON.stringify({ $schemaVersion: 999, entries: [] }),
  );

  const { loadLibrary } = await import('../bin/lib/library.js');
  const { ForwardIncompatError } = await import(
    '../bin/lib/migrations/loader.js'
  );

  await assert.rejects(
    () => loadLibrary(root),
    (e: unknown) => e instanceof ForwardIncompatError,
  );
});
