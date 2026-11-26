# pensmith doctor

> Run ecosystem self-check — 10 probes across runtime and ecosystem presence. Exits 1 on FAIL.

<capability_check>
required:
  - (none required)

degrade_if_missing:
  - (no degradation needed — doctor is read-only)
</capability_check>

## Overview

`pensmith doctor` calls `runDoctor()` (`bin/lib/doctor/probes.ts`) which runs 10 probes
in parallel via `Promise.allSettled`. Results are rendered via `renderTty()` (human-first
prose, grouped by severity) or `renderJson()` (the `--json` flag, schema v1 per D-18).
Exits 0 if all probes are PASS/WARN/SKIP; exits 1 if any probe is FAIL (D-15).

Probe strings are sourced from `references/doctor-output.md` (locked — D-18). Any
wording change to that file must re-pin the SHA-256 hash in `tests/repo-files.test.ts`.
Probe is READ-ONLY (D-19): no `.paper/` writes, no locks, no atomicWriteFile.

## Outputs

- stdout: TTY prose table (default) or JSON `{ schemaVersion:1, probes:{...}, summary:{...} }` (--json)
- exit code 0 (all probes PASS/WARN/SKIP) or 1 (any probe FAIL)

## Body

1. **Run all 10 probes in parallel** via `runDoctor()` (`bin/lib/doctor/probes.ts`):
   - **DOCT-01 — runtime:** `node-version` (FAIL below Node 22.12, the package.json engines floor)
   - **DOCT-02 — ecosystem:** `zotero-mcp-presence` (WARN if no Zotero MCP server is configured where Claude Code reads MCP servers, or ZOTERO_API_KEY is unset; research does not read from Zotero yet), `pandoc-presence` (WARN if not on PATH), `humanizer-skill-presence` (WARN if no humanizer skill is installed under ~/.claude/skills/, the project's .claude/skills/ or an installed plugin)
   - **DOCT-03 — config:** `contact-email-presence` (WARN if PENSMITH_CONTACT_EMAIL unset)
   - **DOCT-04 — env:** `sync-folder-detection` (WARN if .paper/ inside OneDrive/iCloud/Dropbox/Google Drive)
   - **DOCT-05 — wiring:** `intake-outline-verify-wiring` (FAIL if any of the 6 Phase-3 verbs are unwired)
   - **DOCT-07 — runtime config:** `runtime-config-presence` (WARN if no provider API key set)
   - **install:** `build-artifact-resolves` (FAIL unless a CLI entry, `dist/pensmith.mjs` in the plugin or `dist/bin/pensmith.js` in a source build, runs `--version`, and the prompt templates, CSL styles and reference copy it reads are present)
   - **D-03(d) — cassette:** `http-crossref-ping` (cassette-wiring smoke; SKIP outside the repo)

2. **Render output** based on the `--json` flag:
   - Default (TTY): `renderTty(results)` — human-first prose, severity emoji, probe summary + fix strings sourced from `references/doctor-output.md`.
   - `--json`: `renderJson(results)` — schema v1 JSON (D-18 shape: `{ schemaVersion:1, probes:{}, summary:{} }`).

3. **Exit**: 0 if no FAIL; `process.exit(1)` if any probe severity is FAIL (D-15). WARN and SKIP do not block exit 0.

4. Shell fallback (TIER-06): `pensmith doctor [--json]`.
