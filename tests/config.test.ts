// tests/config.test.ts — CONF-01 (D-17-31): the .paper/config.toml loader.
//
// bin/lib/config.ts is the only reader and writer. It migrates an older file
// and writes it back with schema_version = 1, refuses a newer one, warns once
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
    assert.equal(cfg.schema_version, 1);
    assert.equal(cfg.project?.pii_redaction, true);
    assert.equal(cfg.verification?.plagiarism_check, false);
    const written = fs.readFileSync(file, 'utf8');
    assert.match(written, /^schema_version = 1\n/);
    assert.ok(!/verify_quotes/.test(written), 'the retired verify_quotes = true is dropped');
    assert.ok(!/endpoint|api_key_env/.test(written), 'the v0 template no-op runtime keys are dropped');
    assert.match(written, /pii_redaction = true/);
    assert.match(stderr, /migrated from schema v0 to v1/);
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
      e instanceof ConfigError && e.exitCode === 1 && /schema_version 99, newer than this pensmith supports \(1\); upgrade pensmith/.test(e.message));
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

test('CONF-01: updatePaperConfig is the single writer (schema_version = 1, other keys kept)', async () => {
  await withLlmSandbox({}, async (sb) => {
    await updatePaperConfig(sb.root, (raw) => { rawTable(raw, 'project')['title'] = 'First'; });
    await updatePaperConfig(sb.root, (raw) => { rawTable(raw, 'budget')['cost_cap_usd'] = 3; });
    const text = fs.readFileSync(path.join(sb.paper, 'config.toml'), 'utf8');
    assert.match(text, /^schema_version = 1\n/);
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
    assert.equal(rows.get('project.citation_style')?.value, 'Chicago (Author-Date)', 'the history preset style');
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
    assert.match(out, /pensmith status --config \(\.paper\/config\.toml, schema_version 1\)/);
    assert.match(out, /project\.citation_style\s+= "MLA"\s+\(config\)/);
    assert.match(out, /humanizer\.enabled\s+= true\s+\(default\)/);
    assert.match(out, /provider\s+= anthropic\s+\(global\)/);
    assert.match(out, /model \(generation\)\s+= claude-sonnet-5\s+\(flag\)/);
    assert.match(out, /api_key_env\s+= ANTHROPIC_API_KEY \(set\)/);
    assert.ok(!out.includes('sk-test-config-0001'), 'a key value is never printed');
    assert.match(out, /section-drafter\s+generation\s+claude-sonnet-5\s+effort high\s+\(model: flag; effort: default\)/);
    assert.match(out, /claim-support\s+judgment\s+claude-sonnet-5\s+.*\(model: config/);
    assert.match(out, /orphan-label\s+judgment\s+claude-haiku-4-5\s+.*\(model: default/);
    // The effort shown is the one SENT: claude-haiku-4-5 takes no effort parameter.
    assert.match(out, /orphan-label\s+judgment\s+claude-haiku-4-5\s+effort n\/a\s+\(model: default; effort: not sent for this model\)/);
  });
});
