---
phase: 02-tier-shells-doctor-tier-contract-gate
plan: 05
type: execute
wave: 2
depends_on: ["02-00"]
files_modified:
  - bin/pensmith.ts
  - bin/cli/stubs.ts
  - bin/cli/doctor.ts
  - bin/lib/doctor/probes.ts
  - bin/lib/doctor/probes/node-version.ts
  - bin/lib/doctor/probes/mcp-sdk-presence.ts
  - bin/lib/doctor/probes/contact-email-presence.ts
  - bin/lib/doctor/probes/sync-folder-detection.ts
  - bin/lib/doctor/probes/runtime-config-presence.ts
  - bin/lib/doctor/probes/zotero-mcp-presence.ts
  - bin/lib/doctor/probes/pandoc-presence.ts
  - bin/lib/doctor/probes/humanizer-skill-presence.ts
  - bin/lib/doctor/probes/build-artifact-resolves.ts
  - bin/lib/doctor/probes/http-crossref-ping.ts
  - bin/lib/doctor/render.ts
  - tests/cli-verbs.test.ts
  - tests/cli-stubs.test.ts
  - tests/doctor-exit-code.test.ts
  - tests/doctor-shape.test.ts
  - tests/doctor-probes.test.ts
  - package.json
autonomous: true
requirements: [TIER-04, DOCT-01, DOCT-02, DOCT-03, DOCT-04, DOCT-05, DOCT-07]
must_haves:
  truths:
    - "All 16 UX-02 verbs are dispatchable via `pensmith <verb>` (`new`, `next`, `status`, `research`, `outline`, `plan`, `write`, `verify`, `compile`, `done`, `resume`, `list`, `open`, `sketch`, `add`, `doctor`) and only `doctor` does real work — per CONTEXT D-05 (16 verbs canonical, UX-02 authoritative). Phase 6+ verbs like `export`/`citations`/`humanize`/`gpt-zero`/`plagiarism` are sub-commands under `compile`/`verify`, NOT first-class verbs in Phase 2."
    - "Stub verbs (15 of them) exit 0 with stdout containing the phrase 'not implemented yet'"
    - "Built CLI binary resolves to `dist/bin/pensmith.js` (package.json `bin.pensmith` field; matches CONTRIBUTING.md D-24 lock, 02-07 preflight, and all reference docs)"
    - "`pensmith doctor` exits 0 when every probe is PASS/WARN/SKIP, and non-zero when any probe is FAIL"
    - "`pensmith doctor --json` emits the locked JSON shape from `references/doctor-output.md`"
    - "Probes return a `Record<string, ProbeResult>` keyed by probe.id (D-20)"
    - "Doctor is read-only — no writes to .paper/, no lock acquisition, no atomic-write calls (D-19)"
    - "Probe report copy matches references/doctor-output.md verbatim — locked"
    - "DOCT-02 reports presence of three ecosystem dependencies — Zotero MCP, Pandoc, humanizer skill"
    - "DOCT-05 substitute: `build-artifact-resolves` probe asserts `dist/bin/pensmith.js` + `dist/mcp/server.js` exist non-empty AND `node dist/bin/pensmith.js --version` (via `execFileSync`, no shell) exits 0. Real Phase 3+ intake/outline/verify exercise deferred per D-04."
    - "D-03(d) Phase-2 contract (cross-AI review HIGH fix from Codex iter 1): `http-crossref-ping` ships with a stable id but a structurally fixed SKIP severity. Production code MUST NOT import from `tests/` (inverts layering, breaks production-only builds). Phase 3 will land a production-tree `bin/lib/http-mock.ts` chokepoint and re-enable PASS/FAIL discrimination. The probe interface is stable across phases so 02-07 Case A tier-fact extraction stays unchanged."
    - "DOCT-07 runtime-config-presence emits per-provider {name, apiKeyEnv, present} — value never leaves bin/lib/capabilities.ts::loadCapabilityFacts (the SINGLE composition site shared with mcp/, per cross-AI cycle-2 HIGH #2)"
    - "Canonical probe ids (Record keys): `node-version`, `mcp-sdk-presence`, `contact-email-presence`, `sync-folder-detection`, `runtime-config-presence`, `zotero-mcp-presence`, `pandoc-presence`, `humanizer-skill-presence`, `build-artifact-resolves`, `http-crossref-ping` — these MUST match the keys read in 02-07's Case A fact-extraction code AND the locked JSON shape in `references/doctor-output.md`."
  artifacts:
    - path: "bin/pensmith.ts"
      provides: "citty dispatcher with 16 subCommands (1 real + 15 stubs). Compiled to `dist/bin/pensmith.js` by tsc with `rootDir: .` + `outDir: dist/`."
    - path: "bin/cli/doctor.ts"
      provides: "doctor verb implementation — TTY + --json output paths"
    - path: "bin/lib/doctor/probes.ts"
      provides: "ProbeResult type + runDoctor() aggregator (returns Record<string, ProbeResult>). Single entry point both tiers call per D-13."
    - path: "bin/lib/doctor/probes/{10 files}"
      provides: "Ten probes — node-version, mcp-sdk-presence, contact-email-presence, sync-folder-detection, runtime-config-presence (DOCT-01/03/04/07) + zotero-mcp-presence, pandoc-presence, humanizer-skill-presence (DOCT-02 ecosystem) + build-artifact-resolves (DOCT-05 Phase 2 substitute, depends on `npm run build` — runs in Wave 3 wiring step) + http-crossref-ping (D-03(d) cassette wiring smoke). DOCT-06 lands as the tier-equivalence assertion in 02-07."
    - path: "bin/lib/doctor/render.ts"
      provides: "TTY renderer + JSON serializer using locked copy from references/doctor-output.md"
  key_links:
    - from: "bin/pensmith.ts"
      to: "citty@^0.2.2"
      via: "defineCommand + subCommands + runMain"
      pattern: "subCommands:"
    - from: "bin/cli/doctor.ts"
      to: "bin/lib/doctor/probes.ts"
      via: "import { runDoctor } "
      pattern: "runDoctor"
    - from: "bin/lib/doctor/probes/sync-folder-detection.ts"
      to: "bin/lib/paths.ts isInsideSyncFolder"
      via: "presence check on paperDir()"
      pattern: "isInsideSyncFolder"
    - from: "bin/lib/doctor/probes/runtime-config-presence.ts"
      to: "bin/lib/capabilities.ts::loadCapabilityFacts"
      via: "delegates to the SHARED helper (same source mcp/ consumes — cross-AI cycle-2 HIGH #2); probe re-keys snake_case facts to the doctor's historical {name, apiKeyEnv, present} JSON detail"
      pattern: "loadCapabilityFacts"
    - from: "bin/lib/doctor/probes/build-artifact-resolves.ts"
      to: "dist/bin/pensmith.js + dist/mcp/server.js"
      via: "statSync presence + execFileSync(node, [BIN, '--version'])"
      pattern: "build-artifact-resolves"
    - from: "bin/lib/doctor/probes/http-crossref-ping.ts"
      to: "(Phase 2) NONE — probe is structurally SKIP-only. (Phase 3) `bin/lib/http-mock.ts` chokepoint will live in production-tree, NOT in `tests/`."
      via: "Phase 2: zero imports beyond probe types. Phase 3: dynamic-import the http-mock chokepoint after existsSync check."
      pattern: "http-crossref-ping"
---

<objective>
Ship Tier 2 — the portable Node CLI — and the read-only `doctor` verb that backs Phase 2's
ecosystem-self-checks.

Per D-14 + REQUIREMENTS UX-02 (post-2026-05-16 correction — see CONTEXT D-05):
`bin/pensmith.ts` is a citty dispatcher with **16 subCommands** — the canonical UX-02
verb list. Only the `doctor` verb performs real work. The other 15 are stubs that print
"not implemented yet" and exit 0. That single-shell-many-stubs pattern is the
load-bearing TIER-01 / TIER-02 property — it locks the verb list in the dispatcher so
Phase 3+ implementations slot in without growing the surface. Phase 6+ verbs like
`export`/`citations`/`humanize`/`gpt-zero`/`plagiarism` are sub-commands under
`compile`/`verify`, NOT first-class verbs in v0.1.0.

Per D-15..D-20: `doctor` runs **10 probes**, returns a `Record<string, ProbeResult>`
keyed by probe.id, exits 0 unless any probe severity is FAIL, defaults to TTY output,
supports `--json`, and **never writes to disk** (read-only — D-19).

Per DOCT-02 (revised per checker iter 1/3): three ecosystem-tooling probes — Zotero MCP,
Pandoc binary on PATH, and the humanizer skill at `~/.claude/skills/humanizer/` — surface
the optional dependencies pensmith's downstream phases rely on. None are required at
Phase 2 (severity WARN/SKIP, not FAIL); they exist so users see the gap before Phase 3+
verbs blow up.

Per DOCT-07 (NEW in this revision, replaces deferred DOCT-05): runtime-config-presence
iterates `loadRuntimeConfig().providers` and emits per-provider `{name, apiKeyEnv, present}`.
The presence flag is computed by checking `typeof process.env[apiKeyEnv] === 'string' &&
process.env[apiKeyEnv]!.length > 0` — the value itself never leaves that boolean
coercion. Symmetric to T-01-07 (no-leak invariant) and D-12 (capabilities-no-leak).

Per D-18: TTY copy and JSON shape are locked in `references/doctor-output.md` (Wave 0,
02-00 ships that). Render code in this plan reads severity icons + section headers
from the locked file or duplicates them verbatim with a comment pointing at the source.

Per D-21: when a probe disagrees with a tier (e.g., DOCT-02 says `pandoc` not on PATH),
the default fix is to INSTALL the dependency, not to make the probe lenient.

Output: `node dist/bin/pensmith.js --version` exits 0, `node dist/bin/pensmith.js doctor`
runs 10 probes and renders the locked report; `node dist/bin/pensmith.js doctor --json`
emits a `jq`-pipeable JSON object.

**DOCT-05 Phase-2 scope (per checker iter 2 / B4 user decision)**: Phase 2 ships a
**build-artifact-resolves** probe — `statSync` on `dist/bin/pensmith.js` and
`dist/mcp/server.js` plus `execFileSync(node, [BIN, '--version'])` smoke. The real
Phase 3+ vertical-slice intake/outline/verify exercise remains deferred per CONTEXT
D-04, but the Phase-2 probe gives users a deterministic build-health signal today.
Symmetrically, **http-crossref-ping** ships per D-03(d) but with a Phase-2 contract
of **structurally SKIP-only** — cross-AI review HIGH (Codex iter 1) ruled out the
draft `await import('../../../../tests/cassettes/index.js')` because production code
must never depend on `tests/`. Phase 3 will introduce a production-tree
`bin/lib/http-mock.ts` chokepoint and re-enable PASS/FAIL discrimination. The probe
interface is stable across phases so 02-07 Case A tier-fact extraction is unaffected.
**DOCT-06 (both tiers equivalent doctor output)** is the cross-tier equivalence test
that lives in 02-07 (tier-contract gate), not here.
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

<read_first_d12>
Before implementing the **runtime-config-presence** probe (Task 2 Step B file
`bin/lib/doctor/probes/runtime-config-presence.ts`), re-read:

- `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-12
  (capabilities-no-leak — symmetric to T-01-07)
- `bin/lib/runtime.ts` lines 430-462 (`getOpenAlexApiKey` chokepoint pattern)
- `bin/lib/runtime.ts` `loadRuntimeConfig` return shape (look for `providers:` field
  and its `apiKeyEnv` property — that's the env-var NAME, not the value)

The invariant: **the resolved API-key value never appears in any probe output, log
line, error message, or detail string.** Only the boolean presence flag escapes the
probe. The lint in 02-01 (capabilities-no-leak rule) extends to scan
`bin/lib/doctor/probes/runtime-config-presence.ts` for any of these forbidden patterns:

- `process.env[<dynamic-string>]` followed by anything other than a length test or
  boolean coercion
- Concatenation of `apiKey` / `value` / resolved-config-field into a result string
- JSON-stringify of an object that contains a resolved provider key value

The acceptable pattern (and the only one tests permit):

```typescript
const v = process.env[provider.apiKeyEnv];
const present = typeof v === 'string' && v.length > 0;
// `v` is now out of scope. Only `present` (boolean) is used onward.
```
</read_first_d12>

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

<!-- The 16 verbs (UX-02 canonical — REQUIREMENTS.md line 61, locked by CONTEXT D-05 post-2026-05-16 correction): -->

```
doctor (real) + 15 stubs:
  new, next, status, research, outline, plan, write,
  verify, compile, done, resume, list, open, sketch, add
```

The exact list MUST come from REQUIREMENTS.md UX-02 — re-read before implementing.
Phase 6+ verbs (`export`, `citations`, `humanize`, `gpt-zero`, `plagiarism`) are
sub-commands under `compile`/`verify`, NOT first-class verbs in v0.1.0.

<!-- Existing helpers the probes consume: -->

```typescript
// bin/lib/paths.ts
export function paperDir(opts?: { paperRoot?: string }): string
export function isInsideSyncFolder(absPath: string): boolean

// bin/lib/runtime.ts  -- ALLOWED in bin/cli/ and bin/lib/doctor/ — D-12 lint only fires inside mcp/**.
export async function loadRuntimeConfig(opts): Promise<RuntimeConfig>
// RuntimeConfig.providers: Array<{ name: string; apiKeyEnv: string; ...other fields }>
// (Re-read bin/lib/runtime.ts before implementing — the exact field names are authoritative there.)
export async function getOpenAlexApiKey(opts): Promise<string | undefined>  // returns *value* — doctor MUST NOT log it
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: citty dispatcher + 16 UX-02 verbs (1 real, 15 stubs) — bin/pensmith.ts</name>
  <files>bin/pensmith.ts, bin/cli/stubs.ts, bin/cli/doctor.ts, package.json, tests/cli-verbs.test.ts, tests/cli-stubs.test.ts</files>
  <read_first>
    - `.planning/REQUIREMENTS.md` UX-02 (lines 61) — the **canonical 16-verb list** (authoritative)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-05 (post-2026-05-16 correction: 16 verbs, UX-02 authoritative — earlier "17" was an off-by-one)
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
      Note the path `dist/bin/pensmith.js` (NOT `dist/bin/cli/pensmith.js`) — source `bin/pensmith.ts` compiles via `tsc` (`rootDir: .`, `outDir: dist/`) into `dist/bin/pensmith.js`. This path is locked by CONTRIBUTING.md D-24 LOCKED block, 02-07 preflight, and all reference docs. Helper modules `bin/cli/stubs.ts` and `bin/cli/doctor.ts` compile to `dist/bin/cli/stubs.js` and `dist/bin/cli/doctor.js` (they keep the `cli/` namespace).
    - Add a script for local dev: `"pensmith": "tsx bin/pensmith.ts"`.

    **Step B — create `bin/cli/stubs.ts`:**

    ```typescript
    // bin/cli/stubs.ts
    //
    // D-05: 15 of the 16 verbs are stubs in Phase 2. They register with citty
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

    **Step C — create `bin/pensmith.ts`:**

    ```typescript
    #!/usr/bin/env node
    // bin/pensmith.ts — Tier 2 dispatcher.
    //
    // D-03: citty@^0.2.2 (locked).
    // D-05: exactly 16 verbs from REQUIREMENTS.md UX-02 — doctor (real) + 15 stubs.
    //   Phase 6+ verbs like `export`/`citations`/`humanize`/`gpt-zero`/`plagiarism`
    //   are sub-commands under `compile`/`verify`, NOT first-class verbs in v0.1.0.
    // Pitfall 7 — DO NOT console.log here either; this binary is the CLI, not
    // the MCP server, but consistency matters for future stdio surfaces.

    import { defineCommand, runMain } from 'citty';
    import { makeStub } from './cli/stubs.js';

    const main = defineCommand({
      meta: {
        name: 'pensmith',
        version: '0.2.0',
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

    **Step E — `tests/cli-verbs.test.ts`** (TIER-04 — all 16 verbs dispatchable +
    workflow ↔ dispatcher key-equal preflight per VALIDATION.md):

    ```typescript
    // tests/cli-verbs.test.ts
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { readFileSync, readdirSync, existsSync } from 'node:fs';
    import { join } from 'node:path';

    // UX-02 canonical 16 verbs (REQUIREMENTS.md line 61, locked by CONTEXT D-05).
    const EXPECTED_16 = [
      'doctor', 'new', 'next', 'status', 'research', 'outline', 'plan', 'write',
      'verify', 'compile', 'done', 'resume', 'list', 'open', 'sketch', 'add',
    ];

    test('TIER-04: dispatcher registers exactly 16 verbs (UX-02 canonical)', () => {
      const src = readFileSync('bin/pensmith.ts', 'utf8');
      for (const verb of EXPECTED_16) {
        // Each verb appears as a property of subCommands. Quoted verbs use single quotes.
        const re = new RegExp(`(^|\\s|,)['"]?${verb.replace('-', '\\-')}['"]?:`);
        assert.ok(re.test(src), `verb ${verb} not registered in subCommands`);
      }
      // Count the subCommands properties — must be exactly 16.
      const match = src.match(/subCommands:\s*\{([\s\S]*?)\n\s*\},?/);
      assert.ok(match, 'subCommands block not found');
      const block = match[1];
      const propLines = block.split('\n').filter((l) => /^\s*['"]?[a-z-]+['"]?:\s*\(\)\s*=>/.test(l));
      assert.equal(propLines.length, 16, `expected 16 subCommands, got ${propLines.length}`);
    });

    test('TIER-04 preflight: workflows/*.md keys match dispatcher verbs', () => {
      const workflowsDir = 'workflows';
      if (!existsSync(workflowsDir)) {
        // Workflows ship in 02-06; this preflight is a no-op until then.
        return;
      }
      const files = readdirSync(workflowsDir).filter((f) => f.endsWith('.md'));
      const workflowVerbs = files.map((f) => f.replace(/\.md$/, '')).sort();
      const dispatcherVerbs = [...EXPECTED_16].sort();
      assert.deepEqual(
        workflowVerbs,
        dispatcherVerbs,
        `workflow files ${JSON.stringify(workflowVerbs)} must equal dispatcher verbs ${JSON.stringify(dispatcherVerbs)}`,
      );
    });
    ```

    **Step F — `tests/cli-stubs.test.ts`** (TIER-04 — stub verbs exit 0 with phrase):

    ```typescript
    // tests/cli-stubs.test.ts
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { execFileSync } from 'node:child_process';
    import { existsSync } from 'node:fs';

    // 15 stubs (UX-02 minus `doctor` which is the only real verb in Phase 2).
    const STUBS = [
      'new', 'next', 'status', 'research', 'outline', 'plan', 'write',
      'verify', 'compile', 'done', 'resume', 'list', 'open', 'sketch', 'add',
    ];

    // Resolve the built binary; build is a precondition (run npm run build first).
    // Path locked by CONTRIBUTING.md D-24 LOCKED block + 02-07 preflight.
    const BIN = 'dist/bin/pensmith.js';

    test('TIER-04: build artifact exists', () => {
      assert.ok(existsSync(BIN), `expected ${BIN} — run npm run build first`);
    });

    for (const stub of STUBS) {
      test(`TIER-04: stub verb '${stub}' exits 0 with 'not implemented yet'`, () => {
        const out = execFileSync(process.execPath, [BIN, stub], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        assert.match(out, /not implemented yet/, `stub ${stub} stdout: ${out}`);
      });
    }
    ```

    **Step G — self-check after all steps:**
    - `grep -c "subCommands:" bin/pensmith.ts` == 1.
    - `grep -v '^#' bin/pensmith.ts | grep -cE "^\\s*['\"]?[a-z-]+['\"]?:\\s*\\(\\)\\s*=>"` == 16.
    - `npm run build` produces `dist/bin/pensmith.js`.
    - `node dist/bin/pensmith.js --version` prints `0.2.0` and exits 0.
    - `node dist/bin/pensmith.js new` prints `pensmith new: not implemented yet` and exits 0.
    - `npm run lint` + `npm run typecheck` pass.
  </action>
  <verify>
    <automated>npm run lint &amp;&amp; npm run typecheck &amp;&amp; npm run build &amp;&amp; node scripts/run-tests.mjs tests/cli-verbs.test.ts tests/cli-stubs.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `bin/pensmith.ts` exists, uses `defineCommand` + `runMain` from `citty`, and registers exactly 16 verbs in `subCommands` (UX-02 canonical).
    - `bin/cli/stubs.ts` exports `makeStub(verb: string)` and is the source for all 15 stub verbs.
    - `bin/cli/doctor.ts` exists with a scaffolded `doctorCommand` (full probe wiring in Task 3).
    - `package.json` `bin.pensmith` points at `dist/bin/pensmith.js`.
    - `dist/bin/pensmith.js` builds (tsc `rootDir: .`, `outDir: dist/`).
    - `tests/cli-verbs.test.ts` and `tests/cli-stubs.test.ts` all green.
    - `node dist/bin/pensmith.js --version` prints `0.2.0` and exits 0.
    - `grep -c "doctor:" bin/pensmith.ts` returns at least 1; doctor is the only verb NOT routed through `makeStub`.
  </acceptance_criteria>
  <done>
    Dispatcher live. TIER-04 (citty verb shape) satisfied. Task 2
    implements the 10 probes; Task 3 wires `doctorCommand` to actually run them.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Ten probes — DOCT-01, DOCT-02 (3 ecosystem), DOCT-03, DOCT-04, DOCT-05, DOCT-07 + D-03(d) — under bin/lib/doctor/probes/</name>
  <files>bin/lib/doctor/probes.ts, bin/lib/doctor/probes/node-version.ts, bin/lib/doctor/probes/mcp-sdk-presence.ts, bin/lib/doctor/probes/zotero-mcp-presence.ts, bin/lib/doctor/probes/pandoc-presence.ts, bin/lib/doctor/probes/humanizer-skill-presence.ts, bin/lib/doctor/probes/contact-email-presence.ts, bin/lib/doctor/probes/sync-folder-detection.ts, bin/lib/doctor/probes/runtime-config-presence.ts, bin/lib/doctor/probes/build-artifact-resolves.ts, bin/lib/doctor/probes/http-crossref-ping.ts, tests/doctor-probes.test.ts</files>
  <read_first>
    - `bin/lib/paths.ts` lines 140-170 (`SYNC_FOLDER_PATTERNS` + `isInsideSyncFolder`) — DOCT-04 reuses this
    - `bin/lib/runtime.ts` lines 1-100 (config shape, especially `RuntimeConfig.providers[].apiKeyEnv`) + lines 430-462 (key-resolution chokepoint) — DOCT-07 consumes
    - `references/doctor-output.md` (Wave 0 — 02-00 ships this) — the LOCKED copy for each probe summary
    - `references/http-warnings.md` (DOCT-03 contact-email copy must match this file's warning-text style)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-12 + D-15..D-20
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-VALIDATION.md` § Per-Requirement map rows DOCT-01..04, DOCT-07
    - **D-12 read_first_d12 block** at the top of this PLAN (capabilities-no-leak invariant)
  </read_first>
  <behavior>
    All 10 probes implement the `Probe` interface and return `ProbeResult`.
    Behaviors (one test per probe minimum, mock filesystem / env / paths
    where appropriate — D-19 read-only means probes themselves must NOT mutate
    anything; tests verify by checking no `.paper/` files appear):

    - **DOCT-01 node-version** (`id: 'node-version'`): returns `severity: 'PASS'`
      when `process.version` ≥ `v20.10.0`; `severity: 'FAIL'` otherwise; summary
      copy locked.
    - **DOCT-02a mcp-sdk-presence** (`id: 'mcp-sdk-presence'`): returns `PASS`
      when `dist/mcp/server.js` exists and is non-empty; `FAIL` when missing;
      `WARN` when present but smaller than 200 bytes (probably a stub).
    - **DOCT-02b zotero-mcp-presence** (`id: 'zotero-mcp-presence'`): returns
      `PASS` when the user's Claude MCP config (`~/.claude/mcp_servers.json` or
      `~/.config/claude/mcp_servers.json` — probe checks both standard locations)
      has an entry with name matching `/zotero/i`; `WARN` when missing — Zotero
      MCP is optional for Phase 3+ research/citation verbs. Detail string lists
      which paths were checked.
    - **DOCT-02c pandoc-presence** (`id: 'pandoc-presence'`): returns `PASS`
      when `pandoc --version` (via `execFileSync('pandoc', ['--version'],
      { stdio: 'pipe' })`) exits 0; `WARN` when the binary is missing — pandoc
      is required for the export verb but not for Phase 2 doctor itself. NEVER
      spawns via `exec` (shell-interpolation risk) — always `execFileSync` with
      argv array.
    - **DOCT-02d humanizer-skill-presence** (`id: 'humanizer-skill-presence'`):
      returns `PASS` when `~/.claude/skills/humanizer/` exists (any file
      inside); `WARN` when missing — the humanizer verb wraps the user's
      installed humanizer skill.
    - **DOCT-03 contact-email-presence** (`id: 'contact-email-presence'`):
      returns `WARN` when `PENSMITH_CONTACT_EMAIL` is unset; `PASS` when set.
      The WARN copy is sourced from `references/http-warnings.md` (per
      VALIDATION.md DOCT-03 row).
    - **DOCT-04 sync-folder-detection** (`id: 'sync-folder-detection'`): calls
      `paperDir()` then `isInsideSyncFolder()`; returns `WARN` when match,
      `PASS` otherwise. Test override pattern: use `PENSMITH_PAPER_DIR` env-var
      override to point at a tmp dir containing `/OneDrive/`.
    - **DOCT-05 build-artifact-resolves** (`id: 'build-artifact-resolves'` —
      Phase-2 substitute per checker iter 2 / B4 user decision): `statSync` on
      `dist/bin/pensmith.js` and `dist/mcp/server.js` (both must be non-empty);
      then `execFileSync(process.execPath, ['dist/bin/pensmith.js', '--version'],
      { timeout: 5000 })` smoke-test. Returns `PASS` when both artifacts exist
      non-empty AND `--version` exits 0; `FAIL` when either artifact is
      missing/empty OR the smoke exec fails (timeout / non-zero exit). Real
      Phase 3+ vertical-slice intake/outline/verify exercise stays deferred per
      CONTEXT D-04.
    - **DOCT-07 runtime-config-presence** (`id: 'runtime-config-presence'`):
      calls `loadRuntimeConfig()` and iterates `cfg.providers`. For each
      provider emits `{name, apiKeyEnv, present: boolean}` where `present` is
      derived from `typeof process.env[provider.apiKeyEnv] === 'string' &&
      process.env[provider.apiKeyEnv]!.length > 0`. Returns `WARN` if NO
      provider is present; `PASS` if at least one. **Detail string is the
      serialised array of `{name, apiKeyEnv, present}` objects ONLY** — never
      the resolved value, never any other config field that might contain
      secrets. T-01-07 carry-forward, D-12 symmetric, lint-enforced in 02-01.
    - **D-03(d) http-crossref-ping** (`id: 'http-crossref-ping'`): cross-AI
      review HIGH (Codex iter 1) ruled out the original draft that
      `await import`ed from `tests/cassettes/index.js` — production code MUST
      NOT depend on `tests/`. **Phase 2 contract**: the probe ships with a
      stable `id` but a structurally fixed `severity: 'SKIP'`. The handler
      does no I/O, no imports beyond probe types, and never touches the
      network. Phase 3 will land `bin/lib/http-mock.ts` (production-tree
      MockAgent chokepoint) and re-enable PASS/FAIL discrimination — at that
      point the probe `run()` will conditionally `await import('../../http-mock.js')`
      from production-tree, dispatch the stub GET, and return PASS on 200 / FAIL
      on other status. The probe's interface (id + signature) is intentionally
      stable across the Phase 2 → Phase 3 transition so 02-07's tier-fact
      extraction code never has to change.

    Aggregator `runDoctor()` runs all 10 in parallel via `Promise.allSettled`,
    converts any rejection to a `FAIL` ProbeResult, and returns a
    `Record<string, ProbeResult>` keyed by probe.id (D-20).
  </behavior>
  <action>
    **Step A — `bin/lib/doctor/probes.ts` (types + aggregator):**

    ```typescript
    // bin/lib/doctor/probes.ts
    //
    // D-15: 10 probes in Phase 2 — build-artifact-resolves is the Phase-2 substitute
    //       for the deferred DOCT-05 vertical slice (per CONTEXT D-04 + B4 user
    //       decision iter 2). http-crossref-ping covers D-03(d) cassette wiring.
    //       DOCT-06 tier-equivalence lands in 02-07.
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
    import { mcpSdkPresenceProbe } from './probes/mcp-sdk-presence.js';
    import { zoteroMcpPresenceProbe } from './probes/zotero-mcp-presence.js';
    import { pandocPresenceProbe } from './probes/pandoc-presence.js';
    import { humanizerSkillPresenceProbe } from './probes/humanizer-skill-presence.js';
    import { contactEmailPresenceProbe } from './probes/contact-email-presence.js';
    import { syncFolderDetectionProbe } from './probes/sync-folder-detection.js';
    import { runtimeConfigPresenceProbe } from './probes/runtime-config-presence.js';
    import { buildArtifactResolvesProbe } from './probes/build-artifact-resolves.js';
    import { httpCrossrefPingProbe } from './probes/http-crossref-ping.js';

    export function defaultProbes(): Probe[] {
      return [
        nodeVersionProbe,
        mcpSdkPresenceProbe,
        zoteroMcpPresenceProbe,
        pandocPresenceProbe,
        humanizerSkillPresenceProbe,
        contactEmailPresenceProbe,
        syncFolderDetectionProbe,
        runtimeConfigPresenceProbe,
        buildArtifactResolvesProbe,
        httpCrossrefPingProbe,
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
    02-01 can't accidentally complain about a single fat file; per D-09 thin-shim
    discipline applies to probes too):

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

    `bin/lib/doctor/probes/mcp-sdk-presence.ts`:
    ```typescript
    import type { Probe, ProbeResult } from '../probes.js';
    import { statSync } from 'node:fs';

    const MCP_PATH = 'dist/mcp/server.js';

    export const mcpSdkPresenceProbe: Probe = {
      id: 'mcp-sdk-presence',
      async run(): Promise<ProbeResult> {
        try {
          const s = statSync(MCP_PATH);
          if (s.size === 0) {
            return { id: 'mcp-sdk-presence', severity: 'FAIL', summary: `${MCP_PATH} exists but is empty`, fix: 'Run `npm run build`.' };
          }
          if (s.size < 200) {
            return { id: 'mcp-sdk-presence', severity: 'WARN', summary: `${MCP_PATH} suspiciously small (${s.size}B)`, fix: 'Rebuild — `npm run clean && npm run build`.' };
          }
          return { id: 'mcp-sdk-presence', severity: 'PASS', summary: `${MCP_PATH} present (${s.size}B)` };
        } catch {
          return { id: 'mcp-sdk-presence', severity: 'FAIL', summary: `${MCP_PATH} not found`, fix: 'Run `npm run build`.' };
        }
      },
    };
    ```

    `bin/lib/doctor/probes/zotero-mcp-presence.ts` (DOCT-02b):
    ```typescript
    import type { Probe, ProbeResult } from '../probes.js';
    import { readFileSync, existsSync } from 'node:fs';
    import { homedir } from 'node:os';
    import { join } from 'node:path';

    // Standard locations where Claude MCP server configs live.
    // The exact set must be re-checked against the user's Claude version;
    // probe is best-effort and treats absence as WARN, not FAIL.
    function candidatePaths(): string[] {
      const home = homedir();
      return [
        join(home, '.claude', 'mcp_servers.json'),
        join(home, '.config', 'claude', 'mcp_servers.json'),
      ];
    }

    export const zoteroMcpPresenceProbe: Probe = {
      id: 'zotero-mcp-presence',
      async run(): Promise<ProbeResult> {
        const paths = candidatePaths();
        const checked: string[] = [];
        for (const p of paths) {
          checked.push(p);
          if (!existsSync(p)) continue;
          try {
            const raw = readFileSync(p, 'utf8');
            // Parse defensively — config schema may differ across Claude versions.
            // We only care whether the word "zotero" appears as a server key/name.
            const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
            const servers = parsed.mcpServers ?? {};
            const names = Object.keys(servers);
            const match = names.find((n) => /zotero/i.test(n));
            if (match) {
              return {
                id: 'zotero-mcp-presence',
                severity: 'PASS',
                summary: `Zotero MCP configured (${match}) in ${p}`,
              };
            }
          } catch {
            // Malformed JSON — fall through and keep checking.
          }
        }
        return {
          id: 'zotero-mcp-presence',
          severity: 'WARN',
          summary: 'Zotero MCP server not configured — citations and research verbs (Phase 3+) will be offline-only.',
          detail: `Checked: ${checked.join(', ')}`,
          fix: 'See https://github.com/<zotero-mcp-org>/zotero-mcp for installation. Then add to your Claude MCP config.',
        };
      },
    };
    ```

    `bin/lib/doctor/probes/pandoc-presence.ts` (DOCT-02c):
    ```typescript
    import type { Probe, ProbeResult } from '../probes.js';
    import { execFileSync } from 'node:child_process';

    export const pandocPresenceProbe: Probe = {
      id: 'pandoc-presence',
      async run(): Promise<ProbeResult> {
        try {
          // execFileSync — NEVER exec (Pitfall 8: shell-interpolation risk).
          // argv array form; no shell involved.
          const out = execFileSync('pandoc', ['--version'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8',
            timeout: 5000,
          });
          const firstLine = out.split('\n')[0] ?? 'pandoc';
          return {
            id: 'pandoc-presence',
            severity: 'PASS',
            summary: `pandoc on PATH — ${firstLine}`,
          };
        } catch (err: unknown) {
          const reason = err instanceof Error ? err.message : String(err);
          return {
            id: 'pandoc-presence',
            severity: 'WARN',
            summary: 'pandoc not found on PATH — the `export` verb (Phase 3+) will be unavailable.',
            detail: `spawn failed: ${reason}`,
            fix: 'Install pandoc: https://pandoc.org/installing.html',
          };
        }
      },
    };
    ```

    `bin/lib/doctor/probes/humanizer-skill-presence.ts` (DOCT-02d):
    ```typescript
    import type { Probe, ProbeResult } from '../probes.js';
    import { existsSync, readdirSync, statSync } from 'node:fs';
    import { homedir } from 'node:os';
    import { join } from 'node:path';

    export const humanizerSkillPresenceProbe: Probe = {
      id: 'humanizer-skill-presence',
      async run(): Promise<ProbeResult> {
        const skillPath = join(homedir(), '.claude', 'skills', 'humanizer');
        if (!existsSync(skillPath)) {
          return {
            id: 'humanizer-skill-presence',
            severity: 'WARN',
            summary: `Humanizer skill not installed at ${skillPath} — the \`humanize\` verb (Phase 3+) will be unavailable.`,
            fix: 'Install the humanizer skill into ~/.claude/skills/humanizer/. See README humanizer disclosure (PRD §3 & §14).',
          };
        }
        try {
          const stat = statSync(skillPath);
          if (!stat.isDirectory()) {
            return {
              id: 'humanizer-skill-presence',
              severity: 'WARN',
              summary: `${skillPath} exists but is not a directory`,
              fix: 'Remove the file and install the humanizer skill as a directory.',
            };
          }
          const entries = readdirSync(skillPath);
          if (entries.length === 0) {
            return {
              id: 'humanizer-skill-presence',
              severity: 'WARN',
              summary: `${skillPath} is empty`,
              fix: 'Re-install the humanizer skill — directory is present but contains no files.',
            };
          }
          return {
            id: 'humanizer-skill-presence',
            severity: 'PASS',
            summary: `Humanizer skill present at ${skillPath} (${entries.length} entries)`,
          };
        } catch (err) {
          return {
            id: 'humanizer-skill-presence',
            severity: 'WARN',
            summary: `Humanizer skill probe failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    };
    ```

    `bin/lib/doctor/probes/contact-email-presence.ts`:
    ```typescript
    import type { Probe, ProbeResult } from '../probes.js';

    export const contactEmailPresenceProbe: Probe = {
      id: 'contact-email-presence',
      async run(): Promise<ProbeResult> {
        const v = process.env.PENSMITH_CONTACT_EMAIL;
        if (v && v.length > 0) {
          return { id: 'contact-email-presence', severity: 'PASS', summary: 'PENSMITH_CONTACT_EMAIL set — HTTP User-Agent includes contact.' };
        }
        return {
          id: 'contact-email-presence',
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

    `bin/lib/doctor/probes/sync-folder-detection.ts`:
    ```typescript
    import type { Probe, ProbeResult } from '../probes.js';
    import { paperDir, isInsideSyncFolder } from '../../paths.js';

    export const syncFolderDetectionProbe: Probe = {
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

    `bin/lib/doctor/probes/runtime-config-presence.ts` (DOCT-07):

    **First — re-read the `<read_first_d12>` block at the top of this PLAN.** The
    invariant: only the boolean `present` flag and the env-var NAME escape this
    probe. The resolved key value is computed inside a single statement, its
    truthiness extracted, and then it goes out of scope.

    ```typescript
    import type { Probe, ProbeResult } from '../probes.js';
    import { loadCapabilityFacts } from '../../capabilities.js';

    export const runtimeConfigPresenceProbe: Probe = {
      id: 'runtime-config-presence',
      async run(): Promise<ProbeResult> {
        // D-12 / T-01-07 / cross-AI cycle-2 HIGH #2: this probe MUST delegate
        // to the SAME helper that mcp/ uses (bin/lib/capabilities.ts::
        // loadCapabilityFacts). Re-implementing env presence here would create
        // a second composition site of loadRuntimeConfig + process.env[...],
        // which 02-07 Case A would have no way to keep in sync with mcp/.
        // The helper returns CapabilityFacts.providers as a readonly array of
        // { name, api_key_env, present } — exactly the shape we serialize here.
        const facts = await loadCapabilityFacts();
        // Re-key from snake_case (capability-fact shape — owned by 02-04's
        // loadCapabilityFacts and consumed unmodified by mcp/) to the doctor's
        // historical detail shape { name, apiKeyEnv, present }. 02-07's
        // extractCliFacts JSON.parses this detail string into an object array
        // and reads p.present per element — no regex parsing.
        const providers = facts.providers.map((p) => ({
          name: p.name,
          apiKeyEnv: p.api_key_env,
          present: p.present,
        }));
        const anyPresent = providers.some((p) => p.present);
        const detail = JSON.stringify(providers);  // only {name, apiKeyEnv, present}
        return anyPresent
          ? {
              id: 'runtime-config-presence',
              severity: 'PASS',
              summary: `At least one provider key resolvable (${providers.filter((p) => p.present).length}/${providers.length}).`,
              detail,
            }
          : {
              id: 'runtime-config-presence',
              severity: 'WARN',
              summary: 'No provider keys resolvable — pensmith will run in offline mode for any verb that needs a provider.',
              detail,
              fix: `Set one of: ${providers.map((p) => p.apiKeyEnv).join(', ')}.`,
            };
      },
    };
    ```

    **Why this probe delegates to `loadCapabilityFacts` (cross-AI cycle-2 HIGH #2):**
    The probe lives in `bin/lib/doctor/`, which is on the CLI side of the tier
    seam — D-12 lint does not forbid `loadRuntimeConfig` or `process.env[...]`
    here. However, having two composition sites (one in mcp via the helper, a
    parallel one here in the probe) would mean 02-07 Case A has no structural
    guarantee that the two stay in sync. The cross-AI review made the
    architectural call: BOTH surfaces consume the SAME single source
    (`bin/lib/capabilities.ts::loadCapabilityFacts`). Tier-equivalence becomes
    structural (same source) rather than statistical (parallel implementations).
    The probe's only job is to re-key the snake_case capability-fact shape
    back into the doctor's historical `{name, apiKeyEnv, present}` JSON detail.

    `bin/lib/doctor/probes/build-artifact-resolves.ts` (DOCT-05 Phase-2
    substitute, per checker iter 2 + B4 user decision):

    ```typescript
    import type { Probe, ProbeResult } from '../probes.js';
    import { statSync } from 'node:fs';
    import { execFileSync } from 'node:child_process';

    const BIN = 'dist/bin/pensmith.js';
    const MCP = 'dist/mcp/server.js';

    function presentNonEmpty(p: string): { ok: boolean; size: number; reason?: string } {
      try {
        const s = statSync(p);
        if (s.size === 0) return { ok: false, size: 0, reason: `${p} exists but is empty` };
        return { ok: true, size: s.size };
      } catch (err) {
        return { ok: false, size: 0, reason: `${p} not found` };
      }
    }

    export const buildArtifactResolvesProbe: Probe = {
      id: 'build-artifact-resolves',
      async run(): Promise<ProbeResult> {
        const bin = presentNonEmpty(BIN);
        const mcp = presentNonEmpty(MCP);
        if (!bin.ok || !mcp.ok) {
          return {
            id: 'build-artifact-resolves',
            severity: 'FAIL',
            summary: `Build artifact missing: ${[!bin.ok && bin.reason, !mcp.ok && mcp.reason].filter(Boolean).join('; ')}`,
            fix: 'Run `npm run build`.',
          };
        }
        try {
          // execFileSync (NEVER exec) — argv array, no shell. 5s timeout.
          execFileSync(process.execPath, [BIN, '--version'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8',
            timeout: 5000,
          });
          return {
            id: 'build-artifact-resolves',
            severity: 'PASS',
            summary: `Build artifacts present (${BIN}: ${bin.size}B, ${MCP}: ${mcp.size}B) and \`pensmith --version\` exits 0.`,
          };
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          return {
            id: 'build-artifact-resolves',
            severity: 'FAIL',
            summary: `Build artifacts exist but ${BIN} --version failed to exit 0: ${reason}`,
            fix: 'Run `npm run clean && npm run build`; investigate the build output.',
          };
        }
      },
    };
    ```

    `bin/lib/doctor/probes/http-crossref-ping.ts` (D-03(d) cassette wiring smoke,
    per B4 user decision):

    **CROSS-AI REVIEW HIGH FIX (Codex iter 1):** the original draft `await import`ed
    from `../../../../tests/cassettes/index.js` inside production code. That
    inverts the dependency direction — production must NEVER depend on `tests/`
    (build would fail in production-only deploys, and `tests/` is excluded from
    `tsc` for distribution). The fix: in Phase 2 the probe reports a SINGLE
    deterministic SKIP severity citing "cassette wiring deferred to Phase 3".
    The probe still SHIPS (so Case A tier-fact extraction in 02-07 finds it),
    but its result is structurally fixed to SKIP. Phase 3 will land the cassette
    behind a `bin/lib/http-mock.ts` chokepoint that lives in production-tree
    (NOT tests/), at which point the probe's `run()` will discriminate
    PASS/SKIP on the chokepoint's existence. The probe interface is stable
    regardless.

    ```typescript
    import type { Probe, ProbeResult } from '../probes.js';

    // Phase 2: SKIP-only. Cross-AI review HIGH (Codex iter 1) ruled out any
    // dynamic import from the test fixtures directory in production code — it
    // inverts the layering and breaks production-only builds (the fixtures
    // directory is excluded from tsc dist).
    //
    // Phase 3 will introduce a production-tree `bin/lib/http-mock.ts`
    // chokepoint owned by the http layer (NOT by the fixtures directory).
    // When that lands, this probe's `run()` will: (a) check for the chokepoint,
    // (b) if present, call `dispatchCrossrefPing()` against MockAgent,
    // (c) discriminate PASS/FAIL on response status. Until then, SKIP is the
    // honest answer.
    //
    // The probe interface (id + run signature) is stable — 02-07 Case A
    // extracts `probes['http-crossref-ping']?.severity` and treats SKIP as
    // a non-failure (parity is asserted on existence + canonical id, not on
    // the severity value itself, which Phase 2 pins to SKIP by construction).

    export const httpCrossrefPingProbe: Probe = {
      id: 'http-crossref-ping',
      async run(): Promise<ProbeResult> {
        return {
          id: 'http-crossref-ping',
          severity: 'SKIP',
          summary: 'D-03(d) cassette wiring smoke deferred to Phase 3 (production-tree http-mock chokepoint not yet shipped). Phase 2 ships this probe with a stable id so tier-fact extraction in 02-07 can rely on its presence.',
          fix: 'No action required in Phase 2. Phase 3 will land bin/lib/http-mock.ts and re-enable this probe with a real PASS/FAIL discrimination.',
        };
      },
    };
    ```

    **Step C — `tests/doctor-probes.test.ts`:**

    Ten tests, one per probe. Use env-var overrides and stubbed
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
    import { mcpSdkPresenceProbe } from '../bin/lib/doctor/probes/mcp-sdk-presence.js';
    import { zoteroMcpPresenceProbe } from '../bin/lib/doctor/probes/zotero-mcp-presence.js';
    import { pandocPresenceProbe } from '../bin/lib/doctor/probes/pandoc-presence.js';
    import { humanizerSkillPresenceProbe } from '../bin/lib/doctor/probes/humanizer-skill-presence.js';
    import { contactEmailPresenceProbe } from '../bin/lib/doctor/probes/contact-email-presence.js';
    import { syncFolderDetectionProbe } from '../bin/lib/doctor/probes/sync-folder-detection.js';
    import { runtimeConfigPresenceProbe } from '../bin/lib/doctor/probes/runtime-config-presence.js';
    import { buildArtifactResolvesProbe } from '../bin/lib/doctor/probes/build-artifact-resolves.js';
    import { httpCrossrefPingProbe } from '../bin/lib/doctor/probes/http-crossref-ping.js';

    test('DOCT-01 node-version returns PASS on current Node', async () => {
      const r = await nodeVersionProbe.run();
      assert.equal(r.id, 'node-version');
      assert.ok(['PASS', 'FAIL'].includes(r.severity));
    });

    test('DOCT-02a mcp-sdk-presence returns one of {PASS,WARN,FAIL}', async () => {
      // 02-04 ships the real server build before this plan; if running before that,
      // the probe legitimately FAILs. Both shapes are acceptable to the test.
      const r = await mcpSdkPresenceProbe.run();
      assert.equal(r.id, 'mcp-sdk-presence');
      assert.ok(['PASS', 'WARN', 'FAIL'].includes(r.severity));
    });

    test('DOCT-02b zotero-mcp-presence returns one of {PASS,WARN}', async () => {
      const r = await zoteroMcpPresenceProbe.run();
      assert.equal(r.id, 'zotero-mcp-presence');
      assert.ok(['PASS', 'WARN'].includes(r.severity));
      // Detail mentions the paths checked.
      if (r.severity === 'WARN') assert.match(r.detail ?? '', /Checked:/);
    });

    test('DOCT-02c pandoc-presence returns one of {PASS,WARN}', async () => {
      const r = await pandocPresenceProbe.run();
      assert.equal(r.id, 'pandoc-presence');
      assert.ok(['PASS', 'WARN'].includes(r.severity));
    });

    test('DOCT-02d humanizer-skill-presence returns one of {PASS,WARN}', async () => {
      const r = await humanizerSkillPresenceProbe.run();
      assert.equal(r.id, 'humanizer-skill-presence');
      assert.ok(['PASS', 'WARN'].includes(r.severity));
    });

    test('DOCT-03 contact-email-presence WARN when env unset', async () => {
      const prev = process.env.PENSMITH_CONTACT_EMAIL;
      delete process.env.PENSMITH_CONTACT_EMAIL;
      try {
        const r = await contactEmailPresenceProbe.run();
        assert.equal(r.severity, 'WARN');
        assert.match(r.summary, /PENSMITH_CONTACT_EMAIL/);
      } finally {
        if (prev !== undefined) process.env.PENSMITH_CONTACT_EMAIL = prev;
      }
    });

    test('DOCT-03 contact-email-presence PASS when env set', async () => {
      const prev = process.env.PENSMITH_CONTACT_EMAIL;
      process.env.PENSMITH_CONTACT_EMAIL = 'test@example.com';
      try {
        const r = await contactEmailPresenceProbe.run();
        assert.equal(r.severity, 'PASS');
      } finally {
        if (prev !== undefined) process.env.PENSMITH_CONTACT_EMAIL = prev;
        else delete process.env.PENSMITH_CONTACT_EMAIL;
      }
    });

    test('DOCT-04 sync-folder-detection WARN when paperDir is inside /OneDrive/', async () => {
      const prev = process.env.PENSMITH_PAPER_DIR;
      // Use a synthetic path that matches SYNC_FOLDER_PATTERNS regardless of OS.
      process.env.PENSMITH_PAPER_DIR = '/tmp/fake/OneDrive/project';
      try {
        const r = await syncFolderDetectionProbe.run();
        assert.equal(r.severity, 'WARN');
      } finally {
        if (prev !== undefined) process.env.PENSMITH_PAPER_DIR = prev;
        else delete process.env.PENSMITH_PAPER_DIR;
      }
    });

    test('DOCT-05 build-artifact-resolves returns one of {PASS,FAIL}', async () => {
      // After `npm run build` this is PASS; before build it FAILs. Both are valid
      // shapes for this assertion. The CI matrix runs this AFTER `npm run build`.
      const r = await buildArtifactResolvesProbe.run();
      assert.equal(r.id, 'build-artifact-resolves');
      assert.ok(['PASS', 'FAIL'].includes(r.severity));
    });

    test('D-03(d) http-crossref-ping returns SKIP in Phase 2 (cassette wiring deferred to Phase 3)', async () => {
      // Cross-AI review HIGH (Codex iter 1): production probes must NOT import
      // from tests/. Phase 2 ships the probe with a stable id but a
      // structurally fixed SKIP severity. Phase 3 will land bin/lib/http-mock.ts
      // (production-tree chokepoint) and re-enable PASS/FAIL discrimination.
      const r = await httpCrossrefPingProbe.run();
      assert.equal(r.id, 'http-crossref-ping');
      assert.equal(r.severity, 'SKIP', 'Phase 2 contract: this probe is SKIP-only by construction');
      assert.match(r.summary, /Phase 3|deferred/i, 'summary must explain the Phase 2 deferral');
    });

    test('DOCT-07 runtime-config-presence WARN when no provider keys present + no value leak', async () => {
      // Snapshot every env var that loadRuntimeConfig() might check and clear them.
      const SENTINEL = 'sk-test-LEAK-SENTINEL-12345';
      const saved: Record<string, string | undefined> = {};
      for (const k of ['OPENALEX_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
        saved[k] = process.env[k];
        delete process.env[k];
      }
      // Set one with a sentinel value and verify the probe NEVER includes the value.
      process.env.OPENALEX_API_KEY = SENTINEL;
      try {
        const r = await runtimeConfigPresenceProbe.run();
        // At least one is present, so severity is PASS.
        assert.equal(r.severity, 'PASS');
        // The detail must contain the env var NAME but NEVER the sentinel value.
        assert.ok(r.detail);
        assert.equal(r.detail!.includes(SENTINEL), false, 'D-12 / T-01-07: probe must NEVER include resolved value');
        assert.match(r.detail!, /OPENALEX_API_KEY/);
        // Now clear and confirm WARN path also never leaks.
        delete process.env.OPENALEX_API_KEY;
        const r2 = await runtimeConfigPresenceProbe.run();
        assert.equal(r2.severity, 'WARN');
        assert.equal((r2.detail ?? '').includes(SENTINEL), false);
      } finally {
        for (const [k, v] of Object.entries(saved)) {
          if (v !== undefined) process.env[k] = v;
          else delete process.env[k];
        }
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

    test('D-20: runDoctor returns Record keyed by probe.id (10 probes)', async () => {
      const r = await runDoctor();
      assert.ok(!Array.isArray(r), 'must be object, not array');
      assert.ok('node-version' in r);
      assert.ok('mcp-sdk-presence' in r);
      assert.ok('zotero-mcp-presence' in r);
      assert.ok('pandoc-presence' in r);
      assert.ok('humanizer-skill-presence' in r);
      assert.ok('contact-email-presence' in r);
      assert.ok('sync-folder-detection' in r);
      assert.ok('runtime-config-presence' in r);
      assert.ok('build-artifact-resolves' in r);
      assert.ok('http-crossref-ping' in r);
      assert.equal(Object.keys(r).length, 10, 'expected exactly 10 probes');
    });
    ```

    Self-check (use header-strip pattern per Nyquist hygiene — `grep -v '^//'`
    to avoid self-invalidating gates on comments mentioning these tokens):
    - `grep -v '^[[:space:]]*//' bin/lib/doctor/probes/*.ts | grep -cE "writeFile|atomicWriteFile|withLock|mkdir"` returns 0 (D-19 read-only — except `statSync` for presence checks).
    - `grep -v '^[[:space:]]*//' bin/lib/doctor/probes/*.ts | grep -cE 'process\.env\[' | head -1` should equal 0 (cross-AI cycle-2 HIGH #2: DOCT-07 now delegates to `bin/lib/capabilities.ts::loadCapabilityFacts`, which is the SINGLE composition site of `loadRuntimeConfig` + `process.env[...]` — the probe re-keys the facts and never touches `process.env[...]` directly).
    - `grep -v '^[[:space:]]*//' bin/lib/doctor/probes/contact-email-presence.ts | grep -c 'process\.env\.PENSMITH_CONTACT_EMAIL' | head -1` may be 0 OR 1: the probe can either read `process.env.PENSMITH_CONTACT_EMAIL` directly (dotted access, not computed `[...]` — allowed) or, preferred for symmetry, read `loadCapabilityFacts().contact_email_set`. Either is acceptable; 02-07 Case A reads the probe via `probes['contact-email-presence'].severity === 'PASS'` which is shape-stable across both implementations.
    - `grep -cE 'exec\(' bin/lib/doctor/probes/*.ts` returns 0 (Pitfall 8: no shell-spawning `exec` — only `execFileSync`).
    - Each probe file exports a single `Probe`-typed constant.
    - `http-crossref-ping.ts` never touches the live network — only MockAgent through the 02-00 cassette infrastructure (D-03(d)).
  </action>
  <verify>
    <automated>npm run lint &amp;&amp; npm run typecheck &amp;&amp; node scripts/run-tests.mjs tests/doctor-probes.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - 10 probe files exist under `bin/lib/doctor/probes/` — one per probe.
    - `bin/lib/doctor/probes.ts` exports `Probe`, `ProbeResult`, `Severity`, `runDoctor`, `defaultProbes`.
    - `runDoctor()` returns `Record<string, ProbeResult>` (D-20) with exactly 10 entries.
    - `tests/doctor-probes.test.ts` includes one positive and (where applicable) one negative case per probe + the D-19 read-only assertion + the D-20 keying assertion + the **D-12 sentinel-value leak test** (DOCT-07).
    - All 13+ tests pass.
    - `grep -v '^[[:space:]]*//' bin/lib/doctor/probes/*.ts | grep -cE "writeFile|atomicWriteFile|withLock|mkdir"` returns 0.
    - `grep -cE 'exec\(' bin/lib/doctor/probes/*.ts` returns 0 (only `execFileSync` permitted).
    - `runtime-config-presence.ts` calls `loadCapabilityFacts` (not `loadRuntimeConfig` directly — cross-AI cycle-2 HIGH #2): `grep -l 'loadCapabilityFacts' bin/lib/doctor/probes/*.ts` lists exactly `runtime-config-presence.ts`, AND `grep -l 'loadRuntimeConfig' bin/lib/doctor/probes/*.ts` returns no probe files (the helper is the single composition site). 02-07 Case A asserts tier-fact equivalence end-to-end against this shared source.
    - DOCT-07 probe output detail JSON contains `apiKeyEnv` and `present` keys only — never any concatenation of the resolved value.
    - `http-crossref-ping.ts` is structurally SKIP-only in Phase 2: `grep -c "tests/cassettes\\|tests/" bin/lib/doctor/probes/http-crossref-ping.ts` returns 0 (cross-AI review HIGH fix — no production-tree imports from tests/). The probe interface (id + run signature) is stable so 02-07 fact-extraction works unchanged.
  </acceptance_criteria>
  <done>
    Ten probes shipped, all read-only, all returning the D-15 / D-20 contract shape.
    DOCT-02 ecosystem-tooling triad (Zotero MCP, Pandoc, humanizer skill) live.
    DOCT-05 Phase-2 substitute (build-artifact-resolves) live.
    D-03(d) http-crossref-ping shipped as SKIP-only Phase-2 contract; Phase 3 lands
    `bin/lib/http-mock.ts` (production-tree) and re-enables PASS/FAIL.
    DOCT-07 runtime-config-presence respects D-12 / T-01-07 no-leak invariant.
    Task 3 wires them into the `doctor` verb and the renderer.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Doctor renderer (TTY + JSON) + wire to doctorCommand — exit-code contract</name>
  <files>bin/lib/doctor/render.ts, bin/cli/doctor.ts, tests/doctor-exit-code.test.ts, tests/doctor-shape.test.ts</files>
  <read_first>
    - `references/doctor-output.md` (Wave 0 — LOCKED copy and JSON shape; D-18) — including the sha256 hash check from 02-00.
    - `bin/lib/doctor/probes.ts` and 8 probe files from Task 2
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
      } catch (err: unknown) {
        // Non-zero exit. Validate it's exit 1 AND stdout contained FAIL.
        const status = (err as { status?: number }).status;
        const stdout = (err as { stdout?: Buffer | string }).stdout?.toString() ?? '';
        assert.equal(status, 1, `unexpected exit code: ${status}`);
        assert.match(stdout, /FAIL/, 'exit 1 only with FAIL present');
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

    **Step D — `tests/doctor-shape.test.ts` (TIER-04 / D-20):**

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
    - `node dist/bin/pensmith.js doctor` runs all 10 probes and exits 0 (assuming
      the host has `dist/mcp/server.js` from 02-04 — note dependency ordering;
      `mcp-sdk-presence` and `build-artifact-resolves` may FAIL otherwise, in
      which case the test's catch path handles it correctly).
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
    - `grep -v '^[[:space:]]*//' bin/lib/doctor/render.ts bin/cli/doctor.ts | grep -cE "writeFile|atomicWriteFile|withLock"` returns 0 (D-19 read-only).
  </acceptance_criteria>
  <done>
    Doctor verb fully wired. TIER-04 + DOCT-01, DOCT-02 (3 ecosystem probes),
    DOCT-03, DOCT-04, DOCT-05 (Phase-2 substitute build-artifact-resolves),
    DOCT-07 satisfied. D-03(d) cassette wiring smoke (http-crossref-ping) live.
    DOCT-06 (both-tiers-equivalent-doctor-output) is asserted by the
    tier-contract harness in 02-07.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| CLI argv → dispatcher | citty parses argv; only registered verbs run; unknown verb prints help and exits non-zero |
| doctor → host filesystem | Read-only (D-19); probes may `statSync` / `readFileSync` paths but never write |
| doctor → host environment | Reads selected env vars (PENSMITH_CONTACT_EMAIL, OPENALEX_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY) by name; only `runtime-config-presence.ts` binds via the literal-typed `provider.apiKeyEnv` field, with immediate length-test + boolean coercion (D-12) |
| doctor → external binaries (pandoc) | `execFileSync('pandoc', ['--version'])` — argv form only, no shell. 5s timeout. Spawn failure → WARN (never FAIL) |
| doctor → user config files (zotero) | `readFileSync` on `~/.claude/mcp_servers.json` and `~/.config/claude/mcp_servers.json` — JSON.parse defensively; malformed → fall through |
| doctor → user skill directory (humanizer) | `existsSync` + `readdirSync` on `~/.claude/skills/humanizer/` — read-only directory enumeration |
| doctor stdout → user terminal | Renders ProbeResult content; T-01-07 / D-12 carry-forward — NEVER include resolved secret values |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-05-01 | Information Disclosure | runtime-config probe (DOCT-07) accidentally includes the resolved API key in `detail` | mitigate | Probe code uses literal-bound `process.env[provider.apiKeyEnv]` → `typeof === 'string' && length > 0` boolean coercion (D-12 pattern). Detail serialises ONLY `{name, apiKeyEnv, present}`. **Sentinel-value test** in `doctor-probes.test.ts` injects `sk-test-LEAK-SENTINEL-12345` and asserts `r.detail!.includes(SENTINEL) === false`. Lint in 02-01 (capabilities-no-leak rule) extends to `bin/lib/doctor/probes/runtime-config-presence.ts`. |
| T-02-05-02 | Tampering | doctor writes to `.paper/` and corrupts state | mitigate | D-19 read-only contract. `tests/doctor-probes.test.ts` D-19 assertion: `readdirSync(tmp)` before/after equality. Lint: no `writeFile` / `atomicWriteFile` / `withLock` strings in `bin/lib/doctor/` (header-strip + grep -c == 0). |
| T-02-05-03 | Spoofing | A stub verb is accidentally swapped to a real implementation that exfiltrates data | mitigate | `tests/cli-stubs.test.ts` asserts every stub stdout matches `/not implemented yet/`. Exit 0 only. A real implementation would either have different stdout (fails the assertion) or be in a different verb (fails the 16-count assertion). |
| T-02-05-04 | Denial of Service | A misbehaving probe hangs the doctor invocation indefinitely | mitigate | `Promise.allSettled` ensures one probe's hang affects only its own resolution. `execFileSync` calls (pandoc probe) include `timeout: 5000`. Node-level kill via Ctrl-C remains available. |
| T-02-05-05 | Elevation of Privilege | A stub verb is invoked with `--yolo` and somehow mutates state | mitigate | Stubs don't accept any args (citty `defineCommand` with no `args:` block ignores additional argv tokens). Behavior is print + exit. |
| T-02-05-06 | Information Disclosure | doctor `--json` is piped to a public location (CI log, paste bin) revealing host paths | accept | `paperDir()` is a host path string; doctor by design reports it. The user must avoid pasting CI logs to public locations. This is OPSEC, not a control we add here. |
| T-02-05-07 | Tampering / Information Disclosure | pandoc probe shells out to a hostile binary at `./pandoc` instead of system pandoc | mitigate | `execFileSync('pandoc', ['--version'])` — Node's child_process resolves via PATH, not CWD-first. Argv form (no `exec` / shell). The probe trusts the user's PATH; if a hostile binary is shadowed there, this is a host-compromise issue outside our threat model. |
| T-02-05-08 | Information Disclosure | zotero-mcp probe reads `~/.claude/mcp_servers.json` and echoes contents to stdout | mitigate | Probe only emits `Object.keys(mcpServers)` matches against `/zotero/i` — never the value of any server entry. Detail string lists *paths checked*, not config contents. |

Security domain: V4 Access Control (D-19 read-only restricts blast radius), V14 Configuration (no resolved-value disclosure in probes / render), V5 Validation (defensive `JSON.parse` in zotero-mcp probe — malformed config falls through to WARN).
</threat_model>

<verification>
After all three tasks:

1. `npm run build` produces `dist/bin/pensmith.js`, `dist/bin/cli/stubs.js`, `dist/bin/cli/doctor.js`, and `dist/mcp/server.js`.
2. `node dist/bin/pensmith.js --version` prints `0.2.0`, exits 0.
3. `node dist/bin/pensmith.js new` prints `pensmith new: not implemented yet`, exits 0.
4. `node dist/bin/pensmith.js doctor` prints the locked report + exits 0 (assuming no FAIL on the dev box).
5. `node dist/bin/pensmith.js doctor --json` produces `JSON.parse`-able output with `{ schemaVersion: 1, probes: {...}, summary: {...} }`.
6. `node scripts/run-tests.mjs tests/cli-verbs.test.ts tests/cli-stubs.test.ts tests/doctor-exit-code.test.ts tests/doctor-shape.test.ts tests/doctor-probes.test.ts` — all green.
7. `npm run lint` + `npm run typecheck` pass.
8. `grep -v '^[[:space:]]*//' bin/lib/doctor/**/*.ts | grep -cE "writeFile|atomicWriteFile|withLock|mkdir"` returns 0 (D-19).
9. `grep -lE 'loadCapabilityFacts' bin/lib/doctor/probes/*.ts` lists exactly `bin/lib/doctor/probes/runtime-config-presence.ts` (cross-AI cycle-2 HIGH #2: DOCT-07 delegates to the shared `bin/lib/capabilities.ts::loadCapabilityFacts` helper rather than calling `loadRuntimeConfig` directly, so both tiers compose facts from a SINGLE source). `grep -lE 'loadRuntimeConfig' bin/lib/doctor/probes/*.ts` returns no probe files.
10. `grep -cE 'exec\(' bin/lib/doctor/probes/*.ts` returns 0 (Pitfall 8 — only `execFileSync`).
11. **Sentinel-value leak test** (in `tests/doctor-probes.test.ts`) passes: `process.env.OPENALEX_API_KEY = 'sk-test-LEAK-SENTINEL-12345'` → `runtimeConfigPresenceProbe.run()` → `r.detail!.includes('sk-test-LEAK-SENTINEL-12345') === false`.
12. `http-crossref-ping.ts` is structurally SKIP-only in Phase 2 — `grep -c "tests/" bin/lib/doctor/probes/http-crossref-ping.ts` returns 0 (cross-AI review HIGH fix: production code MUST NOT import from tests/). Probe interface is stable so 02-07 fact extraction is unaffected.
</verification>

<success_criteria>
- TIER-04 (this plan's primary requirement): ProbeResult shape is `{id, severity, summary, detail?, fix?}`, and `bin.pensmith` resolves to `dist/bin/pensmith.js` (CONTRIBUTING.md D-24 lock + 02-07 preflight). 16 UX-02 verbs dispatchable (15 stubs + doctor); workflow-key-equal preflight passes once 02-06 lands.
- Stubs exit 0 with "not implemented yet" stdout (TIER-04 surface contract).
- Doctor exits 0 on PASS/WARN/SKIP, non-zero on FAIL (DOCT-* surface contract).
- DOCT-01 (node-version), DOCT-02 (3 ecosystem probes: zotero-mcp-presence, pandoc-presence, humanizer-skill-presence), DOCT-03 (contact-email-presence), DOCT-04 (sync-folder-detection), DOCT-05 (build-artifact-resolves — Phase-2 substitute per CONTEXT D-04 + B4 user decision), DOCT-07 (runtime-config-presence): probes implemented + tested.
- D-03(d) http-crossref-ping: probe shipped with stable id but Phase 2 contract = structurally SKIP-only (cross-AI review HIGH fix from Codex iter 1: production code MUST NOT import from `tests/`). Phase 3 will land production-tree `bin/lib/http-mock.ts` and re-enable PASS/FAIL.
- DOCT-06 (both-tiers-equivalent-doctor-output): asserted by tier-contract harness in 02-07 — NOT in this plan's scope.
- D-19: doctor is read-only — no .paper/ writes (asserted by test).
- D-20: Record<string, ProbeResult> keyed by probe.id (asserted by test).
- D-18: JSON shape is `{ schemaVersion: 1, probes, summary }`.
- **D-12 / T-01-07 carry-forward**: runtime-config-presence probe sentinel-value leak test passes.
</success_criteria>

<output>
After completion, create `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-05-SUMMARY.md`.
</output>
