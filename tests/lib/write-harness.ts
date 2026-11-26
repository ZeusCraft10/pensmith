// tests/lib/write-harness.ts — run the `write` verb in-process, shared by
// write-refusals, write-source-feed and write-wave-status.
//
// Not a test file (the runner collects only *.test.ts).

import { afterEach, beforeEach } from 'node:test';
import { _setGeneratorForTest } from '../../bin/lib/anthropic.js';

const ENV = ['PENSMITH_NO_LLM', 'ANTHROPIC_API_KEY', 'PENSMITH_OFFLINE'];

/**
 * Register, in the calling test file, hooks that run each test with a key
 * configured, the LLM on and the network online, and that capture stderr;
 * afterwards the environment, cwd, exit code and test generator are put
 * back. `io.stderr` holds what the test wrote to stderr so far (a test may
 * clear it).
 */
export function useWriteHarness(): { stderr: string } {
  const io = { stderr: '' };
  let prevCwd = '';
  const saved: Record<string, string | undefined> = {};
  let realStderrWrite: typeof process.stderr.write;
  beforeEach(() => {
    prevCwd = process.cwd();
    for (const k of ENV) saved[k] = process.env[k];
    delete process.env['PENSMITH_NO_LLM'];
    delete process.env['PENSMITH_OFFLINE'];
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-not-sent';
    io.stderr = '';
    realStderrWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as unknown as { write: (s: string | Uint8Array) => boolean }).write = (s) => {
      io.stderr += typeof s === 'string' ? s : Buffer.from(s).toString('utf8');
      return true;
    };
  });
  afterEach(() => {
    process.stderr.write = realStderrWrite;
    _setGeneratorForTest(null);
    process.chdir(prevCwd);
    process.exitCode = 0;
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  return io;
}

/** `pensmith write` with `args` (and --yolo) in `root`; its result, with the exit code it set. */
export async function runWrite(root: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { writeCommand } = await import('../../bin/cli/write.js');
  process.chdir(root);
  const res = (await (writeCommand.run as (c: { args: Record<string, unknown> }) => Promise<Record<string, unknown>>)({ args: { yolo: true, ...args } })) ?? {};
  return { ...res, exitCode: process.exitCode ?? 0 };
}
