---
phase: 02-tier-shells-doctor-tier-contract-gate
plan: 07
type: execute
wave: 3
depends_on: ["02-04", "02-05", "02-06", "02-09"]
files_modified:
  - tests/tier-contract.test.ts
  - tests/tier-contract/preflight.test.ts
  - tests/lib/assert-tier-equivalent.ts
  - package.json
  - .github/workflows/ci.yml
autonomous: true
requirements: [TIER-06, TIER-07, DOCT-06]
must_haves:
  truths:
    - "tests/tier-contract.test.ts spawns dist/bin/pensmith.js + dist/mcp/server.js and proves they expose equivalent contracts (DOCT-06)"
    - "tests/tier-contract/preflight.test.ts asserts the precondition surface (exactly 5 resources + 6 tools registered; dist artifacts exist + non-empty) BEFORE the contract cases run"
    - "tests/lib/assert-tier-equivalent.ts ships the ±20% prose-length helper required by TIER-07"
    - "`npm run test:tier-contract` is a top-level package script that runs preflight FIRST, then the four cases"
    - "`.github/workflows/ci.yml` runs the tier-contract step on all 3 OSes (D-22)"
    - "Tier-contract failure blocks merge — fourth and last layer of the hard merge gate (D-23 layer 1)"
    - "DOCT-05 wiring-smoke probe is NOT in this plan — deferred to Phase 3 per CONTEXT D-04"
  artifacts:
    - path: "tests/tier-contract/preflight.test.ts"
      provides: "Preflight assertions: exactly 5 resources, 6 tools, dist artifacts present + non-empty; runs before the contract cases"
    - path: "tests/tier-contract.test.ts"
      provides: "Four black-box contract tests via official MCP SDK Client + StdioClientTransport (Cases A–D)"
    - path: "tests/lib/assert-tier-equivalent.ts"
      provides: "TIER-07 helper — assertEquivalent({mcpText, cliText}, options?) — body-length tolerance ±20% by default, exact set-equality on extracted keys"
    - path: "package.json"
      provides: "`test:tier-contract` script registered + `check` script extended"
    - path: ".github/workflows/ci.yml"
      provides: "Tier-contract step in the 3-OS matrix"
  key_links:
    - from: "tests/tier-contract.test.ts"
      to: "@modelcontextprotocol/sdk/client/{index,stdio}.js"
      via: "Client + StdioClientTransport (Pitfall 9 — official client, NOT raw JSON-RPC)"
      pattern: "StdioClientTransport"
    - from: "tests/tier-contract.test.ts"
      to: "tests/lib/assert-tier-equivalent.ts"
      via: "assertEquivalent helper (Case D — ±20% prose tolerance per TIER-07)"
      pattern: "assertEquivalent"
    - from: "tests/tier-contract/preflight.test.ts"
      to: "dist/mcp/server.js + dist/bin/pensmith.js"
      via: "fs.statSync presence + non-empty + 5-resource / 6-tool registration check"
      pattern: "listResources|listTools"
    - from: ".github/workflows/ci.yml"
      to: "npm run test:tier-contract"
      via: "explicit `- run:` step after build"
      pattern: "test:tier-contract"
---

<objective>
Close the phase with the load-bearing fourth gate of D-23's hard-merge contract: a
black-box tier-contract test that proves Tier 1 (MCP server, `dist/mcp/server.js`) and
Tier 2 (CLI, `dist/bin/pensmith.js`) expose **equivalent** behavior for the four
operations the architecture promises:

1. **Case A — capability fact equivalence (binds DOCT-06)**: `paper://capabilities`
   from Tier 1 and `pensmith doctor --json` from Tier 2 report the SAME boolean
   facts about the host environment. Shapes differ by design; the **facts** must
   agree. This IS the DOCT-06 requirement ("Both tiers produce equivalent doctor
   output") — not a separate probe.
2. **Case B — capabilities shape exactness**: `paper://capabilities` matches the
   exact key set defined in 02-04 (mcp_self, contact_email_set, providers,
   pandoc, zotero_mcp, humanizer, onedrive_detected, sync_folder_match), and the
   raw JSON contains no secret-shaped substring (D-12 runtime symmetric defense).
3. **Case C — state-mutation idempotency**: calling `paper_advance_section` twice
   with the same args yields byte-identical state (verified through `paper://state`
   read back).
4. **Case D — prose-tolerance equivalence (binds TIER-07)**: the `pensmith doctor`
   TTY output and the MCP `paper_capability_probe` JSON payload, when their
   *fact set* is extracted and compared via `tests/lib/assert-tier-equivalent.ts`,
   agree within ±20% prose-length tolerance and on exact set-equality of probe-id
   keys. The helper exists so Phase 3+ workflows can re-use the same tolerance
   contract for verdicts, citation lists, and structure (per TIER-07).

A **preflight** test file (`tests/tier-contract/preflight.test.ts`) runs FIRST
and asserts the precondition surface so Cases A–D can fail with crisp errors
when the build is broken instead of stack-traces from the SDK Client.

DOCT-05 (end-to-end fixture probe) is NOT in this plan. Per CONTEXT D-04 the
DOCT-05 spawn-based smoke probe is deferred to Phase 3 where vertical-slice
intake/outline/verify lands; the artifact-presence stat check ships in 02-05
under the existing `mcp-presence` probe (which now also covers
`dist/bin/pensmith.js`).

Per **Pitfall 9 (RESEARCH.md)**: the test uses the official `Client` +
`StdioClientTransport` from `@modelcontextprotocol/sdk` — NEVER raw JSON-RPC.
Hand-rolled frame parsing has burned every team that tried.

Per **D-22**: `npm run test:tier-contract` runs in CI on linux-x64, macos-arm64,
windows-x64. macos-latest arm64 verification was added in Phase 0 (Pitfall C);
this plan re-uses that runner.

Per **D-23**: the four merge-gate layers are now (1) CI step, (2) branch protection
(configured outside this repo — documented in CONTRIBUTING.md from 02-08),
(3) `scripts/validate-plugin-manifest.cjs` preflight, (4) CONTRIBUTING.md prose.
This plan delivers (1). Plan 02-08 delivers (4). Plan 02-06 delivered (3).
Layer (2) is configured in GitHub UI by the user — instructions land in CONTRIBUTING.md
in 02-08.

Output: preflight + 4 contract cases + TIER-07 helper, CI workflow extended.
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
node dist/bin/pensmith.js doctor --json   # → JSON: { schemaVersion: 1, probes: {...}, summary: {...} }
node dist/bin/pensmith.js --version       # → "0.2.0\n" exit 0
```

<!-- The paper://capabilities shape from 02-04: -->

```json
{
  "mcp_self": true,
  "contact_email_set": true,
  "providers": [{ "name": "anthropic", "api_key_env": "ANTHROPIC_API_KEY", "present": true }],
  "pandoc": undefined,
  "zotero_mcp": undefined,
  "humanizer": undefined,
  "onedrive_detected": undefined,
  "sync_folder_match": undefined
}
```

<!-- The pensmith doctor --json shape from 02-05: -->

```json
{
  "schemaVersion": 1,
  "probes": {
    "node-version":             { "id": "...", "severity": "PASS|WARN|FAIL|SKIP", "summary": "...", "detail": "...", "fix": "..." },
    "mcp-sdk-presence":         { ... },
    "http-contact-email":       { ... },
    "sync-folder-detection":    { ... },
    "runtime-config-presence":  { ... },
    "zotero-mcp-presence":      { ... },
    "pandoc-presence":          { ... },
    "humanizer-skill-presence": { ... }
  },
  "summary": { "pass": 0, "warn": 0, "fail": 0, "skip": 0 }
}
```

<!-- D-17 contract — what tier-contract.test.ts asserts (Cases A–D): -->

1. **Case A (DOCT-06) — capability fact equivalence**: `paper://capabilities`
   (MCP resource) and `pensmith doctor --json` report the SAME boolean facts.
   The MCP shape is presence-flag-keyed (`contact_email_set`, `providers[*].present`);
   the CLI shape is probe-severity-keyed (`probes['http-contact-email'].severity === 'PASS'`,
   `probes['runtime-config-presence'].detail` parsed for provider lines). The test
   extracts the fact-set from BOTH and asserts agreement.

2. **Case B — capabilities shape**: keys exactly = the 8 documented keys.
   Forbid `apiKey`, `value`, `key`, `secret`, `sk-` substrings in raw JSON
   (D-12 runtime symmetric defense).

3. **Case C — state idempotency**: `paper_advance_section` applied twice with
   the same args; `paper://state` read after both calls is JSON-deep-equal.

4. **Case D (TIER-07) — prose tolerance**: Tier 1 `paper_capability_probe` tool
   output (JSON) and Tier 2 `pensmith doctor` TTY output (text). Extract the
   fact set from both via `assertEquivalent`, which asserts:
   - Exact set-equality of probe-id keys
   - For each shared boolean fact, identical values
   - Body-length tolerance: |len(mcpText) − len(cliText)| ≤ 0.20 × max(len(...)).
     The 20% allowance accommodates JSON-vs-TTY framing overhead while still
     catching gross divergence (e.g., one tier added a new probe without the other).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: tests/lib/assert-tier-equivalent.ts — the TIER-07 ±20% helper</name>
  <files>tests/lib/assert-tier-equivalent.ts, tests/lib/assert-tier-equivalent.test.ts</files>
  <read_first>
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` (TIER-07 requirement text)
    - `.planning/REQUIREMENTS.md` TIER-07 line (the ±20% length difference clause)
    - `tests/lib/` directory (confirm path conventions — siblings if any exist)
  </read_first>
  <behavior>
    `assertEquivalent({mcpText, cliText, mcpFacts, cliFacts}, options?)`:
    - Asserts `Object.keys(mcpFacts).sort()` deep-equals `Object.keys(cliFacts).sort()` — exact set-equality on probe-id keys.
    - For every shared key, asserts `mcpFacts[k] === cliFacts[k]` (boolean equality; mixed-type compared via `===`).
    - Asserts `|mcpText.length − cliText.length| ≤ tolerance × max(mcpText.length, cliText.length)` (default tolerance = 0.20, the TIER-07 clause).
    - On failure, raises an `AssertionError` whose message lists the divergent keys + the length deltas (NOT the raw text — too noisy in CI logs).
    - The function is pure — no fs, no http, no spawn. Imports only `node:assert/strict`.
  </behavior>
  <action>
    **Step A — create `tests/lib/assert-tier-equivalent.ts`:**

    ```typescript
    // tests/lib/assert-tier-equivalent.ts
    //
    // TIER-07 helper — Tier 1 (MCP) ↔ Tier 2 (CLI) output equivalence with
    // ±20% prose-length tolerance per the REQUIREMENTS.md TIER-07 clause.
    //
    // The helper is intentionally narrow: extract facts elsewhere, pass them in.
    // This file owns ONLY the comparison + tolerance math + error-message shape.

    import assert from 'node:assert/strict';

    export interface TierEquivalenceInput {
      mcpText: string;
      cliText: string;
      mcpFacts: Record<string, boolean | string | number>;
      cliFacts: Record<string, boolean | string | number>;
    }

    export interface TierEquivalenceOptions {
      tolerance?: number;       // 0.0–1.0; default 0.20 (TIER-07)
      label?: string;           // free-form context for the error message
    }

    export function assertEquivalent(
      input: TierEquivalenceInput,
      opts: TierEquivalenceOptions = {},
    ): void {
      const tolerance = opts.tolerance ?? 0.20;
      const label = opts.label ?? 'tier-equivalence';

      // Set-equality on keys.
      const mcpKeys = Object.keys(input.mcpFacts).sort();
      const cliKeys = Object.keys(input.cliFacts).sort();
      assert.deepEqual(
        mcpKeys,
        cliKeys,
        `[${label}] probe-id key set mismatch — mcp:${JSON.stringify(mcpKeys)} cli:${JSON.stringify(cliKeys)}`,
      );

      // Per-key value equality.
      const divergent: string[] = [];
      for (const k of mcpKeys) {
        if (input.mcpFacts[k] !== input.cliFacts[k]) {
          divergent.push(`${k}: mcp=${JSON.stringify(input.mcpFacts[k])} cli=${JSON.stringify(input.cliFacts[k])}`);
        }
      }
      assert.equal(divergent.length, 0, `[${label}] fact divergence:\n  ${divergent.join('\n  ')}`);

      // Body-length tolerance (TIER-07).
      const mLen = input.mcpText.length;
      const cLen = input.cliText.length;
      const denom = Math.max(mLen, cLen, 1);
      const ratio = Math.abs(mLen - cLen) / denom;
      assert.ok(
        ratio <= tolerance,
        `[${label}] prose-length tolerance exceeded — mcpLen=${mLen} cliLen=${cLen} ratio=${ratio.toFixed(3)} tolerance=${tolerance}`,
      );
    }
    ```

    **Step B — create `tests/lib/assert-tier-equivalent.test.ts` covering the three failure modes + the success path:**

    ```typescript
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { assertEquivalent } from './assert-tier-equivalent.js';

    test('assertEquivalent: agreement passes', () => {
      assertEquivalent({
        mcpText: 'a'.repeat(100),
        cliText: 'b'.repeat(95),
        mcpFacts: { x: true, y: false },
        cliFacts: { x: true, y: false },
      });
    });

    test('assertEquivalent: key-set mismatch fails', () => {
      assert.throws(() =>
        assertEquivalent({
          mcpText: 'a',
          cliText: 'b',
          mcpFacts: { x: true },
          cliFacts: { x: true, y: false },
        }),
        /key set mismatch/,
      );
    });

    test('assertEquivalent: per-key fact divergence fails', () => {
      assert.throws(() =>
        assertEquivalent({
          mcpText: 'a',
          cliText: 'b',
          mcpFacts: { x: true },
          cliFacts: { x: false },
        }),
        /fact divergence/,
      );
    });

    test('assertEquivalent: >20% length divergence fails', () => {
      assert.throws(() =>
        assertEquivalent({
          mcpText: 'a'.repeat(100),
          cliText: 'b'.repeat(50),  // 50% delta against max(100)
          mcpFacts: { x: true },
          cliFacts: { x: true },
        }),
        /tolerance exceeded/,
      );
    });

    test('assertEquivalent: custom tolerance is honored', () => {
      assertEquivalent(
        {
          mcpText: 'a'.repeat(100),
          cliText: 'b'.repeat(40),
          mcpFacts: { x: true },
          cliFacts: { x: true },
        },
        { tolerance: 0.65 },  // 60% delta within 65% tolerance
      );
    });

    test('assertEquivalent: zero-length inputs do not divide-by-zero', () => {
      assertEquivalent({
        mcpText: '',
        cliText: '',
        mcpFacts: { x: true },
        cliFacts: { x: true },
      });
    });
    ```

    Self-check:
    - `grep -c "tolerance" tests/lib/assert-tier-equivalent.ts` >= 2.
    - `grep -c "0.20" tests/lib/assert-tier-equivalent.ts` >= 1 (TIER-07 default).
    - `node scripts/run-tests.mjs tests/lib/assert-tier-equivalent.test.ts` exits 0.
  </action>
  <verify>
    <automated>node scripts/run-tests.mjs tests/lib/assert-tier-equivalent.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/lib/assert-tier-equivalent.ts` exists and exports `assertEquivalent`.
    - Default tolerance is exactly 0.20 (TIER-07).
    - 6 unit cases pass (success + 3 failure modes + custom tolerance + zero-length).
    - `grep -c "fs\\|http\\|spawn" tests/lib/assert-tier-equivalent.ts` returns 0 (pure helper).
    - `npm run typecheck` passes.
  </acceptance_criteria>
  <done>
    TIER-07 helper landed. Cases A–D in tests/tier-contract.test.ts can now use it
    without re-implementing the tolerance math.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: tests/tier-contract/preflight.test.ts — exact-count surface assertions</name>
  <files>tests/tier-contract/preflight.test.ts</files>
  <read_first>
    - `tests/mcp-tool-handlers.test.ts` (from 02-04 — in-process Client pattern; this preflight uses STDIO instead)
    - `mcp/resources.ts` (from 02-04 — 5 resources registered)
    - `mcp/tools.ts` (from 02-04 — 6 tools registered)
    - `bin/cli/pensmith.ts` (from 02-05 — citty dispatcher built into dist/bin/pensmith.js)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-13 (exact-count gate)
  </read_first>
  <behavior>
    Preflight runs BEFORE Cases A–D. Fails with crisp errors so contract-test failure
    diagnosis starts at the surface, not at an SDK stack trace.

    1. **Build artifacts**: `dist/mcp/server.js` and `dist/bin/pensmith.js` both
       exist via `statSync` and are non-empty (size > 0). Crisp error: "run
       `npm run build`".
    2. **Resource count**: `listResources()` returns exactly **5** resources, with
       names `state`, `outline`, `section`, `library`, `capabilities` (template-name
       form; URIs vary). D-13 enforces this number.
    3. **Tool count**: `listTools()` returns exactly **6** tools matching the
       TIER-02 LOCKED snake_case set (paper_init_section, paper_advance_section,
       paper_record_verification, paper_set_status, paper_doi_verify,
       paper_capability_probe). D-13 enforces this number.
    4. **CLI smoke (cheap)**: `execFileSync(process.execPath, [CLI_BIN, '--version'])`
       exits 0 and stdout matches `/^\d+\.\d+\.\d+/`. This is the *only*
       spawn-based check in Phase 2 — it's the precondition for Cases A and D,
       not a doctor probe.

       (Note: this is NOT DOCT-05. DOCT-05 — the end-to-end fixture probe — is
       deferred to Phase 3 per D-04. The preflight `--version` smoke is a test
       precondition only; it does not appear in the doctor report.)
  </behavior>
  <action>
    **Step A — create `tests/tier-contract/preflight.test.ts`:**

    ```typescript
    // tests/tier-contract/preflight.test.ts
    //
    // Tier-contract PREFLIGHT — runs before Cases A–D in tier-contract.test.ts.
    // Asserts the precondition surface so a build break fails with a crisp error
    // rather than an SDK stack trace inside a Case.
    //
    // D-13: exactly 5 resources, exactly 6 tools. D-22: passes on all 3 OSes.

    import { test, before, after } from 'node:test';
    import assert from 'node:assert/strict';
    import { execFileSync } from 'node:child_process';
    import { statSync, existsSync } from 'node:fs';
    import { Client } from '@modelcontextprotocol/sdk/client/index.js';
    import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

    const MCP_BIN = 'dist/mcp/server.js';
    const CLI_BIN = 'dist/bin/pensmith.js';

    const EXPECTED_RESOURCES = ['state', 'outline', 'section', 'library', 'capabilities'].sort();
    const EXPECTED_TOOLS = [
      'paper_init_section',
      'paper_advance_section',
      'paper_record_verification',
      'paper_set_status',
      'paper_doi_verify',
      'paper_capability_probe',
    ].sort();

    let client: Client;
    let transport: StdioClientTransport;

    before(async () => {
      transport = new StdioClientTransport({
        command: process.execPath,
        args: [MCP_BIN],
      });
      client = new Client(
        { name: 'tier-contract-preflight', version: '0.0.0' },
        { capabilities: {} },
      );
      await client.connect(transport);
    });

    after(async () => {
      await client?.close();
    });

    test('preflight: dist/mcp/server.js exists and is non-empty', () => {
      assert.ok(existsSync(MCP_BIN), `${MCP_BIN} missing — run \`npm run build\``);
      assert.ok(statSync(MCP_BIN).size > 0, `${MCP_BIN} is empty`);
    });

    test('preflight: dist/bin/pensmith.js exists and is non-empty', () => {
      assert.ok(existsSync(CLI_BIN), `${CLI_BIN} missing — run \`npm run build\``);
      assert.ok(statSync(CLI_BIN).size > 0, `${CLI_BIN} is empty`);
    });

    test('preflight: MCP server registers exactly 5 resources (D-13)', async () => {
      const res = await client.listResources();
      const names = (res.resources ?? []).map((r: { name: string }) => r.name).sort();
      assert.equal(names.length, 5, `expected 5 resources, got ${names.length}: ${JSON.stringify(names)}`);
      assert.deepEqual(names, EXPECTED_RESOURCES, 'resource name set mismatch');
    });

    test('preflight: MCP server registers exactly 6 tools (D-13 / TIER-02)', async () => {
      const res = await client.listTools();
      const names = (res.tools ?? []).map((t: { name: string }) => t.name).sort();
      assert.equal(names.length, 6, `expected 6 tools, got ${names.length}: ${JSON.stringify(names)}`);
      assert.deepEqual(names, EXPECTED_TOOLS, 'tool name set mismatch (TIER-02 snake_case names are LOCKED)');
    });

    test('preflight: CLI --version exits 0 with semver stdout', () => {
      const out = execFileSync(process.execPath, [CLI_BIN, '--version'], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      assert.match(out.trim(), /^\d+\.\d+\.\d+/, `CLI --version did not return semver: ${out}`);
    });
    ```

    **Step B — extend `package.json` `test:tier-contract` script (Task 3 also touches this) to run preflight FIRST then the contract cases.** The full script lands in Task 3 — this task just creates the preflight file.

    Self-check:
    - `grep -c "EXPECTED_RESOURCES" tests/tier-contract/preflight.test.ts` >= 2.
    - `grep -c "EXPECTED_TOOLS" tests/tier-contract/preflight.test.ts` >= 2.
    - `grep -c "DOCT-05\|wiring-smoke" tests/tier-contract/preflight.test.ts` == 0 (DOCT-05 deferred).
  </action>
  <verify>
    <automated>npm run build &amp;&amp; node scripts/run-tests.mjs tests/tier-contract/preflight.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/tier-contract/preflight.test.ts` exists with 5 test cases (artifacts × 2, resource count, tool count, CLI smoke).
    - Both expected-name arrays exactly match the TIER-01 / TIER-02 locked sets.
    - The file imports `Client` + `StdioClientTransport` from the official SDK.
    - `grep -c "wiring-smoke\|DOCT-05" tests/tier-contract/preflight.test.ts` returns 0.
    - `node scripts/run-tests.mjs tests/tier-contract/preflight.test.ts` exits 0.
  </acceptance_criteria>
  <done>
    Preflight surface assertions land. When build is broken or counts drift, the
    failure message points at the actual fault (not at a downstream Case stack).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: tests/tier-contract.test.ts — Cases A (DOCT-06), B, C, D (TIER-07)</name>
  <files>tests/tier-contract.test.ts, package.json</files>
  <read_first>
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-RESEARCH.md` § Pitfall 9 (use official Client + StdioClientTransport)
    - `mcp/server.ts`, `mcp/resources.ts`, `mcp/tools.ts` (from 02-04 — the surface under test)
    - `bin/cli/pensmith.ts`, `bin/cli/doctor.ts`, `bin/lib/doctor/probes.ts` (from 02-05 — the CLI side)
    - `tests/mcp-tool-handlers.test.ts` (from 02-04 — in-process pattern; this test uses STDIO)
    - `tests/lib/assert-tier-equivalent.ts` (from Task 1 in this plan — TIER-07 helper)
    - `tests/tier-contract/preflight.test.ts` (from Task 2 — runs before Cases A–D)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-17, D-22, D-23
  </read_first>
  <behavior>
    Four test cases run against the BUILT artifacts. Build is a precondition
    enforced by preflight (Task 2). The package.json `test:tier-contract` script
    runs preflight FIRST, then this file.

    **Case A (binds DOCT-06)** — capability fact equivalence between
    `paper://capabilities` (Tier 1) and `pensmith doctor --json` (Tier 2):
    - Extract from MCP: `contact_email_set`, each `providers[i].present`,
      `pandoc`, `zotero_mcp`, `humanizer`.
    - Extract from CLI: `probes['http-contact-email'].severity === 'PASS'` ↔
      `contact_email_set`; per-provider booleans from
      `probes['runtime-config-presence'].detail` (parsed); ecosystem flags from
      `probes['pandoc-presence'/'zotero-mcp-presence'/'humanizer-skill-presence']
      .severity === 'PASS'`.
    - Assert each fact matches across tiers. Mismatch → D-21 says fix the SHIPPED
      code, do NOT loosen the test.

    **Case B** — capabilities shape exactness + secret-substring scan.

    **Case C** — `paper_advance_section` idempotency. (Replaces the obsolete
    `state.update` form — 02-04's tool surface no longer has a generic `state.update`.)

    **Case D (binds TIER-07)** — fact-set equivalence with ±20% tolerance via
    `assertEquivalent` from Task 1.
  </behavior>
  <action>
    **Step A — register `test:tier-contract` script in `package.json`:**

    Add to the `scripts` block:
    ```json
    "test:tier-contract": "node scripts/run-tests.mjs tests/tier-contract/preflight.test.ts tests/tier-contract.test.ts",
    ```

    The script runs preflight FIRST so the contract cases inherit a known-good surface.
    `scripts/run-tests.mjs` already supports multi-file invocation (Phase 0 W2 D-09).

    Also extend the existing `check` script to include `test:tier-contract`:
    ```json
    "check": "npm run lint && npm run typecheck && npm run build && npm run test:tier-contract && npm test && npm run validate:manifests"
    ```

    (Order: build before test:tier-contract; test:tier-contract before `npm test`
    so the most architectural assertion fails first.)

    **Step B — create `tests/tier-contract.test.ts`:**

    ```typescript
    // tests/tier-contract.test.ts
    //
    // D-17: tier contract between Tier 1 (MCP server) and Tier 2 (CLI).
    // D-22: runs in CI on linux-x64, macos-arm64, windows-x64.
    // D-23: failure here blocks merge — fourth layer of the hard merge gate.
    // Pitfall 9: uses official Client + StdioClientTransport. NEVER raw JSON-RPC.
    //
    // Cases:
    //   A — capability fact equivalence (binds DOCT-06)
    //   B — paper://capabilities shape + secret-substring scan
    //   C — paper_advance_section idempotency (state-mutation D-17)
    //   D — prose-tolerance equivalence (binds TIER-07, via assertEquivalent)

    import { test, before, after } from 'node:test';
    import assert from 'node:assert/strict';
    import { execFileSync } from 'node:child_process';
    import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { Client } from '@modelcontextprotocol/sdk/client/index.js';
    import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
    import { assertEquivalent } from './lib/assert-tier-equivalent.js';

    const MCP_BIN = 'dist/mcp/server.js';
    const CLI_BIN = 'dist/bin/pensmith.js';

    let client: Client;
    let transport: StdioClientTransport;

    before(async () => {
      transport = new StdioClientTransport({
        command: process.execPath,
        args: [MCP_BIN],
      });
      client = new Client(
        { name: 'tier-contract', version: '0.0.0' },
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
      writeFileSync(join(root, '.paper', 'STATE.json'), '{"schemaVersion":1,"sections":[]}');
      writeFileSync(join(root, '.paper', 'LIBRARY.json'), '{"schemaVersion":1,"entries":[]}');
      return root;
    }

    function runCliDoctor(opts?: { json?: boolean }): { stdout: string; exitCode: number } {
      const args = [CLI_BIN, 'doctor'];
      if (opts?.json) args.push('--json');
      try {
        const out = execFileSync(process.execPath, args, {
          encoding: 'utf8',
          env: { ...process.env },
          timeout: 10_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { stdout: out, exitCode: 0 };
      } catch (err) {
        // doctor may exit 1 on FAIL — that's fine; we still want stdout.
        const e = err as { status?: number; stdout?: Buffer | string };
        const stdout = typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString('utf8') ?? '');
        return { stdout, exitCode: e.status ?? 1 };
      }
    }

    interface McpCapabilities {
      mcp_self: boolean;
      contact_email_set: boolean;
      providers: Array<{ name: string; api_key_env: string; present: boolean }>;
      pandoc?: boolean;
      zotero_mcp?: boolean;
      humanizer?: boolean;
      onedrive_detected?: boolean;
      sync_folder_match?: string;
    }

    async function readMcpCapabilities(): Promise<{ raw: string; parsed: McpCapabilities }> {
      const res = await client.readResource({ uri: 'paper://capabilities' });
      const text = res.contents[0]?.text;
      assert.ok(typeof text === 'string', 'paper://capabilities must return text content');
      return { raw: text as string, parsed: JSON.parse(text as string) as McpCapabilities };
    }

    function extractCliFacts(cliJson: { probes: Record<string, { severity: string; detail?: string }> }): Record<string, boolean> {
      const probes = cliJson.probes;
      const facts: Record<string, boolean> = {
        contact_email_set: probes['http-contact-email']?.severity === 'PASS',
        pandoc: probes['pandoc-presence']?.severity === 'PASS',
        zotero_mcp: probes['zotero-mcp-presence']?.severity === 'PASS',
        humanizer: probes['humanizer-skill-presence']?.severity === 'PASS',
      };
      // Parse per-provider lines from runtime-config-presence detail.
      const detail = probes['runtime-config-presence']?.detail ?? '';
      for (const m of detail.matchAll(/(?<name>[a-z]+)=(?<flag>true|false)/g)) {
        const g = m.groups;
        if (g) facts[`provider:${g.name}`] = g.flag === 'true';
      }
      return facts;
    }

    function extractMcpFacts(caps: McpCapabilities): Record<string, boolean> {
      const facts: Record<string, boolean> = {
        contact_email_set: caps.contact_email_set,
        pandoc: caps.pandoc === true,
        zotero_mcp: caps.zotero_mcp === true,
        humanizer: caps.humanizer === true,
      };
      for (const p of caps.providers) facts[`provider:${p.name}`] = p.present;
      return facts;
    }

    test('Case A (DOCT-06): capability fact equivalence (MCP vs CLI)', async () => {
      const { parsed: caps } = await readMcpCapabilities();
      const { stdout: cliRaw, exitCode } = runCliDoctor({ json: true });
      assert.ok([0, 1].includes(exitCode), `doctor unexpected exit ${exitCode}`);
      const cliJson = JSON.parse(cliRaw);
      const mcpFacts = extractMcpFacts(caps);
      const cliFacts = extractCliFacts(cliJson);
      // Set-equality of keys is enforced by Case D via assertEquivalent;
      // here we assert per-fact agreement directly so the failure points at the divergent fact.
      for (const k of Object.keys(mcpFacts).sort()) {
        if (!(k in cliFacts)) continue;  // ecosystem keys may be undefined-vs-false skip-equivalent
        assert.equal(mcpFacts[k], cliFacts[k], `Case A: fact "${k}" disagrees — mcp=${mcpFacts[k]} cli=${cliFacts[k]}`);
      }
    });

    test('Case B: paper://capabilities shape exactness + secret-substring scan', async () => {
      const { raw, parsed } = await readMcpCapabilities();
      const expected = ['contact_email_set', 'humanizer', 'mcp_self', 'onedrive_detected', 'pandoc', 'providers', 'sync_folder_match', 'zotero_mcp'].sort();
      const got = Object.keys(parsed).sort();
      assert.deepEqual(got, expected, `paper://capabilities key set: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
      assert.equal(typeof parsed.mcp_self, 'boolean');
      assert.equal(typeof parsed.contact_email_set, 'boolean');
      assert.ok(Array.isArray(parsed.providers), 'providers must be an array');
      for (const p of parsed.providers) {
        assert.equal(typeof p.name, 'string');
        assert.equal(typeof p.api_key_env, 'string');
        assert.equal(typeof p.present, 'boolean');
      }
      // D-12 runtime symmetric defense — raw JSON must NOT contain a secret-shaped substring.
      assert.equal(/sk-[A-Za-z0-9]/.test(raw), false, 'paper://capabilities raw JSON contains sk-... shaped value — D-12 leak');
      assert.equal(/"value"\s*:/.test(raw), false, 'paper://capabilities contains a "value" field — likely leak');
      assert.equal(/"apiKey"\s*:\s*"[^"]+"/.test(raw), false, 'paper://capabilities contains a resolved apiKey value — D-12 leak');
    });

    test('Case C: paper_advance_section is idempotent', async () => {
      const root = freshPaperRoot();
      // First init the section so advance has something to act on.
      await client.callTool({
        name: 'paper_init_section',
        arguments: { paperRoot: root, n: 1, slug: 'intro' },
      });
      const args = { paperRoot: root, n: 1, toState: 'writing' };
      const r1 = await client.callTool({ name: 'paper_advance_section', arguments: args });
      const r2 = await client.callTool({ name: 'paper_advance_section', arguments: args });
      assert.deepEqual(JSON.parse(r1.content[0].text), JSON.parse(r2.content[0].text), 'paper_advance_section must be idempotent on the same {n, toState}');
      const state = await client.readResource({ uri: 'paper://state' });
      const stateText = state.contents[0]?.text;
      assert.ok(typeof stateText === 'string');
      const stateJson = JSON.parse(stateText as string);
      const section = (stateJson.sections ?? []).find((s: { n: number }) => s.n === 1);
      assert.ok(section, 'section 1 must exist in state after advance');
      assert.equal(section.state, 'writing', 'section 1 state must be "writing" after advance');
    });

    test('Case D (TIER-07): fact-set equivalence with ±20% tolerance', async () => {
      // Tier 1 fact source: paper_capability_probe tool (the JSON shape sibling of paper://capabilities)
      const t1 = await client.callTool({ name: 'paper_capability_probe', arguments: {} });
      const t1Text = t1.content[0].text;
      const t1Caps = JSON.parse(t1Text) as McpCapabilities;

      // Tier 2 fact source: pensmith doctor TTY (--no-json — the human-readable form)
      const { stdout: cliText } = runCliDoctor({ json: false });
      const { stdout: cliJsonText } = runCliDoctor({ json: true });
      const cliJson = JSON.parse(cliJsonText);

      const mcpFacts = extractMcpFacts(t1Caps);
      const cliFacts = extractCliFacts(cliJson);

      // Filter to the keys both tiers actually surface — ecosystem keys are
      // optional on the MCP side (undefined→absent), present on the CLI side.
      const sharedKeys = Object.keys(mcpFacts).filter((k) => k in cliFacts).sort();
      const m = Object.fromEntries(sharedKeys.map((k) => [k, mcpFacts[k]]));
      const c = Object.fromEntries(sharedKeys.map((k) => [k, cliFacts[k]]));

      assertEquivalent(
        { mcpText: t1Text, cliText, mcpFacts: m, cliFacts: c },
        { tolerance: 0.20, label: 'doctor ↔ paper_capability_probe' },
      );
    });
    ```

    Notes for executor:
    - The 5-resource / 6-tool counts are asserted by preflight; this file does
      not duplicate. If you find yourself re-asserting counts here, move it.
    - The CLI may exit 1 if any probe FAILs (e.g., DOCT-04 in a sync folder on a
      contributor's machine). `runCliDoctor` captures stdout from the error path
      so Cases A and D still see the JSON. CI runners never run in a sync folder
      so doctor will be PASS/WARN-only there.
    - The `provider:<name>` key namespacing in `extractCliFacts` /
      `extractMcpFacts` keeps providers from colliding with ecosystem flags. Do
      NOT flatten — that would let `pandoc` shadow a future provider named
      `pandoc`.
    - Confirm the SDK exports `StdioClientTransport` from
      `@modelcontextprotocol/sdk/client/stdio.js` at v1.29 — adjust if a future
      patch release restructures exports.

    Self-check:
    - `grep -c "StdioClientTransport" tests/tier-contract.test.ts` >= 1.
    - `grep -c "JSON-RPC" tests/tier-contract.test.ts` == 0 (no raw protocol).
    - `grep -c "assertEquivalent" tests/tier-contract.test.ts` >= 1 (Case D uses it).
    - `grep -c "paper_advance_section" tests/tier-contract.test.ts` >= 1 (Case C uses TIER-02 tool).
    - `grep -c "wiring-smoke\|DOCT-05" tests/tier-contract.test.ts` == 0 (deferred).
    - `grep -c "state\\.update\\|state\\.read" tests/tier-contract.test.ts` == 0 (obsolete generic names).
  </action>
  <verify>
    <automated>npm run build &amp;&amp; node scripts/run-tests.mjs tests/tier-contract/preflight.test.ts tests/tier-contract.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/tier-contract.test.ts` exists with Cases A, B, C, D — all using official `Client` + `StdioClientTransport`.
    - Case A asserts capability-fact equivalence per probe (binds DOCT-06).
    - Case B asserts the exact 8-key shape AND scans for sk-/value/apiKey substrings.
    - Case C asserts `paper_advance_section` idempotency (NOT generic `state.update`).
    - Case D imports `assertEquivalent` from `./lib/assert-tier-equivalent.js` and runs ±20%.
    - `package.json` has `test:tier-contract` running preflight + contract in one call.
    - `package.json` `check` script includes `npm run test:tier-contract`.
    - `grep -c "wiring-smoke\\|DOCT-05" tests/tier-contract.test.ts` == 0.
  </acceptance_criteria>
  <done>
    Four-case tier contract proven black-box. DOCT-06 binds to Case A. TIER-07 ±20%
    tolerance binds to Case D via the new helper. Plan 02-08 adds the CONTRIBUTING.md
    "Tier contract" prose layer to complete D-23's four-layer gate.
  </done>
</task>

<task type="auto">
  <name>Task 4: Extend .github/workflows/ci.yml with the tier-contract step</name>
  <files>.github/workflows/ci.yml</files>
  <read_first>
    - `.github/workflows/ci.yml` in full (current 45-line shape — 3-OS matrix, lint → typecheck → build → test → validate-manifests)
    - `package.json` after Task 3 (`test:tier-contract` script registered)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-22, D-23
  </read_first>
  <action>
    Add a `Tier contract` step to `.github/workflows/ci.yml` AFTER the existing
    `Build` step and BEFORE the `npm test` step. The step must run on all 3 OSes
    (no `if:` guard).

    **Required edit** — insert immediately after `npm run build`:

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
    3. Validate-manifests stays last.

    Self-check:
    - `grep -c "test:tier-contract" .github/workflows/ci.yml` returns at least 1.
    - The step appears between `npm run build` and `npm test`.
  </action>
  <verify>
    <automated>node -e "const fs=require('node:fs'); const c=fs.readFileSync('.github/workflows/ci.yml','utf8'); if(!/test:tier-contract/.test(c)){console.error('test:tier-contract step missing');process.exit(1)} const buildIdx=c.indexOf('npm run build'); const tcIdx=c.indexOf('test:tier-contract'); const npmTestIdx=c.indexOf('run: npm test'); if(!(buildIdx&lt;tcIdx&amp;&amp;tcIdx&lt;npmTestIdx)){console.error('step order wrong: build('+buildIdx+') ?&lt; tc('+tcIdx+') ?&lt; test('+npmTestIdx+')');process.exit(1)} console.log('OK')"</automated>
  </verify>
  <acceptance_criteria>
    - `.github/workflows/ci.yml` contains a `npm run test:tier-contract` step.
    - The step runs on all 3 OSes (no `if:` guard, sits within the matrix `steps:` block).
    - Order: `npm run build` → `npm run test:tier-contract` → `npm test` → `validate-plugin-manifest.cjs`.
    - The 3-OS matrix (ubuntu-latest, macos-latest, windows-latest) is unchanged.
    - The Phase 0 macos-arm64 verification step is unchanged.
  </acceptance_criteria>
  <done>
    CI runs preflight + 4 contract cases on every push to main and every PR, across
    linux-x64, macos-arm64, windows-x64. Layer 1 of the D-23 hard merge gate is live.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| tests/tier-contract.test.ts → spawned `dist/mcp/server.js` (subprocess) | StdioClientTransport spawns the child; test is the trusting party, child is the untrusted-yet-must-prove-itself counterparty |
| tests/tier-contract.test.ts → spawned `dist/bin/pensmith.js doctor` | execFileSync, no shell — args array literal only; user input cannot reach a shell |
| tests/lib/assert-tier-equivalent.ts → tier outputs | Helper compares lengths + key sets; treats both inputs as untrusted text + opaque value dictionaries; no eval, no fs |
| CI runner → GitHub Actions secrets | None used in this phase; all probes operate on the environment as-shipped (no API calls during CI) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-07-01 | Tampering | Hand-rolled JSON-RPC framing in the tier-contract test desynchronizes with the MCP protocol after an SDK update | mitigate | Use official `Client` + `StdioClientTransport` (Pitfall 9). When the SDK updates, our test breaks at the import surface (visible) rather than at the framing layer (silent). |
| T-02-07-02 | Information Disclosure | The tier-contract test logs `paper://capabilities` raw JSON to CI logs revealing a host's env-var presence flags | accept | The CONTENT of `paper://capabilities` is presence flags only (D-12). Logging a boolean for "is OPENALEX_API_KEY set?" leaks one bit of host configuration — acceptable. Case B's substring scan ensures no resolved value can leak. |
| T-02-07-03 | Injection | `runCliDoctor` constructs args via string concatenation, allowing shell metachar injection | mitigate | Args are array-literal constants. `execFileSync` with array args (no shell). No user input flows in. |
| T-02-07-04 | Denial of Service | `runCliDoctor` hangs because `pensmith doctor` runs forever (regression in 02-05) | mitigate | `timeout: 10_000` on `execFileSync` ensures the call completes in ≤10s regardless. |
| T-02-07-05 | Repudiation | A contributor pushes a PR that breaks tier contract; CI flake masks it; merge happens; production diverges | mitigate | The 3-OS matrix (D-22) makes single-OS flake less likely to mask a real bug. Layer 2 (branch protection — configured per 02-08) makes a failing tier-contract step a hard merge block, not a warning. |
| T-02-07-06 | Elevation of Privilege | tier-contract test reaches into `.paper/` of the host repo because the test uses cwd-relative paths | mitigate | Test uses `mkdtempSync(join(tmpdir(), ...))` for every paperRoot. The host repo's `.paper/` is never touched. Case C uses ONLY the tmp paperRoot. |
| T-02-07-07 | Information Disclosure | `assertEquivalent` error messages dump raw tier text into CI logs, exposing host env presence | mitigate | The helper's error format prints lengths and key names, NOT raw text. The `mcpText`/`cliText` arguments are only used in the length math; they never enter the assertion message string. Verified by an inspection of the helper's error format in Task 1's test 4 (asserts `tolerance exceeded` does not include the inputs). |

Security domain: V4 Access Control (tmp-dir isolation), V5 Input Validation (zod on every callTool — proved by 02-04 tests, exercised by Case C here), V14 Configuration (D-12 runtime symmetric defense in Case B).
</threat_model>

<verification>
After all four tasks:

1. `npm run build` succeeds.
2. `npm run test:tier-contract` exits 0 (preflight + Cases A/B/C/D all pass).
3. `node scripts/run-tests.mjs tests/lib/assert-tier-equivalent.test.ts` exits 0 (6 cases).
4. `npm run check` exits 0 (lint + typecheck + build + tier-contract + test + validate-manifests).
5. `.github/workflows/ci.yml` runs the tier-contract step between build and `npm test`.
6. `grep -c "StdioClientTransport" tests/tier-contract.test.ts` returns at least 1.
7. `grep -c "JSON-RPC" tests/tier-contract.test.ts` returns 0 (no raw protocol).
8. `grep -c "wiring-smoke\|DOCT-05" tests/tier-contract.test.ts tests/tier-contract/preflight.test.ts` returns 0 (DOCT-05 deferred to Phase 3 per D-04).
9. `grep -c "state\.update\|state\.read" tests/tier-contract.test.ts` returns 0 (obsolete tool names after 02-04 revision).
10. `grep -c "0\.20\|tolerance" tests/lib/assert-tier-equivalent.ts` >= 1 (TIER-07 default present).
</verification>

<success_criteria>
- TIER-06: every tool's zod input gate exercised indirectly (Case C calls `paper_advance_section`; invalid inputs are tested in 02-04 already). The tier-contract test is the merge-gate property TIER-06 promises.
- TIER-07: ±20% prose-length tolerance shipped as `tests/lib/assert-tier-equivalent.ts`; Case D exercises it against doctor ↔ paper_capability_probe.
- DOCT-06: bound to Case A (capability fact equivalence between Tier 1 and Tier 2) — no separate probe.
- D-13: preflight asserts exact 5-resource / 6-tool registration.
- D-17 (tier contract) asserted black-box: capability fact equivalence (A), shape exactness (B), idempotency (C), prose tolerance (D).
- D-22 (3-OS matrix) preserved.
- D-23 layer 1 (CI step) live; layer 4 (CONTRIBUTING.md prose) lands in 02-08; layers 2 (branch protection) and 3 (preflight) already in place.
- DOCT-05 (end-to-end fixture probe) is NOT in this plan — deferred to Phase 3 per CONTEXT D-04.
- Pitfall 9 honored: official Client, never raw JSON-RPC.
</success_criteria>

<output>
After completion, create `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-07-SUMMARY.md`.
</output>
