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
// Walk up from HERE until we find a directory containing package.json.
// Fixed-depth `..` arithmetic does not work because this file ships at two
// different depths: bin/lib/doctor/probes/*.ts under tsx (4 `..` to root)
// and dist/bin/lib/doctor/probes/*.js after build (5 `..` to root). An
// earlier fix used `..` × 4 unconditionally and produced a bogus
// dist/dist/bin/pensmith.js path that no Tier-2 install would satisfy.
function findPkgRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 8; i++) {
    try {
      if (statSync(path.join(cur, 'package.json')).isFile()) return cur;
    } catch {
      // continue
    }
    const next = path.dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  // Fall back to start; the probe will report FAIL with a clear summary.
  return start;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = findPkgRoot(HERE);
const BIN_REL = 'dist/bin/pensmith.js';
const MCP_REL = 'dist/mcp/server.js';
const BIN = path.join(PKG_ROOT, BIN_REL);
const MCP = path.join(PKG_ROOT, MCP_REL);

function presentNonEmpty(p: string): { ok: boolean; size: number; reason?: string } {
  try {
    const s = statSync(p);
    if (s.size === 0) return { ok: false, size: 0, reason: `${p} exists but is empty` };
    return { ok: true, size: s.size };
  } catch (err) {
    // IN-01: classify the failure so an operator can act. ENOENT = build is
    // missing (run `npm run build`); EACCES = file exists but pensmith can't
    // read it (permission/ACL problem, not a missing artifact). Anything else
    // surfaces verbatim so unknown errno states don't disappear into "not found".
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: false, size: 0, reason: `${p} not found` };
    if (code === 'EACCES') return { ok: false, size: 0, reason: `${p} permission denied (EACCES)` };
    return { ok: false, size: 0, reason: `${p} stat failed (${code ?? 'unknown'})` };
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
