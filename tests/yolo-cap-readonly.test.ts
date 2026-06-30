// tests/yolo-cap-readonly.test.ts — audit #24 regression.
//
// The --yolo cost-cap pre-flight used to run for ANY verb whenever --yolo was
// present, hard-refusing (exit 1) when the project estimate exceeded 50% of the
// cap. That wrongly blocked read-only verbs (status/list/doctor/open) and the
// --estimate preview, which incur no model/network cost. shouldRunYoloCapPreflight
// now scopes the pre-flight to cost-incurring execution only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRunYoloCapPreflight } from '../bin/pensmith.js';

test('audit #24: read-only verbs with --yolo skip the cap pre-flight', () => {
  for (const v of ['status', 'list', 'doctor', 'open']) {
    assert.equal(shouldRunYoloCapPreflight([v, '--yolo']), false, `${v} --yolo must skip the cap`);
  }
});

test('audit #24: --estimate --yolo skips the cap pre-flight (preview, no execution)', () => {
  assert.equal(shouldRunYoloCapPreflight(['--estimate', '--yolo']), false);
  assert.equal(shouldRunYoloCapPreflight(['research', '--yolo', '--estimate']), false);
});

test('audit #24: --version/--help meta with --yolo skip the cap pre-flight', () => {
  assert.equal(shouldRunYoloCapPreflight(['--version', '--yolo']), false);
  assert.equal(shouldRunYoloCapPreflight(['--help', '--yolo']), false);
});

test('audit #24: cost-incurring verbs with --yolo STILL run the cap pre-flight', () => {
  for (const v of ['write', 'plan', 'verify', 'research', 'compile', 'done']) {
    assert.equal(shouldRunYoloCapPreflight([v, '2', '--yolo']), true, `${v} --yolo must run the cap`);
  }
});

test('audit #24: a bare --yolo invocation (runs the pipeline) STILL runs the cap pre-flight', () => {
  assert.equal(shouldRunYoloCapPreflight(['--yolo']), true);
});

test('audit #24: without --yolo the cap pre-flight never runs', () => {
  assert.equal(shouldRunYoloCapPreflight(['write', '2']), false);
  assert.equal(shouldRunYoloCapPreflight(['status']), false);
});
