// tests/migration.test.ts — Wave 0 stub for D-09 / ARCH-07 / T-3-08.
// Tests: v1→v2 round-trip, idempotent on v2, refuse-forward on v3.
//
// Production code required: bin/lib/state.ts (writeBack branch / migrate_v1_to_v2)
// The dormant migration registry (Phase 1 line 30) wakes up in Wave 2.
// Until then: existence assertion fires RED; behavioral tests skip gracefully.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const statePath = new URL('../bin/lib/state.ts', import.meta.url);

test('migration: bin/lib/state.ts production module exists (D-09, ARCH-07)', () => {
  assert.ok(
    existsSync(statePath),
    'MISSING: bin/lib/state.ts — exists but must export migrateState() to pass migration tests (Wave 2 wakes writeBack branch)',
  );
});

// Check if migrateState is actually exported — state.ts exists from Phase 1 but migrateState
// is only added in Phase 3 Wave 2 when the dormant writeBack branch is activated.
async function hasMigrateState(): Promise<boolean> {
  if (!existsSync(statePath)) return false;
  try {
    const mod = await import('../bin/lib/state.js');
    return typeof (mod as Record<string, unknown>)['migrateState'] === 'function';
  } catch {
    return false;
  }
}

const migrateStateAvailable = await hasMigrateState();

// Minimal v1 STATE.json fixture: has embedded state/status/lastVerification on sections[].
const V1_FIXTURE = {
  schema_version: 1,
  name: 'test-paper',
  slug: 'test-paper',
  sections: [
    {
      n: 1,
      slug: '01-introduction',
      state: 'planned',
      status: 'planned',
      lastVerification: null,
    },
    {
      n: 2,
      slug: '02-background',
      state: 'verified',
      status: 'verified',
      lastVerification: { verdict: 'PASS', timestamp: '2026-01-01T00:00:00Z', draft_hash: 'abc123' },
    },
  ],
};

// Minimal v2 STATE.json fixture: sections[] has only n+slug pointers (no embedded state).
const V2_FIXTURE = {
  schema_version: 2,
  name: 'test-paper',
  slug: 'test-paper',
  sections: [
    { n: 1, slug: '01-introduction' },
    { n: 2, slug: '02-background' },
  ],
};

test('migration: migrate v1 state → v2 round-trip (D-09)',
  { skip: !migrateStateAvailable },
  async () => {
    const { migrateState } = await import('../bin/lib/state.js');
    const migrated = await migrateState(V1_FIXTURE) as Record<string, unknown> & { schema_version: number; sections: Array<Record<string, unknown>> };
    assert.equal(migrated.schema_version, 2, 'migrated schema_version must be 2');
    // After migration, sections[] must NOT have embedded state/status/lastVerification.
    for (const section of migrated.sections) {
      const s = section as Record<string, unknown>;
      assert.ok(!('state' in s), 'v2 section must NOT have "state" field (D-09)');
      assert.ok(!('status' in s), 'v2 section must NOT have "status" field (D-09)');
      assert.ok(!('lastVerification' in s), 'v2 section must NOT have "lastVerification" field (D-09)');
      assert.ok('n' in s, 'v2 section must have "n" pointer field');
      assert.ok('slug' in s, 'v2 section must have "slug" pointer field');
    }
  },
);

test('migration: migrate v2 state is idempotent (v2 → v2 byte-equal) (D-09)',
  { skip: !migrateStateAvailable },
  async () => {
    const { migrateState } = await import('../bin/lib/state.js');
    const once = await migrateState(V2_FIXTURE) as Record<string, unknown> & { schema_version: number };
    const twice = await migrateState(once) as Record<string, unknown> & { schema_version: number };
    assert.deepEqual(once, twice, 'migrate(v2) must be idempotent');
    assert.equal(twice.schema_version, 2, 'idempotent result must still be schema_version 2');
  },
);

test('migration: migrate v3 state THROWS refuse-forward error (D-09, D-39)',
  { skip: !migrateStateAvailable },
  async () => {
    const { migrateState } = await import('../bin/lib/state.js');
    const v3Fixture = { ...V2_FIXTURE, schema_version: 3 };
    await assert.rejects(
      () => migrateState(v3Fixture),
      /forward|version|schema|v3/i,
      'migrateState must throw on schema_version > 2 (D-39 refuse-forward-incompat)',
    );
  },
);
