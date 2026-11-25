// tests/handoff.test.ts — HandoffSchema contract.
//
// `pensmith resume` still reads a .paper/HANDOFF.json when one exists, so the
// schema it validates against stays pinned here. No hook writes the file any
// more: the SessionStart hook derives its context from the router instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandoffSchema } from '../bin/lib/schemas/handoff.js';

test('handoff: HandoffSchema requires schema_version=1, phase enum, next_action, bounded breadcrumbs (D-17)',
  () => {

    // Valid minimal payload
    const valid = {
      schema_version: 1,
      last_updated: '2026-01-01T00:00:00Z',
      current_section: null,
      phase: 'intake',
      next_action: 'Run `pensmith research` to begin research phase',
      breadcrumbs: [],
      section_pointers: [],
    };
    const result = HandoffSchema.safeParse(valid);
    assert.ok(result.success, `HandoffSchema must accept valid minimal payload: ${JSON.stringify(result.error?.errors)}`);

    // breadcrumbs must be bounded at max 5
    const tooManyBreadcrumbs = {
      ...valid,
      breadcrumbs: Array.from({ length: 6 }, () => ({
        ts: '2026-01-01T00:00:00Z',
        verb: 'intake',
        section: null,
        ok: true,
      })),
    };
    const tooMany = HandoffSchema.safeParse(tooManyBreadcrumbs);
    assert.ok(!tooMany.success, 'HandoffSchema must reject breadcrumbs array with > 5 elements (D-17 5KB budget)');
  },
);
