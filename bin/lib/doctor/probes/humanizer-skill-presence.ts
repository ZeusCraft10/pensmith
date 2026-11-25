// bin/lib/doctor/probes/humanizer-skill-presence.ts
//
// DOCT-02d: Humanizer skill presence probe.
// D-15 severity: PASS when a non-empty `humanizer` skill directory exists as a
//   user, project or plugin skill; WARN otherwise (optional dependency).
// D-19 read-only: readdirSync only, no writes.

import type { Probe, ProbeResult } from '../probes.js';
import { humanizerSkillScan } from '../../ecosystem-presence.js';

export const humanizerSkillPresenceProbe: Probe = {
  id: 'humanizer-skill-presence',
  async run(): Promise<ProbeResult> {
    const { locations, present } = humanizerSkillScan();
    if (present) {
      return {
        id: 'humanizer-skill-presence',
        severity: 'PASS',
        summary: 'Humanizer skill installed. In this alpha, `pensmith done` does not run it yet (the humanize step is skipped).',
      };
    }
    return {
      id: 'humanizer-skill-presence',
      severity: 'WARN',
      summary: 'Humanizer skill not found (optional; in this alpha `pensmith done` skips the humanize step either way).',
      detail: `Checked: ${locations.join(', ')}`,
      fix: 'Install a skill named `humanizer` (user skills: ~/.claude/skills/humanizer/). It improves readability; see the README.',
    };
  },
};
