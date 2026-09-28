# Pensmith — Developer Notes

`CLAUDE.md` is the architecture guide (tiers, pipeline modules, chokepoints, non-negotiables) and `CONTRIBUTING.md` the contributor workflow (test lanes, cassettes, the tier contract). This page covers the mechanics you hit first.

## Toolchain

Node **≥ 22.12** (`engines.node`); CI runs the Node 22 and 24 LTS lines on Ubuntu, macOS arm64 and Windows. `@types/node` tracks the floor (`^22`). The lockfile is committed and CI installs with `npm ci`, so a dependency change is `npm install <pkg>` plus the regenerated `package-lock.json` in the same commit.

## Build-first dependency

`.mcp.json` references `${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js`. A fresh git clone has no `dist/` (it is `.gitignore`'d per D-22). Before loading the plugin, running the manifest validator, or running the tests that spawn the built CLI, run:

```bash
npm ci
npm run build
```

`npm run build` runs `prebuild` (which generates the gitignored `bin/lib/version.generated.ts` and `bin/lib/verbs.json`) and then `tsc`, producing `dist/` from the TypeScript sources in `bin/`, `mcp/`, `hooks/`, `scripts/`, and `tests/`. `npm run lint` and `npm run typecheck` need the prebuild output too.

## Running the CLI from a checkout

```bash
npm run pensmith -- doctor              # through tsx, from source
node dist/bin/pensmith.js --version     # the built CLI
npm link && pensmith --version          # a global symlink, exactly like `npm i -g`
```

Entry points use `bin/lib/main-guard.ts` `isMainModule(import.meta.url)`, which compares realpaths, so the CLI and `dist/mcp/server.js` also run through `npm link`, `npm i -g`, `node_modules/.bin` shims and symlinked (or, on Windows, junctioned) plugin roots. A hand-rolled `import.meta.url === pathToFileURL(process.argv[1]).href` guard is false under a symlink and is rejected by the `main-guard` chokepoint row.

## Trying the workflow without a real key

Three ways to drive a paper from a checkout without a provider account, from least to most real (the third takes a placeholder key, which only ever reaches the loopback mock):

```bash
# 1. A dry run: zero sockets, synthetic sources, stubbed model — in ./.paper-dry-run/
#    (seeded from .paper/ when there is one; .paper/ is never written).
cd /some/scratch/folder && cp <checkout>/tests/fixtures/assignment.txt .
node <checkout>/dist/bin/pensmith.js --dry-run --yolo      # assignment → .paper-dry-run/export/DRAFT.dry-run.md

# 2. Stubbed model, live sources: PENSMITH_NO_LLM=1 answers every model call with its contract stub.
PENSMITH_NO_LLM=1 node <checkout>/dist/bin/pensmith.js --yolo   # one step per run

# 3. The mock LLM (RUN-21) as the provider, through the global runtime.json of an isolated data dir.
#    The anthropic provider requires a key even for a local endpoint: give it a placeholder.
npm run mock-llm -- --port 18080
#   <data dir>/pensmith/runtime.json: {"$schemaVersion":2,"provider":"anthropic","endpoint":"http://127.0.0.1:18080"}
ANTHROPIC_API_KEY=sk-local-mock node <checkout>/dist/bin/pensmith.js --yolo
```

Each bare run is one step (a section's step is plan → write → verify) and ends with `pensmith: ran …; next: …`. Run CLI experiments from a scratch folder with `XDG_DATA_HOME` (and `HOME` on macOS) pointing inside it, never from the checkout itself.

## Test runner

`npm test` runs `node scripts/run-tests.mjs`, which programmatically discovers `tests/**/*.test.ts` (no shell glob — works identically on linux, macos, and windows) and executes them via `node --import tsx --test`. The runner exits 1 if zero test files are found (avoids a vacuous CI pass on Windows). Pass files or directories to run a subset (`node scripts/run-tests.mjs tests/tier-contract/`) and `--`-flags to forward them to `node --test`.

The runner also isolates the data dir (CI-09): it points `XDG_DATA_HOME`, `LOCALAPPDATA` and `PENSMITH_TEST_DATA_DIR` at a per-run temp dir and sets `PENSMITH_TEST=1`, which also keeps sources offline unless `PENSMITH_NETWORK_TESTS=1`. `bin/lib/paths.ts` refuses a non-temp data dir under any test context, so `node --import tsx --test tests/<file>.test.ts` is isolated as well.

Whole-workflow tests drive the built CLI through `tests/helpers/e2e-chain.ts` (`openChainSandbox`: a project folder, an isolated data dir, the mock LLM and per-slug call counts; `loop()` repeats bare runs until a condition) over the recorded e2e corpus (`tests/fixtures/e2e-corpus/`, re-recorded with `npm run cassettes:refresh -- --corpus e2e`; see CONTRIBUTING.md).

## Chokepoint rule

`npm run lint` includes the local rule `pensmith/chokepoint` (`scripts/eslint-rules/chokepoint.mjs`), driven by the rows in `scripts/chokepoints/*.json`. `tests/chokepoints.test.ts` lints each row's `tests/fixtures/chokepoints/<id>.violation.ts.txt` (ignored by project lint) and must see it fail. See the CLAUDE.md chokepoint table before adding code that crosses a module boundary.

## OneDrive / iCloud / Dropbox / Google Drive

If your repo lives inside a sync folder (the upstream dev folder is `Documents/Github/pensmith` inside OneDrive), exclude `dist/` and `node_modules/` from sync to avoid build-time races. `pensmith doctor` surfaces this warning for `.paper/` workspaces; the same advice applies to the dev tree.

## Quick check

`npm run check` runs prebuild, lint, typecheck, build, the tier contract, the tests and the manifest validation in one shot — the same order as CI.
