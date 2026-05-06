# Pensmith — Developer Notes

## Build-first dependency

`.mcp.json` references `${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js`. A fresh git clone has no `dist/` (it is `.gitignore`'d per D-22). Before loading the plugin or running the manifest validator, run:

```bash
npm ci
npm run build
```

`npm run build` invokes `tsc` and produces `dist/` from the TypeScript sources in `bin/`, `mcp/`, `hooks/`, `scripts/`, and `tests/`.

## Test runner

`npm test` runs `node scripts/run-tests.mjs`, which programmatically discovers `tests/**/*.test.ts` (no shell glob — works identically on linux, macos, and windows) and executes them via `node --import tsx --test`. The runner exits 1 if zero test files are found (avoids vacuous CI pass on Windows).

## OneDrive / iCloud / Dropbox / Google Drive

If your repo lives inside a sync folder (the upstream dev folder is `Documents/Github/pensmith` inside OneDrive), exclude `dist/` and `node_modules/` from sync to avoid build-time races. Phase 2's `pensmith doctor` command surfaces this warning for `.paper/` workspaces; the same advice applies to the dev tree.

## Quick check

`npm run check` runs lint + typecheck + tests + manifest validation in one shot.
