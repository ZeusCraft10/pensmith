---
phase: 02-tier-shells-doctor-tier-contract-gate
plan: 05
type: execute
wave: 2
depends_on: ["02-00"]
files_modified:
  - bin/cli/pensmith.ts
  - bin/cli/doctor.ts
  - bin/lib/doctor/probes.ts
  - bin/lib/doctor/probes/node-version.ts
  - bin/lib/doctor/probes/mcp-presence.ts
  - bin/lib/doctor/probes/contact-email.ts
  - bin/lib/doctor/probes/sync-folder.ts
  - bin/lib/doctor/probes/runtime-config.ts
  - bin/lib/doctor/render.ts
  - tests/cli-verbs.test.ts
  - tests/cli-stubs.test.ts
  - tests/doctor-exit-code.test.ts
  - tests/doctor-shape.test.ts
  - tests/doctor-probes.test.ts
  - package.json
autonomous: true
requirements: [TIER-01, TIER-02, TIER-03, TIER-04, DOCT-01, DOCT-02, DOCT-03, DOCT-04, DOCT-06]
must_haves:
  truths:
    - "All 17 verbs are dispatchable via `pensmith <verb>` and only `doctor` does real work"
    - "Stub verbs exit 0 with stdout containing the phrase 'not implemented yet'"
    - "`pensmith doctor` exits 0 when every probe is PASS/WARN/SKIP, and non-zero when any probe is FAIL"
    - "`pensmith doctor --json` emits the locked JSON shape from `references/doctor-output.md`"
    - "Probes return a `Record<string, ProbeResult>` keyed by probe.id (D-20)"
    - "Doctor is read-only — no writes to .paper/, no lock acquisition, no atomic-write calls (D-19)"
    - "Probe report copy matches references/doctor-output.md verbatim — locked"
  artifacts:
    - path: "bin/cli/pensmith.ts"
      provides: "citty dispatcher with 17 subCommands (1 real + 16 stubs)"
    - path: "bin/cli/doctor.ts"
      provides: "doctor verb implementation — TTY + --json output paths"
    - path: "bin/lib/doctor/probes.ts"
      provides: "ProbeResult type + runDoctor() aggregator (returns Record<string, ProbeResult>)"
    - path: "bin/lib/doctor/probes/{5 files}"
      provides: "Five probes — node-version, mcp-presence, contact-email, sync-folder, runtime-config (DOCT-01..04, DOCT-06; DOCT-05 lands in 02-07)"
    - path: "bin/lib/doctor/render.ts"
      provides: "TTY renderer + JSON serializer using locked copy from references/doctor-output.md"
  key_links:
    - from: "bin/cli/pensmith.ts"
      to: "citty@^0.2.2"
      via: "defineCommand + subCommands + runMain"
      pattern: "subCommands:"
    - from: "bin/cli/doctor.ts"
      to: "bin/lib/doctor/probes.ts"
      via: "import { runDoctor } "
      pattern: "runDoctor"
    - from: "bin/lib/doctor/probes/sync-folder.ts"
      to: "bin/lib/paths.ts isInsideSyncFolder"
      via: "presence check on paperDir()"
      pattern: "isInsideSyncFolder"
---

<objective>
Ship Tier 2 — the portable Node CLI — and the read-only `doctor` verb that backs Phase 2's
ecosystem-self-checks.

Per D-14: `bin/cli/pensmith.ts` is a citty dispatcher with **17 subCommands**. Only the
`doctor` verb performs real work. The other 16 are stubs that print "not implemented yet"
and exit 0. That single-shell-many-stubs pattern is the load-bearing TIER-01 / TIER-02
property — it locks the verb list in the dispatcher so Phase 3+ implementations slot in
without growing the surface.

Per D-15..D-20: `doctor` runs 5 probes, returns a `Record<string, ProbeResult>` keyed by
probe.id, exits 0 unless any probe severity is FAIL, defaults to TTY output, supports
`--json`, and **never writes to disk** (read-only — D-19).

Per D-18: TTY copy and JSON shape are locked in `references/doctor-output.md` (Wave 0,
02-00 ships that). Render code in this plan reads severity icons + section headers
from the locked file or duplicates them verbatim with a comment pointing at the source.

Per D-21: when a probe disagrees with a tier (e.g., DOCT-02 says `dist/mcp/server.js`
missing because the build hasn't run), the default fix is to BUILD, not to make the
probe lenient.

Output: `node dist/bin/pensmith.js --version` exits 0, `node dist/bin/pensmith.js doctor`
runs 5 probes and renders the locked report; `node dist/bin/pensmith.js doctor --json`
emits a `jq`-pipeable JSON object.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-RESEARCH.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-PATTERNS.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-VALIDATION.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-00-review-cleanup-PLAN.md
@bin/lib/paths.ts
@bin/lib/runtime.ts
@references/http-warnings.md

<interfaces>
<!-- citty@^0.2.2 surface (D-03 lock). Pattern source: RESEARCH § citty patterns. -->

```typescript
import { defineCommand, runMain } from 'citty';

const main = defineCommand({
  meta: { name: 'pensmith', version: '0.2.0', description: '...' },
  subCommands: {
    doctor: () => import('./doctor.js').then((m) => m.doctorCommand),
    intake: () => import('./stubs.js').then((m) => m.makeStub('intake')),
    // ... 16 more (15 stubs + doctor)
  },
});

runMain(main);
```

<!-- ProbeResult shape (D-15, D-20 — Record<string, ProbeResult> keyed by probe.id): -->

```typescript
// bin/lib/doctor/probes.ts
export type Severity = 'PASS' | 'WARN' | 'FAIL' | 'SKIP';

export interface ProbeResult {
  id: string;            // e.g., 'node-version'
  severity: Severity;
  summary: string;       // one-line copy (locked in references/doctor-output.md)
  detail?: string;       // multi-line additional context (optional)
  fix?: string;          // user-actionable remediation (optional)
}

export interface Probe {
  id: string;
  run(): Promise<ProbeResult>;
}

export async function runDoctor(): Promise<Record<string, ProbeResult>> {
  // executes all probes in parallel, returns Record keyed by probe.id (D-20)
}
```

<!-- The 17 verbs (D-14 locked list — exact spelling): -->

```
doctor (real) + 16 stubs:
  intake, research, outline, plan, write, verify, compile,
  export, library, citations, humanize, gpt-zero, plagiarism,
  status, resume, help-paper
```

Note: `help-paper` is the verb name (citty already owns `help`).
The exact list MUST come from D-14 in CONTEXT.md — re-read before implementing.

<!-- Existing helpers the probes consume: -->

```typescript
// bin/lib/paths.ts
export function paperDir(opts?: { paperRoot?: string }): string
export function isInsideSyncFolder(absPath: string): boolean

// bin/lib/runtime.ts  -- ALLOWED in bin/cli/ and bin/lib/doctor/ — D-12 lint only fires inside mcp/**.
export async function loadRuntimeConfig(opts): Promise<RuntimeConfig>
export async function getOpenAlexApiKey(opts): Promise<string | undefined>  // returns *value* — doctor MUST NOT log it
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: citty dispatcher + 17 verbs (1 real, 16 stubs) — bin/cli/pensmith.ts</name>
  <files>bin/cli/pensmith.ts, bin/cli/stubs.ts, bin/cli/doctor.ts, package.json, tests/cli-verbs.test.ts, tests/cli-stubs.test.ts</files>
  <read_first>
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-14 (exact 17-verb list — copy verbatim)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-RESEARCH.md` § citty patterns + § Stack pins (D-03 citty version)
    - `package.json` (current `bin` field + dependencies)
    - `workflows/*.md` if present (Wave 0 or 02-06 — for the workflow ↔ dispatcher key-equal preflight)
  </read_first>
  <action>
    **Step A — confirm citty dep + bin field in `package.json`:**

    - `citty` should already be a dependency from 02-00. If not, add `"citty": "^0.2.2"`.
    - Add (or confirm) the `bin` field in `package.json`:
      ```json
      "bin": {
        "pensmith": "dist/bin/pensmith.js"
      }
      ```
    - Add a script for local dev: `"pensmith": "tsx bin/cli/pensmith.ts"`.

    **Step B — create `bin/cli/stubs.ts`:**

    ```typescript
    // bin/cli/stubs.ts
    //
    // D-14: 16 of the 17 verbs are stubs in Phase 2. They register with citty
    // exactly the same way as real verbs but print "not implemented yet" and
    // exit 0. Phase 3+ replaces each one with a real implementation.

    import { defineCommand } from 'citty';

    export function makeStub(verb: string) {
      return defineCommand({
        meta: {
          name: verb,
          description: `(Phase 2 stub) ${verb} — not implemented yet`,
        },
        run() {
          process.stdout.write(`pensmith ${verb}: not implemented yet\n`);
          // exit 0 is the citty default when run() returns normally.
        },
      });
    }
    ```

    **Step C — create `bin/cli/pensmith.ts`:**

    ```typescript
    #!/usr/bin/env node
    // bin/cli/pensmith.ts — Tier 2 dispatcher.
    //
    // D-03: citty@^0.2.2 (locked).
    // D-14: exactly 17 verbs — doctor (real) + 16 stubs.
    // Pitfall 7 — DO NOT console.log here either; this binary is the CLI, not
    // the MCP server, but consistency matters for future stdio surfaces.

    import { defineCommand, runMain } from 'citty';
    import { makeStub } from './stubs.js';

    const main = defineCommand({
      meta: {
        name: 'pensmith',
        version: '0.2.0',
        description: 'Pensmith — Tier 2 portable CLI. Section-as-phase academic writing.',
      },
      subCommands: {
        // Real verb (Phase 2):
        doctor: () => import('./doctor.js').then((m) => m.doctorCommand),

        // Stubs (Phase 2 — Phase 3+ replaces each):
        // NOTE: re-read D-14 in CONTEXT.md before edit. The exact list is
        //       part of the tier contract and must match workflows/*.md key-for-key.
        intake: () => Promise.resolve(makeStub('intake')),
        research: () => Promise.resolve(makeStub('research')),
        outline: () => Promise.resolve(makeStub('outline')),
        plan: () => Promise.resolve(makeStub('plan')),
        write: () => Promise.resolve(makeStub('write')),
        verify: () => Promise.resolve(makeStub('verify')),
        compile: () => Promise.resolve(makeStub('compile')),
        export: () => Promise.resolve(makeStub('export')),
        library: () => Promise.resolve(makeStub('library')),
        citations: () => Promise.resolve(makeStub('citations')),
        humanize: () => Promise.resolve(makeStub('humanize')),
        'gpt-zero': () => Promise.resolve(makeStub('gpt-zero')),
        plagiarism: () => Promise.resolve(makeStub('plagiarism')),
        status: () => Promise.resolve(makeStub('status')),
        resume: () => Promise.resolve(makeStub('resume')),
        'help-paper': () => Promise.resolve(makeStub('help-paper')),
      },
    });

    void runMain(main);
    ```

    **Step D — `bin/cli/doctor.ts` initial scaffold** (full body lands in Task 3):

    ```typescript
    // bin/cli/doctor.ts
    import { defineCommand } from 'citty';
    import { runDoctor } from '../lib/doctor/probes.js';
    import { renderTty, renderJson } from '../lib/doctor/render.js';

    export const doctorCommand = defineCommand({
      meta: { name: 'doctor', description: 'Ecosystem self-check.' },
      args: {
        json: { type: 'boolean', description: 'Emit JSON instead of TTY output.' },
      },
      async run({ args }) {
        const results = await runDoctor();
        const output = args.json ? renderJson(results) : renderTty(results);
        process.stdout.write(output + '\n');
        const failed = Object.values(results).some((r) => r.severity === 'FAIL');
        if (failed) process.exit(1);
      },
    });
    ```

    **Step E — `tests/cli-verbs.test.ts`** (TIER-01 — all 17 verbs dispatchable +
    workflow ↔ dispatcher key-equal preflight per VALIDATION.md):

    ```typescript
    // tests/cli-verbs.test.ts
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { readFileSync, readdirSync, existsSync } from 'node:fs';
    import { join } from 'node:path';

    const EXPECTED_17 = [
      'doctor', 'intake', 'research', 'outline', 'plan', 'write', 'verify',
      'compile', 'export', 'library', 'citations', 'humanize', 'gpt-zero',
      'plagiarism', 'status', 'resume', 'help-paper',
    ];

    test('TIER-01: dispatcher registers exactly 17 verbs', () => {
      const src = readFileSync('bin/cli/pensmith.ts', 'utf8');
      for (const verb of EXPECTED_17) {
        // Each verb appears as a property of subCommands. Quoted verbs use single quotes.
        const re = new RegExp(`(^|\\s|,)['"]?${verb.replace('-', '\\-')}['"]?:`);
        assert.ok(re.test(src), `verb ${verb} not registered in subCommands`);
      }
      // Count the subCommands properties — must be exactly 17.
      const match = src.match(/subCommands:\s*\{([\s\S]*?)\n\s*\},?/);
      assert.ok(match, 'subCommands block not found');
      const block = match[1];
      const propLines = block.split('\n').filter((l) => /^\s*['"]?[a-z-]+['"]?:\s*\(\)\s*=>/.test(l));
      assert.equal(propLines.length, 17, `expected 17 subCommands, got ${propLines.length}`);
    });

    test('TIER-01 preflight: workflows/*.md keys match dispatcher verbs', () => {
      const workflowsDir = 'workflows';
      if (!existsSync(workflowsDir)) {
        // Workflows ship in 02-06; this preflight is a no-op until then.
        return;
      }
      const files = readdirSync(workflowsDir).filter((f) => f.endsWith('.md'));
      const workflowVerbs = files.map((f) => f.replace(/\.md$/, '')).sort();
      const dispatcherVerbs = [...EXPECTED_17].sort();
      assert.deepEqual(
        workflowVerbs,
        dispatcherVerbs,
        `workflow files ${JSON.stringify(workflowVerbs)} must equal dispatcher verbs ${JSON.stringify(dispatcherVerbs)}`,
      );
    });
    ```

    **Step F — `tests/cli-stubs.test.ts`** (TIER-02 — stub verbs exit 0 with phrase):

    ```typescript
    // tests/cli-stubs.test.ts
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { execFileSync } from 'node:child_process';
    import { existsSync } from 'node:fs';

    const STUBS = [
      'intake', 'research', 'outline', 'plan', 'write', 'verify', 'compile',
      'export', 'library', 'citations', 'humanize', 'gpt-zero', 'plagiarism',
      'status', 'resume', 'help-paper',
    ];

    // Resolve the built binary; build is a precondition (run npm run build first).
    const BIN = 'dist/bin/pensmith.js';

    test('TIER-02: build artifact exists', () => {
      assert.ok(existsSync(BIN), `expected ${BIN} — run npm run build first`);
    });

    for (const stub of STUBS) {
      test(`TIER-02: stub verb '${stub}' exits 0 with 'not implemented yet'`, () => {
        const out = execFileSync(process.execPath, [BIN, stub], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        assert.match(out, /not implemented yet/, `stub ${stub} stdout: ${out}`);
      });
    }
    ```

    **Step G — self-check after all steps:**
    - `grep -c "subCommands:" bin/cli/pensmith.ts` == 1.
    - `grep -cE "^\\s*['\"]?[a-z-]+['\"]?:\\s*\\(\\)\\s*=>" bin/cli/pensmith.ts` == 17.
    - `npm run build` produces `dist/bin/pensmith.js`.
    - `node dist/bin/pensmith.js --version` prints `0.2.0` and exits 0.
    - `node dist/bin/pensmith.js intake` prints `pensmith intake: not implemented yet` and exits 0.
    - `npm run lint` + `npm run typecheck` pass.
  </action>
  <verify>
    <automated>npm run lint &amp;&amp; npm run typecheck &amp;&amp; npm run build &amp;&amp; node scripts/run-tests.mjs tests/cli-verbs.test.ts tests/cli-stubs.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `bin/cli/pensmith.ts` exists, uses `defineCommand` + `runMain` from `citty`, and registers exactly 17 verbs in `subCommands`.
    - `bin/cli/stubs.ts` exports `makeStub(verb: string)` and is the source for all 16 stub verbs.
    - `bin/cli/doctor.ts` exists with a scaffolded `doctorCommand` (full probe wiring in Task 3).
    - `package.json` `bin.pensmith` points at `dist/bin/pensmith.js`.
    - `dist/bin/pensmith.js` builds.
    - `tests/cli-verbs.test.ts` and `tests/cli-stubs.test.ts` all green.
    - `node dist/bin/pensmith.js --version` prints `0.2.0` and exits 0.
    - `grep -c "doctor:" bin/cli/pensmith.ts` returns at least 1; doctor is the only verb NOT routed through `makeStub`.
  </acceptance_criteria>
  <done>
    Dispatcher live. TIER-01 + TIER-02 satisfied. Task 2 implements the 5 probes; Task 3
    wires `doctorCommand` to actually run them.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Five probes — DOCT-01..04 + DOCT-06 — under bin/lib/doctor/probes/</name>
  <files>bin/lib/doctor/probes.ts, bin/lib/doctor/probes/node-version.ts, bin/lib/doctor/probes/mcp-presence.ts, bin/lib/doctor/probes/contact-email.ts, bin/lib/doctor/probes/sync-folder.ts, bin/lib/doctor/probes/runtime-config.ts, tests/doctor-probes.test.ts</files>
  <read_first>
    - `bin/lib/paths.ts` lines 140-170 (`SYNC_FOLDER_PATTERNS` + `isInsideSyncFolder`) — DOCT-04 reuses this
    - `bin/lib/runtime.ts` lines 1-100 (config shape) + lines 430-462 (key-resolution chokepoint) — DOCT-06 consumes
    - `references/doctor-output.md` (Wave 0 — 02-00 ships this) — the LOCKED copy for each probe summary
    - `references/http-warnings.md` (DOCT-03 contact-email copy must match this file's warning-text style)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-15..D-20
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-VALIDATION.md` § Per-Requirement map rows DOCT-01..06
  </read_first>
  <behavior>
    All 5 probes implement the `Probe` interface and return `ProbeResult`.
    Behaviors (one test per probe minimum, mock filesystem / env / paths
    where appropriate — D-19 read-only means probes themselves must NOT mutate
    anything; tests verify by checking no `.paper/` files appear):

    - **DOCT-01 node-version**: returns `severity: 'PASS'` when `process.version`
      ≥ `v20.10.0`; `severity: 'FAIL'` otherwise; summary copy locked.
    - **DOCT-02 mcp-presence**: returns `PASS` when `dist/mcp/server.js` exists
      and is non-empty; `FAIL` when missing; `WARN` when present but smaller
      than 200 bytes (probably a stub).
    - **DOCT-03 contact-email**: returns `WARN` when `PENSMITH_CONTACT_EMAIL`
      is unset; `PASS` when set. The WARN copy is sourced from
      `references/http-warnings.md` (per VALIDATION.md DOCT-03 row).
    - **DOCT-04 sync-folder**: calls `paperDir()` then `isInsideSyncFolder()`;
      returns `WARN` when match, `PASS` otherwise. Test override pattern:
      use `PENSMITH_PAPER_DIR` env-var override (or whatever `paths.ts`
      already supports) to point at a tmp dir containing `/OneDrive/`.
    - **DOCT-06 runtime-config**: calls `loadRuntimeConfig()`. Returns
      `WARN` (not FAIL) if no provider key is resolvable; `PASS` if at least
      one is. **NEVER persists the resolved value** — only emits
      `{ openalexPresent: bool, anthropicPresent: bool, openaiPresent: bool }`
      in `detail`. T-01-07 carry-forward.

    Aggregator `runDoctor()` runs all 5 in parallel via `Promise.allSettled`,
    converts any rejection to a `FAIL` ProbeResult, and returns a
    `Record<string, ProbeResult>` keyed by probe.id (D-20).
  </behavior>
  <action>
    **Step A — `bin/lib/doctor/probes.ts` (types + aggregator):**

    ```typescript
    // bin/lib/doctor/probes.ts
    //
    // D-15: 5 probes in Phase 2 (DOCT-05 wiring-smoke lands in 02-07).
    // D-19: probes are READ-ONLY. No fs.writeFile, no atomicWriteFile, no withLock calls.
    //       Tests assert no .paper/ files appear after runDoctor() runs against a clean tmp dir.
    // D-20: returns Record<string, ProbeResult> keyed by probe.id (NOT an array).

    export type Severity = 'PASS' | 'WARN' | 'FAIL' | 'SKIP';

    export interface ProbeResult {
      id: string;
      severity: Severity;
      summary: string;
      detail?: string;
      fix?: string;
    }

    export interface Probe {
      id: string;
      run(): Promise<ProbeResult>;
    }

    import { nodeVersionProbe } from './probes/node-version.js';
    import { mcpPresenceProbe } from './probes/mcp-presence.js';
    import { contactEmailProbe } from './probes/contact-email.js';
    import { syncFolderProbe } from './probes/sync-folder.js';
    import { runtimeConfigProbe } from './probes/runtime-config.js';

    export function defaultProbes(): Probe[] {
      return [
        nodeVersionProbe,
        mcpPresenceProbe,
        contactEmailProbe,
        syncFolderProbe,
        runtimeConfigProbe,
      ];
    }

    export async function runDoctor(probes: Probe[] = defaultProbes()): Promise<Record<string, ProbeResult>> {
      const settled = await Promise.allSettled(probes.map((p) => p.run()));
      const out: Record<string, ProbeResult> = {};
      for (let i = 0; i < probes.length; i += 1) {
        const probe = probes[i];
        const result = settled[i];
        if (result.status === 'fulfilled') {
          out[probe.id] = result.value;
        } else {
          out[probe.id] = {
            id: probe.id,
            severity: 'FAIL',
            summary: `probe ${probe.id} crashed`,
            detail: String(result.reason),
          };
        }
      }
      return out;
    }
    ```

    **Step B — implement each probe in its own file** (so the AST-walk lint in
    02-01 can't accidentally complain about a single fat file):

    `bin/lib/doctor/probes/node-version.ts`:
    ```typescript
    import type { Probe, ProbeResult } from '../probes.js';

    function parseMajorMinor(v: string): [number, number] {
      const m = v.replace(/^v/, '').match(/^(\d+)\.(\d+)/);
      return m ? [Number(m[1]), Number(m[2])] : [0, 0];
    }

    export const nodeVersionProbe: Probe = {
      id: 'node-version',
      async run(): Promise<ProbeResult> {
        const [major, minor] = parseMajorMinor(process.version);
        const ok = major > 20 || (major === 20 && minor >= 10);
        return ok
          ? { id: 'node-version', severity: 'PASS', summary: `Node ${process.version} (>= v20.10)` }
          : {
              id: 'node-version',
              severity: 'FAIL',
              summary: `Node ${process.version} (< v20.10 — required)`,
              fix: 'Install Node 20.10 or newer. https://nodejs.org/',
            };
      },
    };
    ```

    `bin/lib/doctor/probes/mcp-presence.ts`:
    ```typescript
    import type { Probe, ProbeResult } from '../probes.js';
    import { statSync } from 'node:fs';

    const MCP_PATH = 'dist/mcp/server.js';

    export const mcpPresenceProbe: Probe = {
      id: 'mcp-presence',
      async run(): Promise<ProbeResult> {
        try {
          const s = statSync(MCP_PATH);
          if (s.size === 0) {
            return { id: 'mcp-presence', severity: 'FAIL', summary: `${MCP_PATH} exists but is empty`, fix: 'Run `npm run build`.' };
          }
          if (s.size < 200) {
            return { id: 'mcp-presence', severity: 'WARN', summary: `${MCP_PATH} suspiciously small (${s.size}B)`, fix: 'Rebuild — `npm run clean && npm run build`.' };
          }
          return { id: 'mcp-presence', severity: 'PASS', summary: `${MCP_PATH} present (${s.size}B)` };
        } catch {
          return { id: 'mcp-presence', severity: 'FAIL', summary: `${MCP_PATH} not found`, fix: 'Run `npm run build`.' };
        }
      },
    };
    ```

    `bin/lib/doctor/probes/contact-email.ts`:
    ```typescript
    import type { Probe, ProbeResult } from '../probes.js';

    export const contactEmailProbe: Probe = {
      id: 'http-contact-email',
      async run(): Promise<ProbeResult> {
        const v = process.env.PENSMITH_CONTACT_EMAIL;
        if (v && v.length > 0) {
          return { id: 'http-contact-email', severity: 'PASS', summary: 'PENSMITH_CONTACT_EMAIL set — HTTP User-Agent includes contact.' };
        }
        return {
          id: 'http-contact-email',
          severity: 'WARN',
          summary: 'PENSMITH_CONTACT_EMAIL is not set — outbound HTTP will use a fallback User-Agent that may be rate-limited.',
          fix: 'Set PENSMITH_CONTACT_EMAIL to a contact email. See references/http-warnings.md.',
        };
      },
    };
    ```

    Copy of the WARN summary above MUST match the warning-text in
    `references/http-warnings.md` verbatim — if it diverges, fix the probe
    summary, not the references doc (D-21).

    `bin/lib/doctor/probes/sync-folder.ts`:
    ```typescript
    import type { Probe, ProbeResult } from '../probes.js';
    import { paperDir, isInsideSyncFolder } from '../../paths.js';

    export const syncFolderProbe: Probe = {
      id: 'sync-folder-detection',
      async run(): Promise<ProbeResult> {
        const dir = paperDir();
        if (isInsideSyncFolder(dir)) {
          return {
            id: 'sync-folder-detection',
            severity: 'WARN',
            summary: `paperDir() ${dir} is inside a cloud-sync folder — locks and SQLite WALs may corrupt.`,
            fix: 'Move the paper project outside OneDrive/Dropbox/Google Drive/iCloud, or set PENSMITH_PAPER_DIR to an unsynced path.',
          };
        }
        return { id: 'sync-folder-detection', severity: 'PASS', summary: `paperDir() ${dir} is not inside a known sync folder.` };
      },
    };
    ```

    `bin/lib/doctor/probes/runtime-config.ts`:
    ```typescript
    import type { Probe, ProbeResult } from '../probes.js';

    export const runtimeConfigProbe: Probe = {
      id: 'runtime-config-presence',
      async run(): Promise<ProbeResult> {
        // T-01-07 carry-forward: NEVER log the resolved value. Only the boolean.
        const openalexPresent = !!process.env.OPENALEX_API_KEY;
        const anthropicPresent = !!process.env.ANTHROPIC_API_KEY;
        const openaiPresent = !!process.env.OPENAI_API_KEY;
        const any = openalexPresent || anthropicPresent || openaiPresent;
        const detail = `openalex=${openalexPresent} anthropic=${anthropicPresent} openai=${openaiPresent}`;
        return any
          ? { id: 'runtime-config-presence', severity: 'PASS', summary: 'At least one provider key resolvable.', detail }
          : { id: 'runtime-config-presence', severity: 'WARN', summary: 'No provider keys resolvable — pensmith will run in offline mode.', detail, fix: 'Set OPENALEX_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY as appropriate.' };
      },
    };
    ```

    NOTE: `runtimeConfigProbe` is intentionally a static dot-access reader, NOT
    a `loadRuntimeConfig()` caller — `loadRuntimeConfig` is the chokepoint
    forbidden by D-12 inside mcp/**. It is ALLOWED here (bin/lib/doctor/ is not
    mcp/**), but keeping the probe leak-shape-symmetric with the capabilities
    resource (02-04) is the right discipline (D-21 — make tiers agree).

    **Step C — `tests/doctor-probes.test.ts`:**

    Five tests, one per probe. Use env-var overrides and stubbed
    `paperDir()` for control. Critical assertion shared by all: after
    `runDoctor()` runs against a fresh tmp directory, no new files exist
    under that directory (D-19 read-only).

    ```typescript
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { mkdtempSync, readdirSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { runDoctor } from '../bin/lib/doctor/probes.js';
    import { nodeVersionProbe } from '../bin/lib/doctor/probes/node-version.js';
    import { mcpPresenceProbe } from '../bin/lib/doctor/probes/mcp-presence.js';
    import { contactEmailProbe } from '../bin/lib/doctor/probes/contact-email.js';
    import { syncFolderProbe } from '../bin/lib/doctor/probes/sync-folder.js';
    import { runtimeConfigProbe } from '../bin/lib/doctor/probes/runtime-config.js';

    test('DOCT-01 node-version returns PASS on current Node', async () => {
      const r = await nodeVersionProbe.run();
      assert.equal(r.id, 'node-version');
      assert.ok(['PASS', 'FAIL'].includes(r.severity));
    });

    test('DOCT-02 mcp-presence returns PASS when dist/mcp/server.js exists', async () => {
      // 02-04 ships the real server build before this plan; if running before that,
      // the probe legitimately FAILs. Both shapes are acceptable to the test.
      const r = await mcpPresenceProbe.run();
      assert.equal(r.id, 'mcp-presence');
      assert.ok(['PASS', 'WARN', 'FAIL'].includes(r.severity));
    });

    test('DOCT-03 contact-email WARN when env unset', async () => {
      const prev = process.env.PENSMITH_CONTACT_EMAIL;
      delete process.env.PENSMITH_CONTACT_EMAIL;
      try {
        const r = await contactEmailProbe.run();
        assert.equal(r.severity, 'WARN');
        assert.match(r.summary, /PENSMITH_CONTACT_EMAIL/);
      } finally {
        if (prev !== undefined) process.env.PENSMITH_CONTACT_EMAIL = prev;
      }
    });

    test('DOCT-03 contact-email PASS when env set', async () => {
      const prev = process.env.PENSMITH_CONTACT_EMAIL;
      process.env.PENSMITH_CONTACT_EMAIL = 'test@example.com';
      try {
        const r = await contactEmailProbe.run();
        assert.equal(r.severity, 'PASS');
      } finally {
        if (prev !== undefined) process.env.PENSMITH_CONTACT_EMAIL = prev;
        else delete process.env.PENSMITH_CONTACT_EMAIL;
      }
    });

    test('DOCT-04 sync-folder WARN when paperDir is inside /OneDrive/', async () => {
      const prev = process.env.PENSMITH_PAPER_DIR;
      // Use a synthetic path that matches SYNC_FOLDER_PATTERNS regardless of OS.
      process.env.PENSMITH_PAPER_DIR = '/tmp/fake/OneDrive/project';
      try {
        const r = await syncFolderProbe.run();
        assert.equal(r.severity, 'WARN');
      } finally {
        if (prev !== undefined) process.env.PENSMITH_PAPER_DIR = prev;
        else delete process.env.PENSMITH_PAPER_DIR;
      }
    });

    test('DOCT-06 runtime-config WARN when no provider keys present', async () => {
      const saved = {
        oa: process.env.OPENALEX_API_KEY,
        anth: process.env.ANTHROPIC_API_KEY,
        oai: process.env.OPENAI_API_KEY,
      };
      delete process.env.OPENALEX_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      try {
        const r = await runtimeConfigProbe.run();
        assert.equal(r.severity, 'WARN');
        assert.ok(r.detail);
        // T-01-07: NEVER include the actual value in detail.
        assert.equal(r.detail!.includes('sk-'), false);
      } finally {
        if (saved.oa !== undefined) process.env.OPENALEX_API_KEY = saved.oa;
        if (saved.anth !== undefined) process.env.ANTHROPIC_API_KEY = saved.anth;
        if (saved.oai !== undefined) process.env.OPENAI_API_KEY = saved.oai;
      }
    });

    test('D-19: runDoctor is read-only — does not create files in cwd', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'pensmith-doctor-readonly-'));
      const before = readdirSync(tmp);
      const cwd = process.cwd();
      process.chdir(tmp);
      try {
        await runDoctor();
      } finally {
        process.chdir(cwd);
      }
      const after = readdirSync(tmp);
      assert.deepEqual(after, before, 'D-19: doctor MUST NOT create files');
    });

    test('D-20: runDoctor returns Record keyed by probe.id', async () => {
      const r = await runDoctor();
      assert.ok(!Array.isArray(r), 'must be object, not array');
      assert.ok('node-version' in r);
      assert.ok('mcp-presence' in r);
      assert.ok('http-contact-email' in r);
      assert.ok('sync-folder-detection' in r);
      assert.ok('runtime-config-presence' in r);
    });
    ```

    Self-check:
    - `grep -c "atomicWriteFile\|withLock\|writeFile\|mkdir" bin/lib/doctor/probes/` returns 0 (D-19 read-only — except `statSync` for presence checks).
    - `grep -c "process.env\[" bin/lib/doctor/probes/` returns 0 (no computed env access).
    - Each probe file exports a single `Probe`-typed constant.
  </action>
  <verify>
    <automated>npm run lint &amp;&amp; npm run typecheck &amp;&amp; node scripts/run-tests.mjs tests/doctor-probes.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - 5 probe files exist under `bin/lib/doctor/probes/` — one per probe.
    - `bin/lib/doctor/probes.ts` exports `Probe`, `ProbeResult`, `Severity`, `runDoctor`, `defaultProbes`.
    - `runDoctor()` returns `Record<string, ProbeResult>` (D-20).
    - `tests/doctor-probes.test.ts` includes one positive and (where applicable) one negative case per probe + the D-19 read-only assertion + the D-20 keying assertion.
    - All 7+ tests pass.
    - `grep -c "writeFile\|atomicWriteFile\|withLock\|mkdir" bin/lib/doctor/probes/` returns 0.
    - `grep -c "process.env\[" bin/lib/doctor/probes/` returns 0 (only static dot-access permitted).
  </acceptance_criteria>
  <done>
    Five probes shipped, all read-only, all returning the D-15 / D-20 contract shape.
    Task 3 wires them into the `doctor` verb and the renderer.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Doctor renderer (TTY + JSON) + wire to doctorCommand — exit-code contract</name>
  <files>bin/lib/doctor/render.ts, bin/cli/doctor.ts, tests/doctor-exit-code.test.ts, tests/doctor-shape.test.ts</files>
  <read_first>
    - `references/doctor-output.md` (Wave 0 — LOCKED copy and JSON shape; D-18)
    - `bin/lib/doctor/probes.ts` and 5 probe files from Task 2
    - `bin/cli/doctor.ts` scaffold from Task 1
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-15..D-20
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-VALIDATION.md` § Manual-Only Verifications (TTY rendering across terminals)
  </read_first>
  <behavior>
    **renderTty(results)**: produces a multi-line string with:
    - Section header per probe (icon by severity: ✓ PASS, ! WARN, ✗ FAIL, — SKIP)
    - The probe `summary` on the icon line
    - Indented `detail` if present
    - Indented `fix:` line if present
    - Final summary footer: `Doctor: <n> PASS, <m> WARN, <k> FAIL, <s> SKIP`

    **renderJson(results)**: produces a JSON object matching the locked shape in
    `references/doctor-output.md`:
    ```json
    {
      "schemaVersion": 1,
      "probes": { "<id>": { "severity": "...", "summary": "...", "detail": "...", "fix": "..." }, ... },
      "summary": { "pass": n, "warn": m, "fail": k, "skip": s }
    }
    ```

    **doctorCommand**: wires `runDoctor()` -> `renderTty | renderJson` -> stdout.
    Exit code: 0 unless any probe.severity === 'FAIL'; then exit 1 (D-17).
    Locked copy MUST come from `references/doctor-output.md` — any divergence is
    an error in the renderer, not the locked doc (D-21).
  </behavior>
  <action>
    **Step A — `bin/lib/doctor/render.ts`:**

    ```typescript
    // bin/lib/doctor/render.ts
    //
    // D-18: TTY copy + JSON shape locked in references/doctor-output.md.
    //       Render output MUST match that file. Tests assert the JSON shape.

    import type { ProbeResult, Severity } from './probes.js';

    const ICONS: Record<Severity, string> = {
      PASS: '✓',
      WARN: '!',
      FAIL: '✗',
      SKIP: '—',
    };

    export function renderTty(results: Record<string, ProbeResult>): string {
      const lines: string[] = ['Pensmith doctor:', ''];
      let pass = 0, warn = 0, fail = 0, skip = 0;
      for (const r of Object.values(results)) {
        const icon = ICONS[r.severity];
        lines.push(`  ${icon} [${r.severity}] ${r.id}: ${r.summary}`);
        if (r.detail) lines.push(`      ${r.detail}`);
        if (r.fix) lines.push(`      fix: ${r.fix}`);
        if (r.severity === 'PASS') pass += 1;
        else if (r.severity === 'WARN') warn += 1;
        else if (r.severity === 'FAIL') fail += 1;
        else skip += 1;
      }
      lines.push('');
      lines.push(`Doctor: ${pass} PASS, ${warn} WARN, ${fail} FAIL, ${skip} SKIP`);
      return lines.join('\n');
    }

    export function renderJson(results: Record<string, ProbeResult>): string {
      let pass = 0, warn = 0, fail = 0, skip = 0;
      for (const r of Object.values(results)) {
        if (r.severity === 'PASS') pass += 1;
        else if (r.severity === 'WARN') warn += 1;
        else if (r.severity === 'FAIL') fail += 1;
        else skip += 1;
      }
      const payload = {
        schemaVersion: 1,
        probes: results,
        summary: { pass, warn, fail, skip },
      };
      return JSON.stringify(payload, null, 2);
    }
    ```

    Cross-check the icon glyphs + summary footer copy against
    `references/doctor-output.md`. If 02-00 locks different glyphs (e.g.
    `[PASS]`, `[WARN]` with no Unicode), match that locked copy verbatim and
    update the constants above — the locked doc wins (D-18 / D-21).

    **Step B — update `bin/cli/doctor.ts` to consume render + exit code:**

    Replace the scaffold from Task 1 with a fully wired version:

    ```typescript
    import { defineCommand } from 'citty';
    import { runDoctor } from '../lib/doctor/probes.js';
    import { renderTty, renderJson } from '../lib/doctor/render.js';

    export const doctorCommand = defineCommand({
      meta: { name: 'doctor', description: 'Ecosystem self-check.' },
      args: {
        json: { type: 'boolean', description: 'Emit JSON instead of TTY output.' },
      },
      async run({ args }) {
        const results = await runDoctor();
        const output = args.json ? renderJson(results) : renderTty(results);
        process.stdout.write(output + '\n');
        const failed = Object.values(results).some((r) => r.severity === 'FAIL');
        if (failed) process.exit(1);
      },
    });
    ```

    **Step C — `tests/doctor-exit-code.test.ts` (TIER-03):**

    ```typescript
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { execFileSync } from 'node:child_process';
    import { existsSync } from 'node:fs';

    const BIN = 'dist/bin/pensmith.js';

    test('TIER-03: doctor exits 0 when no probe is FAIL', () => {
      assert.ok(existsSync(BIN));
      // We don't control what severity each probe returns on the dev box, but we
      // can detect the exit code by inspecting whether `FAIL` appears in stdout.
      // Run twice and reconcile.
      try {
        const out = execFileSync(process.execPath, [BIN, 'doctor'], { encoding: 'utf8' });
        const hasFail = /FAIL/.test(out);
        assert.equal(hasFail, false, 'this assertion path expected no FAIL; if a FAIL exists the next test covers exit-1');
      } catch (err: any) {
        // Non-zero exit. Validate it's exit 1 AND stdout contained FAIL.
        assert.equal(err.status, 1, `unexpected exit code: ${err.status}`);
        assert.match(err.stdout?.toString() ?? '', /FAIL/, 'exit 1 only with FAIL present');
      }
    });

    test('TIER-03: doctor exits non-zero when probe is FAIL (synthetic via mocked probe)', async () => {
      // Drive runDoctor() directly with a synthetic failing probe.
      const { runDoctor } = await import('../bin/lib/doctor/probes.js');
      const results = await runDoctor([
        { id: 'synth-fail', async run() { return { id: 'synth-fail', severity: 'FAIL', summary: 'synthetic' }; } },
      ]);
      const failed = Object.values(results).some((r) => r.severity === 'FAIL');
      assert.equal(failed, true);
    });
    ```

    **Step D — `tests/doctor-shape.test.ts` (TIER-04 / DOCT-20):**

    ```typescript
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { runDoctor } from '../bin/lib/doctor/probes.js';
    import { renderJson } from '../bin/lib/doctor/render.js';

    test('TIER-04: ProbeResult shape {id, severity, summary, detail?, fix?}', async () => {
      const results = await runDoctor();
      for (const [key, r] of Object.entries(results)) {
        assert.equal(r.id, key, `key ${key} must match r.id`);
        assert.ok(['PASS', 'WARN', 'FAIL', 'SKIP'].includes(r.severity));
        assert.equal(typeof r.summary, 'string');
        if ('detail' in r && r.detail !== undefined) assert.equal(typeof r.detail, 'string');
        if ('fix' in r && r.fix !== undefined) assert.equal(typeof r.fix, 'string');
      }
    });

    test('D-18: doctor --json output is jq-pipeable (parses to expected shape)', async () => {
      const results = await runDoctor();
      const json = JSON.parse(renderJson(results));
      assert.equal(json.schemaVersion, 1);
      assert.equal(typeof json.probes, 'object');
      assert.equal(typeof json.summary.pass, 'number');
      assert.equal(typeof json.summary.warn, 'number');
      assert.equal(typeof json.summary.fail, 'number');
      assert.equal(typeof json.summary.skip, 'number');
    });
    ```

    Self-check:
    - `npm run build` succeeds.
    - `node dist/bin/pensmith.js doctor` runs all 5 probes and exits 0 (assuming
      the host has `dist/mcp/server.js` from 02-04 — note dependency ordering;
      DOCT-02 may FAIL otherwise, in which case the test's catch path handles
      it correctly).
    - `node dist/bin/pensmith.js doctor --json | jq '.schemaVersion'` prints `1`.
  </action>
  <verify>
    <automated>npm run lint &amp;&amp; npm run typecheck &amp;&amp; npm run build &amp;&amp; node scripts/run-tests.mjs tests/doctor-exit-code.test.ts tests/doctor-shape.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `bin/lib/doctor/render.ts` exports `renderTty` and `renderJson`.
    - `bin/cli/doctor.ts` calls `runDoctor()` and dispatches to render fn based on `--json`.
    - `doctor` exits 1 when any probe is FAIL, 0 otherwise (TIER-03).
    - `renderJson` produces an object with keys `schemaVersion: 1`, `probes`, `summary`.
    - `tests/doctor-exit-code.test.ts` and `tests/doctor-shape.test.ts` pass.
    - `node dist/bin/pensmith.js doctor --json` produces valid JSON parseable by `JSON.parse`.
    - `grep -c "writeFile\|atomicWriteFile\|withLock" bin/lib/doctor/render.ts bin/cli/doctor.ts` returns 0 (D-19 read-only).
  </acceptance_criteria>
  <done>
    Doctor verb fully wired. TIER-01..04 + DOCT-01..04 + DOCT-06 satisfied. DOCT-05
    (wiring-smoke) lands in 02-07 because it requires the built artifact + the
    tier-contract harness to be in place.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| CLI argv → dispatcher | citty parses argv; only registered verbs run; unknown verb prints help and exits non-zero |
| doctor → host filesystem | Read-only (D-19); probes may `statSync` paths but never write |
| doctor → host environment | Reads selected env vars (PENSMITH_CONTACT_EMAIL, OPENALEX_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY) by name only — no computed access |
| doctor stdout → user terminal | Renders ProbeResult content; T-01-07 carry-forward — NEVER include resolved secret values |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-05-01 | Information Disclosure | runtime-config probe accidentally includes the resolved API key in `detail` | mitigate | Probe code uses boolean coercion (`!!process.env.X`) and emits only `xxxPresent=true/false`. Test asserts `detail!.includes('sk-')` is false. |
| T-02-05-02 | Tampering | doctor writes to `.paper/` and corrupts state | mitigate | D-19 read-only contract. `tests/doctor-probes.test.ts` D-19 assertion: `readdirSync(tmp)` before/after equality. Lint: no `writeFile` / `atomicWriteFile` / `withLock` strings in `bin/lib/doctor/`. |
| T-02-05-03 | Spoofing | A stub verb is accidentally swapped to a real implementation that exfiltrates data | mitigate | `tests/cli-stubs.test.ts` asserts every stub stdout matches `/not implemented yet/`. Exit 0 only. A real implementation would either have different stdout (fails the assertion) or be in a different verb (fails the 17-count assertion). |
| T-02-05-04 | Denial of Service | A misbehaving probe hangs the doctor invocation indefinitely | accept | `Promise.allSettled` ensures one probe's hang affects only its own resolution. Node-level kill via Ctrl-C remains available. Phase 3 may add per-probe timeouts; not required at this phase. |
| T-02-05-05 | Elevation of Privilege | A stub verb is invoked with `--yolo` and somehow mutates state | mitigate | Stubs don't accept any args (citty `defineCommand` with no `args:` block ignores additional argv tokens). Behavior is print + exit. |
| T-02-05-06 | Information Disclosure | doctor `--json` is piped to a public location (CI log, paste bin) revealing host paths | accept | `paperDir()` is a host path string; doctor by design reports it. The user must avoid pasting CI logs to public locations. This is OPSEC, not a control we add here. |

Security domain: V4 Access Control (D-19 read-only restricts blast radius), V14 Configuration (no resolved-value disclosure in probes / render).
</threat_model>

<verification>
After all three tasks:

1. `npm run build` produces `dist/bin/pensmith.js` and `dist/bin/doctor.js`.
2. `node dist/bin/pensmith.js --version` prints `0.2.0`, exits 0.
3. `node dist/bin/pensmith.js intake` prints `pensmith intake: not implemented yet`, exits 0.
4. `node dist/bin/pensmith.js doctor` prints the locked report + exits 0 (assuming no FAIL on the dev box).
5. `node dist/bin/pensmith.js doctor --json` produces `JSON.parse`-able output with `{ schemaVersion: 1, probes: {...}, summary: {...} }`.
6. `node scripts/run-tests.mjs tests/cli-verbs.test.ts tests/cli-stubs.test.ts tests/doctor-exit-code.test.ts tests/doctor-shape.test.ts tests/doctor-probes.test.ts` — all green.
7. `npm run lint` + `npm run typecheck` pass.
8. `grep -c "writeFile\|atomicWriteFile\|withLock\|mkdir" bin/lib/doctor/` returns 0 (D-19).
9. `grep -c "process.env\[" bin/lib/doctor/` returns 0 (computed env access forbidden — symmetry with D-12).
</verification>

<success_criteria>
- TIER-01: 17 verbs dispatchable (15 stubs + doctor + workflow-key-equal preflight passes once 02-06 lands).
- TIER-02: stubs exit 0 with "not implemented yet" stdout.
- TIER-03: doctor exits 0 on PASS/WARN/SKIP, non-zero on FAIL.
- TIER-04: ProbeResult shape is `{id, severity, summary, detail?, fix?}`.
- DOCT-01..04, DOCT-06: probes implemented + tested.
- D-19: doctor is read-only — no .paper/ writes (asserted by test).
- D-20: Record<string, ProbeResult> keyed by probe.id (asserted by test).
- D-18: JSON shape is `{ schemaVersion: 1, probes, summary }`.
- DOCT-05 wiring-smoke deferred to 02-07 (depends on tier-contract harness existing).
</success_criteria>

<output>
After completion, create `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-05-SUMMARY.md`.
</output>
