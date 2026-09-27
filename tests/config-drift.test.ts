// tests/config-drift.test.ts — CONF-01 (D-17-31): PRD §10 and the config.toml
// schema cannot drift.
//
// The §10 TOML block is run through the ONE config reader
// (bin/lib/config.ts parsePaperConfigText): it must parse, validate and raise
// no unknown-key warning (PRD → schema), and every key the schema declares must
// appear in the block (schema → PRD). The documented defaults that code also
// hard-codes (default generation model, session cap) must agree.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePaperConfigText } from '../bin/lib/config.js';
import { CITATION_STYLE_NAMES, CONFIG_TABLES, CURRENT_CONFIG_VERSION } from '../bin/lib/schemas/config.js';
import { DEFAULT_MODELS, SLUGS } from '../bin/lib/llm-models.js';
import { DEFAULT_SESSION_CAP_USD } from '../bin/lib/budget.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function prdSection10Toml(): string {
  const prd = fs.readFileSync(path.join(ROOT, 'PRD.md'), 'utf8').replace(/\r\n/g, '\n');
  const start = prd.indexOf('\n## 10. ');
  assert.ok(start >= 0, 'PRD §10 heading');
  const end = prd.indexOf('\n## 11. ', start);
  const section = prd.slice(start, end);
  const m = /```toml\n([\s\S]*?)\n```/.exec(section);
  assert.ok(m, 'PRD §10 has a ```toml block');
  return m[1]!;
}

test('CONF-01: the PRD §10 block parses through config.ts with no unknown-key warning', () => {
  const { config, warnings, migratedFrom } = parsePaperConfigText(prdSection10Toml(), 'PRD §10');
  assert.deepEqual(warnings, [], 'every documented key is in the schema');
  assert.equal(migratedFrom, null, 'the documented file is current (no migration)');
  assert.equal(config.schema_version, CURRENT_CONFIG_VERSION);
});

test('CONF-01: every key the schema declares is documented in PRD §10', () => {
  const { config } = parsePaperConfigText(prdSection10Toml(), 'PRD §10');
  const doc = config as unknown as Record<string, Record<string, unknown> | undefined>;
  for (const [table, schema] of Object.entries(CONFIG_TABLES)) {
    const documented = doc[table];
    assert.ok(documented, `[${table}] is documented`);
    for (const key of Object.keys(schema.shape)) {
      assert.ok(documented[key] !== undefined, `${table}.${key} is documented in PRD §10`);
    }
  }
  const slugs = (doc['runtime']?.['slugs'] ?? {}) as Record<string, unknown>;
  for (const slug of Object.keys(slugs)) assert.ok(SLUGS[slug], `[runtime.slugs.${slug}] names a real prompt slug`);
});

test('CONF-01: documented defaults agree with the code', () => {
  const toml = prdSection10Toml();
  const { config } = parsePaperConfigText(toml, 'PRD §10');
  assert.equal(config.runtime?.model, DEFAULT_MODELS.anthropic.generation, 'default generation model');
  assert.equal(config.budget?.cost_cap_usd, DEFAULT_SESSION_CAP_USD, 'default session cap');
  const styleLine = toml.split('\n').find((l) => l.startsWith('citation_style'));
  assert.ok(styleLine);
  for (const style of CITATION_STYLE_NAMES) assert.ok(styleLine.includes(style), `citation style "${style}" is documented`);
});

test('CONF-01: verify_quotes, endpoint and api_key_env are documented only as exclusions (never as keys)', () => {
  const keys = prdSection10Toml()
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .map((l) => /^\s*([a-z_]+)\s*=/.exec(l)?.[1])
    .filter((k): k is string => k !== undefined);
  for (const k of ['verify_quotes', 'endpoint', 'api_key_env']) assert.equal(keys.includes(k), false, `${k} is not a key`);
});
