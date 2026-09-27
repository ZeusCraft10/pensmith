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

import { defineCommand, runCommand, renderUsage, type CommandDef } from 'citty';
import { makeStub } from './cli/stubs.js';
import { VERSION } from './lib/version.generated.js';
import { UX02_VERBS, type Ux02Verb, canonicalVerb, VERB_ALIASES, nearest } from './lib/verbs.js';
import {
  projectRoot,
  workingDirectory,
  resolvePaperRoot,
  setActivePaperRoot,
  activePaperBanner,
  type PaperPointer,
} from './lib/paths.js';
import { migrateLegacyLayout } from './lib/state.js';
import { acquireSessionLock, releaseSessionLock } from './lib/session-lock.js';
import { runGate, declineGate, canPrompt } from './lib/gates.js';
import { EXIT_CODES, EXIT_USAGE, EXIT_ERROR, EXIT_COST_CAP, PensmithError } from './lib/exit-codes.js';
import { classifyFailure, finalExitCode, stripAnsi } from './lib/verb-outcome.js';
import { setMirrorPromptsToStderr, setSessionArgv } from './lib/session-log.js';
import { announceModes } from './lib/http-mock.js';
import { projectEstimate, renderEstimate } from './lib/estimator.js';
import { formatUsd } from './lib/budget.js';
import { argvFlagValue, runtimeFlagsFromArgv, setRuntimeOverride } from './lib/runtime.js';
import { resolveNextAction } from './lib/router.js';
import { readGoalFromConfig, stopAfterResearchFor, renderLearningEndState } from './cli/goal.js';

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
 * RUN-09/RUN-12 (D-17-34): an EXPECTED failure (a PensmithError such as a gate
 * refusal, or an aborted prompt) is re-thrown so the dispatch() wrapper exits
 * with ITS documented code — bare/next/resume propagate the dispatched verb's
 * code. Any other throw becomes a one-line stderr diagnostic and an
 * EXIT_ERROR result (never a stack trace).
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
    // Expected failures carry their own exit code: let dispatch() report them.
    const failure = classifyFailure(e);
    if (!failure.unexpected) throw e;
    // C6-HIGH BACKSTOP: never let a dispatched verb's throw escape the
    // bare/next/resume umbrella as an uncaught crash.
    process.stderr.write(`pensmith: ${verb}: ${failure.message}\n`);
    return { ok: false, exitCode: EXIT_ERROR };
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
    description: 'Pensmith — structured academic paper writing with verified citations. Run `pensmith` with no verb to take the next step.',
  },
  // The global flags are declared so `--help` documents them; the LOAD-BEARING
  // application is the argv pre-parse below (NOT a root run() — H2).
  args: {
    paper: { type: 'string', description: 'Work on this paper: a name from `pensmith list`, or a folder containing .paper/ (RUN-14).', valueHint: 'name|path' },
    'dry-run': { type: 'boolean', description: 'Preview run: makes no network or model call (sources and model replies are labelled stand-ins).', default: false },
    estimate: { type: 'boolean', description: 'Project the remaining token + USD cost, then offer to proceed.', default: false },
    yolo: { type: 'boolean', description: 'Skip the approval gates --yolo may skip (outline approval, export confirmation, research scope/prune, add remap, revise swap). Never skips the cost cap, detector consent or the active-paper choice.', default: false },
    'show-prompts': { type: 'boolean', description: 'Mirror every outbound request (and full LLM prompts) to stderr before it is sent.', default: false },
    runtime: { type: 'string', description: 'LLM provider for this run: anthropic | openai | ollama | vllm | openai-compatible (overrides config; RUN-08).' },
    model: { type: 'string', description: 'Generation model for this run (outline, plan, write); judgment slugs keep their own model (RUN-26).' },
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
  if (hasFlag(argv, 'estimate')) return false;
  if (argv.includes('--version') || argv.includes('--help') || argv.includes('-h')) return false;
  const v = firstVerb(argv);
  if (v !== null && READ_ONLY_VERBS.has(v)) return false;
  return true;
}

/**
 * Find the first non-flag argv token and return its canonical verb (one of the
 * locked 16, or the verb an alias names — RUN-11), skipping the values of the
 * value-taking global flags. An unknown token never reaches here: the
 * pre-flight rejects it with EXIT_USAGE before anything runs.
 */
function firstVerb(argv: string[]): Ux02Verb | null {
  const at = verbTokenIndex(argv);
  return at < 0 ? null : canonicalVerb(argv[at] ?? '');
}

// ---------------------------------------------------------------------------
// Argv validation (RUN-11, D-17-35) — the first step of the pre-flight.
// ---------------------------------------------------------------------------

/** Boolean global flags every verb accepts. */
const GLOBAL_BOOLEAN_FLAGS: readonly string[] = ['dry-run', 'estimate', 'yolo', 'show-prompts'];
/**
 * Value-taking global flags. They are stripped (with their values) before
 * citty parses a verb's argv, so a verb never sees them as positionals.
 * `--runtime`/`--model` belong to the model runtime (RUN-08), `--paper` to the
 * active-paper resolver (RUN-14).
 */
const GLOBAL_VALUE_FLAGS: readonly string[] = ['paper', 'runtime', 'model'];
const HELP_FLAGS: readonly string[] = ['--help', '-h'];
const VERSION_FLAGS: readonly string[] = ['--version', '-v'];

function isFlagToken(tok: string): boolean {
  return tok.startsWith('-') && tok !== '-';
}

/** `--name=value` / `--name` / `-x` → the bare option name. */
function flagName(tok: string): string {
  const bare = tok.replace(/^-{1,2}/, '');
  const eq = bare.indexOf('=');
  return eq >= 0 ? bare.slice(0, eq) : bare;
}

/** Index of the first non-flag token (the verb position), or -1. */
function verbTokenIndex(argv: readonly string[]): number {
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i] ?? '';
    if (tok === '--') return -1;
    if (isFlagToken(tok)) {
      if (!tok.includes('=') && GLOBAL_VALUE_FLAGS.includes(flagName(tok))) i += 1;
      continue;
    }
    return i;
  }
  return -1;
}

function kebab(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

interface VerbArgShape {
  /** Option names (kebab-case) → true when the option takes a value. */
  readonly options: ReadonlyMap<string, boolean>;
  readonly positionals: number;
}

async function verbArgShape(verb: Ux02Verb): Promise<VerbArgShape> {
  const loader = REAL_VERB_LOADERS[verb];
  const cmd: AnyCommandDef = loader ? await loader() : makeStub(verb);
  const defs = (typeof cmd.args === 'function' ? await (cmd.args as () => unknown)() : cmd.args ?? {}) as Record<
    string,
    { type?: string }
  >;
  const options = new Map<string, boolean>();
  let positionals = 0;
  for (const [name, def] of Object.entries(defs)) {
    if (def.type === 'positional') {
      positionals += 1;
      continue;
    }
    options.set(kebab(name), def.type === 'string' || def.type === 'enum');
  }
  return { options, positionals };
}

export interface ValidatedArgv {
  /** The canonical verb, or null for a bare invocation. */
  readonly verb: Ux02Verb | null;
  /** The `--paper` value, when given. */
  readonly paperFlag: string | undefined;
  readonly help: boolean;
  readonly version: boolean;
}

function usage(message: string): PensmithError {
  return new PensmithError(message, EXIT_USAGE);
}

/**
 * Validate argv before anything runs (RUN-11): the first non-flag token must be
 * a verb or an alias, every flag must be a global flag or one of the verb's own
 * options, value-taking options need a value, and a verb takes no more
 * positionals than it declares. Violations throw EXIT_USAGE with a
 * Levenshtein ≤ 2 suggestion — nothing has been created, read or sent yet.
 */
export async function validateArgv(argv: readonly string[]): Promise<ValidatedArgv> {
  const at = verbTokenIndex(argv);
  let verb: Ux02Verb | null = null;
  if (at >= 0) {
    const tok = argv[at] ?? '';
    verb = canonicalVerb(tok);
    if (verb === null) {
      const hint = nearest(tok, [...UX02_VERBS, ...Object.keys(VERB_ALIASES)]);
      throw usage(
        `unknown command '${tok}'${hint ? `; did you mean '${hint}'?` : ''} ` +
          '(run pensmith --help for the verb list)',
      );
    }
  }
  const shape = verb ? await verbArgShape(verb) : { options: new Map<string, boolean>(), positionals: 0 };
  let paperFlag: string | undefined;
  let help = false;
  let version = false;
  let positionals = 0;
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i] ?? '';
    if (tok === '--') break;
    if (i === at) continue;
    if (!isFlagToken(tok)) {
      positionals += 1;
      if (verb === null || positionals > shape.positionals) {
        throw usage(
          verb === null
            ? `unexpected argument '${tok}' (run pensmith --help)`
            : `unexpected argument '${tok}' for 'pensmith ${verb}' (run pensmith ${verb} --help)`,
        );
      }
      continue;
    }
    if (HELP_FLAGS.includes(tok)) {
      help = true;
      continue;
    }
    if (VERSION_FLAGS.includes(tok) && verb === null) {
      version = true;
      continue;
    }
    const name = flagName(tok);
    const hasInline = tok.includes('=');
    const negated = !hasInline && tok.startsWith('--no-') ? tok.slice(5) : null;
    let takesValue: boolean | undefined;
    if (GLOBAL_VALUE_FLAGS.includes(name)) takesValue = true;
    else if (GLOBAL_BOOLEAN_FLAGS.includes(name)) takesValue = false;
    else if (tok.startsWith('--')) takesValue = shape.options.get(name);
    if (takesValue === undefined && negated !== null && shape.options.get(negated) === false) continue;
    if (takesValue === undefined && negated !== null && GLOBAL_BOOLEAN_FLAGS.includes(negated)) continue;
    if (takesValue === undefined) {
      const known = [...GLOBAL_BOOLEAN_FLAGS, ...GLOBAL_VALUE_FLAGS, ...shape.options.keys()];
      const hint = nearest(name, known);
      throw usage(
        `unknown option '${tok.split('=')[0]}'${verb ? ` for 'pensmith ${verb}'` : ''}` +
          `${hint ? `; did you mean '--${hint}'?` : ''} (run pensmith ${verb ? `${verb} ` : ''}--help)`,
      );
    }
    if (!takesValue) continue;
    let value: string | undefined;
    if (hasInline) value = tok.slice(tok.indexOf('=') + 1);
    else {
      const next = argv[i + 1];
      if (next === undefined || isFlagToken(next)) throw usage(`option '--${name}' needs a value`);
      value = next;
      i += 1;
    }
    if (name === 'paper') paperFlag = value;
  }
  return { verb, paperFlag, help, version };
}

/**
 * The argv handed to citty for an explicit verb: every token except the verb
 * itself and the value-taking global flags (with their values). Global
 * booleans stay, so a verb sees `--yolo` wherever it was typed.
 */
function verbArgv(argv: readonly string[]): string[] {
  const at = verbTokenIndex(argv);
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i] ?? '';
    if (i === at) continue;
    if (tok === '--') {
      out.push(...argv.slice(i));
      break;
    }
    if (isFlagToken(tok) && GLOBAL_VALUE_FLAGS.includes(flagName(tok))) {
      if (!tok.includes('=')) i += 1;
      continue;
    }
    out.push(tok);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Paper root + session (RUN-13, RUN-14, RUN-23) — the rest of the pre-flight.
// ---------------------------------------------------------------------------

/** What the pre-flight resolved for this invocation. */
interface InvocationSession {
  root: string;
  /** The pointer, when the root came from it. */
  pointer: PaperPointer | null;
  /** The pointer was offered to a mutating run and the user chose it. */
  pointerConfirmed: boolean;
  /** The session lock is held (released when the invocation ends). */
  locked: boolean;
  readonly cwd: string;
}

let currentSession: InvocationSession | null = null;

/**
 * A mutating run in a paper-less folder while `pensmith open` points elsewhere:
 * ask (paper-pointer gate) in a terminal; refuse with EXIT_USAGE otherwise, and
 * always under --yolo (--yolo never follows the pointer — S-21, D-17-33).
 */
async function choosePointerOrNew(pointer: PaperPointer, cwd: string, yolo: boolean): Promise<string> {
  const refusal =
    `no paper in ${cwd}, and the active paper "${pointer.name}" is at ${pointer.root}. ` +
    `Pass --paper ${JSON.stringify(pointer.name)} to work on it, or run pensmith new to start a paper here` +
    `${yolo ? ' (--yolo never follows the active-paper pointer)' : ''}.`;
  if (yolo || !canPrompt()) declineGate('paper-pointer', refusal);
  const outcome = await runGate('paper-pointer', {
    yolo: false,
    question: {
      id: 'paper-pointer',
      kind: 'select',
      label: `No paper here. Continue "${pointer.name}" at ${pointer.root}, or start a new paper in ${cwd}?`,
      options: [
        { value: 'continue', label: `continue "${pointer.name}"` },
        { value: 'new', label: 'start a new paper here' },
      ],
      default: 'continue',
    },
  });
  const choice = outcome.kind === 'answered' && outcome.answer.kind === 'select' ? outcome.answer.value : null;
  if (choice === 'continue') return pointer.root;
  if (choice === 'new') return cwd;
  return declineGate('paper-pointer', refusal);
}

/** Take the session lock for a mutating run (idempotent; re-entrant by PID). */
async function enterMutatingSession(session: InvocationSession, verb: Ux02Verb | null, yolo: boolean): Promise<void> {
  if (session.pointer !== null && !session.pointerConfirmed) {
    session.root = await choosePointerOrNew(session.pointer, session.cwd, yolo);
    session.pointerConfirmed = true;
    if (session.root !== session.pointer.root) session.pointer = null;
    setActivePaperRoot(session.root);
    await migrateLegacyLayout(session.root);
  }
  if (session.locked) return;
  await acquireSessionLock(session.root, { kind: 'cli', verb: verb ?? 'pensmith' });
  session.locked = true;
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
 * The pre-dispatch entrypoint: validates argv and resolves the paper (the
 * pre-flight), applies global-flag setup, the yolo cap pre-flight, and the
 * --estimate preview BEFORE any verb runs, then dispatches exactly once
 * (explicit verb → citty runCommand; bare → resolveNextAction + dispatchVerb).
 * Returns the dispatched verb's result; dispatch() maps it to the exit code.
 */
export async function dispatchInner(argv: string[] = process.argv.slice(2)): Promise<unknown> {
  // PRE-FLIGHT (RUN-11, RUN-13, RUN-14, RUN-23; D-17-32..37), in this order:
  //   1. argv validation — an unknown verb or flag is EXIT_USAGE before anything
  //      is created, read or sent (no .paper/, no STATE.json, no network, no LLM);
  //   2. resolve the paper root (`--paper`, PENSMITH_PAPER_ROOT, the cwd, a new
  //      paper, or the `open` pointer) and record it for projectRoot();
  //   3. the one-time legacy-layout move (root STATE.json/config.toml → .paper/);
  //   4. the active-paper banner for a read-only run served by the pointer;
  //   5. the session lock for a mutating run (bare/next/resume included).
  const checked = await validateArgv(argv);
  const meta = checked.help || checked.version;
  if (!meta) {
    const readOnly = (checked.verb !== null && READ_ONLY_VERBS.has(checked.verb)) || hasFlag(argv, 'estimate');
    const cwd = workingDirectory();
    const resolved = resolvePaperRoot({ verb: checked.verb, paperFlag: checked.paperFlag, mode: 'cli', readOnly });
    const session: InvocationSession = {
      root: resolved.kind === 'ask-pointer' ? cwd : resolved.root,
      pointer: resolved.kind === 'root' ? null : resolved.pointer,
      pointerConfirmed: false,
      locked: false,
      cwd,
    };
    currentSession = session;
    if (resolved.kind !== 'ask-pointer') {
      setActivePaperRoot(session.root);
      await migrateLegacyLayout(session.root);
    }
    if (resolved.kind === 'pointer' && checked.verb !== 'open') {
      process.stderr.write(`${activePaperBanner(resolved.pointer)}\n`);
    }
    if (!readOnly) await enterMutatingSession(session, checked.verb, hasFlag(argv, 'yolo'));
  }

  // (a) --show-prompts → the http.ts egress gate mirrors every outbound request
  //     (URL, LLM body, POST previews; never headers) to stderr BEFORE it is sent
  //     (RUN-16, D-17-12).
  if (hasFlag(argv, 'show-prompts')) setMirrorPromptsToStderr(true);

  // (b) --dry-run → both channels off (D-17-04). PENSMITH_DRY_RUN=1 makes the
  //     http.ts gate refuse every request (zero sockets) and routes research to
  //     the labelled synthetic provider (RUN-27); PENSMITH_NO_LLM=1 stubs every
  //     model call. Both are env vars so child processes inherit the mode.
  if (hasFlag(argv, 'dry-run')) {
    process.env['PENSMITH_DRY_RUN'] = '1';
    process.env['PENSMITH_NO_LLM'] = '1';
  }
  // RUN-02 banners (once, stderr, before other output) + the D-17-15
  // installed-package refusal (throws OfflineFixturesNotShippedError, EXIT_ERROR).
  announceModes({ verb: firstVerb(argv), argv });

  // (b2) --runtime / --model (RUN-08, D-17-19): pre-parse into the runtime
  //      override so every model call in this invocation resolves them first,
  //      and record the invocation argv once for SESSION.log replay (RUN-17).
  setSessionArgv(argv);
  setRuntimeOverride(runtimeFlagsFromArgv(argv));

  // (c) --yolo COST PRE-FLIGHT (D-17-27) — runs whenever --yolo is present for a
  //     COST-INCURRING execution (write/plan/verify/research/compile/done/revise,
  //     next/resume, and bare invocation). It refuses (EXIT_COST_CAP) only when
  //     the projected remaining cost exceeds the session cost cap — not 50% of
  //     it (the ARCH-11 heuristic would refuse the default §15 paper). The
  //     per-call cap in complete(), which --yolo cannot skip, is the hard
  //     enforcement (RUN-18). projectEstimate never throws for on-disk paper
  //     state (a paper-less dir or a corrupt STATE.json projects the whole
  //     pipeline); an invalid runtime config is a one-line error.
  //
  //     Audit #24: read-only verbs (status/list/doctor/open), the --estimate
  //     preview and --version/--help incur no model cost and bypass it.
  if (shouldRunYoloCapPreflight(argv)) {
    let est: Awaited<ReturnType<typeof projectEstimate>>;
    try {
      const from = argvFlagValue(argv, 'from');
      est = await projectEstimate({ paperRoot: projectRoot(), ...(from !== undefined ? { from } : {}) });
    } catch (e) {
      // An invalid runtime config (or any projection failure) is one line
      // through dispatch() — which also releases the session lock.
      if (e instanceof PensmithError) throw e;
      throw new PensmithError((e as Error).message, EXIT_ERROR);
    }
    if (est.exceedsCap) {
      // HARD refusal before any model call: one line and EXIT_COST_CAP through
      // dispatch(), which also releases the session lock.
      throw new PensmithError(
        `REFUSED — --yolo projects ${formatUsd(est.totalUsd)} for the remaining steps, over the ` +
          `${formatUsd(est.capUsd)} session cost cap (RUN-18). Raise [budget] cost_cap_usd or ` +
          `PENSMITH_COST_CAP_USD, or run without --yolo to be asked before the cap is crossed.`,
        EXIT_COST_CAP,
      );
    }
  }

  // (d) --estimate (RUN-20) → print the projection (no network, no LLM call),
  //     then the V2 estimate-proceed gate: a terminal user may continue into
  //     the normal routing (with --estimate stripped); "no" or a run that
  //     cannot prompt exits 0 after printing.
  if (hasFlag(argv, 'estimate')) {
    let est: Awaited<ReturnType<typeof projectEstimate>>;
    try {
      const from = argvFlagValue(argv, 'from');
      est = await projectEstimate({ paperRoot: projectRoot(), ...(from !== undefined ? { from } : {}) });
    } catch (e) {
      // An invalid runtime config (or any projection failure) is one line
      // through dispatch() — which also releases the session lock.
      if (e instanceof PensmithError) throw e;
      throw new PensmithError((e as Error).message, EXIT_ERROR);
    }
    process.stdout.write(renderEstimate(est) + '\n');
    if (est.nothingLeft) return;
    const outcome = await runGate('estimate-proceed', { yolo: false });
    const proceed = outcome.kind === 'answered' && outcome.answer.kind === 'confirm' && outcome.answer.value === true;
    if (!proceed) return;
    argv = argv.filter((a) => a !== '--estimate');
  }

  // (e) Dispatch exactly once.
  // Root meta flags (--version / --help / -h): print the version, or the usage
  // of the root or of the named verb followed by the exit-code / global-flag /
  // environment footer (RUN-09). Never falls into the bare router path.
  if (checked.version && !checked.help) {
    process.stdout.write(`${VERSION}\n`);
    return undefined;
  }
  if (checked.help) {
    const helpVerb = firstVerb(argv);
    const target = helpVerb ? await loadVerbCommand(helpVerb) : command;
    const usageText = await renderUsage(target, helpVerb ? command : undefined);
    const plain = process.stdout.isTTY ? usageText : stripAnsi(usageText);
    process.stdout.write(`${plain}\n\n${helpFooter()}\n`);
    return undefined;
  }

  // (d) may have turned an --estimate preview into a real run ("proceed"): it is
  // mutating from here on — the paper-pointer choice and the session lock apply.
  if (currentSession !== null && !hasFlag(argv, 'estimate') && !READ_ONLY_VERBS.has(firstVerb(argv) ?? '')) {
    await enterMutatingSession(currentSession, firstVerb(argv), hasFlag(argv, 'yolo'));
  }

  const verb = firstVerb(argv);
  if (verb && !isSectionVerbWithoutNumber(argv, verb)) {
    // Explicit verb (with its required positional, if any) → citty runCommand
    // on the verb's own CommandDef with the verb's argv (value-taking globals
    // stripped, global booleans kept wherever they were typed). runCommand
    // throws instead of printing a stack or calling process.exit, and returns
    // the verb's result for the exit-code mapping (RUN-09, D-17-34). NO root
    // run() to fall through into (H2).
    const cmd = await loadVerbCommand(verb);
    const { result } = await runCommand(cmd, { rawArgs: verbArgv(argv) });
    return result;
  }

  // Either a bare invocation OR a section-scoped verb invoked without its
  // section number (UX-01). Resolve via resolveNextAction (NEVER throws,
  // C4/C5-HIGH) and dispatch via the shared helper, forwarding the parsed
  // global flags (C3-HIGH-2). Do NOT also call runCommand (citty would throw
  // 'No command specified' on bare, or reject the missing required positional).
  //
  // Goal-aware tier: map goal → the router's goal-AGNOSTIC stopAfterResearch.
  const paperRoot = projectRoot();
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
    const at =
      'n' in decision && 'slug' in decision ? ` (section ${decision.n} ${decision.slug})` : '';
    process.stderr.write(
      `pensmith ${verb}: no section is ready to ${verb} right now — the next step is ` +
      `\`pensmith ${decision.verb}\`${at}. Pass a section number ` +
      `(e.g. \`pensmith ${verb} 2\`) to ${verb} a specific section.\n`,
    );
    return { ok: false, exitCode: EXIT_ERROR };
  }

  // Learning hard-stop: render the per-claim learning end-state to TUTORIAL.md
  // INSTEAD OF dispatching the status verb's generic "ready to export" message.
  if (stop && decision.verb === 'status' && decision.reason === 'done') {
    await renderLearningEndState(paperRoot);
    return { ok: true, mode: 'learning-end-state' };
  }

  const verbArgs: Record<string, unknown> = {};
  if ('n' in decision) verbArgs.n = decision.n;
  if ('slug' in decision) verbArgs.slug = decision.slug;
  if ('reason' in decision) verbArgs.reason = decision.reason;
  // Bare runs propagate the dispatched verb's result (and so its exit code).
  return dispatchVerb(decision.verb, {
    args: verbArgs,
    globalFlags: {
      yolo: hasFlag(argv, 'yolo'),
      dryRun: hasFlag(argv, 'dry-run'),
      estimate: hasFlag(argv, 'estimate'),
      showPrompts: hasFlag(argv, 'show-prompts'),
    },
  });
}

/** The CommandDef for `verb` (real loader, or the stub). */
async function loadVerbCommand(verb: Ux02Verb): Promise<AnyCommandDef> {
  const loader = REAL_VERB_LOADERS[verb];
  return loader ? loader() : makeStub(verb);
}

// ---------------------------------------------------------------------------
// --help footer (RUN-09, D-17-34): exit codes, global flags, environment.
// ---------------------------------------------------------------------------

/** Environment variables pensmith reads (documented in --help and the README). */
export const ENVIRONMENT_DOCS: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ['ANTHROPIC_API_KEY', 'API key for the Anthropic provider (the default)'],
  ['OPENAI_API_KEY', 'API key for the OpenAI provider (used when it is the only key set)'],
  ['PENSMITH_NO_LLM', 'replaces every LLM call with a deterministic stub (testing and dry-run)'],
  ['PENSMITH_OFFLINE', 'sources, verification, detector and plagiarism checks use recorded fixtures instead of the network (a disclosed offline mode)'],
  ['PENSMITH_PAPER_ROOT', 'the project folder (containing .paper/) to work on; the CLI, the MCP server and the hooks honour it'],
  ['PENSMITH_COST_CAP_USD', 'session cost cap in USD (overrides [budget] cost_cap_usd)'],
  ['PENSMITH_PROMPT_MODE', '"numbered" reads gate answers from stdin one line per question (scripted answers)'],
  ['PENSMITH_DEBUG', 'print a stack trace for an unexpected error'],
]);

const GLOBAL_FLAG_DOCS: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ['--paper <name|path>', 'work on this paper (a name from `pensmith list`, or a folder containing .paper/)'],
  ['--yolo', 'skip the gates --yolo may skip; never the cost cap, detector consent or the active-paper choice'],
  ['--dry-run', 'preview: no network or model call'],
  ['--estimate', 'project the remaining cost, then offer to proceed'],
  ['--show-prompts', 'mirror outbound requests and LLM prompts to stderr before they are sent'],
  ['--runtime <provider>', 'LLM provider for this run: anthropic | openai | ollama | vllm | openai-compatible'],
  ['--model <id>', 'generation model for this run (judgment steps keep their own model)'],
]);

function columns(rows: ReadonlyArray<readonly [string, string]>): string[] {
  const width = Math.max(...rows.map(([a]) => a.length));
  return rows.map(([a, b]) => `  ${a.padEnd(width)}  ${b}`);
}

/** The footer appended to every `--help` (root and per-verb). */
export function helpFooter(): string {
  return [
    'GLOBAL FLAGS (accepted by every verb)',
    '',
    ...columns(GLOBAL_FLAG_DOCS),
    '',
    'EXIT CODES',
    '',
    ...columns(EXIT_CODES.map((c) => [`${c.code}  ${c.name}`, c.meaning] as const)),
    '',
    'ENVIRONMENT',
    '',
    ...columns(ENVIRONMENT_DOCS),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// dispatch() — the process-level wrapper (RUN-09, RUN-12, D-17-34).
// ---------------------------------------------------------------------------

/**
 * Run one invocation and set the process exit code. Every failure is ONE line
 * on stderr, never a stack trace:
 *   - a PensmithError prints `pensmith: <message>` and exits with its code;
 *   - an aborted/timed-out prompt exits EXIT_APPROVAL;
 *   - a citty usage error exits EXIT_USAGE;
 *   - anything else prints one line plus the PENSMITH_DEBUG hint, EXIT_ERROR.
 * A verb that returns normally exits with the code its result maps to (an
 * explicit process.exitCode it set wins). The session lock is released here.
 */
export async function dispatch(argv: string[] = process.argv.slice(2)): Promise<void> {
  let code: number;
  try {
    const result = await dispatchInner(argv);
    code = finalExitCode(result, process.exitCode);
  } catch (e) {
    const failure = classifyFailure(e);
    code = failure.code;
    process.stderr.write(`pensmith: ${failure.message}\n`);
    if (failure.unexpected) {
      if (process.env['PENSMITH_DEBUG'] === '1' && e instanceof Error && e.stack) {
        process.stderr.write(`${e.stack}\n`);
      } else {
        process.stderr.write('pensmith: set PENSMITH_DEBUG=1 for a stack trace\n');
      }
    }
  } finally {
    const session = currentSession;
    currentSession = null;
    if (session?.locked) await releaseSessionLock(session.root);
  }
  process.exitCode = code;
}

// CLI-style invocation: `node dist/bin/pensmith.js <verb>` dispatches.
// Guarded so importing this module from tests (WR-06: tests/cli-verbs.test.ts
// introspects command.subCommands at runtime) does NOT auto-run.
// RUN-10: isMainModule compares REALPATHS, so `npm i -g`, `npm link`, .bin
// shims and symlinked/junctioned roots dispatch (a plain URL comparison with
// argv[1] was false under a symlink and the CLI silently exited 0).
import { isMainModule } from './lib/main-guard.js';
if (isMainModule(import.meta.url)) {
  void dispatch();
}
