// bin/lib/doctor/probes/build-artifact-resolves.ts
//
// DOCT-05 Phase-2 substitute (per checker iter 2 + B4 user decision):
//   statSync on the Tier-2 CLI build dist/bin/pensmith.js and the Tier-1 MCP
//   server bundle plugin/dist/mcp/server.mjs (both must be non-empty); then
//   execFileSync(process.execPath, [<cli>, '--version']) smoke-test.
// D-15 severity: PASS when both artifacts exist non-empty AND --version exits 0;
//   FAIL when either artifact is missing/empty OR the smoke exec fails.
// D-19 read-only: statSync + execFileSync (read-only query), no writes.
// Pitfall 8: NEVER exec() (shell-interpolation risk) — only execFileSync with argv array.

import type { Probe, ProbeResult } from '../probes.js';
import { statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { cliPackageRoot, pluginMcpServerBundle, PLUGIN_MCP_SERVER_LABEL } from '../../paths.js';

// CR-02: resolve the artifacts from the installed package, never from the
// process working directory — `pensmith doctor` runs from inside a user's
// paper folder, not the pensmith repo root. paths.ts (the one asset resolver,
// D-23a-03) finds the plugin from its own module location: the package that
// holds plugin/ is where the CLI build lives (source checkout, npm install),
// and the Tier-1 server is the committed plugin bundle (D-23a-04).
const BIN_REL = 'dist/bin/pensmith.js';

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
    let binPath: string;
    let mcpPath: string;
    try {
      const pkg = cliPackageRoot();
      if (pkg === null) {
        return {
          id: 'build-artifact-resolves',
          severity: 'FAIL',
          summary: 'Running inside the plugin bundle, which ships no Tier-2 CLI build.',
          fix: 'Run `pensmith doctor` from the npm-installed CLI or a source checkout.',
        };
      }
      binPath = path.join(pkg, 'dist', 'bin', 'pensmith.js');
      mcpPath = pluginMcpServerBundle();
    } catch (err) {
      return {
        id: 'build-artifact-resolves',
        severity: 'FAIL',
        summary: `Build artifacts not located: ${err instanceof Error ? err.message : String(err)}`,
        fix: 'Reinstall pensmith, or restore plugin/ in a source checkout.',
      };
    }
    const bin = presentNonEmpty(binPath);
    const mcp = presentNonEmpty(mcpPath);
    if (!bin.ok || !mcp.ok) {
      const fixes = [
        !bin.ok && 'run `npm run build` for the CLI',
        !mcp.ok && 'run `npm run bundle` for the plugin bundle',
      ].filter(Boolean).join(' and ');
      return {
        id: 'build-artifact-resolves',
        severity: 'FAIL',
        summary: `Build artifact missing: ${[!bin.ok && bin.reason, !mcp.ok && mcp.reason].filter(Boolean).join('; ')}`,
        fix: `In a source checkout, ${fixes}; an npm install ships both, so reinstall pensmith.`,
      };
    }
    try {
      // execFileSync (NEVER exec) — argv array, no shell. 5s timeout.
      execFileSync(process.execPath, [binPath, '--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        timeout: 5000,
      });
      return {
        id: 'build-artifact-resolves',
        severity: 'PASS',
        summary: `Build artifacts present (${BIN_REL}: ${bin.size}B, ${PLUGIN_MCP_SERVER_LABEL}: ${mcp.size}B) and \`pensmith --version\` exits 0.`,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        id: 'build-artifact-resolves',
        severity: 'FAIL',
        summary: `Build artifacts exist but ${BIN_REL} --version failed to exit 0: ${reason}`,
        fix: 'Run `npm run build` again and investigate its output.',
      };
    }
  },
};
