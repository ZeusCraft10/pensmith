// tests/deep-equal.test.ts — coverage for bin/lib/deep-equal.ts (Plan 03-03 Task 3.5).

import test from 'node:test';
import assert from 'node:assert/strict';
import { deepEqual } from '../bin/lib/deep-equal.js';

test('deep-equal: primitives equal via ===', () => {
  assert.equal(deepEqual(1, 1), true);
  assert.equal(deepEqual('x', 'x'), true);
  assert.equal(deepEqual(true, true), true);
  assert.equal(deepEqual(null, null), true);
  assert.equal(deepEqual(undefined, undefined), true);
});

test('deep-equal: primitives unequal', () => {
  assert.equal(deepEqual(1, 2), false);
  assert.equal(deepEqual('x', 'y'), false);
  assert.equal(deepEqual(true, false), false);
  assert.equal(deepEqual(null, undefined), false);
  assert.equal(deepEqual(0, '0'), false);
});

test('deep-equal: NaN !== NaN (matches === semantics)', () => {
  assert.equal(deepEqual(NaN, NaN), false);
});

test('deep-equal: arrays element-wise', () => {
  assert.equal(deepEqual([1, 2, 3], [1, 2, 3]), true);
  assert.equal(deepEqual([1, 2, 3], [1, 2, 4]), false);
  assert.equal(deepEqual([1, 2], [1, 2, 3]), false);
  assert.equal(deepEqual([], []), true);
});

test('deep-equal: array vs non-array type mismatch', () => {
  assert.equal(deepEqual([1, 2], { 0: 1, 1: 2, length: 2 }), false);
});

test('deep-equal: nested object structural equality', () => {
  const a = { x: 1, y: { z: [1, 2, { q: 'deep' }] } };
  const b = { x: 1, y: { z: [1, 2, { q: 'deep' }] } };
  assert.equal(deepEqual(a, b), true);
  const c = { x: 1, y: { z: [1, 2, { q: 'other' }] } };
  assert.equal(deepEqual(a, c), false);
});

test('deep-equal: key-set mismatch', () => {
  assert.equal(deepEqual({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(deepEqual({ a: 1, b: 2 }, { a: 1 }), false);
});

test('deep-equal: Date by getTime', () => {
  const t = Date.now();
  assert.equal(deepEqual(new Date(t), new Date(t)), true);
  assert.equal(deepEqual(new Date(t), new Date(t + 1)), false);
});
