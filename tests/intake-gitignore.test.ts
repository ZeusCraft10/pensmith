// tests/intake-gitignore.test.ts — audit #13 regression.
//
// The intake verb repeatedly documents .paper/INTAKE.raw.local (the RAW,
// unredacted PII answers, written when PII redaction is enabled) as
// "(gitignored)", but nothing ever wrote a .gitignore into the user's workspace
// — so the raw PII was committable, defeating the PII opt-in. intake now writes
// .paper/.gitignore (idempotently) so the raw file can never be committed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTAKE_ANSWERS } from './lib/intake-answers.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

function runNew(cwd: string): { status: number | null; stdout: string; stderr: string } {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env['PENSMITH_NO_LLM'] = '1';
  env['PENSMITH_TEST_CASSETTES'] = '1';
  const r = spawnSync(
    process.execPath,
    ['--import', TSX_LOADER, PENSMITH_TS, 'new', '--answers', JSON.stringify({ assignment: 'Write about tidal energy.', ...INTAKE_ANSWERS })],
    { cwd, env, encoding: 'utf8' },
  );
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

test('audit #13: intake writes .paper/.gitignore that ignores the raw-PII file', () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-gitignore-'));
  const res = runNew(root);
  assert.equal(res.status, 0, `new must succeed offline; stderr=${res.stderr}`);

  const gi = join(root, '.paper', '.gitignore');
  assert.ok(existsSync(gi), '.paper/.gitignore must be written by intake');
  const body = readFileSync(gi, 'utf8');
  assert.match(body, /^INTAKE\.raw\.local$/m, '.gitignore must ignore the raw-PII file');
  assert.match(body, /^\*\.local$/m, '.gitignore should also ignore *.local artifacts');
});

test('an existing .paper/.gitignore keeps every line of its own and gains only the lines it lacks', () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-gitignore-idem-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const gi = join(root, '.paper', '.gitignore');
  const custom = '# my custom ignore\nsecrets.txt\nINTAKE.raw.local\n';
  writeFileSync(gi, custom);

  const res = runNew(root);
  assert.equal(res.status, 0, `stderr=${res.stderr}`);
  // The user's file is kept as it was; the raw-PII pattern and the added PDF
  // texts (sources/) it did not cover are appended once.
  const after = readFileSync(gi, 'utf8');
  assert.ok(after.startsWith(custom), after);
  assert.equal(after.slice(custom.length), '*.local\nsources/\n');
  const again = runNew(root);
  assert.equal(again.status, 0, `stderr=${again.stderr}`);
  assert.equal(readFileSync(gi, 'utf8'), after, 'a second run adds nothing');
});

test('intake\'s .paper/.gitignore keeps the added PDF texts (sources/) out of git', () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-gitignore-src-'));
  runNew(root);
  assert.match(readFileSync(join(root, '.paper', '.gitignore'), 'utf8'), /^sources\/$/m);
});
