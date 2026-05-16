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
import { join } from 'node:path';
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

/**
 * Probe whether a Zotero MCP server is configured in any of the standard
 * Claude MCP config locations. Best-effort — absence is WARN, not FAIL.
 */
export function isZoteroMcpPresent(): boolean {
  const home = homedir();
  const paths = [
    join(home, '.claude', 'mcp_servers.json'),
    join(home, '.config', 'claude', 'mcp_servers.json'),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, 'utf8');
      const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
      const servers = parsed.mcpServers ?? {};
      const names = Object.keys(servers);
      if (names.some((n) => /zotero/i.test(n))) return true;
    } catch {
      // Malformed JSON — keep checking the next path.
    }
  }
  return false;
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
 * Env-var resolution: PENSMITH_PAPER_ROOT → paperDir(). This is the canonical
 * env var name used everywhere else in the codebase (mcp/server.ts boot,
 * tests/tier-contract.test.ts Case C); WR-05 dropped the transitional
 * PENSMITH_PAPER_DIR legacy fallback.
 */
export function detectSyncFolder(): { detected: boolean; match: string | null; dir: string } {
  const envRoot = process.env.PENSMITH_PAPER_ROOT;
  const dir = envRoot && envRoot.length > 0 ? envRoot : paperDir();
  const detected = isInsideSyncFolder(dir);
  return { detected, match: detected ? dir : null, dir };
}
