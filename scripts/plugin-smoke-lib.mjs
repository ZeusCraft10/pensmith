// scripts/plugin-smoke-lib.mjs — helpers shared by scripts/plugin-smoke.mjs
// (CI-05, D-23a-17) and scripts/plugin-session-check.mjs (D-23a-19).
//
// The parsers and the PATH filter are pure and unit-tested in
// tests/plugin-smoke-helpers.test.ts; the rest spawns processes. Nothing here
// needs an API key, and nothing writes outside the temp dirs the callers make.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

/** The skills the plugin must load (the 23a contract: the router plus seven plumbing skills). */
export const EXPECTED_SKILLS = Object.freeze([
  'compile', 'done', 'outline', 'pensmith', 'plan-section', 'research', 'verify-section', 'write-section',
]);
/** The hook events hooks.json declares (D-23a-06). */
export const EXPECTED_HOOK_EVENTS = Object.freeze(['PostToolUse', 'PreCompact', 'SessionStart', 'Stop']);
/** The MCP tools the installed server must list (pensmith_status is D-23a-12's PLUG-03 slice). */
export const EXPECTED_TOOLS = Object.freeze(['pensmith_plan', 'pensmith_status', 'pensmith_verify', 'pensmith_write']);
/** The name Claude Code gives the plugin's MCP server. */
export const PLUGIN_SERVER = 'plugin:pensmith:pensmith';

// ---------------------------------------------------------------------------
// PATH handling (pure).
// ---------------------------------------------------------------------------

/** The env key holding the search path (`Path` on Windows, whatever its case). */
export function pathKey(env, platform = process.platform) {
  if (platform !== 'win32') return 'PATH';
  return Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'Path';
}

/** The executable file names `name` may have in a PATH directory. */
export function executableNames(name, platform = process.platform, pathext = '.COM;.EXE;.BAT;.CMD') {
  if (platform !== 'win32') return [name];
  if (path.win32.extname(name) !== '') return [name];
  return pathext.split(';').filter(Boolean).map((ext) => `${name}${ext.toLowerCase()}`);
}

/**
 * `pathValue` without the directories that hold a `node` executable, so a
 * command resolved through it cannot start node. `exists(file)` is injected
 * (tests pass a fake file system).
 */
export function pathWithoutNode(pathValue, platform = process.platform, exists = existsSync) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const sep = platform === 'win32' ? ';' : ':';
  const nodeNames = platform === 'win32' ? ['node.exe', 'node.cmd', 'node.bat', 'node'] : ['node'];
  return String(pathValue ?? '')
    .split(sep)
    .filter((dir) => dir.length > 0 && !nodeNames.some((n) => exists(p.join(dir, n))))
    .join(sep);
}

/** The first `name` executable on `pathValue`, or null. */
export function findOnPath(name, pathValue, platform = process.platform, exists = existsSync, pathext = undefined) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const sep = platform === 'win32' ? ';' : ':';
  for (const dir of String(pathValue ?? '').split(sep).filter(Boolean)) {
    for (const file of executableNames(name, platform, pathext)) {
      const full = p.join(dir, file);
      if (exists(full)) return full;
    }
  }
  return null;
}

/**
 * The native `claude` executable behind an npm shim on Windows: cmd-shim
 * writes `"%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe" %*`.
 * Returns the target, or null when `shimText` names none. Pure.
 */
export function cmdShimTarget(shimPath, shimText) {
  const m = /"%~?dp0%?\\?([^"]+?\.exe)"/i.exec(shimText);
  if (!m) return null;
  return path.win32.join(path.win32.dirname(shimPath), m[1]);
}

// ---------------------------------------------------------------------------
// Claude Code output parsers (pure).
// ---------------------------------------------------------------------------

/**
 * `claude plugin details <name>` → the component inventory:
 *   Skills (8)  compile, done, …
 *   Hooks (4)  SessionStart, PreCompact, PostToolUse, Stop  (harness-only — …)
 *   MCP servers (1)  pensmith  (tool schemas resolved at runtime; not counted)
 */
export function parsePluginDetails(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(Skills|Agents|Hooks|MCP servers|LSP servers|Commands)\s*\((\d+)\)\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = { Skills: 'skills', Agents: 'agents', Hooks: 'hooks', 'MCP servers': 'mcpServers', 'LSP servers': 'lspServers', Commands: 'commands' }[m[1]];
    const rest = m[3].replace(/\s+\([^()]*\)\s*$/, '').trim();
    out[key] = { count: Number(m[2]), names: rest === '' ? [] : rest.split(/,\s*/).map((s) => s.trim()).filter(Boolean) };
  }
  return out;
}

/**
 * `claude mcp list` → one row per server:
 *   plugin:pensmith:pensmith: node /…/server.mjs - ✓ Connected
 *   plugin:pensmith:pensmith: node /…/server.mjs - ✗ Failed to connect
 */
export function parseMcpList(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    // The status follows the first ` - ` that starts a status mark or word
    // (✓ √ ✗ × ⚠ !, Connected, Failed, Needs …): a failure reason may itself
    // contain ` - `.
    const m = /^(\S+?): (.+?) - ((?:[✓√✔✗×✘⚠!]|Connected|Failed|Needs|Pending|Disabled)(?:.*))$/iu.exec(line.trim())
      ?? /^(\S+?): (.+) - (.+)$/.exec(line.trim());
    if (!m) continue;
    const statusText = m[3].trim();
    const connected = /\bconnected\b/i.test(statusText) && !/fail|not connected|disconnected/i.test(statusText);
    rows.push({ name: m[1], command: m[2].trim(), statusText, connected });
  }
  return rows;
}

/** Problems with `claude plugin list --json`'s entry for `id` (empty when enabled and error-free). */
export function pluginListProblems(json, id = 'pensmith@pensmith') {
  const list = Array.isArray(json) ? json : Array.isArray(json?.plugins) ? json.plugins : null;
  if (list === null) return ['plugin list --json did not return a list'];
  const entry = list.find((p) => p?.id === id);
  if (!entry) return [`${id} is not installed (have: ${list.map((p) => p?.id).join(', ') || 'none'})`];
  const problems = [];
  if (entry.enabled !== true) problems.push(`${id} is not enabled`);
  for (const [k, v] of Object.entries(entry)) {
    if (/error/i.test(k) && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0) && v !== '') {
      problems.push(`${id} reports ${k}: ${JSON.stringify(v)}`);
    }
  }
  return problems;
}

/** The installed entry's `installPath`, or null. */
export function installPathOf(json, id = 'pensmith@pensmith') {
  const list = Array.isArray(json) ? json : json?.plugins ?? [];
  const entry = list.find((p) => p?.id === id);
  return typeof entry?.installPath === 'string' ? entry.installPath : null;
}

/** Substitute `${CLAUDE_PLUGIN_ROOT}` in a manifest string. */
export function expandPluginRoot(value, root) {
  return String(value).split('${CLAUDE_PLUGIN_ROOT}').join(root);
}

// ---------------------------------------------------------------------------
// Processes.
// ---------------------------------------------------------------------------

/**
 * How to run the `claude` executable at `claudePath` (CLAUDE_BIN, else `claude`
 * on PATH): the real native binary behind a symlink or a Windows npm shim, so
 * it still runs with no `node` on PATH. A JavaScript entry (an older npm
 * install) is run with this process's node.
 */
export function resolveClaude(env = process.env, platform = process.platform) {
  const requested = env.CLAUDE_BIN && env.CLAUDE_BIN.length > 0 ? env.CLAUDE_BIN : null;
  const found = requested
    ? (path.isAbsolute(requested) ? requested : findOnPath(requested, env[pathKey(env, platform)], platform) ?? path.resolve(requested))
    : findOnPath('claude', env[pathKey(env, platform)], platform, existsSync, env.PATHEXT);
  if (found === null || !existsSync(found)) {
    throw new Error(`claude not found (${requested ? `CLAUDE_BIN=${requested}` : 'no `claude` on PATH'}); install Claude Code or set CLAUDE_BIN`);
  }
  let file = realpathSync(found);
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    const target = cmdShimTarget(file, readFileSync(file, 'utf8'));
    if (target !== null && existsSync(target)) file = target;
  }
  const head = readFileSync(file).subarray(0, 64).toString('latin1');
  if (/\.[cm]?js$/i.test(file) || /^#!.*\bnode\b/.test(head)) return { command: process.execPath, prefix: [file], path: file };
  return { command: file, prefix: [], path: file };
}

/** Run `claude <args>` and return {status, stdout, stderr}. */
export function runClaude(claude, args, opts) {
  const r = spawnSync(claude.command, [...claude.prefix, ...args], {
    cwd: opts.cwd,
    env: opts.env,
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 180_000,
    input: opts.input ?? '',
    windowsHide: true,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error ?? null };
}

/**
 * Start an MCP stdio server and run `initialize` + `tools/list` over raw
 * newline-delimited JSON-RPC. Every stdout line must be a JSON-RPC message.
 */
export function mcpHandshake({ command, args, env, cwd, timeoutMs = 30_000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let buf = '';
    let stderr = '';
    const pending = new Map();
    let finished = false;
    const done = (err, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.kill();
      if (err) reject(Object.assign(err, { stderr }));
      else resolve(value);
    };
    const timer = setTimeout(() => done(new Error(`no answer within ${timeoutMs / 1000}s`)), timeoutMs);
    child.on('error', (e) => done(e));
    child.on('exit', (code) => done(new Error(`server exited (${code}) before answering`)));
    child.stderr.on('data', (c) => {
      stderr += String(c);
    });
    child.stdout.on('data', (c) => {
      buf += String(c);
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (line.trim() === '') continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          return done(new Error(`stdout line is not JSON-RPC: ${line.slice(0, 200)}`));
        }
        if (msg?.jsonrpc !== '2.0') return done(new Error(`stdout line is not JSON-RPC 2.0: ${line.slice(0, 200)}`));
        const waiter = pending.get(msg.id);
        if (waiter) {
          pending.delete(msg.id);
          waiter(msg);
        }
      }
    });
    const request = (id, method, params) =>
      new Promise((res) => {
        pending.set(id, res);
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    (async () => {
      const init = await request(1, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'pensmith-plugin-smoke', version: '1.0.0' },
      });
      if (init.error) return done(new Error(`initialize failed: ${JSON.stringify(init.error)}`));
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      const list = await request(2, 'tools/list', {});
      if (list.error) return done(new Error(`tools/list failed: ${JSON.stringify(list.error)}`));
      done(null, {
        serverInfo: init.result?.serverInfo ?? null,
        tools: (list.result?.tools ?? []).map((t) => t.name).sort(),
        stderr,
      });
    })().catch((e) => done(e));
  });
}
