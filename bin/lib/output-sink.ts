// bin/lib/output-sink.ts — the one stdout chokepoint (PLUG-13, D-23a-13).
//
// Every line a verb or a bin/lib module prints for the user goes through
// out(). Nothing else in bin/ writes to the process's stdout: the
// `stdout-sink` chokepoint row (scripts/chokepoints/stdout-sink.json) forbids
// it lexically, and the `mcp-stdout-graph` row forbids it in every module the
// MCP server can reach.
//
// Why: the MCP server (mcp/server.ts) speaks JSON-RPC over stdio, and its
// pensmith_plan / pensmith_write / pensmith_verify tools run the CLI verbs
// in-process. One `pensmith plan: …` line on stdout would corrupt the stream
// (T1-15). So the sink is injected:
//   - the CLI keeps the default, the process's stdout, written at call time
//     (so a test that swaps process.stdout.write still sees every byte, and CLI
//     output stays byte-identical);
//   - the MCP server calls setOutputSink(process.stderr) before it connects;
//   - a caller that needs the text itself (the pensmith_status tool returns the
//     exact `pensmith status` text) runs the verb under withCapturedOutput(),
//     which is scoped per async call chain (AsyncLocalStorage): concurrent tool
//     calls never mix their output, a nested capture keeps its own text, and a
//     write after the capture ended falls through to the process sink instead
//     of vanishing.
//
// stderr is not routed here: diagnostics already go to process.stderr, which
// is never the JSON-RPC channel.

import { AsyncLocalStorage } from 'node:async_hooks';

/** Anything with a write(text) — process.stdout, process.stderr, a test double. */
export interface OutputSink {
  write(text: string): unknown;
}

interface Capture {
  readonly chunks: string[];
  open: boolean;
}

/** The replaced process-wide sink, or null for the process's stdout (the default). */
let replaced: OutputSink | null = null;

const captures = new AsyncLocalStorage<Capture>();

/** The process-wide sink out() writes to outside a capture. */
function processSink(): OutputSink {
  return replaced ?? process.stdout;
}

/**
 * Print `text` exactly as given (callers add their own newline): into the
 * innermost open capture of this call chain, else to the process-wide sink.
 */
export function out(text: string): void {
  const capture = captures.getStore();
  if (capture !== undefined && capture.open) {
    capture.chunks.push(text);
    return;
  }
  processSink().write(text);
}

/** Route every uncaptured out() in this process to `sink` (the MCP server: process.stderr). */
export function setOutputSink(sink: OutputSink): void {
  replaced = sink;
}

/** Restore the default sink, the process's stdout. */
export function resetOutputSink(): void {
  replaced = null;
}

/**
 * Run `fn` and return its result with everything it printed through out(),
 * in order. The capture covers `fn`'s whole async call chain and nothing
 * outside it; it closes when `fn` settles (a rejection propagates, and the
 * text printed until then is dropped with it).
 */
export async function withCapturedOutput<T>(fn: () => T | Promise<T>): Promise<{ result: T; output: string }> {
  const capture: Capture = { chunks: [], open: true };
  try {
    const result = await captures.run(capture, fn);
    return { result, output: capture.chunks.join('') };
  } finally {
    capture.open = false;
  }
}
