// tests/no-outline-graceful.test.ts — audit M2 regression.
//
// `pensmith write` (wave mode) and `pensmith compile` parse OUTLINE.md via
// parseOutline, which throws "no section table" on an absent/placeholder outline
// (the offline mock, a hand-edit, or a malformed model outline). Before the fix
// that throw escaped as a raw Node stack trace; now both degrade gracefully —
// write prints a "run `pensmith outline` first" diagnostic and compile REFUSES.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');
const STACK_RE = /\n\s+at\s+\w/; // a raw Node stack-trace frame

function runCli(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env['PENSMITH_NO_LLM'] = '1';
  env['PENSMITH_NETWORK_TESTS'] = '';
  const r = spawnSync(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, ...args], { cwd, env, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// A workspace with a placeholder (table-less) OUTLINE.md — exactly what the
// offline mock produces — plus the research artifact so routing is realistic.
function seedSectionlessOutline(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-nooutline-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(
    join(root, 'STATE.json'),
    JSON.stringify({ $schemaVersion: 2, paperId: 'm2-test', createdAt: new Date().toISOString(), sections: [] }),
  );
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), '{"$schemaVersion":1,"entries":[]}\n');
  writeFileSync(join(root, '.paper', 'OUTLINE.md'), '[PENSMITH_NO_LLM placeholder — no section table here]\n');
  return root;
}

test('audit M2: `write` on a section-less outline degrades gracefully (no raw stack trace)', () => {
  const root = seedSectionlessOutline();
  const out = runCli(['write', '--yolo'], root);
  const all = out.stdout + out.stderr;
  assert.match(out.stderr, /no usable outline/i, `expected a friendly diagnostic; got: ${all}`);
  assert.match(out.stderr, /pensmith outline/, 'must point the user at `pensmith outline`');
  assert.ok(!STACK_RE.test(all), `must not dump a raw stack trace; got: ${all}`);
  assert.ok(!/outline-parse: no section table/.test(all), 'the raw parser error must not surface');
});

test('audit M2: `compile` on a section-less outline REFUSES gracefully (no raw stack trace)', () => {
  const root = seedSectionlessOutline();
  const out = runCli(['compile', '--yolo'], root);
  const all = out.stdout + out.stderr;
  assert.match(all, /REFUSED|no usable outline|no sections/i, `expected a refusal; got: ${all}`);
  assert.ok(!STACK_RE.test(all), `must not dump a raw stack trace; got: ${all}`);
});
