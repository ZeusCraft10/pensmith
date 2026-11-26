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
// citty@^0.2.2 parses the command line.
// The verbs are the 16 of REQUIREMENTS.md UX-02, plus `ack` (acknowledge a
//   RETRACTED citation). Words like `export`/`humanize`/`gpt-zero`/`plagiarism`
//   are aliases or parts of other verbs, not verbs of their own.
// No console.log here: stdout carries only what a verb prints.
//
// WR-03 + WR-06 (cross-AI review): the verb list is owned by
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
//     in a PRE-DISPATCH argv pre-parse BEFORE citty runs (NOT a root run() — citty
//     falls through to a root run() after every verb, H2). The root command
//     keeps subCommands ONLY and NO run().

import { realpathSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { defineCommand, parseArgs, renderUsage, runCommand, runMain, type ArgsDef, type CommandDef } from 'citty';
import { makeStub } from './cli/stubs.js';
import { VERSION } from './lib/version.generated.js';
import { UX02_VERBS, canonicalVerb, unknownOptionMessage, unknownVerbMessage, type Ux02Verb } from './lib/verbs.js';
import { setMirrorPromptsToStderr } from './lib/session-log.js';
import { projectEstimate } from './lib/estimator.js';
import { decisionArgs, decisionCommand, resolveNextAction, type RouterDecision } from './lib/router.js';
import { migrateLegacyLayout } from './lib/migrations/layout.js';
import { isDryRun } from './lib/atomic-write.js';
import { readGoalFromConfig, stopAfterResearchFor, renderLearningEndState } from './cli/goal.js';
import { EXIT_ERROR, EXIT_OK, EXIT_REFUSED } from './lib/exit-codes.js';
import { OFFLINE_SKIP_NOTE, isOfflineMode } from './lib/network-mode.js';
import { resolveCostCap } from './lib/budget.js';
import { describeModelFailure } from './lib/failure.js';
import { isNoLlmMode } from './lib/placeholder.js';

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
  // `new` is the verb (README quick start); its implementation is
  // ./cli/intake.ts, named for the intake step.
  new: () => import('./cli/intake.js').then((m) => m.intakeCommand),
  research: () => import('./cli/research.js').then((m) => m.researchCommand),
  outline: () => import('./cli/outline.js').then((m) => m.outlineCommand),
  plan: () => import('./cli/plan.js').then((m) => m.planCommand),
  write: () => import('./cli/write.js').then((m) => m.writeCommand),
  verify: () => import('./cli/verify.js').then((m) => m.verifyCommand),
  compile: () => import('./cli/compile.js').then((m) => m.compileCommand),
  done: () => import('./cli/done.js').then((m) => m.doneCommand),
  next: () => import('./cli/next.js').then((m) => m.nextCommand),
  status: () => import('./cli/status.js').then((m) => m.statusCommand),
  resume: () => import('./cli/resume.js').then((m) => m.resumeCommand),
  list: () => import('./cli/list.js').then((m) => m.listCommand),
  open: () => import('./cli/open.js').then((m) => m.openCommand),
  sketch: () => import('./cli/sketch.js').then((m) => m.sketchCommand),
  add: () => import('./cli/add.js').then((m) => m.addCommand),
  ack: () => import('./cli/ack.js').then((m) => m.ackCommand),
};

/** The CommandDef for `verb`: its real loader, or the Phase 2 stub. */
const loadVerbCommand = (verb: Ux02Verb): Promise<AnyCommandDef> =>
  (REAL_VERB_LOADERS[verb] ?? (() => Promise.resolve(makeStub(verb))))();

/** Parsed global-flag bundle forwarded into a manually-dispatched verb. */
export interface GlobalFlags {
  yolo?: boolean;
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
 * verbs run via citty's runCommand and surface their errors through dispatch.
 */
export async function dispatchVerb(
  verb: Ux02Verb,
  opts: { args?: Record<string, unknown>; globalFlags?: GlobalFlags } = {},
): Promise<unknown> {
  const cmd = await loadVerbCommand(verb);

  const gf = opts.globalFlags ?? {};
  const mergedArgs: Record<string, unknown> = {
    ...(opts.args ?? {}),
    // Forward the global flags into the verb's args (≥ yolo — the exact gate-skip
    // key compile/done read). The dispatched verb sees these as if citty parsed
    // them on an explicit invocation (C3-HIGH-2).
    yolo: gf.yolo === true,
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
  for (const verb of UX02_VERBS) out[verb] = () => loadVerbCommand(verb);
  return out;
}

// Five global flags declared so `--help` documents them; the LOAD-BEARING
// application is the argv pre-parse below (NOT a root run() — H2).
const ROOT_ARGS = {
  'dry-run': { type: 'boolean', description: 'Show what the step would read, write and call; run nothing, write nothing, no network.', default: false },
  offline: { type: 'boolean', description: `Refuse every network request; lookups report "${OFFLINE_SKIP_NOTE}" and citations UNRESOLVED.`, default: false },
  estimate: { type: 'boolean', description: 'Project token + USD cost; do not execute.', default: false },
  yolo: { type: 'boolean', description: 'Skip outline + export approval gates.', default: false },
  'show-prompts': { type: 'boolean', description: 'Echo every LLM prompt to stderr.', default: false },
} as const satisfies ArgsDef;

/** Every flag bare `pensmith` (no command word) accepts. */
const ROOT_OPTIONS: readonly string[] = [
  ...Object.keys(ROOT_ARGS).map((k) => `--${k}`),
  '--version',
  '-v',
  '--help',
  '-h',
];

export const command = defineCommand({
  meta: {
    name: 'pensmith',
    // WR-01: VERSION is derived from package.json#version at prebuild time
    // (scripts/prebuild.mjs writes bin/lib/version.generated.ts). NEVER
    // inline a literal here — it will drift from npm's view of the package.
    version: VERSION,
    description: 'Pensmith — Tier 2 portable CLI. Section-as-phase academic writing.',
  },
  args: ROOT_ARGS,
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

/** True if argv asks for the usage (`--help` or `-h`). */
function wantsHelp(argv: string[]): boolean {
  return hasFlag(argv, 'help') || argv.includes('-h');
}

/**
 * Verbs that incur NO model/network cost, which the --yolo cost-cap pre-flight
 * skips: inspecting status/library/health, opening a paper or recording an
 * acknowledgement should work even over an over-cap project.
 */
const NO_COST_VERBS: ReadonlySet<string> = new Set(['status', 'list', 'doctor', 'open', 'ack']);

/**
 * Whether the --yolo cost-cap pre-flight should run for this argv (audit #24).
 * It runs ONLY for cost-incurring execution: --yolo present, NOT a no-cost
 * preview (--estimate) or citty meta (--version/--help), and NOT an explicit
 * no-cost verb. A bare invocation (no verb) runs the pipeline, so it counts.
 */
export function shouldRunYoloCapPreflight(argv: string[]): boolean {
  if (!hasFlag(argv, 'yolo')) return false;
  if (hasFlag(argv, 'estimate') || hasFlag(argv, 'dry-run') || isDryRun()) return false;
  // Stub mode and offline make no paid call, so there is nothing to cap.
  if (isNoLlmMode() || isOfflineMode()) return false;
  if (wantsHelp(argv) || hasFlag(argv, 'version')) return false;
  const v = firstVerb(argv);
  if (v !== null && NO_COST_VERBS.has(v)) return false;
  return true;
}

/**
 * The paper's cost cap, as every model call checks it: PENSMITH_COST_CAP_USD,
 * then [budget] cost_cap_usd in config.toml, then $5.
 */
function configuredCapUsd(): number {
  return resolveCostCap(process.cwd()).capUsd;
}

/** The section number typed after a section verb (`write 3`), or null. */
function typedSectionNumber(argv: string[]): number | null {
  const i = commandWordIndex(argv);
  const tok = i === -1 ? undefined : argv.slice(i + 1).find((t) => !t.startsWith('-'));
  return tok !== undefined && /^\d+$/.test(tok) ? Number(tok) : null;
}

/** The --estimate / --yolo projection of what this argv would run. */
function estimateFor(argv: string[]): ReturnType<typeof projectEstimate> {
  return projectEstimate({
    paperRoot: process.cwd(),
    sessionCapUsd: configuredCapUsd(),
    verb: firstVerb(argv),
    n: typedSectionNumber(argv),
  });
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
// `pensmith write` must reach citty, not the single-section router path.
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
  const why = decision.why ? `, because ${decision.why}` : '';
  process.stderr.write(
    `pensmith ${verb}: no section is ready to ${verb} right now — the next step is ` +
    `\`${decisionCommand(decision)}\`${at}${why}. Pass a section number ` +
    `(e.g. \`pensmith ${verb} 2\`) to ${verb} a specific section.\n`,
  );
  return EXIT_REFUSED;
}

/**
 * The line that says which step the router chose and why, on stderr, so the
 * dispatched verb's stdout stays its own.
 */
export function nextStepLine(prefix: string, decision: RouterDecision): string {
  const step = decision.verb === 'status' ? `status (${decision.reason})` : decisionCommand(decision);
  return `${prefix}: → ${step}${decision.why ? ` — ${decision.why}` : ''}`;
}

/** The router's next step for the paper, with the goal's stop-after-research applied. */
async function routeNext(paperRoot: string): Promise<{ stop: boolean; decision: RouterDecision }> {
  const stop = stopAfterResearchFor(readGoalFromConfig(paperRoot));
  return { stop, decision: await resolveNextAction(paperRoot, { stopAfterResearch: stop }) };
}


/**
 * `--dry-run`: work out the step that would run — the named command with its
 * arguments, or the router's next step for bare `pensmith`, `next`, `resume`
 * and a section verb typed without its number — and print what it would read,
 * write and call. Never runs a verb. Returns the exit code.
 */
async function runDryRun(argv: string[], verb: Ux02Verb | null): Promise<number> {
  // Loaded here, not at startup: only a dry run needs it.
  const { describeStep, renderDryRun, DRY_RUN_TRAILER } = await import('./lib/dry-run.js');
  const paperRoot = process.cwd();
  const bareSectionVerb = verb !== null && isSectionVerbWithoutNumber(argv, verb);
  const routed = verb === null || verb === 'next' || verb === 'resume' || bareSectionVerb;

  if (!routed) {
    const cmd = await loadVerbCommand(verb);
    const argsDef = typeof cmd.args === 'function' ? await cmd.args() : await cmd.args;
    const args = parseArgs(argv.slice(commandWordIndex(argv) + 1), argsDef ?? {}) as Record<string, unknown>;
    const step = describeStep({ verb, args }, paperRoot);
    process.stdout.write(renderDryRun(`pensmith --dry-run: would run \`${step.command}\`.`, step));
    return EXIT_OK;
  }

  const { decision } = await routeNext(paperRoot);
  if (bareSectionVerb && decision.verb !== verb) return refuseSectionVerb(verb, decision);
  if (decision.verb === 'status' || decision.verb === 'resume') {
    const why = decision.verb === 'status' && decision.reason === 'done'
      ? `the paper is finished (${decision.why})`
      : `the paper needs attention (run \`pensmith status\`)${decision.why ? `: ${decision.why}` : ''}`;
    process.stdout.write(`pensmith --dry-run: nothing to run — ${why}.\n${DRY_RUN_TRAILER}\n`);
    return EXIT_OK;
  }
  const step = describeStep({ verb: decision.verb, args: decisionArgs(decision) }, paperRoot);
  process.stdout.write(renderDryRun(`pensmith --dry-run: the next step is \`${step.command}\`, because ${decision.why}.`, step));
  return EXIT_OK;
}

/** citty's error for a usage mistake: a required argument missing, a value it does not take. */
function isUsageError(e: unknown): e is Error {
  return e instanceof Error && e.name === 'CLIError';
}

/**
 * A usage mistake is a refusal, as an unknown verb is: the usage of the command
 * typed and the error go to stderr, and the exit is 2. citty's runMain printed
 * the usage on stdout and exited 1, the code for a crash.
 */
async function refuseUsage(argv: string[], e: Error): Promise<void> {
  const verb = firstVerb(argv);
  const usage = verb === null ? await renderUsage(command) : await renderUsage(await loadVerbCommand(verb), command);
  process.stderr.write(`${usage}\n\n${e.message}\n`);
  process.exitCode = EXIT_REFUSED;
}

/**
 * The CLI entrypoint. Every usage error, whichever path parsed the arguments
 * (an explicit verb, a dry run), is reported here; anything else is an
 * unexpected error and exits 1.
 */
export async function dispatch(argv: string[] = process.argv.slice(2)): Promise<void> {
  try {
    await dispatchArgv(argv);
  } catch (e) {
    if (isUsageError(e)) {
      await refuseUsage(argv, e);
      return;
    }
    // A model call refused over the cost cap, or one that gave no usable answer
    // (cut off, declined, the provider failing), is reported in plain words,
    // not as a stack trace.
    const failure = describeModelFailure(e);
    if (failure) {
      process.stderr.write(`pensmith: ${failure.text}\n`);
      process.exitCode = failure.exitCode;
      return;
    }
    process.stderr.write(`${inspect(e)}\n`);
    process.exit(EXIT_ERROR);
  }
}

/**
 * Applies global-flag setup, the yolo cap pre-flight, and the --estimate
 * preview BEFORE any verb runs, then dispatches exactly once (explicit verb →
 * citty's runCommand; bare → resolveNextAction + dispatchVerb).
 */
async function dispatchArgv(argv: string[]): Promise<void> {
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
  } else {
    // With no command word, only the root flags mean anything. A typo such as
    // `--verison` used to be dropped and the next step run in its place.
    const unknown = argv.find((tok) => !ROOT_OPTIONS.includes(tok));
    if (unknown !== undefined) {
      process.stderr.write(`${unknownOptionMessage(unknown, ROOT_OPTIONS)}\n`);
      process.exitCode = EXIT_REFUSED;
      return;
    }
    argv = argv.map((tok) => (tok === '-v' ? '--version' : tok));
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

  // A project an older pensmith laid out with STATE.json and config.toml in
  // the project root is moved into .paper/ before anything reads its settings
  // (the cost cap below among them). A dry run and the --estimate preview
  // change nothing, so they skip this.
  if (!isDryRun() && !wantsHelp(argv) && !hasFlag(argv, 'version') && !hasFlag(argv, 'estimate')) {
    try {
      await migrateLegacyLayout(process.cwd());
    } catch (e) {
      process.stderr.write(`pensmith: WARN — could not move STATE.json and config.toml into .paper/: ${(e as Error).message}\n`);
    }
  }

  // (c) H1 / C2-H1 YOLO CAP PRE-FLIGHT — runs WHENEVER --yolo is present for a
  //     COST-INCURRING execution (write/plan/verify/research/compile/done/revise,
  //     next/resume, and bare invocation). projectEstimate is guarded against ALL
  //     load errors, so a paper-less dir / corrupt STATE.json sees an empty
  //     estimate.
  //
  //     Audit #24: a no-cost verb (NO_COST_VERBS) and the --estimate
  //     preview incur NO model/network cost, so the cap must NOT hard-refuse them
  //     — `pensmith status --yolo` or `pensmith --estimate --yolo` should still
  //     work over an over-cap project. --version/--help are citty meta and bypass
  //     too. Bare/cost verbs still get the refusal.
  if (shouldRunYoloCapPreflight(argv)) {
    const est = await estimateFor(argv);
    if (est.exceedsHalfCap) {
      process.stderr.write(
        'pensmith: REFUSED — --yolo estimate exceeds 50% of the session cap (ARCH-11).\n',
      );
      process.exit(EXIT_REFUSED); // HARD refusal — not advisory, not nested in --estimate
    }
  }

  // (d) --estimate → print the projection table and exit 0 WITHOUT a verb.
  if (hasFlag(argv, 'estimate')) {
    const est = await estimateFor(argv);
    const out: string[] = ['pensmith estimate (token + USD projection, estimated ±50%):'];
    for (const r of est.rows) {
      out.push(`  ${r.step}: in=${r.inputTokens} out=${r.outputTokens} → $${r.usd.toFixed(4)}`);
    }
    out.push(`  TOTAL: $${est.totalUsd.toFixed(4)}`);
    process.stdout.write(out.join('\n') + '\n');
    return;
  }

  // (e) Dispatch exactly once.
  // --help and a lone --version are citty's: they print the usage or the semver
  // (preflight contract) and parse nothing, so they never raise a usage error.
  // --version with anything else is parsed like any command line, so it never
  // falls into the bare router path.
  if (wantsHelp(argv) || (argv.length === 1 && argv[0] === '--version')) {
    await runMain(command, { rawArgs: argv });
    return;
  }
  if (hasFlag(argv, 'version')) {
    await runCommand(command, { rawArgs: argv });
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
    // root run() to fall through into (H2). A usage error propagates to
    // dispatch, which reports it.
    await runCommand(command, { rawArgs: argv });
    return;
  }

  // Either a bare invocation OR a section-scoped verb invoked without its
  // section number (UX-01). Resolve via resolveNextAction (NEVER throws,
  // C4/C5-HIGH) and dispatch via the shared helper, forwarding the parsed
  // global flags (C3-HIGH-2). Do NOT also call runCommand (citty would throw
  // 'No command specified' on bare, or reject the missing required positional).
  //
  // Goal-aware tier: map goal → the router's goal-AGNOSTIC stopAfterResearch.
  const paperRoot = process.cwd();
  const { stop, decision } = await routeNext(paperRoot);

  // Audit #10: a section-scoped verb (plan/verify) typed WITHOUT its section
  // number must default to the next section that needs THAT verb — it must NEVER
  // silently run whatever DIFFERENT verb the router happens to pick. `verb` is
  // non-null ONLY on the section-verb-without-number path here (an explicit verb
  // with its number returned via runCommand above; a bare invocation has
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

  process.stderr.write(`${nextStepLine('pensmith', decision)}\n`);
  await dispatchVerb(decision.verb, {
    args: decisionArgs(decision),
    globalFlags: {
      yolo: hasFlag(argv, 'yolo'),
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
 *
 * This uses Node's JS realpathSync, not realpathSync.native (paths.ts
 * realPath): the JS walk is what Node's loader uses for import.meta.url, and it
 * still follows links where the OS realpath call fails (some Windows volumes,
 * a libc whose realpath needs /proc).
 */
export function isMainModule(argv1: string | undefined, moduleUrl: string): boolean {
  if (!argv1) return false;
  const real = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return resolvePath(p);
    }
  };
  return real(resolvePath(argv1)) === real(fileURLToPath(moduleUrl));
}

if (isMainModule(process.argv[1], import.meta.url)) {
  void dispatch();
}
