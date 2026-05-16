// bin/lib/doctor/probes/humanizer-skill-presence.ts
//
// DOCT-02d: Humanizer skill presence probe.
// D-15 severity: PASS when ~/.claude/skills/humanizer/ exists with files;
//   WARN when missing or empty (optional Phase 8 dependency).
// D-19 read-only: existsSync + statSync + readdirSync only, no writes.

import type { Probe, ProbeResult } from '../probes.js';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const humanizerSkillPresenceProbe: Probe = {
  id: 'humanizer-skill-presence',
  async run(): Promise<ProbeResult> {
    const skillPath = join(homedir(), '.claude', 'skills', 'humanizer');
    if (!existsSync(skillPath)) {
      return {
        id: 'humanizer-skill-presence',
        severity: 'WARN',
        summary: `Humanizer skill not installed at ${skillPath} — the \`humanize\` verb (Phase 3+) will be unavailable.`,
        fix: 'Install the humanizer skill into ~/.claude/skills/humanizer/. See README humanizer disclosure (PRD §3 & §14).',
      };
    }
    try {
      const stat = statSync(skillPath);
      if (!stat.isDirectory()) {
        return {
          id: 'humanizer-skill-presence',
          severity: 'WARN',
          summary: `${skillPath} exists but is not a directory`,
          fix: 'Remove the file and install the humanizer skill as a directory.',
        };
      }
      const entries = readdirSync(skillPath);
      if (entries.length === 0) {
        return {
          id: 'humanizer-skill-presence',
          severity: 'WARN',
          summary: `${skillPath} is empty`,
          fix: 'Re-install the humanizer skill — directory is present but contains no files.',
        };
      }
      return {
        id: 'humanizer-skill-presence',
        severity: 'PASS',
        summary: `Humanizer skill present at ${skillPath} (${entries.length} entries)`,
      };
    } catch (err) {
      return {
        id: 'humanizer-skill-presence',
        severity: 'WARN',
        summary: `Humanizer skill probe failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
