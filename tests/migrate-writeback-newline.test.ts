// tests/migrate-writeback-newline.test.ts — audit #35 regression.
//
// loadAndMigrate's writeBack path wrote JSON.stringify(...) with no trailing
// newline, while every other JSON writer (state.ts, library.ts) appends '\n'.
// A migrated file was therefore byte-inconsistent with a freshly-written one and
// produced a spurious "\ No newline at end of file" git diff. The write-back now
// appends the newline.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAndMigrate } from '../bin/lib/migrations/loader.js';
import { Schema as StateSchema } from '../bin/lib/schemas/state.js';
import v1_to_v2_migration from '../bin/lib/migrations/state/v1_to_v2.js';

test('audit #35: a migrated write-back ends with exactly one trailing newline', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'pensmith-mig-nl-')), 'STATE.json');
  // A v1 envelope (no $schemaVersion) so a migration runs and the write-back fires.
  // Written WITHOUT a trailing newline — the pre-fix state.
  const v1 = {
    schema_version: 1,
    paperId: '11111111-1111-1111-1111-111111111111',
    createdAt: '2026-01-01T00:00:00.000Z',
    sections: [{ n: 1, slug: 'intro', state: 'planned', status: 'planned', lastVerification: null }],
  };
  writeFileSync(file, JSON.stringify(v1, null, 2)); // no trailing '\n'

  await loadAndMigrate({
    file,
    schema: StateSchema,
    schemaName: 'state',
    currentVersion: 2, // v2 is the current state schema; the 1→2 migration runs
    migrations: { 1: v1_to_v2_migration },
    writeBack: true,
  });

  const after = readFileSync(file, 'utf8');
  assert.ok(after.endsWith('\n'), 'migrated write-back must end with a trailing newline');
  assert.ok(!after.endsWith('\n\n'), 'exactly one trailing newline (no double)');
});
