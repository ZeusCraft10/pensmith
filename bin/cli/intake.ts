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
import { parse as parseToml } from 'smol-toml';
import { loadPrompt, interpolate } from '../lib/prompt-loader.js';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { paperDir } from '../lib/paths.js';
import { loadState } from '../lib/state.js';
import { registerPaperInGlobalLibrary } from '../lib/global-library.js';
import {
  buildStyleProfile,
  checkAndRegisterFingerprint,
  writeStyleProfile,
} from '../lib/style-match.js';

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

/**
 * Resolve the paper's display name + class. `name` falls back to the project
 * folder basename; `class` reads config.toml `[project] class` when present,
 * defaulting to 'Unfiled'. Both reads are best-effort — never throw.
 */
function resolvePaperMeta(cwd: string): { name: string; class: string } {
  const name = path.basename(cwd) || 'Untitled paper';
  let klass = 'Unfiled';
  try {
    const cfgPath = path.join(cwd, 'config.toml');
    if (existsSync(cfgPath)) {
      const cfg = parseToml(readFileSync(cfgPath, 'utf8')) as {
        project?: { class?: unknown; title?: unknown };
      };
      const c = cfg.project?.class;
      if (typeof c === 'string' && c.trim()) klass = c.trim();
      const t = cfg.project?.title;
      if (typeof t === 'string' && t.trim()) {
        return { name: t.trim(), class: klass };
      }
    }
  } catch {
    // best-effort: a malformed config.toml must not break intake.
  }
  return { name, class: klass };
}

/**
 * Best-effort paperId from STATE.json (loadState). Returns null when STATE.json
 * is not yet present (the Tier-2 placeholder path runs before init in some
 * flows) — callers then WARN-skip registration but the producer can still build
 * the per-paper STYLE.json using a folder-derived synthetic identity.
 */
async function resolvePaperId(cwd: string): Promise<string | null> {
  try {
    const state = await loadState(cwd);
    return state.paperId;
  } catch {
    return null;
  }
}

/**
 * LIB-04 — register the paper in the GLOBAL PAPER registry as a NON-FATAL side
 * effect (Open-Q4): id (paperId), name, folderPath (REQUIRED — `open` switches
 * to it and `list` derives status from this paper's STATE.json), class, and a
 * SEEDED status:'intake'.
 *
 * The hardcoded status:'intake' is INTENTIONAL and SUFFICIENT: per DERIVE-AT-
 * DISPLAY (08-01), `list` computes the LIVE lifecycle status from each paper's
 * own STATE.json at display time. intake SEEDS the entry — it does NOT, and must
 * NOT, chase status across later verbs (research/outline/…); doing so would
 * reintroduce the staleness the derive-at-display model removes. NO other verb
 * UPSERTs status. (T-08-05-07.)
 */
async function registerPaperNonFatal(
  cwd: string,
  paperId: string | null,
  meta: { name: string; class: string },
): Promise<void> {
  try {
    if (!paperId) {
      process.stderr.write(
        'pensmith new: WARN — no paperId yet (STATE.json absent); skipping global-library registration (non-fatal).\n',
      );
      return;
    }
    const now = new Date().toISOString();
    await registerPaperInGlobalLibrary({
      id: paperId,
      name: meta.name,
      folderPath: path.resolve(cwd),
      class: meta.class,
      status: 'intake',
      createdAt: now,
      updatedAt: now,
    });
  } catch (e) {
    process.stderr.write(
      `pensmith new: WARN — global-library registration failed (non-fatal): ${(e as Error).message}\n`,
    );
  }
}

/**
 * STYL-01/02 PRODUCER (08-05) — the live caller of buildStyleProfile /
 * checkAndRegisterFingerprint / writeStyleProfile. This is the producer end of
 * the style-match loop; write.ts (Task 1) is the consumer.
 *
 * Order is LOAD-BEARING: build → check → PRINT NOTICE → write, so a
 * writeStyleProfile failure can never SUPPRESS an already-printed reuse notice
 * (T-08-05-06). The cross-paper-reuse notice is UNCONDITIONAL — it surfaces on
 * stdout whenever a prior paper shares the fingerprint, is NOT --yolo-gated, and
 * is NOT suppressible (STYL-02 / Anti-Pattern). The whole producer is wrapped in
 * try/catch that WARNs and never fails the verb (T-08-05-04) — a bad samples dir
 * must not break intake.
 */
async function runStyleProducerNonFatal(
  cwd: string,
  samplesDir: string,
  paperId: string | null,
  name: string,
): Promise<void> {
  try {
    // A synthetic, folder-derived identity is used for the fingerprint registry
    // only when STATE.json has no paperId yet — the STYLE.json still gets built
    // and the reuse detection still works.
    const fpPaperId = paperId ?? `unregistered:${path.resolve(cwd)}`;

    const profile = await buildStyleProfile(samplesDir); // build
    const { priorPapers } = await checkAndRegisterFingerprint( // check
      profile.fingerprint,
      fpPaperId,
      name,
    );

    // PRINT the unconditional cross-paper-reuse notice BEFORE the write.
    if (priorPapers.length > 0) {
      const names = priorPapers
        .map((p) => p.paperName || p.paperId)
        .join(', ');
      process.stdout.write(
        `pensmith new: NOTICE — these writing samples were already used to style a prior paper: ${names}. ` +
          `Style Match mirrors your own voice; reuse across papers is surfaced here for transparency.\n`,
      );
    }

    await writeStyleProfile(paperDir(cwd), profile); // write .paper/STYLE.json
    process.stdout.write(
      `pensmith new: wrote style profile to ${path.join(paperDir(cwd), 'STYLE.json')}\n`,
    );
  } catch (e) {
    process.stderr.write(
      `pensmith new: WARN — style-match producer failed (non-fatal): ${(e as Error).message}\n`,
    );
  }
}

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
    // Phase 8 STYL-01/02 (08-05) — OPT-IN style-match producer. NOT a 17th verb:
    // an absent flag means NO profiling. When provided, intake builds the paper's
    // .paper/STYLE.json from these writing samples and surfaces cross-paper reuse
    // UNCONDITIONALLY. The Tier-1 workflow body may surface this as an interactive
    // prompt; this CLI flag is the deterministic Tier-2 path.
    styleSamples: {
      type: 'string',
      description:
        'Opt-in: path to a folder of your writing samples to match your voice (.md/.txt/.docx).',
    },
    yolo: {
      type: 'boolean',
      description: 'Skip the approval gate (auto-accept the intake).',
      default: false,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const targetPath = path.join(paperDir(), 'INTAKE.md');
    const noLlm = process.env['PENSMITH_NO_LLM'] === '1' || !process.env['ANTHROPIC_API_KEY'];
    const thesisSeed = typeof args.thesis === 'string' && args.thesis.trim()
      ? args.thesis.trim()
      : '';
    const styleSamples =
      typeof args.styleSamples === 'string' && args.styleSamples.trim()
        ? args.styleSamples.trim()
        : '';

    // NON-FATAL side effects run at the END of a successful intake (before each
    // return). registerPaperNonFatal SEEDS the global-library entry (LIB-04);
    // runStyleProducerNonFatal is the OPT-IN style-match producer (STYL-01/02) —
    // it runs ONLY when --style-samples is provided. Both never fail the verb.
    const meta = resolvePaperMeta(cwd);
    const runSideEffects = async (): Promise<void> => {
      const paperId = await resolvePaperId(cwd);
      await registerPaperNonFatal(cwd, paperId, meta);
      if (styleSamples) {
        await runStyleProducerNonFatal(cwd, styleSamples, paperId, meta.name);
      }
    };

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
      await runSideEffects();
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
    await runSideEffects();
    return { ok: true, path: targetPath, mode: 'tier2-placeholder' };
  },
});

export default intakeCommand;
