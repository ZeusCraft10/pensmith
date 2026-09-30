// tests/output-sink.test.ts — the injected stdout sink (PLUG-13, D-23a-13).
//
// bin/lib/output-sink.ts is the one place bin/ writes to the process's stdout.
// These cases pin its contract:
//   - the default sink is process.stdout, looked up at write time (a test or a
//     tool that swaps process.stdout.write sees every byte; CLI output is
//     byte-identical to a direct write);
//   - setOutputSink replaces it process-wide (the MCP server: process.stderr)
//     and resetOutputSink restores the default;
//   - withCapturedOutput is scoped to one async call chain: nested captures keep
//     their own text, concurrent captures never mix, a write after a capture
//     settled falls through to the process sink, and a rejection propagates.

import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { out, setOutputSink, resetOutputSink, withCapturedOutput, type OutputSink } from '../bin/lib/output-sink.js';

/**
 * Run the SYNCHRONOUS `fn` with process.stdout.write recorded (and silenced);
 * always restores it. Never across an await: the test runner reports on this
 * process's stdout, and a patched write would swallow its frames.
 */
function recordingStdout(fn: () => void): string {
  const chunks: string[] = [];
  const write = process.stdout.write;
  process.stdout.write = ((c: string | Uint8Array): boolean => {
    chunks.push(String(c));
    return true;
  }) as typeof process.stdout.write;
  try {
    fn();
    return chunks.join('');
  } finally {
    process.stdout.write = write;
  }
}

/** A process-wide sink double (what the MCP server installs: process.stderr). */
function recordingSink(): OutputSink & { text: () => string } {
  const chunks: string[] = [];
  return { write: (t: string) => chunks.push(t), text: () => chunks.join('') };
}

/** Run `fn` with a recording process-wide sink installed; always resets it. */
async function withSink<T>(fn: (sink: ReturnType<typeof recordingSink>) => Promise<T>): Promise<T> {
  const sink = recordingSink();
  setOutputSink(sink);
  try {
    return await fn(sink);
  } finally {
    resetOutputSink();
  }
}

test('PLUG-13: out() writes exactly its text to process.stdout by default, looked up at write time', () => {
  resetOutputSink();
  const stdout = recordingStdout(() => {
    out('pensmith plan: wrote PLAN.md\n');
    out('no newline');
    out('\n');
  });
  assert.equal(stdout, 'pensmith plan: wrote PLAN.md\nno newline\n', 'byte-identical: no newline added, nothing dropped');
});

test('PLUG-13: setOutputSink replaces the process-wide sink; resetOutputSink restores stdout', () => {
  const sink = recordingSink();
  let stdout: string;
  try {
    setOutputSink(sink);
    stdout = recordingStdout(() => out('to the sink\n'));
  } finally {
    resetOutputSink();
  }
  assert.equal(stdout, '', 'nothing reaches stdout once the sink is replaced');
  assert.equal(sink.text(), 'to the sink\n');
  assert.equal(recordingStdout(() => out('back on stdout\n')), 'back on stdout\n');
  assert.equal(sink.text(), 'to the sink\n', 'the replaced sink sees nothing after the reset');
});

test('PLUG-13: withCapturedOutput returns the result and the text, and nothing escapes to the process sink', async () => {
  await withSink(async (sink) => {
    const captured = await withCapturedOutput(async () => {
      out('line 1\n');
      await tick();
      out('line 2\n');
      return 42;
    });
    assert.deepEqual(captured, { result: 42, output: 'line 1\nline 2\n' });
    const sync = await withCapturedOutput(() => {
      out('sync\n');
      return 'ok';
    });
    assert.deepEqual(sync, { result: 'ok', output: 'sync\n' }, 'a synchronous fn is captured too');
    assert.equal(sink.text(), '', 'a capture holds its text back from the process-wide sink (the MCP server: stderr)');
  });
  // …and with the default sink, a capture keeps its text off stdout too.
  let pending: Promise<{ result: void; output: string }> | undefined;
  const stdout = recordingStdout(() => {
    pending = withCapturedOutput(() => out('captured, not printed\n'));
  });
  assert.equal(stdout, '');
  assert.equal((await pending!).output, 'captured, not printed\n');
});

test('PLUG-13: nested captures keep their own text; the outer capture never sees the inner one', async () => {
  const outer = await withCapturedOutput(async () => {
    out('outer before\n');
    const inner = await withCapturedOutput(async () => {
      out('inner 1\n');
      await tick();
      out('inner 2\n');
      return 'inner-result';
    });
    out('outer after\n');
    return inner;
  });
  assert.deepEqual(outer.result, { result: 'inner-result', output: 'inner 1\ninner 2\n' });
  assert.equal(outer.output, 'outer before\nouter after\n');
});

test('PLUG-13: concurrent captures (parallel MCP tool calls) never mix their output', async () => {
  const run = (name: string, lines: number, delayEvery: number) =>
    withCapturedOutput(async () => {
      for (let i = 0; i < lines; i += 1) {
        out(`${name} ${i}\n`);
        if (i % delayEvery === 0) await tick();
        await Promise.resolve();
      }
      return name;
    });
  const all = await withSink(async (sink) => {
    const results = await Promise.all([run('a', 25, 2), run('b', 25, 3), run('c', 25, 1)]);
    assert.equal(sink.text(), '', 'nothing leaks to the process sink');
    return results;
  });
  for (const r of all) {
    const expected = Array.from({ length: 25 }, (_, i) => `${r.result} ${i}\n`).join('');
    assert.equal(r.output, expected, `capture ${r.result} holds exactly its own lines, in order`);
  }
});

test('PLUG-13: a write after the capture settled falls through to the process sink instead of vanishing', async () => {
  await withSink(async (sink) => {
    let late: Promise<void> = Promise.resolve();
    const captured = await withCapturedOutput(() => {
      out('inside\n');
      late = tick().then(() => out('late\n'));
      return 'done';
    });
    assert.deepEqual(captured, { result: 'done', output: 'inside\n' });
    await late;
    assert.equal(sink.text(), 'late\n', 'the late line reached the process sink');
  });
});

test('PLUG-13: a rejection inside a capture propagates, and the capture closes', async () => {
  await withSink(async (sink) => {
    let late: Promise<void> = Promise.resolve();
    await assert.rejects(
      withCapturedOutput(async () => {
        out('before the failure\n');
        late = tick().then(() => out('after the failure\n'));
        await Promise.resolve();
        throw new Error('boom');
      }),
      /boom/,
    );
    await late;
    out('outside\n');
    assert.equal(sink.text(), 'after the failure\noutside\n', 'the failed capture dropped its text and no longer captures');
  });
});
