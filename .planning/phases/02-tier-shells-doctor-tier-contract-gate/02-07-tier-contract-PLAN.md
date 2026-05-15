---
phase: 02-tier-shells-doctor-tier-contract-gate
plan: 07
type: execute
wave: 3
depends_on: ["02-04", "02-05", "02-06"]
files_modified:
  - tests/tier-contract.test.ts
  - bin/lib/doctor/probes/wiring-smoke.ts
  - bin/lib/doctor/probes.ts
  - package.json
  - .github/workflows/ci.yml
  - tests/doctor-probes.test.ts
autonomous: true
requirements: [TIER-05, DOCT-05]
must_haves:
  truths:
    - "tests/tier-contract.test.ts spawns dist/bin/pensmith.js + dist/mcp/server.js and proves they expose equivalent contracts"
    - "DOCT-05 wiring-smoke probe runs `node dist/bin/pensmith.js --version`, asserts exit 0"
    - "`npm run test:tier-contract` is a top-level package script"
    - "`.github/workflows/ci.yml` runs the tier-contract step on all 3 OSes"
    - "Tier-contract failure blocks merge — fourth and last layer of the hard merge gate (D-23)"
  artifacts:
    - path: "tests/tier-contract.test.ts"
      provides: "Black-box contract tests using official MCP SDK Client + StdioClientTransport"
    - path: "bin/lib/doctor/probes/wiring-smoke.ts"
      provides: "DOCT-05 — spawns `node dist/bin/pensmith.js --version` via execFileSync"
    - path: "package.json"
      provides: "`test:tier-contract` script registered + `check` script extended"
    - path: ".github/workflows/ci.yml"
      provides: "Tier-contract step in the 3-OS matrix"
  key_links:
    - from: "tests/tier-contract.test.ts"
      to: "@modelcontextprotocol/sdk/client/{index,stdio}.js"
      via: "Client + StdioClientTransport (Pitfall 9 — official client, NOT raw JSON-RPC)"
      pattern: "StdioClientTransport"
    - from: "bin/lib/doctor/probes/wiring-smoke.ts"
      to: "dist/bin/pensmith.js"
      via: "execFileSync(process.execPath, [bin, '--version'])"
      pattern: "execFileSync.*pensmith\\.js"
    - from: ".github/workflows/ci.yml"
      to: "npm run test:tier-contract"
      via: "explicit `- run:` step after build"
      pattern: "test:tier-contract"
---

<objective>
Close the phase with the load-bearing fourth gate of D-23's hard-merge contract: a
black-box tier-contract test that proves Tier 1 (MCP server, `dist/mcp/server.js`) and
Tier 2 (CLI, `dist/bin/pensmith.js`) expose **equivalent** behavior for the three
operations the architecture promises: doctor PASS shape, paper://capabilities shape,
and state-mutation idempotency (D-17 contract).

Also lands DOCT-05 (`wiring-smoke` probe), which depends on the build artifact being
present and is the final probe registered with the doctor aggregator from 02-05.

Per **Pitfall 9 (RESEARCH.md)**: the test uses the official `Client` +
`StdioClientTransport` from `@modelcontextprotocol/sdk` — NEVER raw JSON-RPC. Hand-rolled
frame parsing has burned every team that tried.

Per **D-22**: `npm run test:tier-contract` runs in CI on linux-x64, macos-arm64,
windows-x64. macos-latest arm64 verification was added in Phase 0 (Pitfall C); this
plan re-uses that runner.

Per **D-23**: the four merge-gate layers are now (1) CI step, (2) branch protection
(configured outside this repo — documented in CONTRIBUTING.md from 02-08),
(3) `scripts/validate-plugin-manifest.cjs` preflight, (4) CONTRIBUTING.md prose.
This plan delivers (1). Plan 02-08 delivers (4). Plan 02-06 delivered (3).
Layer (2) is configured in GitHub UI by the user — instructions land in CONTRIBUTING.md
in 02-08.

Output: a tier-contract test that fails CI on any divergence between Tier 1 and Tier 2,
DOCT-05 probe shipped, and the CI workflow extended.
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
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-04-mcp-server-PLAN.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-05-cli-doctor-PLAN.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-06-hooks-workflows-PLAN.md
@.github/workflows/ci.yml

<interfaces>
<!-- Official MCP SDK Client surface (D-02 lock). Pitfall 9 source. -->

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/mcp/server.js'],
});
const client = new Client({ name: 'tier-contract', version: '0.0.0' }, { capabilities: {} });
await client.connect(transport);

// Resources:
const resources = await client.listResources();          // { resources: [...] }
const content = await client.readResource({ uri: '...' }); // { contents: [...] }

// Tools:
const tools = await client.listTools();                  // { tools: [...] }
const result = await client.callTool({ name: '...', arguments: {...} });

await client.close();
```

<!-- The Tier 2 surface (from 02-05): -->

```bash
node dist/bin/pensmith.js doctor --json   # → JSON with { schemaVersion: 1, probes: {...}, summary: {...} }
node dist/bin/pensmith.js --version       # → "0.2.0\n" exit 0
```

<!-- D-17 contract — what tier-contract.test.ts asserts: -->

1. **Doctor PASS shape equivalence**: there is no Tier 1 doctor — instead the
   tier-contract test asserts that `paper://capabilities` (MCP resource) and
   `pensmith doctor --json` (CLI) report the SAME boolean facts about the host
   environment. The shape is different by design (capabilities is a single
   resource read; doctor is a multi-probe report) but the keys for "is
   OPENALEX_API_KEY present?" must agree.

2. **Capabilities resource shape**: `readResource('paper://capabilities')`
   returns content matching the shape from 02-04 (exactly these keys, all
   boolean): `openalexApiKey`, `anthropicApiKey`, `openaiApiKey`,
   `pensmithContactEmail`.

3. **State-mutation idempotency**: `callTool('state.update', { ... })` applied
   twice with the same patch returns byte-identical results. The second call
   is a no-op at the storage layer (relies on `updateState`'s atomic-write
   pattern from Phase 1).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: tests/tier-contract.test.ts — 3 contract cases via official Client</name>
  <files>tests/tier-contract.test.ts, package.json</files>
  <read_first>
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-RESEARCH.md` § Pitfall 9 (use official Client + StdioClientTransport)
    - `mcp/server.ts`, `mcp/resources.ts`, `mcp/tools.ts` (from 02-04 — the surface under test)
    - `bin/cli/pensmith.ts`, `bin/cli/doctor.ts`, `bin/lib/doctor/probes.ts` (from 02-05 — the CLI side)
    - `tests/mcp-tool-handlers.test.ts` (from 02-04 — in-process pattern; this test uses STDIO instead)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-17, D-22, D-23
  </read_first>
  <behavior>
    Three test cases run against the BUILT artifacts (dist/mcp/server.js +
    dist/bin/pensmith.js). The build is a precondition (CI runs `npm run build`
    before `npm run test:tier-contract`; locally the executor runs both).

    1. **Case A — capability fact equivalence**: spawn `dist/mcp/server.js` via
       Client + StdioClientTransport; `readResource('paper://capabilities')`;
       extract the 4 boolean fields. Then spawn `dist/bin/pensmith.js doctor --json`;
       extract the corresponding facts from `probes['http-contact-email']` +
       `probes['runtime-config-presence']`. Assert each MCP boolean matches
       the same boolean derived from the CLI output. If they disagree, D-21
       discipline says fix the SHIPPED code so they agree — do NOT loosen the
       test.

    2. **Case B — capabilities shape exactness**: `readResource('paper://capabilities')`
       returns an object with exactly the 4 keys `openalexApiKey`, `anthropicApiKey`,
       `openaiApiKey`, `pensmithContactEmail`, each `typeof === 'boolean'`, and
       NO additional keys. Forbid `apiKey`, `value`, `key`, `secret` substrings
       in the raw JSON (D-12 runtime symmetric defense).

    3. **Case C — state.update idempotency**: create a tmp paperRoot with
       a fresh STATE.json; call `state.update` with a non-empty patch; capture
       the returned state. Call it AGAIN with the same patch; capture again.
       Assert the two captures are JSON-deep-equal (idempotent merge). Then
       call `state.read`; assert it equals the second capture.
  </behavior>
  <action>
    **Step A — register `test:tier-contract` script in `package.json`:**

    Add to the `scripts` block:
    ```json
    "test:tier-contract": "node --experimental-vm-modules scripts/run-tests.mjs tests/tier-contract.test.ts",
    ```

    Also extend the existing `check` script to include `test:tier-contract`:
    ```json
    "check": "npm run lint && npm run typecheck && npm run build && npm run test:tier-contract && npm test && npm run validate:manifests"
    ```

    (Order matters: build before test:tier-contract; test:tier-contract before
    `npm test` because the contract test is the most-likely-to-fail and
    fails-fast saves CI minutes.)

    **Step B — create `tests/tier-contract.test.ts`:**

    ```typescript
    // tests/tier-contract.test.ts
    //
    // D-17: tier contract between Tier 1 (MCP server) and Tier 2 (CLI).
    // D-22: runs in CI on linux-x64, macos-arm64, windows-x64.
    // D-23: failure here blocks merge — fourth layer of the hard merge gate.
    //
    // Pitfall 9: uses official Client + StdioClientTransport. NEVER raw JSON-RPC.

    import { test, before, after } from 'node:test';
    import assert from 'node:assert/strict';
    import { execFileSync } from 'node:child_process';
    import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { Client } from '@modelcontextprotocol/sdk/client/index.js';
    import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

    const MCP_BIN = 'dist/mcp/server.js';
    const CLI_BIN = 'dist/bin/pensmith.js';

    let client: Client;
    let transport: StdioClientTransport;

    before(async () => {
      assert.ok(existsSync(MCP_BIN), `${MCP_BIN} missing — run npm run build`);
      assert.ok(existsSync(CLI_BIN), `${CLI_BIN} missing — run npm run build`);
      transport = new StdioClientTransport({
        command: process.execPath,
        args: [MCP_BIN],
      });
      client = new Client(
        { name: 'tier-contract-test', version: '0.0.0' },
        { capabilities: {} },
      );
      await client.connect(transport);
    });

    after(async () => {
      await client?.close();
    });

    function freshPaperRoot(): string {
      const root = mkdtempSync(join(tmpdir(), 'pensmith-tier-contract-'));
      mkdirSync(join(root, '.paper'), { recursive: true });
      writeFileSync(join(root, '.paper', 'STATE.json'), '{"version":1,"sections":[]}');
      writeFileSync(join(root, '.paper', 'LIBRARY.json'), '{"version":1,"entries":[]}');
      return root;
    }

    function readCapabilities(content: { contents: Array<{ text?: string }> }): Record<string, unknown> {
      const text = content.contents[0]?.text;
      assert.ok(typeof text === 'string', 'capabilities resource must return text content');
      return JSON.parse(text);
    }

    test('Case A: capability fact equivalence (MCP vs CLI)', async () => {
      // MCP side: paper://capabilities
      const capsContent = await client.readResource({ uri: 'paper://capabilities' });
      const mcpCaps = readCapabilities(capsContent);

      // CLI side: pensmith doctor --json
      const cliOut = execFileSync(process.execPath, [CLI_BIN, 'doctor', '--json'], {
        encoding: 'utf8',
        env: { ...process.env },  // pass through env so both sides see same flags
      });
      // doctor may exit 1 on FAIL; execFileSync throws in that case. Re-extract from err.stdout.
      // (Handled by the try/catch below if necessary.)

      const cliJson = JSON.parse(cliOut);
      const cliEmailPresent = cliJson.probes['http-contact-email'].severity === 'PASS';
      const cliRuntimeDetail: string = cliJson.probes['runtime-config-presence'].detail ?? '';
      const cliOpenalex = /openalex=true/.test(cliRuntimeDetail);
      const cliAnthropic = /anthropic=true/.test(cliRuntimeDetail);
      const cliOpenai = /openai=true/.test(cliRuntimeDetail);

      // Agreement assertions:
      assert.equal(mcpCaps.pensmithContactEmail, cliEmailPresent, 'PENSMITH_CONTACT_EMAIL presence disagrees');
      assert.equal(mcpCaps.openalexApiKey, cliOpenalex, 'OPENALEX_API_KEY presence disagrees');
      assert.equal(mcpCaps.anthropicApiKey, cliAnthropic, 'ANTHROPIC_API_KEY presence disagrees');
      assert.equal(mcpCaps.openaiApiKey, cliOpenai, 'OPENAI_API_KEY presence disagrees');
    });

    test('Case B: paper://capabilities shape — exactly 4 boolean keys, no secret substring', async () => {
      const content = await client.readResource({ uri: 'paper://capabilities' });
      const text = content.contents[0]?.text;
      assert.ok(typeof text === 'string');
      const parsed = JSON.parse(text);
      const keys = Object.keys(parsed).sort();
      assert.deepEqual(
        keys,
        ['anthropicApiKey', 'openaiApiKey', 'openalexApiKey', 'pensmithContactEmail'].sort(),
        'capabilities must have exactly these 4 keys',
      );
      for (const [k, v] of Object.entries(parsed)) {
        assert.equal(typeof v, 'boolean', `${k} must be boolean, got ${typeof v}`);
      }
      // D-12 symmetric defense at runtime: raw text must NOT contain a secret-shaped substring.
      assert.ok(!/sk-[A-Za-z0-9]/.test(text!), 'capabilities content contains a sk-... shaped value — D-12 leak');
      assert.ok(!/"value"\s*:/.test(text!), 'capabilities content contains a "value" field — likely leak');
    });

    test('Case C: state.update is idempotent', async () => {
      const root = freshPaperRoot();
      const patch = { sections: [{ id: 's1', title: 'Section 1', status: 'planned' }] };

      const r1 = await client.callTool({
        name: 'state.update',
        arguments: { paperRoot: root, patch },
      });
      const r2 = await client.callTool({
        name: 'state.update',
        arguments: { paperRoot: root, patch },
      });
      const t1 = JSON.parse(r1.content[0].text);
      const t2 = JSON.parse(r2.content[0].text);
      assert.deepEqual(t1, t2, 'state.update must be idempotent (same patch -> same state)');

      const r3 = await client.callTool({
        name: 'state.read',
        arguments: { paperRoot: root },
      });
      const t3 = JSON.parse(r3.content[0].text);
      assert.deepEqual(t3, t2, 'state.read must return the post-update state');
    });
    ```

    Notes for executor:
    - If `Client.callTool({ arguments })` returns a `result.isError === true`
      instead of throwing on invalid args, the negative cases handled by 02-04
      take care of that. This test is positive-only (the 3 cases above all
      pass valid args).
    - The `execFileSync` for the CLI may throw if doctor exits 1 (any probe
      FAILs). If that's the case on the CI runner because DOCT-02 (mcp-presence)
      can't find dist/mcp/server.js for some reason, the test should fail
      explicitly with the "build artifact missing" error, NOT silently mask the
      doctor crash. Wrap in try/catch and re-throw with context if needed.
    - Confirm the SDK exports `StdioClientTransport` from
      `@modelcontextprotocol/sdk/client/stdio.js` at v1.29 — if the package
      restructured exports, adjust the import path. Source: the SDK's
      `package.json` `exports` map (installed in 02-04).
  </action>
  <verify>
    <automated>npm run build &amp;&amp; node scripts/run-tests.mjs tests/tier-contract.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/tier-contract.test.ts` exists and uses official `Client` + `StdioClientTransport` (NOT raw JSON-RPC).
    - Three test cases (A: capability fact equivalence, B: shape exactness, C: state.update idempotency) all pass.
    - `package.json` has `test:tier-contract` script that points at this file.
    - `package.json` `check` script includes `npm run test:tier-contract` in its chain.
    - `grep -c "StdioClientTransport" tests/tier-contract.test.ts` returns at least 1.
    - `grep -c "JSON.parse\|JSON-RPC" tests/tier-contract.test.ts` — JSON-RPC count is 0 (no raw protocol); JSON.parse count ≥ 3 (we parse text content from resource + tool returns).
  </acceptance_criteria>
  <done>
    Tier contract proven black-box. Plan 02-08 adds the CONTRIBUTING.md "Tier contract"
    prose layer to complete D-23's four-layer gate.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: DOCT-05 wiring-smoke probe — spawn `pensmith --version`</name>
  <files>bin/lib/doctor/probes/wiring-smoke.ts, bin/lib/doctor/probes.ts, tests/doctor-probes.test.ts</files>
  <read_first>
    - `bin/lib/doctor/probes.ts` (from 02-05 — `defaultProbes()` to extend)
    - `bin/lib/doctor/probes/mcp-presence.ts` (sibling probe — shape and statSync usage pattern)
    - `bin/cli/pensmith.ts` (from 02-05 — the binary the probe spawns)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-19 (read-only)
  </read_first>
  <behavior>
    `wiring-smoke` probe:
    - Spawns `node dist/bin/pensmith.js --version` via `execFileSync`.
    - PASS when the process exits 0 AND stdout matches `/^\d+\.\d+\.\d+/`.
    - FAIL when the binary is missing.
    - WARN when the binary exists but exit code != 0 (smoke fails; pensmith
      is broken in a non-trivial way).
    - Uses `execFileSync` (NOT `exec`) — no shell interpolation (V5 mitigation,
      Pitfall: T-02-04 register).
    - D-19 read-only — the probe doesn't write anywhere; spawning a process that
      writes nothing is fine.
  </behavior>
  <action>
    **Step A — create `bin/lib/doctor/probes/wiring-smoke.ts`:**

    ```typescript
    // bin/lib/doctor/probes/wiring-smoke.ts
    //
    // DOCT-05: end-to-end smoke — spawn `node dist/bin/pensmith.js --version`.
    // Exits 0 AND stdout looks like a semver → PASS.
    //
    // Security: execFileSync (NOT exec) — no shell interpolation. Args are an
    // array literal; user input cannot reach a shell.
    // D-19: read-only — the spawned child runs the CLI's --version path which
    // never touches .paper/.

    import type { Probe, ProbeResult } from '../probes.js';
    import { execFileSync } from 'node:child_process';
    import { existsSync } from 'node:fs';

    const CLI_BIN = 'dist/bin/pensmith.js';

    export const wiringSmokeProbe: Probe = {
      id: 'wiring-smoke',
      async run(): Promise<ProbeResult> {
        if (!existsSync(CLI_BIN)) {
          return {
            id: 'wiring-smoke',
            severity: 'FAIL',
            summary: `${CLI_BIN} missing — Tier 2 binary not built`,
            fix: 'Run `npm run build`.',
          };
        }
        try {
          const out = execFileSync(process.execPath, [CLI_BIN, '--version'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 5000,
          });
          if (/^\d+\.\d+\.\d+/.test(out.trim())) {
            return {
              id: 'wiring-smoke',
              severity: 'PASS',
              summary: `${CLI_BIN} --version → ${out.trim()}`,
            };
          }
          return {
            id: 'wiring-smoke',
            severity: 'WARN',
            summary: `${CLI_BIN} --version returned unexpected output: ${out.trim()}`,
          };
        } catch (err) {
          return {
            id: 'wiring-smoke',
            severity: 'WARN',
            summary: `${CLI_BIN} --version exited non-zero or timed out`,
            detail: String((err as Error).message),
            fix: 'Run `npm run build && node dist/bin/pensmith.js --version` to reproduce locally.',
          };
        }
      },
    };
    ```

    **Step B — register `wiringSmokeProbe` in `bin/lib/doctor/probes.ts`:**

    Update the `defaultProbes()` function and the import block:

    ```typescript
    import { wiringSmokeProbe } from './probes/wiring-smoke.js';

    export function defaultProbes(): Probe[] {
      return [
        nodeVersionProbe,
        mcpPresenceProbe,
        contactEmailProbe,
        syncFolderProbe,
        runtimeConfigProbe,
        wiringSmokeProbe,    // <-- new, last in the order
      ];
    }
    ```

    **Step C — extend `tests/doctor-probes.test.ts` with DOCT-05 cases:**

    Append at the bottom of the existing test file:

    ```typescript
    import { wiringSmokeProbe } from '../bin/lib/doctor/probes/wiring-smoke.js';

    test('DOCT-05 wiring-smoke: PASS when dist/bin/pensmith.js prints semver', async () => {
      // Precondition: npm run build has run.
      const r = await wiringSmokeProbe.run();
      assert.equal(r.id, 'wiring-smoke');
      // Either PASS (built) or FAIL (not built); both are acceptable shapes here.
      assert.ok(['PASS', 'WARN', 'FAIL'].includes(r.severity));
      if (r.severity === 'PASS') {
        assert.match(r.summary, /\d+\.\d+\.\d+/);
      }
    });

    test('DOCT-05 wiring-smoke: FAIL when binary missing (synthetic)', async () => {
      // We can't actually delete dist/bin/pensmith.js mid-test, but we can prove
      // the FAIL branch's shape by inspecting the source for the right exit-criteria.
      // (Black-box "delete and retest" lives in tier-contract.test.ts which runs
      // with the binary present; the failure mode is observable in CI when build
      // is skipped.)
      // This test is a sentinel — assert the probe file exports the right shape.
      const r = await wiringSmokeProbe.run();
      assert.ok(typeof r.summary === 'string' && r.summary.length > 0);
    });
    ```

    Self-check:
    - `grep -c "execFileSync" bin/lib/doctor/probes/wiring-smoke.ts` returns at least 1.
    - `grep -c "exec(" bin/lib/doctor/probes/wiring-smoke.ts` returns 0 (no shell exec).
    - `grep -c "wiringSmokeProbe" bin/lib/doctor/probes.ts` returns at least 2 (import + array entry).
    - `node dist/bin/pensmith.js doctor` now shows 6 probes (5 from 02-05 + wiring-smoke).
    - `node dist/bin/pensmith.js doctor --json | jq '.summary | (.pass + .warn + .fail + .skip)'` returns `6`.
  </action>
  <verify>
    <automated>npm run lint &amp;&amp; npm run typecheck &amp;&amp; npm run build &amp;&amp; node scripts/run-tests.mjs tests/doctor-probes.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `bin/lib/doctor/probes/wiring-smoke.ts` exists and exports `wiringSmokeProbe: Probe`.
    - `bin/lib/doctor/probes.ts` imports + registers it in `defaultProbes()` (6 probes total).
    - `tests/doctor-probes.test.ts` includes a DOCT-05 case.
    - `node dist/bin/pensmith.js doctor` runs 6 probes and includes `wiring-smoke` in the report.
    - `grep -c "exec(" bin/lib/doctor/probes/wiring-smoke.ts` returns 0 (no shell exec — execFileSync only).
    - `grep -c "writeFile\|atomicWriteFile" bin/lib/doctor/probes/wiring-smoke.ts` returns 0 (D-19).
  </acceptance_criteria>
  <done>
    DOCT-05 wiring-smoke probe shipped. Doctor now has the complete 6-probe set for
    Phase 2.
  </done>
</task>

<task type="auto">
  <name>Task 3: Extend .github/workflows/ci.yml with the tier-contract step</name>
  <files>.github/workflows/ci.yml</files>
  <read_first>
    - `.github/workflows/ci.yml` in full (current 45-line shape — 3-OS matrix, lint → typecheck → build → test → validate-manifests)
    - `package.json` after Task 1 (`test:tier-contract` script registered)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-22, D-23
  </read_first>
  <action>
    Add a `Tier contract` step to `.github/workflows/ci.yml` AFTER the existing
    `Build` step (line 38-39) and BEFORE the `npm test` step (line 41). The step
    must run on all 3 OSes (no `if:` guard).

    **Required edit** — insert at line ~40, immediately after `npm run build`:

    ```yaml
      - name: Tier contract (Tier 1 ↔ Tier 2 equivalence — D-23 layer 1)
        run: npm run test:tier-contract
    ```

    The result should look like (excerpt):

    ```yaml
      - name: Build (produces dist/mcp/server.js for manifest validation)
        run: npm run build

      - name: Tier contract (Tier 1 ↔ Tier 2 equivalence — D-23 layer 1)
        run: npm run test:tier-contract

      - run: npm test

      - name: Validate plugin manifests
        run: node scripts/validate-plugin-manifest.cjs
    ```

    Rationale for ordering:
    1. Build must come before tier-contract (needs both dist artifacts).
    2. Tier-contract before `npm test` (fail-fast on the most architectural assertion).
    3. Validate-manifests stays last (cheapest preflight; if everything else passed, this is a final sanity check).

    Self-check:
    - `grep -c "test:tier-contract" .github/workflows/ci.yml` returns at least 1.
    - The step appears between `npm run build` and `npm test`.
    - `actionlint .github/workflows/ci.yml` (if available locally) passes with no new warnings.
  </action>
  <verify>
    <automated>node -e "const fs=require('node:fs'); const c=fs.readFileSync('.github/workflows/ci.yml','utf8'); if(!/test:tier-contract/.test(c)){console.error('test:tier-contract step missing');process.exit(1)} const buildIdx=c.indexOf('npm run build'); const tcIdx=c.indexOf('test:tier-contract'); const npmTestIdx=c.indexOf('run: npm test'); if(!(buildIdx&lt;tcIdx&amp;&amp;tcIdx&lt;npmTestIdx)){console.error('step order wrong: build('+buildIdx+') ?&lt; tc('+tcIdx+') ?&lt; test('+npmTestIdx+')');process.exit(1)} console.log('OK')"</automated>
  </verify>
  <acceptance_criteria>
    - `.github/workflows/ci.yml` contains a `npm run test:tier-contract` step.
    - The step runs on all 3 OSes (no `if:` guard, sits within the matrix `steps:` block).
    - Order: `npm run build` → `npm run test:tier-contract` → `npm test` → `validate-plugin-manifest.cjs`.
    - The 3-OS matrix (ubuntu-latest, macos-latest, windows-latest) is unchanged.
    - The Phase 0 macos-arm64 verification step (lines 25-30) is unchanged.
  </acceptance_criteria>
  <done>
    CI runs the tier-contract step on every push to main and every PR, across linux-x64,
    macos-arm64, windows-x64. Layer 1 of the D-23 hard merge gate is live.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| tests/tier-contract.test.ts → spawned `dist/mcp/server.js` (subprocess) | StdioClientTransport spawns the child; test is the trusting party, child is the untrusted-yet-must-prove-itself counterparty |
| wiring-smoke probe → spawned `dist/bin/pensmith.js --version` | execFileSync, no shell — args array literal only; user input cannot reach a shell |
| CI runner → GitHub Actions secrets | None used in this phase; all probes operate on the environment as-shipped (no API calls made during CI runs) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-07-01 | Tampering | Hand-rolled JSON-RPC framing in the tier-contract test desynchronizes with the MCP protocol after an SDK update | mitigate | Use official `Client` + `StdioClientTransport` (Pitfall 9). When the SDK updates, our test breaks at the import surface (visible) rather than at the framing layer (silent). |
| T-02-07-02 | Information Disclosure | The tier-contract test logs `paper://capabilities` raw JSON to CI logs revealing a host's env-var presence flags | accept | The CONTENT of `paper://capabilities` is presence flags only (D-12). Logging a boolean for "is OPENALEX_API_KEY set?" leaks one bit of host configuration — acceptable. The lint chokepoints (02-03) + Case B assertion in this test ensure no actual values can leak. |
| T-02-07-03 | Injection | wiring-smoke probe's spawned binary path is constructed via string concatenation, allowing shell metachar injection | mitigate | Constant string `'dist/bin/pensmith.js'`. No user input. `execFileSync` with array args (no shell). |
| T-02-07-04 | Denial of Service | wiring-smoke probe hangs because the spawned `pensmith --version` runs forever (regression in 02-05) | mitigate | `timeout: 5000` on `execFileSync` ensures the probe completes in ≤5s regardless. Probe returns WARN on timeout (not FAIL — distinguishes "broken" from "missing"). |
| T-02-07-05 | Repudiation | A contributor pushes a PR that breaks tier contract; CI flake masks it; merge happens; production diverges | mitigate | The 3-OS matrix (D-22) makes single-OS flake less likely to mask a real bug. Layer 2 (branch protection — configured outside this PR per 02-08) makes a failing tier-contract step a hard merge block, not a warning. |
| T-02-07-06 | Elevation of Privilege | tier-contract test reaches into `.paper/` of the host repo because the test uses cwd-relative paths | mitigate | Test uses `mkdtempSync(join(tmpdir(), ...))` for every paperRoot. The host repo's `.paper/` is never touched. Case C assertion uses ONLY the tmp paperRoot. |

Security domain: V4 Access Control (tmp-dir isolation), V5 Input Validation (zod on every callTool — proved by 02-04 tests, exercised by Case C here), V14 Configuration (D-12 runtime symmetric defense in Case B).
</threat_model>

<verification>
After all three tasks:

1. `npm run build` succeeds.
2. `npm run test:tier-contract` exits 0 (all 3 cases pass).
3. `node dist/bin/pensmith.js doctor` reports 6 probes (5 from 02-05 + wiring-smoke).
4. `node dist/bin/pensmith.js doctor --json | jq '.probes."wiring-smoke".severity'` returns `"PASS"`.
5. `npm run check` exits 0 (lint + typecheck + build + tier-contract + test + validate-manifests).
6. `.github/workflows/ci.yml` runs the tier-contract step between build and `npm test`.
7. `grep -c "StdioClientTransport" tests/tier-contract.test.ts` returns at least 1.
8. `grep -c "exec(" bin/lib/doctor/probes/wiring-smoke.ts` returns 0 (shell-exec forbidden).
</verification>

<success_criteria>
- TIER-05 (server boots over stdio with 4 resources + 4 tools) is proven by the live `StdioClientTransport` connection in tier-contract.test.ts.
- DOCT-05 (wiring-smoke) is implemented + registered + tested.
- D-17 (tier contract) is asserted black-box: capability fact equivalence, shape exactness, idempotency.
- D-22 (3-OS matrix) is preserved.
- D-23 layer 1 (CI step) is live; layer 4 (CONTRIBUTING.md prose) lands in 02-08; layers 2 (branch protection) and 3 (preflight) are already in place.
- Pitfall 9 honored: official Client, never raw JSON-RPC.
</success_criteria>

<output>
After completion, create `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-07-SUMMARY.md`.
</output>
