// tests/registry-gc.test.ts — audit M3 regression.
//
// The global paper registry had no GC: every `pensmith new` appended an entry
// and nothing ever removed entries whose folder was later deleted, so the index
// grew unbounded (158 of 344 entries were dead in the field) and `list` showed
// ghosts. registerPaperInGlobalLibrary now self-heals: on each register it
// prunes entries whose folderPath no longer exists — but NEVER the entry being
// registered, and NEVER an 'archived' entry (explicit user retention).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { GlobalLibraryEntry } from '../bin/lib/schemas/global-library.js';

function mkDataRoot(): void {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-gc-data-'));
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
}

function mkPaperRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-gc-paper-'));
}

function entry(id: string, folderPath: string, status: GlobalLibraryEntry['status'] = 'intake'): GlobalLibraryEntry {
  return { id, name: id, folderPath, class: 'Unfiled', status, createdAt: '2099-01-01T00:00:00.000Z', updatedAt: '2099-01-01T00:00:00.000Z' };
}

test('audit M3: registering prunes dead-folder entries, keeping live + just-registered + archived', async () => {
  mkDataRoot();
  const { registerPaperInGlobalLibrary, loadGlobalLibrary } = await import('../bin/lib/global-library.js');

  const a = mkPaperRoot();
  const b = mkPaperRoot();
  const archived = mkPaperRoot();
  await registerPaperInGlobalLibrary(entry('A', a));
  await registerPaperInGlobalLibrary(entry('B', b));
  await registerPaperInGlobalLibrary(entry('ARCH', archived, 'archived'));

  // A's and ARCH's folders are deleted out from under the registry.
  fs.rmSync(a, { recursive: true, force: true });
  fs.rmSync(archived, { recursive: true, force: true });

  // Registering a new paper triggers the self-healing GC pass.
  const c = mkPaperRoot();
  const lib = await registerPaperInGlobalLibrary(entry('C', c));

  const ids = new Set(lib.entries.map((e) => e.id));
  assert.ok(!ids.has('A'), 'a dead-folder entry must be pruned');
  assert.ok(ids.has('B'), 'a live entry must remain');
  assert.ok(ids.has('C'), 'the just-registered entry must remain');
  assert.ok(ids.has('ARCH'), 'an archived entry survives even with a deleted folder');

  // Persisted to disk too.
  const reloaded = await loadGlobalLibrary();
  assert.deepEqual(new Set(reloaded.entries.map((e) => e.id)), ids);
});

test('audit M3: the entry being registered is never pruned even if its own folder is absent', async () => {
  mkDataRoot();
  const { registerPaperInGlobalLibrary } = await import('../bin/lib/global-library.js');
  // A non-existent folderPath for the entry under registration must NOT prune it
  // (mirrors the upsert path where the folder may be created moments later).
  const lib = await registerPaperInGlobalLibrary(entry('SELF', path.join(os.tmpdir(), 'pensmith-gc-missing-xyz')));
  assert.ok(lib.entries.some((e) => e.id === 'SELF'), 'the registered entry is retained regardless of folder existence');
});
