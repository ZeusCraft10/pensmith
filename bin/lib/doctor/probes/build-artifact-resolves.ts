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
import path from 'node:path';
import { packageRoot } from '../../paths.js';

// The install root, never process.cwd(): `pensmith doctor` runs from inside a
// user's paper directory. If no root is found the checks below FAIL with a
// clear summary.
const PKG_ROOT = packageRoot();
// Plugin bundle first, then the source build.
const ENTRY_CANDIDATES = ['dist/pensmith.mjs', 'dist/bin/pensmith.js'];
const REQUIRED_ASSETS = [
  'templates/prompts/section-drafter.md',
  'templates/citation-styles/apa.csl',
  'references/honesty-framing.md',
  'references/http-warnings.md',
];

function isNonEmpty(p: string): boolean {
  try {
    return statSync(p).size > 0;
  } catch {
    return false;
  }
}

export const buildArtifactResolvesProbe: Probe = {
  id: 'build-artifact-resolves',
  async run(): Promise<ProbeResult> {
    const entryRel = ENTRY_CANDIDATES.find((rel) => isNonEmpty(path.join(PKG_ROOT, rel)));
    const missingAssets = REQUIRED_ASSETS.filter((rel) => !isNonEmpty(path.join(PKG_ROOT, rel)));
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
