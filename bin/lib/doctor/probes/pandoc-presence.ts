// bin/lib/doctor/probes/pandoc-presence.ts
//
// DOCT-02c: Pandoc binary on PATH probe.
// D-15 severity: PASS when pandoc --version exits 0; WARN when missing.
// D-19 read-only: spawns read-only binary query only.
// Pitfall 8: NEVER exec() (shell-interpolation risk) — always execFileSync with argv array.

import type { Probe, ProbeResult } from '../probes.js';
import { execFileSync } from 'node:child_process';

export const pandocPresenceProbe: Probe = {
  id: 'pandoc-presence',
  async run(): Promise<ProbeResult> {
    try {
      // execFileSync — NEVER exec (Pitfall 8: shell-interpolation risk).
      // argv array form; no shell involved.
      const out = execFileSync('pandoc', ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        timeout: 5000,
      });
      const firstLine = out.split('\n')[0] ?? 'pandoc';
      return {
        id: 'pandoc-presence',
        severity: 'PASS',
        summary: `pandoc on PATH — ${firstLine}`,
      };
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        id: 'pandoc-presence',
        severity: 'WARN',
        summary: 'pandoc not found on PATH — the `export` verb (Phase 3+) will be unavailable.',
        detail: `spawn failed: ${reason}`,
        fix: 'Install pandoc: https://pandoc.org/installing.html',
      };
    }
  },
};
