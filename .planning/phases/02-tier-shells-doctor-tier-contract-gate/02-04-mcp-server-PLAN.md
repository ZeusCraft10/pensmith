---
phase: 02-tier-shells-doctor-tier-contract-gate
plan: 04
type: execute
wave: 2
depends_on: ["02-01", "02-02", "02-03"]
files_modified:
  - package.json
  - mcp/server.ts
  - mcp/resources.ts
  - mcp/tools.ts
  - bin/lib/capabilities.ts
  - bin/lib/outline.ts
  - bin/lib/section.ts
  - bin/lib/state.ts
  - bin/lib/schemas/state.ts
  - tests/capabilities.test.ts
  - tests/mcp-tool-handlers.test.ts
  - tests/mcp-server-thin-shim.test.ts
autonomous: true
requirements: [ARCH-18, TIER-01, TIER-02]
must_haves:
  truths:
    - "MCP server boots over stdio and registers exactly 5 paper:// resources (state, outline, section/{N}, library, capabilities) and 6 snake_case state-mutation tools (per TIER-01, TIER-02, D-07, D-13)"
    - "Each tool handler in mcp/tools.ts is ≤30 statements (AST-counted) — D-08 hard budget"
    - "Capabilities resource emits only presence-flag booleans, never a resolved key value (D-12 runtime behavior, lint-enforced in 02-03)"
    - "Capabilities are built in `bin/lib/capabilities.ts::loadCapabilityFacts()` (thin-shim architecture per cross-AI review HIGH consensus). `mcp/resources.ts` paper://capabilities handler and `mcp/tools.ts` paper_capability_probe BOTH delegate to this helper — neither calls `loadRuntimeConfig` nor accesses `process.env[...]` directly. This preserves D-12's lint signal in mcp/ (no exception needed) and gives both tiers ONE shared capability-fact source."
    - "All 6 tool handlers parse input via per-handler zod shapes (TIER-06)"
    - "Server passes its own lints — no fs / no http / no console.* / no computed process.env / no inline runtime-helper calls"
  artifacts:
    - path: "mcp/server.ts"
      provides: "Boot + StdioServerTransport wiring + registerResource/registerTool calls"
      contains: "McpServer"
    - path: "mcp/resources.ts"
      provides: "5 paper:// resource definitions (state, outline, section/{N}, library, capabilities) per TIER-01 + D-07"
    - path: "mcp/tools.ts"
      provides: "6 snake_case tool handlers (paper_init_section, paper_advance_section, paper_record_verification, paper_set_status, paper_doi_verify, paper_capability_probe) per TIER-02, each ≤30 stmts"
    - path: "bin/lib/capabilities.ts"
      provides: "loadCapabilityFacts() — single capability-fact source consumed by both tiers (mcp/resources.ts paper://capabilities + mcp/tools.ts paper_capability_probe + 02-05's doctor probes). Calls loadRuntimeConfig + reads process.env presence flags HERE, not in mcp/. Preserves D-12 lint signal in mcp/."
    - path: "bin/lib/outline.ts"
      provides: "loadOutline() chokepoint (mcp/ MUST NOT call node:fs directly — D-09)"
    - path: "bin/lib/section.ts"
      provides: "loadSection(paperRoot, n) chokepoint for paper://section/{N} (mcp/ may not read fs directly)"
    - path: "tests/mcp-tool-handlers.test.ts"
      provides: "Per-tool zod validation tests (TIER-06 — malformed input rejected) across all 6 tools"
    - path: "tests/mcp-server-thin-shim.test.ts"
      provides: "AST-walk positive case: each of 5 resource handlers + 6 tool handlers ≤30 stmts (ARCH-18 / D-08 / D-09)"
  key_links:
    - from: "mcp/server.ts"
      to: "@modelcontextprotocol/sdk@^1.29"
      via: "import { McpServer, StdioServerTransport }"
      pattern: "McpServer.*StdioServerTransport"
    - from: "mcp/tools.ts handlers"
      to: "bin/lib/state.ts, bin/lib/library.ts, bin/lib/checkpoint.ts, bin/lib/runtime.ts"
      via: "thin delegation — handler reads/writes via these chokepoints (paper_doi_verify reuses bin/lib/http.ts via doi.ts; paper_capability_probe delegates to runtime.ts)"
      pattern: "import.*from\\s+'\\.\\./bin/lib/(state|library|checkpoint|runtime|doi|http|section)"
    - from: "mcp/resources.ts paper://capabilities handler"
      to: "bin/lib/capabilities.ts::loadCapabilityFacts"
      via: "named import — handler is a thin shim that JSON.stringifies the helper output (D-12: handler itself imports nothing from runtime.ts and accesses no process.env)"
      pattern: "loadCapabilityFacts"
    - from: "mcp/tools.ts paper_capability_probe handler"
      to: "bin/lib/capabilities.ts::loadCapabilityFacts"
      via: "named import — same thin-shim pattern; tier-equivalence by SHARING the source, not by reimplementation"
      pattern: "loadCapabilityFacts"
    - from: "bin/lib/capabilities.ts"
      to: "bin/lib/runtime.ts::loadRuntimeConfig + process.env presence checks"
      via: "this is the ONLY non-mcp location allowed to combine loadRuntimeConfig with process.env presence flags into the capabilities shape"
      pattern: "loadRuntimeConfig"
    - from: "mcp/resources.ts paper://section/{N}"
      to: "bin/lib/section.ts::loadSection"
      via: "ResourceTemplate variable + delegation"
      pattern: "ResourceTemplate|loadSection"
---

<objective>
Ship the real `mcp/server.ts` — boots `McpServer` over `StdioServerTransport`, registers
exactly **5 paper:// resources** per TIER-01 + D-07 (`paper://state`, `paper://outline`,
`paper://section/{N}`, `paper://library`, `paper://capabilities`), and registers exactly
**6 snake_case state-mutation tools** per TIER-02 (`paper_init_section`,
`paper_advance_section`, `paper_record_verification`, `paper_set_status`,
`paper_doi_verify`, `paper_capability_probe`) with zod-validated inputs.

Purpose: TIER-01 (resource surface complete), TIER-02 (tool surface complete), TIER-06
(every tool handler parses input via zod), ARCH-18
(handlers ≤30 stmts, no fs/http imports — enforced by the chokepoints landed in
02-01/02/03). This is the load-bearing artifact of Wave 2 — every subsequent tier-contract
assertion (02-07) and every doctor probe that references `dist/mcp/server.js` (02-05
mcp-sdk-presence, 02-07 build-artifact-resolves) depends on it existing.

Output: a stdio MCP server that survives `tsc --noEmit`, passes `npm run lint`
(including all three Wave 1 chokepoints), and exposes the complete contract that 02-07's
tier-contract test will black-box against using the official `Client` +
`StdioClientTransport`.
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
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-01-lint-thin-shim-PLAN.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-02-lint-mcp-no-network-PLAN.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-03-lint-capabilities-noleak-PLAN.md
@bin/lib/state.ts
@bin/lib/library.ts
@bin/lib/checkpoint.ts
@bin/lib/paths.ts
@bin/lib/runtime.ts
@bin/lib/doi.ts
@bin/lib/schemas/state.ts
@bin/lib/schemas/library.ts
@bin/lib/schemas/checkpoint.ts
@bin/lib/schemas/runtime-config.ts

<interfaces>
<!-- MCP SDK v1.29 surface (D-02 lock). Pattern source: RESEARCH § MCP SDK v1.29 -->
<!-- Pitfall 2: inputSchema is a flat record of zod fields, NOT z.object(...). -->
<!-- ResourceTemplate is the SDK shape for parameterised URIs like paper://section/{N}. -->

```typescript
// From @modelcontextprotocol/sdk@^1.29 (D-02 — locked, NOT v2-alpha):
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Plain resource registration shape:
server.registerResource(
  'state',                                  // logical name
  'paper://state',                          // literal URI
  { title: '...', mimeType: 'application/json' },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(...) }]
  }),
);

// Templated resource registration shape (paper://section/{N}):
server.registerResource(
  'section',
  new ResourceTemplate('paper://section/{n}', { list: undefined }),
  { title: 'Paper section', mimeType: 'application/json' },
  async (uri, { n }) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await loadSection(root, Number(n))) }]
  }),
);

// Tool registration shape:
server.registerTool(
  'paper_init_section',
  {
    title: 'Initialize a new section',
    description: '...',
    inputSchema: { paperRoot: z.string(), n: z.number().int().min(1), slug: z.string() },  // <-- flat record, NOT z.object({...})
  },
  async ({ paperRoot, n, slug }) => ({
    content: [{ type: 'text', text: JSON.stringify(await initSection(paperRoot, n, slug)) }],
  }),
);
```

<!-- Existing in-repo chokepoints the handlers MUST delegate to: -->

```typescript
// bin/lib/state.ts
export async function loadState(paperRoot: string): Promise<State>
export async function updateState(paperRoot: string, mutator: (s: State) => State): Promise<State>
// NEW (added in this plan if not already present — see Task 1 Step D):
export async function initSection(paperRoot: string, n: number, slug: string): Promise<State>
export async function advanceSection(paperRoot: string, n: number, toState: SectionState): Promise<State>
export async function setSectionStatus(paperRoot: string, n: number, status: SectionStatus): Promise<State>
export async function recordVerification(paperRoot: string, n: number, verdict: VerificationVerdict): Promise<State>

// bin/lib/library.ts
export async function loadLibrary(paperRoot: string): Promise<Library>

// bin/lib/checkpoint.ts
export async function recordCheckpoint(paperRoot: string, entry: CheckpointEntry): Promise<Checkpoint>

// bin/lib/runtime.ts — the SINGLE source for capability presence flags
export async function loadRuntimeConfig(opts?: { paperRoot?: string }): Promise<RuntimeConfig>
//   .providers is the array [{ name, apiKeyEnv, ... }] — D-12 maps to presence flags.

// bin/lib/doi.ts (Phase 1) — DOI normalization + via bin/lib/http.ts for Crossref ping
export function normalizeDoi(s: string): string | undefined
export async function verifyDoi(doi: string): Promise<{ valid: boolean; metadata?: unknown }>

// bin/lib/paths.ts — paperRoot resolution; do NOT call fs.* directly in mcp/
export function paperDir(opts?: { paperRoot?: string }): string

// NEW in this plan (per D-09 — mcp/ may not import node:fs):
// bin/lib/outline.ts — export async function loadOutline(paperRoot: string): Promise<string>
// bin/lib/section.ts — export async function loadSection(paperRoot: string, n: number): Promise<SectionPayload>

// bin/lib/schemas/state.ts, library.ts, checkpoint.ts — already shipped zod schemas
// NEW in this plan: StatePatchSchema (derived as .partial() of the state schema)
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Pin @modelcontextprotocol/sdk@^1.29, add bin/lib chokepoints, and write mcp/resources.ts with 5 resources</name>
  <files>package.json, bin/lib/outline.ts, bin/lib/section.ts, bin/lib/state.ts, bin/lib/schemas/state.ts, mcp/resources.ts</files>
  <read_first>
    - `package.json` in full (existing dependencies, scripts)
    - `bin/lib/state.ts` (entire — confirm loadState + updateState signatures; understand which new helpers need adding)
    - `bin/lib/library.ts` (loadLibrary signature)
    - `bin/lib/runtime.ts` lines 200-470 (loadRuntimeConfig + provider iteration shape — D-12 reference)
    - `bin/lib/schemas/state.ts` (entire — confirm existing schema shape so StatePatchSchema can be derived)
    - `bin/lib/schemas/runtime-config.ts` (RuntimeConfigSchema — provider list shape)
    - `bin/lib/paths.ts` (paperDir + outline path conventions)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-RESEARCH.md` § MCP SDK v1.29 patterns + § Pitfall 2 + § Pitfall 7 + § ResourceTemplate usage
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-02 (SDK version lock), D-07 (URI grammar — 5 resources), D-12 (capabilities-no-leak), D-13 (counts), D-19 (read-only resources)
  </read_first>
  <read_first_d12>
    <!-- B10: D-12 capabilities-no-leak is a load-bearing invariant. Re-read before
         writing the capabilities handler. -->
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-12
      verbatim: "paper://capabilities = presence-flags only, lint-enforced. Shape:
      `{ mcp_self, pandoc, zotero_mcp, humanizer, contact_email_set, providers: [{ name, api_key_env, present }], onedrive_detected, sync_folder_match? }`.
      All booleans / enum / env-var-NAME values; zero key-value leaks."
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-03-lint-capabilities-noleak-PLAN.md` §
      acceptance criteria — confirm the lint rule pattern your handler must satisfy.
    - Phase 1 `bin/lib/runtime.ts::getOpenAlexApiKey` (lines 438-462) — the no-leak idiom
      to mirror: log `envName + present:boolean`, NEVER the resolved value.
    - T-01-07 invariant from Phase 1 — capabilities is the Phase 2 symmetry case.
  </read_first_d12>
  <action>
    **Step A — pin the SDK in `package.json`:**

    Add `"@modelcontextprotocol/sdk": "^1.29.0"` to `dependencies` (NOT
    `devDependencies`). Per **D-02 lock**: pin minor at `^1.29.0` (NOT
    `^2.0.0-alpha.*`, NOT `latest`). If `zod` is not already a top-level
    dependency, add `"zod": "^3.23.0"` to `dependencies` (the SDK declares it
    as a peer dep). After edit, run `npm install` so `package-lock.json`
    updates in the same commit.

    Self-check: `node -e "const p=require('./package.json'); if(!/^\\^1\\.29/.test(p.dependencies['@modelcontextprotocol/sdk'])){process.exit(1)}"` exits 0.

    **Step B — create `bin/lib/outline.ts`** (per D-09 — mcp/ MUST NOT import node:fs):

    ```typescript
    // bin/lib/outline.ts — chokepoint for reading approved outline markdown.
    // mcp/ MUST NOT call node:fs directly (D-09); it calls loadOutline() here.
    import { readFile } from 'node:fs/promises';
    import { join } from 'node:path';

    export async function loadOutline(paperRoot: string): Promise<string> {
      const outlinePath = join(paperRoot, 'OUTLINE.md');
      try {
        return await readFile(outlinePath, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return '';  // empty outline acceptable for fresh papers
        }
        throw err;
      }
    }
    ```

    **Step C — create `bin/lib/section.ts`** (per D-07 — paper://section/{N} is
    a read-only paper resource; mcp/ may not read fs directly):

    ```typescript
    // bin/lib/section.ts — chokepoint for reading a single section's payload.
    // mcp/ MUST NOT call node:fs directly (D-09); paper://section/{N} delegates here.

    import { readFile } from 'node:fs/promises';
    import { join } from 'node:path';
    import { loadState } from './state.js';

    export interface SectionPayload {
      n: number;
      slug?: string;
      state: string;     // section state enum from State.sections[n].state
      plan?: string;     // PLAN.md raw markdown if present
      draft?: string;    // DRAFT.md raw markdown if present
      verification?: string;  // VERIFICATION.md raw markdown if present
    }

    export async function loadSection(paperRoot: string, n: number): Promise<SectionPayload> {
      const state = await loadState(paperRoot);
      const entry = state.sections?.find((s) => s.n === n);
      if (!entry) {
        return { n, state: 'unknown' };
      }
      const sectionDir = join(paperRoot, 'sections', `${String(n).padStart(2, '0')}-${entry.slug ?? 'section'}`);
      const read = async (name: string): Promise<string | undefined> => {
        try { return await readFile(join(sectionDir, name), 'utf8'); }
        catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
          throw err;
        }
      };
      return {
        n,
        slug: entry.slug,
        state: entry.state,
        plan: await read('PLAN.md'),
        draft: await read('DRAFT.md'),
        verification: await read('VERIFICATION.md'),
      };
    }
    ```

    NOTE: if the existing `State.sections[i]` shape differs (e.g. uses a Record
    keyed by N, or stores the slug differently), adjust `loadSection` accordingly
    — the contract is "return a stable payload for one section, returning a
    minimal `{ n, state: 'unknown' }` if the section is absent." Phase 2 ships
    the resource shell; Phase 3 fills in real section state.

    **Step D — extend `bin/lib/state.ts` and `bin/lib/schemas/state.ts`** with the
    state-mutation helpers the 4 mutation tools need. The existing `updateState`
    is the generic write primitive; the new helpers are typed convenience wrappers
    that compose it (each ≤15 lines, suitable to import directly from `mcp/tools.ts`):

    ```typescript
    // bin/lib/state.ts (additions — placed alongside existing updateState):

    import type { SectionStatus, SectionState, VerificationVerdict } from './schemas/state.js';

    export async function initSection(paperRoot: string, n: number, slug: string): Promise<State> {
      return updateState(paperRoot, (prev) => {
        const sections = prev.sections ?? [];
        if (sections.some((s) => s.n === n)) return prev;  // idempotent (D-08)
        return { ...prev, sections: [...sections, { n, slug, state: 'planned', status: 'pending' }] };
      });
    }

    export async function advanceSection(paperRoot: string, n: number, toState: SectionState): Promise<State> {
      return updateState(paperRoot, (prev) => ({
        ...prev,
        sections: (prev.sections ?? []).map((s) => (s.n === n ? { ...s, state: toState } : s)),
      }));
    }

    export async function setSectionStatus(paperRoot: string, n: number, status: SectionStatus): Promise<State> {
      return updateState(paperRoot, (prev) => ({
        ...prev,
        sections: (prev.sections ?? []).map((s) => (s.n === n ? { ...s, status } : s)),
      }));
    }

    export async function recordVerification(paperRoot: string, n: number, verdict: VerificationVerdict): Promise<State> {
      return updateState(paperRoot, (prev) => ({
        ...prev,
        sections: (prev.sections ?? []).map((s) => (s.n === n ? { ...s, lastVerification: verdict } : s)),
      }));
    }
    ```

    In `bin/lib/schemas/state.ts` ensure exports exist for `SectionStatus`,
    `SectionState`, `VerificationVerdict`, plus a `StatePatchSchema` derived as
    `.partial()` of the existing state schema (used as fallback by any tool that
    accepts a generic patch). If the existing schema uses `z.object`, the
    `.partial()` form is `StateSchema.partial()`. Export the inferred TypeScript
    types alongside.

    Self-check after Steps B/C/D:
    - `grep -c "export async function loadOutline" bin/lib/outline.ts` returns 1.
    - `grep -c "export async function loadSection" bin/lib/section.ts` returns 1.
    - `grep -c "export async function initSection\\|export async function advanceSection\\|export async function setSectionStatus\\|export async function recordVerification" bin/lib/state.ts` returns 4.
    - `grep -c "StatePatchSchema" bin/lib/schemas/state.ts` returns at least 1.
    - `npm run typecheck` exits 0.

    **Step E — create `mcp/resources.ts`** with **5 resources** per TIER-01 + D-07:

    Export a single function `registerPaperResources(server: McpServer)` that
    calls `server.registerResource(...)` exactly **5 times**. Each handler is a
    thin lambda (≤30 stmts, D-08) that delegates to a `bin/lib/*` chokepoint.
    **No fs imports. No console.*. No computed process.env. No inline runtime.ts
    helper calls** (all three Wave 1 chokepoints will fire if violated).

    Required body:

    ```typescript
    // mcp/resources.ts
    //
    // TIER-01 + D-07 + D-13: exactly 5 paper:// resources —
    //   paper://state, paper://outline, paper://section/{N}, paper://library, paper://capabilities.
    // D-19: all resources are READ-ONLY (no writes from resource handlers).
    // D-12: paper://capabilities emits PRESENCE FLAGS only — never a resolved
    //       env value. THIN SHIM: handler delegates to
    //       bin/lib/capabilities.ts::loadCapabilityFacts, which is the SINGLE
    //       location authorised to combine loadRuntimeConfig + process.env
    //       presence checks into the capability shape. mcp/ MUST NOT import
    //       loadRuntimeConfig and MUST NOT access process.env[...] — D-12 lint
    //       (from 02-03) catches both directly here.
    // D-08: each handler body ≤30 statements (AST-counted in tests/mcp-server-thin-shim.test.ts).
    // D-07/Pitfall 7: no console.* in this file — would corrupt stdio MCP frame.

    import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
    import { loadState } from '../bin/lib/state.js';
    import { loadLibrary } from '../bin/lib/library.js';
    import { loadOutline } from '../bin/lib/outline.js';
    import { loadSection } from '../bin/lib/section.js';
    import { loadCapabilityFacts } from '../bin/lib/capabilities.js';
    import { paperDir } from '../bin/lib/paths.js';

    export function registerPaperResources(server: McpServer): void {
      // 1. paper://state — read-only state document
      server.registerResource(
        'state',
        'paper://state',
        { title: 'Paper state', description: 'Section status, milestones, verification flags.', mimeType: 'application/json' },
        async (uri) => {
          const state = await loadState(paperDir());
          return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(state, null, 2) }] };
        },
      );

      // 2. paper://outline — approved outline markdown
      server.registerResource(
        'outline',
        'paper://outline',
        { title: 'Paper outline', description: 'Approved outline markdown.', mimeType: 'text/markdown' },
        async (uri) => {
          const outline = await loadOutline(paperDir());
          return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: outline }] };
        },
      );

      // 3. paper://section/{N} — read-only per-section payload (TIER-01)
      server.registerResource(
        'section',
        new ResourceTemplate('paper://section/{n}', { list: undefined }),
        { title: 'Paper section', description: 'Per-section state + plan/draft/verification markdown.', mimeType: 'application/json' },
        async (uri, vars) => {
          const n = Number(vars.n);
          if (!Number.isInteger(n) || n < 1) {
            throw new Error(`paper://section/{n}: invalid section number "${vars.n}"`);
          }
          const payload = await loadSection(paperDir(), n);
          return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(payload, null, 2) }] };
        },
      );

      // 4. paper://library — citation library
      server.registerResource(
        'library',
        'paper://library',
        { title: 'Citation library', description: 'All cited works with DOI verification status.', mimeType: 'application/json' },
        async (uri) => {
          const library = await loadLibrary(paperDir());
          return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(library, null, 2) }] };
        },
      );

      // 5. paper://capabilities — presence-flag booleans ONLY (D-12 lint-enforced).
      //    THIN SHIM: delegates 100% to bin/lib/capabilities.ts::loadCapabilityFacts.
      //    This file (mcp/resources.ts) MUST NOT import loadRuntimeConfig and MUST
      //    NOT access process.env[...] — D-12 lint enforces. The helper does both
      //    safely on the non-mcp side (T-01-07 symmetric defence).
      server.registerResource(
        'capabilities',
        'paper://capabilities',
        { title: 'Runtime capability flags', description: 'Presence flags only — NEVER resolved key values (D-12).', mimeType: 'application/json' },
        async (uri) => {
          const facts = await loadCapabilityFacts();
          return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(facts, null, 2) }] };
        },
      );
    }
    ```

    **D-12 architectural note (cross-AI review HIGH consensus):** The cross-AI
    review (Codex HIGH; OpenCode HIGH-via-inference) flagged that having
    `mcp/resources.ts` directly call `loadRuntimeConfig()` and access
    `process.env[p.apiKeyEnv]` — even with literal-bound + length-test + boolean
    coercion — undermines D-12 because the lint selector cannot prove flow-safety
    via AST shape alone. The discipline rule D-21 explicitly forbids loosening
    the lint or adding a runtime normalizer to dissolve the contradiction.
    The fix is structural: extract capability-fact construction into
    `bin/lib/capabilities.ts::loadCapabilityFacts()` (built in Step F below),
    and make BOTH `mcp/resources.ts` (paper://capabilities) and `mcp/tools.ts`
    (paper_capability_probe) thin shims that import that helper. Result: mcp/
    contains zero `process.env[...]` accesses and zero `loadRuntimeConfig`
    calls — D-12 lint stays maximally tight. Tier-equivalence becomes
    structural (same source) rather than statistical (parallel implementations).

    Self-check after Step E:
    - `grep -c "registerResource(" mcp/resources.ts` returns 5.
    - `grep -c "ResourceTemplate(" mcp/resources.ts` returns 1.
    - `grep -c "paper://state\\|paper://outline\\|paper://section\\|paper://library\\|paper://capabilities" mcp/resources.ts` returns at least 5 (one per URI).
    - `grep -c "node:fs\\|node:http\\|node:https\\|node:net\\|node:tls\\|node:child_process" mcp/resources.ts` returns 0.
    - `grep -c "console\\." mcp/resources.ts` returns 0.
    - `grep -c "loadCapabilityFacts" mcp/resources.ts` returns at least 1 (the new key_link to the bin/lib helper).
    - `grep -c "loadRuntimeConfig" mcp/resources.ts` returns 0 (mcp/ MUST NOT touch runtime.ts directly — D-12 architectural fix).
    - `grep -c "process\\.env\\[" mcp/resources.ts` returns 0 (no computed env access in mcp/; D-12 lint enforces).
    - `grep -cE "process\\.env\\.[A-Z_]+" mcp/resources.ts` returns 0 (capabilities-fact construction lives in bin/lib/capabilities.ts now).
    - `npm run lint` exits 0 (all three Wave 1 chokepoints + project-wide selectors pass — D-12 fires on nothing because the handler is a thin shim).

    **Step F — create `bin/lib/capabilities.ts`** (THE non-mcp helper that owns
    the capability shape — D-12 architectural fix from cross-AI review):

    This is the ONLY non-mcp location authorised to combine `loadRuntimeConfig`
    with `process.env[...]` presence checks into a `CapabilityFacts` record.
    Both `mcp/resources.ts` (paper://capabilities) and `mcp/tools.ts`
    (paper_capability_probe) import `loadCapabilityFacts` and JSON.stringify the
    return — neither does any composition of its own. 02-05's doctor probes
    (`runtime-config-presence`, `contact-email-presence`) MAY also delegate
    here for tier-equivalence; alternatively the probe can use the same
    underlying primitives — both are acceptable since the fact-source IS the
    single bin/lib helper.

    Required body:

    ```typescript
    // bin/lib/capabilities.ts
    //
    // D-12 architectural fix (cross-AI review HIGH consensus): SINGLE source of
    // capability facts. mcp/ MUST NOT call loadRuntimeConfig and MUST NOT access
    // process.env[...] directly — D-12 lint (02-03) catches both. This file is
    // the only authorised composition site.
    //
    // Invariant: returned shape contains presence-flag BOOLEANS only. NEVER a
    // resolved env value. tests/capabilities.test.ts uses sentinel values
    // (PROCESS-ENV-SENTINEL-DO-NOT-LEAK-...) to prove no leak path exists.
    // Symmetric to mcp/ T-01-07 / T-02-04-02 mitigation.

    import { loadRuntimeConfig } from './runtime.js';

    export interface ProviderCapability {
      readonly name: string;
      readonly api_key_env: string;
      readonly present: boolean;
    }

    export interface CapabilityFacts {
      readonly mcp_self: true;
      readonly contact_email_set: boolean;
      readonly providers: readonly ProviderCapability[];
      // Phase 2: placeholders so the shape is stable for 02-05 to populate.
      readonly pandoc?: boolean;
      readonly zotero_mcp?: boolean;
      readonly humanizer?: boolean;
      readonly onedrive_detected?: boolean;
      readonly sync_folder_match?: boolean;
    }

    function envPresent(name: string): boolean {
      const v = process.env[name];
      return typeof v === 'string' && v.length > 0;
    }

    export async function loadCapabilityFacts(): Promise<CapabilityFacts> {
      const cfg = await loadRuntimeConfig();
      const providers: readonly ProviderCapability[] = (cfg.providers ?? []).map((p) => ({
        name: p.name,
        api_key_env: p.apiKeyEnv,
        present: envPresent(p.apiKeyEnv),
      }));
      return {
        mcp_self: true,
        contact_email_set: envPresent('PENSMITH_CONTACT_EMAIL'),
        providers,
        // Phase 2: undefined → "not yet probed". 02-05 doctor probes populate.
        pandoc: undefined,
        zotero_mcp: undefined,
        humanizer: undefined,
        onedrive_detected: undefined,
        sync_folder_match: undefined,
      };
    }
    ```

    Self-check after Step F:
    - `bin/lib/capabilities.ts` exists.
    - `grep -c "export async function loadCapabilityFacts" bin/lib/capabilities.ts` returns 1.
    - `grep -c "loadRuntimeConfig" bin/lib/capabilities.ts` returns at least 1 (this IS the authorised consumer).
    - `grep -c "process\\.env\\[" bin/lib/capabilities.ts` returns at least 1 (composition lives here on purpose).
    - `grep -c "console\\." bin/lib/capabilities.ts` returns 0 (chokepoints stay quiet).
    - The D-12 `eslint.config.js` rule from 02-03 does NOT scope this file — selectors target `mcp/**/*.ts` only. (Cross-check: open `eslint.config.js` and confirm no `bin/lib/capabilities.ts` is listed under the D-12 block.)
    - `npm run lint` and `npm run typecheck` continue to pass.
  </action>
  <verify>
    <automated>npm run lint &amp;&amp; npm run typecheck &amp;&amp; node -e "const fs=require('node:fs'); const r=fs.readFileSync('mcp/resources.ts','utf8'); const reg=(r.match(/registerResource\(/g)||[]).length; if(reg!==5){console.error('expected 5 registerResource calls, got',reg);process.exit(1)} if(!/ResourceTemplate\(/.test(r)){console.error('ResourceTemplate missing for paper://section/{n}');process.exit(1)} for(const uri of ['paper://state','paper://outline','paper://section/{n}','paper://library','paper://capabilities']){if(!r.includes(uri)){console.error('missing URI',uri);process.exit(1)}} if(!/loadCapabilityFacts/.test(r)){console.error('capabilities must delegate to loadCapabilityFacts (D-12 thin-shim)');process.exit(1)} if(/loadRuntimeConfig/.test(r)){console.error('D-12: loadRuntimeConfig leaked into mcp/resources.ts');process.exit(1)} if(/process\.env\[/.test(r)){console.error('D-12: computed process.env access in mcp/resources.ts');process.exit(1)} if(/console\./.test(r)){console.error('console.* forbidden in mcp/');process.exit(1)} const o=fs.readFileSync('bin/lib/outline.ts','utf8'); if(!/loadOutline/.test(o)){console.error('loadOutline missing');process.exit(1)} const sec=fs.readFileSync('bin/lib/section.ts','utf8'); if(!/loadSection/.test(sec)){console.error('loadSection missing');process.exit(1)} const cap=fs.readFileSync('bin/lib/capabilities.ts','utf8'); if(!/loadCapabilityFacts/.test(cap)){console.error('loadCapabilityFacts missing in bin/lib/capabilities.ts');process.exit(1)} if(!/loadRuntimeConfig/.test(cap)){console.error('bin/lib/capabilities.ts MUST call loadRuntimeConfig (it is the only allowed caller)');process.exit(1)} const st=fs.readFileSync('bin/lib/state.ts','utf8'); for(const fn of ['initSection','advanceSection','setSectionStatus','recordVerification']){if(!new RegExp('export async function '+fn).test(st)){console.error('missing state helper',fn);process.exit(1)}} const p=require('./package.json'); if(!/^\^1\.29/.test(p.dependencies['@modelcontextprotocol/sdk'])){console.error('SDK not pinned at ^1.29');process.exit(1)} console.log('OK')"</automated>
  </verify>
  <acceptance_criteria>
    - `package.json` lists `@modelcontextprotocol/sdk` at `^1.29.x` in `dependencies`.
    - `package.json` lists `zod` at `^3.23.x` or higher in `dependencies`.
    - `package-lock.json` regenerated and committed.
    - `bin/lib/outline.ts` exists and exports `loadOutline(paperRoot: string): Promise<string>`.
    - `bin/lib/section.ts` exists and exports `loadSection(paperRoot: string, n: number): Promise<SectionPayload>`.
    - `bin/lib/state.ts` exports 4 new helpers: `initSection`, `advanceSection`, `setSectionStatus`, `recordVerification`.
    - `bin/lib/schemas/state.ts` exports `StatePatchSchema` (and section-enum types).
    - `mcp/resources.ts` calls `server.registerResource` exactly **5** times for URIs `paper://state`, `paper://outline`, `paper://section/{n}` (templated), `paper://library`, `paper://capabilities`.
    - `mcp/resources.ts` imports `loadCapabilityFacts` from `../bin/lib/capabilities.js` and the paper://capabilities handler is a thin shim that JSON.stringifies its return (D-12 architectural fix from cross-AI review).
    - `mcp/resources.ts` contains zero `loadRuntimeConfig` references and zero `process.env[` references — both are forbidden by D-12 lint inside mcp/.
    - `bin/lib/capabilities.ts` exists and calls `loadRuntimeConfig` plus `process.env[...]` presence checks (the SINGLE non-mcp location authorised to combine these into a capability shape).
    - `paper://capabilities` handler exposes `mcp_self`, `contact_email_set`, `providers`, plus the placeholders `pandoc`, `zotero_mcp`, `humanizer`, `onedrive_detected`, `sync_folder_match` (booleans-or-undefined only; 02-05 will populate the runtime-probe fields). Shape is OWNED by `loadCapabilityFacts`.
    - `npm run lint` passes (all three Wave 1 chokepoints quiet on shipped code).
    - `npm run typecheck` passes.
  </acceptance_criteria>
  <done>
    Resource registry complete with 5 resources. mcp/server.ts in Task 2 will wire this into the
    transport.
  </done>
</task>

<task type="auto">
  <name>Task 2: Write mcp/tools.ts (6 snake_case zod-validated tool handlers) + mcp/server.ts boot</name>
  <files>mcp/tools.ts, mcp/server.ts</files>
  <read_first>
    - `mcp/resources.ts` (just created — same import discipline applies here)
    - `bin/lib/state.ts` (after Task 1 — confirm 4 new helpers + updateState are exported)
    - `bin/lib/checkpoint.ts` lines 138-200 (`recordCheckpoint` signature)
    - `bin/lib/doi.ts` (Phase 1 — DOI normalisation + verifyDoi signature for paper_doi_verify)
    - `bin/lib/capabilities.ts` (will be created in Task 1.5 — `loadCapabilityFacts` is the SINGLE source of capability flags; both paper://capabilities and paper_capability_probe delegate here. D-12 lint forbids `loadRuntimeConfig` and `process.env[` inside `mcp/`.)
    - `bin/lib/schemas/state.ts`, `bin/lib/schemas/checkpoint.ts` (existing zod schemas to re-export from tool inputs)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-RESEARCH.md` § Pitfall 2 (inputSchema flat record, NOT z.object), § Pitfall 7 (no console.*), § MCP SDK v1.29 boot pattern
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-08 (≤30 stmts), D-13 (counts), TIER-02 (the 6 snake_case names — these are LOCKED, do not rename)
  </read_first>
  <action>
    **Step A — create `mcp/tools.ts` with 6 snake_case tools per TIER-02:**

    Define exactly **6 tools** per TIER-02 + D-13. Each handler:
    - Body ≤30 statements (counted in Task 3 by `tests/mcp-server-thin-shim.test.ts`).
    - Per-handler `inputSchema` as a **flat record of zod fields** — NOT `z.object({...})` (Pitfall 2 — SDK auto-wraps).
    - Delegates 100% of work to a `bin/lib/*` chokepoint.
    - Returns `{ content: [{ type: 'text', text: ... }] }` on success.
    - Throws on validation failure (SDK turns this into a JSON-RPC error per protocol — DO NOT swallow).
    - No fs/http imports. No console.*. No computed process.env.

    Required body:

    ```typescript
    // mcp/tools.ts
    //
    // TIER-02 + D-13: exactly 6 snake_case state-mutation tools —
    //   paper_init_section, paper_advance_section, paper_record_verification,
    //   paper_set_status, paper_doi_verify, paper_capability_probe.
    // D-08: each handler body ≤30 stmts (AST-asserted in tests/mcp-server-thin-shim.test.ts).
    // D-06 / Pitfall 2: inputSchema is a flat record { field: z.<type>() } — the SDK
    //       wraps the record in z.object() internally. Passing z.object({...}) makes
    //       the schema double-wrapped and tool args arrive as { value: {...} }.
    //
    // No console.* allowed (D-07 / Pitfall 7 — corrupts stdio MCP frame).

    import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
    import { z } from 'zod';
    import {
      initSection,
      advanceSection,
      setSectionStatus,
      recordVerification,
    } from '../bin/lib/state.js';
    import { verifyDoi } from '../bin/lib/doi.js';
    import { loadCapabilityFacts } from '../bin/lib/capabilities.js';
    import {
      SectionStateSchema,
      SectionStatusSchema,
      VerificationVerdictSchema,
    } from '../bin/lib/schemas/state.js';

    export function registerPaperTools(server: McpServer): void {
      // Tool 1: paper_init_section — initialise a section row in State (idempotent per D-08).
      server.registerTool(
        'paper_init_section',
        {
          title: 'Initialize a new section',
          description: 'Append a new section to state.sections. Idempotent: re-init on existing N returns prior state unchanged.',
          inputSchema: {
            paperRoot: z.string().min(1),
            n: z.number().int().min(1),
            slug: z.string().min(1),
          },
        },
        async ({ paperRoot, n, slug }) => {
          const next = await initSection(paperRoot, n, slug);
          return { content: [{ type: 'text', text: JSON.stringify(next, null, 2) }] };
        },
      );

      // Tool 2: paper_advance_section — transition section state (planned→writing→written→...).
      server.registerTool(
        'paper_advance_section',
        {
          title: 'Advance a section state machine',
          description: 'Transition section[n].state. Idempotent at the natural-key level (same args ⇒ same end state).',
          inputSchema: {
            paperRoot: z.string().min(1),
            n: z.number().int().min(1),
            toState: SectionStateSchema,
          },
        },
        async ({ paperRoot, n, toState }) => {
          const next = await advanceSection(paperRoot, n, toState);
          return { content: [{ type: 'text', text: JSON.stringify(next, null, 2) }] };
        },
      );

      // Tool 3: paper_record_verification — write a verification verdict for a section.
      server.registerTool(
        'paper_record_verification',
        {
          title: 'Record verification verdict',
          description: 'Persist a verifier verdict on section[n].lastVerification.',
          inputSchema: {
            paperRoot: z.string().min(1),
            n: z.number().int().min(1),
            verdict: VerificationVerdictSchema,
          },
        },
        async ({ paperRoot, n, verdict }) => {
          const next = await recordVerification(paperRoot, n, verdict);
          return { content: [{ type: 'text', text: JSON.stringify(next, null, 2) }] };
        },
      );

      // Tool 4: paper_set_status — set section[n].status (pending/in-progress/blocked/done).
      server.registerTool(
        'paper_set_status',
        {
          title: 'Set section status',
          description: 'Update section[n].status. Idempotent.',
          inputSchema: {
            paperRoot: z.string().min(1),
            n: z.number().int().min(1),
            status: SectionStatusSchema,
          },
        },
        async ({ paperRoot, n, status }) => {
          const next = await setSectionStatus(paperRoot, n, status);
          return { content: [{ type: 'text', text: JSON.stringify(next, null, 2) }] };
        },
      );

      // Tool 5: paper_doi_verify — DOI re-fetch + metadata check via Crossref (delegates to bin/lib/doi.ts).
      server.registerTool(
        'paper_doi_verify',
        {
          title: 'Verify a DOI',
          description: 'Re-fetch the DOI via Crossref and return validity + metadata. Thin wrapper around bin/lib/doi.ts::verifyDoi.',
          inputSchema: { doi: z.string().min(1) },
        },
        async ({ doi }) => {
          const result = await verifyDoi(doi);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        },
      );

      // Tool 6: paper_capability_probe — return current capability flags (presence-only; D-12).
      //         Imperative form of paper://capabilities. Same shape, same no-leak invariant.
      //         THIN SHIM: delegates to bin/lib/capabilities.ts::loadCapabilityFacts so the
      //         ONLY caller of loadRuntimeConfig + process.env presence checks lives outside mcp/.
      //         D-12 lint requires zero loadRuntimeConfig + zero process.env[ in this file.
      server.registerTool(
        'paper_capability_probe',
        {
          title: 'Probe runtime capabilities',
          description: 'Return presence-flag booleans for providers and runtime ecosystem (Pandoc/Zotero/humanizer). Never returns secret values.',
          inputSchema: {},
        },
        async () => {
          const facts = await loadCapabilityFacts();
          return { content: [{ type: 'text', text: JSON.stringify(facts, null, 2) }] };
        },
      );
    }
    ```

    **Note about the schemas:** `SectionStateSchema`, `SectionStatusSchema`,
    `VerificationVerdictSchema` should exist already (or be added in Task 1
    Step D) as small `z.enum([...])` declarations. If they don't, define them as:
    ```typescript
    export const SectionStateSchema = z.enum(['planned','writing','written','verifying','verified','failed']);
    export const SectionStatusSchema = z.enum(['pending','in-progress','blocked','done']);
    export const VerificationVerdictSchema = z.enum(['PASS','FAIL','PARTIAL','UNCLEAR']);
    ```
    Do NOT inline a fat zod definition in `mcp/tools.ts` (would push handlers over 30 stmts).

    **Step B — replace the `mcp/server.ts` stub with the real boot:**

    Required body:

    ```typescript
    // mcp/server.ts
    //
    // Entrypoint: stdio MCP server for Pensmith Tier 1.
    //
    // D-02: SDK pinned at @modelcontextprotocol/sdk@^1.29 (NOT v2-alpha).
    // TIER-01 + TIER-02 + D-13: exactly 5 resources + 6 tools (registered via the helpers below).
    // D-07/Pitfall 7: NEVER console.log in this file — corrupts stdio MCP frame.
    //                 Use process.stderr.write or the session-log if diagnostics needed.

    import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
    import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
    import { registerPaperResources } from './resources.js';
    import { registerPaperTools } from './tools.js';

    export function buildServer(): McpServer {
      const server = new McpServer({
        name: 'pensmith',
        version: '0.2.0',
      });
      registerPaperResources(server);
      registerPaperTools(server);
      return server;
    }

    export async function main(): Promise<void> {
      const server = buildServer();
      const transport = new StdioServerTransport();
      await server.connect(transport);
    }

    // CLI-style invocation: `node dist/mcp/server.js` boots and connects.
    // Guarded so importing this module from tests does NOT auto-boot.
    if (import.meta.url === `file://${process.argv[1]}`) {
      void main();
    }
    ```

    Self-check:
    - `grep -c "registerTool(" mcp/tools.ts` returns 6.
    - `grep -c "paper_init_section\\|paper_advance_section\\|paper_record_verification\\|paper_set_status\\|paper_doi_verify\\|paper_capability_probe" mcp/tools.ts` returns at least 6.
    - `grep -cE "inputSchema:\\s*\\{" mcp/tools.ts` returns 6 (one per tool — confirms flat-record pattern; the empty `{}` for paper_capability_probe still counts).
    - `grep -c "z\\.object(" mcp/tools.ts` returns 0 (Pitfall 2 — flat records only at the inputSchema top level).
    - `grep -c "console\\." mcp/tools.ts mcp/server.ts` returns 0.
    - `grep -c "node:fs\\|node:http\\|node:https\\|node:net\\|node:tls\\|node:child_process" mcp/tools.ts mcp/server.ts` returns 0.
    - `grep -c "loadCapabilityFacts" mcp/tools.ts` returns at least 1 (paper_capability_probe delegates via the helper).
    - `grep -c "loadRuntimeConfig" mcp/tools.ts` returns 0 (D-12: forbidden in mcp/ — must be reached only via bin/lib/capabilities.ts).
    - `grep -cE "process\\.env\\[" mcp/tools.ts` returns 0 (D-12 lint: no computed-env access in mcp/).
    - `grep -c "StdioServerTransport" mcp/server.ts` returns at least 1.
    - `grep -c "import.meta.url" mcp/server.ts` returns at least 1 (test-safe boot guard).
    - `npm run lint` passes (chokepoints in 02-01/02/03 fire on nothing here).
    - `npm run typecheck` passes.
    - `npm run build` produces `dist/mcp/server.js`, `dist/mcp/resources.js`, `dist/mcp/tools.js`.
  </action>
  <verify>
    <automated>npm run lint &amp;&amp; npm run typecheck &amp;&amp; npm run build &amp;&amp; node -e "const fs=require('node:fs'); for(const f of ['dist/mcp/server.js','dist/mcp/resources.js','dist/mcp/tools.js']){if(!fs.existsSync(f)){console.error('missing build artifact',f);process.exit(1)}} const t=fs.readFileSync('mcp/tools.ts','utf8'); const rt=(t.match(/registerTool\(/g)||[]).length; if(rt!==6){console.error('expected 6 registerTool, got',rt);process.exit(1)} for(const name of ['paper_init_section','paper_advance_section','paper_record_verification','paper_set_status','paper_doi_verify','paper_capability_probe']){if(!t.includes(name)){console.error('missing tool name',name);process.exit(1)}} if(/z\.object\(/.test(t)){console.error('z.object found in mcp/tools.ts — Pitfall 2 violation');process.exit(1)} if(/loadRuntimeConfig/.test(t)){console.error('D-12: loadRuntimeConfig leaked into mcp/tools.ts');process.exit(1)} if(/process\.env\[/.test(t)){console.error('D-12: computed process.env access in mcp/tools.ts');process.exit(1)} if(!/loadCapabilityFacts/.test(t)){console.error('thin-shim: paper_capability_probe must delegate to loadCapabilityFacts');process.exit(1)} const s=fs.readFileSync('mcp/server.ts','utf8'); if(!/StdioServerTransport/.test(s)){console.error('StdioServerTransport not used');process.exit(1)} if(!/import\.meta\.url/.test(s)){console.error('boot guard missing');process.exit(1)} console.log('OK')"</automated>
  </verify>
  <acceptance_criteria>
    - `mcp/tools.ts` calls `server.registerTool` exactly **6** times for the snake_case names `paper_init_section`, `paper_advance_section`, `paper_record_verification`, `paper_set_status`, `paper_doi_verify`, `paper_capability_probe`.
    - Each `inputSchema` is a flat record literal `{ field: z.<type>(...) }` — no `z.object(...)` at the top level (Pitfall 2).
    - `mcp/server.ts` imports `McpServer` and `StdioServerTransport` from `@modelcontextprotocol/sdk` and wires them in `main()`.
    - `mcp/server.ts` has an `import.meta.url === \`file://${process.argv[1]}\`` boot guard (test imports do not auto-boot).
    - No `node:fs`, `node:http`, `node:https`, `node:net`, `node:tls`, or `node:child_process` imports in either file.
    - No `console.*` calls anywhere in `mcp/`.
    - `mcp/tools.ts` contains zero `loadRuntimeConfig` references and zero `process.env[` references — paper_capability_probe MUST route through `loadCapabilityFacts` (D-12 thin-shim).
    - `npm run build` produces `dist/mcp/server.js`.
    - `npm run lint` + `npm run typecheck` pass.
  </acceptance_criteria>
  <done>
    Real MCP server shipped with the complete TIER-01 + TIER-02 surface (5 resources, 6 snake_case tools). 02-07's tier-contract test can now spawn `dist/mcp/server.js`
    and exercise the full handshake.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Tests — tool zod validation (TIER-06) for 6 tools + ≤30-stmt budget AST walk for 5 resources + 6 tools (D-08)</name>
  <files>tests/mcp-tool-handlers.test.ts, tests/mcp-server-thin-shim.test.ts</files>
  <read_first>
    - `mcp/tools.ts` and `mcp/server.ts` (just created in Task 2)
    - `tests/lint-thin-shim.test.ts` (from 02-01 — the AST-walk statement count idiom, since that lint targets the same property from a different angle)
    - `bin/lib/schemas/state.ts` and `bin/lib/schemas/checkpoint.ts` (for valid + invalid input examples)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-RESEARCH.md` § Pitfall 9 (use official Client + StdioClientTransport — but for TIER-06 here, in-process Server is fine and faster)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-08 (≤30 stmts hard budget), D-13, TIER-06
  </read_first>
  <behavior>
    **`tests/mcp-tool-handlers.test.ts` (TIER-06 — zod input validation):**

    For each of the **6 tools**, at least one positive (valid input) and one negative
    (invalid input) case:
    - Valid input: handler returns `{ content: [{ type: 'text', text: <json> }] }`.
    - Invalid input: the tool registration's input schema rejects the call (the SDK
      raises `McpError` with `code: InvalidParams` or a JSON-RPC error response;
      assert via a thrown / rejected promise OR `isError: true` on the result).

    Use **in-process** server instantiation via `buildServer()` (exported by
    `mcp/server.ts` per Task 2). Drive the call through the SDK's `Client` +
    `InMemoryTransport.createLinkedPair()`. Full `StdioClientTransport`
    lands in 02-07's tier-contract test.

    **`tests/mcp-server-thin-shim.test.ts` (D-08 — ≤30 stmts AST positive case):**

    Parse `mcp/tools.ts` with `@typescript-eslint/parser` (already a dep — used
    in 02-01/02/03). Walk to each `registerTool` call's third argument (the
    handler function expression). Count statements in its body.

    Assert: ALL 6 tool handlers, body.statements.length ≤ 30. Repeat for the
    **5 resource handlers** in `mcp/resources.ts` and assert ≤30 stmts each.
  </behavior>
  <action>
    Create both test files. Skeleton for `tests/mcp-server-thin-shim.test.ts`:

    ```typescript
    // tests/mcp-server-thin-shim.test.ts
    //
    // D-08 positive case: every real handler body in mcp/ is ≤30 statements.
    // The chokepoint LINT (02-01) covers fixtures; this test covers the
    // SHIPPED code. Counts: 5 resources (TIER-01) + 6 tools (TIER-02).

    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { parse } from '@typescript-eslint/parser';

    function countHandlerStmts(filePath: string, registerName: 'registerTool' | 'registerResource'): Array<{ name: string; stmts: number }> {
      const src = readFileSync(filePath, 'utf8');
      const ast = parse(src, { ecmaVersion: 2022, sourceType: 'module', loc: true, range: true });
      const results: Array<{ name: string; stmts: number }> = [];

      function visit(node: any): void {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'CallExpression'
          && node.callee?.type === 'MemberExpression'
          && node.callee.property?.name === registerName) {
          // Last function-shaped argument is the handler.
          const fnArg = [...node.arguments].reverse().find(
            (a: any) => a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression',
          );
          if (fnArg) {
            const body = fnArg.body;
            const stmts = body?.type === 'BlockStatement' ? body.body.length : 1;
            const nameArg = node.arguments[0];
            const name = nameArg?.type === 'Literal' ? String(nameArg.value) : '<unknown>';
            results.push({ name, stmts });
          }
        }
        for (const key of Object.keys(node)) {
          const v = (node as any)[key];
          if (Array.isArray(v)) v.forEach(visit);
          else if (v && typeof v === 'object') visit(v);
        }
      }
      visit(ast);
      return results;
    }

    test('D-08: every mcp/tools.ts handler ≤30 statements (TIER-02 = 6 tools)', () => {
      const handlers = countHandlerStmts('mcp/tools.ts', 'registerTool');
      assert.equal(handlers.length, 6, `expected 6 tools per TIER-02, got ${handlers.length}`);
      for (const h of handlers) {
        assert.ok(h.stmts <= 30, `${h.name}: ${h.stmts} stmts (max 30)`);
      }
    });

    test('D-08: every mcp/resources.ts handler ≤30 statements (TIER-01 = 5 resources)', () => {
      const handlers = countHandlerStmts('mcp/resources.ts', 'registerResource');
      assert.equal(handlers.length, 5, `expected 5 resources per TIER-01 + D-07, got ${handlers.length}`);
      for (const h of handlers) {
        assert.ok(h.stmts <= 30, `${h.name}: ${h.stmts} stmts (max 30)`);
      }
    });
    ```

    Skeleton for `tests/mcp-tool-handlers.test.ts` — covers all 6 tools:

    ```typescript
    // tests/mcp-tool-handlers.test.ts
    //
    // TIER-06: each of the 6 MCP tools parses input via zod. Malformed input is rejected.
    // Uses InMemoryTransport (faster than stdio); the stdio path is covered
    // by 02-07's tier-contract test.

    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { buildServer } from '../mcp/server.js';
    import { Client } from '@modelcontextprotocol/sdk/client/index.js';
    import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
    import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';

    async function pair() {
      const server = buildServer();
      const [clientT, serverT] = InMemoryTransport.createLinkedPair();
      await server.connect(serverT);
      const client = new Client({ name: 'pensmith-test', version: '0.0.0' }, { capabilities: {} });
      await client.connect(clientT);
      return { client, server };
    }

    function freshPaperRoot(): string {
      const root = mkdtempSync(join(tmpdir(), 'pensmith-tool-test-'));
      mkdirSync(join(root, '.paper'), { recursive: true });
      writeFileSync(join(root, '.paper', 'STATE.json'), '{"version":1,"sections":[]}');
      writeFileSync(join(root, '.paper', 'LIBRARY.json'), '{"version":1,"entries":[]}');
      return root;
    }

    function expectError(p: Promise<unknown>) {
      return assert.rejects(p as Promise<never>).catch(() => {
        // Some SDK versions return result.isError instead of rejecting; both forms acceptable.
      });
    }

    // ===== paper_init_section =====
    test('TIER-06: paper_init_section accepts valid input', async () => {
      const { client } = await pair();
      const root = freshPaperRoot();
      const res = await client.callTool({ name: 'paper_init_section', arguments: { paperRoot: root, n: 1, slug: 'intro' } });
      assert.ok(Array.isArray(res.content));
    });
    test('TIER-06: paper_init_section rejects missing slug', async () => {
      const { client } = await pair();
      const root = freshPaperRoot();
      await assert.rejects(client.callTool({ name: 'paper_init_section', arguments: { paperRoot: root, n: 1 } }));
    });
    test('TIER-06: paper_init_section rejects n=0', async () => {
      const { client } = await pair();
      const root = freshPaperRoot();
      await assert.rejects(client.callTool({ name: 'paper_init_section', arguments: { paperRoot: root, n: 0, slug: 'intro' } }));
    });

    // ===== paper_advance_section =====
    test('TIER-06: paper_advance_section rejects invalid toState', async () => {
      const { client } = await pair();
      const root = freshPaperRoot();
      await assert.rejects(client.callTool({ name: 'paper_advance_section', arguments: { paperRoot: root, n: 1, toState: 'BOGUS' } }));
    });
    test('TIER-06: paper_advance_section accepts valid state transition', async () => {
      const { client } = await pair();
      const root = freshPaperRoot();
      await client.callTool({ name: 'paper_init_section', arguments: { paperRoot: root, n: 1, slug: 'intro' } });
      const res = await client.callTool({ name: 'paper_advance_section', arguments: { paperRoot: root, n: 1, toState: 'writing' } });
      assert.ok(Array.isArray(res.content));
    });

    // ===== paper_record_verification =====
    test('TIER-06: paper_record_verification rejects malformed verdict', async () => {
      const { client } = await pair();
      const root = freshPaperRoot();
      await assert.rejects(client.callTool({ name: 'paper_record_verification', arguments: { paperRoot: root, n: 1, verdict: 'NOT_A_VERDICT' } }));
    });

    // ===== paper_set_status =====
    test('TIER-06: paper_set_status rejects invalid status', async () => {
      const { client } = await pair();
      const root = freshPaperRoot();
      await assert.rejects(client.callTool({ name: 'paper_set_status', arguments: { paperRoot: root, n: 1, status: 'BOGUS' } }));
    });
    test('TIER-06: paper_set_status accepts valid status', async () => {
      const { client } = await pair();
      const root = freshPaperRoot();
      await client.callTool({ name: 'paper_init_section', arguments: { paperRoot: root, n: 1, slug: 'intro' } });
      const res = await client.callTool({ name: 'paper_set_status', arguments: { paperRoot: root, n: 1, status: 'in-progress' } });
      assert.ok(Array.isArray(res.content));
    });

    // ===== paper_doi_verify =====
    test('TIER-06: paper_doi_verify rejects empty doi', async () => {
      const { client } = await pair();
      await assert.rejects(client.callTool({ name: 'paper_doi_verify', arguments: { doi: '' } }));
    });
    test('TIER-06: paper_doi_verify rejects missing doi', async () => {
      const { client } = await pair();
      await assert.rejects(client.callTool({ name: 'paper_doi_verify', arguments: {} }));
    });
    // NOTE: a *valid* paper_doi_verify positive case would require a Crossref cassette;
    // 02-07's tier-contract test covers the live-handshake form. Here we only assert
    // the zod gate; success path is exercised in 02-07.

    // ===== paper_capability_probe =====
    test('TIER-06: paper_capability_probe accepts empty args', async () => {
      const { client } = await pair();
      const res = await client.callTool({ name: 'paper_capability_probe', arguments: {} });
      assert.ok(Array.isArray(res.content));
      const payload = JSON.parse(res.content[0].text);
      assert.equal(typeof payload.mcp_self, 'boolean');
      assert.equal(typeof payload.contact_email_set, 'boolean');
      assert.ok(Array.isArray(payload.providers));
      // D-12 invariant: no secret values leaked.
      const flat = JSON.stringify(payload);
      assert.equal(/sk-[a-zA-Z0-9]/.test(flat), false, 'no API-key-shaped strings in capability probe output');
    });
    ```

    Notes:
    - The exact import path for `InMemoryTransport` in MCP SDK v1.29 is
      `@modelcontextprotocol/sdk/inMemory.js` — verify against the locally
      installed package after `npm install` lands in Task 1; correct the import
      if the SDK exports it elsewhere.
    - If `Client.callTool({ arguments: {} })` returns a `result` object with
      `isError: true` rather than throwing, assert on `res.isError === true`
      instead of `assert.rejects`. Match whichever surface the SDK actually
      presents — do NOT loosen the test if both forms are available.
    - Run with `node scripts/run-tests.mjs tests/mcp-tool-handlers.test.ts tests/mcp-server-thin-shim.test.ts`.
  </action>
  <verify>
    <automated>node scripts/run-tests.mjs tests/mcp-server-thin-shim.test.ts tests/mcp-tool-handlers.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/mcp-server-thin-shim.test.ts` exists and asserts ≤30 stmts on all 11 handlers (5 resources + 6 tools).
    - `tests/mcp-tool-handlers.test.ts` exists with at least 1 positive + 1 negative case across all 6 tools (≥12 cases total).
    - Both files run green under `node scripts/run-tests.mjs ...`.
    - `npm run lint` continues to pass.
    - `grep -c "InMemoryTransport" tests/mcp-tool-handlers.test.ts` returns at least 1.
    - The AST-walk test correctly identifies 5 resource handlers + 6 tool handlers (asserts `handlers.length === 5` and `=== 6` respectively).
    - The paper_capability_probe test asserts no API-key-shaped strings escape (D-12 runtime defence).
  </acceptance_criteria>
  <done>
    TIER-01 (5 resources), TIER-02 (6 snake_case tools), TIER-06 (zod input validation),
    and the D-08 ≤30-stmt positive case are all proven against the shipped code.
    (Server-boots-over-stdio is exercised live by 02-07; ARCH-18 is the controlling Phase 2 requirement.)
    Plan 02-07 (tier-contract) will exercise the same surface over real stdio.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Tests — bin/lib/capabilities.ts shape + sentinel-value no-leak (D-12)</name>
  <files>tests/capabilities.test.ts</files>
  <read_first>
    - `bin/lib/capabilities.ts` (just created in Task 1 Step F)
    - `bin/lib/runtime.ts` (the underlying source of provider list)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-12, T-01-07
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-REVIEWS.md` § Codex HIGH on capabilities helper extraction
  </read_first>
  <behavior>
    Sentinel-value test: set `process.env[ANTHROPIC_API_KEY] = 'PROCESS-ENV-SENTINEL-DO-NOT-LEAK-${nonce}'`,
    invoke `loadCapabilityFacts()`, assert (a) `providers[*].present === true` for that name,
    (b) the sentinel string does NOT appear anywhere in `JSON.stringify(facts)`. Repeat for
    `PENSMITH_CONTACT_EMAIL`. This proves the helper is structurally incapable of leaking
    a secret value via the capability shape — the same property D-12 lint enforces in mcp/.

    Shape test: assert `mcp_self === true`, `typeof contact_email_set === 'boolean'`,
    `Array.isArray(providers)`, every provider entry has exactly `{ name, api_key_env, present }`
    keys, and the Phase 2 placeholders (`pandoc`, `zotero_mcp`, `humanizer`, `onedrive_detected`,
    `sync_folder_match`) are present and `=== undefined`.
  </behavior>
  <action>
    Required body:

    ```typescript
    // tests/capabilities.test.ts
    //
    // D-12 sentinel test (cross-AI review HIGH from Codex): proves
    // bin/lib/capabilities.ts::loadCapabilityFacts cannot leak resolved
    // env values into the capability shape. Symmetric to T-01-07 / T-02-04-02
    // mitigations on the mcp/ side.

    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { loadCapabilityFacts } from '../bin/lib/capabilities.js';

    function withEnv(overrides: Record<string, string>, fn: () => Promise<void>): Promise<void> {
      const prior: Record<string, string | undefined> = {};
      for (const k of Object.keys(overrides)) prior[k] = process.env[k];
      Object.assign(process.env, overrides);
      return fn().finally(() => {
        for (const k of Object.keys(prior)) {
          if (prior[k] === undefined) delete process.env[k];
          else process.env[k] = prior[k];
        }
      });
    }

    test('D-12: capability shape is stable (mcp_self, contact_email_set, providers, placeholders)', async () => {
      const facts = await loadCapabilityFacts();
      assert.equal(facts.mcp_self, true);
      assert.equal(typeof facts.contact_email_set, 'boolean');
      assert.ok(Array.isArray(facts.providers));
      for (const p of facts.providers) {
        assert.deepEqual(Object.keys(p).sort(), ['api_key_env', 'name', 'present']);
        assert.equal(typeof p.present, 'boolean');
      }
      // Phase 2 placeholders: present-but-undefined so 02-05 can populate without shape drift.
      for (const k of ['pandoc', 'zotero_mcp', 'humanizer', 'onedrive_detected', 'sync_folder_match'] as const) {
        assert.equal((facts as Record<string, unknown>)[k], undefined);
      }
    });

    test('D-12: sentinel API-key value never appears in serialized capability facts', async () => {
      const sentinel = `PROCESS-ENV-SENTINEL-DO-NOT-LEAK-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await withEnv({ ANTHROPIC_API_KEY: sentinel, PENSMITH_CONTACT_EMAIL: 'reviewer@example.test' }, async () => {
        const facts = await loadCapabilityFacts();
        const serialized = JSON.stringify(facts);
        assert.equal(serialized.includes(sentinel), false, 'sentinel value leaked into capability output');
        assert.equal(serialized.includes('reviewer@example.test'), false, 'contact-email value leaked into capability output');
        // But the presence flags MUST flip to true.
        const anth = facts.providers.find((p) => p.api_key_env === 'ANTHROPIC_API_KEY');
        if (anth) assert.equal(anth.present, true, 'ANTHROPIC_API_KEY presence flag should be true when env set');
        assert.equal(facts.contact_email_set, true);
      });
    });

    test('D-12: missing env yields presence=false (no exception, no value leak)', async () => {
      await withEnv({}, async () => {
        delete process.env.PENSMITH_CONTACT_EMAIL;
        const facts = await loadCapabilityFacts();
        assert.equal(facts.contact_email_set, false);
      });
    });
    ```

    Self-check:
    - `node scripts/run-tests.mjs tests/capabilities.test.ts` — all green.
    - `grep -c "PROCESS-ENV-SENTINEL-DO-NOT-LEAK" tests/capabilities.test.ts` returns at least 1.
    - `grep -c "JSON.stringify" tests/capabilities.test.ts` returns at least 1 (proof the leak test exercises the serialization path that mcp/ uses).
  </action>
  <verify>
    <automated>node scripts/run-tests.mjs tests/capabilities.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/capabilities.test.ts` exists with at least 3 cases (shape, sentinel-leak, missing-env).
    - The sentinel test asserts the random sentinel string does NOT appear in the serialized output (D-12 runtime invariant).
    - The shape test pins the Phase 2 placeholder fields (so 02-05 cannot accidentally drift the shape).
    - All cases run green under `node scripts/run-tests.mjs`.
  </acceptance_criteria>
  <done>
    Capabilities helper proven leak-free at runtime — symmetric to D-12's
    static lint signal in mcp/. 02-07 tier-contract assertions can rely on
    the sentinel invariant when comparing tier outputs (Case D in 02-07 Wave 4).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| MCP client (Claude Code / external) → mcp/server.ts | Untrusted input on every `callTool` and `readResource` request — zod parsing is the gate |
| mcp/ handlers → bin/lib/* chokepoints | Handlers MUST NOT bypass paths.ts / lock.ts / atomic-write.ts; D-09 lint enforces |
| paper://capabilities resource → MCP client | Resource content is observable; presence flags must NEVER contain a resolved secret value (D-12 lint enforces) |
| paper://section/{N} template variable → loadSection | URI parameter is attacker-controlled; must coerce to integer + bounds-check (no fs path traversal) |
| dist/mcp/server.js stdout → MCP client framing | Any stray `console.log` corrupts the JSON-RPC frame (Pitfall 7); D-07 lint enforces |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-04-01 | Tampering | `paper_advance_section` / `paper_set_status` tools accept arbitrary inputs and corrupt STATE.json | mitigate | `SectionStateSchema` / `SectionStatusSchema` (zod enums) gate the input. `updateState()` in bin/lib/state.ts performs atomic write via lock.ts (Phase 1 chokepoint). Idempotency: re-applying same args yields same end state. |
| T-02-04-02 | Information Disclosure | `paper://capabilities` or `paper_capability_probe` accidentally emits `process.env.OPENALEX_API_KEY` (the value, not the flag) | mitigate | Architectural fix per cross-AI review: capability composition lives in `bin/lib/capabilities.ts::loadCapabilityFacts`. Both mcp/ handlers are thin shims that delegate + JSON.stringify the return — they never see the raw env values. D-12 lint (from 02-03) is therefore maximally tight in `mcp/**/*.ts` (zero `loadRuntimeConfig`, zero `process.env[...]` permitted) without runtime exceptions. The sentinel test in Task 4 (`tests/capabilities.test.ts`) plus the API-key-shape test in Task 3 (`tests/mcp-tool-handlers.test.ts`) prove the runtime invariant on both sides. T-01-07 symmetric defence. |
| T-02-04-03 | Denial of Service | `console.log` in a handler corrupts stdio framing → MCP session hangs | mitigate | D-07 lint flags all `console.*` calls in `mcp/`. Handlers use `process.stderr.write` if diagnostics absolutely needed. |
| T-02-04-04 | Repudiation | `paper_record_verification` accepts a malformed verdict and silently drops it | mitigate | `VerificationVerdictSchema` (zod enum) rejects malformed input → SDK raises `InvalidParams` JSON-RPC error → client sees the failure. TIER-06 test in this plan proves it. |
| T-02-04-05 | Elevation of Privilege | A tool handler imports `node:fs` and bypasses `paths.ts` sandboxing | mitigate | D-09 lint (from 02-01) flags all `node:fs` imports in `mcp/**/*.ts`. The handlers delegate through bin/lib/{outline,section,state,library,checkpoint,runtime,doi} chokepoints which respect paperDir() containment. |
| T-02-04-06 | Spoofing | An attacker reconfigures the MCP transport to HTTP and intercepts traffic | mitigate | D-10 lint (from 02-02) flags `http.createServer`, `tls.createServer`, raw `new Server()`. Transport is hardcoded to `StdioServerTransport` in `mcp/server.ts`. |
| T-02-04-07 | Tampering / Information Disclosure | `paper://section/{N}` URI parameter `n` is attacker-supplied; if treated as raw fs path, enables traversal | mitigate | `n` is coerced to `Number(vars.n)`, validated with `Number.isInteger(n) && n >= 1`. `loadSection` joins ONLY `paperRoot/sections/<NN>-<slug>` where `NN` is `String(n).padStart(2,'0')` — no user-controlled string flows into the path component. |
| T-02-04-08 | Information Disclosure | A future hand-rolled `inputSchema: z.object({...})` (Pitfall 2) causes args to arrive double-wrapped, and the handler logs the raw payload trying to debug it | mitigate | The grep-checkable acceptance criterion `grep -c "z.object(" mcp/tools.ts == 0` catches this at PR-review time. Plus D-07 prevents the logging branch anyway. |

Security domain: V4 Access Control (user-space, D-19 doctor read-only — but this plan is the server, not doctor), V5 Input Validation (zod on every tool), V14 Configuration (capabilities-no-leak, D-12).
</threat_model>

<verification>
After all four tasks:

1. `npm run build` produces `dist/mcp/server.js` AND `dist/mcp/resources.js` AND `dist/mcp/tools.js` AND `dist/bin/lib/capabilities.js`.
2. `node scripts/run-tests.mjs tests/mcp-server-thin-shim.test.ts tests/mcp-tool-handlers.test.ts tests/capabilities.test.ts` — all tests green.
3. `npm run lint` passes (none of the Wave 1 chokepoints fire on the shipped code).
4. `npm run typecheck` passes.
5. `grep -c "registerResource(" mcp/resources.ts` == 5.
6. `grep -c "ResourceTemplate(" mcp/resources.ts` == 1 (for paper://section/{n}).
7. `grep -c "registerTool(" mcp/tools.ts` == 6.
8. Each TIER-02 snake_case name (`paper_init_section`, `paper_advance_section`, `paper_record_verification`, `paper_set_status`, `paper_doi_verify`, `paper_capability_probe`) appears at least once in `mcp/tools.ts`.
9. `grep -c "z.object(" mcp/tools.ts` == 0 (Pitfall 2 — flat-record inputSchema only).
10. `grep -c "console\\." mcp/server.ts mcp/resources.ts mcp/tools.ts` == 0.
11. `grep -c "loadCapabilityFacts" mcp/resources.ts mcp/tools.ts` >= 2 (D-12 thin-shim: BOTH handlers delegate to the bin/lib helper).
12. `grep -c "loadRuntimeConfig" mcp/resources.ts mcp/tools.ts` == 0 (D-12 architectural fix: mcp/ never touches runtime.ts directly).
13. `grep -cE "process\\.env\\[" mcp/resources.ts mcp/tools.ts` == 0 (D-12: no computed env access in mcp/).
14. `grep -c "export async function loadCapabilityFacts" bin/lib/capabilities.ts` == 1 (the SINGLE composition site).
15. `grep -c "loadRuntimeConfig" bin/lib/capabilities.ts` >= 1 (this IS the authorised consumer).
16. `node dist/mcp/server.js` (manually, with stdin closed) exits cleanly within ~1s — boot guard fires, transport survives empty session.
</verification>

<success_criteria>
- TIER-01: 5 paper:// resources (state, outline, section/{N}, library, capabilities) registered.
- TIER-02: 6 snake_case state-mutation tools (paper_init_section, paper_advance_section, paper_record_verification, paper_set_status, paper_doi_verify, paper_capability_probe) registered.
- TIER-06: every tool handler parses input via zod (asserted by tests in this plan).
- ARCH-18 / D-08: every handler body ≤30 stmts (asserted by AST-walk test in this plan).
- D-13: exactly 5 resources, exactly 6 tools — grep-counted.
- D-02: SDK pinned at `^1.29.x` in package.json.
- D-12: capabilities resource AND paper_capability_probe tool both emit only boolean presence flags. Composition lives in `bin/lib/capabilities.ts::loadCapabilityFacts` (single non-mcp source); both mcp/ handlers are thin shims. Lint-enforced (mcp/ has zero loadRuntimeConfig + zero process.env[) + grep-verified + runtime-tested via sentinel-leak test in `tests/capabilities.test.ts`.
- All three Wave 1 chokepoints (D-09, D-10, D-12) are silent on the shipped code — proof the handlers are thin shims by construction.
</success_criteria>

<output>
After completion, create `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-04-SUMMARY.md`.
</output>
