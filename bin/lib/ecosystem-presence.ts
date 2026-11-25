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
import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { claudeConfigDir, claudeJsonPath, isInsideSyncFolder, paperDir } from './paths.js';

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

/** The project's and the installed plugins' MCP configs for a session in `cwd` (the user config aside). */
function otherMcpConfigs(cwd: string): string[] {
  const plugins = installedPluginDirs().flatMap((dir) => [join(dir, '.mcp.json'), join(dir, '.claude-plugin', 'plugin.json')]);
  return [join(cwd, '.mcp.json'), ...plugins];
}

/** Every MCP config Claude Code would read for a session in `cwd`. */
export function zoteroMcpConfigLocations(cwd: string = process.cwd()): string[] {
  return [claudeJsonPath(), ...otherMcpConfigs(cwd)];
}

const isZotero = (name: string): boolean => /zotero/i.test(name);

/** Whether the user config at `file` has a Zotero server at user scope, or at local scope for `cwd`. */
function userConfigHasZotero(file: string, cwd: string): boolean {
  const userConfig = readJson(file);
  if (serverNames(userConfig).some(isZotero)) return true;
  if (!isRecord(userConfig) || !isRecord(userConfig['projects'])) return false;
  const here = resolve(cwd);
  return Object.entries(userConfig['projects']).some(([dir, entry]) => resolve(dir) === here && serverNames(entry).some(isZotero));
}

/**
 * The MCP configs a session in `cwd` reads (`checked`, for the doctor's
 * detail) and whether any of them configures a Zotero server, in one pass.
 * Best-effort: absence is a WARN, never a FAIL.
 */
export function zoteroMcpScan(cwd: string = process.cwd()): { checked: string[]; present: boolean } {
  const userFile = claudeJsonPath();
  const others = otherMcpConfigs(cwd);
  const present = userConfigHasZotero(userFile, cwd) || others.some((p) => serverNames(readJson(p)).some(isZotero));
  return { checked: [userFile, ...others], present };
}

/** Whether a Zotero MCP server is configured for a session in `cwd`, in any scope Claude Code reads. */
export function isZoteroMcpPresent(cwd: string = process.cwd()): boolean {
  return zoteroMcpScan(cwd).present;
}

/** Every directory a `humanizer` skill could be loaded from for a session in `cwd`. */
export function humanizerSkillLocations(cwd: string = process.cwd()): string[] {
  return [
    join(claudeConfigDir(), 'skills', 'humanizer'),
    join(cwd, '.claude', 'skills', 'humanizer'),
    ...installedPluginDirs().map((dir) => join(dir, 'skills', 'humanizer')),
  ];
}

/** The humanizer skill locations for `cwd`, and whether any is a non-empty directory, in one pass. */
export function humanizerSkillScan(cwd: string = process.cwd()): { locations: string[]; present: boolean } {
  const locations = humanizerSkillLocations(cwd);
  const present = locations.some((dir) => {
    try {
      // Throws for a missing directory or a file, so only a non-empty directory counts.
      return readdirSync(dir).length > 0;
    } catch {
      return false;
    }
  });
  return { locations, present };
}

/** Whether a non-empty `humanizer` skill directory exists in any of those places. */
export function isHumanizerSkillPresent(cwd: string = process.cwd()): boolean {
  return humanizerSkillScan(cwd).present;
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
