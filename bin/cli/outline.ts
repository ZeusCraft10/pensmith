// bin/cli/outline.ts — `pensmith outline` verb entrypoint (OUTL-01).
//
// Plan 03-07 Task 7.2 — Tier-2 thin orchestrator. In Tier 1 the workflow
// body delegates to the model with the `outline-author` prompt
// (D-12 LOCKED slug). In Tier 2 (portable CLI) the verb calls complete()
// via the Phase 11 transport (GEN-02).
//
// Phase 11 wiring: complete() handles isNoLlmMode() short-circuit before
// key resolution, so verbs do NOT check PENSMITH_NO_LLM themselves.
//   - With PENSMITH_NO_LLM=1: complete() returns offline mock (no key needed).
//   - With ANTHROPIC_API_KEY set: complete() makes real API call.
//   - With no key: getProviderApiKey() throws MissingApiKeyError → fail-loud.
//
// CLAUDE.md non-negotiable: outline approval is default-ON (only skips with
// --yolo). The gate mirrors the revise.ts ApprovalUnavailableError pattern:
// TTY → @clack/prompts confirm; non-TTY without --yolo → exit code 3.

import { defineCommand } from 'citty';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { paperDir } from '../lib/paths.js';
import { loadPrompt, interpolate } from '../lib/prompt-loader.js';
import { complete, MissingApiKeyError, resolveProviderId } from '../lib/anthropic.js';
import { getProviderApiKey } from '../lib/runtime.js';

// Phase 11 — the outline placeholder constant has been removed. outline now calls
// complete() for real generation (GEN-02). With no key configured: fail-loud
// (GEN-06). With PENSMITH_NO_LLM=1: complete() returns offline mock transparently.

/**
 * ApprovalUnavailableError — thrown by the approval gate when the terminal is
 * not interactive and --yolo was not passed. Mirrors revise.ts shape exactly.
 * Exit code 3 (per CLAUDE.md non-negotiable: approval-gates default-on).
 */
class ApprovalUnavailableError extends Error {
  exitCode = 3 as const;
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalUnavailableError';
  }
}

/**
 * Run the outline approval gate.
 *
 * - When args.yolo is true: auto-approve immediately (no prompt).
 * - When TTY: show @clack/prompts confirm dialog.
 * - When non-TTY and !yolo: throw ApprovalUnavailableError (exit 3).
 */
async function runApprovalGate(outlineText: string, yolo: boolean): Promise<boolean> {
  if (yolo) return true;

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    throw new ApprovalUnavailableError(
      'outline: approval gate requires an interactive terminal. ' +
      'Use --yolo to auto-accept (CLAUDE.md non-negotiable: approval-gates default-on).',
    );
  }

  const clack = await import('@clack/prompts');
  // Show a preview of the proposed outline (first 500 chars).
  const preview = outlineText.slice(0, 500) + (outlineText.length > 500 ? '\n…(truncated)' : '');
  clack.note(preview, 'Proposed outline');
  const ok = await clack.confirm({ message: 'Accept this outline and write OUTLINE.md?' });
  return ok === true && !clack.isCancel(ok);
}

export const outlineCommand = defineCommand({
  meta: {
    name: 'outline',
    description: 'Propose a section outline (approval-gated unless --yolo).',
  },
  args: {
    yolo: {
      type: 'boolean',
      description: 'Skip the approval gate.',
      default: false,
    },
  },
  async run({ args }) {
    const outlinePath = path.join(paperDir(), 'OUTLINE.md');

    // ── Phase 11: GEN-06 fail-loud probe (BEFORE any prompt/complete() work) ──
    // Only probe for key presence when NOT in offline mode.
    // complete() handles PENSMITH_NO_LLM=1 internally (before key resolution).
    const noLlm = process.env['PENSMITH_NO_LLM'] === '1';
    if (!noLlm) {
      try {
        // CR-01: resolve provider ID dynamically so OpenAI-only configs don't
        // false-positive with "no config for 'anthropic'". resolveProviderId()
        // is the single source of truth (shared with complete()).
        const providerId = await resolveProviderId();
        await getProviderApiKey(providerId);
      } catch (e) {
        if (e instanceof MissingApiKeyError) {
          process.stderr.write(
            'pensmith outline: ERROR — no LLM key configured.\n' +
            'Set ANTHROPIC_API_KEY (or configure a provider in runtime.json) to enable real generation.\n' +
            'Run inside Claude Code (Tier 1) for key-free operation.\n',
          );
          process.exitCode = 1;
          return { ok: false, mode: 'no-key-configured' };
        }
        throw e;
      }
    }

    // ── Load and interpolate the outline-author prompt (D-12 LOCKED) ──
    // The outline-author template requires: {{topic}}, {{length}},
    // {{candidateSources}}, {{discipline}}. In Tier 2, we derive these
    // best-effort from the existing INTAKE.md (written by intake verb).
    // This gives the model context to work with; the workflow body populates
    // them from research output in Tier 1.
    const intakePath = path.join(paperDir(), 'INTAKE.md');
    const intakeContent = existsSync(intakePath)
      ? readFileSync(intakePath, 'utf8').trim()
      : '(no intake content available — run `pensmith new` first)';

    const prompt = loadPrompt('outline-author');
    const interpolatedPrompt = interpolate(prompt, {
      topic: intakeContent,
      length: '2000',           // default word-count target; intake captures the real value
      candidateSources: '[]',   // populated by research in full workflow
      discipline: 'general',    // populated from intake answers in full workflow
    });

    // ── Call the transport (GEN-02) ──
    const result = await complete({
      system: interpolatedPrompt,
      messages: [{ role: 'user', content: intakeContent }],
      scope: 'task',
      scopeId: 'outline',
    });

    // ── Approval gate (CLAUDE.md non-negotiable: default-ON, skip with --yolo) ──
    let approved: boolean;
    try {
      approved = await runApprovalGate(result.text, args.yolo === true);
    } catch (e) {
      if (e instanceof ApprovalUnavailableError) {
        process.stderr.write(`pensmith outline: ${e.message}\n`);
        process.exitCode = e.exitCode;
        return { ok: false, mode: 'approval-unavailable' };
      }
      throw e;
    }

    if (!approved) {
      process.stdout.write('pensmith outline: outline rejected — no OUTLINE.md written.\n');
      return { ok: false, mode: 'rejected' };
    }

    await atomicWriteFile(outlinePath, result.text);
    process.stdout.write(`pensmith outline: wrote OUTLINE.md to ${outlinePath}\n`);
    return { ok: true, path: outlinePath, mode: 'real' };
  },
});

export default outlineCommand;
