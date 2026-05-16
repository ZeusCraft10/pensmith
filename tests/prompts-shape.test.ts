// tests/prompts-shape.test.ts — Shape parity + TIER-05 invariant checks.
//
// TIER-05: Both prompt paths (clack TTY + numbered stdin) converge on the same
// PromptAnswer shape. This file asserts:
//   1. Behavioral shape parity: same question → same answer.kind and value
//      (tested via numbered mode in CI since clack requires a real TTY).
//   2. Dispatcher sanity: ask() with mode:'numbered' produces same result as
//      direct askNumbered() call.
//   3. PENSMITH_PROMPT_MODE env override forces mode selection.
//   4-6. Single-source-of-truth invariant: only prompts/clack.ts imports @clack/prompts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { ask } from '../bin/lib/prompts.js';
import { askNumbered } from '../bin/lib/prompts/numbered.js';

// ── Helper ────────────────────────────────────────────────────────────────────

function fakeStdin(line: string): PassThrough {
  const s = new PassThrough({ allowHalfOpen: true });
  // Deliver line asynchronously so readline event listeners are set first
  queueMicrotask(() => {
    s.write(line + '\n');
    s.end();
  });
  return s;
}

function makeSilentStderr(): PassThrough {
  return new PassThrough();
}

// ── Behavioral parity tests (numbered mode only — clack requires real TTY) ───

test('shape: ask(select, mode:numbered) returns select PromptAnswer', async () => {
  const question = {
    id: 'q',
    kind: 'select' as const,
    label: 'pick',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
  };
  const ans = await ask(question, {
    mode: 'numbered',
    stdin: fakeStdin('2'),
    stderr: makeSilentStderr(),
  });
  assert.equal(ans.kind, 'select');
  assert.equal(ans.value, 'b');
  assert.equal(ans.id, 'q');
});

test('shape: ask(text, mode:numbered, blank line) returns default', async () => {
  const ans = await ask(
    { id: 't', kind: 'text', label: 'name', default: 'alice' },
    { mode: 'numbered', stdin: fakeStdin(''), stderr: makeSilentStderr() },
  );
  assert.equal(ans.kind, 'text');
  assert.equal(ans.value, 'alice');
});

test('shape: ask(confirm, mode:numbered, y) returns true', async () => {
  const ans = await ask(
    { id: 'c', kind: 'confirm', label: 'sure?', default: false },
    { mode: 'numbered', stdin: fakeStdin('y'), stderr: makeSilentStderr() },
  );
  assert.equal(ans.kind, 'confirm');
  assert.equal(ans.value, true);
});

test('shape: ask(multiselect, mode:numbered, "1,3") returns array of two values', async () => {
  const ans = await ask(
    {
      id: 'm',
      kind: 'multiselect',
      label: 'pick many',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
        { value: 'c', label: 'C' },
      ],
    },
    { mode: 'numbered', stdin: fakeStdin('1,3'), stderr: makeSilentStderr() },
  );
  assert.equal(ans.kind, 'multiselect');
  assert.deepEqual(ans.value, ['a', 'c']);
});

// ── Dispatcher sanity: ask(numbered) === askNumbered directly ─────────────────

test('shape: ask(mode:numbered) produces same answer as direct askNumbered()', async () => {
  const question = {
    id: 'direct',
    kind: 'text' as const,
    label: 'Enter title:',
    default: 'draft',
  };
  // Two separate calls with the same input → same answer shape
  const [viaAsk, viaDirect] = await Promise.all([
    ask(question, { mode: 'numbered', stdin: fakeStdin('my paper'), stderr: makeSilentStderr() }),
    askNumbered(question, { stdin: fakeStdin('my paper'), stderr: makeSilentStderr() }),
  ]);
  assert.equal(viaAsk.kind, viaDirect.kind);
  assert.equal(viaAsk.value, viaDirect.value);
  assert.equal(viaAsk.id, viaDirect.id);
});

// ── PENSMITH_PROMPT_MODE env override ────────────────────────────────────────

test('TIER-05 invariant: PENSMITH_PROMPT_MODE=numbered forces numbered mode', async () => {
  const prev = process.env['PENSMITH_PROMPT_MODE'];
  process.env['PENSMITH_PROMPT_MODE'] = 'numbered';
  try {
    // Even if stdout.isTTY were true, the env override must force numbered.
    const ans = await ask(
      { id: 'forced', kind: 'text', label: 'hi', default: 'd' },
      { stdin: fakeStdin(''), stderr: makeSilentStderr() },
    );
    assert.equal(ans.value, 'd');
    assert.equal(ans.kind, 'text');
  } finally {
    if (prev === undefined) delete process.env['PENSMITH_PROMPT_MODE'];
    else process.env['PENSMITH_PROMPT_MODE'] = prev;
  }
});

// ── Single-source-of-truth invariant: only clack.ts imports @clack/prompts ───

test('TIER-05 invariant: only prompts/clack.ts imports @clack/prompts', () => {
  const pub = readFileSync('bin/lib/prompts.ts', 'utf8');
  const num = readFileSync('bin/lib/prompts/numbered.ts', 'utf8');
  const sch = readFileSync('bin/lib/prompts/schema.ts', 'utf8');
  const clk = readFileSync('bin/lib/prompts/clack.ts', 'utf8');

  // The import statement pattern (not comment-only occurrences)
  const hasImport = (src: string): boolean => /^import\s.*@clack\/prompts/m.test(src);

  assert.equal(hasImport(pub), false, 'public entry point must not import clack directly');
  assert.equal(hasImport(num), false, 'numbered fallback must not import clack');
  assert.equal(hasImport(sch), false, 'schema must not import clack');
  assert.equal(hasImport(clk), true, 'clack.ts MUST be the file that imports clack');
});
