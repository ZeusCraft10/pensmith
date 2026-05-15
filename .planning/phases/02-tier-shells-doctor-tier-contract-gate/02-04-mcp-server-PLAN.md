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
  - tests/mcp-tool-handlers.test.ts
  - tests/mcp-server-thin-shim.test.ts
autonomous: true
requirements: [ARCH-18, TIER-05, TIER-06]
must_haves:
  truths:
    - "MCP server boots over stdio and registers exactly 4 resources and 4 tools"
    - "Each tool handler in mcp/tools.ts is ≤30 statements (AST-counted) — D-08 hard budget"
    - "Capabilities resource emits only presence-flag booleans, never a resolved key value (D-12 runtime behavior, lint-enforced in 02-03)"
    - "All 4 tool handlers parse input via per-handler zod shapes (TIER-06)"
    - "Server passes its own lints — no fs / no http / no console.* / no computed process.env / no inline runtime-helper calls"
  artifacts:
    - path: "mcp/server.ts"
      provides: "Boot + StdioServerTransport wiring + registerResource/registerTool calls"
      contains: "McpServer"
    - path: "mcp/resources.ts"
      provides: "4 paper:// resource definitions (state, outline, library, capabilities)"
    - path: "mcp/tools.ts"
      provides: "4 tool handlers (state.read, state.update, library.read, checkpoint.append) each ≤30 stmts"
    - path: "tests/mcp-tool-handlers.test.ts"
      provides: "Per-tool zod validation tests (TIER-06 — malformed input rejected)"
    - path: "tests/mcp-server-thin-shim.test.ts"
      provides: "AST-walk positive case: each real handler body's stmt count ≤30 (TIER-05 / ARCH-18 / D-08)"
  key_links:
    - from: "mcp/server.ts"
      to: "@modelcontextprotocol/sdk@^1.29"
      via: "import { McpServer, StdioServerTransport }"
      pattern: "McpServer.*StdioServerTransport"
    - from: "mcp/tools.ts handlers"
      to: "bin/lib/state.ts, bin/lib/library.ts, bin/lib/checkpoint.ts"
      via: "thin delegation — handler reads/writes via these chokepoints"
      pattern: "import.*from\\s+'\\.\\./bin/lib/(state|library|checkpoint)"
    - from: "mcp/resources.ts paper://capabilities"
      to: "presence-flag booleans"
      via: "process.env.<NAME> !== undefined — static dot-access only (D-12)"
      pattern: "process\\.env\\.[A-Z_]+\\s*!==\\s*undefined"
---

<objective>
Ship the real `mcp/server.ts` — boots `McpServer` over `StdioServerTransport`, registers
the 4 paper:// resources (`paper://state`, `paper://outline`, `paper://library`,
`paper://capabilities`), and registers the 4 tools (`state.read`, `state.update`,
`library.read`, `checkpoint.append`) with zod-validated inputs.

Purpose: TIER-05 (server boots over stdio with 4 resources + 4 tools), TIER-06 (every
tool handler parses input via zod), ARCH-18 (handlers ≤30 stmts, no fs/http imports —
enforced by the chokepoints landed in 02-01/02/03). This is the load-bearing artifact of
Wave 2 — every subsequent tier-contract assertion (02-07) and every doctor probe that
references `dist/mcp/server.js` (02-05 DOCT-02, 02-07 DOCT-05) depends on it existing.

Output: a stdio MCP server that survives `tsc --noEmit`, passes `npm run lint`
(including all three Wave 1 chokepoints), and exposes the contract that 02-07's
tier-contract test will black-box against using the official `Client` + `StdioClientTransport`.
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
@bin/lib/schemas/state.ts
@bin/lib/schemas/library.ts
@bin/lib/schemas/checkpoint.ts

<interfaces>
<!-- MCP SDK v1.29 surface (D-02 lock). Pattern source: RESEARCH § MCP SDK v1.29 -->
<!-- Pitfall 2: inputSchema is a flat record of zod fields, NOT z.object(...). -->

```typescript
// From @modelcontextprotocol/sdk@^1.29 (D-02 — locked, NOT v2-alpha):
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Resource registration shape:
server.registerResource(
  'state',                                  // logical name
  'paper://state',                          // URI
  { title: '...', mimeType: 'application/json' },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(...) }]
  }),
);

// Tool registration shape:
server.registerTool(
  'state.read',
  {
    title: 'Read state',
    description: '...',
    inputSchema: { paperRoot: z.string() },  // <-- flat record, NOT z.object({...})
  },
  async ({ paperRoot }) => ({
    content: [{ type: 'text', text: JSON.stringify(await loadState(paperRoot)) }],
  }),
);
```

<!-- Existing in-repo chokepoints the handlers MUST delegate to: -->

```typescript
// bin/lib/state.ts
export async function loadState(paperRoot: string): Promise<State>
export async function updateState(paperRoot: string, mutator: (s: State) => State): Promise<State>

// bin/lib/library.ts
export async function loadLibrary(paperRoot: string): Promise<Library>

// bin/lib/checkpoint.ts
export async function recordCheckpoint(paperRoot: string, entry: CheckpointEntry): Promise<Checkpoint>

// bin/lib/paths.ts — paperRoot resolution; do NOT call fs.* directly in mcp/
export function paperDir(opts?: { paperRoot?: string }): string

// bin/lib/schemas/state.ts, library.ts, checkpoint.ts — already shipped zod schemas
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Pin @modelcontextprotocol/sdk@^1.29 and write mcp/resources.ts</name>
  <files>package.json, mcp/resources.ts</files>
  <read_first>
    - `package.json` in full (existing dependencies, scripts)
    - `bin/lib/state.ts` lines 191-300 (`loadState` signature)
    - `bin/lib/library.ts` lines 214-260 (`loadLibrary` signature)
    - `bin/lib/paths.ts` (paperDir + outline path conventions)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-RESEARCH.md` § MCP SDK v1.29 patterns + § Pitfall 2 + § Pitfall 7
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-02 (SDK version lock), D-12 (capabilities-no-leak), D-13 (4 resources, 4 tools)
  </read_first>
  <action>
    **Step A — pin the SDK in `package.json`:**

    Add `"@modelcontextprotocol/sdk": "^1.29.0"` to `dependencies` (NOT
    `devDependencies`). Per **D-02 lock**: pin minor at `^1.29.0` (NOT
    `^2.0.0-alpha.*`, NOT `latest`). If `zod` is not already a top-level
    dependency, add `"zod": "^3.23.0"` to `dependencies` (the SDK declares it
    as a peer dep). After edit, run `npm install` so `package-lock.json`
    updates in the same commit.

    Self-check: `node -e "const p=require('./package.json'); if(!/^\\^1\\.29/.test(p.dependencies['@modelcontextprotocol/sdk'])){process.exit(1)}"` exits 0.

    **Step B — create `mcp/resources.ts`:**

    Export a single function `registerPaperResources(server: McpServer)` that
    calls `server.registerResource(...)` exactly 4 times — once per
    paper:// resource. Each handler is a thin lambda (≤30 stmts, D-08) that
    delegates to a `bin/lib/*` chokepoint. **No fs imports. No console.*. No
    computed process.env. No inline runtime.ts helper calls** (all three Wave
    1 chokepoints will fire if violated).

    Required body (concrete — D-12, D-13, and the 4 URIs are locked):

    ```typescript
    // mcp/resources.ts
    //
    // D-13: exactly 4 paper:// resources.
    // D-12: paper://capabilities emits PRESENCE FLAGS only — never a resolved
    //       env value. Static dot-access only (`process.env.OPENALEX_API_KEY`),
    //       coerced to boolean before emit.
    // D-08: each handler body ≤30 statements (AST-counted in tests/mcp-server-thin-shim.test.ts).
    // D-07/Pitfall 7: no console.* in this file — would corrupt stdio MCP frame.

    import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
    import { loadState } from '../bin/lib/state.js';
    import { loadLibrary } from '../bin/lib/library.js';
    import { paperDir } from '../bin/lib/paths.js';
    import { readFile } from 'node:fs/promises';
    //  ^^^^^^^^ NOTE: this single fs import in mcp/resources.ts triggers D-09
    //  unless mcp/resources.ts is explicitly carved out, OR we delegate the
    //  outline read to a new bin/lib helper. Per D-21 (default fix = make
    //  tiers agree), executor MUST take option B: create
    //  `bin/lib/outline.ts` with `export async function loadOutline(paperRoot: string): Promise<string>`
    //  and remove the fs import from this file.

    export function registerPaperResources(server: McpServer): void {
      server.registerResource(
        'state',
        'paper://state',
        {
          title: 'Paper state',
          description: 'Current section status, milestones, and verification flags.',
          mimeType: 'application/json',
        },
        async (uri) => {
          const root = paperDir();
          const state = await loadState(root);
          return {
            contents: [{
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(state, null, 2),
            }],
          };
        },
      );

      server.registerResource(
        'outline',
        'paper://outline',
        {
          title: 'Paper outline',
          description: 'Approved outline markdown.',
          mimeType: 'text/markdown',
        },
        async (uri) => {
          const root = paperDir();
          const outline = await loadOutline(root);  // <-- bin/lib/outline.ts (Step C)
          return {
            contents: [{
              uri: uri.href,
              mimeType: 'text/markdown',
              text: outline,
            }],
          };
        },
      );

      server.registerResource(
        'library',
        'paper://library',
        {
          title: 'Citation library',
          description: 'All cited works with DOI verification status.',
          mimeType: 'application/json',
        },
        async (uri) => {
          const root = paperDir();
          const library = await loadLibrary(root);
          return {
            contents: [{
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(library, null, 2),
            }],
          };
        },
      );

      server.registerResource(
        'capabilities',
        'paper://capabilities',
        {
          title: 'Runtime capability flags',
          description: 'Presence flags only — NEVER resolved key values (D-12).',
          mimeType: 'application/json',
        },
        async (uri) => {
          // D-12: every field MUST be a boolean. Do NOT include the env value.
          const capabilities = {
            openalexApiKey: process.env.OPENALEX_API_KEY !== undefined,
            anthropicApiKey: process.env.ANTHROPIC_API_KEY !== undefined,
            openaiApiKey: process.env.OPENAI_API_KEY !== undefined,
            pensmithContactEmail: process.env.PENSMITH_CONTACT_EMAIL !== undefined,
          };
          return {
            contents: [{
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(capabilities, null, 2),
            }],
          };
        },
      );
    }
    ```

    **Step C — create `bin/lib/outline.ts`** (per D-21 fix-the-tiers, not normalize):

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

    After Step C, remove the `import { readFile } from 'node:fs/promises'`
    placeholder from `mcp/resources.ts` and replace with
    `import { loadOutline } from '../bin/lib/outline.js'`.

    Self-check after all three steps:
    - `grep -c "registerResource" mcp/resources.ts` returns 4.
    - `grep -c "node:fs\|node:http\|node:https\|node:net\|node:tls\|node:child_process" mcp/resources.ts` returns 0.
    - `grep -c "console\." mcp/resources.ts` returns 0.
    - `grep -cE "process\.env\.[A-Z_]+\s*!==\s*undefined" mcp/resources.ts` returns 4 (one per capability).
    - `grep -c "process.env\[" mcp/resources.ts` returns 0 (computed forbidden).
    - `npm run lint` exits 0 (all three Wave 1 chokepoints + project-wide selectors pass).
  </action>
  <verify>
    <automated>npm run lint &amp;&amp; node -e "const fs=require('node:fs'); const r=fs.readFileSync('mcp/resources.ts','utf8'); const reg=(r.match(/registerResource\(/g)||[]).length; if(reg!==4){console.error('expected 4 registerResource calls, got',reg);process.exit(1)} const caps=(r.match(/process\.env\.[A-Z_]+\s*!==\s*undefined/g)||[]).length; if(caps<4){console.error('expected >=4 capability flags, got',caps);process.exit(1)} if(/process\.env\[/.test(r)){console.error('computed process.env[] forbidden');process.exit(1)} if(/console\./.test(r)){console.error('console.* forbidden in mcp/');process.exit(1)} const o=fs.readFileSync('bin/lib/outline.ts','utf8'); if(!/loadOutline/.test(o)){console.error('loadOutline missing');process.exit(1)} const p=require('./package.json'); if(!/^\^1\.29/.test(p.dependencies['@modelcontextprotocol/sdk'])){console.error('SDK not pinned at ^1.29');process.exit(1)} console.log('OK')"</automated>
  </verify>
  <acceptance_criteria>
    - `package.json` lists `@modelcontextprotocol/sdk` at `^1.29.x` in `dependencies` (NOT devDependencies, NOT `^2.x` alpha).
    - `package.json` lists `zod` at `^3.23.x` or higher in `dependencies`.
    - `package-lock.json` regenerated and committed.
    - `mcp/resources.ts` calls `server.registerResource` exactly 4 times for URIs `paper://state`, `paper://outline`, `paper://library`, `paper://capabilities`.
    - `paper://capabilities` handler exposes exactly the keys `openalexApiKey`, `anthropicApiKey`, `openaiApiKey`, `pensmithContactEmail`, each as a boolean.
    - `bin/lib/outline.ts` exists and exports `loadOutline(paperRoot: string): Promise<string>`.
    - `npm run lint` passes.
    - `npm run typecheck` passes.
  </acceptance_criteria>
  <done>
    Resource registry committed. mcp/server.ts in Task 2 will wire this into the
    transport.
  </done>
</task>

<task type="auto">
  <name>Task 2: Write mcp/tools.ts (4 zod-validated tool handlers) + mcp/server.ts boot</name>
  <files>mcp/tools.ts, mcp/server.ts</files>
  <read_first>
    - `mcp/resources.ts` (just created — same import discipline applies here)
    - `bin/lib/state.ts` lines 267-end (`updateState` signature + how mutators compose)
    - `bin/lib/checkpoint.ts` lines 138-200 (`recordCheckpoint` signature)
    - `bin/lib/schemas/state.ts`, `bin/lib/schemas/library.ts`, `bin/lib/schemas/checkpoint.ts` (existing zod schemas to re-export from tool inputs)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-RESEARCH.md` § Pitfall 2 (inputSchema flat record, NOT z.object), § Pitfall 7 (no console.*), § MCP SDK v1.29 boot pattern
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-08 (≤30 stmts), D-13 (4 tools)
  </read_first>
  <action>
    **Step A — create `mcp/tools.ts`:**

    Define exactly 4 tools per D-13. Each handler:
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
    // D-13: exactly 4 tools — state.read, state.update, library.read, checkpoint.append.
    // D-08: each handler body ≤30 stmts (AST-asserted in tests/mcp-server-thin-shim.test.ts).
    // D-06 / Pitfall 2: inputSchema is a flat record { field: z.<type>() } — the SDK
    //       wraps the record in z.object() internally. Passing z.object({...}) makes
    //       the schema double-wrapped and tool args arrive as { value: {...} }.
    //
    // No console.* allowed (D-07 / Pitfall 7 — corrupts stdio MCP frame).

    import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
    import { z } from 'zod';
    import { loadState, updateState } from '../bin/lib/state.js';
    import { loadLibrary } from '../bin/lib/library.js';
    import { recordCheckpoint } from '../bin/lib/checkpoint.js';
    import { CheckpointEntrySchema } from '../bin/lib/schemas/checkpoint.js';
    import { StatePatchSchema } from '../bin/lib/schemas/state.js';

    export function registerPaperTools(server: McpServer): void {
      // Tool 1: state.read — reads State from paper root.
      server.registerTool(
        'state.read',
        {
          title: 'Read paper state',
          description: 'Returns the current State document for the given paper root.',
          inputSchema: { paperRoot: z.string().min(1) },
        },
        async ({ paperRoot }) => {
          const state = await loadState(paperRoot);
          return {
            content: [{ type: 'text', text: JSON.stringify(state, null, 2) }],
          };
        },
      );

      // Tool 2: state.update — idempotent merge of a State patch.
      server.registerTool(
        'state.update',
        {
          title: 'Update paper state',
          description: 'Applies a State patch (idempotent merge). Returns the post-update state.',
          inputSchema: {
            paperRoot: z.string().min(1),
            patch: StatePatchSchema,
          },
        },
        async ({ paperRoot, patch }) => {
          const updated = await updateState(paperRoot, (prev) => ({ ...prev, ...patch }));
          return {
            content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }],
          };
        },
      );

      // Tool 3: library.read — reads citation library.
      server.registerTool(
        'library.read',
        {
          title: 'Read citation library',
          description: 'Returns the citation library (entries + DOI verification status).',
          inputSchema: { paperRoot: z.string().min(1) },
        },
        async ({ paperRoot }) => {
          const library = await loadLibrary(paperRoot);
          return {
            content: [{ type: 'text', text: JSON.stringify(library, null, 2) }],
          };
        },
      );

      // Tool 4: checkpoint.append — append-only, sequence-numbered checkpoint log.
      server.registerTool(
        'checkpoint.append',
        {
          title: 'Append checkpoint',
          description: 'Appends an immutable checkpoint entry to the project log.',
          inputSchema: {
            paperRoot: z.string().min(1),
            entry: CheckpointEntrySchema,
          },
        },
        async ({ paperRoot, entry }) => {
          const result = await recordCheckpoint(paperRoot, entry);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        },
      );
    }
    ```

    **Note about `StatePatchSchema`:** If `bin/lib/schemas/state.ts` does not
    already export a `StatePatchSchema`, add one as `z.object({}).passthrough()`
    or as a `.partial()` of the existing state schema — whichever matches the
    existing convention. Do NOT inline a fat zod definition in `mcp/tools.ts`
    (would push the handler over 30 stmts and violate the thin-shim spirit).

    **Step B — replace the `mcp/server.ts` stub with the real boot:**

    Required body:

    ```typescript
    // mcp/server.ts
    //
    // Entrypoint: stdio MCP server for Pensmith Tier 1.
    //
    // D-02: SDK pinned at @modelcontextprotocol/sdk@^1.29 (NOT v2-alpha).
    // D-13: exactly 4 resources + 4 tools (registered via the helpers below).
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
    - `grep -c "registerTool" mcp/tools.ts` returns 4.
    - `grep -cE "inputSchema:\s*\{" mcp/tools.ts` returns 4 (one per tool — confirms flat-record pattern).
    - `grep -c "z\.object\(" mcp/tools.ts` returns 0 (Pitfall 2 — flat records only at the inputSchema top level).
    - `grep -c "console\." mcp/tools.ts mcp/server.ts` returns 0.
    - `grep -c "node:fs\|node:http\|node:https\|node:net\|node:tls\|node:child_process" mcp/tools.ts mcp/server.ts` returns 0.
    - `grep -c "StdioServerTransport" mcp/server.ts` returns at least 1.
    - `grep -c "import.meta.url" mcp/server.ts` returns at least 1 (test-safe boot guard).
    - `npm run lint` passes (chokepoints in 02-01/02/03 fire on nothing here).
    - `npm run typecheck` passes.
    - `npm run build` produces `dist/mcp/server.js`, `dist/mcp/resources.js`, `dist/mcp/tools.js`.
  </action>
  <verify>
    <automated>npm run lint &amp;&amp; npm run typecheck &amp;&amp; npm run build &amp;&amp; node -e "const fs=require('node:fs'); for(const f of ['dist/mcp/server.js','dist/mcp/resources.js','dist/mcp/tools.js']){if(!fs.existsSync(f)){console.error('missing build artifact',f);process.exit(1)}} const t=fs.readFileSync('mcp/tools.ts','utf8'); const rt=(t.match(/registerTool\(/g)||[]).length; if(rt!==4){console.error('expected 4 registerTool, got',rt);process.exit(1)} if(/z\.object\(/.test(t)){console.error('z.object found in mcp/tools.ts — Pitfall 2 violation');process.exit(1)} const s=fs.readFileSync('mcp/server.ts','utf8'); if(!/StdioServerTransport/.test(s)){console.error('StdioServerTransport not used');process.exit(1)} if(!/import\.meta\.url/.test(s)){console.error('boot guard missing');process.exit(1)} console.log('OK')"</automated>
  </verify>
  <acceptance_criteria>
    - `mcp/tools.ts` calls `server.registerTool` exactly 4 times for `state.read`, `state.update`, `library.read`, `checkpoint.append`.
    - Each `inputSchema` is a flat record literal `{ field: z.<type>(...) }` — no `z.object(...)` at the top level (Pitfall 2).
    - `mcp/server.ts` imports `McpServer` and `StdioServerTransport` from `@modelcontextprotocol/sdk` and wires them in `main()`.
    - `mcp/server.ts` has an `import.meta.url === \`file://${process.argv[1]}\`` boot guard (test imports do not auto-boot).
    - No `node:fs`, `node:http`, `node:https`, `node:net`, `node:tls`, or `node:child_process` imports in either file.
    - No `console.*` calls anywhere in `mcp/`.
    - `npm run build` produces `dist/mcp/server.js`.
    - `npm run lint` + `npm run typecheck` pass.
  </acceptance_criteria>
  <done>
    Real MCP server shipped. 02-07's tier-contract test can now spawn `dist/mcp/server.js`
    and run the full handshake against it.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Tests — tool zod validation (TIER-06) + ≤30-stmt budget AST walk (D-08)</name>
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

    For each of the 4 tools, two cases:
    - Valid input: handler returns a `{ content: [{ type: 'text', text: <json> }] }` shape.
    - Invalid input: the tool registration's input schema rejects the call (the SDK
      raises `McpError` with `code: InvalidParams` or a JSON-RPC error response;
      assert via a thrown / rejected promise).

    Use **in-process** server instantiation via `buildServer()` (exported by
    `mcp/server.ts` per Task 2). Drive the call through `server.server.request(...)`
    or — preferred — invoke the tool through the SDK's internal request handler
    by feeding it a synthetic `CallToolRequest`. If the in-process surface is
    inconvenient, fall back to the official `Client` + `InMemoryTransport` pair
    (RESEARCH § Pitfall 9 endorses this for unit tests; full
    `StdioClientTransport` lands in 02-07's tier-contract test).

    **`tests/mcp-server-thin-shim.test.ts` (D-08 — ≤30 stmts AST positive case):**

    Parse `mcp/tools.ts` with `@typescript-eslint/parser` (already a dep — used
    in 02-01/02/03). Walk to each `registerTool` call's third argument (the
    handler function expression). Count statements in its body.

    Assert: for ALL 4 handlers, body.statements.length ≤ 30. This is the positive
    half of the chokepoint — the lint rule (02-01) catches statement count on
    fixture files; this test confirms our REAL handlers comply.

    Also repeat the same walk for the 4 resource handlers in `mcp/resources.ts`
    and assert ≤30 stmts each.
  </behavior>
  <action>
    Create both test files. Skeleton for `tests/mcp-server-thin-shim.test.ts`:

    ```typescript
    // tests/mcp-server-thin-shim.test.ts
    //
    // D-08 positive case: every real handler body in mcp/ is ≤30 statements.
    // The chokepoint LINT (02-01) covers fixtures; this test covers the
    // SHIPPED code.

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
          // Last arg is the handler (for registerResource that's arg 3; for registerTool that's arg 2 — the SDK shape).
          // We grab the LAST argument that's a function expression.
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

    test('D-08: every mcp/tools.ts handler ≤30 statements', () => {
      const handlers = countHandlerStmts('mcp/tools.ts', 'registerTool');
      assert.equal(handlers.length, 4, `expected 4 tools, got ${handlers.length}`);
      for (const h of handlers) {
        assert.ok(h.stmts <= 30, `${h.name}: ${h.stmts} stmts (max 30)`);
      }
    });

    test('D-08: every mcp/resources.ts handler ≤30 statements', () => {
      const handlers = countHandlerStmts('mcp/resources.ts', 'registerResource');
      assert.equal(handlers.length, 4, `expected 4 resources, got ${handlers.length}`);
      for (const h of handlers) {
        assert.ok(h.stmts <= 30, `${h.name}: ${h.stmts} stmts (max 30)`);
      }
    });
    ```

    Skeleton for `tests/mcp-tool-handlers.test.ts`:

    ```typescript
    // tests/mcp-tool-handlers.test.ts
    //
    // TIER-06: each MCP tool parses input via zod. Malformed input is rejected.
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
      // initialise minimal .paper/ scaffolding the chokepoints expect.
      mkdirSync(join(root, '.paper'), { recursive: true });
      writeFileSync(join(root, '.paper', 'STATE.json'), '{"version":1,"sections":[]}');
      writeFileSync(join(root, '.paper', 'LIBRARY.json'), '{"version":1,"entries":[]}');
      return root;
    }

    test('TIER-06: state.read accepts valid paperRoot', async () => {
      const { client } = await pair();
      const root = freshPaperRoot();
      const res = await client.callTool({ name: 'state.read', arguments: { paperRoot: root } });
      assert.ok(Array.isArray(res.content));
      assert.equal(res.content[0].type, 'text');
    });

    test('TIER-06: state.read rejects missing paperRoot', async () => {
      const { client } = await pair();
      await assert.rejects(
        client.callTool({ name: 'state.read', arguments: {} }),
        /paperRoot|required|invalid/i,
      );
    });

    test('TIER-06: state.read rejects empty paperRoot', async () => {
      const { client } = await pair();
      await assert.rejects(
        client.callTool({ name: 'state.read', arguments: { paperRoot: '' } }),
        /at least 1|min|invalid/i,
      );
    });

    test('TIER-06: library.read accepts valid paperRoot', async () => {
      const { client } = await pair();
      const root = freshPaperRoot();
      const res = await client.callTool({ name: 'library.read', arguments: { paperRoot: root } });
      assert.equal(res.content[0].type, 'text');
    });

    test('TIER-06: library.read rejects missing paperRoot', async () => {
      const { client } = await pair();
      await assert.rejects(client.callTool({ name: 'library.read', arguments: {} }));
    });

    test('TIER-06: checkpoint.append rejects malformed entry', async () => {
      const { client } = await pair();
      const root = freshPaperRoot();
      await assert.rejects(
        client.callTool({
          name: 'checkpoint.append',
          arguments: { paperRoot: root, entry: { not: 'a valid entry' } },
        }),
      );
    });

    test('TIER-06: state.update rejects missing patch', async () => {
      const { client } = await pair();
      const root = freshPaperRoot();
      await assert.rejects(
        client.callTool({ name: 'state.update', arguments: { paperRoot: root } }),
      );
    });
    ```

    Notes:
    - The exact import path for `InMemoryTransport` in MCP SDK v1.29 is
      `@modelcontextprotocol/sdk/inMemory.js` — verify against the locally
      installed package after `npm install` lands in Task 1; correct the import
      if the SDK exports it elsewhere.
    - If `Client.callTool({ arguments: {} })` returns a `result` object with
      `isError: true` rather than throwing (SDK behavior depends on protocol
      mode), assert on `res.isError === true` instead of `assert.rejects`.
      Match whichever surface the SDK actually presents — do NOT loosen the
      test if both forms are available.
    - Run with `node scripts/run-tests.mjs tests/mcp-tool-handlers.test.ts tests/mcp-server-thin-shim.test.ts`.
  </action>
  <verify>
    <automated>node scripts/run-tests.mjs tests/mcp-server-thin-shim.test.ts tests/mcp-tool-handlers.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/mcp-server-thin-shim.test.ts` exists and asserts ≤30 stmts on all 8 handlers (4 tools + 4 resources).
    - `tests/mcp-tool-handlers.test.ts` exists with at least 1 positive + 1 negative case per tool (8 cases minimum).
    - Both files run green under `node scripts/run-tests.mjs ...`.
    - `npm run lint` continues to pass.
    - `grep -c "InMemoryTransport\|InProcessTransport" tests/mcp-tool-handlers.test.ts` returns at least 1.
    - The AST-walk test correctly identifies all 4 tool handlers and all 4 resource handlers (asserts `handlers.length === 4` for each file).
  </acceptance_criteria>
  <done>
    TIER-05 (server boots with 4 resources + 4 tools), TIER-06 (zod input validation),
    and the D-08 ≤30-stmt positive case are all proven against the shipped code.
    Plan 02-07 (tier-contract) will exercise the same surface over real stdio.
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
| dist/mcp/server.js stdout → MCP client framing | Any stray `console.log` corrupts the JSON-RPC frame (Pitfall 7); D-07 lint enforces |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-04-01 | Tampering | `state.update` tool accepts an arbitrary patch and corrupts STATE.json | mitigate | `StatePatchSchema` (zod) gates the input. `updateState()` in bin/lib/state.ts performs atomic write via lock.ts (Phase 1 chokepoint). Idempotency: re-applying the same patch produces byte-identical output. |
| T-02-04-02 | Information Disclosure | `paper://capabilities` handler accidentally emits `process.env.OPENALEX_API_KEY` (the value, not the flag) | mitigate | D-12 lint (from 02-03) flags computed `process.env[...]` and inline `getProviderApiKey()` calls in mcp/. The handler in this plan uses static dot-access + `!== undefined` boolean coercion only. |
| T-02-04-03 | Denial of Service | `console.log` in a handler corrupts stdio framing → MCP session hangs | mitigate | D-07 lint (project-wide + re-included in mcp/** scoped blocks per 02-01/02/03) flags all `console.*` calls. Handlers use `process.stderr.write` if diagnostics absolutely needed. |
| T-02-04-04 | Repudiation | `checkpoint.append` accepts a malformed entry and silently drops it | mitigate | `CheckpointEntrySchema` (zod, from `bin/lib/schemas/checkpoint.ts`) rejects malformed input → SDK raises `InvalidParams` JSON-RPC error → client sees the failure. TIER-06 test in this plan proves it. |
| T-02-04-05 | Elevation of Privilege | A tool handler imports `node:fs` and bypasses `paths.ts` sandboxing | mitigate | D-09 lint (from 02-01) flags all `node:fs` imports in `mcp/**/*.ts`. The handler must delegate through bin/lib/* chokepoints which respect paperDir() containment. |
| T-02-04-06 | Spoofing | An attacker reconfigures the MCP transport to HTTP and intercepts traffic | mitigate | D-10 lint (from 02-02) flags `http.createServer`, `tls.createServer`, raw `new Server()`. Transport is hardcoded to `StdioServerTransport` in `mcp/server.ts`. |
| T-02-04-07 | Information Disclosure | A future hand-rolled `inputSchema: z.object({...})` (Pitfall 2) causes args to arrive double-wrapped, and the handler logs the raw payload trying to debug it | mitigate | The grep-checkable acceptance criterion `grep -c "z.object(" mcp/tools.ts == 0` catches this at PR-review time. Plus D-07 prevents the logging branch anyway. |

Security domain: V4 Access Control (user-space, D-19 doctor read-only — but this plan is the server, not doctor), V5 Input Validation (zod on every tool), V14 Configuration (capabilities-no-leak, D-12).
</threat_model>

<verification>
After all three tasks:

1. `npm run build` produces `dist/mcp/server.js` AND `dist/mcp/resources.js` AND `dist/mcp/tools.js`.
2. `node scripts/run-tests.mjs tests/mcp-server-thin-shim.test.ts tests/mcp-tool-handlers.test.ts` — all tests green.
3. `npm run lint` passes (none of the Wave 1 chokepoints fire on the shipped code).
4. `npm run typecheck` passes.
5. `grep -c "registerResource" mcp/resources.ts` == 4.
6. `grep -c "registerTool" mcp/tools.ts` == 4.
7. `grep -c "z.object(" mcp/tools.ts` == 0 (Pitfall 2 — flat-record inputSchema only).
8. `grep -c "console\." mcp/server.ts mcp/resources.ts mcp/tools.ts` == 0.
9. `node dist/mcp/server.js` (manually, with stdin closed) exits cleanly within ~1s — i.e., the boot guard fires and the transport survives an empty session.
</verification>

<success_criteria>
- TIER-05: MCP server boots over stdio, registers 4 resources + 4 tools (asserted by 02-07 tier-contract test next wave).
- TIER-06: every tool handler parses input via zod (asserted by tests in this plan).
- ARCH-18 / D-08: every handler body ≤30 stmts (asserted by AST-walk test in this plan).
- D-13: exactly 4 resources, exactly 4 tools — grep-counted.
- D-02: SDK pinned at `^1.29.x` in package.json.
- D-12: capabilities resource emits only boolean presence flags (lint-enforced + grep-verified).
- All three Wave 1 chokepoints (D-09, D-10, D-12) are silent on the shipped code — proof the handlers are thin shims by construction.
</success_criteria>

<output>
After completion, create `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-04-SUMMARY.md`.
</output>
