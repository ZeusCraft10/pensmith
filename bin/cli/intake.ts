// bin/cli/intake.ts — `pensmith new` / `pensmith intake` verb entrypoint
// (INTK-01, ARCH-02; CYCLE-2 M-1 canonical filename).
//
// Plan 03-07 Task 7.2 — Tier-2 thin orchestrator. The Tier-1 (MCP plugin)
// path delegates to the model via the workflow body's <capability_check>
// branch; the Tier-2 (portable Node CLI) path runs in deterministic-only
// mode and writes a placeholder INTAKE.md so downstream verbs (research,
// outline) have a file to read.
//
// Phase 3 Tier-2 fallback: see Plan 07 amendment.
//   When PENSMITH_NO_LLM=1 OR no ANTHROPIC_API_KEY is set, this verb does
//   NOT invoke a model. It writes `.paper/INTAKE.md` with a placeholder
//   string the operator can hand-edit, then exits 0. Phase 4 adds
//   bin/lib/anthropic.ts with a real chat() helper.
//
// D-12 LOCKED prompt slug: `intake-clarifier` (registered in
// bin/lib/prompt-loader.ts EXPECTED_PROMPT_HASHES).

import { defineCommand } from 'citty';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { loadPrompt, interpolate } from '../lib/prompt-loader.js';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { paperDir } from '../lib/paths.js';

const TIER2_PLACEHOLDER = [
  '# Pensmith Intake (Tier-2 placeholder)',
  '',
  '[Pensmith Tier 2: this section requires LLM drafting. Run in Claude Code,',
  ' or set ANTHROPIC_API_KEY for direct API access (Phase 4 work).]',
  '',
  '## Topic',
  '',
  '(hand-edit this file or re-run inside the Claude Code plugin so the',
  ' `intake-clarifier` prompt can populate it.)',
  '',
].join('\n');

export const intakeCommand = defineCommand({
  meta: {
    name: 'new',
    description: 'Start a new paper — clarify topic + assignment (intake step).',
  },
  args: {
    from: {
      type: 'string',
      description: 'Path to an assignment file to seed the intake (optional).',
    },
    // Phase 8 ERGO-05 / Open-Q2: an OPTIONAL thesis seed (NOT a new verb). The
    // `sketch` verb dispatches `new` with this pre-filled after the user
    // confirms a candidate thesis; a manual `pensmith new --thesis "…"` works
    // identically. When set, it pre-fills the intake placeholder.
    thesis: {
      type: 'string',
      description: 'A candidate thesis to pre-fill the intake (optional; supplied by `sketch`).',
    },
    yolo: {
      type: 'boolean',
      description: 'Skip the approval gate (auto-accept the intake).',
      default: false,
    },
  },
  async run({ args }) {
    const targetPath = path.join(paperDir(), 'INTAKE.md');
    const noLlm = process.env['PENSMITH_NO_LLM'] === '1' || !process.env['ANTHROPIC_API_KEY'];
    const thesisSeed = typeof args.thesis === 'string' && args.thesis.trim()
      ? args.thesis.trim()
      : '';

    if (noLlm) {
      // Phase 3 Tier-2 fallback: see Plan 07 amendment.
      const fromText = args.from && existsSync(args.from)
        ? readFileSync(args.from, 'utf8')
        : '';
      let body = fromText
        ? `${TIER2_PLACEHOLDER}\n## Seed (from --from ${args.from})\n\n${fromText}\n`
        : TIER2_PLACEHOLDER;
      if (thesisSeed) {
        body = `${body}\n## Candidate thesis (from sketch)\n\n${thesisSeed}\n`;
      }
      await atomicWriteFile(targetPath, body);
      process.stdout.write(`pensmith new: wrote Tier-2 placeholder to ${targetPath}\n`);
      return { ok: true, path: targetPath, mode: 'tier2-placeholder' };
    }

    // Tier-1 path: load the prompt (hash-validated by prompt-loader)
    // and hand it to the model. In Phase 3 the actual model invocation
    // lives in the workflow body — this branch is reached only when an
    // operator runs the CLI verb directly with an API key, which is a
    // Phase-4 path. For now: load the prompt to fail-fast on hash drift,
    // then emit the placeholder.
    const prompt = loadPrompt('intake-clarifier');
    const seed = args.from && existsSync(args.from) ? readFileSync(args.from, 'utf8') : '';
    const _interpolated = interpolate(prompt, { seed });
    void _interpolated; // referenced for D-12 hash-pin enforcement at runtime
    await atomicWriteFile(targetPath, TIER2_PLACEHOLDER);
    process.stdout.write(`pensmith new: wrote Tier-2 placeholder to ${targetPath} (Phase 4 will wire real chat())\n`);
    return { ok: true, path: targetPath, mode: 'tier2-placeholder' };
  },
});

export default intakeCommand;
