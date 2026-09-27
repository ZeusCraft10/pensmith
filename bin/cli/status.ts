// bin/cli/status.ts — `pensmith status` verb entrypoint (UX-01, UX-02, RUN-19).
//
// THIN ORCHESTRATOR over bin/lib/status-view.ts, the view model the MCP
// `paper://state` resource also returns (tier parity: tests/tier-contract/
// status-fields.test.ts). It prints the paper title and name, class,
// `current: §N (step)`, per-section glyphs (✓ ⌛ ⌽, ASCII when the locale is not
// UTF-8), the cost meter (`cost: $X this session / $Y total (cap $Z)`) and the
// router's next action.
//
// `--config` (a flag, not a verb — CONF-01 / RUN-26) prints every effective
// config.toml value with its source (default, preset, intake, config, env,
// flag, global) plus the resolved runtime and each prompt slug's model.
//
// NEVER CRASHES on paper state: status is where the router sends a corrupt
// STATE.json (C4-HIGH) or a corrupt PLAN.md (C6-HIGH); the view reads both
// through the router's guarded helpers. An invalid config is a one-line error
// only under --config (the report exists to show it).
//
// stdout-only (no console.* — keeps a future stdio/MCP frame clean).

import { defineCommand } from 'citty';
import { projectRoot } from '../lib/paths.js';
import { buildStatusView, renderConfigView, renderStatusView } from '../lib/status-view.js';
import { readGoalFromConfig, stopAfterResearchFor } from './goal.js';

export const statusCommand = defineCommand({
  meta: {
    name: 'status',
    description: 'Show the active paper: position, per-section status, cost meter and next action (--config: effective settings).',
  },
  args: {
    config: {
      type: 'boolean',
      description: 'Print every effective config value and its source, the runtime, and each prompt slug\'s model.',
      default: false,
    },
  },
  async run({ args }) {
    const paperRoot = projectRoot();

    if (args.config === true) {
      process.stdout.write((await renderConfigView(paperRoot)) + '\n');
      return { ok: true, mode: 'config' };
    }

    // Goal-aware tier: pass the goal→stopAfterResearch mapping so the surfaced
    // "next" line reflects the learning hard-stop. status is READ-ONLY — it does
    // not render TUTORIAL.md (rendering belongs to next/resume/bare).
    const stop = stopAfterResearchFor(readGoalFromConfig(paperRoot));
    const view = await buildStatusView(paperRoot, { tier: 'cli', stopAfterResearch: stop });
    process.stdout.write(renderStatusView(view) + '\n');
    if (view.problem === 'no-paper') return { ok: false, reason: 'no-paper' };
    if (view.problem === 'corrupt-state') return { ok: false, reason: 'corrupt-state' };
    return { ok: true, next: view.next.split(' ')[0] ?? view.next, view };
  },
});

export default statusCommand;
