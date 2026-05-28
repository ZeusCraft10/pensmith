// bin/lib/doctor/probes/intake-outline-verify-wiring.ts
//
// DOCT-05 (Plan 03-09 Task 9.1): intake/outline/verify wiring smoke probe.
//
// Confirms the 6 Phase-3 per-section verbs are wired end-to-end across the
// three surfaces that Plans 03-04..03-08 landed:
//
//   (a) bin/pensmith.ts REAL_VERB_LOADERS includes:
//         new, research, outline, plan, write, verify
//       (`new` is the canonical UX02_VERBS key — workflows/new.md is the
//        intake workflow body per CYCLE-3 NAMING NOTE.)
//   (b) workflows/{new,research,outline,plan,write,verify}.md each has a
//       `## Body` section (Plan 03-06 contract).
//   (c) bin/lib/drafter-input.ts exports `assertDrafterInput` (Plan 03-07).
//
// D-19 read-only: probe only imports + parses files; no filesystem writes,
//   no .paper/ touches, no network I/O.
//
// Failure modes surfaced as a FAIL with details listing every missing piece
// so a single `pensmith doctor` invocation tells the operator exactly which
// wiring regressed.

import type { Probe, ProbeResult } from '../probes.js';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve workflow files relative to the package root (same find-up
// pattern used by build-artifact-resolves.ts and prompt-loader.ts) so the
// probe works under both `tsx` (bin/lib/doctor/probes/*.ts) and the
// compiled dist build (dist/bin/lib/doctor/probes/*.js).
function findPkgRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 8; i++) {
    try {
      if (statSync(path.join(cur, 'package.json')).isFile()) return cur;
    } catch {
      // continue upward
    }
    const next = path.dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  return start;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = findPkgRoot(HERE);

// (a) REAL_VERB_LOADERS expected keys. `new` is the canonical UX02 key
// even though the bin/cli implementation file is intake.ts (Plan 06+07
// CYCLE-3 NAMING NOTE — workflows/new.md is the intake body until
// UX02_VERBS renames the key).
const EXPECTED_VERB_KEYS = ['new', 'research', 'outline', 'plan', 'write', 'verify'] as const;

// (b) Workflow files expected. Same canonical-name list — workflows/new.md
// (not workflows/intake.md) is the intake workflow file at Plan 09 acceptance.
const EXPECTED_WORKFLOW_FILES = ['new', 'research', 'outline', 'plan', 'write', 'verify'] as const;

export const intakeOutlineVerifyWiringProbe: Probe = {
  id: 'intake-outline-verify-wiring',
  async run(): Promise<ProbeResult> {
    const failures: string[] = [];

    // (a) REAL_VERB_LOADERS includes all 6 Phase-3 verbs.
    try {
      const dispatcher = (await import('../../../pensmith.js')) as {
        command?: { subCommands?: Record<string, unknown> };
      };
      // The dispatcher exports `command` (a citty CommandDef) with
      // subCommands populated by buildSubCommands(). REAL_VERB_LOADERS
      // itself is private to the module, but its effect is observable on
      // command.subCommands.
      const subs = dispatcher.command?.subCommands ?? {};
      for (const v of EXPECTED_VERB_KEYS) {
        if (!(v in subs)) {
          failures.push(`pensmith.ts subCommands missing verb: ${v}`);
        }
      }
    } catch (e) {
      failures.push(
        `pensmith.ts dispatcher not importable: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // (b) Each workflow file exists and contains a `## Body` heading.
    for (const v of EXPECTED_WORKFLOW_FILES) {
      const wfPath = path.join(PKG_ROOT, 'workflows', `${v}.md`);
      try {
        const text = readFileSync(wfPath, 'utf8');
        if (!/^## Body\s*$/m.test(text)) {
          failures.push(`workflows/${v}.md missing '## Body' section`);
        }
      } catch {
        failures.push(`workflows/${v}.md not found`);
      }
    }

    // (c) bin/lib/drafter-input.ts exports assertDrafterInput.
    try {
      const di = (await import('../../drafter-input.js')) as {
        assertDrafterInput?: unknown;
      };
      if (typeof di.assertDrafterInput !== 'function') {
        failures.push('bin/lib/drafter-input.ts missing assertDrafterInput export');
      }
    } catch (e) {
      failures.push(
        `bin/lib/drafter-input.ts not importable: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (failures.length > 0) {
      return {
        id: 'intake-outline-verify-wiring',
        severity: 'FAIL',
        summary: 'Intake/outline/verify wiring incomplete',
        detail: failures.join('; '),
        fix: 'Re-check Plan 03-06 (workflow bodies), Plan 03-07 (verb loaders + drafter-input), and the REAL_VERB_LOADERS map in bin/pensmith.ts.',
      };
    }

    return {
      id: 'intake-outline-verify-wiring',
      severity: 'PASS',
      summary:
        'All 6 verbs (new, research, outline, plan, write, verify) wired in dispatcher + workflows + drafter contract.',
    };
  },
};
