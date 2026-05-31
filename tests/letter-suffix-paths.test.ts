// tests/letter-suffix-paths.test.ts — RED spec for D-15 letter-suffix path tolerance.
// ARCH-20: parseSectionDirName + optional letterSuffix on sectionDir.

import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionDir, parseSectionDirName } from '../bin/lib/paths.js';

// ---------- parseSectionDirName ----------

test('parseSectionDirName: "03b-validity-threats" → {n:3, letterSuffix:"b", slug:"validity-threats"}', () => {
  const result = parseSectionDirName('03b-validity-threats');
  assert.ok(result !== null, 'Expected a parsed result, got null');
  assert.equal(result!.n, 3);
  assert.equal(result!.letterSuffix, 'b');
  assert.equal(result!.slug, 'validity-threats');
});

test('parseSectionDirName: "03-intro" → {n:3, letterSuffix:undefined, slug:"intro"}', () => {
  const result = parseSectionDirName('03-intro');
  assert.ok(result !== null, 'Expected a parsed result, got null');
  assert.equal(result!.n, 3);
  assert.equal(result!.letterSuffix, undefined);
  assert.equal(result!.slug, 'intro');
});

test('parseSectionDirName: rejects ".." (path traversal)', () => {
  const result = parseSectionDirName('..');
  assert.equal(result, null, 'Expected null for ".." traversal');
});

test('parseSectionDirName: rejects absolute path (starts with slash)', () => {
  const result = parseSectionDirName('/etc/passwd');
  assert.equal(result, null, 'Expected null for absolute path');
});

test('parseSectionDirName: rejects path with null byte', () => {
  const result = parseSectionDirName('03-intro\0evil');
  assert.equal(result, null, 'Expected null for null-byte input');
});

test('parseSectionDirName: rejects backslash (Windows path traversal)', () => {
  const result = parseSectionDirName('03-intro\\evil');
  assert.equal(result, null, 'Expected null for backslash in dirname');
});

// ---------- Lexicographic ordering (D-15) ----------

test('lexicographic order: "03" < "03b" < "04" (letter-suffix insertion invariant)', () => {
  const dirs = ['04-discussion', '03b-validity-threats', '03-intro'];
  const sorted = [...dirs].sort();
  assert.deepEqual(sorted, [
    '03-intro',
    '03b-validity-threats',
    '04-discussion',
  ], 'Letter-suffix must sort between plain NN and NN+1 under string compare');
});

// ---------- sectionDir with optional letterSuffix (D-15) ----------

test('sectionDir(3, "foo", {letterSuffix:"b"}) ends with "03b-foo"', () => {
  const result = sectionDir(3, 'foo', '/tmp/p', { letterSuffix: 'b' });
  assert.ok(
    result.endsWith('03b-foo'),
    `Expected result ending in "03b-foo", got: ${result}`,
  );
});

test('sectionDir(3, "foo") unchanged (existing 3-arg callers unaffected)', () => {
  const result = sectionDir(3, 'foo', '/tmp/p');
  assert.ok(
    result.endsWith('03-foo'),
    `Expected result ending in "03-foo" (no letterSuffix), got: ${result}`,
  );
});

test('sectionDir with letterSuffix "a" produces "01a-methods"', () => {
  const result = sectionDir(1, 'methods', '/tmp/p', { letterSuffix: 'a' });
  assert.ok(result.endsWith('01a-methods'), `Got: ${result}`);
});

test('sectionDir: existing 3-arg call with root arg still works', () => {
  // Regression: root as 3rd arg must still work (previously positional)
  const result = sectionDir(2, 'results', '/tmp/q');
  assert.ok(result.endsWith('02-results'), `Got: ${result}`);
});
