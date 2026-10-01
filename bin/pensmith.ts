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
// Pitfall 7 / PLUG-13 — every stdout line goes through bin/lib/output-sink.ts
// out(): the MCP server runs the same verbs in-process and points that sink at
// stderr, so a direct stdout write would corrupt its JSON-RPC stream (the
// `stdout-sink` and `mcp-stdout-graph` chokepoint rows enforce it).
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
//
// Phase 18 (GRND-18/19, D-18-28..30):
//   - runNextStep is the ONE routed step bare `pensmith`, `next` and `resume`
//     share: a section's step is plan → write → verify (each stage runs only if
//     the previous one succeeded and the router names the same section's next
//     stage), any other decision is its one verb; it prints
//     `pensmith: ran <steps>; next: <step>` and ends with the last verb's code.
//   - runRouted adds the --dry-run loop: steps repeat until done / attention, a
//     failure or gate refusal, or a decision that does not advance.
//   - --dry-run works in `<root>/.paper-dry-run/` (paths.ts paperDir, seeded by
//     dry-run-paper.ts under the session lock) and never writes `.paper/`.

// FIRST import: filters a dependency's DEP0040 (punycode) deprecation noise
// before any module that loads citation-js is evaluated (RUN-12).
import './lib/node-warnings.js';
import { existsSync } from 'node:fs';
import { defineCommand, runCommand, renderUsage, type CommandDef } from 'citty';
import { makeStub } from './cli/stubs.js';
import { VERSION } from './lib/version.generated.js';
import { UX02_VERBS, type Ux02Verb, canonicalVerb, VERB_ALIASES, nearest, expandVerbAlias } from './lib/verbs.js';
import {
  projectRoot,
  workingDirectory,
  resolvePaperRoot,
  setActivePaperRoot,
  setDryRunWorkspace,
  dryRunPaperDir,
  realPaperDir,
  activePaperBanner,
  hasPaper,
  mutatingVerbNeedsPaper,
  noPaperHereMessage,
  type PaperPointer,
} from './lib/paths.js';
import { migrateLegacyLayout } from './lib/state.js';
import { migratePaperConfigFile, parseCostCapEnv } from './lib/config.js';
import { enforceDryRunBoundary } from './lib/dry-run-paper.js';
import { acquireSessionLock, releaseSessionLock } from './lib/session-lock.js';
import { runGate, declineGate, canPrompt, yoloFlagDescription, yoloNeverList } from './lib/gates.js';
import { EXIT_CODES, EXIT_OK, EXIT_USAGE, EXIT_ERROR, PensmithError, type ExitCode } from './lib/exit-codes.js';
import { classifyFailure, finalExitCode, failureLine, stripAnsi } from './lib/verb-outcome.js';
import { setMirrorPromptsToStderr, setSessionArgv } from './lib/session-log.js';
import { announceModes, networkMode } from './lib/http-mock.js';
import { projectEstimate, renderEstimate, type EstimateScope } from './lib/estimator.js';
import { assertInvocationBudget } from './lib/budget.js';
import { argvFlagValue, runtimeFlagsFromArgv, setRuntimeOverride } from './lib/runtime.js';
import { isProviderName, PROVIDER_NAMES } from './lib/llm-models.js';
import { resolveNextAction, type RouterDecision } from './lib/router.js';
import { sameSectionId, sectionIdOf, sectionLabel, type SectionId } from './lib/section-id.js';
import { renderLearningEndState } from './cli/goal.js';
import { routeOptionsFor } from './cli/route-options.js';
import { out as writeOut } from './lib/output-sink.js';

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
    paper: { type: 'string', description: 'Work on this paper: a name from `pensmith list`, or a folder containing .paper/.', valueHint: 'name|path' },
    'dry-run': { type: 'boolean', description: 'Trial run in ./.paper-dry-run/ (a copy of .paper/, which is never written): no network or model call (sources and model replies are labelled stand-ins); bare/next/resume loop to the end of the paper.', default: false },
    estimate: { type: 'boolean', description: 'Project the remaining token + USD cost, then offer to proceed.', default: false },
    // Generated from the gate registry (gates.ts), so it cannot drift from it.
    yolo: { type: 'boolean', description: yoloFlagDescription(), default: false },
    'show-prompts': { type: 'boolean', description: 'Mirror every outbound request (and full LLM prompts) to stderr before it is sent.', default: false },
    runtime: { type: 'string', description: 'LLM provider for this run: anthropic | openai | ollama | vllm | openai-compatible (overrides the config).', valueHint: 'provider' },
    model: { type: 'string', description: 'Generation model for this run (outline, plan, write); judgment steps keep their own model.', valueHint: 'id' },
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
  /**
   * Option names → true when the option takes a value. Each option is listed
   * under its declared name AND its kebab-case form: citty accepts both
   * (`--lintHeadings` and `--lint-headings`), and its --help prints the
   * declared (camelCase) spelling, so validation must accept that one too.
   */
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
    const takesValue = def.type === 'string' || def.type === 'enum';
    options.set(name, takesValue);
    options.set(kebab(name), takesValue);
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
  /** The verb's positional arguments, in order (e.g. the section number). */
  readonly positionals: readonly string[];
  /**
   * argv with every global boolean in ONE spelling: a flag whose final value is
   * true appears once as the bare `--<name>` (at its last position), and a false
   * one does not appear at all. `--x=true|1`, `--x=false|0` and `--no-x` are
   * folded here, so every later check (`hasFlag`, citty, the logged argv) sees
   * the value the user asked for — `--dry-run=true` is a dry run.
   */
  readonly argv: readonly string[];
}

function usage(message: string): PensmithError {
  return new PensmithError(message, EXIT_USAGE);
}

/** The value of an inline `--<global boolean>=<v>`; anything but true/false/1/0 is EXIT_USAGE. */
function inlineBoolean(name: string, raw: string): boolean {
  const v = raw.toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  throw usage(`option '--${name}' is a switch: use --${name} or --no-${name} (got '--${name}=${raw}')`);
}

/** Rewrite the global booleans of argv into their one canonical spelling (see ValidatedArgv.argv). */
function normalizeGlobalBooleans(argv: readonly string[], finals: ReadonlyMap<string, { value: boolean; at: number }>): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i] ?? '';
    if (tok === '--') {
      out.push(...argv.slice(i));
      break;
    }
    const name = globalBooleanName(tok);
    if (name === null) {
      out.push(tok);
      continue;
    }
    const final = finals.get(name);
    if (final !== undefined && final.value && final.at === i) out.push(`--${name}`);
  }
  return out;
}

/** The global boolean a token spells (`--x`, `--x=v`, `--no-x`), or null. */
function globalBooleanName(tok: string): string | null {
  if (!tok.startsWith('--')) return null;
  const name = flagName(tok);
  if (GLOBAL_BOOLEAN_FLAGS.includes(name)) return name;
  if (!tok.includes('=') && tok.startsWith('--no-') && GLOBAL_BOOLEAN_FLAGS.includes(tok.slice(5))) return tok.slice(5);
  return null;
}

/**
 * argv with an alias at the verb position replaced by its verb and arguments
 * (verbs.ts expandVerbAlias). An alias given its own option again
 * (`pensmith export --only score`) is EXIT_USAGE.
 */
export function rewriteVerbAlias(argv: readonly string[]): string[] {
  const at = verbTokenIndex(argv);
  const { argv: expanded, conflict } = expandVerbAlias(argv, at);
  if (conflict !== null) {
    const alias = argv[at] ?? '';
    const named = VERB_ALIASES[alias];
    const spelled = named !== undefined ? `pensmith ${named.verb} ${named.args.join(' ')}` : `pensmith ${alias}`;
    throw usage(
      `'pensmith ${alias}' is '${spelled}' — it takes no ${conflict} of its own (run 'pensmith ${named?.verb ?? alias} ${conflict} …' instead)`,
    );
  }
  return expanded;
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
  // GRND-02: the intake answers (`--class`, `--discipline`, `--pii-redact`, …)
  // are options of `pensmith new`; a bare run takes only the global flags. Say
  // so, instead of reading `--class "PHIL 101"` as the unknown command "PHIL 101".
  // Only for a bare run: with a verb, a flag before it is that verb's (`pensmith --force outline`).
  const bareRun = at < 0 || canonicalVerb(argv[at] ?? '') === null;
  const leading = bareRun ? argv.slice(0, at >= 0 ? at : argv.length) : [];
  const endAt = leading.indexOf('--');
  const bareFlags = (endAt >= 0 ? leading.slice(0, endAt) : leading).filter((t) =>
    t.startsWith('--') && globalBooleanName(t) === null && !GLOBAL_VALUE_FLAGS.includes(flagName(t))
    && !HELP_FLAGS.includes(t) && !VERSION_FLAGS.includes(t));
  if (bareFlags.length > 0) {
    const intake = await verbArgShape('new');
    for (const flag of bareFlags) {
      const name = flagName(flag);
      const negated = !flag.includes('=') && flag.startsWith('--no-') ? flag.slice(5) : null;
      if (intake.options.has(name) || (negated !== null && intake.options.get(negated) === false)) {
        const spelled = flag.split('=')[0];
        throw usage(
          `'${spelled}' is an intake option of 'pensmith new' — a bare pensmith takes only the global flags; ` +
            `start the paper with 'pensmith new ${spelled} …', then run pensmith`,
        );
      }
    }
  }
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
  const positionalValues: string[] = [];
  const booleans = new Map<string, { value: boolean; at: number }>();
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i] ?? '';
    if (tok === '--') break;
    if (i === at) continue;
    const globalBool = globalBooleanName(tok);
    if (globalBool !== null) {
      // The last spelling wins: `--yolo --no-yolo` is false, `--dry-run=true` is true.
      const value = tok.startsWith('--no-') && !tok.includes('=')
        ? false
        : tok.includes('=') ? inlineBoolean(globalBool, tok.slice(tok.indexOf('=') + 1)) : true;
      booleans.set(globalBool, { value, at: i });
      continue;
    }
    if (!isFlagToken(tok)) {
      positionals += 1;
      positionalValues.push(tok);
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
    // RUN-09: `--runtime <provider>` names one of the providers — an unknown
    // one is an invalid argument (EXIT_USAGE) for every verb, before any work,
    // never an EXIT_ERROR at the first model call (or silence on a read-only verb).
    if (name === 'runtime' && !isProviderName(value)) {
      throw usage(`unknown provider '${value}' for --runtime; valid values: ${PROVIDER_NAMES.join(', ')}`);
    }
  }
  // RUN-09: a per-section verb's positional is a section number. `plan abc`
  // is a usage error — never routed as if no number were given.
  const sectionArg = positionalValues[0];
  if (verb !== null && SECTION_NUMBER_VERBS.includes(verb) && sectionArg !== undefined && !/^\d+[a-z]?$/.test(sectionArg)) {
    throw usage(`pensmith ${verb}: <n> must be a section number from 1 to 99; got '${sectionArg}'`);
  }
  return { verb, paperFlag, help, version, positionals: positionalValues, argv: normalizeGlobalBooleans(argv, booleans) };
}

/** This invocation is a --dry-run (the flag, or PENSMITH_DRY_RUN=1 inherited from a parent run). */
function isDryRunInvocation(argv: readonly string[]): boolean {
  return hasFlag([...argv], 'dry-run') || networkMode().dryRun;
}

/** Verbs whose (optional) positional is a section number. */
const SECTION_NUMBER_VERBS: readonly Ux02Verb[] = ['plan', 'write', 'verify'];

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
  /** The root is the paper-less cwd the resolver fell back to (step 5). */
  readonly cwdFallback: boolean;
  /** A dry-run workspace note (seeded / re-seeded / reset) still to print after the banners. */
  workspaceNote: string | null;
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

/**
 * Take the session lock for a mutating run (idempotent; re-entrant by PID),
 * then keep --dry-run and real papers apart (RUN-27, dry-run-paper.ts: a dry
 * run's workspace `.paper-dry-run/` is created, kept or seeded from `.paper/`,
 * GRND-19) and write an older config.toml back (CONF-01) — both under the
 * lock, before the verb touches anything. A dry run holds the paper's own
 * session lock, so it never interleaves with a real run on the same folder.
 */
async function enterMutatingSession(session: InvocationSession, verb: Ux02Verb | null, yolo: boolean, dryRun: boolean): Promise<void> {
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
  // RUN-27 / GRND-19: a --dry-run works only in its workspace (prepared here),
  // and a normal run never continues a paper a Phase 17 dry run made in
  // `.paper/` — refused before any file is touched.
  const workspace = await enforceDryRunBoundary(session.root, dryRun);
  session.workspaceNote = workspace?.note ?? null;
  // CONF-01: an older config.toml is written back at the current schema only
  // here, under the session lock (comments kept) — read-only runs never write.
  if (!dryRun) await migratePaperConfigFile(session.root);
}

// Section-scoped verbs with a REQUIRED positional section number. When invoked
// with no number, they default to the router-resolved next pending section (the
// single-command UX, UX-01) rather than failing citty's required-positional gate.
// NOTE: `write` is deliberately EXCLUDED — its `n` is OPTIONAL (omit to write
// ALL sections wave-by-wave, the tier-contract write-wave surface), so a bare
// `pensmith write` must reach citty/runMain, not the single-section router path.
const SECTION_SCOPED_VERBS: readonly Ux02Verb[] = ['plan', 'verify'];

/** True when argv carries a non-empty `--research <query>` (or `--research=<query>`). */
function hasResearchFlag(argv: readonly string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i] ?? '';
    if (tok.startsWith('--research=')) return tok.slice('--research='.length).trim().length > 0;
    if (tok === '--research') {
      const next = argv[i + 1];
      return next !== undefined && !next.startsWith('--') && next.trim().length > 0;
    }
  }
  return false;
}

/** True if `verb` is section-scoped AND no numeric positional follows it in argv. */
function isSectionVerbWithoutNumber(argv: string[], verb: Ux02Verb): boolean {
  if (!SECTION_SCOPED_VERBS.includes(verb)) return false;
  const verbIdx = argv.indexOf(verb);
  for (let i = verbIdx + 1; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === undefined) continue;
    // A bare section id after the verb is the section positional (`2`, or `1a`
    // for an inserted section — GRND-09).
    if (!tok.startsWith('-') && /^\d+[a-z]?$/.test(tok)) return false;
  }
  return true;
}

/**
 * The steps this invocation runs, for the --yolo pre-flight: an explicit verb
 * (with its section positional), or — for bare/next/resume and plan/verify
 * without a section number — the step the router resolves (it never throws).
 */
async function invocationScope(argv: string[], checked: ValidatedArgv): Promise<EstimateScope> {
  const verb = checked.verb;
  if (verb !== null && verb !== 'next' && verb !== 'resume' && !isSectionVerbWithoutNumber(argv, verb)) {
    const n = checked.positionals.find((p) => /^\d+[a-z]?$/.test(p));
    const base: EstimateScope = n !== undefined ? { verb, section: /^\d+$/.test(n) ? Number(n) : n } : { verb };
    // GRND-17: `plan N --research <q>` is the section research pass
    // (evaluator calls), not the planner's call (unless --revise follows it).
    if (verb === 'plan' && hasResearchFlag(argv)) {
      return { ...base, research: true, ...(argv.includes('--revise') ? { revise: true } : {}) };
    }
    return base;
  }
  const root = projectRoot();
  const decision = await resolveNextAction(root, routeOptionsFor(root));
  if (!('n' in decision)) return { verb: decision.verb };
  return { verb: decision.verb, section: decision.suffix !== undefined ? `${decision.n}${decision.suffix}` : decision.n };
}

/**
 * Every step THIS invocation runs, for the --yolo pre-flight (D-17-27). An
 * explicit verb is its own scope. A routed run (bare / next / resume) runs one
 * step of the chain (GRND-18, D-18-28): a `plan` decision also writes and
 * verifies that section, a `write` decision also verifies it — so all of them
 * are projected. A routed --dry-run loops to the end of the paper (D-18-30):
 * the whole remaining paper (undefined scope; its model calls are stubs).
 */
async function invocationScopes(argv: string[], checked: ValidatedArgv): Promise<Array<EstimateScope | undefined>> {
  const routed = checked.verb === null || checked.verb === 'next' || checked.verb === 'resume';
  if (routed && isDryRunInvocation(argv)) return [undefined];
  const scope = await invocationScope(argv, checked);
  // An explicit `write` verifies what it drafts (GRND-15, D-18-26) unless
  // --no-verify: `write N` also runs verify §N, a wave `write` verifies every
  // section it drafts.
  if (!routed && scope.verb === 'write' && !hasFlag(argv, 'no-verify') && !argv.includes('--verify=false')) {
    return [scope, scope.section !== undefined ? { verb: 'verify', section: scope.section } : { verb: 'verify', wave: true }];
  }
  if (!routed || scope.section === undefined) return [scope];
  const at = SECTION_CHAIN.indexOf(scope.verb as SectionChainVerb);
  if (at < 0) return [scope];
  return SECTION_CHAIN.slice(at).map((verb) => ({ ...scope, verb }));
}

/** Project several invocation scopes and add them up (the rows in order, the USD summed). */
async function projectScopes(
  paperRoot: string,
  scopes: ReadonlyArray<EstimateScope | undefined>,
  from: string | undefined,
): Promise<Awaited<ReturnType<typeof projectEstimate>>> {
  const parts: Array<Awaited<ReturnType<typeof projectEstimate>>> = [];
  for (const scope of scopes) {
    parts.push(await projectEstimate({ paperRoot, ...(scope !== undefined ? { scope } : {}), ...(from !== undefined ? { from } : {}) }));
  }
  const [first] = parts;
  if (first === undefined) throw new PensmithError('no estimate scope', EXIT_ERROR);
  const rows = parts.flatMap((p) => p.rows);
  const totalUsd = parts.reduce((acc, p) => acc + p.totalUsd, 0);
  return { ...first, rows, totalUsd, exceedsCap: totalUsd > first.capUsd, nothingLeft: rows.length === 0 };
}

// ---------------------------------------------------------------------------
// The routed chain: one bare / next / resume step (GRND-18, D-18-28) and the
// --dry-run loop (GRND-19, D-18-30).
// ---------------------------------------------------------------------------

/** A section's lifecycle, in order: one routed step runs it from the router's stage to verify. */
const SECTION_CHAIN = ['plan', 'write', 'verify'] as const;
type SectionChainVerb = (typeof SECTION_CHAIN)[number];

/** The section a plan / write / verify decision names, or null for any other decision. */
function decisionSection(d: RouterDecision): (SectionId & { slug: string }) | null {
  if (d.verb !== 'plan' && d.verb !== 'write' && d.verb !== 'verify') return null;
  // `suffix` (GRND-09, §1a) is optional on the decision; read it without assuming it.
  const suffix = (d as { suffix?: unknown }).suffix;
  return { ...sectionIdOf(d.n, typeof suffix === 'string' ? suffix : undefined), slug: d.slug };
}

/**
 * One line naming a router decision: `plan §1`, `write §1a`, `research`,
 * `status (done)`, `status (attention: <what and the command that fixes it>)`.
 */
export function describeDecision(d: RouterDecision): string {
  const s = decisionSection(d);
  if (s !== null) return `${d.verb} ${sectionLabel(s)}`;
  if (d.verb === 'status') {
    const detail = (d as { detail?: unknown }).detail;
    const at = d.section !== undefined ? ` ${sectionLabel(d.section)}` : '';
    return typeof detail === 'string' && detail.length > 0
      ? `status (${d.reason}: ${detail})`
      : `status (${d.reason}${at})`;
  }
  return d.verb;
}

/** The dispatch arguments of a decision (n / slug / reason where it has them). */
function decisionArgs(d: RouterDecision): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if ('n' in d) args['n'] = d.n;
  if ('slug' in d) args['slug'] = d.slug;
  if ('reason' in d) args['reason'] = d.reason;
  return args;
}

/** One verb the chain ran, and the exit code it ended with. */
export interface ChainStep {
  readonly label: string;
  readonly code: ExitCode;
}

/** What one routed step ran and where the paper stands after it. */
export interface RoutedStep {
  /** The last verb's result (what dispatch() maps to the exit code). */
  readonly result: unknown;
  readonly steps: readonly ChainStep[];
  /** The decision the step started from. */
  readonly first: RouterDecision;
  /** The router's decision after the step. */
  readonly next: RouterDecision;
  /** The exit code of the last verb (0 when every verb succeeded). */
  readonly code: ExitCode;
  /** The learning-goal end state was rendered instead of a verb (see goal.ts). */
  readonly learningEnd: boolean;
}

export interface RoutedOptions {
  readonly globalFlags: GlobalFlags;
  /** The decision to start from (next / resume resolved it already to announce it). */
  readonly first?: RouterDecision;
}

/**
 * `pensmith: ran plan §1, write §1, verify §1 (exit 4); next: verify §1`.
 * A step that only reported attention, which the router still reports, says
 * so in a few words: `status` printed the message just above, and repeating
 * it twice more made the summary a paragraph (GRND-18).
 */
function chainLine(steps: readonly ChainStep[], next: RouterDecision): string {
  const label = (s: ChainStep, text: string): string => (s.code === EXIT_OK ? text : `${text} (exit ${s.code})`);
  const nextText = describeDecision(next);
  const only = steps.length === 1 ? steps[0] : undefined;
  if (only !== undefined && next.verb === 'status' && next.reason === 'attention' && only.label === nextText) {
    return `pensmith: ran ${label(only, 'status (needs attention — see above)')}; next: do what it names, then run pensmith again`;
  }
  return `pensmith: ran ${steps.map((s) => label(s, s.label)).join(', ')}; next: ${nextText}`;
}

/**
 * Run ONE step of the paper (GRND-18, D-18-28) — the chain bare `pensmith`,
 * `next` and `resume` share. The router's decision is dispatched with the
 * forwarded global flags; a section step runs that section from the router's
 * stage to verify: a `plan` decision plans, then (if it succeeded and the
 * router now names the same section's `write`) writes, then (if the router
 * then names its `verify` — `write` may already have verified it) verifies.
 * Any other decision runs its one verb. The chain stops at the first verb that
 * does not succeed; its exit code is the step's. It prints what ran and the
 * router's next step on stderr (stdout stays the verbs' own output).
 */
export async function runNextStep(opts: RoutedOptions): Promise<RoutedStep> {
  const root = projectRoot();
  const routeOptions = routeOptionsFor(root);
  const stop = routeOptions.stopAfterResearch;
  const route = (): Promise<RouterDecision> => resolveNextAction(root, routeOptions);
  const first = opts.first ?? (await route());

  // Learning hard-stop: render the per-claim learning end-state to TUTORIAL.md
  // INSTEAD OF dispatching the status verb's generic "ready to export" message.
  if (stop && first.verb === 'status' && first.reason === 'done') {
    await renderLearningEndState(root);
    return { result: { ok: true, mode: 'learning-end-state' }, steps: [], first, next: first, code: EXIT_OK, learningEnd: true };
  }

  const steps: ChainStep[] = [];
  let decision = first;
  let result: unknown;
  for (;;) {
    const saved = process.exitCode;
    process.exitCode = undefined;
    try {
      result = await dispatchVerb(decision.verb, { args: decisionArgs(decision), globalFlags: opts.globalFlags });
    } catch (e) {
      // An expected failure (a gate refusal, a cost cap): say what ran, then let
      // dispatch() print its one line and exit with its code.
      process.exitCode = saved;
      steps.push({ label: describeDecision(decision), code: classifyFailure(e).code });
      process.stderr.write(`${chainLine(steps, await route())}\n`);
      throw e;
    }
    const code = finalExitCode(result, process.exitCode);
    if (code === EXIT_OK) process.exitCode = saved;
    steps.push({ label: describeDecision(decision), code });
    const after = await route();
    const here = decisionSection(decision);
    const there = decisionSection(after);
    const advances =
      code === EXIT_OK &&
      here !== null &&
      there !== null &&
      sameSectionId(there, here) &&
      there.slug === here.slug &&
      SECTION_CHAIN.indexOf(after.verb as SectionChainVerb) > SECTION_CHAIN.indexOf(decision.verb as SectionChainVerb);
    if (advances) {
      decision = after;
      continue;
    }
    process.stderr.write(`${chainLine(steps, after)}\n`);
    return { result, steps, first, next: after, code, learningEnd: false };
  }
}

/** The most steps one --dry-run loop takes (5 + N steps for N ≤ 99 sections, with room). */
const DRY_RUN_MAX_STEPS = 256;

/**
 * Bare `pensmith`, `next` and `resume`: one routed step (GRND-18), or — under
 * --dry-run — the dry-run loop (GRND-19, D-18-30): steps are repeated until
 * the router reports done or attention, a step fails or a gate refuses (its
 * exit code, e.g. 3 at the first gate a run without --yolo cannot answer), or
 * a decision repeats without progress (EXIT_ERROR). With --yolo a dry run goes
 * from the assignment to the export in one invocation.
 */
export async function runRouted(opts: RoutedOptions & { announce?: (d: RouterDecision) => void }): Promise<unknown> {
  const root = projectRoot();
  const routeOptions = routeOptionsFor(root);
  const stop = routeOptions.stopAfterResearch;
  const first = opts.first ?? (await resolveNextAction(root, routeOptions));
  // The learning end state (runNextStep) is not a verb to announce.
  if (opts.announce && !(stop && first.verb === 'status' && first.reason === 'done')) opts.announce(first);
  let step = await runNextStep({ ...opts, first });
  if (opts.globalFlags.dryRun !== true) return step.result;
  for (let i = 1; i < DRY_RUN_MAX_STEPS; i += 1) {
    if (step.code !== EXIT_OK || step.learningEnd || step.next.verb === 'status') return step.result;
    if (describeDecision(step.next) === describeDecision(step.first)) {
      process.stderr.write(
        `pensmith: the dry run stopped — \`${describeDecision(step.first)}\` ran without advancing the paper\n`,
      );
      return { ok: false, exitCode: EXIT_ERROR };
    }
    step = await runNextStep({ ...opts, first: step.next });
  }
  process.stderr.write(`pensmith: the dry run stopped after ${DRY_RUN_MAX_STEPS} steps without reaching the end of the paper\n`);
  return { ok: false, exitCode: EXIT_ERROR };
}

/** `outline`, or `write §1, write §2, write §3`, or `write §1 … write §9 (9 steps)`. */
function describeSteps(rows: ReadonlyArray<{ step: string }>): string {
  const steps = rows.map((r) => r.step);
  if (steps.length <= 3) return steps.join(', ');
  return `${steps[0]} … ${steps[steps.length - 1]} (${steps.length} steps)`;
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
  // EXP-21 (D-21-23): an alias (`export`, `humanize`, `score`, `plagiarism`)
  // is rewritten to the verb and arguments it names (`done --only export`)
  // BEFORE argv validation, so it validates, dispatches and logs exactly as
  // that invocation would.
  argv = rewriteVerbAlias(argv);
  const checked = await validateArgv(argv);
  // Every check below reads the normalized global booleans (`--dry-run=true`
  // is a dry run, `--no-yolo` is not --yolo) — never the raw spellings.
  argv = [...checked.argv];
  const meta = checked.help || checked.version;

  // (b) --dry-run → both channels off (D-17-04) and the paper moves to the
  //     dry-run workspace (GRND-19, D-18-29). PENSMITH_DRY_RUN=1 makes the
  //     http.ts gate refuse every request (zero sockets), routes research to
  //     the labelled synthetic provider (RUN-27) and points paths.ts paperDir()
  //     at `<root>/.paper-dry-run`; PENSMITH_NO_LLM=1 stubs every model call.
  //     Both are env vars so child processes inherit the mode. Set BEFORE the
  //     paper root is resolved: the resolver, the legacy-layout move and the
  //     session all see the workspace, never the real `.paper/`. An inherited
  //     PENSMITH_DRY_RUN=1 is the same dry run (the cost pre-flight then prices
  //     the stubbed calls at $0, as they are).
  if (isDryRunInvocation(argv)) {
    process.env['PENSMITH_DRY_RUN'] = '1';
    process.env['PENSMITH_NO_LLM'] = '1';
    setDryRunWorkspace(true);
  }

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
      cwdFallback: resolved.kind === 'root' && resolved.source === 'fallback',
      workspaceNote: null,
    };
    currentSession = session;
    if (resolved.kind !== 'ask-pointer') {
      setActivePaperRoot(session.root);
      await migrateLegacyLayout(session.root);
    }
    if (resolved.kind === 'pointer' && checked.verb !== 'open') {
      process.stderr.write(`${activePaperBanner(resolved.pointer)}\n`);
    }
    // RUN-18: an invalid PENSMITH_COST_CAP_USD is one EXIT_USAGE line before
    // any verb runs (never a silent $5 default) — for every run that can spend
    // or projects spend (--estimate); `status` shows it instead of failing.
    if (!readOnly || hasFlag(argv, 'estimate')) parseCostCapEnv(process.env['PENSMITH_COST_CAP_USD']);
    if (!readOnly) await enterMutatingSession(session, checked.verb, hasFlag(argv, 'yolo'), isDryRunInvocation(argv));
    // GRND-19: a read-only dry run (`status --dry-run`) on a real paper whose
    // workspace does not exist yet seeds it first — a copy into
    // `.paper-dry-run/` under the session lock, exactly as a mutating dry run
    // does; `.paper/` is only read — so it reports the paper, never "no active
    // paper" for a folder that holds one.
    if (readOnly && isDryRunInvocation(argv) && (checked.verb === 'status' || hasFlag(argv, 'estimate'))
      && resolved.kind === 'root'
      && !existsSync(dryRunPaperDir(session.root)) && existsSync(realPaperDir(session.root))) {
      session.workspaceNote = await seedWorkspaceForReadOnly(session.root, checked.verb);
    }
  }

  // (a) --show-prompts → the http.ts egress gate mirrors every outbound request
  //     (URL, LLM body, POST previews; never headers) to stderr BEFORE it is sent
  //     (RUN-16, D-17-12).
  if (hasFlag(argv, 'show-prompts')) setMirrorPromptsToStderr(true);

  // RUN-02 banners (once, stderr, before other output) + the D-17-15
  // installed-package refusal (throws OfflineFixturesNotShippedError, EXIT_ERROR).
  // A dry run's banner names its workspace (GRND-19, D-18-30).
  announceModes({
    verb: firstVerb(argv),
    argv,
    ...(isDryRunInvocation(argv) ? { workspace: dryRunPaperDir(projectRoot()) } : {}),
  });
  printWorkspaceNote();

  // (b2) --runtime / --model (RUN-08, D-17-19): pre-parse into the runtime
  //      override so every model call in this invocation resolves them first,
  //      and record the invocation argv once for SESSION.log replay (RUN-17).
  setSessionArgv(argv);
  setRuntimeOverride(runtimeFlagsFromArgv(argv));

  // (c) --yolo COST PRE-FLIGHT (D-17-27) — runs whenever --yolo is present for a
  //     COST-INCURRING execution (an explicit verb, next/resume, or a bare run).
  //     It projects the steps THIS invocation runs — the named verb (and
  //     section; `write` with no section is every section with a PLAN.md, and
  //     `write` also verifies what it drafts unless --no-verify), or for
  //     bare/next/resume the step the router picks — never the rest of the
  //     paper, which this run will not touch. Over the session cap it goes
  //     through the same never-skippable cost-cap gate, with the same one-line
  //     message, as the per-call check in complete() (RUN-18), which remains
  //     the hard enforcement. An invalid runtime config is a one-line error.
  //
  //     Audit #24: read-only verbs (status/list/doctor/open), the --estimate
  //     preview and --version/--help incur no model cost and bypass it.
  if (shouldRunYoloCapPreflight(argv)) {
    let est: Awaited<ReturnType<typeof projectEstimate>>;
    try {
      const from = argvFlagValue(argv, 'from');
      est = await projectScopes(projectRoot(), await invocationScopes(argv, checked), from);
    } catch (e) {
      // An invalid runtime config (or any projection failure) is one line
      // through dispatch() — which also releases the session lock.
      if (e instanceof PensmithError) throw e;
      throw new PensmithError((e as Error).message, EXIT_ERROR);
    }
    if (est.totalUsd > 0) {
      await assertInvocationBudget({ projectedUsd: est.totalUsd, what: describeSteps(est.rows), root: projectRoot() });
    }
  }

  // (d) --estimate (RUN-20) → print the projection (no network, no LLM call),
  //     then the V2 estimate-proceed gate: a terminal user may continue into
  //     the normal routing (with --estimate stripped); "no" or a run that
  //     cannot prompt exits 0 after printing. An explicit verb projects what
  //     "proceed" would run — that verb (and section), the same scope as the
  //     --yolo pre-flight; bare/next/resume project the whole remaining paper.
  if (hasFlag(argv, 'estimate')) {
    let est: Awaited<ReturnType<typeof projectEstimate>>;
    try {
      const from = argvFlagValue(argv, 'from');
      const explicit = checked.verb !== null && checked.verb !== 'next' && checked.verb !== 'resume';
      est = explicit
        ? await projectScopes(projectRoot(), await invocationScopes(argv, checked), from)
        : await projectEstimate({ paperRoot: projectRoot(), ...(from !== undefined ? { from } : {}) });
    } catch (e) {
      // An invalid runtime config (or any projection failure) is one line
      // through dispatch() — which also releases the session lock.
      if (e instanceof PensmithError) throw e;
      throw new PensmithError((e as Error).message, EXIT_ERROR);
    }
    writeOut(renderEstimate(est) + '\n');
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
    writeOut(`${VERSION}\n`);
    return undefined;
  }
  if (checked.help) {
    const helpVerb = firstVerb(argv);
    const target = helpVerb ? await loadVerbCommand(helpVerb) : command;
    const usageText = await renderUsage(target, helpVerb ? command : undefined);
    const plain = process.stdout.isTTY ? usageText : stripAnsi(usageText);
    writeOut(`${plain}\n\n${helpFooter()}\n`);
    return undefined;
  }

  // (d) may have turned an --estimate preview into a real run ("proceed"): it is
  // mutating from here on — the paper-pointer choice, the no-paper refusal
  // (S-21: the preview was read-only, so the resolver let a paper-less folder
  // through) and the session lock apply.
  if (currentSession !== null && !hasFlag(argv, 'estimate') && !READ_ONLY_VERBS.has(firstVerb(argv) ?? '')) {
    const s = currentSession;
    if (s.cwdFallback && !hasPaper(s.root) && mutatingVerbNeedsPaper(firstVerb(argv))) {
      throw new PensmithError(noPaperHereMessage(s.cwd), EXIT_USAGE);
    }
    await enterMutatingSession(s, firstVerb(argv), hasFlag(argv, 'yolo'), isDryRunInvocation(argv));
    printWorkspaceNote();
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

  const globalFlags: GlobalFlags = {
    yolo: hasFlag(argv, 'yolo'),
    dryRun: isDryRunInvocation(argv),
    estimate: hasFlag(argv, 'estimate'),
    showPrompts: hasFlag(argv, 'show-prompts'),
  };

  // A bare invocation (verb === null): one routed step of the paper — for a
  // section, its plan → write → verify — or, under --dry-run, the dry-run loop
  // (GRND-18/19, D-18-28/30). resolveNextAction NEVER throws (C4/C5-HIGH) and
  // the verbs are dispatched through the shared helper with the global flags
  // forwarded (C3-HIGH-2); the result (and so the exit code) is the last verb's.
  if (verb === null) return runRouted({ globalFlags });

  // A section-scoped verb (plan/verify) typed WITHOUT its section number (UX-01).
  // Do NOT call runCommand (citty would reject the missing required positional).
  // Audit #10: it defaults to the next section that needs THAT verb — it must
  // NEVER silently run whatever DIFFERENT verb the router happens to pick. When
  // the router's next action is not the requested verb, no section is ready for
  // it — tell the user the real next step instead of running a command they did
  // not ask for. It runs that one verb (never the bare chain).
  // The same routing options as bare / next / status (review round 3: an
  // outline-only paper's `pensmith plan` planned §1 — a paid call — while
  // status said the paper was complete).
  const paperRoot = projectRoot();
  const routeOptions = routeOptionsFor(paperRoot);
  const decision = await resolveNextAction(paperRoot, routeOptions);
  if (decision.verb !== verb) {
    const at =
      'n' in decision && 'slug' in decision ? ` (section ${decision.n} ${decision.slug})` : '';
    const outlineOnly = routeOptions.stopAfterOutline
      ? 'this paper is outline only ([project] mode = "outline"): no section is planned, drafted or verified unless you name it — '
      : `no section is ready to ${verb} right now — `;
    process.stderr.write(
      `pensmith ${verb}: ${outlineOnly}the next step is ` +
      `\`pensmith ${decision.verb}\`${at}. Pass a section number ` +
      `(e.g. \`pensmith ${verb} 2\`) to ${verb} a specific section.\n`,
    );
    return { ok: false, exitCode: EXIT_ERROR };
  }
  return dispatchVerb(decision.verb, { args: decisionArgs(decision), globalFlags });
}

/** Print (once) the dry-run workspace note the session recorded — after the RUN-02 banners. */
/**
 * Seed the dry-run workspace of `root` for a read-only dry run (see the
 * pre-flight): the session lock is held only while the workspace is copied.
 * Returns the note to print. When another session holds the paper the
 * workspace is not seeded, and the note says how to seed it.
 */
async function seedWorkspaceForReadOnly(root: string, verb: string | null): Promise<string> {
  try {
    await acquireSessionLock(root, { kind: 'cli', verb: verb ?? 'pensmith' });
  } catch (e) {
    const why = e instanceof PensmithError ? e.message : String(e);
    return (
      `pensmith: the dry-run workspace ${dryRunPaperDir(root)} does not exist yet and could not be seeded now (${why}); ` +
      `a dry run (\`pensmith --dry-run\`) seeds it from ${realPaperDir(root)}`
    );
  }
  try {
    const outcome = await enforceDryRunBoundary(root, true);
    return outcome?.note ?? `pensmith: prepared the dry-run workspace ${dryRunPaperDir(root)}`;
  } finally {
    await releaseSessionLock(root);
  }
}

function printWorkspaceNote(): void {
  const note = currentSession?.workspaceNote ?? null;
  if (note === null || currentSession === null) return;
  currentSession.workspaceNote = null;
  process.stderr.write(`${note}\n`);
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
  ['PENSMITH_OFFLINE', 'sources and verification use recorded fixtures instead of the network; the detector score and the plagiarism check are skipped, never replayed (a disclosed offline mode)'],
  ['PENSMITH_PAPER_ROOT', 'the project folder (containing .paper/) to work on; the CLI, the MCP server and the hooks honour it'],
  ['PENSMITH_CONTACT_EMAIL', 'polite-pool contact sent to Crossref, OpenAlex and Unpaywall only (Unpaywall is skipped without it)'],
  ['OPENALEX_API_KEY', 'optional, free: OpenAlex key sent as api_key (keyless requests share a small daily budget)'],
  ['PENSMITH_S2_API_KEY', 'optional: Semantic Scholar key sent as x-api-key (keyless requests are often rate limited)'],
  ['ZOTERO_API_KEY', 'optional: read your Zotero library through the Zotero Web API (sent only as Zotero-API-Key)'],
  ['ZOTERO_GROUP_ID', 'optional: read a Zotero group library instead of your own'],
  ['PENSMITH_ZOTERO_LOCAL', '1 reads Zotero 7\'s local API on this machine (127.0.0.1:23119); nothing leaves the machine'],
  ['PENSMITH_GROBID_URL', 'optional: a loopback GROBID server that reads your PDFs\' title, authors and DOI'],
  ['GPTZERO_API_KEY', 'optional: done\'s AI-detector score through GPTZero (sent only as x-api-key, after your consent)'],
  ['ORIGINALITY_API_KEY', 'optional: the same score through Originality.ai ([humanizer] honesty_backend = "originality")'],
  ['SAPLING_API_KEY', 'optional: the same score through Sapling ([humanizer] honesty_backend = "sapling")'],
  ['PENSMITH_COST_CAP_USD', 'session cost cap in USD (overrides [budget] cost_cap_usd)'],
  ['PENSMITH_PROMPT_MODE', '"numbered" reads gate answers from stdin one line per question (scripted answers)'],
  ['PENSMITH_DEBUG', 'print a stack trace for an unexpected error'],
]);

const GLOBAL_FLAG_DOCS: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ['--paper <name|path>', 'work on this paper (a name from `pensmith list`, or a folder containing .paper/)'],
  // Generated from the gate registry, like the OPTIONS block (review round 1: the hand-written list drifted).
  ['--yolo', `skip the gates --yolo may skip; never ${yoloNeverList()}`],
  ['--dry-run', 'trial run in ./.paper-dry-run/ (seeded from .paper/, never writing it): no network or model call'],
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
    'ALIASES (sub-steps of a verb, not verbs of their own)',
    '',
    ...columns(Object.entries(VERB_ALIASES).map(([alias, a]) => [alias, `pensmith ${a.verb} ${a.args.join(' ')}`] as const)),
    '',
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
    process.stderr.write(`${failureLine(failure.message)}\n`);
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
