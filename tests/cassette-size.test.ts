// tests/cassette-size.test.ts — Wave 0 stub for D-25.
// Asserts every cassette under tests/fixtures/cassettes/<adapter>/*.json is ≤ 51200 bytes.
//
// The cassettes/ directory is created with a .gitkeep in Task 0.3; adapter cassettes
// land in Wave 3 (Plan 04). The size test passes vacuously on an empty directory.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

// A binary body (a PDF) is kept beside its cassette as a file, not as JSON.
// It gets a budget of its own: big enough for a short real paper, small
// enough that the fixtures stay small.
const MAX_BINARY_BYTES = 102400; // 100 KB

test('cassette-size: every binary cassette body is <= 100 KB and named by a cassette', () => {
  const bodies: string[] = [];
  const named = new Set<string>();
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.json')) {
        for (const c of JSON.parse(readFileSync(full, 'utf8')) as Array<{ responseFile?: string }>) {
          if (c.responseFile) named.add(join(dir, c.responseFile));
        }
      } else if (!e.name.endsWith('.md') && e.name !== '.gitkeep') bodies.push(full);
    }
  };
  walk(CASSETTE_ROOT);
  for (const b of bodies) {
    assert.ok(statSync(b).size <= MAX_BINARY_BYTES, `${b} is ${statSync(b).size} bytes, over the ${MAX_BINARY_BYTES}-byte budget`);
    assert.ok(named.has(b), `${b} is not the responseFile of any cassette`);
  }
});
