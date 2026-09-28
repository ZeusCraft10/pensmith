// tests/library.test.ts — round-trip + init-collision + not-found + upsert
// persistence + concurrent upserts + findEntry + forward-incompat coverage for
// bin/lib/library.ts (W11; v2 / one writer since BRDTH-01 / D-17-43).
//
// Test isolation strategy (mirrors tests/state.test.ts and
// tests/session-log.test.ts): each test calls mkPaperRoot() to create a fresh
// tmpdir AND override process.env.LOCALAPPDATA / XDG_DATA_HOME / HOME so the
// session-log singleton inside library.ts (lazy-init at first .event() call)
// resolves into the per-test tmpdir.
//
// Paper root (D-17-32): library functions take the PROJECT root and resolve
// `.paper/LIBRARY.json` themselves; the `.paper` directory is accepted too.
//
// Concurrency property: 10 simultaneous upsertSources calls with disjoint
// sources must all land in the final library. This is the regression gate for
// the "load + merge + write inside ONE withLock" invariant (T-01-01): if the
// read were outside the lock, two callers could each observe the same
// pre-write entries[] and the second writer would silently clobber the first.

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
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  return tmp;
}

function src(i: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: 'crossref',
    id: `10.5555/lib.${i}`,
    doi: `10.5555/lib.${i}`,
    title: `Library Round Trip Work Number ${i}`,
    authors: [`Author${String.fromCharCode(97 + i)}, Test`],
    year: 2000 + i,
    citekey: `author${String.fromCharCode(97 + i)}${2000 + i}`,
    last_verified: '2026-01-01T00:00:00.000Z',
    retracted: false,
    raw: {},
    ...extra,
  };
}

test('initLibrary then loadLibrary returns an empty current-version library', async () => {
  const root = mkPaperRoot();
  const { initLibrary, loadLibrary } = await import('../bin/lib/library.js');
  const { CURRENT_LIBRARY_VERSION } = await import('../bin/lib/schemas/library.js');

  await initLibrary(root);
  const loaded = await loadLibrary(root);

  assert.deepEqual(loaded.entries, []);
  assert.equal(loaded.$schemaVersion, CURRENT_LIBRARY_VERSION);
  assert.ok(fs.existsSync(path.join(root, '.paper', 'LIBRARY.json')), 'LIBRARY.json lives under .paper/');
});

test('initLibrary refuses to overwrite an existing LIBRARY.json', async () => {
  const root = mkPaperRoot();
  const { initLibrary, LibraryAlreadyExistsError } = await import('../bin/lib/library.js');

  await initLibrary(root);
  await assert.rejects(
    () => initLibrary(root),
    (e: unknown) => e instanceof LibraryAlreadyExistsError,
  );
});

test('loadLibrary throws LibraryNotFoundError when LIBRARY.json is absent; tryLoadLibrary returns null', async () => {
  const root = mkPaperRoot();
  const { loadLibrary, tryLoadLibrary, LibraryNotFoundError } = await import('../bin/lib/library.js');

  await assert.rejects(
    () => loadLibrary(root),
    (e: unknown) => e instanceof LibraryNotFoundError,
  );
  assert.equal(await tryLoadLibrary(root), null);
});

test('upsertSources persists; loadLibrary (via the project root or the .paper dir) sees it', async () => {
  const root = mkPaperRoot();
  const { upsertSources, loadLibrary } = await import('../bin/lib/library.js');

  const r = await upsertSources(root, [src(1)], { provenance: 'research' });
  assert.deepEqual(r.outcomes, [{ index: 0, citekey: 'authorb2001', status: 'added' }]);

  for (const via of [root, path.join(root, '.paper')]) {
    const lib = await loadLibrary(via);
    assert.equal(lib.entries.length, 1);
    const e = lib.entries[0]!;
    assert.equal(e.citekey, 'authorb2001');
    assert.equal(e.doi, '10.5555/lib.1');
    assert.deepEqual(e.provenance, ['research:crossref']);
    assert.ok(!Number.isNaN(Date.parse(e.addedAt)));
    assert.equal(e.last_verified, '2026-01-01T00:00:00.000Z');
  }
  // The two citation files are rendered from it.
  assert.match(fs.readFileSync(path.join(root, '.paper', 'CITATIONS.bib'), 'utf8'), /@article\{authorb2001,/);
  assert.match(fs.readFileSync(path.join(root, '.paper', 'CITATIONS.ris'), 'utf8'), /TY {2}- JOUR/);
});

test('10 concurrent upsertSources calls with disjoint sources all succeed and all are visible', async () => {
  const root = mkPaperRoot();
  const { upsertSources, loadLibrary } = await import('../bin/lib/library.js');

  // Fire 10 simultaneously; if the load-merge-write triple were not under ONE
  // lock, the final entries[] would be strictly shorter than 10.
  await Promise.all(Array.from({ length: 10 }, (_, i) => upsertSources(root, [src(i)], { provenance: 'research' })));

  const lib = await loadLibrary(root);
  assert.deepEqual(
    lib.entries.map((e) => e.doi).sort(),
    Array.from({ length: 10 }, (_, i) => `10.5555/lib.${i}`).sort(),
  );
});

test('findEntry returns the matching entry / undefined for a miss', async () => {
  const root = mkPaperRoot();
  const { upsertSources, findEntry } = await import('../bin/lib/library.js');

  await upsertSources(root, [src(3)], { provenance: 'add' });
  const hit = await findEntry(root, (e) => e.doi === '10.5555/lib.3');
  const miss = await findEntry(root, (e) => e.citekey === 'nope');

  assert.equal(hit?.citekey, 'authord2003');
  assert.equal(miss, undefined);
});

test('BLOCKER-01: concurrent initLibrary calls — exactly one succeeds, others get AlreadyExists (no clobber)', async () => {
  const root = mkPaperRoot();
  const { initLibrary, LibraryAlreadyExistsError, loadLibrary } = await import('../bin/lib/library.js');

  const N = 8;
  const results = await Promise.allSettled(Array.from({ length: N }, () => initLibrary(root)));
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, `exactly one initLibrary must succeed; got ${fulfilled.length}`);
  assert.equal(rejected.length, N - 1, `the other ${N - 1} must reject`);
  for (const r of rejected) {
    assert.ok(
      (r as PromiseRejectedResult).reason instanceof LibraryAlreadyExistsError,
      'every loser must throw LibraryAlreadyExistsError',
    );
  }
  const final = await loadLibrary(root);
  assert.deepEqual(final.entries, [], 'on-disk entries must be the seeded empty array');
});

test('forward-incompat: $schemaVersion=999 throws ForwardIncompatError (never downgraded)', async () => {
  const root = mkPaperRoot();
  const file = path.join(root, '.paper', 'LIBRARY.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 999, entries: [] }));

  const { loadLibrary, upsertSources } = await import('../bin/lib/library.js');
  const { ForwardIncompatError } = await import('../bin/lib/migrations/loader.js');

  await assert.rejects(() => loadLibrary(root), (e: unknown) => e instanceof ForwardIncompatError);
  await assert.rejects(() => upsertSources(root, [src(1)], { provenance: 'add' }), (e: unknown) => e instanceof ForwardIncompatError);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).$schemaVersion, 999, 'the newer file is untouched');
});

test('the library refuses to persist a duplicate citekey (schema invariant)', async () => {
  const { Schema, CURRENT_LIBRARY_VERSION } = await import('../bin/lib/schemas/library.js');
  const e = {
    citekey: 'dup2020',
    title: 'x',
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const r = Schema.safeParse({ $schemaVersion: CURRENT_LIBRARY_VERSION, entries: [e, { ...e, doi: '10.5555/other' }] });
  assert.equal(r.success, false);
  assert.match(JSON.stringify(r.error?.issues), /duplicate citekey/);
});
