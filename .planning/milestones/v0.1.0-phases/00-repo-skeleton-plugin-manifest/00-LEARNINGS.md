---
phase: 0
phase_name: "repo-skeleton-plugin-manifest"
project: "pensmith"
generated: "2026-05-16"
counts:
  decisions: 14
  lessons: 4
  patterns: 7
  surprises: 3
missing_artifacts:
  - "00-UAT.md"
---

# Phase 0 Learnings: repo-skeleton-plugin-manifest

## Decisions

### Test runner via Node script, not shell glob
`scripts.test = "node scripts/run-tests.mjs"` was chosen over a shell-glob pattern like `node --test tests/**/*.test.ts`.

**Rationale:** Windows `cmd.exe` does not expand globs, and Node 20.10 lacks native `--test` glob support (D-10). A portable JS discoverer using `readdir({ recursive: true })` works on all three OSes in the CI matrix.
**Source:** 00-01-SUMMARY.md

---

### Built-in ESLint chokepoints over `eslint-plugin-import`
No `eslint-plugin-import` was added; D-06 (HTTP import chokepoint) is satisfied by built-in `no-restricted-imports` with per-file overrides for `bin/lib/http.ts`.

**Rationale:** Avoids an extra dependency for a need the built-in rule already covers. Revised cycle 2 of D-06.
**Source:** 00-01-SUMMARY.md

---

### Test fixtures excluded from typecheck
`tsconfig.json` `exclude` includes `tests/fixtures/**/*` from day one.

**Rationale:** Plan 00-02's red-team fixture uses `@ts-nocheck` and intentional violations; type-checking it would fail the build.
**Source:** 00-01-SUMMARY.md

---

### Pinned package manager
`packageManager: "npm@10.9.0"` locked in `package.json` (D-15).

**Rationale:** Reproducible installs across contributor machines; matches CI runner default.
**Source:** 00-01-SUMMARY.md

---

### MCP server is a Phase 0 stub
`mcp/server.ts` ships as `export {}` only; the server does not start at Phase 0 (D-18 revised cycle 2).

**Rationale:** Phase 0 acceptance only requires the file compile under strict tsconfig; resources land in Phase 2 (TIER-01). Documented as Known Stub.
**Source:** 00-01-SUMMARY.md

---

### DOI regex AST selector uses 4-level escape depth
The D-07 chokepoint selector is `Literal[regex.pattern=/^\^10\\\\\\./]`.

**Rationale:** AST attribute selector requires escapes at three levels of nesting: ESLint AST pattern (`^10\.`), regex attribute selector syntax (`/^\^10\\./`), and JS string in the config file. Pitfall B's benign negative test (`/^11\./`) verifies the selector does not over-fire.
**Source:** 00-02-SUMMARY.md

---

### Integration test loads project config from disk
Test 3 in `tests/lint-chokepoint.test.ts` loads `eslint.config.js` via dynamic import rather than re-declaring the rules inline.

**Rationale:** Proves the actual project config is correct, not just that the rules work in theory. Catches drift between an inline copy and the real config.
**Source:** 00-02-SUMMARY.md

---

### MCP server declared in two manifests
The pensmith MCP server appears in both `.claude-plugin/plugin.json` (`mcpServers.pensmith`) and `.mcp.json` (Assumption A3).

**Rationale:** Redundant dual-declaration per D-18 + RESEARCH A3; matches gsd-plugin's pattern and ensures both plugin-aware tools and bare MCP clients can resolve the server.
**Source:** 00-03-SUMMARY.md

---

### Structural manifest validation, not JSON-Schema
`scripts/validate-plugin-manifest.cjs` uses procedural structural assertions (kebab-case regex, semver check, required-field assertions) instead of validating against a JSON-Schema artifact.

**Rationale:** Anthropic does not publish a stable JSON-Schema artifact for plugin manifests (D-17 revised cycle 2). gsd-plugin's `bin/validate-plugin.cjs` uses the same approach.
**Source:** 00-03-SUMMARY.md

---

### `.cjs` files in scripts/ exempt from `no-require-imports`
`eslint.config.js` carries `{ files: ['scripts/**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } }`.

**Rationale:** `.cjs` extension is mandatory in `type:module` packages for CommonJS files; those files intentionally use `require()`. `tseslint.configs.recommended` enables `no-require-imports` by default and would otherwise block the validator.
**Source:** 00-03-SUMMARY.md

---

### CI matrix is single Node LTS only
The matrix runs Node 20.10 only on ubuntu / macos / windows; Node 22 deferred to v0.2 (D-10).

**Rationale:** Phase 0 scope is minimal verification; adding Node 22 triples the matrix cost for marginal coverage. Revisit when v0.2 needs forward-compat evidence.
**Source:** 00-04-SUMMARY.md

---

### `npm run build` before `npm test` in CI step order
CI orders steps `lint → tsc → build → test → validate:manifests`, with `build` preceding `test`.

**Rationale:** The manifest validator's Pitfall D guard checks that `dist/mcp/server.js` resolves if `dist/` exists. Building first ensures the path resolves cleanly during the final `validate:manifests` step.
**Source:** 00-04-SUMMARY.md

---

### `fail-fast: false` on the CI matrix
The matrix continues all three OS jobs even if one fails.

**Rationale:** A macOS failure must not hide independent Windows path-handling failures. Cross-platform debugging requires independent signals per OS.
**Source:** 00-04-SUMMARY.md

---

### Pitfall C ARM64 assertion on macos-latest
The macOS job runs `test "$RUNNER_ARCH" = "ARM64"` as an explicit early step.

**Rationale:** GitHub has historically demoted `macos-latest` back to Intel without notice. The cheap assertion fails fast on demotion so the team learns immediately rather than discovering arm64-only test gaps later.
**Source:** 00-04-SUMMARY.md

---

## Lessons

### ESLint flat-config global-ignores are unconditional
A flat-config entry with only an `ignores` key (no `files`) is a hard global exclude — appending a later `{ files: [...] }` entry to "un-ignore" a path does **not** work. ESLint returns `ruleId: null, message: "File ignored because of a matching ignore pattern"` instead of rule violations.

**Context:** The plan suggested appending a `files: ['tests/fixtures/lint-chokepoint-fixture.ts']` entry to un-ignore the fixture for the integration test. This failed silently. Fix: filter out global-ignores-only entries from the loaded project config before constructing the integration-test ESLint instance.
**Source:** 00-02-SUMMARY.md

---

### `tseslint.configs.recommended` enables `no-require-imports` by default
The spread `tseslint.configs.recommended` brings in `@typescript-eslint/no-require-imports`, which fires on every `require()` call — including legitimate CommonJS `.cjs` files inside ESM packages.

**Context:** Discovered when `npm run check` failed on `scripts/validate-plugin-manifest.cjs`. Requires a targeted per-file override; this is not visible until lint actually runs against the file.
**Source:** 00-03-SUMMARY.md

---

### Auto-approved human-verify gates leave verification gaps
`auto_advance: true` will auto-approve a `checkpoint:human-verify` task based on local pipeline success, even when the task's verification criteria explicitly require an external action (e.g., pushing to GitHub and inspecting the Actions tab).

**Context:** Plan 04 Task 2 was a human-verify checkpoint for the GitHub CI matrix. Local pipeline was green, auto_advance approved the task, but the actual GitHub push never happened. gsd-verifier correctly flagged this as `human_needed` with 4/5 success criteria verified.
**Source:** 00-VERIFICATION.md

---

### Plans drove themselves to ~5–12 min per plan
Phase 0's four plans completed in roughly 12 / 4 / 3 / 2 minutes respectively, despite covering scaffolding, lint config, manifests, and CI YAML — categories that often consume hours.

**Context:** Tight CONTEXT.md decisions (D-01..D-22) eliminated mid-execution ambiguity. Pre-locked field shapes (e.g., `packageManager:"npm@10.9.0"`, `mcpServers.pensmith.command:"node"`) meant the executor had no choices to make.
**Source:** 00-01..00-04 SUMMARY.md metrics fields

---

## Patterns

### Red-team fixture + programmatic ESLint test as regression gate
For every architectural lint chokepoint, ship a fixture file containing the intentional violation plus a programmatic ESLint test that asserts the rule fires on the fixture and does NOT fire on a benign near-match.

**When to use:** Whenever a lint rule encodes an architectural invariant. Without a fixture, rules rot silently when ESLint upgrades, AST node names change, or someone replaces the rule with `// eslint-disable-next-line`. D-08 pattern.
**Source:** 00-02-SUMMARY.md

---

### Filter global-ignores entries when loading project config for integration testing
When an integration test needs to lint a file that the project's `eslint.config.js` globally ignores, load the project config, filter out entries that are pure-ignores objects, and pass the remaining entries to the test's `ESLint` instance.

**When to use:** Any integration test that asserts "the project's actual rules fire on file X" where X is ignored in production lint runs (red-team fixtures, vendored code, generated files).
**Source:** 00-02-SUMMARY.md

---

### Phase-stub pattern: `export {}` files that compile
A file that has no Phase 0 body but must exist for downstream phases ships as `export {};` with a `// Phase N stub` comment and a Known Stubs table entry pointing to the future plan.

**When to use:** When the directory contract or manifest references a file before its real implementation lands. Compiles cleanly under `verbatimModuleSyntax`, makes the deferred work explicit.
**Source:** 00-01-SUMMARY.md (mcp/server.ts)

---

### Portable test discoverer instead of shell-glob test script
Replace `node --test tests/**/*.test.ts` with `node scripts/run-tests.mjs` where the script walks `tests/` recursively, collects `*.test.ts`, and spawns `node --import tsx --test` with the collected paths.

**When to use:** Any cross-platform repo that targets Windows + macOS + Linux on a Node version before native `--test` glob support. The script also adds a "zero-test-files" guard that fails CI to prevent vacuous passes.
**Source:** 00-01-SUMMARY.md

---

### Dual-declaration of MCP server (plugin.json + .mcp.json)
Declare the MCP server in both `.claude-plugin/plugin.json` (`mcpServers.pensmith`) and `.mcp.json` with identical command/args.

**When to use:** Any Claude Code plugin that ships an MCP server and wants discoverability via both plugin-aware tooling and bare MCP clients. Matches gsd-plugin's pattern; redundancy is intentional per RESEARCH A3.
**Source:** 00-03-SUMMARY.md

---

### Structural manifest validator when vendor publishes no schema
For ecosystems where the vendor does not publish a stable JSON-Schema artifact (Claude Code plugin manifests at time of writing), use a `.cjs` validator script that performs procedural structural assertions on required fields.

**When to use:** Validating manifests, configs, or any contract where ajv-against-vendor-schema is impossible. Matches gsd-plugin's `bin/validate-plugin.cjs` approach.
**Source:** 00-03-SUMMARY.md

---

### CI matrix step order: `lint → tsc → build → test → validate`
Standardized CI step order for any TypeScript+ESM project with manifest validation: lint first, typecheck second, build before tests, then run tests, then validate manifests last (after `dist/` is materialized so existence-guard validators see the compiled output).

**When to use:** Any CI workflow that combines `tsc` compilation with manifest validation that asserts compiled output paths exist. Order matters: validating before building causes false positives if `dist/` is absent and false negatives if `dist/` is stale.
**Source:** 00-04-SUMMARY.md

---

## Surprises

### ESLint flat-config global-ignores semantics differ from intuition
The plan's suggested approach for un-ignoring a fixture in an integration test did not work the way config-merging in older ESLint versions worked. Required an in-flight approach adjustment (auto-fixed Rule 1).

**Impact:** One auto-fix during 00-02 Task 2 execution; no plan-scope change. The lesson is now codified in [[lesson-eslint-flat-config-global-ignores]].
**Source:** 00-02-SUMMARY.md (Deviations from Plan)

---

### tseslint.configs.recommended fires `no-require-imports` on `.cjs` files
Including `tseslint.configs.recommended` blocked the CommonJS validator script with `@typescript-eslint/no-require-imports`. Not obvious from reading rule docs in isolation; only visible after running lint against the .cjs file.

**Impact:** One auto-fix during 00-03 Task 2 (added `scripts/**/*.cjs` override). Locks in the pattern for any future `.cjs` files.
**Source:** 00-03-SUMMARY.md (Deviations from Plan)

---

### Auto-approval bypassed the only real CI verification
Plan 04 Task 2 was the entire Phase 0 success criterion #1 (CI green on three OSes). `auto_advance: true` approved it on local-pipeline-green alone, and gsd-verifier caught the gap (4/5 verified, 1 NEEDS HUMAN).

**Impact:** Phase 0 closed as `human_needed` rather than fully verified. Recommendation in VERIFICATION.md is to push to GitHub and confirm before Phase 1 (low-risk, but a real outstanding action).
**Source:** 00-VERIFICATION.md
