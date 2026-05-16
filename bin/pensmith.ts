#!/usr/bin/env node
// bin/pensmith.ts — Tier 2 dispatcher.
//
// D-03: citty@^0.2.2 (locked).
// D-05: exactly 16 verbs from REQUIREMENTS.md UX-02 — doctor (real) + 15 stubs.
//   Phase 6+ verbs like `export`/`citations`/`humanize`/`gpt-zero`/`plagiarism`
//   are sub-commands under `compile`/`verify`, NOT first-class verbs in v0.1.0.
// Pitfall 7 — DO NOT console.log here; this binary is the CLI, not
// the MCP server, but consistency matters for future stdio surfaces.

import { defineCommand, runMain } from 'citty';
import { makeStub } from './cli/stubs.js';
import { VERSION } from './lib/version.generated.js';

const main = defineCommand({
  meta: {
    name: 'pensmith',
    // WR-01: VERSION is derived from package.json#version at prebuild time
    // (scripts/prebuild.mjs writes bin/lib/version.generated.ts). NEVER
    // inline a literal here — it will drift from npm's view of the package.
    version: VERSION,
    description: 'Pensmith — Tier 2 portable CLI. Section-as-phase academic writing.',
  },
  subCommands: {
    // Real verb (Phase 2):
    doctor: () => import('./cli/doctor.js').then((m) => m.doctorCommand),

    // Stubs (Phase 2 — Phase 3+ replaces each):
    // NOTE: re-read REQUIREMENTS.md UX-02 + CONTEXT.md D-05 before edit. The exact
    //       list is part of the tier contract and must match workflows/*.md key-for-key.
    new: () => Promise.resolve(makeStub('new')),
    next: () => Promise.resolve(makeStub('next')),
    status: () => Promise.resolve(makeStub('status')),
    research: () => Promise.resolve(makeStub('research')),
    outline: () => Promise.resolve(makeStub('outline')),
    plan: () => Promise.resolve(makeStub('plan')),
    write: () => Promise.resolve(makeStub('write')),
    verify: () => Promise.resolve(makeStub('verify')),
    compile: () => Promise.resolve(makeStub('compile')),
    done: () => Promise.resolve(makeStub('done')),
    resume: () => Promise.resolve(makeStub('resume')),
    list: () => Promise.resolve(makeStub('list')),
    open: () => Promise.resolve(makeStub('open')),
    sketch: () => Promise.resolve(makeStub('sketch')),
    add: () => Promise.resolve(makeStub('add')),
  },
});

void runMain(main);
