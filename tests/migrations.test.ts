// tests/migrations.test.ts — loader contract tests for bin/lib/migrations/loader.ts.
//
// Coverage matrix (per VALIDATION 01-07-03):
//   1. forward-incompat throws when diskVersion > currentVersion (D-39)
//   2. missing $schemaVersion is treated as v1
//   3. v1 -> v2 migration runs and writes back when writeBack:true
//   4. writeBack omitted (default false) leaves disk untouched after migration
//   5. writeBack:false leaves disk untouched after migration
//   6. missing migration in chain throws
//   7. invalid JSON throws (caller-handled SyntaxError)
//   8. zod validation failure throws SchemaValidationError with rich issues
//
// withTmp pattern mirrors tests/atomic-write.test.ts: mkdtemp + rm cleanup.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { z } from 'zod';
import {
  loadAndMigrate,
  ForwardIncompatError,
  SchemaValidationError,
} from '../bin/lib/migrations/loader.js';
import {
  Schema as StateSchema,
  CURRENT_STATE_VERSION,
} from '../bin/lib/schemas/state.js';
import v1_to_v2 from '../bin/lib/migrations/state/v1_to_v2.js';
import { atomicWriteFile } from '../bin/lib/atomic-write.js';

// Test-fixture seed: writes JSON content to a tmpdir path through the W2
// chokepoint. We cannot use fsp.writeFile directly here because the D-07
// atomic-write chokepoint bans it everywhere outside bin/lib/atomic-write.ts;
// routing the test seeding through atomicWriteFile keeps the chokepoint
// surface tight (no eslint per-file exemption needed for this file).
async function seed(file: string, content: string): Promise<void> {
  await atomicWriteFile(file, content);
}

const ISO = '2026-05-08T00:00:00.000Z';

async function withTmp(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pensmith-mig-'));
  try {
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test('forward-incompat: throws when diskVersion > currentVersion', async () => {
  await withTmp(async (dir) => {
    const file = path.join(dir, 's.json');
    await seed(
      file,
      JSON.stringify({ $schemaVersion: 5, paperId: 'x', createdAt: ISO }),
    );

    let err: unknown;
    try {
      await loadAndMigrate({
        file,
        schema: StateSchema,
        schemaName: 'state',
        currentVersion: 1,
      });
    } catch (e) {
      err = e;
    }
    assert.ok(
      err instanceof ForwardIncompatError,
      `expected ForwardIncompatError; got ${String(err)}`,
    );
    assert.equal((err as ForwardIncompatError).diskVersion, 5);
    assert.equal((err as ForwardIncompatError).codeVersion, 1);
    // Error message is human-readable and mentions the upgrade path.
    assert.match((err as Error).message, /refusing to load state v5/);
  });
});

test('missing $schemaVersion is treated as v1', async () => {
  await withTmp(async (dir) => {
    const file = path.join(dir, 's.json');
    // Permissive schema that does NOT require $schemaVersion — proves the
    // readVersion() default-to-1 branch fires when the field is absent.
    const PermissiveSchema = z
      .object({ paperId: z.string(), createdAt: z.string() })
      .passthrough();
    await seed(
      file,
      JSON.stringify({ paperId: 'x', createdAt: ISO }),
    );
    const out = await loadAndMigrate({
      file,
      schema: PermissiveSchema,
      schemaName: 'state',
      currentVersion: 1,
    });
    assert.equal((out as { paperId: string }).paperId, 'x');
  });
});

test('v1 -> v2 migration runs and writes back when writeBack:true', async () => {
  await withTmp(async (dir) => {
    const file = path.join(dir, 's.json');
    await seed(
      file,
      JSON.stringify({ $schemaVersion: 1, paperId: 'x', createdAt: ISO }),
    );
    const V2Schema = z.object({
      $schemaVersion: z.literal(2),
      paperId: z.string(),
      createdAt: z.string(),
    });
    const out = await loadAndMigrate({
      file,
      schema: V2Schema,
      schemaName: 'state',
      currentVersion: 2,
      migrations: { 1: v1_to_v2 },
      writeBack: true,
    });
    assert.equal(out.$schemaVersion, 2);
    // Disk now reflects the migrated value (atomic-write through W2).
    const onDisk = JSON.parse(await fsp.readFile(file, 'utf8')) as {
      $schemaVersion: number;
    };
    assert.equal(onDisk.$schemaVersion, 2);
  });
});

test('writeBack omitted (default false) leaves disk untouched after migration', async () => {
  await withTmp(async (dir) => {
    const file = path.join(dir, 's.json');
    await seed(
      file,
      JSON.stringify({ $schemaVersion: 1, paperId: 'x', createdAt: ISO }),
    );
    const V2Schema = z.object({
      $schemaVersion: z.literal(2),
      paperId: z.string(),
      createdAt: z.string(),
    });
    await loadAndMigrate({
      file,
      schema: V2Schema,
      schemaName: 'state',
      currentVersion: 2,
      migrations: { 1: v1_to_v2 },
      // writeBack omitted -> default false
    });
    const onDisk = JSON.parse(await fsp.readFile(file, 'utf8')) as {
      $schemaVersion: number;
    };
    assert.equal(
      onDisk.$schemaVersion,
      1,
      'default writeBack:false must leave disk at v1',
    );
  });
});

test('writeBack:false leaves disk untouched after migration', async () => {
  await withTmp(async (dir) => {
    const file = path.join(dir, 's.json');
    await seed(
      file,
      JSON.stringify({ $schemaVersion: 1, paperId: 'x', createdAt: ISO }),
    );
    const V2Schema = z.object({
      $schemaVersion: z.literal(2),
      paperId: z.string(),
      createdAt: z.string(),
    });
    await loadAndMigrate({
      file,
      schema: V2Schema,
      schemaName: 'state',
      currentVersion: 2,
      migrations: { 1: v1_to_v2 },
      writeBack: false,
    });
    const onDisk = JSON.parse(await fsp.readFile(file, 'utf8')) as {
      $schemaVersion: number;
    };
    assert.equal(
      onDisk.$schemaVersion,
      1,
      'writeBack:false must leave disk at v1',
    );
  });
});

test('missing migration in chain throws', async () => {
  await withTmp(async (dir) => {
    const file = path.join(dir, 's.json');
    await seed(
      file,
      JSON.stringify({ $schemaVersion: 1, paperId: 'x', createdAt: ISO }),
    );
    await assert.rejects(
      loadAndMigrate({
        file,
        schema: StateSchema,
        schemaName: 'state',
        currentVersion: 3,
        // no migrations registered
      }),
      /missing migration state v1 -> v2/,
    );
  });
});

test('invalid JSON throws (caller-handled SyntaxError)', async () => {
  await withTmp(async (dir) => {
    const file = path.join(dir, 's.json');
    await seed(file, '{not json');
    await assert.rejects(
      loadAndMigrate({
        file,
        schema: StateSchema,
        schemaName: 'state',
        currentVersion: 1,
      }),
    );
  });
});

test('BLOCKER-02: concurrent loadAndMigrate(writeBack:true) wrapped in withLock — disk is consistent post-migration, no torn writes', async () => {
  // This test models the exact contract that state.ts/library.ts/runtime.ts
  // honor after BLOCKER-02 — every loadAndMigrate call with writeBack:true
  // is wrapped in withLock at the call site. We replay that wrap here against
  // the v1->v2 sample migration fixture to prove the lock serializes
  // concurrent writers and the on-disk file ends in a single consistent
  // v2 state (never torn, never half-migrated, never racing tmp+rename
  // pairs against each other).
  await withTmp(async (dir) => {
    const file = path.join(dir, 's.json');
    await seed(
      file,
      JSON.stringify({ $schemaVersion: 1, paperId: 'race-target', createdAt: ISO }),
    );
    const V2Schema = z.object({
      $schemaVersion: z.literal(2),
      paperId: z.string(),
      createdAt: z.string(),
    });

    // Import withLock to wrap loadAndMigrate the same way state.ts /
    // library.ts / runtime.ts do post-fix.
    const { withLock } = await import('../bin/lib/lock.js');

    // Fire 5 concurrent locked load+migrate+writeBack calls. With the lock
    // in place every caller serializes; without the lock (the pre-fix bug)
    // tmp+rename pairs could interleave and produce torn writes.
    const N = 5;
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        withLock(file, async () =>
          loadAndMigrate({
            file,
            schema: V2Schema,
            schemaName: 'state',
            currentVersion: 2,
            migrations: { 1: v1_to_v2 },
            writeBack: true,
          }),
        ),
      ),
    );

    // Every caller must observe the migrated $schemaVersion = 2 with the
    // original paperId intact. No half-merged shapes.
    for (const r of results) {
      assert.equal((r as { $schemaVersion: number }).$schemaVersion, 2);
      assert.equal((r as { paperId: string }).paperId, 'race-target');
    }

    // Disk reflects the migrated value — and the file is parseable as a
    // single valid v2 envelope (no torn JSON).
    const onDiskRaw = await fsp.readFile(file, 'utf8');
    const onDisk = JSON.parse(onDiskRaw) as {
      $schemaVersion: number;
      paperId: string;
      createdAt: string;
    };
    assert.equal(onDisk.$schemaVersion, 2, 'on-disk schemaVersion must be 2 post-migration');
    assert.equal(onDisk.paperId, 'race-target', 'paperId must survive the race');
    assert.equal(onDisk.createdAt, ISO, 'createdAt must survive the race');
  });
});

test('schema validation failure throws SchemaValidationError with rich issues', async () => {
  await withTmp(async (dir) => {
    const file = path.join(dir, 's.json');
    // Bad: empty paperId AND non-iso createdAt — both fail StateSchema.
    // Seed at CURRENT_STATE_VERSION so loadAndMigrate skips migration (none
    // is passed here) and goes straight to zod validation — the path this
    // test exercises. A v1 seed would instead trip the "missing migration"
    // guard before validation ever runs (state is at v2 since 03-03).
    await seed(
      file,
      JSON.stringify({
        $schemaVersion: CURRENT_STATE_VERSION,
        paperId: '',
        createdAt: 'not-a-date',
      }),
    );
    let err: unknown;
    try {
      await loadAndMigrate({
        file,
        schema: StateSchema,
        schemaName: 'state',
        currentVersion: CURRENT_STATE_VERSION,
      });
    } catch (e) {
      err = e;
    }
    assert.ok(
      err instanceof SchemaValidationError,
      `expected SchemaValidationError; got ${String(err)}`,
    );
    assert.ok(
      (err as SchemaValidationError).zodIssue.length >= 1,
      'zodIssue array must be populated',
    );
  });
});
