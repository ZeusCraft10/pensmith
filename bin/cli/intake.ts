// bin/cli/intake.ts — `pensmith new` / `pensmith intake` verb entrypoint
// (INTK-01, ARCH-02; CYCLE-2 M-1 canonical filename).
//
// Plan 03-07 Task 7.2 — Tier-2 thin orchestrator. The Tier-1 (MCP plugin)
// path delegates to the model via the workflow body's <capability_check>
// branch; the Tier-2 (portable Node CLI) path calls complete() via the
// Tier-2 LLM transport (GEN-02, Phase 11).
//
// Phase 11 wiring: complete() handles isNoLlmMode() short-circuit before
// key resolution, so verbs do NOT check PENSMITH_NO_LLM themselves.
//   - With PENSMITH_NO_LLM=1: complete() returns offline mock (no key needed).
//   - With ANTHROPIC_API_KEY set: complete() makes real API call.
//   - With no key: getProviderApiKey() throws MissingApiKeyError → fail-loud.
//
// D-12 LOCKED prompt slug: `intake-clarifier` (registered in
// bin/lib/prompt-loader.ts EXPECTED_PROMPT_HASHES).

import { defineCommand } from 'citty';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { loadPrompt, interpolate } from '../lib/prompt-loader.js';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { redactPii, diffPii } from '../lib/pii.js';
import { complete, MissingApiKeyError, resolveProviderId } from '../lib/anthropic.js';
import { getProviderApiKey } from '../lib/runtime.js';

// EGRESS SEAM (H3 — test-observable model-bound payload). intake calls the
// model-bound interpolate THROUGH this module-local indirection so the egress
// assertion (tests/intake-pii-egress.test.ts) can intercept the exact payload
// that crosses the LLM boundary. Native ESM module namespaces are SEALED under
// Node 24 (the prompt-loader export cannot be monkeypatched from outside), so a
// replaceable seam in THIS module is the only runtime-portable interception
// point. Defaults to the real interpolate; production behavior is unchanged.
let _interpolate: (template: string, vars: Record<string, string>) => string = interpolate;

/** Test-only seam: override the model-bound interpolate to capture egress (H3). */
export function __setInterpolateForTest(
  fn: (template: string, vars: Record<string, string>) => string,
): () => void {
  const prev = _interpolate;
  _interpolate = fn;
  return () => {
    _interpolate = prev;
  };
}
import { paperDir } from '../lib/paths.js';
import { initState, loadState } from '../lib/state.js';
import { registerPaperInGlobalLibrary } from '../lib/global-library.js';
import {
  buildStyleProfile,
  checkAndRegisterFingerprint,
  writeStyleProfile,
} from '../lib/style-match.js';

// Phase 11 — the intake placeholder constant has been removed. intake now calls
// complete() for real generation (GEN-02). With no key configured: fail-loud
// (GEN-06). With PENSMITH_NO_LLM=1: complete() returns offline mock transparently.

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
 * The educator-mode goal enum (ERGO-07 / resolved Open-Q2): a SHORT enum, NOT a
 * 17th verb. Coerce any unrecognized value to the default 'draft'. GOAL logic
 * is confined to the CLI tier (intake/goal.ts) — Foundation never sees it (H1).
 */
function coerceGoal(v: unknown): 'draft' | 'learning' | 'both' {
  return v === 'learning' || v === 'both' ? v : 'draft';
}

/**
 * Persist `project.goal` (and `project.pii_redaction` when set via the CLI arg)
 * into config.toml. config.toml is the CANONICAL store (RESEARCH A2 + PRD §10);
 * we do NOT add a STATE.json field. The read+merge+write is best-effort: a
 * malformed config.toml must NOT break intake (mirrors resolvePaperMeta's
 * try/catch). On any persist failure we emit a VISIBLE stderr WARN AND keep the
 * selected goal in memory for THIS session (M1 — a silent persist failure must
 * not strand the learning goal). Written via atomicWriteFile (D-07 chokepoint).
 */
async function persistProjectConfig(
  cwd: string,
  goal: 'draft' | 'learning' | 'both',
  piiRedactArg: boolean | undefined,
): Promise<void> {
  try {
    const cfgPath = path.join(cwd, 'config.toml');
    let cfg: { project?: Record<string, unknown> } = {};
    if (existsSync(cfgPath)) {
      try {
        cfg = parseToml(readFileSync(cfgPath, 'utf8')) as typeof cfg;
      } catch {
        cfg = {}; // malformed config.toml → start from a clean object (best-effort).
      }
    }
    const project = { ...(cfg.project ?? {}) };
    project.goal = goal;
    // Only persist pii_redaction when the user set it explicitly via the CLI arg
    // (the arg WINS over config — see precedence comment at the call site).
    if (piiRedactArg !== undefined) project.pii_redaction = piiRedactArg;
    const next = { ...cfg, project };
    await atomicWriteFile(cfgPath, stringifyToml(next));
  } catch (e) {
    process.stderr.write(
      `pensmith new: WARN — could not persist goal to config.toml (non-fatal; goal kept in-memory for this session): ${(e as Error).message}\n`,
    );
  }
}

/**
 * Resolve the PII opt-in. PII redaction is OPT-IN per the non-negotiables. The
 * CLI `--pii-redact` arg WINS over the config.toml `[project] pii_redaction`
 * value when BOTH are present (L6 precedence). Returns `{ on, argSet }` so the
 * caller can persist the arg value only when it was explicitly provided.
 */
function resolvePiiRedact(
  cwd: string,
  argValue: unknown,
): { on: boolean; argSet: boolean } {
  // CLI arg WINS (explicit user intent for this run).
  if (typeof argValue === 'boolean') return { on: argValue, argSet: true };
  // Else fall back to config.toml [project] pii_redaction (best-effort).
  try {
    const cfgPath = path.join(cwd, 'config.toml');
    if (existsSync(cfgPath)) {
      const cfg = parseToml(readFileSync(cfgPath, 'utf8')) as {
        project?: { pii_redaction?: unknown };
      };
      if (cfg.project?.pii_redaction === true) return { on: true, argSet: false };
    }
  } catch {
    // best-effort — a malformed config.toml defaults PII OFF (opt-in).
  }
  return { on: false, argSet: false };
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
    // Phase 9 ERGO-07 / resolved Open-Q2 — the educator-mode workflow goal. A
    // SHORT enum (draft|learning|both), NOT a 17th verb (the 16-verb bijection is
    // unchanged). Persisted to config.toml [project] goal; the goal-aware CLI
    // callers (next/resume/status/bare) read it and map learning ⇒ a hard-stop
    // after research. Anything outside the enum coerces to 'draft'.
    goal: {
      type: 'string',
      description: 'Workflow goal: draft (default), learning, or both.',
      default: 'draft',
    },
    // Phase 9 ERGO-07 / SC-3 — OPT-IN PII redaction. When on, intake redacts the
    // raw answers, writes a reviewable diff, persists redacted text to INTAKE.md
    // and raw text to .paper/INTAKE.raw.local (gitignored), and feeds the model
    // the REDACTED text. The CLI arg WINS over config.toml [project] pii_redaction
    // when both are present. PII is OPT-IN per the non-negotiables.
    'pii-redact': {
      type: 'boolean',
      description: 'Opt-in: redact PII from your answers before they reach the model (H3).',
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
    const rawLocalPath = path.join(paperDir(), 'INTAKE.raw.local');
    const thesisSeed = typeof args.thesis === 'string' && args.thesis.trim()
      ? args.thesis.trim()
      : '';
    const styleSamples =
      typeof args.styleSamples === 'string' && args.styleSamples.trim()
        ? args.styleSamples.trim()
        : '';

    // --- Educator goal (ERGO-07) — coerce + PERSIST to config.toml (canonical). ---
    // The goal arg is the SHORT enum draft|learning|both (default draft); the
    // persisted value is what the goal-aware CLI callers read to drive the
    // learning hard-stop. Persist is best-effort/non-fatal (M1).
    const goal = coerceGoal(args.goal);

    // --- PII opt-in resolution (SC-3). The CLI arg WINS over config.toml. ---
    // The arg is `--pii-redact` (citty key `pii-redact`); the test seam also
    // passes `redactPii`. Honor either spelling. Falls back to config.toml
    // [project] pii_redaction when no arg is given.
    const piiRedactArg =
      typeof args['pii-redact'] === 'boolean'
        ? (args['pii-redact'] as boolean)
        : typeof (args as Record<string, unknown>)['redactPii'] === 'boolean'
          ? ((args as Record<string, unknown>)['redactPii'] as boolean)
          : undefined;
    const { on: piiRedact } = resolvePiiRedact(cwd, piiRedactArg);

    // Persist goal (and pii_redaction when set via arg). Done EARLY so a later
    // failure path still leaves the canonical config in place.
    await persistProjectConfig(cwd, goal, piiRedactArg);

    // --- PII BLOCK — STRUCTURALLY BEFORE loadPrompt/interpolate (T-09-PII-EGRESS). ---
    // Collect the raw ANSWERS (the user's --from seed + thesis seed — NEVER the
    // prompt template). When PII opt-in is on, compute the redaction + a
    // reviewable diff HERE, persist raw → INTAKE.raw.local (gitignored) and
    // redacted → INTAKE.md, and bind egressSeed = redacted. The egress variable
    // (the value interpolated into the model payload) is the REDACTED text — the
    // raw answers never cross the LLM boundary (H3). When opt-in is OFF, raw
    // answers go to INTAKE.md and egressSeed = rawAnswers (today's behavior).
    const fromText = args.from && existsSync(args.from) ? readFileSync(args.from, 'utf8') : '';
    const rawAnswers = [fromText, thesisSeed].filter((s) => s.length > 0).join('\n\n');

    let egressSeed = rawAnswers;
    if (piiRedact) {
      const redacted = redactPii(rawAnswers);
      const diff = diffPii(rawAnswers, redacted);
      // Print the reviewable diff: one line per detected PII span.
      for (const d of diff) {
        process.stdout.write(`pensmith new: [${d.kind}] "${d.raw}" → ${d.tag}\n`);
      }
      // Raw answers → INTAKE.raw.local (gitignored); redacted text is what flows
      // to the model AND to INTAKE.md.
      await atomicWriteFile(rawLocalPath, rawAnswers.endsWith('\n') ? rawAnswers : rawAnswers + '\n');
      egressSeed = redacted;
    }

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

    // ── Phase 11: GEN-06 fail-loud probe (BEFORE any prompt/complete() work) ──
    // getProviderApiKey() is used here as a PRESENCE PROBE only — the resolved
    // key value is never bound to a variable used outside this block (T-01-07).
    // complete() re-resolves the key internally when it makes the HTTP call.
    // NOTE: complete() calls isNoLlmMode() BEFORE getProviderApiKey(), so when
    // PENSMITH_NO_LLM=1 is set, the probe below throws MissingApiKeyError but
    // complete() never reaches key resolution — the offline mock fires first.
    // To preserve this ordering, we call getProviderApiKey ONLY when NOT in
    // offline mode (isNoLlmMode is checked inside complete()). We let complete()
    // handle the offline path transparently. We call the probe for fail-loud only.
    {
      // Only probe for key presence when we are NOT in offline mode.
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
              'pensmith new: ERROR — no LLM key configured.\n' +
              'Set ANTHROPIC_API_KEY (or configure a provider in runtime.json) to enable real generation.\n' +
              'Run inside Claude Code (Tier 1) for key-free operation.\n',
            );
            process.exitCode = 1;
            return { ok: false, mode: 'no-key-configured' };
          }
          throw e;
        }
      }
    }

    // ── CRITICAL (H3 / Pitfall 3): the value interpolated into the model-bound ──
    // payload is `egressSeed` — the REDACTED text when PII opt-in is on (never
    // the raw --from contents). The PII block above already ran, so redaction is
    // by CONTENT here, not merely ordered before this call.
    //
    // egressSeed (REDACTED when piiRedact=true) flows into the prompt via
    // _interpolate seam (test-observable) AND into complete() as the user message.
    // rawAnswers MUST NEVER appear in the complete() call args (T-11-06 / GEN-06).
    const prompt = loadPrompt('intake-clarifier');
    // The intake-clarifier template interpolates {{assignment}} (D-12 LOCKED).
    // Routed through the _interpolate seam so the egress is test-observable (H3).
    const interpolatedPrompt = _interpolate(prompt, { assignment: egressSeed });

    // content is egressSeed (redacted when piiRedact=true) — never rawAnswers (Pitfall 3).
    const result = await complete({
      system: interpolatedPrompt,
      messages: [{ role: 'user', content: egressSeed }],
      scope: 'task',
      scopeId: 'intake',
    });

    // GEN-04 — Bootstrap STATE.json BEFORE writing INTAKE.md and running
    // side effects, so resolvePaperId() returns a non-null paperId and the
    // global-library registration + style-match producer proceed (not WARN-skip).
    // initState(cwd) writes <cwd>/STATE.json (same path loadState(cwd) reads).
    // StateAlreadyExistsError is caught and silently skipped — idempotent.
    // Any other error re-throws (fail-loud: bootstrap failure is real).
    try {
      await initState(cwd);
    } catch (e) {
      if ((e as { code?: string }).code !== 'STATE_ALREADY_EXISTS') throw e;
      // else: STATE.json already present — paperId is unchanged (idempotent skip)
    }

    // INTAKE.md carries the redacted text via the model result when PII opt-in
    // is on (raw → .raw.local). The model output is the artifact; no placeholder.
    await atomicWriteFile(targetPath, result.text);
    process.stdout.write(`pensmith new: wrote INTAKE.md to ${targetPath}\n`);
    await runSideEffects();
    return { ok: true, path: targetPath, mode: 'real' };
  },
});

export default intakeCommand;
