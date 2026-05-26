// tests/section-isolation.test.ts — Wave 0 stub for TEST-09 / SC-4 / T-3-08.
// Asserts that re-doing section N leaves all other sections' mtimes unchanged.
//
// Production code required: bin/cli/plan.ts (--revise flag) — lands Wave 4.
// Until then: existence assertion fires RED; behavioral tests skip gracefully.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const planCliPath = new URL('../bin/cli/plan.ts', import.meta.url);

test('section-isolation: bin/cli/plan.ts production module exists (TEST-09, SC-4)', () => {
  assert.ok(
    existsSync(planCliPath),
    'MISSING: bin/cli/plan.ts — Wave 4 must create before this test passes (TEST-09 mtime invariant)',
  );
});

test('section-isolation: slug regex ^[a-z0-9-]+$ is enforced by path helper (T-3-12, ARCH-02)',
  { skip: !existsSync(planCliPath) },
  async () => {
    // The path helper (bin/lib/paths.ts) must reject slugs that don't match
    // ^[a-z0-9-]+$ to prevent path traversal (T-3-12).
    // This test wakes up when bin/cli/plan.ts exists (which depends on bin/lib/paths.ts
    // already having the sectionDir() helper from Wave 2).
    const { sectionDir } = await import('../bin/lib/paths.js');
    // sectionDir signature: (n: number, slug: string, root?: string)
    assert.throws(
      () => sectionDir(1, '../etc/passwd'),
      /invalid.*slug|slug.*invalid|^[a-z0-9-]/i,
      'sectionDir must throw on path-traversal slug',
    );
    assert.throws(
      () => sectionDir(1, 'UPPERCASE'),
      /invalid.*slug|slug.*invalid|^[a-z0-9-]/i,
      'sectionDir must throw on uppercase slug',
    );
    // Valid slug must not throw:
    assert.doesNotThrow(() => sectionDir(1, '01-introduction'), 'valid slug must not throw');
  },
);

test('section-isolation: re-doing section N leaves all other sections mtimes unchanged (TEST-09)',
  { skip: !existsSync(planCliPath) },
  async () => {
    // Full behavioral test:
    // Spawn `pensmith plan 3 --revise` against a fixture .paper/ with sections 01/02/03/04/05,
    // snapshot mtimes of sections 01/02/04/05 before+after, assert all equal.
    // Implementation note: this test intentionally deferred to Wave 4 when plan.ts lands.
    // The skip guard ensures Wave 0 CI sees this as a skip, not a failure.
    assert.fail(
      'section-isolation behavioral test not yet implemented — Plan 04 must wire the revise flow (TEST-09)',
    );
  },
);
