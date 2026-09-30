// bin/lib/hooks/stdin.ts — the Claude Code hook input (PLUG-14, D-23a-15).
//
// Claude Code starts a command hook with one JSON object on stdin: the common
// fields `session_id`, `transcript_path`, `cwd`, `hook_event_name` (and
// `permission_mode`, …) plus the event's own — SessionStart `source`
// (startup | resume | clear | compact | fork), PreCompact `trigger` (manual |
// auto), PostToolUse `tool_name` / `tool_input` / `tool_response`, Stop
// `stop_hook_active`. See https://code.claude.com/docs/en/hooks.
//
// readHookInput reads it bounded in time (2 s: a hook must never hang on a
// stdin nobody closes) and in size, and never throws: no input, a TTY, or a
// body that is not a JSON object all read as null. This module never writes
// stdout — the hook entries in hooks/*.ts print the protocol JSON.

import path from 'node:path';

/** Bound on waiting for the hook's stdin JSON (Claude Code writes it at spawn). */
export const HOOK_STDIN_TIMEOUT_MS = 2_000;

/** A PostToolUse body carries the tool's response; anything past this is not a hook input we act on. */
export const HOOK_STDIN_MAX_BYTES = 16 * 1024 * 1024;

/** The fields pensmith's hooks read. Every field is optional: Claude Code versions differ. */
export interface HookInput {
  readonly session_id?: string;
  readonly cwd?: string;
  readonly hook_event_name?: string;
  readonly transcript_path?: string;
  /** SessionStart: startup | resume | clear | compact | fork. */
  readonly source?: string;
  /** PreCompact: manual | auto. */
  readonly trigger?: string;
  /** PostToolUse. */
  readonly tool_name?: string;
}

const STRING_FIELDS = ['session_id', 'cwd', 'hook_event_name', 'transcript_path', 'source', 'trigger', 'tool_name'] as const;

/** Parse a hook body: the known string fields of a JSON object, or null. Pure. */
export function parseHookInput(text: string): HookInput | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of STRING_FIELDS) {
    const v = o[k];
    if (typeof v === 'string' && v.length > 0 && v.length <= 4096) out[k] = v;
  }
  return out as HookInput;
}

/** The folder the hook addresses: the input's absolute `cwd`, else null (the caller uses its own). */
export function hookInputCwd(input: HookInput | null): string | null {
  const cwd = input?.cwd;
  return typeof cwd === 'string' && path.isAbsolute(cwd) ? cwd : null;
}

/** The subset of a readable stream readHookInput drives (tests pass a fake). */
export interface HookStdin {
  readonly isTTY?: boolean | undefined;
  on(event: 'data', fn: (chunk: Buffer | string) => void): unknown;
  once(event: 'end' | 'error' | 'close', fn: () => void): unknown;
  removeAllListeners(): unknown;
  pause(): unknown;
}

/** Read and parse the hook input from `stdin` (bounded; never throws). */
export async function readHookInput(
  stdin: HookStdin = process.stdin,
  timeoutMs: number = HOOK_STDIN_TIMEOUT_MS,
): Promise<HookInput | null> {
  if (stdin.isTTY === true) return null;
  const text = await new Promise<string | null>((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (value: string | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stdin.removeAllListeners();
      stdin.pause();
      resolve(value);
    };
    // At the deadline, use what arrived: a writer that sent the whole object
    // but left the pipe open still gets its input read.
    const timer = setTimeout(() => finish(Buffer.concat(chunks).toString('utf8')), timeoutMs);
    stdin.on('data', (c: Buffer | string) => {
      const b = typeof c === 'string' ? Buffer.from(c, 'utf8') : c;
      size += b.length;
      if (size > HOOK_STDIN_MAX_BYTES) finish(null);
      else chunks.push(b);
    });
    stdin.once('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    stdin.once('close', () => finish(Buffer.concat(chunks).toString('utf8')));
    stdin.once('error', () => finish(null));
  });
  return text === null ? null : parseHookInput(text);
}
