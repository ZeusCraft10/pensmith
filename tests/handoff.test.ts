// tests/handoff.test.ts — Wave 0 stub for D-17 / D-18.
// Tests: PreCompact hook writes HANDOFF.json that validates against zod schema.
//
// Production code required: bin/lib/handoff.ts + hooks/pre-compact.ts (body)
// Until then: existence assertions fire RED; behavioral tests skip gracefully.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const handoffPath = new URL('../bin/lib/handoff.ts', import.meta.url);
const preCompactPath = new URL('../hooks/pre-compact.ts', import.meta.url);

test('handoff: bin/lib/handoff.ts production module exists (D-17, D-18)', () => {
  assert.ok(
    existsSync(handoffPath),
    'MISSING: bin/lib/handoff.ts — Wave 4 must create before handoff schema validation can run (D-17/D-18)',
  );
});

test('handoff: hooks/pre-compact.ts has body (not just stub) (D-17)',
  { skip: !existsSync(handoffPath) },
  () => {
    assert.ok(
      existsSync(preCompactPath),
      'MISSING: hooks/pre-compact.ts — Wave 4 must implement the hook body (D-17)',
    );
  },
);

const skip = !existsSync(handoffPath) || !existsSync(preCompactPath);

test('handoff: PreCompact hook writes HANDOFF.json that validates against HandoffSchema (D-17, D-18)',
  { skip },
  async () => {
    const { HandoffSchema } = await import('../bin/lib/handoff.js');
    const { onPreCompact } = await import('../hooks/pre-compact.js');

    // Minimal fixture .paper/ with STATE.json so the hook has context.
    const tmp = join(tmpdir(), `pensmith-handoff-${Date.now()}`);
    const paperDir = join(tmp, '.paper');
    mkdirSync(paperDir, { recursive: true });
    writeFileSync(join(paperDir, 'STATE.json'), JSON.stringify({
      schema_version: 2,
      name: 'test-paper',
      slug: 'test-paper',
      sections: [
        { n: 1, slug: '01-introduction' },
        { n: 2, slug: '02-background' },
      ],
    }));

    // Run the pre-compact hook.
    await onPreCompact({ paperDir });

    const handoffFilePath = join(paperDir, 'HANDOFF.json');
    assert.ok(existsSync(handoffFilePath), 'HANDOFF.json must be written by pre-compact hook');

    // Validate against HandoffSchema.
    const { readFileSync } = await import('node:fs');
    const raw = JSON.parse(readFileSync(handoffFilePath, 'utf-8'));
    const parsed = HandoffSchema.safeParse(raw);
    assert.ok(
      parsed.success,
      `HANDOFF.json must conform to HandoffSchema (D-17): ${JSON.stringify(parsed.error?.errors, null, 2)}`,
    );
  },
);

test('handoff: HandoffSchema requires schema_version=1, phase enum, next_action, bounded breadcrumbs (D-17)',
  { skip: !existsSync(handoffPath) },
  async () => {
    const { HandoffSchema } = await import('../bin/lib/handoff.js');

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
      breadcrumbs: Array.from({ length: 6 }, (_, i) => ({
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
