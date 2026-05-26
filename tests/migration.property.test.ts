// tests/migration.property.test.ts — Wave 0 stub for D-09 property test.
// fast-check property: migrate preserves all non-dropped top-level fields.
//
// Production code required: bin/lib/state.ts migrateState()
// Until then: existence assertion fires RED; property test skips gracefully.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as fc from 'fast-check';

const statePath = new URL('../bin/lib/state.ts', import.meta.url);

// Fields that the v1→v2 migration DROPS from section entries (D-09).
const DROPPED_SECTION_FIELDS = new Set(['state', 'status', 'lastVerification']);

test('migration.property: bin/lib/state.ts production module exists (D-09 property gate)', () => {
  assert.ok(
    existsSync(statePath),
    'MISSING: bin/lib/state.ts — exists but must export migrateState() to pass property tests (Wave 2 wakes writeBack branch)',
  );
});

// Check if migrateState is actually exported (same pattern as migration.test.ts).
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

test('migration.property: migrate preserves all non-dropped top-level STATE fields (D-09)',
  { skip: !migrateStateAvailable },
  async () => {
    // @ts-expect-error — migrateState lands in Wave 2 (D-09 writeBack branch)
    const { migrateState } = await import('../bin/lib/state.js');

    // fast-check: forall v1 state objects with arbitrary extra top-level fields,
    // migrate(v1) preserves every top-level field that is NOT in the dropped-section-fields list.
    const extraFieldArb = fc.record({
      extraString: fc.string(),
      extraNumber: fc.integer(),
    });

    await fc.assert(
      fc.asyncProperty(extraFieldArb, async ({ extraString, extraNumber }) => {
        const v1 = {
          schema_version: 1,
          name: 'prop-test',
          slug: 'prop-test',
          customField1: extraString,
          customField2: extraNumber,
          sections: [
            {
              n: 1,
              slug: '01-intro',
              state: 'planned',
              status: 'planned',
              lastVerification: null,
            },
          ],
        };

        const migrated = await migrateState(v1);

        // Top-level fields (other than schema_version and sections) must be preserved.
        assert.equal(
          (migrated as Record<string, unknown>)['customField1'],
          extraString,
          'migrate must preserve top-level customField1',
        );
        assert.equal(
          (migrated as Record<string, unknown>)['customField2'],
          extraNumber,
          'migrate must preserve top-level customField2',
        );

        // Section entries must NOT have the dropped fields.
        for (const section of migrated.sections) {
          const s = section as Record<string, unknown>;
          for (const dropped of DROPPED_SECTION_FIELDS) {
            assert.ok(
              !(dropped in s),
              `migrate must drop "${dropped}" from section entries (D-09)`,
            );
          }
        }
      }),
      { numRuns: 50 },
    );
  },
);
