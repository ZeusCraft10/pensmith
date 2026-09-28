// bin/lib/ecosystem-presence.ts
//
// CR-01 fix: shared ecosystem-presence detection used by BOTH capabilities.ts
// (MCP tier) AND the doctor probes (CLI tier). Per D-21 ("fix the tiers, not
// the test"), `paper://capabilities` MUST report real booleans for
// pandoc/zotero/humanizer/onedrive — not undefined placeholders — so the
// tier-contract test's MCP-vs-CLI fact equivalence holds on any machine
// where these tools are installed (e.g., macos-latest CI runners that ship
// pandoc preinstalled).
//
// Each function returns `{ present: boolean, detail?: string }`. The doctor
// probes wrap this with PASS/WARN severity + fix text; capabilities.ts uses
// the boolean directly.
//
// This module exists to AVOID a circular import: probes/ -> ../probes.ts ->
// capabilities.ts -> probes/ would cycle. Extracting the pure detection
// helpers here keeps capabilities.ts and the probes both downstream of a
// shared, dependency-free module.
//
// D-19 read-only: every function in this module is pure path/exists/spawn
// query — no writes, no atomicWriteFile, no withLock.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isInsideSyncFolder, paperDir, activePaperRoot, servicePaperRoot } from './paths.js';

/**
 * Probe whether `pandoc` is on PATH and answers `--version`.
 * D-15 mapping: PASS -> present=true, WARN -> present=false.
 */
export function isPandocPresent(): boolean {
  try {
    // execFileSync — NEVER exec (shell-interpolation risk).
    execFileSync('pandoc', ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Zotero MCP server detection (SRC-16, D-19-24)
// ---------------------------------------------------------------------------
// Claude Code keeps MCP servers in three scopes (`claude mcp add -s …`):
//   user    — top-level `mcpServers` of `.claude.json` in the Claude config dir
//             ($CLAUDE_CONFIG_DIR when set, else the home folder);
//   local   — `projects[<absolute project path>].mcpServers` of the same file
//             (the default scope of `claude mcp add`);
//   project — `.mcp.json` in the project folder (checked into the project).
// Older setups used `mcp_servers.json` under ~/.claude or ~/.config/claude.
// A server counts as Zotero when its name, command, arguments or URL mention
// "zotero" (e.g. `zotero`, `zotero-mcp`, `uvx zotero-mcp`).

export type ZoteroMcpScope = 'user' | 'local' | 'project' | 'legacy';

export interface ZoteroMcpServer {
  readonly name: string;
  readonly scope: ZoteroMcpScope;
  /** The config file it was found in. */
  readonly file: string;
}

export interface ZoteroMcpDetection {
  readonly servers: readonly ZoteroMcpServer[];
  /** Every config file that was looked at (present or not), for the doctor's detail. */
  readonly checked: readonly string[];
}

/** The Claude Code config folder: $CLAUDE_CONFIG_DIR, else the home folder. */
function claudeConfigHome(env: NodeJS.ProcessEnv): string {
  const dir = env['CLAUDE_CONFIG_DIR']?.trim();
  return dir ? resolve(dir) : homedir();
}

function readJson(file: string): unknown {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null; // malformed — detection is best-effort
  }
}

function isZoteroServer(name: string, spec: unknown): boolean {
  if (/zotero/i.test(name)) return true;
  if (typeof spec !== 'object' || spec === null) return false;
  const s = spec as { command?: unknown; args?: unknown; url?: unknown };
  const parts = [s.command, s.url, ...(Array.isArray(s.args) ? s.args : [])].filter((p): p is string => typeof p === 'string');
  return parts.some((p) => /zotero/i.test(p));
}

function zoteroServersIn(servers: unknown, scope: ZoteroMcpScope, file: string): ZoteroMcpServer[] {
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) return [];
  return Object.entries(servers as Record<string, unknown>)
    .filter(([name, spec]) => isZoteroServer(name, spec))
    .map(([name]) => ({ name, scope, file }));
}

/** `dir` and its ancestors, nearest first, stopping after the first folder that holds `.git`. */
function projectDirs(dir: string): string[] {
  const out: string[] = [];
  let cur = resolve(dir);
  for (let i = 0; i < 64; i += 1) {
    out.push(cur);
    if (existsSync(join(cur, '.git'))) break;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return out;
}

function samePath(a: string, b: string): boolean {
  const fold = (p: string): string => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  return fold(a) === fold(b);
}

/**
 * Find Zotero MCP servers configured for Claude Code, for the project at
 * `root` (default: the active paper root, else PENSMITH_PAPER_ROOT / the
 * working directory). Read-only; never throws.
 */
export function detectZoteroMcpServers(root?: string, env: NodeJS.ProcessEnv = process.env): ZoteroMcpDetection {
  const project = root ?? activePaperRoot() ?? servicePaperRoot(env);
  const dirs = projectDirs(project);
  const servers: ZoteroMcpServer[] = [];
  const checked: string[] = [];

  const claudeJson = join(claudeConfigHome(env), '.claude.json');
  checked.push(claudeJson);
  const cfg = readJson(claudeJson) as { mcpServers?: unknown; projects?: unknown } | null;
  if (cfg) {
    servers.push(...zoteroServersIn(cfg.mcpServers, 'user', claudeJson));
    if (typeof cfg.projects === 'object' && cfg.projects !== null) {
      for (const [path, entry] of Object.entries(cfg.projects as Record<string, unknown>)) {
        if (!dirs.some((d) => samePath(d, path))) continue;
        servers.push(...zoteroServersIn((entry as { mcpServers?: unknown } | null)?.mcpServers, 'local', claudeJson));
      }
    }
  }

  for (const d of dirs) {
    const file = join(d, '.mcp.json');
    checked.push(file);
    servers.push(...zoteroServersIn((readJson(file) as { mcpServers?: unknown } | null)?.mcpServers, 'project', file));
  }

  const home = homedir();
  for (const file of [join(home, '.claude', 'mcp_servers.json'), join(home, '.config', 'claude', 'mcp_servers.json')]) {
    checked.push(file);
    servers.push(...zoteroServersIn((readJson(file) as { mcpServers?: unknown } | null)?.mcpServers, 'legacy', file));
  }
  return { servers, checked };
}

/**
 * Probe whether a Zotero MCP server is configured for Claude Code (any scope,
 * see detectZoteroMcpServers). Best-effort — absence is WARN, not FAIL.
 */
export function isZoteroMcpPresent(): boolean {
  return detectZoteroMcpServers().servers.length > 0;
}

/**
 * Probe whether the humanizer skill is installed at the standard path.
 * Present iff the directory exists, is a directory, and is non-empty.
 */
export function isHumanizerSkillPresent(): boolean {
  const skillPath = join(homedir(), '.claude', 'skills', 'humanizer');
  if (!existsSync(skillPath)) return false;
  try {
    const stat = statSync(skillPath);
    if (!stat.isDirectory()) return false;
    return readdirSync(skillPath).length > 0;
  } catch {
    return false;
  }
}

/**
 * Detect whether the current paper directory is inside a known cloud-sync
 * folder. Returns `{ detected, match, dir }` where `detected` is the boolean
 * for capabilities.ts (`onedrive_detected`) and `match` is the absolute
 * paper-dir path that matched (or null) for capabilities.ts
 * (`sync_folder_match`, per WR-02 — string|null, not boolean).
 *
 * Root resolution: the active root, else PENSMITH_PAPER_ROOT → cwd. This is the canonical
 * env var name used everywhere else in the codebase (mcp/server.ts boot,
 * tests/tier-contract.test.ts Case C); WR-05 dropped the transitional
 * PENSMITH_PAPER_DIR legacy fallback.
 */
export function detectSyncFolder(): { detected: boolean; match: string | null; dir: string } {
  // RUN-13: the paper's `.paper/` under the resolved project root — the CLI's or
  // MCP server's active root, else PENSMITH_PAPER_ROOT / the working directory.
  const dir = paperDir(activePaperRoot() ?? servicePaperRoot());
  const detected = isInsideSyncFolder(dir);
  return { detected, match: detected ? dir : null, dir };
}
