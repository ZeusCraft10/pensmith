#!/usr/bin/env node
/*
 * pensmith — structured academic paper writing with verified citations
 * Copyright (C) 2026 Akhil Achanta
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// bin/pensmith.ts — Tier 2 dispatcher.
//
// D-03: citty@^0.2.2 (locked).
// D-05: exactly 16 verbs from REQUIREMENTS.md UX-02 — doctor (real) + 15 stubs.
//   Phase 6+ verbs like `export`/`citations`/`humanize`/`gpt-zero`/`plagiarism`
//   are sub-commands under `compile`/`verify`, NOT first-class verbs in v0.1.0.
// Pitfall 7 — DO NOT console.log here; this binary is the CLI, not
// the MCP server, but consistency matters for future stdio surfaces.
//
// WR-03 + WR-06 (cross-AI review): the 16-verb list is owned by
// bin/lib/verbs.ts (UX02_VERBS); this dispatcher builds subCommands by
// iterating that array, so a verb added there is auto-registered here.
// tests/cli-verbs.test.ts imports the exported `command` and introspects
// command.subCommands at runtime — no more regex-over-source.
//
// Phase 7 Plan 07-02 — Single-command UX layer:
//   - REAL_VERB_LOADERS gains next/status/resume and is EXPORTED so next/resume
//     reuse it (no circular static import — the loaders are dynamic import()).
//   - dispatchVerb is EXPORTED: the SHARED flag-forwarding dispatch helper used
//     by the bare path AND next/resume so a manually-dispatched verb receives
//     the parsed global flags (≥ yolo) exactly as if invoked explicitly
//     (C3-HIGH-2), wrapped in an OUTER try/catch backstop so the bare/next/
//     resume umbrella NEVER crashes with an uncaught exception (C6-HIGH).
//   - Four global flags (--dry-run/--estimate/--yolo/--show-prompts) are applied
//     in a PRE-DISPATCH argv pre-parse BEFORE runMain (NOT a root run() — citty
//     falls through to a root run() after every verb, H2). The root command
//     keeps subCommands ONLY and NO run().

import { realpathSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineCommand, parseArgs, runMain, type CommandDef } from 'citty';
import { makeStub } from './cli/stubs.js';
import { VERSION } from './lib/version.generated.js';
import { UX02_VERBS, canonicalVerb, unknownVerbMessage, type Ux02Verb } from './lib/verbs.js';
import { setMirrorPromptsToStderr } from './lib/session-log.js';
import { projectEstimate } from './lib/estimator.js';
import { resolveNextAction, type RouterDecision } from './lib/router.js';
import { describeStep, renderDryRun } from './lib/dry-run.js';
import { isDryRun } from './lib/atomic-write.js';
import { readGoalFromConfig, stopAfterResearchFor, renderLearningEndState } from './cli/goal.js';
import { EXIT_ERROR, EXIT_OK, EXIT_REFUSED } from './lib/exit-codes.js';

// CommandDef<any> is intentional here: each real verb declares its own
// strongly-typed ArgsDef (e.g., doctor declares { json: BooleanArgDef }),
// but citty's subCommands map is parametric — every value must be a
// CommandDef of some args shape. Narrowing to a single concrete ArgsDef
// would force every verb to share the same args. The `any` is bounded:
// it appears only on the loader-function return type, never on user input.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCommandDef = CommandDef<any>;

/**
 * Real verb loaders. Each entry is a function returning a citty CommandDef
 * (or a Promise of one). Verbs NOT in this map default to the Phase 2
 * `makeStub(verb)` placeholder. As real implementations land, add a
 * loader here — that is the ONLY edit point.
 *
 * EXPORTED (Phase 7 / M7): next.ts + resume.ts dispatch through this table via
 * dispatchVerb rather than re-importing verb modules — avoiding a circular-dep
 * risk while keeping ONE dispatch path that forwards global flags.
 */
export const REAL_VERB_LOADERS: Partial<Record<Ux02Verb, () => Promise<AnyCommandDef>>> = {
  doctor: () => import('./cli/doctor.js').then((m) => m.doctorCommand),
  // Phase 3 Plan 03-07 Task 7.2 — 6 new real verbs.
  // CYCLE-2 M-1 reconciliation: `new` is the UX02_VERBS canonical key
  // (README quick-start), but the implementation file is `./cli/intake.ts`
  // (the canonical filename matching workflows/intake.md). Both point to
  // the same CommandDef.
  new: () => import('./cli/intake.js').then((m) => m.intakeCommand),
  research: () => import('./cli/research.js').then((m) => m.researchCommand),
  outline: () => import('./cli/outline.js').then((m) => m.outlineCommand),
  plan: () => import('./cli/plan.js').then((m) => m.planCommand),
  write: () => import('./cli/write.js').then((m) => m.writeCommand),
  verify: () => import('./cli/verify.js').then((m) => m.verifyCommand),
  // Phase 4 Plan 04-05 — compile is one of the locked 16 (no new verb); promote
  // the Phase-2 dispatcher stub to the real keystone pipeline loader.
  compile: () => import('./cli/compile.js').then((m) => m.compileCommand),
  // Phase 6 Plan 06-05 — done is one of the locked 16 (no new verb); promote the
  // Phase-2 dispatcher stub to the real export-pipeline loader (DONE-01/03/09).
  done: () => import('./cli/done.js').then((m) => m.doneCommand),
  // Phase 7 Plan 07-02 — next/status/resume promoted from stubs to real verbs.
  next: () => import('./cli/next.js').then((m) => m.nextCommand),
  status: () => import('./cli/status.js').then((m) => m.statusCommand),
  resume: () => import('./cli/resume.js').then((m) => m.resumeCommand),
  // Phase 8 Plan 08-01 — list/open promoted from Phase-2 stubs (no 17th verb;
  // both are already members of the locked-16 UX02_VERBS).
  list: () => import('./cli/list.js').then((m) => m.listCommand),
  open: () => import('./cli/open.js').then((m) => m.openCommand),
  // Phase 8 Plan 08-04 — sketch/add promoted from Phase-2 stubs (no 17th verb;
  // both are already members of the locked-16 UX02_VERBS).
  sketch: () => import('./cli/sketch.js').then((m) => m.sketchCommand),
  add: () => import('./cli/add.js').then((m) => m.addCommand),
};

/** Parsed global-flag bundle forwarded into a manually-dispatched verb. */
export interface GlobalFlags {
  yolo?: boolean;
  dryRun?: boolean;
  estimate?: boolean;
  showPrompts?: boolean;
}

/**
 * SHARED flag-forwarding dispatch helper (C3-HIGH-2 + C6-HIGH — load-bearing).
 *
 * Loads the CommandDef for `verb` via REAL_VERB_LOADERS (or the stub), MERGES the
 * forwarded global flags into the verb's args object — at minimum
 * `yolo: globalFlags.yolo === true` (the EXACT key compile.ts:90 + done.ts:436
 * read to skip their approval gate) — and invokes cmd.run({ args, rawArgs, cmd })
 * INSIDE AN OUTER try/catch BACKSTOP.
 *
 * KEY POINT (C3-HIGH-2): a verb reached via this manual loader-table path (bare /
 * next / resume) sees `yolo:true` in its args EXACTLY as if citty had parsed
 * `--yolo` on an explicit invocation — otherwise its own approval-gate-skip never
 * engages even though the cost-cap pre-flight ran.
 *
 * BACKSTOP INVARIANT (C6-HIGH): bare /pensmith never crashes with an uncaught
 * exception regardless of which verb it dispatches or what on-disk state exists.
 * Any throw becomes a one-line stderr diagnostic + a non-zero exit. SCOPE: this
 * backstop is specifically for the bare/next/resume umbrella dispatch — explicit
 * verbs run via runMain(command) and surface their errors normally.
 */
export async function dispatchVerb(
  verb: Ux02Verb,
  opts: { args?: Record<string, unknown>; globalFlags?: GlobalFlags } = {},
): Promise<unknown> {
  const loader = REAL_VERB_LOADERS[verb];
  const cmd: AnyCommandDef = loader ? await loader() : makeStub(verb);

  const gf = opts.globalFlags ?? {};
  const mergedArgs: Record<string, unknown> = {
    ...(opts.args ?? {}),
    // Forward the global flags into the verb's args (≥ yolo — the exact gate-skip
    // key compile/done read). The dispatched verb sees these as if citty parsed
    // them on an explicit invocation (C3-HIGH-2).
    yolo: gf.yolo === true,
    'dry-run': gf.dryRun === true,
    estimate: gf.estimate === true,
    'show-prompts': gf.showPrompts === true,
  };

  try {
    // citty CommandDef.run may be undefined for a meta-only command; guard it.
    const run = cmd.run as
      | ((ctx: { args: Record<string, unknown>; rawArgs: string[]; cmd: AnyCommandDef }) => unknown)
      | undefined;
    if (typeof run !== 'function') return undefined;
    return await run({ args: mergedArgs, rawArgs: [], cmd });
  } catch (e) {
    // C6-HIGH BACKSTOP: never let a dispatched verb's throw escape the
    // bare/next/resume umbrella as an uncaught crash.
    process.stderr.write(
      `[pensmith] dispatch of '${verb}' failed: ${(e as Error).message}\n`,
    );
    process.exitCode = EXIT_ERROR;
    return undefined;
  }
}

/**
 * Build the citty subCommands record from UX02_VERBS. Each verb is either a
 * real loader (above) or a stub. The returned shape is exactly what
 * defineCommand expects for subCommands: a Record<string, SubCommandsDef>.
 */
function buildSubCommands(): Record<string, () => Promise<AnyCommandDef>> {
  const out: Record<string, () => Promise<AnyCommandDef>> = {};
  for (const verb of UX02_VERBS) {
    const realLoader = REAL_VERB_LOADERS[verb];
    out[verb] = realLoader ?? (() => Promise.resolve(makeStub(verb)));
  }
  return out;
}

export const command = defineCommand({
  meta: {
    name: 'pensmith',
    // WR-01: VERSION is derived from package.json#version at prebuild time
    // (scripts/prebuild.mjs writes bin/lib/version.generated.ts). NEVER
    // inline a literal here — it will drift from npm's view of the package.
    version: VERSION,
    description: 'Pensmith — Tier 2 portable CLI. Section-as-phase academic writing.',
  },
  // Four global flags declared so `--help` documents them; the LOAD-BEARING
  // application is the argv pre-parse below (NOT a root run() — H2).
  args: {
    'dry-run': { type: 'boolean', description: 'Show what the step would read, write and call; run nothing, write nothing, no network.', default: false },
    offline: { type: 'boolean', description: 'Refuse every network request; lookups report "skipped (offline)" and citations UNRESOLVED.', default: false },
    estimate: { type: 'boolean', description: 'Project token + USD cost; do not execute.', default: false },
    yolo: { type: 'boolean', description: 'Skip outline + export approval gates.', default: false },
    'show-prompts': { type: 'boolean', description: 'Echo every LLM prompt to stderr.', default: false },
  },
  // NO run() — bare routing happens in the pre-dispatch wrapper below (H2).
  subCommands: buildSubCommands(),
});

// Back-compat alias for any prior consumer that imported `main`.
export const main = command;

// ---------------------------------------------------------------------------
// Pre-dispatch argv seam (Phase 7 / H2 / H1 / C2-H1 / C3-HIGH-2 / C4-HIGH).
// ---------------------------------------------------------------------------

/** True if `--<flag>` appears anywhere in argv (flags may appear post-verb). */
function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(`--${flag}`);
}

/**
 * Read-only verbs that incur NO model/network cost. The --yolo cap pre-flight
 * must not hard-refuse these (audit #24): inspecting status/library/health or
 * opening a paper should work even over an over-cap project.
 */
const READ_ONLY_VERBS: ReadonlySet<string> = new Set(['status', 'list', 'doctor', 'open']);

/**
 * Whether the --yolo cost-cap pre-flight should run for this argv (audit #24).
 * It runs ONLY for cost-incurring execution: --yolo present, NOT a no-cost
 * preview (--estimate) or citty meta (--version/--help), and NOT an explicit
 * read-only verb. A bare invocation (no verb) runs the pipeline, so it counts.
 */
export function shouldRunYoloCapPreflight(argv: string[]): boolean {
  if (!hasFlag(argv, 'yolo')) return false;
  if (hasFlag(argv, 'estimate') || hasFlag(argv, 'dry-run') || isDryRun()) return false;
  if (argv.includes('--version') || argv.includes('--help') || argv.includes('-h')) return false;
  const v = firstVerb(argv);
  if (v !== null && READ_ONLY_VERBS.has(v)) return false;
  return true;
}

/** The configured session cap (C2-M3): PENSMITH_COST_CAP_USD if finite >0, else $5. */
function configuredCapUsd(): number {
  const raw = process.env['PENSMITH_COST_CAP_USD'];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 5.0;
}

/** Index of the first argv token that is not a flag (the command word), or -1. */
function commandWordIndex(argv: string[]): number {
  return argv.findIndex((tok) => !tok.startsWith('-'));
}

/** The verb the command word names (aliases resolved), or null when there is none. */
function firstVerb(argv: string[]): Ux02Verb | null {
  const i = commandWordIndex(argv);
  return i === -1 ? null : canonicalVerb(argv[i] ?? '');
}

// Section-scoped verbs with a REQUIRED positional section number. When invoked
// with no number, they default to the router-resolved next pending section (the
// single-command UX, UX-01) rather than failing citty's required-positional gate.
// NOTE: `write` is deliberately EXCLUDED — its `n` is OPTIONAL (omit to write
// ALL sections wave-by-wave, the tier-contract write-wave surface), so a bare
// `pensmith write` must reach citty/runMain, not the single-section router path.
const SECTION_SCOPED_VERBS: readonly Ux02Verb[] = ['plan', 'verify'];

/** True if `verb` is section-scoped AND no numeric positional follows it in argv. */
function isSectionVerbWithoutNumber(argv: string[], verb: Ux02Verb): boolean {
  if (!SECTION_SCOPED_VERBS.includes(verb)) return false;
  const verbIdx = argv.indexOf(verb);
  for (let i = verbIdx + 1; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === undefined) continue;
    // A bare numeric token after the verb is the section positional.
    if (!tok.startsWith('-') && /^\d+$/.test(tok)) return false;
  }
  return true;
}

/**
 * `plan`/`verify` typed without a section number run for the router's next
 * section only when the router's next step is that verb. Otherwise say what the
 * next step is instead of running a command the user did not ask for.
 */
function refuseSectionVerb(verb: Ux02Verb, decision: RouterDecision): number {
  const at = 'n' in decision && 'slug' in decision ? ` (section ${decision.n} ${decision.slug})` : '';
  process.stderr.write(
    `pensmith ${verb}: no section is ready to ${verb} right now — the next step is ` +
    `\`pensmith ${decision.verb}\`${at}. Pass a section number ` +
    `(e.g. \`pensmith ${verb} 2\`) to ${verb} a specific section.\n`,
  );
  return EXIT_REFUSED;
}

/** The decision's section (n, slug) as verb args, when it has one. */
function decisionArgs(decision: RouterDecision): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ('n' in decision) out['n'] = decision.n;
  if ('slug' in decision) out['slug'] = decision.slug;
  return out;
}

/**
 * `--dry-run`: work out the step that would run — the named command with its
 * arguments, or the router's next step for bare `pensmith`, `next`, `resume`
 * and a section verb typed without its number — and print what it would read,
 * write and call. Never runs a verb. Returns the exit code.
 */
async function runDryRun(argv: string[], verb: Ux02Verb | null): Promise<number> {
  const paperRoot = process.cwd();
  const routed =
    verb === null || verb === 'next' || verb === 'resume' || isSectionVerbWithoutNumber(argv, verb);

  if (!routed) {
    const loader = REAL_VERB_LOADERS[verb];
    const cmd: AnyCommandDef = loader ? await loader() : makeStub(verb);
    const argsDef = typeof cmd.args === 'function' ? await cmd.args() : await cmd.args;
    const args = parseArgs(argv.slice(argv.indexOf(verb) + 1), argsDef ?? {}) as Record<string, unknown>;
    const step = describeStep({ verb, args }, paperRoot);
    process.stdout.write(renderDryRun(`pensmith --dry-run: would run \`${step.command}\`.`, step));
    return EXIT_OK;
  }

  const stop = stopAfterResearchFor(readGoalFromConfig(paperRoot));
  const decision = await resolveNextAction(paperRoot, { stopAfterResearch: stop });
  if (verb !== null && verb !== 'next' && verb !== 'resume' && decision.verb !== verb) {
    return refuseSectionVerb(verb, decision);
  }
  if (decision.verb === 'status' || decision.verb === 'resume') {
    const why = decision.verb === 'status' && decision.reason === 'done'
      ? 'the paper is finished'
      : 'the paper needs attention (run `pensmith status`)';
    process.stdout.write(`pensmith --dry-run: nothing to run — ${why}.\nDry run: nothing was written and no network request was made.\n`);
    return EXIT_OK;
  }
  const step = describeStep({ verb: decision.verb, args: decisionArgs(decision) }, paperRoot);
  process.stdout.write(renderDryRun(`pensmith --dry-run: the next step is \`${step.command}\`.`, step));
  return EXIT_OK;
}

/**
 * The pre-dispatch entrypoint: applies global-flag setup, the yolo cap
 * pre-flight, and the --estimate preview BEFORE any verb runs, then dispatches
 * exactly once (explicit verb → runMain; bare → resolveNextAction + dispatchVerb).
 */
export async function dispatch(argv: string[] = process.argv.slice(2)): Promise<void> {
  // The first word that is not a flag must name a verb. Anything else used to
  // fall through to the router and run a different step with the flags dropped.
  // Only an argv with no command word at all is a bare `pensmith`.
  const wordAt = commandWordIndex(argv);
  if (wordAt !== -1) {
    const word = argv[wordAt] ?? '';
    const verb = canonicalVerb(word);
    if (verb === null) {
      process.stderr.write(`${unknownVerbMessage(word)}\n`);
      process.exitCode = EXIT_REFUSED;
      return;
    }
    // An alias is rewritten to its verb so it takes exactly the verb's arguments.
    if (verb !== word) argv = [...argv.slice(0, wordAt), verb, ...argv.slice(wordAt + 1)];
  }

  // (a) --show-prompts → mirror prompts to stderr (BEFORE any LLM call).
  if (hasFlag(argv, 'show-prompts')) setMirrorPromptsToStderr(true);

  // (b) --offline / --dry-run → http.ts refuses every request (network-mode.ts).
  //     --dry-run also makes the write chokepoint refuse every write
  //     (atomic-write.ts), as a backstop: a dry run never runs a verb at all.
  //     PENSMITH_DRY_RUN=1 in the environment counts as --dry-run, since the
  //     write chokepoint honours it either way.
  if (hasFlag(argv, 'dry-run')) process.env['PENSMITH_DRY_RUN'] = '1';
  if (hasFlag(argv, 'offline') || isDryRun()) {
    process.env['PENSMITH_OFFLINE'] = '1';
  }
  if (isDryRun()) process.env['PENSMITH_NO_LLM'] = '1';

  // (c) H1 / C2-H1 YOLO CAP PRE-FLIGHT — runs WHENEVER --yolo is present for a
  //     COST-INCURRING execution (write/plan/verify/research/compile/done/revise,
  //     next/resume, and bare invocation). projectEstimate is guarded against ALL
  //     load errors, so a paper-less dir / corrupt STATE.json sees an empty
  //     estimate.
  //
  //     Audit #24: a read-only verb (status/list/doctor/open) and the --estimate
  //     preview incur NO model/network cost, so the cap must NOT hard-refuse them
  //     — `pensmith status --yolo` or `pensmith --estimate --yolo` should still
  //     work over an over-cap project. --version/--help are citty meta and bypass
  //     too. Bare/cost verbs still get the refusal.
  if (shouldRunYoloCapPreflight(argv)) {
    const est = await projectEstimate({ paperRoot: process.cwd(), sessionCapUsd: configuredCapUsd() });
    if (est.exceedsHalfCap) {
      process.stderr.write(
        'pensmith: REFUSED — --yolo estimate exceeds 50% of the session cap (ARCH-11).\n',
      );
      process.exit(EXIT_REFUSED); // HARD refusal — not advisory, not nested in --estimate
    }
  }

  // (d) --estimate → print the projection table and exit 0 WITHOUT a verb.
  if (hasFlag(argv, 'estimate')) {
    const est = await projectEstimate({ paperRoot: process.cwd(), sessionCapUsd: configuredCapUsd() });
    const out: string[] = ['pensmith estimate (token + USD projection, estimated ±50%):'];
    for (const r of est.rows) {
      out.push(`  ${r.step}: in=${r.inputTokens} out=${r.outputTokens} → $${r.usd.toFixed(4)}`);
    }
    out.push(`  TOTAL: $${est.totalUsd.toFixed(4)}`);
    process.stdout.write(out.join('\n') + '\n');
    return;
  }

  // (e) Dispatch exactly once.
  // Root meta flags (--version / --help / -h) are owned by citty's runMain even
  // with no subcommand — delegate them so `pensmith --version` prints the semver
  // (preflight contract) instead of falling into the bare router path.
  if (argv.includes('--version') || argv.includes('--help') || argv.includes('-h')) {
    await runMain(command, { rawArgs: argv });
    return;
  }

  const verb = firstVerb(argv);

  // --dry-run: say what would run and stop before any verb runs.
  if (isDryRun()) {
    process.exitCode = await runDryRun(argv, verb);
    return;
  }

  if (verb && !isSectionVerbWithoutNumber(argv, verb)) {
    // Explicit verb (with its required positional, if any) → citty parses
    // --yolo into the subcommand args itself; no manual forwarding needed. NO
    // root run() to fall through into (H2).
    await runMain(command, { rawArgs: argv });
    return;
  }

  // Either a bare invocation OR a section-scoped verb invoked without its
  // section number (UX-01). Resolve via resolveNextAction (NEVER throws,
  // C4/C5-HIGH) and dispatch via the shared helper, forwarding the parsed
  // global flags (C3-HIGH-2). Do NOT also call runMain (citty would throw
  // 'No command specified' on bare, or reject the missing required positional).
  //
  // Goal-aware tier: map goal → the router's goal-AGNOSTIC stopAfterResearch.
  const paperRoot = process.cwd();
  const stop = stopAfterResearchFor(readGoalFromConfig(paperRoot));
  const decision = await resolveNextAction(paperRoot, { stopAfterResearch: stop });

  // Audit #10: a section-scoped verb (plan/verify) typed WITHOUT its section
  // number must default to the next section that needs THAT verb — it must NEVER
  // silently run whatever DIFFERENT verb the router happens to pick. `verb` is
  // non-null ONLY on the section-verb-without-number path here (an explicit verb
  // with its number returned via runMain above; a bare invocation has
  // verb === null and is unaffected). When the router's next action is not the
  // requested verb, no section is ready for it — tell the user the real next step
  // instead of running a command they did not ask for.
  if (verb !== null && decision.verb !== verb) {
    process.exitCode = refuseSectionVerb(verb, decision);
    return;
  }

  // Learning hard-stop: render the per-claim learning end-state to TUTORIAL.md
  // INSTEAD OF dispatching the status verb's generic "ready to export" message.
  if (stop && decision.verb === 'status' && decision.reason === 'done') {
    await renderLearningEndState(paperRoot);
    return;
  }

  const verbArgs: Record<string, unknown> = decisionArgs(decision);
  if ('reason' in decision) verbArgs.reason = decision.reason;
  await dispatchVerb(decision.verb, {
    args: verbArgs,
    globalFlags: {
      yolo: hasFlag(argv, 'yolo'),
      dryRun: hasFlag(argv, 'dry-run'),
      estimate: hasFlag(argv, 'estimate'),
      showPrompts: hasFlag(argv, 'show-prompts'),
    },
  });
}

/**
 * True when this module is the program Node was asked to run, as opposed to a
 * module imported by a test or script (which must not dispatch).
 *
 * npm link, global installs, npx and node_modules/.bin start the CLI through a
 * symlink. Node resolves import.meta.url to the real file but leaves argv[1] as
 * the link, so both sides are compared after resolving symlinks.
 */
export function isMainModule(argv1: string | undefined, moduleUrl: string): boolean {
  if (!argv1) return false;
  const self = fileURLToPath(moduleUrl);
  const real = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return resolvePath(p);
    }
  };
  return real(resolvePath(argv1)) === real(self);
}

if (isMainModule(process.argv[1], import.meta.url)) {
  void dispatch();
}
