// bin/lib/doctor/probes/build-artifact-resolves.ts
//
// Is this install complete? Two layouts exist: the plugin payload
// (dist/pensmith.mjs bundle beside templates/ and references/) and a source
// build (dist/bin/pensmith.js). The probe finds the CLI entry for whichever
// layout it is running from, checks that `--version` exits 0, and checks the
// runtime assets the CLI reads (prompt templates, CSL styles, reference copy).
// D-15 severity: PASS when the entry runs and every asset is present; FAIL
//   otherwise, naming what is missing.
// D-19 read-only: statSync + execFileSync (read-only query), no writes.
// Pitfall 8: NEVER exec() (shell-interpolation risk) — only execFileSync with argv array.

import type { Probe, ProbeResult } from '../probes.js';
import { statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Resolve the install root relative to THIS file, never process.cwd():
// `pensmith doctor` runs from inside a user's paper directory. Walk up rather
// than using a fixed number of `..`, because this code runs at different
// depths under tsx, in the compiled build and inside the plugin bundle.
function findPkgRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 8; i++) {
    try {
      // package.json marks a source checkout; .claude-plugin/plugin.json marks
      // the installed plugin, which ships no package.json.
      for (const marker of ['package.json', path.join('.claude-plugin', 'plugin.json')]) {
        if (statSync(path.join(cur, marker), { throwIfNoEntry: false })?.isFile()) return cur;
      }
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
// Plugin bundle first, then the source build.
const ENTRY_CANDIDATES = ['dist/pensmith.mjs', 'dist/bin/pensmith.js'];
const REQUIRED_ASSETS = [
  'templates/prompts/section-drafter.md',
  'templates/citation-styles/apa.csl',
  'references/honesty-framing.md',
  'references/http-warnings.md',
];

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
    const entryRel = ENTRY_CANDIDATES.find((rel) => presentNonEmpty(path.join(PKG_ROOT, rel)).ok);
    const missingAssets = REQUIRED_ASSETS.filter((rel) => !presentNonEmpty(path.join(PKG_ROOT, rel)).ok);
    if (!entryRel || missingAssets.length > 0) {
      const problems = [
        ...(entryRel ? [] : [`no CLI entry (${ENTRY_CANDIDATES.join(' or ')}) under ${PKG_ROOT}`]),
        ...missingAssets.map((rel) => `${rel} missing under ${PKG_ROOT}`),
      ];
      return {
        id: 'build-artifact-resolves',
        severity: 'FAIL',
        summary: `Install incomplete: ${problems.join('; ')}`,
        fix: 'Reinstall the plugin, or run `npm run build` in a source checkout.',
      };
    }
    const entry = path.join(PKG_ROOT, entryRel);
    try {
      // execFileSync (NEVER exec) — argv array, no shell. 10s timeout.
      execFileSync(process.execPath, [entry, '--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        timeout: 10_000,
      });
      return {
        id: 'build-artifact-resolves',
        severity: 'PASS',
        summary: `CLI entry ${entryRel} runs and its ${REQUIRED_ASSETS.length} runtime assets are present.`,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        id: 'build-artifact-resolves',
        severity: 'FAIL',
        summary: `${entryRel} --version failed to exit 0: ${reason}`,
        fix: 'Reinstall the plugin, or rebuild with `npm run build` in a source checkout.',
      };
    }
  },
};
