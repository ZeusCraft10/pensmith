// tests/honesty-consent.test.ts — EXP-17 (D-21-20): detector consent is asked
// ONCE in a terminal and the answer — yes or no — is recorded in the pensmith
// data dir for this paper and this detector (detector-consent.ts; never in
// `.paper/config.toml`, which travels with a shared paper — review round 1),
// so the next score reads it and never asks again. The terminal is the numbered-prompt mode
// (PENSMITH_PROMPT_MODE=numbered: one answer line per question on stdin); the
// child scores twice with the V5 MockAgent answering GPTZero in the test lane.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHILD = fileURLToPath(new URL('./helpers/honesty-consent-child.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

function run(answer: string): { root: string; consent: string; result: { first: string; second: string; requests: number }; stdout: string; stderr: string } {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-consent-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(join(root, '.paper', 'config.toml'), 'schema_version = 4\n');
  // The child's own data dir (its consent file is read back here).
  const dataDir = mkdtempSync(join(tmpdir(), 'pensmith-consent-data-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PENSMITH_TEST_DATA_DIR: dataDir,
    XDG_DATA_HOME: dataDir,
    LOCALAPPDATA: dataDir,
    PENSMITH_TEST: '1',
    PENSMITH_NETWORK_TESTS: '1',
    PENSMITH_PROMPT_MODE: 'numbered',
    GPTZERO_API_KEY: 'test-key-consent-child',
  };
  delete env['PENSMITH_OFFLINE'];
  const r = spawnSync(process.execPath, ['--import', TSX_LOADER, CHILD, root], { cwd: root, input: answer, encoding: 'utf8', timeout: 60_000, env });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const line = r.stderr.trim().split('\n').filter((l) => l.startsWith('{')).pop() ?? '{}';
  const found = [join(dataDir, 'detector-consent.json'), join(dataDir, 'pensmith', 'detector-consent.json')].find((f) => existsSync(f));
  const consent = found !== undefined ? readFileSync(found, 'utf8') : '';
  return { root, consent, result: JSON.parse(line) as { first: string; second: string; requests: number }, stdout: r.stdout, stderr: r.stderr };
}

/** The recorded answer for `root` and GPTZero in a consent file's text. */
function recorded(consent: string, root: string): unknown {
  const papers = (JSON.parse(consent || '{}') as { papers?: Record<string, Record<string, boolean>> }).papers ?? {};
  const real = realpathSync.native(root);
  const entry = Object.entries(papers).find(([k]) => k === real || k === real.toLowerCase());
  return entry?.[1]?.['gptzero'];
}

test('EXP-17: in a terminal the first score asks once; "yes" is recorded and the second score sends without asking', () => {
  const { root, consent, result, stdout, stderr } = run('y\n');
  assert.match(result.first, /^33% AI-generated \(gptzero, \d{4}-/);
  assert.match(result.second, /^33% AI-generated \(gptzero, \d{4}-/);
  assert.equal(result.requests, 2);
  assert.equal(recorded(consent, root), true, 'the yes is recorded in the data dir for this paper and GPTZero');
  assert.equal(readFileSync(join(root, '.paper', 'config.toml'), 'utf8'), 'schema_version = 4\n', 'never in the paper\'s config.toml');
  assert.equal((stderr.match(/Send the full paper text to GPTZero/g) ?? []).length, 1, 'the question is asked once (numbered prompts ask on stderr)');
  assert.ok(!stdout.includes('test-key-consent-child') && !stderr.includes('test-key-consent-child'), 'the key is never printed');
});

test('EXP-17: "no" is recorded too — nothing is sent, now or on the next score', () => {
  const { root, consent, result } = run('n\n');
  assert.equal(result.first, 'skipped (consent declined)');
  assert.equal(result.second, 'skipped (consent declined — your recorded answer)');
  assert.equal(result.requests, 0);
  assert.equal(recorded(consent, root), false);
  assert.equal(readFileSync(join(root, '.paper', 'config.toml'), 'utf8'), 'schema_version = 4\n');
});
