// tests/config-v4.test.ts — config.toml v4 (Phase 21, D-21-26; S-20).
//
// v4 adds `[humanizer] honesty_consent` (EXP-17), the `[compile]` table
// (`smooth_transitions` EXP-10, `contradiction_pairs` EXP-11), `[verification]
// plagiarism_max_phrases` (EXP-19) and a local `.csl` path as `[project]
// citation_style` (EXP-03). The migration rewrites only the version; the keys
// validate; an unknown backend names the three; status --config shows the defaults.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { ConfigError, effectiveConfigRows, loadPaperConfig, parsePaperConfigText, readPaperConfigSync, updatePaperConfig, rawTable } from '../bin/lib/config.js';
import { CURRENT_CONFIG_VERSION, isCslPathSpelling } from '../bin/lib/schemas/config.js';
import { migrate as v3ToV4 } from '../bin/lib/migrations/config/v3_to_v4.js';

test('D-21-26: CURRENT_CONFIG_VERSION is 4 and v3 → v4 rewrites only the version (pure)', () => {
  assert.equal(CURRENT_CONFIG_VERSION, 4);
  const input = { schema_version: 3, humanizer: { enabled: true }, verification: { quote_min_words: 4 } };
  const frozen = JSON.stringify(input);
  const out = v3ToV4(input);
  assert.deepEqual(out, { ...input, schema_version: 4 });
  assert.equal(Object.keys(out)[0], 'schema_version');
  assert.equal(JSON.stringify(input), frozen, 'the input is not mutated');
  assert.deepEqual(v3ToV4({}), { schema_version: 4 });
});

test('D-21-26: a v3 file migrates to v4 by its version line alone, and the v4 keys validate', async () => {
  await withLlmSandbox({}, async (sb) => {
    const v3 = '# keep me\nschema_version = 3\n[humanizer]\nenabled = true   # on\n';
    sb.writePaperConfig(v3);
    const orig = process.stderr.write.bind(process.stderr);
    let err = '';
    (process.stderr as unknown as { write: (c: string | Uint8Array) => boolean }).write = (c) => {
      err += typeof c === 'string' ? c : Buffer.from(c).toString('utf8');
      return true;
    };
    try {
      await loadPaperConfig(sb.root);
    } finally {
      (process.stderr as unknown as { write: typeof orig }).write = orig;
    }
    assert.match(err, /migrated from schema v3 to v4/);
    assert.equal(fs.readFileSync(path.join(sb.paper, 'config.toml'), 'utf8'), v3.replace('schema_version = 3\n', 'schema_version = 4\n'));

    sb.writePaperConfig([
      'schema_version = 4',
      '[project]',
      'citation_style = "styles/my-journal.csl"',
      '[humanizer]',
      'honesty_consent = false',
      'honesty_backend = "sapling"',
      '[compile]',
      'smooth_transitions = false',
      'contradiction_pairs = 0',
      '[verification]',
      'plagiarism_max_phrases = 12',
      '',
    ].join('\n'));
    const text = fs.readFileSync(path.join(sb.paper, 'config.toml'), 'utf8');
    const parsed = parsePaperConfigText(text, 'config.toml');
    assert.deepEqual(parsed.warnings, [], 'no v4 key is unknown');
    const cfg = readPaperConfigSync(sb.root).config;
    assert.equal(cfg.project?.citation_style, 'styles/my-journal.csl');
    assert.equal(cfg.humanizer?.honesty_consent, false);
    assert.equal(cfg.humanizer?.honesty_backend, 'sapling');
    assert.equal(cfg.compile?.smooth_transitions, false);
    assert.equal(cfg.compile?.contradiction_pairs, 0);
    assert.equal(cfg.verification?.plagiarism_max_phrases, 12);
  });
});

test('D-21-26: invalid v4 values are refused with one line each (an unknown backend names the three)', async () => {
  await withLlmSandbox({}, async (sb) => {
    const cases: ReadonlyArray<readonly [string, RegExp]> = [
      ['[humanizer]\nhonesty_backend = "foo"', /honesty_backend must be one of: gptzero, originality, sapling/],
      ['[humanizer]\nhonesty_consent = "yes"', /honesty_consent/],
      ['[compile]\ncontradiction_pairs = -1', /contradiction_pairs/],
      ['[compile]\nsmooth_transitions = 1', /smooth_transitions/],
      ['[verification]\nplagiarism_max_phrases = 0', /plagiarism_max_phrases/],
      ['[project]\ncitation_style = "Bluebook"', /citation_style must be one of: APA, MLA, .* or a path to a local \.csl file/],
    ];
    for (const [body, why] of cases) {
      sb.writePaperConfig(`schema_version = 4\n${body}\n`);
      assert.throws(() => readPaperConfigSync(sb.root), (e: unknown) => e instanceof ConfigError && why.test(e.message), body);
    }
  });
});

test('D-21-26: isCslPathSpelling accepts a .csl path in any case, nothing else', () => {
  for (const ok of ['my.csl', 'styles/journal.CSL', '/abs/path/x.csl', 'C:\\styles\\x.csl', '../shared/apa-6th.csl']) assert.equal(isCslPathSpelling(ok), true, ok);
  for (const bad of ['', '.csl', 'apa', 'csl', 'x.csl.bak', 'a\nb.csl']) assert.equal(isCslPathSpelling(bad), false, JSON.stringify(bad));
});

test('D-21-26: status --config shows the v4 defaults with their source, and updatePaperConfig records honesty_consent', async () => {
  await withLlmSandbox({}, async (sb) => {
    sb.writePaperConfig('schema_version = 4\n');
    const row = (k: string) => effectiveConfigRows(sb.root).find((r) => r.key === k);
    assert.deepEqual(row('compile.smooth_transitions'), { key: 'compile.smooth_transitions', value: true, source: 'default' });
    assert.deepEqual(row('compile.contradiction_pairs'), { key: 'compile.contradiction_pairs', value: 20, source: 'default' });
    assert.deepEqual(row('verification.plagiarism_max_phrases'), { key: 'verification.plagiarism_max_phrases', value: 30, source: 'default' });
    assert.equal(row('humanizer.honesty_consent'), undefined, 'unset: not asked yet (no default row)');
    await updatePaperConfig(sb.root, (raw) => {
      rawTable(raw, 'humanizer')['honesty_consent'] = true;
    });
    assert.deepEqual(row('humanizer.honesty_consent'), { key: 'humanizer.honesty_consent', value: true, source: 'config' });
    assert.match(fs.readFileSync(path.join(sb.paper, 'config.toml'), 'utf8'), /\[humanizer\]\nhonesty_consent = true\n/);
  });
});
