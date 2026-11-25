// bin/lib/ecosystem-presence.ts
//
// Shared ecosystem-presence detection for the doctor probes, the capability
// facts and the Zotero source adapter. Every function is a read-only query
// (path checks, JSON reads, `pandoc --version`): no writes, no locks.
//
// It lives apart from capabilities.ts so the doctor probes can use it without
// an import cycle (probes/ -> probes.ts -> capabilities.ts -> probes/).
//
// Claude Code keeps MCP servers and skills in these places, and these are the
// places we look:
//   - user config: $CLAUDE_CONFIG_DIR/.claude.json, else ~/.claude.json
//     (top-level `mcpServers` = user scope; `projects[<dir>].mcpServers` =
//     local scope); user skills under $CLAUDE_CONFIG_DIR/skills, else
//     ~/.claude/skills;
//   - the project: <cwd>/.mcp.json and <cwd>/.claude/skills;
//   - installed plugins: each installPath in
//     <config dir>/plugins/installed_plugins.json (its .mcp.json, its
//     plugin.json `mcpServers`, its skills/).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { isInsideSyncFolder, paperDir } from './paths.js';

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

/** Claude Code's config directory: $CLAUDE_CONFIG_DIR, else ~/.claude. */
function claudeConfigDir(): string {
  const env = process.env['CLAUDE_CONFIG_DIR'];
  return env && env.length > 0 ? env : join(homedir(), '.claude');
}

/** Claude Code's user config file: $CLAUDE_CONFIG_DIR/.claude.json, else ~/.claude.json. */
function claudeJsonPath(): string {
  const env = process.env['CLAUDE_CONFIG_DIR'];
  return env && env.length > 0 ? join(env, '.claude.json') : join(homedir(), '.claude.json');
}

function readJson(p: string): unknown {
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as unknown;
  } catch {
    return undefined; // absent or malformed: treat as "nothing configured here"
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Server names under an `mcpServers` object, or [] when it is not one. */
function serverNames(container: unknown): string[] {
  if (!isRecord(container)) return [];
  const servers = container['mcpServers'];
  return isRecord(servers) ? Object.keys(servers) : [];
}

/** installPath of every installed plugin (all scopes). */
function installedPluginDirs(): string[] {
  const registry = readJson(join(claudeConfigDir(), 'plugins', 'installed_plugins.json'));
  if (!isRecord(registry) || !isRecord(registry['plugins'])) return [];
  const dirs: string[] = [];
  for (const installs of Object.values(registry['plugins'])) {
    if (!Array.isArray(installs)) continue;
    for (const inst of installs) {
      if (isRecord(inst) && typeof inst['installPath'] === 'string' && isAbsolute(inst['installPath'])) {
        dirs.push(inst['installPath']);
      }
    }
  }
  return dirs;
}

/** Every MCP config Claude Code would read for a session in `cwd`. */
export function zoteroMcpConfigLocations(cwd: string = process.cwd()): string[] {
  const plugins = installedPluginDirs().flatMap((dir) => [join(dir, '.mcp.json'), join(dir, '.claude-plugin', 'plugin.json')]);
  return [claudeJsonPath(), join(cwd, '.mcp.json'), ...plugins];
}

/**
 * Whether a Zotero MCP server is configured for a session in `cwd`, in any
 * scope Claude Code reads. Best-effort: absence is a WARN, never a FAIL.
 */
export function isZoteroMcpPresent(cwd: string = process.cwd()): boolean {
  const isZotero = (name: string): boolean => /zotero/i.test(name);
  const userConfig = readJson(claudeJsonPath());
  if (serverNames(userConfig).some(isZotero)) return true;
  if (isRecord(userConfig) && isRecord(userConfig['projects'])) {
    const projects = userConfig['projects'];
    const here = resolve(cwd);
    for (const [dir, entry] of Object.entries(projects)) {
      if (resolve(dir) === here && serverNames(entry).some(isZotero)) return true;
    }
  }
  for (const p of zoteroMcpConfigLocations(cwd).slice(1)) {
    if (serverNames(readJson(p)).some(isZotero)) return true;
  }
  return false;
}

/** Every directory a `humanizer` skill could be loaded from for a session in `cwd`. */
export function humanizerSkillLocations(cwd: string = process.cwd()): string[] {
  return [
    join(claudeConfigDir(), 'skills', 'humanizer'),
    join(cwd, '.claude', 'skills', 'humanizer'),
    ...installedPluginDirs().map((dir) => join(dir, 'skills', 'humanizer')),
  ];
}

/** Whether a non-empty `humanizer` skill directory exists in any of those places. */
export function isHumanizerSkillPresent(cwd: string = process.cwd()): boolean {
  return humanizerSkillLocations(cwd).some((dir) => {
    try {
      return existsSync(dir) && statSync(dir).isDirectory() && readdirSync(dir).length > 0;
    } catch {
      return false;
    }
  });
}

/**
 * Detect whether the current paper directory is inside a known cloud-sync
 * folder. Returns `{ detected, match, dir }` where `detected` is the boolean
 * for capabilities.ts (`onedrive_detected`) and `match` is the absolute
 * paper-dir path that matched (or null) for capabilities.ts
 * (`sync_folder_match`, per WR-02 — string|null, not boolean).
 *
 * Env-var resolution: PENSMITH_PAPER_ROOT → paperDir().
 */
export function detectSyncFolder(): { detected: boolean; match: string | null; dir: string } {
  const envRoot = process.env.PENSMITH_PAPER_ROOT;
  const dir = envRoot && envRoot.length > 0 ? envRoot : paperDir();
  const detected = isInsideSyncFolder(dir);
  return { detected, match: detected ? dir : null, dir };
}
