# Phase 0: Repo skeleton & plugin manifest - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning
**Mode:** `--auto` (recommended defaults selected for every gray area; see audit log at end of file)

<domain>
## Phase Boundary

Stand up the repo, plugin manifest, MCP entry, and CI discipline that every later phase depends on. Phase 0 ships **no business logic** — only the scaffolding (config files, manifests, lint chokepoints, CI matrix, empty source-tree dirs) that makes Phase 1 Foundation NFRs land cleanly. The phase ends when `npm run lint`, `tsc --noEmit`, and `node --test` (zero tests is fine) all pass on linux-x64 / macos-arm64 / windows-x64 in CI, and the plugin/MCP manifests validate.

In scope: `package.json`, `tsconfig.json`, `eslint.config.js`, `.gitignore`, `LICENSE`, README skeleton, `PRIVACY.md` skeleton, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.mcp.json`, CI workflow, lint chokepoint rules + red-team fixture, empty `bin/`, `bin/lib/`, `mcp/`, `hooks/`, `skills/`, `agents/`, `workflows/`, `templates/`, `references/`, `schema/`, `tests/`, `migrations/` directories with `.gitkeep`.

Out of scope (belongs in later phases): any Foundation NFR implementation (Phase 1), any tier shell or doctor (Phase 2), any feature work (Phase 3+), full v0.1.0 README with disclaimer (Phase 6 — when export becomes real).

</domain>

<decisions>
## Implementation Decisions

### TypeScript build pipeline
- **D-01:** Compile to `dist/` via `tsc`. Pensmith is a portable npm package (Tier 2) plus a Claude Code plugin (Tier 1); shipping compiled JS is the only portable distribution form across both tiers.
- **D-02:** `tsx` is the dev-time loader (`npm run dev`); production never depends on a TS loader.
- **D-03:** `tsconfig.json` targets ES2022, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, full `strict`, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **D-04:** Node 22 native TS strip is **not** a Phase 0 dependency — pensmith's minimum is Node 20.10 LTS per research/STACK.md. Re-evaluate at v0.2.

### Lint chokepoint enforcement (REPO-05)
- **D-05:** Use ESLint flat config (`eslint.config.js`). Modern standard in 2026; flat config is what Claude Code's own plugin examples ship.
- **D-06:** Enforce "no `fetch` / `http` / `https` / `undici` imports outside `bin/lib/http.ts`" using the built-in ESLint `no-restricted-imports` rule alone, with a per-file override that turns the rule OFF inside `bin/lib/http.ts`. **Revised cycle 2 (2026-05-07):** the original plan to also use `eslint-plugin-import/no-restricted-paths` was dropped — the built-in rule + per-file override fully encodes D-06's literal wording without a third-party dependency. Phase 1+ may re-introduce `eslint-plugin-import` if directory-scoped restrictions across multiple `bin/lib/` modules are needed; not required at Phase 0. Plans 00-01 and 00-02 reflect this; if a future planner reintroduces the plugin, this decision must be revisited.
- **D-07:** Enforce "no `/^10\./` regex literal outside `bin/lib/doi.ts`" with `no-restricted-syntax` and an AST selector matching `Literal[regex.pattern=/^\^10\\\\\\./]` (or equivalent). DOI normalization is a single chokepoint per Pitfall 2.
- **D-08:** Ship a **red-team fixture** at `tests/lint-chokepoint.test.ts` that contains both violations (a stray `import { fetch } from 'undici'` outside `http.ts`, and a `/^10\./` regex outside `doi.ts`) and verify in CI that ESLint flags both. Without the fixture the chokepoint rules can rot silently.

### CI matrix (REPO-04)
- **D-09:** GitHub Actions only. Repo lives on GitHub; matching the runtime to the host avoids extra surface area.
- **D-10:** Matrix is `[linux-x64, macos-arm64, windows-x64]` × `[node@20.10]` for v0.1.0. macos-arm64 + windows-x64 are non-negotiable (Pitfall 8 path landmines surface only on real OSes); Node 22 deferred until native TS strip becomes load-bearing.
- **D-11:** CI steps: `actions/setup-node@v4` → `npm ci` → `npm run lint` → `npx tsc --noEmit` → `node --test` → manifest validation (`node scripts/validate-plugin-manifest.js`). All steps run on every matrix entry.
- **D-12:** Cache `node_modules` keyed on `package-lock.json`. Don't enable codecov yet — there's no code to cover.

### Package manager
- **D-13:** **npm.** Stdlib-aligned with Node, no extra installer step in CI, matches what Claude Code's own plugin examples ship. Pnpm/bun are not net wins for a single-package repo and would surprise contributors.
- **D-14:** Lockfile (`package-lock.json`) committed.
- **D-15:** `engines.node` set to `>=20.10.0` and `packageManager` field set to `npm@10.x` (avoids accidental other-PM installs).

### Plugin & MCP manifests (REPO-02, REPO-03)
- **D-16:** `.claude-plugin/plugin.json` — `name: "pensmith"`, `version: "0.1.0-dev"`, `description` from PROJECT.md "Core Value", `license: "MIT"`, author from CLAUDE.md (`akhilachanta8@gmail.com`), capabilities/skills declared as Phase 0 placeholders (real entries are added phase-by-phase).
- **D-17:** `.claude-plugin/marketplace.json` ships the same metadata in marketplace shape; both files validated by a tiny Node script in `scripts/validate-plugin-manifest.cjs` (note: `.cjs` extension because `package.json` is `"type": "module"`) that runs in CI (D-11). **Revised cycle 2 (2026-05-07):** the validator implements **structural assertions** against the documented Claude Code plugin manifest contract (required fields: `name` kebab-case, `version` semver, `author.name`, `mcpServers[].command`; required marketplace fields: `name`, `owner.name`, `plugins[].name + .source`). It does NOT consume an upstream JSON-Schema file — Anthropic does not currently publish a stable JSON-Schema artifact for plugin manifests. The structural-assertion approach matches gsd-plugin's `bin/validate-plugin.cjs`. If Anthropic publishes a JSON-Schema later, swap the validator to schema-validate and keep the structural fallback for offline CI. Phase 0 success criterion #2 ("validate against the Claude Code plugin schema") is satisfied by structural assertions until then.
- **D-18:** `.mcp.json` declares the pensmith MCP server with `command: "node"`, `args: ["${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js"]`. The actual `mcp/server.ts` at Phase 0 is a **deliberate non-runnable stub** (`export {};` only) — it satisfies the path reference at lock time so the validator's "if `dist/` exists, `dist/mcp/server.js` MUST exist" guard (Pitfall D) does not fire after `npm run build`. **Revised cycle 2 (2026-05-07):** Phase 0 acceptance does NOT require the server to actually start. If Claude Code's plugin loader attempts to launch the MCP server when the plugin is loaded into a session, it will exit immediately (no resources/tools registered, no listener); this is acceptable for Phase 0 because the plugin is not yet installed/loaded into a real session — only the manifest validates. Real MCP server bring-up (read-only resources `paper://state`, `paper://outline`, etc.) lands in Phase 2 per `TIER-01`. Plans 00-03 and 00-04 do NOT spawn the server; they only assert the manifest shape and the file-path resolution.

### README scope at Phase 0
- **D-19:** Phase 0 ships a **stub README** only: project name, one-line description, "v0.1.0 in development — see PRD.md", link to PRD.md and PROJECT.md. The full v0.1.0 README with the AI-detection / humanizer / style-match dual-use disclosure (PRD §3, non-negotiable per CLAUDE.md) ships in Phase 6 when the export pipeline is real and the disclaimer becomes load-bearing.
- **D-20:** `PRIVACY.md` ships as a stub matching D-19's scope: "Local-only, no telemetry, no cloud" + "Full privacy doc in v0.1.0".

### Source-tree skeleton
- **D-21:** Phase 0 creates these empty directories with `.gitkeep`: `bin/`, `bin/lib/`, `bin/lib/migrations/`, `mcp/`, `hooks/`, `skills/`, `agents/`, `workflows/`, `templates/`, `templates/citation-styles/`, `references/`, `schema/`, `tests/`, `tests/fixtures/`. The directory contract is itself a load-bearing element — Pitfall 4 (state corruption) and Pitfall 10 (section invariants) both depend on the directory layout being declared up front, not improvised.
- **D-22:** A top-level `dist/` is `.gitignore`'d but the `dist/mcp/` path that `.mcp.json` references is documented in README-DEV.md so contributors don't trip over the chicken-and-egg `npm run build` step.

### Claude's Discretion
The following are mechanical choices the planner can make without further input:
- Exact dependency pin styles (`^` vs exact) — match research/STACK.md guidance: pin `pdf-parse` exact, allow caret on everything else.
- ESLint plugin choice for the directory-scoped ban (`eslint-plugin-import/no-restricted-paths` is recommended; if a flatter alternative emerges, the planner picks).
- CI workflow file name (`.github/workflows/ci.yml` is conventional).
- Whether to add a `npm run` aggregator command (`npm run check` = lint + tsc + test). Recommended yes.
- Schema-version stamp in placeholder JSON files (use `schema_version: 1` everywhere from day one per ARCH-07, even on stubs).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project source-of-truth
- `PRD.md` — Pensmith specification (819 lines). §3 README disclaimer, §14 verifier non-negotiables, §15 v0.1.0 success criteria, §17 deferred discuss-phase questions, §18 attribution, §19 NFRs-as-early-phase guidance.
- `CLAUDE.md` — Project memory and non-negotiables (load-bearing model, two-tier requirement, single-command UX, verifier gates, no exported trace, honest framing).

### Phase scope inputs
- `.planning/PROJECT.md` — Active requirements, constraints, key decisions table.
- `.planning/REQUIREMENTS.md` — REPO-01 through REPO-05 are this phase's full requirement set.
- `.planning/ROADMAP.md` Phase 0 — Goal and the 5 success criteria the phase must satisfy.

### Research-grounded design choices
- `.planning/research/STACK.md` — Stack picks: TypeScript + ESM, Node ≥20.10, npm, ESLint flat, `tsc` build, `node:test` + `c8` + `nock`. Versions listed are 2026-current.
- `.planning/research/ARCHITECTURE.md` — Three-ring dependency model justifying the source-tree skeleton (D-21).
- `.planning/research/PITFALLS.md` — Pitfall 2 (DOI normalization chokepoint), Pitfall 7 (HTTP chokepoint), Pitfall 8 (cross-platform paths) ground D-06 through D-11.

### External specs to validate against (read at lock time, cache version)
- Claude Code Plugin reference docs at code.claude.com/docs — schema for `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` (D-16, D-17).
- Model Context Protocol spec — schema for `.mcp.json` (D-18).
- DOI Handbook §case-insensitivity — informs the regex chokepoint test in D-08.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None. Phase 0 is greenfield; the repo currently contains only `.planning/`, `PRD.md`, `CLAUDE.md`, `NOTES.md`, and `pensmith.txt`. No `package.json` exists yet.

### Established Patterns
- `gsd-plugin` (`https://github.com/jnuyens/gsd-plugin`) is the architectural reference per CLAUDE.md. Pensmith adapts (does NOT copy) its plugin manifest layout, MCP server pattern, CLI scaffold, and capability_check workflow body pattern. The cloned reference repo path (`/tmp/refs/gsd-plugin`, per CLAUDE.md) is what the planner should consult for shape, not for code-lift.
- `Get Shit Done` (`https://github.com/gsd-build/get-shit-done`) is the secondary reference for skill / agent / hook patterns.

### Integration Points
- The MCP server entry declared in `.mcp.json` (D-18) MUST resolve to a `dist/mcp/server.js` artifact produced by `npm run build`. Phase 0 ships the stub server file; Phase 2 fills in read-only resources; Phase 4 adds idempotent state-mutation tools.
- The CI matrix (D-10) is the same matrix `tier-contract.test.js` will run on starting Phase 2. Phase 0 sets the precedent.
- Lint chokepoints (D-06, D-07) are the enforcement mechanism for the architectural invariants Phase 1 (`http.ts`, `doi.ts`) will rely on. The chokepoints exist *before* the modules they protect — the red-team fixture (D-08) keeps the rules honest in the gap.

</code_context>

<specifics>
## Specific Ideas

- **Repo hosting confirmed GitHub.** Per CLAUDE.md the dev folder is at `Documents/Github/pensmith` — repo will live at github.com/akhilachanta/pensmith (or similar). CI choice (D-09) follows.
- **OneDrive caveat.** The current dev folder lives inside `OneDrive - Roanoke College`. Phase 0 itself has no state-file writes (all artifacts are git-tracked source), so OneDrive doesn't bite here — but the doctor warning (DOCT-04) ships in Phase 2. Note the warning text already exists as a non-negotiable in CLAUDE.md.
- **"Pensmith" name disambiguation.** The plugin manifest `name` field is `"pensmith"` (lowercase, no separator). The npm package name matches. Display name in marketplace.json can be `"Pensmith"`.
- **Author / license.** MIT per PROJECT.md constraint. Author = `akhilachanta8@gmail.com` per CLAUDE.md userEmail. Year = 2026.

</specifics>

<deferred>
## Deferred Ideas

- **Node 22 native TS strip in CI** — defer to v0.2 when the new pipeline becomes a measurable win. v0.1.0 ships with Node 20.10 LTS only.
- **Codecov / coverage thresholds** — defer to Phase 1 when there's actually code to cover.
- **Bundling for plugin distribution** (e.g., into a single `.tgz`) — defer; Claude Code plugins ship from a directory, not a bundle. Re-evaluate if the marketplace surface changes.
- **Pre-commit hooks (husky / lint-staged)** — defer to Phase 1 when foundation libs add real surface area worth gating locally. Phase 0's lint runs in CI is sufficient.
- **Full v0.1.0 README** — explicitly Phase 6 territory, when the disclaimer (PRD §3) is real. A premature README promises features that don't exist yet.
- **GitHub repo settings: branch protection, required CI, CODEOWNERS** — operational, not Phase 0 code. Defer to Phase 6 launch prep.

</deferred>

---

## Auto-mode audit log

This phase ran under `--auto`. Every gray area was auto-resolved with the recommended default. Log preserved here so the user can review and correct before Phase 1 starts.

| Gray area | Recommended → Selected | Rationale source |
|-----------|------------------------|------------------|
| TypeScript build pipeline | `tsc` compile to `dist/` (with `tsx` for dev) | research/STACK.md + portable npm distribution requirement |
| Lint chokepoint enforcement | `no-restricted-imports` + `no-restricted-syntax` + red-team fixture | Pitfalls 2 & 7 demand chokepoints; rules without a fixture rot silently |
| CI matrix | linux-x64 + macos-arm64 + windows-x64 × Node 20.10 only | Pitfall 8 cross-platform; Node 22 deferred per D-04 |
| Package manager | npm | Stdlib-aligned; Claude Code plugin convention |
| ESLint config style | Flat config (`eslint.config.js`) | 2026 modern standard |
| README scope | Stub only at Phase 0 | Full README belongs in Phase 6 when disclaimer is real |
| Plugin manifest values | Pulled from PROJECT.md / CLAUDE.md (name, license, author, version) | Mechanical |
| MCP server entry shape | `dist/mcp/server.js` stub at Phase 0; resources Phase 2 | Roadmap-aligned |
| Source-tree skeleton | All architectural directories created up front with `.gitkeep` | ARCH-02 + Pitfalls 4/10 require directory contracts to exist |

If any of these defaults conflict with intent, edit this CONTEXT.md before running `/gsd-plan-phase 0`.

---

*Phase: 0-repo-skeleton-plugin-manifest*
*Context gathered: 2026-05-06*
