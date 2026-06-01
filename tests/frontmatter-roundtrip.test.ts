// tests/frontmatter-roundtrip.test.ts — round-trip safety for bin/lib/frontmatter.ts.
//
// Phase 3 Plan 03-03 Task 3.4 (CYCLE-2 H-1 + CYCLE-1 MEDIUM convergence).
//
// Asserts:
//   1. parseFrontmatter on a no-frontmatter document returns {} + raw body.
//   2. updateFrontmatter preserves a YAML comment adjacent to a key on add.
//   3. `delete fm.key` actually deletes the key (the load-bearing CYCLE-1
//      MEDIUM fix — the naïve Object.entries→doc.set pattern was broken).
//   4. updateFrontmatter preserves a comment across deletion of a sibling.
//   5. parseFrontmatter + serializeFrontmatter preserves key order.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontmatter,
  serializeFrontmatter,
  updateFrontmatter,
} from '../bin/lib/frontmatter.js';

test('parseFrontmatter handles missing frontmatter', () => {
  const { frontmatter, body } = parseFrontmatter('just body, no fm');
  assert.deepEqual(frontmatter, {});
  assert.equal(body, 'just body, no fm');
});

test('updateFrontmatter preserves comment preceding a key (D-08 round-trip)', () => {
  const input = '---\n# my comment\nkey: value\n---\nbody';
  const out = updateFrontmatter(input, (fm) => {
    fm.added = 1;
  });
  assert.match(out, /# my comment/);
  assert.match(out, /added: 1/);
});

test('updateFrontmatter deletes keys via delete operator (CYCLE-1 MEDIUM fix)', () => {
  const input = '---\nfoo: 1\nbar: 2\n---\nbody';
  const out = updateFrontmatter(input, (fm) => {
    delete fm.foo;
  });
  assert.doesNotMatch(out, /foo:/);
  assert.match(out, /bar: 2/);
});

test('updateFrontmatter preserves comment across deletion of a sibling', () => {
  const input = '---\n# preserved\nfoo: 1\nbar: 2\n---\nbody';
  const out = updateFrontmatter(input, (fm) => {
    delete fm.bar;
  });
  assert.match(out, /# preserved/);
  assert.match(out, /foo: 1/);
  assert.doesNotMatch(out, /bar:/);
});

test('parseFrontmatter + serializeFrontmatter preserves key order', () => {
  const input = '---\nz: 1\na: 2\nm: 3\n---\nbody';
  const { frontmatter } = parseFrontmatter(input);
  const ser = serializeFrontmatter(frontmatter);
  assert.match(ser, /---\nz: 1\na: 2\nm: 3\n---/);
});
