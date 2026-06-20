#!/usr/bin/env node
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

import { defineCommand, runMain, type CommandDef } from 'citty';
import { makeStub } from './cli/stubs.js';
import { VERSION } from './lib/version.generated.js';
import { UX02_VERBS, type Ux02Verb } from './lib/verbs.js';
import { setMirrorPromptsToStderr } from './lib/session-log.js';
import { projectEstimate } from './lib/estimator.js';
import { resolveNextAction } from './lib/router.js';

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
    process.exitCode = 1;
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
    'dry-run': { type: 'boolean', description: 'Zero external API calls; use cassette fixtures + offline LLM placeholder.', default: false },
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

/** The configured session cap (C2-M3): PENSMITH_COST_CAP_USD if finite >0, else $5. */
function configuredCapUsd(): number {
  const raw = process.env['PENSMITH_COST_CAP_USD'];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 5.0;
}

/** Find the first non-flag argv token that is one of the locked 16 verbs. */
function firstVerb(argv: string[]): Ux02Verb | null {
  for (const tok of argv) {
    if (tok.startsWith('-')) continue;
    if ((UX02_VERBS as readonly string[]).includes(tok)) return tok as Ux02Verb;
    // The first non-flag token that is NOT a verb is a positional for an
    // (implicit) bare invocation; stop scanning.
    return null;
  }
  return null;
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
 * The pre-dispatch entrypoint: applies global-flag setup, the yolo cap
 * pre-flight, and the --estimate preview BEFORE any verb runs, then dispatches
 * exactly once (explicit verb → runMain; bare → resolveNextAction + dispatchVerb).
 */
export async function dispatch(argv: string[] = process.argv.slice(2)): Promise<void> {
  // (a) --show-prompts → mirror prompts to stderr (BEFORE any LLM call).
  if (hasFlag(argv, 'show-prompts')) setMirrorPromptsToStderr(true);

  // (b) --dry-run → gate BOTH egress channels via env the existing code honors.
  if (hasFlag(argv, 'dry-run')) {
    process.env['PENSMITH_NETWORK_TESTS'] = ''; // source adapters → cassettes (isOfflineMode()===true)
    process.env['PENSMITH_NO_LLM'] = '1'; // LLM call sites (pass2/pass4) → offline placeholder, ZERO egress
    process.env['PENSMITH_DRY_RUN'] = '1'; // advisory marker only — NOT itself a gate
  }

  // (c) H1 / C2-H1 YOLO CAP PRE-FLIGHT — runs WHENEVER --yolo is present, for
  //     ANY verb (incl. non-gate write/plan/verify) and bare invocation,
  //     INDEPENDENT of --estimate. projectEstimate is guarded against ALL load
  //     errors, so a paper-less dir / corrupt STATE.json sees an empty estimate.
  if (hasFlag(argv, 'yolo')) {
    const est = await projectEstimate({ paperRoot: process.cwd(), sessionCapUsd: configuredCapUsd() });
    if (est.exceedsHalfCap) {
      process.stderr.write(
        'pensmith: REFUSED — --yolo estimate exceeds 50% of the session cap (ARCH-11).\n',
      );
      process.exit(1); // HARD refusal — not advisory, not nested in --estimate
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
    await runMain(command);
    return;
  }

  const verb = firstVerb(argv);
  if (verb && !isSectionVerbWithoutNumber(argv, verb)) {
    // Explicit verb (with its required positional, if any) → citty parses
    // --yolo into the subcommand args itself; no manual forwarding needed. NO
    // root run() to fall through into (H2).
    await runMain(command);
    return;
  }

  // Either a bare invocation OR a section-scoped verb invoked without its
  // section number (UX-01). Resolve via resolveNextAction (NEVER throws,
  // C4/C5-HIGH) and dispatch via the shared helper, forwarding the parsed
  // global flags (C3-HIGH-2). Do NOT also call runMain (citty would throw
  // 'No command specified' on bare, or reject the missing required positional).
  const decision = await resolveNextAction(process.cwd());
  const verbArgs: Record<string, unknown> = {};
  if ('n' in decision) verbArgs.n = decision.n;
  if ('slug' in decision) verbArgs.slug = decision.slug;
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

// CLI-style invocation: `node dist/bin/pensmith.js <verb>` dispatches.
// Guarded so importing this module from tests (WR-06: tests/cli-verbs.test.ts
// introspects command.subCommands at runtime) does NOT auto-run.
// Same pathToFileURL + import.meta.url comparison pattern as mcp/server.ts —
// naive `file://${process.argv[1]}` fails on Windows for relative argv[1].
import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void dispatch();
}
