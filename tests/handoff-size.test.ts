// tests/handoff-size.test.ts — Wave 0 stub for D-17 / ARCH-04.
// Asserts HANDOFF.json size < 5120 bytes after pre-compact hook runs against fixture .paper/.
//
// Production code required: hooks/pre-compact.ts (body) — lands Wave 4.
// Until then: existence assertion fires RED; behavioral tests skip gracefully.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const preCompactPath = new URL('../hooks/pre-compact.ts', import.meta.url);

test('handoff-size: hooks/pre-compact.ts production module exists (D-17, ARCH-04)', () => {
  assert.ok(
    existsSync(preCompactPath),
    'MISSING: hooks/pre-compact.ts body — Wave 4 must implement PreCompact hook that writes HANDOFF.json',
  );
});

test('handoff-size: HANDOFF.json size < 5120 bytes after pre-compact hook runs (D-17, ARCH-04)',
  { skip: !existsSync(preCompactPath) },
  async () => {
    // Write minimal fixture state, invoke pre-compact hook entrypoint,
    // then assert statSync(HANDOFF.json).size < 5120.
    const tmp = join(tmpdir(), `pensmith-handoff-size-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });

    // Minimal fixture .paper/STATE.json so the hook has something to read.
    const paperDir = join(tmp, '.paper');
    mkdirSync(paperDir, { recursive: true });
    writeFileSync(join(paperDir, 'STATE.json'), JSON.stringify({
      schema_version: 2,
      name: 'test-paper',
      sections: [],
    }));

    // Dynamically import and call the pre-compact hook.
    const { onPreCompact } = await import('../hooks/pre-compact.js');
    await onPreCompact({ paperDir });

    const handoffPath = join(paperDir, 'HANDOFF.json');
    assert.ok(existsSync(handoffPath), 'HANDOFF.json must exist after pre-compact hook');
    const size = statSync(handoffPath).size;
    assert.ok(
      size < 5120,
      `HANDOFF.json size ${size} bytes exceeds 5120-byte budget (D-17 / ARCH-04)`,
    );
  },
);
