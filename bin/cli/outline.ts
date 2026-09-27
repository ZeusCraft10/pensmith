// bin/cli/outline.ts — `pensmith outline` verb entrypoint (OUTL-01).
//
// Plan 03-07 Task 7.2 — Tier-2 thin orchestrator. In Tier 1 the workflow
// body delegates to the model with the `outline-author` prompt
// (D-12 LOCKED slug). In Tier 2 (portable CLI) the verb calls complete()
// via the Phase 11 transport (GEN-02).
//
// Phase 17 wiring (RUN-07, RUN-25): assertLlmConfigured('outline') runs
// before any model work (one-line MissingApiKeyError when no provider is
// usable; skipped under PENSMITH_NO_LLM=1). outline-author is a STRUCTURED
// slug: complete() returns the validated OutlineSchema object and OUTLINE.md
// is rendered from it (outline-parse.ts renderOutlineMd) — model prose never
// reaches the file.
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
import { complete, assertLlmConfigured } from '../lib/anthropic.js';
import { parseOutline, renderOutlineMd } from '../lib/outline-parse.js';
import { parseIntakeMd, escapeTemplateTokens } from '../lib/intake-parse.js';
import { tryReadPaperConfigSync } from '../lib/config.js';
import { parseLengthWords } from '../lib/estimator.js';
import type { OutlineContract } from '../lib/llm-contracts.js';
import {
  initSection,
  initState,
  loadState,
  StateAlreadyExistsError,
  StateNotFoundError,
} from '../lib/state.js';

// outline-author is a STRUCTURED slug (RUN-25): complete() returns the
// schema-validated OutlineSchema object (GRND-07 fields), and OUTLINE.md is
// rendered from it by outline-parse.ts renderOutlineMd — the canonical table
// parseOutline reads back. With no key configured: fail-loud (GEN-06 / RUN-07).
// With PENSMITH_NO_LLM=1: complete() returns a deterministic 3-section stub.

/** One library candidate as the outline prompt sees it (T-12-02: JSON-encoded). */
interface OutlineCandidate {
  citekey: string;
  title?: string;
  authors?: string[];
  year?: number;
  doi?: string;
}

/**
 * Read the research library (LIBRARY.json: `{entries: [...]}` or a bare array)
 * as the outline prompt's candidate list. Best-effort: absent or malformed → [].
 */
function readLibraryCandidates(paperRoot: string): OutlineCandidate[] {
  const libPath = path.join(paperDir(paperRoot), 'LIBRARY.json');
  if (!existsSync(libPath)) return [];
  try {
    const raw = JSON.parse(readFileSync(libPath, 'utf8')) as unknown;
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as { entries?: unknown }).entries)
        ? (raw as { entries: unknown[] }).entries
        : [];
    const out: OutlineCandidate[] = [];
    for (const e of list) {
      if (!e || typeof e !== 'object') continue;
      const r = e as Record<string, unknown>;
      if (typeof r['citekey'] !== 'string' || !r['citekey']) continue;
      const c: OutlineCandidate = { citekey: r['citekey'] as string };
      if (typeof r['title'] === 'string') c.title = r['title'];
      if (Array.isArray(r['authors'])) c.authors = (r['authors'] as unknown[]).filter((a): a is string => typeof a === 'string').slice(0, 3);
      if (typeof r['year'] === 'number') c.year = r['year'];
      if (typeof r['doi'] === 'string') c.doi = r['doi'];
      out.push(c);
    }
    return out;
  } catch {
    return [];
  }
}

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

/**
 * Register every section in `outlineMd` into STATE.json (audit #1). The router
 * gates pipeline advancement on state.sections (router.ts:182-183); without this
 * a valid OUTLINE.md leaves state.sections empty and bare `pensmith`/next/resume
 * loop on `outline` forever. initSection is idempotent (D-08), so re-running is
 * safe. Best-effort: an outline with no parseable section table (the offline
 * placeholder, or a malformed model response) WARNs and registers nothing rather
 * than crashing — the per-section pipeline simply cannot advance until the
 * outline carries the locked section table. Returns the count registered.
 */
async function registerOutlineSections(paperRoot: string, outlineMd: string): Promise<number> {
  let parsed;
  try {
    parsed = parseOutline(outlineMd);
  } catch (e) {
    process.stderr.write(
      `pensmith outline: WARN — OUTLINE.md has no parseable section table, so no sections were ` +
      `registered in STATE.json; the per-section pipeline (plan/write/verify) cannot advance until the ` +
      `outline carries a "| # | slug | title | depends_on | word target | assigned_sources |" table. ` +
      `(${(e as Error).message})\n`,
    );
    return 0;
  }
  if (parsed.sections.length === 0) return 0;

  // Ensure STATE.json exists (intake normally seeds it via initState; be
  // defensive for a hand-assembled workspace). initState is idempotent through
  // StateAlreadyExistsError.
  try {
    await loadState(paperRoot);
  } catch (e) {
    if (e instanceof StateNotFoundError) {
      try {
        await initState(paperRoot);
      } catch (e2) {
        if (!(e2 instanceof StateAlreadyExistsError)) throw e2;
      }
    } else {
      throw e;
    }
  }

  for (const s of parsed.sections) {
    await initSection(paperRoot, s.n, s.slug);
  }
  return parsed.sections.length;
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
    force: {
      type: 'boolean',
      description: 'Regenerate OUTLINE.md even if a valid one already exists (audit #4).',
      default: false,
    },
  },
  async run({ args }) {
    const paperRoot = process.cwd();
    const outlinePath = path.join(paperDir(), 'OUTLINE.md');

    // Audit #4: NEVER clobber a valid, parseable OUTLINE.md. bare /pensmith,
    // `next`, and `resume` re-dispatch `outline` whenever state.sections is empty
    // (router.ts:182-183); without this guard a re-dispatch overwrites a user- or
    // model-authored outline with the regenerated (often table-less, in offline
    // mode) text and destroys it. When a valid outline already exists, register
    // its sections idempotently (audit #1) and return — pass --force to redo.
    if (args.force !== true && existsSync(outlinePath)) {
      try {
        const existing = readFileSync(outlinePath, 'utf8');
        if (parseOutline(existing).sections.length > 0) {
          const count = await registerOutlineSections(paperRoot, existing);
          process.stdout.write(
            `pensmith outline: OUTLINE.md already present (${count} section(s)); ` +
            `registered in STATE.json. Not regenerating — pass --force to redo.\n`,
          );
          return { ok: true, path: outlinePath, mode: 'existing', sections: count };
        }
      } catch {
        // Existing OUTLINE.md is not a parseable section table (e.g. an offline
        // placeholder from a prior dry-run) — fall through and regenerate.
      }
    }

    // ── GEN-06 / RUN-07 fail-loud probe (BEFORE any prompt/complete() work) ──
    await assertLlmConfigured('outline');

    // ── Load and interpolate the outline-author prompt (D-12 LOCKED) ──
    // The outline-author template requires: {{topic}}, {{length}},
    // {{candidateSources}}, {{discipline}}. In Tier 2 they come from INTAKE.md
    // (topic, discipline), [project] length_target_words or the assignment's
    // stated length, and the research library (the citekeys the outline may
    // assign). User-derived strings are escaped against template injection.
    const intakePath = path.join(paperDir(), 'INTAKE.md');
    const intakeContent = existsSync(intakePath)
      ? readFileSync(intakePath, 'utf8').trim()
      : '(no intake content available — run `pensmith new` first)';
    const intake = parseIntakeMd(intakeContent);
    const config = tryReadPaperConfigSync(paperRoot);
    const lengthWords = config?.project?.length_target_words ?? parseLengthWords(intakeContent) ?? 1500;
    const candidates = readLibraryCandidates(paperRoot);
    const topic = intake.topic || 'the assigned topic';

    const prompt = loadPrompt('outline-author');
    const interpolatedPrompt = interpolate(prompt, {
      topic: escapeTemplateTokens(topic),
      length: String(lengthWords),
      candidateSources: JSON.stringify(candidates, null, 2),
      discipline: escapeTemplateTokens(intake.discipline),
    });

    // ── Call the transport (GEN-02) — structured outline-author (RUN-25) ──
    const result = await complete<OutlineContract>({
      slug: 'outline-author',
      system: interpolatedPrompt,
      messages: [{ role: 'user', content: intakeContent }],
      stubHint: { topic, length: lengthWords, sources: candidates.map((c) => c.citekey) },
    });
    const outlineMd = renderOutlineMd(
      result.data as OutlineContract,
      config?.project?.title?.trim() || topic,
    );

    // ── Approval gate (CLAUDE.md non-negotiable: default-ON, skip with --yolo) ──
    let approved: boolean;
    try {
      approved = await runApprovalGate(outlineMd, args.yolo === true);
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

    await atomicWriteFile(outlinePath, outlineMd);
    process.stdout.write(`pensmith outline: wrote OUTLINE.md to ${outlinePath}\n`);

    // Audit #1: register the outline's sections into STATE.json so the router can
    // advance to the per-section plan/write/verify pipeline (best-effort).
    const sectionCount = await registerOutlineSections(paperRoot, outlineMd);
    if (sectionCount > 0) {
      process.stdout.write(
        `pensmith outline: registered ${sectionCount} section(s) in STATE.json.\n`,
      );
    }
    return { ok: true, path: outlinePath, mode: 'real', sections: sectionCount };
  },
});

export default outlineCommand;
