// bin/lib/doctor/probes/humanizer-skill-presence.ts
//
// DOCT-02d: Humanizer skill presence probe.
// D-15 severity: PASS when ~/.claude/skills/humanizer/ exists with files;
//   WARN when missing or empty (optional Phase 8 dependency).
// D-19 read-only: existsSync + statSync + readdirSync only, no writes.

import type { Probe, ProbeResult } from '../probes.js';
import { isHumanizerSkillPresent } from '../../ecosystem-presence.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const humanizerSkillPresenceProbe: Probe = {
  id: 'humanizer-skill-presence',
  async run(): Promise<ProbeResult> {
    // CR-01: share the detection algorithm with bin/lib/capabilities.ts via
    // ecosystem-presence.ts so both tiers report the same boolean.
    const skillPath = join(homedir(), '.claude', 'skills', 'humanizer');
    if (isHumanizerSkillPresent()) {
      return {
        id: 'humanizer-skill-presence',
        severity: 'PASS',
        summary: `Humanizer skill present at ${skillPath}`,
      };
    }
    return {
      id: 'humanizer-skill-presence',
      severity: 'WARN',
      summary: `Humanizer skill not installed at ${skillPath} — the \`humanize\` verb (Phase 3+) will be unavailable.`,
      fix: 'Install the humanizer skill into ~/.claude/skills/humanizer/. See README humanizer disclosure (PRD §3 & §14).',
    };
  },
};
