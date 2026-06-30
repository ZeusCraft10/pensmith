// tests/add-url-pdf.test.ts — audit #11/#12/#30 regression for `pensmith add`.
//
// #12: a URL ending in .pdf matched the local-PDF branch and crashed
//      fs.readFile(path.resolve(url)) with an unhandled ENOENT — URL-PDF
//      ingestion was dead. URLs now route to the URL branch BEFORE the local one.
// #11: the URL branch's httpFetch(source:'generic') is not cassette-backed, so
//      `--dry-run`/offline `add <url>` made a live network call. It is now refused
//      in offline mode (zero external calls).
// #30: a missing/unreadable local .pdf dumped a raw ENOENT stack trace; it now
//      yields a friendly diagnostic.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

interface RunResult { status: number | null; stdout: string; stderr: string }

// spawnSync (not execFileSync) so BOTH streams are captured regardless of exit
// code — `add` writes diagnostics to stderr but exits 0 on a non-fatal failure.
function runCli(args: string[], cwd: string): RunResult {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env['PENSMITH_NETWORK_TESTS'] = ''; // force offline (isOfflineMode: !== '1')
  env['PENSMITH_NO_LLM'] = '1';
  const r = spawnSync(
    process.execPath,
    ['--import', TSX_LOADER, PENSMITH_TS, ...args],
    { cwd, env, encoding: 'utf8' },
  );
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const STACK_RE = /\n\s+at\s+\w/; // a raw Node stack-trace frame

test('audit #11/#12: `add <url>.pdf` offline is refused (no network) and does NOT crash with ENOENT', () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-addurl-'));
  const out = runCli(['add', 'https://example.com/paper.pdf', '--yolo'], root);

  const all = out.stdout + out.stderr;
  // #11: offline URL ingestion is refused — it took the URL branch, not a live call.
  assert.match(out.stderr, /URL ingestion requires network access/i, `stderr=${out.stderr}`);
  // #12: a URL ending in .pdf must NOT have been read as a local file.
  assert.ok(!/ENOENT/.test(all), `must not crash with ENOENT on a URL; got: ${all}`);
  assert.ok(!STACK_RE.test(all), `must not dump a raw stack trace; got: ${all}`);
  // No bib written (nothing hydrated).
  assert.ok(!existsSync(join(root, '.paper', 'CITATIONS.bib')), 'no source should be added offline');
});

test('audit #11: `add <url>` (non-pdf) offline is refused with no live call', () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-addurl2-'));
  const out = runCli(['add', 'https://example.com/some/article', '--yolo'], root);
  assert.match(out.stderr, /URL ingestion requires network access/i);
  assert.ok(!STACK_RE.test(out.stdout + out.stderr));
});

test('audit #30: `add <missing>.pdf` (local) yields a friendly error, not a raw stack trace', () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-addpdf-'));
  const missing = join(root, 'does-not-exist.pdf');
  const out = runCli(['add', missing, '--yolo'], root);

  const all = out.stdout + out.stderr;
  assert.match(out.stderr, /could not read local PDF/i, `expected a friendly diagnostic; got: ${all}`);
  assert.ok(!STACK_RE.test(all), `must not dump a raw stack trace; got: ${all}`);
});
