# Phase 2: Tier shells + doctor + tier-contract gate — Research

**Researched:** 2026-05-14
**Domain:** MCP server (TypeScript SDK v1.x), citty-based CLI dispatcher, environment-probe doctor, AST-walk chokepoint tests, two-tier workflow body delegation
**Confidence:** HIGH (all libraries and APIs verified against pinned versions on npm registry + GitHub source at the v1.29.0 tag)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01..D-24)

**Area 1 — Phase-1 carry-forwards triage**

- **D-01** parseRetryAfter split — extract `parseRetryAfter()` from http.ts into bin/lib/retry.ts as a pure helper in Phase 2 Wave 0 (no behavior change; pure refactor). Test coverage moves with it.
- **D-02** Plan 02-00-review-cleanup is the FIRST plan in Phase 2 (Wave 0) — it lands the parseRetryAfter split + clears Plan 01-13 SUMMARY.md backlog + clears any remaining Phase-1 review nits. Every later plan depends on it.
- **D-03** DOCT-05 (wiring smoke) executes a single `pensmith --version` invocation against the built binary and asserts exit-0; this is the doctor-side smoke. Detailed end-to-end wiring is a Phase 3 follow-up.
- **D-04** Phase 3 OWNS the cross-tier wiring smoke — the tier-contract gate (this phase) only proves shape-equivalence of probe Records.

**Area 2 — Exit criteria & Definition of Done**

- **D-05** Phase 2 Definition of Done = (a) `tests/tier-contract.test.ts` green on all 3 OSes (linux-x64, macos-arm64, windows-x64), (b) plugin manifest validator green, (c) `pensmith doctor` invocation under Tier 2 produces a Record keyed by probe.id with PASS/WARN/FAIL/SKIP for every probe in `DOCTOR_PROBE_IDS`, (d) MCP server boots under stdio transport and registers all 4 paper://* resources + tools.
- **D-06** No requirement for any verb other than `doctor` to be functionally implemented this phase — 16 of the 17 verbs are stub-only with exit-0 and a "Not implemented yet" message (status FOLLOWS_DESIGN, not FAILED). Doctor is the proof of architecture.

**Area 3 — MCP server surface**

- **D-07** MCP server registers exactly 4 resources: `paper://state`, `paper://library`, `paper://outline`, `paper://capabilities`. Plus 4 tools (state.read, state.update, library.read, checkpoint.append) and ZERO prompts. ResourceTemplate is NOT used for these 4 (all are static URIs); Phase 3 may add `paper://section/{N}` via ResourceTemplate.
- **D-08** Tool handlers in mcp/server.ts are thin shims — each is ≤30 lines (target ≤20), parses input via zod, calls a single bin/lib/* function, and returns the result. Business logic lives in bin/lib/*; no I/O happens inline in mcp/server.ts.
- **D-09** Thin-shim invariant is LINT-ENFORCED via `tests/lint-thin-shim.test.ts` — AST-walks mcp/server.ts using @typescript-eslint/parser and asserts every tool/resource handler body has ≤30 statements AND zero direct fs/http imports (re-uses the no-restricted-imports allowlist).

**Area 4 — MCP auth/trust boundary**

- **D-10** stdio-only transport is LOCKED BY LINT — `tests/lint-mcp-no-network.test.ts` AST-walks `mcp/**/*.ts` for any `net.createServer` / `http.createServer` / `tls.createServer` / `new Server()` call and fails. No HTTP/SSE transport ever ships.
- **D-11** `tests/tier-contract.test.ts` SPAWNS `dist/mcp/server.js` as a real child process over stdio, sends an MCP initialize handshake + listResources + listTools, and asserts the response shape. NOT a fake/mock. This is why Phase 2 needs `npm run build` to land before the tier-contract step runs in CI.
- **D-12** `paper://capabilities` returns PRESENCE FLAGS ONLY — booleans, enums, and env-var-NAME strings (e.g., `"ANTHROPIC_API_KEY"`). NEVER resolved API key values, NEVER `process.env[key]`. Lint-enforced by `tests/lint-capabilities-noleak.test.ts` AST-walking the handler for any MemberExpression accessing `process.env[*]` with a computed key, or any reference to `getProviderApiKey` / `getOpenAlexApiKey` inside the handler. T-01-07 (Phase 1) symmetric defense.
- **D-13** MCP server reads runtime config via `loadRuntimeConfig()` ONCE at startup, caches the result in module scope, and re-reads only when explicitly invoked through a future `runtime.reload` tool (out of scope for Phase 2). No file-watch.

**Area 5 — Tier-2 CLI dispatch**

- **D-14** citty is the locked dispatcher — `defineCommand({ subCommands: { ... } })` with one subCommand per verb. 17 verbs total: doctor, init, intake, research, outline, plan, write, verify, compile, status, resume, version, library, fetch, dryrun, undo, help. Only `doctor` and `version` have real implementations this phase.
- **D-15** Doctor severity model: PASS / WARN / FAIL / SKIP. Exit code = 0 unless any probe is FAIL. WARN does not block. SKIP applies when a probe is N/A on this OS (e.g., LOCALAPPDATA on Linux).

**Area 6 — Doctor output**

- **D-16** Doctor probes return `{ id, severity, summary, detail?, fix? }`. Tier 1 collects these into a Record keyed by probe.id; Tier 2 does the same. Both tiers MUST produce identical Records for identical environments — that's what tier-contract.test.ts proves.
- **D-17** Probe list (DOCT-01..06): node-version, mcp-sdk-presence, http-contact-email, sync-folder-detection, wiring-smoke (DOCT-05), runtime-config-presence. Ordering is DOCUMENTED but execution order is unspecified — the Record keyed by probe.id kills the order question (D-20).
- **D-18** Doctor text output (Tier 2) follows the locked copy in `references/doctor-output.md` (placeholder — must be written this phase). Tier 1 surfaces the same Record through `paper://capabilities` or a future MCP tool; copy is shared via a single source.
- **D-19** Doctor MUST NOT mutate any disk state. It is pure read-only.
- **D-20** Probes return a flat Record keyed by probe.id (not an Array). Tier 1 may probe in parallel via Promise.all; Tier 2 runs sequentially. Either way the resulting Record key set is identical and the values match shape — that's the contract.

**Area 7 — Tier-contract test scaffolding**

- **D-21** Normalizer discipline rule: if Tier 1 and Tier 2 disagree on probe output, the default fix is to MAKE THE TIERS AGREE (change one or both implementations), NOT to add a normalizer rule that papers over the divergence. Normalizers are an escape hatch reserved for environment-derived noise (e.g., OS-specific paths in `detail`) — never for severity, id, or summary.
- **D-22** Four-layer hard merge gate: (1) CI step `npm run test:tier-contract` runs on all 3 OSes in the matrix, (2) GitHub branch protection requires this check to pass before merge, (3) a Phase 2 preflight test asserts every verb declared in `workflows/*.md` has a corresponding case in the Tier 2 dispatcher, (4) LOCKED CONTRIBUTING.md prose documents the gate and forbids skipping it.
- **D-23** test:tier-contract npm script is added to package.json and wired into CI BEFORE the tier-contract.test.ts file is written — so the first commit that adds the test file also wires CI in the same change.
- **D-24** CONTRIBUTING.md gate prose lives in a section called "Tier contract — do not skip" and is asserted present by `tests/repo-files.test.ts` extension.

### Claude's Discretion

- Exact format of `references/doctor-output.md` (just lock the schema and let the planner draft the copy)
- Internal helper structure inside bin/cli/doctor.ts (single file vs. one helper per probe — recommend single file ~150 LOC)
- Whether to use `runMain(main)` from citty directly or wrap it for typed exit-code handling — Phase 2 picks one and locks it
- Logging adapter inside MCP server (use bin/lib/session-log.ts directly vs. a thin wrapper for MCP-specific structured logs)

### Deferred Ideas (OUT OF SCOPE)

- SSE/HTTP MCP transport — locked out by D-10
- ResourceTemplate-based dynamic resources (e.g., `paper://section/{N}`) — Phase 3+
- 16 of 17 verbs functionally implemented — Phase 3+
- `pensmith resume` and `pensmith undo` semantics — Phase 5+
- Cross-tier wiring smoke beyond `--version` — Phase 3
- `runtime.reload` tool / file-watch on runtime.json — TBD
- Doctor probes for plagiarism/style/humanizer dependencies — Phase 6+
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ARCH-01 | Two-tier source-of-truth: workflow bodies + templates shared between Tier 1 plugin and Tier 2 CLI | Topic 6 (`<capability_check>` workflow body pattern) — gsd-plugin reference shows the canonical body+capability_check shape we adopt |
| ARCH-03 | `<capability_check>` block degrades gracefully when Task/MCP/AskUserQuestion are unavailable | Topic 6 — the workflow body is shared markdown; capability_check resolves at workflow runtime, not at install time |
| ARCH-18 | MCP server thin-shim: tool handlers ≤30 lines, business logic in bin/lib/* | Topic 1 + Topic 5 — registerTool's inputSchema + async handler signature naturally compose with bin/lib delegation; AST-walk lint-test pattern proven in Phase 0/1 |
| TIER-01 | Tier 2 CLI dispatches all 17 verbs declared in workflows/ | Topic 2 — citty's defineCommand({subCommands}) with one entry per verb; preflight test asserts mapping |
| TIER-02 | All verbs except doctor are stub-only this phase, exit 0 + "Not implemented yet" message | Topic 2 — citty's `run()` callback can be a single `console.log + return` for stubs |
| TIER-03 | Tier 2 doctor exits non-zero on FAIL, zero on PASS/WARN/SKIP | Topic 3 — D-15 severity model; citty supports process.exit via run callback throwing or returning |
| TIER-04 | Doctor probes return `{id, severity, summary, detail?, fix?}` Record keyed by probe.id | Topic 3 — shape is internal to pensmith; Record type is just `Record<string, ProbeResult>` |
| TIER-05 | MCP server boots over stdio, registers paper://state, paper://library, paper://outline, paper://capabilities | Topic 1 — McpServer + StdioServerTransport from v1.29; server.registerResource with static URI strings (no ResourceTemplate) |
| TIER-06 | MCP tool handlers parse zod input schemas and delegate to bin/lib/* in ≤30 lines | Topic 1 + Topic 5 — server.registerTool accepts `inputSchema: { field: z.string() }` object form |
| TIER-07 | Plugin shell ships .claude-plugin/plugin.json + .mcp.json + hook scaffolding (SessionStart, PreCompact, PostToolUse) — hooks are no-ops this phase | Topic 4 — gsd-plugin patterns already studied; pensmith plugin.json + .mcp.json already exist from Phase 0 |
| DOCT-01 | node-version probe: assert >=20.10.0 | Topic 3 — `process.versions.node` semver compare; no external lib |
| DOCT-02 | mcp-sdk-presence probe: dist/mcp/server.js exists and is non-empty | Topic 3 — `fs.stat(absolutePath).size > 0`; absolutePath via existing paths.ts helper or `import.meta.url` |
| DOCT-03 | http-contact-email probe: surfaces same WARN as bin/lib/http.ts when PENSMITH_CONTACT_EMAIL is unset | Topic 3 — WARN copy locked in `references/http-warnings.md`; reuse that exact string |
| DOCT-04 | sync-folder-detection probe: WARNs when paperDir() resolves inside OneDrive/iCloud/Dropbox/Google Drive | Topic 3 — `isInsideSyncFolder()` already implemented in bin/lib/paths.ts; just call + format |
| DOCT-05 | wiring-smoke probe: `pensmith --version` returns 0 (PASS) or non-zero (FAIL) | Topic 3 — execFileSync on dist/bin/pensmith.js (the built CLI entry) with `--version` arg |
| DOCT-06 | runtime-config-presence probe: WARN if no provider has a resolvable API key (env-var NAME present but no value) | Topic 3 — `loadRuntimeConfig()` + iterate providers + check `process.env[apiKeyEnv] !== undefined` (presence flag only, never persist the value) |
</phase_requirements>

## Summary

Phase 2 lands the two architectural shells (MCP server + Node CLI dispatcher) and the doctor probe that proves they're compatibility-equivalent. The dependencies are already pinned in package.json: `@modelcontextprotocol/sdk@^1.29` (current is 1.29.0, no upgrade needed), `zod@^3.23` (pin holds — the v1.x SDK API uses zod 3 schemas directly), `proper-lockfile`, `undici`, `p-retry`, `@clack/prompts@^0.7` (stale — current is 1.4.0; recommend planner consider bump but Phase 1 already uses 0.7 patterns so a Phase 2 bump is optional). One new dependency: **`citty@0.2.2`** (locked by D-14) — not yet installed; planner must add it to dependencies in the Wave 0 plan. No new devDependency is needed for the three new AST-walk lint tests because `typescript-eslint@^8` (already a devDependency, exposes `@typescript-eslint/parser`) supplies the parser used by the existing `tests/lint-*-chokepoint.test.ts` family.

The four guardrails that distinguish this phase from "ship two shells and call it a day" are: (1) `paper://capabilities` is presence-flags-only and lint-enforced (D-12, symmetric to T-01-07 from Phase 1 — api-key VALUES never leave bin/lib/runtime.ts), (2) MCP stdio-only is lint-enforced (D-10 — no SSE/HTTP transport can ever silently slip in), (3) MCP thin-shim invariant is lint-enforced (D-09 — handlers cannot accumulate inline business logic), (4) the tier-contract test spawns the real built mcp/server.js as a child process and runs an actual MCP handshake against it (D-11 — not a mock). The 4-layer hard merge gate (CI step + branch protection + preflight verb-mapping assertion + CONTRIBUTING.md prose) puts the contract under permanent enforcement.

**Primary recommendation:** Wave 0 = parseRetryAfter split + add citty + draft references/doctor-output.md. Wave 1 = three new AST-walk lint tests + their red-team fixtures (chokepoint lands BEFORE the modules they protect — Phase 0/1 Pitfall 7 pattern). Wave 2 = mcp/server.ts implementation + bin/cli/pensmith.ts dispatcher + bin/cli/doctor.ts. Wave 3 = tests/tier-contract.test.ts + npm script + CI step (D-22/23 same commit). Wave 4 = CONTRIBUTING.md prose + repo-files.test.ts extension. The tier-contract test depends on `npm run build` producing dist/mcp/server.js, so CI step order is `build → test:tier-contract → test` (same as Phase 0 Pitfall D).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| MCP tool/resource routing | **MCP server (Tier 1 inner)** | — | Lives in mcp/server.ts as a thin shim; only Claude Code's plugin runtime invokes it [VERIFIED: D-07/D-08/D-09] |
| CLI verb dispatch | **Tier 2 CLI** | — | citty in bin/cli/pensmith.ts — sole entry for terminal usage [VERIFIED: D-14] |
| Doctor probes (the actual checks) | **bin/lib (Tier 0)** | — | Probes are pure functions in `bin/lib/doctor/*.ts` or `bin/cli/doctor.ts`; called identically by Tier 1 (via MCP tool) and Tier 2 (via CLI subcommand) so the tier-contract test can compare outputs [VERIFIED: D-16/D-20] |
| State mutation through MCP | **bin/lib/state.ts** | MCP server (thin shim) | Tool handler is ≤30 lines, delegates to state.updateState() [VERIFIED: D-08, Phase 1 W10] |
| Capabilities advertisement | **bin/lib/runtime.ts** (presence flags) | MCP server (read-only handler) | Handler MUST NOT call process.env[key] with computed key; lint-enforced [VERIFIED: D-12] |
| Workflow body delegation (Tier 1↔Tier 2 shared) | **workflows/*.md** + `<capability_check>` | both tiers consume the same markdown | gsd-plugin pattern — markdown body is single source, capability_check resolves at execution [CITED: github.com/jnuyens/gsd-plugin pattern study; ARCH-01/ARCH-03] |
| Plugin lifecycle hooks (SessionStart, PreCompact, PostToolUse) | **hooks/*.ts (Tier 1)** | — | Phase 2 ships scaffolding only — all hooks are no-op exit-0 [VERIFIED: D-06] |

## Standard Stack

### Core

| Library | Pinned Version | Current (verified 2026-05-14) | Purpose | Why Standard |
|---------|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | `^1.29` | 1.29.0 | MCP server (McpServer + StdioServerTransport) | Official Anthropic SDK; v2 is pre-alpha and not production-ready [VERIFIED: npm view @modelcontextprotocol/sdk version → 1.29.0] [VERIFIED: github.com/modelcontextprotocol/typescript-sdk/tags shows v2 as `2.0.0-alpha.2`] |
| `citty` | NOT YET INSTALLED — pin `^0.2.2` | 0.2.2 | CLI dispatcher (`defineCommand`/`runMain`) | UnJS-maintained; minimal API; declarative subCommands; native TypeScript [VERIFIED: npm view citty version → 0.2.2] [CITED: github.com/unjs/citty README] |
| `zod` | `^3.23` | 4.4.3 | Input/output schema validation for MCP tools | v1.x SDK API uses zod 3-shaped schemas in `registerTool` inputSchema; DO NOT upgrade to zod 4 in Phase 2 — Phase 1 schemas use zod 3 [VERIFIED: package.json pin; v1.29 SDK examples use `z.string()` from zod 3 imports] |
| `@typescript-eslint/parser` | (transitive of `typescript-eslint@^8`) | 8.59.3 | AST parsing for the three new chokepoint lint tests | Already used by tests/lint-chokepoint.test.ts, tests/lint-paths-chokepoint.test.ts, tests/lint-atomic-write-chokepoint.test.ts — same pattern extends to thin-shim / no-network / capabilities-noleak [VERIFIED: tests/lint-*-chokepoint.test.ts source] |

### Supporting

| Library | Pinned | Purpose | When to Use |
|---------|--------|---------|-------------|
| `@clack/prompts` | `^0.7` (stale; current 1.4.0) | TTY interactive prompts | Doctor output IS allowed to use `intro`/`outro`/`note` for human-readable rendering, but MUST also produce machine-readable JSON via `--json` flag for the tier-contract test to compare. Pin bump optional this phase. [VERIFIED: npm view @clack/prompts version → 1.4.0] |
| `proper-lockfile` | `^4` | (not used in Phase 2 directly) | bin/lib/lock.ts already wraps it; doctor MUST NOT acquire any lock (D-19 read-only) |
| `undici` | `^7` | (not used in Phase 2 directly) | bin/lib/http.ts only; doctor probes MUST NOT make HTTP requests (DOCT-03 reads env var, doesn't probe network) |
| `p-retry` | `^6` | (not used in Phase 2 directly) | Phase 1 W5; wiring smoke uses execFileSync, no retry needed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| citty | commander, yargs, sade | citty is smaller (~20KB), declarative subCommands, native TS; commander has more features but heavier; sade is minimalist but less typed; D-14 locks citty |
| MCP SDK v1.29 (v1.x line) | v2.0.0-alpha.2 (split into `@modelcontextprotocol/server` + `/client`) | v2 is pre-alpha as of 2026-05; pensmith's Phase 0 plugin.json + .mcp.json already pin v1 [VERIFIED: github.com/modelcontextprotocol/typescript-sdk/tags] |
| ResourceTemplate for `paper://state` etc. | Static URI strings via server.registerResource(name, "paper://state", ...) | All 4 Phase 2 resources are static singletons; ResourceTemplate is for variable URIs like `paper://section/{N}` (Phase 3+) |
| `@clack/prompts` for doctor TTY | Plain console.log + chalk | clack is already a dep and gives consistent intro/outro framing across all future verbs; recommend keeping it |

**Installation:**

```bash
npm install citty@^0.2.2
```

(All other deps already pinned. Optional but recommended: `npm install @clack/prompts@^1.4` to refresh to current. Do NOT bump zod 3 → 4 this phase.)

**Version verification:** Re-run `npm view <pkg> version` immediately before the Wave 0 plan executes — npm registry is the source of truth for "current" and may have advanced since 2026-05-14.

## Architecture Patterns

### System Architecture Diagram

```
                       ┌──────────────────────────────────────────┐
                       │              workflows/*.md              │
                       │   (shared markdown body — ARCH-01)       │
                       └──────────┬────────────────────┬──────────┘
                                  │                    │
                       <capability_check>     <capability_check>
                       resolves to MCP        resolves to direct
                       tool/resource calls    bin/lib/* function calls
                                  │                    │
        ┌─────────────────────────▼─────────┐  ┌──────▼──────────────────────────┐
        │       Tier 1: Plugin shell        │  │        Tier 2: Node CLI         │
        │  .claude-plugin/plugin.json       │  │  bin/cli/pensmith.ts (citty)    │
        │  .mcp.json (stdio command)        │  │  ↓ defineCommand subCommands    │
        │  hooks/*.ts (no-op Phase 2)       │  │  17 verbs, only doctor real     │
        │  ┌─────────────────────────────┐  │  │  ┌────────────────────────────┐ │
        │  │ mcp/server.ts (thin shim)   │  │  │  │ bin/cli/doctor.ts          │ │
        │  │ McpServer + Stdio transport │  │  │  │   probe runner → Record    │ │
        │  │ 4 resources + 4 tools       │  │  │  └────────────┬───────────────┘ │
        │  │ each handler ≤ 30 lines     │  │  └───────────────┼─────────────────┘
        │  └──────────────┬──────────────┘  │                  │
        └─────────────────┼─────────────────┘                  │
                          │                                    │
                          └──────────────┬─────────────────────┘
                                         ▼
                       ┌──────────────────────────────────────────┐
                       │            Tier 0: bin/lib/*             │
                       │  paths.ts • runtime.ts • state.ts        │
                       │  library.ts • checkpoint.ts • lock.ts    │
                       │  atomic-write.ts • doi.ts • http.ts      │
                       │  budget.ts • session-log.ts • pii.ts     │
                       │  pricing.ts • migrations + schemas       │
                       │  retry.ts (parseRetryAfter — D-01 new)   │
                       │  doctor/* probe helpers (new)            │
                       └──────────────────────────────────────────┘

                                         ↓
                       ┌──────────────────────────────────────────┐
                       │   tests/tier-contract.test.ts (D-11)     │
                       │  spawns dist/mcp/server.js subprocess    │
                       │  spawns dist/bin/pensmith.js doctor      │
                       │  asserts probe Records key-equal +       │
                       │  severity/summary/id shape-match (D-21)  │
                       └──────────────────────────────────────────┘
```

### Recommended Project Structure (Phase 2 additions only)

```
mcp/
└── server.ts             # NEW — McpServer + stdio + 4 resources + 4 tools (thin shim)

bin/
├── cli/
│   ├── pensmith.ts       # NEW — citty entry, 17 subCommands, only doctor real
│   └── doctor.ts         # NEW — probe runner (the doctor verb's run() callback)
└── lib/
    ├── retry.ts          # NEW (D-01) — parseRetryAfter() extracted from http.ts
    └── doctor/           # NEW (optional decomposition; D-Discretion)
        ├── node-version.ts
        ├── mcp-presence.ts
        ├── contact-email.ts
        ├── sync-folder.ts
        ├── wiring-smoke.ts
        └── runtime-config.ts

hooks/                    # NEW directory — Phase 2 ships no-op scaffolds (TIER-07)
├── session-start.ts      # no-op exit 0
├── pre-compact.ts        # no-op exit 0
└── post-tool-use.ts      # no-op exit 0

references/
├── doctor-output.md      # NEW — locked TTY copy (D-18)
└── tier-contract.md      # NEW — explains gate, referenced by CONTRIBUTING.md

tests/
├── lint-thin-shim.test.ts          # NEW (D-09)
├── lint-mcp-no-network.test.ts     # NEW (D-10)
├── lint-capabilities-noleak.test.ts # NEW (D-12)
├── tier-contract.test.ts           # NEW (D-11/22)
└── fixtures/
    ├── lint-thin-shim-fixture.ts          # NEW — red-team
    ├── lint-mcp-no-network-fixture.ts     # NEW — red-team
    └── lint-capabilities-noleak-fixture.ts # NEW — red-team

CONTRIBUTING.md           # NEW (D-24) — "Tier contract — do not skip" section
```

### Pattern 1: MCP server thin shim (v1.x SDK API)

**What:** Each MCP tool/resource handler is a ≤30 line async function that parses input via zod and calls exactly one bin/lib/* function.

**When to use:** Every handler in mcp/server.ts. Period.

**Verified example (literal v1.29 API):**

```typescript
// mcp/server.ts
// Source: https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.29.0/docs/server.md
// + src/examples/server/simpleStreamableHttp.ts at v1.29.0

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readState, updateState } from '../bin/lib/state.js';
import { readLibrary } from '../bin/lib/library.js';
import { appendCheckpoint } from '../bin/lib/checkpoint.js';
import { loadRuntimeConfig } from '../bin/lib/runtime.js';

const server = new McpServer(
  { name: 'pensmith', version: '0.1.0-dev' },
  { capabilities: { resources: {}, tools: {} } }
);

// === Resources (static URIs — no ResourceTemplate this phase) ===

server.registerResource(
  'paper-state',
  'paper://state',
  { title: 'Paper State', mimeType: 'application/json' },
  async () => {
    const state = await readState();
    return { contents: [{ uri: 'paper://state', text: JSON.stringify(state) }] };
  }
);

server.registerResource(
  'paper-capabilities',
  'paper://capabilities',
  { title: 'Pensmith Capabilities', mimeType: 'application/json' },
  async () => {
    // D-12: presence flags ONLY. No process.env[anything] reads here.
    // No getProviderApiKey calls. Just env-var-NAMES + booleans.
    const cfg = await loadRuntimeConfig();
    const providers = cfg.providers.map(p => ({
      name: p.name,
      apiKeyEnv: p.apiKeyEnv,                                   // env-var NAME (safe)
      apiKeyPresent: process.env[p.apiKeyEnv] !== undefined,    // boolean (safe)
    }));
    return { contents: [{ uri: 'paper://capabilities', text: JSON.stringify({ providers }) }] };
  }
);

// === Tools (zod-validated input; ≤30 lines each) ===

server.registerTool(
  'state.update',
  {
    title: 'Update paper state',
    description: 'Patch fields on the paper state (optimistic-concurrency, D-08)',
    inputSchema: {
      patch: z.record(z.string(), z.unknown()),
    },
  },
  async ({ patch }) => {
    const result = await updateState(patch);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Notes on the API surface (verified against v1.29.0 source at github.com/modelcontextprotocol/typescript-sdk):**

- `McpServer(serverInfo, options)` — first arg `{ name, version }`, second arg `{ capabilities }`. [VERIFIED: src/examples/server/simpleStreamableHttp.ts at v1.29.0]
- `server.registerResource(name, uriOrTemplate, metadata, readCallback)` — when `uriOrTemplate` is a string, it's a static URI; when it's `new ResourceTemplate(template, opts)`, it's variable. [VERIFIED: src/server/mcp.ts at v1.29.0]
- `server.registerTool(name, { title, description, inputSchema }, handler)` — inputSchema is a **plain object of zod schemas** (NOT a single `z.object({...})` — the SDK wraps it internally). [VERIFIED: src/examples/server/simpleStreamableHttp.ts at v1.29.0]
- `await server.connect(transport)` — handshake-and-pump loop. [VERIFIED: docs/server.md at v1.29.0]
- `StdioServerTransport` constructor takes optional `(stdin, stdout)` Readable/Writable args; defaults are `process.stdin`/`process.stdout`. [VERIFIED: src/server/stdio.ts at v1.29.0]

### Pattern 2: citty CLI dispatcher (TIER-01)

**What:** Single `defineCommand` with a `subCommands` map, one entry per verb.

**When to use:** `bin/cli/pensmith.ts` — the Tier 2 entry point.

**Verified example (citty 0.2.2):**

```typescript
// bin/cli/pensmith.ts
// Source: https://github.com/unjs/citty/blob/main/README.md (citty@0.2.2)

import { defineCommand, runMain } from 'citty';
import { runDoctor } from './doctor.js';

const stub = (verb: string) => defineCommand({
  meta: { name: verb, description: `${verb} (not implemented yet)` },
  run() {
    console.log(`pensmith ${verb}: not implemented yet`);
    // exit 0 — TIER-02: stubs are FOLLOWS_DESIGN, not failures
  },
});

const doctor = defineCommand({
  meta: { name: 'doctor', description: 'Run environment probes and report PASS/WARN/FAIL/SKIP' },
  args: {
    json: { type: 'boolean', description: 'Output machine-readable JSON' },
  },
  async run({ args }) {
    const probes = await runDoctor();
    if (args.json) {
      console.log(JSON.stringify(probes, null, 2));
    } else {
      // human-readable via @clack/prompts — see references/doctor-output.md
      renderDoctorPretty(probes);
    }
    // D-15: exit non-zero only on any FAIL
    const failed = Object.values(probes).some(p => p.severity === 'FAIL');
    if (failed) process.exit(1);
  },
});

const main = defineCommand({
  meta: { name: 'pensmith', version: '0.1.0-dev', description: 'Pensmith CLI (Tier 2)' },
  subCommands: {
    doctor,
    init: stub('init'),
    intake: stub('intake'),
    research: stub('research'),
    outline: stub('outline'),
    plan: stub('plan'),
    write: stub('write'),
    verify: stub('verify'),
    compile: stub('compile'),
    status: stub('status'),
    resume: stub('resume'),
    library: stub('library'),
    fetch: stub('fetch'),
    dryrun: stub('dryrun'),
    undo: stub('undo'),
    help: stub('help'),
    // version is handled by citty's --version automatically from meta.version
  },
});

runMain(main);
```

**Notes (verified against unjs/citty README, citty@0.2.2):**

- `defineCommand({ meta, args, subCommands, run })` — meta supplies `name`, `description`, `version`. [CITED: github.com/unjs/citty README]
- `args` declares per-flag types: `{ type: 'positional' | 'string' | 'boolean' | 'enum', required?, default?, description? }`. [CITED: github.com/unjs/citty README]
- `runMain(main)` is the entry point — parses argv, dispatches, handles `--help`/`--version`/exit codes. [CITED: github.com/unjs/citty README]
- subCommands map is plain object — keys are the verb name as typed on the CLI. [CITED: github.com/unjs/citty README]

### Pattern 3: Doctor probe — pure read-only function returning a Record entry

**What:** Each probe is `async (): Promise<ProbeResult>` where `ProbeResult = { id; severity; summary; detail?; fix? }`.

```typescript
// bin/cli/doctor.ts (or bin/lib/doctor/*.ts)

export type Severity = 'PASS' | 'WARN' | 'FAIL' | 'SKIP';

export type ProbeResult = {
  id: string;
  severity: Severity;
  summary: string;          // one-line human prose
  detail?: string;          // optional multi-line context
  fix?: string;             // optional remediation hint
};

import { isInsideSyncFolder, paperDir } from '../lib/paths.js';

async function probeSyncFolder(): Promise<ProbeResult> {
  const dir = await paperDir();
  if (isInsideSyncFolder(dir)) {
    return {
      id: 'sync-folder-detection',
      severity: 'WARN',
      summary: 'Paper directory is inside a sync folder (OneDrive/iCloud/Dropbox/Google Drive)',
      detail: `paperDir() resolved to ${dir}`,
      fix: 'Move the paper to a non-synced location to avoid lock conflicts and version churn',
    };
  }
  return { id: 'sync-folder-detection', severity: 'PASS', summary: 'Paper directory is not in a sync folder' };
}

export async function runDoctor(): Promise<Record<string, ProbeResult>> {
  // Sequential (Tier 2). Tier 1 may run via Promise.all — same Record result.
  const results: ProbeResult[] = [
    await probeNodeVersion(),
    await probeMcpPresence(),
    await probeContactEmail(),
    await probeSyncFolder(),
    await probeWiringSmoke(),
    await probeRuntimeConfig(),
  ];
  return Object.fromEntries(results.map(r => [r.id, r]));
}
```

### Pattern 4: AST-walk chokepoint lint test (D-09, D-10, D-12)

**What:** A test file that walks AST nodes of target files (mcp/server.ts) using `@typescript-eslint/parser` and fails the build if a forbidden node shape is present.

**Pattern (already proven in tests/lint-chokepoint.test.ts / tests/lint-paths-chokepoint.test.ts / tests/lint-atomic-write-chokepoint.test.ts):**

```typescript
// tests/lint-thin-shim.test.ts (sketch)
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { parse } from '@typescript-eslint/parser';

test('mcp/server.ts: every tool/resource handler is ≤30 statements', () => {
  const src = readFileSync(new URL('../mcp/server.ts', import.meta.url), 'utf8');
  const ast = parse(src, { sourceType: 'module', ecmaVersion: 2022, range: true, loc: true });

  // Walk CallExpression nodes where callee is `server.registerTool` or `server.registerResource`.
  // The handler is the last argument — must be ArrowFunctionExpression or FunctionExpression.
  // Count statements in the body. Assert ≤ 30 (D-08 says ≤30, target ≤20).

  // [walker code omitted in sketch — see existing tests/lint-paths-chokepoint.test.ts for the pattern]
  // assert.ok(maxStatements <= 30, `Handler exceeds thin-shim budget: ${maxStatements} statements`);
});

test('red-team fixture: handler with 31+ statements is flagged', () => {
  // Run the walker on tests/fixtures/lint-thin-shim-fixture.ts and assert it fails.
});
```

### Pattern 5: Tier-contract test (D-11) — spawn built artifacts

```typescript
// tests/tier-contract.test.ts (sketch)
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn, execFileSync } from 'node:child_process';

test('Tier 1 MCP server + Tier 2 CLI doctor produce key-equal Records', async () => {
  // 1. Spawn dist/mcp/server.js as child process over stdio.
  //    Send initialize → listResources → listTools handshake.
  //    Read paper://capabilities resource. Parse JSON.
  //    Run a doctor MCP tool (if exposed) OR mock the probes deterministically.
  // 2. Run `node dist/bin/pensmith.js doctor --json` via execFileSync.
  //    Parse stdout JSON.
  // 3. Assert: Object.keys(tier1Probes).sort() deep-equals Object.keys(tier2Probes).sort()
  // 4. For each key: assert id, severity, summary match. Allow detail/fix to differ
  //    ONLY where a documented environment-noise normalizer applies (D-21).
});
```

### Pattern 6: `<capability_check>` workflow body (ARCH-03)

**What:** A markdown body block that resolves at workflow runtime to "MCP tool available?" → use it, else fall back to direct file read or shell.

**Example structure (from gsd-plugin patterns we adopt):**

```markdown
<!-- workflows/doctor.md -->

# /pensmith doctor

<capability_check>
- if: MCP tool `paper.capabilities` available
  then: call it, render the returned Record
- elif: CLI binary `pensmith` on PATH
  then: shell out `pensmith doctor --json`, parse stdout
- else: refuse — neither tier is installed
</capability_check>
```

Pensmith adopts this pattern. The block is conceptual markdown — there is no `capability_check` runtime parser this phase; it's just a body convention that both tiers know how to read.

### Anti-Patterns to Avoid

- **Inline business logic in mcp/server.ts handlers** — anything more than `await binLibCall(input)` violates D-08/D-09. The lint test catches it.
- **Calling `process.env[providerName]` inside the capabilities handler** — leaks the value. Lint catches it via D-12.
- **Importing `net` / `http` / `https` / starting a server in mcp/** — locks D-10 to fail.
- **Using `ResourceTemplate` for the 4 Phase 2 resources** — they're singletons; ResourceTemplate is for `paper://section/{N}` (Phase 3+).
- **Treating tier-contract failure as "the test is flaky, retry"** — D-21: the default fix is to make the tiers agree, not to bypass.
- **Doctor probe that mutates state** — D-19 violation. Read-only only; no atomic-write, no lock acquisition.
- **Skipping `npm run build` before the tier-contract test** — Phase 0 Pitfall D applies; the test spawns dist/mcp/server.js and dist/bin/pensmith.js, which only exist after tsc.
- **Adding a normalizer rule to paper over a real tier divergence** — D-21 explicitly forbids; normalizers are reserved for OS-specific path strings in `detail`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP request/response framing | Custom JSON-RPC pump | `@modelcontextprotocol/sdk` (McpServer + StdioServerTransport) | Handshake, capabilities advertisement, tool/resource registration, framing on stdio — all spec-correct in the SDK |
| CLI verb parsing | Hand-rolled `process.argv.slice(2)` switch | citty | Help/version auto-generation, type-safe args, subCommand routing, exit code semantics |
| Argv schema validation | Manual `if (typeof args.json !== 'boolean')` | citty's `args: { json: { type: 'boolean' } }` | Coercion + help text from one declaration |
| OneDrive/iCloud/Dropbox/Google Drive detection | New regex | `isInsideSyncFolder()` in bin/lib/paths.ts (ALREADY EXISTS, Phase 1 W1) | Patterns already cover \\OneDrive(\\| - ), /Library/CloudStorage/OneDrive-/, etc. |
| Semver compare for node-version probe | String split | `process.versions.node` + simple major.minor.patch parse | Single comparison; pulling in semver is overkill for one probe |
| Spawning a subprocess for wiring-smoke (DOCT-05) | `child_process.exec` (shell-out) | `execFileSync('node', [path, '--version'])` | Avoids shell glob/quoting landmines on Windows (same lesson as scripts/run-tests.mjs) |
| Pretty-print probe Records to TTY | Manual ANSI codes | `@clack/prompts` `intro`/`outro`/`note` (already a dep) | Consistent UX across all future verbs |
| AST parsing for chokepoint tests | hand-rolled regex | `@typescript-eslint/parser` (transitive of typescript-eslint@^8) | Already wired into Phase 0/1 lint tests; regex on TS source is famously fragile |

**Key insight:** Phase 1 already shipped the heavy lifting (paths, runtime config, state, library, checkpoint, http, atomic-write, lock). Phase 2 mostly composes those primitives. The temptation to hand-roll a "simple" doctor or a "simple" CLI is the trap — citty + the existing bin/lib + the existing AST-walk test pattern give you Phase 2 in ~600 LOC of new code, most of which is type definitions.

## Runtime State Inventory

(Skipped — Phase 2 is greenfield code addition with no rename/refactor/migration of existing runtime state.)

## Common Pitfalls

### Pitfall 1: Mixing v1 and v2 MCP SDK import paths

**What goes wrong:** Copying example code from the v2.0.0-alpha README into mcp/server.ts. v2 uses split packages (`@modelcontextprotocol/server` + `/client`); v1.x uses `@modelcontextprotocol/sdk` with subpaths.

**Why it happens:** GitHub README at HEAD currently documents v2 patterns; pensmith pins v1.

**How to avoid:** All imports MUST start with `@modelcontextprotocol/sdk/server/...`. Lock the URL `https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.29.0/docs/server.md` as the authoritative reference.

**Warning signs:** TypeScript error `Cannot find module '@modelcontextprotocol/server'` or `... /node.js`.

### Pitfall 2: `inputSchema` shape — object of schemas, not `z.object`

**What goes wrong:** Writing `inputSchema: z.object({ name: z.string() })` instead of `inputSchema: { name: z.string() }`.

**Why it happens:** zod 4 conventions; reading SDK source incorrectly.

**How to avoid:** v1.29 SDK `registerTool` expects a **plain object whose values are zod schemas**. The SDK wraps it as `z.object(...)` internally. [VERIFIED: src/examples/server/simpleStreamableHttp.ts at v1.29.0]

```typescript
//  CORRECT
inputSchema: { name: z.string() }

//  WRONG
inputSchema: z.object({ name: z.string() })
```

**Warning signs:** Tool call from Claude Code fails with `validation error: expected object, received ZodObject`.

### Pitfall 3: Tier-contract test spawned BEFORE build (Phase 0 Pitfall D)

**What goes wrong:** `npm run test:tier-contract` runs before `npm run build`; `dist/mcp/server.js` doesn't exist; test fails with ENOENT.

**Why it happens:** CI step ordering defaults to test-then-build for some templates.

**How to avoid:** CI step order in `.github/workflows/ci.yml`: `npm ci → npm run lint → npx tsc --noEmit → npm run build → npm run test:tier-contract → npm test → npm run validate:manifests`. The tier-contract step MUST come after build.

**Warning signs:** Local `npm run test:tier-contract` works (because dist/ exists from a prior build); CI fails on first run.

### Pitfall 4: macOS-latest GitHub runner silently demoted to Intel

**What goes wrong:** macos-latest assumed to be arm64; one day GitHub demotes it; binaries with native modules (proper-lockfile has no native modules, but future deps might) break silently.

**How to avoid:** Phase 0 already added an explicit arm64 assert step: `test "$RUNNER_ARCH" = "ARM64"`. Tier-contract step inherits it — no change needed, just don't remove it.

### Pitfall 5: Windows path-separator divergence in tier-contract Record `detail` field

**What goes wrong:** Tier 1's MCP server (running in Claude Code's Node) and Tier 2's CLI (running in the user's terminal Node) report paths differently — Windows backslash vs forward-slash from `path.join` vs `path.posix.join`.

**Why it happens:** Probe `detail` strings often interpolate file paths.

**How to avoid:** **D-21 is the rule** — don't add a normalizer that strips path separators. Instead, make both tiers use the same `path.join` (Node default uses the platform separator on Windows; both tiers run on the same platform in any given run, so they agree). The tier-contract test asserts `id`, `severity`, `summary` are equal; `detail` is documented as best-effort. If a real divergence shows up (e.g., one tier uses absolute paths and the other uses relative), fix the tier — don't normalize.

**Warning signs:** Tier-contract test flakes on Windows but passes on Linux.

### Pitfall 6: `paper://capabilities` accidentally leaks key VALUES

**What goes wrong:** Handler writes `apiKeyValue: process.env[p.apiKeyEnv]` instead of `apiKeyPresent: process.env[p.apiKeyEnv] !== undefined`.

**Why it happens:** Convenience copy-paste; "just dump the env" thinking.

**How to avoid:** Lint-test `tests/lint-capabilities-noleak.test.ts` (D-12) AST-walks the registerResource handler for `paper-capabilities` and flags:
1. Any `MemberExpression` with `object: process.env` AND `computed: true` (i.e., `process.env[someVar]`)
2. Any identifier reference to `getProviderApiKey` or `getOpenAlexApiKey`
3. Any property assignment with key matching `/apiKey$|secret$|token$/i` whose value is NOT a literal string or a boolean expression

**Red-team fixture** (tests/fixtures/lint-capabilities-noleak-fixture.ts) intentionally violates each rule; the test asserts all three flag.

**Warning signs:** Test passes locally because env vars are empty in CI; production user sees their key echoed back.

### Pitfall 7: MCP server stdout corruption from console.log

**What goes wrong:** `console.log` inside an MCP handler writes to stdout. **Stdout is the MCP transport** — any non-JSON-RPC byte corrupts the protocol stream. Claude Code sees garbled framing and disconnects.

**Why it happens:** Default debugging instinct.

**How to avoid:**
1. Inside mcp/server.ts, NEVER use `console.log`. Use `console.error` (goes to stderr) or the session-log facility.
2. Add a lint rule (could be the same lint-thin-shim test) that flags `console.log` calls anywhere in `mcp/**/*.ts`.

**Warning signs:** MCP connection drops on first tool call; Claude Code reports "unexpected token" or "protocol error".

### Pitfall 8: citty's `args.<name>` is undefined when flag absent

**What goes wrong:** `if (args.json) { ... }` is fine, but `if (args.json === false)` is wrong — when the user omits `--json`, the value is `undefined`, not `false`.

**How to avoid:** Use truthy checks or set `default: false` in the args declaration. [CITED: github.com/unjs/citty README — args support default]

### Pitfall 9: stdio transport handshake timing in the tier-contract test

**What goes wrong:** Test sends `initialize` and immediately reads response — but the spawned child may not have called `await server.connect(transport)` yet. Race condition.

**How to avoid:** Use the MCP SDK's `Client` from `@modelcontextprotocol/sdk/client/index.js` against the spawned child via `StdioClientTransport`. The client handles handshake correctly. Don't write raw JSON-RPC bytes by hand.

```typescript
// Tier-contract test, Tier 1 side:
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: [path.join(distDir, 'mcp/server.js')],
});
const client = new Client({ name: 'tier-contract-test', version: '0.0.1' }, { capabilities: {} });
await client.connect(transport);
const caps = await client.readResource({ uri: 'paper://capabilities' });
// caps.contents[0].text is the JSON we asserted on
await client.close();
```

### Pitfall 10: `parseRetryAfter` split (D-01) — test ownership transfer

**What goes wrong:** Moving `parseRetryAfter` from `bin/lib/http.ts` to `bin/lib/retry.ts` but forgetting to also move its tests; or moving tests but breaking `import` paths in http.test.ts.

**How to avoid:** Wave 0 plan task: (1) create bin/lib/retry.ts with the function, (2) update http.ts to `export { parseRetryAfter } from './retry.js'` for backwards compatibility OR update all call sites, (3) move test cases from http.test.ts to a new tests/retry.test.ts, (4) `npm run check` green before commit.

### Pitfall 11: `@clack/prompts` version drift between tiers

**What goes wrong:** Tier 2 CLI uses `@clack/prompts@0.7` (pinned); a future tier-contract regression introduces a tier-1 fork on 1.4 — the JSON output diverges because clack 1.x changed the bullet character.

**How to avoid:** Both tiers consume the SAME bin/cli/doctor.ts module. The `--json` output is the only thing the tier-contract test compares, and JSON serialization is invariant under clack version. Pretty output is human-only.

### Pitfall 12: Doctor probe order is unspecified but Record is comparable (D-20)

**What goes wrong:** Tier 1 runs probes via `Promise.all`; results come back in completion order, not declaration order. Tier 2 runs sequentially. If the test compares ARRAYS, it flakes.

**How to avoid:** D-20 locks the API as `Record<string, ProbeResult>` keyed by `probe.id`. Compare with `Object.keys().sort()` deep-equal, never array index.

## Code Examples

### Full mcp/server.ts skeleton (verified API)

(See Pattern 1 above.)

### Full bin/cli/pensmith.ts skeleton (citty)

(See Pattern 2 above.)

### isInsideSyncFolder usage (reusing Phase 1 implementation)

```typescript
// bin/cli/doctor.ts
import { isInsideSyncFolder, paperDir } from '../lib/paths.js';
// isInsideSyncFolder(absPath: string): boolean
// Already implemented in Phase 1 W1; covers OneDrive, iCloud, Dropbox, Google Drive
```

### npm script + CI step (D-22/D-23 same-commit pattern)

```json
// package.json — Wave 3
{
  "scripts": {
    "test:tier-contract": "node --import tsx tests/tier-contract.test.ts",
    "check": "npm run lint && npm run typecheck && npm run build && npm run test:tier-contract && npm test && npm run validate:manifests"
  }
}
```

```yaml
# .github/workflows/ci.yml — Wave 3, in the same commit
- name: Build
  run: npm run build
- name: Tier contract gate
  run: npm run test:tier-contract
- name: Unit tests
  run: npm test
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-rolled JSON-RPC over stdio | `@modelcontextprotocol/sdk` McpServer | SDK 1.0 release Nov 2024 | Pensmith uses SDK |
| MCP SDK v0.x (separate Server/Client classes) | v1.x (McpServer high-level API) | v1.0 (Nov 2024) | Pensmith on v1.29 |
| Commander-style imperative CLI builders | Declarative defineCommand (citty/oclif) | citty 0.2.x (2024) | Pensmith uses citty |
| zod 3 → zod 4 ecosystem migration | Mixed — v1.29 SDK uses zod 3 schemas | zod 4.0 (Apr 2025) | Pensmith stays on zod 3 this phase |

**Deprecated/outdated:**

- MCP SDK v0.x patterns from pre-2024 tutorials — `new Server()` low-level API still exists in v1.x but `McpServer` high-level wrapper is the standard.
- Manual `process.argv.slice(2)` parsing — citty subsumes this.
- Pretty-print to stdout from MCP handlers — Pitfall 7; never do it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Phase 2 doctor TTY uses `@clack/prompts` (already a dep) rather than chalk | Standard Stack / Pattern 3 | [ASSUMED] — if planner picks chalk instead, no functional impact; cosmetic |
| A2 | `pretty` output of doctor is human-only; `--json` is the tier-contract comparison surface | Pitfall 11 / Pattern 2 | [ASSUMED] — D-15..D-20 say Record-keyed; doesn't explicitly say `--json` flag, but tier-contract test needs deterministic JSON. Recommend planner formalize a `--json` flag |
| A3 | hooks/ directory exists or will be created in Phase 2; hooks ship as no-op exit-0 stubs | Recommended Project Structure | [ASSUMED] — TIER-07 implies it; if Phase 0 already created the dir, this is just file additions |
| A4 | `dist/bin/pensmith.js` is the built CLI entry path (not `dist/cli/pensmith.js`) | Pitfall 3 / Code Examples | [ASSUMED] — depends on tsconfig.outDir layout; planner verifies during Wave 0 |
| A5 | `console.error` is safe inside MCP handlers | Pitfall 7 | [VERIFIED: MCP spec — stdio transport uses stdout for protocol, stderr is free] |
| A6 | `runtime.json` location is `pensmithDataDir()/runtime.json` and loadRuntimeConfig returns defaults on ENOENT | Pattern 1 / DOCT-06 | [VERIFIED: bin/lib/runtime.ts, decision in 01-13 commit log] |

## Open Questions

1. **Does the doctor verb expose a `--json` flag or does it default to JSON when stdout is not a TTY?**
   - What we know: The tier-contract test needs deterministic JSON output to compare Tier 1 (MCP `paper://capabilities`) against Tier 2 (CLI doctor stdout).
   - What's unclear: Whether `pensmith doctor` defaults to pretty TTY when interactive and JSON when piped, or whether it requires an explicit `--json`.
   - Recommendation: Add explicit `--json` flag (citty makes this one line). The tier-contract test calls `node dist/bin/pensmith.js doctor --json`. Pretty output for humans, machine output gated by flag.

2. **Should the MCP server expose `doctor` as a tool, or only as a resource via `paper://capabilities`?**
   - What we know: D-07 locks 4 resources + 4 tools. None of the 4 listed tools is `doctor`.
   - What's unclear: Whether `paper://capabilities` content alone is sufficient for Tier 1 to satisfy the tier-contract (capabilities are a subset of doctor probes — only DOCT-06 directly maps).
   - Recommendation: For Phase 2, treat tier-contract scope as `paper://capabilities` vs. `pensmith doctor --json` filtered to the capabilities subset. Phase 3 can introduce a `doctor.run` MCP tool for full equivalence.

3. **Is `bin/lib/retry.ts` (D-01) imported by http.ts via re-export or via direct migration of call sites?**
   - What we know: D-01 mandates a "pure refactor; no behavior change."
   - What's unclear: Backwards-compat re-export vs. clean migration.
   - Recommendation: Re-export from http.ts for backwards-compat (`export { parseRetryAfter } from './retry.js'`); audit no-restricted-imports allowlist if needed. Test moves to tests/retry.test.ts in the same commit.

4. **Does `dist/mcp/server.js` need a shebang for direct execution?**
   - What we know: `.mcp.json` already references it as `command: "node"` with `args: [...path]`, so it's invoked via node, not directly.
   - What's unclear: Whether Phase 2 also wires it as a bin entry in package.json.
   - Recommendation: NO shebang needed; current plugin.json/.mcp.json shape is correct. Bin entry for `pensmith` CLI is separate.

5. **Should we lock `@clack/prompts` to 0.7 or bump to 1.4 in Wave 0?**
   - What we know: package.json pins `^0.7`; current is 1.4.0. Phase 1 doesn't use it heavily.
   - Recommendation: Defer the bump to a later phase. Phase 2 just uses `intro`/`outro`/`note` which haven't changed signatures. Stable.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node ≥ 20.10 | Everything | ✓ | engines.node `>=20.10.0` pinned; CI on 20.18 | — |
| `@modelcontextprotocol/sdk@^1.29` | mcp/server.ts | ✓ | 1.29.0 (matches pin) | — |
| `citty` | bin/cli/pensmith.ts | ✗ | not installed | Wave 0 plan installs `citty@^0.2.2` |
| `zod@^3.23` | mcp/server.ts inputSchemas | ✓ | pinned, Phase 1 uses it | — |
| `@typescript-eslint/parser` | the 3 new lint tests | ✓ | 8.59.3 transitive of typescript-eslint@^8 | — |
| GitHub Actions matrix (linux-x64, macos-arm64, windows-x64) | CI tier-contract gate | ✓ | Existing matrix from Phase 0 W4 | — |
| `tsx` | running test files in node-test | ✓ | ^4.0.0 devDep | — |
| `proper-lockfile` | (not directly used by Phase 2) | ✓ | — | — |
| `undici` | (not directly used by Phase 2) | ✓ | — | — |

**Missing dependencies with no fallback:** None blocking.

**Missing dependencies with fallback:**

- `citty@^0.2.2` — install in Wave 0 (D-14 locks the choice; alternatives would be commander/yargs but D-14 closed that door).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node --test` (node:test) + tsx for TS execution |
| Config file | scripts/run-tests.mjs (portable discovery) |
| Quick run command | `node scripts/run-tests.mjs tests/tier-contract.test.ts` |
| Full suite command | `npm run check` (lint + typecheck + build + test:tier-contract + test + validate:manifests) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ARCH-01 | Workflows are markdown shared by both tiers | smoke | `node scripts/run-tests.mjs tests/repo-files.test.ts` (extend to assert workflows/*.md present + readable by both tier entries) | ❌ Wave 0 — extend existing tests/repo-files.test.ts |
| ARCH-03 | `<capability_check>` block present in every workflow body | unit | `node scripts/run-tests.mjs tests/repo-files.test.ts` (extend) | ❌ Wave 0 |
| ARCH-18 | MCP tool handler ≤30 lines, no fs/http imports | lint | `node scripts/run-tests.mjs tests/lint-thin-shim.test.ts` | ❌ Wave 1 NEW |
| TIER-01 | All 17 verbs dispatchable | unit | `node scripts/run-tests.mjs tests/cli-verbs.test.ts` (preflight: assert workflows/*.md → dispatcher subCommands key-equal) | ❌ Wave 2 NEW |
| TIER-02 | Stub verbs exit 0 with "not implemented yet" | smoke | `node scripts/run-tests.mjs tests/cli-stubs.test.ts` (execFileSync each stub verb, assert exit 0 and stdout matches) | ❌ Wave 2 NEW |
| TIER-03 | Doctor exits 0 on PASS/WARN/SKIP, non-zero on FAIL | unit | `node scripts/run-tests.mjs tests/doctor-exit-code.test.ts` (mock a FAIL probe, assert exit 1) | ❌ Wave 2 NEW |
| TIER-04 | Probes return `{id, severity, summary, detail?, fix?}` | unit | `node scripts/run-tests.mjs tests/doctor-shape.test.ts` (call runDoctor(), assert Record shape) | ❌ Wave 2 NEW |
| TIER-05 | MCP server boots over stdio and registers 4 resources + 4 tools | integration | `npm run test:tier-contract` — covers handshake | ❌ Wave 3 NEW |
| TIER-06 | MCP tool handlers parse zod input | unit | `node scripts/run-tests.mjs tests/mcp-tool-handlers.test.ts` (instantiate McpServer in-process, call tool with malformed input, assert validation error) | ❌ Wave 2 NEW |
| TIER-07 | Plugin shell + hooks scaffolding present + manifest valid | smoke | `npm run validate:manifests` (extend scripts/validate-plugin-manifest.cjs to also assert hooks/ scaffolding) | ❌ Wave 4 — extend existing |
| DOCT-01 | node-version probe ≥20.10 PASS | unit | `tests/doctor-probes.test.ts::node-version` | ❌ Wave 2 NEW |
| DOCT-02 | mcp-sdk-presence probe checks dist/mcp/server.js exists+non-empty | unit | `tests/doctor-probes.test.ts::mcp-presence` (mock fs) | ❌ Wave 2 NEW |
| DOCT-03 | http-contact-email probe surfaces WARN when PENSMITH_CONTACT_EMAIL unset, copy matches `references/http-warnings.md` | unit | `tests/doctor-probes.test.ts::contact-email` | ❌ Wave 2 NEW |
| DOCT-04 | sync-folder-detection probe WARNs when paperDir() in sync folder | unit | `tests/doctor-probes.test.ts::sync-folder` (override paperDir() to a tmp path containing /OneDrive/) | ❌ Wave 2 NEW |
| DOCT-05 | wiring-smoke probe runs `node dist/bin/pensmith.js --version`, asserts exit 0 | smoke | `tests/doctor-probes.test.ts::wiring-smoke` (depends on build artifact) | ❌ Wave 3 NEW (depends on build) |
| DOCT-06 | runtime-config-presence probe — WARN if no provider key resolvable; value never persisted | unit | `tests/doctor-probes.test.ts::runtime-config` (override process.env per test) | ❌ Wave 2 NEW |
| Carry-forward CF-D01 | parseRetryAfter pure function | unit | `tests/retry.test.ts` (moved cases from http.test.ts) | ❌ Wave 0 (split) |
| Carry-forward CF-D09 | Thin-shim AST lint flags fixtures | lint | `tests/lint-thin-shim.test.ts` (red-team fixture) | ❌ Wave 1 NEW |
| Carry-forward CF-D10 | MCP no-network AST lint flags fixtures | lint | `tests/lint-mcp-no-network.test.ts` (red-team fixture) | ❌ Wave 1 NEW |
| Carry-forward CF-D12 | Capabilities no-leak AST lint flags fixtures | lint | `tests/lint-capabilities-noleak.test.ts` (red-team fixture) | ❌ Wave 1 NEW |
| Carry-forward CF-D22 | CI matrix runs test:tier-contract on all 3 OSes | smoke | CI itself (asserts in `.github/workflows/ci.yml`) | ❌ Wave 3 NEW |
| Carry-forward CF-D24 | CONTRIBUTING.md has "Tier contract — do not skip" section | smoke | `tests/repo-files.test.ts` (extend) | ❌ Wave 4 |

### Sampling Rate

- **Per task commit:** `npm run lint && npm run typecheck && node scripts/run-tests.mjs tests/<the-test-file>`
- **Per wave merge:** `npm run check` (full suite)
- **Phase gate:** Full `npm run check` green on all 3 OSes in CI before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `bin/lib/retry.ts` — extract parseRetryAfter (D-01)
- [ ] `tests/retry.test.ts` — move test cases out of http.test.ts
- [ ] `package.json` — add `citty@^0.2.2` to dependencies
- [ ] `references/doctor-output.md` — locked TTY copy + JSON shape (D-18)
- [ ] `tests/repo-files.test.ts` extension — assert references/doctor-output.md present and unchanged hash, assert hooks/ dir exists

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 2 is stdio MCP only, runs as the same user; no auth boundary |
| V3 Session Management | no | No sessions |
| V4 Access Control | yes | MCP server runs in user-space; D-19 (doctor is read-only) limits blast radius |
| V5 Input Validation | yes | zod schemas on every MCP tool inputSchema (TIER-06) |
| V6 Cryptography | no | No crypto in Phase 2; API keys handled by Phase 1 runtime.ts (already chokepoint-locked) |
| V14 Configuration | yes | `paper://capabilities` MUST NOT leak secrets (D-12 lint-enforced) |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| MCP transport leaking secrets via resource content | Information Disclosure | D-12 lint-enforced presence-flags-only; T-01-07 symmetric defense |
| MCP server exposed via HTTP/SSE accidentally | Spoofing / Elevation | D-10 lint-enforced stdio-only |
| Inline business logic in MCP handler accumulating untested branches | Tampering / Repudiation | D-09 lint-enforced thin-shim invariant ≤30 lines |
| CLI arg injection via citty into shell | Injection | Doctor uses `execFileSync` (not `exec`) for the wiring-smoke probe; no shell interpolation |
| Stdout corruption breaking MCP framing | DoS / Repudiation | Pitfall 7 mitigation: never `console.log` in mcp/ — lint catches it |
| Sync-folder lock contention causing data loss | DoS / data integrity | DOCT-04 surfaces the WARN; Phase 1 W3 lock.ts already exponential-backoff retries; D-19 doctor read-only avoids contention from doctor itself |

## Project Constraints (from CLAUDE.md)

- **Section-as-phase is load-bearing** — Phase 2 doesn't touch section directories; safe.
- **Two-tier source-of-truth** — both tiers consume `workflows/*.md`; Pattern 6 documents the `<capability_check>` shape.
- **Single-command UX** — `/pensmith` is the headline command in Phase 1; Phase 2 ships `pensmith doctor` as a power-user fallback. Acceptable.
- **Verifier blocks compile and export** — Out of scope for Phase 2; Phase 6+.
- **No exported-document trace** — N/A for Phase 2; Phase 2 doesn't produce exports.
- **Honest framing on detection** — N/A for Phase 2.
- **Approval gates default-on** — N/A for Phase 2 (doctor is read-only; no destructive operations).

## Sources

### Primary (HIGH confidence)

- `@modelcontextprotocol/sdk@1.29.0` — https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.29.0
  - docs/server.md — `McpServer` import path + `await server.connect(transport)` + ResourceTemplate example
  - src/server/mcp.ts — ResourceTemplate constructor signature, registerResource overload
  - src/server/stdio.ts — StdioServerTransport signature
  - src/examples/server/simpleStreamableHttp.ts — registerTool inputSchema shape verified
- `npm view <pkg> version` — confirmed 2026-05-14:
  - citty@0.2.2
  - @clack/prompts@1.4.0
  - @modelcontextprotocol/sdk@1.29.0
  - zod@4.4.3 (note: SDK still uses zod 3 shapes)
  - @typescript-eslint/parser@8.59.3
- `github.com/modelcontextprotocol/typescript-sdk/tags` — confirmed v2 is pre-alpha (2.0.0-alpha.2 as of 2026-05)
- Pensmith Phase 0/1 source (HIGH — already in this repo):
  - eslint.config.js — AST-walk chokepoint pattern with 4-level escape (Pitfall B)
  - bin/lib/paths.ts — `isInsideSyncFolder()` already exists with regex coverage of OneDrive/iCloud/Dropbox/Google Drive
  - bin/lib/runtime.ts — `loadRuntimeConfig()` defaults-on-ENOENT; api-key-name-only persistence
  - bin/lib/http.ts — WARN-once banner for PENSMITH_CONTACT_EMAIL; references/http-warnings.md locked
  - scripts/run-tests.mjs — portable cross-platform test discovery
  - scripts/validate-plugin-manifest.cjs — manifest structural validation pattern
  - .github/workflows/ci.yml — 3-OS matrix, Node 20.18, fail-fast: false, ARM64 assert step

### Secondary (MEDIUM confidence)

- `github.com/unjs/citty` README — defineCommand, subCommands, runMain, args type system. Single source; widely used in UnJS ecosystem (nuxt, nitro).
- Anthropic plugin manifest docs (via gsd-plugin reference repo at jnuyens/gsd-plugin) — plugin.json + .mcp.json shape; pensmith Phase 0 already produced compatible files.

### Tertiary (LOW confidence — flagged for validation)

- citty 0.2.x behavior under unknown subcommand — assumed to print --help; verify in Wave 2 with a quick smoke.
- Whether `runMain` from citty exits the process on completion or returns. Verify before relying on `process.exit(1)` after `runMain(main)`.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — every version verified against npm registry on 2026-05-14
- MCP SDK API: HIGH — quoted literally from github.com/modelcontextprotocol/typescript-sdk at the v1.29.0 tag
- citty API: MEDIUM-HIGH — quoted from official README; behavior verified only via README, not by running the CLI
- AST-walk chokepoint pattern: HIGH — three existing tests in the repo prove the pattern works
- isInsideSyncFolder reuse: HIGH — function already shipped in Phase 1 W1
- Tier-contract spawn approach: MEDIUM — pattern is conventional but pensmith-specific assembly needs Wave 3 validation
- Pitfalls: HIGH for ones lifted from Phase 0/1 lessons (Pitfall 3, 4, 5, 10); MEDIUM for novel ones (Pitfall 7, 9)

**Research date:** 2026-05-14
**Valid until:** 2026-06-13 (30 days — MCP SDK and citty are both stable; only flagged for re-verification if v2 SDK exits pre-alpha)
