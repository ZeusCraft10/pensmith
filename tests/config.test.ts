// tests/config.test.ts — CONF-01 (D-17-31): the .paper/config.toml loader.
//
// bin/lib/config.ts is the only reader and writer. It migrates an older file
// and writes it back with the current schema_version (4), refuses a newer one, warns once
// per unknown key, refuses verify_quotes (PRD §14) and a paper-level
// endpoint / api_key_env (naming the global runtime.json), and `status
// --config` prints every effective value with its source.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import {
  ConfigError,
  _resetConfigWarningsForTest,
  effectiveConfigRows,
  loadPaperConfig,
  readPaperConfigSync,
  tryReadPaperConfigSync,
  updatePaperConfig,
  rawTable,
} from '../bin/lib/config.js';
import { readGoalFromConfig } from '../bin/cli/goal.js';

async function captureStderr<T>(fn: () => Promise<T> | T): Promise<{ value: T; stderr: string }> {
  const orig = process.stderr.write.bind(process.stderr);
  let buf = '';
  (process.stderr as unknown as { write: (c: string | Uint8Array) => boolean }).write = (c: string | Uint8Array): boolean => {
    buf += typeof c === 'string' ? c : Buffer.from(c).toString('utf8');
    return true;
  };
  try {
    const value = await fn();
    return { value, stderr: buf };
  } finally {
    (process.stderr as unknown as { write: typeof orig }).write = orig;
  }
}

test('CONF-01: a v0 file (no schema_version) is migrated and written back once', async () => {
  await withLlmSandbox({}, async (sb) => {
    sb.writePaperConfig('[project]\ngoal = "learning"\npii_redaction = true\n\n[verification]\nverify_quotes = true\nplagiarism_check = false\n\n[runtime]\nendpoint = ""\napi_key_env = "ANTHROPIC_API_KEY"\n');
    const file = path.join(sb.paper, 'config.toml');
    const { value: cfg, stderr } = await captureStderr(() => loadPaperConfig(sb.root));
    assert.equal(cfg.schema_version, 4);
    assert.equal(cfg.project?.pii_redaction, true);
    assert.equal(cfg.verification?.plagiarism_check, false);
    const written = fs.readFileSync(file, 'utf8');
    assert.match(written, /^schema_version = 4\n/);
    assert.ok(!/verify_quotes/.test(written), 'the retired verify_quotes = true is dropped');
    assert.ok(!/endpoint|api_key_env/.test(written), 'the v0 template no-op runtime keys are dropped');
    assert.match(written, /pii_redaction = true/);
    assert.match(stderr, /migrated from schema v0 to v4/);
    // A second read of the now-current file writes nothing.
    const before = fs.statSync(file).mtimeMs;
    const again = await captureStderr(() => loadPaperConfig(sb.root));
    assert.equal(fs.statSync(file).mtimeMs, before);
    assert.equal(again.stderr, '');
    assert.equal(readGoalFromConfig(sb.root), 'learning', 'the goal reader goes through config.ts');
  });
});

test('CONF-01: a newer schema_version is refused with an upgrade message and never rewritten', async () => {
  await withLlmSandbox({}, async (sb) => {
    sb.writePaperConfig('schema_version = 99\n[project]\ntitle = "x"\n');
    const file = path.join(sb.paper, 'config.toml');
    const before = fs.readFileSync(file, 'utf8');
    await assert.rejects(loadPaperConfig(sb.root), (e: unknown) =>
      e instanceof ConfigError && e.exitCode === 1 && /schema_version 99, newer than this pensmith supports \(4\); upgrade pensmith/.test(e.message));
    assert.throws(() => readPaperConfigSync(sb.root), ConfigError);
    assert.equal(tryReadPaperConfigSync(sb.root), null, 'read-only callers degrade to "no config"');
    await assert.rejects(updatePaperConfig(sb.root, () => undefined), ConfigError, 'the writer refuses too');
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });
});

test('CONF-01: verify_quotes is an error citing PRD §14 (both false, and false surviving a v0 migration)', async () => {
  await withLlmSandbox({}, async (sb) => {
    for (const toml of ['schema_version = 1\n[verification]\nverify_quotes = false\n', '[verification]\nverify_quotes = false\n', 'schema_version = 1\n[verification]\nverify_quotes = true\n']) {
      sb.writePaperConfig(toml);
      await assert.rejects(loadPaperConfig(sb.root), (e: unknown) =>
        e instanceof ConfigError &&
        /verify_quotes is not configurable: Pass 3 quote verification is a blocking pass \(PRD §14\)/.test(e.message) &&
        !e.message.includes('\n'));
    }
  });
});

test('CONF-01 / S-18: a paper-level [runtime] endpoint or api_key_env is an error naming the global runtime.json', async () => {
  await withLlmSandbox({}, async (sb) => {
    const globalFile = path.join(sb.pensmithData, 'runtime.json');
    for (const line of ['endpoint = "http://169.254.169.254/v1"', 'api_key_env = "GITHUB_TOKEN"']) {
      sb.writePaperConfig(`schema_version = 1\n[runtime]\n${line}\n`);
      const key = line.split(' ')[0]!;
      assert.throws(() => readPaperConfigSync(sb.root), (e: unknown) =>
        e instanceof ConfigError &&
        e.message.includes(`[runtime] ${key} is not allowed in a paper's config`) &&
        e.message.includes(globalFile));
    }
  });
});

test('CONF-01: unknown keys warn once each and are ignored; invalid TOML and bad values are one-line errors', async () => {
  await withLlmSandbox({}, async (sb) => {
    _resetConfigWarningsForTest();
    sb.writePaperConfig('schema_version = 1\ncolour = "red"\n[project]\ntitle = "T"\nfavourite = 3\n[runtime.slugs.not-a-slug]\nmodel = "x"\n[runtime.slugs.section-drafter]\neffort = "low"\nbogus = 1\n');
    const first = await captureStderr(() => readPaperConfigSync(sb.root));
    const second = await captureStderr(() => readPaperConfigSync(sb.root));
    assert.equal(first.value.config.project?.title, 'T');
    assert.equal(first.value.config.runtime?.slugs?.['section-drafter']?.effort, 'low');
    for (const k of ['unknown key "colour"', 'unknown key "project.favourite"', 'unknown prompt slug "runtime.slugs.not-a-slug"', 'unknown key "runtime.slugs.section-drafter.bogus"']) {
      assert.ok(first.stderr.includes(k), `${k} warned`);
    }
    assert.equal(first.stderr.trim().split('\n').length, 4, 'one line per unknown key');
    assert.equal(second.stderr, '', 'each warning prints once per process');

    sb.writePaperConfig('schema_version = 1\n[project\ntitle = "x"\n');
    assert.throws(() => readPaperConfigSync(sb.root), (e: unknown) => e instanceof ConfigError && /is not valid TOML/.test(e.message) && !e.message.includes('\n'));
    sb.writePaperConfig('schema_version = 1\n[project]\ncitation_style = "Bluebook"\n[budget]\ncost_cap_usd = -1\n');
    assert.throws(() => readPaperConfigSync(sb.root), (e: unknown) =>
      e instanceof ConfigError && /citation_style must be one of: APA, MLA/.test(e.message) && /budget\.cost_cap_usd/.test(e.message));
  });
});

test('CONF-01: unknown keys are warned about but never deleted — a migration write-back and updatePaperConfig keep them', async () => {
  await withLlmSandbox({}, async (sb) => {
    _resetConfigWarningsForTest();
    // A v0 file with keys this pensmith does not know (a newer pensmith's, or the user's own).
    sb.writePaperConfig('baseURL = "https://example.org/"\ntitle = "My site"\n[project]\ngoal = "draft"\nfavourite = 3\n[params]\ntheme = "dark"\n');
    const file = path.join(sb.paper, 'config.toml');
    const { stderr } = await captureStderr(() => loadPaperConfig(sb.root));
    assert.match(stderr, /unknown key "baseURL" \(ignored\)/);
    assert.match(stderr, /migrated from schema v0 to v4/);
    const migrated = fs.readFileSync(file, 'utf8');
    assert.match(migrated, /^schema_version = 4\n/);
    for (const kept of [/baseURL = "https:\/\/example\.org\/"/, /title = "My site"/, /favourite = 3/, /\[params\]\ntheme = "dark"/]) {
      assert.match(migrated, kept, `the migration write-back keeps ${String(kept)}`);
    }
    await captureStderr(() => updatePaperConfig(sb.root, (raw) => { rawTable(raw, 'budget')['cost_cap_usd'] = 2; }));
    const updated = fs.readFileSync(file, 'utf8');
    for (const kept of [/baseURL = /, /title = "My site"/, /favourite = 3/, /theme = "dark"/, /cost_cap_usd = 2/]) {
      assert.match(updated, kept, `updatePaperConfig keeps ${String(kept)}`);
    }
    assert.equal(readPaperConfigSync(sb.root).config.budget?.cost_cap_usd, 2);
  });
});

test('CONF-01: updatePaperConfig is the single writer (the current schema_version, other keys kept)', async () => {
  await withLlmSandbox({}, async (sb) => {
    await updatePaperConfig(sb.root, (raw) => { rawTable(raw, 'project')['title'] = 'First'; });
    await updatePaperConfig(sb.root, (raw) => { rawTable(raw, 'budget')['cost_cap_usd'] = 3; });
    const text = fs.readFileSync(path.join(sb.paper, 'config.toml'), 'utf8');
    assert.match(text, /^schema_version = 4\n/);
    const cfg = readPaperConfigSync(sb.root).config;
    assert.equal(cfg.project?.title, 'First');
    assert.equal(cfg.budget?.cost_cap_usd, 3);
    // A write that would produce an invalid file is refused and nothing changes.
    await assert.rejects(updatePaperConfig(sb.root, (raw) => { rawTable(raw, 'project')['citation_style'] = 'Nope'; }), ConfigError);
    assert.equal(fs.readFileSync(path.join(sb.paper, 'config.toml'), 'utf8'), text);
  });
});

test('CONF-01: effective values carry their source (default, preset, intake, config, env)', async () => {
  await withLlmSandbox({}, async (sb) => {
    sb.writePaperConfig('schema_version = 1\n[project]\ndiscipline_preset = "history"\npii_redaction = true\nlength_target_words = 2000\n');
    const rows = new Map(effectiveConfigRows(sb.root, { PENSMITH_COST_CAP_USD: '7.5' }).map((r) => [r.key, r]));
    assert.deepEqual(rows.get('project.length_target_words'), { key: 'project.length_target_words', value: 2000, source: 'config' });
    assert.equal(rows.get('project.pii_redaction')?.source, 'intake', 'pensmith new writes pii_redaction');
    assert.equal(rows.get('project.citation_style')?.source, 'preset');
    assert.equal(rows.get('project.citation_style')?.value, 'Chicago (Notes-Bibliography)', 'the history preset style (PRD §8, GRND-06)');
    assert.deepEqual(rows.get('project.counterargument_required'), { key: 'project.counterargument_required', value: true, source: 'preset' });
    assert.equal(rows.get('humanizer.enabled')?.source, 'default');
    assert.deepEqual(rows.get('budget.cost_cap_usd'), { key: 'budget.cost_cap_usd', value: 7.5, source: 'env' });
  });
});

test('CONF-01 / RUN-26: `pensmith status --config` prints values, runtime and per-slug models with sources', async () => {
  await withLlmSandbox({ runtime: { provider: 'anthropic' } }, async (sb) => {
    sb.writePaperConfig('schema_version = 1\n[project]\ncitation_style = "MLA"\n[runtime.slugs.claim-support]\nmodel = "claude-sonnet-5"\n');
    const r = sb.runCli(['status', '--config', '--model', 'claude-sonnet-5'], { env: { ANTHROPIC_API_KEY: 'sk-test-config-0001' } });
    assert.equal(r.status, 0, r.stderr);
    const out = r.stdout;
    assert.match(out, /pensmith status --config \(\.paper\/config\.toml, schema_version 4\)/, 'a v1 file reads as the current version (migrated in memory)');
    assert.match(out, /project\.citation_style\s+= "MLA"\s+\(config\)/);
    assert.match(out, /humanizer\.enabled\s+= true\s+\(default\)/);
    assert.match(out, /provider\s+= anthropic\s+\(global\)/);
    assert.match(out, /model \(generation\)\s+= claude-sonnet-5\s+\(flag\)/);
    assert.match(out, /api_key_env\s+= ANTHROPIC_API_KEY \(set\)/);
    assert.ok(!out.includes('sk-test-config-0001'), 'a key value is never printed');
    // RUN-26 (D-18-05): each slug row also says whether its system prompt reaches
    // the minimum cacheable prefix of the model it runs on (claude-sonnet-5: 1024).
    assert.match(out, /section-drafter\s+generation\s+claude-sonnet-5\s+effort high\s+cache (?:yes|no)\s+\(model: flag; effort: default; cache: system prompt ~\d+ tokens (?:reaches|is below) the 1024-token minimum for claude-sonnet-5/);
    assert.match(out, /claim-support\s+judgment\s+claude-sonnet-5\s+.*\(model: config/);
    assert.match(out, /orphan-label\s+judgment\s+claude-haiku-4-5\s+.*\(model: default/);
    // The effort shown is the one SENT: claude-haiku-4-5 takes no effort parameter;
    // its 4096-token cache minimum is above every judgment template.
    assert.match(out, /orphan-label\s+judgment\s+claude-haiku-4-5\s+effort n\/a\s+cache no\s+\(model: default; effort: not sent for this model; cache: system prompt ~\d+ tokens is below the 4096-token minimum for claude-haiku-4-5 \(marked, not cached\)\)/);
  });
});

// ---------------------------------------------------------------------------
// Review round 2: write-back keeps the user's comments and formatting, and a
// read-only verb never writes.
// ---------------------------------------------------------------------------

const COMMENTED_V0 = [
  "# My paper settings — keep the cap low, I'm a student!",
  '[project]',
  'due_date = 2026-05-20          # submit via Canvas',
  'title = "Tides # and currents"   # the working title',
  '',
  '[budget]',
  'cost_cap_usd = 2               # hard limit',
  '',
  '[verification]',
  'verify_quotes = true # retired',
  'plagiarism_check = false',
  '',
].join('\n');

test('CONF-01: the v0 → v4 write-back keeps every comment, the layout and TOML dates (only schema_version is added)', async () => {
  await withLlmSandbox({}, async (sb) => {
    sb.writePaperConfig(COMMENTED_V0);
    const file = path.join(sb.paper, 'config.toml');
    await captureStderr(() => loadPaperConfig(sb.root));
    const written = fs.readFileSync(file, 'utf8');
    const expected = COMMENTED_V0
      .replace('[project]', 'schema_version = 4\n[project]')
      .replace('verify_quotes = true # retired\n', '');
    assert.equal(written, expected, 'a line edit, not a re-serialization');
    assert.match(written, /^due_date = 2026-05-20 {10}# submit via Canvas$/m, 'the date stays a TOML date');
    assert.ok(!fs.existsSync(`${file}.bak`), 'no backup needed when the edit is textual');
    const cfg = readPaperConfigSync(sb.root).config;
    assert.equal(cfg.project?.due_date, '2026-05-20');
    assert.equal(cfg.project?.title, 'Tides # and currents');
  });
});

test('CONF-01 / S-20 (Phase 19 review round 3): a v1 file migrates to the current version by its version line alone — send_byo_passages and the books / nber databases are v2', async () => {
  await withLlmSandbox({}, async (sb) => {
    const v1 = COMMENTED_V0.replace('[project]', 'schema_version = 1\n[project]').replace('verify_quotes = true # retired\n', '');
    sb.writePaperConfig(v1);
    const file = path.join(sb.paper, 'config.toml');
    const { stderr } = await captureStderr(() => loadPaperConfig(sb.root));
    assert.match(stderr, /migrated from schema v1 to v4/);
    assert.equal(fs.readFileSync(file, 'utf8'), v1.replace('schema_version = 1\n', 'schema_version = 4\n'), 'only the version line changed');
    // The v2 keys and values validate; a newer version is refused.
    sb.writePaperConfig('schema_version = 2\n[sources]\nallowed_databases = ["books", "nber", "crossref"]\n[verification]\nsend_byo_passages = true\n');
    const cfg = readPaperConfigSync(sb.root).config;
    assert.deepEqual(cfg.sources?.allowed_databases, ['books', 'nber', 'crossref']);
    assert.equal(cfg.verification?.send_byo_passages, true);
    sb.writePaperConfig('schema_version = 5\n');
    assert.throws(() => readPaperConfigSync(sb.root), /schema_version 5, newer than this pensmith supports \(4\); upgrade pensmith/);
  });
});

test('CONF-01 / S-20 (Phase 20, VRFY-18): a v2 file migrates to the current version by its version line alone; quote_min_words is 1–5 (a paper may only lower the floor)', async () => {
  await withLlmSandbox({}, async (sb) => {
    const v2 = COMMENTED_V0.replace('[project]', 'schema_version = 2\n[project]').replace('verify_quotes = true # retired\n', '');
    sb.writePaperConfig(v2);
    const file = path.join(sb.paper, 'config.toml');
    const { stderr } = await captureStderr(() => loadPaperConfig(sb.root));
    assert.match(stderr, /migrated from schema v2 to v4/);
    assert.equal(fs.readFileSync(file, 'utf8'), v2.replace('schema_version = 2\n', 'schema_version = 4\n'), 'only the version line changed');
    assert.equal(readPaperConfigSync(sb.root).config.verification?.quote_min_words, undefined, 'absent: the default applies');
    for (const n of [1, 3, 5]) {
      sb.writePaperConfig(`schema_version = 3\n[verification]\nquote_min_words = ${n}\n`);
      assert.equal(readPaperConfigSync(sb.root).config.verification?.quote_min_words, n);
    }
    const refused: ReadonlyArray<readonly [string, RegExp]> = [
      ['6', /quote_min_words must be between 1 and 5: a higher floor would leave longer direct quotes unchecked by Pass 3 \(PRD §14\)/],
      ['0', /quote_min_words must be between 1 and 5/],
      ['2.5', /quote_min_words/],
      ['"5"', /quote_min_words/],
    ];
    for (const [bad, why] of refused) {
      sb.writePaperConfig(`schema_version = 3\n[verification]\nquote_min_words = ${bad}\n`);
      assert.throws(() => readPaperConfigSync(sb.root), (e: unknown) => e instanceof ConfigError && why.test(e.message), bad);
    }
    // A v2 file that already names the key (written by hand) is migrated and validated the same way.
    sb.writePaperConfig('schema_version = 2\n[verification]\nquote_min_words = 4\n');
    assert.equal(readPaperConfigSync(sb.root).config.verification?.quote_min_words, 4);
    assert.deepEqual(effectiveConfigRows(sb.root).find((r) => r.key === 'verification.quote_min_words'), { key: 'verification.quote_min_words', value: 4, source: 'config' });
    sb.writePaperConfig('schema_version = 3\n');
    assert.deepEqual(effectiveConfigRows(sb.root).find((r) => r.key === 'verification.quote_min_words'), { key: 'verification.quote_min_words', value: 5, source: 'default' });
    // Review round 2: every effective [verification] value is shown (PRD §10) — the re-check threshold and the BYO-passage switch too.
    const rows = effectiveConfigRows(sb.root);
    assert.deepEqual(rows.find((r) => r.key === 'verification.recheck_after_days'), { key: 'verification.recheck_after_days', value: 30, source: 'default' });
    assert.deepEqual(rows.find((r) => r.key === 'verification.send_byo_passages'), { key: 'verification.send_byo_passages', value: false, source: 'default' });
    sb.writePaperConfig('schema_version = 3\n[verification]\nrecheck_after_days = 7\n');
    assert.deepEqual(effectiveConfigRows(sb.root).find((r) => r.key === 'verification.recheck_after_days'), { key: 'verification.recheck_after_days', value: 7, source: 'config' });
  });
});

test('CONF-01: updatePaperConfig edits only the changed keys — comments, dates and untouched lines survive', async () => {
  await withLlmSandbox({}, async (sb) => {
    sb.writePaperConfig(COMMENTED_V0.replace('[project]', 'schema_version = 1\n[project]').replace('verify_quotes = true # retired\n', ''));
    const file = path.join(sb.paper, 'config.toml');
    await captureStderr(() => updatePaperConfig(sb.root, (raw) => {
      rawTable(raw, 'budget')['cost_cap_usd'] = 3;
      rawTable(raw, 'project')['goal'] = 'learning';
      rawTable(raw, 'logging')['session_bodies'] = 'redacted';
    }));
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /^# My paper settings — keep the cap low, I'm a student!$/m);
    assert.match(text, /^cost_cap_usd = 3 {15}# hard limit$/m, 'the changed value keeps its trailing comment');
    assert.match(text, /^due_date = 2026-05-20 {10}# submit via Canvas$/m);
    assert.match(text, /^title = "Tides # and currents" {3}# the working title\ngoal = "learning"$/m, 'a new key joins its table');
    assert.match(text, /\n\[logging\]\nsession_bodies = "redacted"\n$/, 'a new table is appended');
    const cfg = readPaperConfigSync(sb.root).config;
    assert.equal(cfg.budget?.cost_cap_usd, 3);
    assert.equal(cfg.logging?.session_bodies, 'redacted');
  });
});

test('CONF-01: `pensmith status --config` on a v0 file migrates in memory only — the file is untouched', async () => {
  await withLlmSandbox({ runtime: { provider: 'anthropic' } }, async (sb) => {
    sb.writePaperConfig(COMMENTED_V0.replace('verify_quotes = true # retired\n', ''));
    const file = path.join(sb.paper, 'config.toml');
    const before = fs.readFileSync(file, 'utf8');
    const r = sb.runCli(['status', '--config']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /budget\.cost_cap_usd\s+= 2\s+\(config\)/);
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'a read-only verb never writes config.toml');
  });
});

test('RUN-18: PENSMITH_COST_CAP_USD is validated like [budget] cost_cap_usd — an invalid value is one EXIT_USAGE line, never the $5 default', async () => {
  const { parseCostCapEnv } = await import('../bin/lib/config.js');
  assert.equal(parseCostCapEnv(undefined), null);
  assert.equal(parseCostCapEnv(''), null);
  assert.equal(parseCostCapEnv('0.5'), 0.5);
  assert.equal(parseCostCapEnv(' 2 '), 2);
  assert.equal(parseCostCapEnv('.25'), 0.25);
  for (const bad of ['0', '-1', '$1', '1 USD', 'abc', '0x10', 'Infinity', 'NaN']) {
    assert.throws(() => parseCostCapEnv(bad), (e: unknown) =>
      e instanceof ConfigError && e.exitCode === 2 && /^PENSMITH_COST_CAP_USD must be a positive number of US dollars/.test(e.message), bad);
  }
  assert.throws(() => effectiveConfigRows(process.cwd(), { PENSMITH_COST_CAP_USD: '0' }), ConfigError, 'status --config refuses it too');

  await withLlmSandbox({}, async (sb) => {
    fs.writeFileSync(path.join(sb.root, 'assignment.txt'), 'Write a 1500-word essay on tidal power.\n');
    for (const v of ['0', '$1']) {
      const r = sb.runCli(['--estimate'], { env: { PENSMITH_COST_CAP_USD: v, PENSMITH_NO_LLM: '1' } });
      assert.equal(r.status, 2, `${v}: ${r.stdout}\n${r.stderr}`);
      assert.match(r.stderr, /^pensmith: PENSMITH_COST_CAP_USD must be a positive number of US dollars/m);
      assert.doesNotMatch(r.stdout, /cap \$5\.00/, 'never the silent default');
    }
  });
});
