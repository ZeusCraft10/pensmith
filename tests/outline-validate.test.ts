// tests/outline-validate.test.ts — GRND-08 / D-18-15: every semantic outline
// rule, reported at once for the one corrective turn.

import test from 'node:test';
import assert from 'node:assert/strict';
import { outlineCorrection, validateOutline, formatOutlineIssues, type ValidatedOutlineSection } from '../bin/lib/outline-validate.js';
import { COUNTERARGUMENT_REQUIRED_MESSAGE } from '../bin/lib/counterargument.js';

const LIB = new Set(['a2020', 'b2019', 'c2018']);

function s(slug: string, extra: Partial<ValidatedOutlineSection> = {}): ValidatedOutlineSection {
  return { slug, depends_on: [], assigned_sources: ['a2020'], estimated_word_count: 500, role: 'body', ...extra };
}

const OK: ValidatedOutlineSection[] = [
  s('introduction', { role: 'intro' }),
  s('body', { depends_on: ['introduction'], assigned_sources: ['b2019', 'c2018'] }),
  s('conclusion', { role: 'conclusion', depends_on: ['body'], assigned_sources: [] }),
];

function codes(sections: ValidatedOutlineSection[], opts: { length?: number; counter?: boolean; lib?: Set<string> } = {}): string[] {
  return validateOutline({
    sections,
    libraryCitekeys: opts.lib ?? LIB,
    lengthTarget: opts.length ?? 1500,
    counterargumentRequired: opts.counter ?? false,
  }).map((i) => i.code);
}

test('GRND-08: a valid outline has no issues', () => {
  assert.deepEqual(codes(OK), []);
});

test('GRND-08: duplicate slugs, self-dependency and unknown depends_on are each reported', () => {
  assert.deepEqual(codes([...OK, s('body', { role: 'body' })], { length: 2000 }), ['duplicate-slug']);
  assert.deepEqual(codes([OK[0]!, s('body', { depends_on: ['body'] }), OK[2]!]), ['self-dependency']);
  assert.deepEqual(codes([OK[0]!, s('body', { depends_on: ['nowhere'] }), OK[2]!]), ['unknown-dependency']);
});

test('GRND-08: a dependency cycle is reported with its slugs', () => {
  const cyc = [s('a', { role: 'intro', depends_on: ['c'] }), s('b', { depends_on: ['a'] }), s('c', { role: 'conclusion', depends_on: ['b'] })];
  const issues = validateOutline({ sections: cyc, libraryCitekeys: LIB, lengthTarget: 1500, counterargumentRequired: false });
  assert.deepEqual(issues.map((i) => i.code), ['dependency-cycle']);
  assert.match(issues[0]!.message, /"a".*"b".*"c"/);
});

test('GRND-08: a citekey outside LIBRARY.json is named with the sections that use it', () => {
  const issues = validateOutline({
    sections: [OK[0]!, s('body', { assigned_sources: ['a2020', 'fake2099'] }), s('conclusion', { role: 'conclusion', assigned_sources: ['fake2099'] })],
    libraryCitekeys: LIB,
    lengthTarget: 1500,
    counterargumentRequired: false,
  });
  assert.deepEqual(issues.map((i) => i.code), ['unknown-citekey']);
  assert.match(issues[0]!.message, /citekey "fake2099" \(assigned to "body", "conclusion"\)/);
});

test('GRND-08: the word targets must sum to within ±20% of the length target', () => {
  assert.deepEqual(codes(OK, { length: 1250 }), [], '1500 is within 20% of 1250');
  assert.deepEqual(codes(OK, { length: 1875 }), [], '1500 is within 20% of 1875');
  assert.deepEqual(codes(OK, { length: 3000 }), ['word-budget'], 'off by 50%');
  assert.match(formatOutlineIssues(validateOutline({ sections: OK, libraryCitekeys: LIB, lengthTarget: 3000, counterargumentRequired: false })), /sum to 1500, but the paper's length target is 3000 words \(allowed 2400-3600\)/);
});

test('GRND-08: at most 2 non-intro/conclusion sections without a source (only when the library has sources)', () => {
  const bare = [s('introduction', { role: 'intro', assigned_sources: [] }), s('b1', { assigned_sources: [] }), s('b2', { assigned_sources: [] }), s('conclusion', { role: 'conclusion', assigned_sources: [] })];
  assert.deepEqual(codes(bare, { length: 2000 }), [], 'two bare body sections are allowed');
  const three = [...bare.slice(0, 3), s('b3', { assigned_sources: [] }), bare[3]!];
  assert.deepEqual(codes(three, { length: 2500 }), ['zero-source-sections']);
  assert.deepEqual(codes(three, { length: 2500, lib: new Set() }), [], 'an empty library cannot allocate sources');
});

test('GRND-10: the counterargument rule — counterargument + rebuttal, or one combined section', () => {
  assert.deepEqual(codes(OK, { counter: true }), ['counterargument-missing']);
  const end = s('conclusion', { role: 'conclusion', assigned_sources: [] });
  const withPair = [OK[0]!, s('counter', { role: 'counterargument' }), s('rebut', { role: 'rebuttal' }), end];
  assert.deepEqual(codes(withPair, { counter: true, length: 2000 }), []);
  const combined = [OK[0]!, s('both', { role: 'counterargument-rebuttal' }), end];
  assert.deepEqual(codes(combined, { counter: true }), []);
  const onlyCounter = [OK[0]!, s('counter', { role: 'counterargument' }), end];
  const issues = validateOutline({ sections: onlyCounter, libraryCitekeys: LIB, lengthTarget: 1500, counterargumentRequired: true });
  assert.equal(issues[0]!.message, COUNTERARGUMENT_REQUIRED_MESSAGE);
  assert.equal(COUNTERARGUMENT_REQUIRED_MESSAGE, 'counterargument + rebuttal section required (§7.4); use --no-counter to disable');
});

test('GRND-08: every issue is reported at once and quoted in the corrective turn', () => {
  const bad = [s('a', { role: 'intro', depends_on: ['a'], assigned_sources: ['nope'] }), s('a', { role: 'conclusion' })];
  const issues = validateOutline({ sections: bad, libraryCitekeys: LIB, lengthTarget: 5000, counterargumentRequired: true });
  assert.deepEqual(issues.map((i) => i.code).sort(), ['counterargument-missing', 'duplicate-slug', 'self-dependency', 'unknown-citekey', 'word-budget']);
  const correction = outlineCorrection(issues);
  for (const i of issues) assert.ok(correction.includes(i.message), `quotes: ${i.message}`);
  assert.match(correction, /ONE JSON object/);
  assert.deepEqual(codes([]), ['no-sections']);
});
