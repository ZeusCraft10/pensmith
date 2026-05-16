// bin/lib/doctor/probes/build-artifact-resolves.ts
//
// DOCT-05 Phase-2 substitute (per checker iter 2 + B4 user decision):
//   statSync on dist/bin/pensmith.js and dist/mcp/server.js (both must be non-empty);
//   then execFileSync(process.execPath, ['dist/bin/pensmith.js', '--version']) smoke-test.
// D-15 severity: PASS when both artifacts exist non-empty AND --version exits 0;
//   FAIL when either artifact is missing/empty OR the smoke exec fails.
// D-19 read-only: statSync + execFileSync (read-only query), no writes.
// Pitfall 8: NEVER exec() (shell-interpolation risk) — only execFileSync with argv array.

import type { Probe, ProbeResult } from '../probes.js';
import { statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// CR-02 fix: resolve build artifacts relative to THIS file, not process.cwd().
// The PRD §3 / §19 Tier-2 contract guarantees `pensmith doctor` runs from
// inside a user's paper directory — not from the pensmith repo root. Using
// cwd-relative literals silently failed every Tier-2 user's first
// `pensmith doctor` invocation outside the repo root. CI never caught this
// because CI always runs from the repo root.
//
// After `npm run build`, this file is emitted to:
//   dist/bin/lib/doctor/probes/build-artifact-resolves.js
// So PKG_ROOT is `..` × 4 from HERE.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const BIN_REL = 'dist/bin/pensmith.js';
const MCP_REL = 'dist/mcp/server.js';
const BIN = path.join(PKG_ROOT, BIN_REL);
const MCP = path.join(PKG_ROOT, MCP_REL);

function presentNonEmpty(p: string): { ok: boolean; size: number; reason?: string } {
  try {
    const s = statSync(p);
    if (s.size === 0) return { ok: false, size: 0, reason: `${p} exists but is empty` };
    return { ok: true, size: s.size };
  } catch {
    return { ok: false, size: 0, reason: `${p} not found` };
  }
}

export const buildArtifactResolvesProbe: Probe = {
  id: 'build-artifact-resolves',
  async run(): Promise<ProbeResult> {
    const bin = presentNonEmpty(BIN);
    const mcp = presentNonEmpty(MCP);
    if (!bin.ok || !mcp.ok) {
      return {
        id: 'build-artifact-resolves',
        severity: 'FAIL',
        summary: `Build artifact missing: ${[!bin.ok && bin.reason, !mcp.ok && mcp.reason].filter(Boolean).join('; ')}`,
        fix: 'Run `npm run build`.',
      };
    }
    try {
      // execFileSync (NEVER exec) — argv array, no shell. 5s timeout.
      execFileSync(process.execPath, [BIN, '--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        timeout: 5000,
      });
      return {
        id: 'build-artifact-resolves',
        severity: 'PASS',
        summary: `Build artifacts present (${BIN_REL}: ${bin.size}B, ${MCP_REL}: ${mcp.size}B) and \`pensmith --version\` exits 0.`,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        id: 'build-artifact-resolves',
        severity: 'FAIL',
        summary: `Build artifacts exist but ${BIN_REL} --version failed to exit 0: ${reason}`,
        fix: 'Run `npm run clean && npm run build`; investigate the build output.',
      };
    }
  },
};
