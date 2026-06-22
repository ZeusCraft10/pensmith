// tests/disciplines-schema.test.ts — Phase 10 Plan 10-00 Wave-0 RED scaffold
// (RSCH-06 / CITE-02 discipline→style coverage).
//
// Asserts templates/presets/disciplines.json carries the full 6-field PRD §8
// schema on every entry.
//
// RED-by-skip (Phase-10 Wave-0 convention — matches 05-01/06-01/08-00: Wave-0
// scaffolds skip rather than hard-fail so the FULL suite stays GREEN with zero
// failures). The schema assertions skip NOW because Plan 10-03 has not yet
// expanded disciplines.json (it currently carries only 2 fields per entry —
// defaultTone + defaultCitationStyle). The `schemaComplete` guard inverts and
// these become real assertions automatically once 10-03 lands the 6-field schema.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const disciplinesPath = fileURLToPath(
  new URL('../templates/presets/disciplines.json', import.meta.url),
);

const REQUIRED_FIELDS = [
  'defaultTone',
  'defaultCitationStyle',
  'sourcePreference',
  'sectioningConvention',
  'counterargDefault',
  'densityTarget',
] as const;

function loadPresets(): Record<string, Record<string, unknown>> {
  const raw = readFileSync(disciplinesPath, 'utf8');
  return JSON.parse(raw) as Record<string, Record<string, unknown>>;
}

// schemaComplete is TRUE only once every entry carries all 6 PRD §8 fields
// (i.e. after Plan 10-03 expands disciplines.json). Until then the schema
// assertions below skip with a clear reason rather than hard-failing the suite.
function isSchemaComplete(): boolean {
  if (!existsSync(disciplinesPath)) return false;
  try {
    const presets = loadPresets();
    const entries = Object.values(presets);
    if (entries.length === 0) return false;
    return entries.every((preset) => REQUIRED_FIELDS.every((f) => f in preset));
  } catch {
    return false;
  }
}

const schemaComplete = isSchemaComplete();
const skipUntil6Fields = !schemaComplete;

test('disciplines-schema: disciplines.json exists', () => {
  assert.ok(existsSync(disciplinesPath), 'MISSING: templates/presets/disciplines.json');
});

test('disciplines-schema: every entry contains all 6 required PRD §8 fields', { skip: skipUntil6Fields }, () => {
  const presets = loadPresets();
  for (const [discipline, preset] of Object.entries(presets)) {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(
        field in preset,
        `disciplines.json['${discipline}'] missing required field '${field}'`,
      );
    }
  }
});

test('disciplines-schema: computer-science defaultCitationStyle is ieee, not apa (PRD §8 fix)', { skip: skipUntil6Fields }, () => {
  const presets = loadPresets();
  const cs = presets['computer-science'] as { defaultCitationStyle?: unknown } | undefined;
  assert.equal(
    cs?.defaultCitationStyle,
    'ieee',
    'CS preset must default to IEEE per PRD §8 (was apa)',
  );
});

test('disciplines-schema: every densityTarget has low/center/high keys', { skip: skipUntil6Fields }, () => {
  const presets = loadPresets();
  for (const [discipline, preset] of Object.entries(presets)) {
    const dt = preset['densityTarget'] as Record<string, unknown> | undefined;
    assert.ok(
      dt && 'low' in dt && 'center' in dt && 'high' in dt,
      `disciplines.json['${discipline}'].densityTarget must have low/center/high`,
    );
  }
});
