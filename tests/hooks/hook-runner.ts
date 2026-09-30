// tests/hooks/hook-runner.ts — spawn a committed hook bundle the way Claude
// Code does (PLUG-14): `node plugin/dist/hooks/<name>.mjs` with the documented
// stdin JSON (https://code.claude.com/docs/en/hooks — the common fields
// session_id, transcript_path, cwd, hook_event_name, permission_mode, plus
// the event's own: SessionStart `source`, PreCompact `trigger`, PostToolUse
// `tool_name` / `tool_input` / `tool_response` / `tool_use_id`, Stop
// `stop_hook_active`). The hook tests never import the hook functions.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, type Sandbox } from '../helpers/paper-cli-harness.js';

export type HookName = 'session-start' | 'pre-compact' | 'post-tool-use' | 'stop';

export const HOOK_EVENTS: Readonly<Record<HookName, string>> = Object.freeze({
  'session-start': 'SessionStart',
  'pre-compact': 'PreCompact',
  'post-tool-use': 'PostToolUse',
  stop: 'Stop',
});

/** The pensmith MCP tool name Claude Code reports for a plugin tool (matcher `mcp__plugin_pensmith_pensmith__.*`). */
export const PLUGIN_TOOL = 'mcp__plugin_pensmith_pensmith__pensmith_write';

export function hookBundle(name: HookName): string {
  return join(REPO, 'plugin', 'dist', 'hooks', `${name}.mjs`);
}

export function assertBundlesPresent(): void {
  for (const name of Object.keys(HOOK_EVENTS) as HookName[]) {
    if (!existsSync(hookBundle(name))) throw new Error(`${hookBundle(name)} is missing — run \`npm run bundle\``);
  }
}

/** Claude Code's stdin JSON for `name` in `cwd`. */
export function hookInput(name: HookName, cwd: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    session_id: 'claude-session-1',
    transcript_path: join(cwd, 'transcript.jsonl'),
    cwd,
    hook_event_name: HOOK_EVENTS[name],
    permission_mode: 'default',
  };
  const own: Record<HookName, Record<string, unknown>> = {
    'session-start': { source: 'startup', model: 'claude-opus-5' },
    'pre-compact': { trigger: 'auto', custom_instructions: '' },
    'post-tool-use': {
      tool_name: PLUGIN_TOOL,
      tool_input: { section: 2 },
      tool_response: { content: [{ type: 'text', text: 'ok' }] },
      tool_use_id: 'toolu_01TEST',
    },
    stop: { stop_hook_active: false },
  };
  return { ...base, ...own[name], ...extra };
}

export interface HookRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Wall-clock time of the spawn, ms. */
  readonly ms: number;
}

export interface RunHookOptions {
  readonly cwd: string;
  /** The stdin body: an object (JSON-encoded), a raw string, or null for no stdin at all. */
  readonly input?: Record<string, unknown> | string | null;
  readonly env?: Record<string, string | undefined>;
}

/** Spawn the hook bundle as Claude Code does, in the sandbox's isolated data dir. */
export function runHook(sb: Sandbox, name: HookName, opts: RunHookOptions): HookRun {
  const input = opts.input === undefined ? hookInput(name, opts.cwd) : opts.input;
  const started = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [hookBundle(name)], {
    cwd: opts.cwd,
    env: sb.env(opts.env),
    encoding: 'utf8',
    timeout: 30_000,
    ...(input === null
      ? { stdio: ['ignore', 'pipe', 'pipe'] as const }
      : { input: typeof input === 'string' ? input : JSON.stringify(input) }),
  });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  return { status: r.status, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? ''), ms };
}
