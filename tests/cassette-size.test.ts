// tests/cassette-size.test.ts — Wave 0 stub for D-25.
// Asserts every cassette under tests/fixtures/cassettes/<adapter>/*.json is ≤ 51200 bytes.
//
// The cassettes/ directory is created with a .gitkeep in Task 0.3; adapter cassettes
// land in Wave 3 (Plan 04). The size test passes vacuously on an empty directory.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CASSETTE_ROOT = fileURLToPath(new URL('../tests/fixtures/cassettes', import.meta.url));
const MAX_CASSETTE_BYTES = 51200; // 50KB per D-25

test('cassette-size: tests/fixtures/cassettes/ directory exists (D-25)', () => {
  assert.ok(
    existsSync(CASSETTE_ROOT),
    'MISSING: tests/fixtures/cassettes/ — Task 0.3 must create .gitkeep to commit the directory',
  );
});

test('cassette-size: every adapter cassette JSON is ≤ 51200 bytes (D-25)', () => {
  if (!existsSync(CASSETTE_ROOT)) {
    // Vacuously pass if directory not yet created — the existence test above handles the failure.
    return;
  }

  // Walk recursively through cassettes/
  function walkDir(dir: string): string[] {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walkDir(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const cassettes = walkDir(CASSETTE_ROOT);
  // Passes vacuously when no cassettes exist yet (Wave 3 lands them).
  for (const cassette of cassettes) {
    const size = statSync(cassette).size;
    assert.ok(
      size <= MAX_CASSETTE_BYTES,
      `Cassette exceeds ${MAX_CASSETTE_BYTES}-byte budget (D-25): ${cassette} is ${size} bytes`,
    );
  }
});
