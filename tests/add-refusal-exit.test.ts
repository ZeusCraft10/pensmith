// tests/add-refusal-exit.test.ts — every `pensmith add` refusal exits 2.
//
// A refused source used to print "Source NOT added" and exit 0, so a script
// running `pensmith add <doi> && pensmith verify` carried on as if the source
// were in the bibliography. The convention is: 0 ok, 2 blocked or refused.
//
// These drive the real CLI. Registry answers come from the committed cassettes
// or, for the offline cases, from nowhere at all (PENSMITH_OFFLINE=1).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedCliEnv } from './lib/cli-env.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');
const BYO_PDF = fileURLToPath(new URL('./fixtures/pdf/byo-text.pdf', import.meta.url));

interface RunResult { status: number | null; stdout: string; stderr: string; bibWritten: boolean }

function runAdd(source: string, mode: 'cassette' | 'offline'): RunResult {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-add-exit-'));
  const env = isolatedCliEnv({
    PENSMITH_OFFLINE: mode === 'offline' ? '1' : undefined,
    PENSMITH_TEST_CASSETTES: mode === 'offline' ? undefined : '1',
    PENSMITH_NO_LLM: '1',
  }, 'pensmith-add-exit-home-');
  const r = spawnSync(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, 'add', source, '--yolo'], {
    cwd: root, env, encoding: 'utf8',
  });
  return {
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    bibWritten: existsSync(join(root, '.paper', 'CITATIONS.bib')),
  };
}

function assertRefused(r: RunResult, why: RegExp): void {
  const all = r.stdout + r.stderr;
  assert.match(all, why, all);
  assert.match(all, /Source NOT added/, all);
  assert.equal(r.status, 2, `a refused source must exit 2; got ${r.status}. output: ${all}`);
  assert.equal(r.bibWritten, false, 'nothing may be written to CITATIONS.bib');
}

test('add exit code: a recorded DOI that resolves is added and exits 0', () => {
  const r = runAdd('10.1038/nphys1170', 'cassette');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.bibWritten, true);
});

test('add exit code: a registry record with a different DOI is refused with exit 2', () => {
  // The cassette answers 10.0000/alias-audit16 with the record for 10.0000/retracted.
  assertRefused(runAdd('10.0000/alias-audit16', 'cassette'), /different work \(10\.0000\/retracted\)/);
});

test('add exit code: a DOI the registry does not know is refused with exit 2', () => {
  assertRefused(runAdd('10.9999/pensmith-unknown-doi', 'cassette'), /could not hydrate/);
});

test('add exit code: an offline DOI lookup is refused with exit 2', () => {
  assertRefused(runAdd('10.1038/nphys1170', 'offline'), /DOI lookup requires network access/);
});

test('add exit code: an offline URL is refused with exit 2', () => {
  assertRefused(runAdd('https://example.com/some/article', 'offline'), /URL ingestion requires network access/);
});

test('add exit code: an offline local PDF (title lookup needs the registry) is refused with exit 2', () => {
  assertRefused(runAdd(BYO_PDF, 'offline'), /looking up the PDF by title requires network access/);
});
