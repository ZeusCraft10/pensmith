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

import { defineCommand, runMain, type CommandDef } from 'citty';
import { makeStub } from './cli/stubs.js';
import { VERSION } from './lib/version.generated.js';
import { UX02_VERBS, type Ux02Verb } from './lib/verbs.js';

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
 */
const REAL_VERB_LOADERS: Partial<Record<Ux02Verb, () => Promise<AnyCommandDef>>> = {
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
  // Phase 4 Plan 04-04 (WRTE-02 / D-06): citation-swap revise verb.
  revise: () => import('./cli/revise.js').then((m) => m.reviseCommand),
};

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
  subCommands: buildSubCommands(),
});

// Back-compat alias for any prior consumer that imported `main`.
export const main = command;

// CLI-style invocation: `node dist/bin/pensmith.js <verb>` dispatches.
// Guarded so importing this module from tests (WR-06: tests/cli-verbs.test.ts
// introspects command.subCommands at runtime) does NOT auto-run.
// Same pathToFileURL + import.meta.url comparison pattern as mcp/server.ts —
// naive `file://${process.argv[1]}` fails on Windows for relative argv[1].
import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void runMain(command);
}
