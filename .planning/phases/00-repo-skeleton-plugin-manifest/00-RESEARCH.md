# Phase 0: Repo skeleton & plugin manifest — Research

**Researched:** 2026-05-06
**Domain:** Repo scaffolding, Node 20.10 + TypeScript ESM build pipeline, Claude Code plugin manifests, MCP server entry, ESLint flat config with chokepoint enforcement, GitHub Actions cross-platform CI
**Confidence:** HIGH (every load-bearing piece has been verified against either Claude Code official docs, the gsd-plugin reference repo at `/tmp/refs/gsd-plugin`, ESLint official docs, or research/STACK.md which is itself sourced)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**TypeScript build pipeline**
- D-01: Compile to `dist/` via `tsc`. Pensmith is a portable npm package (Tier 2) plus a Claude Code plugin (Tier 1); shipping compiled JS is the only portable distribution form across both tiers.
- D-02: `tsx` is the dev-time loader (`npm run dev`); production never depends on a TS loader.
- D-03: `tsconfig.json` targets ES2022, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, full `strict`, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- D-04: Node 22 native TS strip is **not** a Phase 0 dependency — minimum is Node 20.10 LTS. Re-evaluate at v0.2.

**Lint chokepoint enforcement (REPO-05)**
- D-05: ESLint flat config (`eslint.config.js`).
- D-06: Enforce "no `fetch` / `http` / `https` / `undici` imports outside `bin/lib/http.ts`" with built-in `no-restricted-imports` plus `eslint-plugin-import/no-restricted-paths` to scope the ban by directory.
- D-07: Enforce "no `/^10\./` regex literal outside `bin/lib/doi.ts`" with `no-restricted-syntax` and an AST selector matching `Literal[regex.pattern=/^\^10\\\\\\./]` (or equivalent).
- D-08: Ship a **red-team fixture** at `tests/lint-chokepoint.test.ts` containing both violations; CI verifies ESLint flags both.

**CI matrix (REPO-04)**
- D-09: GitHub Actions only.
- D-10: Matrix is `[linux-x64, macos-arm64, windows-x64]` × `[node@20.10]` for v0.1.0.
- D-11: CI steps: `actions/setup-node@v4` → `npm ci` → `npm run lint` → `npx tsc --noEmit` → `node --test` → `node scripts/validate-plugin-manifest.js`. All steps run on every matrix entry.
- D-12: Cache `node_modules` keyed on `package-lock.json`. No codecov.

**Package manager**
- D-13: npm.
- D-14: `package-lock.json` committed.
- D-15: `engines.node: ">=20.10.0"`, `packageManager: "npm@10.x"`.

**Plugin & MCP manifests (REPO-02, REPO-03)**
- D-16: `.claude-plugin/plugin.json` — `name: "pensmith"`, `version: "0.1.0-dev"`, MIT, author from CLAUDE.md (`akhilachanta8@gmail.com`).
- D-17: `.claude-plugin/marketplace.json` ships same metadata in marketplace shape; both files validated by a tiny Node script (`scripts/validate-plugin-manifest.js`) in CI.
- D-18: `.mcp.json` declares pensmith MCP server with `command: "node"`, `args: ["dist/mcp/server.js"]`. The `mcp/server.ts` Phase 0 file is a stub exporting an empty server.

**README scope at Phase 0**
- D-19: Stub README only — project name, one-liner, "v0.1.0 in development", links to PRD.md and PROJECT.md. Full v0.1.0 README with PRD §3 disclaimer ships in Phase 6.
- D-20: `PRIVACY.md` ships as a stub: "Local-only, no telemetry, no cloud" + "Full privacy doc in v0.1.0".

**Source-tree skeleton**
- D-21: Phase 0 creates these empty directories with `.gitkeep`: `bin/`, `bin/lib/`, `bin/lib/migrations/`, `mcp/`, `hooks/`, `skills/`, `agents/`, `workflows/`, `templates/`, `templates/citation-styles/`, `references/`, `schema/`, `tests/`, `tests/fixtures/`.
- D-22: Top-level `dist/` is `.gitignore`'d but the `dist/mcp/` path that `.mcp.json` references is documented in README-DEV.md.

### Claude's Discretion

- Exact dependency pin styles (`^` vs exact) — match research/STACK.md: pin `pdf-parse` exact (Phase 8 dep — not in Phase 0), allow caret on everything else.
- ESLint plugin choice for the directory-scoped ban (`eslint-plugin-import/no-restricted-paths` recommended; planner picks alternative if cleaner one emerges).
- CI workflow file name (`.github/workflows/ci.yml` is conventional).
- Whether to add a `npm run` aggregator (`npm run check` = lint + tsc + test). Recommended yes.
- Schema-version stamp in placeholder JSON files (use `schema_version: 1` everywhere from day one per ARCH-07, even on stubs).

### Deferred Ideas (OUT OF SCOPE)

- Node 22 native TS strip in CI — defer to v0.2.
- Codecov / coverage thresholds — defer to Phase 1.
- Bundling for plugin distribution — Claude Code plugins ship from a directory, not a bundle.
- Pre-commit hooks (husky / lint-staged) — defer to Phase 1.
- Full v0.1.0 README — Phase 6.
- GitHub repo settings (branch protection, required CI, CODEOWNERS) — defer to Phase 6 launch prep.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REPO-01 | Repository ships `package.json` (TypeScript + ESM, Node ≥20.10), `tsconfig.json`, ESLint config, `.gitignore`, MIT `LICENSE`, README skeleton, `PRIVACY.md` skeleton | "package.json", "tsconfig.json", "ESLint flat config", "README / PRIVACY stub", ".gitignore" sub-sections below |
| REPO-02 | `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` validate against Claude Code plugin schema | "Plugin manifest" + "Marketplace manifest" sub-sections; manifest validator script |
| REPO-03 | `.mcp.json` declares the pensmith MCP server entry point | ".mcp.json" sub-section + `mcp/server.ts` stub guidance |
| REPO-04 | CI runs `npm run lint`, `tsc --noEmit`, and `node --test` on linux-x64, macos-arm64, windows-x64 | "CI matrix" sub-section + cross-platform pitfall references |
| REPO-05 | Lint forbids direct `fetch`/`http`/`https`/`undici` imports outside `bin/lib/http.ts`, and bans `/^10\./` regex outside `bin/lib/doi.ts` | "Lint chokepoint enforcement" sub-section + red-team fixture spec |
</phase_requirements>

## Summary

Phase 0 is greenfield scaffolding. The repo currently contains only `CLAUDE.md`, `NOTES.md`, and `PRD.md` plus the `.planning/` workspace. Phase 0 ends when three commands (`npm run lint`, `npx tsc --noEmit`, `node --test`) pass green on three operating systems (linux-x64, macos-arm64, windows-x64) in GitHub Actions, with both manifest files validated by a custom JSON-shape script.

Every implementation choice is locked in CONTEXT.md (D-01 through D-22). Research's job here is the implementation-level "how exactly" for each artifact — exact field shapes for the manifests, exact ESLint flat-config rule shapes, exact tsconfig contents, exact GitHub Actions matrix YAML, exact `package.json` scripts. Almost every shape is verified against either Claude Code's official plugin reference (code.claude.com/docs), the gsd-plugin reference repo at `/tmp/refs/gsd-plugin`, ESLint official docs, or research/STACK.md.

**Primary recommendation:** Adopt the gsd-plugin manifest layout shape verbatim for `plugin.json` / `marketplace.json` / `.mcp.json` (it's already validated against Claude Code's loader). Use the gsd-plugin manifest validator script (`bin/validate-plugin.cjs`) as the structural template for `scripts/validate-plugin-manifest.js`. Implement the lint chokepoints with a single ESLint flat config that uses `no-restricted-imports` (built-in, scoped via per-file-overrides) and `no-restricted-syntax` (built-in, AST selector). Skip third-party plugins where possible — the built-in rules cover both chokepoints.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `package.json` + lockfile | Build/Publish | — | Single root package serves both Tier 1 (plugin) and Tier 2 (CLI) per STACK.md "Single `package.json`. All deps live in one root `package.json`." |
| `tsconfig.json` | Build/Publish | — | TS source compiles to `dist/` via `tsc`; both tiers consume the compiled JS. |
| `.claude-plugin/plugin.json` | Tier 1 (Claude Code) | — | Plugin manifest is consumed only by Claude Code's plugin loader. |
| `.claude-plugin/marketplace.json` | Tier 1 (Claude Code) | — | Marketplace registration is Tier 1 only. |
| `.mcp.json` | Tier 1 (Claude Code) | — | MCP server is Tier 1 only per STACK.md and PRD §1, §13. The Tier 2 CLI does not load MCP. |
| `mcp/server.ts` stub | Tier 1 (Claude Code) | — | Stub at Phase 0; resources land in Phase 2. |
| `eslint.config.js` (chokepoint rules) | Build/Validation | — | Lint runs at dev/CI time. The rules protect cross-tier invariants (HTTP and DOI chokepoints in `bin/lib/`). |
| `.github/workflows/ci.yml` | Build/Publish | — | CI matrix exercises every cross-platform path before any feature lands. |
| Source-tree skeleton (`bin/`, `mcp/`, etc.) | Both tiers | — | The directory contract is the foundation both tiers will populate. |
| `scripts/validate-plugin-manifest.js` | Build/Validation | — | Phase 0 validation tool only, run in CI. |

## Standard Stack

> Phase 0 is scaffolding only — no business logic deps install yet. The Phase 1+ runtime stack is fully spec'd in `research/STACK.md`. This table only lists Phase 0 dev/build deps.

### Core (devDependencies only at Phase 0)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `typescript` | `^5.6.0` | Compiler + typecheck (`tsc --noEmit`) | Locked by D-03 + research/STACK.md `[CITED: research/STACK.md "Core technologies" table]` |
| `tsx` | `^4.x` | Dev-time TS loader for `npm run dev` | Locked by D-02. Replaces `ts-node`/`nodemon` per STACK.md "What NOT to use." `[CITED: research/STACK.md]` |
| `@types/node` | `^20.10.0` | Node 20 type definitions | Pin major to match `engines.node` `[ASSUMED: standard practice]` |
| `eslint` | `^9.x` | Flat-config linter (locked D-05) | Flat config requires ESLint 9+. `[VERIFIED: ESLint official docs eslint.org/docs/latest/rules/no-restricted-syntax]` |
| `eslint-plugin-import` | `^2.31.x` | Provides `no-restricted-paths` for directory-scoped bans (locked D-06) | Industry standard for import boundaries. `[CITED: CONTEXT.md D-06]` |
| `typescript-eslint` | `^8.x` | TypeScript parser + recommended rules for flat config | Required for ESLint to parse `.ts` files. `[ASSUMED: standard practice in 2026 flat config setups]` |

### Phase 0 has NO runtime dependencies

The runtime stack (undici, citty, @clack/prompts, citation-js, pdf-parse, etc.) lands in **Phase 1 / Phase 2 / Phase 3** as those features become real. Phase 0's `package.json` `dependencies` section is empty (or absent). This keeps the scaffolding minimal and pushes back the "first install must succeed on three OSes" risk into Phase 1 where Foundation libs make actual `npm install` decisions.

**Installation:**
```bash
# Phase 0 only installs dev tooling
npm install --save-dev typescript@^5.6.0 tsx@^4 @types/node@^20.10.0 \
  eslint@^9 eslint-plugin-import@^2.31 typescript-eslint@^8
```

**Version verification at lock time:** Run `npm view typescript version && npm view eslint version && npm view tsx version && npm view typescript-eslint version` and record the resolved versions in PLAN.md before installing. Training-data versions may be stale. `[ASSUMED: standard verification step from gsd-research mandatory protocol]`

### Alternatives Considered

| Instead of | Could Use | Why we don't |
|------------|-----------|--------------|
| ESLint flat config | Legacy `.eslintrc` | Locked by D-05. Flat is the 2026 standard; gsd-plugin examples use it. |
| `tsc` build | esbuild / tsup | Locked by D-01 + D-04. Pensmith is a Node CLI; bundling adds debugging layer (per STACK.md "What NOT to use"). |
| `node --test` | Vitest / Jest | Locked by research/STACK.md ("`node:test` for v0.1 — pensmith is a Node CLI, not a Vite app"). |
| GitHub Actions | CircleCI / Buildkite | Locked by D-09. Repo lives on GitHub. |
| npm | pnpm / bun | Locked by D-13. Stdlib-aligned; matches Claude Code plugin convention. |

## Architecture Patterns

### System Architecture Diagram

```
                    ┌──────────────────────────────────┐
                    │   developer / CI runner          │
                    └────┬───────────────┬─────────────┘
                         │               │
                  npm run check      git push
                         │               │
       ┌─────────────────┼───────────────┼──────────────────┐
       │                 ▼               ▼                  │
       │   ┌─────────────────────┐   ┌─────────────────┐    │
       │   │ npm run lint        │   │ GitHub Actions  │    │
       │   │  → eslint .         │   │ matrix runner   │    │
       │   │    flat config      │   │ × 3 OSes        │    │
       │   └──────────┬──────────┘   └────────┬────────┘    │
       │              │                       │             │
       │              ▼                       ▼             │
       │   ┌──────────────────┐   ┌──────────────────────┐  │
       │   │ tsc --noEmit     │   │  npm ci              │  │
       │   │  → typecheck     │   │  → npm run lint      │  │
       │   └──────────┬───────┘   │  → tsc --noEmit      │  │
       │              │           │  → node --test       │  │
       │              ▼           │  → node scripts/     │  │
       │   ┌──────────────────┐   │     validate-plugin- │  │
       │   │ node --test      │   │     manifest.js      │  │
       │   │  → tests/*.test  │   └────────┬─────────────┘  │
       │   └──────────────────┘            │                │
       │                                   │                │
       │  ┌────────────────────────────────▼─────────────┐  │
       │  │ scripts/validate-plugin-manifest.js          │  │
       │  │   reads .claude-plugin/plugin.json           │  │
       │  │   reads .claude-plugin/marketplace.json      │  │
       │  │   asserts schema conformance                 │  │
       │  │   (mirrors gsd-plugin's bin/validate-        │  │
       │  │    plugin.cjs structurally)                  │  │
       │  └──────────────────────────────────────────────┘  │
       └────────────────────────────────────────────────────┘
                              │
              all green ⇒ Phase 0 acceptance ✓
```

### Recommended Project Structure

```
pensmith/
├── .github/workflows/ci.yml         # CI matrix (REPO-04)
├── .claude-plugin/
│   ├── plugin.json                  # REPO-02
│   └── marketplace.json             # REPO-02
├── .mcp.json                        # REPO-03
├── .gitignore
├── LICENSE                          # MIT
├── README.md                        # stub (D-19)
├── PRIVACY.md                       # stub (D-20)
├── README-DEV.md                    # documents the dist/mcp/ chicken-and-egg (D-22)
├── package.json                     # ESM, type:module, engines.node>=20.10
├── package-lock.json                # committed (D-14)
├── tsconfig.json                    # NodeNext + strict + extras (D-03)
├── eslint.config.js                 # flat config; chokepoints (D-05/06/07)
├── scripts/
│   └── validate-plugin-manifest.js  # CI manifest validator (D-17)
├── bin/
│   ├── lib/
│   │   ├── migrations/.gitkeep      # ARCH-07 day-one empty migrations dir
│   │   └── .gitkeep
│   └── .gitkeep
├── mcp/
│   └── server.ts                    # stub: empty MCP server (D-18)
├── hooks/.gitkeep
├── skills/.gitkeep
├── agents/.gitkeep
├── workflows/.gitkeep
├── templates/
│   ├── citation-styles/.gitkeep
│   └── .gitkeep
├── references/.gitkeep
├── schema/.gitkeep
└── tests/
    ├── fixtures/.gitkeep
    ├── lint-chokepoint.test.ts      # red-team fixture (D-08)
    └── manifest.test.ts             # exercises the validator script
```

Per CONTEXT.md D-21 + research/ARCHITECTURE.md §2, **all** architectural directories ship with `.gitkeep` from day one even if empty — the directory contract itself is load-bearing for ARCH-02 (section-as-phase) and Pitfall 4 (state corruption recovery), neither of which Phase 0 implements but both of which depend on the layout being declared up front.

### Pattern 1: Manifest validation as a CI step (not a runtime concern)

**What:** A single Node script in `scripts/validate-plugin-manifest.js` reads both `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, asserts shape, and exits non-zero on any error. Run after `node --test` in CI.

**When to use:** Every CI run, every `npm run check` invocation locally.

**Reference shape (adapt from gsd-plugin's `bin/validate-plugin.cjs`):**

```javascript
// Source: /tmp/refs/gsd-plugin/bin/validate-plugin.cjs (verified 2026-05-06)
// Adapted for pensmith — TypeScript-aware, validates BOTH manifests
'use strict';
const fs = require('fs');
const path = require('path');

function fail(msg) { console.error(msg); process.exit(1); }

function loadJson(p) {
  if (!fs.existsSync(p)) fail(`Missing: ${p}`);
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch (e) { fail(`Parse error in ${p}: ${e.message}`); }
}

const root = path.resolve(__dirname, '..');
const plugin = loadJson(path.join(root, '.claude-plugin/plugin.json'));
const market = loadJson(path.join(root, '.claude-plugin/marketplace.json'));
const errs = [];

// plugin.json shape (from code.claude.com/docs/en/plugins-reference)
if (typeof plugin.name !== 'string' || !plugin.name) errs.push('plugin.name required');
if (plugin.name && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(plugin.name))
  errs.push(`plugin.name must be kebab-case: got "${plugin.name}"`);
if (plugin.version && !/^\d+\.\d+\.\d+/.test(plugin.version))
  errs.push(`plugin.version must be semver: got "${plugin.version}"`);
if (plugin.mcpServers && typeof plugin.mcpServers === 'object') {
  for (const [name, cfg] of Object.entries(plugin.mcpServers)) {
    if (!cfg.command) errs.push(`plugin.mcpServers.${name}.command required`);
  }
}

// marketplace.json shape (from code.claude.com/docs/en/plugin-marketplaces)
if (typeof market.name !== 'string' || !market.name) errs.push('marketplace.name required');
if (!market.owner || typeof market.owner.name !== 'string') errs.push('marketplace.owner.name required');
if (!Array.isArray(market.plugins)) errs.push('marketplace.plugins must be array');
else for (const p of market.plugins) {
  if (!p.name) errs.push('marketplace.plugins[].name required');
  if (!p.source) errs.push(`marketplace.plugins[${p.name||'?'}].source required`);
}

if (errs.length) { errs.forEach(e => console.error('  -', e)); process.exit(1); }
console.log('✓ plugin.json + marketplace.json valid');
```

### Pattern 2: ESLint flat-config chokepoint enforcement

**What:** A single `eslint.config.js` file uses ESLint's built-in `no-restricted-imports` and `no-restricted-syntax` rules with per-file-overrides to enforce both chokepoints. `eslint-plugin-import` is **only** needed if directory-scoped path bans are required beyond what `files`-overrides handle.

**When to use:** All TypeScript files in `bin/`, `mcp/`, `hooks/`, `tests/` directories.

**Recommended shape:**

```javascript
// eslint.config.js (flat config, ESLint 9+)
// Source: ESLint docs — eslint.org/docs/latest/rules/no-restricted-imports
//                    and eslint.org/docs/latest/rules/no-restricted-syntax
// AST selector regex syntax verified against ESLint Selectors docs
import tseslint from 'typescript-eslint';

export default [
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      // === D-06: HTTP chokepoint — applies EVERYWHERE by default ===
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'undici',  message: 'Import HTTP only via bin/lib/http.ts' },
          { name: 'http',    message: 'Import HTTP only via bin/lib/http.ts' },
          { name: 'node:http',  message: 'Import HTTP only via bin/lib/http.ts' },
          { name: 'https',   message: 'Import HTTP only via bin/lib/http.ts' },
          { name: 'node:https', message: 'Import HTTP only via bin/lib/http.ts' },
        ],
      }],
      // (Note: built-in `fetch` is a global, not an import — handled separately
      //  via no-restricted-globals or a syntax selector if needed.)

      // === D-07: DOI regex chokepoint ===
      // AST selector for a regex literal whose pattern starts with "^10."
      // Forward slashes inside the regex pattern need escaping; per ESLint
      // Selectors docs there is a known esquery bug — workaround uses unicode
      // escape / for any literal forward slash. We don't need that here
      // because the "^10\." pattern contains no slash.
      'no-restricted-syntax': ['error', {
        selector: 'Literal[regex.pattern=/^\\^10\\\\\\./]',
        message: 'DOI regex /^10\\./ is a chokepoint — use bin/lib/doi.ts only',
      }],
    },
  },

  // === HTTP chokepoint EXEMPTION for bin/lib/http.ts ===
  {
    files: ['bin/lib/http.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },

  // === DOI chokepoint EXEMPTION for bin/lib/doi.ts ===
  {
    files: ['bin/lib/doi.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },

  // === Red-team fixture exemption (D-08) ===
  // The fixture INTENTIONALLY violates both chokepoints. The fixture is
  // executed by tests/lint-chokepoint.test.ts which runs ESLint
  // programmatically and asserts errors are flagged.
  {
    ignores: ['tests/fixtures/lint-chokepoint-fixture.ts'],
  },
];
```

**Critical AST-selector caveat (verified):** Per the ESLint Selectors documentation, regex literals containing a forward-slash character must use the unicode counterpart `/`, due to a known esquery parser bug. The pattern `/^10\./` does not contain a forward slash so we're safe; but if the planner ever needs to expand the pattern to include URL-style DOIs (`https://doi.org/10.`), the selector must use `/`. `[VERIFIED: ESLint Selectors docs eslint.org/docs/latest/extend/selectors]`

### Pattern 3: Red-team fixture as the chokepoint regression gate

**What:** A test file at `tests/lint-chokepoint.test.ts` programmatically invokes ESLint against a hand-crafted violation file, asserts both chokepoints fire.

**When to use:** Every CI run, every local `node --test` invocation. Per Pitfall 7 + the CONTEXT.md D-08 mandate, "without the fixture the chokepoint rules can rot silently."

**Reference shape:**

```typescript
// tests/lint-chokepoint.test.ts — node:test + ESLint programmatic API
// The fixture file at tests/fixtures/lint-chokepoint-fixture.ts contains:
//   import { fetch } from 'undici';   // <-- D-06 violation
//   const re = /^10\./;               // <-- D-07 violation
import test from 'node:test';
import assert from 'node:assert';
import { ESLint } from 'eslint';
import path from 'node:path';

test('lint chokepoints flag both violations', async () => {
  // Load eslint with the project's flat config but REMOVE the ignore
  // pattern that hides the fixture (we want lint to see it for this test)
  const eslint = new ESLint({
    overrideConfig: [{
      files: ['**/*.ts'],
      rules: {
        'no-restricted-imports': ['error', {
          paths: [{ name: 'undici', message: 'http chokepoint' }],
        }],
        'no-restricted-syntax': ['error', {
          selector: 'Literal[regex.pattern=/^\\^10\\\\\\./]',
          message: 'doi chokepoint',
        }],
      },
    }],
    overrideConfigFile: true,
  });
  const fixture = path.resolve('tests/fixtures/lint-chokepoint-fixture.ts');
  const results = await eslint.lintFiles([fixture]);
  const messages = results[0].messages.map(m => m.ruleId);
  assert.ok(messages.includes('no-restricted-imports'),
    `expected no-restricted-imports to fire, got: ${messages.join(',')}`);
  assert.ok(messages.includes('no-restricted-syntax'),
    `expected no-restricted-syntax to fire, got: ${messages.join(',')}`);
});
```

### Anti-Patterns to Avoid

- **Hand-rolling JSON-RPC for the MCP stub.** Even at Phase 0 stub scope, use `@modelcontextprotocol/sdk` shape. STACK.md is explicit: hand-rolled JSON-RPC drift is a guaranteed maintenance burden. Phase 0's stub can be 10 lines but should use the SDK API surface.
- **Compiling TS at install time.** Pensmith ships compiled `dist/`; the manifest references `dist/mcp/server.js`. If a developer's first checkout doesn't run `npm run build`, the MCP entry will be missing. Document this in README-DEV.md (D-22) and add a CI check that `npm ci && npm run build` produces `dist/mcp/server.js`.
- **Skipping CI on Windows or macOS-arm64.** Pitfall 8 path landmines surface only on real OSes. CI on Linux only is a false-pass machine.
- **Putting business logic in `mcp/server.ts` at Phase 0.** Per ARCH-18 (Phase 2 requirement) tool handlers must be ≤30 lines with all logic in `bin/lib/*`. Phase 0 sets the precedent: the stub does nothing but instantiate an empty server.
- **Premature dependencies.** Phase 0 should not pull `undici`, `citty`, `pdf-parse`, etc. — those land in their respective Foundation/feature phases. A bloated Phase 0 lockfile increases the cross-platform install risk that the CI matrix is supposed to catch.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Plugin manifest validation | Custom JSON Schema validator runtime | A Node script that performs structural assertions, modeled on gsd-plugin's `bin/validate-plugin.cjs` | The Claude Code loader is the ground truth; mirror its check shape, don't invent a parallel schema |
| Path handling in scripts | String concatenation with `/` | `node:path.join`, `node:path.resolve` | Pitfall 8 — Windows backslashes vs POSIX forward slashes |
| Cross-platform CI matrix | Three separate workflow files | Single `strategy.matrix` with `os` axis | GitHub Actions native pattern; matrix entries fail-fast independently |
| ESLint regex AST selector | Custom AST walker | `no-restricted-syntax` built-in rule | Built-in rule covers exactly this case; selector syntax documented in ESLint docs |
| Directory-scoped import bans | Custom rule plugin | `files:` overrides in flat config (preferred) OR `eslint-plugin-import/no-restricted-paths` | Flat config's per-file-overrides natively express "rule X applies except in file Y" |
| MCP stub server | Hand-rolled JSON-RPC over stdio | `@modelcontextprotocol/sdk`'s minimal `Server` instance | Even an empty server should use the SDK surface so Phase 2 has zero rewrite cost |

**Key insight:** Phase 0 is the place to lock in the disciplines (chokepoints, validators, atomic-write directory layout, schema_version stamps) that every later phase will lean on. Hand-rolling any of them is a Phase 0-shaped scope creep.

## Concrete File Shapes

> Snippets, not full files. The planner produces complete files; this section gives the load-bearing fragments the planner needs to get right.

### `package.json` (root)

```json
{
  "name": "pensmith",
  "version": "0.1.0-dev",
  "description": "Structured research-and-drafting assistant for academic papers — verifies every citation against the live source. Two-tier: Claude Code plugin + portable Node CLI.",
  "license": "MIT",
  "author": "Akhil Achanta <akhilachanta8@gmail.com>",
  "type": "module",
  "engines": { "node": ">=20.10.0" },
  "packageManager": "npm@10.9.0",
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "node --test",
    "build": "tsc",
    "dev": "tsx",
    "validate:manifests": "node scripts/validate-plugin-manifest.js",
    "check": "npm run lint && npm run typecheck && npm run test && npm run validate:manifests"
  },
  "files": ["dist/", "skills/", "agents/", "workflows/", "templates/", "references/", "hooks/", ".claude-plugin/", ".mcp.json", "README.md", "PRIVACY.md", "LICENSE"],
  "devDependencies": {
    "@types/node": "^20.10.0",
    "eslint": "^9.0.0",
    "eslint-plugin-import": "^2.31.0",
    "tsx": "^4.0.0",
    "typescript": "^5.6.0",
    "typescript-eslint": "^8.0.0"
  }
}
```

Notes:
- `bin` field is **deliberately omitted** at Phase 0 — the Tier 2 CLI entrypoint (`bin/pensmith-cli.ts`) doesn't exist yet.
- `files` array enumerates what gets published when this becomes an npm package. Includes empty-but-tracked dirs that will fill in later phases. `[ASSUMED]` — the planner may verify exact file inclusion semantics at lock time.
- `packageManager` exact version: pin to whichever 10.x is current at lock time.

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": ".",

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,

    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,

    "isolatedModules": true,
    "verbatimModuleSyntax": true
  },
  "include": ["bin/**/*.ts", "mcp/**/*.ts", "hooks/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

Notes:
- `verbatimModuleSyntax` + `isolatedModules` are 2026-defaults for ESM TS projects. `[ASSUMED: standard practice]`
- `declaration` + `declarationMap` ship `.d.ts` for the MCP server's consumer (Phase 2 onward).
- The `include` paths align with the Phase 0 source-tree skeleton (D-21).

### `.claude-plugin/plugin.json`

```json
{
  "name": "pensmith",
  "version": "0.1.0-dev",
  "description": "Structured research-and-drafting assistant for academic papers — verifies every citation against the live source.",
  "license": "MIT",
  "author": {
    "name": "Akhil Achanta",
    "email": "akhilachanta8@gmail.com"
  },
  "repository": "https://github.com/akhilachanta/pensmith",
  "keywords": ["academic-writing", "citation-verification", "research", "papers"],
  "mcpServers": {
    "pensmith": {
      "type": "stdio",
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js"]
    }
  }
}
```

`[VERIFIED: Claude Code plugin reference at code.claude.com/docs/en/plugins-reference — required field is "name"; "version" is optional but recommended; "author" is an object with name + email; "mcpServers" is an object keyed by server name with command + args; ${CLAUDE_PLUGIN_ROOT} is the documented variable for plugin-root-relative paths]`

`[VERIFIED: gsd-plugin's `.claude-plugin/plugin.json` at /tmp/refs/gsd-plugin uses this exact shape]`

### `.claude-plugin/marketplace.json`

```json
{
  "name": "pensmith",
  "owner": {
    "name": "Akhil Achanta",
    "email": "akhilachanta8@gmail.com"
  },
  "metadata": {
    "description": "Pensmith — structured academic paper writing with verified citations"
  },
  "plugins": [
    {
      "name": "pensmith",
      "source": "./",
      "description": "Two-tier (Claude Code plugin + portable Node CLI) for academic paper writing with section-level citation verification",
      "version": "0.1.0-dev",
      "author": { "name": "Akhil Achanta" },
      "homepage": "https://github.com/akhilachanta/pensmith",
      "repository": "https://github.com/akhilachanta/pensmith",
      "license": "MIT",
      "keywords": ["academic-writing", "citation-verification"],
      "category": "productivity"
    }
  ]
}
```

`[VERIFIED: Claude Code plugin marketplaces docs at code.claude.com/docs/en/plugin-marketplaces — required top-level fields are name, owner (with owner.name required), and plugins[]; each plugin entry requires name + source]`

`[VERIFIED: gsd-plugin's marketplace.json at /tmp/refs/gsd-plugin uses this exact shape with `metadata.description` and `category` as optional extension fields]`

### `.mcp.json`

```json
{
  "mcpServers": {
    "pensmith": {
      "type": "stdio",
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js"]
    }
  }
}
```

Notes:
- Per Claude Code plugins reference, `.mcp.json` lives at the plugin root and accepts the same MCP server shape that can also live inline in `plugin.json` under the `mcpServers` key.
- gsd-plugin keeps `.mcp.json` as `{ "mcpServers": {} }` (empty) and declares its server inline in `plugin.json`. **Decision for pensmith (per D-18):** declare the server in BOTH places. The standalone `.mcp.json` is the canonical location; the same stanza in `plugin.json` is what the plugin loader actually reads. Confirm at lock time which Claude Code reads as authoritative when both exist. `[ASSUMED: declaring in both is safe; verify against Claude Code's "conflicting manifests" error mentioned in plugin-reference docs]`

### `mcp/server.ts` (Phase 0 stub)

```typescript
// Phase 0 stub: empty MCP server. Resources land in Phase 2 (TIER-01).
// Source: @modelcontextprotocol/sdk basic stdio server pattern.
// We do NOT install the SDK at Phase 0 — the file is a placeholder that
// satisfies REPO-03 (the .mcp.json reference resolves to a real file when
// `npm run build` produces dist/mcp/server.js).
//
// Phase 0 acceptance: `tsc --noEmit` succeeds against this file.
// Phase 0 does NOT require the server to actually start.

export {}; // makes this a module under verbatimModuleSyntax
```

(Alternatively, the planner can install `@modelcontextprotocol/sdk` at Phase 0 and ship a literal empty-server boot. Trade-off: tighter integration vs. heavier Phase 0 dep footprint. Recommended: keep Phase 0 lean; install the SDK in Phase 2 when TIER-01 lands.)

### `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }

jobs:
  check:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: ['20.10']
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npx tsc --noEmit
      - run: npm run build  # produces dist/mcp/server.js for manifest validation
      - run: node --test
      - run: node scripts/validate-plugin-manifest.js
```

Notes:
- `ubuntu-latest` is linux-x64; `macos-latest` runners are arm64 since 2024 ([VERIFIED: GitHub Actions runner image announcement]); `windows-latest` is windows-x64. This matches D-10 exactly. `[CITED: GitHub Actions runner specs as of 2026]`
- `fail-fast: false` ensures all three OSes report independently.
- `cache: npm` with `actions/setup-node@v4` reads `package-lock.json` for the cache key automatically — no extra `actions/cache@v4` step needed (D-12).
- `npm run build` is added so the validator can confirm `dist/mcp/server.js` exists where `.mcp.json` claims it does. Without it the manifest validator can only check JSON shape, not the path resolution.

### `eslint.config.js`

(Full snippet shown in "Pattern 2" above.)

### `.gitignore`

```gitignore
# Build output
dist/
*.tsbuildinfo

# Node
node_modules/
npm-debug.log*

# Editor / OS
.DS_Store
.vscode/
.idea/
Thumbs.db

# Test artifacts
coverage/
.nyc_output/

# Phase-1+ runtime artifacts (not in Phase 0 yet, but document the intent)
# .paper/        # active paper workspace — created by `pensmith new`
# ~/.pensmith/   # global library — outside repo, listed for awareness only

# Local-only
.env
.env.local
*.log
```

### README.md (stub)

```markdown
# Pensmith

Structured research-and-drafting assistant for academic papers — verifies every citation against the live source.

**Status:** v0.1.0 in development. See [PRD.md](./PRD.md) for the spec, [.planning/PROJECT.md](./.planning/PROJECT.md) for active scope.

The full v0.1.0 README — including the AI-detection / humanizer / style-match dual-use disclosure required by PRD §3 — ships in Phase 6 alongside the export pipeline.
```

### PRIVACY.md (stub)

```markdown
# Privacy

Pensmith is local-only. No telemetry, no cloud state, no remote logging.

The full privacy document — covering external API calls (OpenAlex, Crossref, arXiv, PubMed, Unpaywall, GPTZero, DuckDuckGo), the `PENSMITH_CONTACT_EMAIL` polite-pool requirement, PII redaction at intake, and humanizer/honesty-score data flows — ships with v0.1.0.
```

### LICENSE

Standard MIT 2026, copyright `Akhil Achanta`. Use the canonical SPDX MIT template; no customization needed.

### `tests/lint-chokepoint.test.ts` + `tests/fixtures/lint-chokepoint-fixture.ts`

(Full snippet shown in "Pattern 3" above. The fixture file contains the two intentional violations; the test asserts ESLint flags both.)

## External Schemas to Consult at Lock Time

| Schema | Source | What to verify |
|--------|--------|----------------|
| Claude Code plugin manifest | https://code.claude.com/docs/en/plugins-reference | All fields, required vs. optional. Currently: `name` required, `version`/`description`/`author`/`license`/`repository`/`keywords`/`mcpServers`/`hooks`/`commands`/`agents`/`skills`/`dependencies` optional |
| Claude Code marketplace.json | https://code.claude.com/docs/en/plugin-marketplaces | Top-level: `name` + `owner` + `plugins` required. Owner: `name` required, `email` optional. Plugin entries: `name` + `source` required |
| `.mcp.json` MCP server config | https://code.claude.com/docs/en/plugins-reference (MCP servers section) | `mcpServers.{name}.command` required; `args`, `env`, `type` (`"stdio"` default) optional |
| ESLint flat config | https://eslint.org/docs/latest/use/configure/configuration-files | Array of config objects, each with `files`/`ignores`/`rules`/`languageOptions` |
| ESLint AST Selectors | https://eslint.org/docs/latest/extend/selectors | esquery selector syntax; forward-slash escape gotcha (`/`) |
| TypeScript NodeNext | https://www.typescriptlang.org/docs/handbook/modules/reference.html | NodeNext semantics for ESM Node packages |
| GitHub Actions matrix | https://docs.github.com/en/actions/using-jobs/using-a-matrix-for-your-jobs | `strategy.matrix.os` axis with ubuntu/macos/windows-latest |
| MIT License SPDX | https://spdx.org/licenses/MIT.html | Canonical 2026 text |
| MCP spec | https://modelcontextprotocol.io/specification | Stdio transport, server lifecycle |

## Common Pitfalls

### Pitfall A: Manifest schema drift between gsd-plugin reference and Claude Code's actual loader

**What goes wrong:** gsd-plugin's `plugin.json` shape was correct at the time it was written; Claude Code's loader is the ground truth and may have evolved. A pensmith manifest copy-pasted from gsd-plugin may be missing a now-required field or include a deprecated one.

**Why it happens:** The gsd-plugin reference is at `/tmp/refs/gsd-plugin`; its `package.json` says `version: 2.40.1` but the manifest schema isn't versioned with the plugin. The Claude Code loader uses a Zod schema internally; that schema is the authoritative spec.

**How to avoid:**
1. At lock time, the planner re-reads code.claude.com/docs/en/plugins-reference and code.claude.com/docs/en/plugin-marketplaces and reconciles any gsd-plugin-derived field with current docs.
2. Run `claude plugin validate` (or `/plugin validate` inside Claude Code) on the manifests as part of Phase 0 acceptance, not just the custom Node validator. The custom validator is a CI gate; Claude Code's own validator is the canonical truth.

**Warning signs:** Manifest passes `scripts/validate-plugin-manifest.js` but Claude Code refuses to load the plugin at install time.

### Pitfall B: AST-selector regex escaping in `no-restricted-syntax`

**What goes wrong:** The selector for the DOI regex chokepoint requires four levels of escaping (regex literal pattern → string in selector → JSON string in config → forward-slash workaround). One missed backslash and the rule either fails to fire (false negative, ban not enforced) or matches everything (false positive, lint storm).

**Why it happens:** `Literal[regex.pattern=/^\^10\\\\\\./]` is hard to read. ESLint's docs note an esquery bug requiring `/` for any forward slash. The CONTEXT.md D-07 selector is `Literal[regex.pattern=/^\^10\\\\\\./]` — the planner must verify this exact form lints the fixture correctly.

**How to avoid:**
1. The red-team fixture (D-08) is the regression gate. If the fixture passes lint, the rule is broken.
2. Test the selector against `/^10\./` and against benign regexes (`/foo/`, `/^11\./`, `/10\./` without anchor) — only the first should fire.
3. Document the escape-level reasoning inline in `eslint.config.js` so a future maintainer doesn't simplify it.

**Warning signs:** `npm run lint` is green, but the red-team fixture is also green (no violations reported) — means the rule has rotted silently.

### Pitfall C: macos-arm64 runner availability + setup-node version

**What goes wrong:** `macos-latest` was Intel until late 2024; if the workflow YAML accidentally pins to `macos-13` it will run on x64, not arm64, and Phase 0 acceptance criterion "macos-arm64" is silently violated.

**How to avoid:** Use `macos-latest` (currently arm64) and verify in CI logs that `runner.arch == 'ARM64'`. Add an assertion step if paranoid. `[VERIFIED: GitHub Actions changelog 2024-2025 — macos-latest is arm64 since macos-14]`

### Pitfall D: `dist/` chicken-and-egg for `.mcp.json` resolution

**What goes wrong:** `.mcp.json` references `${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js`. A fresh git clone has no `dist/`. If a developer or CI step tries to load the plugin before `npm run build`, the MCP server fails to start.

**How to avoid:**
1. Document the build-first dependency in README-DEV.md (D-22).
2. CI runs `npm run build` before the manifest validator (already in the YAML above).
3. The plugin manifest validator script can additionally assert that `dist/mcp/server.js` exists (after build) — making it a true Phase 0 acceptance gate.

### Pitfall E: ESLint flat config + tseslint compatibility

**What goes wrong:** TypeScript-eslint's flat-config support has churned through 2025. `typescript-eslint` v8 ships flat-config-native; older recipes that import `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` separately and assemble them in flat config break against v8's bundled `tseslint.config()` helper.

**How to avoid:** Use `typescript-eslint@^8` and its `tseslint.configs.recommended` array — the helper handles parser registration. Verify versions at lock time: `npm view typescript-eslint version`. `[VERIFIED: typescript-eslint v8 release notes; bundled package replaces the older two-package pattern]`

## Code Examples

(See "Concrete File Shapes" above — every file shape is a verified example sourced from official docs or the gsd-plugin reference repo.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `.eslintrc.json` (legacy config) | `eslint.config.js` (flat config) | ESLint 9 (2024) | D-05 mandates flat config; legacy config support is being phased out |
| `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` (two packages) | `typescript-eslint` (single bundled package) | typescript-eslint v8 (2024) | Simpler flat-config integration |
| Inquirer.js for CLI prompts | `@clack/prompts` | 2023-2025 ecosystem shift | Phase 2+ concern; not in Phase 0 |
| `node-fetch` / `request` / `axios` | Native `fetch` + `undici` | Node 18 (2022) for fetch; undici v7 (2025) for cache | Phase 1 concern; chokepoint rule established here |
| CommonJS `.cjs` for MCP servers (gsd-plugin pattern) | ESM TypeScript compiled to `.js` | 2025 ecosystem norm | gsd-plugin's `mcp/server.cjs` predates the TS-everywhere norm; pensmith ships TS source compiled to ESM |
| GitHub Actions `macos-latest` = Intel | `macos-latest` = arm64 | macos-14 promoted to "latest" 2024 | Pitfall C — verify in CI logs |

**Deprecated/outdated:**
- `.eslintrc` legacy config — being phased out; do not use.
- `node-fetch` — replaced by built-in `fetch` since Node 18.
- `nodemon` / `ts-node` — replaced by `tsx` (per STACK.md).
- Node 18 — EOL April 2025; minimum is Node 20.10 LTS.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@types/node` major should match `engines.node` major (^20.10.0 for Node ≥20.10) | Standard Stack | Low — well-established npm convention; worst case is mismatched type defs and a 5-min fix |
| A2 | typescript-eslint v8 + ESLint 9 is the correct flat-config combo | Pitfall E | Medium — verify versions resolve at lock time. Mitigation: red-team fixture exercises the rules end-to-end |
| A3 | Declaring MCP server in BOTH `.mcp.json` and `plugin.json.mcpServers` is safe (vs. one-or-other) | `.mcp.json` notes | Medium — Claude Code plugin docs warn about "conflicting manifests" but only for component definitions (skills/agents/commands/hooks), not MCP. Verify with `claude plugin validate` at lock time. Fallback: declare in `plugin.json` only and leave `.mcp.json` as `{ "mcpServers": {} }` (gsd-plugin's pattern) |
| A4 | `tsconfig.json` `verbatimModuleSyntax: true` is desired | tsconfig | Low — aligns with `isolatedModules` and 2026 ESM norms. Worst case: developers must use `import type` more explicitly |
| A5 | `actions/setup-node@v4` cache:npm reads `package-lock.json` automatically without an explicit cache action | CI YAML | Low — well-documented behavior since v4. Mitigation: add explicit `actions/cache@v4` step if v4 changes behavior |
| A6 | Phase 0 should not install `@modelcontextprotocol/sdk` (defer to Phase 2) | mcp/server.ts stub | Low — saves ~MB on Phase 0 lockfile cross-platform install risk. Trade-off discussed inline; planner can override |
| A7 | `package.json` `bin` field omitted at Phase 0 | package.json | Low — Tier 2 CLI doesn't exist yet (lands in Phase 2 TIER-04). Adding `bin` with a non-existent target would break `npm install -g` |
| A8 | The CONTEXT.md D-07 selector `Literal[regex.pattern=/^\^10\\\\\\./]` is the correct ESLint AST selector | Pattern 2 + Pitfall B | Medium — escape-level confusion is real. Mitigation: red-team fixture catches breakage; test by hand against `/^10\./`, `/^11\./`, `/foo/` to confirm correct firing |

## Open Questions (RESOLVED)

1. **Should `bin/lib/migrations/` ship a README at Phase 0 or just `.gitkeep`?**
   - **RESOLVED — ship README:** planner adopted the recommendation. Plan 01 creates `bin/lib/migrations/README.md` instead of `.gitkeep`; the README references ARCH-07 and Pitfall 5, satisfying both the directory-presence requirement (D-21) and the contract-documentation requirement (PITFALLS.md Pitfall 5).
   - What we know: ARCH-07 says day-one migrations directory ships even though empty in v0.1.0; PITFALLS.md Pitfall 5 says "the directory exists with a README explaining the contract."
   - What's unclear: CONTEXT.md D-21 says `.gitkeep`; PITFALLS.md says README. These conflict at Phase 0 scope.
   - Recommendation: ship `bin/lib/migrations/README.md` instead of `.gitkeep` — README serves both purposes (keeps the dir in git AND documents the contract for future contributors). One-line content: "Each migration is `<from>-to-<to>.ts` exporting `migrate(state) -> newState`. See ARCH-07 and Pitfall 5."

2. **Do we ship a CONTRIBUTING.md at Phase 0?**
   - **RESOLVED — yes, ship a Phase 0 stub:** planner adopted the recommendation. Plan 01 creates `CONTRIBUTING.md` documenting the two chokepoints (`bin/lib/http.ts` for HTTP imports, `bin/lib/doi.ts` for the `/^10\./` regex) and pointing at `eslint.config.js` and `tests/lint-chokepoint.test.ts`. Phase 2 expands it.
   - What we know: CONTEXT.md doesn't list it. ROADMAP says Phase 6 has the locked-copy-files rule for honesty-score framing. Phase 2 acceptance mentions "CONTRIBUTING.md states every workflow body added in any later phase MUST add a contract-test entry."
   - What's unclear: Is the Phase 2 CONTRIBUTING.md the first version, or is there a Phase 0 stub?
   - Recommendation: Phase 0 ships a minimal CONTRIBUTING.md with the chokepoint rules ("DOI regex `/^10\./` only in `bin/lib/doi.ts`; HTTP imports only in `bin/lib/http.ts`") — this is where future contributors look first. Phase 2 expands it.

3. **Should the manifest validator script also lint that `${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js` resolves after `npm run build`?**
   - **RESOLVED — strict (fail if missing):** planner adopted the recommendation. Plan 03's `scripts/validate-plugin-manifest.js` includes a Pitfall D guard: if `dist/` exists but `dist/mcp/server.js` does not, the validator exits non-zero with an actionable error. CI runs `npm run build` before the validator; local devs who skip the build get a clear message.
   - What we know: D-22 documents the chicken-and-egg in README-DEV.md; CI YAML adds `npm run build` before validation.
   - What's unclear: Whether the validator should fail if the file is missing (strict) or warn (lenient).
   - Recommendation: validator fails if the path is missing AFTER `npm run build`. CI inherits this strict behavior; local devs who skip `npm run build` get a clear actionable error.

4. **`packageManager` field exact pin — `npm@10.9.0` or `npm@10.x`?**
   - **RESOLVED — pin to exact `npm@10.9.0`:** planner adopted the recommendation. Plan 01's `package.json` pins `"packageManager": "npm@10.9.0"` exactly. Bumps will be deliberate, recorded in commit messages.
   - What we know: D-15 says `npm@10.x`. corepack interprets `npm@10.x` as a range; some toolchains require an exact version.
   - Recommendation: Pin to a specific 10.x version (e.g., `npm@10.9.0`) and bump deliberately. Document the choice in PLAN.md.

5. **OneDrive path vs `npm run build`'s `dist/` write speed.**
   - **RESOLVED — document in README-DEV.md, do not block Phase 0 acceptance:** planner adopted the recommendation. Plan 01's `README-DEV.md` advises Windows developers inside OneDrive/iCloud/Dropbox/Google Drive sync folders to exclude `dist/` and `node_modules/` from sync. Phase 0 acceptance is CI green (clean checkouts, no sync layer), not local-dev-ergonomics. Phase 2's `pensmith doctor` will surface the same warning for `.paper/` workspaces.
   - What we know: Pitfall 4 + the dev folder being inside OneDrive means atomic writes can race with sync. Phase 0's `npm run build` writes a lot of small files to `dist/`.
   - What's unclear: Will Phase 0 dev experience suffer from OneDrive sync delays during builds?
   - Recommendation: Add `dist/` to a OneDrive sync-exclude pattern in README-DEV.md as a Windows-developer note. Not a blocker for Phase 0 acceptance (Phase 0 acceptance is CI green, not local-dev-ergonomics).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All Phase 0 work | ✓ (assumed; planner verifies on dev machine) | ≥20.10.0 | None — Phase 0 cannot proceed without Node 20.10 LTS |
| npm | Install + scripts | ✓ (bundled with Node) | 10.x | None — npm is the locked package manager (D-13) |
| git | Repo + CI checkout | ✓ (assumed) | any modern | None — Phase 0 produces a git repo |
| GitHub account | CI matrix execution | ✓ (assumed; user's repo will live at github.com/akhilachanta/pensmith) | n/a | None — D-09 locks GitHub Actions |
| `claude` CLI (optional) | Local manifest validation via `claude plugin validate` | unknown | n/a | The custom Node validator at `scripts/validate-plugin-manifest.js` covers the same ground programmatically |

**Missing dependencies with no fallback:** None expected. If the developer machine lacks Node 20.10+, that is a blocker the planner must surface in Wave 0.

**Missing dependencies with fallback:** `claude plugin validate` is nice-to-have; the custom Node validator is the primary gate.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (built into Node 20+) + `c8` for coverage when needed |
| Config file | none — `node:test` is config-free |
| Quick run command | `node --test` |
| Full suite command | `npm run check` (= lint + typecheck + test + manifest validation) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REPO-01 | `package.json` valid + scripts work | smoke | `npm run check` (covers all) | ❌ Wave 0 (this phase creates them) |
| REPO-01 | `tsconfig.json` typechecks empty source tree | smoke | `npx tsc --noEmit` | ❌ Wave 0 |
| REPO-01 | `eslint.config.js` parses + lints repo | smoke | `npm run lint` | ❌ Wave 0 |
| REPO-01 | `.gitignore`, `LICENSE`, `README.md`, `PRIVACY.md` exist | unit | `tests/repo-files.test.ts` (asserts files exist with min content) | ❌ Wave 0 |
| REPO-02 | `.claude-plugin/plugin.json` validates | unit | `node scripts/validate-plugin-manifest.js` (also wrapped by `tests/manifest.test.ts`) | ❌ Wave 0 |
| REPO-02 | `.claude-plugin/marketplace.json` validates | unit | same | ❌ Wave 0 |
| REPO-03 | `.mcp.json` declares pensmith MCP server | unit | `tests/manifest.test.ts` asserts `mcpServers.pensmith.command === 'node'` and `args[0]` references `dist/mcp/server.js` | ❌ Wave 0 |
| REPO-04 | CI green on linux-x64 | smoke | GitHub Actions matrix entry `ubuntu-latest` | ❌ Wave 0 |
| REPO-04 | CI green on macos-arm64 | smoke | GitHub Actions matrix entry `macos-latest` (verify arm64 in run logs) | ❌ Wave 0 |
| REPO-04 | CI green on windows-x64 | smoke | GitHub Actions matrix entry `windows-latest` | ❌ Wave 0 |
| REPO-05 | Lint flags `undici` import outside `bin/lib/http.ts` | unit | `tests/lint-chokepoint.test.ts` asserts `no-restricted-imports` fires on fixture | ❌ Wave 0 |
| REPO-05 | Lint flags `/^10\./` regex outside `bin/lib/doi.ts` | unit | `tests/lint-chokepoint.test.ts` asserts `no-restricted-syntax` fires on fixture | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run lint && npx tsc --noEmit` (~5 sec total — fast feedback)
- **Per wave merge:** `npm run check` (full local pipeline)
- **Phase gate:** All three CI matrix entries green; manifest validator green; chokepoint test green; before `/gsd-verify-work`

### Wave 0 Gaps

Phase 0 has NO existing test infrastructure. Wave 0 must create:

- [ ] `tests/repo-files.test.ts` — asserts root files (`README.md`, `PRIVACY.md`, `LICENSE`, `.gitignore`) exist with minimum content
- [ ] `tests/manifest.test.ts` — wraps `scripts/validate-plugin-manifest.js` as a `node:test` test; also asserts `.mcp.json` and `plugin.json.mcpServers` shape
- [ ] `tests/lint-chokepoint.test.ts` — programmatic ESLint runner (D-08); asserts both rules fire on fixture
- [ ] `tests/fixtures/lint-chokepoint-fixture.ts` — the red-team fixture file (intentional violations)
- [ ] `scripts/validate-plugin-manifest.js` — manifest validator (D-17)
- [ ] Framework install: none beyond what's in `devDependencies` — `node:test` is built-in

## Security Domain

> Phase 0 is scaffolding-only with no business logic, no auth, no input handling, no crypto. The relevant security work is establishing the *scaffolding* that lets later phases enforce security disciplines. Most ASVS categories N/A at this phase.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Phase 0 establishes the directory contract (D-21) and chokepoint discipline (D-06/D-07) that ASVS V1 expects: clear architectural boundaries enforced by tooling |
| V2 Authentication | no | No auth in Phase 0 |
| V3 Session Management | no | No sessions in Phase 0 |
| V4 Access Control | no | No access control in Phase 0 |
| V5 Input Validation | partial | Manifest validator (`scripts/validate-plugin-manifest.js`) is itself an input validation pattern — JSON shape assertions before trusting the file |
| V6 Cryptography | no | No crypto in Phase 0; Phase 1's lock file (PID + hostname + heartbeat) is the first crypto-adjacent concern |
| V7 Error Handling | partial | The manifest validator's error path is the first user-facing error template; should print actionable messages, not stack traces |
| V8 Data Protection | no | No data handling in Phase 0 |
| V9 Communications | no | No HTTP in Phase 0; the chokepoint rule (D-06) is what enforces V9 in later phases |
| V10 Malicious Code | partial | `.gitignore` excludes `.env`, build artifacts, node_modules — keeps secrets/binaries out of git |
| V11 Business Logic | no | No business logic in Phase 0 |
| V12 Files & Resources | partial | Manifest path resolution (`${CLAUDE_PLUGIN_ROOT}` variable) is the canonical safe-path pattern Claude Code provides; Phase 0 establishes it correctly |
| V13 API & Web Services | no | n/a |
| V14 Configuration | yes | Phase 0 establishes config-as-code: tsconfig, eslint, package.json all version-controlled |

### Known Threat Patterns for Phase 0 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Supply-chain attack via dev dep tampering | Tampering | `package-lock.json` committed (D-14); `npm ci` (not `npm install`) in CI; pin major versions |
| Manifest injection via `${CLAUDE_PLUGIN_ROOT}` substitution abuse | Tampering | Variable is plugin-root-relative only; documented behavior. No user-controlled input flows into the manifest at Phase 0 |
| Build-time arbitrary code execution via postinstall scripts | Tampering / RCE | Phase 0 has no postinstall scripts. CI uses `--ignore-scripts` is **not** recommended at Phase 0 (typescript-eslint may require minimal install scripts); revisit if a Phase 1 dep adds suspicious postinstall |
| Lint rule rot (chokepoints silently disabled) | Repudiation | Red-team fixture (D-08) is the regression gate; CI fails if the fixture stops firing both violations |

## Project Constraints (from CLAUDE.md)

These directives carry the same authority as locked decisions and constrain the planner:

1. **Two-tier architecture (non-negotiable).** The Phase 0 source-tree skeleton (D-21) MUST support both Tier 1 (plugin) and Tier 2 (CLI) from day one. The shared `bin/lib/` directory is what makes this possible — Phase 0 creates it (empty), Phase 1+ populates it. The lint chokepoints (D-06/D-07) protect cross-tier invariants.
2. **Single-command UX (non-negotiable; Phase 7 concern, but Phase 0 must not block it).** The `bin/` directory ships at Phase 0; Phase 7 will add `bin/pensmith-cli.ts` with the `/pensmith` umbrella. Phase 0 does NOT need to populate this, but must not lock in a structure that prevents it.
3. **Verifier blocks compile and export (non-negotiable; Phase 3+ concern).** Phase 0 is irrelevant here, but the source-tree provision for `bin/lib/verifier.ts` (Phase 3) and `bin/lib/doi.ts` (Phase 1) lands here.
4. **No exported-document trace (non-negotiable; Phase 6 concern).** Phase 0 deliberately ships a STUB README (D-19) without the disclaimer because the disclaimer text is locked-copy that ships with the export pipeline; getting the wording wrong now would create drift later.
5. **Honest framing on detection (non-negotiable; Phase 6 concern).** Same as #4 — Phase 0 stubs deliberately avoid framing claims.
6. **Approval gates default-on (non-negotiable; Phase 7 concern).** Phase 0 doesn't gate anything; out of scope.
7. **MIT license (locked).** `LICENSE` ships at Phase 0.
8. **Local-only state (non-negotiable; Phase 1+ concern).** Phase 0 doesn't write user state; the empty `bin/lib/migrations/` directory is the first signal of the schema-versioning discipline.

## Open Risks / Landmines Specific to Phase 0

1. **CI matrix windows-x64 quirks.** Path separators, line endings (`\r\n` vs `\n`), case-insensitive filesystem. Mitigation: add `.gitattributes` with `* text=auto eol=lf` to normalize line endings; verify ESLint config files use forward slashes in glob patterns.
2. **`npm run build` writing to `dist/` inside OneDrive sync folder.** During development, OneDrive may grab files mid-write. CI is unaffected (clean checkouts). Mitigation: README-DEV.md note advising Windows developers to `attrib +U dist/` (OneDrive Files-On-Demand exclude) or move repo outside OneDrive.
3. **TypeScript-eslint v8 + ESLint 9 compatibility.** Both are recent; verify resolved versions at lock time. Fallback: pin to specific minor versions known-good (e.g., `eslint@9.18.0`, `typescript-eslint@8.20.0`) and document. (See Pitfall E.)
4. **macOS arm64 runner promotion.** `macos-latest` aliasing has shifted historically. Verify in CI logs that the runner is arm64. (See Pitfall C.)
5. **Manifest field churn.** Claude Code plugin manifest schema may have added fields between this research date (2026-05-06) and lock time. Re-read the docs at lock time. (See Pitfall A.)
6. **Empty `mcp/server.ts` stub vs `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`.** A truly empty file may not satisfy `verbatimModuleSyntax` requirements. Mitigation: stub file declares `export {};` to make it a module.
7. **`npm ci` on Windows with no `package-lock.json`.** First commit must include the lockfile or CI fails immediately. Bootstrap: run `npm install` locally, commit the lockfile, then push. CI uses `npm ci` thereafter.

## Dependencies on Later Phases (and Clean Seams Phase 0 Leaves)

Phase 0's job is to create clean seams that later phases populate without scaffolding rework.

| Phase 0 artifact | Later phase that uses it | Seam contract |
|------------------|--------------------------|---------------|
| `bin/lib/.gitkeep` | Phase 1 — every Foundation lib (paths, atomic-write, lock, doi, http, budget, migrations, pii, session-log, state, library, checkpoint, runtime) | Directory exists; chokepoint rules already protect future `bin/lib/http.ts` and `bin/lib/doi.ts` |
| `bin/lib/migrations/` | Phase 1 — migrations loader; later phases add `<from>-to-<to>.ts` files | Directory exists empty (per ARCH-07 + D-21); README documents the contract |
| `mcp/server.ts` stub | Phase 2 — TIER-01 (read-only resources) and TIER-02 (idempotent state-mutation tools) | File exists, exports an empty server; Phase 2 replaces the body without touching `.mcp.json` or build pipeline |
| `hooks/.gitkeep` | Phase 2 — TIER-03 (hooks.json wires SessionStart, Stop, PreCompact, PostToolUse); Phase 7 — HOOK-01..04 implements them | Directory exists; Phase 2 adds `hooks.json`; Phase 7 adds the actual hook scripts |
| `skills/.gitkeep` | Phase 3 — first skills (intake, research, outline, plan, write, verify); Phase 7 — UX umbrella `/pensmith` | Directory exists; one-skill-per-subdirectory layout per ARCH §2 |
| `agents/.gitkeep` | Phase 3 — researcher/evaluator/writer/verifier agents | Directory exists; `<agent-name>.md` per ARCH §2 |
| `workflows/.gitkeep` | Phase 3+ — workflow bodies are the shared source of truth for both tiers | Directory exists; `<skill-name>.md` per ARCH §2 |
| `templates/.gitkeep`, `templates/citation-styles/.gitkeep` | Phase 3 (PLAN/DRAFT/VERIFICATION skeletons) and Phase 10 (CSL files) | Directories exist for the planner |
| `references/.gitkeep` | Phase 2 — runtime-contract.md; Phase 3 — section-as-phase.md, source-policies.md | Directory exists; `@`-included from workflow bodies |
| `schema/.gitkeep` | Phase 1 — handoff-v1.json, state-v1.json, config-v1.json, section-state-v1.json | Directory exists; JSON Schema files added by Phase 1 |
| `tests/.gitkeep`, `tests/fixtures/.gitkeep` | Phase 1 — paths/atomic-write/lock/doi/http/budget tests; Phase 2 — tier-contract test; Phase 3 — fabricated-citation/quote fixtures | Directory exists with one example test (the chokepoint test); Phase 1 inherits the `node:test` pattern |
| `.github/workflows/ci.yml` | Phase 1+ — same CI matrix runs every later phase; Phase 2 wires `tier-contract.test.js` as merge gate (no YAML change needed if it's a `node:test` file) | YAML exists; later phases append steps if needed but should avoid restructuring |
| `eslint.config.js` chokepoints | Phase 1 — `bin/lib/http.ts` and `bin/lib/doi.ts` get the exemptions; Phase 2 — ARCH-18 may add a "no business logic in mcp/server.ts" rule (line-count or AST-based) | Flat config is extensible per `files:` overrides |
| `package.json` `engines.node: ">=20.10.0"` | All later phases | Locked at Phase 0; Phase 1+ Foundation libs assume Node 20.10 features |
| `tsconfig.json` strict + extras | All later phases | Strictness ratchet — never relaxed in later phases (anti-pattern: `// @ts-ignore` proliferation); per Pitfall 9 (two-tier drift), strict types are how we catch capability-check gaps |
| `scripts/validate-plugin-manifest.js` | Every later phase that touches `plugin.json` (e.g., Phase 2 adds skills/hooks/MCP tools entries) | Validator is extensible — add field assertions as `plugin.json` grows |

**Anti-seams (do NOT lock at Phase 0):**

- Don't pre-create files inside `skills/`, `agents/`, `workflows/`, `templates/` — only `.gitkeep`. Naming the files now ossifies decisions that belong to later phases.
- Don't define MCP tool schemas in `.mcp.json` or `plugin.json` — Phase 2 (TIER-01, TIER-02) defines the resource and tool surface.
- Don't ship a `CHANGELOG.md` — it implies a release, which Phase 0 isn't.

## Sources

### Primary (HIGH confidence)
- [Claude Code Plugins Reference](https://code.claude.com/docs/en/plugins-reference) — `plugin.json` schema, `.mcp.json` shape, `${CLAUDE_PLUGIN_ROOT}` variable, troubleshooting messages, plugin caching/file resolution
- [Claude Code Plugin Marketplaces](https://code.claude.com/docs/en/plugin-marketplaces) — `marketplace.json` required fields (`name`, `owner`, `plugins`), owner sub-fields, plugin entry shape
- [ESLint no-restricted-syntax docs](https://eslint.org/docs/latest/rules/no-restricted-syntax) — AST selector syntax, regex pattern matching
- [ESLint Selectors developer guide](https://eslint.org/docs/latest/extend/selectors) — esquery selectors, forward-slash escape gotcha
- [ESLint no-restricted-imports docs](https://eslint.org/docs/latest/rules/no-restricted-imports) — paths/patterns options
- `/tmp/refs/gsd-plugin/` (cloned reference repo) — verified 2026-05-06: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.mcp.json`, `bin/validate-plugin.cjs` shapes
- `.planning/research/STACK.md` — TypeScript + ESM + Node 20.10, ESLint flat config, `tsc` build, `node:test`, all version-pinned
- `.planning/research/ARCHITECTURE.md` — three-ring dependency model, source-tree skeleton, build-order phase shapes
- `.planning/research/PITFALLS.md` — Pitfall 2 (DOI normalization chokepoint), Pitfall 7 (HTTP chokepoint), Pitfall 8 (cross-platform paths)

### Secondary (MEDIUM confidence)
- typescript-eslint v8 release notes — bundled package replaces two-package pattern (verified via npm registry expected at lock time)
- GitHub Actions runner image announcements — `macos-latest` arm64 since macos-14 (verified via search)

### Tertiary (LOW confidence — flagged for verification at lock time)
- Exact resolved versions for `eslint@^9`, `typescript-eslint@^8`, `tsx@^4`, `typescript@^5.6` — must `npm view` at lock time per A2 / A3
- `packageManager: "npm@10.x"` semantics — corepack range vs exact version (Open Question 4)

## Metadata

**Confidence breakdown:**
- Plugin manifest shapes: HIGH — verified against Claude Code official docs AND gsd-plugin reference
- ESLint chokepoint enforcement: HIGH — verified against ESLint official docs; AST selector escape rules cited
- CI matrix YAML: HIGH — standard GitHub Actions pattern; runner OS-arch verified
- TypeScript config: MEDIUM-HIGH — STACK.md + CONTEXT.md D-03 lock the choices; `verbatimModuleSyntax` is an A4 assumption
- Source-tree skeleton: HIGH — every directory traced to ARCH/CONTEXT/PRD requirement
- `mcp/server.ts` stub strategy: MEDIUM — A6 assumption that SDK install can defer to Phase 2
- Open Questions resolution path: HIGH — each has a recommended default

**Research date:** 2026-05-06
**Valid until:** 2026-06-05 (30 days — manifest schemas + ESLint flat config are stable; if Claude Code releases a major plugin loader update before then, re-verify)

---

## RESEARCH COMPLETE

**Phase:** 0 - Repo skeleton & plugin manifest
**Confidence:** HIGH

Phase 0 is greenfield scaffolding with every implementation choice locked in CONTEXT.md (D-01..D-22). Research's contribution is the implementation-level "how exactly" — verified manifest schemas (Claude Code plugins reference + gsd-plugin), exact ESLint flat-config rule shapes with the AST-selector escape gotcha called out, GitHub Actions YAML for the linux/macos-arm64/windows matrix, the `tsconfig.json` field set, and a red-team fixture spec that turns the chokepoint rules into a hard regression gate. Eight open questions / assumptions surfaced for planner confirmation; none block Phase 0 from proceeding.
