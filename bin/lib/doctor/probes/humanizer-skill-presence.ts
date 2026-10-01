// bin/lib/doctor/probes/humanizer-skill-presence.ts
//
// DOCT-02d: Humanizer skill presence probe.
// D-15 severity: PASS when the humanizer skill paths.ts humanizerSkillPath
//   resolves exists — ~/.claude/skills/humanizer/SKILL.md ($CLAUDE_CONFIG_DIR
//   when set), an account-synced skill or an installed plugin's (the file the
//   Tier-2 humanizer reads, EXP-14), naming the file; WARN when none is (an
//   optional dependency: done then skips the humanize step and says so).
// D-19 read-only: statSync only, no writes.

import type { Probe, ProbeResult } from '../probes.js';
import { isHumanizerSkillPresent } from '../../ecosystem-presence.js';
import { humanizerSkillPath, humanizerSkillSearchDescription, userHomeDir } from '../../paths.js';
import { join } from 'node:path';

export const humanizerSkillPresenceProbe: Probe = {
  id: 'humanizer-skill-presence',
  async run(): Promise<ProbeResult> {
    // CR-01: share the detection algorithm with bin/lib/capabilities.ts via
    // ecosystem-presence.ts so both tiers report the same boolean.
    const skillPath = humanizerSkillPath() ?? join(userHomeDir(), '.claude', 'skills', 'humanizer', 'SKILL.md');
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
      summary: `Humanizer skill not installed (looked for ${humanizerSkillSearchDescription()}) — \`pensmith done\` will skip the humanize step.`,
      fix: 'Install the humanizer skill into ~/.claude/skills/humanizer/ (its SKILL.md). See README humanizer disclosure (PRD §3 & §14).',
    };
  },
};
