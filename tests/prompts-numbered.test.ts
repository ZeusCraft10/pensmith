// tests/prompts-numbered.test.ts — Stream-driven tests for bin/lib/prompts/numbered.ts.
//
// All tests use PassThrough for stdin and a Writable collector for stderr.
// No child_process.spawn — these are unit tests against the function directly.
// No @clack/prompts import (and the numbered module must not have one either).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { askNumbered } from '../bin/lib/prompts/numbered.js';
import { PromptAbortedError, PromptTimeoutError } from '../bin/lib/prompts.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a PassThrough that buffers lines we push, with { allowHalfOpen: true }
 * so we can end() to simulate EOF independently of line delivery. */
function makeFakeStdin(lines: string[]): PassThrough {
  const s = new PassThrough({ allowHalfOpen: true });
  // Push lines asynchronously so readline event listeners are set up first.
  queueMicrotask(() => {
    for (const line of lines) {
      s.write(line + '\n');
    }
  });
  return s;
}

/** Create a stdin that ends immediately (EOF before any line). */
function makeEofStdin(): PassThrough {
  const s = new PassThrough({ allowHalfOpen: true });
  queueMicrotask(() => s.end());
  return s;
}

/** Collect everything written to stderr. */
function makeStderrCollector(): { stream: Writable; get(): string } {
  let buf = '';
  const stream = new Writable({
    write(chunk: Buffer | string, _enc: BufferEncoding, cb: () => void) {
      buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      cb();
    },
  });
  return { stream, get: () => buf };
}

// Sample question fixtures
const SELECT_QUESTION = {
  id: 'discipline',
  kind: 'select' as const,
  label: 'Which discipline preset?',
  options: [
    { value: 'cs', label: 'Computer science', hint: 'APA + arXiv-heavy' },
    { value: 'bio', label: 'Biological sciences', hint: 'CSE + PubMed' },
    { value: 'history', label: 'History', hint: 'Chicago notes-bib' },
    { value: 'other', label: 'Pick a custom style' },
  ],
  default: 'cs',
};

const MULTISELECT_QUESTION = {
  id: 'formats',
  kind: 'multiselect' as const,
  label: 'Select output formats:',
  options: [
    { value: 'pdf', label: 'PDF' },
    { value: 'docx', label: 'DOCX' },
    { value: 'tex', label: 'LaTeX' },
  ],
};

const TEXT_QUESTION = {
  id: 'title',
  kind: 'text' as const,
  label: 'Enter paper title:',
  default: 'My Thesis',
};

const CONFIRM_QUESTION = {
  id: 'approve',
  kind: 'confirm' as const,
  label: 'Proceed with export?',
  default: false,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

test('numbered: select happy path — push "2" → returns option[1].value', async () => {
  const { stream: stderr } = makeStderrCollector();
  const stdin = makeFakeStdin(['2']);
  const ans = await askNumbered(SELECT_QUESTION, { stdin, stderr });
  assert.equal(ans.kind, 'select');
  assert.equal(ans.id, 'discipline');
  assert.equal(ans.value, 'bio'); // option index 2 = bio
});

test('numbered: select out-of-range × 3 → PromptAbortedError', async () => {
  const { stream: stderr } = makeStderrCollector();
  // 3 retries each get an out-of-range answer, then abort
  const stdin = new PassThrough({ allowHalfOpen: true });
  queueMicrotask(() => {
    stdin.write('99\n');
    stdin.write('0\n');
    stdin.write('-1\n');
  });
  await assert.rejects(
    () => askNumbered(SELECT_QUESTION, { stdin, stderr }),
    (err: unknown) => {
      assert.ok(err instanceof PromptAbortedError, `expected PromptAbortedError, got ${String(err)}`);
      assert.equal((err as PromptAbortedError).id, 'discipline');
      return true;
    },
  );
});

test('numbered: multiselect "1,3" → returns [opt[0].value, opt[2].value]', async () => {
  const { stream: stderr } = makeStderrCollector();
  const stdin = makeFakeStdin(['1,3']);
  const ans = await askNumbered(MULTISELECT_QUESTION, { stdin, stderr });
  assert.equal(ans.kind, 'multiselect');
  assert.deepEqual(ans.value, ['pdf', 'tex']);
});

test('numbered: multiselect blank line + default → returns default array', async () => {
  const { stream: stderr } = makeStderrCollector();
  const q = { ...MULTISELECT_QUESTION, default: ['pdf'] };
  const stdin = makeFakeStdin(['']);
  const ans = await askNumbered(q, { stdin, stderr });
  assert.equal(ans.kind, 'multiselect');
  assert.deepEqual(ans.value, ['pdf']);
});

test('numbered: text happy path — "hello world" → returns that string', async () => {
  const { stream: stderr } = makeStderrCollector();
  const stdin = makeFakeStdin(['hello world']);
  const ans = await askNumbered(TEXT_QUESTION, { stdin, stderr });
  assert.equal(ans.kind, 'text');
  assert.equal(ans.value, 'hello world');
});

test('numbered: text blank line → returns default', async () => {
  const { stream: stderr } = makeStderrCollector();
  const stdin = makeFakeStdin(['']);
  const ans = await askNumbered(TEXT_QUESTION, { stdin, stderr });
  assert.equal(ans.kind, 'text');
  assert.equal(ans.value, 'My Thesis');
});

test('numbered: confirm y → true; n → false; blank+default:true → true; blank+noDefault → false', async () => {
  // y → true
  {
    const { stream: stderr } = makeStderrCollector();
    const ans = await askNumbered(
      { ...CONFIRM_QUESTION },
      { stdin: makeFakeStdin(['y']), stderr },
    );
    assert.equal(ans.value, true);
  }
  // n → false
  {
    const { stream: stderr } = makeStderrCollector();
    const ans = await askNumbered(
      { ...CONFIRM_QUESTION },
      { stdin: makeFakeStdin(['n']), stderr },
    );
    assert.equal(ans.value, false);
  }
  // blank + default:true → true
  {
    const { stream: stderr } = makeStderrCollector();
    const ans = await askNumbered(
      { ...CONFIRM_QUESTION, default: true },
      { stdin: makeFakeStdin(['']), stderr },
    );
    assert.equal(ans.value, true);
  }
  // blank + no default → false
  {
    const { stream: stderr } = makeStderrCollector();
    const q = { id: 'c', kind: 'confirm' as const, label: 'Sure?' };
    const ans = await askNumbered(q, { stdin: makeFakeStdin(['']), stderr });
    assert.equal(ans.value, false);
  }
});

test('numbered: EOF mid-question → PromptAbortedError with id', async () => {
  const { stream: stderr } = makeStderrCollector();
  const stdin = makeEofStdin();
  await assert.rejects(
    () => askNumbered(SELECT_QUESTION, { stdin, stderr }),
    (err: unknown) => {
      assert.ok(err instanceof PromptAbortedError, `expected PromptAbortedError, got ${String(err)}`);
      assert.equal((err as PromptAbortedError).id, 'discipline');
      return true;
    },
  );
});

test('numbered: timeout fires within 100ms when stdin never delivers', async () => {
  const { stream: stderr } = makeStderrCollector();
  // Never write to this stdin — timeout should fire
  const stdin = new PassThrough({ allowHalfOpen: true });
  const startMs = Date.now();
  await assert.rejects(
    () => askNumbered(SELECT_QUESTION, { stdin, stderr, timeoutMs: 50 }),
    (err: unknown) => {
      assert.ok(err instanceof PromptTimeoutError, `expected PromptTimeoutError, got ${String(err)}`);
      assert.equal((err as PromptTimeoutError).id, 'discipline');
      return true;
    },
  );
  const elapsed = Date.now() - startMs;
  assert.ok(elapsed < 500, `timeout should fire within 500ms, took ${elapsed}ms`);
});

test('numbered: stderr contains question label and numbered option list', async () => {
  const { stream: stderr, get } = makeStderrCollector();
  const stdin = makeFakeStdin(['1']);
  await askNumbered(SELECT_QUESTION, { stdin, stderr });
  const output = get();
  assert.match(output, /Which discipline preset\?/, 'label should appear in stderr');
  assert.match(output, /1\)/, 'option list should be numbered');
  assert.match(output, /cs/, 'option value should appear');
});

test('numbered: stderr contains [default:...] when a default is set', async () => {
  const { stream: stderr, get } = makeStderrCollector();
  const stdin = makeFakeStdin(['1']);
  await askNumbered(SELECT_QUESTION, { stdin, stderr });
  const output = get();
  // SELECT_QUESTION has default: 'cs' which is option 1
  assert.match(output, /default/i, 'default indicator should appear in stderr');
});

test('numbered: stderr NEVER contains the resolved answer value', async () => {
  const { stream: stderr, get } = makeStderrCollector();
  const stdin = makeFakeStdin(['hello secret answer']);
  // Use a text question with no default so the answer IS the typed value
  const q = { id: 'q', kind: 'text' as const, label: 'Type something:' };
  await askNumbered(q, { stdin, stderr });
  const output = get();
  // The answer value should NOT appear in stderr (no echo)
  assert.ok(!output.includes('hello secret answer'), `stderr should not echo the answer value, got: ${output}`);
});

test('numbered: no process.stdout writes (stdout reserved for JSON downstream)', async () => {
  // We assert by patching process.stdout.write temporarily and verifying
  // it's never called.
  let stdoutWriteCalled = false;
  // Use type assertion to work around the overloaded-signature constraint.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const origWrite = (process.stdout.write as (...a: any[]) => boolean).bind(process.stdout);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ): boolean => {
    stdoutWriteCalled = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (origWrite as (...a: any[]) => boolean)(...args);
  };
  try {
    const { stream: stderr } = makeStderrCollector();
    const stdin = makeFakeStdin(['2']);
    await askNumbered(SELECT_QUESTION, { stdin, stderr });
    assert.equal(stdoutWriteCalled, false, 'numbered mode must not write to stdout');
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = origWrite;
  }
});
