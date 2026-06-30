// tests/state-migration-fixes.test.ts — audit #27/#28 regression.
//
// #27: the v1→v2 migration wrote the version on whichever field the input used
//      (snake `schema_version` or none), but the loader + StateSchema require the
//      canonical `$schemaVersion`. So a snake-cased / pre-versioning v1 migrated
//      to a snake-only output that StateSchema.parse rejected — permanently
//      unloadable.
// #28: a section slug was synthesized only when MISSING, so a present-but-invalid
//      slug (uppercase/space/punctuation) survived and failed v2's strict
//      /^[a-z0-9-]+$/ — a valid v1 state failed v2 validation.

import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateState } from '../bin/lib/state.js';
import { Schema as StateSchema } from '../bin/lib/schemas/state.js';

test('audit #27/#28: a snake v1 with an invalid slug migrates to a SCHEMA-VALID v2', async () => {
  const v1 = {
    schema_version: 1, // snake-cased envelope (no $schemaVersion)
    paperId: '11111111-1111-1111-1111-111111111111',
    createdAt: '2026-01-01T00:00:00.000Z',
    sections: [
      // Present-but-invalid slug (uppercase + space + punctuation).
      { n: 1, slug: 'Intro Section!', state: 'planned', status: 'planned', lastVerification: null },
    ],
  };

  const migrated = (await migrateState(v1)) as Record<string, unknown> & {
    sections: Array<{ slug: string }>;
  };

  // #27: the canonical envelope is present (the snake field is preserved too).
  assert.equal(migrated['$schemaVersion'], 2, 'migrated state must carry $schemaVersion: 2');
  assert.equal(migrated['schema_version'], 2, 'the original snake naming is still preserved');

  // #28: the invalid slug is normalized to the v2 contract.
  assert.match(migrated.sections[0]!.slug, /^[a-z0-9-]+$/, 'slug must match the v2 contract');
  assert.equal(migrated.sections[0]!.slug, 'intro-section');

  // The crux of #27: the migrated state now PASSES StateSchema (it was rejected
  // before — missing $schemaVersion and/or an invalid slug).
  assert.doesNotThrow(() => StateSchema.parse(migrated), 'migrated v2 must validate against StateSchema');
});

test('audit #28: a conforming slug is left unchanged; a missing slug falls back to section-<n>', async () => {
  const v1 = {
    $schemaVersion: 1,
    paperId: '22222222-2222-2222-2222-222222222222',
    createdAt: '2026-01-01T00:00:00.000Z',
    sections: [
      { n: 1, slug: '01-introduction', state: 'planned' },
      { n: 2, state: 'planned' }, // missing slug
    ],
  };
  const migrated = (await migrateState(v1)) as Record<string, unknown> & {
    sections: Array<{ n: number; slug: string }>;
  };
  assert.equal(migrated.sections[0]!.slug, '01-introduction', 'a valid slug is unchanged');
  assert.equal(migrated.sections[1]!.slug, 'section-2', 'a missing slug falls back to section-<n>');
  assert.doesNotThrow(() => StateSchema.parse(migrated));
});
