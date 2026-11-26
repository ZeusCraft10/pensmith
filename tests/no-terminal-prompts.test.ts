// tests/no-terminal-prompts.test.ts — add and sketch never read stdin for a
// question when there is no terminal.
//
// In Claude Code's Bash tool stdin is /dev/null. add asked its remap question
// there after it had saved the source, and sketch asked its four thesis
// questions and crashed on the first one. Now add says how to remap and asks
// nothing; sketch reports what it would ask as one JSON line and exits 3,
// writing nothing, so Claude can talk the thesis through with the user and
// start the paper with `pensmith new --thesis`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedCliEnv } from './lib/cli-env.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

function cli(cwd: string, args: string[], input = ''): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, ...args], {
    cwd,
    env: isolatedCliEnv({ PENSMITH_NO_LLM: '1', PENSMITH_OFFLINE: undefined, PENSMITH_PROMPT_MODE: 'numbered', ANTHROPIC_API_KEY: undefined }),
    encoding: 'utf8',
    input,
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function lastJson(stdout: string): Record<string, unknown> {
  const line = stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  assert.ok(line, `no JSON line on stdout: ${stdout}`);
  return JSON.parse(line) as Record<string, unknown>;
}

test('add without a terminal does not ask whether to remap; it says how, and keeps the source', () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-noterm-add-'));
  mkdirSync(join(root, '.paper'));
  writeFileSync(join(root, '.paper', 'STATE.json'), JSON.stringify({ $schemaVersion: 2, paperId: 'noterm-add', createdAt: new Date().toISOString(), sections: [] }));
  const r = cli(root, ['add', '10.1038/nphys1170'], 'y\n');
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.doesNotMatch(r.stderr, /Remap sections to reference it\?/, 'no question is asked on stdin');
  assert.match(r.stdout + r.stderr, /--remap/, 'the user is told how to remap');
  assert.match(readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8'), /10\.1038\/nphys1170/i);
});

test('sketch without a terminal reports its questions (exit 3), crashes on none, and writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-noterm-sketch-'));
  const r = cli(dir, ['sketch']);
  assert.equal(r.status, 3, `${r.stdout}\n${r.stderr}`);
  assert.doesNotMatch(r.stderr, /PromptAbortedError|\n\s+at /, 'no stack trace');
  const p = lastJson(r.stdout);
  assert.equal(p['gate'], 'sketch');
  assert.equal((p['questions'] as unknown[]).length, 4);
  assert.match(String(p['how_to_answer']), /pensmith new --thesis/);
  assert.doesNotMatch(r.stdout + r.stderr, /--yolo/);
  assert.deepEqual(readdirSync(dir), [], 'sketch creates nothing before the user confirms');
});

test('sketch --thesis without a terminal asks for the go-ahead as a decision (exit 3) and starts nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-noterm-sketch-'));
  const r = cli(dir, ['sketch', '--thesis', 'Tidal barrages reshape estuaries'], 'y\n');
  assert.equal(r.status, 3, `${r.stdout}\n${r.stderr}`);
  const p = lastJson(r.stdout);
  assert.equal(p['gate'], 'sketch');
  assert.deepEqual(p['options'], ['proceed', 'cancel']);
  assert.equal(p['thesis'], 'Tidal barrages reshape estuaries');
  assert.match(String(p['how_to_answer']), /pensmith new --thesis/);
  assert.deepEqual(readdirSync(dir), [], 'a piped "y" is not the user\'s go-ahead');
});
