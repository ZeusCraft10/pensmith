// tests/counterargument.test.ts — GRND-10 / D-18-19: one resolver decides
// whether the outline needs a counterargument + rebuttal, with the precedence
// --no-counter > config.toml > intake yes/no > paper type (auto) > preset.

import test from 'node:test';
import assert from 'node:assert/strict';
import { presetFor, disciplineSlugs } from '../bin/lib/disciplines.js';
import { coversCounterargument, presetCounterargDefault, resolveCounterargument } from '../bin/lib/counterargument.js';

// Pick presets by their table value, not by name (no discipline literals).
const slugs = disciplineSlugs();
const ON = slugs.find((s) => presetFor(s).counterargDefault === 'on')!;
const OFF = slugs.find((s) => presetFor(s).counterargDefault === 'off')!;
const ASK = slugs.find((s) => presetFor(s).counterargDefault === 'ask')!;

test('GRND-10: the preset table has on, off and ask defaults (the fixtures this test relies on)', () => {
  assert.ok(ON && OFF && ASK);
  assert.equal(presetCounterargDefault(ON), 'on');
});

test('GRND-10: --no-counter wins over everything', () => {
  assert.deepEqual(resolveCounterargument({ noCounter: true, configRequired: true, intakeAnswer: 'yes', paperType: 'argumentative', discipline: ON }), { required: false, source: 'flag' });
});

test('GRND-10: config.toml counterargument_required wins over intake, paper type and preset', () => {
  assert.deepEqual(resolveCounterargument({ configRequired: false, intakeAnswer: 'yes', paperType: 'persuasive', discipline: ON }), { required: false, source: 'config' });
  assert.deepEqual(resolveCounterargument({ configRequired: true, intakeAnswer: 'no', paperType: 'lab-report', discipline: OFF }), { required: true, source: 'config' });
});

test('GRND-10: an intake yes/no wins over the paper type and the preset', () => {
  assert.deepEqual(resolveCounterargument({ intakeAnswer: 'yes', paperType: 'summary', discipline: OFF }), { required: true, source: 'intake' });
  assert.deepEqual(resolveCounterargument({ intakeAnswer: 'no', paperType: 'argumentative', discipline: ON }), { required: false, source: 'intake' });
});

test('GRND-10: auto — argumentative/persuasive need one; lab reports, summaries and primers never do', () => {
  for (const t of ['argumentative', 'persuasive'] as const) {
    assert.deepEqual(resolveCounterargument({ intakeAnswer: 'auto', paperType: t, discipline: OFF }), { required: true, source: 'paper-type' });
  }
  for (const t of ['lab-report', 'summary', 'primer'] as const) {
    assert.deepEqual(resolveCounterargument({ intakeAnswer: 'auto', paperType: t, discipline: ON }), { required: false, source: 'paper-type' });
  }
});

test('GRND-10: otherwise the preset decides — on → required, off/ask → not', () => {
  assert.deepEqual(resolveCounterargument({ intakeAnswer: 'auto', paperType: 'analytical', discipline: ON }), { required: true, source: 'preset' });
  assert.deepEqual(resolveCounterargument({ paperType: 'other', discipline: OFF }), { required: false, source: 'preset' });
  assert.deepEqual(resolveCounterargument({ discipline: ASK }), { required: false, source: 'preset' });
});

test('GRND-10: coverage — both roles, or the combined role', () => {
  assert.equal(coversCounterargument(['intro', 'counterargument', 'rebuttal', 'conclusion']), true);
  assert.equal(coversCounterargument(['intro', 'counterargument-rebuttal']), true);
  assert.equal(coversCounterargument(['intro', 'counterargument', 'conclusion']), false);
  assert.equal(coversCounterargument(['rebuttal', undefined]), false);
});
